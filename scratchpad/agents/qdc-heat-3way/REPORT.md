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

## Round 3 — run-1 defects fixed (2026-09-26); proof blocker found, NOT touched

Run 1 (luna, commit `2256dbd8`, evidence `raw/s23-cli-heat-20260926/`) stopped
after arm 1 with two driver defects; both are fixed in this round. No
thread/poll flag was changed (the owner's CPU-speed diagnosis is running and
its decision comes separately).

| defect | evidence | fix |
|---|---|---|
| **1. parser anchored fields at `$1/$6`** — on the device every line carries `<ts> <level> ` before the label, so every perf value came back empty → `run_fail` → luna's fail-fast guard stopped the session | `raw/s23-cli-heat-20260926/s23-cli-heat-20260926-t1cpu.log:48` — `1.17.377.184 I common_perf_print: prompt eval time =   10947.50 ms /  1018 tokens` | `arm.sh:142-166` — locate the `common_perf_print:` TOKEN anywhere in the line and index fields relative to it (value at label+5/+4, counts at +8/+7); works for prefixed AND bare lines. The old header claim "log prefix off (common/log.cpp:174)" was refuted and rewritten (`arm.sh:13-20`). The fake now emits lines with byte-identical prefixes copied from that committed raw log (`dryrun-adb.sh:149-155`), asserted by `dryrun.sh:74` (`I common_perf_print:`) plus the parsed values |
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
