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
| A1 | parser prefix `llama_perf_context_print:` does not exist in the kit | `arm.sh:135-137` — matches `common_perf_print:`, field indices $6/$9, $5/$8, $5(load) kept; format verified in-tree at f25f0c1c5 `common/sampling.cpp:573-576`, no log prefix (`common/log.cpp:174`); the fake now generates lines from that exact format (`dryrun-adb.sh:141-144`) |
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

- `d_run.sh` (324) — session orchestration: args, prep, gates, load+turn loop, rows, END, restore.
- `stop_lib.sh` (86) — live readings, numeric fail-closed checks, hard stops, `request_stop` (sourced; DSpark will source it too).
- `battery_trust.sh` (69) — battery-sensor verdict (two-sample mismatch).
- `kit.sh` (62) — push and byte-verify kit/model/prompt/sampler, remote-log sweep, backend-name preflight.
- `arm.sh` (193) — build/run/parse one arm (load phase + measured turn, thresholds).
- `restore.sh` (67) — undo every device change (standalone-capable).
- `smp.sh` (33) — on-device 1 s thermal sampler.
- `dryrun-adb.sh` (239) — fake adb with reading/log-injection knobs.
- `dryrun.sh` (243) — 18 fixtures + assertions.
- `PREREG.md` (238), `REPORT.md`.

## Dry-run proof (Mac, fake adb)

```
cd scratchpad/agents/qdc-heat-3way && ./dryrun.sh > /tmp/dryrun_a1.log 2>&1; echo "EXIT=$?"
EXIT=0      dryrun summary: PASS=138 FAIL=0     (log: raw/dryrun-final-run.log, per-fixture raw/dryrun-<name>.log)
bash -n d_run.sh restore.sh dryrun.sh dryrun-adb.sh stop_lib.sh battery_trust.sh kit.sh arm.sh  → all EXIT=0
```

| fixture | injection | asserted outcome |
|---|---|---|
| `six-arms` (seed stayon=1) | none | rc 0; **6 rows**, cpu gpu npu npu gpu cpu; pairs 1 1 2 2 3 3; all OK; **real `common_perf_print:` prefix parses** (A1); prompt_n 1018, runs 127; prefill 45000/14000/18000; proofs `cpu_no_offload`, `gpu_assigned_lines=33 kernels=12`, `htp_ops=1200 arch=v73`; load cols 33.5/33.5 + `inload_ms=9876.50` logged; pagein 1→0; stayon restored to 1; restore; no unknown shell cmd |
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

## Declared, not touched

Nothing pre-existing was refactored: `../qdc-heat-per-backend/*` and
`npu-spec-verify/*` are read-only for this cell (the former runs live on QDC);
its oversized `parse.sh` (48 KB app harness) is pre-existing excess, left
alone by design — this cell does not source it. `safety.sh` from round 1 was
replaced by `stop_lib.sh` (A15), not kept alongside it.
