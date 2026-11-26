// Shared-state generative UI: deep agents keep a `todos` list in graph state.
// AG-UI streams that state as STATE_SNAPSHOT / STATE_DELTA events, so this
// panel updates live as the agent plans and ticks things off.

type Todo = { content: string; status: "pending" | "in_progress" | "completed" };

const MARK = { pending: "○", in_progress: "◐", completed: "●" } as const;

export function TodoPanel({ todos }: { todos?: Todo[] }) {
  return (
    <section className="panel">
      <h2>Agent plan</h2>
      {!todos?.length ? (
        <p className="muted">No plan yet. Ask for something multi-step.</p>
      ) : (
        <ul className="todos">
          {todos.map((t, i) => (
            <li key={i} className={t.status}>
              <span>{MARK[t.status] ?? "○"}</span> {t.content}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
