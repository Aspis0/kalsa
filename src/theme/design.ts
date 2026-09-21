/**
 * The design layer for the 2026-09 rebuild.
 *
 * The palette is the single asset that survives, and it is the GREEN family:
 * Kalsa Brain's `chat/src/styles/tokens.css` and the app's own `palettes.js`
 * already carry the same accent (`#1f5f4e` light, `#75b3a0` dark), so the two
 * products agree by construction rather than by convention.
 *
 * These values are kept verbatim and need no correction: measured with the
 * WCAG 2.1 formula, every text pair passes in both modes — the loudest case is
 * accent-as-text at 6.98:1 (light) and 7.59:1 (dark), and the quietest is
 * secondary text at 5.97:1. `design.test.ts` re-checks all of them on every
 * run so a value cannot drift.
 */

import { radius, spacing } from "./tokens";

export type ThemeMode = "light" | "dark";

export type DesignColors = {
  /** The page. Everything sits on it. */
  page: string;
  /** Cards and sheets. Separated from the page by elevation, not by a border. */
  surface: string;
  /** A recessed block: code, an inset row. */
  surfaceMuted: string;
  /** The user's turn — the only boxed turn in the transcript. */
  bubbleUser: string;
  /** Hairlines. Grouping, never decoration. */
  border: string;
  borderStrong: string;
  /** Primary text. */
  ink: string;
  /** Secondary: subtitles, quiet labels. */
  inkSoft: string;
  /** Tertiary: timestamps, units, placeholders, the thinking tail. */
  silence: string;
  /** The single accent. Structural use only: send, focus, progress, links. */
  accent: string;
  accentHover: string;
  accentPressed: string;
  /** Foreground on a filled accent surface. */
  onAccent: string;
  /** Destructive text and icons. */
  danger: string;
  dangerSoft: string;
  /** Highlighted text, and the same tint the user's turn uses: a selection and
   *  "this is mine" are the same idea. */
  selection: string;
};

/** Light. Values from Kalsa Brain's tokens.css; all pairs measured. */
const light: DesignColors = {
  page: "#f4f8f3",
  surface: "#ffffff",
  surfaceMuted: "#e8eae7",
  /** 1.25:1 against the page — deliberately the same step ChatGPT's own bubble
   *  takes (1.24:1), so the container is felt rather than outlined. ink on it
   *  measures 12.39:1. */
  bubbleUser: "#cfe3d6",
  border: "#d8e0d7",
  borderStrong: "#c2cdc1",
  ink: "#17201c",
  inkSoft: "#2c3630",
  silence: "#58615b",
  accent: "#1f5f4e",
  accentHover: "#125545",
  accentPressed: "#024b3b",
  onAccent: "#ffffff",
  danger: "#8a3b32",
  dangerSoft: "#f6e2df",
  selection: "#cfe3d6",
};

/** Dark. The accent lightens so it keeps its contrast against a dark page, the
 *  same move Kalsa Brain makes (#1f5f4e -> #75b3a0). */
const dark: DesignColors = {
  page: "#111613",
  surface: "#1a211c",
  surfaceMuted: "#232c26",
  /** 1.69:1 — a larger step than light mode, because on a dark page a small
   *  step reads as a smudge rather than as a container. */
  bubbleUser: "#2b4238",
  border: "#2e3833",
  borderStrong: "#414e46",
  ink: "#e9f0ea",
  inkSoft: "#c2cfc5",
  silence: "#97a59c",
  accent: "#75b3a0",
  accentHover: "#86c2ab",
  accentPressed: "#679e8c",
  onAccent: "#111613",
  danger: "#d89c92",
  dangerSoft: "#3a2422",
  selection: "#2b4238",
};

export const modes: Record<ThemeMode, DesignColors> = { light, dark };

/** Loaded faces. Weight lives in the NAME: on Android RN does not synthesize
 *  fontWeight for a custom family, so a numeric weight is never set alongside
 *  these (the trap is documented in typography.ts and createStyles.ts). */
export const families = {
  sans: "Inter_400Regular",
  sansMedium: "Inter_500Medium",
  sansSemi: "Inter_600SemiBold",
  sansBold: "Inter_700Bold",
  sansItalic: "Inter_400Regular_Italic",
  /** The reading face for the answer itself. Not the same job as `sans`: the
   *  interface is Inter, the answer is set in a serif, which is what Claude
   *  ships and what a 3-inch panel rewards at 16/26. */
  reading: "SourceSerif4_400Regular",
  /** Display. Source Serif 4 carries it, at its semibold weight: Instrument
   *  Serif was the earlier choice and is NOT installed, so naming it here would
   *  have made the "every family is loaded" test pass vacuously. */
  display: "SourceSerif4_600SemiBold",
  displayItalic: "SourceSerif4_400Regular_Italic",
  /** Code, and figures that must line up in columns. */
  mono: "IBMPlexMono_400Regular",
} as const;

/** Five roles, down from the twelve the old scale carried. */
export const type = {
  /** The one place a serif speaks: the empty state, a screen title. */
  display: { fontFamily: families.display, fontSize: 28, lineHeight: 34, letterSpacing: -0.2 },
  title: { fontFamily: families.sansSemi, fontSize: 18, lineHeight: 24, letterSpacing: -0.1 },
  /** The reading role: the assistant's answer. 16/26 is a deliberately loose
   *  leading, because the answer is long and the panel is small, and leading
   *  buys legibility cheaper than size does. */
  body: { fontFamily: families.reading, fontSize: 16, lineHeight: 26 },
  label: { fontFamily: families.sansMedium, fontSize: 14, lineHeight: 20 },
  meta: { fontFamily: families.sansMedium, fontSize: 12, lineHeight: 16 },
  mono: { fontFamily: families.mono, fontSize: 13, lineHeight: 19 },
} as const;

export type TypeRole = keyof typeof type;

export const measure = {
  /** The Jelly Star is 349 dp wide and the S23 is 360: the widths are nearly
   *  identical, so the layout is tuned on HEIGHT and on the compact gutter. */
  gutter: 18,
  gutterCompact: 14,
  /** Between two turns. */
  turnGap: 18,
  /** The deliberate empty band the composer floats over, so the last line of an
   *  answer is never trapped against the input. */
  composerLift: 96,
  /** Every control clears this; hitSlop where the glyph is smaller. */
  touchTarget: 48,
  /** Longest a line of answer text may run, in dp. */
  readingMaxWidth: 620,
} as const;

export { radius, spacing };
