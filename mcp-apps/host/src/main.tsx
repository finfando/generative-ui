import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./app.css";

// No <StrictMode>: its double-mounted effects would create two AppBridges
// per iframe, which makes the traffic log confusing to read.
createRoot(document.getElementById("root")!).render(<App />);
