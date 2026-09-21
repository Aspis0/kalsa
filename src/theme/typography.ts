import { Platform, TextStyle } from "react-native";

import { useLabTheme } from "../ui/labTheme";

import { baseTypeScale, typeFaces } from "./typeData";

// Font family resolves to the loaded @expo-google-fonts/* family name:
// Inter for the interface, Source Serif 4 for the answer, IBM Plex Mono for
// code and figures. useFonts is wired in App.tsx; until it resolves, App renders null.
// On Android, fontWeight is NOT synthesized for custom families — weight MUST
// come from the fontFamily name (never pair a custom family with numeric fontWeight).
// The names live in typeData.ts (react-native-free) so typography.test.ts can
// read them; this file only projects them onto the current platform.
const display = Platform.select({ default: typeFaces.display });
const displayBold = Platform.select({ default: typeFaces.displayBold });
const displayExtra = Platform.select({ default: typeFaces.displayExtra });
const body = Platform.select({ default: typeFaces.body });
// Inter ships its own italic, so UI italic stays inside the UI family. It used
// to point at SourceSerif4_400Regular_Italic, which made an italic word inside
// sans UI text jump to another family's serif. `typeFaces` pins that pairing.
const bodyItalic = Platform.select({ default: typeFaces.bodyItalic });
const bodyMedium = Platform.select({ default: typeFaces.bodyMedium });
const bodySemi = Platform.select({ default: typeFaces.bodySemi });
const chatBody = Platform.select({ default: typeFaces.chatBody });
const mono = Platform.select({ default: typeFaces.mono });
const monoBold = Platform.select({ default: typeFaces.monoBold });

export const fontFamilies = {
  display,
  displayBold,
  displayExtra,
  body,
  bodyItalic,
  bodyMedium,
  bodySemi,
  chatBody,
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

/**
 * Base type scale at scale=1. Components should not import this for rendering.
 * The numbers live in typeData.ts so typography.test.ts can assert the ladder
 * without importing Platform or the theme context.
 */
export const baseTypography: Record<string, TextStyle> = baseTypeScale;

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
