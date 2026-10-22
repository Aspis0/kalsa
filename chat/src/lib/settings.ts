import type { ChatSettings } from "./types";

const SETTINGS_KEY = "crescent-chat.settings.v1";
const THEME_KEY = "crescent-chat.theme.v1";

// This session's own choice outranks storage, so Automatic keeps following
// the system even when the stored choice cannot be read or removed.
let sessionChoice: "auto" | "light" | "dark" | null = null;

export function themeChoiceMade(): boolean {
  if (sessionChoice !== null) return sessionChoice !== "auto";
  try {
    return localStorage.getItem(THEME_KEY) !== null;
  } catch {
    // Unreadable is unstored, as loadTheme reads it: follow the system.
    return false;
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
    if (!raw) return { model: "", webTools: true, browserVision: false, contextDigest: false };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      // A record in a shape nothing can read cannot be partially cleaned:
      // its bytes may BE the old API key, so the whole key leaves storage.
      try {
        localStorage.removeItem(SETTINGS_KEY);
      } catch {
        // Private mode etc: there is nothing left to come back to.
      }
      return { model: "", webTools: true, browserVision: false, contextDigest: false };
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
      // **The picture of the page is off unless it is switched on.** A stored
      // record without the key is a record from before the tool existed, and
      // what it says is nothing: the tool is not offered. Only an explicit
      // true turns it on, so a build that has not been asked for it never
      // offers a picture — the lever is a decision, not a default.
      browserVision: parsed.browserVision === true,
      // The same rule as the picture switch: only an explicit true turns the
      // digest on. A record from before the feature has nothing to say about it.
      contextDigest: parsed.contextDigest === true,
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
    return { model: "", webTools: true, browserVision: false, contextDigest: false };
  }
}

/** True when the record landed in storage. A false is private mode and its
 *  kin — the session keeps working from memory, and the caller can choose
 *  not to promise the save to anyone else. */
export function saveSettings(settings: ChatSettings): boolean {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

export function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // fall through to media query
  }
  return systemTheme();
}

/** Back to following the system: the stored choice goes, so the next launch follows it too. */
export function forgetThemeChoice(): void {
  sessionChoice = "auto";
  try {
    localStorage.removeItem(THEME_KEY);
  } catch {
    // non-fatal: this session follows the system regardless; the stored
    // choice may come back at the next launch
  }
}

export function saveTheme(theme: Theme): void {
  sessionChoice = theme;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // non-fatal
  }
}
