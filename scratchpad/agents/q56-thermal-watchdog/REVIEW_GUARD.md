# HOSTILE REVIEW — thermal_guard.sh + launch_with_guard.py

**Reviewer mode:** paranoid, fail-first. This watchdog killed a Galaxy S23 once already; the next device might not recover.

---

## 1. PID race — unguarded window

**Finding:** The launcher starts the workload (`nohup setsid sh -c ...`) then polls a PID file for up to 15 s, and only after reading the PID does it start the guard. During the entire PID-file poll window + guard-start window, the workload runs with NO thermal monitoring.

**File:** `launch_with_guard.py:118-125` (workload launch), `:127-130` (PID poll), `:132-137` (guard start)

**Evidence from raw:** Test-1 `launch_stdout` = `LAUNCH_PID=25378`, `guard_launch_stdout` = `GUARD_LAUNCH_PID=25385`. The guard launched ~7 PIDs after the workload launcher — those 7 fork/exec steps plus the adb round-trip represent ~2-5 s of unguarded runtime.

**Severity: HIGH.** On a device at 41 °C and climbing, a 5 s unguarded NPU burst could add 1-2 °C before the guard even starts.

**Status: CONFIRMED.**

**Fix:** Start the guard FIRST with a sentinel PID (e.g., `echo 0 > pid_file`), then start the workload, then patch the PID file. Or: use a two-phase approach where the guard watches for the PID file to appear and starts monitoring the instant it does (guard reads PID file itself in a tight loop). The current architecture (launcher reads PID, passes to guard) inherently serialises the wrong way.

---

## 2. Guard liveness never verified

**Finding:** After launching the guard via `nohup setsid sh -c ...`, the launcher prints `GUARD_LAUNCH_PID=$!` but never checks whether that process is alive. If the guard crashes at startup (bad log path, permission denied, `dumpsys` segfault in the shell), the workload runs entirely unguarded.

**File:** `launch_with_guard.py:132-137` — `guard_result` is captured but `guard_pid` is never used for a liveness check.

**Severity: HIGH.** A dead guard = zero protection. The settle loop (lines 155-161) will eventually time out and `guard_rc` stays `None`, returning exit code 1 — but by then the workload has already run and finished.

**Status: CONFIRMED.**

**Fix:** After launching the guard, poll `GUARD_LAUNCH_PID` with `kill -0` for 2-3 s. If dead, abort the workload immediately (kill the child before it starts heavy computation, or refuse to launch). Alternatively, have the guard write a `GUARD_READY` sentinel to a file within 1 s of startup; the launcher blocks on this before starting the workload.

---

## 3. `hard_tenths=380` silently overrides production `kill_tenths=430`

**Finding:** The guard has a hardcoded `hard_tenths=380` (line 20 of `thermal_guard.sh`) that fires a `HARD_ABORT` before the caller's `kill_tenths` is ever reached. When the production command passes `--kill-tenths 430`, the guard will kill at 38.0 °C, NOT 43.0 °C. The report's production command is therefore misleading — it claims 43.0 °C kill but the actual kill is 38.0 °C.

**File:** `thermal_guard.sh:20` (`hard_tenths=380`), `thermal_guard.sh:72-76` (hard abort check before kill_tenths check)

**Severity: MEDIUM (functionally a safety net, but wrong if intentional).** If 38.0 °C is the correct hard limit, then the production `kill_tenths=430` is dead code and should be removed or documented as overridden. If 43.0 °C is the intended production kill, then `hard_tenths` must be ≥ 430 or removed. The REPORT.md production_command implies 43 °C is the kill point — it is not.

**Status: CONFIRMED.**

**Fix:** Either (a) remove `hard_tenths` entirely and rely on the caller-supplied `kill_tenths` (caller is responsible), or (b) set `hard_tenths=450` (45.0 °C) as a true emergency limit above the production 430, or (c) document in REPORT.md that `hard_tenths=380` caps production to 38.0 °C regardless of caller args. Currently the REPORT.md does not mention this override.

---

## 4. Post-loop WARN/KILLED not emitted — only MAX

**Finding:** After the `while pid_exists` loop exits normally, the guard does a final `read_sample` then runs three conditional blocks (sensor error, battery abort, hard abort) that each log a line and `exit 2`. If none trigger, it logs `MAX` and `exit 0`. There is NO post-loop equivalent of the `warn_tenths` / `kill_tenths` checks. If the workload finishes while temp is between WARN and KILL (e.g., 410 tenths = 41.0 °C with kill at 430), no WARN or MAX-with-warn is logged — just a bare MAX line.

**File:** `thermal_guard.sh:93-111` (post-loop block — missing warn/kill checks)

**Severity: MEDIUM.** Not a kill-path failure (the workload already finished), but it means the post-run thermal state is under-reported. If someone uses the MAX line to decide whether to start a next arm, they miss that the device was in WARN territory.

**Status: CONFIRMED.**

**Fix:** Add `warn_tenths` and `kill_tenths` checks in the post-loop block, before the final MAX line. If temp ≥ kill_tenths post-workload, log KILLED and exit 2 (the binary already exited but the thermal state is still dangerous — delay next arm). If temp ≥ warn_tenths, log WARN before MAX.

---

## 5. `dumpsys battery` slow — poll interval collapse

**Finding:** The guard uses `sleep $interval_s` as its poll cadence. But `dumpsys battery` can hang for 5-10 s on a loaded device (thermal throttling, binder contention). If `dumpsys` takes 8 s and `interval_s=10`, the effective poll period becomes 18 s — during which temperature could rise 3-5 °C unmonitored.

**File:** `thermal_guard.sh:37-38` (`dumpsys battery` inside `read_sample`), `thermal_guard.sh:78` (`sleep $interval_s` at end of loop)

**Severity: MEDIUM.** Not a failure on a lightly loaded device, but the exact scenario this guard exists for (sustained NPU load) is when binder is most contended.

**Status: PLAUSIBLE** (no evidence in current raw logs that dumpsys was slow — the poll intervals in test2 are ~1 s, but dumpsys was probably fast at 29 °C with light load).

**Fix:** (a) Use `timeout 5 dumpsys battery` (toybox supports `timeout`). (b) Record the time spent in `read_sample` and subtract it from `sleep` to maintain constant wall-clock interval. (c) If `dumpsys` exceeds a deadline (e.g., 3 s), treat it as a sensor error and `exit 2` (fail-closed).

---

## 6. `kill -9` to PID with no retry, no confirmation

**Finding:** The guard calls `kill -9 "$pid" 2>/dev/null` and immediately logs `KILLED` and exits. There is no verification that the process actually died. If `kill -9` fails silently (process in uninterruptible sleep / D state, or PID already reused by a kernel thread), the guard exits reporting success while the workload continues running.

**File:** `thermal_guard.sh:73-75`, `:82-84`, `:90-92`, `:100-102` (all four kill sites)

**Severity: LOW-MEDIUM.** `kill -9` to a userspace process almost never fails on Linux. But if the NPU driver holds the process in D state (possible with DSP crashes — see the `dspqueue_write 0x1` in the incident), the kill could be ineffective.

**Status: PLAUSIBLE** (the incident shows DSP failures, but D-state processes are rare for userspace binaries).

**Fix:** After `kill -9`, sleep 1 s, then re-check `pid_exists`. If still alive, log `KILL_FAILED` and `exit 3` (distinct from exit 2) so the launcher knows to escalate. The launcher should then attempt its own kill or alert.

---

## 7. WARN threshold fires at `warn_tenths` (inclusive), not above

**Finding:** The guard uses `[ "$temp" -ge "$warn_tenths" ]` — meaning WARN triggers at exactly 40.0 °C (400 tenths), not above it. This is technically correct for a "≥ 40 °C" policy, but the incident document says "log a WARN at 40 °C" which is ambiguous. More importantly, the `[ "$temp" -ge "$kill_tenths" ]` check runs AFTER the warn check, and since `warned` is set to 1 on the first WARN, subsequent polls at ≥ 40 °C will skip the WARN log but still reach the kill check. This is correct behavior but not obvious.

**File:** `thermal_guard.sh:86-89` (WARN), `:90-92` (KILL)

**Severity: LOW.** Functionally correct for integer tenths. Off-by-one at the boundary means 399 tenths (39.9 °C) does NOT trigger WARN, 400 tenths (40.0 °C) DOES. This matches the policy.

**Status: CONFIRMED (correct behavior).**

**Fix:** None needed for correctness. Consider adding a comment: `# WARN fires at exactly warn_tenths (inclusive); KILL fires at exactly kill_tenths (inclusive)`.

---

## 8. Sensor failure → kill (fail-closed) ✓ but TEMP=0 silently kills

**Finding:** If `dumpsys battery` returns no temperature AND no thermal_zone battery is found, `temp` is set to `0` (line 49). The `sensor_ok=0` path correctly kills on the next iteration. However, if `dumpsys battery` returns a temperature that happens to be `0` (sensor hardware failure reading 0.0 °C), the guard does NOT set `sensor_ok=0` — it treats 0 as a valid reading. A reading of 0 tenths (0.0 °C) is below all thresholds, so the workload runs unmonitored while the real temperature could be anything.

**File:** `thermal_guard.sh:47-49` (case statement forces `temp=0` on non-numeric), `thermal_guard.sh:51-53` (sensor_ok logic)

**Severity: LOW.** A hardware temperature sensor reading exactly 0 °C on a phone that just finished a 15-min cooldown at 30 °C is physically implausible. But a firmware bug returning 0 as an error code is plausible.

**Status: PLAUSIBLE.**

**Fix:** Add a sanity check: if `temp` is 0 AND we are in the first few seconds (or if temp drops by > 100 tenths in one interval), treat it as a sensor error. Alternatively, define `temp=0` as a sentinel for "no reading" and set `sensor_ok=0` when temp is 0 after the numeric coercion. This requires changing the coercion to set `sensor_ok=0` when `temp` becomes 0 from the fallback.

---

## 9. Nohup/setsid — guard survives shell death ✓

**Finding:** The guard is launched as `nohup setsid sh -c '...' </dev/null >/dev/null 2>&1 &`. This correctly:
- Detaches stdin/stdout/stderr from the adb shell session
- Creates a new session (`setsid`) so SIGHUP from the adb shell closing doesn't kill it
- Backgrounds it so the launcher's adb shell returns immediately

**File:** `launch_with_guard.py:134-137`

**Severity: N/A (correct).**

**Status: CONFIRMED (correct).**

**Fix:** None needed.

---

## 10. `exec` in workload wrapper — binary IS the PID ✓

**Finding:** The workload wrapper uses `(setup; exec workload ...) & child=$!`. The `exec` replaces the subshell, so `$child` is the actual binary PID, not a wrapper shell. The guard's `kill -9 $pid` targets the binary directly.

**File:** `launch_with_guard.py:107-112` (workload wrapper)

**Severity: N/A (correct).**

**Status: CONFIRMED (correct).**

**Fix:** None needed.

---

## 11. ADB disconnect during guard — guard keeps running ✓

**Finding:** The guard runs on-device via `setsid`, fully detached from the adb session. If adb drops (as in the incident), the guard continues polling and can still `kill -9` the workload. The guard does not depend on adb connectivity.

**File:** `thermal_guard.sh` (entirely on-device), `launch_with_guard.py:134-137` (nohup+setsid)

**Severity: N/A (correct).**

**Status: CONFIRMED (correct).**

**Fix:** None needed.

---

## 12. Log path unwritable → guard exits before loop

**Finding:** The guard does `: >> "$log_path" || exit 73` before entering the loop. If the log path is unwritable (wrong permissions, read-only filesystem), the guard exits immediately with code 73. The launcher would then time out on the settle loop (10 s) and report `guard_rc=None` → exit 1. The workload runs unguarded.

**File:** `thermal_guard.sh:31`

**Severity: LOW.** The launcher pushes the guard script to `/data/local/tmp/` which is writable, and the log path is in the same directory. But if the directory is full (93% disk usage noted in REPORT.md), writes could fail.

**Status: PLAUSIBLE** (disk at 93% is a real concern).

**Fix:** The launcher should pre-create and verify the log file is writable before starting the guard. Add a disk-space check: `df /data/local/tmp` and abort if < 1 MB free.

---

## 13. Log file unbounded growth

**Finding:** For a 40-minute run at 10 s intervals, the guard produces ~240 lines. Each line is ~30 bytes → ~7.2 KB. This is fine. But for a 10 s interval run that somehow lasts hours (e.g., max_seconds not enforced), the log grows without bound.

**File:** `thermal_guard.sh:33-35` (log_line appends indefinitely)

**Severity: VERY LOW** (max_seconds in the launcher caps this at 120 s → 12 lines).

**Status: CONFIRMED (benign in practice).**

**Fix:** None needed given the launcher's `--max-seconds` cap. If the guard is used standalone, consider a max-lines counter.

---

## 14. Launcher adb reconnect during run — not implemented

**Finding:** The launcher's `Device._reconnect_or_raise` handles adb transport errors for individual commands, but the main polling loop (`while proc_exists(device, pid)`) does NOT handle adb disconnection. If adb drops mid-run, `proc_exists` will fail, the `_transport_error` check will trigger, reconnect will be attempted (up to 3 × 90 s = 270 s), and the workload may finish or thermal-kill during reconnection. The launcher does NOT pull logs if adb is down when the workload finishes.

**File:** `launch_with_guard.py:148-155` (polling loop — no reconnect), `:160-163` (pull loop — no reconnect)

**Severity: MEDIUM.** The guard on-device still protects the workload, but the launcher loses visibility. If the guard kills the workload while adb is disconnected, the launcher won't know until reconnection, and log pulling may fail.

**Status: CONFIRMED.**

**Fix:** The polling loop should catch adb transport errors and retry the reconnect. After reconnection, re-verify the PID is dead (the guard may have killed it during the blackout). Add a post-reconnect log-pull attempt.

---

## 15. Battery level < 45% → immediate kill (unrelated to thermal)

**Finding:** The guard kills the workload if battery level < 45% (`thermal_guard.sh:62-67`). This is a policy decision (prevent deep discharge during long runs), but it is NOT a thermal protection. If the battery is at 44% and the device is at 25 °C, the guard kills. The report's `abort_level_pct=45` documents this.

**File:** `thermal_guard.sh:62-67`

**Severity: LOW** (correct behavior for the documented policy, but conflating battery-level abort with thermal watchdog is confusing in the naming).

**Status: CONFIRMED (correct for stated policy).**

**Fix:** None for correctness. Consider renaming the log line from `BATTERY_ABORT` to `BATTERY_LOW_ABORT` for clarity.

---

## 16. Production command — WARN 40.0 / KILL 43.0 °C correct ✓ (but see Finding 3)

**Finding:** The REPORT.md production command uses `--warn-tenths 400 --kill-tenths 430`, which is 40.0 °C / 43.0 °C. This matches the incident document's policy. However, per Finding 3, the `hard_tenths=380` override means the actual kill is 38.0 °C, not 43.0 °C.

**File:** `REPORT.md:production_command`

**Severity: MEDIUM** (misleading — the command claims 43 °C kill but hard_tenths kills at 38 °C).

**Status: CONFIRMED (the command args are correct per policy, but hard_tenths overrides them).**

**Fix:** See Finding 3.

---

## 17. Validation evidence — test 1 kill ✓, test 2 pass ✓

**Finding — test 1:** Raw `test1_kill.guard.log` shows three lines at epoch 1787633525: sample (286), WARN (286), KILLED (286). Guard `exit_code=2` in manifest. Workload `rc=137` (= 128 + 9 = SIGKILL). All consistent: temp 286 > kill_tenths 281 → killed. stdout.jsonl is empty (0 bytes) — workload was killed before producing output.

**Finding — test 2:** Raw `test2_pass.guard.log` shows 20 samples at 1-s intervals, temp rises from 286 to 295, then MAX line. Guard `exit_code=0`, workload `rc=0`. stdout.jsonl has 2 rows of valid JSON with `n_gpu_layers=0`. No WARN or KILLED lines — temp 295 never reached warn_tenths 400.

**Finding — gap check:** REPORT.md claims `test1_max_temperature_tenths=286` and `test2_max_temperature_tenths=295`. Both match the raw guard logs (test1: all lines show 286; test2: max in the 20 lines is 295). No discrepancy.

**Severity: N/A (evidence is consistent).**

**Status: CONFIRMED.**

---

## 18. Test 1 timestamp anomaly — all three lines at same epoch

**Finding:** The test-1 guard log has all three lines (sample, WARN, KILLED) at the same epoch `1787633525`. This means the guard's first poll already exceeded the kill threshold, so the loop body ran once: read_sample → log → check warn → log WARN → check kill → log KILL → exit. The `sleep 1` at the end of the loop was never reached. This is correct behavior — the guard killed on its very first poll.

**File:** `raw/test1_kill.guard.log:1-3`

**Severity: N/A (expected for a kill-at-first-poll test).**

**Status: CONFIRMED (correct).**

---

## 19. Disk at 93% — log pull and write risk

**Finding:** REPORT.md shows `data_use_pct=93`, `data_available_gb=8.2`. The guard log is small (~7 KB), but the workload stdout/stderr could be large (test2 stderr = 1039 B, stdout = 1887 B). At 93% usage, a large perplexity run could generate MB of output and exhaust disk before the guard even acts.

**File:** `REPORT.md:health`, `launch_with_guard.py:109-110` (workload redirects to files)

**Severity: LOW** (8.2 GB free is plenty for the current workloads, but a 40-min perplexity run could be larger).

**Status: PLAUSIBLE.**

**Fix:** Add a pre-run disk check in the launcher: `df` on `/data/local/tmp`, abort if < 500 MB free. Also consider redirecting workload stderr to the guard log to avoid a separate file.

---

## Summary

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | PID race — unguarded window (2-5 s) | HIGH | CONFIRMED |
| 2 | Guard liveness never verified | HIGH | CONFIRMED |
| 3 | hard_tenths=380 overrides production kill_tenths=430 | MEDIUM | CONFIRMED |
| 4 | Post-loop missing warn/kill checks | MEDIUM | CONFIRMED |
| 5 | dumpsys slow → poll interval collapse | MEDIUM | PLAUSIBLE |
| 6 | kill -9 no retry, no confirmation | LOW-MED | PLAUSIBLE |
| 7 | WARN at threshold (inclusive) — correct | LOW | CONFIRMED (OK) |
| 8 | temp=0 from sensor failure not caught | LOW | PLAUSIBLE |
| 9 | nohup/setsid correct | — | CONFIRMED (OK) |
| 10 | exec → binary IS the PID | — | CONFIRMED (OK) |
| 11 | Guard survives adb disconnect | — | CONFIRMED (OK) |
| 12 | Log unwritable → guard exits, workload unguarded | LOW | PLAUSIBLE |
| 13 | Log unbounded growth | VERY LOW | CONFIRMED (benign) |
| 14 | Launcher doesn't handle adb disconnect mid-run | MEDIUM | CONFIRMED |
| 15 | Battery level abort conflated with thermal | LOW | CONFIRMED (OK) |
| 16 | Production thresholds correct per policy (but overridden) | MEDIUM | CONFIRMED |
| 17 | Raw evidence matches report | — | CONFIRMED (OK) |
| 18 | Same-epoch guard log = first-poll kill (correct) | — | CONFIRMED (OK) |
| 19 | 93% disk — write/pull risk | LOW | PLAUSIBLE |

---

**SAFE-with-fixes: 1, 2, 3, 4, 14.** The guard works for its tested scenario (short CPU-only run, cool device). For a 40-minute NPU run on a device that already suffered thermal shutdown: the two HIGH findings (unguarded window, no guard liveness check) and the hard_tenths override (Finding 3) mean this guard is NOT ready for production unsupervised use until those three are fixed.
