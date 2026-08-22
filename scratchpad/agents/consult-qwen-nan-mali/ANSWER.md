# Qwen 3.8 Max consult — NaN judge (HTP harness) + Mali-G57 kernel recipes

Channel: chat.qwen.ai via Paseo browser (free API quota was exhausted; owner logged
in, orchestrator drove the chat). Date: 2026-08-22 night. Full answer transcribed
below (dedup of the double paste). Session: "New chat" in owner's Qwen account.

## Q1 — test-backend-ops CPU-reference NaN on quantized MUL_MAT (Android arm64)

**Verdict: CPU-reference data/buffer poisoning, NOT Hexagon math and NOT
(primarily) -ffp-model=fast.** Float paths passing + all quant families failing on
two Snapdragon generations points at the CPU reference path for quantized tensors.

(a) -ffp-model=fast: unlikely root cause — the dotprod/i8mm accumulation is
INTEGER; float only enters at the block-scale edges. -fno-finite-math-only does
not undo reassociation/contraction/reciprocal parts of fp-model=fast. Fast-math
can only aggravate pre-existing bad data/UB (roundf(NaN), zero/garbage scales).

(b) **ARM REPACK extra buffer types = TOP SUSPECT.** If the reference allocator
places a quantized tensor in a REPACK/tiled extra buffer but the harness fills it
as canonical q4_0/q8_0, the fp16 scale field reads repack metadata → NaN/Inf half
patterns → dequant NaN immediately. Explains: f32/f16 pass, all quant fail,
identical on v73/v75, HTP finite (HTP consumes its own correctly-initialized
buffers). Also watch: block-granular padding/K-tail/view offsets not zero-filled.

(c) Discriminating experiments IN ORDER (do NOT start with a global
-ffp-model=precise rebuild):
1. **Log/force the CPU reference buffer type** — if failing tensors sit in a
   buffer named *REPACK* → smoking gun. Force ggml_backend_cpu_buffer_type()
   (plain host) for reference tensors; if NaNs disappear → root cause found.
2. Scan the reference INPUT blocks for NaN/Inf fp16 scales
   (half_is_nan: (h&0x7C00)==0x7C00 && (h&0x03FF)!=0) — inputs poisoned = setup
   bug; inputs finite but output NaN = compute/UB.
3. Build CPU without dotprod/i8mm/repack (-DGGML_CPU_ARM_ARCH=armv8.2-a+fp16)
   keeping fast-math — isolates the optimized aarch64 path.
4. Only then: reference path with -ffp-model=precise -ffp-contract=off -fno-lto
   (watch flag ORDER in compile_commands.json).
5. Optional: HWASan (-fsanitize=hwaddress) for OOB/uninitialized block reads.

(d) This is a known upstream **class** (post extra-buffer/aarch64-repack work):
accelerator finite, CPU reference NaN, quant-only, aarch64-only; fixes landed in
test/reference allocation or repack init, not in dot kernels. Check whether
3f545be predates the reference-buffer fix → update/cherry-pick.

## Q2 — Mali-G57 (Valhall, warp 16) OpenCL 1d quant kernels

**Verdict: two distinct issues — unsupported subgroup collectives in dense 1d
kernels, and a q4_K work-group-size constraint mismatch. MUL_MAT_ID q8_0 passing
means bring-up/half-fixes/data-path are fine.**

(a) Reduction replacement: prefer `sub_group_reduce_add()` ONLY after a tiny
dispatch-probe validates it (drivers can accept the builtin and still fail at
dispatch); otherwise local-memory reduction. For 16 lanes a lane-0 SERIAL
reduction with two barriers often beats a tree with four. Pad local arrays
[N_SIMDWIDTH+1]. Never barrier inside divergent control flow; early-return only
after all barriers. Grep ALL sub_group_* builtins (shuffle/broadcast/scan/
ballot/any/all) — any of them can SIGILL, not just shuffle_xor.
lane = get_local_id(0) % N_SIMDWIDTH (not get_sub_group_local_id).

(b) q4_K -54: enqueue local size vs compile-time `reqd_work_group_size` mismatch
(Adreno path hardcodes 32/64), or local/private memory (register spills) shrinking
CL_KERNEL_WORK_GROUP_SIZE below the requested local. Safe fix: query
CL_KERNEL_COMPILE_WORK_GROUP_SIZE / WORK_GROUP_SIZE / LOCAL_SIZE /
PRIVATE_MEM_SIZE, honor reqd exactly or clamp to max, round global up to a
multiple of local; parameterize reqd_work_group_size(N_SIMDWIDTH,1,1); pass
-DN_SIMDWIDTH=16 -DN_SIMDGROUP=1 -DN_DST=1..2 consistently to host AND
clBuildProgram.

(c) **MUL_MAT_ID kernels are (plausibly) shuffle-free by construction** — MoE
irregular row sets prevent subgroup tiling. YES: generalize the MoE style to
dense for correctness bring-up. Staged plan:
  Stage 1: full-dot per work item, zero collectives.
  Stage 2: 16-lane local reduction.
  Stage 3: sub_group_reduce_add if probe-validated.
  Stage 4: Mali-tuned tiles + weight repack (separate scale array, padded quants,
           32/64B alignment, 16-lane tiles).

(d) Valhall traps: local sizes multiple of 16 (one subgroup per WG for generic
path); barriers expensive; q4_K/q6_K dequant is ALU-heavy and can spill (start
with q4_0/q8_0 — counterintuitively often FASTER than K-quants on generic mobile
kernels); vload_half once per block, never per element, accumulate in float.
**Prefill viability: decode/short-prefill plausible with generic patched kernels;
competitive/long prefill on Mali-G57 very likely requires ML-Drift-style Mali
specialization** (token/output tiling, weight reuse, low-barrier reductions,
Mali block layouts) — otherwise dominated by barriers, unpack ALU, poor reuse.

## Action hooks (mapped to our queue)
- Q1 → next PC+device slot: experiment 1 (log/force reference buffer type) on the
  hexagon build; also check upstream master for the reference-buffer fix.
- Q2 → feeds Mali gate 5 (if owner opens the kernel project): stage 1-2 on dense
  q4_0/q8_0 first, q4_K WG-size fix via query/clamp, subgroup probe kernel.
