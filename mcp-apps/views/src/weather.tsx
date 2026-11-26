/**
 * Weather view: renders the get_weather RESULT, and shows the three ways a
 * view can act on its own:
 *   Refresh       -> app.callServerTool  (host forwards tools/call to the server; the model isn't involved)
 *   °C / °F       -> app.updateModelContext (silently tells the model the user's preference)
 *   Packing tips  -> app.sendMessage (posts a user message; the host runs the model)
 */
import type { CallToolResult } from "@modelcontextprotocol/client";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Shell, useView } from "./shared";

interface Weather {
  city: string;
  temperature_c: number;
  condition: string;
  humidity: number;
  forecast: { day: string; temperature_c: number }[];
  fetched_at: string;
}

const ICONS: Record<string, string> = { sunny: "☀️", cloudy: "☁️", rainy: "🌧️", snowy: "❄️", windy: "💨" };

function WeatherView() {
  const { app, error, tool } = useView("weather");
  const [refreshed, setRefreshed] = useState<CallToolResult | null>(null);
  const [unit, setUnit] = useState<"C" | "F">("C");
  const [busy, setBusy] = useState(false);

  const w = (refreshed ?? tool.result)?.structuredContent as Weather | undefined;
  const city = (tool.input?.city as string | undefined) ?? w?.city;
  const fmt = (c: number) => (unit === "C" ? `${c}°C` : `${Math.round((c * 9) / 5 + 32)}°F`);

  async function refresh() {
    if (!app || !city) return;
    setBusy(true);
    try {
      setRefreshed(await app.callServerTool({ name: "get_weather", arguments: { city } }));
    } finally {
      setBusy(false);
    }
  }

  async function toggleUnit() {
    const next = unit === "C" ? "F" : "C";
    setUnit(next);
    await app?.updateModelContext({
      content: [{ type: "text", text: `The user switched the weather card to ${next === "C" ? "Celsius" : "Fahrenheit"}. Use that unit.` }],
    });
  }

  async function askPacking() {
    await app?.sendMessage({
      role: "user",
      content: [{ type: "text", text: `What should I pack for ${city} this week?` }],
    });
  }

  return (
    <Shell app={app} error={error}>
      {!w ? (
        <p className="muted">{city ? `Fetching weather for ${city}…` : "Waiting for tool input…"}</p>
      ) : (
        <>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>
              {ICONS[w.condition] ?? "🌡️"} {w.city}
            </h2>
            <span className="muted">updated {new Date(w.fetched_at).toLocaleTimeString()}</span>
          </div>
          <div style={{ fontSize: 34, fontWeight: 600 }}>{fmt(w.temperature_c)}</div>
          <div className="muted">
            {w.condition} · humidity {w.humidity}%
          </div>
          <div className="row" style={{ marginTop: 12, gap: 14 }}>
            {w.forecast.map((d) => (
              <div key={d.day} style={{ textAlign: "center" }}>
                <div className="muted">{d.day}</div>
                <div>{fmt(d.temperature_c)}</div>
              </div>
            ))}
          </div>
          <div className="actions">
            <button onClick={refresh} disabled={busy}>
              {busy ? "Refreshing…" : "↻ Refresh"}
            </button>
            <button onClick={toggleUnit}>Show °{unit === "C" ? "F" : "C"}</button>
            <button className="primary" onClick={askPacking}>
              Ask for packing tips
            </button>
          </div>
        </>
      )}
    </Shell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WeatherView />
  </StrictMode>,
);
