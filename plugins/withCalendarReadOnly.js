/**
 * expo-calendar may declare WRITE_CALENDAR. Kalsa only reads the agenda —
 * strip write permission from the merged manifest.
 */

const { withAndroidManifest } = require("@expo/config-plugins");

const WRITE = "android.permission.WRITE_CALENDAR";

module.exports = function withCalendarReadOnly(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    if (!manifest) return mod;
    const perms = manifest["uses-permission"];
    if (Array.isArray(perms)) {
      manifest["uses-permission"] = perms.filter(
        (p) => p?.$?.["android:name"] !== WRITE,
      );
    }
    return mod;
  });
};
