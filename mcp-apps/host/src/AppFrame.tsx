/**
 * Renders one MCP App view for one tool call. This is the host side of the
 * protocol, in order:
 *
 *  1. Load the sandbox proxy (other origin) in an iframe, wait for
 *     ui/notifications/sandbox-proxy-ready.
 *  2. Create an AppBridge and connect it over postMessage. Passing the MCP
 *     client means tools/call and resources/read from the view are
 *     forwarded to the server automatically.
 *  3. resources/read the tool's ui:// resource and send the HTML with
 *     ui/notifications/sandbox-resource-ready. The view boots and sends
 *     ui/initialize; the bridge answers with host capabilities + context.
 *  4. After ui/notifications/initialized: push tool-input-partial (while the
 *     model streams), tool-input (final args) and tool-result.
 */
import type { Client, Tool } from "@modelcontextprotocol/client";
import {
  AppBridge,
  PostMessageTransport,
  type McpUiHostContext,
  type McpUiStyles,
  type McpUiUpdateModelContextRequest,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { useEffect, useRef, useState } from "react";
import { readUiResource } from "./mcp";
import { LoggingTransport } from "./traffic";

export type ModelContext = McpUiUpdateModelContextRequest["params"];

interface Props {
  client: Client;
  tool: Tool;
  resourceUri: string;
  toolUseId: string;
  args: Record<string, unknown>;
  argsDone: boolean;
  result?: CallToolResult;
  error?: string;
  onMessage: (text: string) => void;
  onModelContext: (ctx: ModelContext | null) => void;
}

const theme = () => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

export function AppFrame(p: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const [ready, setReady] = useState(false);
  const [height, setHeight] = useState(120);
  const [status, setStatus] = useState("loading sandbox…");
  const sentFinal = useRef(false);
  const sentResult = useRef(false);
  // Keep the latest callbacks without re-running the setup effect.
  const cb = useRef(p);
  cb.current = p;

  useEffect(() => {
    const iframe = iframeRef.current!;
    const link = `view:${p.tool.name}#${p.toolUseId.slice(-4)}`;
    let disposed = false;

    const hostContext: McpUiHostContext = {
      theme: theme(),
      platform: "web",
      displayMode: "inline",
      availableDisplayModes: ["inline"],
      containerDimensions: { maxHeight: 900 },
      locale: navigator.language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      toolInfo: { id: p.toolUseId, tool: p.tool },
      styles: {
        variables: {
          "--color-ring-primary": "light-dark(#6d28d9, #a78bfa)",
          "--color-background-secondary": "light-dark(#f4f4f5, #27272a)",
          "--color-border-primary": "light-dark(#e4e4e7, #3f3f46)",
          "--font-sans": "ui-sans-serif, system-ui, -apple-system, sans-serif",
          // The type lists ~75 variables; a host may send any subset, views keep their fallbacks.
        } as McpUiStyles,
      },
    };

    const bridge = new AppBridge(
      p.client,
      { name: "mcp-apps-playground-host", version: "0.1.0" },
      // What this host supports. The view reads these in ui/initialize.
      { openLinks: {}, serverTools: {}, serverResources: {}, logging: {}, updateModelContext: { text: {} }, message: { text: {} } },
      { hostContext },
    );
    bridgeRef.current = bridge;

    // Register handlers BEFORE connect().
    bridge.oninitialized = () => {
      setStatus("");
      setReady(true);
    };
    bridge.onsizechange = ({ height }) => height !== undefined && setHeight(Math.min(height, 900));
    bridge.onmessage = async ({ content }) => {
      const text = content.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
      cb.current.onMessage(text);
      return {};
    };
    bridge.onupdatemodelcontext = async (params) => {
      const empty = !params.content?.length && !params.structuredContent;
      cb.current.onModelContext(empty ? null : params);
      return {};
    };
    bridge.onopenlink = async ({ url }) => {
      window.open(url, "_blank", "noopener,noreferrer");
      return {};
    };
    bridge.onloggingmessage = (params) => console.info(`[${link}]`, params.data);

    const media = matchMedia("(prefers-color-scheme: dark)");
    const onTheme = () => bridge.sendHostContextChange({ theme: theme() });
    media.addEventListener("change", onTheme);

    // Step 1: sandbox proxy.
    const proxyReady = new Promise<void>((resolve) => {
      const onMsg = (e: MessageEvent) => {
        if (e.source === iframe.contentWindow && e.data?.method === "ui/notifications/sandbox-proxy-ready") {
          window.removeEventListener("message", onMsg);
          resolve();
        }
      };
      window.addEventListener("message", onMsg);
    });
    iframe.src = __SANDBOX_URL__;

    (async () => {
      await proxyReady;
      if (disposed) return;
      // Step 2: bridge over postMessage (target and source = this iframe only).
      const win = iframe.contentWindow!;
      await bridge.connect(new LoggingTransport(new PostMessageTransport(win, win), link));
      // Step 3: fetch the view HTML and hand it to the sandbox.
      setStatus("reading ui:// resource…");
      const { html, csp } = await readUiResource(p.client, p.resourceUri);
      if (disposed) return;
      setStatus("starting view…");
      await bridge.sendSandboxResourceReady({ html, csp });
    })().catch((e) => setStatus(`error: ${e instanceof Error ? e.message : e}`));

    return () => {
      disposed = true;
      media.removeEventListener("change", onTheme);
      bridge.teardownResource({}).catch(() => {}).finally(() => bridge.close());
    };
    // Set up once per tool call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Step 4: stream the tool call into the view.
  // Each tool-input-partial carries ALL the args so far, so sending one per
  // token is quadratic (painful for render_html). Send at most one per 150ms.
  const lastPartial = useRef(0);
  const partialTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestArgs = useRef(p.args);
  latestArgs.current = p.args;
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!ready || !bridge) return;
    if (!p.argsDone) {
      if (partialTimer.current) return; // a send is already scheduled
      const wait = Math.max(0, lastPartial.current + 150 - Date.now());
      partialTimer.current = setTimeout(() => {
        partialTimer.current = null;
        if (sentFinal.current) return;
        lastPartial.current = Date.now();
        bridge.sendToolInputPartial({ arguments: latestArgs.current });
      }, wait);
    } else if (!sentFinal.current) {
      sentFinal.current = true;
      if (partialTimer.current) clearTimeout(partialTimer.current);
      bridge.sendToolInput({ arguments: p.args });
    }
  }, [ready, p.args, p.argsDone]);

  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!ready || !bridge || sentResult.current || !sentFinal.current) return;
    if (p.result) {
      sentResult.current = true;
      bridge.sendToolResult(p.result);
    } else if (p.error) {
      sentResult.current = true;
      bridge.sendToolCancelled({ reason: p.error });
    }
  }, [ready, p.result, p.error, p.argsDone]);

  return (
    <div className="app-frame">
      <div className="app-frame-bar">
        <span>
          🧩 <b>{p.tool.name}</b> · <code>{p.resourceUri}</code>
        </span>
        {status && <span className="muted">{status}</span>}
      </div>
      <iframe ref={iframeRef} title={p.tool.name} style={{ height }} />
    </div>
  );
}
