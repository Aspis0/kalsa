/**
 * The type layer's data, kept free of react-native so it can be asserted in the
 * node test stack (`typography.test.ts`). `typography.ts` turns these numbers
 * into the live TextStyle tokens; `fonts.ts` loads exactly `LOADED_FACES`.
 *
 * The link to the loader is a type, not a convention: fonts.ts types its map as
 * `Record<LoadedFace, FontSource>`, so a face added to (or dropped from) this
 * list without the loader is a compile error in both directions.
 *
 * On Android RN does not synthesize `fontWeight` for a custom family — weight
 * lives in the face name (…_400Regular, …_600SemiBold). No role may carry a
 * numeric fontWeight beside one of these faces.
 */
import type { TextStyle } from "react-native";

/** The ten faces the boot gate waits for, in fonts.ts. Nine are used by a role;
 *  Inter_700Bold is loaded and referenced by no role, deliberately. */
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

/**
 * Role -> face name. An italic role must stay inside its upright role's family:
 * `bodyItalic` used to point at SourceSerif4_400Regular_Italic while `body` was
 * Inter, so one italic word inside sans UI text jumped to another family's serif.
 *
 * Deliberately NOT typed as `Record<string, LoadedFace>`: that would turn a role
 * naming an unloaded face into a compile error and make the runtime assertion
 * vacuous. The test is meant to be the guard here.
 */
export const typeFaces = {
  display: "SourceSerif4_600SemiBold",
  displayBold: "SourceSerif4_600SemiBold",
  displayExtra: "SourceSerif4_600SemiBold",
  body: "Inter_400Regular",
  bodyItalic: "Inter_400Regular_Italic",
  bodyMedium: "Inter_500Medium",
  bodySemi: "Inter_600SemiBold",
  chatBody: "SourceSerif4_400Regular",
  mono: "IBMPlexMono_400Regular",
  monoBold: "IBMPlexMono_700Bold",
} as const;

/** The scale at multiplier 1, before the user's font-scale preference. */
export const baseTypeScale: Record<string, TextStyle> = {
  displayXl: {
    fontFamily: typeFaces.displayExtra,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.4,
  },
  displayLg: {
    fontFamily: typeFaces.displayExtra,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.3,
  },
  displayMd: {
    fontFamily: typeFaces.displayBold,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.2,
  },
  displaySm: {
    fontFamily: typeFaces.displayBold,
    fontSize: 16,
    lineHeight: 20,
    letterSpacing: -0.1,
  },
  chatBody: {
    fontFamily: typeFaces.chatBody,
    fontSize: 16,
    lineHeight: 25,
  },
  bodyLg: {
    fontFamily: typeFaces.body,
    fontSize: 16,
    lineHeight: 24,
  },
  bodyMd: {
    fontFamily: typeFaces.body,
    fontSize: 15,
    lineHeight: 22,
  },
  bodySm: {
    fontFamily: typeFaces.bodyMedium,
    fontSize: 14,
    lineHeight: 20,
  },
  label: {
    fontFamily: typeFaces.bodySemi,
    fontSize: 13,
    lineHeight: 18,
  },
  bodyXs: {
    fontFamily: typeFaces.bodySemi,
    fontSize: 12,
    lineHeight: 16,
  },
  monoSm: {
    fontFamily: typeFaces.mono,
    fontSize: 13,
    lineHeight: 19,
  },
  monoXs: {
    fontFamily: typeFaces.monoBold,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.4,
  },
};
