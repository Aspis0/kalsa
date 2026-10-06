# Handover - governor / one-copy three legs session (1d714246, 2026-10-05 evening)

Read first: memory `MEMORY.md` (+ linked feedback files), `~/Projects/kalsa/CLAUDE.md`, `REPOS.md`, lab `PLAN.md`
(tail: everything below is there with detail) + `docs/ALIVE.md`, `scratchpad/agents/onecopy-three-legs/`
(`PLAN-INTEGRATION.md` steps table, `FABLE-DESIGN.md` Amendments A-J). Rules unchanged: Paseo profiles only
(`list_profiles` first; Coder = `pi/opencode-go/deepseek-v4.1-flash`; Reviewer = `codex/gpt-6-luna`; reviewer n2 =
space-bunny; GLM zcode-acp needs `update_agent` model=Flash after create), clean-code block verbatim in every coder
brief, writer model != auditor model, verify every delegate claim on disk, one hostile audit per step, NEW agents only,
archive finished ones, PLAN + ALIVE updated and the lab push verified (`origin/main..HEAD` = 0) after every result.
Fable 5.1 `b1fb0210` (architect, owner-granted exception) is idle and stays alive.

## Chain

| piece | state |
|---|---|
| Engine main (Aspis0/kalsallama) | `837334a74` = `bc5f0207c` + the Q8_0 quantizer fix (below). The bar "engine main must not reach the app pin" is LIFTED for the #29395 regression. |
| One-copy branch | `feat/governor-onecopy` = `6106d4997`, pushed to the fork. Q8_0 fix cherry-picked (`f7b96a8a0`). |
| Archive tags (fork) | `archive/governor-onecopy-q6raw` (option 3, closed), `archive/exp-revert-q8-quantizer` (the revert experiment). |
| Binding / app | binding pin `f25f0c1c5` (shipped, not affected by #29395). App main is `480f4592` (UX session); the next app-pin push rebases on it and needs a native rebuild (react-native-worklets 0.10.4). |

## What was settled today

1. **NPU KLD regression, fixed.** Upstream `07fc586e3` (#29395) changed `quantize_block_f32_q8_0_tiled` to per-32
   scales; v73 Q4_0 KLD 0.0054 -> 0.045. Reverting only that function gives 0.005357 bit-identical. On engine main and
   the governor branch. Owner: NO upstream report. Keep the revert on every future upstream merge (code comment says why).
2. **Tied output route = J(1)** (owner decision): one flat Q6_K `token_embd` in `HTP0-HOST-W`; the GPU leg reads it in
   place for the lm_head inside the NPU decode. Options 2 (duplicate) and 3 (raw Q6_K on the HTP, 9.2 s/call) CLOSED.
3. **J(1) is fast**: deepseek's AoS Q6_K kernel `917027089` (`kernels/mul_mv_q6_k_f32_aos.cl`) + audit fixes
   `6106d4997`. S23 ABBA: H tg128 22.38/22.14 vs A 22.68/22.64 = 0.98; KLD 0.005343 vs 0.005357; RSS ~127 vs ~317 MB.
   The plain kernel was 22.5 ms/token (~9.5 GB/s). `GGML_OPENCL_HOST_Q6K_PLAIN=1` forces the old kernel (A/B).
4. OpenCL `offload_op` (`75177029d`), gallocr zero-chunk fix (`e199c140d`, `6821db6da`), MUL admission = norm row only
   (`4c47c09c3`). Leftovers in `scratchpad/BACKLOG-LOW-PRIORITY.md`.

## Next, in order

0. **Profile the AoS kernel on the S23** (needs battery >= 30 %, UNPLUGGED; the last attempt stopped at the gate, 29 %).
   Profiling build = `~/Projects/kalsallama-gov-prof/build-prof/bin/llama-bench` at `6106d4997` (OpenCL profiling ON;
   check the build log `/tmp/prof-build3.log` ended `EXIT=0`, else rebuild with the docker command below). Push it to
   `/data/local/tmp/govhtp/prof/` (sha256 both sides), run `. /data/local/tmp/govhtp/step4b-s23/run-prof.sh`, pull
   `prof/H/cl_profiling.csv`, mean of `result_output` rows. Baseline: plain 22.542 ms. The O arm is useless (the tied
   output stays on the CPU in GPU-only) - drop it. If the AoS kernel is above ~6 ms, the next lever is reading the
   import through `image1d_buffer` views (REPORT.md:66, 93-107: 37-55 GB/s vs 22-30 for plain global loads).
   Record in PLAN/ALIVE + `step4b-s23/raw/`.
1. **Re-run the step-4b GPU leg** (`run-step4b-correct.sh`, arm G) on `6106d4997`: with `offload_op` the HOST ops may
   now reach OpenCL - check splits (were 197) and G tg128. KV on the GPU is still step 5.
2. **Step 5** (FABLE-DESIGN Amendments F + G): leg contexts `leg{engine, ctx, side_state, params}[3]` over ONE model,
   KV on OpenCL for the GPU leg, the GPU-leg context's CPU compute buft follows the leg's first device (Amendment I
   note), hop v2 in `select_decode` rule 4, governor-bench one-model arm; gate: 32-token hops CPU->NPU->GPU->CPU, KLD vs
   two-copy over 256 tokens. Trap: hop v1 lives on engine MAIN, not on the one-copy branch (Amendment F) - bring main
   in first. Ask Fable `b1fb0210` only if the territory is new.
3. **Step 6**: binding capability table, one load, setter before load, `release_imports` before `llama_model_free`,
   R2 negative control (the Jelly belongs to the UX session: ask first). J(1) consequence: NPU decode on the shared
   copy REQUIRES the OpenCL HOST leg admitted - the table must refuse NPU-shared decode where it is not (R2).
4. Later: Qwen (requant KLD first), QDC 8 Elite (v79 / Adreno 830), Xiaomi only with Marco's ok, app pin rebase.

## Traps learned today

- A new worktree has no `CMakeUserPresets.json` (untracked): copy it from `kalsallama-gov-onecopy` or the preset is
  "not found". A log written to `/tmp` INSIDE the docker container is lost - write logs on the Mac side.
- Device harness gate: battery >= 30 %; never benchmark plugged; correctness-only checks (`run-h-correct.sh`) skip it.
- llama-bench takes `--repack 0` (no `-nr`); after DSP changes rebuild `htp-v73` in BOTH `build-gateg` and
  `build-gateg-rel`; `cl_profiling.csv` is written in the current directory at backend free.
- Docker build (zsh: write it inline, never in a variable):
  `docker run --rm --platform linux/amd64 -u 501:20 -v <worktree>:/workspace -w /workspace ghcr.io/snapdragon-toolchain/arm64-android:v0.7 cmake --build <build-dir> --target <targets> -j4 > /tmp/x.log 2>&1; echo EXIT=$?`
- S23 `192.168.1.152:35017`; device dirs `/data/local/tmp/govhtp/{step4b-s23,prof,bisect}`; the step4b-s23 `bin/` holds
  the `6106d4997` build (bench `fbf3f4c98474`, ppl `052926cd8c84`, release skel `e16120a812a1`).
