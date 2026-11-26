/**
 * The host's agent loop: Claude + MCP tools, in the browser.
 *
 *   user text ─▶ Claude (streamed) ─▶ tool_use? ─▶ tools/call on the MCP server
 *        ▲                                              │
 *        └───────────── tool_result ◀───────────────────┘
 *
 * MCP Apps adds two inputs to this loop, both coming from views:
 *   - ui/message               -> queued as a new user turn
 *   - ui/update-model-context  -> stored, attached to the NEXT user turn
 *
 * Requests go to /anthropic, which Vite proxies to api.anthropic.com and adds
 * the API key server-side (see host/vite.config.ts).
 */
import Anthropic from "@anthropic-ai/sdk";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { parse as parsePartialJson } from "partial-json";
import { useCallback, useRef, useState } from "react";
import type { ModelContext } from "./AppFrame";
import type { McpConnection } from "./mcp";

type Msg = Anthropic.Beta.BetaMessageParam;

export type ChatItem =
  | { kind: "user"; id: string; text: string; fromView?: string; attachedContext?: string[] }
  | { kind: "assistant"; id: string; text: string }
  | {
      kind: "tool";
      id: string; // tool_use id
      name: string;
      argsText: string;
      args: Record<string, unknown>;
      argsDone: boolean;
      result?: CallToolResult;
      error?: string;
    };

export interface StoredContext {
  toolUseId: string;
  toolName: string;
  ctx: ModelContext;
  pending: boolean; // not yet sent to the model
}

const SYSTEM = `You are a helpful assistant in a playground that demonstrates MCP Apps.
Some of your tools render interactive UIs (weather card, chart, address form) directly in the chat.
When a tool has shown a UI, keep your text short; don't repeat what the UI already shows.
Messages may start with <app_context> blocks: that is state from those UIs (e.g. what the user clicked). Use it.
To show a custom UI, prefer render_ui (building blocks). Use render_html only for what the building blocks can't do: games, animations, custom visuals.`;

const anthropic = new Anthropic({
  baseURL: `${location.origin}/anthropic`,
  apiKey: "added-by-the-vite-proxy",
  dangerouslyAllowBrowser: true,
});

function toolResultContent(r: CallToolResult): Anthropic.Beta.BetaToolResultBlockParam["content"] {
  const blocks: { type: "text"; text: string }[] = r.content
    .filter((c) => c.type === "text")
    .map((c) => ({ type: "text", text: (c as { text: string }).text }));
  if (r.structuredContent) blocks.push({ type: "text", text: JSON.stringify(r.structuredContent) });
  return blocks.length ? blocks : [{ type: "text", text: "(no content)" }];
}

function safeParse(text: string): Record<string, unknown> {
  try {
    const v = parsePartialJson(text || "{}");
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function useChat(conn: McpConnection | null) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [running, setRunning] = useState(false);
  const [contexts, setContexts] = useState<Map<string, StoredContext>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const history = useRef<Msg[]>([]);
  const queue = useRef<{ text: string; fromView?: string }[]>([]);
  const busy = useRef(false);
  const contextsRef = useRef(contexts);
  contextsRef.current = contexts;

  const patch = (id: string, fn: (it: ChatItem) => ChatItem) =>
    setItems((xs) => xs.map((x) => (x.id === id ? fn(x) : x)));

  const runModel = useCallback(async () => {
    if (!conn) return;
    const tools: Anthropic.Beta.BetaTool[] = conn.modelTools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      input_schema: t.inputSchema as Anthropic.Beta.BetaTool["input_schema"],
      // Stream tool args token by token, so views get tool-input-partial.
      eager_input_streaming: true,
    }));

    for (;;) {
      const stream = anthropic.beta.messages.stream({
        model: __MODEL__,
        max_tokens: 16000,
        system: SYSTEM,
        tools,
        messages: history.current,
        output_config: { effort: "low" }, // chat-style; raise for harder tasks
        // If a safety classifier declines, the API retries on a fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });

      // content block index -> chat item id
      const blocks = new Map<number, string>();
      for await (const ev of stream) {
        if (ev.type === "content_block_start") {
          const b = ev.content_block;
          if (b.type === "text") {
            const id = crypto.randomUUID();
            blocks.set(ev.index, id);
            setItems((xs) => [...xs, { kind: "assistant", id, text: b.text }]);
          } else if (b.type === "tool_use") {
            blocks.set(ev.index, b.id);
            // Pushing the item now mounts the view while args still stream.
            setItems((xs) => [...xs, { kind: "tool", id: b.id, name: b.name, argsText: "", args: {}, argsDone: false }]);
          }
        } else if (ev.type === "content_block_delta") {
          const id = blocks.get(ev.index);
          if (!id) continue;
          if (ev.delta.type === "text_delta") {
            const d = ev.delta.text;
            patch(id, (it) => (it.kind === "assistant" ? { ...it, text: it.text + d } : it));
          } else if (ev.delta.type === "input_json_delta") {
            const d = ev.delta.partial_json;
            patch(id, (it) => {
              if (it.kind !== "tool") return it;
              const argsText = it.argsText + d;
              return { ...it, argsText, args: safeParse(argsText) };
            });
          }
        } else if (ev.type === "content_block_stop") {
          const id = blocks.get(ev.index);
          if (id) patch(id, (it) => (it.kind === "tool" ? { ...it, argsDone: true } : it));
        }
      }

      const message = await stream.finalMessage();
      history.current.push({ role: "assistant", content: message.content });

      const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (message.stop_reason === "refusal") throw new Error("The model declined this request (stop_reason: refusal).");
      if (message.stop_reason === "max_tokens" && toolUses.length) throw new Error("Tool input was cut off (max_tokens).");
      if (message.stop_reason !== "tool_use" || !toolUses.length) return;

      // Run all tool calls (in parallel) on the MCP server. The server
      // validates args against its zod schema and returns isError if invalid.
      const results = await Promise.all(
        toolUses.map(async (tu): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
          patch(tu.id, (it) => (it.kind === "tool" ? { ...it, args: tu.input as Record<string, unknown>, argsDone: true } : it));
          try {
            const r = (await conn.client.callTool({ name: tu.name, arguments: tu.input as Record<string, unknown> })) as CallToolResult;
            patch(tu.id, (it) => (it.kind === "tool" ? { ...it, result: r } : it));
            return { type: "tool_result", tool_use_id: tu.id, content: toolResultContent(r), is_error: r.isError };
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            patch(tu.id, (it) => (it.kind === "tool" ? { ...it, error: msg } : it));
            return { type: "tool_result", tool_use_id: tu.id, content: msg, is_error: true };
          }
        }),
      );
      history.current.push({ role: "user", content: results });
    }
  }, [conn]);

  /** Drain the queue of user turns one at a time. */
  const pump = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setRunning(true);
    setError(null);
    try {
      while (queue.current.length) {
        const { text, fromView } = queue.current.shift()!;
        // Attach model context that views set since the last turn.
        const pending = [...contextsRef.current.values()].filter((c) => c.pending);
        const ctxBlocks = pending.map((c) => {
          const parts = (c.ctx.content ?? []).map((b) => (b.type === "text" ? b.text : `[${b.type}]`));
          if (c.ctx.structuredContent) parts.push(JSON.stringify(c.ctx.structuredContent));
          return `<app_context tool="${c.toolName}">\n${parts.join("\n")}\n</app_context>`;
        });
        if (pending.length) {
          setContexts((m) => {
            const next = new Map(m);
            pending.forEach((c) => next.set(c.toolUseId, { ...c, pending: false }));
            return next;
          });
        }
        setItems((xs) => [...xs, { kind: "user", id: crypto.randomUUID(), text, fromView, attachedContext: ctxBlocks }]);
        history.current.push({
          role: "user",
          content: [...ctxBlocks.map((t) => ({ type: "text" as const, text: t })), { type: "text", text }],
        });
        await runModel();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      queue.current = [];
    } finally {
      busy.current = false;
      setRunning(false);
    }
  }, [runModel]);

  const send = useCallback(
    (text: string, fromView?: string) => {
      queue.current.push({ text, fromView });
      void pump();
    },
    [pump],
  );

  const setModelContext = useCallback((toolUseId: string, toolName: string, ctx: ModelContext | null) => {
    setContexts((m) => {
      const next = new Map(m);
      // Each view has ONE context slot; a new update replaces the old one.
      if (ctx) next.set(toolUseId, { toolUseId, toolName, ctx, pending: true });
      else next.delete(toolUseId);
      return next;
    });
  }, []);

  /** Call a tool directly (no model): handy for poking at views without an API key. */
  const callDirect = useCallback(
    async (name: string, args: Record<string, unknown>) => {
      if (!conn) return;
      const id = `direct_${crypto.randomUUID().slice(0, 8)}`;
      setItems((xs) => [...xs, { kind: "tool", id, name, argsText: JSON.stringify(args), args, argsDone: true }]);
      try {
        const r = (await conn.client.callTool({ name, arguments: args })) as CallToolResult;
        patch(id, (it) => (it.kind === "tool" ? { ...it, result: r } : it));
      } catch (e) {
        patch(id, (it) => (it.kind === "tool" ? { ...it, error: String(e) } : it));
      }
    },
    [conn],
  );

  return { items, running, error, contexts, send, setModelContext, callDirect };
}
