/**
 * Shared bits for every view. A "view" is the HTML that runs inside the
 * host's sandboxed iframe. It talks to the host through the `App` class
 * from @modelcontextprotocol/ext-apps (JSON-RPC over postMessage).
 *
 * Host -> view notifications we listen to:
 *   ui/notifications/tool-input-partial  args while the model is still writing them
 *   ui/notifications/tool-input          final args
 *   ui/notifications/tool-result         the tool's CallToolResult
 *   ui/notifications/host-context-changed theme, size, display mode...
 *
 * View -> host requests we use:
 *   tools/call                 app.callServerTool(...)   (host forwards to the MCP server)
 *   ui/message                 app.sendMessage(...)      (becomes a user chat message)
 *   ui/update-model-context    app.updateModelContext(...) (extra context for the next turn)
 *   notifications/message      app.sendLog(...)
 */
import type { App } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { useState, type ReactNode } from "react";
import "./view.css";

export interface ToolState {
  /** Args: partial while streaming, then final. */
  input?: Record<string, unknown>;
  inputComplete: boolean;
  result?: CallToolResult;
  cancelled?: string;
}

export function useView(name: string): { app: App | null; error: Error | null; tool: ToolState } {
  const [tool, setTool] = useState<ToolState>({ inputComplete: false });
  const { app, error } = useApp({
    appInfo: { name, version: "0.1.0" },
    capabilities: {},
    // Register handlers before connect() so no early notification is missed.
    onAppCreated: (app) => {
      app.ontoolinputpartial = ({ arguments: args }) => setTool((t) => ({ ...t, input: args }));
      app.ontoolinput = ({ arguments: args }) => setTool((t) => ({ ...t, input: args, inputComplete: true }));
      app.ontoolresult = (result) => setTool((t) => ({ ...t, result }));
      app.ontoolcancelled = ({ reason }) => setTool((t) => ({ ...t, cancelled: reason ?? "cancelled" }));
    },
  });
  // Applies the host's CSS variables (colors, fonts) and theme.
  useHostStyles(app, app?.getHostContext());
  return { app, error, tool };
}

export function Shell({ app, error, children }: { app: App | null; error: Error | null; children: ReactNode }) {
  if (error) return <main className="view error">Error: {error.message}</main>;
  if (!app) return <main className="view muted">Connecting to host…</main>;
  return <main className="view">{children}</main>;
}
