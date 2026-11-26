/**
 * The host's MCP client: one connection to our server, through the Vite proxy.
 * A real host (Claude, ChatGPT...) would hold one of these per connected server.
 */
import { Client, StreamableHTTPClientTransport, type Tool } from "@modelcontextprotocol/client";
import {
  RESOURCE_MIME_TYPE,
  getToolUiResourceUri,
  isToolVisibilityAppOnly,
  type McpUiResourceCsp,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { LoggingTransport } from "./traffic";

export interface McpConnection {
  client: Client;
  tools: Tool[];
  /** Tools the model may see: everything except visibility ["app"]. */
  modelTools: Tool[];
}

export async function connectMcp(): Promise<McpConnection> {
  const client = new Client({ name: "mcp-apps-playground-host", version: "0.1.0" });
  const http = new StreamableHTTPClientTransport(new URL("/mcp", location.origin));
  await client.connect(new LoggingTransport(http, "server"));
  const { tools } = await client.listTools();
  return { client, tools, modelTools: tools.filter((t) => !isToolVisibilityAppOnly(t)) };
}

export { getToolUiResourceUri };

export interface UiResource {
  html: string;
  csp?: McpUiResourceCsp;
}

const cache = new Map<string, Promise<UiResource>>();

/** resources/read for a `ui://` URI. Hosts may prefetch and cache these. */
export function readUiResource(client: Client, uri: string): Promise<UiResource> {
  if (!cache.has(uri)) {
    cache.set(
      uri,
      client.readResource({ uri }).then(({ contents: [c] }) => {
        if (c?.mimeType !== RESOURCE_MIME_TYPE) throw new Error(`Not an MCP App resource: ${c?.mimeType}`);
        const html = "text" in c ? c.text : atob(c.blob);
        return { html, csp: (c._meta as { ui?: { csp?: McpUiResourceCsp } } | undefined)?.ui?.csp };
      }),
    );
  }
  return cache.get(uri)!;
}
