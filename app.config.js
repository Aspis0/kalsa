const config = {
  name: "Kalsa AI Chat",
  slug: "kalsa",
  version: "0.1.0",
  orientation: "portrait",
  scheme: "kalsa",
  userInterfaceStyle: "automatic",
  assetBundlePatterns: ["**/*"],
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.kalsa.app",
    deploymentTarget: "16.4",
    config: {
      usesNonExemptEncryption: false,
    },
    infoPlist: {
      NSMicrophoneUsageDescription:
        "Kalsa uses the microphone for on-device voice dictation. Audio stays on this device.",
    },
  },
  android: {
    package: "com.kalsa.app",
    permissions: ["android.permission.RECORD_AUDIO"],
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
    "./plugins/withLintOff",
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
      "expo-notifications",
      {
        color: "#0b1512",
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
