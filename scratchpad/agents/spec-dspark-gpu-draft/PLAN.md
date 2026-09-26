# PLAN — DSpark speculative decoding on the Galaxy S23 (CPU target / CPU+GPU drafter)

**PREP ONLY, no device touched. Predictions below were rewritten 2026-09-26 after hostile audit f2ee97f4 and BEFORE any device run.** Engine `kalsallama` branch `kalsa-opencl-upload-oom-throw` @ `f25f0c1c5`. Target `/Users/marco/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf` sha `a247afd6…40b03`; draft `/Users/marco/kalsa-models/mac/LFM2.5-2.6B-DSpark-Q8_0.gguf` sha `85a98faf…386c87` (arch `dflash`, vocab 128000 = target, 5 layers, 62 tensors). Kit `/Users/marco/kalsa-qdc/dspark-spec-v73/dspark-kit-f25f0c1c5.tgz` sha `bd6be0a4…45447df` (sums `raw/kit_SHA256SUMS.txt`, build recipe `KIT-BUILD.md`). Host evidence: `raw/host_smoke.log`, `raw/host_calib_summary.log`, `raw/calib_armA127.log` (n_max 0 control: `n_drafted = 0`, plain decode, EXIT=0).

## Prompt and metric (audit B1, B7)

Frozen prompt `PROMPT.txt` (`0c58258b…12644`, 393 B): the SAME file for `host_smoke.sh`, `host_calib.sh` and every device arm (`-f`, sha+bytes checked from `PROMPT.meta` locally and on-device). Host EOG check: `-n 170` → `n_predict = 171`, no early EOG, ≥160 tokens safe — `--ignore-eos` is dead code in spec-simple (examples/speculative-simple/speculative-simple.cpp:339 breaks on `has_eos`; `params.ignore_eos` unused).

Overshoot: the loop breaks only at `n_predict > limit`; host measured A +1, B4 +5, B8 +9 at `-n 127` but B4 +3 at `-n 63` — NOT constant, so equal token counts cannot be assumed. **Method MATCHED-N**: probe all five arms at `-n 127`, take N\* = max n_predict, re-run each arm below N\* with `-n (127 + N* − N_i)` (≤ 2 attempts, `MATCH_MAX=2`); gate = final `n_predict` IDENTICAL across all five arms, else the comparison is VOID (`MATCH ok` / `MATCH void` in the session log). Metric for every arm = the same line `decoded N tokens in X s, speed: Y t/s` (never `common_perf_print eval`: 0.00 ms / 1 runs under speculation). Host convergence proof: probes A=128, B4=132, B8=136 → A@135 → 136, B4@131 → 136. `n_predict` per arm/attempt = column 5 of `results.tsv`.

## Arms — ONE binary for all five (`d_run.sh` + `arm.sh`), `-lv 5`, `GGML_OPENCL_LOG_KERNELS=1`, `-t 8`, greedy `--temp 0 --top-k 1`, target `-ngl 0`

Common: `-m ship.gguf -md draft.gguf --spec-type draft-dspark -f prompt.txt -n <limit>`.
- **A** (no-speculation control): `--spec-draft-n-max 0 -ngld 0` — host verified `n_drafted = 0`, plain decode, EXIT=0.
- **B4 / B8**: `--spec-draft-n-max 4|8 -ngld 0` (drafter on CPU).
- **C4 / C8**: `--spec-draft-n-max 4|8 -devd GPUOpenCL -ngld 99` (drafter on GPU; device name to confirm via `--list-devices`, expected `GPUOpenCL: Adreno(TM) 740`).

**Draft-on-GPU proof (C; counted AFTER the `common_speculative_init_result: loading draft model` line):** ≥ 5 `load_tensors: layer … assigned to device GPUOpenCL` (all 5 dflash layers) AND ≥ 4 distinct `GGML_OPENCL_LOG_KERNELS:` lines (drafter floor: matmul/gemv + convert + norm + elementwise; the 30/8 floors of qdc-heat-3way target a 33-layer model) AND no `kernel set failed to build|device disabled`. `-lv 5` is mandatory: `assigned to device` is LLAMA_LOG_DEBUG (SPC_TRC already prints at default); dspark prints no `devices=[…]` SPC line (only draft-simple/mtp do), so that proof does not exist.

**CPU counter-check (A/B):** drafter CPU assignments ≥ 1 AND zero GPUOpenCL assignments AND zero kernel lines after the marker — deliberately NOT "zero ggml_opencl lines" (the kit logs OpenCL discovery/init even at `-ngl 0`). Informational only: `llama_prepare_model_devices: using device GPUOpenCL` after the marker.

## Predictions — written 2026-09-26 after audit, BEFORE any device run (do not edit once numbers land)

- A ≈ 16–19 t/s (banked S23 CPU 53.3–56.6 ms/token). Acceptance on this prompt (host, CPU drafter): **n_max 4 → 55–57 %, n_max 8 → 39–40 %** (two limits each).
- B ≠ C: OpenCL GEMM residuals change drafter tokens (same-top 94.8 % measured before) → predict C within **±8 pp** of the matching B arm, never equal.
- **B vs A: sign UNCERTAIN (lean lose).** Arithmetic: drafter step ≈ 12 ms (356 MB vs 1594 MB streamed at the banked ~27 GB/s); verify of K+1 at short KV ≈ 53 + 7.4·K ms (Step-0 pp4/pp1 = 1.42×; our KV is ~210 tokens, so the audit's ~1000-KV premise does not hold for this prompt — the unmeasured part is checkpoint re-verification). K=4 round ≈ 132 ms needs E ≥ 2.4 tok/round → α ≥ 0.65; host α = 0.56 says lose, but ±20 % on the unmeasured verify cost flips the sign. K=8 round ≈ 213 ms vs E(α=0.39) = 1.6 → robust lose.
- C vs B: sign unknown — drafter step on Adreno 740 unmeasured (356 MB/step over shared LPDDR); expect |C−B| ≤ 30 %. n_max 8 vs 4: expect 4 ≥ 8 (host 63.0 vs 73.9 t/s; direction only).

## Phone gates, stops, push (owner rules; driver `d_run.sh`, stop logic SOURCED from `../qdc-heat-3way/stop_lib.sh`, never copied or edited)

Gates before the push, before/after every arm, plus a background mid-arm poll. Stops armed: battery ≥ 44.0 °C, thermal status ≥ 3, level ≤ 25 %, plugged (AC/USB/Wireless/Dock), missing reading → stop (fail closed). Screen Awake: wakeup + stayon + 30 min timeout, saved in `.restore-state` and restored on exit. Arm timeout → orphan kill `pkill -f 'llama-speculative-simpl[e]'` (same kill fired by stop and poll). Push: kit local sha → push → `tar -xzf` → `sha256sum -c SHA256SUMS`; each model/prompt pushed only if the on-device sha mismatches, then re-verified (`ensure_file`). Dry-run `./dryrun.sh` (fake adb, no phone): 51 PASS / 0 FAIL, EXIT=0 — every stop fires.

## Unverified after this prep

Device-side everything: `--list-devices` output, `-devd GPUOpenCL -ngld 99` parse and offload, Q8_0 GEMM numerics for the drafter on Adreno 740, the assignment/kernel line counts against the stated floors, OpenCL drafter step latency, all tok/s and acceptance, matched-N convergence within ≤ 2 attempts, thermal behaviour. Host = M-series CPU only; host ratios are not S23 predictions. Arm A (`--spec-draft-n-max 0`) verified on host, unverified on device.
