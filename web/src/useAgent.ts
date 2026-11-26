// A tiny React hook around an AG-UI agent.
//
// `LangGraphAgent` speaks to `langgraph dev` and turns the LangGraph run into
// AG-UI events (TEXT_MESSAGE_*, TOOL_CALL_*, STATE_SNAPSHOT, ...). The base
// AbstractAgent class folds those events into two things for us:
//   - agent.messages : the conversation (incl. tool calls + tool results)
//   - agent.state    : the graph state (deep agents keep `todos` here)
// We mirror both into React state and also keep a raw event log for learning.
//
// Interrupts: when the graph calls interrupt(), the run ends with
// RUN_FINISHED { outcome: "interrupt" }. We keep those open interrupts so the
// UI can render a form, then `resume()` starts a new run that answers them.

import { useEffect, useMemo, useState } from "react";
import { LangGraphAgent } from "@ag-ui/langgraph";
import type { BaseEvent, Interrupt, Message, RunAgentParameters } from "@ag-ui/client";

export type LoggedEvent = { at: number; type: string; event: BaseEvent };

export function useAgent() {
  const agent = useMemo(
    () =>
      new LangGraphAgent({
        graphId: "deep_agent", // key in agent/langgraph.json
        // Vite proxies /langgraph -> http://localhost:2024 (see vite.config.ts)
        deploymentUrl: `${window.location.origin}/langgraph`,
        // Report interrupts as RUN_FINISHED { outcome: "interrupt" } instead
        // of the legacy `on_interrupt` custom event.
        emitInterruptOutcome: true,
      }),
    [],
  );

  const [messages, setMessages] = useState<Message[]>([]);
  const [state, setState] = useState<Record<string, unknown>>({});
  const [events, setEvents] = useState<LoggedEvent[]>([]);
  const [interrupts, setInterrupts] = useState<Interrupt[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { unsubscribe } = agent.subscribe({
      onMessagesChanged: ({ messages }) => setMessages([...messages]),
      onStateChanged: ({ state }) => setState({ ...state }),
      onEvent: ({ event }) =>
        setEvents((prev) => [...prev, { at: Date.now(), type: event.type, event }]),
      onRunFinishedEvent: (params) => {
        if (params.outcome === "interrupt") setInterrupts(params.interrupts);
      },
      onRunErrorEvent: ({ event }) => setError(event.message),
      onRunFailed: ({ error }) => setError(error.message),
    });
    return unsubscribe;
  }, [agent]);

  async function run(params?: RunAgentParameters) {
    setError(null);
    setInterrupts([]);
    setRunning(true);
    try {
      await agent.runAgent(params);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  function send(text: string) {
    agent.addMessage({ id: crypto.randomUUID(), role: "user", content: text });
    return run();
  }

  // Answer an open interrupt. "resolved" hands `payload` back as the return
  // value of interrupt() in Python; "cancelled" tells the graph the user said no.
  function resume(interruptId: string, status: "resolved" | "cancelled", payload?: unknown) {
    return run({ resume: [{ interruptId, status, payload }] });
  }

  return {
    messages,
    state,
    events,
    interrupts,
    running,
    error,
    send,
    resume,
    stop: () => agent.abortRun(),
  };
}
