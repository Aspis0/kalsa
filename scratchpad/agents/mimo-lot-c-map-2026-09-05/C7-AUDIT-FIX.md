# C7 — Battery ETA · Audit Fix Pass

**Target:** commit `68e2d76` · **Repo:** `/Users/marco/Projects/kalsa`
**Basis:** hostile audit `C7-AUDIT-DEEPSEEK.md` (findings F1–F13).
**Scope:** `src/engine/batteryEta.ts`, `src/engine/batteryEta.test.ts`, `src/hooks/useBatteryEta.ts`, `src/app/AppShell.tsx`, `src/i18n/en.ts`, `src/i18n/it.ts`.

## Test / typecheck (real)
- `jest src/engine/batteryEta.test.ts` → **EXIT 0, 15 passed / 15** (was 13; +F2 observed-rate test, +F7 deadband test).
- `tsc --noEmit` → **0 errors**.

## Fixes shipped

### F1 — charging state reachable (hook)
When `charging === true`, the hook now `setState`s `{ kind: "charging", batteryPercent, charging: true, … }` **explicitly** and `return`s — it never feeds the emptied window to `estimateBatteryEtaHours` (which read `unknown`). AppShell additionally prefers `batteryEta.charging === true` → charging copy, so a plugged-in device never shows the "keep generating for ~10 min" unknown copy.

### F3 — stale-tick race (hook)
Added a per-arm `epochRef`. Each (re)arm bumps it; `tick` checks `epoch !== epochRef.current || !mountedRef.current` **after** `await readBattery()` and bails if the arm was superseded (model switch / enabled flip) or the effect unmounted. The AppState background clear is guarded on the same epoch.

### F2 — observed rate for ETA (engine)
`etaRate` was `netDrop·3600000/minSpanMs` (min-window normalized → ETA shrank as the window filled). Now `etaHours = headroom / actualRate` where `actualRate = netDrop·3600000/spanMs` (observed). `ratePctPerHour` is now genuinely the observed rate. Added a test at span > minSpan asserting the ETA uses the observed rate.

### F4 — burst cap + real maxHours coverage (engine)
Added `maxRatePctPerHour` (default 60 %/h): drains steeper than this are rejected as implausible bursts → `unknown`. The "steep drain" test (previously passing via the headroom gate) is now a true burst test (90→50 in 12 min = 200 %/h → unknown). The "maxHours" test now actually hits the maxHours branch (passes min-rate, eta 8.3h > maxHours 4 → unknown).

### F5 — sub-hour / band copy (AppShell)
New `formatEtaBand`: collapses duplicated/sub-hour copy — both ends format the same → show once ("~less than 1 hour"); sub-hour low with a whole/half high band → surface the upper bound ("~1 h", "~2 h 30 min") instead of "less than 1 h–1 h".

### F6 — iOS `inactive` vs `background` (hook)
AppState handler now distinguishes states: `background` → stop timer + clear window + `unknown` (epoch-guarded); `inactive` (notification shade / CC / app switcher) → pause timer **but keep the sample window** (no cold 10-min wipe); `active` → resume.

### F7 — charging deadband (engine)
`netDrop < 0` → `netDrop < -1` (≥ 2 pp rise required for the charging verdict). Integer-quantized levels bounce ±1 pp, so a 1 pp rise now falls through to `unknown` instead of flipping to "charging".

### F9 — dead conditional (hook)
Background branch no longer writes `kind: length > 0 ? "measuring" : "unknown"` (window just cleared → always unknown). Now writes `kind: "unknown"`.

### F10 — nits (hook)
Renamed `DEFAULT_BATTERY_eta_ui_state` → `DEFAULT_BATTERY_UI_STATE` (typo-prone constant); dropped the dead `lowPowerMode?: boolean` from `NativePowerState`.

### F11 — Italian copy (i18n)
Native pass: *Measurazione / estimazione* → *Stima*; *estimazione suspendeda* → *sospesa*; *Estimazione della batteria sconosciuta* → *Stima della batteria sconosciuta*.

### F13 — copy honesty (i18n)
"~10 min" wording aligned with the integer 1 pp / 10 min continuous-drain gate ("…of continuous generating / continuous drain").

## Skipped (deliberately)
- **F8 (Android battery-protection):** plausible device-specific UNPLUGGED coercion; no cheap client-side fix. Left as a known limitation — fail-open bounds the harm (0 pp drop → unknown).
- **F10 `sampledAt`:** harmless (never consumed by AppShell); left as-is.

## Dirty tree
Left untouched: `device-decode-lineup-out/`, `docs/AUDIT_*`, `out/`, `results/`, `n3.txt`.