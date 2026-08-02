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
    deploymentTarget: "16.4",
    config: {
      usesNonExemptEncryption: false,
    },
  },
  android: {
    package: "com.aichat.app",
    permissions: [],
    allowBackup: false,
    usesCleartextTraffic: false,
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
      "expo-image-picker",
      {
        photosPermission: "AI Chat lets you attach photos so the local model can read them.",
        cameraPermission: "AI Chat uses the camera to take photos for the local model.",
      },
    ],
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
      },
    ],
  ],
};

module.exports = () => {
  const next = JSON.parse(JSON.stringify(config));
  return next;
};
