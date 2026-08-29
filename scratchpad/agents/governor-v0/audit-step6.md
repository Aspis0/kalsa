# Hostile audit — governor-v0 step 6: hybrid memory support (delta 3551c3d55..58ece1a41)

Auditor: step-6 hostile review, hybrid memory / numeric instrumentation focus.
Target: ~/Projects/kalsallama, branch kalsa/governor-v0, +~420/−30 (llama-memory-hybrid, llama-kv-commit, llama-model hybrid path, tests/test-governor-v0-hybrid.cpp, ext/CMake).
Run of record: suite 7/7 (hybrid SKIP w/o env); LFM2MOE C1 real-model run PASS, token equality vs baseline, commits=3 bytes=158629888 us=11645, 2 turns / 4 generated.

## Angle 1 — recurrent whole-state copy vs claimed source
(findings appended below)

## Angle 2 — THE BYTES: 158629888 decomposition
(findings appended below)

## Angle 3 — hybrid dispatch in kv-commit
(findings appended below)

## Angle 4 — llama-model.cpp un-throw
(findings appended below)

## Angle 5 — fences on the recurrent child
(findings appended below)

## Angle 6 — test honesty
(findings appended below)

## Angle 7 — sizes/hygiene
(findings appended below)

## VERDICT
(pending)

### A1 finding — recurrent whole-state copy: semantically faithful to the claim, SUPERSET in extent
CONFIRMED correct / CONFIRMED looser than claimed.
- The copy, src/llama-hybrid-commit.cpp:52-67 `copy_recurrent()`: per layer, `copy_tensor(src.r_l[i], dst.r_l[i], ...)` + same for s_l[i]; each `copy_tensor` copies `ggml_nbytes(src)` from offset 0 (llama-hybrid-commit.cpp:36-48). Then wholesale metadata: `dst.cells = src.cells; dst.head = src.head; dst.used = src.used; dst.rs_idx = src.rs_idx; dst.n = src.n; dst.rs_z = src.rs_z;`.
- Claimed source, llama-memory-recurrent.cpp:861-939 (state_write_data) and :1041-1115 (state_read_data): per-cell-range R rows (`range_size * r_size_row` at offset `range.first * r_size_row`) and S rows (contiguous, s_trans hardcoded 0), row size `ggml_row_size(type, n_embd_r()/n_embd_s())`.
- Comparison: SAME tensors (r_l/s_l per layer, both skip nulls — copy_tensor's `if (!src || !dst) return src == dst;`), SAME row semantics (one row per cell), SAME element sizes (row = n_embd_r()/n_embd_s() elements, f32). DIFFERENT extent: state-IO copies only the seq's cell ranges; copy_recurrent copies WHOLE tensors = ALL cells × ALL sequences × (1+n_rs_seq) rollback planes (tensor shape at llama-memory-recurrent.cpp:99-101 `n_rows = mem_size * (1 + n_rs_seq)`). So it is a whole-STATE copy: seq_id/p0/p1 are accepted and IGNORED for the recurrent half (signature carries them, copy_recurrent never sees them). It commits state for ALL sequences, not just seq_id. Fine for the governor (seq 0 only) but should be stated in the header.
- Overwrite semantics: dst tensors fully overwritten and dst metadata wholesale replaced → NO stale dst state survives. Internally consistent including rollback planes (rs_idx copied together with the planes it indexes).
- The code comment ("Mirrors ... :861-939 writes contiguous R/S rows; :1041-1115 restores those rows with the same ggml tensor offsets") is fair on tensors/rows/sizes but glosses the extent difference (ranges → whole state). PLAUSIBLE concern, not a defect: with mem_size=1 and n_rs_seq=0 (this run) they coincide.

### A2 finding — THE BYTES: 158629888 decomposes EXACTLY; recurrent whole-state is 99.65% of it
CONFIRMED, with a §5 red flag.
- Model (parsed from ~/kalsa-models/s23-backup-2026-08-27/q63_c1_preserved.gguf): arch qwen35, block_count 33, embedding 2560, kv_heads 4, key_length=value_length=256, ssm: conv_kernel 4, state_size 128, group_count 16, time_step_rank 32, inner_size 4096, full_attention_interval 4, nextn_predict_layers 1. KV cache types f16 (defaults), recurrent r/s f32 (llama-model.cpp:2145-2146 `GGML_TYPE_F32`).
- Attention: 8 full-attention layers (pattern is_recr_impl[i] = (i<33) && ((i+1)%4 != 0), src/models/qwen35.cpp:35-40 → attention at i=3,7,...,31). n_embd_k_gqa = n_embd_v_gqa = 4×256 = 1024 elems → 2048 B row each → 4096 B/token/layer → 32768 B/token.
- Recurrent: n_embd_r() = (4−1)×(4096 + 2×16×128) = 24576 elems; n_embd_s() = 128×4096 = 524288 elems (src/llama-hparams.cpp:204,221 — qwen35 does NOT set n_embd_head_kda (kimi-only) or n_shortconv_l_cache, so the default mamba branch applies). Per layer 24576+524288 = 548864 elems × 4 B.
- Committed tokens: turn 0 prompt P0=7 tokens (verified with llama-tokenize: `[32,2716,24197,6326,61911,9640,13]`), turn 1 prompt P1=6 (`[32,2018,24197,10125,2404,13]`), decode-side 4 positions between (k_generated=4: 3 greedy + 1 final). Commits: C1 (A→B, turn-0 prompt) = 7 tokens, C2 (B→A, turn-1 prefill) = 4 tokens, C3 (A→B) = 6 tokens → 17 attention tokens.
- Recurrent whole-state per commit: 24 layers × 548864 × 4 B = 52,690,944 B. Total: 3×52,690,944 + 17×32,768 = 158,072,832 + 557,056 = 158,629,888 ✓ EXACT (zero remainder; independently re-ran the test: `commits=3 bytes=158629888 us=13952`, exit 0).
- Uniqueness check: the 9-attention-layer alternative (dense-first pattern) yields 3R = 158,003,200 → R = 52,667,733.33, NON-integer → refuted. 8 attn + 24 recurrent non-null layers is the only clean fit. (25 trunk recurrent layers flagged, 24 non-null — PLAUSIBLE: one flagged layer gets null r/s in the child; silently tolerated by copy_tensor's null branch. Census detail unresolved; does not affect the closure.)
- §5 IMPLICATION: recurrent whole-state = 52,690,944 B per commit REGARDLESS of prefill length. Observed commit_us: 11,645 (user run) / 13,952 (my rerun) for 3 commits ≈ 3.9-4.6 ms/commit ≈ 11-13 GB/s memcpy. The plan budget commit_ms/prefill_ms < 2% is at risk for short prefills: a 7-token prefill on a 4.3B MOE does not take ~200 ms per handoff amortization — the commit cost is FIXED (O(total state)), not O(new tokens). And the plan's "shortconv is small" assumption is FALSE for this arch: the recurrent child is a gated-delta-net/mamba-2 state of 52.7 MB, not a small conv. Dirty-range logic can only shave the 0.35% attention sliver; the recurrent state is inherently whole-state per handoff. The §5 numbers need to be re-derived with 52.7 MB/commit as a floor.

### A3 finding — hybrid dispatch: dynamic_cast chain, iswa-in-hybrid cleanly rejected
CONFIRMED correct.
- Dispatch, src/llama-kv-commit.cpp get_cache(): `if (auto * cache = dynamic_cast<const llama_kv_cache *>(mem)) return cache; if (auto * hybrid = dynamic_cast<const llama_memory_hybrid *>(mem)) return hybrid->get_mem_attn(); return nullptr;` — plain cache first, hybrid unwrapped to its attention child. get_hybrid() mirrors it.
- iswa-in-hybrid: `class llama_memory_hybrid_iswa : public llama_memory_i` (src/llama-memory-hybrid-iswa.h:19) — does NOT derive from llama_memory_hybrid, so dynamic_cast to hybrid returns nullptr → both get_cache and get_hybrid return nullptr → "commit requires compatible KV caches" → Reject. No mishandled nested case. Additionally fenced at creation: src/llama-model.cpp:2117 `throw std::runtime_error("ctx_other is not supported for hybrid-SWA memory yet");`.
- Route guards: for hybrids, llama_kv_route_query checks BOTH `llama_kv_commit_access::compatible(*dst,*src)` on the unwrapped attention children (per-layer dims/types — the step-5 guard chain, unchanged) AND `llama_hybrid_memory_compatible(*dst_hybrid, *src_hybrid)` (recurrent child: per-layer tensor shapes/types/bytes + size/n_rs_seq/rs_idx match, llama-hybrid-commit.cpp:21-33). `(dst_hybrid == nullptr) != (src_hybrid == nullptr)` forces mixed pairs to Reject. Hybrid returns MirrorAndCopy unconditionally — correct, since attention children never alias K/V tensors (shared-cells case shares metadata only, tensors stay separate).
- The new shared_cells branch in mirror() (llama-kv-commit.cpp:174-193): when cells are shared (`dst.v_cells_impl == src.v_cells_impl && (dst.other == &src || ...)`, :42-46) it skips collision checks, cell metadata sync, and head update — correct, the metadata is one object. For the governor's independent-context hybrids shared_cells is false and the full step-5 path runs.

### A4 finding — llama-model.cpp un-throw: correct child, type-safe cast, clean throws
CONFIRMED.
- The blanket throw is removed from the hybrid branch (deleted: `if (params.mem_other) { throw std::runtime_error("ctx_other is not supported for this architecture yet"); }`) and replaced by: (a) hybrid-SWA still throws — src/llama-model.cpp:2117-2119: `if (params.mem_other) { throw std::runtime_error("ctx_other is not supported for hybrid-SWA memory yet"); }` before constructing llama_memory_hybrid_iswa; (b) plain hybrid passes `/* mem_other */ params.mem_other` (src/llama-model.cpp:2156) into the ctor, where src/llama-memory-hybrid.cpp:9-17 `hybrid_attention_other()` does `dynamic_cast<llama_memory_hybrid *>(mem_other)` and throws `"cannot share hybrid memory with an incompatible memory type"` on mismatch — type-safe, clean message, matching the step-2 iswa pattern; it forwards `other->get_mem_attn()` so attention shares with attention.
- Recurrent-only archs still throw — src/llama-model.cpp:2083-2085: `if (llm_arch_is_recurrent(arch)) { if (params.mem_other) { throw std::runtime_error("ctx_other is not supported for this architecture yet"); }` ✓ unchanged.
- Note: the governor itself does NOT pass ctx_other (llama-governor.cpp untouched in this delta) — the governor's two hybrid contexts are fully independent memories; cell-sharing exists only on the ctx_other construction path (exercised then destroyed by the test's owner/shared pair).

### A5 finding — fences: comprehensive on the shared side, not silent, one gap
CONFIRMED robust / one CONFIRMED gap.
- Fence definition, src/llama-memory-hybrid.cpp:83-89: `bool llama_memory_hybrid::shared_fence(const char * operation) const { if (!shared) return false; LLAMA_LOG_ERROR("%s: %s is not allowed from shared hybrid memory (recurrent state is owner-only)\n", __func__, operation); return true; }` — every hit LOGS an error, so nothing is silent (the step-2 landmine class is not reintroduced).
- Fenced: init_batch ("decode" → FAILED_PREPARE), init_update ("memory update"), clear, seq_rm (returns false), seq_cp, seq_keep, seq_add, seq_div, get_can_shift (`return !shared && mem_attn->get_can_shift();`), and state IO: state_write/state_read `throw std::runtime_error("state IO is not supported on a shared hybrid memory")`.
- GAP: init_full is NOT fenced — src/llama-memory-hybrid.cpp:155-157: `llama_memory_context_ptr llama_memory_hybrid::init_full() { return std::make_unique<llama_memory_hybrid_context>(this); }`. And it IS reachable on a shared hybrid: llama-context.cpp:556 calls `memory->init_full()` during context construction (graph reservation), :767 and :3762 likewise. Mitigation: the no-ubatch hybrid context is used only for graph reserve (no cache mutation observed on the reserve path), so PLAUSIBLE benign — but it is an inconsistency in the owner-only wall; a fence or a comment is warranted.

### A6 finding — test honesty: formula correct, lower bound is decorative, skip-77 matches, equality covers both turns
- Commit-count formula, tests/test-governor-v0-hybrid.cpp:148-150: `// Each multi-token turn has one A->B handoff; later turns add a B->A handoff.` `const uint64_t expected_commits = 2 * prompts.size() - 1;` — CONFIRMED correct: T prefill→decode switches + (T−1) decode→prefill switches = 2T−1 = 3 for T=2; matches commits=3.
- Bytes check, :152-153: `// Whole recurrent-state copies include model-specific padded tensors, so assert only a principled lower bound.` `const uint64_t min_commit_bytes = expected_commits * sizeof(float);` — REFUTED as principled: 12 bytes. It is >0 in disguise. A REAL bound is derivable from the in-scope model handle: recurrent layers × (hparams.n_embd_r() + hparams.n_embd_s()) × 4 B ≈ 52.7 MB per commit — the test has `model` right there. The comment's "padded tensors" point is real (the (1+n_rs_seq) plane factor and layer census are model-specific) but it justifies a weaker constant (e.g. one layer's r+s), not 12 bytes. CONFIRMED decorative.
- Skip-77: main() returns 77 when KALSA_HYBRID_GGUF is unset; tests/CMakeLists.txt:302 `set_tests_properties(test-governor-v0-hybrid PROPERTIES SKIP_RETURN_CODE 77)` — CONFIRMED matches the fixture convention (test-repack-q23k-load.cpp uses the same return-77 pattern).
- Token equality: governor vs baseline compared for the turn-0 prompt token AND all 3 greedy tokens per turn (the `next_g != next_b` checks at :120 and :137), i.e. both turns' sampled tokens (8 comparisons). The per-turn final decode is output=false (commit-only, :139-141) and intentionally unsampled — same fixture semantics as step 5. Because baseline is a single independent context, this equality IS the recurrent-handoff oracle: a broken r/s copy would desync generation and fail the test. CONFIRMED meaningful.

### A7 finding — sizes/hygiene
- File sizes: src/llama-hybrid-commit.cpp 85, src/llama-memory-hybrid.h 146, tests/test-governor-v0-hybrid.cpp 173 — fine. VIOLATIONS of the <250 convention: src/llama-kv-commit.cpp 289 and src/llama-memory-hybrid.cpp 333. Both grew past the line in this delta (kv-commit +87/−29). Suggest splitting the hybrid-commit accessors out rather than continuing to grow kv-commit.
- ext convention: CONFIRMED respected — no new public symbols in llama-ext.h; llama-hybrid-commit.h includes llama-ext.h and declares internal functions (llama_hybrid_memory_compatible, llama_hybrid_commit); llama_kv_commit_cache_range added to the internal llama-kv-commit.h. Byte accounting stays internal (size_t* out-param).
- Dead code: none found — llama_hybrid_memory_compatible used by route query, llama_kv_commit_cache_range used by both hybrid_commit and the plain path, shared_fence/get_hybrid/get_mem_recr all consumed. The stats fields (commit_bytes/us/count) unchanged from step 5 and all populated on the hybrid path (bytes accumulate the WHOLE-tensor recurrent copies + attention ranges, verified by the exact A2 closure).

## VERDICT

The recurrent whole-state copy is behaviorally correct (full overwrite, wholesale metadata, no stale state, null-tolerant) — a faithful but wider-extent variant of the claimed state-IO mirror. The bytes close EXACTLY: 3×52,690,944 recurrent + 17×32,768 attention = 158,629,888, and the exact fit uniquely pins 8 attention layers / 24 non-null recurrent layers. Dispatch, un-throw, and fences are correct and non-silent; the commit-count formula is right and the token-equality oracle genuinely exercises the handoff.

Real defects, none behavior-breaking: (1) min_commit_bytes = 12 B is decorative — a real lower bound is computable from the loaded model; (2) the recurrent whole-state copy is a FIXED ~52.7 MB/commit (99.65% of committed bytes), which invalidates the plan's "shortconv is small" assumption and puts the commit_ms/prefill_ms < 2% budget at risk for short prefills — §5 must be re-derived with this floor; (3) init_full is unfenced on shared hybrids (PLAUSIBLE benign, reserve-only); (4) two files exceed the 250-line convention.

APPLY — with the decorative bound upgraded to a derived bound and the §5 budget numbers recomputed before the 2% gate is relied upon.
