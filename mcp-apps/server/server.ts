/**
 * An MCP server whose tools come with their own UI ("MCP Apps").
 *
 * Every UI tool is registered in two halves, tied together by a `ui://` URI:
 *
 *   registerAppTool(..., { _meta: { ui: { resourceUri } } })   <- the tool
 *   registerAppResource(..., resourceUri, ...)                 <- its HTML
 *
 * The host (our chat client in ../host) sees `_meta.ui.resourceUri` on the
 * tool, reads that resource (`resources/read`), and renders the HTML in a
 * sandboxed iframe. From then on the iframe ("view") talks JSON-RPC over
 * postMessage with the host, NOT with this server directly.
 *
 * Compare with the AG-UI playground next door: there the *frontend* owns the
 * components and maps tool names to them. Here the *server* ships the UI, so
 * any MCP Apps host (Claude, ChatGPT, VS Code, ...) can render it unchanged.
 */
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { registerGenerativeTools } from "./generative.ts";

const VIEWS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "views", "dist");

/** Register a `ui://` resource that serves one bundled view from views/dist. */
function registerView(server: McpServer, name: string) {
  const uri = `ui://${name}/view.html`;
  registerAppResource(server, `${name} view`, uri, { mimeType: RESOURCE_MIME_TYPE }, async () => {
    // Read on every request so `npm run dev` picks up rebuilt views.
    const html = await fs.readFile(path.join(VIEWS_DIR, `${name}.html`), "utf-8");
    return {
      contents: [
        {
          uri,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
          // Optional per-resource metadata. `csp` lists the external origins
          // the view may load from / connect to. Ours are fully self-contained.
          _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true } },
        },
      ],
    };
  });
  return uri;
}

function fakeWeather(city: string) {
  // Deterministic fake data, so it works offline (same idea as agent/agent.py).
  let seed = [...city.toLowerCase()].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) % 1000) / 1000;
  const conditions = ["sunny", "cloudy", "rainy", "snowy", "windy"] as const;
  const base = Math.round(rnd() * 37 - 5);
  return {
    city,
    temperature_c: base,
    condition: conditions[Math.floor(rnd() * conditions.length)],
    humidity: Math.round(20 + rnd() * 75),
    forecast: ["Mon", "Tue", "Wed", "Thu", "Fri"].map((day) => ({
      day,
      temperature_c: base + Math.round(rnd() * 8 - 4),
    })),
    fetched_at: new Date().toISOString(),
  };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "mcp-apps-playground", version: "0.1.0" });

  // ── 1. Tool result -> UI ────────────────────────────────────────────────
  // The view gets the tool *result* (ui/notifications/tool-result) and draws
  // a card. Its "Refresh" button calls this same tool again via the host
  // (tools/call proxied through the AppBridge), without involving the model.
  const weatherUri = registerView(server, "weather");
  registerAppTool(
    server,
    "get_weather",
    {
      title: "Get weather",
      description: "Get the current weather and a 5-day forecast for a city. The user sees it as an interactive card.",
      inputSchema: { city: z.string().describe("City name, e.g. Oslo") },
      _meta: { ui: { resourceUri: weatherUri } },
    },
    async ({ city }): Promise<CallToolResult> => {
      const w = fakeWeather(city);
      return {
        // `content` is what the model reads.
        content: [{ type: "text", text: `${w.city}: ${w.temperature_c}°C, ${w.condition}, humidity ${w.humidity}%.` }],
        // `structuredContent` is typed data for the view (the model may see it too).
        structuredContent: w,
      };
    },
  );

  // ── 2. Streaming tool input -> UI ───────────────────────────────────────
  // The view draws the chart from the tool *arguments*. The host forwards
  // the arguments while Claude is still writing them
  // (ui/notifications/tool-input-partial), so bars appear one by one.
  // Clicking a bar calls ui/update-model-context: the host keeps that text
  // and gives it to the model on the next turn.
  const chartUri = registerView(server, "chart");
  registerAppTool(
    server,
    "render_chart",
    {
      title: "Render chart",
      description:
        "Show a bar or line chart to the user. Use whenever numbers would be clearer visually. " +
        "The chart is drawn in the user's interface, so do not repeat the numbers in text afterwards.",
      inputSchema: {
        title: z.string(),
        labels: z.array(z.string()),
        values: z.array(z.number()),
        kind: z.enum(["bar", "line"]).default("bar"),
      },
      _meta: { ui: { resourceUri: chartUri } },
    },
    async ({ title, values }): Promise<CallToolResult> => ({
      content: [{ type: "text", text: `Chart "${title}" with ${values.length} points is shown to the user.` }],
    }),
  );

  // ── 3. Interactive form -> new user message ─────────────────────────────
  // In AG-UI we paused the graph with interrupt(). MCP Apps has no "pause":
  // the tool returns right away, the form stays on screen, and when the user
  // submits it the view sends a ui/message. The host appends that as a user
  // message and runs the model again.
  const addressUri = registerView(server, "address");
  registerAppTool(
    server,
    "request_address",
    {
      title: "Request address",
      description:
        "Show the user a form to enter a postal address. Use this whenever you need an address; never ask for it in plain text. " +
        "The tool returns immediately. The address arrives later as the user's next message.",
      inputSchema: { reason: z.string().describe("Shown above the form, e.g. 'Where should we deliver the grinder?'") },
      _meta: { ui: { resourceUri: addressUri } },
    },
    async (): Promise<CallToolResult> => ({
      content: [
        {
          type: "text",
          text: "The address form is now shown to the user. Stop here and wait: their address will arrive as their next message.",
        },
      ],
    }),
  );

  // App-only tool: visibility ["app"] hides it from the model. Only the
  // address view calls it (to validate the postcode as you type).
  registerAppTool(
    server,
    "validate_postcode",
    {
      title: "Validate postcode",
      description: "Check whether a postcode looks valid for a country.",
      inputSchema: { country: z.string(), postcode: z.string() },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ country, postcode }): Promise<CallToolResult> => {
      const patterns: Record<string, RegExp> = {
        NO: /^\d{4}$/,
        PL: /^\d{2}-\d{3}$/,
        DE: /^\d{5}$/,
        US: /^\d{5}(-\d{4})?$/,
        GB: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i,
      };
      const re = patterns[country.toUpperCase()];
      const valid = re ? re.test(postcode.trim()) : postcode.trim().length > 0;
      return {
        content: [{ type: "text", text: valid ? "valid" : "invalid" }],
        structuredContent: { valid, hint: re ? `expected ${re.source}` : "unknown country, any value accepted" },
      };
    },
  );

  // ── 5 + 6. Generative tools: the model writes the UI (see generative.ts) ──
  registerGenerativeTools(server, registerView);

  // ── 4. A plain tool, no UI ──────────────────────────────────────────────
  // For contrast: the host shows a generic JSON card.
  server.registerTool(
    "get_time",
    { description: "Get the server's current time (ISO 8601).", inputSchema: z.object({}) },
    async (): Promise<CallToolResult> => ({ content: [{ type: "text", text: new Date().toISOString() }] }),
  );

  return server;
}
