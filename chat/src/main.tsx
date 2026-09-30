import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { LanguageProvider } from "./i18n/useLanguage";
import "./styles/tokens.css";
import "./styles/base.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </StrictMode>,
);
