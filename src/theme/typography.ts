import { Platform, TextStyle } from "react-native";

import { useLabTheme } from "../ui/labTheme";

// Font family resolves to the loaded @expo-google-fonts/* family name.
// useFonts is wired in App.tsx; until it resolves, App renders null.
// On Android, fontWeight is NOT synthesized for custom families — weight MUST
// come from the fontFamily name (never pair a custom family with numeric fontWeight).
const display = Platform.select({
  default: "PlusJakartaSans_600SemiBold",
});
const displayBold = Platform.select({
  default: "PlusJakartaSans_700Bold",
});
const displayExtra = Platform.select({
  default: "PlusJakartaSans_800ExtraBold",
});
const body = Platform.select({
  default: "PlusJakartaSans_400Regular",
});
const bodyMedium = Platform.select({
  default: "PlusJakartaSans_500Medium",
});
const bodySemi = Platform.select({
  default: "PlusJakartaSans_600SemiBold",
});
const mono = Platform.select({
  default: "JetBrainsMono_400Regular",
});
const monoBold = Platform.select({
  default: "JetBrainsMono_700Bold",
});

export const fontFamilies = {
  display,
  displayBold,
  displayExtra,
  body,
  bodyMedium,
  bodySemi,
  mono,
  monoBold,
};

/** AsyncStorage key for the in-app font scale preference. */
export const FONT_SCALE_KEY = "kalsa.fontScale";

/** User-facing scale ids (Settings radio). */
export type FontScaleId = "s" | "m" | "l" | "xl";

export const DEFAULT_FONT_SCALE_ID: FontScaleId = "m";

/** Multipliers applied to every typography token (fontSize + lineHeight). */
export const FONT_SCALE_VALUES: Record<FontScaleId, number> = {
  s: 0.9,
  m: 1.0,
  l: 1.15,
  xl: 1.3,
};

export function normalizeFontScaleId(value: string | null | undefined): FontScaleId {
  if (value === "s" || value === "m" || value === "l" || value === "xl") return value;
  return DEFAULT_FONT_SCALE_ID;
}

export function fontScaleValue(id: FontScaleId): number {
  return FONT_SCALE_VALUES[id];
}

function roundSize(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Base type scale at scale=1. Components should not import this for rendering. */
export const baseTypography: Record<string, TextStyle> = {
  displayXl: {
    fontFamily: displayExtra,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.4,
  },
  displayLg: {
    fontFamily: displayExtra,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.3,
  },
  displayMd: {
    fontFamily: displayBold,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.2,
  },
  displaySm: {
    fontFamily: displayBold,
    fontSize: 16,
    lineHeight: 20,
    letterSpacing: -0.1,
  },
  chatBody: {
    fontFamily: body,
    fontSize: 16,
    lineHeight: 25,
  },
  bodyLg: {
    fontFamily: body,
    fontSize: 16,
    lineHeight: 24,
  },
  bodyMd: {
    fontFamily: body,
    fontSize: 15,
    lineHeight: 22,
  },
  bodySm: {
    fontFamily: bodyMedium,
    fontSize: 14,
    lineHeight: 20,
  },
  label: {
    fontFamily: bodySemi,
    fontSize: 13,
    lineHeight: 18,
  },
  bodyXs: {
    fontFamily: bodySemi,
    fontSize: 12,
    lineHeight: 16,
  },
  monoSm: {
    fontFamily: mono,
    fontSize: 13,
    lineHeight: 19,
  },
  monoXs: {
    fontFamily: monoBold,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.4,
  },
};

function cloneScaled(scale: number): Record<string, TextStyle> {
  const out: Record<string, TextStyle> = {};
  for (const [key, style] of Object.entries(baseTypography)) {
    out[key] = {
      ...style,
      ...(typeof style.fontSize === "number"
        ? { fontSize: roundSize(style.fontSize * scale) }
        : null),
      ...(typeof style.lineHeight === "number"
        ? { lineHeight: roundSize(style.lineHeight * scale) }
        : null),
    };
  }
  return out;
}

/**
 * Live typography tokens. Static importers (`import { typography }`) keep this
 * object reference; `applyFontScale` mutates fontSize/lineHeight in place so
 * re-renders after a scale change pick up the new sizes without migrating every
 * call site to context.
 */
export const typography: Record<string, TextStyle> = cloneScaled(1);

/** Build a fresh scaled copy (for ThemeContext value identity). */
export function scaleTypography(scale: number): Record<string, TextStyle> {
  return cloneScaled(scale);
}

/**
 * Mutate the live `typography` export to match `scale`, and return a fresh
 * scaled copy suitable for putting on the theme context.
 */
export function applyFontScale(scale: number): Record<string, TextStyle> {
  const scaled = cloneScaled(scale);
  for (const key of Object.keys(baseTypography)) {
    const live = typography[key];
    const next = scaled[key];
    if (!live || !next) continue;
    if (typeof next.fontSize === "number") live.fontSize = next.fontSize;
    if (typeof next.lineHeight === "number") live.lineHeight = next.lineHeight;
  }
  return scaled;
}

/**
 * Reactive typography tokens, memoized per the current Settings font-scale
 * preference. Unlike the static `typography` import (mutated in place —
 * relies on an unrelated re-render to become visible), this reads the value
 * ThemeContext already computes in App.tsx (`applyFontScale` + `useMemo`), so
 * components using this hook re-render whenever the scale actually changes.
 * Prefer this over `import { typography }` in new/updated screens.
 */
export function useTypography(): Record<string, TextStyle> {
  return useLabTheme<{ typography: Record<string, TextStyle> }>().typography;
}
