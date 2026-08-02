const config = {
  name: "AI Chat",
  slug: "ai-chat",
  version: "0.1.0",
  orientation: "portrait",
  scheme: "aichat",
  userInterfaceStyle: "automatic",
  assetBundlePatterns: ["**/*"],
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.aichat.app",
    config: {
      usesNonExemptEncryption: false,
    },
  },
  android: {
    package: "com.aichat.app",
    permissions: [],
    adaptiveIcon: {
      backgroundColor: "#07110F",
    },
  },
  extra: {
    // Tutto locale: nessun backend. Endpoint opzionali futuri vanno qui.
  },
  plugins: [
    "expo-font",
    "expo-secure-store",
    "expo-sharing",
    [
      "llama.rn",
      {
        enableEntitlements: true,
        entitlementsProfile: "production",
        forceCxx20: true,
        enableOpenCLAndHexagon: true,
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          newArchEnabled: true,
        },
        ios: {
          deploymentTarget: "16.4",
        },
      },
    ],
  ],
};

module.exports = () => {
  const next = JSON.parse(JSON.stringify(config));
  return next;
};
