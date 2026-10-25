# C3 hard-gate implementation report

Date: 2026-09-05<br>
Branch: `feat/moe-stream`

## Checklist mapping

| Best-practice requirement | Implementation |
| --- | --- |
| Gate only on platform CRITICAL | `src/engine/thermalHardGate.ts` contains the pure predicates. Android gates status `>= 4` (CRITICAL, EMERGENCY, SHUTDOWN); iOS gates only `thermalState == critical` (`3` or `"critical"`). |
| Android platform API | `modules/kalsa-thermal/android/src/main/java/expo/modules/kalsathermal/KalsaThermalModule.kt` uses `PowerManager.getCurrentThermalStatus()` and `addThermalStatusListener()` on API 29+. |
| iOS platform API | `modules/kalsa-thermal/ios/KalsaThermalModule.swift` reads `ProcessInfo.processInfo.thermalState` before registering `thermalStateDidChangeNotification`. |
| Listener plus current value | `modules/kalsa-thermal/src/index.ts` exposes the async current-state query and event subscription. `src/hooks/useThermalHardGate.ts` registers the listener before the initial query and refreshes on foreground. |
| Advisory bands unchanged | `src/hooks/useThermalMonitor.ts` and `src/engine/thermalThresholds.ts` remain the advisory `thermal_zone0` 45/48/52 path. The hard gate never reads that temperature. |
| Charging alone does not gate | The native module does not read battery/charging state; only platform thermal severity/state is mapped. |
| Dispose on rising edge | `src/app/AppShell.tsx` uses the gate's rising edge to abort/invalidate pending work, await the chat lifecycle, then call `runNativeOp(() => disposeEngine())`. It also releases the embedding resource and chat ownership token. |
| Block new inference and model load | `AiChatPage` receives `inferenceBlocked` and rejects all send entry points. AppShell has synchronous ref guards plus current-state probes in `ensureEngineForModel`, download, model selection, foreground recovery, and the stream callback. |
| No retry while gated | The falling edge only clears the gate/banner. No reload is started by the thermal hook; the existing model chip remains the lazy reload action after cooldown. |
| Localized blocking UI | AppShell renders a full-screen EN/IT overlay using `chat.thermalHardGateTitle` and `chat.thermalHardGateBody` from `src/i18n/en.ts` and `src/i18n/it.ts`. |
| Fail open | Missing/unsupported native module, malformed snapshots, and thrown native calls all map to `false`. No CRITICAL value is inferred from Celsius, charging, or an unknown API. |

## Verification

- `npm run typecheck` — passed (`tsc --noEmit`).
- `npx jest --runInBand src/engine/thermalHardGate.test.ts src/engine/platformThermalStatus.test.ts` — passed, 2 suites / 15 tests.
- `npx expo-modules-autolinking resolve --platform android` — resolved `expo.modules.kalsathermal.KalsaThermalModule`.
- `npx expo-modules-autolinking resolve --platform ios` — resolved pod `KalsaThermal` and module class `KalsaThermalModule`.
