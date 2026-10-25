import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { LanguageProvider } from "./i18n/useLanguage";
import { watchPageVisibility } from "./lib/pageVisible";
import "./styles/tokens.css";
import "./styles/base.css";

// Before anything renders: the root attribute the paused-when-hidden CSS and
// the polls both read has to be true from the first paint on.
watchPageVisibility();

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </StrictMode>,
);
