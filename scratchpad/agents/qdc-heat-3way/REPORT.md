# qdc-heat-3way — report

**Status: DRY-RUN ONLY.** No phone and no QDC session was touched: every run
below used the fake adb (`dryrun-adb.sh`) on the Mac. `PREREG.md` was written
before any run and stays locked; real numbers will be appended here, never to
the PREREG. Device plan: Galaxy S23 (SM8550 / Adreno 740 / Hexagon v73), local
adb, unplugged.

## What the cell does

One fixed turn per arm — prefill the frozen ~1018-token prompt of
`qdc-heat-per-backend` (copied `PROMPT.txt`, sha256
`2a4b5deaa3f4eefc5a878278184dcb6ba397f376c82395368f5126d9967d0ea1`, 3833 B)
plus exactly 127 decode tokens (`-n 127 --ignore-eos --seed 1 --temp 0`) — on
C (CPU `-ngl 0`), G (Adreno `-dev GPUOpenCL -ngl 99`), N (HTP
`-dev HTP0 -ngl 99 -nkvo`), order `CGNNGC`, pair = ceil(turn/2), via the
`npu-spec-verify` CLI kit (engine `f25f0c1c5`). The app has no NPU route
(`src/bench/benchConfig.ts:18 bench:route cpu|gpu|auto`), hence the CLI kit.

## Reuse map (copied vs sourced — as required)

| piece | how | provenance |
|---|---|---|
| kit push/env/HTP-arm selection, `--list-devices` discipline, proof rule | adapted | `npu-spec-verify/d_run.sh` + `STEP0-V73-PREP.md` (HTP proof = `execute-op` lines + `Hexagon Arch version`; missing proof = METHOD-VOID) |
| stop logic (`live_readings`, `require_numeric`, `hard_stops`) | **copied** from `../qdc-heat-per-backend/safety.sh:20-27,29-46,51-53,65-84` (its `session_stop` :20-27 became `request_stop` here) | sourcing that file whole was impossible: its `safety_gate`/`thermo_refresh` rebuild the app's `kalsa.bench.thermo` profile through `set_prefs` in `parse.sh`, and `parse.sh` **is** the app harness (APK install, logcat anchors, composer typing) — none of which exists on the CLI path; its `session_stop` also `exit 0`s, which would hide the stop reason from this driver. Bodies were rewritten from `&&`-chains to `if` where `set -euo pipefail` required it (e.g. `safety.sh:37`). |
| `battery_trust.sh` | **sourced unchanged** from `../qdc-heat-per-backend/battery_trust.sh` (d_run.sh:64) | pure dumpsys logic; its only deps (`adbT`, `log`, `RAW`, `SER`) are provided by this driver; called as `battery_trust_check || …` so its insides run errexit-immune (qdc's own `set -u` script never had `set -e`) |
| cooldown-as-cap, warm_start flag, pair = ceil(turn/2), 60 s `skin_after` tail, adbT alarm wrapper | copied/adapted from `../qdc-heat-per-backend/{d_run.sh,parse.sh}` | owner rules recorded in that cell's REPORT (no cool-start gate: start skin+battery recorded, cooldown only caps the wait ≤720 s) |
| 1 s sampler | **copied** `smp.sh` body (source lines 4-31), paths retargeted to `/data/local/tmp/heat3way/heat` | a file pushed to *this* cell's device dir; editing the other cell's files while its live session runs is off-limits |

## Files (one responsibility each)

- `d_run.sh` (285) — session orchestration: args, device prep, gates, ordered arm loop, rows, END, restore.
- `safety.sh` (84) — live readings + hard stops + `request_stop`.
- `kit.sh` (59) — push and byte-verify kit/model/prompt/sampler + backend-name preflight.
- `arm.sh` (108) — build/run/parse one `llama-completion` arm (timings + backend proof).
- `restore.sh` (56) — undo every device change (also callable standalone after SIGKILL).
- `smp.sh` (33) — on-device 1 s thermal sampler.
- `dryrun-adb.sh` (212) — fake adb with reading-injection knobs.
- `dryrun.sh` (160) — fixture matrix + assertions.
- `PREREG.md` — predictions, written before any run.

## Dry-run proof (Mac, fake adb)

```
cd scratchpad/agents/qdc-heat-3way && ./dryrun.sh > /tmp/dryrun_final.log 2>&1; echo "EXIT=$?"
EXIT=0      dryrun summary: PASS=94 FAIL=0     (full log: raw/dryrun-final-run.log)
bash -n d_run.sh restore.sh dryrun.sh dryrun-adb.sh safety.sh kit.sh arm.sh  → all EXIT=0
```

| fixture | injection | asserted outcome |
|---|---|---|
| `six-arms` | none | rc 0; **6 rows**, arms cpu gpu npu npu gpu cpu; pairs 1 1 2 2 3 3; all OK; prompt_n 1018; decode_runs 127; per-backend prefill + proofs (`cpu_no_offload`, `gpu_assigned_lines=2`, `htp_ops=2 arch=v73`); `END exit_0`; samples.txt; list-devices; restore; no unhandled shell cmd |
| `no-htp` | `DRY_NO_HTP_PROOF=1` | 1 row **VOID `no_htp_proof`** (METHOD-VOID), `END exit_0`, restore |
| `no-gpu` | `DRY_NO_GPU_PROOF=1` | 1 row VOID `no_gpu_proof` |
| `warm-start` | skin 38 C from read 1 | cooldown caps at 5 s, **`warm_start=1`, `cooldown_s=5`, skin_before=38` recorded, arms still run** (owner's no-cool-start-gate rule), 2 OK rows |
| `stop-thermal` | status 3 at first gate | `END stop_thermal_status`, 0 rows |
| `stop-batt-temp` | 44.5 C at read 11 (between arms) | `END stop_battery_temp`, 1 OK row before the stop |
| `stop-level` | level 20 % | `END stop_battery_level` |
| `stop-plugged` | AC powered true | `END stop_plugged` |
| `stop-missing` | blank skin | `END stop_missing_skin` (fail-closed) |
| `stop-skinfb` | QDC 25.0 C stub + skin 46.5 C between arms | `battery_trust.txt untrusted=1`, `END stop_skin_fallback`, 1 row |
| `stop-midarm` | 4 s arm, 44.5 C at read 9 | background poll fires mid-arm: `END stop_battery_temp`, row VOID `stop_battery_temp` |

Every fixture also asserts restore ran (`raw/<job>/restore.log` `state=1 …
rc=0`) with `screen_off_timeout` back to the pre-run value and
`stayon=false`.

## Bugs the dry-run caught (all fixed before this report)

1. `arm.sh:52-57` — `local tag="$1" logf="$RAW/$tag.log"` expanded `$tag`
   from the (unset) outer scope under `set -u`; split into separate `local`s.
2. `arm.sh:68-69` — the awk programs had `\"` inside single quotes → awk
   syntax error → every row silently VOID `run_fail`. The dry-run's
   "all rows OK + perf values" assertions is what exposed it.
3. `dryrun-adb.sh` dispatch — `pkill -f llama-completion` also matches the
   arm branch (`*llama-completion*`); moved pkill/list-devices above it.
4. Proof design (found before running, from `npu-spec-verify/raw/s23/A.log:58`):
   even `-ngl 0` logs `using device GPUOpenCL` (bare discovery), so the CPU
   proof checks **layer assignments**, not device-mentions; the fake emits the
   discovery lines for the CPU arm to regress exactly this.
5. `kit.sh:15` — `got=$(kit_file_sha …)` tripped `set -e` on the intended
   "file absent → push" path (remote `sha256sum` rc 1); guarded inside the
   function.
6. `d_run.sh:155` — a stale `.restore-state` from a previous session could
   authorize restoring a timeout this run never set; the driver now deletes it
   right after `wait-for-device`, before its own state write.

## Commands with exit codes (this session)

- `bash -n` on all 7 scripts → 0.
- `./dryrun.sh` iterations: first EXIT=1 (dryrun's own output redirect into a
  missing `raw/` — fixed), second EXIT=1 (13 fails, bug 1+2 above), third
  EXIT=0 (83), fourth EXIT=0 (93), **final EXIT=0 (94 PASS / 0 FAIL)**.
- Host model sha: `shasum -a 256 …LFM2.5-2.6B-QAD-Q4_0.gguf` →
  `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03` EXIT=0
  (matches `d_run.sh:43`).
- Kit archive sha (local): `dccf0865753557eb76e253af0157cb53a70346978ea48184fdf0cd884424c7ea`
  (`~/kalsa-qdc/npu-step0-v73/npu-kit-f25f0c1c5.tgz`, matches
  STEP0-V73-PREP.md).
- Prompt sha: `2a4b5dea…7d0ea1` = `PROMPT.meta` = the source cell's file.

## Not verified (needs the real S23, dry-run only so far)

- Everything device-side: real `--perf` line parsing against this kit's build
  (parsed against the captured format of `raw/s23/A.log` and the fake),
  real HTP/OpenCL proof lines, real HAL skin label on the S23, on-device
  sampler, `pkill` toybox behavior, kit push bandwidth, the 720 s cooldown on
  a hot board, the deadline path, INT/TERM delivery during a bare `sleep`
  (worst case = one TAIL_S/COOL_POLL_S, same caveat as qdc's driver).
- `battery_trust.sh` verdict on the S23 (expected trusted: live readings move).
- Skin/battery numbers of PREREG — untouched, still predictions.

## Declared, not touched

Nothing pre-existing was refactored: `../qdc-heat-per-backend/*` is read-only
for this cell (its live session owns it), `npu-spec-verify/*` likewise; its
oversized `parse.sh` (48 KB app harness) is pre-existing excess and was left
alone by design — this cell does not source it.
