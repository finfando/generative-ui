/** Serves the MCP server over Streamable HTTP at http://localhost:3001/mcp (stateless). */
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { Request, Response } from "express";
import { createServer } from "./server.ts";

const PORT = Number(process.env.MCP_PORT ?? 3001);

// Binds 127.0.0.1 and validates the Host header (DNS-rebinding protection).
const app = createMcpExpressApp();

app.all("/mcp", async (req: Request, res: Response) => {
  // Stateless: one server + transport per HTTP request. Fine here because no
  // tool keeps per-session state.
  const server = createServer();
  const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP error:", error);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`MCP server: http://localhost:${PORT}/mcp`);
});
