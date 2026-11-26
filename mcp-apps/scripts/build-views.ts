/**
 * Bundles each MCP App view into ONE self-contained HTML file
 * (views/dist/<name>.html). The server returns that file as the `ui://`
 * resource, and the host injects it into a sandboxed iframe, so it can't
 * load separate .js/.css files: everything is inlined (vite-plugin-singlefile).
 *
 *   tsx scripts/build-views.ts          build once
 *   tsx scripts/build-views.ts --watch  rebuild on change
 */
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const VIEWS = ["weather", "chart", "address", "ui", "html"];
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "views");
const watch = process.argv.includes("--watch");

for (const name of VIEWS) {
  await build({
    root,
    configFile: false,
    logLevel: "warn",
    plugins: [react(), viteSingleFile()],
    build: {
      outDir: "dist",
      emptyOutDir: false,
      rollupOptions: { input: path.join(root, `${name}.html`) },
      watch: watch ? {} : null,
    },
  });
  console.log(`built views/dist/${name}.html`);
}
