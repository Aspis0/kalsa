# REPORT — fixes for hostile audit dd6bdb56 (section B, cell spec-dspark-gpu-draft)

Status after fixes: `./dryrun.sh > raw/dryrun_summary.txt 2>&1; echo EXIT=$?` → **`SUMMARY pass=147 fail=0`, `DRYRUN_EXIT=0`**; host `./host_calib.sh` (9 runs) and `./host_smoke.sh` re-run at `-t 5` → **EXIT=0** (`raw/host_calib_summary.log`, `raw/host_smoke.log`). No phone, no adb, no sub-agents. Every CONFIRMED finding is fixed in code; deviations and the PLAUSIBLE-adjacent choices are justified below. `PLAN.md` predictions were rewritten after this audit, dated, before any device run.

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
- Host threads `-t 5` (S23 app preset) in `host_smoke.sh`/`host_calib.sh`, re-run, EXIT=0; `-ngld 0` added so a drafter-flag typo dies on the host. **Device arms stay `-t 8`** (the instruction scoped `-t 5` to the host and the sister cell's device arms also run `-t 8`) — deliberate, flagged here and in PLAN.md.
- `trap` on HUP (B-9). Poll covers load: in this cell load happens inside the timed arm call, so the poll spans load+decode; the push window and every proof run are polled too (B-7).

## stop_lib.sh (parallel fix)

Still **sourced** from `../qdc-heat-3way/stop_lib.sh`, never copied, never edited. **No new function is requested from it**: its contract (`log`, `adbT`, `RAW`, `SER`, `BATTERY_UNTRUSTED`, `live_readings`, `hard_stops`, `safety_gate`, `request_stop`) covers every use here. The one gap — `request_stop` pkills `llama-completio[n]`, the wrong binary for this cell — is covered by this cell's own verified `kill_spec_verified`; if the parallel fix ever adds a generic kill hook, we would call it instead of ours, but nothing in this cell blocks on that.

## Still unverified (device-side)

`pgrep -f` support on the S23 toybox (if absent, the driver reports `pgrep_broken` loudly instead of passing), real `dumpsys` formats beyond what the committed S23 logs show, `-devd GPUOpenCL` parse/offload, all tok/s/acceptance/proof counts, cooldown behaviour on real skin, `battery_trust.sh` verdict on this board. Host speeds at `-t 5` were noisy run-to-run (B4 at −n 127: 37–51 t/s across limits) and are explicitly not used as evidence in `PLAN.md`.
