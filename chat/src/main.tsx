import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadTheme } from "./lib/settings";
import "./styles/tokens.css";
import "./styles/base.css";

/* The look is set before the first paint, so a dark Mac never flashes light. */
document.documentElement.dataset.theme = loadTheme();

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
