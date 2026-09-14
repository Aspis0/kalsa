/**
 * Loopback-only cleartext HTTP (127.0.0.1 / localhost / ::1) so adb reverse
 * to the Mac works in debug AND release. Global default stays
 * cleartextTrafficPermitted=false (app.config usesCleartextTraffic: false).
 */
const fs = require("fs");
const path = require("path");
const { withAndroidManifest, withDangerousMod } = require("@expo/config-plugins");

const XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">127.0.0.1</domain>
        <domain includeSubdomains="false">localhost</domain>
        <domain includeSubdomains="false">::1</domain>
    </domain-config>
</network-security-config>
`;

module.exports = function withDebugCleartext(config) {
  config = withDangerousMod(config, [
    "android",
    async (c) => {
      const root = c.modRequest.platformProjectRoot;
      const xmlDir = path.join(root, "app/src/main/res/xml");
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, "network_security_config.xml"), XML);
      return c;
    },
  ]);
  return withAndroidManifest(config, (mod) => {
    const app = mod.modResults.manifest?.application?.[0];
    if (app?.$) {
      app.$["android:networkSecurityConfig"] = "@xml/network_security_config";
    }
    return mod;
  });
};
