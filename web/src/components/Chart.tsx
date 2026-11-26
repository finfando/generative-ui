// A dependency-free SVG chart. It tolerates partial specs, so it can grow
// bar-by-bar while the model is still streaming the tool arguments.

export type ChartSpec = {
  title: string;
  labels: string[];
  values: number[];
  kind: "bar" | "line";
};

export function Chart({ spec }: { spec: Partial<ChartSpec> }) {
  const values = (spec.values ?? []).filter((v) => typeof v === "number");
  const labels = spec.labels ?? [];
  const max = Math.max(1, ...values);
  const W = 480;
  const H = 200;
  const pad = 24;
  const step = values.length ? (W - pad * 2) / values.length : 0;
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);

  return (
    <div className="card chart">
      <div className="chart-title">{spec.title ?? "…"}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={spec.title}>
        {spec.kind === "line" ? (
          <polyline
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2.5}
            points={values.map((v, i) => `${pad + step * (i + 0.5)},${y(v)}`).join(" ")}
          />
        ) : (
          values.map((v, i) => (
            <rect
              key={i}
              x={pad + step * i + step * 0.15}
              width={step * 0.7}
              y={y(v)}
              height={H - pad - y(v)}
              rx={3}
              fill="var(--accent)"
            />
          ))
        )}
        {values.map((v, i) => (
          <g key={`l${i}`} fontSize={11} textAnchor="middle" fill="var(--muted)">
            <text x={pad + step * (i + 0.5)} y={H - 6}>
              {labels[i] ?? ""}
            </text>
            <text x={pad + step * (i + 0.5)} y={y(v) - 4}>
              {v}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
