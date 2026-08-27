// Aspis Bio "Agora" palettes for the mobile app.
// Dark theme is the primary direction (matches the new website's Agora theme).
// Light theme ("Sage paper"): on a light page, elevated surfaces go LIGHTER /
// WHITER (opaque whites and near-whites) — never "more transparent black".
// Borders sit at ≥ ~10% black equivalent so they remain visible on #E8EEE7.
// Keys preserved so existing createStyles.ts compiles unchanged.

const THEME_OPTIONS = [
  { id: "light", label: "Light", name: "Sage paper" },
  { id: "dark", label: "Dark", name: "Navy glass" },
];

const palettes = {
  light: {
    id: "light",
    name: "Sage paper",
    blurTint: "light",
    statusBar: "dark-content",
    colors: {
      // text
      ink: "#17201C",
      muted: "#58615B",
      quiet: "#2C3630",
      // page + surfaces (OPAQUE — elevated surfaces go lighter on a light page)
      shell: "#E8EEE7",
      shellElevated: "#F4F8F3",
      panelSolid: "#FFFFFF",
      panel: "#F4F8F3",
      panelSoft: "#EDF2EC",
      panelBright: "#FFFFFF",
      inputNativeFill: "#FFFFFF",
      cardStrong: "#FFFFFF",
      surfaceElev: "#FFFFFF",
      surfaceSunken: "#D8E0D7",
      materialTop: "#E8EEE7",
      materialMid: "#E8EEE7",
      materialBottom: "#E8EEE7",
      // borders — 10% black is the floor for visibility on this page
      line: "#D3DAD2",
      lineStrong: "#C2CAC1",
      lineSoft: "#DFE5DE",
      progressTrack: "#D3DAD2",
      // one accent, used structurally (send / links / progress / focus)
      accent: "#1F5F4E",
      accentDeep: "#17493C",
      accentSoft: "#DCE6DE",
      primaryText: "#FFFFFF",
      // semantic — recomputed to pass WCAG AA (4.5:1) on the page
      compute: "#0A6A5A",
      computeDeep: "#083F35",
      cyan: "#2E6E80",
      violet: "#5B3F8C",
      amber: "#8A6410",
      good: "#146B33",
      warn: "#8A6410",
      bad: "#B3261E",
      danger: "#B3261E",
      computeSoft: "#D9E8E3",
      goodSoft: "#DCEBDF",
      // Soft violet — plate-grid control wells (distinct from goodSoft sample green).
      controlSoft: "#E8E0F2",
      warnSoft: "#F2E6CC",
      badSoft: "#F5DEDC",
      // plots
      plotUp: "#B3261E",
      plotDown: "#1D4ED8",
      plotNs: "#A8B0A7",
      // scrims / overlays — layered over content, MUST stay translucent
      blackGlass: "rgba(23, 32, 28, 0.06)",
      whiteGlass: "rgba(255, 255, 255, 0.75)",
      navGlass: "rgba(232, 238, 231, 0.92)",
      materialVeil: "rgba(244, 248, 243, 0)",
      glowTop: "rgba(31, 95, 78, 0.05)",
      glowMid: "rgba(10, 106, 90, 0.05)",
      // kept for key parity (createStyles / primitives still read it)
      inkSoft: "#2C3630",
    },
  },
  dark: {
    id: "dark",
    name: "Navy glass",
    blurTint: "dark",
    statusBar: "light-content",
    colors: {
      // Legacy keys — retuned to Agora dark.
      ink: "#f7f3ed",
      muted: "#a8b0bc",
      quiet: "#ddd5cc",
      shell: "#07101C",
      shellElevated: "#0B1727",
      panelSolid: "#0B1727",
      panel: "rgba(255, 255, 255, 0.07)",
      panelSoft: "rgba(255, 255, 255, 0.04)",
      panelBright: "rgba(255, 255, 255, 0.12)",
      inputNativeFill: "rgba(255, 255, 255, 0.05)",
      line: "rgba(255, 255, 255, 0.17)",
      lineStrong: "rgba(255, 255, 255, 0.30)",
      accent: "#f07a3f",
      compute: "#5fd2bd",
      cyan: "#88c0d0",
      violet: "#b594dd",
      amber: "#f5c542",
      danger: "#ef4444",
      blackGlass: "rgba(8, 10, 14, 0.64)",
      whiteGlass: "rgba(255, 255, 255, 0.07)",
      navGlass: "rgba(8, 10, 14, 0.50)",
      glowTop: "rgba(240, 122, 63, 0.10)",
      glowMid: "rgba(95, 210, 189, 0.10)",
      progressTrack: "rgba(255, 255, 255, 0.12)",
      primaryText: "#0d1118",
      materialTop: "#07101C",
      materialMid: "#07101C",
      materialBottom: "#07101C",
      materialVeil: "rgba(13, 17, 24, 0)",
      // New keys consumed by primitives.
      accentDeep: "#e0522d",
      inkSoft: "#ddd5cc",
      good: "#22c55e",
      warn: "#f59e0b",
      bad: "#ef4444",
      cardStrong: "rgba(255, 255, 255, 0.12)",
      surfaceElev: "#181d27",
      surfaceSunken: "#0E1520",
      // RNA-seq mobile port — soft tints, plot colors, line hairline.
      lineSoft: "rgba(255, 255, 255, 0.08)",
      accentSoft: "rgba(240, 122, 63, 0.16)",
      computeDeep: "#3aa890",
      computeSoft: "rgba(95, 210, 189, 0.14)",
      goodSoft: "rgba(34, 197, 94, 0.16)",
      // Soft violet from palette violet #b594dd — plate-grid control wells.
      controlSoft: "rgba(181, 148, 221, 0.18)",
      warnSoft: "rgba(245, 158, 11, 0.16)",
      badSoft: "rgba(239, 68, 68, 0.18)",
      plotUp: "#ff8a78",
      plotDown: "#6ba8ff",
      plotNs: "rgba(255, 255, 255, 0.18)",
    },
  },
};

module.exports = {
  THEME_OPTIONS,
  palettes,
};
