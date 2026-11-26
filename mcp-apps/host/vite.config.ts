/**
 * Dev server for the HOST (our mini chat client), plus two helpers:
 *
 *  /mcp        -> proxied to the MCP server on :3001 (avoids CORS)
 *  /anthropic  -> proxied to api.anthropic.com; the API key is added HERE,
 *                 in Node, so it never reaches the browser
 *  :5181       -> the sandbox proxy page, on a DIFFERENT origin from the
 *                 host (:5180). The spec requires host and sandbox to be
 *                 different origins so a view can't touch the host page.
 */
import react from "@vitejs/plugin-react";
import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
// mcp-apps/.env first, then fall back to the AG-UI agent's key.
loadEnv({ path: [path.join(here, "../.env"), path.join(here, "../../agent/.env")], quiet: true });

const HOST_PORT = 5180;
const SANDBOX_PORT = 5181;
const MODEL = process.env.MODEL ?? "claude-opus-5-5";

/** Serves host/sandbox.html on its own port with a CSP header. */
function sandboxServer(): Plugin {
  return {
    name: "mcp-apps-sandbox",
    configureServer() {
      const server = http.createServer((req, res) => {
        if (!req.url?.startsWith("/sandbox.html")) {
          res.writeHead(404).end("Only /sandbox.html is served here");
          return;
        }
        // The view's HTML is document.write()-n into an inner iframe of
        // this page, so it inherits this CSP. Views are self-contained
        // (inline scripts/styles), so we allow inline and nothing external.
        // A real host would build this from the resource's _meta.ui.csp.
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy": [
            "default-src 'self' 'unsafe-inline'",
            "script-src 'self' 'unsafe-inline' blob: data:",
            "style-src 'self' 'unsafe-inline' blob: data:",
            "img-src 'self' data: blob:",
            "font-src 'self' data: blob:",
            "connect-src 'self'",
            "frame-src 'none'",
            "object-src 'none'",
            "base-uri 'none'",
          ].join("; "),
        });
        res.end(fs.readFileSync(path.join(here, "sandbox.html")));
      });
      server.listen(SANDBOX_PORT, "localhost");
    },
  };
}

export default defineConfig({
  root: here,
  plugins: [react(), sandboxServer()],
  define: {
    __MODEL__: JSON.stringify(MODEL),
    __HAS_KEY__: JSON.stringify(Boolean(process.env.ANTHROPIC_API_KEY)),
    __SANDBOX_URL__: JSON.stringify(`http://localhost:${SANDBOX_PORT}/sandbox.html`),
  },
  server: {
    port: HOST_PORT,
    strictPort: true,
    proxy: {
      "/mcp": { target: "http://127.0.0.1:3001", changeOrigin: true },
      "/anthropic": {
        target: "https://api.anthropic.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/anthropic/, ""),
        configure: (proxy) => {
          proxy.on("proxyReq", (req) => {
            req.setHeader("x-api-key", process.env.ANTHROPIC_API_KEY ?? "");
            req.removeHeader("anthropic-dangerous-direct-browser-access");
            req.removeHeader("origin");
          });
        },
      },
    },
  },
});
