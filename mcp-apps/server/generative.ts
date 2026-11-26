/**
 * The two GENERATIVE tools. Unlike get_weather & co., the server does not
 * know what will be shown: the model writes the UI itself.
 *
 *   render_ui    DECLARATIVE: the model composes a tree of components from a
 *                fixed vocabulary (card, stat, table, form...). The view owns
 *                the components, so the result always looks on-brand and the
 *                model can't run code. Cheap in tokens.
 *
 *   render_html  OPEN-ENDED: the model writes a whole HTML document (CSS + JS).
 *                Anything is possible (games, custom visuals), but quality
 *                varies, it costs more tokens, and it is untrusted code, which
 *                is exactly what the MCP Apps sandbox (separate origin, CSP,
 *                no network) is for.
 */
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

// ── The component vocabulary for render_ui ────────────────────────────────
// Used for strict validation on the server. The model sees the same rules
// in the tool description (the input schema is kept loose on purpose: a
// recursive JSON Schema is harder for every layer to handle than prose).
type Tone = "default" | "muted" | "success" | "warning" | "danger";
const tone = z.enum(["default", "muted", "success", "warning", "danger"]).optional();

export type UiNode =
  | { type: "stack"; direction?: "row" | "column"; gap?: number; children: UiNode[] }
  | { type: "card"; title?: string; children: UiNode[] }
  | { type: "heading"; text: string; level?: 1 | 2 | 3 }
  | { type: "text"; text: string; tone?: Tone }
  | { type: "badge"; text: string; tone?: Tone }
  | { type: "stat"; label: string; value: string | number; delta?: string; tone?: Tone }
  | { type: "progress"; label: string; value: number }
  | { type: "table"; columns: string[]; rows: (string | number)[][] }
  | { type: "bar_chart"; labels: string[]; values: number[] }
  | { type: "list"; items: string[]; ordered?: boolean }
  | { type: "divider" }
  | { type: "button"; label: string; message: string; variant?: "primary" | "secondary" }
  | {
      type: "form";
      title?: string;
      submitLabel?: string;
      fields: { name: string; label: string; kind?: "text" | "number" | "date" | "select" | "checkbox"; options?: string[]; placeholder?: string }[];
    };

const UiNodeSchema: z.ZodType<UiNode> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("stack"), direction: z.enum(["row", "column"]).optional(), gap: z.number().optional(), children: z.array(UiNodeSchema) }),
    z.object({ type: z.literal("card"), title: z.string().optional(), children: z.array(UiNodeSchema) }),
    z.object({ type: z.literal("heading"), text: z.string(), level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional() }),
    z.object({ type: z.literal("text"), text: z.string(), tone }),
    z.object({ type: z.literal("badge"), text: z.string(), tone }),
    z.object({ type: z.literal("stat"), label: z.string(), value: z.union([z.string(), z.number()]), delta: z.string().optional(), tone }),
    z.object({ type: z.literal("progress"), label: z.string(), value: z.number().min(0).max(100) }),
    z.object({ type: z.literal("table"), columns: z.array(z.string()), rows: z.array(z.array(z.union([z.string(), z.number()]))) }),
    z.object({ type: z.literal("bar_chart"), labels: z.array(z.string()), values: z.array(z.number()) }),
    z.object({ type: z.literal("list"), items: z.array(z.string()), ordered: z.boolean().optional() }),
    z.object({ type: z.literal("divider") }),
    z.object({ type: z.literal("button"), label: z.string(), message: z.string(), variant: z.enum(["primary", "secondary"]).optional() }),
    z.object({
      type: z.literal("form"),
      title: z.string().optional(),
      submitLabel: z.string().optional(),
      fields: z.array(
        z.object({
          name: z.string(),
          label: z.string(),
          kind: z.enum(["text", "number", "date", "select", "checkbox"]).optional(),
          options: z.array(z.string()).optional(),
          placeholder: z.string().optional(),
        }),
      ),
    }),
  ]),
) as z.ZodType<UiNode>;

const RENDER_UI_DESCRIPTION = `Compose a custom UI for the user from building blocks. Use it for dashboards, summaries, comparisons, plans, small forms: anything that reads better as UI than as prose.

\`root\` is a tree of nodes. Every node has a "type":
- stack {direction?: "row"|"column" (default column), gap?: px, children: Node[]}  layout
- card {title?, children: Node[]}
- heading {text, level?: 1|2|3}
- text {text, tone?}            tone: "default"|"muted"|"success"|"warning"|"danger"
- badge {text, tone?}
- stat {label, value, delta?, tone?}   a big number, e.g. {label:"Revenue", value:"€12k", delta:"+8%", tone:"success"}
- progress {label, value: 0-100}
- table {columns: string[], rows: (string|number)[][]}
- bar_chart {labels: string[], values: number[]}
- list {items: string[], ordered?}
- divider {}
- button {label, message, variant?: "primary"|"secondary"}   clicking sends \`message\` to you as the user's next message
- form {title?, submitLabel?, fields: [{name, label, kind?: "text"|"number"|"date"|"select"|"checkbox", options?, placeholder?}]}   on submit you receive the values as the user's next message

Put "type" first in every node. The UI renders while you write it. Don't repeat its contents in text afterwards.`;

const RENDER_HTML_DESCRIPTION = `Render a complete, self-contained HTML document for the user (inline <style> and <script>). Use it only when the building blocks of render_ui can't do the job: games, animations, simulations, custom visualizations, interactive toys.

Rules:
- No external resources: CDNs, web fonts, remote images and fetch() are blocked by the sandbox. Use inline SVG, canvas, CSS.
- The page is shown inline in the chat, about 600px wide. Keep it compact and size it to its content.
- Support light and dark mode (prefers-color-scheme).
- Your scripts can talk back through \`window.mcp\`:
    mcp.sendMessage(text)        send a user message to you (e.g. a game score)
    mcp.updateContext(text)      silently tell you about state, attached to the user's next message`;

export function registerGenerativeTools(server: McpServer, registerView: (server: McpServer, name: string) => string) {
  const uiUri = registerView(server, "ui");
  registerAppTool(
    server,
    "render_ui",
    {
      title: "Render UI",
      description: RENDER_UI_DESCRIPTION,
      inputSchema: {
        title: z.string().describe("Short title shown above the UI"),
        root: z.record(z.string(), z.unknown()).describe("Root node of the UI tree (see the description)"),
      },
      _meta: { ui: { resourceUri: uiUri } },
    },
    async ({ title, root }): Promise<CallToolResult> => {
      const parsed = UiNodeSchema.safeParse(root);
      if (!parsed.success) {
        // The model sees this and usually fixes its spec on the next try.
        return {
          isError: true,
          content: [{ type: "text", text: `Invalid UI spec:\n${z.prettifyError(parsed.error)}` }],
        };
      }
      return { content: [{ type: "text", text: `UI "${title}" is shown to the user.` }] };
    },
  );

  const htmlUri = registerView(server, "html");
  registerAppTool(
    server,
    "render_html",
    {
      title: "Render HTML",
      description: RENDER_HTML_DESCRIPTION,
      inputSchema: {
        title: z.string().describe("Short title"),
        html: z.string().describe("A full HTML document"),
      },
      _meta: { ui: { resourceUri: htmlUri } },
    },
    async ({ title, html }): Promise<CallToolResult> => ({
      content: [{ type: "text", text: `"${title}" (${html.length} chars of HTML) is shown to the user.` }],
    }),
  );
}
