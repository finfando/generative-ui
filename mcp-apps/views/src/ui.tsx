/**
 * Declarative generative UI: renders the component tree the model writes in
 * render_ui's `root` argument.
 *
 * The VIEW owns the components; the model only arranges them. So the result
 * always matches the host's styles, and the model never runs code.
 *
 * The tree arrives through ui/notifications/tool-input-partial while Claude is
 * still writing it, so every renderer must cope with half-written nodes
 * (missing fields, truncated arrays). Unknown or incomplete nodes render as
 * nothing instead of crashing.
 *
 * Interactivity goes back through the host:
 *   button -> app.sendMessage(node.message)
 *   form   -> app.updateModelContext(values) + app.sendMessage(summary)
 */
import type { App } from "@modelcontextprotocol/ext-apps";
import { StrictMode, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Shell, useView } from "./shared";

// Loose on purpose: during streaming any field may be missing.
type Node = { type?: string; [k: string]: unknown };

const str = (v: unknown, d = "") => (typeof v === "string" ? v : typeof v === "number" ? String(v) : d);
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const toneColor: Record<string, string> = {
  muted: "var(--color-text-secondary)",
  success: "var(--color-text-success)",
  warning: "var(--color-text-warning)",
  danger: "var(--color-text-danger)",
};

function Render({ node, app, done }: { node: unknown; app: App; done: boolean }): ReactNode {
  if (!node || typeof node !== "object") return null;
  const n = node as Node;
  const kids = (k: unknown) => arr<unknown>(k).map((c, i) => <Render key={i} node={c} app={app} done={done} />);
  const color = toneColor[str(n.tone)];

  switch (n.type) {
    case "stack": {
      const row = n.direction === "row";
      const style: CSSProperties = { display: "flex", flexDirection: row ? "row" : "column", gap: typeof n.gap === "number" ? n.gap : 10, flexWrap: row ? "wrap" : undefined };
      return <div style={style} className={row ? "g-row" : undefined}>{kids(n.children)}</div>;
    }
    case "card":
      return (
        <section className="g-card">
          {str(n.title) && <div className="g-card-title">{str(n.title)}</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{kids(n.children)}</div>
        </section>
      );
    case "heading": {
      const size = n.level === 1 ? 20 : n.level === 3 ? 14 : 16;
      return <div style={{ fontSize: size, fontWeight: 650 }}>{str(n.text)}</div>;
    }
    case "text":
      return <p style={{ margin: 0, color, lineHeight: 1.45 }}>{str(n.text)}</p>;
    case "badge":
      return <span className="g-badge" style={{ color: color ?? "var(--color-ring-primary)" }}>{str(n.text)}</span>;
    case "stat":
      return (
        <div className="g-stat">
          <div className="muted" style={{ fontSize: 12 }}>{str(n.label)}</div>
          <div style={{ fontSize: 24, fontWeight: 650 }}>{str(n.value, "…")}</div>
          {str(n.delta) && <div style={{ fontSize: 12, color: color ?? "var(--color-text-secondary)" }}>{str(n.delta)}</div>}
        </div>
      );
    case "progress": {
      const v = Math.max(0, Math.min(100, Number(n.value) || 0));
      return (
        <div>
          <div className="row" style={{ justifyContent: "space-between", fontSize: 12 }}>
            <span>{str(n.label)}</span>
            <span className="muted">{v}%</span>
          </div>
          <div className="g-track"><div className="g-fill" style={{ width: `${v}%` }} /></div>
        </div>
      );
    }
    case "table": {
      const cols = arr<string>(n.columns);
      return (
        <table className="g-table">
          <thead><tr>{cols.map((c, i) => <th key={i}>{str(c)}</th>)}</tr></thead>
          <tbody>
            {arr<unknown[]>(n.rows).map((r, i) => (
              <tr key={i}>{arr<unknown>(r).map((c, j) => <td key={j}>{str(c)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      );
    }
    case "bar_chart": {
      const labels = arr<string>(n.labels);
      const values = arr<unknown>(n.values).filter((v): v is number => typeof v === "number");
      const k = Math.min(labels.length, values.length);
      const max = Math.max(1, ...values.slice(0, k));
      return (
        <div style={{ display: "grid", gap: 4 }}>
          {labels.slice(0, k).map((l, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "90px 1fr 48px", gap: 8, alignItems: "center", fontSize: 12 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{str(l)}</span>
              <div className="g-track"><div className="g-fill" style={{ width: `${(values[i] / max) * 100}%` }} /></div>
              <span className="muted" style={{ textAlign: "right" }}>{values[i]}</span>
            </div>
          ))}
        </div>
      );
    }
    case "list": {
      const items = arr<unknown>(n.items).map((it, i) => <li key={i}>{str(it)}</li>);
      return n.ordered ? <ol className="g-list">{items}</ol> : <ul className="g-list">{items}</ul>;
    }
    case "divider":
      return <hr className="g-hr" />;
    case "button":
      return (
        <div>
          <button
            className={n.variant === "secondary" ? undefined : "primary"}
            disabled={!done || !str(n.message)}
            onClick={() => app.sendMessage({ role: "user", content: [{ type: "text", text: str(n.message) }] })}
          >
            {str(n.label, "…")}
          </button>
        </div>
      );
    case "form":
      return <GenForm node={n} app={app} done={done} />;
    default:
      return null; // unknown type, or "type" not streamed yet
  }
}

type Field = { name?: string; label?: string; kind?: string; options?: string[]; placeholder?: string };

function GenForm({ node, app, done }: { node: Node; app: App; done: boolean }) {
  const fields = arr<Field>(node.fields).filter((f) => f && f.name);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await app.updateModelContext({
      content: [{ type: "text", text: `The user submitted the form "${str(node.title, "form")}".` }],
      structuredContent: { form: str(node.title), values },
    });
    const summary = fields.map((f) => `${f.label ?? f.name}: ${values[f.name!] ?? ""}`).join("\n");
    await app.sendMessage({ role: "user", content: [{ type: "text", text: `${str(node.title, "Form")}\n${summary}` }] });
    setSent(true);
  }

  return (
    <form className="g-card" onSubmit={submit} style={{ display: "grid", gap: 8 }}>
      {str(node.title) && <div className="g-card-title">{str(node.title)}</div>}
      {fields.map((f) => {
        const set = (v: string | boolean) => setValues((s) => ({ ...s, [f.name!]: v }));
        const label = <span style={{ fontSize: 12 }}>{f.label ?? f.name}</span>;
        if (f.kind === "checkbox")
          return (
            <label key={f.name} className="row">
              <input type="checkbox" style={{ width: "auto" }} disabled={sent} onChange={(e) => set(e.target.checked)} /> {label}
            </label>
          );
        if (f.kind === "select")
          return (
            <label key={f.name} style={{ display: "grid", gap: 4 }}>
              {label}
              <select disabled={sent} defaultValue="" onChange={(e) => set(e.target.value)}>
                <option value="" disabled>Choose…</option>
                {arr<string>(f.options).map((o) => <option key={o}>{o}</option>)}
              </select>
            </label>
          );
        return (
          <label key={f.name} style={{ display: "grid", gap: 4 }}>
            {label}
            <input type={f.kind === "number" || f.kind === "date" ? f.kind : "text"} placeholder={f.placeholder} disabled={sent} onChange={(e) => set(e.target.value)} />
          </label>
        );
      })}
      <div>
        <button type="submit" className="primary" disabled={!done || sent}>
          {sent ? "Sent ✓" : str(node.submitLabel, "Submit")}
        </button>
      </div>
    </form>
  );
}

function UiView() {
  const { app, error, tool } = useView("ui");
  const title = str(tool.input?.title);
  const failed = tool.result?.isError
    ? tool.result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n")
    : null;
  return (
    <Shell app={app} error={error}>
      {title && <h2>{title}</h2>}
      {!tool.input?.root && <p className="muted">Waiting for the model to write the UI…</p>}
      {app && <Render node={tool.input?.root} app={app} done={tool.inputComplete} />}
      {!tool.inputComplete && tool.input?.root != null && <p className="note">streaming spec…</p>}
      {failed && <pre className="error" style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{failed}</pre>}
    </Shell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UiView />
  </StrictMode>,
);
