import { useEffect, useRef, useState } from "react";
import { AppFrame } from "./AppFrame";
import { connectMcp, getToolUiResourceUri, type McpConnection } from "./mcp";
import { TrafficPanel } from "./TrafficPanel";
import { useChat, type ChatItem } from "./useChat";

const SUGGESTIONS = [
  "What's the weather in Oslo?",
  "Chart the populations of the 5 largest EU countries",
  "Order me a coffee grinder delivered to my home",
  "What time is it on the server?",
  "Plan a 3-day trip to Lisbon as a dashboard, with a form to adjust budget and pace",
  "Make a tiny reaction-time game; send me my score when I finish",
];

const DIRECT_CALLS: { name: string; args: Record<string, unknown> }[] = [
  { name: "get_weather", args: { city: "Kraków" } },
  { name: "render_chart", args: { title: "Coffee per day", labels: ["Mon", "Tue", "Wed", "Thu", "Fri"], values: [2, 3, 1, 4, 2], kind: "bar" } },
  { name: "request_address", args: { reason: "Where should we send your sticker?" } },
  // Hand-written stand-ins for what the model would generate:
  {
    name: "render_ui",
    args: {
      title: "Sprint 42",
      root: {
        type: "stack",
        children: [
          {
            type: "stack",
            direction: "row",
            children: [
              { type: "stat", label: "Done", value: 18, delta: "+5 this week", tone: "success" },
              { type: "stat", label: "In progress", value: 6 },
              { type: "stat", label: "Blocked", value: 2, tone: "danger", delta: "needs review" },
            ],
          },
          { type: "progress", label: "Sprint goal", value: 72 },
          {
            type: "table",
            columns: ["Ticket", "Owner", "Status"],
            rows: [["Login flow", "Ana", "Done"], ["Billing page", "Ola", "In review"], ["CSV export", "Piotr", "Blocked"]],
          },
          {
            type: "stack",
            direction: "row",
            children: [
              { type: "button", label: "Summarize risks", message: "Summarize the risks in this sprint." },
              { type: "button", label: "Draft standup note", message: "Draft a standup note from this.", variant: "secondary" },
            ],
          },
        ],
      },
    },
  },
  {
    name: "render_html",
    args: {
      title: "Click counter",
      html: `<!doctype html><html><head><style>
body{font:14px system-ui;margin:0;padding:16px;color-scheme:light dark;text-align:center}
button{font-size:28px;padding:16px 28px;border-radius:14px;border:0;background:#7c3aed;color:#fff;cursor:pointer;transition:transform .1s}
button:active{transform:scale(.95)}
</style></head><body>
<p>Model-written HTML, running in the sandbox.</p>
<button id="b">Clicked 0×</button>
<p><a href="#" id="s">Send my count to Claude</a></p>
<script>
let n=0; const b=document.getElementById('b');
b.onclick=()=>{ b.textContent='Clicked '+(++n)+'×'; mcp.updateContext('The user has clicked the counter '+n+' times.'); };
document.getElementById('s').onclick=(e)=>{ e.preventDefault(); mcp.sendMessage('I clicked the counter '+n+' times!'); };
</script></body></html>`,
    },
  },
];

export function App() {
  const [conn, setConn] = useState<McpConnection | null>(null);
  const [connError, setConnError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const chat = useChat(conn);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    connectMcp().then(setConn, (e) => setConnError(String(e)));
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat.items.length]);

  const submit = (text: string) => {
    if (!text.trim() || !__HAS_KEY__) return;
    chat.send(text.trim());
    setInput("");
  };

  return (
    <div className="layout">
      <main className="chat">
        <header>
          <h1>MCP Apps playground</h1>
          <div className="muted small">
            {connError ? (
              <span className="err">MCP server unreachable: {connError}</span>
            ) : conn ? (
              <>
                {conn.tools.length} tools ·{" "}
                {conn.tools.map((t) => (
                  <span key={t.name} className="tool-chip" title={JSON.stringify(t._meta ?? {})}>
                    {getToolUiResourceUri(t) ? "🧩 " : ""}
                    {t.name}
                    {!conn.modelTools.includes(t) ? " (app-only)" : ""}
                  </span>
                ))}{" "}
                · model {__MODEL__}
              </>
            ) : (
              "connecting to MCP server…"
            )}
          </div>
        </header>

        <div className="messages">
          {chat.items.length === 0 && (
            <p className="empty">Ask Claude something below, or call a UI tool directly (no model) with the "call …" buttons.</p>
          )}
          {chat.items.map((it) => (
            <Item key={it.id} item={it} conn={conn} chat={chat} />
          ))}
          {chat.error && <div className="err">⚠ {chat.error}</div>}
          <div ref={endRef} />
        </div>

        {!__HAS_KEY__ && (
          <div className="err small">
            No ANTHROPIC_API_KEY found (looked in mcp-apps/.env and agent/.env). Chat is off; the "call …" buttons still work.
          </div>
        )}
        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => submit(s)} disabled={chat.running || !conn || !__HAS_KEY__}>
              {s}
            </button>
          ))}
        </div>
        <div className="suggestions">
          <span className="muted small">no model:</span>
          {DIRECT_CALLS.map((c) => (
            <button key={c.name} onClick={() => chat.callDirect(c.name, c.args)} disabled={!conn}>
              call {c.name}
            </button>
          ))}
        </div>
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
        >
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Message Claude…" disabled={!conn || !__HAS_KEY__} />
          <button type="submit" disabled={chat.running || !input.trim() || !__HAS_KEY__}>
            {chat.running ? "…" : "Send"}
          </button>
        </form>
      </main>
      <TrafficPanel contexts={chat.contexts} />
    </div>
  );
}

function Item({ item, conn, chat }: { item: ChatItem; conn: McpConnection | null; chat: ReturnType<typeof useChat> }) {
  if (item.kind === "user") {
    return (
      <div className="msg user">
        {item.fromView && <div className="from-view">sent by the {item.fromView} view (ui/message)</div>}
        {!!item.attachedContext?.length && (
          <details className="from-view">
            <summary>+ {item.attachedContext.length} app context block(s) attached</summary>
            <pre>{item.attachedContext.join("\n")}</pre>
          </details>
        )}
        {item.text}
      </div>
    );
  }
  if (item.kind === "assistant") return item.text ? <div className="msg assistant">{item.text}</div> : null;

  const tool = conn?.tools.find((t) => t.name === item.name);
  const uri = tool && getToolUiResourceUri(tool);
  if (conn && tool && uri) {
    return (
      <AppFrame
        client={conn.client}
        tool={tool}
        resourceUri={uri}
        toolUseId={item.id}
        args={item.args}
        argsDone={item.argsDone}
        result={item.result}
        error={item.error}
        onMessage={(text) => chat.send(text, item.name)}
        onModelContext={(ctx) => chat.setModelContext(item.id, item.name, ctx)}
      />
    );
  }
  // A tool without UI: generic card.
  return (
    <div className="tool-card">
      <div>
        🔧 <b>{item.name}</b> <code>{item.argsText || "{}"}</code>
      </div>
      {item.result && <pre>{item.result.content.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n")}</pre>}
      {item.error && <div className="err">{item.error}</div>}
    </div>
  );
}
