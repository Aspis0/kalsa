# C7 — Battery ETA · Hostile Audit

**Target:** commit `68e2d76` on `feat/moe-stream` · **Repo:** `/Users/marco/Projects/kalsa`
**Scope:** `src/engine/batteryEta.ts`, `src/engine/batteryEta.test.ts`, `src/hooks/useBatteryEta.ts`, `src/app/AppShell.tsx` (battery wiring), `src/i18n/en.ts` + `it.ts` (`chat.battery*`)
**Method:** read-only code inspection, diff of `68e2d76`, cross-check against expo-battery docs and real-world device reports. No source edited.

---

## Verdict

**No Critical or High findings. No secrets. No privacy leak in C7 scope. Chat is never blocked. Ship is acceptable after fixing the ordered list — but one feature-level bug (F1) means the headline "Battery charging — ETA paused" state is effectively dead in production wiring, and the ETA math (F2) is systematically short as the window fills.** Nine confirmed bugs, one plausible device-specific edge, zero refuted engineering claims of consequence (the two I suspected and checked — hook-order violation, expo enum — are clean).

---

## MVP requirements checklist

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Slope from level samples, not CURRENT_NOW | ✅ | `batteryEta.ts:96-99` — `netDrop = first.percent - last.percent`; `batteryState` used only as discharge/charge polarity (`useBatteryEta.ts:194-202`) |
| 2 | Fail-open: unknown/measuring/charging never block chat | ✅ | `AppShell.tsx:2562-2586` renders text only; no send/load gate references `batteryEta` anywhere else |
| 3 | Shown only ≤50% and model ready | ✅ | `AppShell.tsx:2566-2568` — `pct > 50 || modelState !== "ready"` → null |
| 4 | ≥3 samples / ~10 min / ≥1% drop gate | ✅ (integer-quantized) | `BATTERY_ETA_DEFAULTS` (`batteryEta.ts:41-47`); 1pp min with `Math.round` percent (`useBatteryEta.ts:67`) |
| 5 | EN + IT i18n | ✅ (quality issues, F11/F13) | 6 keys each, same shape (`en.ts:515-520`, `it.ts:514-519`) |
| 6 | Advisory only, no hard stop | ✅ | confirmed grep-wide |
| 7 | Cleanup on unmount/background | ⚠️ | listeners/intervals cleaned (`useBatteryEta.ts:247-253`) but races F3 + over-aggressive window wipe on `inactive` (F6) |

---

## Findings

### F1 — CONFIRMED · Med · "Charging" state is unreachable in production; users see "keep generating" while plugged in

The hook clears the window on every charging tick, then feeds the *empty* window to the estimator. `estimateBatteryEtaHours([])` returns `{ kind: "unknown" }` — never `"charging"`.

`src/hooks/useBatteryEta.ts:194-208`
```ts
if (charging === true) {
  // On power → drain slope is invalid; drop the window.
  samplesRef.current = [];
} ...
if (mountedRef.current) {
  setState({
    ...estimateBatteryEtaHours(samplesRef.current),
```

The engine's `charging` branch (`batteryEta.ts:98-101`, `netDrop < 0 → { kind: "charging" }`) can only trigger from a **non-cleared** window whose net slope is negative-rising — i.e. a phantom +1pp bounce *while discharging* (see F7), not a genuine plug-in. Net effect: on a real charger, the UI renders `chat.batteryUnknown` — **"Battery ETA unknown — keep generating for ~10 min to measure"** (`en.ts:518`) — at the exact moment the user is charging and the 10-minute instruction is impossible. `chat.batteryCharging` ("Battery charging — ETA paused") is dead copy on native. The `charging: boolean` field is present in `BatteryEtaUiState` but `AppShell` never branches on it (`AppShell.tsx:2562-2586` branches only on `kind`).

### F2 — CONFIRMED · Med · ETA projection denominator is `minSpanMs`, not `spanMs` — rate is not the observed rate, ETA is systematically short

`src/engine/batteryEta.ts:106-119`
```ts
const minRate = (G.minDropPct * MS_PER_HOUR) / G.minSpanMs;
const actualRate = (netDrop * MS_PER_HOUR) / spanMs;   // observed — used ONLY for the gate
if (actualRate < minRate) return { kind: "unknown" };
...
const etaRate = (netDrop * MS_PER_HOUR) / G.minSpanMs;  // projection — NOT observed
const etaHours = etaRate <= 0 ? Infinity : headroom / etaRate;
```

For any window longer than 10 min, `etaRate > actualRate` by factor `spanMs/minSpanMs`, so the ETA shrinks as the window fills. Worst case on the default 60 s poll: 12-sample ring → 11 min span → ETA **10 % short at steady state, monotonically worse the longer the window** (ring at 10 min: 0 %; at 11 min: 10 %). The bias is unbounded if a caller changes `intervalMs` (e.g. 120 s → 22 min max span → up to 2.2× too short). The comment at `batteryEta.ts:117-118` claims this "still yields a stable hourly rate" — it yields the opposite: a rate that grows with window length.

Two aggravations:
- `ratePctPerHour` is documented as "**Observed drain rate**, %/hour" (`batteryEta.ts:29`) but is the minSpan-normalized value — mislabeled API.
- Because the band is `[floor(η·2)/2, +0.5]` (`batteryEta.ts:126-130`), a 10 % short estimate can push the true ETA **above the displayed high bound** (e.g. true 3.03 h → band [2.5, 3.0]).
- **Untested entirely**: every test uses exactly 10 min spans; no test exercises span > minSpan.

### F3 — CONFIRMED (by inspection) · Med · Stale in-flight tick survives re-arm and poisons the reset window

`tick` awaits `readBattery()` (`useBatteryEta.ts:192-193`). When `armKey` changes (model switch, `enabled` flip), cleanup clears the timer but cannot cancel an in-flight tick. The new effect runs `samplesRef.current = []` (`useBatteryEta.ts:174`) and sets `mountedRef.current = true` again — so the stale continuation passes the `mountedRef` guard (`useBatteryEta.ts:204-205`) and:
1. pushes a stale read into the **new** arm's window (`useBatteryEta.ts:197-202`), stamped `Date.now()` at completion — a mismatched (time, level) pair from the previous model/era; and
2. calls `setState` with the stale estimate (`useBatteryEta.ts:206-212`).

The slope now spans two models' usage or two enabled/disabled eras; self-heals only after the ring evicts (~11 min). Same mechanism applies to the AppState race (F6): a tick in flight across a background→clear transition pushes into the emptied window. Fix: an epoch/alive token per arm checked after the await.

### F4 — CONFIRMED · Med · `maxHours` is never exercised by its test; there is no steepness cap despite a test claiming one

**Test lie 1 — `maxHours`.** `src/engine/batteryEta.test.ts:113-121` ("returns unknown when the ETA exceeds maxHours", 90→89.8 over 10 min): `netDrop = 0.2` → `actualRate = 1.2 %/h` < `minRate = 6 %/h`, so the test passes via the **min-rate gate** (`batteryEta.ts:108`), *before* `maxHours` is ever consulted. The `maxHours` branch (`batteryEta.ts:123-124`) has zero effective coverage; the test would pass even with `maxHours` deleted.

**Test lie 2 — "implausibly steep drain".** `batteryEta.test.ts:103-109` (40→2 in 10 min, 228 %/h): rejected at the `headroom <= 0` gate (`batteryEta.ts:112-114`) because the last level is 2 % < reserve 5. There is **no steepness gate in the engine at all**: the same slope from a higher absolute level sails through — e.g. 90→52 in 10 min → `etaHours = 47/228 ≈ 0.2` → `{ kind: "eta", lowHours: 0, highHours: 0.5 }`, rendering "~less than 1 hour–less than 1 hour left at this pace" (`AppShell.tsx:2579-2582`) from a 10-minute burst (video encode spike, thermal throttle recovery). A panic-ETA from transient load with no plausibility bound. The test name asserts the protection; the code doesn't have it.

### F5 — CONFIRMED · Low-Med · Sub-hour ETA renders duplicated garbage copy

`AppShell.tsx:2580` — `~${formatEtaHours(batteryEta.lowHours)}–${formatEtaHours(batteryEta.highHours)}`. With `etaHours = 0.25` (the test's own healthy sub-hour case, `batteryEta.test.ts:146-153`): `lowHours = 0`, `highHours = 0.5`, and `formatEtaHours` returns `"less than 1 hour"` for both (`AppShell.tsx:2552`) → **"~less than 1 hour–less than 1 hour left at this pace"**. Mixed-unit bands also occur (0.75 h → "~less than 1 hour–1 h"). Half-hour banding is engine-side; the formatter has no band-aware singularization.

### F6 — CONFIRMED · Med-Low · iOS `inactive` (notification shade / Control Center / app switcher) wipes the window and stops polling

`src/hooks/useBatteryEta.ts:227-244`
```ts
const appStateSub = AppState.addEventListener("change", (appState) => {
  if (appState === "active") { if (timer == null) start(); }
  else {
    if (timer != null) { clearInterval(timer); timer = null; }
    samplesRef.current = [];
    ...
```

AppState has three states on iOS — `active`, `inactive`, `background` — and `inactive` fires on every transient overlay (pull the notification shade, Control Center, app switcher). Every one of those stops the timer **and** clears the window → on return the user is back to a cold 10-minute re-measure. For an advisory that needs ~10 min of uninterrupted drain, this makes the ETA borderline unreachable in normal iOS use. Distinguish `"background"` from `"inactive"` (clear samples only on true background/screen-off, per the comment's own intent "Backgrounded / screen off": `useBatteryEta.ts:232-233`). Also: the listener is registered **after** `start()` (`useBatteryEta.ts:222,227`) — an app that mounts while backgrounded polls once before the first change event.

### F7 — CONFIRMED · Low · Phantom "charging" on +1pp endpoint bounce while discharging; no deadband

`batteryEta.ts:98-101` — `netDrop < 0 → charging` with no hysteresis. Percent is integer-quantized (`Math.round(n * 100)`, `useBatteryEta.ts:67`), and Android/iOS levels bounce ±1 pp between polls. A window whose **last** sample ticks up 1 pp while genuinely discharging (measurement noise, post-load relaxation) flips the UI to "Battery charging — ETA paused" (`en.ts:517`) — the opposite of the truth — then back. Endpoint sensitivity cuts both ways: a +1 pp bounce on the *first* sample inflates `netDrop` and shortens the ETA. A deadband (e.g. `netDrop <= -1` after the drop gate, or require 2 pp for the charging verdict) would fix both.

### F8 — PLAUSIBLE · Low · Android "battery protection" devices: plugged-but-not-charging reports UNPLUGGED → phantom discharge ETA

`useBatteryEta.ts:76-80` treats only `UNPLUGGED` as discharging (correct per expo's 5-state enum — my initial suspicion of an invented `NOT_CHARGING = 4` was **REFUTED**; expo-battery docs list UNKNOWN 0 / UNPLUGGED 1 / CHARGING 2 / FULL 3 / NOT_CHARGING 4). But upstream reports a real-world inversion: with battery-protection enabled (some Android tablets stop at 80 %), the **native** status is NOT_CHARGING while expo-battery returns **UNPLUGGED** (expo/expo#44212). On such devices the hook classifies "plugged into a charger at 80 %" as discharging, accumulates samples, and can emit a drain ETA while the device is on power. Fail-open limits the harm (a 0 pp drop → unknown), but at exactly the 1 pp/10 min threshold it will produce a numeric ETA. No cheap fix client-side; worth a documented caveat + maybe treating `charging === null && apiAvailable` with suspicion after a stuck-at-100 window.

### F9 — CONFIRMED · Low · Dead conditional in the background branch — can never render "measuring"

`useBatteryEta.ts:236-243`
```ts
samplesRef.current = [];
if (mountedRef.current) {
  setState((prev) => ({
    ...prev,
    kind: samplesRef.current.length > 0 ? "measuring" : "unknown",
  }));
}
```
The window was just cleared on the line above → `length` is always 0 → the `"measuring"` arm is unreachable and the `setState` always writes `kind: "unknown"` (clobbering a previously shown "measuring"). Either the clear or the conditional is wrong; as written it's a pointless state write plus dead code.

### F10 — CONFIRMED · Low · `sampledAt` lies; dead `lowPowerMode`; mislabeled constant

- `useBatteryEta.ts:131` — `/** Epoch ms of the last successful read. */` but `sampledAt: Date.now()` (`useBatteryEta.ts:211`) is set on **every** tick including failed reads (`apiAvailable: false`) and charging ticks. Never consumed by AppShell anyway.
- `useBatteryEta.ts:31` — `lowPowerMode?: boolean;` declared; never read anywhere. Dead contract.
- `useBatteryEta.ts:138` — `DEFAULT_BATTERY_eta_ui_state` — mixed-case constant name; the kind of name that gets typo-imported. (It is correctly never mutated — state updates always spread — so no shared-mutation bug.)

### F11 — CONFIRMED · Low · Italian i18n is machine-translated garbage

`it.ts:515-517`: "**Measurazione** dell'uso della batteria" (Italian: *Misurazione*), "l'**estimazione** appare" and "**Estimazione** della batteria sconosciuta" / "estimazione sospesa" (*stima* — *estimazione* is an archaic anglicism, and "Estimazione … sconosciuta" reads like "unknown estimation", not "estimate unknown"). Users get the feature's core states in visibly broken copy. EN copy is fine.

### F12 — CONFIRMED · Low · Test hygiene

- **Unused helper:** `samples(stepMin, dropPct, start)` (`batteryEta.test.ts:8-17`) is never called — dead code in the suite (all tests inline literals). It's also the only thing using nondeterministic `Date.now()`, so the suite is actually fully deterministic — but the helper's presence invites future flaky use.
- **Wrong comment:** `batteryEta.test.ts:43` — "exactly at threshold" for 1 % over 12 min = 5 %/h vs the 6 %/h gate → it is 17 % *below* threshold, not at it. The true boundary (exactly 1 pp over exactly 10 min → `actualRate === minRate` → passes to `eta`) is **untested**; a `<` vs `<=` slip there is invisible.
- **Path-lie tests:** F4's maxHours and steep-drain tests pass via gates other than the ones their names claim.
- **No coverage at all** for: span > minSpan (F2), ring buffer behavior (`ringPush` is untested), engine "charging" with < minSamples (returns `measuring`, ordering at `batteryEta.ts:88-101` — a rising 2-sample window reports "measuring", not "charging"; arguably wrong semantics, at least undocumented), mixed-order input (sort path), `ratePctPerHour` value.
- Assertions like `expect(r.lowHours).toBeGreaterThanOrEqual(2.5); … expect(r.lowHours).toBe(2.5)` (`batteryEta.test.ts:92-96`) are redundant but honest; the impl report's claim of "Test 6 contradiction … impossible" being fixed by `≥` is fine.

### F13 — CONFIRMED · Low · Copy overpromises "~10 min" while the integer-quantized drop gate may never trigger

`en.ts:516/518` promise the estimate after ~10 min. The gate needs an **integer** 1 pp drop in ≥10 min (`batteryEta.ts:106-108` + `Math.round` percent). A real 4–5 %/h drain delivers ~0.7–0.9 pp per 10 min → the UI can sit at "Battery ETA unknown — keep generating for ~10 min to measure" **forever**, and at 6 %/h with an 11-min ring the window flaps between unknown (1 pp over 11 min = 5.45 %/h < 6) and eta (2 pp), per F2/F7. Combined, the honest-ETA promise is the weakest part of the UX contract.

---

## Security / Secrets

**No findings.** Nothing in C7 scope reads secrets, keys, or identifiers; the hook never touches network, storage, or the telemetry worker; `estimateBatteryEtaHours` is pure. `require("expo-battery")` is the only native surface. The `enabled` gate (`AppShell.tsx:2540-2545`) is UI-state only — no adversarial input reaches the estimator except samples the hook itself collected from the OS.

Privacy: battery level/state **never leaves the device** in C7 wiring. One out-of-scope context flag for the record: `src/agent/deviceTools.ts:42-61` (`readDeviceInfo`) already reads `batteryPercent` into an agent tool payload — a *pre-existing* surface, gated behind the "Device tools" user consent (`en.ts:170`), and it must be transmitted only if the user's chat turns on web tools. C7 neither adds to nor worsens this; flagging so it isn't missed.

---

## Memory / lifecycle

- Interval and AppState listener are correctly cleared on unmount (`useBatteryEta.ts:247-253`) → **no leak** under normal flow.
- `tick` cannot reject (`readBattery` catches internally, `useBatteryEta.ts:85-112`) → no unhandled promise rejections.
- `ringPush` copies (max 12 items) — negligible.
- Residual risks are the F3 stale-tick race and F6 `inactive` churn.

---

## Verified clean (refuted suspicions)

- **Hook-order violation** — REFUTED: no early `return (` before the `useBatteryEta` call in AppShell (only effect-cleanup closures at lines 717/826/959/1109); hook call is unconditional at `AppShell.tsx:2540`.
- **`NOT_CHARGING = 4` invented** — REFUTED: expo-battery's `BatteryState` enum has exactly 5 values incl. 4 (docs.expo.dev, v56 and latest).
- **NaN/Infinity handling** — guarded end-to-end (`batteryEta.ts:61-65` non-finite sweep; infinity tail-catch `batteryEta.ts:120,123`).
- **Shared-state mutation of `DEFAULT_BATTERY_eta_ui_state`** — not possible; all updates spread into fresh objects.
- **Interval double-start on repeated "active"** — guarded by `timer == null` (`useBatteryEta.ts:217-221`).

---

## Ship / fix-first (ordered)

1. **F1 — charging state unreachable.** Have the hook pass `charging` into the estimator result or have AppShell branch on `batteryEta.charging` before `kind`. Never render "keep generating for ~10 min" while on power.
2. **F3 — stale-tick race.** Epoch guard (arm-local `alive` token) checked after `await readBattery()` before push/setState; same token for the AppState clear.
3. **F2 — rate math.** Use `spanMs` for `etaRate` (or deliberately document the minSpan normalization, and relabel `ratePctPerHour` to "projected rate" — but the honest fix is `etaRate = actualRate` and a test at span > minSpan).
4. **F6 — iOS `inactive`.** Only stop/clear on `"background"`; keep polling and window across `"inactive"` (or re-arm the timer but keep samples).
5. **F4 — real coverage + a decision.** Add a true maxHours test (valid-rate window, huge headroom) and decide whether a 228 %/h burst rate deserves a cap (it currently produces 0–0.5 h panic ETAs). Delete or rename the lying tests.
6. **F5 — sub-hour copy.** Collapse the band to a single "less than 1 hour" when `highHours < 1` (and "~less than 1 hour–1 h" case).
7. **F7 — deadband.** Hysteresis on `netDrop` (charging only on `netDrop <= -1` or 2 pp) to stop the "charging while discharging" flap.
8. **F9 — dead conditional** — remove the `length > 0` branch (always 0) and decide whether background should preserve "measuring".
9. **F13 — copy honesty** — align "~10 min" messaging with the actual 1 pp/10 min integer gate (e.g. "after ~10 min of continuous drain").
10. **F11 — Italian copy** — *Misurazione*, *stima*; native-speaker pass.
11. **F12 — test hygiene** — delete the unused `samples()` helper, fix the "exactly at threshold" comment, add boundary tests (exactly 6 %/h passes; 1 pp / 11 min is unknown; ring eviction; mixed-order input).
12. **F10 — nits** — fix `sampledAt` semantics or doc, drop `lowPowerMode`, rename the constant.
13. **F8 — acknowledge** — document the Android battery-protection/UNPLUGGED coercion as a known limitation (or treat stuck-at-immutable-level windows as suspect).

**Fixes 1–5 are the difference between the feature doing what its copy says and not; 6–13 are polish. With 1–5 in, ship.**