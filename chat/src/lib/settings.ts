const THEME_KEY = "kalsa.theme.v2";
/** Before v2 the theme was saved on first launch too, so an old value can pin the app to a look. */
const LEGACY_THEME_KEY = "kalsa.theme.v1";

export type Theme = "light" | "dark";

let sessionChoice: "auto" | Theme | null = null;

export function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function themeChoiceMade(): boolean {
  if (sessionChoice !== null) return sessionChoice !== "auto";
  try {
    return localStorage.getItem(THEME_KEY) !== null;
  } catch {
    return false;
  }
}

/** The default is System: follow macOS live. An old saved choice is dropped once, which moves it to System. */
export function loadTheme(): Theme {
  try {
    localStorage.removeItem(LEGACY_THEME_KEY);
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Fall through to the system setting.
  }
  return systemTheme();
}

export function saveTheme(theme: Theme): void {
  sessionChoice = theme;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // The choice holds for this session when storage refuses it.
  }
}

export function forgetThemeChoice(): void {
  sessionChoice = "auto";
  try {
    localStorage.removeItem(THEME_KEY);
  } catch {
    // Nothing to clear.
  }
}
