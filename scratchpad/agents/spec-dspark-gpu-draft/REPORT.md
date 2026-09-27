# REPORT — fixes for hostile audit dd6bdb56 (section B, cell spec-dspark-gpu-draft)

Status after fixes (round 9, S23 run 3: missing context): `./dryrun.sh > /tmp/drB9.log 2>&1; echo "EXIT=$?"` → **`SUMMARY pass=347 fail=0`, `EXIT=0`** (round 8: 333, round 7: 303, round 6: 302, round 5: 277, round 4: 233, round 3: 209, round 2: 182, round 1: 147; current run copied to `raw/dryrun_summary.txt`); red with the ctx/fit flags stripped: `/tmp/drB9_red.log`, **EXIT=1, 86 FAIL / 261 PASS**; `./shape_check.sh` → **`SHAPE_EXIT=0`** (`raw/shape_check.log`); host `./host_calib.sh` (9 runs) and `./host_smoke.sh` at `-t 5` → **EXIT=0** (`raw/host_calib_summary.log`, `raw/host_smoke.log`); round-1 dry-run was 147/0. No phone, no adb, no sub-agents. Every CONFIRMED finding of both rounds is fixed in code; deviations and the PLAUSIBLE-adjacent choices are justified below. `PLAN.md` predictions were rewritten after audit round 1, dated, before any device run (threads unchanged by round 2: everything was already at the `-t 5` preset except the device arms — NEW-0).

## B-1 (BLOCKER) — kill on every abnormal exit, and the kill is verified

`d_run.sh: kill_spec_verified()` is now the ONLY kill path for this cell's binary: `pkill -f 'llama-speculative-simpl[e]'` (bracketed, never self-matches), then a verdict loop — the device answers exactly one of `GONE` / `ALIVE` / `PGREP_BROKEN` (3 tries, 1 s apart). `GONE` → `KILL_VERIFY ... result=gone`; `ALIVE` after 3 tries → `KILL_VERIFY_FAIL` file + loud log; **`PGREP_BROKEN` (tool missing/broken) is never treated as gone** — a false "gone" would be exactly the silent failure the audit warns about. It is called from: `cleanup` (when rc ≠ 0, any signal, `stop_request` present, or `KILL_NEEDED=1` for void sessions), `finish_stop`, the poll's stop path, and every arm timeout (rc ≥ 124). Fixtures: sigterm (143, gone), sighup (129, gone), thermal stop (gone at `stop_thermal_status`), timeout (gone at `timeout_A-p`), **kill-fail** (`DRY_KILL_FAIL=1` → `result=ALIVE` + marker), **pgrep-broken** (`result=pgrep_broken` + marker). `stop_lib.sh: request_stop` still pkills `llama-completio[n]` — wrong binary for this cell — so this cell kills its own binary beside it; the fake models the same split (stop_lib's pkill does not remove the fake process).

## B-2 (HIGH) — a real restore path, SIGKILL-proof

New standalone `restore.sh` in this cell (written here rather than copied from qdc-heat-3way: that file carries sampler/heat-path baggage we do not have, and its cell is in flight; same contract: work from `.restore-state` alone, runnable after a SIGKILL). `d_run.sh` **never deletes `.restore-state`**: at start a stale state is repaired first (`STALE_RESTORE state_present`), and if it survives the repair the run refuses to proceed (exit 7) instead of overwriting it — the audit's "second run restores the mutated value" path is gone. Also fixed the A-7 pattern (empty `settings get` → `null`, never an empty state value). Fixtures: **sigkill** (state left behind with mutated 1800000/3, standalone `restore.sh` returns 60000/1 and consumes the state) and **rerun-after-kill** (second run logs `STALE_RESTORE` and still ends at 60000/1). The driver's own `cleanup` delegates to `restore.sh` (one implementation).

## B-3 (HIGH) — void is never success

Match failure → `finalize_results void` + `write_end match_void` + **`exit 3`** — stricter than the audit's suggested `exit 0`: any wrapper sees a non-zero rc and `END.txt` says `match_void`. `results.tsv` gains the audited **`final` column**: `proof` (attempt-0 rows), `matched` (the five rows that make the matched N), `superseded` (earlier OK attempts), `void` (VOID rows), `void_match` (OK rows in a void session). The old dry-run encoding is inverted: the timeout fixture now asserts `rc=3 / END=match_void` (it previously asserted `exit_0`), plus a **matchvoid** fixture (`DRY_NEVER_MATCH_ARM=B4`): rc 3, `END=match_void`, 0 `matched`, 11 `void_match`, 5 `proof`, no `MATCH ok` line.

## B-4 (HIGH) — thermal confound

`cooldown_wait` runs before EVERY device run (every proof and every measure attempt): it gates (`hard_stops`) and then waits for skin ≤ `COOL_TARGET_C` (37.0), capped at `COOL_MAX_S` (720 s) after which the arm still runs but is flagged `warm_start=1`. Rows carry `cooldown_s / warm_start / skin_before / skin_after`, so probe rows and (hotter) adjustment rows are comparable and auditable. Fixture **cooldown** (skin 38.5, cap 1): row shows `warm=1, waited=1, skin=38.5`, session still completes. Justification (PLAUSIBLE-adjacent choice): I did **not** add a 1 Hz skin sampler — the sister audit A-11 shows a sampler inside the measured window is itself a perturbation; before/after gates + cooldown are what the comparison needs, and the raw readings live in `stop_lib`'s `safety.log`.

## B-5 (MEDIUM-HIGH) — `-lv 5` out of the timed window

Each arm now runs two kinds of run (`arm.sh`): a short **proof run** `-n 4 -lv 5` with `GGML_OPENCL_LOG_KERNELS=1` (placement is `LLAMA_LOG_DEBUG`, absent at default verbosity on the real device — the sister cell's committed S23 log proves it), and the **measured runs at default verbosity** with no kernel env. `arm_parse_proof` (placement/dispatch/order) and `arm_parse_measure` (N, tps, accept) are separate; the proof attaches to the arm's rows as `final=proof`. Fixtures: proof log contains ` D load_tensors: layer ... assigned`, measured log contains **zero** `assigned to device` lines, kernel lines exist only in proof logs (exactly 6, unprefixed).

## B-6 (MEDIUM-HIGH) — convergence no longer circular

The fake's overshoot is now content-dependent: `DRY_JITTER=1` gives adjustment attempts `o = nmax` instead of `nmax+1`, so one adjustment cannot be enough by construction; `MATCH_MAX` default raised to **4**. Fixtures: **jitter** converges only at the second round (15 rows, tag `B4-m2` present, `MATCH ok n=136`) and **matchvoid** never converges → B-3's void path. Host side: the matched-N arithmetic re-measured at `-t 5` (`A@135 → 136`, `B4@131 → 136`, `B4@123 → 128` — `raw/host_calib_summary.log`). The audit's alternative (fixed N via `--ignore-eos`) is impossible: B-1 established the flag is dead code in this binary.

## B-7 (MEDIUM) — the push window is supervised

The multi-GB push runs under the arm poll; `safety_gate after_push` sits between the push and the `tar`/`sha256sum -c`; a stop request is checked before unpack. Fixture **push** (`DRY_PUSH_SLEEP_S=1`, temp stop at read 4): `END=stop_battery_temp`, `stop_request` written, **no** `KIT_AND_MODELS_VERIFIED` (unpack never ran), kill verified.

## B-8 (MEDIUM) — battery sensor trust

`d_run.sh` sources `../qdc-heat-3way/battery_trust.sh` (same dependency contract as its own driver: `adbT`, `log`, `RAW`, `SER`) and no longer hard-codes `BATTERY_UNTRUSTED=0`; the verdict is logged and written to `RAW/battery_trust.txt`, which arms `stop_lib`'s skin ≥ 46 °C stop. Fixture **untrusted** (`DRY_SYSFS_TEMP=999`: dumpsys ≠ sysfs on both samples) → `BATTERY_SENSOR_UNTRUSTED`, `untrusted=1`, session completes. Justification: an S23 skin-vs-battery measurement was impossible here (no phone), so the harness is the only sanctioned option; risk noted — it is the sister cell's file and may move with its audit; the interface used is exactly the one that cell's driver calls.

## B-9 (LOW) — SIGHUP

`trap 'on_signal HUP 1' HUP` added beside INT/TERM; same kill+restore path; fixture **sighup** (rc 129, `END=signal_HUP`, kill verified, restore ran).

## B-10 (LOW-MED) — unprotected adbT and the poll's child

Setup reads are wrapped (`|| { log "ADB_FAIL at <step>"; exit 2; }` for wait-for-device, getprop, settings get/put, wakeup/stayon/timeout; devices discovery `|| SER=""`; `battery_trust_check || exit 3`) — a raw adb rc can no longer kill the driver silently. The poll subshell traps TERM/INT/HUP to kill its own in-flight adb child, and it checks parent liveness (`kill -0 $DRIVER_PID`) every tick so a **SIGKILLed driver leaves no orphan poll** (fixture sigkill: read counters stable over 2 s after the kill).

## B-11 (LOW) — fake log fidelity

Every fake logger line now carries the `<h>.<mm>.<ss>.<ms> <L> ` prefix (`D` for placement, `I` for stats/marker), byte-shape taken from the committed S23 log `qdc-heat-3way/raw/s23-cli-heat-20260926/...t1cpu.log:47-50` and a host `-lv 5` capture; `EXIT=` (shell echo) and `GGML_OPENCL_LOG_KERNELS:` (fprintf) stay unprefixed, as on the device. The happy fixture asserts both directions: ` I n_predict = 136` present, `EXIT=0` present at line start, kernel lines at line start — so a future anchored regex is exercised by the dry-run.

## B-12 (LOW-MED) — model-order assumption

`arm_parse_proof` now asserts ≥1 placement line **before** the draft-load marker (target model loaded first, `head -n marker-1` vs `tail -n marker+1`) and voids `model_order_unknown` otherwise; the happy fixture asserts `pre_place=24` in the proof rows. A reversed order on-device can no longer silently attribute the target's segment to the drafter.

## (2) measurement validity — ARM_TPS sanity

`arm_parse_measure` voids `no_stats` when the `speed:` field is missing or non-numeric (the primary metric cannot vanish under `status=OK`); happy asserts `tps=17.000` on the B8 row. Row schema is now 17 columns + `final`; all dry-run column assertions were updated to it.

## 3-way decisions applied

- Backend proofs from a short `-lv 5` proof run; measured arms at default verbosity (A-1/A-2/B-5 above).
- Host threads `-t 5` (S23 app preset) in `host_smoke.sh`/`host_calib.sh`, re-run, EXIT=0; `-ngld 0` added so a drafter-flag typo dies on the host. **Device arms are `-t 5` too, everywhere** (audit2 NEW-0): owner decision, S23 app preset `sd-8-gen2` decode5/prefill5 (`kalsa/src/engine/deviceTuning.ts:217-219`); the round-1 justification for keeping `-t 8` on device leaned on "the sister cell also runs `-t 8`", a premise commit `5ba47a93` invalidated — cell A moved to `-t 5` on device and this cell followed. `arm.sh` `arm_cmd` is the single command used by both proof and measured runs.
- `trap` on HUP (B-9). Poll covers load: in this cell load happens inside the timed arm call, so the poll spans load+decode; the push window and every proof run are polled too (B-7).

## stop_lib.sh (parallel fix)

Still **sourced** from `../qdc-heat-3way/stop_lib.sh`, never copied, never edited. **No new function is requested from it**: its contract (`log`, `adbT`, `RAW`, `SER`, `BATTERY_UNTRUSTED`, `live_readings`, `hard_stops`, `safety_gate`, `request_stop`) covers every use here. The one gap — `request_stop` pkills `llama-completio[n]`, the wrong binary for this cell — is covered by this cell's own verified `kill_spec_verified`; if the parallel fix ever adds a generic kill hook, we would call it instead of ours, but nothing in this cell blocks on that.

## AUDIT2 (round 2, dd6bdb56) — fixes

Dry-run after these fixes: **`SUMMARY pass=182 fail=0`, `EXIT=0`** (`raw/dryrun_summary.txt`); all scripts `bash -n` clean.

- **NEW-0 (BLOCCANTE)** — `arm.sh arm_cmd`: `-t 8` → **`-t 5`** in the single command used by proof AND measured runs, with the owner citation in the header (S23 app preset `sd-8-gen2` decode5/prefill5, `deviceTuning.ts:217-219`). The round-1 justification (line 60, now rewritten) rested on "the sister cell also runs `-t 8`", a premise `5ba47a93` invalidated; cell A moved to `-t 5` on device and we followed. `PLAN.md` arms header + prediction wording updated; host scripts were already `-t 5` (re-run, EXIT=0).
- **NEW-1** — `restore.sh`: `rm -f .restore-state` only under `if [ "$rc" -eq 0 ]`; a failed restore logs `restore_failed_keep_state rc=…` and KEEPS the state, so the pre-run values survive and the next run repairs instead of clobbering. Fixture **restorefail** (2 phases): failed restore → state kept + device still 1800000 + keep-logged; second run without the knob → `STALE_RESTORE` repair, state consumed, ends at 60000/1.
- **NEW-2** — the poll's parent-liveness branch now calls `kill_spec_verified "parent_gone"` before exiting. Fixture **sigkill** asserts `KILL_VERIFY reason=parent_gone` + the bracketed pkill (beside the old poll-died assertion).
- **NEW-3** — `results.tsv` is born **18 columns** (header includes `final`), `write_row` writes `final=pending`, `finalize_results` rewrites field 18 in place (never appends), and `cleanup` finalizes any un-finalized file via the `FINALIZED` flag — stop paths, `exit 5/6/7`, deadline and void all leave 18 columns; only a SIGKILL can leave `pending`. `cols18_bad == 0` asserted on happy, thermal, timeout, sigkill, deadline.
- **NEW-4** — `tar -xzf` + `sha256sum -c` now run under the poll (start/stop around them, `stop_request` checked before `KIT_AND_MODELS_VERIFIED`).
- **NEW-5 (owner mandate)** — two layers. (1) **Positive self-test at setup**: `pgrep_selftest` spawns a `sleep 12345` whose cmdline is assembled at runtime (nothing in the wrapper's own cmdline contains the literal, so `sh -c` can never self-match), proves `pgrep -f` FINDS it and `pkill` cleans it (`PGREP_SELFTEST=FOUND` + `PGREP_SELFCLEAN=GONE`), else **`exit 4` before any mutation** — fixture **selftestfail** (rc4, `END=exit_4`, marker, settings untouched, no state written). (2) Kill-time health probe: `pgrep -f zzz_no_such_proc_zzz` must answer `PROBE=1` before any GONE verdict — fixture **pgrepbreaklater** (`DRY_PGREP_BREAK_AT=2`: self-test passes, probe breaks → `result=pgrep_broken` + `KILL_VERIFY_FAIL`). The probe alone cannot catch a busybox pgrep that returns 1 on usage error — that class is closed by the positive self-test, which is exactly why the mandate asked for it. **Adoption**: if `stop_lib.sh` lands its own self-test, the sourced `stop_lib_pgrep_selftest` (or `pgrep_selftest`) wins — `d_run.sh` defines ours only when neither name exists (`declare -F` check at setup), so switching is automatic once the name lands.
- **NEW-6** — not fixable from this cell (the line belongs to the sourced library). Recorded as a request to the stop_lib owner: rename `KILL_VERIFIED` → `KILL_PROBE`, or accept a caller `KILL_PATTERN` (we would pass `llama-speculative-simpl[e]`). Until then the log distinction is documented at `d_run.sh: finish_stop` and here: `KILL_VERIFIED ctx=…` = the library probing for `llama-completion` (never run by this cell), `KILL_VERIFY reason=…` = this cell's verified kill of its own binary; every dry-run assertion keys on the latter only.
- **NEW-7** — `PROOF_N` 4 → **8**: the ≥4-distinct-kernel floor is judged over a multi-step drafter proof instead of a 4-token one (fixture asserts the proof row's `limit` = 8). Lowering the floor to 3 was rejected to keep the threshold's meaning.
- **NEW-8** — deadline: `d_run.sh <job_id> [deadline_minutes 20..110]` (default 60) plus the `DEADLINE_S` dry-run hook; `deadline_check` fires in `cooldown_wait`, `run_proof`, `run_measure` and the match loop → `END=deadline`, exit 124 (abnormal → kill+verify+restore). Fixture **deadline**: rc 124, `END=deadline`, kill verified, restore ran, header-only 18-column results.

## AUDIT3 (round 3, dd6bdb56) — fixes

All four actionable B findings accepted and fixed; the pre-flight one rejected below. Commands: `./dryrun.sh > /tmp/drB3.log 2>&1; echo EXIT=$?` → **EXIT=0, 209 PASS / 0 FAIL**; `for f in *.sh; do bash -n "$f" || echo SYNTAX_FAIL; done` → clean; negative control below → EXIT=1 as designed.

- **B-N1 (HIGH) — deadline inside the cooldown loop.** `d_run.sh:285`: `deadline_check` moved from once before `while :;` to the top of every iteration of `cooldown_wait` — a cold board can spin `COOL_MAX_S=720` there, and the budget now bites within `COOL_POLL_S`. Fixture **deadlinecool** (`dryrun.sh:343`): skin 38.5 keeps the loop spinning and `DEADLINE_S=8` expires mid-spin; asserts rc 124, `END=deadline`, **rows = 0** (no proof may have run), **no `COOLDOWN_CAP`** (deadline beat the 30 s cap), safety reads ≥ 4 (3 setup gates + ≥1 in-loop iteration, so the expiry landed inside the wait), kill verified, restore ran. **Negative control**: patching the old pre-loop-only check back in makes exactly this fixture fail (`rows expected=[0] got=[1]`, `beat-cap: cap fired before the deadline`), matrix EXIT=1 (`/tmp/drB3_negcontrol.log`); `d_run.sh` then restored byte-identical (`cmp` clean) and the full matrix re-run to 209/0.
- **B-N2 (agreed → fixed) — `FINALIZED` tells the truth.** `d_run.sh:312,327`: the flag is set only after `awk … && mv` really rewrote the file (missing file = trivially finalized); a failed rewrite leaves it 0 and removes the temp, so cleanup never reports an unfinished rewrite as done. No fixture (declared): forcing awk/mv to fail between those two commands needs a filesystem fault the fake cannot inject mid-run; two lines, single reader (cleanup's retry), verified by inspection.
- **Count cross-check (agreed → fixed) — `decoded <N>` vs `n_predict = <N>`.** `arm.sh:145-155`: after the tps sanity check the row's two copies of N are compared; missing, non-numeric or mismatched → `count_mismatch` void. Fake knob `DRY_N_DECODED_MISMATCH` (`fake-adb.sh:150`) offsets only the decoded line. Fixture **countmismatch** (`dryrun.sh:358`): all five probes void → `END=match_void`, rc 3, 10 rows, `final` = 5 proof / 5 void / 0 matched. (This fixture first caught MY wrong expectation — `final-void` is 5, not 10, because proofs stay `proof`; the assertion was corrected, not the code.)
- **`DEADLINE_S` range bypass (agreed → fixed).** `d_run.sh:33-37`: the seconds override is refused when `ADB_BIN` is the real adb (`exit 2` before any device call and before RAW creation); the minutes form keeps the 20..110 validation. Fixture **deadlines-guard** (`dryrun.sh:371`): rc 2, `dry-run-only` message, no `.restore-state`, no RAW dir.
- **REJECTED — pre-flight `CALIBRATE=1`-style placement run (audit3 B-low).** B's proof pass already runs before any measured arm and voids the whole session fail-closed when the `-lv 5` placement lines are absent, so the first B run discovers exactly what A's calibrate discovers; a second entry point would duplicate the driver for the same information.
- **Declared, not refactored (round-3 rule):** `d_run.sh` 536 lines (session orchestrator: setup → gates → arms → match → cleanup), `dryrun.sh` 384 lines (test matrix organized by `==` topic sections), `fake-adb.sh` 291, `arm.sh` 165 — pre-existing shape, left alone; no lines were moved to make a number.

## AUDIT4 (round 4, dd6bdb56) — fixes

Red→green: with only the fake/fixtures updated first → `/tmp/drB4_red.log`, **EXIT=1, 21 FAILs** covering exactly N-B2 (8), the item-3 self-match (6), N-B3 (3), N-B1 (2), N-B4 (2); after the code fixes → `/tmp/drB4.log`, **EXIT=0, 233 PASS / 0 FAIL**. `bash -n` clean on all 8 scripts.

- **N-B2 (BLOCKER) — turn-side backend evidence.** `arm.sh:63`: the measured turn now runs `-lv 4` — host matrix measured on f25f0c1c5: default == `-lv 3` admits NONE of the `LLAMA_LOG_INFO` placement lines, `-lv 4` admits INFO, DEBUG needs `-lv 5` — so `-lv 4` is the minimum that shows placement while the timed window stays free of DEBUG/per-op (audit B-5 upheld; same level as cell A's turn). `arm_parse_measure` (`arm.sh:170-207`) now: negative check `kernel set failed to build|device disabled` → `turn_backend_disabled` (the equivalent of cell A's `turn_backend_disabled`, qdc-heat-3way/arm.sh:236-240); `draft_marker_line` (shared with the proof parse) → require ≥1 `model buffer size` line after the marker (`turn_no_placement`), `offloaded ≥1/… layers to GPU` after the marker for C (`turn_placement_mismatch`) and zero for A/B (`turn_gpu_leak`). Fixture **turndisabled** (`DRY_TURN_DISABLED`, emitted only in the turn log): red before (rc 0, `MATCH ok` — the silent case, proof row OK) → green after (rc 3, `END=match_void`, 10 rows, `turn_backend_disabled`, proof row still `OK`/`proof`). `happy` gained the positive side: placement INFO in the turn log, GPU offload in C4's turn, none in B8's.
- **N-B1 (MEDIUM) — `DEADLINE_S` gated on the capability, not a path string.** `d_run.sh:38`: refused whenever `FAKE_ADB_STATE` is unset (any other real adb path now slips through nowhere). Fixture **deadlines-guard2** = the auditor's case B (`ADB_BIN=/nonexistent/adb DEADLINE_S=1`): red (RAW created, `NO_DEVICE`) → green (message, no RAW, no state; the stale RAW from the red run is removed before the fixture so the assertion is about THIS run).
- **item-3 (proven on the S23 tonight) — every pgrep/pkill -f audited:**

  | site | pattern | verdict |
  |---|---|---|
  | `d_run.sh:158` kill health-probe (was `pgrep -f zzz_no_such_proc_zzz` — plain literal in its own `sh -c`) | plain | **FIXED → `zzz_no_such_proc_zz[z]`** (plain literal no longer appears in the command string) |
  | `d_run.sh` verdict `pgrep -f 'llama-speculative-simpl[e]'` | bracketed | SAFE (no plain literal in the same string) |
  | `d_run.sh` kill `pkill -f 'llama-speculative-simpl[e]'` (cleanup/stop/timeout/poll) | bracketed | SAFE |
  | `restore.sh` kill | bracketed | SAFE |
  | `pgrep_selftest` (victim cmdline assembled at runtime via `q="sleep 12"; q="$q""345"`) | literal absent from the wrapper by construction | SAFE |
  | sourced `stop_lib.sh` `llama-completio[n]` pkill+pgrep | bracketed, plain `llama-completion` absent from the command string | SAFE — audited, **not edited** (sister cell; dccd4bb2 is editing it right now) |

  The fake now models the trap (plain-literal probe answers `PROBE=0` because pgrep would match its own wrapper; bracketed answers `PROBE=1`), so all six kill-verified fixtures went red in `/tmp/drB4_red.log` (`batt/thermal/timeout/sigterm/sighup kill-verified`, `killfail alive-recorded`) and green after the bracket fix.
- **N-B3 (LOW, agreed) — an unverifiable kill is visible in `END.txt`.** `d_run.sh`: `KILL_FAILED` set in every failure branch of `kill_spec_verified`; `finish_stop` appends `_kill_unverified`; `cleanup` rewrites an END written before the verdict existed (deadline, match_void, stop) and suffixes its own; `KILL_ATTEMPTED` makes the first kill own the verdict (no duplicate verdict lines). Fixtures updated: killfail / pgrepbreaklater → `signal_TERM_kill_unverified`, selftestfail → `exit_4_kill_unverified`.
- **N-B4 (LOW, agreed) — `ADB_PORT` validated in the driver** (`d_run.sh:26`, mirrors cell A): fixture **port-guard** (red run: it even started an adb daemon on 5038) → green: rc 2 + message + no RAW/state, before any adb call.
- **N-B5 (LOW, agreed → documented):** `decoded == n_predict` is verified only on host logs; if the S23 build disagreed, all five probes void as `count_mismatch` → `END=match_void`, rc 3, with `decoded=… n_predict=…` in the row's `proof` column — zero data, fully diagnosable, never a false number (said here next to the pre-flight rejection).
- **N-B6 (LOW, agreed → documented):** consumers must discard `final=pending` — it is produced only by a SIGKILL of the driver or a failed finalize rewrite; `finalize_results` never emits it (legal values: `void|proof|matched|superseded|void_match`).
- **N-B7 (LOW, PLAUSIBLE → rejected as a code change, one line):** the `parent_gone` kill can still lose the race when the device is unreachable at that instant — that is a reachability window no client-side retry can close; it is already attempted and registered (`KILL_VERIFY_FAIL`), and closing it needs a device-side watchdog this cell does not have.
- **Coordinator addition — fake adb syntax-checks every shell command:** `fake-adb.sh:221-231` runs `sh -n -c "$cmd"` before dispatching; a broken string appends CMD/ERR to `shell_syntax_errors.log` and exits 64; `dryrun.sh` asserts no such file exists across every fixture (`shell-syntax all-fixtures`). It found **nothing** in this cell (233/0 with the check active); the checker itself is proven by negative test: `fake-adb.sh … shell "if true; then echo oops"` → **EXIT=64** with `ERR: syntax error: unexpected end of file` in the log (artifacts removed after).
- **Declared, not refactored (round-4 rule):** `d_run.sh` 560, `dryrun.sh` 433 (topic-sectioned test matrix), `fake-adb.sh` 338, `arm.sh` 211 — pre-existing shape plus these mandated checks; no lines moved to make a number.

## AUDIT5 (round 5, dd6bdb56) — fixes

- **N-C1 (MEDIUM) — a partial drafter offload no longer passes as C4.** `arm.sh:188-202`: `turn_off` is now the offloaded-LAYER **count** (max N parsed out of `offloaded N/M layers to GPU` in the drafter's segment, not a line count) and the C gate is `turn_off -lt MIN_DRAFT_GPU_ASSIGN` — the same constant and rule as the proof; the A/B leak gate stays `-gt 0`. Fixture **turnpartial** (`dryrun.sh:446`, `DRY_TURN_PARTIAL=1`, C turns emit `offloaded 3/6`): C4/C8 void `turn_placement_mismatch`, their proofs stay `OK`, A/B still match to 136, rc 3, `END=match_void`, 12 rows, 0 matched. `happy` is the other side of the same threshold (C4's `6/6` ≥ 5 passes).
- **N-C2 — a fixture and a knob for every turn gate (knobs act on measure logs only, proofs untouched):** `DRY_TURN_NO_MARKER` → fixture **turnnomarker** (`dryrun.sh:427`, all 5 turns void `turn_no_marker`, proofs OK, 10 rows); `DRY_TURN_NO_PLACEMENT` → **turnnoplace** (`:436`, models "-lv 4 admits nothing" — a hypothesis the real logs now refute, see the table: `model buffer size` IS present in both -lv 4 S23 turn logs); `DRY_TURN_PARTIAL` → **turnpartial** (N-C1); `DRY_TURN_GPU_LEAK` → **turnleak** (`:458`, A/B void `turn_gpu_leak`, C4 matches, 11 rows). Each asserts proof `OK`, `matched=0`, `END=match_void`.
- **dash (coordinator item 3)** — `fake-adb.sh:253`: the syntax check now runs `/bin/dash -n -c` (POSIX, the closest available to the device's mksh; cell A does the same — AUDIT5 N-C7). Negative test re-run after the switch: `DASH_NEG_EXIT=64`, dash's own `expecting "fi"` message captured in `shell_syntax_errors.log` (artifacts removed).
- **item-4 — every line shape the parsers depend on, vs the REAL f25f0c1c5 S23 logs** (`qdc-heat-3way/raw/s23-calib-3/calib`, same ship model, `LC_ALL=C grep -a`; full table: `raw/shape_check.log`, script `shape_check.sh`, `SHAPE_EXIT=0`):

  | pattern (consumer) | verdict |
  |---|---|
  | `load_tensors: layer … assigned to device CPU/GPUOpenCL` (proof) | **MATCH** — 62 lines at -lv 5 with `D` level, **0 at -lv 4** → the proof/turn split is real |
  | `model buffer size` at -lv 4 (turn_no_placement) | **MATCH** — 2 cpu / 3 gpu lines: `-lv 4` admits INFO on the real S23 (answers N-C2's question with data) |
  | `offloaded N/M layers to GPU` regex (turn gates) | **MATCH** — accepts `offloaded 31/31`, excludes `offloaded 0/31` (cpu turn has none ≥1) |
  | `offloading output layer` / `offloading N repeating` | **MATCH** |
  | `llama_prepare_model_devices: using device GPUOpenCL … - 2512 MiB free` (informational) | **MATCH** — fake's `3536` corrected to the real `2512` |
  | `^GGML_OPENCL_LOG_KERNELS:` bare (proof dispatch) | **MATCH** — 15 with env in the load log, 0 in turns, line unprefixed |
  | `EXIT=<rc>` bare line | **MATCH** (1 per log) |
  | logger prefix `<h>.<m>.<ss>.<ms> <L>` | **MATCH** (216 lines) |
  | `kernel set failed to build\|device disabled` (turn_backend_disabled) | **ABSENT-HEALTHY** — 0 in healthy logs; shape from source `ggml-opencl.cpp:7255` |
  | stats `n_predict = <N>$` | **NOT-IN-S23 / MATCH on host** (spec-simple only) — and the real logs exposed the trap: completion prints `generate: … n_predict = 16, n_keep = 1`, which the old unanchored awk read as `$NF=1`; parser hardened to `$`-anchor (`arm.sh:151-157`), asserted by the check (unanchored=1, hardened=0) |
  | `decoded <N> tokens … speed:` (the metric) | **NOT-IN-S23 / MATCH on host** — llama-completion does not print it |
  | draft-load marker `… loading draft model` | **NOT-IN-S23 / MATCH on host** (spec-simple only) |
  | `n_threads` / `common_perf_print` | **INFO** — present, parsed by nobody in B (`n_threads = 5` confirms `-t 5` landed on the device) |

  **Fake emits the real shapes verbatim:** a normalized subset-diff in `shape_check.sh` proves the fake's offload / buffer / assigned / using-device / kernel-prefix sets ⊆ the real logs (all MATCH) — my previous `GPUOpenCL model buffer size` name and `3536 MiB` were MISMATCHES, now `OpenCL` / `2512` byte-identical; the target pair is copied from `calcpu.log` (`offloaded 0/31`, `CPU`+`CPU_REPACK` buffer lines). **Drafter-specific lines are NOT in those logs and stay UNVERIFIED** (stated, not hidden): `-devd`/`-ngld` behavior, `llama-speculative-simple`'s whole stats block (`n_predict/n_drafted/accept/decoded` — host-engine-verified only), the marker line, the `6/6` denominators for the 5-layer dflash (source-derived), drafter kernel names, and the disabled-WARN shape (source-derived). **Parser survival:** `shape_check.sh` runs `arm_parse_proof`/`arm_parse_measure` on the real logs — including their 6 non-UTF-8 lines — both return VOID (`no_draft_marker` / `no_stats`) with rc 0 and no crash. The check itself caught my own bug on its first run (3 false MISMATCHes: BSD grep BRE has no `+`; fixed to `grep -E`) — recorded honestly in `raw/shape_check.log`.
- **AUDIT5 LOWs outside this round's scope — deliberately untouched:** N-C3 (END rewrite not atomic: tmp+mv), N-C4 (exit code doesn't carry the kill verdict — consumption rule stays documented), N-C5 (`KILL_ATTEMPTED` suppresses a retry), N-C6 (stop_lib's `kill_unverified` marker unread here) — none blocks the S23 run, none was in the coordinator's list.
- **Declared:** `d_run.sh` 560, `dryrun.sh` 479 (topic-sectioned matrix), `fake-adb.sh` 368, `shape_check.sh` 171 (new, one responsibility: real-log shape verification), `arm.sh` 223 — pre-existing plus these mandated changes; no lines moved to make a number.

## AUDIT6 (conversation/interactive trap) — fixes

Red→green: with the knobs and fixtures but no gate → `/tmp/drB6_red.log`, **EXIT=1, 11 FAILs** (both fixtures: rc 0, `MATCH ok`); after the gate, the stdin redirects and the flag check → `/tmp/drB6c.log`, **EXIT=0, 302 PASS / 0 FAIL**; `bash -n` clean on 9 scripts.

- **Task 1 — the conversation-off flags, quoted from f25f0c1c5.** `common/arg.cpp:1899-1907`: `{-cnv, --conversation}` / `{-no-cnv, --no-conversation}` — "interactive mode is also enabled", "default: auto enabled if chat template is available"; `common/arg.cpp:1909-1914`: `{-st, --single-turn}` — "will not be interactive if first turn is predefined with --prompt". What bit cell A: `tools/completion/completion.cpp:170-177` (`COMMON_CONVERSATION_MODE_AUTO` + `common_chat_templates_was_explicit` → ENABLED, logging `chat template is available, enabling conversation mode (disable it with -no-cnv)`), templating at `completion.cpp:250`, banner at `:413` (`interactive mode on.`) and `:484` (`== Running in interactive mode. ==`); evidence `qdc-heat-3way/raw/s23-3way-5/s23-3way-5-t1cpu.log:204,214`. **This cell drives NO llama-completion command** — grep over all 9 scripts shows only comments, kit packaging and a sha-list; every arm, A included (since round-1 B2), runs `llama-speculative-simple` (`arm.sh arm_cmd`). So there is no completion command to add `-no-cnv` to; instead `KIT-BUILD.md` now carries the warning for anyone running the shipped `bin/llama-completion` by hand (flags + `</dev/null`), and the gate below voids any such log anyway.
- **Task 2 — remote stdin from /dev/null.** Transport level: `d_run.sh` `adbT` execs adb with `< /dev/null` — adb forwards its stdin to the remote shell, so EVERY remote binary of the driver (including the strings sourced from `stop_lib.sh`/`battery_trust.sh`, edited by nobody here) starts with EOF instead of a TTY. `restore.sh` calls adb directly → its 5 shell sites carry their own `</dev/null`. And the named binary: `arm.sh arm_cmd`'s remote string ends `… > log 2>&1 < /dev/null; rc=$?` (before `; rc` so the exit code stays the binary's).
- **Task 3 — gate `interactive_mode`, red→green.** Both `arm_parse_proof` and `arm_parse_measure` void `interactive_mode` (proof column `interactive_line=1`) the moment the log contains `Running in interactive mode`, before any stat is read — a short interactive run exits 0 and would otherwise pass; a long one hangs to the timeout (rc 124, voided as timeout). Two fixtures, knobs per run kind: **interactiveturn** (`DRY_TURN_INTERACTIVE`, turn log only): red (rc 0, `MATCH ok`, 13 rows) → green (rc 3, `END=match_void`, 10 rows, proof `OK`, 0 matched); **interactiveproof** (`DRY_PROOF_INTERACTIVE`, proof log only): red (rc 0) → green (rc 3, 5 rows — the arm dies before any turn runs, 0 matched, no `MATCH ok`).
- **Task 4 — does llama-speculative-simple template `-f`/`-p`? NO.** `examples/speculative-simple/speculative-simple.cpp` has **zero** occurrences of chat/template/interactive/conversation/stdin/getchar/fgets/getline (`grep -c` = 0), and the prompt is tokenized raw at **line 78**: `inp = common_tokenize(ctx_tgt, params.prompt, true, true);` (special = BOS only). Completion is the one that templates, and only under conversation mode (`completion.cpp:250 if (params.conversation_mode && params.enable_chat_template)`). All five arms therefore share binary + `-f PROMPT.txt` + greedy → **identical token sequences by construction**; the comparison is not broken. Side effect: spec-simple cannot print the banner or wait on stdin, so the gate is defense-in-depth (kit misuse, future flag drift), which is why its fixtures come from knobs rather than from a real behavior.
- **Unverified:** the S23 spec-simple runs themselves (no phone); that `-no-cnv`/`-st` behave as quoted on the device build (source-only); adb's stdin forwarding through this adbd (standard, not exercised without a phone); whether a *real* completion hang still exits only at the arm timeout (cell A's evidence, not re-run here).

- **audit6b — the fake rejects misspelled flags (coordinator caution).** The correct flag is `-no-cnv` / `--no-conversation` (`common/arg.cpp:1899-1900`, quoted above and in `KIT-BUILD.md`); `--no-cnv` does NOT exist and appears nowhere in this cell's code or docs (grep = 0). `fake-adb.sh` now allowlists every flag the driver may pass to the binary (`KNOWN_SPEC_FLAGS`) and rejects anything else with **exit 65** + `shell_bad_flags.log` (CMD + BAD) before answering — a typo (`--no-cnv`) or a completion-only flag (`-no-cnv`, `-cnv`, `-st`, which spec-simple would reject anyway) can never pass the dry-run silently. Fixture **flagbad**: an `arm_cmd` with injected `--no-cnv` → rc 65, the flag named in stderr and in `shell_bad_flags.log`, no device log written; a clean `arm_cmd` in the same fixture returns 0 (selective, asserted).

- **Forensics the new gates bought (recorded, not shipped as fixtures):** (a) **all four real `s23-calib-3` logs contain the interactive banner** — cell A's calibration runs were conversation runs that "happened to exit 0", exactly the coordinator's warning, now visible inside my shape-verification inputs; `shape_check.sh`'s survival expectation was updated to the banner gate firing on REAL evidence (`interactive_mode` on both parses). (b) The rerun fixture had a real race: phase-1's SIGKILL-orphaned fake shares the state dir with phase 2, and its late write truncated phase 2's `A-p.log` (`VOID run_fail` → `END=match_void`) — fixed by reaping the orphan fake before phase 2 starts. (c) A once-seen `happy` double-pkill traced to a `.restore-state` left by an aborted dry-run (the driver correctly repaired it first → two restores); `dryrun.sh` now clears any such leftover at start, while the stale-repair behavior itself stays covered by `rerun2`.

## AUDIT7 (S23 self-test spawn trap) — fixes

- **The device failure.** S23 run `aaeeae16` stopped at setup: `PGREP_SELFTEST=MISS`, exit 4, nothing else ran. Root cause in `d_run.sh pgrep_selftest`: the victim spawn was `"$q" &` — quoted, the shell looks for ONE command literally named `sleep 12345`, which does not exist, so nothing is spawned and pgrep (correctly) finds nothing. **Fix:** the victim is now spawned as `sleep "$n" &` with `n=12345` and `q="sleep $n"` — the spawn works, while `n`/`$q` keep the contiguous literal `sleep 12345` out of the command string, so the self-match guard (audit4 item-3) still holds (both traps are named in the comment at `d_run.sh:133-140`).
- **The fake now EXECUTES the self-test string locally under `/bin/dash`** instead of pattern-matching it (`fake-adb.sh` `PGREP_SELFTEST` branch): a spawn that fails for real surfaces as a real MISS. **Red→green:** with the old `"$q" &` line patched back in → `/tmp/drB7_red.log`, **EXIT=1, 185 FAIL / 118 PASS** (every driver fixture aborts at setup; the log carries the exact S23 failure `PGREP_SELFTEST_FAIL out=[PGREP_SELFTEST=MISS|PGREP_SELFCLEAN=GONE]` + `PGREP_SELFTEST_ABORT`); `d_run.sh` restored byte-identical (`cmp` clean) → `/tmp/drB7.log`, **EXIT=0, 303 PASS / 0 FAIL**, with the new permanent assertion `happy selftest-ok` = `PGREP_SELFTEST ok` and no orphan `sleep 12345` left on the host (pgrep-checked).
- **The probe on the restore/cleanup path got the same treatment:** `kill_spec_verified`'s `zzz_no_such_proc` health probe is now EXECUTED under `/bin/dash` too (knob precedence kept for `DRY_PGREP_*`). Live demo on this Mac: bracketed → `PROBE=1` (the only form the driver sends); plain literal → `PROBE=1` here — macOS pgrep does not reproduce the toybox self-match, which is device-proven (and is precisely why the driver only ever sends the bracketed form). **NOT executed, and why it is not cheap:** the `pkill` side (executing it on the host would kill real processes, including concurrent fake arms), the `ALIVE/GONE` verdict pgrep (it would race those fakes' cmdlines instead of the `proc_running` model), `restore.sh`'s `get-state` (would reach a real adb server), and stop_lib's `llama-completion` pkill/pgrep (sister cell's). All stay modeled, with the hazard recorded here.

## AUDIT8 (S23 run 2: HTP0 leak + SIGSEGV misclassification) — fixes

Red→green: the old unpinned command patched back into `arm.sh` → `/tmp/drB8_red.log`, **EXIT=1, 87 FAIL / 246 PASS** (happy dies at its proofs: every arm voids `htp_leak`, 5 rows, `END=match_void`); restored byte-identical (`cmp` clean) → `/tmp/drB8final.log`, **EXIT=0, 333 PASS / 0 FAIL**; `./shape_check.sh` → `SHAPE_EXIT=0`; `bash -n` clean on 9 scripts.

- **1 — device pinning (and no ADSP_LIBRARY_PATH papering).** Quotes from f25f0c1c5: `common/arg.cpp:2734-2738` `{-dev, --device}` — *"comma-separated list of devices to use for offloading (none = don't offload)"*; `:1116-1124 parse_device_list` — `"none"` → `devices.push_back(nullptr)` (CPU-only; note a CPU device *name* itself **throws** `invalid device: …`, so `none` is the only CPU spelling); `:4208-4210` `{-devd, --device-draft}` — *"none = don't offload, default: follows --device"*. Mechanics: `common.cpp:1695-1696` (`mparams.devices = params.devices.data()`) → `src/llama.cpp:158+ llama_prepare_model_devices`: with the NULL-terminated list containing only the NULL the `for (…; *dev; ++dev)` loop body never runs → default GPU/HTP selection is skipped → **no `using device …` line at all**, no Hexagon session. New commands: every arm carries **`-dev none`** (target pinned to CPU) in `arm.sh arm_cmd`; A/B4/B8 add **`-devd none`** (drafter CPU), C4/C8 keep `-devd GPUOpenCL -ngld 99`. Gate: `arm_htp_leak()` (`using device HTP0` OR `ggml-hex: … failed to open session`) checked FIRST in both parses → VOID `htp_leak`, and it also wins inside `arm_rc_reason` (content beats the exit code, so the S23 crash is reported as its root cause). Deliberately NOT done: no `ADSP_LIBRARY_PATH` — this cell must not touch the NPU at all. `-dev` added to the fake's flag allowlist.
- **2 — rc 139 was classified `timeout`.** `arm_rc_reason` (`arm.sh`): `124`/`142` → `timeout` (142 = our own SIGALRM on the adb client, explicitly not a device signal), `≥128` → `crash_sig$((rc-128))` (139 → **`crash_sig11`** = SIGSEGV), `125-127` → `adb_fail_<rc>` (the perl wrapper's own codes), HTP content overriding all of them; both abnormal branches (`run_proof`/`run_measure`) record the classified void (kill-reason label renamed `abn_$tag`, fixture assertion updated). Fixture **segv** (`DRY_ARM_RC=139`, pinned): void `crash_sig11` (not timeout), the rc recorded in the proof column, `END=match_void`, kill verified.
- **3 — the fake replays the real shapes** verbatim from `raw/s23-dspark-2/A-p.log`: `using device GPUOpenCL (QUALCOMM Adreno(TM)) (unknown id) - 2512 MiB free` + `using device HTP0 (Hexagon) (unknown id) - 0 MiB free` (:51-52), `ggml-hex: HTP0 failed to open session : uri file:///libggml-htp-v73.so?htp_iface_skel_handle_invoke&_modver=1.0&_dom=cdsp&_session=0 error 0x80000406` (:856), `llama_init_from_model: failed to initialize the context: ggml-hex: failed to open session (see log for details)` (:858), `common_fit_params: encountered an error while trying to fit params to free device memory: failed to create llama_context from model` (:859), bare `Segmentation fault` + `EXIT=139` — and the replay is **keyed on the command**: without `-dev none` the fake emits the whole crash (no marker, no draft, no stats, rc 139), which is exactly what the red run exercised. Gate coverage on a PINNED command (rc 0) via knobs: `DRY_HTP_LEAK` → fixture **htpproof** (both logs; the parse gate fires before the exit code — proof column `htp_line=1`) and `DRY_TURN_HTP` → fixture **htpturn** (proofs OK, probes void, 10 rows). `happy` gained the permanent guard: no `HTP0`/`ggml-hex` in any of its logs under the pinned command.
- **shape_check note:** the real `s23-calib-3` cal logs themselves carry `using device HTP0` (cell A's CPU cal listed the DSP) *and* the interactive banner → the htp gate (checked first) now fires on that real evidence (`proof/measure → htp_leak`), asserted in `raw/shape_check.log` (`SHAPE_EXIT=0`).
- **Declared:** `d_run.sh` 570, `dryrun.sh` 558 (topic-sectioned matrix), `fake-adb.sh` 432, `arm.sh` 275, `shape_check.sh` 175 — pre-existing plus these mandated changes; no lines moved to make a number. AUDIT5's N-C3..N-C6 LOWs remain untouched, as declared there.

## AUDIT9 (S23 run 3: missing context size) — fixes

Red→green: the ctx/fit flags stripped from `arm.sh` → `/tmp/drB9_red.log`, **EXIT=1, 86 FAIL / 261 PASS** (every arm voids `ctx_mismatch` at 128000); restored byte-identical (`cmp` clean) → `/tmp/drB9.log`, **EXIT=0, 347 PASS / 0 FAIL**; `./shape_check.sh` → `SHAPE_EXIT=0`; `bash -n` clean on 9 scripts; host flag check `raw/host_ctx_flags_check.log` → **EXIT=0**.

- **1 — context pinned on every arm.** `arm.sh`: new constant `CTX_SIZE=2048`, appended to every command as `-c $CTX_SIZE -b 2048 -ub 1024 -fit off` (cell A parity: `-c 2048 -b 2048 -ub 1024`). **`-cd`/`--ctx-size-draft` does NOT exist in f25f0c1c5** (grep = 0): the drafter copies the target's context — `common/speculative.cpp:2550 cparams.n_ctx = llama_n_ctx(ctx_tgt);` — so the single `-c` pins BOTH contexts; `-c` itself is `common/arg.cpp:1636 {-c, --ctx-size}`. Arithmetic: prompt `encoded 77 tokens` (`raw/host_smoke.log`) + worst decode = limit 127 + overshoot ≤ 9 → 136 ⇒ 77 + 136 = **213 ≤ 2048** (10× margin; the drafter adds only `block_size 9`). Host proof: at `-lv 4` with the new flags BOTH contexts print `llama_context: n_ctx                 = 2048` (extraction → `2048 2048 `, the exact string `happy` asserts) and the fit-probe count is 0; at default those INFO lines are absent — which is why the gate runs on -lv 4/5 logs only.
- **2 — gate `ctx_mismatch`.** `arm_ctx_check` parses the verbatim shape `llama_context: n_ctx                 = %u` (format from `src/llama-context.cpp:308`; the spaces-only match excludes `n_ctx_seq`/`n_batch`) → `ok` / `mismatch:<values>` / `none`. Both parses void **`ctx_mismatch`** right after the htp gate when values ≠ `CTX_SIZE` **or when no such line exists at all** at -lv 4/5 (format drift, fail closed), proof column `n_ctx=… want=2048`; `arm_rc_reason` also reports `ctx_mismatch` for a present-but-wrong context (a *missing* one does not override timeout/crash — partial logs). Fixture **ctxbad** (`DRY_CTX_MISMATCH=1`, pinned command forced to the train ctx): proofs void `ctx_mismatch` with `n_ctx=128000,128000 want=2048`, 5 rows, rc 3, `END=match_void`, no `MATCH ok`.
- **3 — `-fit off`: adopted, decided from the source.** `common/common.h:476` `fit_params = true` (fit runs by default) and `-fit [on|off]` (`common/arg.cpp:2864-2876`, no `set_examples` → valid for spec-simple; `off` accepted via `is_falsey`) gates the whole block at `common/common.cpp:1297`. What the source says the fitter can and cannot touch: a user-set ctx is left alone (`common/fit.cpp:455` `context size set by user to … -> no change`), a user-set `n_gpu_layers` makes it abort itself (`common/fit.cpp:463-464`) — but **before/outside those guards it still runs the extra-model measurement probe** (`common/fit.cpp:210-231`), i.e. the exact lines quoted by the coordinator: `:923 getting device memory data for the extra model at a context size of 128000:`, `:1314 dflash requires ctx_other to be set (this warning is normal during memory fitting)` (`src/llama-context.cpp:159` throws it), `:1315 failed to measure the memory of the extra model, fitting without it` (`common/fit.cpp:227`) — allocating probe contexts at whatever ctx is in effect and printing noise indistinguishable from real errors. With `-c/-b/-ub/-ngl/-ngld/-t/-n` all explicit there is nothing legitimate left for it to adjust, so `-fit off` removes the probe and guarantees no future unset flag is silently moved; `common.cpp:1301` even points at `-fit off` as the explicit reproduction path. Host-verified: probe count 0 with the flag, present in every fit-ON run. No fit *gate*: `happy no-fit-probe` asserts the absence instead.
- **4 — fake shapes, red→green.** `emit_ctx_block` prints the real formats verbatim — `n_ctx`/`n_ctx_seq`/`n_batch`/`n_ubatch` (`src/llama-context.cpp:308-311`, byte-copied field padding) and the KV line (`src/llama-kv-cache.cpp:324`) with the real arithmetic `c/64` and `c/128` MiB (128000 → 2000.00/1000.00, exactly A-p.log:863; 2048 → 32.00/16.00) — emitted **twice per run** (target pre-marker, drafter post-marker, as the real logs show at :818 and :2299). Keyed on the command: no `-c` → 128000 (what the red run exercised), `-fit` present without `off` → the three fit lines with shapes from :923/:1314/:1315. `-c -b -ub -fit` added to the flag allowlist so the new command passes the typo check.
- **Declared:** `d_run.sh` 570, `dryrun.sh` 574, `fake-adb.sh` 474, `arm.sh` 321, `shape_check.sh` 175 — pre-existing plus these mandated changes; no lines moved to make a number.

## Still unverified (device-side)

`pgrep -f` support on the S23 toybox (if absent, the driver reports `pgrep_broken` loudly instead of passing), real `dumpsys` formats beyond what the committed S23 logs show, `-devd GPUOpenCL` parse/offload, all tok/s/acceptance/proof counts, cooldown behaviour on real skin, `battery_trust.sh` verdict on this board. Host speeds at `-t 5` were noisy run-to-run (B4 at −n 127: 37–51 t/s across limits) and are explicitly not used as evidence in `PLAN.md`.


## S23 DSpark run 1 — pre-arm self-test abort

Preflight passed on the fixed TLS endpoint: unplugged, battery 75% / 29.0 C,
thermal 0, traced 0, Kalsa absent, no llama/bench process, display Awake and
unlocked. The raw-log scan had no `Running in interactive mode` matches. The
driver stopped before kit/model push and before any proof or measured arm:
`PGREP_SELFTEST=MISS`, `PGREP_SELFCLEAN=GONE`, `PGREP_SELFTEST_ABORT`; cleanup
verified its kill probe as gone. `END reason=exit_4`, process exit 4. No arm
rows or drafter placement, acceptance, speed, or per-arm skin values exist.
No restore state was created. Evidence is in `raw/s23-dspark-1/`; no retry was
made.


## S23 DSpark run 2 — proof startup failed at HTP session init

Preflight passed on the TLS endpoint: unplugged, battery 74% / 27.1 C,
thermal 0, traced 0, Kalsa and llama/bench absent, screen Awake/unlocked.
`PGREP_SELFTEST=FOUND` and `PGREP_SELFCLEAN=GONE`. The kit, target, drafter,
and prompt verified after push. The first proof (`A-p`) and a second proof
(`B4-p`, already starting as INT was delivered) both exited 139 with
`Segmentation fault`; the driver classified each as `VOID timeout` and was
interrupted before remaining proofs/measures. Both logs show HTP0 URI error
0x14, fallback cDSP session open error `0x80000406`, then context-init failure.
No `loading draft model` marker appears, so drafter placement, `n_drafted`,
acceptance, and tok/s are unavailable. Main-model placement says `0/31 GPU`,
which is not drafter-placement evidence. Row skin starts were 29.4 and 29.5 C;
peak per proof is not separable from the safety poll (session-wide observed
skin max 29.6 C). `END reason=signal_INT`, wrapper exit 130. Restore verified
`rc=0`, settings returned to timeout=null / stay-on=0. No retry. Raw logs:
`raw/s23-dspark-2/`.


## S23 DSpark run 3 — CPU proofs pass; C4 proof OOM

Preflight passed on the fixed TLS endpoint: unplugged, 73% / 26.1 C, thermal
0, traced 0, Kalsa and llama/bench absent; screen Awake/unlocked. The updated
self-test passed. All logs in `raw/s23-dspark-3/` were scanned: no Hexagon
backend strings and no interactive-mode banner. Historical `s23-dspark-2`
logs do contain the old HTP0 / ggml-hex session-init failure.

The driver completed proof-only arms A, B4, B8. C4 loaded all 6/6 drafter
layers on OpenCL, then failed graph reservation with an 8000 MiB OpenCL
allocation error (`EXIT=1`, row VOID `run_fail`). The job was interrupted at
that first failing proof; C8 and all matched measurement arms were not run.
The proof logs' short-run statistics are not matched-arm measurements:
A 0 drafted / 0 accepted / nan% (zero drafted), decode 13.587 t/s; B4
20 / 6 / 30.000%, 4.321 t/s; B8 21 / 8 / 38.095%, 11.569 t/s. CPU drafter
proofs assigned 6 layers to CPU and offloaded 0/6 to GPU. Skin start / peak
sampled during each proof: A 28.0 / 30.3 C; B4 30.3 / 31.7 C; B8 31.7 /
33.3 C; C4 33.3 / 33.3 C. The C4 drafter reached OpenCL 6/6 before its
allocation failure; no decoded-token metrics exist for it.

`END reason=signal_INT`, wrapper exit 130; restore verified `rc=0` and
settings returned to their prior values. Raw evidence is in
`raw/s23-dspark-3/`; no retry was made.


## S23 DSpark run 4 — matched-N completed with pinned contexts

Preflight passed on the pinned TLS endpoint: unplugged, 70% / 26.2 C,
thermal 0, traced 0, Kalsa and llama/bench absent, display Awake/unlocked.
All five proofs passed; all five final rows matched at `n_predict=136`.
Both target and drafter logs show `n_ctx=2048` on every proof and final run.
Run-4 raw logs contain no HTP0 / ggml-hex references and no interactive-mode
banner. Historical run-2 crash logs do contain HTP0 / ggml-hex references.

| Final arm | Status / void | Drafter placement | n_ctx target/draft | n_drafted / n_accept / accept | Decode t/s | Skin start / peak C |
|---|---|---|---|---|---:|---:|
| A-m1 | matched / na | CPU, 0/6 GPU | 2048 / 2048 | 0 / 0 / nan% | 15.993 | 32.6 / 33.4 |
| B4-m1 | matched / na | CPU, 0/6 GPU | 2048 / 2048 | 161 / 95 / 59.006% | 21.487 | 33.4 / 33.5 |
| B8 | matched / na | CPU, 0/6 GPU | 2048 / 2048 | 253 / 104 / 41.107% | 18.287 | 31.3 / 31.8 |
| C4-m1 | matched / na | OpenCL, 6/6 GPU | 2048 / 2048 | 165 / 94 / 56.970% | 9.401 | 33.5 / 33.7 |
| C8 | matched / na | OpenCL, 6/6 GPU | 2048 / 2048 | 253 / 104 / 41.107% | 9.640 | 32.2 / 32.6 |

The skin peak column is the highest safety sample bounded by that row's
start/end gates. `END reason=exit_0`, driver exit 0; restore verified `rc=0`,
sampler stopped, screen timeout and stay-on returned to saved values. Raw
logs and context evidence are in `raw/s23-dspark-4/`.
