const THEME_KEY = "kalsa.theme.v1";

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

export function loadTheme(): Theme {
  try {
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
