# Audit step 7 — staged KV commit path (kalsallama, kalsa/governor-v0, 479eae4a2..1bb3c24a0)

Skeleton (live document; appended per sub-check):

1. VIEW/STRIDE MATH — pending
2. GRAPH CACHE KEY — pending
3. CELL-METADATA CONSISTENCY — pending
4. ASYMMETRY HONESTY — pending
5. SELECTION/FALLBACK — pending
6. COUNTERS — pending
7. HYGIENE — pending

VERDICT: pending

---

## 1. VIEW/STRIDE MATH — CONFIRMED (correct), with layout-derivation note

Allocation (src/llama-kv-cache.cpp:231,255):
```cpp
const uint32_t n_embd_v_gqa = !v_trans ? hparams.n_embd_v_gqa(il) : hparams.n_embd_v_gqa_max();
...
ggml_tensor * v = has_v ? ggml_new_tensor_3d(ctx, type_v, n_embd_v_gqa, kv_size, n_stream) : nullptr;
```
i.e. base V is `{n_embd_v_gqa_max, kv_size, n_stream}` regardless of v_trans. Its *logical* shape would imply emb-fastest layout — but under v_trans EVERY consumer bypasses logical shape and uses raw offsets:
- write: `cpy_v` reshapes cache to `{1, n_elements}` and `set_input_v_idxs` (llama-kv-cache.cpp:1552) writes `idx = offs + j*kv_size + sinfo.idxs[s][i]` with `offs = s*kv_size*n_embd_v_gqa_max` → flat `[cell + j*kv_size + s*kv_size*E_max]` (cell-contiguous, emb strided by kv_size).
- read (attention): v_trans 4d view (llama-kv-cache.cpp:1343-1348): `nb2 = ggml_row_size(v->type, kv_size)` (emb stride), dim0 = n_kv at element stride (cell-contiguous).
- naive commit (llama-kv-commit.cpp:180): `offset = (range.first + j * kv_size) * v_size_el` — same.
- state_write_data (llama-kv-cache.cpp:2228-2243): same, which copy_data's comment (llama-kv-commit.cpp:110-112) cites verbatim.

Staged view (src/llama-kv-staged.cpp:62-63):
```cpp
ggml_tensor * src_view = ggml_view_2d(ctx.get(), const_cast<ggml_tensor *>(src_v), count, n_embd_v,
                                      kv_size * element_size, first * element_size);
```
ne0=count (cells [p0,p1), element stride), ne1=n_embd_v (per-layer `hparams.n_embd_v_gqa(il)`, staged.cpp:122 — correct under GQA padding, matches naive j<n_embd_v_gqa loop), nb1=kv_size*element_size (emb stride), offset=first*element_size. `kv_size = src.v_cells[src_stream].size()` (staged.cpp:121) == `get_size()` == allocated kv_size (cells resized once at init, llama-kv-cache.cpp:162-164; never grown) — stride equals allocated row width. CONFIRMED.

Staging target (staged.cpp:64): `ggml_new_tensor_2d(ctx.get(), src_v->type, count, n_embd_v)` → contiguous, nb1=count*element_size; ggml_cpy strided-view→contiguous (staged.cpp:65). One `ggml_backend_tensor_get(staged->staging, scratch.data(), 0, scratch.size())` (staged.cpp:144) with size = `ggml_nbytes(staging)` = count × n_embd_v × element_size — exactly the hparams formula. CONFIRMED.

Stream plane offset is baked into `v_stream` view creation (llama-kv-cache.cpp:265: `s*v->nb[2]` = s*E_max*kv_size*el), and staged/dst offsets are relative to those data pointers — consistent on both sides. dst stride/type validated by `compatible()` (llama-kv-commit.cpp:13-14: `dst.get_size() != src.get_size()`, `cache_type_v != src.cache_type_v` → reject). CONFIRMED.

Minor note (no action): for variable-GQA models with FA off, the staged view can claim bytes beyond `ggml_nbytes(src_v)` (parent view) though still inside the base buffer; ggml doesn't bounds-check views and naive has the same property. Cosmetic.

## 2. GRAPH CACHE KEY — key includes p0 (hypothesis REFUTED); UNBOUNDED CACHE CONFIRMED (finding)

Key (src/llama-kv-staged.h:13-22):
```cpp
struct llama_kv_staged_key {
    uint32_t layer; uint32_t stream; uint32_t first; uint32_t count;
```
`first` (p0) IS in the key; same-length different-p0 cannot collide. The "silently wrong data" scenario is REFUTED.

However: `plan.graphs` is a plain `std::map` (llama-kv-staged.h:33), each entry owns a ggml context AND a real backend buffer (`ggml_backend_alloc_ctx_tensors_from_buft`, staged.cpp:69) of count×n_embd_v×el bytes on the SOURCE device, plus `it->second.backend` pinned. No eviction, no cap, no clearing found anywhere. An incremental conversation (each commit advances p0 → new first → new key per layer per commit) grows device memory O(commits × layers × range bytes) for the life of the src cache (`mutable std::unique_ptr<llama_kv_staged_plan> staged_plan;`, llama-kv-cache.h:301). The 6-graph benchmark reused a fixed range so it never exercised this. Storing a graph per (p0,count) to save one view+cpy build is a bad trade — the graph is 3 nodes and the buffer is the expensive part. This is the audit's FINDING #1 (FIX-FIRST candidate: bound/evict the cache, or key graphs on (layer,stream,count) and rebuild the view cheaply, or clear per commit).

## 3. CELL-METADATA CONSISTENCY — CONFIRMED (same scan)

Call path (src/llama-kv-commit.cpp:195-197, 217-224):
```cpp
if (!collect_ranges(src, seq_id, p0, p1, ranges)) { return false; }
...
const bool staged_v = mode == llama_kv_commit_mode::Staged && src.v_trans;
if (!copy_data(dst, src, dst_stream, src_stream, ranges, copied_bytes, !staged_v, stats)) { return false; }
if (staged_v && !llama_kv_copy_v_staged(dst, src, src_sched, src_stream, dst_stream, ranges, copied_bytes, stats)) { return false; }
```
`collect_ranges` (llama-kv-commit.cpp:60-83) scans `cells` with `cells.is_empty(i) && cells.seq_has(i, seq_id) && cells.pos_in(i, p0, p1)` and emits DISJOINT contiguous runs (holes split ranges). The identical `ranges` vector feeds naive K, (naive V) and staged V. No `[p0,p1)`-contiguity assumption anywhere in the staged path (`first`/`count` come per-range, staged.cpp:124-125). Fragmented-cache case handled. CONFIRMED.

## 4. ASYMMETRY HONESTY — CONFIRMED (get-side only), one over-promise

- Get side: staged collapses n_embd_v tensor_gets → 1 per layer×range (staged.cpp:143-144). Set side REMAINS per-row: n_embd_v `ggml_backend_tensor_set` calls (staged.cpp:147), and the counters admit it (`v_sets_staged`, staged.cpp:151 — counted per row). K is untouched by staging (still naive, commit.cpp:218 passes `!staged_v` as copy_v).
- Naming: `llama_kv_copy_v_staged` is honest (V, staged). `llama_kv_commit_mode::Staged` slightly over-promises (only transposed-V get is staged; v_gets_staged==transfers of one get each). No API surface claims both sides staged. Hybrid recurrent side (`copy_recurrent`) never staged — fine, it's CPU/host state.

## 5. SELECTION/FALLBACK — CONFIRMED loud; default naive CONFIRMED; two reservations

- Switch: opt-in only — `mode == llama_kv_commit_mode::Staged && src.v_trans` (llama-kv-commit.cpp:217). Default: `llama_kv_commit()` passes `llama_kv_commit_mode::Naive` (commit.cpp:350-353); `llama_kv_commit_ex` requires explicit mode. CONFIRMED naive default.
- Failure path: staged.cpp returns nullptr/false with LLAMA_LOG_ERROR on: backend unavailable (staged.cpp:46-49), ggml context alloc (57-60), buffer alloc (70-73), non-element-addressable V type (115-118), graph execution failure (132-134). `mirror()` then returns false → whole commit FAILS. LOUD — no silent fallback to naive V. CONFIRMED.
- Reservation A: mid-commit failure leaves dst with K fully copied + V partially copied while dst cell metadata is NOT updated (mirror returns at commit.cpp:222-224 before the metadata write at 225-241). State is retry-safe (writes are idempotent, pre-validated non-colliding at commit.cpp:205-215) but inconsistent until a retry succeeds. Acceptable for a step-7 governor; worth a comment.
- Reservation B: `staged->backend` is resolved via `ggml_backend_sched_get_tensor_backend` + device/buft heuristics (staged.cpp:26-45) and then driven with bare `ggml_backend_graph_compute` (staged.cpp:132), BYPASSING the sched. Fine after `llama_synchronize(src_ctx)` (commit.cpp:330), but any future caller that drives commit while src has queued work races the device. PLAUSIBLE hazard, not a bug in the current path.
- Thread-safety note: `staged_plan` is mutated through a const ref (`src.staged_plan = std::make_unique<...>`, staged.cpp:97-99) — two concurrent commits from the same src context would race the map. PLAUSIBLE (llama's single-thread-per-ctx convention makes this theoretical today).

## 6. COUNTERS — CONFIRMED consistent with the runs; no commit_bytes double count

- `transfers_naive` / `v_gets_naive` / `v_sets_naive`: copy_tensor (llama-kv-commit.cpp:94-95, 99-100), one get + one set per naive transfer. 1728 = 6 layers × 288 (n_embd_v_gqa, stories15M) ✓.
- `transfers_staged` / `v_gets_staged`: staged.cpp:140-141 (1 get per layer×range) → stories15M: 6; lfm2: 8 KV layers × 1 range ✓. `v_sets_staged`: per-row (staged.cpp:150-151) — honest about the asymmetry. `staged_graph_builds`: staged.cpp:137-139, incremented only when the key misses → 6 and 8 ✓.
- Cross-validation is itself TESTED: test-governor-v0-commit.cpp asserts `naive_stats.v_gets_naive == route_cost.v_naive_gets`, `staged_stats.v_gets_staged == route_cost.v_staged_gets`, `staged_stats.staged_graph_builds == route_cost.v_layers`, and graph reuse (`reuse_stats.staged_graph_builds != 0` → fail). route_cost (llama-kv-commit.cpp:48-59) is an independent model of the same counts. CONFIRMED.
- commit_bytes: staged mode passes `copy_v = !staged_v` (commit.cpp:218), so naive V byte accounting is skipped; staged adds `count*element_size` once per row (staged.cpp:153-155) = count×n_embd_v×el per layer×range. Each V byte counted exactly once. K bytes counted once via copy_tensor (commit.cpp:102). lfm2 exact 1392640 plausible (16·count·(E_k+E_v) over 8 KV layers, f16); no double-count path exists. CONFIRMED.
- Only wart: transfers_staged mixes gets and sets (get + n_embd_v sets per layer×range) — documented in ext.h as "Actual tensor_get/set counts for one commit", so acceptable.

## 7. HYGIENE — mostly clean; one pre-existing file-size violation

- llama-kv-staged.h (65 lines): key struct + 3-line comparator, two value structs (RAII holders, no dtor logic), a static-access struct with declarations only, one free-function decl. No templates, no inline implementation, nothing constructed by nobody. Clean. CONFIRMED.
- llama-kv-cache.h +8: fwd decls + `mutable std::unique_ptr<llama_kv_staged_plan> staged_plan;` + friend. Coupling of the core cache header to the staged path is the price of the lazy per-cache plan; the mutable-on-const-src pattern it enables is the thread-safety reservation from §5.
- llama-kv-cache.cpp +3: out-of-line dtor (`~llama_kv_cache() = default;` moved to .cpp) — REQUIRED for the incomplete-type unique_ptr; plus the include. Correct, minimal. CONFIRMED.
- llama-hybrid-commit.cpp +6/−1 (+ .h +3): pure plumb-through of (mode, src_sched, stats) — no behavior change. CONFIRMED.
- llama-ext.h +37: route_cost, commit mode enum, commit stats, commit_ex — all documented comments, ext-convention respected (public surface in ext.h, staged internals stay in internal headers). CONFIRMED.
- File sizes: new files 172/65 (<250 ✓); tests +81/+30 fine. BUT llama-kv-commit.cpp is now 353 lines (263 pre-existing + 90) — it already violated the <250 discipline before this delta and the delta deepens it. Pre-existing, flag only.

## FINDINGS SUMMARY

1. CONFIRMED defect — unbounded staged-graph cache: one ggml context + one DEVICE staging buffer per (layer, stream, first, count) key, never evicted, never cleared (no reference to staged_plan in llama-kv-cache.cpp; grep exit 1). Incremental commits advance p0 → new keys every commit → device memory growth O(commits × layers × range_bytes) for the life of the source context. The 6-graph benchmark reused a fixed p0 and cannot see this.
2. CONFIRMED wart — mid-commit staged failure leaves dst with partial data and stale cell metadata (retry-safe, no corruption; commit.cpp:222-224). No comment marks this.
3. PLAUSIBLE hazard — bypassing the sched with ggml_backend_graph_compute on a heuristically-resolved backend (staged.cpp:26-45,132); safe only because commit synchronizes both contexts first (commit.cpp:330-331). Also PLAUSIBLE: data race on mutable staged_plan via const src if two threads ever commit from one src.
4. Cosmetic — sub-range staged test accumulates 3 range graphs in ctx_sub, quietly demoing finding #1; variable-GQA staged view can exceed parent-view nbytes (still inside base buffer).

## VERDICT

View/stride math CONFIRMED correct (derived from cpy_v/set_input_v_idxs raw-addressing invariants and corroborated by the 7/7 run), cache key correctly includes p0, ranges/cells scan shared with naive, counters exact and test-cross-validated, opt-in loud, hygiene clean. But the staged path leaks device memory in precisely its target scenario (long-running governor committing advancing p0 ranges), which the fixed-range benchmarks structurally cannot detect. One narrow fix (bound or clear the plan) unblocks it.

VERDICT: FIX-FIRST
