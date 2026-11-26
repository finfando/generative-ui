# MCP Apps playground

The companion to the AG-UI playground in this repo. This one explores
[MCP Apps](https://github.com/modelcontextprotocol/ext-apps): the MCP extension
that lets an **MCP server ship the UI for its tools**, rendered by any host
(Claude, ChatGPT, VS Code, … and the small host in this folder).

```
┌───────────────┐  tools/list, tools/call,   ┌──────────────────────────────┐   postMessage    ┌──────────────┐
│ MCP server    │  resources/read ui://…     │ HOST (host/, React)          │  JSON-RPC (ui/*) │ VIEW         │
│ server/       │ ◀────────────────────────▶ │ • Claude loop (useChat.ts)   │ ◀──────────────▶ │ views/*.tsx  │
│ tools + HTML  │   Streamable HTTP :3001    │ • AppBridge per tool call    │  via sandbox     │ in a sandbox │
└───────────────┘                            │   (AppFrame.tsx)             │  proxy :5181     │ iframe       │
                                             └──────────────────────────────┘                  └──────────────┘
```

## Run it

```bash
cd mcp-apps && npm install
```

```bash
npm run dev
```

Then open http://localhost:5180. `npm run dev` starts three processes: the view
bundler (watch), the MCP server (:3001), and the host (:5180, plus the sandbox
on :5181).

The API key is read from `mcp-apps/.env`, falling back to `../agent/.env`. It is
added by the Vite proxy (`/anthropic`), so it never reaches the browser. The
model defaults to `claude-opus-5-5`; set `MODEL=` in `.env` to change it.
Without a key the chat is off, but the **"call …"** buttons still open each view
by calling the tool directly.

## AG-UI vs MCP Apps

| | AG-UI playground (`../web`) | MCP Apps playground (here) |
|---|---|---|
| Who owns the UI | The **frontend** maps tool name → React component | The **MCP server** ships HTML as a `ui://` resource |
| Where it runs | In the app's own React tree | In a sandboxed iframe, on another origin |
| Protocol | Agent → frontend event stream (`TOOL_CALL_*`, `STATE_*`) | Host ↔ view JSON-RPC over `postMessage` (`ui/*`) |
| Portability | Works in *your* frontend | Works in *any* MCP Apps host |
| Asking the user | `interrupt()` pauses the graph; form payload = tool result | Tool returns at once; the form sends a `ui/message` later |

## How generative is it? Three levels

| Level | The model decides… | Tool here | Trade-off |
|---|---|---|---|
| **Static** | which prebuilt view, and its data | `get_weather`, `request_address` (`render_chart` is a tiny spec) | Predictable, but only what the server author foresaw |
| **Declarative** | the layout, from a fixed set of building blocks | `render_ui` → [ui.tsx](views/src/ui.tsx) | Always on-brand, no model code runs, cheap in tokens. Limited to the vocabulary. |
| **Open-ended** | the UI itself: HTML, CSS and JS | `render_html` → [html.ts](views/src/html.ts) | Anything (games, simulations), but more tokens, uneven quality, and untrusted code |

Both generative tools stream: the view redraws on every (throttled)
`tool-input-partial`, so you watch the UI being written.

**`render_ui`** ([server/generative.ts](server/generative.ts)): the building
blocks are `stack, card, heading, text, badge, stat, progress, table, bar_chart,
list, divider, button, form`. The model learns them from the tool
*description*; the input schema stays loose (`root: object`). The server then
validates the tree strictly with a recursive zod schema and returns `isError`
with the problems, so the model can fix its spec. Buttons and forms reply
through `ui/message` (and `ui/update-model-context` for form values).

**`render_html`**: the view writes the model's document into a *nested*
iframe, so model CSS and scripts can't touch the view's own connection to the
host. While streaming it renders the partial HTML with `<script>` tags removed;
scripts run once the final input arrives. It all sits inside the sandbox
origin and its CSP, so no CDNs, fonts, images or `fetch()`. The only way out is
`window.mcp.sendMessage(text)` / `window.mcp.updateContext(text)`, which the
view hands to the model's code.

Try "Plan a 3-day trip to Lisbon as a dashboard…" and "Make a tiny
reaction-time game…", or the `call render_ui` / `call render_html` buttons
(hand-written examples, no model needed).

## What each view demonstrates

| Tool | View | Shows |
|---|---|---|
| `get_weather` | [weather.tsx](views/src/weather.tsx) | Render the tool **result** (`structuredContent`). Buttons: **Refresh** = `tools/call` from the view (no model), **°F** = `ui/update-model-context`, **Packing tips** = `ui/message` (new user turn). |
| `render_chart` | [chart.tsx](views/src/chart.tsx) | Render the tool **arguments while they stream** (`ui/notifications/tool-input-partial`). Clicking a bar sets model context, so "which one did I select?" works. |
| `request_address` | [address.tsx](views/src/address.tsx) | A form instead of an interrupt. Calls `validate_postcode`, an **app-only** tool (`_meta.ui.visibility: ["app"]`) that the model never sees. |
| `render_ui` | [ui.tsx](views/src/ui.tsx) | Declarative generative UI (see above). |
| `render_html` | [html.ts](views/src/html.ts) | Open-ended generative UI, and a view without React. |
| `get_time` | none | A plain MCP tool, rendered as a generic card. |

## The lifecycle of one view (host side, [AppFrame.tsx](host/src/AppFrame.tsx))

1. Claude starts a `tool_use` whose MCP tool has `_meta.ui.resourceUri`. The host
   mounts an iframe pointing at the **sandbox proxy** ([sandbox.html](host/sandbox.html), port 5181)
   and waits for `ui/notifications/sandbox-proxy-ready`.
2. It creates an `AppBridge` (from `@modelcontextprotocol/ext-apps/app-bridge`) with
   the MCP client and connects it over `PostMessageTransport`.
3. It reads the `ui://` resource (`resources/read`, MIME `text/html;profile=mcp-app`)
   and sends the HTML with `ui/notifications/sandbox-resource-ready`. The proxy
   writes it into an inner iframe.
4. The view's `App` sends `ui/initialize`; the bridge answers with host
   capabilities and `hostContext` (theme, CSS variables, tool info). The view
   then sends `ui/notifications/initialized`.
5. The host pushes `tool-input-partial` (while Claude streams), `tool-input`,
   then `tool-result` once the MCP server answers.
6. From then on the view can call `tools/call`, `ui/message`,
   `ui/update-model-context`, `ui/open-link`, and reports its height with
   `ui/notifications/size-changed`.

The right-hand **JSON-RPC traffic** panel records every message on both links
(host↔server and host↔view). Click a row to see its payload.

## Layout

```
server/main.ts         Streamable HTTP endpoint (stateless), :3001/mcp
server/server.ts       tools + ui:// resources (registerAppTool / registerAppResource)
server/generative.ts   render_ui (component tree, validated) + render_html
views/*.html, src/     the MCP App views (React + App from ext-apps)
scripts/build-views.ts bundles each view into ONE html file (views/dist/)
host/vite.config.ts    host dev server, /mcp + /anthropic proxies, sandbox server on :5181
host/sandbox.html      the sandbox proxy (outer iframe) that relays postMessage
host/src/useChat.ts    Claude ↔ MCP tools loop; ui/message + model context handling
host/src/AppFrame.tsx  one AppBridge per tool call
host/src/traffic.ts    LoggingTransport that records JSON-RPC traffic
```

## Exercises

1. **Add a view.** Add a `get_stock_price` tool with its own `ui://stocks/view.html`,
   a `views/stocks.html` + `src/stocks.tsx`, and add `"stocks"` to `VIEWS` in
   `scripts/build-views.ts`. The host needs no change; that's the point.
2. **Fullscreen.** Add `"fullscreen"` to `availableDisplayModes` in `AppFrame.tsx`,
   handle `bridge.onrequestdisplaymode`, and call `app.requestDisplayMode(...)`
   from the chart view.
3. **External resources.** Load a map library from a CDN in a view. It will be
   blocked until you list the domain in the resource's `_meta.ui.csp` *and*
   build the sandbox CSP from it (the host currently ignores `csp`).
4. **Try a real host.** Point Claude Desktop or the
   [basic-host](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-host)
   example at `http://localhost:3001/mcp`. The same views should work there unchanged.
5. **Grow the vocabulary.** Add a `map` or `timeline` block to `render_ui`
   (zod schema + description in `server/generative.ts`, renderer in `ui.tsx`).
   Then ask for something that needs it and compare with `render_html`.
6. **Ask the same question both ways.** "Show my week as a dashboard" via
   `render_ui`, then "…as custom HTML". Compare tokens (the traffic panel shows
   the size) and how consistent the results look.
7. **Combine both.** Expose `get_weather` from the AG-UI agent through this MCP
   server and render the view inside the AG-UI frontend.
