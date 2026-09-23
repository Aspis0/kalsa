/**
 * Runtime-free font and size data. `typography.ts` scales these roles for the
 * existing Settings preference; the canonical entries follow DESIGN-V2.md §1.2.
 */
import type { TextStyle } from "react-native";

export const LOADED_FACES = [
  "Inter_400Regular",
  "Inter_400Regular_Italic",
  "Inter_500Medium",
  "Inter_600SemiBold",
  "Inter_700Bold",
  "SourceSerif4_400Regular",
  "SourceSerif4_400Regular_Italic",
  "SourceSerif4_600SemiBold",
  "IBMPlexMono_400Regular",
  "IBMPlexMono_700Bold",
] as const;

export type LoadedFace = (typeof LOADED_FACES)[number];

export const typeFaces = {
  display: "Inter_700Bold",
  displayBold: "Inter_700Bold",
  displayExtra: "Inter_700Bold",
  body: "Inter_400Regular",
  bodyItalic: "Inter_400Regular_Italic",
  bodyMedium: "Inter_500Medium",
  bodySemi: "Inter_600SemiBold",
  chatBody: "SourceSerif4_400Regular",
  readingLead: "SourceSerif4_600SemiBold",
  mono: "IBMPlexMono_400Regular",
  monoBold: "IBMPlexMono_700Bold",
} as const;

const display = { fontFamily: typeFaces.display, fontSize: 26, lineHeight: 32, letterSpacing: -0.52 };
const title = { fontFamily: typeFaces.display, fontSize: 21, lineHeight: 26, letterSpacing: -0.315 };
const headline = { fontFamily: typeFaces.bodySemi, fontSize: 17, lineHeight: 22, letterSpacing: -0.17 };
const body = { fontFamily: typeFaces.body, fontSize: 15, lineHeight: 21 };
const bodyStrong = { fontFamily: typeFaces.bodySemi, fontSize: 15, lineHeight: 21 };
const secondary = { fontFamily: typeFaces.body, fontSize: 12.5, lineHeight: 17 };
const label = { fontFamily: typeFaces.displayBold, fontSize: 11, lineHeight: 14, letterSpacing: 0.99 };
const reading = { fontFamily: typeFaces.chatBody, fontSize: 17, lineHeight: 28 };
const readingLead = { fontFamily: typeFaces.readingLead, fontSize: 17, lineHeight: 28 };
const mono = { fontFamily: typeFaces.mono, fontSize: 12.5, lineHeight: 18 };
const monoLabel = { fontFamily: typeFaces.mono, fontSize: 11, lineHeight: 14, letterSpacing: 0.66 };

/** Canonical v2 roles plus legacy names still used by mounted screens. */
export const baseTypeScale: Record<string, TextStyle> = {
  display, title, headline, body, bodyStrong, secondary, label, reading, readingLead, mono, monoLabel,
  displayXl: display,
  displayLg: title,
  displayMd: headline,
  displaySm: bodyStrong,
  chatBody: reading,
  bodyLg: body,
  bodyMd: body,
  bodySm: secondary,
  bodyXs: label,
  monoSm: mono,
  monoXs: monoLabel,
};
