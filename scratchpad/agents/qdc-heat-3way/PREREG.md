# qdc-heat-3way — one fixed turn, three backends: CPU vs Adreno OpenCL vs Hexagon HTP (PREREG)

**Status: WRITTEN BEFORE ANY DEVICE RUN.** No S23 (or QDC) run of this cell has
happened; the only execution so far is the fake-adb dry-run on the Mac, which
produces synthetic logs and no measurement. This file is locked once a real
device run starts: later outcomes go to REPORT.md, never here.

## Why this cell exists

The app exposes `bench:route cpu|gpu|auto` only (`src/bench/benchConfig.ts:18`),
so the shipped path has no NPU route: an NPU heat row cannot be measured
through the app. The CLI kit (`npu-spec-verify`, engine `f25f0c1c5`) has all
three backends on one binary, so all three arms run there.

## Method (fixed before measurement)

- **Device**: Galaxy S23 (SM-S911U, SM8550, Adreno 740, Hexagon v73), local adb,
  **unplugged** (project rule: never benchmark while charging — the driver's
  `plugged` stop enforces it). The kit ships only the v73 DSP skel, so v73 is
  the only board this kit can prove HTP on.
- **Kit**: `~/kalsa-qdc/npu-step0-v73/npu-kit-f25f0c1c5.tgz` (archive sha
  `dccf0865…24c7ea`, `STEP0-V73-PREP.md`), binaries at engine `f25f0c1c5`,
  pushed and SHA-verified per session like `npu-spec-verify/d_run.sh`.
- **Model**: `LFM2.5-2.6B-QAD-Q4_0.gguf`, sha256
  `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03` (device-side
  sha checked before any arm).
- **Prompt**: the frozen `PROMPT.txt` of `qdc-heat-per-backend` (3833 B, sha
  `2a4b5dea…7d0ea1`, word-cycle filler + "Ignore all text above. Reply with
  exactly READY."; that cell's app turns counted **1018 prefill tokens**).
  Copied here, identity re-checked against `PROMPT.meta` at load; the driver
  counts tokens itself from the binary's `prompt eval time = … / N tokens`
  line and records `prompt_n` per arm.
- **Arm = one `llama-completion` process**: `--perf --no-warmup -p <frozen
  prompt> -n 127 --ignore-eos --seed 1 --temp 0 -c 2048 -b 2048 -ub 1024 -t 8
  -fa 1 --simple-io --no-display-prompt -lm none` plus per-backend flags
  (kit help captured at `npu-spec-verify/raw/s23-prep/completion_help.log`:
  `-n`, `--ignore-eos` (:257), `--seed`, `--perf` (default false, so passed
  explicitly), `--no-warmup`, `-dev/--device`).
  - **C**: `-ngl 0`
  - **G**: `-dev GPUOpenCL -ngl 99` (`--list-devices` prints `GPUOpenCL:
    QUALCOMM Adreno(TM)`)
  - **N**: `-dev HTP0 -ngl 99 -nkvo` (KV on CPU, the kit's documented HTP arm;
    env `LD_LIBRARY_PATH`, `ADSP_LIBRARY_PATH`, `GGML_HEXAGON_NDEV=1`,
    `GGML_HEXAGON_VERBOSE=1`)
  - Exactly one load + one fixed turn per arm: 1018-token prefill + 127 decode
    tokens, EOS ignored, greedy. `prompt_n` must equal the first arm's value
    on every later arm (same binary, same text) else the row is VOID
    `prompt_mismatch`; `decode_runs` is recorded (the app harness saw 127 for
    128 forced ids — reported-count semantics are unverified on the CLI, so it
    is recorded, not gated).
- **Backend proof** (METHOD-VOID if absent, per `npu-spec-verify` rule):
  - N arm: ≥1 `HTP0 execute-op` line **and** a `Hexagon Arch version` line in
    the pulled log → else VOID `no_htp_proof`.
  - G arm: ≥1 `device GPUOpenCL` line (prepare/assign) → else VOID
    `no_gpu_proof`.
  - C arm: zero `GPUOpenCL`/`HTP0` offload lines → else VOID
    `cpu_backend_leak`.
  - Every arm: remote exit 0 (`EXIT=` line) else VOID `run_fail`.
- **Order**: `CGNNGC` (balanced: C at positions 1 and 6, G at 2 and 5, N at
  3 and 4; `pair = ceil(turn/2)` → pairs 1=(C,G), 2=(N,N), 3=(G,C)).
- **Cooldown/pairing rules copied from `qdc-heat-per-backend`**: no cool-start
  gate (owner decision, its REPORT: the per-arm start skin+battery are
  *recorded*; cooldown only caps the wait) — poll skin HAL ≤ 37.0 °C every 15 s,
  cap 720 s, cap hit → start anyway with `warm_start=1`; safety stops checked
  again right after the wait, before launch, every POLL_S during the arm, and
  after the arm. `skin_after` = HAL skin 60 s after completion (the qdc tail).
- **Safety stops (owner's closed list, `qdc-heat-per-backend/safety.sh`)**:
  thermal status ≥ 3, battery temperature ≥ 44.0 C, battery level ≤ 25 %,
  plugged = true, and fail-closed `missing_<reading>` for skin/status/temp/
  level. Battery-trust (`battery_trust.sh`, sourced): when the battery sensor
  is flagged (QDC-style injected stub), the 44 C stop is dead and **skin ≥ 46 C
  replaces it for that board** (`skin_fallback`). S23 is expected trusted
  (live readings move), so skin is recorded but not a stop there.
- **Sampling**: on-device 1 s sampler (copied `smp.sh`): all `cpu*`/`gpuss*`
  sysfs zones + HAL skin (`Current temperatures from HAL` section only — the
  cached value can trail by degrees), each line epoch-stamped; series pulled
  to `raw/<job>/samples.txt`.
- **Recorded per arm**: pair, backend, turn, status/void_reason, warm_start,
  cooldown_s, tail_s, wall_s, skin/battery/thermal before→after, prompt_n,
  prefill_ms, decode_runs, decode_tps, proof.

## Predictions (written before any device run)

Priors used (existing lab numbers only):

| prior | source | number |
|---|---|---|
| S23 LFM GPU prefill pp256 | `s23-native-gpu-bench/REPORT.md:313` (Q4_K_M, engine 1068eb03d) | 75.4 t/s; GPU 8.20× CPU; GPU mean 4.73 W vs CPU 0.83 W during pp |
| S23 LFM CPU prefill pp256 | same | 9.19 t/s (older engine, `-fa 0`) |
| S23 CPU/HTP small-K pp, LFM, this kit | `npu-spec-verify/REPORT.md` timing table | CPU 53.3 ms/call K=1, 75.6 K=4; HTP0+CPU-KV 102.5 / 185.1 (HTP 2.45× CPU at K=4) |
| S23 n=1024 prompt, Qwen3.5-4B Q4_0 | `q58-s23-npu-spike-sweep/REPORT.md` | CPU ~26 t/s, wall 184.6 s, ΔT_prompt(batt) +3.25 C; NPU ~105 t/s, wall 58.1 s, ΔT +1.1 C |
| S23 battery ΔT per 512-token pp pass, Qwen3.5-4B | `q57-v73-npu-thermal-trace/REPORT.md` | CPU +2.0/+2.5 C, HTP0 +0.6/+1.2 C |
| QRD8650 app turn, 1018+127 forced, skin ΔT | `qdc-heat-per-backend/REPORT.md:1115ff` | CPU +5.63 mean, GPU +5.44 mean; pair contrast CPU−GPU mean +0.19 C (no confident sign); prefill CPU 10.1–11.2 s, GPU 6.3–6.9 s |
| LFM decode tg128, QRD8650 | `npu-decode-kv` via `npu-spec-verify/REPORT.md` | CPU 17.68 t/s, NPU `-nkvo` 15.08 t/s |
| Adreno 740 decode vs CPU (older engine) | `s23-native-gpu-bench/REPORT.md:31` | GPU 0.41× CPU |

### 1. Prefill ms (the binary's `prompt eval time` for the ~1018-token prompt)

| arm | point | plausible range | reasoning |
|---|---:|---:|---|
| C | **45,000 ms** | 25,000–115,000 | q58 CPU ~26 t/s ⇒ 39 s; s23-native 9.19 t/s ⇒ 111 s (older engine, `-fa 0`); npu-spec f25 small-K shows throughput grows steeply with K (52.9 t/s already at K=4) |
| G | **14,000 ms** | 7,000–30,000 | s23-native LFM GPU pp256 75.4 t/s ⇒ 13.5 s; the prefill dividend is the one Adreno claim that reproduces on this phone |
| N | **18,000 ms** | 7,000–60,000 | q58 Qwen-on-HTP n=1024 ~105 t/s ⇒ ~9.7 s; tempered because LFM's hybrid conv/SSM HTP path has no banked pp1024 point and npu-spec had HTP *slower* than CPU at K≤4 on this exact model/kit |

**Ranking prediction**: C ≫ G ≈ N — both G and N below 0.7 × C. G vs N order
is open (points say N slightly ahead).

### 2. Per-arm skin rise (skin HAL, after − before, after the 60 s tail)

| arm | point | plausible range |
|---|---:|---:|
| C | **+2.5 C** | +0.5 … +5.0 |
| G | **+2.0 C** | 0.0 … +5.0 |
| N | **+1.0 C** | −0.5 … +2.5 |

Reasoning: q58's battery ΔT at n=1024 (CPU +3.25, NPU +1.1, Qwen) is measured
under the die and moves faster than skin; skin damps further, so roughly halve.
GPU sits between: a 14 s burst at the measured 4.73 W mean (~66 J) is more
energy than 45 s at 0.83 W (~37 J), but arrives in one short spike that the
skin sensor integrates and lags. All three arms share the model load (page-in
of 1.59 GB), which is common-mode and dominates the cold first arm — hence the
wide ranges and why cold-first-arm rows are flagged, not pooled blindly.

### 3. Contrasts

- **CPU−GPU pair contrast: +0.3 C, plausible −2.0 … +2.5 (no confident sign).**
  The QRD8650 app rows measured mean +0.19 (median +0.137, sign followed which
  arm got the cold board). Energy argues GPU ≥ CPU (1.8× more J into the GPU
  die per our turn by the s23-native powers); duration-into-the-60 s-tail
  argues CPU ≥ GPU. Both effects are inside the range; a sign flip either way
  does not refute the physics, only the point estimate.
- **CPU−NPU contrast: +1.5 C, plausible −0.5 … +3.5 (CPU hotter).** Two
  independent same-direction priors: q58 battery ΔT at n=1024 (CPU 3.25 vs NPU
  1.1) and q57 ΔT per 512-token pass (CPU 2.0–2.5 vs HTP 0.6–1.2). This is the
  sharper prediction of the two: **refuted if CPU−NPU ≤ −0.5 C**.
- Contrasts are computed from arm means (C outer positions 1/6 vs N inner 3/4
  is the balance; pairs 1 and 3 give the order-controlled C−G check in both
  directions), warm_start and per-arm skin_before always recorded.

### 4. Secondary (recorded, predicted loosely)

- decode tok/s: C **14** [10–18], G **6** [4–10] (archive GPU decode 0.41× CPU
  on the 740), N **13** [8–16] (`-nkvo` 15.08 on QRD8650; v73 older).
- Note a deliberate difference vs the qdc-heat-per-backend rows: on the CLI,
  the G arm decodes **on the GPU** (`-dev GPUOpenCL -ngl 99` offloads the whole
  context), where the app's GPU turns decoded on CPU (`engine_decode` column).
  N keeps `-nkvo`, so its attention/KV steps stay on CPU by kit design.
- `prompt_n` expected in the high 900s–low 1000s (app counted 1018 chunks;
  CLI counts the raw `-p` text with no chat template).

### Falsifiers (stated now)

1. C prefill < 25,000 ms → lower bound refuted (this engine/S23 far faster
   than every prior suggests).
2. G prefill > 0.7 × C prefill → "GPU prefill dividend on Adreno" refuted for
   this kit.
3. N prefill > C prefill → q58-style NPU prefill advantage does not transfer
   to LFM on v73; npu-spec's HTP-slower-at-small-K prior wins at pp1024.
4. CPU−NPU ≤ −0.5 C → section-3 sharp prediction refuted.
5. Any N arm without HTP execution proof → that arm METHOD-VOID (not a data
   point, not silently CPU).

No conclusion about routing, shipping, or energy-per-token is licensed by one
session of six turns on one board.
