# Audit — governor-v0 step 4 (llama_governor object)

- Delta audited: 93e21f361..8e5de77da, branch kalsa/governor-v0, repo ~/Projects/kalsallama
- Date: 2026-08-28
- Scope: +379 all-new — src/llama-governor.h (35), src/llama-governor.cpp (141), tests/test-governor-v0-turns.cpp (175), llama-ext.h/CMake plumbing
- Plan context: PLAN.md §2 (governor owns ctx_prefill + ctx_decode, routes by batch size, commit prefill→decode before post-prefill decode, REVERSE commit decode→prefill before next turn's prefill) + §3.4 (governor v0 with watermark/generations, multi-turn CPU+CPU identical to single-context baseline; audit: prompt vuoto, prompt multi-ubatch, n_past, secondo turno)
- Rules: READ-ONLY on code; this file is the only writable artifact. Every claim quotes file:line + exact text.

## Angles checklist
1. Watermark arithmetic: end = seq_pos_max+1, commit [watermark,end), both watermarks = end; 3-turn hand trace; double-commit/skip; turn-boundary off-by-one; held-back token logits context
2. 1-token prompt ambiguity: routes to decode ctx; bookkeeping coherence; why the test passes
3. Phase rule honesty: n_tokens read before internal split; n_ubatch sub-ubatch re-entry
4. Sampling/logits ownership; commit invalidating logits; get_logits_ith(-1) validity
5. Error paths: loud failures, no silent fallback, partial-turn documentation
6. Generation counters: real or dead weight
7. Test oracle strength: identical params incl. n_ubatch, greedy ties, seq_pos_max continuity, 2-ubatch split coverage
8. Hygiene: llama-ext.h convention, header minimality, file sizes

## Findings

(working — one angle at a time, appended below)

## Angle 1 — Watermark arithmetic (hand trace, 3 turns)

- **Mechanism confirmed from source.** `commit_side` (llama-governor.cpp:47-68): route check :49-52; `end` from `sequence_end(src_ctx, 0, end)` (:54-55) = `seq_pos_max + 1` (:43 `end = max_pos + 1;`, empty cache → 0 :36-38); commit only `if (end > src.watermark)` (:59 `llama_kv_commit(dst_ctx, src_ctx, 0, src.watermark, end)`); then :64-66 `src.watermark = end; dst.watermark = end; dst.generation = src.generation;`. Watermark is documented exclusive (:19 `// exclusive next position not committed to the other side`).
- **Hand trace, turn geometry (12-token prompt, k_generated=6, matching the test's turns 0 and 2):** turn 0 prefill A@[0,12); first 1-token decode (t0@12) flips phase → commit A→B [0,12) → both watermarks 12; B decodes t0@12, t1@13 … t4@16; test's final output=false decode t5@17; B=[0,18), A=[0,12), both watermarks 12. **Turn 1 (1-token prompt @18):** routes to B; last_phase==Decode → no commit (:89); B decodes prompt@18 + gen@19..24 → B=[0,25), A STILL [0,12). **Turn 2 opening (prefill):** commit B→A [12,25) — cells 12..24 (1-token prompt + gen) reach A exactly once; A prefill @25..36; next phase flip commits [25,37). **Verdict: every cell committed exactly once per direction, no skip, no double-commit.**
- **Off-by-one at turn boundary: REFUTED.** The test decodes EVERY sampled token including the last (final_batch :147 `make_batch({ next }, n_past, false)` before :157 `++n_past`), so at turn end `seq_pos_max+1` equals the next prompt's first position and `[watermark, end)` covers everything decoded. The last *sampled-but-undecoded* token case (early stop) is also safe: it was never decoded by either side, and the next prompt starts at max_pos+1 — identical to a single-context baseline.
- **Held-back token: CONFIRMED not needed, and correctly so.** The governor commits the FULL prompt [0,n) including the logits-carrying last prompt token's KV; t0 is sampled from A (A ran last) BEFORE the first 1-token decode triggers the commit. B's first decode appends at pos n on top of the committed prompt. The step-1 replay existed only because state IO can't carry logits and the harness split the prompt — the governor never splits the prompt, so no replay is required.
- **Guard: `end < src.watermark` fails loudly** (:55-58) — catches cache shrinking (user seq_rm via exposed contexts). Empty-src case degenerates safely (end=0 == watermark 0 → sync to 0, no commit :59).

## Angle 2 — 1-token prompt ambiguity

- **CONFIRMED: routes to the decode ctx by the phase rule** (:84-85 `const bool is_prefill = batch.n_tokens > 1; ... target = is_prefill ? ctx_prefill : ctx_decode;`). For turn 1's 1-token prompt: last_phase==Decode==next_phase → no commit; the prompt token is evaluated IN B; its logits are sampled from B via `llama_governor_get_context` (:117 → :111 `return last_ctx;` — B after :106 `last_ctx = target;`).
- **CONFIRMED: bookkeeping stays coherent — traced above.** The prompt's KV lives only in B during turn 1 and reaches A in the turn-2 opening reverse commit [12,25). That commit is REAL coverage, not a degenerate pass: if it had skipped the prompt cell, A's turn-2 prefill would attend to an empty cell @18 and the turn-2 sample comparison (:119, :139) would mismatch the baseline. The test's PASS is therefore substantive for exactly this case, and the printed `one_token_prompt=PASS` (:159) is backed by assertions, not just reachability.
- **Design note (parked):** routing prompts by n_tokens==1 means a 1-token prompt's *sampling* happens on the decode side — semantically fine for v0 (both sides are the same model), but it's an undocumented behavioral asymmetry of the public API.

## Angle 3 — Phase rule honesty

- **CONFIRMED: routing reads the CALLER's batch once, before any split.** :84 is evaluated once per `llama_governor::decode` call; :98 `const int32_t rc = llama_decode(target, batch);` forwards the whole batch. The n_ubatch=2 split of the 12-token prompt happens INSIDE llama_decode (llama-context.cpp:1738+ init_batch/split loop); the governor is never re-entered per sub-ubatch — no phase flip possible mid-prompt.
- **CONFIRMED: 2-ubatch split is genuinely exercised**: :13 `constexpr uint32_t k_ubatch = 2;` applied to ALL three contexts (:41-49 `params.n_ubatch = k_ubatch;` — governor sides AND baseline :83-84), :98-101 refuses a fixture prompt that doesn't exceed it (`if (long_prompt.size() <= k_ubatch)`), turns 0 and 2 prefill 12 tokens = 6 sub-ubatches. Indirect assertion only (no split-counter assert — that's step 5's n_reused instrumentation per plan); acceptable.
- **PLAUSIBLE doc gap: n_tokens>1 is a PREFILL proxy.** A batched multi-seq decode (4 seqs × 1 token → n_tokens=4) would route to the prefill ctx. Irrelevant for v0's single-seq-0 contract, but the ext header says nothing (see angle 8).

## Angle 4 — Sampling/logits ownership

- **CONFIRMED mechanism: "whichever context ran last" is explicit state.** :106 `last_ctx = target;` on success; :111 `llama_context * llama_governor::context() const { return last_ctx; }`; ext getter `llama_governor_get_context` (llama-ext.h). The test samples exclusively through it (:117-118, :137-138).
- **CONFIRMED: no commit can invalidate logits between run and sample.** Commits happen only at the START of a governor decode call (:89-96), i.e. after the user sampled and before the next llama_decode. Between `governor->decode()` returning and the user's `llama_sampler_sample(..., llama_governor_get_context(gov), -1)`, the governor performs no action. Each context owns its output buffers, so the other side running doesn't disturb the last ctx's logits row; `get_logits_ith(-1)` is valid because every sampled decode set logits on its last token (:59 of the test; the output=false final decode is never sampled).
- **PLAUSIBLE minor:** after a failure, `get_context()` returns the last SUCCESSFUL ctx with stale-but-self-consistent logits; the sticky `failed` flag (see angle 5) prevents further decodes but nothing prevents sampling from the stale ctx. Undocumented; harmless if the user checks rc.

## Angle 5 — Error paths

- **CONFIRMED: everything fails loudly, nothing falls back.** Empty batch → `fail("decode requires a non-empty batch")` (:80-82 — the plan's "prompt vuoto" audit item). llama_decode rc propagated AND sticky `failed = true` (:98-103). Commit false → `fail("phase handoff failed")` (:93-95). Route Reject → commit_side false (:49-52) → same fail. Once failed, every decode short-circuits (:77-79 `if (failed) { return fail("governor is failed"); }`). There is exactly one llama_decode call site (:98) on the routed target — no silent single-context fallback path exists.
- **CONFIRMED: watermark sync is failure-atomic.** :64-65 run only after a successful commit; a failed commit leaves both watermarks untouched (retryable state), but the sticky failed flag forbids retry. Combined with step 3's semantics (kv-commit writes metadata only after all tensor copies succeed), a mid-turn failure leaves the system at the last good watermark — coherent, but **UNDOCUMENTED**: llama-ext.h has no comments at all for the governor API (partial-turn semantics, sticky-failure, seq-0-only, the prefill-proxy routing rule — all implicit). Repeated doc gap from steps 3-4.

## Angle 6 — Generation counters

- **CONFIRMED DEAD WEIGHT.** `generation` declared (:20 `uint64_t generation = 0;`), incremented (:105 `++state->generation;`), copied (:66 `dst.generation = src.generation;`) — and read by NOTHING: no getter, no comparison, no assertion, no ext surface. This violates the owner's own rule ("no APIs nobody constructs"). Either delete it or expose/assert it when step 5's instrumentation consumes it.

## Angle 7 — Test oracle strength

- **CONFIRMED: baseline uses IDENTICAL params including n_ubatch.** :41-49 `context_params()` sets `n_ubatch = k_ubatch` (2); used for both governor sides (:83) and the baseline (:84). The comparison is like-for-like down to the ubatch split.
- **CONFIRMED: sampling is deterministic and subtly stronger than pure argmax.** :72-79 chain = `llama_sampler_init_temp(0.0f)` + `llama_sampler_init_dist(k_seed)` with k_seed=1234; two independent sampler instances (gov/base :85-86) start from the same seed and are advanced in lockstep. Identical logits ⇒ identical distributions ⇒ identical draws (no flake); a 1-ulp logit divergence shifts the distribution and CAN flip the draw — more sensitive than argmax, which is what you want from the oracle. Greedy tie-risk is neutralized by seed-symmetry, not by luck.
- **CONFIRMED: seq_pos_max continuity asserted after EVERY phase** — prompt (:112-113), each generated decode (:131-133), and the final output=false decode (:151-153) — on BOTH `llama_governor_get_context(gov)` and the baseline, against `prompt_last`/`n_past`.
- **CONFIRMED: route pre-check** (:91-95) asserts the two governor caches are genuinely independent (MirrorAndCopy, consistent with the ctor's throw on ctx_other :13-15).
- **CONFIRMED scope note (parked):** the oracle would NOT catch a governor that commits too often (e.g. every 1-token decode) — final state would be identical. That's a perf regression, not correctness; step 5's byte/µs counters own it.

## Angle 8 — Hygiene

- **CONFIRMED: ext surface conventional.** llama-ext.h: opaque forward-declared `struct llama_governor;` + 5 LLAMA_API functions (init/free/decode/3 getters), C-boundary safe (`llama_governor_init` catches exceptions → nullptr :117-122; null-guards on all getters :127-141). Same file/style as llama_kv_commit.
- **CONFIRMED: no leaks, header minimal.** Ctor throws with explicit cross-cleanup (:23-24 `llama_free(ctx_prefill); ctx_prefill = nullptr;` before the second throw); dtor frees both (:29-32). Header is 35 lines, all members used. All new files < 250 lines (35+141+175 — PLAN §3 "file nuovi <250 righe").
- **CONFIRMED: CMake conventional.** `llama_build_and_test(test-governor-v0-turns.cpp LABEL "model" ARGS -m "${MODEL_DEST}")` + fixture + src-include hack, `llama-governor.cpp` added to the llama target. No registration drift.
- **Parked (repeated):** zero doc comments on the new public API — routing rule, seq_id-0-only, sticky failure, partial-turn semantics are all tribal knowledge. Second consecutive step shipping undocumented public ext API.

## Runtime verification (auditor-run)

- `cmake --build . --target test-governor-v0-turns -j8` → BUILD=0; `./bin/test-governor-v0-turns -m tinyllamas/stories15M-q4_0.gguf` → RUN=0, `governor_v0_turns=PASS turns=3 generated=18 n_ubatch=2 one_token_prompt=PASS`.

## Overall verdict

**APPLY** — the watermark arithmetic is CONFIRMED correct by full 3-turn hand trace (no double-commit, no skip, no turn-boundary off-by-one; the final sampled token is deliberately decoded with output=false before the watermark snapshot), the 1-token-prompt turn is substantive coverage of the reverse commit rather than a degenerate pass, the phase rule reads the caller's batch before any internal split, logits ownership is explicit and commit-atomic, all error paths are loud with a sticky failed flag and no fallback, and the oracle is like-for-like down to n_ubatch. Parked, non-blocking: `generation` counters are dead weight (expose or delete in step 5 — the only CONFIRMED style defect, cosmetic); the usual missing API documentation (routing proxy, seq-0-only, sticky-failure semantics) — third consecutive step; stale-context sampling after failure is possible for callers who ignore rc.
