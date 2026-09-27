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
- `setup.sh` (80) — pre-arm device setup: prior restore, state, trap arming,
  mutations, kit+trust+gate, the single-session pgrep self-test, sampler.
- `pin.sh` (75) — calib.ok pin resolution/validation (keys, [0.5,25] rate,
  model/kit binding, board binding) or exit 9.
- `calibrate.sh` (140) — CALIBRATE=1 loop: proof + short run per backend,
  candidate report, VOID-proof refusal, G/N buf-collision check, pinned floor.
- `stop_lib.sh` (107) — live readings, fail-closed numeric checks, hard
  stops, `request_stop` + verified `kill_remote_llama` (sourced; DSpark too).
- `battery_trust.sh` (69) — battery-sensor verdict (two-sample mismatch).
- `kit.sh` (76) — `prompt_verify`, push and byte-verify kit/model/prompt/
  sampler, remote-log+samples sweep, backend-name preflight.
- `arm.sh` (362 — declared, over the ~350 indicative: proof/turn cmds, two parses, gates; splitting would move lines only for the number) — proof-run and turn commands, run/pull, shared perf parse,
  fingerprint (with the `off`-is-a-count note), the two parses.
- `sampler.sh` (73) — sampler lifecycle: launch, confirmed pause (state →
  row column), resume, stop.
- `restore.sh` (88) — undo every device change (standalone-capable,
  health-probed kill with a `kill_check=` verdict field).
- `smp.sh` (41) — on-device 1 s sampler: append-only + 4 h hard bound.
- `dryrun-adb.sh` (448 — declared, over the ~350 indicative) — fake adb with
  reading/log/kill/pgrep/sampler knobs, the pgrep self-match model, a
  `dash -n` syntax check on every shell string, and the real f25 log shapes
  (buffer sets, verbatim hexagon lines).
- `dryrun.sh` (28, orchestrator) + `dryrun-lib.sh` (148, incl. real-pin
  backup/restore + bad-flag assertion) + `dryrun-core.sh` (253) +
  `dryrun-stops.sh` (120) + `dryrun-paths.sh` (136) — fixture matrix split by
  topic (44 fixtures, 428 assertions).
- `PREREG.md` (379), `REPORT.md`, `AUDIT{,2,3}-dd6bdb56.md`.

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

## Round 7 — pgrep probes self-matched on the S23 (run 1640559a) — red→green (2026-09-27)

The first real S23 run died at setup with `PGREP_SELFTEST_FAIL
health_probe_rc=0`; the coordinator proved the cause on the board: `pgrep -f
'zzz_no_such_proc_zzz'` run through `adb shell` finds the wrapping `sh -c`,
whose own cmdline contains the literal (plain → RC 0; bracket → RC 1; and
when both forms sit in one command the bracket one also matches, because the
plain occurrence is right there). Both probes in this cell had the plain
form — the setup self-test aborted every session, and `restore.sh` would have
reported `PROBE=0` forever, turning every clean end into
`kill_unverified`/rc 3.

**Fixes (file:line)**

| what | where |
|---|---|
| setup self-test health probe bracketed `'[z]zz_no_such_proc_zzz'` + the two invariants documented (pattern assembled/bracketed AND its unbracketed literal absent from the whole command) | `setup.sh:8-17` |
| restore probe bracketed, same rule stated | `restore.sh:44-56` |
| fake models the general rule: a pgrep/pkill target self-matches iff the command string contains its UNBRACKETED literal (health zzz, victim `sleep 4731`, llama `llama-completion`); restore probe keyed on the invariant `PROBE=` marker, not on a glob-visible literal | `dryrun-adb.sh:264-325` |
| new fixture `no-selfmatch`: rc 0, `PGREP_SELFTEST_OK`, rows 2, `kill_check=verified`, restore rc 0 | `dryrun-paths.sh:92-101` |

**Red → green, same fixture, quoted exit codes**

```
# old probes (plain zzz) + self-match-modeling fake:
./dryrun.sh > /tmp/dr7-red.log 2>&1; echo "EXIT=$?"
EXIT=1   PASS=101 FAIL=200        (raw/dryrun-selfmatch-red.log)
         nsm: rc [0]≠[4], END [exit_0]≠[exit_4_kill_unverified];
         raw/dry-no-selfmatch/driver.log: PGREP_SELFTEST_FAIL health_probe_rc=0
         raw/dry-no-selfmatch/restore_run.log: RESTORE_LLAMA_UNVERIFIED probe_rc=0 gone_rc=1
# after the bracket fixes:
./dryrun.sh > /tmp/dr7-green2.log 2>&1; echo "EXIT=$?"
EXIT=0   PASS=301 FAIL=0           (raw/dryrun-final-run.log; nsm fully PASS)
```

**Static literal audit** (python one-off over every device pgrep/pkill
command): `setup.sh` selftest (`zzz_no_such_proc_zzz` absent, `sleep 4731`
absent-via-assembly), `restore.sh` (`zzz…` absent, `llama-completion`
absent), `stop_lib.sh:71-72` pkill+pgrep (`llama-completion` absent —
bracketed) → **PASS, 6/6, zero unbracketed literals**. Host-side
`pkill -f "$HEAT_TMP/smp.sh"` (`restore.sh:45`) is a path pattern, absent
from this process's cmdline, and pkill never matches itself.

**spec-dspark-gpu-draft (READ-ONLY — not staged, not edited), one finding:**

- **`spec-dspark-gpu-draft/d_run.sh:149`** — health probe
  `pgrep -f zzz_no_such_proc_zzz >/dev/null 2>&1; echo PROBE=$?` uses the
  PLAIN literal → on a real phone the wrapping sh self-matches → `PROBE=0`
  forever → their `kill_spec_verified` takes the `pgrep_broken` branch every
  time (`d_run.sh:151-154`), so every kill is recorded `KILL_VERIFY_FAIL`
  despite being clean (fail-closed, but permanently false and it would mask a
  real pgrep breakage). Fix for its owner: bracket `'[z]zz_no_such_proc_zzz'`
  and keep that literal absent from the same command.
- Their other sites are SAFE: the self-test victim is assembled
  (`d_run.sh:127`, `q="sleep 12"; q="$q""345"` — the contiguous
  `sleep 12345` never appears in the cmdline), and `llama-speculative-simpl[e]`
  at `d_run.sh:144,159` and `restore.sh:43` has no plain `…simpl`+`e`
  occurrence in its commands. There is **no `stop_lib.sh` in that cell** —
  the `stop_lib_pgrep_selftest` shim (`d_run.sh:116-118`) falls through to
  that local assembled self-test.

**Commands (this round):** `bash -n` on all scripts → 0; python literal
checker → PASS (6/6); red run EXIT=1 (101 PASS / 200 FAIL); green run
**EXIT=0 (301 PASS / 0 FAIL)**; `git add` only qdc-heat-3way paths.

**Not verified (round 7):** the fixed commands were not re-executed on the
S23 (no phone) — the coordinator's on-device proof covers the health pattern
plain-vs-bracket pair; the other two targets follow the same no-plain-literal
rule but rest on that proof plus the static check. The fake's self-match
model is a semantic emulation (glob over the raw command string), not an
execution of pgrep. `dryrun-adb.sh` is declared at 386 lines (over the ~350
indicative) — kept whole; splitting it now would move lines only for a number.

**Note on `AUDIT4-dd6bdb56.md`** (arrived mid-round, verdict "SÌ — nessun
blocker"; committed with this round as cell evidence): its two mediums are
NOT yet addressed — N-A1 (a valid pin rejected because the serial is an
alias of this board's) and N-A2 (the G/N buf-collision check is skipped when
either `buf` is `?`) — awaiting instruction, as this round's brief covered
the self-match defect only.

## Round 8 — the double `&&` that killed S23 run 2 (9c5474d6) — red→green (2026-09-27)

Run 2 died at the first CPU load with `/system/bin/sh: syntax error:
unexpected '&&'` (`END calib_fail_load_cpu`): `arm_env` ends its printf in
`&& ` and `arm_proof_env` prepended ANOTHER `&& `, producing
`… GGML_HEXAGON_NDEV=1 && && export GGML_HEXAGON_VERBOSE=1 …` — every
proof/load command was invalid shell since 5ba47a92, and the matrix never
noticed because the fake executed nothing.

| # | fix (file:line) |
|---|---|
| 1. double `&&` | `arm.sh:75-84` — `arm_proof_env` now composes `arm_env` output + its own `export … && ` with **no separator of its own**, and `arm_env` carries the invariant comment (a consumer must not prepend a separator) |
| 2. fake syntax-checks EVERY `shell` string | `dryrun-adb.sh:247-258` — `dash -n -c "$cmd"` before dispatch; a rejected string is appended to `$STATE/shell_syntax_error.log` and the command fails like a broken remote shell (rc 2). Interpreter: **dash** (`/bin/dash` — POSIX, the closest to `/system/bin/sh` on this Mac; `busybox` and `mksh` are not installed, verified `command -v` EXIT=1). Assertion wired into the runner for every fixture (`dryrun-lib.sh:68-75`) and the bespoke SIGHUP block (`dryrun-paths.sh:121-125`) |
| 3. same-class audit of every assembled command | (a) composed commands unit-checked: `arm_remote_cmd cpu`, `arm_remote_cmd npu 16`, `arm_load_cmd gpu` each piped to `dash -n -c` → **PASS 3/3, EXIT=0**; (b) static grep `&& &&|&& ;|&&&&|; ;` over all `*.sh` → single hit is the comment documenting this bug (`arm.sh:78`); (c) every literal shell string (selftest, probes, kit, settings, sampler) now flows through the fake's `dash -n` at fixture runtime — 39 `shell-syntax` assertions, all green |

**Red → green, quoted exit codes**

```
# old arm.sh (double &&) + syntax-checking fake:
./dryrun.sh > /tmp/dr8-red.log 2>&1; echo "EXIT=$?"
EXIT=1   PASS=206 FAIL=134        (raw/dryrun-double-amp-red.log)
         six-arms shell-syntax FAIL quoting the exact `… NDEV=1 && && export …` load command
# after the arm_proof_env fix:
./dryrun.sh > /tmp/dr8-green.log 2>&1; echo "EXIT=$?"
EXIT=0   PASS=340 FAIL=0           (raw/dryrun-final-run.log)
bash -n on every script → 0
```

**Not verified (round 8):** `dash -n` is a POSIX parser, not Android's
`/system/bin/sh` (mksh/toybox lineage) — it accepts a superset in places; the
composed commands are simple `export`/`&&`/redirect chains where the two
agree, but a construct that differs would need the board to catch. The real
S23 has not re-run these commands (no phone). The `dash -n` check parses, it
does not execute: a command can be syntactically valid and still fail
remotely (paths, flags) — that class stays covered by the device run itself.

## Round 9 — run 3 voided the NPU on a line f25 does not print (ecf70a63) — red→green (2026-09-27)

Run 3: CPU and GPU calibrated; NPU really ran (1675 execute-op, 1525.87 MiB
HTP0 buffer) and was voided `no_htp_proof` because `arm.sh` required a
`Hexagon Arch version` line that engine f25f0c1c5 does not print. Audited
against the committed real logs with `LC_ALL=C grep -a` (the NPU log is
`Non-ISO extended-ASCII`).

| fix (file:line) | what |
|---|---|
| `arm.sh:275-287` | **dual-form arch**: `Hexagon Arch version` (older kits) OR the session URI `… libggml-htp-v<NN>.so` (f25 — run 3's real shape, `raw/s23-calib-3/s23-calib-3-calnpu.load.log:274-275`); neither → VOID `no_htp_arch`. Execute-op floor (NEW-1 scaling) unchanged |
| `arm.sh:269-275` | **HTP0 placement required** for the N proof: the fingerprint must carry `HTP0` (run 3's `HTP0 model buffer size = 1525.87 MiB`) — dispatch alone is not placement → VOID `no_htp_placement` |
| `arm.sh:205-207` | **extractor same-class bug**: the old `[^A-Za-z0-9:]` split `CPU_REPACK` into `REPACK` on the REAL log; now space-anchored → `CPU,CPU_REPACK` (unit-checked on the committed logs) |
| `dryrun-adb.sh` npu block | invented `Hexagon Arch version` line **removed**; the two real f25 lines copied VERBATIM (hwinfo `0.00.315.055 I …`, new session `0.00.315.451 I … libggml-htp-v73.so?…` incl. timestamps); `DRY_NO_ARCH=1` omits the session line for the still-void fixture; buffer sets now match the real names/sizes (CPU+CPU_REPACK / +OpenCL / CPU+HTP0), 31 layers, `off 0/31 · 31/31` |
| `dryrun-core.sh` real-log fixture | parsers run against the COMMITTED real `raw/s23-calib-3` logs (non-circular): NPU arch=v73 from the URI, `htp_ops=1675 min=12`, cpu `tokens=13`, gpu `assigned=62 kernels=15`, extractor keeps `CPU_REPACK`, proof↔turn fp equality on both real backends |

**Same-class audit of every field the calibration report parses vs the real
logs** (the rest of `raw/s23-calib-3/calib/report.txt` cross-checked):
`tokens=13` (prompt `" "` = 10 tokens + 3 runs) and `min=ceil(0.86×13)=12`
match the real report arithmetic ✓; `thr=5`, `off=0/31·31/31`,
`gpu_assigned_lines=62 kernels=15`, buffer sets and prefixed turn perf lines
all present ✓. **Listed, no fix:** the `fit|`/`htpwarn|` candidates are
absent from the real G/N logs (`-ngl 99` does not take the `to 0` abort
path) — informational families only, no gate consumes them (labelled in
`calib_candidates`); the NPU `cand=` lines are absent only because run 3
aborted pre-turn and will appear on the next calibration. Non-UTF-8 safety:
the driver exports `LC_ALL=C` (`d_run.sh:16`), `dryrun.sh` now exports it
too, and every file-reading `grep` in the harness is `-a`.

**Red → green, quoted exit codes**

```
# OLD arm.sh (arch-version-only + old extractor), new fixture + fake:
./dryrun.sh > /tmp/dr9-red.log 2>&1; echo "EXIT=$?"
EXIT=1   PASS=319 FAIL=33        (raw/dryrun-arch-red.log)
         real-log fixture: npu VOID `htp_ops=1675 min=12` (no arch), cpu extractor `buf=CPU,REPACK`
# after the fixes:
./dryrun.sh > /tmp/dr9-green3.log 2>&1; echo "EXIT=$?"
EXIT=0   PASS=352 FAIL=0          (raw/dryrun-final-run.log; real-log fixture 10/10 green)
```
Two intermediate green attempts (326/26 then 348/4) caught my own fake bugs
before commit: `tr` without a trailing newline dropped the LAST buffer name
in every set, and the collision forge needed the pipe form (`'DRY_…=CPU|…'`)
because comma names are not extractable — both fixed in the fake/fixture.

**Legacy form** unit-checked inline: synthetic `Hexagon Arch version v79` →
`v79`; real f25 log → (empty for that form) + `v73` from the URI; neither →
empty. `bash -n` on every script → 0.

**Not verified (round 9):** the fixed NPU proof has not run on the S23 (no
phone) — the URI-arch extraction is proven on the committed real log and the
legacy form on a synthetic line only; the fake's verbatim hexagon lines come
from run 3 but its `handle` value is run-3 device-specific (informational,
never parsed); whether older-kit logs still carry `Hexagon Arch version` at
that exact wording rests on the STEP0-era captures, not this kit; `dash -n`
remains a POSIX parser, not Android's shell.

## Round 10 — the band refused a VALID pin; calib4 measured 128.85 ops/token (2026-09-27)

Calibration 4 on the S23 passed (`END calibrated`, NPU `arch v73`,
`htp_ops=1675` over 13 tokens → 128.85 ops/token, pinned 64.4231 = 0.5 ×).
The heat run was then refused pre-setup with exit 9
`floor_rate_out_of_band(64.4231)` — **the band was wrong, not the pin**: the
old [0.5, 25] ceiling came from 1024-token batched-PREFILL priors (q57 1.72 …
q51 20.2 ops/token, dispatches amortised over the batch), while the proof
shape is 1 prompt batch + 3 decode STEPS each re-dispatching the whole graph
(~129 ops/token expected on this shape).

| fix (file:line) | what |
|---|---|
| `pin.sh:35-44` | band → **[0.5, 500]** (~4× the measured decode-shape rate; garbage-only check — the pin is already bound to serial/SoC/model/kit), with the WHY spelled out in the comment (prefill-batch priors vs per-step dispatch) |
| `PREREG.md:129-145` | fourth amendment pass #13 records the measured **128.85** (pin 64.4231 = 0.5×), the old ceiling's provenance, the new [0.5, 500] band and the refused heat run |
| `dryrun-lib.sh:8-27,44` | the REAL cell pin survives the matrix byte-identically: first `run_fixture` backs it up, each fixture controls `calib.ok` only inside its own run, an EXIT trap restores the real pin (or removes a fixture-created one — no fake pin ever left) |
| `dryrun-paths.sh:91-96` + `dryrun-core.sh:220-231` | fixtures: **5000** (upper) and **0.1** (lower) still refused with `CALIB_PIN_INVALID why=floor_rate_out_of_band` rc 9 pre-device; **64.4231 accepted and applied** — `source=calib.ok`, `CALIB_PIN_BOARD_OK`, `htp_ops=300 min=258` (= ceil(64.4231×4 proof tokens)), rows 2 OK, END `exit_0` |

**The real `calib.ok` was not touched** (luna reuses it): sha256 before the
dry-run `6bfff2b9d9615c41db52cca5784d2f4c7056d9f6f3106af2fcdf79bcf2f9cdf1`,
identical after (`shasum -a 256 calib.ok` both quoted above); it is
git-ignored, so nothing device-specific is committed either.

**Commands (this round):** `bash -n` on all scripts → **EXIT=0**;
`./dryrun.sh > /tmp/dr10.log 2>&1; echo "EXIT=$?"` → **EXIT=0, PASS=368
FAIL=0** (log `raw/dryrun-final-run.log`); `shasum -a 256 calib.ok` before/after
→ identical `6bfff2b9…f9cdf1`.

**Not verified (round 10):** the 500 ceiling rests on a single board and a
single proof shape — a genuinely broken pin between 64.4231 and 500 would
pass the band (the pin's serial/SoC/model/kit binding is the backstop);
the backup/restore of the real pin is proven by sha equality on this dry-run
only; the refused heat run itself was not re-attempted (no phone).

## Round 11 — run 5 hung in conversation mode; raw prompt + interactive gate (44395c94, 2026-09-27)

Run 5 (CPU) hit `ARM_TIMEOUT` 900 s / rc 142 → `END method_void_run_fail`
(kill verified, restore fine). Cause: llama-completion AUTO-ENABLED
conversation mode from the GGUF chat template, templated the prompt as a
user turn, generated, then **waited on stdin**. Every log so far —
calibration included — carries the interactive lines
(`grep -c 'interactive mode'` = 2 per log: `interactive mode on.` +
`== Running in interactive mode. ==`); the short runs happened to exit 0.

**Source quotes (engine f25f0c1c5):**
- `tools/completion/completion.cpp:170-175`: `// auto enable conversation
  mode if chat template is available` → `LOG_INF("… enabling conversation
  mode (disable it with -no-cnv)")`.
- `common/arg.cpp:1899-1906`: `{"-cnv", "--conversation"},
  {"-no-cnv", "--no-conversation"}` — help: `"… interactive mode is also
  enabled (default: auto enabled if chat template is available)"`, handler
  sets `COMMON_CONVERSATION_MODE_DISABLED`.
- `tools/completion/completion.cpp:365-376`: `if (params.conversation_mode)
  { … params.interactive_first = true; }` → with `-no-cnv` the stdin wait is
  never armed. (The real log itself hints it: `"(disable it with -no-cnv)"`.)
- Real gated line: `0.03.371.770 I == Running in interactive mode. ==`.

| fix (file:line) | what |
|---|---|
| `arm.sh:107` (turn), `arm.sh:118` (proof) | `--no-conversation` (LONG form — `common/arg.cpp:1900` accepts only `-no-cnv` / `--no-conversation`, a double-dashed short name is no alias; `--no-cnv` would be rejected) in BOTH remote commands **and** `</dev/null` on their stdin — no current or future mode can block on input |
| `arm.sh:332-335` (turn, fail-fast) and `arm.sh:246-253,311-314` (proof, deferred past the thresholds so `ARM_PROOF` still carries the real counts) | gate: any proof/turn log containing `Running in interactive mode` → VOID `interactive_mode`; the turn gates before perf, the proof gates last so calib reports keep counts (either reason voids a doubly-bad log) |
| `dryrun-adb.sh:43,216-221` | knob `DRY_INTERACTIVE=1` emits the two real lines (run-5 shapes) in both phases |
| `dryrun-core.sh:144-151` | fixture `interactive-mode`: rc 0, rows 1, VOID `interactive_mode`, `END method_void_interactive_mode` — **RED on the old gate, GREEN after** |
| `pin.sh:31-38`, `calibrate.sh:135`, `dryrun-lib.sh` seeds | `prompt_mode=raw` is a required pin key: the existing pin (templated proofs) lacks it → refused `missing_keys` exit 9 → **recalibration forced**, file untouched |
| `PREREG.md` amendments #14–#15 | raw vs templated prompt for the heat question + the recalibration requirement |

**PREREG position (as the coordinator framed it):** RAW is the right object
for this question — one frozen byte-identical `-f` file across C/G/N, all
three arms identical, so a backend-heat comparison is valid; templated
app-path rows stay incomparable and must never be mixed in.

**Item 5 — what else interactive mode changed in the real logs parsers
relied on (`raw/s23-calib-4/calib/*`, `raw/s23-3way-5/*`):**
- **Proof token count**: `prompt eval … / 10 tokens` + `3 runs` = **13**
  (the templated `" "` = 10 tokens; raw will be 1 + 3 ≈ 4) → the pinned
  rate's basis changes → **recalibration is required** (now enforced by
  `prompt_mode=raw`).
- **Turn count**: calib-4 turns show `prompt eval … / 1018 tokens` and
  `eval … / 15 runs` for `-n 16` — exactly the raw count and N−1, so the
  templating did not change the `-f` file's eval count (1018 was also the
  app's raw chunk count); the post-`--no-conversation` count must be re-observed but
  all three arms share it either way.
- **Perf lines**: present, prefixed, parse unchanged (round-9/10 fixtures
  still pass on those logs) — `interactive_mode` is the only new verdict.
- **N−1 held** in interactive runs too (15/16, 126/127), and `fp/thr/off/
  buffer` are backend facts untouched by the mode — no other parser input
  moved.

**Red → green, quoted exit codes:**
```
# fixture + fake knob, OLD arm.sh (no gate):
./dryrun.sh > /tmp/dr11-red.log 2>&1; echo "EXIT=$?"
EXIT=1   PASS=372 FAIL=4     (raw/dryrun-interactive-red.log; imode rows/status/void/END red)
# after --no-conversation + </dev/null + gates + prompt_mode pin:
./dryrun.sh > /tmp/dr11-green2.log 2>&1; echo "EXIT=$?"
EXIT=0   PASS=379 FAIL=0      (raw/dryrun-final-run.log)
bash -n on every script → 0
```
One miss-step recorded: the first run after the fake edit executed WITHOUT
the new fixture (python anchor typo → fixture never added) and its EXIT=0
was vacuous — caught by the script's own assertion failure, fixture added,
red re-run properly.

**Not verified (round 11):** `--no-conversation` on the real build (flag + hint are in
the source and in the real log, but never executed on the board); that the
post-fix logs are interactive-free (the void path is fixture-proven, absence
unproven until run 6); `</dev/null` behavior on adbd; the real templated pin
refusal (fixtures seed it; the real `calib.ok` sha is unchanged
`6bfff2b9…f9cdf1`); whether turn `prompt_n` stays 1018 after the fix
(observed 1018 while templated — re-observe).

## Round 12 — `--no-cnv` is not an alias; the fake now parses flags (2026-09-27)

Bug in `727b56b6`: both remote commands passed `--no-cnv`, but
`common/arg.cpp:1899-1900` lists `{"-no-cnv", "--no-conversation"}` — a
double-dashed SHORT name is not an alias, so the real binary would reject it
as an invalid argument (the same misspelling would have killed run 6 at
load).

| fix (file:line) | what |
|---|---|
| `arm.sh:109` (turn), `arm.sh:120` (proof) | `--no-conversation` (long, unambiguous) in both commands |
| `arm.sh:48-51`, `PREREG.md:146,153-155`, `REPORT.md` round-11 rows, `pin.sh:33`, `dryrun-core.sh:14` | every prose/comment spelling of what the CODE passes corrected to `--no-conversation`; the source quotes of `-no-cnv` and the arg table itself stay verbatim (they are quotes, not commands) |
| `dryrun-adb.sh:169-186` | the fake now rejects unknown long options against (a slice of) the real arg list before anything loads: an INVALID list containing `--no-cnv`, plus `DRY_BAD_FLAG=1` to inject a miss so the rejector stays exercised; rejection = `REJECTED_FLAG` in `$STATE/bad_flag.log` + `error: unrecognized option` + rc 2 (real-parser shape) |
| `dryrun-lib.sh:110-121` | every fixture asserts that NO invalid option reached an arm (`EXPECT_BAD_FLAG=1` opts in); fixture `bad-flag` (`dryrun-core.sh:153-160`) proves the rejector itself: injected miss → rows `load_fail`, log present |
| `dryrun-core.sh` comments | era renamed to `pre --no-conversation` |

**Red → green, quoted exit codes:**

```
# old arm.sh (--no-cnv) + rejecting fake:
./dryrun.sh > /tmp/dr12-red.log 2>&1; echo "EXIT=$?"
EXIT=1   PASS=287 FAIL=141      (raw/dryrun-flag-red.log)
         six-arms bad-flag FAIL quoting the exact `… --no-cnv -c 2048 …` command
# after --no-conversation:
./dryrun.sh > /tmp/dr12-green2.log 2>&1; echo "EXIT=$?"
EXIT=0   PASS=428 FAIL=0         (raw/dryrun-final-run.log)
bash -n on every script → 0
```

**Not verified (round 12):** the real binary's exact rejection behavior for
`--no-cnv` (exit code and message) — the source proves it is absent from the
table; the fake models it as rc 2 + `error: unrecognized option`. The INVALID
list carries this one alias by design (extend as misses are found, same way
`common/arg.cpp` is the authority); `--no-conversation` itself has still
never been executed on the board.

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

### S23 three-way attempt — calibration stopped in setup

Preflight passed on the pinned endpoint
`adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`: unplugged, 93% charge,
25.9 C battery, thermal 0, `persist.traced.enable=0`, no `llama|bench`
process, and Kalsa force-stopped. The initially dozing/locked display was
woken and unlocked before the driver started. The kit hashes and model/prompt
presence checks passed; `--list-devices` passed. No model load or backend
proof began.

Calibration stopped at setup's pgrep self-test. The driver recorded
`PGREP_SELFTEST_FAIL health_probe_rc=0` and
`END reason=exit_4_kill_unverified`; its control probe expected the
nonexistent-process health check to return 1. The cleanup check repeated the
same false positive (`RESTORE_LLAMA_UNVERIFIED probe_rc=0 gone_rc=1`). As
required, the heat run was not started. `raw/s23-calib-1/calib/report.txt`
and `calib.ok` were not produced; no C/G/N proof tokens, placement
fingerprints, or pinned floor are available.

The driver ran restore, but its return was 1 due to that pgrep health result.
I restored the original absent `screen_off_timeout` setting manually (verified
as `null`), confirmed `stay_on_while_plugged_in=0`, then left the screen Awake
and unlocked. Post-restore: unplugged, 92%, 26.6 C battery, thermal 0, traced
0, Kalsa absent, and no `llama|bench` process. Preflight, failure, and
post-restore evidence are in `raw/s23-calib-1/`.

### S23 three-way retry — calibration load command failed

Preflight on the fixed endpoint `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`
passed: unplugged, 92%, thermal 0, traced 0, Kalsa force-stopped, no
`llama|bench` process, display Awake/unlocked. The corrected pgrep self-test
passed. Kit hashes, model/prompt presence checks, device listing, and sampler
startup passed.

Calibration stopped on the first CPU load phase:
`/system/bin/sh: syntax error: unexpected '&&'` in
`raw/s23-calib-2/s23-calib-2-calcpu.load_shell.txt`. The driver recorded
`END reason=calib_fail_load_cpu` (exit 3). It emitted no calibration proof,
token counts, or `buf=` placement values; there was no `buf=?` line. The
calibration report contains only its header and prior floor. Per the stop
rule, `s23-3way-2` was not run.

Restore completed successfully (`kill_check=verified rc=0`). Final checks:
unplugged, 92%, 26.4 C battery, thermal 0, traced 0, Kalsa absent, no
`llama|bench` process, `screen_off_timeout=null`, stay-on 0, display Awake and
unlocked. Raw preflight, calibration, restore, and final-state evidence is in
`raw/s23-calib-2/`.

### S23 three-way retry 3 — NPU calibration proof void

Preflight passed on the fixed TLS endpoint: unplugged, 91%, 25.9 C battery,
thermal 0, traced 0, Kalsa force-stopped, no `llama|bench` process, and screen
Awake/unlocked. The corrected pgrep self-test passed. Calibration completed
CPU and GPU proof/short-turn phases, then stopped on the NPU proof with
`END reason=calib_void_npu` (exit 3). No `calib.ok` was written and the
six-arm heat job was not run.

| Backend | Proof status / tokens | Proof counts | Placement fingerprint and buffers |
|---|---|---|---|
| CPU | OK / 13 | `cpu_no_offload` | `buf=CPU,REPACK off=0/31 thr=5`; CPU 206.07 MiB, CPU_REPACK 1511.20 MiB |
| GPU | OK / 13 | 62 GPUOpenCL assignments, 15 kernels | `buf=CPU,OpenCL,REPACK off=31/31 thr=5`; CPU 205.08 MiB, CPU_REPACK 205.08 MiB, OpenCL 1307.20 MiB |
| NPU | VOID `no_htp_proof` / 13 | 1675 HTP0 execute-op lines; no `Hexagon Arch version` line | `buf=CPU,HTP0 off=31/31 thr=5`; CPU 205.08 MiB, HTP0 1525.87 MiB |

No calibration buffer fingerprint was `?`; all three `buf=` values are
listed above. NPU met its execute-op count (minimum 12) but failed the
separate Hexagon architecture proof. The effective floor was the prior
0.86 ops/token; no device-pinned floor was produced. The calibration report,
full logs, and buffer summary are in `raw/s23-calib-3/`.

Restore completed (`kill_check=verified rc=0`). Final readings: unplugged,
90%, 30.1 C battery, thermal 0, traced 0, Kalsa absent, no `llama|bench`
process, timeout restored to `null`, stay-on 0, display Awake/unlocked.

### S23 three-way run 4 — calibration passed, heat pin rejected

Preflight passed on the fixed TLS serial: unplugged, 89%, thermal 0, traced
0, Kalsa force-stopped, no `llama|bench` process, screen Awake/unlocked.
Calibration ended `calibrated` (exit 0):

| Backend | Proof / tokens | Arch | HTP ops / minimum | Placement fingerprint |
|---|---|---|---:|---|
| CPU | OK / 13 | n/a | n/a | `buf=CPU,CPU_REPACK off=0/31 thr=5` |
| GPU | OK / 13; 62 assignments, 15 kernels | n/a | n/a | `buf=CPU,CPU_REPACK,OpenCL off=31/31 thr=5` |
| NPU | OK / 13 | v73 (session URI) | 1675 / 12 | `buf=CPU,HTP0 off=31/31 thr=5` |

Calibration pinned `htp_ops_floor_per_tok=64.4231` (1675 / 13). The heat
command exited 9 before session setup with
`CALIB_PIN_INVALID why=floor_rate_out_of_band(64.4231)`; the driver accepts
only 0.5–25. Therefore the heat job has no END marker and zero arms: no
per-arm status, temperatures, throughput, fingerprint-match or sampler
values exist. No retry was made. The calib buffer values are CPU
206.07 MiB + CPU_REPACK 1511.20 MiB; GPU CPU 205.08 + CPU_REPACK 205.08 +
OpenCL 1307.20 MiB; NPU CPU 205.08 + HTP0 1525.87 MiB.

Calibration restore verified (`kill_check=verified rc=0`). Final checks after
the refused heat start: unplugged, 88%, 28.9 C battery, thermal 0, traced 0,
Kalsa absent, no `llama|bench` process, timeout `null`, stay-on 0, screen
Awake/unlocked. Raw calibration, pin snapshot, heat refusal, and final state
are in `raw/s23-calib-4/` and `raw/s23-3way-4/`.

### S23 three-way run 5 — CPU arm timed out

Preflight passed with the pinned TLS serial; the driver logged
`CALIB_PIN_BOARD_OK` and `source=calib.ok`. After the 900-second arm timeout,
the CPU child was killed and verified gone. The driver stopped after arm 1
with `END reason=method_void_run_fail`; session exit code 0.

| Pair / arm | Status | Skin start / peak | Prefill / decode | Fingerprint | HTP ops / minimum | Sampler |
|---|---|---:|---|---|---|---|
| 1 / CPU | VOID `run_fail` (900 s timeout) | 28.5 / 38.5 C | Parsed partial row: 141.78 ms / 26.12 tok/s, only 3 decode runs; invalid/incomplete | N/A (`fp_turn=na`) | N/A | `ok` |

The run log ended mid-generation, so the partial perf fields are not a valid
completed 1018-token/127-decode turn. No GPU or NPU arm ran; NPU op counts and
pair deltas are unavailable. Pair 1 CPU−GPU and CPU−NPU skin deltas cannot be
computed, and pairs 2–3 were not attempted.

Restore verified (`kill_check=verified rc=0`). Final: unplugged, 81%, 35.8 C
battery, thermal 0, traced 0, Kalsa and llama/bench absent, screen Awake and
unlocked, timeout `null`, stay-on 0. Raw driver, safety, sampler, partial CPU
log, and restore evidence are in `raw/s23-3way-5/`.


### S23 three-way run 6 — raw-prompt calibration and six valid arms

Preflight passed on the pinned TLS endpoint: unplugged, battery 80%, thermal
0, `persist.traced.enable=0`, Kalsa force-stopped, no `llama|bench`, display
Awake/unlocked. The new raw-prompt calibration ended `calibrated` (exit 0);
its proof logs had no `Running in interactive mode` line before the heat
command. The heat log reported `CALIB_PIN_BOARD_OK`, `source=calib.ok`, and
ended `exit_0` (exit 0), with six OK rows and no stops or voids. Every arm
used prompt_n=1010 and decode_runs=126 (the registered N−1 count).

| Calibration backend | Proof / tokens | Arch | HTP ops / proof minimum | Fingerprint | Pinned floor |
|---|---|---|---:|---|---:|
| CPU | OK / 5 | — | — | `buf=CPU,CPU_REPACK off=0/31 thr=5` | — |
| GPU | OK / 5; 62 assigns, 15 kernels | — | — | `buf=CPU,CPU_REPACK,OpenCL off=31/31 thr=5` | — |
| NPU | OK / 5 | v73 | 1398 / 5 | `buf=CPU,HTP0 off=31/31 thr=5` | 139.8000 ops/token |

The NPU floor is half the measured 1398/5 = 279.6 ops/token. Calibration
candidate buffers: CPU 206.07 MiB + CPU_REPACK 1511.20 MiB; GPU CPU 205.08 +
CPU_REPACK 205.08 + OpenCL 1307.20 MiB; NPU CPU 205.08 + HTP0 1525.87 MiB.

| Pair / turn | Backend | Status | Skin start / peak C | Prefill ms | Decode tok/s | Fingerprint match | HTP ops/min | Sampler |
|---|---|---|---:|---:|---:|---|---:|---|
| 1 / 1 | CPU | OK | 31.1 / 35.2 | 19026.97 | 21.15 | yes | — | ok |
| 1 / 2 | GPU | OK | 33.4 / 35.3 | 7347.20 | 11.26 | yes | — | ok |
| 2 / 3 | NPU | OK | 33.7 / 35.1 | 1668.22 | 13.01 | yes | 1398 / 699 | ok |
| 2 / 4 | NPU | OK | 33.6 / 35.0 | 1558.10 | 12.91 | yes | 1398 / 699 | ok |
| 3 / 5 | GPU | OK | 33.7 / 35.5 | 7326.37 | 11.10 | yes | — | ok |
| 3 / 6 | CPU | OK | 34.1 / 35.5 | 10389.45 | 21.12 | yes | — | ok |

Skin peak is the maximum HAL skin sample between each `ARM_START` and
`ARM_END`; starts and post-tail readings are the row's `skin_before` and
`skin_after`. Using per-arm skin rise (`skin_after - skin_before`), pair 1
CPU−GPU = +2.0 C; pair 3 CPU−GPU = −0.2 C (mean contrast +0.9 C). The two
CPU arms averaged +1.25 C rise and the two NPU arms averaged 0.00 C, so the
registered CPU−NPU mean contrast is +1.25 C; pair 2 is NPU/NPU and has no
within-pair CPU−NPU contrast. Restore verified (`kill_check=verified rc=0`),
sampler stopped, screen timeout restored to null and stay-on restored to 0.
Raw preflight, calibration, heat, safety/sampler samples, wake, and restore
logs are under `raw/s23-calib-6/` and `raw/s23-3way-6/`.
