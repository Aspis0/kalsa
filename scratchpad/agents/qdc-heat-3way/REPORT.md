# qdc-heat-3way — report

**Status: DRY-RUN ONLY, round 2.** No phone and no QDC session was touched:
every run below used the fake adb (`dryrun-adb.sh`) on the Mac. `PREREG.md`
was written before any run, then amended (old values stated) after hostile
audit **f2ee97f4**, still before any run; it stays locked once a real device
run starts. Device plan: Galaxy S23 (SM8550 / Adreno 740 / Hexagon v73), local
adb, unplugged.

## What the cell does

One fixed turn per arm — prefill of the frozen ~1018-token prompt of
`qdc-heat-per-backend` (copied `PROMPT.txt`, sha256
`2a4b5deaa3f4eefc5a878278184dcb6ba397f376c82395368f5126d9967d0ea1`, 3833 B,
pushed and sha-verified on the device, **read back by the arm itself with
`-f`**) plus exactly 127 decode tokens (`-n 127 --ignore-eos --seed 1
--temp 0`) — on C (CPU `-ngl 0`), G (Adreno `-dev GPUOpenCL -ngl 99`), N (HTP
`-dev HTP0 -ngl 99 -nkvo`), order `CGNNGC`, via the `npu-spec-verify` CLI kit
(engine `f25f0c1c5`). Every arm is preceded by a load-only phase (page-in,
weight upload, OpenCL compile) with its own wall + before/after skin, so the
measured window is prefill+decode only. The app has no NPU route
(`src/bench/benchConfig.ts:18 bench:route cpu|gpu|auto`), hence the CLI kit.

## Audit f2ee97f4 — every finding, fix location

| # | finding | fix (file:line) |
|---|---|---|
| A1 | parser prefix `llama_perf_context_print:` does not exist in the kit | `arm.sh:135-137` — matches `common_perf_print:`, field indices $6/$9, $5/$8, $5(load) kept; format verified in-tree at f25f0c1c5 `common/sampling.cpp:573-576`, no log prefix (`common/log.cpp:174`); the fake now generates lines from that exact format (`dryrun-adb.sh:141-144`) **[SUPERSEDED by Round 3 + Round 4: the kit DOES prefix every line `<ts> <level> ` — that log-prefix claim was wrong; the parser now matches the label token anywhere and indexes relatively (`arm.sh:211-231`), and the fake copies the prefixed lines byte-for-byte from the committed run log]** |
| A2 | stale `stop_request`/`END.txt` never removed | `d_run.sh:55-58` — rm before anything reads them; fixture `dryrun.sh:211` seeds both and proves `END exit_0` + OK row + file gone |
| A3 | `pkill -f llama-completion` self-match; orphan on timeout | `stop_lib.sh:59` and `restore.sh:48` — pattern `llama-completio[n]`; `arm.sh:77-81,94,109` — rc ≥124 (142=SIGALRM, verified) → `arm_kill_orphan`; fixture `dryrun.sh:220` (ARM_TIMEOUT_S=1 + sleeping fake) |
| A4 | CPU prefill 45 s contradicted its own priors | `PREREG.md` §1 rederived with arithmetic: C 45,000→**15,000** [8k–45k] (pp4 52.9 t/s ⇒ ≤19.2 s; app 10.1–11.2 s ⇒ 12–17 s; q58 39.3 s upper), G 14,000→**13,500** (1018/75.4=13.5 s), N 18,000→**12,000** (q58 9.7 s floor, npu-spec 47.1 s ceiling); dated amendment block names old values + audit id |
| A5 | untrusted verdict disarmed the 44 C stop | `stop_lib.sh:71` — battery ≥44.0 armed ALWAYS, untrusted only adds `stop_lib.sh:72-74` skin ≥46; mismatch needs two concordant samples `battery_trust.sh:44-47`; fixtures `dryrun.sh:195` (untrusted + 44.5 C → `stop_battery_temp`, verdict=1) and `dryrun.sh:169` (skin_fallback) |
| A6 | proofs were presence-only | `arm.sh:34-36,163-190` — N ≥**1000** `HTP0 execute-op` (30×33 layers; priors q58 3430@n1024, q57 1764) + arch line; G ≥**30** placement lines AND ≥**8** `GGML_OPENCL_LOG_KERNELS:` dispatch lines (`ggml-opencl-kalsa-diag.cpp:36-44`, from inside enqueue) + zero kernel-failed/disabled lines; fixtures `dryrun.sh:108,124,131,145` |
| A7 | no equal-decode gate | `d_run.sh:298-305` — `decode_runs` must be 127 else VOID `decode_len` + `END stop_unequal_decode`, session ends after the row; fixture `dryrun.sh:230` |
| A8 | load/compile inside the measured window | `arm.sh:66-76` load-phase command, `d_run.sh:267-283` — per-arm load phase with `load_wall_s`/`load_skin_before`/`load_skin_after` columns + post-load stop gate; turn-process `load time` parsed (`arm.sh:137`) and logged (`d_run.sh:309`); `pagein_cold` flags the session's first (cold) load |
| A9 | order balanced only for linear drift | `PREREG.md` "Order bias": keep `CGNNGC` (palindromic, mean position 3.5 for all three backends ⇒ linear drift cancels; interleaving would break `pair=ceil(turn/2)`); convex-drift residual registered (E[pos²] C 18.5 / G 14.5 / N 12.5) with the P1-vs-P3 diagnostic |
| A10 | device logs untagged, stale pullable | `d_run.sh:255` tag = `${JOB}-t…`; `kit.sh:35` sweeps `$D/*.log` at setup |
| A11 | double restore via EXIT+signal; poll not stopped | `d_run.sh:120-124` CLEANED guard + `stop_arm_poll` in cleanup (defined before it, `d_run.sh:106`) |
| A12 | deadline not checked during cooldown | `d_run.sh:209` |
| A13 | previous `stayon` not saved | `d_run.sh:182-186` read+state; `restore.sh:52-57` put/delete exact saved value; fixture asserts restored=1 (seeded) and deleted (default null) |
| A14 | plugged missed `Dock powered: true` | `stop_lib.sh:38` |
| A15 | stop logic → ONE sourced `stop_lib.sh`; prompt identity | `stop_lib.sh` (whole file: live_readings/require_numeric/hard_stops/request_stop/safety_gate, deps declared for the DSpark consumer); prompt: `arm.sh:57` `-f $D/prompt.txt` + `d_run.sh:156,189` `prompt_verify` — verified file = used file, no inline copy; `battery_trust.sh` now a local copy (A5 required an edit the live qdc cell forbids) |
| A16 | fixtures for A1/A2/A3/A7 | `dryrun.sh:74` (perf prefix), `:211` (stale), `:220` (timeout/orphan), `:230` (unequal decode) — plus A5/A6 fixtures |

## Reuse map (copied vs sourced)

| piece | how | provenance |
|---|---|---|
| kit push/env/HTP-arm selection, `--list-devices`, proof rule (missing = METHOD-VOID) | adapted | `npu-spec-verify/d_run.sh` + `STEP0-V73-PREP.md` |
| stop logic | **copied** into `stop_lib.sh` from `../qdc-heat-per-backend/safety.sh:20-27,29-46,51-53,65-84` (with A5/A14/A3 deltas) | sourcing was never possible (its `thermo_refresh` needs `set_prefs`/`parse.sh` = the app harness) and after A5 the source cell is both incompatible and frozen live on QDC |
| battery trust | **copied** into `battery_trust.sh` from `../qdc-heat-per-backend/battery_trust.sh:18-27,39-69` (A5 two-sample mismatch; its load fn dropped — single-invocation driver) | A5 requires an edit inside the live cell, which the audit forbids; its owner applies it there later |
| cooldown-as-cap, warm_start, pair=ceil(turn/2), 60 s tail, adbT alarm wrapper | copied/adapted | owner rules in that cell's REPORT |
| 1 s sampler | **copied** `smp.sh` body (source lines 4-31), paths retargeted | a file this cell pushes to its own device dir |

## Files (one responsibility each)

- `d_run.sh` (365) — session orchestration: args/order validation, the
  proof+turn loop, 26-column rows, END, restore. *Declared:* over the ~350
  indicative (pre-existing shape since Round 4; shuffling it now would move
  lines only for the number).
- `setup.sh` (79) — pre-arm device setup: prior restore, state, trap arming,
  mutations, kit+trust+gate, the single-session pgrep self-test, sampler.
- `pin.sh` (62) — calib.ok pin resolution/validation (keys, [0.5,25] rate,
  model/kit binding, board binding) or exit 9.
- `calibrate.sh` (140) — CALIBRATE=1 loop: proof + short run per backend,
  candidate report, VOID-proof refusal, G/N buf-collision check, pinned floor.
- `stop_lib.sh` (107) — live readings, fail-closed numeric checks, hard
  stops, `request_stop` + verified `kill_remote_llama` (sourced; DSpark too).
- `battery_trust.sh` (69) — battery-sensor verdict (two-sample mismatch).
- `kit.sh` (76) — `prompt_verify`, push and byte-verify kit/model/prompt/
  sampler, remote-log+samples sweep, backend-name preflight.
- `arm.sh` (308) — proof-run and turn commands, run/pull, shared perf parse,
  fingerprint (with the `off`-is-a-count note), the two parses.
- `sampler.sh` (73) — sampler lifecycle: launch, confirmed pause (state →
  row column), resume, stop.
- `restore.sh` (84) — undo every device change (standalone-capable,
  health-probed kill with a `kill_check=` verdict field).
- `smp.sh` (41) — on-device 1 s sampler: append-only + 4 h hard bound.
- `dryrun-adb.sh` (361 — declared, ~350 indicative) — fake adb with
  reading/log/kill/pgrep/sampler knobs.
- `dryrun.sh` (20, orchestrator) + `dryrun-lib.sh` (96) + `dryrun-core.sh`
  (189) + `dryrun-stops.sh` (120) + `dryrun-paths.sh` (114) — fixture matrix
  split by topic (38 fixtures, 293 assertions).
- `PREREG.md` (337), `REPORT.md`, `AUDIT{,2,3}-dd6bdb56.md`.

## Dry-run proof (Mac, fake adb)

```
cd scratchpad/agents/qdc-heat-3way && ./dryrun.sh > /tmp/dryrun_a1.log 2>&1; echo "EXIT=$?"
EXIT=0      dryrun summary: PASS=138 FAIL=0     (log: raw/dryrun-final-run.log, per-fixture raw/dryrun-<name>.log)
bash -n d_run.sh restore.sh dryrun.sh dryrun-adb.sh stop_lib.sh battery_trust.sh kit.sh arm.sh  → all EXIT=0
```

| fixture | injection | asserted outcome |
|---|---|---|
| `six-arms` (seed stayon=1) | none | rc 0; **6 rows**, cpu gpu npu npu gpu cpu; pairs 1 1 2 2 3 3; all OK; **real `common_perf_print:` prefix parses** (A1); prompt_n 1018, runs **126** (the “127” written here in round 2 was the pre-Round-3 gate, superseded by the device-evidenced N−1 rule); prefill 45000/14000/18000; proofs `cpu_no_offload`, `gpu_assigned_lines=33 kernels=12`, `htp_ops=1200 arch=v73` (Round 4: proof from the -lv 5 load-phase run, plus `fp=` fingerprint and sampler pause/resume — see Round 4); load cols 33.5/33.5 + `inload_ms=9876.50` logged; pagein 1→0; stayon restored to 1; restore; no unknown shell cmd |
| `no-htp` / `htp-low` | 0 / 5 execute-op lines | VOID `no_htp_proof` / `htp_ops_low` (proof=htp_ops=5) |
| `no-gpu` / `gpu-exec-low` / `gpu-disabled` | no placement / 3 kernels / disabled line | VOID `no_gpu_proof` / `gpu_exec_low` / `gpu_disabled` |
| `warm-start` | skin 38 from read 1 | cap waits 2 s, `warm_start=1`, `cooldown_s=2`, `skin_before=38` recorded, arms still run (owner's no-cool-start-gate rule) |
| `stop-thermal` / `stop-level` / `stop-plugged` / `stop-missing` | injected at first gate | `END stop_*`, 0 rows; stayon deleted (default null) |
| `stop-batt-temp` (trusted) | 44.5 C after arm 1 | `END stop_battery_temp`, 1 OK row, verdict untrusted=0 |
| `stop-skinfb` | 25.0 C stub + skin 46.5 | verdict=1, `END stop_skin_fallback`, 1 row |
| `stop-untrusted-batt` (A5) | frozen-reading verdict + 44.5 C | verdict=1 **and** `END stop_battery_temp` — 44 C never disarmed |
| `stop-midarm` | 4 s arm, 44.5 C at read 11 | background poll fires mid-arm: row VOID `stop_battery_temp`, `END stop_battery_temp` |
| `stale` (A2) | seeded stop_request+END | `END exit_0`, 1 OK row, stop_request gone |
| `timeout` (A3) | ARM_TIMEOUT_S=1, 2 s fake arm | `ARM_TIMEOUT … rc=142 → killing` logged, bracketed pkill seen, row VOID `load_fail`, `END exit_0` |
| `decode-unequal` (A7) | decode runs=96 | row VOID `decode_len`, `END stop_unequal_decode`, runs recorded 96 |

Every fixture also asserts restore ran (`raw/<job>/restore.log`
`state=1 … rc=0`) with `screen_off_timeout` back to the pre-run value.

## Bugs caught before/while making round 2

1. Review (NOT caught by the harness): `arm_load_cmd` printf arg misalignment
   (`-p %s` consumed the backend flags) — the fake does not parse prompts, so
   the dry-run would have passed a broken load command. Fixed by embedding
   `-p " "` literally.
2. Review: `rm … "$END_MARKER_TXT"` (unbound under `-u`, and the log line
   called `log` before `log()` existed) — fixed during the rewrite.
3. Round-1 carryovers re-verified by the fixtures: assignment-only CPU proof
   vs A.log discovery lines; `pkill` branch before the arm branch in the fake.

## Commands with exit codes (this session)

- `bash -n` on all 8 scripts → 0.
- `./dryrun.sh` → **EXIT=0, PASS=138, FAIL=0** (first attempt after the
  round-2 rewrite; earlier round-1 progression 1→1→0(83)→0(93)→0(94) is in
  `raw/dryrun-final-run.log` history at ade0efe6).
- Host model sha: `shasum -a 256 …LFM2.5-2.6B-QAD-Q4_0.gguf` →
  `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03` EXIT=0.
- Kit archive sha (local): `dccf0865753557eb76e253af0157cb53a70346978ea48184fdf0cd884424c7ea`.
- Prompt sha: `2a4b5dea…7d0ea1` = `PROMPT.meta` = source cell's file.
- Engine source checks: `git show f25f0c1c5:common/sampling.cpp` (perf format),
  `…ggml-opencl-kalsa-diag.cpp` (kernel-once hook), `…ggml-hexagon.cpp:146-153`
  (execute-op gated on `GGML_HEXAGON_VERBOSE`), `git show f25f0c1c5` cat-file OK.

## Not verified (needs the real S23, dry-run only so far)

- Everything device-side: real `common_perf_print` output at default log
  level, real HTP/OpenCL threshold counts (1000/30/8 are priors-based floors —
  if the real counts sit below them, the arms void by design, METHOD-VOID),
  real HAL skin label, on-device sampler, toybox pkill behavior, kit push
  bandwidth, 720 s cooldown on a hot board, deadline path, INT/TERM delivery
  during a bare sleep (worst case = one TAIL_S/COOL_POLL_S).
- `battery_trust.sh` verdict on the S23 (expected trusted), including the new
  two-sample mismatch rule against real sysfs.
- The `gpu_disabled` and `htp_ops_low` void paths are proven only against
  injected logs.
- Skin/battery numbers of PREREG — untouched predictions, still predictions.

## Round 3 — run-1 defects fixed (2026-09-26); proof blocker found, NOT touched

Run 1 (luna, commit `2256dbd8`, evidence `raw/s23-cli-heat-20260926/`) stopped
after arm 1 with two driver defects; both are fixed in this round. No
thread/poll flag was changed (the owner's CPU-speed diagnosis is running and
its decision comes separately).

| defect | evidence | fix |
|---|---|---|
| **1. parser anchored fields at `$1/$6`** — on the device every line carries `<ts> <level> ` before the label, so every perf value came back empty → `run_fail` → luna's fail-fast guard stopped the session | `raw/s23-cli-heat-20260926/s23-cli-heat-20260926-t1cpu.log:48` — `1.17.377.184 I common_perf_print: prompt eval time =   10947.50 ms /  1018 tokens` | `arm.sh:211-231` — locate the `common_perf_print:` TOKEN anywhere in the line and index fields relative to it (value at label+5/+4, counts at +8/+7); works for prefixed AND bare lines. The old header claim "log prefix off (common/log.cpp:174)" was refuted (the header now documents the prefix in its two-phase design block). The fake now emits lines with byte-identical prefixes copied from that committed raw log (`dryrun-adb.sh:181-185`), asserted by `dryrun-core.sh:12` (`I common_perf_print:`) plus the parsed values |
| **2. gate hard-required 127 runs** — `-n 127` structurally yields **126** eval runs (the first token comes from the prompt eval); `-n 64 → 63` device-confirmed | `raw/s23-cli-diag-20260926` (63 for -n 64) and run 1's `126 runs` | `arm.sh:41-46` — `DECODE_N` is the single source (feeds the `-n %d` flag at `arm.sh:68`); `d_run.sh:78` — gate derives `DECODE_EXPECT=$((DECODE_N - 1))`; stop log now carries `want=… n=…`. No second hardcoded number |

Fixtures (`./dryrun.sh > /tmp/... 2>&1; echo EXIT=$?` → **EXIT=0, PASS=155,
FAIL=0**): six-arms asserts the prefixed line parses to 45000.00/1018/**126**;
`decode-unequal` now injects **125** (off-by-one must void →
`END stop_unequal_decode`); **new** `decode-derived` runs `DECODE_N=64` with
63 runs → OK row, `END exit_0` (a hardcoded 127-gate would void it); **new**
`no-cpu` (fake omits assignment lines, i.e. a default-verbosity-shaped log) →
VOID `no_cpu_proof`, `END method_void_no_cpu_proof`; the five proof-void
fixtures now also assert luna's fail-fast `method_void_*` END (`dryrun.sh:101,114,123,131,139`).

### Open blocker for run 2 — NOT fixed here, decision pending

The placement/execute proof lines all sit below the kit's **default
verbosity**, so after these two fixes run 2 would still void at arm 1:

- `load_tensors: layer %3d assigned to device %s` is `LLAMA_LOG_DEBUG` in this
  engine (`src/llama-model.cpp:1526,1531` at f25f0c1c5) — and run 1's real
  log has **zero** such lines (also zero `using device`/`offloaded` lines,
  although `loaded meta data` is `LLAMA_LOG_INFO` at
  `src/llama-model-loader.cpp:715` and absent too): the tool's default
  threshold suppresses the src/ messages (`common/log.cpp:109` gates DEBUG on
  `common_log_verbosity_thold`).
- `HTP0 execute-op` is `GGML_LOG_DEBUG` gated on `GGML_HEXAGON_VERBOSE=1`
  (`ggml-hexagon.cpp:146-153`) but still needs the logger threshold raised;
  `STEP0-V73-PREP.md`'s diagnostic used `-lv 5` to unlock exactly these
  records.

⇒ At default verbosity all three proofs void (`no_cpu_proof` first), and the
fail-fast guard stops the session again. Awaiting the owner's pending
decision (bundle with thread/poll): add `-lv 5` to the arm env/flags, or
redesign the proofs on always-present lines. The `no-cpu` fixture documents current behavior against a default-verbosity-shaped log; no proof logic was
changed in this commit.

`PREREG.md` is locked (post-run): its "decode_runs must be 127" is superseded
by the device-evidenced N-1 rule; recorded here, not edited there.

## Round 4 — hostile audit dd6bdb56, all findings fixed (2026-09-26)

`AUDIT-dd6bdb56.md` is committed with this round. Owner decisions applied as
stated below; no thread/poll-speed flags were touched beyond the ordered
`-t 5` preset. One note for Rounds 2–3: the fixture matrix was split by topic
(this round), so earlier `dryrun.sh:<n>` references now live in
`dryrun-{lib,core,stops,paths}.sh`. Rows written in earlier rounds keep the
line numbers of their own round — Round 4 reordered the setup block and split
`arm_parse` into proof/turn, so current locations for those are the ones in
the table below.

| # | disposition | fix (file:line) + fixture |
|---|---|---|
| A-1 CONFIRMED (blocker) | **Fixed per owner decision**: the backend proof runs in the load phase at `-lv 5` (few tokens: `-p " " -n 4`), where `LLAMA_LOG_DEBUG`/`GGML_LOG_DEBUG` exist; the measured turn runs at default verbosity with NONE of the verbose env | proof cmd `arm.sh:78-84`, proof env `arm.sh:62-65`, thresholds evaluated on the proof log `arm.sh:143-195`, gate before the turn `d_run.sh:309-315` (a void proof never pays for the big run); turn env `arm.sh:57-60` = LD/ADSP/`GGML_HEXAGON_NDEV` only. Fixtures: every proof fixture now voids pre-turn; `six-arms` asserts **0 proof lines in the turn log** and 33 assignment lines in the load log |
| A-2 PLAUSIBLE (verbose inside the window) | **Fixed**: `GGML_HEXAGON_VERBOSE=1` + `GGML_OPENCL_LOG_KERNELS=1` live only in `arm_proof_env` (`arm.sh:62-65`); the turn carries neither — no per-op fprintf can bias the N `eval time` | same fixtures as A-1; `kit.sh` preflight also dropped `GGML_HEXAGON_VERBOSE` |
| A-3 CONFIRMED (load phase unpollled) | **Fixed**: the poll starts before `arm_load` and stops after the turn (or at the load-fail/stop exits) | `d_run.sh:285`, stop paths `d_run.sh:285-315`; fixture `poll-cadence` (`dryrun-stops.sh`) — the stop lands DURING the load phase (row `stop_battery_temp` with `tail_s=na`) |
| A-4 CONFIRMED (pkill never verified) | **Fixed**: `kill_remote_llama` pkills then probes with `pgrep`; only `PGREP_RC=1` (gone) passes; any other RC (still running, or tool missing = 127) writes `$RAW/kill_unverified`, logs `PKILL_UNVERIFIED`, and every end path turns it into `END …_kill_unverified` with **exit 3**; `restore.sh` fails with `RESTORE_LLAMA_STILL_RUNNING` instead of pretending | `stop_lib.sh:69-86`, `d_run.sh:150-166` (+ load-fail path `d_run.sh:300`, final end `d_run.sh:364`), `restore.sh:50-56`. Fixtures `kill-unverified` (session rc=3, restore rc=1) and `timeout` (`KILL_VERIFIED`, rc=0) |
| A-5 CONFIRMED (no HUP trap) | **Fixed**: `trap 'on_signal HUP 1' HUP`, armed with the others right after the state write | `d_run.sh:209`; fixture `sighup` — HUP at t≈8 s mid-load → `END signal_HUP`, rc=129, restore rc=0, stop marker left for the sampler |
| A-6 CONFIRMED (stale state destroyed) | **Fixed**: no `rm` of `.restore-state`; a leftover state is CONSUMED by a prior `restore.sh` run before this run reads/mutates, and the session aborts loudly if that restore fails; only then is fresh state written | `d_run.sh:184-190`; fixture `prior-restore` — mutated fake device (1800000/3) + stale state (60000/1) → final device 60000/1, fresh state captured pristine |
| A-7 CONFIRMED (empty timeout read) | **Fixed**: `SCREEN_OFF_TIMEOUT` defaults to `null` like STAYON | `d_run.sh:197-199` |
| A-8 CONFIRMED (comment/order lie) | **Fixed**: traps are armed AFTER the state write and BEFORE the first mutation — the rm-before-trap comment is gone because the rm itself is gone | `d_run.sh:202-210` |
| A-9 CONFIRMED (unguarded adbT) | **Fixed**: devices/SOC/settings-read failures log `NO_DEVICE` / `ADB_FAIL …` and exit 2 instead of dying with a raw rc; guards on `d_run.sh:178,192,198,200` | fixtures `fail-devices` (rc=2, `NO_DEVICE`, no END) and `fail-soc` (rc=2, `ADB_FAIL soc_read`, no END) |
| A-10 CONFIRMED (cadence untested/unregistered) | **Fixed**: fixture runs the PRODUCTION `POLL_S=15` and measures ARM_START→STOP (observed **15 s**, asserted 13..40); PREREG amendment #5 registers the bound (15 s + 2 adb RTT ≈ 17–20 s under load) | `dryrun-stops.sh` fixture `poll-cadence`; `PREREG.md` amendments block |
| A-11 CONFIRMED (sampler inside the window) | **Fixed**: the sampler pauses before `arm_run` and resumes right after; `smp.sh` is append-only so a resume cannot truncate the series; the session-start sweep clears `samples.txt`; PREREG amendment #4 registers it | pause/resume `d_run.sh:316,318` + `sampler.sh:17-31`; `smp.sh:10-13`; `kit.sh:35`. Fixture `six-arms`: `SAMPLER_PAUSED`+`SAMPLER_RESUMED` logged, 1 `H zones` header, 7 `H sampler_start` (1 + 6 resumes) |
| A-12 CONFIRMED (PREREG says 127, code 126) | **Fixed**: dated amendment inside `PREREG.md` supersedes the “must be 127” wording (N−1, device-evidenced) | `PREREG.md` pre-run amendments #3 |
| A-13 CONFIRMED (pair decorative) | **Fixed**: `validate_order` requires even length and every pair ∈ {CG, GC, NN} (the registered pairs) — `CGN` and `CCCC` exit 2 before any adb call | `d_run.sh:27-36`; fixture `A-13` in `dryrun-core.sh`; every fixture converted to a registered order |
| A-14 CONFIRMED (self-contradictory ledger) | **Fixed**: the Round-2 A1 row and six-arms row are corrected/superseded in place (this section + the markers above) | this REPORT, rows for A1 and `six-arms` |
| A-15 CONFIRMED (CPU proof unfalsifiable) | **Fixed by A-1**: the positive check (`assigned to device CPU` ≥ 1) and the leak check both run on the `-lv 5` proof log, where those lines exist — a default log can no longer trivially pass either | `arm.sh:157-166`; fixture `no-cpu` (knob omits them → `no_cpu_proof`, `END method_void_no_cpu_proof`) |
| A-16 CONFIRMED (REFUTED by the audit itself) | **No change needed**: `^GGML_OPENCL_LOG_KERNELS:` is correctly anchored — the source is a direct `fprintf(stderr…)` inside `enqueue_ndrange_kernel`, not the logger (audit's own verdict) | fixture `gpu-exec-low`/`six-arms` keep proving the anchor |

**Fingerprint lines (stated, as the owner required)** — all three exist at
the default `-lv 3` because they are WARN or tool-level INFO (run-1 evidence):

1. `common_fit_params: … n_gpu_layers already set by user to <N>` — C: `0`,
   G/N: `99` (the -ngl value);
2. presence of `common_get_device_memory_data_impl: device HTP0 did not
   report memory` — C/N present, G absent (the `-dev` device scope);
3. `system_info: n_threads = <N>` — must equal the arm's `-t 5`.

The turn's fingerprint must equal the proof run's (`arm_fingerprint`,
`arm.sh:130-140`): inequality → VOID `backend_mismatch`, any missing
component on either side → VOID `no_fingerprint` (fail closed). Both values
are written into the `proof` column.

**Owner decisions recorded in PREREG (pre-run amendments block):** proof-run
architecture (#1), CPU/host threads `-t 5` from the app's S23 preset
`deviceTuning.ts:217-219` for all three arms with default poll — a config
choice, the CPU-speed diagnosis having been invalidated by the resident app
(#2), gate N−1 (#3), sampler pause (#4), poll bound (#5).

**Commands (this round):** `bash -n` on 10 scripts → 0;
`./dryrun.sh > /tmp/dryrun_r4_split.log 2>&1; echo EXIT=$?` → **EXIT=0,
PASS=213 FAIL=0** (log copied to `raw/dryrun-final-run.log`; per-fixture
`raw/dryrun-<name>.log`). Intermediate runs this round: 209/3 (three wrong
harness assertions — sampler-launch count 1+6 arms, restore rc=1 is the
CORRECT loud outcome for `kill-unverified`, and a two-field vs three-field
typo), then 213/0; two fake-emitter bugs caught by artifact inspection
(command substitution ate the fingerprint newlines).

**Not verified (round 4):** the real kit's fit line for `-ngl 99` (fingerprint
component 1 assumes `…user to 99`, mirroring run 1's `…user to 0`); the real
G-arm HTP0-warning scoping (component 2 assumes `-dev GPUOpenCL` excludes
HTP0 from the fit query); toybox `pgrep -f` availability on the S23 (if
missing, `PGREP_RC` never equals 1 → every kill fails CLOSED, loudly);
`-lv 5` unlocking the DEBUG lines on this kit (STEP0 diagnostic evidence
only); sampler pause/resume timing on device; HUP delivery during a bare
`sleep` (bounded by one sleep quantum, same caveat as the qdc driver). The
G/N split of the fingerprint therefore rests on two source-level assumptions
stated here and exercised only by the fake until run 2.

## Round 5 — hostile audit2 dd6bdb56: all NEW findings closed (2026-09-26)

`AUDIT2-dd6bdb56.md` committed with this round (it confirms all 16 previous
findings closed and raises NEW-1..NEW-8: the new gates were guesses the fake
satisflies with constants). Owner decisions applied: a **device
CALIBRATION mode** (the phone runs it first), thresholds/fingerprints fixed
from real logs, `-t 5` unchanged.

| # | disposition | fix (file:line) + fixture |
|---|---|---|
| NEW-1 CONFIRMED (blocker: flat 1000 vs a 4-token proof) | **Fixed**: the execute-op threshold is now `ceil(floor × proof_tokens)` with the proof run carrying `--perf` so its exact token count is read from its own log. Floor arithmetic (in `arm.sh:44-49`): priors q57 1764/1024 = **1.72 ops/token** (lowest), q58 3.35, q51 20.2 ⇒ collapse gate = half the lowest = **0.86/token**; a 4-token proof needs ≥ 4 lines, not 1000. `CALIBRATE=1` then PINS `calib.ok htp_ops_floor_per_tok = 0.5 × measured` and production prefers the pin (`d_run.sh:105-114`, logged `source=calib.ok` vs `source=prior(no calib.ok …)`) | `arm.sh:94-101` (`--perf`), `arm.sh:243-257` (scaled check, `min=` in the proof column); fixtures `htp-low` (ops=2 vs min=4), `pinned-floor` (seeded 150 → min=600), `six` (`min=4`) |
| NEW-2 CONFIRMED (fingerprint never device-verified) | **Fixed by the calibration mode**: `CALIBRATE=1` runs proof + short measured run (n=16, production flags/verbosity) per backend with all stops live, writes NO heat rows, and prints per backend the proof counts (execute-op + tokens, OpenCL assign/kernels) and EVERY candidate line family of the measured log — fit, device, system_info, buffer sizes, disabled — into `raw/<job>/calib/report.txt` (logs moved to `calib/`) | `calibrate.sh` (whole file, called at `d_run.sh:253-257`); fixture `calibrate` (END `calibrated`, no results.tsv, candidates present, floor pinned 150.0000) |
| NEW-3 CONFIRMED (fit line = intent, not placement; turn unchecked) | **Fixed**: the fingerprint components are now PLACEMENT — `buf=` from `… model buffer size` lines, `off=` from `offloaded N/M layers`, `thr=` (`arm.sh:189-201`) — and the fit line left the gate (it stays a printed candidate). Source check, quoted: `src/llama-model.cpp:1852` `LLAMA_LOG_INFO("%s: %12s model buffer size = %8.2f MiB\n", …)` and `:1846` `offloaded %d/%d layers` are INFO ⇒ NOT visible at default (`common/common.cpp:396` + `get_verbosity(INFO)=TRACE(4) > thold(3)`; run-1 log grep = 0) ⇒ **the measured turn now runs `-lv 4`** (`arm.sh:86`), which admits INFO and still hides DEBUG/per-op (A-2 intact, PREREG amendment #6). The turn ALSO gets the negative check: `kernel set failed … device disabled` (WARN/ERROR, any verbosity) → VOID `turn_backend_disabled` (`arm.sh:280-286`) | fixtures `backend-mismatch` (`DRY_TURN_FP_BUF=CPU` = silent fallback → `fp_turn=buf=CPU` vs `fp_proof=buf=GPUOpenCL`), `turn-disabled` (`arm.sh:281-285`), `no-fingerprint` |
| NEW-4 CONFIRMED (broken pgrep answering 1) | **Fixed**: setup self-test BEFORE any load — health probe (missing pattern must answer 1), alive probe (a `sleep 4731` we started must be FOUND), gone probe (after pkill must answer 1); any failure → `PGREP_SELFTEST_ABORT`, exit 4, no arm ever loads. Only after this does `RC=1 mean gone` get trusted. `restore.sh` (which can run standalone) has its own PROBE/GONE health check | `setup.sh:6-24` (selftest), called `setup.sh:70`; `restore.sh:51-63`; fixture `pgrep-broken` (RC=4, END `exit_4_kill_unverified`, no `*.load.log`, restore loud rc=1) |
| NEW-5 CONFIRMED (restore loud but no marker) | **Fixed**: restore writes `$RAW/kill_unverified` when it cannot verify, and `cleanup` runs AFTER restore, so a plain-success end becomes `END kill_unverified` + **exit 3** (or `exit_<rc>_kill_unverified` keeping a nonzero rc); the final `write_end exit_0` moved out of the main path into cleanup | `restore.sh:55-63`, `d_run.sh:155-171`, end-flow `d_run.sh:376-383`; fixture `restore-late` (RC=3, `END kill_unverified`, marker present, restore rc=1) |
| NEW-6 CONFIRMED (pause not synced with device exit) | **Fixed**: `sampler_pause` reads a baseline stamp, touches the marker, then waits (≤6 s) for the device loop's own `H sampler_done` stamp before declaring the window quiet; only then kills the host client; unconfirmed pauses are logged loudly | `sampler.sh:17-49`; fixture `six` (`SAMPLER_PAUSE_CONFIRMED`); fixture `kill-unverified`/`stop-midarm` exercise the same path |
| NEW-7 CONFIRMED (unregistered order restriction) | **Registered**: PREREG amendment #8 — even-length orders of {CG, GC, NN}; `CC` and `CGNGCN` deliberately rejected (no within-pair contrast / unregistered NG,CN pairs); calibration bypasses pairs | `PREREG.md` second amendment pass #8; fixture `A-13` unchanged |
| NEW-8 CONFIRMED (unregistered session cost) | **Registered**: PREREG amendment #9 — +1 full model load per arm (proof run) ≈ +3–11 min for 6 arms; expected session 45–75 min vs default deadline 100; calibration ≈ 5–12 min | `PREREG.md` second amendment pass #9 |

**Fingerprint components (stated):** `buf=<backend names from model-buffer-size
lines>`, `off=<n>/<m> layers to GPU`, `thr=<n_threads>` — all INFO-level in the
proof (`-lv 5`) and in the turn (`-lv 4`), all missing → `?` → fail-closed
`no_fingerprint`, inequality → `backend_mismatch`.

**Commands (this round):** `bash -n` on 16 scripts → 0;
`./dryrun.sh > /tmp/dryrun_r5_FINAL.log 2>&1; echo EXIT=$?` → **EXIT=0,
PASS=259 FAIL=0** (log copied to `raw/dryrun-final-run.log`). Intermediate:
209/15 harness-only issues while landing the round (two wrong assertion
expectations of my own — the calibration run correctly cannot show
`source=calib.ok` before it writes the pin, and a broken-pgrep restore must
rc=1), plus one real typo caught by instrumentation (`screen_off_timeout`
filename in an assert while the fake stores `screen_timeout`).

**Not verified (round 5):** whether the REAL S23 kit at `-lv 4` actually
emits the buffer/offload lines (the source says INFO⇒needs 4 and run-1
proves default shows none — calibrate's `cand=buf|` lines are the instrument
that settles it; if they are absent the gate fails closed with
`no_fingerprint` and the next round pins whatever IS there); whether
`-p " "` yields exactly 1 prompt token on device (threshold scales off the
READ count, so any value works — but calibrate reports it); whether
`adb shell sh -c 'sleep … &'` survives the shell exit on this device (the
alive probe fails loudly if not); toybox `pgrep -f` behavior (now self-tested
before every session); real per-backend ops/token vs the 0.86 prior (the pin
replaces it after calibrate).

## Round 6 — hostile audit3 dd6bdb56: 2 BLOCKER + 3 HIGH + every accepted MEDIUM closed (2026-09-27)

`AUDIT3-dd6bdb56.md` committed with this round. Cell A verdict was NO on two
demonstrated false session verdicts plus three HIGHs; everything below is
fixed in this session, no sub-agents, no phone.

| # | disposition | fix (file:line) + fixture |
|---|---|---|
| BLOCKER A-N9 (calibration certifies VOID proofs) | **Fixed**: `arm_parse_proof` result is now checked after its report line — a VOID proof writes `CALIB_VOID backend=<b> reason=<r>` to the report, `END calib_void_<b>`, **rc 3**, and exits BEFORE the pin is written | `calibrate.sh:73-80`; fixture `calibrate-void` (`CALIBRATE=1 DRY_NO_CPU_PROOF=1` → rc 3, `END calib_void_cpu`, no `calib.ok`, no `results.tsv`) — this fixture exits 0 (calibrated) before the fix |
| BLOCKER A-N2 (stale kill_unverified poisons a clean run) | **Fixed**: the marker joins the start sweep | `d_run.sh:75-79`; `dryrun-lib.sh:15-21` `seed_stale` now seeds it; fixture `stale` asserts rc 0 + `END exit_0` + marker absent (pre-fix: rc 3 + `END kill_unverified`, as the audit demonstrated) |
| HIGH A-N3 (1 Hz sampler survives SIGKILL) | **Fixed**: device-side hard bound — `MAX_EPOCH = now + 14400` (4 h) in the loop condition, expiry stamps `H sampler_expired` before the done stamp | `smp.sh:14-17,26,36-37`; *not dry-runnable* — the fake models its own 300-iteration cap; only a real SIGKILL on the board can prove the bound (declared below) |
| HIGH A-N6 (pin not bound to board/kit) | **Fixed**: pin now carries `serial/soc/model_sha/kit_sha`; `pin.sh` refuses missing keys, out-of-band rate or model/kit mismatch (exit 9, pre-device), `setup.sh` refuses a board mismatch once SER+SOC are known (exit 9, pre-mutation); `calib.ok` added to `.gitignore` | `pin.sh:19-62`, `setup.sh:50-52`, `calibrate.sh:131-138`, `.gitignore`; fixtures `calib-pin-mismatch` (rc 9, no END, no load), `calib-pin-badrate` (rc 9 before any adb call — `wait_for_device.txt` absent), `calibrate` asserts the written keys |
| HIGH A-N4 (self-test SIGHUP race + orphan) | **Fixed**: spawn + alive + health + kill + gone in ONE adb session, so the pkill always runs before any host-side verdict and the victim cannot die between sessions; the pattern is assembled at runtime (`q="sleep 47""31"`) so our own shell cmdline never contains it (self-match trap) | `setup.sh:6-25`; fixture `pgrep-broken` still exits 4 with no load (the fake answers the sequence keyed on `ALIVE_RC`, `dryrun-adb.sh:270-280`) |
| MEDIUM A-N5 (floor useless at 4 tokens / fake invents 1200) | **Fixed the two actionable parts**: (a) pin rate must sit in **[0.5, 25] ops/token** or the session refuses pre-device; (b) the fake's execute-op count now scales with its proof tokens (`default 80 = 4 × 20`, inside the band) instead of a constant 1200 — `htp_ops=1200`/pin150 (7.4× the highest observed rate) are gone from every fixture | `pin.sh:31-37`, `dryrun-adb.sh:131`; fixtures `calib-pin-badrate`, `htp-low` (2 vs min 4), `pinned-floor` (20 vs min 40), `calibrate` (pin 10.0000) |
| MEDIUM A-N7 (unconfirmed pause indistinguishable from clean) | **Fixed**: 26th column `sampler` = `ok`/`unconfirmed`/`na`, set by the pause itself; PREREG schema amended (#10) | `sampler.sh:9-12,22,42,52`, `d_run.sh:260-262` + rows `:322,345`; fixtures `six` (col26=ok) and `sampler-unconfirmed` (`DRY_SAMPLER_NO_DONE` → `SAMPLER_PAUSE_UNCONFIRMED` + col26=unconfirmed, rows still OK — validity recorded, not silently clean) |
| MEDIUM A-N8 (`off` does not separate G from N) | **Fixed**: calibration now prints `CALIB buf_gpu=… buf_npu=…` and FAILS on a collision (`END calib_buf_collision`, rc 3); the arm.sh comment now says `off` is a layer count whose literal reads "GPU" for HTP too and that identity comes from the -lv 5 thresholds | `calibrate.sh:108-118`, `arm.sh:182-196`; fixtures `buf-collision` (`DRY_TURN_FP_BUF=GPUOpenCL` → rc 3) and `calibrate` asserts the comparison line |
| LOW A-N10 (two cosmetic report contradictions) | **Fixed**: calibrate header prints the floor IN EFFECT + source (not always the prior); the `off` reword is the A-N8 comment; `fit`/`htpwarn` families labelled informational in `calib_candidates` (the gate excludes fit by design) | `calibrate.sh:44-47,24-27`, `arm.sh:182-196` |
| LOW (restore rc mixes two causes) | **Fixed**: the restore line now carries `kill_check=verified|unverified` as its own field next to `rc=` | `restore.sh:79-84` (existing `state=1 .*rc=0` assertions unaffected) |
| LOW (host `pkill -f` cross-session) | **REJECTED** — the pattern is this cell's unique device dir (`/data/local/tmp/heat3way`), so a cross-kill needs two concurrent sessions on the SAME cell, which the protocol forbids (one session per cell at a time); a second pattern would only weaken the match | one line, here |
| A-N5 second clause (`tokens ≥ 16` or a second sample) | **REJECTED** — the production proof is structurally `-p " " -n 4` (≤5 tokens), so ≥16 would void every legitimate pin, and a second calibration sample triples the cost the [0.5,25] band already covers | one line, here |
| dead-code notes (`arm.sh n` unvalidated, `SAMPLER_PAUSED` not reset) | **Fixed**: numeric guard on `n` (`arm.sh:86`), `SAMPLER_PAUSED=0` in `stop_sampler` (`sampler.sh:59`) | — |

**Commands (this round):** `bash -n` on 17 scripts → 0;
`./dryrun.sh > /tmp/dr6.log 2>&1; echo EXIT=$?` → first EXIT=1 (6 fails:
my own assertion looked for `CALIB_VOID` in the report before it was written
there, and the bespoke SIGHUP block had no pin isolation — a seeded
bad-rate pin from the previous fixture aborted it with rc 9), then
`./dryrun.sh > /tmp/dr6b.log 2>&1; echo EXIT=$?` → **EXIT=0, PASS=293
FAIL=0** (log copied to `raw/dryrun-final-run.log`).

**Not verified (round 6):** the 4 h sampler bound is device-side shell — the
fake has its own iteration cap, so only a real SIGKILL on the board proves
it; the single-session self-test's SIGHUP/self-match behavior on real adbd
(assembly verified by reading, execution only against the fake); the real
`buf` strings for G and N (calibration prints them — `buf_collision` only
fires if they agree); pin keys against a real (non-fake) calibration run;
`DRY_SAMPLER_NO_DONE` models the unconfirmed path, not the device timing.

## Declared, not touched

Nothing pre-existing was refactored: `../qdc-heat-per-backend/*` and
`npu-spec-verify/*` are read-only for this cell (the former runs live on QDC);
its oversized `parse.sh` (48 KB app harness) is pre-existing excess, left
alone by design — this cell does not source it. `safety.sh` from round 1 was
replaced by `stop_lib.sh` (A15), not kept alongside it.

## Real S23 session — 2026-09-26

**Stopped after arm 1; no three-backend comparison.** Preflight passed on
SM8550: unplugged (AC/USB/Wireless/Dock all false), battery 65% at 25.9 °C,
thermal status 0, skin 27.3 °C, `persist.traced.enable=0`, display Awake.
Pre-run DSP ticks: adsprpcd 0/0, cdsprpcd 0/5. The model, prompt and v73 kit
were pushed and SHA-verified; device list contained GPUOpenCL and HTP0. The
battery sensor check returned trusted (dumpsys 26.6→26.9 °C; sysfs reading
unavailable), so no skin fallback gate was added; the 44 °C battery stop
remained armed. Restore returned rc=0, restored timeout `null` and stay-on 0,
stopped the sampler; post-run traced remained 0 and the display returned to
Dozing. Post DSP ticks: adsprpcd 0/6, cdsprpcd 0/12.

The first CPU turn exited 0. Its raw perf output did not match the parser's
assumed token positions: the binary emitted a timestamp and severity before
`common_perf_print:`, so the parser returned `run_fail` and stopped the
session. Representative raw lines:

```
1.17.377.184 I common_perf_print: prompt eval time =   10947.50 ms /  1018 tokens (   10.75 ms per token,    92.99 tokens per second)
1.17.377.201 I common_perf_print:        eval time =   22178.79 ms /   126 runs   (  176.02 ms per token,     5.68 tokens per second)
```

| Pair | Turn | Backend | Proof counts (CPU assignment / GPU assignment / HTP execute-op / GPU kernels) | prompt_n | decode_runs | prefill ms | decode tok/s | Skin °C | Battery °C | Load phase |
|---|---:|---|---|---:|---:|---:|---:|---|---|---|
| 1 | 1 | CPU | 0 / 0 / 0 / 0 (CPU proof absent) | 1018 | 126 (required 127) | 10947.50 | 5.68 | 28.2→29.9 | 26.6→28.1 | 32 s; skin 28.2→28.8; in-process load 10950.51 ms; pagein_cold=1 |

The CPU prefill (10.95 s) is inside PREREG's 8–45 s range and below its
15 s point prediction. Skin rose 1.7 °C, inside the registered +0.5…+5.0 °C
range and below the +2.5 °C point. The row is still VOID: its decode count
was 126, and CPU assignment proof was absent. The equal-decode gate, GPU/HTP
proofs, remaining arms, and all CPU−GPU / CPU−NPU contrasts are unavailable;
no prediction about backend ranking or comparative heating was tested.

The run used `CGNNGC`, `-n 127 --ignore-eos`, and the preregistered proof
thresholds unchanged. A minimal post-row fail-fast guard was added to
`d_run.sh` before execution so any VOID parser/proof row ends the session;
`bash -n d_run.sh` passed. No PREREG content was changed. Raw preflight,
complete arm log, parser row, stop/restore, and DSP snapshots are under
`raw/s23-cli-heat-20260926/`.

## Manual S23 decode diagnosis — 2026-09-26

No heat arms or cell code changes. Preflight passed: unplugged, battery 63%
at 29.0 °C, skin 29.9 °C, thermal status 0, traced 0; display was awakened
before each command. Battery/thermal/traced were checked between tests and
afterward (last: 62%, 31.9 °C battery / 32.4 °C skin, thermal 0, unplugged,
traced 0). The optional skin stop was not approached. DSP before was
adsprpcd 0/10, cdsprpcd 0/16; after 0/24 and 0/30. Original display settings
(`screen_off_timeout=null`, `stay_on_while_plugged_in=0`) were restored.

All four commands returned exit 0. For (a)–(c), the diagnostic prompt was
`Reply with exactly READY.` (15 prompt tokens); each used `-ngl 0`, `-t 8`,
`-fa 1`, `--no-warmup --perf`, `-n 64 --ignore-eos`. (b) added
`--poll 1000`; (c) added `-tb 8`. The cpuset was read in the remote shell
immediately before `exec` replaced that same PID with the binary:
`CPUSET=/` for all four commands (root cpuset; no restricted cpuset path).

| Command | Raw eval line | Decode tok/s |
|---|---|---:|
| (a) completion default poll | `4234.94 ms / 63 runs` | 14.88 |
| (b) completion `--poll 1000` | `5575.90 ms / 63 runs` | 11.30 |
| (c) completion `--poll 1000 -tb 8` | `9492.21 ms / 63 runs` | 6.64 |
| (d) llama-bench as requested | `tg64 @ d1018: 6.28 ± 2.36 t/s` | 6.28 ± 2.36 |

Completion raw `common_perf_print:` eval lines (full logs in the raw folder):

```
(a) eval time = 4234.94 ms / 63 runs (67.22 ms per token, 14.88 tokens per second)
(b) eval time = 5575.90 ms / 63 runs (88.51 ms per token, 11.30 tokens per second)
(c) eval time = 9492.21 ms / 63 runs (150.67 ms per token, 6.64 tokens per second)
```

This confirms the count relationship: `-n 64` yields 63 eval runs here, as
the long CLI turn's `-n 127` yielded 126. The first generated token is
sampled from prompt-eval logits; only subsequent tokens need eval runs.
`--poll 1000` did not explain or fix the slow decode in these one-shot tests;
(b)/(c) were slower than (a), with no repeats to estimate run-to-run noise.
The bench row is not a CPU-only comparator: it reports `backend=OpenCL,HTP`
and `ngl=-1` (the command omitted `-ngl 0`). That log loaded the Adreno
OpenCL device and HTP v73, but contains no HTP execute-op or OpenCL kernel
dispatch proof lines, so the backend label alone does not prove either
backend executed the benchmark graph. The earlier 5.68 tok/s came from the
1018-token context; (a)–(c) used a 15-token prompt, while (d) used
`tg64 @ d1018`. Context depth and the bench's backend configuration remain
the clearest confounds; these single trials do not isolate a scheduler cause.

Raw commands, full binary output, per-test pre/post safety readings, cpusets,
DSP snapshots, and screen restore are in `raw/s23-cli-diag-20260926/`.

## S23 startup jank and CPU decode repeat — 2026-09-26

No cell code or app data changed. Two cold launches of `com.kalsa.app` were
measured idle for 30 s after launch. `gfxinfo`: run 1, 3/11 janky (27.27%),
p50/p90/p99 11/27/32 ms; run 2, 3/10 (30.00%), 10/48/48 ms. **The idle
startup is janky in both samples**, though the frame counts are small. `top`
peaks while loading were `mqt_v_native` 84.4% / 96.1%, with
`FrescoDecodeExe` 63.8% and `AsyncTask` 72.4% also busy. Logcat reports
`KALSA_PREWARM done` at 14,263.837 ms and 14,252.387 ms (prompt_n 1660),
in `raw/s23-app-stutter-20260926/run{1,2}_load_logcat.log`.

Representative timestamped logcat lines:

```
09-26 16:48:38.329 22317 22346 I ReactNativeJS: 'KALSA_PREWARM', '{"op":"start","hash":"3677660334","systemChars":3886,"toolCount":3}'
09-26 16:48:52.651 22317 22346 I ReactNativeJS: 'KALSA_PREWARM', '{"op":"done","promptMs":14263.837,"promptN":1660,"hash":"3677660334"}'
09-26 16:49:53.782 22749 22774 I ReactNativeJS: 'KALSA_PREWARM', '{"op":"start","hash":"3677660334","systemChars":3886,"toolCount":3}'
09-26 16:50:08.059 22749 22774 I ReactNativeJS: 'KALSA_PREWARM', '{"op":"done","promptMs":14252.387,"promptN":1660,"hash":"3677660334"}'
```

CPU-only CLI repeats used the verified 1018-token `prompt.txt`, `-ngl 0`,
`-n 64 --ignore-eos`, 8 threads and `-fa 1`, in A-B-A-B order (A default
poll; B `--poll 1000`). Each valid process reported `CPUSET=/`; power state
was Awake before and after every run, and the background WAKEUP interval
never exceeded 5 s. `-n 64` yielded 63 eval runs in all four complete runs.

| Run | Start battery / temp / thermal / cpu7 MHz | Raw eval line | tok/s |
|---|---|---|---:|
| A1 | 51% / 35.5 C / 0 / 864 | `1084640.27 ms / 63 runs` | 0.06 |
| B1 | 42% / 37.4 C / 1 / 864 | `641214.61 ms / 63 runs` | 0.10 |
| A2 | 37% / 37.8 C / 1 / 864 | `525778.83 ms / 63 runs` | 0.12 |
| B2 | 33% / 37.2 C / 1 / 864 | `3766.11 ms / 63 runs` | 16.73 |

Rates are not stable enough to attribute the difference to polling: the
second B line reports 16.73 tok/s but its total time includes 97.6 s
unaccounted, versus 0.10 tok/s in B1. The preliminary A/B attempts are also
retained but marked invalid because their detached keepalive exited, leaving
continuous Awake state unproven. The four valid
records, raw perf lines, sensor/power captures, and wake timestamps are in
`raw/s23-app-stutter-20260926/cpu-decode/`.

Quoted raw completion eval lines:

```
A1 19.02.456.871 I common_perf_print:        eval time = 1084640.27 ms /    63 runs   (17216.51 ms per token,     0.06 tokens per second)
B1 11.51.099.349 I common_perf_print:        eval time =  641214.61 ms /    63 runs   (10178.01 ms per token,     0.10 tokens per second)
A2 9.32.848.522 I common_perf_print:        eval time =  525778.83 ms /    63 runs   ( 8345.70 ms per token,     0.12 tokens per second)
B2 1.56.393.210 I common_perf_print:        eval time =    3766.11 ms /    63 runs   (   59.78 ms per token,    16.73 tokens per second)
```

The requested CPU-only `llama-bench` (`-ngl 0 -t 8 --poll 1000 -fa 1 -p 0
-n 64 -d 1018 -r 3`) was interrupted before a result row when the battery
reached the 25% hard stop (40.6 C, thermal 2); no bench rate is reported.
Final `persist.traced.enable` remained 0, timeout was restored to `null`,
and `stay_on_while_plugged_in` remained 0. No uninstall or data clear was
performed.

### Follow-up: app lifetime and native-thread load correlation

The command ledger records `am force-stop com.kalsa.app` only before each
TASK 1 cold launch; it records no force-stop between TASK 1 and the CPU CLI
runs. The preflight `ps` filtered only `llama|bench`, and TASK 2 recorded no
Kalsa PID check or `dumpsys meminfo`. Thus Kalsa was likely still resident
during TASK 2, but its PID/lifetime at each CLI run is not directly proven.
No `lowmemorykiller`, `lmkd`, `kswapd`, or meminfo evidence is present in the
saved raw logs. During TASK 1, `top` showed the app at up to 2.2G RES / 1.8G
SHR and system swap use around 2.2G; this is consistent with substantial
memory pressure, but does not prove the app remained alive in TASK 2.

In both 30-second startup windows, `mqt_v_native` peaked at 84.4% / 96.1%
(first sample for run 2), coincident with `KALSA_NATIVE ... load_tensors ...
(load_mode = mmap+mlock)` and `KALSA_PREWARM` start-to-done of about 14.26 s.
This points to native model load/prewarm activity; there is no retained stack
trace or explicit repack event to identify the exact native operation. Each
retained PID-filtered log has exactly 2 `KALSA_NATIVE` lines. The original
full logcat dumps were not retained, so the total number of all mirror lines
in either 30-second window cannot be recovered.
