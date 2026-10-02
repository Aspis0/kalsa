# Brief: iOS engine choice measured on the Mac (2026-10-02)

Owner decision 2026-10-02: llama.cpp stays Kalsa's main engine on iOS unless measurements justify MLX; Apple
Foundation Models (AFM) is a candidate extra "no download" option. This job produces the measurements, on the M1 Max
Mac (macOS 26.6.2), for free. Public HF downloads only; never use or print any token. No Runpod, no phones.

## Wait gate
Another agent may be building/running Kalsa in Xcode. Do all setup (installs, builds, downloads) immediately, but before
EVERY timed measurement check `pgrep -fl "xcodebuild|KalsaAIChat|llama-bench|mlx_lm"` and wait until no other heavy job
is running (poll every 60 s, max 90 min, then report). Run timed cells one at a time.

## A. llama.cpp vs MLX, same model, same prompts
1. llama.cpp: build Kalsa's engine at the app's pin (read `native/kalsallama.pin` in ~/Projects/kalsa and the engine
   checkout listed in ~/Projects/kalsa/REPOS.md; build in a separate build dir with Metal on, `-DLLAMA_CURL=OFF`; do not
   modify any repo, do not commit). Also build upstream-equivalent is NOT needed.
2. Models: LFM2.5-2.6B (GGUF `~/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf`; MLX 4-bit from mlx-community or convert
   with `mlx_lm.convert -q --q-bits 4` from the public HF base) and Qwen3.5-2B (GGUF Q4_0/Q4_K_M + MLX 4-bit) to compare
   with the public iPhone numbers in `../ios-readiness/MODELS-RESEARCH.md` section 2.
3. Cells (3 runs each, report median): llama-bench `-p 512 -n 128 -fa 1 -ngl 99` and `-t` = performance cores; also
   `-d 2048` (decode at 2k context depth). MLX: `mlx_lm.benchmark` or `mlx_lm.generate` with a 512-token prompt and 128
   output tokens, same seed; record prompt tok/s, decode tok/s, peak memory.
4. Explain the app's 31.22 tok/s decode on LFM2.5 (`../ios-readiness/MAC-RELEASE-RUN.md`): reproduce the app's settings
   in llama-bench (n_ctx 16384, flash attn on, the app's thread count and KV types - read them in
   ~/Projects/kalsa/src/engine) and say which setting costs what.

## B. Apple Foundation Models probe
1. Check availability on this Mac (`SystemLanguageModel.default.availability`) with a tiny Swift script/package in
   /tmp. If Apple Intelligence is off or unsupported, report the exact reason and skip the rest of B.
2. If available: the same 5 short prompts in IT, FR, ES, EN, ZH (e.g. "Spiegami in tre frasi cos'è la fotosintesi."),
   record answer text, time to first token, tokens/s if measurable, `contextSize`, and any guardrail refusals. Quality
   is judged by the coordinator from the saved answers - save them verbatim.

## Report
`~/Projects/kalsa-moe-experiments/scratchpad/agents/ios-engine-choice/REPORT.md` (English, `~` not the home path): a
table per engine/model (prompt tok/s, decode tok/s, decode at 2k, peak memory), commands used, exact versions (llama.cpp
commit, mlx/mlx-lm versions), the 31 tok/s explanation, the AFM section with the saved answers. No binaries or files
> 5 MB in the lab folder (models and builds stay in /tmp or ~/kalsa-models). Do not commit. Reply terse with the
table.

Write clean code (any helper script: small, one responsibility, no dead code). Use | tail -5 on noisy commands and
report real exit codes (`cmd > log 2>&1; echo $?`).
