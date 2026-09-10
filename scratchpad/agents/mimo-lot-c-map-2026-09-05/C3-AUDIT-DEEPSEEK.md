# C3 — Hostile Audit (DeepSeek)

**Scope:** commit `55008c3` (+ Job A `9c46a34`) on `feat/moe-stream`. Advisory-only thermal bands + `ThermalGovernorHint`.
**Method:** read `src/engine/thermalThresholds.ts`, `thermalThresholds.test.ts`, `src/hooks/useThermalMonitor.ts`, `src/screens/SettingsScreen.tsx`, `src/i18n/{en,it}.ts`, `src/engine/{monitor,deviceTuning}.ts`, repo-wide greps. `tsc --noEmit` exit 0; `jest thermalThresholds.test.ts` 13/13 pass.
**Verdict: NO MUST-FIX.** Advisory-only contract holds; no gate sneaked in. 6 nits, none behavior-breaking.

---

## 1. Hard gate on send/load — CONFIRMED clean

- `useThermalMonitor` has one consumer in the whole repo: `src/screens/SettingsScreen.tsx:963` banner. Grep `thermal` across `src/` matches only the hook, the thresholds module, i18n, and the banner.
- Banner is text-only, no `onPress`: SettingsScreen.tsx:2140-2156.
- `src/engine/deviceTuning.ts:643` still emits `{ maxDecodeSeconds: 60, guardSource: "measured:thermal-4b" }` but grep proves zero readers outside `deviceTuning.ts`/its test — dead output, pre-existing, matches map §2b.
- `src/engine/LlamaService.ts` (3942 lines) has zero thermal references; `AppShell.tsx` zero; telemetry schema zero. No thermal term in any `selectDisabled`/`hardBlocked`/memory-proxy send path.
- Quote: `useThermalMonitor.ts:4` "Advisory ONLY: never hard-blocks send / load / download."

## 2. Magic numbers outside `ZONE0_THERMAL_BANDS` — CONFIRMED (1 nit)

- °C bands are properly named: `thermalThresholds.ts:40-45` `ZONE0_THERMAL_BANDS = { warmC: 45, hotC: 48, criticalC: 52, exitHysteresisC: 2 }`.
- **Nit 1:** the memory-proxy threshold is still a bare literal — `useThermalMonitor.ts:131` `const status: ThermalStatus = availMiB < 512 ? "warm" : "ok";`. The C3 design docs explicitly proposed `memoryProxyWarmMiB` (`C3-APP-THERMAL-MAP.md` §4a). Not moved, not named, not tested.
- `parseThermalZoneTemp` sanity bounds `-20 / 120` (`useThermalMonitor.ts:41`) are inline literals — acceptable, commented, not product thresholds. Not flagged further.
- `DEFAULT_INTERVAL_MS = 30_000` named (hook line 20). ✓

## 3. Hysteresis bugs / off-by-one — PLAUSIBLE (2 nits, no hard bug)

- Pure logic is correct: enter `>=` (classifyByEnter), hold `tempC >= exit`, exit when `< exit`. Tests pin the edges exactly: 46 stays "hot", 45.9 → "warm"; 43 stays "warm", 42.9 → "ok" (test lines 30-43). No off-by-one.
- **Nit 2 (weakest real flaw): cross-source prev contamination.** `useThermalMonitor.ts:97` passes `state.status` as `prev` into `statusFromTempC` with no source check. A `memory_proxy` "warm" (memory pressure, no °C basis) can later *hold* a sysfs reading of 43–44.9 °C as "warm" (`statusFromTempC` exit for warm = 43). Reachable only after sysfs fail→success; impact is one advisory banner at 44 °C. Benign today, wrong design.
- **Nit 3: `useEffect` deps `[intervalMs, state.status]` (line 160).** Every status transition tears down + recreates the interval and fires an immediate extra `sample()`; on the heating side there is no hysteresis, so a phone hovering 44.9↔45.1 °C flaps warm↔ok every poll, each flap resetting the 30 s cadence. Also, an in-flight `sample()` from the old effect can resolve after the new effect sets `mountedRef.current = true` (line 82) → setState from a stale closure. Same-value setState makes this benign, but the pattern is fragile; a `prevStatusRef` + functional update with deps `[intervalMs]` is the correct shape.
- Noise, not bug: memory_proxy path (line 131) has zero hysteresis — 500↔520 MiB oscillation flaps status. Documented "preserved" behavior; still a flap source.

## 4. `preferGpuPath` wrong for ok/unknown — REFUTED, with a semantic caution

- `thermalThresholds.ts:117` `preferGpuPath: status === "warm" || status === "hot" || status === "critical"` → false for ok and unknown. Correct per the research doc's hint table (`C3-THERMAL-THRESHOLDS-RESEARCH.md`, "Advisory bands → Governor hints": warm/hot/critical all → prefer the cool path / GPU_COOLMODE).
- **Nit 4:** the flag name will mislead a future bridge — the *governor* itself routes CRITICAL → CPU and LOWBAT → CPU (`C3-GOVERNOR-THERMO-MAP.md`, `select_decode(): Unknown/Invalid/CRITICAL → wait`), so "preferGpuPath: true" for `critical` contradicts the governor's own critical policy. Advisory-only today (zero readers), so it's a doc/labeling problem, not a bug. Worth a comment in-file before the bridge lands.

## 5. Settings still using old thermalHot for all — REFUTED

- Banner is per-status: SettingsScreen.tsx:2148-2152 maps `critical → chat.thermalCritical`, `hot → chat.thermalHot`, else `chat.thermalWarm`. Old single-key behavior gone; repo-wide grep shows no other consumer. Only straggler is documentation: `docs/ANTI_OOM_AND_EDITREGEN.md:211` still shows the old one-key table (**Nit 5**, doc drift).
- Job A (`9c46a34`) fixed the Italian copy; `it.ts:507-508` now distinct: warm "Telefono tiepido — l'inferenza può essere più lenta", hot "Telefono caldo — meglio una pausa". `thermalCritical` present in both locales.

## 6. memory_proxy invents fake °C — REFUTED

- `useThermalMonitor.ts:134-137`: proxy path sets `currentTempC: null`, hint `tempC: null`; banner shows no °C suffix when null (SettingsScreen.tsx:2154). `monitor.ts:57-58` confirms non-Android → `getAvailableMemoryBytesUncached` returns null → status "unknown", not a fabricated number. `bytes == null` (line 125) also → "unknown". No invented °C anywhere.

## 7. Test hygiene — CONFIRMED OK (13/13, pure module), 1 gap

- Tests are pure (no hook, no RN mocks, no sleeps), pin exact boundary values, 13 pass, `ZONE0_THERMAL_BANDS` snapshot test matches declared constants. No leftover 42/50 warm/hot expectations.
- **Nit 6:** no coverage at all for the memory-proxy branch (`512 MiB`, null → unknown), the cross-source hold (Nit 2), or the hook's interval/prev plumbing — i.e., everything that can drift *is* in the untested hook.
- Style: `\ No newline at end of file` in `thermalThresholds.ts` and `useThermalMonitor.ts`; `statusFromTempC` invoked twice per sysfs sample (line 98 and 104) with identical args — duplication, harmless.

---

## Summary

| Angle | Verdict |
|---|---|
| 1. Hard gate on send/load | CONFIRMED clean |
| 2. Magic numbers outside bands | CONFIRMED — 512 MiB still literal (Nit 1) |
| 3. Hysteresis / off-by-one | PLAUSIBLE — no hard bug; cross-source hold (Nit 2), effect deps flap+stale closure (Nit 3) |
| 4. preferGpuPath ok/unknown | REFUTED — but `critical→true` mislabels vs governor policy (Nit 4) |
| 5. Settings old thermalHot | REFUTED — per-status keys wired; doc drift only (Nit 5) |
| 6. memory_proxy fake °C | REFUTED — always null on proxy/none |
| 7. Test hygiene | OK — 13 pure tests; proxy/hook paths untested (Nit 6) |

**Must-fix:** none. **Nits worth doing before the governor bridge:** Nit 3 (effect deps → ref-based prev), Nit 1 (name `memoryProxyWarmMiB`), Nit 4 (clarify `preferGpuPath` critical semantics in a comment). All three are small; none blocks shipment.