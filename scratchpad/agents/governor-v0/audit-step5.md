# Hostile audit — governor-v0 numeric instrumentation (delta 8e5de77da..7349b4b3e)

Auditor: step-5 hostile review, numeric instrumentation focus.
Target: ~/Projects/kalsallama, branch kalsa/governor-v0, +170/−25 over 6 files.
Verified run of record: 6/6 ctest PASS; prefill_reused=10 decode_reused=18 prefill_splits=1 decode_splits=1 graph_builds=1/1 commits=3 bytes=269568 us=84 expected_bytes=269568.

## Angle 1 — TAUTOLOGY (commit_bytes vs expected_bytes)
(findings appended below)

## Angle 2 — n_reused semantics
(findings appended below)

## Angle 3 — splits constant-1 vacuity
(findings appended below)

## Angle 4 — commit_us clock and scope
(findings appended below)

## Angle 5 — graph_builds "1/1"
(findings appended below)

## Angle 6 — Surface / API hygiene
(findings appended below)

## Angle 7 — the −25 lines in llama-kv-commit.cpp
(findings appended below)

## VERDICT
(pending)

### A7 finding — diff of src/llama-kv-commit.cpp (35 changed lines)
CONFIRMED: pure instrumentation threading, no behavior change. Evidence:
- `copy_tensor(..., std::vector<uint8_t> & scratch)` → `(..., size_t * copied_bytes)`; only addition is `if (copied_bytes) *copied_bytes += size;` after the two tensor copies.
- `copy_data` / `mirror` gain the same out-param and pass it through; K path accumulates `range_size * k_size_row`, V contiguous path `range_size * v_size_row`, V transposed path `range_size * v_size_el`.
- Public `llama_kv_commit` reduced to a wrapper: `return llama_kv_commit_with_stats(dst_ctx, src_ctx, seq_id, p0, p1, nullptr);` — nullptr stats, identical control flow.
- Remaining diff hunks are blank-line deletions (cosmetic) inside `copy_data`, `mirror`, around `get_cache`/`llama_kv_route_query`. One nit: the blank-line removals make the diff look bigger than it is; −25 stat counts them. No semantic change found.

### A1 finding — commit_bytes vs expected_bytes: semi-circular, near-tautological
CONFIRMED (near-circular; re-derivation, not independent verification).

Both sides use the SAME row-size arithmetic:
- Test, tests/test-governor-v0-turns.cpp:81-93: `bytes += ggml_row_size(cache->type_k(), hparams.n_embd_k_gqa(il));` and non-FA V: `n_v * ggml_type_size(cache->type_v())` per layer.
- Accumulator, src/llama-kv-commit.cpp:96: `const size_t k_size_row = ggml_row_size(src_k->type, src.hparams.n_embd_k_gqa(src_layer.il));`, :116 V contiguous: `ggml_row_size(src_v->type, src.hparams.n_embd_v_gqa(src_layer.il))`, :147-150 V transposed: `range_size * v_size_el` summed over n_embd_v_gqa (same total).

expected_bytes is computed IN THE TEST from hparams + cache tensor types (not read from the counter), so it is a re-derivation of the same formula, not literal circularity. It can catch: wrong committed-token count vs actual copied ranges, a commit loop that didn't run, f16/quantized-type divergence between the two formula copies. It CANNOT catch: a wrong row-size formula shared by both sides, or a systematically wrong bytes-per-token model.

First-principles reproduction of 269568:
- GGUF metadata verified from build/tinyllamas/stories15M-q4_0.gguf: `llama.embedding_length = 288`, `llama.attention.head_count = 6`, `llama.block_count = 6` (stories15M has n_kv_heads = n_heads → n_embd_k_gqa = n_embd_v_gqa = 288).
- Cache types default F16 (src/llama-context.cpp:3444-3445 `/*.type_k =*/ GGML_TYPE_F16, /*.type_v =*/ GGML_TYPE_F16`); flash_attn default DISABLED (test doesn't set flash_attn_type) → non-FA V path.
- Per token per layer: K 288×2 = 576 B + V 288×2 = 576 B = 1152 B; ×6 layers = 6912 B/token.
- llama-tokenize confirms the prompt is 13 tokens incl. BOS: `[1, 319, 1472, 20221, 9508, 338, 6219, 964, 2319, 9128, 9853, 267, 29889]`.
- committed_tokens = 2×L + 13 (test:212 `const size_t committed_tokens = 2 * long_prompt.size() + 13;`) = 2×13+13 = 39.
- 39 × 6912 = 269,568 ✓ exact.

Commit-flow hand-count validating "2L+13": commit fires only on phase switches. C1 turn-0 Prefill→Decode: prefill positions 0..12 = 13 tokens. C2 turn-2 Decode→Prefill: decode-side positions 13..25 = 13 tokens (turn-0's 6 decode positions + turn-1's 1-token prompt + 6 decode positions). C3 turn-2 Prefill→Decode: prefill positions 26..38 = 13 tokens. Total 39 = 3 commits × 13 ✓ (commits=3 in run ✓).

Latent fragility: the test's non-FA V formula `n_v * ggml_type_size(type_v)` equals `ggml_row_size(type_v, n_v)` only for un-padded types (f16). With a quantized KV cache, row_size rounds to block granularity and the two copies of the formula diverge → spurious test failure. Harmless today (F16 hardcoded default), worth a comment.

### A2 finding — n_reused counts UBATCHES, not calls; both reported numbers reproduce
CONFIRMED.
- Increment site, src/llama-context.cpp:1296: inside the per-ubatch graph path, `n_reused++;` when `res->can_reuse(gparams)` succeeds (:1284-1296). `gparams` includes the ubatch (src/llama-context.cpp:2369-2384 `/*.ubatch =*/ ubatch`) and n_outputs → a shape change forces a rebuild.
- Governor read, src/llama-governor.cpp record_side: `const uint64_t reused = static_cast<uint64_t>(ctx->perf_get_data().n_reused);` — a CUMULATIVE snapshot taken after each llama_decode, published as `stats_.decode_n_reused = side.n_reused;` etc.

decode_reused=18 reproduces: decode context receives 3×6 (5 greedy + 1 final per turn) + 1 (turn-1 single-token prompt) = 19 single-ubatch calls; the first builds (fresh graph), the other 18 each reuse → snapshot 18 = calls − 1 ✓. The test assert (test:211) `stats.decode_n_reused != static_cast<uint64_t>(decode_calls - 1)` passes — but note it compares llama's UBATCH-reuse counter against the test's own CALL count; valid only because every decode call is exactly 1 ubatch here (n_ubatch=2, but decode batches are 1 token). With any multi-token decode this assert is wrong by construction.

prefill_reused=10 reproduces as ubatch count: 2 prefill calls × 7 ubatches (13 tokens / n_ubatch 2 → six 2-token + one 1-token ubatch) = 14 ubatches; per call: ubatch 0 builds, ubatches 1-5 reuse (same 2-token shape), the shape-1 last ubatch forces a rebuild (gparams embeds the ubatch) → 5 reuses/call, 2 calls → 10 ✓. It does NOT count calls (there are only 2 prefill calls). The field name `prefill_n_reused` mirrors llama's semantics (ubatches), but the test's assertion style invites the calls-reading.

### A3 finding — splits: constant-1 makes the constancy assert vacuous TODAY, undocumented
CONFIRMED vacuous + CONFIRMED undocumented.
- Read site, src/llama-governor.cpp record_side: `side.n_splits = ggml_backend_sched_get_n_splits(ctx->get_sched());` — the last computed graph's split count, snapshotted after each decode.
- Test, tests/test-governor-v0-turns.cpp:69-77 record_split(): only asserts the value never CHANGES within a phase (`if (expected < 0) expected = current; return current == expected;`).
- Test context is CPU-only by construction (test:40 `params.n_gpu_layers = 0;`) → single backend → splits cannot vary; observed constant 1 on both sides carries no information.
- Searched llama-ext.h, the test file, and the diff: NOT A WORD about the CPU-only vacuity or that this assert only becomes meaningful with CPU+GPU backends. The ext.h comment covers only graph-build counts. For a "step 8 = GPU" roadmap this must be documented or the assert will keep passing while measuring nothing.

### A4 finding — commit_us: monotonic wall clock, wraps the inner commit only, accumulated over 3 commits
CONFIRMED, honest with two nits.
- Clock: `const int64_t t0 = ggml_time_us();` … `stats_.commit_us += ggml_time_us() - t0;` (src/llama-governor.cpp commit_side) — ggml wall-clock microseconds, accumulated with += across commits (3 commits → 84 µs total in the run).
- Wrapped region: exactly `llama_kv_commit_with_stats(...)` — which internally re-runs llama_kv_route_query, then 2× llama_synchronize, then the tensor copies. EXCLUDED: the governor's own earlier llama_kv_route_query and sequence_end() query. So the route decision is timed OUTSIDE the stat (the internal duplicate query is timed inside — a double route query per commit, harmless on CPU, real overhead on GPU).
- Nit: the test asserts `stats.commit_us == 0` fails (test:214) — a wall-clock assert in a CI test is a flake vector on pathological machines; with 3 × ~90 KB copies plus 2 syncs the sum will not realistically be 0 µs. Acceptable.

### A5 finding — graph_builds "1/1" is a misleading label on an undercounting derivation
CONFIRMED misleading (but partially disclosed).
- Derivation, src/llama-governor.cpp record_side: `if (side.calls == 0 || reused == side.n_reused) { ++side.graph_builds; }` — counts a "build" only when a call produced ZERO new ubatch reuses, and unconditionally counts the first call on each side.
- Actual builds in this run: decode side 1 (first call) ✓ correct. Prefill side: 14 ubatches − 10 reuses = 4 actual graph builds (2 per prefill call: initial 2-token ubatch + shape-1 last ubatch, per A2), but reported prefill_graph_builds=1. Undercount 4→1 because turn-0's call had 5 reuses (delta ≠ 0 → never counted) and only the unconditional first-call branch fired.
- Disclosure: llama-ext.h comment says "Graph-build counts are governor-observed submissions that did not reuse the preceding graph; llama has no public graph-build timer." That is a truthful semantics statement — but the field name `prefill_graph_builds` and the test's printed `graph_builds=1/1` invite the "number of graph builds" reading, which is false by 4× on the very first run. Nothing consumes this today besides the test printf; it becomes load-bearing at step 8 (GPU), where per-call build+reuse mixes are far more common and the delta heuristic will systematically miss builds. Rename (e.g. `n_no_reuse_submissions`) or document the undercount in the header before any consumer exists.

### A6 finding — surface hygiene
CONFIRMED acceptable.
- llama_governor_stats (src/llama-ext.h:141-151): plain aggregate with NSDMIs, trivially copyable, `llama_governor_get_stats` copies by value, null governor → zeroed stats (`*stats = governor ? governor->stats() : llama_governor_stats{};`), null stats pointer tolerated. Consistent with the ext.h style; llama-ext.h has no extern "C" convention to violate (C++-only header, grep confirms none).
- llama-kv-commit.h +5: adds the internal `llama_kv_commit_with_stats(..., size_t * copied_bytes)` declaration to an INTERNAL header, correctly NOT exported into llama-ext.h — the public API only gains the stats struct + getter. The commit_bytes figure itself is now public data, which is the stated purpose; no leak of the internal out-param.
- Nothing dead: every new stats field is written by record_side/commit_side and read by the test; side_state's generation field was removed and its sole consumer (dst.generation = src.generation) was correctly dropped — note that deletion also removes the last_phase/commit interaction change in commit_side (it no longer stamps generations), verified behavior-neutral because generation had no readers after the previous step's removal of its checks... PLAUSIBLE (generation had no readers left; CONFIRMED: in the pre-image (git show 8e5de77da:src/llama-governor.cpp) `generation` appears only at :66 (write) and :105 (increment) — never read. Dead-state removal, behavior-neutral.

## VERDICT

Numbers all close exactly: 269568 = 39 tokens × 6912 B/token (6 layers × 2 × 288 × 2 B, f16, non-FA), committed = 13+13+13 across the 3 phase-switch commits; prefill_reused=10 and decode_reused=18 both reproduce from source semantics (ubatch-level counting). The kv-commit delta is a confirmed pure instrumentation refactor; the removed `generation` field was write-only dead state.

The one real defect: `graph_builds=1/1` undercounts (actual prefill builds = 4, not 1) because the delta heuristic (`reused == side.n_reused`) only fires on zero-reuse calls plus an unconditional first-call bump. It is disclosed in the ext.h comment but contradicted by the field name and the test's printout. Second defect: the splits constancy assert is vacuous on CPU-only and its vacuity is documented nowhere. Third: the decode_reused == decode_calls−1 assertion is only valid because every decode call is exactly one ubatch — an accident of the fixture.

All three are semantic/labeling defects in newly exposed stats that nothing yet consumes; none affects the refactor's behavior, the 6/6 pass, or the other counters.

APPLY — with the graph_builds naming/semantics and the splits-vacuity note fixed before step 8 (GPU), where both become load-bearing.
