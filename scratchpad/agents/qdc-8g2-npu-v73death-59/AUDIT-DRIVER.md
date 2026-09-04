# Hostile Pre-Session Audit — Cell #59 Driver

**Auditor:** Same session, self-audit (no delegation).
**Files:** `d_run.sh` (211 lines), `connect.sh` (54 lines), `PREREG.md`. Baseline: `#58 d_run.sh`, `f2b_driver.sh:59-68`, `hostbuf1_driver.sh:171-182,254-262`.
**bash -n:** exit 0.

---

## F1 — PULL_FAIL "exit=0" poisons re-entry skip [CONFIRMED]

```bash
# line 148
echo "PULL_FAIL stdout exit=${e:-NONE}" > "$out"
```
```bash
# line 90
if grep -q "exit=0" "$RAW/$1_$JOB.out" 2>/dev/null; then
```

If the device exited 0 but `adb pull` of `.out` fails (device disconnect, adb glitch), the fallback text contains the literal `exit=0`. On re-entry, the grep on line 90 matches → arm is permanently skipped with no real results. The `.err` fallback (line 151) has the same pattern but `.err` is not checked for re-entry, so only `.out` is affected.

**Impact:** Low probability (QDC link is reliable) but total data loss for that arm on re-entry. A resumed session would silently lose an arm.

**Fix:** Use a distinct sentinel, e.g. `echo "PULL_FAIL exit=${e:-NONE}" > "$out"` (drop the `=` between `exit` and the value so `grep -q "exit=0"` cannot match), or change the re-entry grep to `grep -qP 'exit=0(?!\S)'` or check for `^proof .* exit=0$` instead.

---

## F2 — A2 skipped when A1 gate-aborts [CONFIRMED]

```bash
# line 193
case $rc in 7|8) ABORT=1;; 0) A1_OK=1;; esac
# line 194
if [ "$ABORT" -eq 0 ]; then
```

Spec binding: "Gating: A1 and A2 always if gate passes". A1 gate-abort (rc=7) sets ABORT=1, which skips A2 entirely. A2 never attempts its own `gate_or_abort`. This is consistent with #58's pattern (same structure), so the #58 driver has the same latent issue.

**Impact:** If A1's gate aborts after 3×60 s, the device is hot. A2 running immediately after would likely also abort. Practical impact is near-zero, but the spec says "always" and the code doesn't comply. On a session where A1 gate-aborts and the operator manually waits 10 min before re-running, A2 would still be skipped on the next invocation of d_run.sh because ABORT is set within the same script run.

**Fix:** Remove A2 from the ABORT gate:
```bash
run_arm A1; rc=$?; case $rc in 7|8) ABORT=1;; 0) A1_OK=1;; esac
# A2 always runs regardless of A1
run_arm A2; rc=$?; case $rc in 7|8) ABORT=1;; 0) A2_OK=1;; esac
```
Or accept the #58 precedent and annotate the spec.

---

## F3 — connect.sh echoes full paste including possible key path [PLAUSIBLE]

```bash
# connect.sh line 32
echo "got: $LINE" >&2
```

If the user pastes the full ssh command (e.g. `ssh -i /Users/marco/.ssh/qdc_ed25519 -L ...`) and HOST extraction fails, the entire paste — including the `-i` key path — is printed to stderr. In normal operation HOST extraction succeeds, so this only fires on error. Not a secret leak (it's a file path, not key material), but violates ssh hygiene.

**Impact:** Negligible in practice (error path only, stderr only). Still untidy.

**Fix:** `echo "got: $(echo "$LINE" | sed 's/-i [^ ]* //g')" >&2` or just don't echo the line.

---

## F4 — Broad fastrpc grep in sigfile may false-positive, blocking n1 retry [PLAUSIBLE]

```bash
# line 119
sigline=$(grep -Eai 'dspqueue|fastrpc|qurt_exit|0x2e' "$err" "$logfile" "$tombdir"/* 2>/dev/null | head -1)
# line 122
if ! grep -Eiq 'dspqueue|fastrpc' "$sigfile" && ! grep -q avg_ts "$out"; then
```

`fastrpc` is a Qualcomm framework name that appears in informational logcat lines (e.g. library load messages). A non-fatal `fastrpc` mention in logcat would populate the sigfile, and line 122 would see it as a fatal signature → n1 retry blocked. This is the same grep used in f2b/hostbuf1 — a known limitation.

**Impact:** Low. Only matters if the n1 fallback path is taken AND logcat has a benign fastrpc mention. On v73 with this kit, fastrpc informational lines are unlikely to appear in logcat during a short bench run.

**Fix:** Narrow the grep to `fastrpc_.*die|fastrpc_.*fail|fastrpc_.*error` or check for severity indicators. Not critical for this session.

---

## F5 — connect.sh wait loop uses raw adb, no alarm [PLAUSIBLE]

```bash
# connect.sh line 45
SER=$(adb devices | awk '/\tdevice$/{print $1; exit}')
```

The wait loop (20 iterations × 1 s) uses bare `adb devices` without the `adbT` alarm wrapper. If adb hangs (rare but possible on a stale daemon), the loop blocks indefinitely. d_run.sh uses `adbT` everywhere.

**Impact:** Very low — `adb devices` is typically sub-second. But inconsistent with the rest of the driver's defensive posture.

**Fix:** Not worth fixing for this session. Note for future drivers.

---

## F6 — No device-offline abort [PLAUSIBLE]

If the device drops offline mid-session (QDC link glitch), every subsequent arm enters the 15 s polling loop, times out at the cap, and returns TIMEOUT/9. A 5-arm session with 900–1500 s caps could waste 20+ minutes polling a dead device.

**Impact:** Operational waste, not a data-integrity issue. The arms are correctly treated as TIMEOUT.

**Fix:** After the first TIMEOUT, do a quick `adbT 10 devices` check and abort early if offline. Not critical for a ~20 min session.

---

## F7 — HOSTBUF unset via `unset` in sh -c is a no-op [REFUTED — not a bug]

```bash
# line 120
local env_prefix="unset GGML_HEXAGON_HOSTBUF;"
```

The `unset` runs inside a fresh `sh -c` subprocess on the device. The variable was never set in that subprocess, so `unset` is a harmless no-op. Correct behavior — belt-and-suspenders.

**Verdict:** Not a bug. Correctly ensures the variable is absent.

---

## F8 — n1 retry recursion [REFUTED]

```bash
# line 170-171
retry_cmd=$(printf '%s\n' "$3" | sed 's/-n 0/-n 1/')
run_arm "${1}_n1" "$2" "$retry_cmd" "$4"
```

The retry command has `-n 1`, not `-n 0`. The case match `*" -n 0 "*` on line 164 will not match the retry. No infinite recursion.

A5's `-p 0 -n 128` does not match ` -n 0 ` (it's `-n 128`). Safe.

---

## F9 — HOSTBUF leak across arms [REFUTED]

The env_prefix is expanded Mac-side into the `sh -c` string literal. The `GGML_HEXAGON_HOSTBUF=1` or `unset` only applies inside that subprocess. The Mac shell never exports the variable. Each arm gets a fresh `sh -c`. No leak.

---

## F10 — quoting in T4 sh -c [REFUTED]

All variables (`$D`, `$1`, `$3`, `$env_prefix`) are expanded Mac-side before the string is sent to `adb shell`. On the device, the command is already literal. No quoting issues inside the `sh -c`.

---

## F11 — A5 `-p 0 -n 128` accidentally matching `-n 0` glob [REFUTED]

A5 command: `... -p 0 -n 128 ...`. The case pattern is `*" -n 0 "*`. The substring ` -n 0 ` does not appear in ` -p 0 -n 128 `. Safe.

---

## F12 — kit SHA256SUMS missing on device [CONFIRMED — handled]

```bash
# line 60
adbT 120 -s "$SER" shell "cd $D && sha256sum -c SHA256SUMS" > "$RAW/kit_verify_$JOB.txt" 2>&1
kit_rc=$?
if grep -q FAILED "$RAW/kit_verify_$JOB.txt"; then
  log "KIT_SHA_MISMATCH"; exit 5
fi
if [ "$kit_rc" -ne 0 ]; then
  log "KIT_SHA_CHECK_FAIL"; exit 5
fi
```

If `SHA256SUMS` is absent, `sha256sum -c` fails → `kit_rc` non-zero → exit 5. The double-check (grep FAILED + exit code) is correct. Not a bug.

---

## Compliance Checklist

| Spec requirement | Status | Lines |
|---|---|---|
| DIR, D, KIT, MODEL, MODEL_SHA | ✅ | 4–9 |
| mismatch → exit 5 | ✅ | 25–27, 62–64 |
| Kit extract + chmod + sha256sum -c | ✅ | 48–66 |
| LD_LIBRARY_PATH + vendor dirs | ✅ | 121 |
| ADSP/CDSP_LIBRARY_PATH=$D/lib-fix | ✅ | 121 |
| GGML_HEXAGON_NDEV=1, VERBOSE=1 | ✅ | 121 |
| HOSTBUF arms: HOSTBUF=1 + --no-host 1 | ✅ | 119–120, 195, 203 |
| A1/A3/A5: no HOSTBUF, no --no-host | ✅ | 119, 192, 199, 207 |
| logcat -c before each arm | ✅ | 88 |
| Pull logcat -d main,system,crash | ✅ | 105 |
| Tombstone diff pull | ✅ | 91–103 |
| sig grep: dspqueue\|fastrpc\|qurt_exit\|0x2e | ✅ | 119 |
| Proof append to .out | ✅ | 126 |
| A1/A2 always; A3←A1; A4←A2; A5←A3 | ⚠️ F2 | 192–208 |
| -n 0 fallback with n1 retry | ✅ | 162–176 |
| Retry IS the arm for gating | ✅ | 174 |
| Non-zero DEATH = result, not abort | ✅ | rc=9 path |
| Caps: A1/A2 900, A3/A4/A5 1500 | ✅ | 192–207 |
| Thermal gate before every arm | ✅ | 74 (inside run_arm) |
| T4 nohup: only sh -c bg'd | ✅ | 122 |
| End: DONE + End Session | ✅ | 211 |

---

## Verdict

**APPLY-WITH-FIXES**

The driver is correct for all critical data-integrity paths. Two issues require attention before a live session:

### Must-fix (pre-session)
1. **F1 — PULL_FAIL re-entry poison:** Change the fallback echo on line 148 from `exit=${e:-NONE}` to something that cannot match `exit=0` (e.g. `exit=${e:-NONE} pulled=false`). One line.

### Should-fix (pre-session, 2 min)
2. **F2 — A2 gating:** Either fix the code to let A2 run independently (remove the `if [ "$ABORT" -eq 0 ]` guard around A2), or annotate the PREREG to explicitly state that A1 gate-abort cascades to A2. The spec says "always"; the code says "conditional". Pick one.

### Accept as-is
- F3 (connect.sh echo): error path only, not a real leak.
- F4 (fastrpc false-positive): known limitation from f2b, low probability.
- F5 (no alarm in connect.sh wait): theoretical, not worth fixing.
- F6 (no offline abort): operational nicety, not a data issue.
