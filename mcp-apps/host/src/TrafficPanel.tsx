import { useEffect, useRef, useState } from "react";
import type { StoredContext } from "./useChat";
import { clearTraffic, useTraffic, type TrafficEntry } from "./traffic";

function label(e: TrafficEntry): string {
  const m = e.msg as { method?: string; id?: unknown; result?: unknown; error?: unknown };
  if (m.method) return m.method + ("id" in m && m.id !== undefined ? "" : " (notification)");
  return m.error ? `error #${m.id}` : `result #${m.id}`;
}

export function TrafficPanel({ contexts }: { contexts: Map<string, StoredContext> }) {
  const traffic = useTraffic();
  const [filter, setFilter] = useState<"all" | "views" | "server">("views");
  const [open, setOpen] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const shown = traffic.filter((e) => filter === "all" || (filter === "server" ? e.link === "server" : e.link !== "server"));

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [shown.length]);

  return (
    <aside className="side">
      <section>
        <h3>Model context from views</h3>
        <p className="muted small">Set by <code>ui/update-model-context</code>. Attached to your next message.</p>
        {contexts.size === 0 && <p className="muted small">none yet</p>}
        {[...contexts.values()].map((c) => (
          <div key={c.toolUseId} className="ctx">
            <div className="small">
              <b>{c.toolName}</b> {c.pending ? <span className="pill">pending</span> : <span className="pill sent">sent</span>}
            </div>
            <pre>{[...(c.ctx.content ?? []).map((b) => (b.type === "text" ? b.text : `[${b.type}]`)), c.ctx.structuredContent ? JSON.stringify(c.ctx.structuredContent) : ""].filter(Boolean).join("\n")}</pre>
          </div>
        ))}
      </section>

      <section className="traffic">
        <div className="traffic-head">
          <h3>JSON-RPC traffic</h3>
          <div className="row">
            {(["views", "server", "all"] as const).map((f) => (
              <button key={f} className={filter === f ? "tab active" : "tab"} onClick={() => setFilter(f)}>
                {f}
              </button>
            ))}
            <button className="tab" onClick={clearTraffic}>
              clear
            </button>
          </div>
        </div>
        <p className="muted small">→ host sends · ← host receives. Click a row for the payload.</p>
        <div className="traffic-list">
          {shown.map((e) => (
            <div key={e.seq} className={`t-row ${e.dir}`} onClick={() => setOpen(open === e.seq ? null : e.seq)}>
              <div className="t-line">
                <span className="t-dir">{e.dir === "out" ? "→" : "←"}</span>
                <span className="t-link">{e.link}</span>
                <span className="t-method">{label(e)}</span>
              </div>
              {open === e.seq && <pre>{JSON.stringify(e.msg, (_k, v) => (typeof v === "string" && v.length > 2000 ? `<${v.length} chars, probably the view's HTML>` : v), 2)}</pre>}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      </section>
    </aside>
  );
}
