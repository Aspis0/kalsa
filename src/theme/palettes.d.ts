export type ThemeMode = "light" | "dark";

export type ThemeColors = {
  ink: string;
  muted: string;
  quiet: string;
  shell: string;
  shellElevated: string;
  panelSolid: string;
  panel: string;
  panelSoft: string;
  panelBright: string;
  inputNativeFill: string;
  line: string;
  lineStrong: string;
  accent: string;
  compute: string;
  cyan: string;
  violet: string;
  amber: string;
  danger: string;
  blackGlass: string;
  whiteGlass: string;
  navGlass: string;
  glowTop: string;
  glowMid: string;
  progressTrack: string;
  primaryText: string;
  materialTop: string;
  materialMid: string;
  materialBottom: string;
  materialVeil: string;
  // Added in V1/V2 redesign — read by new primitives + createStyles cards.
  accentDeep: string;
  inkSoft: string;
  good: string;
  warn: string;
  bad: string;
  cardStrong: string;
  surfaceElev: string;
  surfaceSunken: string;
  // Added for RNA-seq mobile port — read by Pill tones, plot SVGs, soft tints.
  lineSoft: string;
  accentSoft: string;
  computeDeep: string;
  computeSoft: string;
  goodSoft: string;
  controlSoft: string;
  warnSoft: string;
  badSoft: string;
  plotUp: string;
  plotDown: string;
  plotNs: string;
  leafBody: string;
  leafBodyDeep: string;
  leafBack: string;
  leafStroke: string;
  leafTile: string;
  leafTileActive: string;
  leafBackdrop: string;
  leafShade: string;
  leafInk: string;
  leafMuted: string;
  leafLine: string;
};

export type ThemePalette = {
  id: ThemeMode;
  name: string;
  blurTint: "light" | "dark";
  statusBar: "light-content" | "dark-content";
  colors: ThemeColors;
};

export const THEME_OPTIONS: Array<{
  id: ThemeMode;
  label: string;
  name: string;
}>;

export const palettes: Record<ThemeMode, ThemePalette>;
