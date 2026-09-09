# HOSTILE AUDIT — Device-Campaign Harness Build

**Auditee:** `campaigns/`, `scripts/campaign/`, `scripts/responseProfile.mjs`, `package.json` harness scripts
**Spec:** `PART3_CAMPAIGN_KIT.md` rev 5 + 11 must-fixes from `AUDIT_PART3_KIT_REV5.md` §4
**Dry-run artifact:** `results/ciswire-campaign/2026-08-25/R1/dry-1.jsonl` (3 turns, R1, charging=true)
**Date:** 2026-08-25

---

## 0. Summary

**11 CONFIRMED defects. 0 REFUTED parent suspects. The supervisor has structural bugs that would corrupt or abort a real run.**

The harness *exists*, the config is validated, the flags reject the on/1/true trap, the profile axes are real, and the pre-registration is sound. But the supervisor's `--run` mode has two show-stoppers (pipeline subshell loses variant params; nconv=6 per cell not 3+3), scores are never computed, the watchdog can't resume, the APK path is unset, and checkpoints are write-only.

---

## 1. Security / Secrets

| # | Status | Finding | Evidence |
|---|---|---|---|
| S1 | **CONFIRMED** | No credentials or API keys in any harness file, log output, or dry-run jsonl. Telemetry payloads are model-stats only (tokensCached, promptMs, etc). | `dry-1.jsonl` turn 1: telemetry contains `tokensEvaluated:1220, promptMs:2742.126, predictedPerSecond:7.197` — no keys. |
| S2 | **CONFIRMED** | `sql` / `sql_write` use string interpolation with single-quote escaping (`sed "s/'/''/g"`), but all keys are harness-generated constants, not user input. Acceptable for a controlled-harness context. | `flags.sh:72` `esc=$(printf '%s' "$val" | sed "s/'/''/g")`; `flags.sh:73` `sql_write "INSERT OR REPLACE…'$key','$esc'"` |
| S3 | **CONFIRMED** | Debug dumps (`campaign_health`) print only `adb get-state / pidof / thermal_status`. No app-internal data logged to host stdout. | `watchdog.sh:98-101` `campaign_health() { … printf '%s %s %s\n' "$state" "${pid:-none}" "${thermal:-unknown}" }` |

**Verdict: CLEAN.** No secrets leaked.

---

## 2. Privacy

| # | Status | Finding | Evidence |
|---|---|---|---|
| P1 | **CONFIRMED** | Host jsonl contains user+assistant transcript (expected per kit §3). PII is planted by the script (fake persona "Elisabetta Quirino"), not real user data. | `dry-1.jsonl` turn 1: `"user":"Ciao, mi chiamo Elisabetta Quirino…"` — planted fake |
| P2 | **CONFIRMED** | ADB carries: (a) `am start`/`am force-stop` (no PII), (b) `dumpsys battery` (no PII), (c) `pidof` (no PII), (d) `logcat` (contains KALSA_TELEMETRY tokens, memory counts — no text content unless app emits it). No user-text crosses adb. | `turn.sh:10-16` `dumpsys battery`; `watchdog.sh:14` `pidof $PKG`; `logcat.sh:30` filter tags |
| P3 | **PLAUSIBLE** | Logcat filter `*:W` (logcat.sh:30) could capture Android system warnings containing the app's React Native bundle URL or package name — not PII per se, but an information leak surface. | `logcat.sh:30` `_CAMPAIGN_LOGCAT_FILTER="ReactNativeJS:V AndroidRuntime:V libc:V llama:V native:V DEBUG:V *:W"` |

**Verdict: CLEAN.** No real PII crosses any boundary.

---

## 3. Bugs

### B1 — Pipeline subshell loses FLAG_PARAMS (SHOW-STOPPER)

**CONFIRMED.** `mode_run` pipes python3 into `while read`, creating a subshell. `FLAG_PARAMS` set by `campaign_load_variant_params` inside the loop never propagates to the parent shell. Variant A's `winbudget=PHASE0` is never resolved.

```
supervisor.sh:221-222:
' "$cells_file" | while read -r arm_id v; do
    …
    campaign_load_variant_params "$v"   # sets FLAG_PARAMS in SUBSHELL
    …
    campaign_arm_begin                  # calls campaign_write_flags which reads FLAG_PARAMS
```

`campaign_load_variant_params` (`supervisor.sh:183`) writes to a plain variable, not exported. The pipe subshell is ephemeral. When `campaign_write_flags` (`flags.sh:119`) reads `${FLAG_PARAMS-}`, it gets empty string. Variant A conversations run with no winbudget set. If PHASE0 sentinel were active, it would `die "variant A winbudget=PHASE0 but PHASE0_WINBUDGET is unset"`.

### B2 — mode_run runs 6 conv per cell (96 total), not 3+3 (48)

**CONFIRMED.** Spec §2: "6 conversations × 24 turns per arm" = 48 total. Kit §2: "Two variants per arm, split ~half/half" = 3 per variant. But:

```
supervisor.sh:226-231:
    for conv in $(seq 1 "$nconv"); do   # nconv=6 from config
      CAMPAIGN_CONV_ID="c${conv}-${v}"
      campaign_arm_begin
      campaign_run_script_turns "$SCRIPT" "$nturns"
```

`nconv=6` per cell × 16 cells = **96 conversations**, double the spec. The spec requires 3 conversations per arm×variant cell (6 per arm total), not 6 per cell.

### B3 — Hang/timeout dies, doesn't skip/resume

**CONFIRMED.** Kit §4 rev 5.1: "abort that turn, log it, and resume/skip cleanly." But:

```
supervisor.sh:116:
    die "turn $i aborted status=$CAMPAIGN_TURN_STATUS"
```

On any non-ok status (hang, timeout, adb-drop, pid-death), `campaign_one_turn` calls `die`, killing the entire supervisor. There is no `continue` to skip the failed turn and proceed to the next. A single hung turn aborts the conversation and all remaining cells.

### B4 — runScorers never called; scores=null always

**CONFIRMED.** `scoring.mjs` defines `runScorers`, `scoreRecall`, `scoreTool`, `scoreProfile` — but `supervisor.sh` never imports or calls any of them. The only scoring-related call is `responseProfile.mjs` which generates the profile JSON without invoking the scorer plugin API.

```
supervisor.sh:233:
    node "$REPO/scripts/responseProfile.mjs" "$OUT/$CAMPAIGN_ARM_ID/${CAMPAIGN_CONV_ID}.jsonl"
```

`responseProfile.mjs main()` (`responseProfile.mjs:147-152`) calls `profileJsonl` and writes the file. It does NOT call `runScorers`. All jsonl records have `"scores": null`.

### B5 — responseProfile CLI profileJsonl() without lexicon → hedgeCount=0

**CONFIRMED.** The supervisor calls `responseProfile.mjs` with no lexicon option:

```
supervisor.sh:233:
    node "$REPO/scripts/responseProfile.mjs" "$OUT/…/…jsonl"
```

`profileJsonl` (`responseProfile.mjs:107`) defaults to `{ hedge: [], refusal: [], apology: [] }`. Hedge/refusal/apology counts are always 0 in the .profile.json artifact. The lexicon only matters when `runScorers` calls `scoreProfile` (which loads it from config), but `runScorers` is never called (B4).

### B6 — phase0_floors: no σ from data, just hardcoded stub

**CONFIRMED.** `phase0.sh:81` calls `node "$CAMPAIGN_ROOT/prereg.mjs" || true`. `prereg.mjs` (line 70-74, the `if (import.meta.url…)` block) just prints the 15 contrasts — it does NOT read R1 jsonl files. The "provisional" σ values come from `prereg.json:16-22` (`"provisionalSigma": {"echo-rate": 0.082, …}`) — hardcoded, not computed.

```
prereg.json:16-22:
    "provisionalSigma": {
      "echo-rate": 0.082,
      "hedge-rate": 0.082,
      "drift": 0.082,
      "tool-call-rate": 0.082,
      "recall": 0.35
    },
```

Phase 0 cannot set real detection floors. The `|| true` on line 81 means even if prereg.mjs failed, phase0 continues.

### B7 — CAMPAIGN_APK unset → install -r cannot run

**CONFIRMED.** `CAMPAIGN_APK` is never set in any script or config. `campaign_find_apk` (`recovery.sh:86`) checks `${CAMPAIGN_APK:-}` — always empty, always returns 1. `campaign_reinstall_r` (`recovery.sh:93`) logs `"no apk for install -r"` and returns 1. On a crash where the app won't restart, the recovery path hits `campaign_relaunch_or_reinstall` → `campaign_reinstall_r` → fail → app never starts → `campaign_wait_ready` times out → `die`.

```
recovery.sh:86-88:
  if [ -n "${CAMPAIGN_APK:-}" ] && [ -f "$CAMPAIGN_APK" ]; then
    printf '%s\n' "$CAMPAIGN_APK"
    return 0
  fi
  return 1
```

### B8 — checkpoint.json written, never read for resume

**CONFIRMED.** `datastore.mjs` defines both `writeCheckpoint` and `readCheckpoint`. `supervisor.sh:137` calls `--checkpoint` to write. But `readCheckpoint` is never called from any supervisor or turn script. On a crash, the harness cannot resume from the last checkpoint — it would have to re-run from scratch or rely on the jsonl append-only log.

```
supervisor.sh:137:
  node "$CAMPAIGN_ROOT/datastore.mjs" --checkpoint "$OUT" "$CAMPAIGN_ARM_ID" "$CAMPAIGN_VARIANT_ID" "$CAMPAIGN_CONV_ID" "$i"
```

### B9 — Recovery events logged to stdout, never to jsonl

**CONFIRMED.** `campaign_abort_turn` (`watchdog.sh:93-96`) prints `{"event":"RECOVERY","reason":"timeout"}` to stdout and calls `campaign_force_stop`. It does NOT write to the datastore. The jsonl file for that turn will have a partial record (pre-abort) with no recovery annotation. Post-hoc analysis cannot distinguish a successful turn from an aborted one without grepping the supervisor's stdout log.

```
watchdog.sh:93-96:
campaign_abort_turn() {
  local reason="${1:-timeout}"
  log "RECOVERY reason=$reason (force-stop $PKG)"
  campaign_force_stop
  printf '%s\n' "{\"event\":\"RECOVERY\",\"reason\":\"$reason\"}"
}
```

### B10 — campaign_watch_turn is dead code

**CONFIRMED.** `watchdog.sh:24-68` defines `campaign_watch_turn()` with its own polling loop. It is never called from any script. `campaign_wait_turn` in `turn.sh:74-128` is the inline version that the supervisor actually uses. The two implementations diverge (campaign_wait_turn has assistant-count check and thermal check; campaign_watch_turn does not).

```
watchdog.sh:24:
campaign_watch_turn() {
```

`grep -rn 'campaign_watch_turn' scripts/campaign/` → only hits the definition, zero call sites.

### B11 — Telemetry guard error not caught by supervisor

**CONFIRMED.** `collector.mjs` throws on guard failure and exits with code 2. `campaign_collect_file` (`turn.sh:190-206`) calls `node … collector.mjs` without checking the exit code. The supervisor does not trap this. A guard failure (wrong ciswireFlags) would print an error to stderr but the script would continue, potentially writing a bad record to the jsonl.

```
collector.mjs:103-106:
  if (tel) assertCompactionBit(tel, declaredBit);
  else if (declaredBit === 1) {
    throw new Error("TELEMETRY GUARD FAIL: no KALSA_TELEMETRY on ciswire arm (bit0 expected 1)");
  }
```

```
turn.sh:194-204:
  node "$CAMPAIGN_ROOT/collector.mjs" \
    --logcat "$slice" \
    …
    ${CAMPAIGN_RETRIED:+--retried}
  # ← no exit-code check
```

---

## 4. Race Conditions

### R1 — logcat offset vs concurrent write

**PLAUSIBLE.** `campaign_logcat_offset` (`logcat.sh:52`) reads `wc -c` of the logcat file. `campaign_logcat_slice` (`logcat.sh:57`) does `tail -c +$((offset+1))`. Between reading the offset and slicing, the logcat background process may have appended more bytes. The slice may miss the last few lines of a turn's telemetry. Mitigated by `campaign_logcat_ensure` restarting dead logcat processes, but the offset/slice gap is inherent.

### R2 — sql_write vs running app

**CONFIRMED FIXED.** `campaign_write_flags` (`flags.sh:90`) calls `campaign_force_stop` before any `sql_write`. `campaign_arm_begin` calls `campaign_write_flags` first. The app is stopped before flags are written. No race.

### R3 — Trap replacement

**PLAUSIBLE.** `supervisor.sh:38` sets a trap for EXIT. The sourced scripts also use `set -uo pipefail`. No trap overwrites are visible, but if any sourced script or subshell sets its own EXIT trap, it would replace the supervisor's. Currently no evidence of this.

### R4 — Pipeline subshell swallowing exit (B1 variant)

**CONFIRMED.** `mode_run`'s `python3 | while read` subshell: if `die()` is called inside the while loop, it exits the subshell (exit 1). With `set -o pipefail`, the parent sees the non-zero pipeline exit. With `set -e` NOT active in the parent (only `-uo pipefail`), the parent does NOT die — it continues past the `done` to the next `case` arm. Actually, re-reading: `set -euo pipefail` IS set at `supervisor.sh:8`. So the pipeline failure WOULD trigger `set -e` in the parent. However, `die()` inside the subshell only kills the subshell — the parent dies from pipefail, not from the intended die message reaching the top level. The error path is correct (script dies) but the reason is pipefail, not the die message.

---

## 5. Memory Leaks / Unbounded Growth

### M1 — Logcat file unbounded

**PLAUSIBLE.** `campaign_logcat_start` (`logcat.sh:33`) appends to a single file. On a 45-110h run, the logcat file grows without bound. No rotation or truncation. A 24-turn conversation with verbose logcat can produce 10-50 MB; 96 conversations could be 1-5 GB. Host disk space is the only limit.

### M2 — jsonl append-only, never trimmed

**CONFIRMED by design.** The spec says "save everything." jsonl files grow monotonically. At ~2 KB per turn × 24 turns × 96 conversations ≈ 4.6 MB total — acceptable.

### M3 — checkpoint.json overwrites, not appending

**CONFIRMED benign.** `writeCheckpoint` (`datastore.mjs:59`) overwrites the file each time. No unbounded growth.

---

## 6. Edge Cases

### E1 — Hang vs pid-death: abort then die; no resume

**CONFIRMED (same as B3).** `campaign_one_turn` (`supervisor.sh:101-116`): on hang/timeout/adb-drop/pid-death, `campaign_abort_turn` runs, then `die`. No turn skip, no conversation resume. The spec requires "abort that turn, log it, and resume/skip cleanly."

### E2 — ADB drop → reconnect path exists but not integrated into turn loop

**PLAUSIBLE.** `campaign_ensure_device` (`recovery.sh:30-58`) handles offline/unauthorized/mDNS, calls `campaign_logcat_on_reconnect`. But `campaign_one_turn` calls `die` on adb-drop (line 115), so the reconnect path is only exercised if the turn is retried — which never happens (B3).

### E3 — Charging stamp

**CONFIRMED WORKING.** Dry-run jsonl: `"charging":true,"timingValid":false` on all 3 turns. `stampTimingInvalid` (`telemetryParse.mjs:42-49`) sets `timingValid: false` and stamps individual keys. Verified:

```
dry-1.jsonl turn 1: "timingValid":false, "promptMsValid":false, "predictedPerSecondValid":false
```

### E4 — Omitted ciswireFlags → 0

**CONFIRMED.** `applySchema` (`telemetryParse.mjs:31-36`) fills absent `ciswireFlags` with 0. Config declares `absentZero: ["ciswireFlags"]` for all 4 prefixes. Dry-run jsonl: `"ciswireFlags":0` on all KALSA_TELEMETRY lines.

### E5 — PHASE0 sentinel unset

**CONFIRMED.** In `mode_run`, `FLAG_PARAMS` is empty in the parent shell (B1). If variant A has `kalsa.bench.winbudget=PHASE0`, `campaign_write_flags` (`flags.sh:122-125`) would `die "variant A winbudget=PHASE0 but PHASE0_WINBUDGET is unset"`. The sentinel is never resolved because `PHASE0_WINBUDGET` is never exported.

### E6 — Missing APK for install -r

**CONFIRMED (same as B7).** `CAMPAIGN_APK` is never set. Recovery after a crash that prevents app restart will fail silently at `campaign_reinstall_r`.

---

## 7. Test Hygiene

### T1 — Selftest cannot fail for wrong reasons

**CONFIRMED.** The selftest (`selftest.mjs`) checks:
- Config validation (8 arms, compaction literals, reject on/1/true) — exercises `validateCampaign`
- Telemetry parsing (absentZero, ciswireFlagsOf, stampTimingInvalid, isChargingFromDump)
- Profile extraction (hedge, echo, drift, numeric) — exercises `extractProfile`
- Guard assertion (bit0 mismatch throws)
- Pre-registration (15 contrasts, Holm α)
- Script structure (24 turns, intent coverage, overlap, drift langs)
- Run-order shuffle (monotone guard)
- Bash syntax check (`bash -n`) for all .sh files
- flags.sh --selftest (unit tests validation functions)

All checks have meaningful assertions. No trivially-passing "if true then ok" patterns. The guard test specifically asserts the negative case (bit0=0 on ciswire arm → throws).

### T2 — Selftest env mutation

**CONFIRMED CLEAN.** `selftest.mjs` does not mutate `process.env`, does not `process.chdir`, does not write files. The `bash` subprocess for `flags.sh --selftest` is isolated. No env mutation leaking to subsequent test steps.

---

## 8. Dead Code

| Item | File:Line | Description |
|---|---|---|
| `campaign_watch_turn` | `watchdog.sh:24-68` | Complete polling function never called from any script. `campaign_wait_turn` (turn.sh:74) is the live version. |
| `CAMPAIGN_RETRIED` | `turn.sh:204` | `${CAMPAIGN_RETRIED:+--retried}` — variable is never set anywhere in the supervisor. The `--retried` flag is never passed to collector.mjs. |
| `readCheckpoint` | `datastore.mjs:64-68` | Exported function never imported or called by any script. |

---

## 9. Must-Fix Compliance (11 items from AUDIT_PART3_KIT_REV5.md §4)

### 1. compaction-on = literal ciswire; reject on/1/true; telemetry guard bit0

**LANDING: YES.** Config uses `"ciswire"` for all 4 compaction arms (`ciswire.json:14,23,41,50`). `validateCampaign` (`config.mjs:39-44`) rejects on/1/true/anchored for R2/R5/R6/R8. `campaign_validate_compaction` (`flags.sh:34-38`) rejects at write time. `assertCompactionBit` (`telemetryParse.mjs:61-70`) fires on mismatch. Selftest exercises all rejection paths. **BUT** guard error is not caught by supervisor (B11).

### 2. 24-turn Italian script with plants, early+late recall, web, ≥3 calendar (2 overlap), ≥2 drift

**LANDING: YES.** `script.json` has 24 turns. 6 plant-fact turns (i=1-6). Recall probes: early (i=9), mid (i=15), late (i=21). Web-request: i=13. Calendar-request: i=11, i=14, i=18 (≥3). Overlap: i=11 overlaps "non guidare mercoledì", i=14 overlaps "Urbino" (≥2). Drift: i=16 (EN), i=20 (FR). Selftest verifies all.

### 3. Phase 0 implemented (reset, R1 6, R2 winbudget, web+calendar, crash/restore, σ floors) — is σ actually computed from R1 jsonl or a stub?

**LANDING: PARTIAL.** Reset ✓, R1 6-turn ✓, R2 mini-conv ✓, web+calendar smoke ✓, crash/restore drill ✓. **σ floors: STUB.** `phase0_floors` calls `prereg.mjs` which reads hardcoded `provisionalSigma` from `prereg.json`. No code exists to compute σ from R1 jsonl data. The `|| true` on `phase0.sh:81` means even a failure is swallowed.

### 4. 15 primary contrasts pre-registered, Holm family, conversation unit, retried flagged

**LANDING: YES.** `prereg.json`: 3 factors × 5 axes = 15 contrasts. `analysisUnit: "conversation"`. `excludeRetriedFromPrimary: true`. `holmFirstAlpha: 0.0033` (= 0.05/15). Selftest verifies contrast count and Holm α.

### 5. Per-turn watchdog hang (not just pidof) + timeout, abort cleanly (skip/resume, not only die)

**LANDING: PARTIAL.** Watchdog detects hang (telemetry gap) ✓ and timeout (wall clock) ✓. **BUT: abort then die, no skip/resume.** `campaign_one_turn` (`supervisor.sh:116`) calls `die` after abort. The spec requires "abort that turn, log it, and resume/skip cleanly — never let a stalled generation block a 2-4 h conversation invisibly." Currently a single hang blocks everything.

### 6. logcat multi-tag + dump -d on reconnect + clear-at-arm

**LANDING: YES.** Tags: `ReactNativeJS:V AndroidRuntime:V libc:V llama:V native:V DEBUG:V *:W` (`logcat.sh:30`). `logcat -d` dump on reconnect: `campaign_logcat_on_reconnect` (`logcat.sh:41-47`). Clear at arm start: `campaign_logcat_clear_arm` (`logcat.sh:34-39`). Selftest does not exercise logcat (requires device), but `bash -n` syntax check passes.

### 7. Run-order random, never monotone R1→R8. Does --run do 3+3 conv per arm (6 total) or 6 per variant (96 conv)?

**LANDING: PARTIAL.** Random order ✓, monotone guard ✓ (`runOrder.mjs:49-56`, reshuffle up to 32 times). **BUT: 6 per cell = 96, not 3+3 = 48.** The config has `"conversations": 6`, and `mode_run` loops `seq 1 $nconv` per cell. Must be 3 per cell for 8×2×3=48.

### 8. timingValid=false on charge in datastore (verify dry-run jsonl)

**LANDING: YES.** Verified in `dry-1.jsonl`: all 3 turns have `"charging":true,"timingValid":false`. Per-telemetry timing keys also stamped: `"promptMsValid":false,"predictedPerSecondValid":false`.

### 9. New conversation primitive; force-stop BEFORE sql_write

**LANDING: YES.** `campaign_new_conversation` (`conversation.sh:56-61`) exists as a reusable primitive. `campaign_write_flags` (`flags.sh:90`) calls `campaign_force_stop` before any `sql_write`. `campaign_arm_begin` calls `campaign_write_flags` first, then `campaign_wipe_chat` (which runs while app is stopped).

### 10. Gate metrics per tool×memory-on; evictionTurn covariate; variants described as cadence not 'no eviction'

**LANDING: PARTIAL.** `prereg.json:14` `gateMetrics: "per tool × memory-on subset; calendarGate is inert when facts.length===0"` ✓. `evictionHint` in collector (`collector.mjs:113-124`) extracts `corpusSize/selectedCount/durationMs` from KALSA_DIGEST ✓. Variant descriptions in `ciswire.json:33-39`: A="eviction timing/severity", B="production cadence (not 'no eviction')" ✓. **BUT:** `evictionTurn` as a per-conversation covariate (which turn the first eviction occurs) is not computed — only `evictionHint` (latest digest) is captured, not the turn index of first corpus non-empty.

### 11. Variants/params in config; scorer plugin API actually INVOKED; telemetry schema absent=0

**LANDING: PARTIAL.** Variants in config ✓ (`ciswire.json:31-39`, with `params` including `winbudget: "PHASE0"`). Telemetry schema with `absentZero` ✓ (`ciswire.json:42-68`). **BUT: scorer plugin API is NOT invoked.** `runScorers` (`scoring.mjs:86-93`) is defined and exported but never called from `supervisor.sh`. All jsonl records have `"scores": null`.

---

## 10. Parent Suspects — Verification

| # | Suspect | Verdict | Evidence |
|---|---|---|---|
| PS1 | supervisor.sh mode_run uses conversations=6 for EACH arm×variant cell → 96 not 48 | **CONFIRMED** | `supervisor.sh:226` `for conv in $(seq 1 "$nconv")` where `nconv=6`. 16 cells × 6 = 96. Spec requires 3 per cell. |
| PS2 | python3 \| while read pipeline: die()/exit 1 in the loop may only kill the subshell | **CONFIRMED** | `supervisor.sh:221` pipe creates subshell. `die()` exits subshell. `set -euo pipefail` catches pipeline failure in parent — parent dies from pipefail, not from die's error message. Behavior is correct (script dies) but error path is indirect. |
| PS3 | hang/timeout: abort then die; does not skip/resume the turn | **CONFIRMED** | `supervisor.sh:116` `die "turn $i aborted status=$CAMPAIGN_TURN_STATUS"`. No `continue`. |
| PS4 | checkpoint.json written, never read for resume | **CONFIRMED** | `supervisor.sh:137` writes checkpoint. `readCheckpoint` (`datastore.mjs:64`) is never called from any script. |
| PS5 | scoring.mjs runScorers never called from supervisor; dry-run scores=null | **CONFIRMED** | `dry-1.jsonl`: all turns have `"scores": null`. `runScorers` grep returns zero call sites in supervisor.sh. |
| PS6 | responseProfile.mjs CLI profileJsonl() without lexicon → hedgeCount always 0 on artifacts | **CONFIRMED** | `supervisor.sh:233` calls `responseProfile.mjs` without lexicon arg. `profileJsonl` defaults to empty lexicon. Hedge/refusal/apology counts are 0 in .profile.json. |
| PS7 | phase0_floors just `node prereg.mjs \|\| true` — no σ from data | **CONFIRMED** | `phase0.sh:81` `node "$CAMPAIGN_ROOT/prereg.mjs" \|\| true`. `prereg.mjs` reads hardcoded `provisionalSigma` from `prereg.json`, not from R1 jsonl. |
| PS8 | CAMPAIGN_APK unset → install -r cannot run | **CONFIRMED** | `grep -rn CAMPAIGN_APK scripts/campaign/` → only `recovery.sh:86-87` (reads it), never set. `campaign_find_apk` always returns 1. |

---

## 11. Config / Infrastructure Correctness

| Check | Status | Evidence |
|---|---|---|
| 8 arms, 2³ grid | ✅ | `ciswire.json` arms R1-R8, all 8 combinations present |
| Compaction literals only | ✅ | 4× "off", 4× "ciswire", 0× on/1/true/anchored |
| Boolean flags 0/1 | ✅ | All memory/toolhelp are "0" or "1" |
| Variants array | ✅ | A (winbudget=PHASE0) + B (empty params) |
| Telemetry schema | ✅ | 4 prefixes, absentZero, sentinels, timingInvalidOnCharge |
| Watchdog params | ✅ | turnTimeoutMs=1200000 (20min), telemetryGapMs=720000 (12min), pollMs=5000 |
| Recovery params | ✅ | thermalPause=3, neverUninstall=true, neverPmClear=true |
| runOrder: random | ✅ | `runOrder: "random"` validated |
| Lexicon | ✅ | 21 hedge, 9 refusal, 8 apology markers |
| Package.json scripts | ✅ | `harness:campaign`, `harness:profile` present |

---

## 12. Dry-Run Artifact Analysis

`results/ciswire-campaign/2026-08-25/R1/dry-1.jsonl` — 3 turns, arm R1 variant B:

| Turn | Intent | charging | timingValid | ciswireFlags | scores | KALSA_DIGEST |
|---|---|---|---|---|---|---|
| 1 | plant-fact | true | false | 0 | null | [] |
| 2 | plant-fact | true | false | 0 | null | [] |
| 3 | plant-fact | true | false | 0 | null | [] |

**Correct for R1 (all off):** ciswireFlags=0 (no compaction), no DIGEST (compaction off), timingValid=false (charging). **Missing:** scores=null (B4). profile.json not checked for hedge counts (B5 — would be 0). No recovery events (no issues during dry-run).

---

## 13. Required Fixes (for implementer)

| # | Priority | Fix | Related |
|---|---|---|---|
| **F1** | **SHOW-STOPPER** | Replace `python3 … \| while read` in `mode_run` with a temp file or `while read … done < <(python3 …)` process substitution. Export or pass `FLAG_PARAMS` to the parent shell. | B1, PS2 |
| **F2** | **SHOW-STOPPER** | Change `nconv` usage in `mode_run` to run `nconv/2` (3) conversations per cell, not `nconv` (6). Or add a `conversationsPerVariant` config key. | B2, PS1 |
| **F3** | **HIGH** | Replace `die` in `campaign_one_turn` error paths with `continue` (skip turn, log recovery to jsonl, proceed to next turn). Add `CAMPAIGN_RETRIED` set+propagation for retried turns. | B3, B9, PS3 |
| **F4** | **HIGH** | Add `runScorers` call after `responseProfile.mjs` in `mode_run`, or integrate scoring into `responseProfile.mjs` CLI. Pass lexicon from config. | B4, B5, PS5, PS6 |
| **F5** | **HIGH** | Write `CAMPAIGN_APK` to config or detect it from `results/` directory. Or require `--apk` CLI arg. | B7, PS8 |
| **F6** | **HIGH** | Implement `readCheckpoint` usage: on supervisor start, check for existing checkpoint.json, offer resume. | B8, PS4 |
| **F7** | **MEDIUM** | Compute σ from R1 jsonl in `phase0_floors`: read profile.json files, compute per-axis sd, write to prereg.json. Remove `|| true`. | B6, PS7 |
| **F8** | **MEDIUM** | Write recovery events to jsonl (not just stdout). Add `--recovery-event` to datastore CLI. | B9 |
| **F9** | **MEDIUM** | Delete dead code: `campaign_watch_turn` (watchdog.sh:24-68). | B10 |
| **F10** | **MEDIUM** | Catch collector.mjs exit code in `campaign_collect_file`: `node … || die "collector failed turn $i"`. | B11 |
| **F11** | **LOW** | Compute `evictionTurn` (first turn with non-empty KALSA_DIGEST corpusSize) as a per-conversation covariate in collector.mjs. | §4 item 10 |
