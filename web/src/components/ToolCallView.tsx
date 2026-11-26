// THE core idea of generative UI: map a tool call to a component.
//
// The agent decides *what* to show (by picking a tool + arguments); the
// frontend decides *how* it looks. Add a new entry to `renderers` to give a
// new tool its own UI. Anything without a renderer falls back to a JSON view.

import type { ReactNode } from "react";
import { parse as parsePartialJson } from "partial-json";
import type { ToolCall } from "@ag-ui/client";
import { WeatherCard, type Weather } from "./WeatherCard";
import { Chart, type ChartSpec } from "./Chart";

type RenderProps = {
  args: Record<string, unknown>; // may be partial while args are streaming
  result?: unknown; // undefined until TOOL_CALL_RESULT arrives
};

const renderers: Record<string, (p: RenderProps) => ReactNode> = {
  // Tool-based: render the tool's *result*.
  get_weather: ({ args, result }) =>
    result ? (
      <WeatherCard data={result as Weather} />
    ) : (
      <div className="card loading">Checking weather in {String(args.city ?? "…")}</div>
    ),

  // Declarative: render the tool's *arguments*, live, as the model writes them.
  render_chart: ({ args }) => <Chart spec={args as Partial<ChartSpec>} />,

  // The deep agent's planning tool. We already show todos from shared state,
  // so here we just leave a small marker in the chat.
  write_todos: () => <div className="pill">updated plan</div>,

  // The form itself is rendered from the interrupt (see InterruptView); the
  // tool call just shows its status in the conversation.
  request_address: ({ result }) => {
    const r = result as { status?: string; address?: { city?: string } } | undefined;
    if (!r) return <div className="pill">waiting for address…</div>;
    return (
      <div className="pill">
        {r.status === "provided" ? `📍 address shared (${r.address?.city ?? ""})` : "address declined"}
      </div>
    );
  },
};

function parseArgs(raw: string): Record<string, unknown> {
  try {
    return (parsePartialJson(raw) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

function parseResult(content: string | undefined): unknown {
  if (content === undefined) return undefined;
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

export function ToolCallView({ call, resultContent }: { call: ToolCall; resultContent?: string }) {
  const args = parseArgs(call.function.arguments);
  const result = parseResult(resultContent);
  const render = renderers[call.function.name];
  if (render) return <>{render({ args, result })}</>;
  return (
    <details className="card raw">
      <summary>
        🔧 {call.function.name} {result === undefined ? "(running…)" : "✓"}
      </summary>
      <pre>{JSON.stringify({ args, result }, null, 2)}</pre>
    </details>
  );
}
