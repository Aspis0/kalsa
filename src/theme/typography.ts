import { Platform, TextStyle } from "react-native";

// Font family resolves to the loaded @expo-google-fonts/* family name.
// useFonts is wired in App.tsx; until it resolves, App renders null.
const display = Platform.select({
  default: "Fraunces_500Medium",
});
const displayBold = Platform.select({
  default: "Fraunces_600SemiBold",
});
const body = Platform.select({
  default: "Inter_400Regular",
});
const bodyMedium = Platform.select({
  default: "Inter_500Medium",
});
const bodySemi = Platform.select({
  default: "Inter_600SemiBold",
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
  body,
  bodyMedium,
  bodySemi,
  mono,
  monoBold,
};

// Type scale. Components should pull from here rather than hardcoding sizes.
export const typography: Record<string, TextStyle> = {
  displayXl: {
    fontFamily: display,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.2,
  },
  displayLg: {
    fontFamily: displayBold,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.1,
  },
  displayMd: {
    fontFamily: displayBold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: 0,
  },
  bodyLg: {
    fontFamily: body,
    fontSize: 16,
    lineHeight: 24,
  },
  bodyMd: {
    fontFamily: body,
    fontSize: 14,
    lineHeight: 22,
  },
  bodySm: {
    fontFamily: bodyMedium,
    fontSize: 13,
    lineHeight: 18,
  },
  bodyXs: {
    fontFamily: bodySemi,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 1.3,
    textTransform: "uppercase",
  },
  monoSm: {
    fontFamily: monoBold,
    fontSize: 12,
    lineHeight: 16,
  },
  monoXs: {
    fontFamily: monoBold,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
};
