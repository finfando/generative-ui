/**
 * Address form view.
 *
 * AG-UI version: the tool calls interrupt(), the run pauses, and the form's
 * payload becomes the tool's return value.
 *
 * MCP Apps version: the tool already returned. The form lives on, and on
 * submit it:
 *   1. app.updateModelContext  -> structured address for the model
 *   2. app.sendMessage         -> a visible user message; the host runs the model
 * While typing the postcode it calls `validate_postcode`, an app-only tool
 * (visibility: ["app"]) that the model never sees.
 */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Shell, useView } from "./shared";

const COUNTRIES = { NO: "Norway", PL: "Poland", DE: "Germany", GB: "United Kingdom", US: "United States" };

function AddressView() {
  const { app, error, tool } = useView("address");
  const [form, setForm] = useState({ name: "", street: "", postcode: "", city: "", country: "NO" });
  const [postcodeOk, setPostcodeOk] = useState<{ valid: boolean; hint: string } | null>(null);
  const [sent, setSent] = useState(false);
  const reason = typeof tool.input?.reason === "string" ? tool.input.reason : "Please enter your address.";

  // Debounced app-only tool call.
  useEffect(() => {
    if (!app || !form.postcode) return setPostcodeOk(null);
    const t = setTimeout(async () => {
      const r = await app.callServerTool({
        name: "validate_postcode",
        arguments: { country: form.country, postcode: form.postcode },
      });
      setPostcodeOk(r.structuredContent as { valid: boolean; hint: string });
    }, 400);
    return () => clearTimeout(t);
  }, [app, form.postcode, form.country]);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const complete = form.name && form.street && form.postcode && form.city && postcodeOk?.valid;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!app || !complete) return;
    await app.updateModelContext({
      content: [{ type: "text", text: "The user submitted the address form." }],
      structuredContent: { address: form },
    });
    const line = `${form.name}, ${form.street}, ${form.postcode} ${form.city}, ${COUNTRIES[form.country as keyof typeof COUNTRIES]}`;
    await app.sendMessage({ role: "user", content: [{ type: "text", text: `My address: ${line}` }] });
    setSent(true);
  }

  async function decline() {
    await app?.sendMessage({ role: "user", content: [{ type: "text", text: "I'd rather not share my address." }] });
    setSent(true);
  }

  return (
    <Shell app={app} error={error}>
      <h2>📮 {reason}</h2>
      <form onSubmit={submit} style={{ display: "grid", gap: 8 }}>
        <input placeholder="Full name" value={form.name} onChange={set("name")} disabled={sent} />
        <input placeholder="Street and number" value={form.street} onChange={set("street")} disabled={sent} />
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <select value={form.country} onChange={set("country")} disabled={sent} style={{ width: 170 }}>
            {Object.entries(COUNTRIES).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
          <input placeholder="Postcode" value={form.postcode} onChange={set("postcode")} disabled={sent} style={{ width: 120 }} />
          <input placeholder="City" value={form.city} onChange={set("city")} disabled={sent} />
        </div>
        {postcodeOk && !sent && (
          <div className="note" style={{ color: postcodeOk.valid ? "var(--color-text-success)" : "var(--color-text-danger)" }}>
            {postcodeOk.valid ? "✓ postcode looks valid" : `✗ postcode looks wrong (${postcodeOk.hint})`} · checked by the app-only
            tool validate_postcode
          </div>
        )}
        <div className="actions">
          <button type="submit" className="primary" disabled={!complete || sent}>
            {sent ? "Sent ✓" : "Use this address"}
          </button>
          <button type="button" onClick={decline} disabled={sent}>
            Don't share
          </button>
        </div>
      </form>
    </Shell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AddressView />
  </StrictMode>,
);
