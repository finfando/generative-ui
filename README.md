# Generative UI playground (Deep Agents + AG-UI)

A small learning project based on
[Deep Agents → AG-UI](https://docs.langchain.com/oss/python/deepagents/ag-ui).

```
┌──────────────┐  HTTP/SSE   ┌──────────────────┐  AG-UI events  ┌──────────────────────┐
│ deep agent   │ ──────────▶ │ @ag-ui/langgraph │ ─────────────▶ │ React: messages,     │
│ (Python,     │  langgraph  │ LangGraphAgent   │  TEXT_MESSAGE_*│ tool calls → cards,  │
│ langgraph dev│  dev :2024  │ (in the browser) │  TOOL_CALL_*   │ state → todo panel   │
└──────────────┘             └──────────────────┘  STATE_*       └──────────────────────┘
```

> **See also:** [mcp-apps/](mcp-apps/README.md), a sibling playground for
> MCP Apps, where the MCP *server* ships the UI and any host renders it in a
> sandboxed iframe.

There is deliberately **no CopilotKit** here, so you can see exactly how
protocol events turn into UI. CopilotKit is a good next step once this makes
sense (it does the same thing with ready-made hooks).

## Run it

You need an Anthropic API key.

```bash
cp agent/.env.example agent/.env   # then put your key in agent/.env
```

Terminal 1, the agent (serves on http://localhost:2024):

```bash
cd agent && uv run langgraph dev --no-browser
```

Terminal 2, the UI (http://localhost:5173):

```bash
cd web && npm run dev
```

Optional, print the raw event stream in the terminal (docs step 5):

```bash
cd web && npm run observe -- "What's the weather in Oslo?"
```

## The three generative-UI patterns in this repo

| Pattern | Where | What happens |
|---|---|---|
| **Tool-based** (static) | `get_weather` in [agent/agent.py](agent/agent.py) → `WeatherCard` | Agent calls a tool; the frontend maps the tool **name** to a component and fills it with the tool **result**. |
| **Declarative** | `render_chart` → [Chart.tsx](web/src/components/Chart.tsx) | Agent describes UI in the tool **arguments**. Args stream in as `TOOL_CALL_ARGS` deltas, parsed with `partial-json`, so the chart grows while the model is still writing. |
| **Shared state** | `write_todos` (from `TodoListMiddleware`) → [TodoPanel.tsx](web/src/components/TodoPanel.tsx) | The agent keeps `todos` in graph state. AG-UI streams it as `STATE_SNAPSHOT` / `STATE_DELTA`, so the plan panel updates live. |

### Interactive UI: forms via interrupts

`request_address` in [agent/agent.py](agent/agent.py) shows how the agent can
**ask the user for input** through a real form:

1. The tool calls `interrupt({"form": "address", "message": reason})`. The
   graph saves its state and the run ends with
   `RUN_FINISHED { outcome: "interrupt" }` (the agent is created with
   `emitInterruptOutcome: true` in [useAgent.ts](web/src/useAgent.ts)).
2. [InterruptView.tsx](web/src/components/InterruptView.tsx) reads the value
   (`interrupt.metadata.langgraph.raw`) and picks a form by its `form` key, here
   [AddressForm.tsx](web/src/components/AddressForm.tsx). The chat input is
   disabled while a form is open.
3. Submitting calls `runAgent({ resume: [{ interruptId, status: "resolved", payload }] })`.
   Back in Python, `interrupt()` returns `payload`, and the tool finishes.
4. "Don't share" sends `status: "cancelled"`. The adapter delivers that as
   `{"__agui_cancelled__": true, ...}`, which the tool turns into a "declined" result.

Try it with the "Order me a coffee grinder…" suggestion. To add another form,
call `interrupt({"form": "<name>", ...})` from a tool and add a `<name>` entry to
the `forms` map in `InterruptView.tsx`.

The key file is [web/src/components/ToolCallView.tsx](web/src/components/ToolCallView.tsx):
a `renderers` map from tool name to React component. That map *is* the
generative UI. The [web/src/useAgent.ts](web/src/useAgent.ts) hook shows how
little glue AG-UI needs: subscribe, mirror `messages` + `state` into React.

The right-hand **AG-UI events** panel shows every event. Expand one to see its
payload. Watching it while chatting is the fastest way to learn the protocol.

## Exercises

1. **Add a tool + renderer.** Add `get_stock_price(ticker)` to `agent.py`, then
   a `StockCard` entry in `renderers`. (`langgraph dev` hot-reloads Python.)
2. **Approve before running.** Pass `interrupt_on={"render_chart": True}` to
   `create_deep_agent`. The interrupt plumbing already exists, so you only need
   a proper Approve / Edit / Reject renderer in `InterruptView.tsx` (inspect the
   raw value in the events panel to see what deepagents sends).
3. **Subagents.** Add `subagents=[...]` to the deep agent and look at the
   `subagentRunId` on messages and the `SUBAGENT_*` events in the log.
4. **Frontend tools.** Let the *browser* own a tool (e.g. `set_theme`).
   This is where CopilotKit (`useFrontendTool`) or its `CopilotKitMiddleware`
   saves real work. See the
   [CopilotKit integration](https://docs.langchain.com/oss/python/langchain/frontend/integrations/copilotkit).
5. **Swap the model.** Set `MODEL=openai:...` (and install `langchain-openai`).
   The UI does not change, which is the point of AG-UI.

## Layout

```
agent/            Python deep agent (uv project)
  agent.py        tools + create_deep_agent
  langgraph.json  graph id "deep_agent" -> agent.py:agent
web/              Vite + React + TypeScript
  src/useAgent.ts           AG-UI client hook
  src/components/           ToolCallView (tool renderers), InterruptView (forms), AddressForm,
                            WeatherCard, Chart, TodoPanel, EventLog
  scripts/observe-events.ts terminal event printer
  vite.config.ts            proxies /langgraph -> :2024 (avoids CORS)
```
