# kalsa-thermal (Expo native module)

This local Expo module exposes only the platform thermal signal needed by the
C3 hard gate. It is auto-linked from `modules/` in native development builds.

The JS surface is:

- `getCurrentThermalStateAsync()` — returns `{ platform, supported, status }`
  on Android or `{ platform, supported, state }` on iOS.
- `thermalStateDidChange` — emitted when the platform thermal signal changes.

Android uses `PowerManager.getCurrentThermalStatus()` and registers with
`addThermalStatusListener` on API 29+. iOS reads `ProcessInfo.thermalState`
before registering for `thermalStateDidChangeNotification`. No raw Celsius
thermal-zone value and no charging state are used.

`src/engine/platformThermalStatus.ts` normalizes the snapshots and fails open
when this native module is missing, unsupported, malformed, or throws. The
pure predicates in `src/engine/thermalHardGate.ts` gate only Android CRITICAL /
EMERGENCY / SHUTDOWN and iOS `.critical`.
