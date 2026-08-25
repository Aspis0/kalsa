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

---

## RE-AUDIT (post-fix)

### 1. Original findings — status

| # | Finding | Verdict | Evidence |
|---|---------|---------|----------|
| 1 | PID race — unguarded window | **FIXED** | Guard-first architecture: `launch_with_guard.py:234-238` starts guard via supervisor, wrapper spins on `GUARD_TRACKING` file (`launch_with_guard.py:180`). Launcher blocks on `wait_for_guard_ready` (`launch_with_guard.py:244-251`) before workload starts. No workload code executes until guard has sampled and confirmed. |
| 2 | Guard liveness never verified | **FIXED** | `wait_for_guard_ready` (`launch_with_guard.py:244-251`) checks `GUARD_PID` alive + `GUARD_READY` file + numeric first sample in log. `wait_for_tracking` (`launch_with_guard.py:253-259`) re-verifies guard alive. Supervisor loop (`launch_with_guard.py:188-193`) checks `kill -0 $guard` every 1 s and exits 75 if dead. Launcher catches `GuardLivenessError` (`launch_with_guard.py:277-292`) and kills supervisor+guard+workload. |
| 3 | `hard_tenths=380` silently overrides production kill_tenths | **FIXED** | Hardcoded `hard_tenths` removed from guard. Now explicit `session_hard_cap_tenths` arg (`thermal_guard.sh:13`, `launch_with_guard.py:167`). `effective_kill_tenths` computed and logged at START (`thermal_guard.sh:77-79`). REPORT.md now states `effective_kill_temperature_c=38.0`. |
| 4 | Post-loop missing warn/kill checks | **FIXED** | Post-loop block calls `process_sample` (`thermal_guard.sh:150-153`) before MAX. `process_sample` runs all checks including warn/kill thresholds. |
| 5 | dumpsys slow → poll interval collapse | **FIXED** | `timeout 5 dumpsys battery` (`thermal_guard.sh:82`). Elapsed time subtracted from sleep (`thermal_guard.sh:143-146`). |
| 6 | kill -9 no retry, no confirmation | **FIXED** | `terminate_target` (`thermal_guard.sh:101-108`): `kill -9` → `sleep 1` → re-check `pid_exists` → `KILL_FAILED` / exit 3. |
| 7 | WARN at threshold (inclusive) — correct | **FIXED** (retained, documented) | `-ge` comparison retained. Threshold fields logged at START. |
| 8 | temp=0 from sensor failure not caught | **FIXED** | `case ""$temp" in ... |0) sensor_ok=0` (`thermal_guard.sh:98`). Zero is now a sensor failure. |
| 9 | nohup/setsid correct | **FIXED** (retained) | Supervisor and guard both `nohup setsid` (`launch_with_guard.py:228,234`). |
| 10 | exec → binary IS the PID | **PARTIAL** | Guard tracks wrapper PID which execs to workload (`launch_with_guard.py:180-182`). See New Finding A below for exec-failure gap. |
| 11 | Guard survives adb disconnect | **FIXED** (retained) | Detached via setsid. |
| 12 | Log unwritable → guard exits, workload unguarded | **FIXED** | Guard checks `: >> log_path` at startup (`thermal_guard.sh:112`). Launcher preflights disk (`launch_with_guard.py:155-157`, `launch_with_guard.py:221-223`). |
| 13 | Log unbounded growth | **FIXED** (retained) | Launcher wall-clock cap. |
| 14 | Launcher doesn't handle adb disconnect mid-run | **FIXED** | `AdbTransportError` raised on reconnect exhaustion (`launch_with_guard.py:56-82`). Launcher catches it (`launch_with_guard.py:293-295`), sets `adb_disconnect=True`, returns exit 76. |
| 15 | Battery level abort conflated with thermal | **FIXED** | Renamed to `BATTERY_LOW_ABORT` in guard (`thermal_guard.sh:119`). |
| 16 | Production thresholds correct (but overridden) | **FIXED** | `--session-hard-cap-tenths 380` explicit in production command. REPORT.md shows effective kill 38.0 °C. |
| 17 | Raw evidence matches report | **FIXED** (retained) | Prior evidence unchanged. |
| 18 | Same-epoch guard log = first-poll kill | **FIXED** (retained) | |
| 19 | 93% disk — write/pull risk | **FIXED** | `disk_available_kb` preflight, `MIN_FREE_KB = 500 * 1024` (`launch_with_guard.py:221-223`). |

---

### 2. New code — hostile attack

#### New Finding A: Wrapper exec failure leaves orphan shell — WORKLOAD RUNS UNDER WRONG COMMAND

**File:** `launch_with_guard.py:180-182`
```sh
while [ ! -f tracking_file ]; do sleep 1; done; setup ; exec workload > stdout 2> stderr
```

If `exec` fails (binary missing, permission denied, library not found), the shell does NOT exit. It falls through to the end of the subshell and exits with the exec error code. The guard sees `pid_exists` → false → breaks → logs MAX → exit 0. The workload never ran, so no thermal damage — but the launcher sees `workload_rc ≠ 0` and `guard_rc = 0`, interprets this as success (returns 0), and does NOT raise an error.

**Severity: LOW.** The workload didn't run, so no thermal risk. But the launcher reports success for a failed workload, which is misleading.

**Status: PLAUSIBLE.**

**Fix:** After exec, if the shell somehow continues (shouldn't happen with `exec`, but belt-and-suspenders), add `exit 127` as a fallback. More importantly, the launcher should check `workload_rc` for exec-failure codes (126, 127) and report them distinctly. Currently it does: `if guard_rc != 0 or workload_rc != 0: return 1` — this catches it, but the manifest `abort_reason` will be empty, which is confusing.

---

#### New Finding B: Supervisor trap kills already-dead child — harmless but noisy

**File:** `launch_with_guard.py:184-185`
```sh
trap 'if [ "$child" -gt 0 ]; then kill -9 "$child" 2>/dev/null; fi' 0 1 2 3 15
```

When the supervisor exits normally after `wait $child` (child already dead), the EXIT trap (signal 0) fires and attempts `kill -9` on the dead child. This is harmless (`kill -9` to a dead PID returns non-zero, `2>/dev/null` suppresses the error) but adds a shell fork to every normal completion.

**Severity: VERY LOW.** No functional impact.

**Status: CONFIRMED (benign).**

**Fix:** Guard the trap body with `[ "$child" -gt 0 ] && kill -0 "$child" 2>/dev/null && kill -9 "$child" 2>/dev/null`. Or accept the harmless noise.

---

#### New Finding C: Guard PID file race — `GUARD_PID` written after guard starts, supervisor reads before guard is sampled

**File:** `launch_with_guard.py:234-236`
```sh
nohup setsid sh -c '...' </dev/null >/dev/null 2>&1 & guard=$!
echo GUARD_PID=$guard > guard_pid_file
```

The guard PID file is written BEFORE the guard writes `GUARD_READY`. The launcher's `wait_for_guard_ready` (`launch_with_guard.py:244-251`) checks `GUARD_PID` alive AND `GUARD_READY` written AND log has a sample. So even though the PID file is written early, the launcher doesn't proceed until the guard has actually sampled. The PID file is just a handle for the liveness check.

**Severity: NONE (not a real race).** The `wait_for_guard_ready` function gates on all three conditions.

**Status: REFUTED.**

---

#### New Finding D: `timeout 5 dumpsys battery` — is `timeout` available on Android toybox?

**File:** `thermal_guard.sh:82`
```sh
sample_text=$(timeout 5 dumpsys battery 2>/dev/null)
```

Android's toybox includes `timeout` (toybox `timeout` implements the coreutils spec). Confirmed on Android 8+ (API 26+). The S23 runs Android 14/15. However, if `timeout` is not present (unlikely on a stock Samsung), it fails silently because `2>/dev/null` is on `dumpsys battery`, not on `timeout` itself. The `$()` captures stdout of `timeout 5 dumpsys battery 2>/dev/null` — if `timeout` is missing, the shell reports `timeout: not found` to stderr (not captured), and `sample_text` is empty. This triggers `sensor_ok=0` → sensor failure path. With `sensor_fail_limit=3`, three consecutive missing-`timeout` calls kill the workload.

**Severity: LOW.** `timeout` is present on the target device. But the failure mode is documented only by the sensor-fail path, not by an explicit "timeout binary missing" check.

**Status: PLAUSIBLE (device-specific).**

**Fix:** Add a guard startup check: `command -v timeout >/dev/null 2>&1 || { log_line 'TIMEOUT_BINARY_MISSING'; exit 64; }`. This fails fast at startup rather than after 3 slow polls.

---

#### New Finding E: `sensor_fail_limit=3` with slow dumpsys — false kills under load

**File:** `thermal_guard.sh:121-131`

If `dumpsys battery` hangs for > 5 s three consecutive times (binder contention under heavy NPU load), the guard累计 `sensor_failures` to 3 and kills the workload. The `timeout 5` ensures each call takes at most 5 s, so three failures = at most 15 s of monitoring gap. On a device at 37 °C climbing at 0.5 °C/min, 15 s = 0.125 °C additional rise — acceptable.

But the false kill itself is the problem: a healthy run at 35 °C gets killed because the monitoring infrastructure is slow, not because the device is hot.

**Severity: MEDIUM.** The kill is incorrect (device is safe), but the alternative (keep running blind) is worse for safety. This is an acceptable false-positive for a safety guard.

**Status: CONFIRMED.**

**Fix:** Document this explicitly: "The guard may kill a healthy workload if the device's binder subsystem is too loaded to respond to dumpsys within 5 s. This is a deliberate fail-closed trade-off: a blind guard is more dangerous than a trigger-happy one." Consider raising `sensor_fail_limit` to 5 for production (25 s of total binder failure before kill, still acceptable for a 40-min run).

---

#### New Finding F: Supervisor shell — no `exec`, signals propagate correctly

**File:** `launch_with_guard.py:228-242`

The supervisor is `sh -c '...'` (no exec). When the launcher kills the supervisor (`kill -9 supervisor_pid`), the supervisor dies immediately. The trap fires (signal 15 → `kill -9 $child`). The guard is a separate `setsid` process and is NOT killed by the supervisor's death — it will detect `target_pid` gone via `pid_exists` → false and exit cleanly. This is correct: the guard outlives the supervisor.

**Severity: NONE (correct architecture).**

**Status: CONFIRMED (correct).**

---

#### New Finding G: `process_sample` return value — guard exits immediately on non-zero

**File:** `thermal_guard.sh:138-139`
```sh
process_sample
sample_result=$?
[ "$sample_result" -ne 0 ] && exit "$sample_result"
```

When `process_sample` returns 3 (sensor error / kill failed), the guard exits 3 immediately. The post-loop `process_sample` call (`thermal_guard.sh:150-153`) is only reached if the loop exits normally (target gone). This is correct: the guard doesn't continue polling after a kill decision.

**Severity: NONE (correct).**

**Status: CONFIRMED (correct).**

---

#### New Finding H: `wait_for_guard_ready` timeout — is `max(2 * interval_s, 2.0)` sufficient?

**File:** `launch_with_guard.py:244`
```python
deadline = time.monotonic() + max(2.0 * interval_s, 2.0)
```

For `interval_s=10` (production), the deadline is 20 s. The guard needs to: start → open log → run `timeout 5 dumpsys battery` → parse → write READY. On a fast device this is ~2 s. On a slow device with slow dumpsys: up to 5 s for the first sample + overhead. 20 s is generous.

For `interval_s=1` (test), the deadline is 2 s. The guard needs to do the same work in 2 s. If dumpsys takes 1.5 s, there's only 0.5 s margin. This could cause spurious `GuardLivenessError` on slow devices during testing.

**Severity: LOW.** The production case (interval_s=10) is fine. The test case (interval_s=1) could be tight.

**Status: PLAUSIBLE.**

**Fix:** Use `max(3.0 * interval_s, 5.0)` to give more headroom, or at least document that test1 with `interval_s=1` requires a responsive device.

---

#### New Finding I: Effective kill logging — guard vs. launcher consistency

**File:** `thermal_guard.sh:77-79` (guard START line), `launch_with_guard.py:317-319` (manifest)

Guard logs: `effective_kill_tenths=380` (when session_hard_cap=380 < kill_tenths=430). Manifest reports: `effective_kill_tenths: min(430, 380) = 380`. REPORT.md: `effective_kill_temperature_c=38.0`. All three are consistent.

The guard's kill comparison (`thermal_guard.sh:125-129`) uses `$effective_kill_tenths` which is 380. The `HARD_ABORT` path also fires at `$session_hard_cap_tenths` (380). So both paths kill at 380 — the `HARD_ABORT` and `KILL_THRESHOLD` paths are redundant when `session_hard_cap_tenths < kill_tenths`. Not a bug, but the dual-path is confusing.

**Severity: LOW.** Redundant but not dangerous.

**Status: CONFIRMED (redundant, not harmful).**

**Fix:** Document that when `session_hard_cap_tenths < kill_tenths`, the `KILL_THRESHOLD` branch is unreachable. Or simplify: only check `effective_kill_tenths` and distinguish HARD vs KILL_THRESHOLD by whether the cap was the limiting factor.

---

#### New Finding J: Toybox sh compatibility audit

**File:** `thermal_guard.sh` (entire)

Checked constructs:
- `$((expr))` — POSIX arithmetic expansion, supported by all toybox sh. ✓
- `case` with glob patterns — POSIX. ✓
- `for zone in /sys/class/thermal/thermal_zone*` — POSIX glob. ✓
- `sed -n`, `grep -m 1` — available in toybox. ✓
- `kill -0`, `[ -d /proc/... ]` — POSIX. ✓
- `command -v` — POSIX (not used, but `is_uint` uses `case`). ✓
- No `[[ ]]` — uses `[ ]` and `case`. ✓
- No arrays — uses scalar variables. ✓
- No `$(( ))` with floats — all arithmetic is integer. ✓
- `timeout` — toybox builtin on Android 8+. ✓
- `date +%s` — POSIX. ✓

**Severity: NONE.**

**Status: CONFIRMED (clean).**

---

### 3. Minimal device re-validation matrix

Four tests, executed in order on a cool device (≤ 30 °C, ≥ 50% battery, unplugged).

#### Test 1 — Kill path (threshold exceeded)

**Purpose:** Prove the guard kills the workload when temperature ≥ kill_tenths.

**Command:**
```
python launch_with_guard.py --serial $SERIAL --tag reval_test1_kill \
  --warn-tenths 281 --kill-tenths 281 --session-hard-cap-tenths 380 \
  --sensor-failure-limit 3 --interval-s 1 --max-seconds 120 \
  --local-dir raw -- \
  /data/local/tmp/kalsahtp/llama-bench -m /data/local/tmp/LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q8_0.gguf \
  -p 64 -n 16 -r 1 --no-warmup -t 8 -o jsonl -ngl 0 --load-mode none -fa on --ubatch-size 1024
```
**Logic:** Device at ~29 °C = 290 tenths. kill_tenths=281 < 290 → guard kills on first poll.

**Expected artifacts:**
- `reval_test1_kill.guard.log`: line 1 = `START,...`, line 2 = sample (290ish), line 3 = `WARN` (if temp ≥ 281), line 4 = `KILLED`.
- `reval_test1_kill.guard.rc` = `2`.
- `reval_test1_kill.workload.rc` = `137` (SIGKILL).
- `reval_test1_kill.manifest.json`: `guard.exit_code` = 2, `guard.effective_kill_tenths` = 281 (or 380, whichever is lower), `workload_rc` = 137, `timed_out` = false, `abort_reason` = empty.
- `reval_test1_kill.stdout.jsonl` = empty or ≤ 1 row (killed before output).
- Guard log has `READY` line, `TRACKING` line, then `KILLED` line.
- Launcher exit code = 0 (guard_rc == 2).

---

#### Test 2 — Pass-through (threshold not reached)

**Purpose:** Prove the guard lets the workload finish when temperature < warn_tenths.

**Command:**
```
python launch_with_guard.py --serial $SERIAL --tag reval_test2_pass \
  --warn-tenths 400 --kill-tenths 430 --session-hard-cap-tenths 380 \
  --sensor-failure-limit 3 --interval-s 10 --max-seconds 120 \
  --local-dir raw -- \
  /data/local/tmp/kalsahtp/llama-bench -m /data/local/tmp/LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q8_0.gguf \
  -p 64 -n 16 -r 1 --no-warmup -t 8 -o jsonl -ngl 0 --load-mode none -fa on --ubatch-size 1024
```
**Logic:** Device at ~29 °C = 290 tenths. warn=400, kill=430, hard_cap=380. Temp stays well below all thresholds.

**Expected artifacts:**
- `reval_test2_pass.guard.log`: START line, ~20 samples (10 s interval × ~23 s run), then `MAX` line. No WARN, no KILLED.
- `reval_test2_pass.guard.rc` = `0`.
- `reval_test2_pass.workload.rc` = `0`.
- `reval_test2_pass.manifest.json`: `guard.exit_code` = 0, `guard.effective_kill_tenths` = 380, `max_temperature_tenths` ≤ 300, `workload_rc` = 0.
- `reval_test2_pass.stdout.jsonl` = 2 rows of valid JSON.
- Guard log has `READY`, `TRACKING_<pid>`, then MAX.
- Launcher exit code = 0.

---

#### Test 3 — Fail-closed sensor path (simulated sensor failure)

**Purpose:** Prove the guard kills after `sensor_fail_limit` consecutive sensor failures.

**Command:**
```
python launch_with_guard.py --serial $SERIAL --tag reval_test3_sensor \
  --warn-tenths 400 --kill-tenths 430 --session-hard-cap-tenths 380 \
  --sensor-failure-limit 3 --interval-s 10 --max-seconds 120 \
  --local-dir raw -- \
  /data/local/tmp/kalsahtp/llama-bench -m /data/local/tmp/LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q8_0.gguf \
  -p 64 -n 16 -r 1 --no-warmup -t 8 -o jsonl -ngl 0 --load-mode none -fa on --ubatch-size 1024
```
**Setup (before launching):** Temporarily make `dumpsys` unavailable:
```sh
adb shell 'chmod 000 /system/bin/dumpsys'
# OR: use a wrapper that sleeps >5 s:
adb shell 'mv /system/bin/dumpsys /system/bin/dumpsys.bak && echo "#!/system/bin/sh
sleep 10" > /system/bin/dumpsys && chmod 755 /system/bin/dumpsys'
```
**Teardown (after test):**
```sh
adb shell 'chmod 755 /system/bin/dumpsys.bak && mv /system/bin/dumpsys.bak /system/bin/dumpsys'
```
**Logic:** `dumpsys battery` fails 3 times (sensor_fail_limit=3) → guard kills workload.

**Expected artifacts:**
- `reval_test3_sensor.guard.log`: START line, 3× `SENSOR_FAILURE_N` lines (N=1,2,3), then `SENSOR_ERROR`, then `KILLED`.
- `reval_test3_sensor.guard.rc` = `3` (sensor error kill).
- `reval_test3_sensor.workload.rc` = `137` (SIGKILL).
- `reval_test3_sensor.manifest.json`: `guard.exit_code` = 3, `max_temperature_tenths` = 0 (sensor failure).
- Guard log: READY line present (guard started OK before dumpsys failed), then SENSOR_FAILURE lines.
- Launcher exit code = 0 (guard_rc == 2 or 3; check launcher logic: `if guard_rc not in (0, None): return 1` — need to verify). **ACTUALLY:** launcher returns 1 if `guard_rc != 0 or workload_rc != 0`. So launcher returns 1 for this case. Manifest `abort_reason` should be empty (sensor error is on-device, not launcher-detected). This is a gap — see Finding K below.

---

#### Test 4 — Guard-not-ready path (guard fails to start)

**Purpose:** Prove the launcher kills the workload when the guard dies at startup.

**Command:**
```
python launch_with_guard.py --serial $SERIAL --tag reval_test4_noguard \
  --warn-tenths 400 --kill-tenths 430 --session-hard-cap-tenths 380 \
  --sensor-failure-limit 3 --interval-s 10 --max-seconds 120 \
  --local-dir raw -- \
  /data/local/tmp/kalsahtp/llama-bench -m /data/local/tmp/LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q8_0.gguf \
  -p 64 -n 16 -r 1 --no-warmup -t 8 -o jsonl -ngl 0 --load-mode none -fa on --ubatch-size 1024
```
**Setup (before launching):** Make the guard script non-executable:
```sh
adb shell 'chmod 000 /data/local/tmp/q56_thermal_watchdog/thermal_guard.sh'
```
**Teardown (after test):**
```sh
adb shell 'chmod 755 /data/local/tmp/q56_thermal_watchdog/thermal_guard.sh'
```
**Logic:** Guard script can't execute → guard process dies immediately → `wait_for_guard_ready` times out → `GuardLivenessError` raised → launcher kills workload.

**Expected artifacts:**
- `reval_test4_noguard.guard.log` = empty or absent (guard never started).
- `reval_test4_noguard.guard.rc` = absent (guard never wrote rc).
- `reval_test4_noguard.workload.rc` = absent (workload killed by supervisor trap before writing rc).
- `reval_test4_noguard.manifest.json`: `guard_liveness_abort` = true, `abort_reason` = `"guard_liveness_abort:guard did not publish a first sample within two poll intervals"`, `binary_pid` = null or wrapper PID, `guard_pid` = null.
- Launcher exit code = 75 (`EXIT_GUARD_LIVENESS`).
- No llama-bench processes on device after test (`ps -A | grep llama` = empty).

---

#### New Finding K: Launcher cannot distinguish on-device sensor kills from normal kills

**File:** `launch_with_guard.py:300-305`
```python
if guard_rc == 2:
    return 0
if guard_rc != 0 or workload_rc != 0:
    return 1
```

When the guard exits 3 (sensor error kill), the launcher returns 1. This is indistinguishable from a generic failure. The manifest `abort_reason` is empty because the sensor error is detected on-device, not by the launcher.

**Severity: LOW.** The workload IS killed (safe), but post-hoc analysis can't distinguish "device was too hot" from "dumpsys was too slow" from the manifest alone. The guard log has the answer, but the manifest doesn't.

**Status: CONFIRMED.**

**Fix:** Have the guard write a structured kill-reason file (e.g., `REASON=SENSOR_ERROR`) alongside `guard.rc`. The launcher reads it into `abort_reason`. Or: the launcher parses the last line of the guard log for `SENSOR_ERROR` / `KILL_THRESHOLD` / `HARD_ABORT` / `BATTERY_LOW_ABORT`.

---

### 4. RE-AUDIT SUMMARY

| Category | Count |
|----------|-------|
| Original FIXED | 17/19 (1 PARTIAL, 1 REFUTED) |
| New findings | 6 (A-F) + 4 sub-findings (G-J) + 1 (K) |
| Severity distribution | 0 HIGH, 1 MEDIUM (E), 4 LOW (A, D, H, K), 1 VERY LOW (B), 5 NONE (C, F, G, I, J) |

**MEDIUM finding E** (false kill under binder load) is the only finding that could cause an incorrect workload termination. It is an inherent trade-off of fail-closed design and is acceptable for safety, but must be documented.

**Test 3** (sensor failure simulation) is the critical new validation that proves the fail-closed path works. Without it, the sensor-failure kill path is untested code.

**Test 4** (guard-not-ready) proves the launcher's liveness check catches a dead guard and kills the workload. This was the highest-risk gap in the original audit.

---

**SAFE-TO-USE-after-revalidation.** All original HIGH findings are FIXED. The one new MEDIUM finding (false kill under binder load) is an acceptable safety trade-off. The four-test re-validation matrix (kill path, pass-through, fail-closed sensor, guard-not-ready) covers all critical paths. Execute the matrix on a real device before production use.
