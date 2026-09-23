/**
 * The measured v2 roles shared by the rebuilt shell and its legacy surfaces.
 * Canonical names mirror DESIGN-V2.md; the final fields in DesignColors are
 * compatibility aliases for mounted screens that have not moved to v2 yet.
 */
import { radius as legacyRadius, spacing } from "./tokens";

export type ThemeMode = "light" | "dark";

export type DesignColors = {
  page: string;
  surface: string;
  tint: string;
  line: string;
  line2: string;
  ink: string;
  ink2: string;
  ink3: string;
  brand: string;
  brandDeep: string;
  onBrand: string;
  accent: string;
  selection: string;
  danger: string;
  dangerSoft: string;
  wait: string;
  waitInk: string;
  surfaceMuted: string;
  bubbleUser: string;
  border: string;
  borderStrong: string;
  inkSoft: string;
  silence: string;
  accentHover: string;
  accentPressed: string;
  onAccent: string;
};

const light: DesignColors = {
  page: "#eef5f0",
  surface: "#fbfdfb",
  tint: "#e6f1e9",
  line: "#dfe9e2",
  line2: "#cbd8d0",
  ink: "#12171a",
  ink2: "#2b3330",
  ink3: "#5f6b66",
  brand: "#1f5f4e",
  brandDeep: "#174b3d",
  onBrand: "#ffffff",
  accent: "#1f5f4e",
  selection: "#cfe3d6",
  danger: "#8a3b32",
  dangerSoft: "#f8ecea",
  wait: "#f8f2e4",
  waitInk: "#6a5729",
  surfaceMuted: "#e6f1e9",
  bubbleUser: "#cfe3d6",
  border: "#dfe9e2",
  borderStrong: "#cbd8d0",
  inkSoft: "#2b3330",
  silence: "#5f6b66",
  accentHover: "#174b3d",
  accentPressed: "#174b3d",
  onAccent: "#ffffff",
};

const dark: DesignColors = {
  page: "#0f1512",
  surface: "#161d19",
  tint: "#1d2722",
  line: "#26302b",
  line2: "#35433b",
  ink: "#eaf1ec",
  ink2: "#ccd7d1",
  ink3: "#96a49c",
  brand: "#2b7a63",
  brandDeep: "#236650",
  onBrand: "#ffffff",
  accent: "#7fbfa6",
  selection: "#25423a",
  danger: "#e0a49b",
  dangerSoft: "#2d211f",
  wait: "#241f14",
  waitInk: "#e6cf9a",
  surfaceMuted: "#1d2722",
  bubbleUser: "#25423a",
  border: "#26302b",
  borderStrong: "#35433b",
  inkSoft: "#ccd7d1",
  silence: "#96a49c",
  accentHover: "#91cbb2",
  accentPressed: "#70ad94",
  onAccent: "#ffffff",
};

export const modes: Record<ThemeMode, DesignColors> = { light, dark };

/** The v2 spacing ladder; the older exported spacing object remains for mounted screens. */
export const space = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32 } as const;

/** Canonical v2 radii with old aliases retained for mounted legacy screens. */
export const radius = {
  ...legacyRadius,
  button: 14,
  field: 14,
  row: 14,
  iconButton: 14,
  card: 16,
  image: 16,
  sheet: 22,
  chip: 999,
  badge: 999,
  toggle: 999,
  composer: 999,
} as const;

export const families = {
  sans: "Inter_400Regular",
  sansMedium: "Inter_500Medium",
  sansSemi: "Inter_600SemiBold",
  sansBold: "Inter_700Bold",
  sansItalic: "Inter_400Regular_Italic",
  display: "Inter_700Bold",
  displayItalic: "Inter_400Regular_Italic",
  reading: "SourceSerif4_400Regular",
  readingLead: "SourceSerif4_600SemiBold",
  readingItalic: "SourceSerif4_400Regular_Italic",
  mono: "IBMPlexMono_400Regular",
} as const;

/** The v2 type scale. Weight lives in each loaded face name, never fontWeight. */
export const type = {
  display: { fontFamily: families.display, fontSize: 26, lineHeight: 32, letterSpacing: -0.52 },
  title: { fontFamily: families.display, fontSize: 21, lineHeight: 26, letterSpacing: -0.315 },
  headline: { fontFamily: families.sansSemi, fontSize: 17, lineHeight: 22, letterSpacing: -0.17 },
  body: { fontFamily: families.sans, fontSize: 15, lineHeight: 21 },
  bodyStrong: { fontFamily: families.sansSemi, fontSize: 15, lineHeight: 21 },
  secondary: { fontFamily: families.sans, fontSize: 12.5, lineHeight: 17 },
  label: { fontFamily: families.sansBold, fontSize: 11, lineHeight: 14, letterSpacing: 0.99 },
  reading: { fontFamily: families.reading, fontSize: 17, lineHeight: 28 },
  readingLead: { fontFamily: families.readingLead, fontSize: 17, lineHeight: 28 },
  mono: { fontFamily: families.mono, fontSize: 12.5, lineHeight: 18 },
  monoLabel: { fontFamily: "IBMPlexMono_400Regular", fontSize: 11, lineHeight: 14, letterSpacing: 0.66 },
  /** Legacy metadata style for mounted surfaces awaiting their v2 pass. */
  meta: { fontFamily: families.sansMedium, fontSize: 12, lineHeight: 16 },
} as const;

export type TypeRole = keyof typeof type;

/** e1 and e2 follow the two elevations in DESIGN-V2.md §1.3. */
export const e1 = {
  shadowColor: "#12171a",
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.055,
  shadowRadius: 1,
  elevation: 1,
} as const;

export const e2 = {
  shadowColor: "#12171a",
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.05,
  shadowRadius: 9,
  elevation: 3,
} as const;

/** Compatibility names retained while older mounted screens are replaced. */
export const elevation = { raised: e1, float: e1, dock: e2 } as const;

export const measure = {
  gutter: 16,
  gutterCompact: 16,
  turnGap: 16,
  composerLift: 24,
  touchTarget: 48,
  readingMaxWidth: 620,
} as const;

export { spacing };
