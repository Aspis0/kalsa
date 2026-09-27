# qdc-heat-3way — one fixed turn, three backends: CPU vs Adreno OpenCL vs Hexagon HTP (PREREG)

**Status: WRITTEN BEFORE ANY DEVICE RUN.** No S23 (or QDC) run of this cell has
happened; the only execution so far is the fake-adb dry-run on the Mac, which
produces synthetic logs and no measurement. This file is locked once a real
device run starts: later outcomes go to REPORT.md, never here.

## Audit amendments — 2026-09-26, hostile audit f2ee97f4, ALL BEFORE ANY RUN

No device run existed when these were applied, so the predictions were free to
change; the old values are stated, not silently overwritten (A4).

- **Predictions §1 (A4): CPU 45,000 → 15,000 ms** (range 25,000–115,000 →
  8,000–45,000) — the old point contradicted its own priors (this kit's
  pp4 52.9 t/s ⇒ ≤19.2 s at 1018 tokens; the app path on QRD8650 ran the same
  turn in 10.1–11.2 s). **GPU 14,000 → 13,500**; **NPU 18,000 → 12,000**
  (arithmetic in §1). Falsifiers rewritten. **Skin predictions §2 and
  contrasts §3: unchanged** (not implicated by the audit).
- **Proof thresholds stated (A6)**, equal-decode gate 127 added (A7), load
  phase with its own temperatures added (A8), battery ≥44 C never disarmed by
  the untrusted verdict (A5), order bias registered (A9).
- Mechanics with no prediction impact: perf prefix is `common_perf_print:`
  (A1, verified in-tree: f25f0c1c5 `common/sampling.cpp:573-576`, log prefix
  off at `common/log.cpp:174`); the arm reads the verified prompt as a file
  `-f $D/prompt.txt` (A15b); stale stop/END cleared at start (A2); arm
  timeout kills the remote orphan (A3); device logs job-tagged and swept
  (A10); cleanup guard against double restore (A11); deadline checked inside
  the cooldown (A12); previous `stay_on_while_plugged_in` saved/restored
  (A13); `Dock powered` counts as plugged (A14); stop logic extracted to
  `stop_lib.sh` + local `battery_trust.sh` whose mismatch test needs two
  concordant samples (A15); fixtures for A1/A2/A3/A7 (+A5/A6) in dryrun (A16).

## Pre-run amendments — 2026-09-26, hostile audit dd6bdb56 + owner decisions (still before any valid arm)

Config/protocol changes only; the prediction sections below stand unless
explicitly superseded here.

1. **Backend proof moves to a short proof run in the load phase** (owner
   decision on A-1/A-2): before every measured turn, the load phase runs the
   same model/backend flags with a few tokens (`-p " " -n 4
   --ignore-eos --seed 1 --temp 0 --no-perf`), at `-lv 5` with
   `GGML_HEXAGON_VERBOSE=1` and `GGML_OPENCL_LOG_KERNELS=1` **only there**.
   All proof thresholds stay as audited (N ≥ 1000 execute-op, G ≥ 30
   assignments + ≥ 8 dispatched kernels + zero disabled lines, C ≥ 1 CPU
   assignment + zero offload leak — evaluated on that proof log, where the
   DEBUG/INFO lines exist). The **measured turn runs at default verbosity**
   with only `LD_LIBRARY_PATH`/`ADSP_LIBRARY_PATH`/`GGML_HEXAGON_NDEV=1` (no
   per-op output inside the measured window) and is voided
   (`backend_mismatch`) if its default-level fingerprint differs from the
   proof run's. **Fingerprint lines (stated, all WARN/tool-level = present at
   default `-lv 3`)**: (a) `common_fit_params: … n_gpu_layers already set by
   user to <N>` (C: 0, G/N: 99), (b) presence of
   `common_get_device_memory_data_impl: device HTP0 did not report memory`
   (C/N: present, G: absent — device scope of `-dev`), (c)
   `system_info: n_threads = <N>`. A turn log missing any component is voided
   `no_fingerprint` (fail closed).
2. **CPU threads = 5, all three arms** (owner decision): the app's S23
   preset is `sd-8-gen2 → decodeThreads 5 / prefillThreads 5`
   (`kalsa/src/engine/deviceTuning.ts:217-219`); the CLI arm now uses
   `-t 5` for the host threads of C, G and N alike, default poll. This is a
   config choice (the CPU-speed diagnosis was invalidated by the app being
   resident on the board), not a measurement outcome.
3. **Equal-decode gate = N−1** (A-12, device-evidenced): `decode_runs` must
   equal `DECODE_N - 1` (126 for `-n 127`; `-n 64 → 63` confirmed). This
   supersedes the "decode_runs must be 127" wording of the round-1/2
   sections below; the superseded wording stays visible for the record.
4. **Sampler paused during the measured turn** (A-11): the 1 Hz on-device
   sampler (`dumpsys thermalservice` + sysfs reads on the same SoC) stops
   before `llama-completion`'s measured turn and resumes right after it; the
   series covers setup/cooldown/load/tail, not the measured window.
   `skin_before`/`skin_after` remain direct host reads.
5. **Poll cadence bound** (A-10): production `POLL_S = 15`; worst-case
   threshold-to-stop latency = 15 s + 2 adb round trips ≈ 17–20 s of
   continued full-load computation. Registered as the accepted bound;
   `dryrun.sh` exercises it at the production cadence (fixture
   `poll-cadence`).

### Second amendment pass — 2026-09-26, hostile audit2 dd6bdb56 (still before any valid arm)

6. **Measured-turn verbosity is `-lv 4`, not the default 3** (audit2
   NEW-2/NEW-3: the fingerprint must prove PLACEMENT). Source check at
   f25f0c1c5: every placement line is `LLAMA_LOG_INFO` —
   `src/llama-model.cpp:1852` `LLAMA_LOG_INFO("%s: %12s model buffer size =
   %8.2f MiB\n", …)` (→ `CPU`/`GPUOpenCL`/`HTP0 model buffer size`), `:1846`
   `offloaded %d/%d layers`; `common/common.cpp:396` routes libllama logs
   through the filtered callback and `common/log.cpp` maps INFO to TRACE(4)
   > default thold(3) — so at true default NONE exist (run-1's committed log:
   `grep -c "buffer size\|load_tensors\|offload" = 0`). `-lv 4` admits INFO
   and still hides DEBUG/per-op output, so amendment #1's real goal (no
   per-op cost in the window) stands. `CALIBRATE=1` prints the candidates the
   phone actually produces and is the first thing the phone runs.
7. **Execute-op floor scales with the proof's token count** (audit2 NEW-1):
   `threshold = ceil(floor × proof_tokens)` with `floor = 0.86 ops/token` =
   half of the lowest prior (q57 1764/1024 = 1.72; q58 3.35; q51 20.2) — a
   4-token proof needs ≥ 4 lines, not the turn-1018-sized flat 1000. After
   `CALIBRATE=1` the pinned measured floor in `calib.ok` (0.5 × measured
   ops/token) replaces the prior; production logs `source=…` either way.
8. **Order restriction registered** (audit2 NEW-7): accepted orders are
   even-length sequences of the registered pairs {CG, GC, NN} — `CC` (a
   single-backend rerun has no within-pair contrast) and `CGNGCN` (pairs
   NG/CN are not registered contrasts) are deliberately rejected by
   `validate_order`; calibration mode (`CALIBRATE=1`) bypasses pairs because
   it runs each backend exactly once.
9. **Session cost** (audit2 NEW-8): each production arm now pays ONE extra
   full model load (the proof run ≈ load of 1.6 GB + 4 tokens ≈ 30–110 s on
   this board), i.e. +6 loads ≈ +3–11 min over the previous shape; expected
   production session ≈ 45–75 min with the default `DEADLINE_MINUTES=100`
   (worst case still bounded by the deadline check inside cooldown).
   `CALIBRATE=1` itself ≈ 3 × (load + 4-token proof + 16-token run) + gates
   ≈ 5–12 min.

## Why this cell exists

The app exposes `bench:route cpu|gpu|auto` only (`src/bench/benchConfig.ts:18`),
so the shipped path has no NPU route: an NPU heat row cannot be measured
through the app. The CLI kit (`npu-spec-verify`, engine `f25f0c1c5`) has all
three backends on one binary, so all three arms run there.

## Method (fixed before measurement)

> Where a dated amendment block above conflicts with the sections below
> (proof phase, `-t 5`, env split, gate N−1), the amendment governs.

- **Device**: Galaxy S23 (SM-S911U, SM8550, Adreno 740, Hexagon v73), local adb,
  **unplugged** (project rule: never benchmark while charging — the driver's
  `plugged` stop enforces it). The kit ships only the v73 DSP skel, so v73 is
  the only board this kit can prove HTP on.
- **Kit**: `~/kalsa-qdc/npu-step0-v73/npu-kit-f25f0c1c5.tgz` (archive sha
  `dccf0865…24c7ea`, `STEP0-V73-PREP.md`), binaries at engine `f25f0c1c5`,
  pushed and SHA-verified per session like `npu-spec-verify/d_run.sh`, plus a
  `--list-devices` preflight that must show `GPUOpenCL` and `HTP0: Hexagon`.
  All pre-existing device-side `*.log` files are swept at setup (A10).
- **Model**: `LFM2.5-2.6B-QAD-Q4_0.gguf`, sha256
  `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03` (device-side
  sha checked before any arm).
- **Prompt**: the frozen `PROMPT.txt` of `qdc-heat-per-backend` (3833 B, sha
  `2a4b5dea…7d0ea1`, word-cycle filler + "Ignore all text above. Reply with
  exactly READY."; that cell's app turns counted **1018 prefill tokens**).
  Copied here, identity re-checked against `PROMPT.meta`, pushed, sha-verified
  on the device — and the arm reads THAT file (`-f $D/prompt.txt`), so the
  verified copy and the used copy are the same bytes (A15b, no prompt text
  travels inline). Tokens are counted by the binary itself from the
  `common_perf_print: prompt eval time = … / N tokens` line and recorded as
  `prompt_n` per arm.
- **Arm = one `llama-completion` turn**: `--perf --no-warmup -f
  $D/prompt.txt -n 127 --ignore-eos --seed 1 --temp 0 -c 2048 -b 2048 -ub 1024
  -t 8 -fa 1 --simple-io --no-display-prompt -lm none` plus per-backend flags
  (kit help at `npu-spec-verify/raw/s23-prep/completion_help.log`: `-f` :48,
  `--ignore-eos` :257, `--perf` :45 default false so passed explicitly,
  `--no-warmup` :340, `-dev/--device` :121), env `LD_LIBRARY_PATH`,
  `ADSP_LIBRARY_PATH`, `GGML_HEXAGON_NDEV=1`, `GGML_HEXAGON_VERBOSE=1`,
  `GGML_OPENCL_LOG_KERNELS=1`:
  - **C**: `-ngl 0`
  - **G**: `-dev GPUOpenCL -ngl 99` (`--list-devices` prints `GPUOpenCL:
    QUALCOMM Adreno(TM)`)
  - **N**: `-dev HTP0 -ngl 99 -nkvo` (KV on CPU, the kit's documented HTP arm)
  - Exactly 1018-token prefill + 127 decode tokens, EOS ignored, greedy.
    `prompt_n` must equal the first arm's value on every later arm (same
    binary, same bytes) else VOID `prompt_mismatch`.
- **Load phase before every arm (A8)**: same backend flags, `-p " " -n 0
  --no-perf` — model page-in, weight upload and the OpenCL kernel compile
  happen HERE, outside the measured window, with their own before/after skin
  readings (`load_skin_before/after`) and wall (`load_wall_s`); the turn's own
  in-process `load time` is parsed and logged separately. The first load of
  the session is the cold page-in and is flagged `pagein_cold=1`.
- **Equal-decode gate (A7, qdc-heat-per-backend 851b053d)**: `decode_runs`
  must be 127 on every arm; any other numeric value voids the row
  (`decode_len`) and ends the session right after it.
- **Backend proof with thresholds (A6; missing/insufficient = METHOD-VOID)**:
  - N: ≥ **1000** `HTP0 execute-op` lines — 30 per layer × 33 layers; priors:
    q58 ran 3430 at n=1024, q57 1764 at pp512×2rep — a count in the low
    hundreds means dispatch collapsed to init, not the turn (void
    `htp_ops_low`, zero = `no_htp_proof`) — **and** a `Hexagon Arch version`
    line.
  - G: ≥ **30** `assigned to device GPUOpenCL` lines (33-layer placement) AND
    ≥ **8** distinct `GGML_OPENCL_LOG_KERNELS:` lines — execution evidence
    emitted from inside `enqueue_ndrange_kernel` (`ggml-opencl-kalsa-diag.cpp:36-44`,
    one line per unique dispatched kernel): a full prefill+decode touches
    matmul, gemv, convert, norm, rope, softmax, elementwise and the hybrid
    conv/ssm kernels — 8 classes (void `no_gpu_proof` / `gpu_exec_low`), plus
    zero `kernel set failed … device disabled` lines (void `gpu_disabled`).
  - C: ≥1 `assigned to device CPU` and zero offload assignment (void
    `cpu_backend_leak`) — assignment-based because even `-ngl 0` logs
    `using device GPUOpenCL` as bare discovery (`npu-spec-verify/raw/s23/A.log:58`).
  - Every arm: remote exit 0 else VOID `run_fail`.
- **Order**: `CGNNGC` — see the order-bias registration below.
- **Cooldown/pairing rules copied from `qdc-heat-per-backend`**: no cool-start
  gate (owner decision; per-arm start skin+battery recorded) — poll skin HAL
  ≤ 37.0 °C every 15 s, cap 720 s (deadline checked inside the poll), cap hit
  → run anyway with `warm_start=1`; stops checked again right after the wait,
  after the load phase, every POLL_S during the arm, and after the arm.
  `skin_after` = HAL skin 60 s after completion (the qdc tail).
- **Safety stops (owner's closed list, via this cell's `stop_lib.sh`)**:
  thermal status ≥ 3, battery temperature ≥ 44.0 °C, battery level ≤ 25 %,
  plugged (`AC|USB|Wireless|Dock powered: true`), fail-closed `missing_<reading>`.
  **A5: the 44 C stop is armed on every board, always** — the battery-trust
  verdict only ADDS the skin ≥ 46 C stop (QDC-injected-stub boards), it never
  disarms the battery stop; the trust mismatch test needs two concordant
  samples (`battery_trust.sh`, copied from the live qdc cell because that
  file is frozen mid-session there).
- **Sampling**: on-device 1 s sampler (`smp.sh`): all `cpu*`/`gpuss*` sysfs
  zones + HAL skin (`Current temperatures from HAL` section only), epoch on
  every line; series pulled to `raw/<job>/samples.txt`.
- **Recorded per arm (25 columns)**: pair, backend, turn, status/void_reason,
  warm_start, cooldown_s, tail_s, wall_s, load_wall_s, load_skin_before,
  load_skin_after, pagein_cold, skin/battery/thermal before→after, prompt_n,
  prefill_ms, decode_runs, decode_tps, proof.

## Order bias (registered; audit f2ee97f4 A9, before any run)

**Call: KEEP `CGNNGC`, do not interleave.** It is palindromic (ABCCBA), so
the mean arm position is identical for the three backends — C {1,6} → 3.5,
G {2,5} → 3.5, N {3,4} → 3.5: any **linear** drift over the session cancels
exactly in every contrast. An interleaved order (C G N C G N …) gains nothing
first-order and breaks the pair structure (`pair = ceil(turn/2)` → C-G, N-N,
G-C) that the within-pair contrasts rely on.

Registered residual (the audit's point): under **convex** drift the mean
squared positions differ — C 18.5, G 14.5, N 12.5 — so an accelerating board
biases contrasts toward CPU > GPU > NPU, the same direction as the CPU−NPU
prediction, which makes that one contrast the drift-vulnerable one.
Diagnostic: the two C−G pair deltas (P1 early, P3 late) bracket any monotone
drift; mutual disagreement outside §3's [−2.0, +2.5] band = drift artifact,
not signal. Cold first arm is flagged `pagein_cold=1`, and every arm records
`warm_start` + `skin_before`.

## Predictions (written before any device run; §1 corrected 2026-09-26 per audit f2ee97f4)

Priors used (existing lab numbers only):

| prior | source | number |
|---|---|---|
| S23 LFM GPU prefill pp256 | `s23-native-gpu-bench/REPORT.md:313` (Q4_K_M, engine 1068eb03d) | 75.4 t/s; GPU 8.20× CPU; GPU mean 4.73 W vs CPU 0.83 W during pp |
| S23 LFM CPU prefill pp256 | same | 9.19 t/s (older engine, `-fa 0`) — excluded, see §1 arithmetic |
| S23 small-K pp, LFM, THIS kit | `npu-spec-verify/REPORT.md` timing table | CPU K=1 53.3 ms/call (18.77 t/s), K=4 75.6 ms/call (52.9 t/s); HTP0+CPU-KV K=4 185.1 ms (21.6 t/s) |
| S23 n=1024 prompt, Qwen3.5-4B Q4_0 | `q58-s23-npu-spike-sweep/REPORT.md` | CPU ~26.1 t/s ⇒ 39.3 s; NPU ~105.2 t/s ⇒ 9.7 s; ΔT_prompt(batt) +3.25 vs +1.1 C |
| S23 battery ΔT per 512-token pp pass, Qwen3.5-4B | `q57-v73-npu-thermal-trace/REPORT.md` | CPU +2.0/+2.5 C, HTP0 +0.6/+1.2 C; pp512 CPU 27–33 t/s, HTP0 88–91 t/s |
| QRD8650 app turn, 1018+127 forced, skin ΔT | `qdc-heat-per-backend/REPORT.md:1115ff` | CPU +5.63 mean, GPU +5.44 mean; pair contrast CPU−GPU mean +0.19 C; prefill CPU 10,142–11,236 ms, GPU 6,347–6,889 ms |
| LFM decode tg128, QRD8650 | `npu-decode-kv` via `npu-spec-verify/REPORT.md` | CPU 17.68 t/s, NPU `-nkvo` 15.08 t/s |
| Adreno 740 decode vs CPU (older engine) | `s23-native-gpu-bench/REPORT.md:31` | GPU 0.41× CPU |

### 1. Prefill ms — the binary's `common_perf_print` prompt-eval time for the ~1018-token prompt (A4 rederivation)

| arm | point | plausible range | arithmetic from the table above |
|---|---:|---:|---|
| C | **15,000 ms** | 8,000–45,000 | (a) THIS kit, THIS model: pp4 = 75.6 ms/call → 52.9 t/s → 1018/52.9 = **19.2 s with zero batch scaling**; pp throughput grows with batch, so ≤19.2 s. (b) Same turn through the app on QRD8650: 10,142–11,236 ms (95.6–100.4 t/s); S23 (8 Gen 2) at ×1.2–1.5 of the 8 Gen 3 → **12–17 s**. (c) q58's Qwen-4B on the same S23: 1024/26.1 = **39.3 s** — heavier model, upper anchor → range top 45 s. Point = mid of (a)+(b) = 15 s, floor 8 s (engine at 8g3-and-better pace). |
| G | **13,500 ms** | 7,000–30,000 | s23-native, same phone + same LFM family: 1018/75.4 = **13.5 s**; range = ×0.5–2.2 for engine/flags/quant differences (its build was 1068eb03d, `-fa 0`, Q4_K_M). |
| N | **12,000 ms** | 6,000–47,000 | q58, same phone, HTP at n=1024: 1024/105.2 = **9.7 s** (Qwen-4B — LFM2.5 is smaller but hybrid conv/SSM on HTP has no banked pp1024 point) → floor ~6–10 s, point +hybrid overhead = 12 s; ceiling = npu-spec's LFM K=4 HTP rate (21.6 t/s → 1018/21.6 = **47.1 s**) with no batch scaling. |

The old CPU point (45,000 ms, range to 115,000) leaned on s23-native's 9.19
t/s (⇒ 110.8 s); that number is EXCLUDED from the range because it came from
a different engine (1068eb03d), `-fa 0 -t 6`, a different quant, and that
report itself attributes the CPU arm's wall to "4–5 min of CPU-side load".
It survives as falsifier 1's tail: landing >45 s means the old prior was
right after all.

**Ranking (replaces the old "C ≫ G ≈ N")**: points **N (12.0) ≤ G (13.5) ≤
C (15.0) s**, with all three ranges overlapping heavily (8–45 s band) — the
overlap is honest, this kit has no pp1024 CPU point. Only directional claims
are made: **G ≤ C** (sign of the Adreno prefill dividend; the 8.20× magnitude
is NOT re-predicted) and **N ≤ C** (q58-style NPU advantage).

### 2. Per-arm skin rise (skin HAL, after − before, after the 60 s tail)

| arm | point | plausible range |
|---|---:|---:|
| C | **+2.5 C** | +0.5 … +5.0 |
| G | **+2.0 C** | 0.0 … +5.0 |
| N | **+1.0 C** | −0.5 … +2.5 |

Reasoning: q58's battery ΔT at n=1024 (CPU +3.25, NPU +1.1, Qwen) is measured
under the die and moves faster than skin; skin damps further, so roughly halve.
GPU sits between: a ~14 s burst at the measured 4.73 W mean (~66 J) is more
energy than ~15 s at 0.83 W (~25 J), but arrives in one short spike that the
skin sensor integrates and lags. All three arms share the model load
(page-in of 1.59 GB, now its own phase — common-mode, dominates the cold
first arm), hence the wide ranges and `pagein_cold`.

### 3. Contrasts

- **CPU−GPU pair contrast: +0.3 C, plausible −2.0 … +2.5 (no confident sign).**
  The QRD8650 app rows measured mean +0.19 (median +0.137, sign followed which
  arm got the cold board). Energy argues GPU ≥ CPU; delivery into the 60 s
  tail argues CPU ≥ GPU. Both live inside the range.
- **CPU−NPU contrast: +1.5 C, plausible −0.5 … +3.5 (CPU hotter).** Two
  same-direction priors: q58 battery ΔT at n=1024 (CPU 3.25 vs NPU 1.1) and
  q57 per-512-pass (CPU 2.0–2.5 vs HTP 0.6–1.2). Sharp prediction:
  **refuted if CPU−NPU ≤ −0.5 C.** Registered caveat (order bias above): a
  convex session drift inflates this contrast in its own direction.
- Contrasts are computed from arm means (C outer positions 1/6 vs N inner 3/4;
  pairs 1 and 3 give the order-controlled C−G check in both directions),
  warm_start and per-arm skin_before always recorded.

### 4. Secondary (recorded, predicted loosely)

- decode tok/s: C **14** [10–18], G **6** [4–10] (archive GPU decode 0.41× CPU
  on the 740), N **13** [8–16] (`-nkvo` 15.08 on QRD8650; v73 older).
- Note a deliberate difference vs the qdc-heat-per-backend rows: on the CLI
  the G arm decodes **on the GPU** (`-dev GPUOpenCL -ngl 99` offloads the
  whole context), where the app's GPU turns decoded on CPU. N keeps `-nkvo`,
  so its attention/KV steps stay on CPU by kit design.
- `prompt_n` expected in the high 900s–low 1000s (app counted 1018 chunks;
  CLI counts the raw file text with no chat template).

### Falsifiers (stated now; rewritten with the A4 values)

1. C prefill outside **[8,000; 45,000] ms** → range refuted (>45 s: the old
   s23-native-weighted prior was right; <8 s: this engine is faster than every
   cited number).
2. **G > C** → the sign of the GPU prefill dividend is refuted on this kit
   (the 8.20× magnitude of the older build is not re-predicted and cannot be
   "refuted" here).
3. N > C → q58's NPU prefill advantage does not transfer to LFM on v73;
   npu-spec's HTP-slower-at-small-K prior wins at pp1024.
4. CPU−NPU ≤ −0.5 C → section-3 sharp prediction refuted.
5. Any N/G/C arm without its proof thresholds → that arm METHOD-VOID (not a
   data point, not silently another backend).

No conclusion about routing, shipping, or energy-per-token is licensed by one
session of six turns on one board.
