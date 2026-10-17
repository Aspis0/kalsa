/**
 * Kalsa notifications are LOCAL only (download progress, src/host/downloadNotifications.ts).
 * expo-notifications' iOS plugin adds `aps-environment` to the entitlements whenever the
 * key is absent, and a free Apple ID cannot provision push, so the signed install fails.
 * Strip the key here.
 *
 * Keep this entry BEFORE "expo-notifications" in app.config.js: the mod registered last
 * runs first, so this one must register first to run after expo-notifications has written it.
 */
const { withEntitlementsPlist } = require("expo/config-plugins");

module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (c) => {
    delete c.modResults["aps-environment"];
    return c;
  });
};
