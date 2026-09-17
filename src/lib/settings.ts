import type { ChatSettings } from "./types";

const SETTINGS_KEY = "crescent-chat.settings.v1";
const THEME_KEY = "crescent-chat.theme.v1";

export type Theme = "light" | "dark";

export function loadSettings(): ChatSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { endpoint: "", token: "", model: "" };
    const parsed = JSON.parse(raw) as Partial<ChatSettings>;
    return {
      endpoint: typeof parsed.endpoint === "string" ? parsed.endpoint : "",
      token: typeof parsed.token === "string" ? parsed.token : "",
      model: typeof parsed.model === "string" ? parsed.model : "",
    };
  } catch {
    return { endpoint: "", token: "", model: "" };
  }
}

export function saveSettings(settings: ChatSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private mode etc: the session keeps working in memory.
  }
}

export function isConfigured(settings: ChatSettings): boolean {
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
