# C3 — Implementation Report

**Date:** 2026-09-05  
**Branch:** `feat/moe-stream` · commit `55008c3` → pushed `origin HEAD` (`659a644..55008c3`)  
**Scope:** Advisory-only summer-aware thermal bands + `ThermalGovernorHint` type. No hard gate on send/load/download.

---

## What changed (named paths only)

| File | Change |
|---|---|
| `src/engine/thermalThresholds.ts` *(new)* | Pure module: `ThermalStatus`, `ThermalBandThresholds`, `ZONE0_THERMAL_BANDS`, `statusFromTempC(temp, prev?)` with hysteresis, `ThermalGovernorHint`, `toGovernorHint(...)`, `ThermalMonitorState`. |
| `src/engine/thermalThresholds.test.ts` *(new)* | 13 pure tests: enter thresholds, hysteresis exit, `preferGpuPath`. |
| `src/hooks/useThermalMonitor.ts` | Refactored to the module + constants; `critical` status added; hysteresis via prior state; returns `hint`; iOS `ProcessInfo.thermalState` noted as a cheap TODO. |
| `src/i18n/en.ts` | Split `chat.thermalHot` → `thermalWarm` / `thermalHot` / `thermalCritical`. |
| `src/i18n/it.ts` | Italian copy for the three split states. |
| `src/screens/SettingsScreen.tsx` | Banner now picks the correct key per status (warm/hot/critical) + `°C`. |

---

## Parent decisions honored

1. **Advisory only** — no send/load/download gate anywhere. `SettingsScreen` banner is text-only.
2. **`thermal_zone0` treated as unknown/internal** — bands raised to 45 / 48 / 52 °C (not the governor's 38 / 39.5 / 42 battery tenths), so summer/direct-sun devices are not spammed.
3. **Named constants** — `ZONE0_THERMAL_BANDS = { warmC: 45, hotC: 48, criticalC: 52, exitHysteresisC: 2 }`. Documented in-file that the governor (later bridge) uses battery tenths °C (WARM ≥ 38, COOLMODE ≥ 39.5, CRITICAL ≥ 42) and may prefer `GPU_COOLMODE` — the app does not implement that switch.
4. **`critical` status** added alongside ok/warm/hot/unknown.
5. **Split i18n** — distinct warm / hot / critical copy in `en` + `it`; banner shows the right one + `°C`.
6. **`ThermalGovernorHint = { status, tempC, source, preferGpuPath }`** — `preferGpuPath` true for warm|hot only (critical yields to the governor); pure data, no native call.
7. **`useThermalMonitor` refactored** to the constants/helpers; memory_proxy behavior preserved (free RAM < 512 MiB → advisory `warm`, no invented °C).
8. **Out-of-scope untouched** — no `governor*`, `LlamaService` governor sections, `patches/`, `plugins/`, native, or `kalsallama` worktree.
9. **Targeted tests** — pure `statusFromTempC` / hysteresis / `preferGpuPath` only (13 tests, no full suite).

---

## Hysteresis model (zone0/unknown bands)

| Band | Enter | Exit (enter − 2 °C) |
|---|---:|---:|
| warm | ≥ 45 | hold until < 43 |
| hot | ≥ 48 | hold until < 46 |
| critical | ≥ 52 | hold until < 50 |

`statusFromTempC(temp, prev)` classifies by enter thresholds, then — when cooling from a hotter band — holds the prior band until the exit threshold is crossed. `unknown` carries no band and never holds state.

---

## Verification

- `npx tsc --noEmit` → **0 errors**.
- `npx jest src/engine/thermalThresholds.test.ts` → **13 passed, 0 failed**.
- Old `chat.thermalHot` key fully removed; no dangling references (grep clean).
- `git add` used named paths only; commit `55008c3`; `git push origin HEAD` → **exit 0**.

---

## C3 nit fixes (this commit `cc22682`)

| Nit | Fix |
|---|---|
| 1 — 512 MiB literal | Added named `MEMORY_PROXY_WARM_BELOW_MIB = 512` in `thermalThresholds.ts`; hook imports it. |
| 2 — cross-source hold | `statusFromTempC(temp, { prevStatus, prevSource, source, bands? })`; a sample whose `source` differs from `prevSource` is classified fresh (no band hold). |
| 3 — effect deps flap | Prev status/source kept in refs (updated per sample); effect deps reduced to `[intervalMs]` only. |
| 4 — `preferGpuPath` | True only for warm|hot; `critical` → false (governor CRITICAL routes to CPU, not GPU_COOLMODE). |

`tsc --noEmit` 0; `src/engine/thermalThresholds.test.ts` 16/16 (was 13; added source-aware hysteresis + constant). Old positional `prev` test args migrated to the options object.

## Out-of-scope (intentionally not done)

- iOS `ProcessInfo.thermalState` wiring (TODO comment added in hook).
- `set_thermo_profile` → native bridge.
- `deviceTuning.maxDecodeSeconds` enforcement.
- Any hard send/load/download gate.