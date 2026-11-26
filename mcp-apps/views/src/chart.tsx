/**
 * Chart view: renders render_chart's ARGUMENTS. Bars appear while Claude is
 * still writing them, because the host forwards partial args
 * (ui/notifications/tool-input-partial). Clicking a bar calls
 * app.updateModelContext, so "this one" in the next message makes sense.
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Shell, useView } from "./shared";

function ChartView() {
  const { app, error, tool } = useView("chart");
  const [selected, setSelected] = useState<number | null>(null);

  const args = tool.input ?? {};
  const title = typeof args.title === "string" ? args.title : "";
  const labels = Array.isArray(args.labels) ? (args.labels as string[]) : [];
  const values = Array.isArray(args.values) ? (args.values as unknown[]).filter((v): v is number => typeof v === "number") : [];
  const kind = args.kind === "line" ? "line" : "bar";
  const n = Math.min(labels.length, values.length);
  const max = Math.max(1, ...values.slice(0, n));

  async function select(i: number) {
    setSelected(i);
    await app?.updateModelContext({
      content: [{ type: "text", text: `On the chart "${title}" the user selected ${labels[i]} = ${values[i]}.` }],
    });
  }

  const W = 520, H = 200, pad = 24;
  const step = n > 0 ? (W - pad * 2) / n : 0;
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);

  return (
    <Shell app={app} error={error}>
      <h2>{title || <span className="muted">…</span>}</h2>
      <svg viewBox={`0 0 ${W} ${H + 20}`} width="100%" role="img" aria-label={title}>
        <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="var(--color-border-primary)" />
        {kind === "line" && n > 1 && (
          <polyline
            fill="none"
            stroke="var(--color-ring-primary)"
            strokeWidth={2}
            points={values.slice(0, n).map((v, i) => `${pad + step * (i + 0.5)},${y(v)}`).join(" ")}
          />
        )}
        {labels.slice(0, n).map((label, i) => {
          const cx = pad + step * (i + 0.5);
          const v = values[i];
          const active = selected === i;
          return (
            <g key={i} onClick={() => select(i)} style={{ cursor: "pointer" }}>
              {kind === "bar" ? (
                <rect
                  x={cx - step * 0.35}
                  y={y(v)}
                  width={step * 0.7}
                  height={H - pad - y(v)}
                  rx={3}
                  fill="var(--color-ring-primary)"
                  opacity={selected === null || active ? 1 : 0.4}
                />
              ) : (
                <circle cx={cx} cy={y(v)} r={active ? 6 : 4} fill="var(--color-ring-primary)" />
              )}
              <text x={cx} y={y(v) - 6} textAnchor="middle" fontSize={11} fill="var(--color-text-secondary)">
                {v}
              </text>
              <text x={cx} y={H - pad + 16} textAnchor="middle" fontSize={11} fill="var(--color-text-primary)">
                {label}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="note">
        {!tool.inputComplete
          ? `streaming arguments… ${n} point${n === 1 ? "" : "s"} so far`
          : selected !== null
            ? `Selected ${labels[selected]}. The model will know on your next message (try "why is this one so high?").`
            : "Click a bar or point to select it."}
      </p>
    </Shell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ChartView />
  </StrictMode>,
);
