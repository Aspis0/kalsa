# Phase 2 OpenCL upstream audit

Repo: `/Users/marco/Projects/kalsallama` (fork; no upstream remote added). Fetch used exactly:

```text
git fetch https://github.com/ggml-org/llama.cpp master
```

Pin: `1882bf8cd99659246f4ddecb99c268669d7bb3c9` (`git cat-file -t` => `commit`).
`FETCH_HEAD`: `7798007a29a90e3053e799394da48cf53a2f8e0f`.
Merge-base: `22b69b6e92e831442fdd287901816ce3aa8a2b43` (`arg: prevent duplicate spec model downloads (#25527)`).

## 1. Full upstream list

Command: `git log --oneline merge-base..FETCH_HEAD -- ggml/src/ggml-opencl`

Count: **40**.

```text
43d87ff2dd0e opencl: fix out-of-bound reads in the Adreno image kernels (#27632)
010be9683afa opencl: tune the quant paths for Intel Xe-LP GPUs to improve its TG and PP performance (#26438)
0190529ec450 ggml: add SWIGLU_CLAMP (#27930)
c841aeeb8bb2 opencl: use a better matmul path on two Adreno GPU generations (#27640)
58546250cfaa opencl: add bin kernels kernel_gemm_moe_q4_0_q8_1_dp4a_bin, kernel_gemm_moe_mxfp4_q8_1_dp4a_bin (#27768)
3af988fabcf7 opencl: fold the gpt-oss MoE per-expert bias adds into the epilogue (op/kernel fusion) (#26431)
cd26896c19e6 opencl: keep the vocab-scale K-quant lm_head on the CPU for Adreno A7X (compiler issue workaround) (#26440)
749f688fcaa4 ggml: support ggml_rope_set_offset on opencl, sycl, wgpu, hexagon (#27345)
6503355df0eb opencl: fix q6_K flat mul_mat for Adreno A6x/A7x GPUs with older E031 compilers (#26476)
6b4fa88a6ce2 opencl: fix local size for norm (#27339)
9ee9fc04c136 opencl: make the MoE expert scatter deterministic (#26464)
b062ba735e5e opencl: port fused ssm_scan kernel (Mamba-2, d_state in {128, 256}) to GPU (#26439)
fe8156f78901 ggml: add ggml_rope_set_offset (+ metal support) (#27120)
60addddf3c56 opencl: fix WAR race in the generic FA tile kernels when the WG spans subgroups (#26434)
89e0aa6fd362 opencl: default FA c8 cluster width to 16 on X1E (#26433)
cb27fe9c35d9 opencl: use flat mv q5_k when weight exceeds image1d_buffer_t limit (#26880)
153d324bcf86 llama: add default load-mode auto, which avoids mmap on iGPUs (#26081)
689e227db485 opencl: transpose the K tile in local memory for FA prefill kernels (#26428)
39eab74a05d3 opencl: route large q6_K lm_head to the flat GEMV (#26427)
0ab9d6fed73d opencl: limit local workgroup size for GLU operation (#26383)
c745be2a2c5a opencl: bugfix increment ref_count in ggml_backend_opencl_init() (#26162)
8190848bb36c opencl: skip the Adreno KQ/KQV image kernels for multi-stream batches (#26189)
42fc24306070 opencl: fix fused RMS norm mul view offset (#26085)
ed7adbfefd5e opencl: cache compiled cl_program binaries on disk (#26050)
56a83860ddb5 opencl: do not treat NULL-mask flash attention as causal (#25771)
178a6c449371 opencl: support broadcast for Adreno MUL_MAT and honor view_offs for Adreno Q8_0 MUL_MAT for llama-server multi-stream (#25910)
86a9c79f8667 opencl: load and use kernel_gemm_moe_q6_k_f32_ns from bin kernel lib (#25797)
6bdd77f13cf1 opencl: read/write MoE dp4a activation tiles to local memory as 128-bit (vectorized LD/ST perf opt) for Adreno GPUs (#25810)
86d86ed4396b opencl: transpose q4_K noshuffle scales for coalesced reads (#25805)
b85833e93412 opencl: add ABS op (#25115)
e8f19cc0ad70 opencl: loads quants as uint for q4_K and q5_K flat mv (optimization for Adreno A7x GPUs) (#25780)
ac2557cb24de docs: added a note about using OpenCl with Adreno 810 (#25786)
3dafb585f834 opencl: disable FA and MoE weights repack to work around compiler issues for Adreno 850 GPU (#25745)
505b1ed15ca8 opencl: exclude some moe kernels on Adreno a7x (#25698)
c3d47e696b11 opencl: fix two issues on flash attention for Adreno a7x (#25697)
12127defda4f opencl: do not use clCreateBufferWithProperties when targeting CL 2.x (#25673)
00fa7cb284cb opencl: handle OOB write in noshuffle GEMV kernels (odd ne01) (#25640)
a4ce2595c55e opencl: avoid the vec path in GEMV for unaligned row stride (#25671)
00e79f6fb146 opencl: fix a dp4a bug for devices where cl_khr_integer_dot_product is unavailable (#25639)
1d1d9a9ed7a4 opencl: add int8 dp4 dense and MoE prefill optimization for Adreno GPUs (#25537)
```

## 2. Per-commit audit

Risk is against the local `ggml-opencl` surface: trans4 scalar-uint convert/restore, q2_K/q3_K MoE kernels, barrier-safe q4/q5/q6 MoE kernels, K2/qk23 dispatch, and the local `ggml-opencl.cpp` shims. `HIGH` follows the requested rule for convert/restore, K-quant `mul_mm`/`mul_mv`, or directly overlapping kernel paths.

### Image, dispatch, and correctness

- `43d87ff2dd0e` — clamps padded q4_K noshuffle fetch rows; enforces image KQ/KQV tiling and passes KQ/KQV identity from dispatch; `ggml/src/ggml-opencl/ggml-opencl.cpp`, `ggml/src/ggml-opencl/kernels/gemv_noshuffle_q4_k_f32.cl` — **HIGH**.
- `c841aeeb8bb2` — enables the X2E xmem F16xF32 GEMM and bypasses tiled F32 GEMM on A7X; `ggml/src/ggml-opencl/ggml-opencl.cpp` — **MEDIUM**.
- `8190848bb36c` — avoids Adreno image KQ/KQV for dim-3 multi-stream tensors and honors views; `ggml/src/ggml-opencl/ggml-opencl.cpp` — **MEDIUM**.
- `cb27fe9c35d9` — routes q5_K to flat MV when image1d-buffer size is exceeded; `ggml/src/ggml-opencl/ggml-opencl.cpp` — **HIGH**.
- `178a6c449371` — adds Adreno MUL_MAT broadcast and Q8_0/view-offset handling for multi-stream; `ggml/src/ggml-opencl/ggml-opencl.cpp` — **MEDIUM**.
- `00fa7cb284cb` — guards odd-`ne01` writes in the noshuffle GEMV family, including K-quants; eleven `ggml/src/ggml-opencl/kernels/gemv_noshuffle_*.cl` files — **HIGH**.
- `a4ce2595c55e` — disables unaligned vector GEMV paths; `ggml/src/ggml-opencl/kernels/mul_mv_f16_f16.cl`, `mul_mv_f16_f32.cl`, `mul_mv_f16_f32_1row.cl` — **LOW**.

### K-quants and Adreno compiler workarounds

- `6503355df0eb` — gates q6_K flat scalar dequant/optimizer-barrier workarounds on old E031 and declines A7X mixed/KV-convert FA variants; `ggml/src/ggml-opencl/ggml-opencl.cpp`, `ggml/src/ggml-opencl/kernels/mul_mv_q6_k_f32_flat.cl` — **HIGH; already carried locally as `5c7e16fa6` with only the helper-signature adaptation**.
- `e8f19cc0ad70` — loads q4_K/q5_K flat-MV quants as uint for old Adreno compilers; `ggml/src/ggml-opencl/kernels/mul_mv_q4_k_f32_flat.cl`, `mul_mv_q5_k_f32_flat.cl` — **HIGH**.
- `86d86ed4396b` — transposes q4_K noshuffle scales for coalesced reads in GEMM/GEMV; `ggml/src/ggml-opencl/ggml-opencl.cpp`, `kernels/gemm_noshuffle_q4_k_f32.cl`, `kernels/gemm_noshuffle_q4_k_q8_1_dp4a.cl`, `kernels/gemv_noshuffle_q4_k_f32.cl` — **HIGH**.
- `010be9683afa` — Intel-only q4_K/q5_K MV reuse and 8x8 MM tiles; `ggml/src/ggml-opencl/ggml-opencl.cpp`, `kernels/mul_mm_q4_k_f32_l4_lm.cl`, `mul_mm_q5_k_f32_l4_lm.cl`, `mul_mv_q4_k_f32_flat.cl`, `mul_mv_q5_k_f32_flat.cl` — **HIGH** (not phone-targeted).
- `39eab74a05d3` — sends large q6_K lm-heads to flat GEMV; `ggml/src/ggml-opencl/ggml-opencl.cpp` — **HIGH**.
- `3dafb585f834` — disables FA/MoE weight repack for A850 compiler issues; edits q4_K MV and MoE kernels plus dispatch; `ggml/src/ggml-opencl/ggml-opencl.cpp`, `kernels/gemm_moe_mxfp4_f32_ns.cl`, `kernels/mul_mv_q4_k_f32.cl` — **HIGH**.
- `505b1ed15ca8` — excludes selected MoE kernels/repack on A7X/A6X/unknown Adreno; `ggml/src/ggml-opencl/ggml-opencl.cpp` — **MEDIUM**.

### MoE and binary-kernel paths

- `1d1d9a9ed7a4` — adds int8 dp4a dense/MoE prefill, quantization, and MoE kernels; `CMakeLists.txt`, `ggml-opencl.cpp`, `kernels/cvt.cl`, `kernels/gemm_moe_*_dp4a.cl`, `kernels/gemm_noshuffle_*_dp4a.cl`, `kernels/gemv_moe_*_ns.cl`, `kernels/moe_combine.cl`, `kernels/moe_reorder_quant_a_q8_1.cl`, `kernels/quant_a_q8_1.cl` — **HIGH**.
- `6bdd77f13cf1` — changes five MoE dp4a kernels to 128-bit local activation loads/stores; `ggml/src/ggml-opencl/kernels/gemm_moe_mxfp4_q8_1_dp4a.cl`, `gemm_moe_q4_0_q8_1_dp4a.cl`, `gemm_moe_q4_k_q8_1_dp4a.cl`, `gemm_moe_q6_k_q8_1_dp4a.cl`, `gemm_moe_q8_1_dp4a.cl` — **HIGH**.
- `86a9c79f8667` — loads q6_K MoE GEMM from the binary library and fixes q5_K availability testing; `ggml/src/ggml-opencl/ggml-opencl.cpp` — **HIGH**.
- `58546250cfaa` — registers two binary dp4a MoE symbols; `ggml/src/ggml-opencl/ggml-opencl.cpp` — **MEDIUM**.
- `9ee9fc04c136` — makes MoE expert scatter deterministic; `ggml/src/ggml-opencl/ggml-opencl.cpp`, `kernels/moe_sort_by_expert.cl` — **MEDIUM**.
- `3af988fabcf7` — fuses gpt-oss per-expert bias into SwiGLU and down-projection combine; `CMakeLists.txt`, `ggml-opencl.cpp`, `kernels/moe_add_id_glu.cl`, `kernels/moe_combine.cl` — **MEDIUM**.

### Flash attention and other kernels

- `60addddf3c56` — adds the missing generic FA reload barrier when `WG_SIZE > FA_SG`; `ggml/src/ggml-opencl/kernels/flash_attn_f16.cl`, `flash_attn_f32.cl` — **MEDIUM**.
- `689e227db485` — transposes the K tile in FA prefill local memory; `ggml/src/ggml-opencl/ggml-opencl.cpp`, `kernels/flash_attn_f32_f16.cl`, `flash_attn_f32_q4_0.cl`, `flash_attn_f32_q8_0.cl` — **MEDIUM**.
- `56a83860ddb5` — treats a NULL FA mask as non-causal; `ggml/src/ggml-opencl/ggml-opencl.cpp` — **LOW**.
- `89e0aa6fd362` — defaults FA c8 cluster width to 16 on X1E; `ggml/src/ggml-opencl/ggml-opencl.cpp` — **LOW** (not 740/750).
- `c3d47e696b11` — maps QCOM shuffle-xor to the QCOM builtin and declines A7X mixed/quant FA; `ggml/src/ggml-opencl/ggml-opencl.cpp`, `kernels/flash_attn_f32_f16.cl`, `flash_attn_f32_q4_0.cl`, `flash_attn_f32_q8_0.cl`, `mul_mv_f16_f32_l4.cl` — **MEDIUM; the decline half is superseded by `6503355df0eb`, but the shuffle mapping remains distinct**.
- `0ab9d6fed73d` — limits GLU local workgroup size; `ggml/src/ggml-opencl/ggml-opencl.cpp` — **LOW**.
- `0190529ec450` — adds OpenCL SWIGLU_CLAMP; `ggml/src/ggml-opencl/ggml-opencl.cpp`, `kernels/glu.cl` — **LOW**.
- `b062ba735e5e` — ports fused Mamba-2 SSM_SCAN for d_state 128/256; `CMakeLists.txt`, `ggml-opencl.cpp`, `kernels/ssm_scan.cl` — **LOW**.
- `b85833e93412` — adds ABS; `CMakeLists.txt`, `ggml-opencl.cpp`, `kernels/abs.cl` — **LOW**.

### Backend plumbing and small fixes

- `cd26896c19e6` — keeps vocab-scale K-quant lm-head on CPU on A7X; `ggml/src/ggml-opencl/ggml-opencl.cpp` — **MEDIUM**.
- `6b4fa88a6ce2` — fixes norm local size; `ggml/src/ggml-opencl/ggml-opencl.cpp` — **LOW**.
- `749f688fcaa4` — supports ROPE offset; `ggml/src/ggml-opencl/ggml-opencl.cpp`, `kernels/rope.cl` — **LOW**.
- `fe8156f78901` — wires ROPE offset support/gating into OpenCL; `ggml/src/ggml-opencl/ggml-opencl.cpp` — **LOW**.
- `153d324bcf86` — marks OpenCL as non-mmap for automatic load-mode selection; `ggml/src/ggml-opencl/ggml-opencl.cpp` — **LOW**.
- `ed7adbfefd5e` — adds on-disk compiled-program cache; `CMakeLists.txt`, `cl-program-cache.cpp`, `cl-program-cache.h`, `ggml-opencl.cpp` — **MEDIUM** (large loader/compile-surface edit).
- `c745be2a2c5a` — increments OpenCL backend refcount so profiling flushes at teardown; `ggml/src/ggml-opencl/ggml-opencl.cpp` — **LOW**.
- `42fc24306070` — fixes fused RMS norm view offset; `ggml/src/ggml-opencl/ggml-opencl.cpp` — **LOW**.
- `12127defda4f` — avoids `clCreateBufferWithProperties` for CL 2.x; `ggml/src/ggml-opencl/ggml-opencl.cpp` — **LOW**.
- `00e79f6fb146` — tolerates missing `cl_khr_integer_dot_product` and disables dp4a dispatch there; `ggml/src/ggml-opencl/ggml-opencl.cpp` — **MEDIUM**.
- `ac2557cb24de` — documents Adreno 810 and adjusts one OpenCL path; `docs/backend/OPENCL.md`, `ggml/src/ggml-opencl/ggml-opencl.cpp` — **LOW**.

## 3. Named-plan cross-checks

- **PR #26476**: merged commit `6503355df0eb4f65875012523263c302fe0088c1`; it contains both the A7X FA compile-decline and old-E031 q6_K flat workaround. See [PR #26476](https://github.com/ggml-org/llama.cpp/pull/26476). The fork already carries this as `5c7e16fa682834ee4d4ba9dca8a18b283af95393`; do not cherry-pick it again.
- **FA per-work-group guard**: merged commit `60addddf3c567c43ec3caf70fc953fba3572d96f`, PR #26434; the PR specifies `WG_SIZE > FA_SG`, with the shipped Adreno path byte-identical and the multi-subgroup tuned path fixed. See [PR #26434](https://github.com/ggml-org/llama.cpp/pull/26434).
- **X2 binary-kernel library**: enablement is PR #23042, merged commit `4fc4ec5541b243957ae5099edb67372f8f3b550e` (outside this 40-commit range, already ancestral to the merge-base); it targets X2-90/X2-85/X2-45 and a manually supplied Qualcomm library. See [PR #23042](https://github.com/ggml-org/llama.cpp/pull/23042). In-range follow-ons are `86a9c79f8667` (q6_K MoE) and `58546250cfaa` (two dp4a symbols); neither is an Adreno 740/750-first pick.
- **q4_K Adreno flat-MV fix**: PR #25780 merged `e8f19cc0ad70a243c8012bf17b4be601abfc8ea2`; its commit list is `a3b4011`, `71ab138`, `3e77ff3`. The PR says uint loads help old E031.41 and are neutral on E031.45+. See [PR #25780](https://github.com/ggml-org/llama.cpp/pull/25780).
- **q4_K repack/coalescing**: PR #25805 merged `86d86ed4396b`; it transposes q4_K scales for dense prefill and token generation, with the PR calling out especially large A7X prefill benefit. See [PR #25805](https://github.com/ggml-org/llama.cpp/pull/25805).
- **q6_K / `ADRENO_OLD_COMPILER`**: the actual upstream path is in `6503355df0eb`; it adds `-DADRENO_OLD_COMPILER=1` only for old E031 compilers and includes the A7X FA decline. See [PR #26476](https://github.com/ggml-org/llama.cpp/pull/26476).

## 4. Recommended order (phone target; candidate picks only)

The q6_K prerequisite is already local, so it is listed as retained rather than counted as a new pick.

1. **`e8f19cc0ad70` / PR #25780 — q4_K/q5_K flat-MV uint loads.** Why: direct A7X/E031.41 optimization; [upstream reports](https://github.com/ggml-org/llama.cpp/pull/25780) q4_K’s old-compiler path at roughly 2x. Risk: **HIGH**, because it edits K-quant `mul_mv` kernels; port the two flat kernels around local dispatch/repack changes. Device gate: on S23/S24-class targets, require 407/407 MoE, dense >= baseline, roundtrip 0, and byte-identical 64-token smoke.
2. **`43d87ff2dd0e` / [PR #27632](https://github.com/ggml-org/llama.cpp/pull/27632) — Adreno image bounds/tiling contract.** Why: correctness guard for q4_K padded image GEMV and KQ/KQV image dispatch, relevant before throughput claims. Risk: **HIGH**, because it edits q4_K GEMV and the dispatch function; reconcile with local K2/qk23 routing. Device gate: require 407/407 MoE, dense >= baseline, roundtrip 0, and byte-identical 64-token smoke.
3. **`60addddf3c56` / PR #26434 — generic FA multi-subgroup barrier.** Why: [closes the tuned-workgroup WAR race and compiles out on shipped one-subgroup Adreno geometry](https://github.com/ggml-org/llama.cpp/pull/26434). Risk: **MEDIUM**, isolated to FA kernels; verify it does not disturb local FA admission/decline shims. Device gate: require 407/407 MoE, dense >= baseline, roundtrip 0, and byte-identical 64-token smoke.

Retain/verify, not re-pick: `6503355df0eb` is already represented by local `5c7e16fa6` (q6_K old-E031 scalar path plus A7X FA decline). The fork’s helper-signature adaptation is intentional.

## 5. OBSOLETES / supersession flags

**PROMINENT — `43d87ff2dd0e` partially obsoletes local `dcd0a7607`’s Q4_K large-M safety redirect.** Upstream now clamps padded q4_K noshuffle fetch rows and predicates stores, so the local `ne1 % 128 != 0` Q4_K redirect is no longer required for the specific out-of-bounds-read safety rationale. Re-evaluate that Q4 branch after porting; do not remove the separate Q6_K dispatch logic or performance policy without device tests.

**`6503355df0eb` supersedes the A7X mixed/KV-convert FA-decline half of upstream `c3d47e696b11`, but does not supersede c3d’s QCOM shuffle-xor mapping.** Local `5c7e16fa6` already carries the former.

No upstream commit in this range exactly replaces the local trans4 scalar-uint convert/restore paths, q2_K/q3_K MoE kernels, local MoE K barrier fixes, q4_K/q5_K MoE mask-argument fix, or K2/qk23 dispatch changes. The K-quant and MoE commits above are therefore conflict candidates, not automatic local-patch replacements.
