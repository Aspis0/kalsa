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
