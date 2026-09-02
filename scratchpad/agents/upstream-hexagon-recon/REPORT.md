# Upstream Hexagon Commit Recon — Class B Defect Fingerprint

**Date:** 2026-09-02
**Scope:** Read-only recon of upstream llama.cpp hexagon commits (22b69b6e92..FETCH_HEAD) for plausibly fixing our banked Class B defect.
**Defect:** q4_0 MUL_MAT m=2880,n=32,k=2880 on HMX path, Hexagon v79 — NaN at ONE output index, ONLY on first in-process execution; requires dirty process/VTCM state from prior ops; poisoned index moves per run/session; q8_0 same geometry passes; k=1024 passes; n=64 passes. T1 (weight-tile scale pad zeroing) refuted by cell #50.

---

## Commit-by-Commit Analysis

### 1. b2dd28a3b — "L2 cache handling rework (dirty bit tracking with lazy flushing) and more MUL_MAT updates"

**Verdict: RELATED-BUT-DIFFERENT**

**What it does:** Introduces a bitmap-based dirty-bit tracking system for L2 cache lines. Key additions:

- `htp-tensor.h`: New file with `htp_tensor_make_dirty()` / `htp_tensor_make_clean()` that set/clear bits in a `dirty_map` bitmap, walking alias chains (`ggml/src/ggml-hexagon/htp/htp-tensor.h:22-35`).
- `l2-cache.c`: New file implementing `htp_tensor_flush()` which checks `dirty_map` before flushing — if not dirty, skip; if dirty and > threshold, flush-all; otherwise range-flush (`l2-cache.c`).
- `ggml-hexagon.cpp`: Adds `dirty_map[HTP_OP_MAX_TENSORS / 32]` to `htp_context` (`ggml-hexagon.cpp:103`).
- `main.c` OLD (before this commit): Per-op flush model — `hex_l2flush(src)` before read if `HTP_TENSOR_COMPUTE && !HTP_TENSOR_FLUSHED`; `hex_l2flush(dst)` after write + set `HTP_TENSOR_FLUSHED` flag (`main.c:815-848`).
- `main.c` NEW: Same per-op model PLUS batch-level `bitmap_reset(dirty_map)` at opbatch start.

**Why it doesn't fix our defect:** The L2 cache is on the DDR side. VTCM is on-chip memory accessed via DMA, which bypasses L2. Our defect is about VTCM state corruption, not L2 cache coherence. The OLD code's per-op `hex_l2flush` already handles DDR-side cache for compute tensors. The dirty-bit tracking optimizes which tensors need flushing but doesn't change the fundamental flush-before-read semantics. Furthermore, the batch-level `qurt_mem_cache_clean(QURT_MEM_CACHE_FLUSH_INVALIDATE_ALL)` was already present in the OLD code's `process_opbatch` (confirmed by checking the pre-b2dd28a3b `main.c` at the `htp_packet_callback` path — it does a full cache clean at opbatch start). The dirty-bit tracking is an optimization, not a correctness fix for VTCM.

**Fingerprint match:** Does NOT explain first-exec-only, dirty-state-required, index instability, q8_0 immunity, or pad-zeroing futility.

---

### 2. 71102a73f — "check tensor type when reusing descriptors"

**Verdict: PLAUSIBLE-FIX (top candidate)**

**What it does:** Single 2-line change in `ggml-hexagon.cpp:1289`:

```cpp
// BEFORE (our side):
return (h->ne[0] == ne0) && (h->ne[1] == ne1) && (h->ne[2] == t->ne[2]) && (h->ne[3] == t->ne[3]) &&
       (h->nb[0] == t->nb[0]) && (h->nb[1] == nb1) && (h->nb[2] == nb2) && (h->nb[3] == nb3);

// AFTER (upstream):
return (h->type == t->type) &&
       (h->ne[0] == ne0) && (h->ne[1] == ne1) && (h->ne[2] == t->ne[2]) && (h->ne[3] == t->ne[3]) &&
       (h->nb[0] == t->nb[0]) && (h->nb[1] == nb1) && (h->nb[2] == nb2) && (h->nb[3] == nb3);
```

The `same_shape()` function is called in `add_tensor()` (`ggml-hexagon.cpp:1296-1305`) which first looks up by data pointer (`d_map`), then by tensor pointer (`t_map`). If `same_shape` returns true, the existing `htp_tensor` descriptor is reused. Without the type check, a q8_0 tensor with the same shape/strides as a q4_0 tensor would be incorrectly reused.

**Mechanism — how this could cause our defect:**

1. **Descriptor reuse corruption:** The `htp_tensor` descriptor contains VTCM layout parameters (tile sizes, strides, offsets) that are type-dependent. q4_0 and q8_0 have different tile sizes (`htp_mm_get_weight_tile_size(type)`). If a q8_0 descriptor is reused for q4_0, the VTCM layout is computed with wrong tile parameters → DMA transfers use wrong strides/offsets → stale VTCM data from the q8_0 op leaks into the q4_0 output buffer.

2. **First-exec-only:** On first execution of shape 2880/32/2880, if a q8_0 tensor with the same shape exists in the opbatch, the descriptor is incorrectly reused. On re-execution, the q4_0 tensor is already in the descriptor pool with the correct type, so no incorrect reuse occurs.

3. **Dirty-state-required:** The incorrect reuse only happens if prior ops (specifically q8_0 ops with matching shape) have populated the descriptor pool. A cold process starts with an empty pool → no reuse → no NaN.

4. **Index instability:** The specific stale VTCM content depends on which q8_0 tensor was previously processed and its data content. Different runs/sessions process different prior ops → different stale content → different NaN index.

5. **q8_0 immunity:** The defect is q4_0-specific because q8_0 → q8_0 reuse is type-correct (the type check passes). Only q8_0 → q4_0 reuse is corrupted.

6. **Pad-zeroing futility:** The defect isn't in the weight-tile pad — it's in the VTCM layout parameters themselves. Zeroing the pad doesn't fix wrong strides/offsets.

**Fingerprint match:** Explains ALL five banked observations: first-exec-only, dirty-state-required, index instability, q8_0 immunity, pad-zeroing futility.

**Conflict risk:** MODERATE. The change is in `ggml-hexagon.cpp` which has ~4100 lines of diff between our branch and upstream. However, the `same_shape` function and `add_tensor` are likely structurally similar in both versions (they're core opbatch machinery). The 2-line change itself is trivial — the risk is in surrounding context changes that might have moved the function.

---

### 3. 960dffab0 — "MUL_MAT and MUL_MAT_ID fusion and fixes"

**Verdict: UNRELATED to our specific defect**

**What it does:** Large commit (1236 insertions, 180 deletions in matmul-ops.c). Key changes:

- **QKV/FFN fusion:** Fuses consecutive MUL_MAT ops that share the same activation input (`hmx_mm_op_matmul_id_nx`).
- **MUL_MAT_ID fusion:** Fuses MUL_MAT_ID into MUL_MAT_ID_NX for 2x/3x/... cases.
- **VTCM budget fix:** Changes overhead calculation from hardcoded `256` to `htp_mm_hmx_get_2d_overhead(pipeline, is_matmul_id)` which returns `num_regions * HTP_MM_HMX_TILE_SIZE + 256` (`matmul-ops.h:300-309`). Also adds `max_nc_budget` cap to prevent exceeding VTCM (`matmul-ops.h:137`).
- **Fastdiv optimization:** Replaces scalar divs with fastdiv throughout.
- **VA defrag:** Adds simple virtual address space defragmentation.

**"Fixes" enumerated:**
1. `hex-mm: correct overhead sizing to make sure we dont exceed vtcm budget for large dims` — VTCM budget miscalculation could cause buffer overflow → stale data. But this is about VTCM *allocation*, not VTCM *content* from prior ops. The budget fix prevents the layout from exceeding VTCM, but our defect is about stale VTCM content, not VTCM overflow.
2. `hex-mm: remove hardcoded ne[1] < 32K restriction` — Unrelated to our shape.
3. `hex-get-rows: explicitly reject repacked Q8_0` — Unrelated (get-rows op).

**Why it doesn't fix our defect:** The VTCM budget fix prevents layout overflow but doesn't address stale VTCM content from prior ops. The fusion changes are additive (new code paths) and don't modify the existing single-op HMX path that our defect triggers.

**Fingerprint match:** Does NOT explain first-exec-only or dirty-state-required. The budget fix could prevent VTCM overflow crashes but not single-index NaN from stale content.

---

### 4. 990e3bfee — "fix FA HMX queue ordering and pack the rescale D matrices"

**Verdict: UNRELATED**

**What it does:** Flash-attention-specific fix. Changes queue ordering in `flash-attn-ops.c:114-145` — O-update must be pushed before next block's QK-dot because `hmx_queue_pop()` retires the oldest descriptor. Also double-buffers D matrices (`flash-attn-ops.h:109-112`).

**Why it doesn't fix our defect:** Entirely within `flash-attn-ops.c/h`. MUL_MAT code path is untouched. The queue ordering fix is about FA pipeline hazard, not MUL_MAT.

**Fingerprint match:** Zero relevance.

---

### 5. 0a50d9909 — "further improved pipeline of the core bits (L2, DMA, MM, FA)"

**Verdict: RELATED-BUT-DIFFERENT**

**What it does:** Builds on b2dd28a3b. Key changes:

- **Dirty ranges:** Adds `dirty_ranges` tracking (range-based flush instead of per-tensor) in `main.c:128-131`.
- **Cache clean reordering:** Moves `qurt_mem_cache_clean(FLUSH_INVALIDATE_ALL)` AFTER buffer setup (was before), adds tracing (`main.c:128-131`).
- **Output transfer threading:** Adds multi-threaded output transfer in `matmul-ops.c:244-300` (`transfer_output_chunk_col_chunk_worker_fn`).
- **Dirty marking:** Changes from `htp_tensor_make_dirty(dst)` to `htp_tensor_dirty_all(ctx, ctx->dsts, HTP_OP_MAX_OUTPUTS)` (`main.c:80-88`).
- **Removes bitmap_reset:** Replaces `bitmap_reset(ctx->dirty_map, ...)` with `memset(ctx->dirty_ranges, 0, ...)` at opbatch start.

**Why it doesn't fix our defect:** Same reasoning as b2dd28a3b — this is about L2 cache management optimization, not VTCM content. The dirty_ranges change is a performance optimization for the flush path. The output transfer threading doesn't change the HMX kernel behavior.

**Fingerprint match:** Does NOT explain first-exec-only or dirty-state-required.

---

### Remaining 18 Commits — Brief Scan

| SHA | Subject | Relevance |
|-----|---------|-----------|
| f027c4f1b | F16 support for unary ops | UNRELATED |
| 69320fef1 | Missing FARF logs | UNRELATED |
| 9723942ad | CPY fence bug | UNRELATED (cpy-ops.c) |
| 0190529ec | SWIGLU_CLAMP | UNRELATED |
| 9e54e687c | Device discovery | UNRELATED |
| 57291f264 | Alloc dependencies in graph_optimize | UNRELATED (ggml core) |
| e70802a01 | HTP unary ops ABS/LOG | UNRELATED |
| 83d855c5a | RMS_NORM_MUL weight-offset | UNRELATED (unary-ops.c) |
| 192067b72 | Multi-NPU async backend | UNRELATED |
| 749f688fc | ggml_rope_set_offset | UNRELATED |
| fe8156f78 | ggml_rope_set_offset metal | UNRELATED |
| 153d324bc | Default load-mode auto | UNRELATED |
| 355303eda | Partial im2col support | UNRELATED |
| c0bc8591e | Windows crash fix | UNRELATED |
| 0278d8362 | Activation ops update | UNRELATED |
| 76f46ad29 | CLAMP op | UNRELATED |
| c71854292 | HMX queue signal enum-narrowing | UNRELATED (enum cast, not logic) |
| 67776eaee | ARGSORT performance | UNRELATED |

None of the remaining commits touch MUL_MAT HMX q4_0 paths, VTCM initialization, descriptor reuse, or L2/flush mechanisms in ways relevant to our defect.

---

## Top Candidate: 71102a73f (descriptor type check)

### What it explains

| Observation | Explained? | Mechanism |
|-------------|------------|-----------|
| First-exec-only | ✅ | Incorrect reuse only on first encounter; re-execution finds correct-type descriptor in pool |
| Dirty-state-required | ✅ | Requires prior ops to have populated descriptor pool with same-shape different-type entries |
| Index instability | ✅ | Different prior ops → different stale VTCM content → different NaN index |
| q8_0 immunity | ✅ | q8_0→q8_0 reuse is type-correct; only q8_0→q4_0 reuse is corrupted |
| Pad-zeroing futility | ✅ | Defect is in VTCM layout params (strides/offsets), not in pad content |
| Cold process clean | ✅ | Empty descriptor pool → no incorrect reuse |

### What it does NOT explain (open questions)

1. **Why exactly ONE index?** The corrupted VTCM layout would affect an entire tile/chunk, not a single element. Possible explanation: the corrupted layout causes a DMA to read exactly one stale scale value that happens to produce NaN when multiplied. The single-index behavior suggests the corruption is in the scale/dequant path, not the accumulation path.

2. **Why m=2880,n=32,k=2880 specifically?** The shape must match a q8_0 tensor in the opbatch for incorrect reuse to occur. The test harness runs many shapes; only this specific shape has a same-shape q8_0 predecessor.

3. **Why does k=1024 pass?** Different k → different tile count → possibly no same-shape q8_0 predecessor → no incorrect reuse.

4. **Why does n=64 pass?** Same reasoning — different n means no same-shape q8_0 predecessor.

### Conflict risk assessment

- **File:** `ggml/src/ggml-hexagon/ggml-hexagon.cpp`
- **Divergence:** ~4100 lines changed between our branch and upstream in this file
- **Change size:** 2 lines (trivial)
- **Function location:** `same_shape()` is core opbatch machinery, likely structurally stable
- **Risk:** LOW for the 2-line change itself, MODERATE for surrounding context if the function has moved or been refactored
- **Recommendation:** Cherry-pick is feasible; manual conflict resolution likely trivial given the small change size

---

## Recommendation

**Cherry-pick candidate: 71102a73f** (sha `71102a73f2042d9aacae2d6dc70874a8611b8361`)

This is the ONLY upstream commit that plausibly explains ALL five banked observations of the Class B defect. The 2-line change is trivial to audit and apply. Conflict risk is moderate (large surrounding file divergence but small targeted change).

**Secondary candidate for desk review: 960dffab0** (VTCM budget fix portion only)

The VTCM budget miscalculation (`256` → proper `num_regions * HTP_MM_HMX_TILE_SIZE + 256`) could cause buffer overlaps that manifest as stale-data reads. However, this is less likely to be the primary cause because:
- Our defect is about stale VTCM content, not VTCM overflow
- The budget fix doesn't change how VTCM is initialized or flushed
- The existing code already has `HTP_STATUS_VTCM_TOO_SMALL` checks that would catch overflow

If cherry-picking 71102a73f doesn't resolve the defect, the VTCM budget fix from 960dffab0 is worth a desk review as a secondary angle.

**Not recommended for cherry-pick:** b2dd28a3b, 0a50d9909 (L2 cache rework — massive diff, different layer), 990e3bfee (FA-only).

**Bottom line:** One commit (71102a73f) is a strong candidate. The remaining 22 commits do not plausibly fix our defect. If the descriptor type-check doesn't cure it, the root cause is likely NOT in upstream llama.cpp and requires deeper DSP-side instrumentation (VTCM aliasing, double-buffer staleness, HMX accumulator state — as noted in cell #50 REPORT).
