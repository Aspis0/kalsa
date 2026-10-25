export const spacing = {
  xxs: 4,
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 32,
};

export const radius = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 22,
  xl: 28,
  pill: 999,
};

// The old "Lab Book / notebook" palette used to live here. It was dead code —
// no file in src/ ever imported it — and it contradicted the brand: it claimed a
// warm cream paper, a blue-grey chrome and a teal accent, while the app actually
// ships the green family (palettes.js, accent #1f5f4e) and so does the desktop
// (Kalsa Brain, chat/src/styles/tokens.css, --accent: #1f5f4e). It also cited a
// web reference, labbook-v2.css, that was never in this repository's history.
// The live palette is now `src/theme/design.ts`; the brand pair green #1F5F4E
// and cream #F4EFE4 is the one BrandIcon.tsx already encoded.

// React Native shadows are platform-split. These tokens encode (iOS) shadow*
// and (Android) elevation in one place so primitives can spread them.
export const shadows = {
  soft: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 3,
  },
  lift: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.35,
    shadowRadius: 28,
    elevation: 8,
  },
  accent: {
    shadowColor: "#f07a3f",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.35,
    shadowRadius: 28,
    elevation: 10,
  },
} as const;
