export type Weather = {
  city: string;
  temperature_c: number;
  condition: string;
  humidity: number;
};

const ICON: Record<string, string> = {
  sunny: "☀️",
  cloudy: "☁️",
  rainy: "🌧️",
  snowy: "❄️",
  windy: "💨",
};

export function WeatherCard({ data }: { data: Weather }) {
  return (
    <div className="card weather">
      <div className="weather-icon">{ICON[data.condition] ?? "🌡️"}</div>
      <div>
        <div className="weather-city">{data.city}</div>
        <div className="weather-temp">{data.temperature_c}°C</div>
        <div className="muted">
          {data.condition} · humidity {data.humidity}%
        </div>
      </div>
    </div>
  );
}
