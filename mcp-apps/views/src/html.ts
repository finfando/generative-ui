/**
 * Open-ended generative UI: renders a whole HTML document written by the model.
 *
 * No React here. This view uses the `App` class directly, to show the
 * framework-free API.
 *
 * Layers, outside in:
 *   host page (:5180)
 *   └ sandbox proxy (:5181, CSP: inline only, no network, no external frames)
 *     └ THIS view (the App, connected to the host)
 *       └ nested iframe with the model's document
 *
 * The nested iframe keeps the model's CSS and scripts away from this view's
 * own DOM and message listener, and it inherits the sandbox's CSP. So the
 * model's code can't load anything from the network, and it can reach the
 * host only through the small `window.mcp` object we hand it.
 *
 * While Claude is still writing, we re-render the partial HTML with
 * <script> tags removed, so you watch the page build up. Scripts run once,
 * when the final tool-input arrives.
 */
import { App } from "@modelcontextprotocol/ext-apps";
import "./view.css";

const status = document.createElement("div");
status.className = "note";
status.style.cssText = "margin: 0; padding: 6px 12px;";
const frame = document.createElement("iframe");
frame.title = "generated content";
frame.style.cssText = "display:block; width:100%; height:60px; border:0; background:transparent; color-scheme:light dark;";
document.getElementById("root")!.append(frame, status);
document.body.style.margin = "0";

const app = new App({ name: "html", version: "0.1.0" }, {});

// What the model's scripts may do. They see this as window.mcp.
const bridge = {
  sendMessage: (text: string) => app.sendMessage({ role: "user", content: [{ type: "text", text: String(text) }] }),
  updateContext: (text: string) => app.updateModelContext({ content: [{ type: "text", text: String(text) }] }),
};
(window as unknown as { __mcpBridge: typeof bridge }).__mcpBridge = bridge;
// The meta tag makes the nested page follow light/dark like the rest of the
// chat (otherwise the browser paints an opaque white iframe in dark mode).
const PRELUDE = `<meta name="color-scheme" content="light dark"><script>window.mcp = parent.__mcpBridge;</script>`;

let observer: ResizeObserver | null = null;

function write(html: string) {
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  // Size the nested frame to its content; the App's auto-resize then
  // reports this view's new height to the host (ui/notifications/size-changed).
  observer?.disconnect();
  const fit = () => {
    const h = Math.min(Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0), 900);
    frame.style.height = `${h}px`;
  };
  observer = new ResizeObserver(fit);
  observer.observe(doc.documentElement);
  fit();
}

function stripScripts(html: string) {
  // Complete <script> blocks, then a trailing one that is still being written.
  return html.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<script\b[\s\S]*$/i, "");
}

let lastPartial = 0;
app.ontoolinputpartial = ({ arguments: args }) => {
  const html = typeof args?.html === "string" ? args.html : "";
  status.textContent = `Claude is writing ${typeof args?.title === "string" ? `"${args.title}"` : "a page"}… ${html.length} chars`;
  // Re-rendering on every token is wasteful; ~5 times a second is plenty.
  const now = Date.now();
  if (now - lastPartial < 200) return;
  lastPartial = now;
  write(PRELUDE.replace(/<script[\s\S]*/, "") + stripScripts(html));
};

app.ontoolinput = ({ arguments: args }) => {
  const html = typeof args?.html === "string" ? args.html : "<p>No HTML.</p>";
  status.textContent = `${html.length} chars of model-written HTML · scripts running in the sandbox`;
  write(PRELUDE + html);
};

app.ontoolcancelled = ({ reason }) => {
  status.textContent = `Cancelled: ${reason ?? "unknown reason"}`;
};

app.connect().then(
  () => (status.textContent = "Waiting for the model to write HTML…"),
  (e) => (status.textContent = `Could not connect to host: ${e}`),
);
