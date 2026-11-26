// Step 5 of the docs, as a script: print the raw AG-UI event stream.
// Run with:  npm run observe -- "What's the weather in Oslo?"

import { LangGraphAgent } from "@ag-ui/langgraph";

const prompt = process.argv[2] ?? "Plan a weekend in Oslo: check the weather and chart it.";

const agent = new LangGraphAgent({
  graphId: "deep_agent",
  deploymentUrl: "http://localhost:2024",
  initialMessages: [{ id: "1", role: "user", content: prompt }],
});

await agent.runAgent(
  {},
  {
    onEvent({ event }) {
      if (event.type !== "TEXT_MESSAGE_CONTENT" && event.type !== "TOOL_CALL_ARGS")
        console.log(`\n· ${event.type}`);
    },
    onTextMessageContentEvent({ event }) {
      process.stdout.write(event.delta);
    },
    onToolCallStartEvent({ event }) {
      console.log(`  [tool] ${event.toolCallName}`);
    },
    onToolCallEndEvent({ toolCallName, toolCallArgs }) {
      console.log(`  [args] ${toolCallName}`, toolCallArgs);
    },
    onStateSnapshotEvent({ event }) {
      const s = event.snapshot as { todos?: unknown };
      console.log("  [state.todos]", s?.todos ?? "(none)");
    },
    onRunFinishedEvent() {
      console.log("\n[done]");
    },
  },
);
