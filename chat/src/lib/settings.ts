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

/// The record is a real object — never a string, number, array or null,
/// whose bytes may themselves be the old API key.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadSettings(): ChatSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { model: "", webTools: true };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      // A record in a shape nothing can read cannot be partially cleaned:
      // its bytes may BE the old API key, so the whole key leaves storage.
      try {
        localStorage.removeItem(SETTINGS_KEY);
      } catch {
        // Private mode etc: there is nothing left to come back to.
      }
      return { model: "", webTools: true };
    }
    // Only these two keys go; everything else — including keys this version
    // does not know — comes back as it was: a whitelist rewrite would
    // silently drop tomorrow's fields. The stale remote-server pair is why
    // this runs at all: an old API key must not sit in durable storage
    // waiting for a settings visit that may never come.
    const { endpoint: _staleEndpoint, token: _staleToken, ...rest } = parsed;
    const settings = {
      ...rest,
      model: typeof parsed.model === "string" ? parsed.model : "",
      // Settings written before this switch existed have no answer to give,
      // and the default — the same one new installs get — is on.
      webTools: parsed.webTools !== false,
    };
    if ("endpoint" in parsed || "token" in parsed) {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch {
        // Private mode again: the stale fields wait for the next load.
      }
    }
    return settings;
  } catch {
    // Unparsable JSON: the bytes may BE the old API key — the key goes.
    try {
      localStorage.removeItem(SETTINGS_KEY);
    } catch {
      // Private mode etc: there is nothing left to come back to.
    }
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
