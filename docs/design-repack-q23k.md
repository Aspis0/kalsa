# Project #29 — ARM NEON repack and kernels for Q2_K/Q3_K

Status: implementation design; desk-only, no code or device work performed here.
Fork: `Aspis0/kalsallama`, new branch `kalsa/repack-q23k`, based on the current pin `1882bf8cd99659246f4ddecb99c268669d7bb3c9`.

## 1. Goal and non-goals

The goal is a correct, upstreamable ARM CPU path for KEXP expert tensors: Q2_K gate/up and Q3_K down, using compact repacks and NEON dotprod kernels. The immediate motivation is the measured 16-turn LFM2.5-8B-A1B KEXP collapse: file-backed experts were evicted and decode fell about 6.6x, with about 2.7x energy. The fix must preserve mmap for cold data while making the hot computation regular and resident when memory permits.

Target silicon is Cortex-A76 through X3 class: dotprod is the v1 baseline; i8mm is newer-silicon work. Expert tensors are 3-D `MUL_MAT_ID` weights, so 3-D routing is part of the design, not an optional integration.

Non-goals are GPU/NPU kernels, GGUF format changes, model quantization changes, an int8 Q3_K representation, arbitrary ragged weight rows, and background repack workers. The implementation is CPU-only and must retain a lossless generic fallback.

## 2. Decisions

| Area | Decision | Rationale and invariant |
|---|---|---|
| Repack identity | Add internal CPU traits named `Q2_K_8x4` and `Q3_K_8x4`; do not add serialized/public GGML types. | Current CPU repack attaches a trait through `tensor->extra`; preserve tensor type, GGUF compatibility, and fallback behavior. |
| Tile meaning | Eight weight rows are interleaved; the dotprod GEMM tile consumes four activation/RHS rows. | This matches the existing ARM 8-column/4-row family and the A76 coverage target. |
| Q2_K layout | Per 8-row × 256-K tile: `qs[16][8][4]` (512 B), packed `sm[16][8]` with `scale = sm & 0xf`, `min = sm >> 4` (128 B), `d[8]` and `dmin[8]` as fp16 (32 B): 672 B total. | Eight native pinned `block_q2_K` blocks are 8×84 = 672 B, so this is size-neutral. The pinned struct, not the older 2.5625-bpw description, is the accounting source: 672×8/2048 = 2.625 bpw. |
| Q3_K layout | Per 8-row × 256-K tile: `qs[16][8][4]` (512 B), `hmask[16][8][2]` (256 B), unpacked raw byte `scale_code[16][8]` holding 0..63 (128 B), `d[8]` fp16 (16 B): 912 B total. The effective signed scale is `s = scale_code - 32`. | Eight native blocks are 8×110 = 880 B; the repack is +32 B/tile, +0.125 bpw, or 3.5625 bpw. Byte scales buy a simple, auditable kernel and avoid 6-bit unpacking in the hot loop while preserving the pinned signed-scale convention. |
| Q3 materialization | Never materialize `q-4` as int8 in v1 or v2. Do not implement the alternative 4-bit-folded layout in this project. | Int8 Q3 expands to roughly 8.5 bpw and defeats residency. Reconstruct `q = low2 | (high<<2)` in registers; revisit folding only as a separate measured project. |
| Q2 math | For each 16-value subblock, accumulate `d_x * (d * scale * dot(q, x) - dmin * min * bsum)`. | `bsum` is the q8_K sum for exactly that 16-value subblock; preserve its sign, including negative sums. |
| Q3 math | Accumulate `d_x * d * s * (dot(q, x) - 4 * bsum)`, with raw `q` in 0..7 and effective signed `s = scale_code - 32`. | The `-4` correction is applied once per subblock, not once per lane; this is the packed-layout equivalent of `q-4`. The `-32` scale decode is required by the pinned scalar reference. |
| Integer precision | Use signed `sdot` into int32; widen scale/min before multiplication; flush integer accumulators at every 256-element superblock into fp32 output accumulators. | NEON dotprod is signed×signed. Q2/Q3 raw q values are non-negative signed int8. Activation and weight scales change per 256 block; never carry scaled integers across blocks. |
| Activation contract | Quantize each activation row to q8_K once, retaining `d`, 256 `qs`, and 16 int16 `bsums`; reuse that block across all selected experts. | Re-quantizing per expert wastes work and risks a wrong q8 stride or missing `bsums`. |
| ISA dispatch | Select the traits only when runtime NEON + dotprod are present. v1 never selects i8mm. | All target A76-class devices have dotprod; i8mm coverage is not universal and is v2. |
| Weight gates | Require `ne[0] % 256 == 0`, `nrows_interleaved = 8`, per-expert `ne[1] % 8 == 0`, dense contiguous source slices, and 16-byte tile alignment with 64-byte-aligned expert-slice strides. Zero all slice padding. | No interleaving across experts; `ne[1]` is the per-expert row count. Padding is at slice boundaries only and is included in `nb[2]` and the allocation size. |
| GEMV/GEMM split | `M==1` uses a dedicated GEMV kernel with no fake RHS padding. `M%4==0` uses 8x4 GEMM. Other RHS tails use one GEMV per RHS column. | Prevents over-read and keeps decode—the critical MoE case—on a clean path. |
| 3-D policy | Support 3-D `MUL_MAT_ID` end-to-end. Repack every expert slice independently; kernels remain 2-D. Dispatch obtains `expert_ptr = base + expert_id * nb[2]` and invokes the 2-D kernel on that slice. | `supports_op` must admit 3-D only when this compute path is present. This directly fixes the pinned `supports_op`/2-D assertion mismatch and avoids fragile graph-created 2-D views. |
| `MUL_MAT_ID` batching | v1 dispatches each selected id in stable input order; it uses GEMV for one selected RHS row. It does not add dynamic expert regrouping. | This is the smallest correct 3-D implementation. Ordinary `MUL_MAT` still tests GEMM; grouping is a later optimization, not a correctness dependency. |
| `supports_op` guard | The predicate and compute contract are identical: op type, 2-D/3-D rank, F32 host-accessible RHS, dense strides, K/row gates, dotprod, and initialized matching trait. Otherwise return false. | A rejected op falls back to the original Q2_K/Q3_K CPU path; no accepted shape may reach an assertion. |
| Fallback | Non-ARM, no dotprod, unsupported rank/stride/tail, or failed allocation uses the existing native quantized CPU implementation. | Correctness and model load remain available without repack. |
| Buffer sizing | The repack buffer’s allocation size, `set_tensor` size check, and `nb[2]` use the trait’s repacked byte count; they never use native `ggml_nbytes()` for the derived storage. | This is required because the logical tensor keeps its native GGML type while its backing storage is tiled. Native byte count remains the source-size check for the input copy only. |

Pinned-source audit: `ggml-common.h:298-321` defines the 84-byte Q2_K and 110-byte Q3_K source shapes; `ggml-quants.c:1249-1271` and `:1305-1341` preserve Q3’s raw 6-bit code and subtract 32; `ggml-cpu/repack.cpp:2965-3050` is the existing Q2 interleave transform; `:4547-4570` and `:4627-4637` show current traits/selection; `:4282` asserts 2-D compute; `:4727-4739` initializes and consumes `tensor->extra`; `:4774-4795` currently admits 3-D `MUL_MAT_ID`. This is the mismatch class tracked by upstream issue #26537; related 3-D routing/stride failures from #25837 remain regression targets. ARM’s existing dotprod 8x4 families use q8_Kx4 around `arch/arm/repack.cpp:3323-3347`, while i8mm uses `vmmlaq_s32` around `:4185` and `:4393-4443`. The current tree has Q2 traits but no Q3 trait and no ARM Q2/Q3 dotprod selection.

## 3. Scope

### v1 — full repack and dotprod

Implement the two compact layouts above, pack all eligible rows and experts into a full anonymous CPU repack buffer, add Q2/Q3 8x4 dotprod GEMV and GEMM, add 3-D-aware `MUL_MAT_ID` dispatch via `nb[2]`, and make `supports_op` reject every shape the compute path cannot execute. Full repack is enabled only by an explicit caller mode and only when projected derived bytes fit the caller’s `full_repack_budget_bytes`; an absent or insufficient budget selects the native fallback. Add explicit repack identity and backend tests.

Full repack is an opt-in/eligible CPU buffer mode, not a claim that every ARM model should repack. The original file-backed mapping may remain live while the derived buffer is built; the memory cost is therefore a first-class gate.

### v2 — selective cache and i8mm

Selective repack is a fixed-budget, read-only, evictable cache of expert slices. The logical tensor remains native Q2_K/Q3_K and authoritative; only hot slices get Q2_K_8x4/Q3_K_8x4 copies. Use states `COLD -> PACKING -> PACKED`, a decayed score with decay 0.95 per inference step, promotion at score 8, utility `score / repacked_bytes`, a 1.25 promotion hysteresis factor, minimum residency 64 steps, at most one promotion per step, and step-boundary-only promotion/eviction. `COLD -> PACKING` is a single-owner CAS; `PACKING -> PACKED` is a release publication; a PACKING or evicted slice always uses native storage. Use page-aligned slots and `madvise(MADV_DONTNEED)` on eviction. The default hard cache budget is 512 MiB and is configurable downward or upward by the caller; allocation never exceeds the configured budget.

Counters are per-thread and merged at the step boundary; no mutex or repack occurs in the matmul loop. Use two fixed slot size classes per expert tensor/type (Q2 and Q3), with each slot equal to the aligned repacked slice size; do not use a general allocator that can fragment the budget. A stable key is tensor name plus backend buffer identity and offset. Expose `ggml_backend_cpu_repack_cache_trim(target_bytes)` as the trim hook; it evicts only between steps and never needs writeback. `S1`–`S5` below are the v2 acceptance stages.

Explicitly out of v1: int8 Q3_K, 4-bit-folded Q3_K, ragged `ne[1]` weight tails, dynamic expert regrouping, background repack threads, i8mm 8x8, and selective cache policy.

## 4. Milestones and pass criteria

| Milestone | Deliverable | Pass criteria |
|---|---|---|
| M0 — registration/size | Traits, predicates, byte sizing, pack entry points, extra-buffer initialization, and 3-D guard. | For `ne0%256==0`, `ne1%8==0`, `ne2=1/>1`, selection is exact; computed bytes equal tile bytes×tiles×experts plus declared slice padding. Repeated init/set/reset/reuse leaves no stale `tensor->extra`. ASan/UBSan shows no OOB; the identity harness verifies zero padding (MSan is used where available). |
| M1 — identity | Packer and scalar repacked-layout dequant oracle. | Shapes `ne0=256,512,1024`, `ne1=8,16,24,32`, `ne2=1,2,3`; patterned bytes encode expert, row, block, subblock, plane, scale, min. Q2/Q3 dequant matches the scalar source within fp16 conversion tolerance; Q3 low plane, hmask order, raw six-bit code, and `code-32` signed-scale decode each have targeted tests. |
| M2 — GEMV | Q2/Q3 dotprod GEMV with q8_K and corrections. | Random and patterned activations, including negative `bsum`; Q2 min correction and Q3 `-4*bsum` match the float/dequant oracle. Integer accumulation is per 256 block and fp32 output is used. Outputs are bit-identical across 1, 2, 4, and max thread counts; any thread-count difference is a failure. |
| M3 — GEMM | 8x4 dotprod GEMM plus safe RHS fallback. | `M=1,2,3,4,5,8,9` matches the oracle; only multiples of four use GEMM, all other columns use GEMV. Test K 256/512/1024 and N 8/16/32. Run ASan/UBSan and a stack-smashing stress shape patterned after issue #19561. |
| M4 — 3-D `MUL_MAT_ID` | `nb[2]` expert-slice dispatch and supports guard. | Experts 2/3/5, tokens 1/2/7/16, random/repeated/unused ids, and per-expert patterned weights match expert-by-expert 2-D reference. No cross-expert interleave, wrong stride, or assertion; `supports_op` is false for every negative case. |
| M5 — integration | Backend tests, real KEXP tensor coverage, and pre-device evidence package. | `test-backend-ops` includes Q2/Q3 `MUL_MAT` and `MUL_MAT_ID`; host model logits are within the declared oracle tolerance for Q2 gate/up and Q3 down; repeated runs and all tested thread counts are stable. Attach allocation, RSS, and throughput measurements before any device run. |

### v2 cache stages

| Stage | Pass criteria |
|---|---|
| S1 — native 3-D baseline | Native 3-D Q2/Q3 `MUL_MAT_ID` maps every id to the correct slice and matches per-expert 2-D reference. |
| S2 — manual cache list | Forced experts use repacked kernels, others native kernels; mixed outputs match full-repack reference; budget accounting is exact and bounded. |
| S3 — promotion | Synthetic routing with one dominant, one warm, and cold experts promotes only after score 8; no promotion occurs in the hot loop; no in-flight mutation. |
| S4 — eviction/trim | A budget holding N experts survives N+10 rotating experts; lowest-utility entries evict, trim lowers RSS, and post-eviction results remain correct. |
| S5 — sustained device run | Across the prescribed 16 turns, hot slices remain anonymous/resident, cold slices remain file-backed, cache RSS is bounded by budget, no LMK/uncorrected swap, and the turn-rate collapse is absent. |

## 5. Test plan

The repack-identity harness is mandatory; generic backend tests alone are insufficient because graph support and CPU repack selection can bypass the new path. Generate source tensors with a deterministic encoder: each value’s quant, scale/min, expert id, row id, 256-block id, 16-value subblock id, and Q3 high-plane bit are independently recognizable. Include all-zero, all-max, alternating-sign activations and negative q8_K sums.

Use three independent oracles: (1) scalar native Q2_K/Q3_K dequant to fp32, (2) native scalar `vec_dot`/q8_K where available, and (3) expert-by-expert 2-D reference for 3-D routing. Compare bytes/layout metadata separately from numeric outputs. Check `nb[0]`, `nb[1]`, `nb[2]`, slice padding, and `ggml_nbytes()` against a hand calculation.

Run host tests under ASan and UBSan, with alignment sanitizer where available. Repeat allocation, repack, graph rebuild, tensor reset/reuse, and thread counts 1/2/4/max. Treat stack-smashing precedent #19561, high-thread garbling precedent #16942, stale `tensor->extra`, q8 block-stride errors, and all tails as explicit regressions.

Device validation is deferred, but the protocol is fixed. For each arm—native mmap/no repack, v1 full repack when its memory gate passes, and v2 selective cache when implemented—use the same binary, model, seed, thread count, screen/power state, cooldown, and 16-turn conversation replay. Record per turn: wall time, decode tok/s, energy, process `RssAnon`, `RssFile`, `VmSwap`, and the process major-fault counter from `/proc/<pid>/stat`; put `majflt` in the same row immediately next to `RssFile`, never as an unpaired total. Repeat arms in ABBA order with cold-start and warm-start labels.

The device pass requires no kill, no unexplained swap growth, no cache allocation beyond the hard budget, and turns 13–16 within 20% of the median turns 1–4 for the same arm **at matched generation lengths**. Record `tokensPredicted` per turn and compare rates only within matched length bands: the app team measured corr(tok/s, tokensPredicted) negative in every arm — raw per-turn tok/s confounds generation length with memory effects (their "bimodality" was length, not memory). Do not evaluate the kernel on a total decay%: context growth degrades all arms (~1/3 over 16 turns on the Jelly with zero eviction) and #29 cannot recover it. `majflt` reading (two-phone correction): the per-turn delta WITHIN an arm tracks collapse well; never compare cumulative majflt ACROSS arms whose weights are backed differently. If any mlock arm is ever run, read `/proc/<app-pid>/limits` — RLIMIT_MEMLOCK is per-device (S23 64MB hard, Jelly unlimited) and adb/run-as shells inherit shell limits, not the app's. Ship gate: the residency remedy is worth 6.6x on a no-margin device and 1.006x on one with margin (two-phone control, pre-registered prediction) — enablement must be conditional on a measured fit margin, never a global default.

## 6. Memory budget analysis

All figures below are expert tensors only, before allocator metadata; the 64-byte slice alignment adds zero for the stated dimensions. Native Q2 uses 84 B/256 and native Q3 uses 110 B/256. The full-repack buffer is anonymous and the native source mapping is assumed to remain live during construction.

| Model/expert set | Geometry and native recipe | Native Q2 | Native Q3 | Repacked expert bytes | Additional anonymous full-repack buffer |
|---|---|---:|---:|---:|---:|
| LFM2.5-8B-A1B | 22 layers × 32 experts; 2048×1792; gate/up Q2, down Q3 | 1.696 GB (1.579 GiB) | 1.110 GB (1.034 GiB) | 2.846 GB (2.651 GiB) | 2.846 GB (2.651 GiB); Q3 overhead 40.4 MB |
| Marco KEXP | 28 layers × 256 experts; 1024×768; gate/up Q2, down Q3 | 3.699 GB (3.445 GiB) | 2.422 GB (2.256 GiB) | 6.210 GB (5.783 GiB) | 6.210 GB (5.783 GiB); Q3 overhead 88.1 MB |

Thus Q2’s tile is storage-neutral; Q3’s only format expansion is +0.125 bpw. Full repack still duplicates the entire expert set while the source is retained: roughly 5.26 GiB of native-plus-derived expert representations for LFM and 11.48 GiB for Marco, before trunk, activations, and allocator overhead. Full repack is therefore a correctness/benchmark mode for LFM-class resident devices, not a safe default for Marco-class memory pressure. v2’s 512 MiB cache is the production memory shape: bounded anonymous hot slices plus native file-backed cold slices.

## 7. Upstream strategy

Open a design issue first, from `kalsa/repack-q23k`, describing the two layouts, arithmetic, 3-D policy, memory measurements, and explicit non-goals. ik_llama’s reported IQ2_K_R4 and IQ3_K_R4 prompt gains were about 1.81x and 1.71x, with only modest decode gains; use those numbers as prior art for row interleaving, never as a GGML result or forecast. Recheck upstream searches and issue #26537 immediately before opening the issue.

Submit in this order: (1) generic pack/layout traits, identity oracle, exact shape/support guards, and tests; (2) ARM 8x4 dotprod GEMV/GEMM plus the 3-D `MUL_MAT_ID` dispatch; (3) v2 selective cache with device evidence; (4) i8mm 8x8 only after a measured large-M benefit. Keep each change reviewable and retain the native fallback in every stage.

Claim only measured facts: Q2 size neutrality, Q3 +0.125 bpw, exact supported shapes, reference equivalence, and device results with memory counters. Do not claim universal speedup, mmap preservation for full repack, int8-Q3 viability, i8mm benefit without data, or that `majflt` alone proves residency failure. Explain that PR #14373 accepted Q2 interleave only after architecture-specific evidence and restricted enablement because repack cost and mmap loss mattered; this ARM design addresses that economic objection explicitly rather than assuming the x86 result transfers.

## 8. Risks and mitigations

1. **Q3 plane/scale corruption or signedness error.** Preserve `qs`, `hmask`, six-bit scale meaning, and bit order; use raw positive q with signed `sdot`; decode `s = scale_code - 32`; test `s * (dot(q,x)-4*bsum)` against dequant before benchmarking.
2. **Q2 min/bsum and numeric-range error.** Use the exact q8_K 16-value `bsums`, preserve negative signs, widen metadata, flush every 256 block, and accumulate final results in fp32.
3. **Shape, tail, stride, or thread partition error.** Gate K/weight rows and dense strides; split GEMV/GEMM; never fake-pad RHS; zero padding; require bit-identical outputs across thread counts; use ASan/UBSan and the #19561 stack-smash regression.
4. **3-D routing mismatch.** Fix the current `supports_op` acceptance versus `compute_forward` 2-D assertion before enabling the op; pack each expert independently and use `nb[2]`, not original row size, for offsets. Test repeated, unused, and reordered ids.
5. **Residency economics and lifecycle.** Do not make full repack the default on large expert sets; bound v2 cache bytes, make it evictable, transition only at step boundaries, trim with `madvise`, and clear/reinitialize `tensor->extra` and cache descriptors on reset/reuse. This covers the mmap/repack and large-MoE allocation concerns from issues #16761 and #23603. Report anon/file RSS and swap beside speed; a faster kernel that causes the 16-turn cliff is a failure.
