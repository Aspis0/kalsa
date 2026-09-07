# PREREG — Adreno prefill precision bisection (cell `adreno-precision-bisect`)
Written 7/09 00:45 EDT, before any measurement. Owner directive that opened it: "come facciamo a fixarlo per la GPU?
Indagando kernel? Perché il prefill gpu è importante su tutti gli snapdragon."

## The question
ALIVE 55 measured, on QRD8650 (Adreno 750, V75), that the GPU prefill produces materially different pre-sampler logits
from the CPU prefill on the same forced tokens (median |Δp₁| 0,0861; 8/32 steps with a different raw top-1 while the CPU
is confident; 3 of those 8 outside the CPU's top-5). The 750's known non-contiguous-src0 defect is already gated in that
build (pin 3bec271fd), and `test-backend-ops` is green on this kernel family (925/0 on the 750, 925/925 on 732/735).
**Is the residual divergence numerical precision, or a second localized defect?**

Named suspect, read on disk before any run: `ggml/src/ggml-opencl/kernels/gemm_noshuffle_q4_0_f32.cl:38`
`half8 c0 = 0, c1 = 0, c2 = 0, c3 = 0; // 8x4 output elements` — the prefill GEMM accumulates the whole K loop in f16
(~3,3 decimal digits), while the CPU path accumulates in f32 and, for Q4_0, uses exact integer dot products. The same
`half8 c0` pattern is in ALL TEN quantized `gemm_noshuffle_*` kernels (iq4_nl, q1_0, q4_0, q4_1, q4_k, q5_0, q5_1, q5_k,
q6_k, q8_0), so whatever this cell finds applies to every quantization we could ship, not just ours.

## Method (this cell measures ONLY localization, not speed and not a fix)
Device QRD8650 (same board as ALIVE 55), kit built with the existing Docker toolchain
(`qdc-750-mulmat-view/build-kit.sh`, preset arm64-android-snapdragon-release, `-DGGML_HEXAGON=OFF`) with
`llama-eval-callback` added to the target list. Model: the shipped `LFM2.5-2.6B-QAD-Q4_0.gguf` (same file as the app).
Two arms, identical prompt (fixed 32-token English prompt, stored in the cell and quoted in the REPORT), greedy,
`-n 1`, temperature 0:
- **arm CPU**: `-ngl 0`
- **arm GPU**: `-ngl 99` (OpenCL backend)
Each arm dumps every intermediate tensor through the eval-callback hook. A compare script pairs the tensors by name and
call order and reports, per tensor: shape, backend, and the relative deviation
`rel = max|gpu − cpu| / (max|cpu| + 1e-6)` over the sampled values that eval-callback prints, plus the running maximum
by layer index.

## Pre-declared readings (fixed before looking)
1. **Smooth growth**: `rel` increases monotonically-ish with depth and no single op exceeds 10× the median `rel` of its
   own layer → **precision hypothesis supported**. Next cell: f32 accumulators in the GEMM, scored by the logit oracle
   and paid for in tok/s.
2. **Jump**: one op (or one op class) where `rel` is ≥ 10× its neighbours and ≥ 10× the same op in earlier layers →
   **localized defect**. Deliverable: op name, shapes, and a `test-backend-ops` case that reproduces it on the host.
3. **Flat ~0 everywhere** (`rel` ≤ 1e-3 on every tensor) → the divergence is NOT in the prefill compute; my hypothesis is
   refuted and the search moves to the KV/rope/attention-mask path. This outcome must be reported as loudly as the others.
4. If the two dumps cannot be aligned (different op sequences between backends), the cell is DESCRIPTIVE and says so;
   no conclusion is drawn from a partial alignment.

## Rules
- No fix is written in this cell. Nothing is promoted. The kernel change is a separate cell with its own PREREG.
- `test-backend-ops` passing is not evidence of model-level fidelity and will not be cited as such (that conflation is
  what this cell exists to break).
- The prompt, the kit sha256 and the exact command lines go in the REPORT; the raw dumps are committed.

## Addendum 1 (7/09 01:00, before any build) — provenance of the kit, and two facts from recon
- **Trap avoided:** the worktree `kalsallama-wt-governor-v03` is currently checked out on `kalsa/bench-fault-inject`
  @5f0701dac with `#define KALSA_BENCH_FAULT_INJECT 1` hard-enabled (`ggml-opencl.cpp:55`) and the injection live in
  `gemm_noshuffle_q4_0_f32.cl`. A kit built from that tree would measure our own injected fault. **The kit for this cell
  is built from `kalsallama-wt-oclpicks-25910` @2f3b24dee** (clean: 0 occurrences of the define and of the injection),
  which is the same OpenCL code as the pin 3bec271fd used by the APK that produced ALIVE 55. Verified on disk; the
  `half8 c0 = 0` accumulator is present on all three trees including clean upstream (64a155d24), so it is upstream code.
- **Recon (deepseek af188cb6, quotes verified by me on the clean tree):** the prefill path converts operand B to half as
  well (`img_fmt = {CL_RGBA, CL_HALF_FLOAT}` before `kernel_gemm_noshuffle_q4_0_f32`), so prefill is exposed twice
  (half operand + half accumulation), while the decode path (`gemv_noshuffle_q4_0_f32.cl:225`
  `__private float2 totalSum = (float2)(0.0f);`, B image `CL_FLOAT`) accumulates in fp32 and is NOT exposed.
  **Pre-declared prediction from this asymmetry:** the tensor diff must show the divergence appearing in the prefill
  matmuls and NOT in the decode GEMV path. If the dump shows the opposite, the precision hypothesis is in trouble and
  the cell says so.
- No precision switch exists in the backend (no env var, no define): the f32-accumulate experiment will need a real
  kernel change, in its own cell.

## Addendum 2 (7/09 01:15, before any build) — instrument chosen from prior art, not invented
Websearch (Luna 28c3a483, sources verified as URLs + dates in the agent report) changes the tooling decision:
- **llama.cpp already ships the fidelity instrument we need for kernel work**: `llama-perplexity` with
  `--kl-divergence-base <file>.kld` (baseline arm) and `--kl-divergence` (comparison arm), reporting KLD, PPL delta,
  probability deltas, RMS, percentiles and "same top p" (tools/perplexity/README.md). Running the baseline with the CPU
  backend and the comparison with the OpenCL backend answers "does the GPU produce the same distribution as the CPU" on
  THOUSANDS of tokens, from the CLI, with no app, no typing and no thermal-heavy A/B pairs. **This cell adopts it as the
  primary metric.** The app-level logit oracle (ALIVE 55) keeps its own, different job: whether the SHIPPED app with the
  governor produces the same output — it is not replaced, it is no longer the tool for kernel iteration.
- **The localization method is the upstream-recommended one**: `llama-eval-callback` dumped on CPU and on GPU, diffed to
  find the first materially divergent operation (upstream discussion #10253 + examples/eval-callback/README).
- **The fix has an in-project precedent**: the Vulkan backend generates both `_f32acc` and `_f16acc` variants of its
  quantized matmul shaders with `ACC_TYPE` = `float` or `float16_t` and selects at runtime; Metal (`simdgroup_float8x8`)
  and CUDA (`float *sum`, mixed-precision Tensor Core mode) accumulate in float. OpenCL/Adreno is the outlier. Qualcomm's
  own OpenCL guide documents loading/storing FP16 while computing in FP32 "when precision requires it", and states FP16
  ALU throughput is 2× FP32 — so the worst-case cost of the fix is bounded and known before we measure it.
- **Independent corroboration, no diagnosis upstream**: two open reports of the same symptom class on Adreno (830
  "garbled output" after #15270; 740 "GPU garbage while CPU correct" with Q6_K 10/11 test failures), both unresolved.
  No upstream issue discusses f16-vs-f32 accumulation in `gemm_noshuffle_*`, and no Adreno f32-accumulate measurement
  exists. **We will not open or comment on any upstream issue** (standing owner rule); the finding stays in this repo.
Revised order for this cell: (1) KLD CPU-vs-GPU on device to quantify the gap with a standard metric, (2) eval-callback
diff to localize, (3) only then the ACC_TYPE experiment, in its own cell with its own PREREG and its own speed budget.

## Amendment 1 (7/09 02:05 EDT — written after the first KLD and the dump, before the next run)
First measurement, QRD8650 (Adreno 750, pineapple), kit 2f3b24dee, model LFM2.5-2.6B-QAD-Q4_0 (sha a247afd6…),
corpus 3079 words, `-s 42`, CPU arm `-ngl 0`, GPU arm `-ngl 99`, 51 s + 31 s of device time:
`Mean PPL(Q)-PPL(base) 8.498116 ± 1.143139` | `Mean KLD 0.636690 ± 0.016669` | `Median KLD 0.454348` |
`Same top p 62.373 ± 1.149 %`.
**The comparison is NOT clean, and the reason is now known.** The eval-callback dumps do not align (CPU 1014 tensors,
GPU 1054; `compare_dump.py` refused to pair, per reading #4) because the two arms compute attention with DIFFERENT
ALGORITHMS: the GPU arm logs `resolve_fused_ops: Flash Attention not supported, set to disabled` and contains 0
`FLASH_ATTN_EXT` and 8 `SOFT_MAX` ops, while the CPU arm contains 8 `FLASH_ATTN_EXT` and 0 `SOFT_MAX`.
Therefore the measured divergence mixes (a) f16 accumulation in the quantized GEMM kernels — the hypothesis this cell
was opened on — with (b) a different attention formulation. **Neither can be attributed the gap from this run.**
**Next run, declared before measuring:** repeat the KLD with flash attention disabled on BOTH arms (`-fa 0` / the
equivalent flag verified in the pinned `common/arg.cpp` before use), so both graphs use the unfused attention path.
Readings, fixed now:
- KLD collapses to the same order as the CUDA reference (median ~5e-3, same-top ~95 %) → the gap was the attention-path
  mismatch, and the accumulator hypothesis is NOT supported by this evidence; the cell says so and the ACC_TYPE cell is
  postponed until it has its own evidence.
- KLD stays within a factor ~2 of today's (median ~0.45, same-top ~62 %) → the attention path is not the cause and the
  arithmetic of the quantized GEMM path becomes the prime suspect; only then does the ACC_TYPE experiment start.
- Anything in between → both contribute; report the split and do not pick a single culprit.
Also recorded, for the speed claims: with FA unsupported on OpenCL the GPU arm is a MIXED execution (attention on CPU
per the same warning), so "GPU prefill" numbers in ALIVE 55 and earlier rows are for a mixed graph, not a fully-GPU one.
