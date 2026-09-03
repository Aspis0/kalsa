# AUDIT-PRERUN — Cell #52 (QRD7675 / 7+ Gen 3)

**Date:** 2026-09-03. **Severity model:** a bug here burns a paid QDC session minute. Every line is guilty until proven.

---

## F1 — FATAL: `connect.sh` never passes `$1` to `d_run.sh`

**Severity:** SESSION-KILLING. The intended one-command launch flow is broken.

- `connect.sh:65` — `exec "$DIR/d_run.sh"` (no arguments)
- `d_run.sh:4` — `JOB="${1:?usage: d_run.sh <job_tag>}"` (requires `$1`)

**What happens:** connect.sh brings up the tunnel, loops until adb sees the device, then exec's `d_run.sh` with zero arguments. `set -u` + `${1:?...}` aborts immediately. The SSH tunnel is left orphaned (nohup'd, no cleanup path). User sees:

```
d_run.sh: line 4: : usage: d_run.sh <job_tag>
```

**Verdict:** CONFIRMED. Concrete failing input: any invocation of `connect.sh` with no further args after tunnel-up.

**Fix:** connect.sh must either (a) extract JOB from the HOST (it already does: `JOB=$(printf '%s\n' "$HOST" | sed 's/\..*//')` on line 26) and pass it: `exec "$DIR/d_run.sh" "$JOB"`, or (b) take a second argument.

---

## F2 — FATAL: `timeout` not in Android toybox → every arm dies with exit 127

**Severity:** SESSION-KILLING. All four arms produce zero benchmark data. 45–70 min of QDC time burned for nothing.

- `d_run.sh:67` — `timeout $2 sh -c 'LD_LIBRARY_PATH=$D $3' > $1.out 2>&1`

**What happens:** Android's toybox does not ship `timeout`. The `sh -c` on the device searches PATH (`/sbin:/system/sbin:/system/bin:/system/xbin:/vendor/bin:/vendor/xbin`), finds nothing, and prints `sh: timeout: not found` to stderr (captured in `.out`). Exit code 127 is written to `.exit`. No benchmark runs.

**Evidence:**
- The reference driver (`qdc-8elite-npu-v79-clsB-51/d_run.sh`) does NOT use `timeout` at all — it uses a Mac-side `elapsed()` / `over()` check instead (lines 20–21, 64).
- Android toybox source: `timeout` was never added. QDC devices are stock Android without busybox.

**Verdict:** CONFIRMED (high confidence — can't run `adb shell which timeout` from here, but the reference driver's avoidance of `timeout` is strong corroboration).

**Fix:** Either (a) bundle a statically-linked `timeout` binary in the kit, or (b) replace the device-side timeout with a Mac-side wrapper (like the reference driver), or (c) use `busybox timeout` if available (check during recon). Option (b) is the proven pattern.

---

## F3 — CRITICAL: Gate abort not implemented (PREREG divergence)

**Severity:** PREREG §Procedure step 7 promises: *"on GATE_FAIL wait 60 s, retry ×3, then abort remaining arms (partial cell banks what ran)"*. d_run.sh does not honor this.

- `d_run.sh:65` — `gate_or_abort "$1" || return 7` (run_arm returns 7 on gate failure)
- `d_run.sh:55–58` — all four `run_arm` calls ignore the return value:
  ```
  run_arm tbo_mm     1200 "./test-backend-ops test -b GPUOpenCL -o MUL_MAT"
  run_arm tbo_mmid   1200 "./test-backend-ops test -b GPUOpenCL -o MUL_MAT_ID"
  run_arm bench_cpu  1500 "taskset $CPU_MASK ./llama-bench ..."
  run_arm bench_gpu  1500 "taskset $CPU_MASK ./llama-bench ..."
  ```
- `d_run.sh:5` — `set -u` (no `-e`), so non-zero return from `run_arm` is silently ignored.

**What happens:** If the thermal gate fails 3× on `tbo_mm`, the arm is skipped but `tbo_mmid`, `bench_cpu`, `bench_gpu` all proceed. The script burns gate-retry time (3 × 60s = 3 min) on every subsequent arm too, each failing the same way. Total waste: 12+ min of gate retries, plus the arms themselves may run if the device cools during the wait.

**Verdict:** CONFIRMED. Silent divergence from PREREG §Procedure step 7.

**Fix:** Chain the run_arm calls with return-code checks:
```bash
run_arm tbo_mm 1200 "..." || { log "ARM_ABORT tbo_mm"; ABORT=1; }
[ "$ABORT" = 0 ] && run_arm tbo_mmid 1200 "..." || { log "ARM_ABORT tbo_mmid"; ABORT=1; }
# etc.
```

---

## F4 — HIGH: `run_arm` doesn't check `adb shell` exit → silent data loss

**Severity:** Wastes an arm + produces a file that looks like a successful-but-empty run.

- `d_run.sh:67` — the `adb -s "$SER" shell "..."` exit code is never captured.
- `d_run.sh:70` — `adb -s "$SER" pull "$D/$1.out" "$RAW/$1_$JOB.out" >/dev/null 2>&1` (pull failure silenced by `2>&1` redirect).
- `d_run.sh:71` — `echo "nproc=$NPROC cpu_mask=0x$CPU_MASK exit=$E" >> "$RAW/$1_$JOB.out"` (creates file even if pull failed).

**What happens:** If the adb tunnel drops mid-arm, the `adb shell` command fails. The `.exit` file may not exist. `E` is read as empty string. The pull fails silently. The Mac-side `.out` file gets only the metadata line (`nproc=... cpu_mask=... exit=`). This looks like a valid but empty run — not an obvious failure.

**Verdict:** CONFIRMED. The `exit=` field being empty is indistinguishable from `exit=0` without careful inspection.

**Fix:** Check the adb shell exit code. If non-zero, log ABORT and skip the pull+metadata append. At minimum, don't append metadata if the pull failed.

---

## F5 — HIGH: No Mac-side timeout on `adb shell` → indefinite hang

**Severity:** If the SSH tunnel drops or the device becomes unresponsive, `d_run.sh` hangs forever. No QDC session cleanup happens.

- `d_run.sh:67` — `adb -s "$SER" shell "cd $D && ..."` with no `timeout` wrapper.
- `d_run.sh:68` — `adb -s "$SER" shell "cat $D/$1.exit ..."` — same.
- All `adb shell` calls in recon (lines 14–19) also have no timeout.

**What happens:** adb's default connection timeout is long (minutes). If the tunnel TCP connection stalls (not resets), adb waits. The script blocks at the `adb shell` call with no Mac-side watchdog.

**Verdict:** PLAUSIBLE. Depends on tunnel behavior under failure. Some adb versions have built-in timeouts, but they're not reliable over SSH tunnels. The reference driver has the same weakness.

**Fix:** Wrap all adb calls with `timeout 300 adb -s "$SER" shell "..."` (Mac-side `timeout`, which IS available on macOS).

---

## F6 — HIGH: `tar xzf` + `chmod` failure not guarded

**Severity:** If tar fails (corrupt kit, disk full on /data), subsequent arms run against missing binaries and waste QDC time.

- `d_run.sh:33` — `adb -s "$SER" shell "cd $D && tar xzf kit.tgz && chmod 755 llama-bench llama-cli test-backend-ops governor-bench"`

**What happens:** The `&&` chain means if `tar xzf` fails, `chmod` is skipped. The adb shell exits non-zero. But the script doesn't check this exit code. It proceeds to push the model and run arms. Each arm fails because the binary is missing. The `.out` files contain `./llama-bench: not found` or similar.

**Verdict:** CONFIRMED. No guard on a critical setup step.

**Fix:** Check the exit code: `adb -s "$SER" shell "..." || { log "KIT_EXTRACT_FAIL"; exit 5; }`

---

## F7 — HIGH: No abort if `/vendor/lib64/libOpenCL.so` is missing

**Severity:** Recon checks for the file but doesn't act on its absence. OpenCL arms will crash.

- `d_run.sh:18` — `adb -s "$SER" shell "ls -la /vendor/lib64/libOpenCL.so 2>&1"` (output captured in recon file).
- No subsequent check of the recon output for OpenCL presence.

**What happens:** If the device doesn't have the vendor OpenCL library, the kit binaries (which have `NEEDED libOpenCL.so`) will fail with `CANNOT LINK EXECUTABLE`. Both R1 (correctness) and R3 (GPU bench) waste their full timeout.

**Verdict:** CONFIRMED. PREREG §Procedure step 2 says recon checks this, but the script treats recon as logging only.

**Fix:** Add after recon:
```bash
grep -q 'libOpenCL.so' "$RAW/recon_$JOB.txt" || { log "NO_OPENCL_LIB"; exit 5; }
```

---

## F8 — MEDIUM: `taskset` mask is bare hex (no `0x` prefix) → misread as decimal

**Severity:** Works by coincidence for this SoC, fragile for others.

- `d_run.sh:42` — `awk '{m += 2^$1} END{printf "%x", m}'` outputs bare hex, e.g., `f0`.
- `d_run.sh:57` — `taskset $CPU_MASK` passes bare hex to toybox taskset.

**What happens:** Android toybox `taskset` uses `strtoul(..., 0)` which auto-detects base: `0x` → hex, bare → decimal. Without `0x`, `f0` is read as decimal 240 = hex `0xf0`. For this SoC (cores 4–7 = mask `0xf0`), decimal 240 = hex `0xf0` — same value by coincidence. For a mask like `0x110` (decimal 272), bare `110` would be read as decimal 110 = hex `0x6e` — **wrong mask, wrong cores**.

**Verdict:** CONFIRMED for the general case. PLAUSIBLE that it works for this specific SoC. The coincidence won't hold for all topologies.

**Fix:** Change the printf: `printf "0x%x", m`

---

## F9 — MEDIUM: `set -u` without `set -e` → silent intermediate failures

**Severity:** Most critical failures are caught by explicit checks, but some intermediate commands fail silently.

- `d_run.sh:5` — `set -u` (nounset only, no errexit).
- `d_run.sh:33` — tar/chmod failure exits silently (covered by F6).
- `d_run.sh:67` — adb shell failure exits silently (covered by F4).

**What happens:** Any command that fails in a pipeline or subshell doesn't abort the script. The reference driver uses `set -eu` (line 7). This is a deliberate choice difference — the current driver relies on explicit exit-code checks. But some checks are missing (F4, F6, F7).

**Verdict:** PLAUSIBLE. Not a bug per se, but the combination of `set -u` + missing guards creates a class of silent failures.

**Fix:** Consider switching to `set -eu` and handling specific failures with `|| true`. Or add guards for all critical commands.

---

## F10 — LOW: connect.sh hardcoded SSH key path

**Severity:** Only matters if the key moves or the user changes.

- `connect.sh:7` — `KEY="/Users/marco/.ssh/qdc_ed25519"`

**Verdict:** CONFIRMED but low impact — this is a personal workstation script.

**Fix:** None needed; document the dependency.

---

## Logic vs PREREG: Divergence Summary

| PREREG Promise | d_run.sh Implementation | Status |
|---|---|---|
| §1: tunnel via connect.sh on port 6037 | connect.sh binds 6037, passes to d_run.sh | ⚠️ F1 breaks the handoff |
| §2: recon captures SOC, freq, OpenCL, mem | Recon captures all fields ✓ | ✅ |
| §2: "4 highest-max-freq cores define CPU_MASK" | Computed dynamically from recon ✓ | ✅ |
| §3: push + sha256 verify, mismatch = exit 5 | Implemented ✓ | ✅ |
| §4: R1 correctness, caps 20 min | Implemented, caps match ✓ | ✅ |
| §5: R2 CPU bench, cap 25 min | Implemented ✓ | ✅ |
| §6: R3 GPU bench, same + `-ngl 99` | Implemented ✓ | ✅ |
| §7: Thermal gate PRE each arm, retry ×3, **abort remaining** | Retry ×3 ✓, **abort NOT implemented** | ❌ F3 |
| §7: Thermal snapshot POST each arm | Implemented ✓ | ✅ |
| §8: Pull all raw outputs | Implemented ✓ | ✅ |
| mask + nproc recorded in every bench file | Appended to .out ✓ | ✅ |
| G4: model fails to load → abort bench, keep recon | **No model-load check** | ❌ F11 |

---

## F11 — MEDIUM: No G4 (model load failure) abort path

**Severity:** PREREG §Procedure step 4 / Grid G4: *"model fails to load (RAM/other) → abort bench arms, keep recon + correctness; cell still banks Q1."*

- `d_run.sh:55–58` — bench arms use `-m lfm26.gguf` but there's no pre-check that the model loads.
- If the model is too large for device RAM, `llama-bench` will fail with an OOM or allocation error inside the 25-min timeout.

**What happens:** R1 (correctness, no model) might pass. R2/R3 (bench, needs model) burn their full 25-min timeout each trying to load a model that won't fit. G4 says abort bench arms and keep R1. The script doesn't implement this.

**Verdict:** CONFIRMED. PREREG promises a G4 abort path that doesn't exist.

**Fix:** After R1, do a quick model-load probe:
```bash
adb -s "$SER" shell "cd $D && LD_LIBRARY_PATH=$D ./llama-cli -m lfm26.gguf -n 1 -p 1" 2>&1 | head -5
```
Check for OOM/allocation errors. If found, skip R2/R3.

---

## Race/Hang Analysis

| Scenario | Behavior | Risk |
|---|---|---|
| Tunnel drops mid-recon | adb shell hangs (F5). Script blocks. | HIGH |
| Tunnel drops mid-arm | Same hang. No Mac-side watchdog. | HIGH |
| Device reboots mid-session | adb loses device. Next `adb devices` returns empty. | MEDIUM (detected by SER check at top) |
| Gate script fails to connect | gate_or_abort retries 3× with 60s sleeps. Then continues anyway (F3). | MEDIUM |
| Two concurrent connect.sh | First kills old tunnel (line 35–38). Second starts clean. | LOW (handled) |

---

## Test Hygiene

| Concern | Assessment |
|---|---|
| Re-run with same $JOB | Overwrites raw/ files. Acceptable. |
| Re-run with different $JOB | Separate raw/ files. No collision. ✓ |
| Leftover device state | $D (`/data/local/tmp/kalsa52`) persists. Old `.out`/`.exit` files cleaned per-arm (`rm -f $1.exit`, `>` truncates `.out`). ✓ |
| Kit re-extraction | `tar xzf` overwrites. `chmod 755` is idempotent. ✓ |
| Model re-push | `adb push` overwrites. SHA check re-runs. ✓ |

---

## PREREG Prose: Internal Contradictions

1. **Grid G4 vs Procedure step 7:** G4 says "abort bench arms, keep recon + correctness". Step 7 says "abort remaining arms" on thermal gate failure. These are different abort triggers (model load vs thermal), but the script implements neither.

2. **Procedure step 5 says `-r 3` (3 repeats).** The GPU bench (step 6) says "same + `-ngl 99`". This implies 3 repeats for GPU too. d_run.sh does this correctly. No contradiction, just verifying.

3. **Cost estimate: "Push ~1.6 GB"** — kit is ~50 MB (tar listing shows ~9 binaries + libs), model is 1.5 GB. Total ~1.55 GB. Estimate is close. Not a contradiction.

---

## FIX LIST (ordered by severity)

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | FATAL | F2: `timeout` not in Android toybox | Replace with Mac-side timeout wrapper or bundle static `timeout` binary |
| 2 | FATAL | F1: connect.sh doesn't pass $1 to d_run.sh | Change `exec "$DIR/d_run.sh"` to `exec "$DIR/d_run.sh" "$JOB"` |
| 3 | CRITICAL | F3: Gate abort not implemented | Chain run_arm calls with `|| { ABORT=1; }` and check before each subsequent arm |
| 4 | HIGH | F4: run_arm doesn't check adb shell exit | Check exit code; skip pull+metadata on failure |
| 5 | HIGH | F5: No Mac-side timeout on adb shell | Wrap adb calls with `timeout 300 adb ...` |
| 6 | HIGH | F6: tar/chmod failure not guarded | Add `|| { log "KIT_EXTRACT_FAIL"; exit 5; }` |
| 7 | HIGH | F7: No abort on missing OpenCL lib | Parse recon output for libOpenCL.so presence |
| 8 | MEDIUM | F8: taskset mask bare hex | Change printf to `0x%x` |
| 9 | MEDIUM | F11: No G4 model-load abort | Add model-load probe after R1 |
| 10 | MEDIUM | F9: `set -u` without `set -e` | Consider `set -eu` or add missing guards |
| 11 | LOW | F10: Hardcoded SSH key path | Document dependency |
