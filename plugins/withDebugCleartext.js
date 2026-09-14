/**
 * Debug-only cleartext HTTP so the phone can reach 127.0.0.1:8000
 * (adb reverse → Mac mtplx). Release keeps usesCleartextTraffic=false.
 */
const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("@expo/config-plugins");

const XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true" />
</network-security-config>
`;

const DEBUG_MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">
    <application
        android:usesCleartextTraffic="true"
        android:networkSecurityConfig="@xml/network_security_config"
        tools:targetApi="28" />
</manifest>
`;

module.exports = function withDebugCleartext(config) {
  return withDangerousMod(config, [
    "android",
    async (c) => {
      const root = c.modRequest.platformProjectRoot;
      const xmlDir = path.join(root, "app/src/debug/res/xml");
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, "network_security_config.xml"), XML);
      const debugDir = path.join(root, "app/src/debug");
      fs.mkdirSync(debugDir, { recursive: true });
      fs.writeFileSync(path.join(debugDir, "AndroidManifest.xml"), DEBUG_MANIFEST);
      return c;
    },
  ]);
};
