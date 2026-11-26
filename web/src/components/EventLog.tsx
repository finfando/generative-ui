// Shows the raw AG-UI events. Watch this while chatting to see how the
// protocol drives everything else on the page.

import type { LoggedEvent } from "../useAgent";

export function EventLog({ events }: { events: LoggedEvent[] }) {
  // Collapse the very chatty *_CONTENT / *_ARGS deltas into counts.
  const rows: { type: string; count: number; last: LoggedEvent }[] = [];
  for (const e of events) {
    const prev = rows[rows.length - 1];
    if (prev && prev.type === e.type) {
      prev.count++;
      prev.last = e;
    } else rows.push({ type: e.type, count: 1, last: e });
  }

  return (
    <section className="panel events">
      <h2>AG-UI events ({events.length})</h2>
      <ol>
        {rows.slice(-200).map((r, i) => (
          <li key={i}>
            <details>
              <summary>
                <code>{r.type}</code>
                {r.count > 1 && <span className="muted"> ×{r.count}</span>}
              </summary>
              <pre>{JSON.stringify(r.last.event, null, 2)}</pre>
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}
