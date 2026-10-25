/** Android debug bundle request options mirrored from React Native DevServerHelper. */
export const ANDROID_DEBUG_BUNDLE_ENTRY = "/.expo/.virtual-metro-entry.bundle";

export const ANDROID_DEBUG_BUNDLE_OPTIONS = Object.freeze({
  platform: "android",
  dev: "true",
  lazy: "true",
  minify: "false",
  app: "com.kalsa.app",
  modulesOnly: "false",
  runModule: "true",
});

// React Native's Android DevServerHelper appends these only when Fusebox is enabled.
export const FUSEBOX_BUNDLE_OPTIONS = Object.freeze({
  excludeSource: "true",
  sourcePaths: "url-server",
});

// Expo's Metro rewrite may append these to the virtual entry request.
export const EXPO_REWRITE_BUNDLE_OPTIONS = Object.freeze({
  routerRoot: "src/app",
  engine: "hermes",
  bytecode: "1",
  unstable_transformProfile: "hermes-stable",
});

export function buildAndroidDebugBundlePath({ fusebox = false, rewrite = false } = {}) {
  const options = new URLSearchParams(ANDROID_DEBUG_BUNDLE_OPTIONS);
  if (fusebox) {
    for (const [key, value] of Object.entries(FUSEBOX_BUNDLE_OPTIONS)) {
      options.set(key, value);
    }
  }
  if (rewrite) {
    for (const [key, value] of Object.entries(EXPO_REWRITE_BUNDLE_OPTIONS)) {
      options.set(key, value);
    }
  }
  return `${ANDROID_DEBUG_BUNDLE_ENTRY}?${options.toString()}`;
}

export function fuseboxEnabledFromEnv(env = process.env) {
  return /^(1|true|yes)$/i.test(String(env.CAMPAIGN_METRO_FUSEBOX || ""));
}
