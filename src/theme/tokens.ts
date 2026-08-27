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

// Lab Book "notebook" palette — Claude design (web v2 parity).
// The notebook is INTENTIONALLY always a dark blue-grey "chrome" shell wrapping
// warm cream paper pages with deep blue-black ink and a teal accent, regardless
// of the app's light/dark theme. Values are converted from the web reference
// oklch() tokens (labbook-v2.css :root) to HEX/RGBA so they render natively.
export const notebook = {
  // ink (pen on paper)
  ink: "#0b1c2c",
  inkDim: "#607489",
  inkFaint: "#91a0b1",
  // paper (warm cream)
  paper: "#f7f3eb",
  paperEdge: "#eae4d7",
  paperDeep: "#dfd6c8",
  paperShadow: "#c1b5a6",
  // teal accent
  teal: "#008889",
  tealStrong: "#00a2a4",
  // chrome (workspace shell around the book)
  chromeBg: "#0a0f13",
  chromePanel: "#13181d",
  chromeRaised: "#1b2127",
  chromeBorder: "#292e34",
  chromeText: "#f1f4f7",
  chromeMuted: "#81878d",
  // on-teal foreground (matches web --teal-strong button text)
  onTeal: "#061417",
} as const;

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
