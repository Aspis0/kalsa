import type { ChatSettings } from "./types";

const SETTINGS_KEY = "crescent-chat.settings.v1";
const THEME_KEY = "crescent-chat.theme.v1";

export function themeChoiceMade(): boolean {
  try {
    return localStorage.getItem(THEME_KEY) !== null;
  } catch {
    return true;
  }
}

export type Theme = "light" | "dark";

export function loadSettings(): ChatSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { model: "", webTools: true };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const settings: ChatSettings = {
      model: typeof parsed.model === "string" ? parsed.model : "",
      // Settings written before this switch existed have no answer to give,
      // and the default — the same one new installs get — is on.
      webTools: parsed.webTools !== false,
    };
    // The remote-server fields are gone, and a saved API key must not sit
    // in durable storage waiting for a settings visit that may never come:
    // the cleaned record goes back over them once.
    if ("endpoint" in parsed || "token" in parsed) {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch {
        // Private mode again: the stale fields wait for the next load.
      }
    }
    return settings;
  } catch {
    return { model: "", webTools: true };
  }
}

export function saveSettings(settings: ChatSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private mode etc: the session keeps working in memory.
  }
}

export function isConfigured(settings: { endpoint: string; model: string }): boolean {
  return settings.endpoint.trim().length > 0 && settings.model.trim().length > 0;
}

export function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // fall through to media query
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function saveTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // non-fatal
  }
}
