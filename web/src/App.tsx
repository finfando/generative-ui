import { useState } from "react";
import type { Message, ToolMessage } from "@ag-ui/client";
import { useAgent } from "./useAgent";
import { ToolCallView } from "./components/ToolCallView";
import { TodoPanel } from "./components/TodoPanel";
import { EventLog } from "./components/EventLog";
import { InterruptView } from "./components/InterruptView";
import "./App.css";

const SUGGESTIONS = [
  "What's the weather in Warsaw and Lisbon?",
  "Compare the weather in 5 European capitals and chart the temperatures.",
  "Plan a 3-day trip to Tokyo: check weather, then chart a rough daily budget.",
  "Order me a coffee grinder delivered to my home.",
];

function contentText(m: Message): string {
  return typeof m.content === "string" ? m.content : "";
}

export default function App() {
  const { messages, state, events, interrupts, running, error, send, resume, stop } = useAgent();
  const [input, setInput] = useState("");

  // Index tool results by the tool call they answer.
  const results = new Map<string, string>();
  for (const m of messages)
    if (m.role === "tool") results.set((m as ToolMessage).toolCallId, contentText(m));

  function submit(text: string) {
    if (!text.trim() || running || interrupts.length) return;
    setInput("");
    void send(text);
  }

  return (
    <div className="layout">
      <main className="chat">
        <header>
          <h1>Generative UI playground</h1>
          <p className="muted">Deep agent → AG-UI events → React components</p>
        </header>

        <div className="messages">
          {messages.length === 0 && (
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => submit(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}

          {messages.map((m) => {
            if (m.role === "user")
              return (
                <div key={m.id} className="bubble user">
                  {contentText(m)}
                </div>
              );
            if (m.role === "assistant")
              return (
                <div key={m.id} className="assistant">
                  {contentText(m) && <div className="bubble">{contentText(m)}</div>}
                  {m.toolCalls?.map((tc) => (
                    <ToolCallView key={tc.id} call={tc} resultContent={results.get(tc.id)} />
                  ))}
                </div>
              );
            return null; // tool messages are rendered via their tool call
          })}
          {interrupts.map((it) => (
            <InterruptView
              key={it.id}
              interrupt={it}
              onResume={(status, payload) => void resume(it.id, status, payload)}
            />
          ))}
          {running && <div className="muted">thinking…</div>}
          {error && <div className="error">{error}</div>}
        </div>

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={interrupts.length ? "Answer the form above first…" : "Ask the agent something…"}
            disabled={interrupts.length > 0}
          />
          {running ? (
            <button type="button" onClick={stop}>
              Stop
            </button>
          ) : (
            <button type="submit">Send</button>
          )}
        </form>
      </main>

      <aside className="side">
        <TodoPanel todos={state.todos as never} />
        <EventLog events={events} />
      </aside>
    </div>
  );
}
