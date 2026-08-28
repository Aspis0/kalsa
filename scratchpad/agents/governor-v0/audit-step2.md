# Audit — governor-v0 step 2 (generalize shared KV cells)

- Delta audited: 409ef5ef3..ee10d3421, branch kalsa/governor-v0, repo ~/Projects/kalsallama
- Date: 2026-08-28
- Scope: +218/−27 over 7 files: src/llama-kv-cache.{cpp,h}, src/llama-kv-cache-iswa.cpp, src/llama-context.cpp, src/llama-model.cpp, tests/CMakeLists.txt, new tests/test-governor-v0-shared-cells.cpp (160 lines)
- Plan context: PLAN.md §3 step 2 (same scratchpad dir). Audit items flagged by plan: v_heads (~kv-cache.cpp:1093), find_slot (~:894), invariantes single-owner nascoste (defrag, SWA pruning, seq_rm dal lato sbagliato).
- Rules: READ-ONLY on code; this file is the only writable artifact. Every claim quotes file:line + exact text.

## Angles checklist
1. Hidden single-owner invariants: v_heads + find_slot under interleaved A/B decodes; apply_ubatch/rollback
2. Fence completeness: missed ops among seq_cp, seq_keep, seq_div, SWA pruning, state_read into shared cache, clear()
3. Guard completeness at share-accept: n_pad, offload/buft mismatch, hybrid memory (LFM2) acceptance
4. iswa 12-line change: why touched; SWA regression risk on unshared path
5. GEMMA4 path preserved: aliasing branch still taken for GEMMA4_ASSISTANT
6. Test quality: negative test reaches the new guard; shared_cells_next_slot ground truth; A/B interleaving
7. Unshared-path regression when ctx_other is null
8. RIUSO-PRIMA: extension of GEMMA4 plumbing vs parallel mechanism

## Findings

(working — one angle at a time, appended below)

## Angle 1 — Hidden single-owner invariants (v_heads, find_slot, apply_ubatch)

- **CONFIRMED: find_slot reads the OWNER's heads on the non-owner.** src/llama-kv-cache.cpp:919 (new): `const auto & heads = other ? other->v_heads : v_heads;`, consumed at :928 `const uint32_t head_cur = heads[stream_id];` (debug) and :1022 `uint32_t head_cur = heads[seq_to_stream[seq_id]];`. Combined with shared cells (`v_cells_impl(other ? other->v_cells_impl : ...)` :83), B's slot search continues exactly where A left off. This is the plan's step-2 deliverable and it works for the probe.
- **CONFIRMED: apply_ubatch is a SILENT NO-OP on the non-owner** — src/llama-kv-cache.cpp:1119-1122 (UNCHANGED by the delta): `void llama_kv_cache::apply_ubatch(...) { // TODO: refactor [TAG_KV_CACHE_SHARE_CELLS]` / `if (other) {` / `return;` / `}`. This function is where cells get marked (pos/seq) and where the head advances — tail at :1190-1193: `auto & head = v_heads[sinfo.strm[s]];` / `head = sinfo.idxs[s].back() + 1;`, and where SWA purge runs (:1185-1187 `seq_rm(s, cells.seq_pos_min(s), seq_pos_max_rm[s] + 1);`).
- **CONFIRMED LANDMINE (the big one): a non-owner decode is metadata-invisible.** B can run llama_decode: init/prepare → find_slot (works, reads owner heads) → graph build → compute writes K/V into **B's own tensors** (share==nullptr ⇒ no aliasing) at cells the SHARED metadata still considers FREE; apply_ubatch no-ops so no cell is ever marked and B's v_heads stay 0 forever. The next find_slot — by A or by B — hands out the SAME cells again → silent KV collision. Pre-delta this no-op was safe because GEMMA4's non-owner was a read-only consumer of ALIASED tensors; the delta generalizes sharing to non-aliased caches (share==nullptr path, model.cpp:2243/2264) without fencing or fixing the write path. The plan's own step-1 harness decodes in B; the governor (step 3+) needs B to decode after commit. Nothing in step 2 fences or supports this — it fails silently later.
- **CONFIRMED: prepare() rollback writes into shared state.** prepare() (:767) is a dry-run: :796 `state_t state = { sinfo_new, v_heads, {} };`, :808 `apply_ubatch(sinfo_new, ubatch);`, then an UNCONDITIONAL restore loop :815-824 including :819 `auto & head  = v_heads[sinfo.strm[s]];` and `cells.set(sinfo.idxs[s], it->v_cells[s]);`. For B: apply no-opped so the cell writes are value-neutral (writes back identical old copies into the SHARED impl), and head restore writes B's own (always-0) heads. Benign today ONLY because of the no-op — a hidden coupling worth an assert.
- **PLAUSIBLE: v_heads staleness between owner and non-owner is only benign-by-accident.** B's heads stay 0 (no-op apply); correctness relies entirely on shared cells occupancy, with owner heads used as search start. Any future op that trusts a cache's own heads on a shared cache breaks. No assert documents "non-owner heads are meaningless".
- **state_read_meta :2229 grep hit explained:** the `v_heads[strm]` at :2228-2229 belongs to `llama_kv_cache::state_read_meta` (`auto & cells = v_cells[strm]; auto & head  = v_heads[strm];`), i.e. the state-RESTORE path's head update — not a decode-side owner-head write. Unreachable from a shared non-owner only because state_read itself no-ops (see angle 2).

## Angle 2 — Fence completeness (THE MISSED OPERATION)

Fenced by the delta (claims check out):
- **CONFIRMED seq_rm fails**: :394-398 `bool llama_kv_cache::seq_rm(...) { // TODO: refactor [TAG_KV_CACHE_SHARE_CELLS]` / `if (other) {` / `LLAMA_LOG_ERROR("%s: sequence removal is not allowed from a shared KV cache\n", __func__);` / `return false;` (was silent `return true` pre-delta).
- **CONFIRMED seq-shift aborts**: :582-585 seq_add → `GGML_ABORT("sequence shifting is not allowed from a shared KV cache");`.
- **CONFIRMED K-shift/update refused**: init_update :759-762 `if (other && (do_shift || !sc_info.empty())) { LLAMA_LOG_ERROR("%s: memory update is not allowed from a shared KV cache\n", __func__); return std::make_unique<llama_kv_cache_context>(LLAMA_MEMORY_STATUS_FAILED_PREPARE); }`; update() :835-839 re-checks (`if (other) { if (do_shift || !sc_info.empty()) { ... return false; } return true; }`). build_graph_shift :1935-1937 `GGML_ASSERT(!other);` belt-and-suspenders.

CONFIRMED UNFENCED / silently-broken (the misses):
- **CONFIRMED MISS #1 — clear() wipes the OWNER's cells with no fence.** :382-391 `void llama_kv_cache::clear(bool data) {` / `for (uint32_t s = 0; s < n_stream; ++s) {` / `v_cells[s].reset();` / `v_heads[s] = 0;` — on a non-owner, v_cells IS the owner's impl, so B.clear() erases A's KV and zeroes B's heads while A's heads stay stale (inconsistent pair). No `if (other)` at all, no TAG comment even. Reachable via llama_clear_kv_cache / context reset paths. This is the operation they missed.
- **CONFIRMED MISS #2 — seq_cp silent no-op**: :463-467 `void llama_kv_cache::seq_cp(...) { ... if (other) { return; } }` — caller believes the copy happened.
- **CONFIRMED MISS #3 — seq_keep silent no-op**: :555-559 `if (other) { return; }`.
- **CONFIRMED MISS #4 — seq_div silent no-op**: :632-636 `if (other) { return; }`.
- **CONFIRMED MISS #5 — state_write silent no-op**: :1983-1987 `void llama_kv_cache::state_write(...) { ... if (other) { return; } }` — a state SAVE from B produces an EMPTY state with no error; the step-1 handoff pattern via llama_state_seq_get_data on B would silently yield nothing.
- **CONFIRMED MISS #6 — state_read silent no-op**: :2053-2057 `if (other) { return; }` — a state LOAD into B silently does nothing (including the head/cell updates of state_read_meta :2228+).
- Note the inconsistency: seq_rm fails loudly, seq_add aborts, but seq_cp/seq_keep/seq_div/state_* are silent no-ops and clear is a silent WIPE. Four different failure modes for the same class of "non-owner touches shared state" bugs.

## Angle 3 — Guard completeness at share-accept

- **CONFIRMED: claimed guards exist in the ctor** (delta): kv_size (`throw std::runtime_error("cannot share KV cells with a different kv_size")`), type_k/type_v (`"...different K/V types"`), n_seq_max/n_stream (`"...different sequence capacity"`), n_pad/n_swa/swa_type/v_trans (`"...incompatible cache layout"`), n_layer_all (`"...different layer count"`), plus type-safe dispatch (`other(dynamic_cast<llama_kv_cache *>(mem_other))` + `throw std::runtime_error("cannot share KV cells with an incompatible memory type")`). n_pad IS covered — brief's hypothesis refuted.
- **CONFIRMED behavior change vs GEMMA4 era: kv_size mismatch went WARN+override → throw.** Old ctor (git show 409ef5ef3): `LLAMA_LOG_WARN("%s: kv_size = %u overridden to %u to match the shared source cache\n", ...); kv_size = size_other;` with comment "a fitted target can be smaller than the draft default". New: hard throw. **PLAUSIBLE regression:** if the GEMMA4_ASSISTANT fit/draft flow ever produced mismatched kv_sizes (the old comment says it could!), sharing now hard-fails at context creation — possibly inside memory fitting where exceptions are only partially expected (cf. "this warning is normal during memory fitting" comment in llama-context.cpp:121-122).
- **CONFIRMED missing guard: backend/buft mismatch.** Nothing checks that owner and non-owner K/V tensors live on compatible buffers (CPU vs GPU, offload_kqv on/off). Silent acceptance; for the governor this is eventually intended (cross-buft commit), but nothing documents/asserts it — and with cells shared, a buft mismatch also changes nothing at step 2 while making step-3 semantics silently different. Should at least be a documented capability note.
- **PLAUSIBLE (unverified — hybrid branch not yet quoted): LFM2-class hybrid memory silently ignores mem_other.** create_memory's diff only threads params.mem_other into the non-GEMMA iswa branch (model.cpp:2243) and the plain kv_cache branch (:2264). If the hybrid (llama_memory_hybrid) and recurrent branches still hardcode nullptr, ctx_other on those archs yields independent caches with NO error — silent divergence from the governor's expectations. To verify below.

## Angle 4 — iswa 12-line change

- **Why touched: CONFIRMED correctness fix forced by the generalization.** Old: `mem_other_base = static_cast<llama_kv_cache_iswa *>(mem_other)->get_base();` — UB if mem_other wasn't an iswa cache. New llama-kv-cache-iswa.cpp:84-90: `auto * other = dynamic_cast<llama_kv_cache_iswa *>(mem_other);` / `if (mem_other && !other) { throw std::runtime_error("cannot share iSWA cells with an incompatible memory type"); }` / `llama_memory_t mem_other_base = other ? other->get_base() : nullptr;`.
- **Unshared SWA path: CONFIRMED unchanged.** mem_other==nullptr ⇒ dynamic_cast(nullptr)==nullptr ⇒ base/swa both nullptr, exactly as the old two-`if` block produced. No regression risk for normal SWA models on the unshared path. REFUTED as regression; the change is justified and minimal.

## Angle 5 — GEMMA4 path preserved

- **CONFIRMED structurally: GEMMA4 still takes the aliasing branch.** llama-model.cpp:2201-2212: `if (arch == LLM_ARCH_GEMMA4_ASSISTANT) {` / `llama_memory_t mem_other = llama_get_memory(cparams.ctx_other);` / `share = [&](int32_t il) { ... return llama_model_n_layer(model_other) - 2; ... return llama_model_n_layer(model_other) - 1; }` — the share callback (tensor aliasing) is unchanged and passed at :2214-2229 `res = new llama_kv_cache_iswa(..., mem_other, filter, reuse, share);`.
- **CONFIRMED: gate generalization in llama-context.cpp** :118-127 — GEMMA4 branch still throws when ctx_other==null for GEMMA4_ASSISTANT (`throw std::runtime_error("Gemma4Assistant requires ctx_other to be set ...")`), and the new `if (params.ctx_other != nullptr) { cparams.ctx_other = params.ctx_other; }` accepts sharing for ALL archs.
- **CAVEAT (from angle 3): "preserved" is only structural.** The ctor the GEMMA4 path flows through now throws on kv_size/type/layout mismatches that previously warned+overrode. Byte-identical behavior holds only for exactly-matched pairs. PLAUSIBLE e2e regression, undecidable without a GEMMA4 model.

## Angle 6 — Test quality (preliminary; probe-soundness sub-item verified below)

- **CONFIRMED: negative tests reach the NEW guards.** :123 `if (llama_memory_seq_rm(llama_get_memory(ctx_b.get()), 0, -1, -1)) {` → dispatches straight into the fenced :394 seq_rm (first check in the function) → expects false. :128-132 bad type_k (F32) → ctor throw "...different K/V types"; :133-137 n_ctx=512 → throw "...different kv_size"; llama_init_from_model returns nullptr on throw. The guards are genuinely exercised.
- **CONFIRMED: shared_cells_next_slot is ASSERTED, not just printed.** :115-121: `const uint32_t expected = static_cast<uint32_t>(tokens.size());` ... `if (llama_memory_seq_pos_max(llama_get_memory(ctx_b.get()), 0) != expected_pos || slot_a.empty() || slot_b.empty() || slot_a.head() != expected || slot_b.head() != expected) { ... return false; }`. Ground truth (token count of the test's own prompt) is independent of cache internals. Print at :140 is supplementary.
- **CONFIRMED WEAK: no A/B interleaved decodes — B never decodes at all.** Only owner prefill (:95) + find_slot probes (:113-114). The apply_ubatch no-op landmine (angle 1) and any B-side decode semantics are untested. The plan's "il find_slot di B continua giusto" is covered, but the sharing model's only real risk isn't.
- **CONFIRMED fragile: raw static_cast of memory.** :100-101 `auto * cache_a = static_cast<llama_kv_cache *>(llama_get_memory(ctx_a.get()));` — UB if the model were SWA (iswa memory); fine for stories15M, breaks silently if the fixture changes.
- **PLAUSIBLE fragile: hardcoded n_pos_per_embd.** :107 `llama_batch_allocr allocator(1);` — the ctor arg is n_pos_per_embd (cf. src/llama-kv-cache.cpp:2235 `llama_batch_allocr balloc(hparams.n_pos_per_embd());`); 1 is correct for stories15M only.
- No negative test for clear() (the missed fence), none for state ops, none for seq_cp/keep/div.

## Angle 7 — Unshared-path regression (ctx_other == null)

- **CONFIRMED no regression.** llama-context.cpp:118 `cparams.ctx_other = nullptr;` and the new accept is gated on non-null (:126-127 `if (params.ctx_other != nullptr) { cparams.ctx_other = params.ctx_other; }`).
- Ctor: `other(dynamic_cast<llama_kv_cache *>(mem_other))` → nullptr; `v_cells_impl(other ? other->v_cells_impl : std::make_shared<llama_kv_cells_vec>())` — owner path allocates its own impl as before; the delta's `if (!other) { v_cells.resize(n_stream); ... }` (:152-156) skips resizing only for shared caches — for unshared it's byte-identical to the old unconditional resize.
- iswa: nullptr → base/swa nullptr (angle 4). Guards all sit inside `if (other)`. clear/seq ops unchanged for owner-only caches. REFUTED: no unshared-path behavior change found.

## Angle 8 — RIUSO-PRIMA

- **CONFIRMED: this is an EXTENSION of the existing GEMMA4 plumbing, not a parallel mechanism.** Same v_cells_impl sharing member-init (:83), same ctx_other cparam, same TAG_KV_CACHE_SHARE_CELLS convention sites, same share-callback signature; the delta adds guards + type-safe dispatch + fences at the existing tag sites. The new test reuses common_tokenize/common_params_parse (same as step 1's final form). No reinvention found.

## Closure (orchestrator, Fable — auditor died twice mid-run; open items verified by me on disk)

- memory->clear(true) at llama-context.cpp:3274 sits in the opt/training epoch path (GGML_ASSERT(opt_ctx) above it) — but clear() is also reachable via the public llama_memory_clear API, so MISS #1 stands regardless of this call site.
- Hybrid: `grep -n mem_other src/llama-memory-hybrid.{cpp,h}` → EMPTY. The hybrid ctor takes no mem_other at all, while llama-context.cpp now accepts ctx_other for ALL archs → CONFIRMED silent ignore for LFM2-class (KEXP). Step 6 will thread it; until then acceptance must be loud, not silent.
- Spot-verified on disk by orchestrator: clear() unfenced (:382-391), seq_cp/apply_ubatch silent no-ops, seq_rm/seq_add/init_update fences present as quoted.

## VERDICT: FIX-FIRST

Blocking: MISS #1 (clear), MISSES #2-6 loud-not-silent, non-owner decode fence (angle-1 landmine),
hybrid/recurrent silent ctx_other ignore, kv_size WARN+override→throw regression on the aliasing path.
Non-blocking noted: buft capability note, test fragilities (static_cast, n_pos_per_embd, no B decode).

## Re-audit 951df1f92

- Delta: ee10d3421..951df1f92 (+73/−3: llama-kv-cache.cpp 34, llama-model.cpp 8, tests/test-governor-v0-shared-cells.cpp +34 → 194 lines)
- Date: 2026-08-28
- Carry-over: the step-2 verdict line was interrupted mid-session; step-2 ended CONFIRMED-heavy (clear() unfenced wipe of shared cells, apply_ubatch no-op landmine, silent no-ops on seq_cp/keep/div/state IO, hybrid/recurrent silent-ignore of mem_other). This delta claims to fix exactly those. Also closing the last step-2 loose end: llama-context.cpp:3274 `memory->clear(true);` sits inside `llama_context::opt_epoch_iter` (:3258) — an explicit opt-training entry point, not init-time; so clear() on a shared non-owner is reachable via public C APIs (llama_memory_clear/llama_clear_kv_cache → :3804 `mem->clear(data);`) and opt_epoch_iter, NOT automatically at context creation. Consistent with the passing test.


### MICRO: is the non-owner decode fence bypassable?


**Route 1 — normal plain-cache decode: CONFIRMED FENCED.** llama-context.cpp:1739 `mctx = memory->init_batch(*balloc, cparams.n_ubatch, output_all);` → fence at llama-kv-cache.cpp:735-738 `if (other) { LLAMA_LOG_ERROR("%s: decode is not allowed from a shared KV cache\n", __func__); return std::make_unique<llama_kv_cache_context>(LLAMA_MEMORY_STATUS_FAILED_PREPARE); }` — returns a status-only context BEFORE the do/split loop, so no slot reservation, no prepare, no graph. Decode switch at :1754 handles FAILED_PREPARE → one `memory_update(true)` retry → `continue` re-enters the fenced init_batch → second failure → WARN + `return 1;` (nonzero rc). The fence is at the memory-context level, as claimed.
- Note (harmless): the retry calls init_update(lctx, true) on the non-owner; with do_shift=false and empty sc_info the context ctor sets NO_UPDATE (llama-kv-cache.cpp:2570-2573 `if (!do_shift && this->sc_info.empty()) { status = LLAMA_MEMORY_STATUS_NO_UPDATE; }`) and update() returns true without touching cells for a non-owner (:836-839). No cell writes.

**Route 2 — split/retry loop: CONFIRMED FENCED.** The loop is `while (true) {` (:1738) around init_batch; the retry `continue;` (:1761 area) re-enters init_batch, which unconditionally fences first. There is no path from the retry loop into prepare/apply that skips init_batch on a plain cache.

**Route 3 — init_full: CONFIRMED SAFE (does not reach apply_ubatch).** llama-kv-cache.cpp:771-772 `llama_memory_context_ptr llama_kv_cache::init_full() { return std::make_unique<llama_kv_cache_context>(this); }` — ctor :2548-2563 sets a dummy sinfo but has NO ubatches (no such param). apply() :2597-2601: `if (ubatches.empty()) { kv->update(lctx, do_shift, sc_info); return true; }` → non-owner update() without shift is a no-op. Callers :556/:767/:3762 (reserve/warmup/sync paths) can never apply_ubatch through init_full.

**Route 4 — init_update: CONFIRMED FENCED for the dangerous case.** :788-794 (previous delta) refuses other+(do_shift||!sc_info.empty()) with FAILED_PREPARE; the no-update case is NO_UPDATE and apply() routes to the no-op update() above.

**Route 5 — iswa non-owner decode: CONFIRMED FENCED, and the :793 prepare fence is LOAD-BEARING, not redundant.** llama-kv-cache-iswa.cpp:157 init_batch delegates slot finding DIRECTLY to the sub-caches: :185/:221 `auto sinfos_base = kv_base->prepare(ubatches);` and :190/:226 `auto sinfos_swa = kv_swa->prepare(ubatches);` — bypassing the plain caches' init_batch. The :793-798 prepare fence (`if (other) { LLAMA_LOG_ERROR("%s: decode is not allowed from a shared KV cache\n", __func__); return {}; }`) makes those returns empty; iswa handles it: :187-189/:222-224 `if (sinfos_base.empty()) { break; }` (and the swa twin), both split attempts fall through to :240 `return std::make_unique<llama_kv_cache_iswa_context>(LLAMA_MEMORY_STATUS_FAILED_PREPARE);`. The iswa ubatch-context ctor (:2546+J49-J58, `new llama_kv_cache_context(kv->get_base(), std::move(sinfos_base), this->ubatches)`) — the ONLY construction of SUCCESS-status ubatch-carrying sub-contexts — is reached only with non-empty sinfos, which the prepare fence makes impossible on a non-owner. Failure propagation is correct: status combined via `llama_memory_status_combine(...)` (:290/:301/:313).

**Route 6 — apply_ubatch itself: CONFIRMED last-resort fence.** :1145-1150: `if (other) { LLAMA_LOG_ERROR("%s: decode is not allowed from a shared KV cache\n", __func__); return; }`. Unreachable via the public decode flow per routes 1-5, but it now logs instead of silently no-opping — the silent-collision landmine from my step-2 angle-1 finding is converted into a loud guard even if a future route appears. (Caveat carried from step 2: the fence makes non-owner decode IMPOSSIBLE — the step-3/4 commit primitive must lift exactly these three sites, as the TODO at :734/:792 says: `// TODO [TAG_KV_CACHE_SHARE_CELLS]: step 3/4's commit primitive will lift this fence.`)

**Route 7 — llama_encode: CONFIRMED shares the fenced route.** llama-context.cpp:3299 `auto mctx = memory->init_batch(*balloc, cparams.n_ubatch, true);` — same init_batch, same fence. No separate encode entry into apply_ubatch.

**Route 8 — exotic memories (hybrid/recurrent/dsa/dsv4): CONFIRMED cannot be non-owners.** The delta throws in create_memory for recurrent and hybrid when mem_other is set (llama-model.cpp:2079-2082 `if (params.mem_other) { throw std::runtime_error("ctx_other is not supported for this architecture yet"); }` — same at :2093-2096); dsa/dsv4 branches never receive mem_other (model.cpp passes params.mem_other only at :2202/:2243/:2264). The direct `llama_kv_cache_context(..., sinfos, ubatches)` constructions in dsa.cpp:210-211, dsv4.cpp:1392, hybrid.cpp:235 therefore always sit on owner-only caches.

**MICRO VERDICT on the question: the non-owner decode fence is NOT bypassable.** Three sites, three distinct choke points, each necessary: init_batch (plain decode + encode), prepare (iswa delegation — would otherwise bypass init_batch), apply_ubatch (defense-in-depth). Every route ends in FAILED_PREPARE → decode rc 1, or a no-op that never touches cells. No CONFIRMED BYPASS.

## Re-audit verdict (951df1f92)

**APPLY** — all four implementer claims verified against source (clear() fence :387-392 with owner-cells-intact assertion in the test; decode fence triple at :735/:793/:1148 proven unbypassable on every route including iswa delegation, encode, and the retry loop; kv_size override restored gated on `if (share)` with the general share==nullptr path still throwing; state IO throws added); hybrid/recurrent silent-ignore converted to a loud throw (matches my step-2 CONFIRMED finding); the two new tests assert owner continuity AFTER B's refusals, not just refusal itself. State-IO exception-across-C-boundary and test-vacuity are being verified separately per instruction — excluded here. Parked (non-blocking, from step 2): buft/offload-mismatch still accepted silently at share-accept; test fragilities (static_cast of memory, hardcoded n_pos_per_embd=1 with a now-present comment at :121); seq_add still GGML_ABORT (harsh but consistent with pre-existing shift semantics).
