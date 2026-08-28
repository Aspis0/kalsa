# Audit — governor-v0 step 1 (test)

- Commit audited: 88e88a1cf (branch kalsa/governor-v0, repo ~/Projects/kalsallama)
- Date: 2026-08-28
- Scope: diff vs main = tests/test-governor-v0.cpp (new, ~225 lines) + 4-line registration in tests/CMakeLists.txt
- Rules: READ-ONLY on code; this file is the only writable artifact. Every claim quotes file:line + exact text.

## Angles checklist
1. Oracle correctness (position arithmetic, n_past, seed/threads, symmetry blindness)
2. Vacuous-PASS risk (argmax equality on tiny model, logits-level comparison)
3. State API usage (get_size vs get_data, return codes, buffer sizing, seq ids)
4. Edge cases (empty/single-token prompt, decode failures, allocation failures)
5. Measurement bracketing (bytes/ms windows)
6. Test hygiene (leaks on all paths, GGUF fixture/network, env/global mutation)
7. CMake registration (side effects, labels/fixtures vs conventions)
8. RIUSO-PRIMA (reinvention vs test-save-load-state patterns)

## Findings

(working — one angle at a time, appended below)

## Angle 1 — Oracle correctness

- **Position arithmetic: CONFIRMED CORRECT.** Prefill decodes P−1 tokens at pos 0..P−2 (`tests/test-governor-v0.cpp:161` `if (!decode_prompt(ctx_a.get(), prompt_tokens, prompt_tokens.size() - 1))`); held-back token at `last_prompt_pos = prompt_tokens.size() - 1` (`:174`) fed to BOTH ctxs; first generated token goes to `next_pos = prompt_tokens.size() + i` at i=0 → pos P (`:198`). Token g_i lands at pos P+i; loop samples before decoding (i=k_generated_tokens−1 samples without a trailing decode). Correct, and P+7 ≤ n_ctx=128 (prompt ~6–10 tokens).
- **n_past after handoff: PLAUSIBLE-OK.** `llama_state_seq_set_data` on empty ctx_b restores KV cells with positions; next decode appends at pos P−1. No explicit n_past assertion anywhere — the test trusts cell bookkeeping silently. If set_data restored cells but left dst cell bookkeeping stale, the test would only catch it if the argmax chain diverged (see angle 2).
- **Seed/n_threads determinism: CONFIRMED OK.** `params.n_threads = 1; params.n_threads_batch = 1;` (`:57-58`), greedy samplers only (`:181-182` `llama_sampler_init_greedy()`), no seed anywhere (greedy has none). Both contexts on CPU-only (`params.n_gpu_layers = 0;` `:47`).
- **Symmetry blindness: REFUTED (mostly).** A is an independent recomputation (never receives transferred state), B is the handoff path — so A-vs-B does test the handoff, not two copies of the same object. BUT the oracle granularity is argmax tokens only (see angle 2). Deviation from PLAN §3 step 1 oracle wording "uguaglianza greedy token-per-token vs run a contesto singolo": A is a *chunked-prefill* single-context run (P−1 batch then 1 token), not a single-batch prefill; ubatch-boundary reduction order could make A differ from a true single-shot prefill in the low bits. Acceptable for step 1 (CPU, deterministic), but note the oracle is "A's chunked pattern" not "the canonical single-batch baseline". PLAUSIBLE minor.
- **Held-back-token replay design: CONFIRMED SOUND.** Comment `:159-160` ("public sequence-state format carries KV, not the final logits row") is accurate for llama_state_seq_*; replaying the last prompt token in both contexts gives equivalent logits rows to sample from. PLAN §3's named audit item "ownership di output_ids/logits tra contesti" is implicitly exercised here and OK.

## Angle 2 — Vacuous-PASS risk

- **CONFIRMED: no logits-level comparison exists.** The only value check is `:192` `if (token_a != token_b)`. `llama_get_logits_*` is never called; max-abs-diff never computed.
- **CONFIRMED weakness: 8 greedy argmax tokens on stories15M-q4_0 is a weak oracle.** The fixture model is `tests/CMakeLists.txt:210` `set(MODEL_NAME "tinyllamas/stories15M-q4_0.gguf")` — tiny vocab, repetitive greedy chains; a subtly corrupted KV (dropped cell, stale RoPE delta, quantized-KV readback off-by-N) can easily keep 8 argmax tokens equal while logits differ materially. This is exactly the class of bug step 3 (byte-equality vs oracle) is meant to catch; step 1 ships without even a scalar guard.
- **Required strengthening (cheap, high value):** after `:175-176` decode_one replay, compare `llama_get_logits_ith(ctx_a, 0)` vs `ctx_b` over n_vocab: assert max-abs-diff ≤ ~1e-4 (on identical deterministic CPU+CPU with lossless state round-trip it should be ~0). One loop, ~10 lines, still <250-line budget. Would convert the oracle from token-granular to logits-granular and make the A-vs-B comparison non-vacuous.
- Note: get/set_data on CPU is a memcpy of host buffers, so bitwise-equal logits are a realistic expectation; any nonzero diff would itself be a finding worth surfacing.

## Angle 3 — State API usage

- **CONFIRMED OK: size/data/set round-trip.** `:130` `const size_t state_size = llama_state_seq_get_size(src, 0);` → `:136` buffer `std::vector<uint8_t> state(state_size);` → `:138` `llama_state_seq_get_data(src, state.data(), state.size(), 0)` → `:139` `llama_state_seq_set_data(dst, state.data(), state.size(), 0)`. Buffer sized exactly to get_size; zero-size rejected (`:131-114`); return codes checked `:143` `if (copied != state_size || restored != state_size)`.
- **CONFIRMED OK: seq ids consistent.** Decode batches use `batch.seq_id[i][0] = 0;` (`:86`, `:101`), state APIs use seq_id 0 (`:130,138,139`). Match.
- **PLAUSIBLE minor:** `get_size` is queried once before `get_data` with no state change in between — fine here. No use of `get_size_ext`/flags (matches non-ext API choice; fine for CPU-resident state).
- **PLAUSIBLE (documented but misleading?) metric:** `:149` `bytes = copied + restored;` — reported as `governor_v0_handoff_bytes=%zu (get+set)` (`:207`). Summing get+set double-counts vs the actual state size; the "number v0 must beat" is a fudge factor ×2 away from state_size. Defensible (it measures bytes moved) but should print state_size too, or the plan's cost number is ambiguous.

## Angle 4 — Edge cases

- **CONFIRMED OK: empty prompt.** `tokenize` returns `!tokens.empty()` (`:76`).
- **CONFIRMED OK: single-token prompt.** `:154` `if (prompt_tokens.size() < 2)` → error return 1. (Dead in practice: hardcoded prompt; defensive. Fine.)
- **CONFIRMED OK: tokenize two-call dance correct.** `:84` expects negative `required`; `:91-92` checks `actual != required * -1`.
- **CONFIRMED OK: decode failure paths.** All `llama_decode` results checked (`:112,104`, `:175-176`, `:199-201`); batch freed on both paths (`:111-112`, `:105-106`).
- **PLAUSIBLE: llama_batch_init allocation failure unchecked.** `:80-82` / `:96-98` never verify `batch.token != NULL` before writing. llama_batch_init aborts on OOM in current llama.cpp, so low risk — but it is unchecked, and this harness will later be templated for bigger inputs.
- **CONFIRMED OK: model/ctx load failures.** `:135-140` and `:149-152` check all four handles before use.
- **CONFIRMED OK: allocation failure** of the state vector throws std::bad_alloc → terminate; acceptable for a test. No partial-state leak between the two `decode_one` calls (`:175-176`): if A's replay succeeds and B's fails, test returns 1 with handles RAII-freed. Fine.

## Angle 5 — Measurement bracketing

- **CONFIRMED: window = get_data + set_data only.** `:137` start → `:138-139` both calls → `:120` finish. Vector alloc + zero-init (`:136`) is before start (pages committed, so no page-fault cost hides in the window — good). steady_clock used (`:117,120`) — good.
- **CONFIRMED weakness: single-shot, no warm-up, no repetitions.** The number printed (`:208` `governor_v0_handoff_ms=%.3f`) is ONE invocation including first-touch of dst cache pages and any first-call lazy init. PLAN §3 says "Misura il costo naive = numero che v0 deve battere" — a cold single-shot number is a shaky baseline to "beat"; noisy CI timing will make cross-run comparisons meaningless. At minimum: run the get→set round-trip a few times (or document it as cold-start cost explicitly in the printf label).
- **PLAUSIBLE: window excludes the allocation of the receive-side buffer in the governor's real path** — fine for "naive serialization cost" framing, but step 3's commit primitive will not pay this same structure; keep in mind when comparing.
- `bytes = copied + restored` (`:149`) — see angle 3; double-count ambiguity.


## Angle 6 — Test hygiene

- **CONFIRMED OK: RAII on every path.** unique_ptr deleters for model/ctx/sampler (`:15-25`); ctxs declared after models (`:147-148` vs `:187-188`) so destruction order is samplers → ctxs → models (ctx cannot outlive model). `llama_batch_free` on every decode path (`:111-112`, `:105-106`). `llama_backend_init/free` bracketed in main (`:221-224`).
- **CONFIRMED OK: no env/global mutation.** Only `llama_log_set(log_errors, nullptr)` (`:221`) — process-local, never restored, irrelevant since process exits. No file writes, no cwd assumptions.
- **CONFIRMED OK: device array lifetime.** `:64` `ggml_backend_dev_t devices[] = { cpu, nullptr };` is consumed only inside `llama_model_load_from_file` within `load_cpu_model` — no dangling.
- **CONFIRMED: GGUF arrives via network fixture on first run.** `tests/CMakeLists.txt:225-231` `add_test(NAME test-download-model COMMAND ${CMAKE_COMMAND} -DDEST=${MODEL_DEST} ...)` with `FIXTURES_SETUP test-download-model` (:231); model = `tinyllamas/stories15M-q4_0.gguf` (:210), SHA256-pinned (:211). Test correctly requires the fixture (`tests/CMakeLists.txt:288`). First ctest run downloads from HF — acceptable repo convention, but the test cannot run offline.
- **PLAUSIBLE minor: log callback swallows warnings.** `:52` `if (level >= GGML_LOG_LEVEL_ERROR)` — GGML_LOG_LEVEL_WARN diagnostics during state restore would be invisible; debug-hostile but cosmetic.
- **Runtime evidence (ran the single binary, exit 0):** `governor_v0_handoff_bytes=97272 (get+set)`, `governor_v0_handoff_ms=0.030`, `governor_v0_token_check=PASS (8 tokens)`. Note stderr tensor-load progress dots leak past the log filter during the two model loads — cosmetic.

## Angle 7 — CMake registration

- **CONFIRMED DEFECT: missing `LABEL "model"`.** tests/CMakeLists.txt:285-288:
  `llama_build(test-governor-v0.cpp)` / `add_test(NAME test-governor-v0 COMMAND test-governor-v0 "${MODEL_DEST}")` / `set_tests_properties(test-governor-v0 PROPERTIES FIXTURES_REQUIRED test-download-model)`.
  The three neighbors with the identical fixture all use LABEL "model": `:276` `llama_build_and_test(test-state-restore-fragmented.cpp LABEL "model" ARGS -m "${MODEL_DEST}")`, `:279` (test-recurrent-state-rollback, same), `:283` (test-save-load-state, same). The default is "main" (`:93`). Consequence: `ctest -L model` (the standard way to run the model-dependent set against a pre-provisioned model) skips this test silently; `ctest -L main` pulls in the network download fixture. One-word fix.
- **CONFIRMED DEFECT: only raw `add_test` for a C++ test in the file.** `grep -n "add_test(NAME"` over tests/CMakeLists.txt yields exactly :225 (the download fixture) and :287 (this diff). Every other C++ test goes through `llama_test`/`llama_build_and_test`. Divergence is unjustified — `llama_build_and_test(test-governor-v0.cpp LABEL "model" ARGS -m "${MODEL_DEST}")` + FIXTURES_REQUIRED line would be 2 lines and conventional.
- **CONFIRMED: `llama_build` (not `_and_test`) omits get-model.cpp** (`:8` `set(TEST_SOURCES ${source} ${ARGN})` vs `:89` `set(TEST_SOURCES ${source} ... get-model.cpp)` in `_and_test`), so the repo's standard skip-when-no-model convention (`tests/get-model.cpp:10-15`, env `LLAMACPP_TEST_MODELFILE`, exit EXIT_SUCCESS) is unavailable; the test hard-exits 2 on missing argv[1] (`:216-219`). Inside ctest this never bites (path always passed), but direct binary invocation diverges from every model-based sibling.
- No other side effects found: builds cleanly (`cmake --build . --target test-governor-v0` exit 0), no target-name collision, fixture ordering correct.

## Angle 8 — RIUSO-PRIMA

- **CONFIRMED (in the good direction): state serialization pattern mirrors the existing one.** The get_size→get_data→set_data + exact-size-return-check sequence is the same shape as tests/test-save-load-state.cpp:166-177 (`std::vector<uint8_t> seq_store(llama_state_seq_get_size(ctx.get(), 0)); ... llama_state_seq_get_data(...); if (ncopy != seq_store.size()) ...`). No core offset math was reinvented — step 1 correctly uses public APIs only.
- **CONFIRMED minor reuse miss: hand-rolled tokenize.** `:82-97` reimplements the two-call `llama_tokenize` dance while `common_tokenize` is one call away — `llama-common` IS linked (`tests/CMakeLists.txt:12` in `llama_build`), and test-save-load-state.cpp:329 uses `common_tokenize(ctx.get(), params.prompt, true)`. The hand-rolled version is correct but is ~16 lines of duplicate logic (RIUSO-PRIMA says search first, rewrite only what doesn't exist).
- **PLAUSIBLE: harness itself is not reinvention.** No existing test builds a two-context cross-model handoff (test-state-restore-fragmented is single-context; test-save-load-state migrates seqs within one ctx). A new file is justified; the PLAN mandates it ("Harness a due contesti, zero modifiche core").
- **Minor: `get-model.cpp` convention not reused** — see angle 7, third bullet.

## Runtime verification (auditor-run, single test only)

- Build: `cmake --build . --target test-governor-v0 -j8` → EXIT=0.
- Run: `build/bin/test-governor-v0 build/tinyllamas/stories15M-q4_0.gguf` → EXIT=0, PASS (8 tokens), bytes=97272 (get+set ⇒ state_size≈48636), ms=0.030 (single-shot).

## Overall verdict

**FIX-FIRST** — no correctness bug in the oracle or the handoff logic itself (positions, seq ids, return-code checks, RAII all CONFIRMED correct; test passes at runtime). Blocking items, both in the 4-line registration + ~15 lines of test:

1. **[CONFIRMED] CMake: add `LABEL "model"` and register via `llama_test`/`llama_build_and_test`** instead of the file's only raw C++ `add_test`; otherwise `ctest -L model` silently skips it and label-based CI selection diverges from the three fixture-siblings.
2. **[CONFIRMED, required strengthening] Add a logits-level assertion** (max-abs-diff on `llama_get_logits_ith` of ctx A vs B after the held-back-token replay, ≤ ~1e-4; bitwise ≈0 expected on deterministic CPU+CPU). Without it, 8 greedy argmax tokens on stories15M-q4_0 can pass over subtly corrupted KV — and this harness is the oracle foundation for step 3's byte-equality work.

Non-blocking (fix if trivial): reuse `common_tokenize`; use `get_model_or_exit` convention (or accept + document the divergence); print `state_size` alongside the get+set byte sum; label the ms metric as cold single-shot or add a warm-up repeat; check `llama_batch_init` results before writing.

## Re-audit 70f56c59c

- Commit audited: 70f56c59c (delta vs 88e88a1cf: tests/CMakeLists.txt 3 lines, tests/test-governor-v0.cpp +48/−34)
- Date: 2026-08-28
- Scope: hostile re-audit of the FIX-FIRST delta only; every claim quotes file:line + exact text.
- Claims under test: (1) llama_build_and_test + LABEL "model" + ARGS -m + fixture, -m parsing; (2) full-row logits max-abs-diff A-vs-B after held-back replay, FAIL > 1e-6, measured 0; (3) separate byte counts + cold single-shot ms label; (4) common_tokenize.


### Claim 1 — registration & -m parsing: CONFIRMED FIXED
- tests/CMakeLists.txt:286 `llama_build_and_test(test-governor-v0.cpp LABEL "model" ARGS -m "${MODEL_DEST}")` + :287 `set_tests_properties(test-governor-v0 PROPERTIES FIXTURES_REQUIRED test-download-model)` — LABEL "model" restored, raw add_test eliminated, fixture kept. Matches test-save-load-state.cpp:283-284 pattern exactly.
- get-model.cpp is now compiled in (llama_build_and_test adds it to TEST_SOURCES) but `get_model_or_exit` is still not called — harmless dead code; the empty-model path is instead guarded at tests/test-governor-v0.cpp:230 `if (params.model.path.empty()) {` → exit 2. Default is indeed empty: common/common.h:303 `std::string path        = ""; // model local path`.
- Precedent for common_params_parse in tests exists: tests/test-thread-safety.cpp:19-21 (`common_init();` / `if (!common_params_parse(argc, argv, params, LLAMA_EXAMPLE_COMMON)) {`).
- **No regression (measured):** no-args → `NOARGS_EXIT=1` + `error: --model is required` (arg.cpp rejects BEFORE the :230 guard — so :230 is a redundant second belt, reachable only via `--model ""`); `--badflag` → `BADFLAG_EXIT=1` + `error: invalid argument: --badflag`. ctest path (`ARGS -m`) unaffected. Old `argc != 2`/exit-2 path gone; behavior now conventional.

### Claim 2 — logits check: CONFIRMED PRESENT, one CONFIRMED hole (NaN)
- **Placement: CONFIRMED.** Replay decode at :173-174 (`if (!decode_one(ctx_a.get(), prompt_tokens.back(), last_prompt_pos) || !decode_one(ctx_b.get(), ...))`), then :179-182 `compare_logits(ctx_a.get(), ctx_b.get(), llama_vocab_n_tokens(llama_model_get_vocab(model_a.get())), logits_max_abs_diff)`; samplers created only at :189; greedy loop at :196. Check runs before any sampling. :183 prints the diff on every run (`std::printf("governor_v0_logits_max_abs_diff=%.9g\n", logits_max_abs_diff);`), :184-186 returns 1 on mismatch.
- **Both rows are the replay row: CONFIRMED.** idx −1 = last output row; each context's last decode is the single-token replay with logits=true, so n_outputs=1 in both. Row stride is exactly n_vocab: src/llama-context.cpp:835 `return logits.data + j*model.vocab.n_tokens();` — no padding exists *inside* the row, so the n_vocab bound (:129 `for (int32_t i = 0; i < n_vocab; ++i) {`) is airtight. Padding concern REFUTED.
- **NULL path:** :123-126 `if (!logits_a || !logits_b) { max_abs_diff = INFINITY; return false; }` — correct in release. Caveat: in debug builds llama-context.cpp:836-837 (`#ifndef NDEBUG` / `GGML_ABORT("fatal error");`) aborts instead of returning nullptr, so the guard is unreachable under NDEBUG-less ctest configs. Minor, can't trigger here (both ctxs decoded with logits=true).
- **CONFIRMED hole — NaN slips through: :130 `max_abs_diff = std::max(max_abs_diff, std::fabs(logits_a[i] - logits_b[i]));`** — std::max(a, b) returns (a < b) ? b : a; with b = NaN the comparison is false and `a` (the running max) is returned, so any element whose diff is NaN (NaN in either row) is silently skipped and the check can PASS over NaN-corrupted logits — exactly the corruption class this oracle exists to catch. Improbable on deterministic CPU stories15M, but it is a real soundness gap in the new oracle. Two-line fix: reject non-finite elements, e.g. `const float d = std::fabs(logits_a[i] - logits_b[i]); if (!std::isfinite(d)) { return false; }` before the max.
- **Threshold 1e-6: CONFIRMED sound for step-1 scope.** f32 state round-trip via memcpy is lossless, both contexts run identical CPU kernels with n_threads=1 over identical cells → bitwise-equal logits expected; measured `governor_v0_logits_max_abs_diff=0` in my run. GPU tolerance is explicitly out of scope (PLAN §4.4).

### Claim 3 — byte/ms reporting: CONFIRMED FIXED
- :215-217: `std::printf("governor_v0_handoff_copied_bytes=%zu\n", copied_bytes);` / `"governor_v0_handoff_restored_bytes=%zu\n"` / `"governor_v0_handoff_ms_cold_single_shot=%.3f\n"` — separate counts (my run: 48636/48636, so state_size is now visible), double-count ambiguity gone, cold single-shot honestly labeled (the "label OR warm-up" option I offered; labeling chosen).

### Claim 4 — common_tokenize: CONFIRMED FIXED
- :150 `const std::vector<llama_token> prompt_tokens = common_tokenize(ctx_a.get(), k_prompt, true);` — the 16-line two-call llama_tokenize dance is gone. Semantics equal (add_special=true, parse_special defaults true — same as the old call); ctx_a exists before this point (:143-148); `< 2` guard retained (:151). common.h is linked. Fine.

### Survival of prior findings
- FIXED: LABEL "model"; raw add_test; common_tokenize; separate bytes + cold label; logits strengthening (modulo the NaN hole); state_size now observable via copied_bytes.
- Resolved differently (acceptable): get_model_or_exit skip convention — replaced by parse-level `--model is required` rejection; harmless since ctest always passes -m.
- UNFIXED (all were non-blocking): llama_batch_init results still unchecked before writing (:66-69, :82-85 — unchanged); single-shot timing still one shot (now labeled); WARN-level logs still swallowed by the :52 filter.

### Runtime verification (auditor-run)
- `cmake --build . --target test-governor-v0 -j8` → BUILD_EXIT=0.
- `./bin/test-governor-v0 -m tinyllamas/stories15M-q4_0.gguf` → RUN_EXIT=0; `governor_v0_logits_max_abs_diff=0`, copied=restored=48636, ms_cold_single_shot=0.033, PASS (8 tokens). Claim "measured 0" reproduced.

## Re-audit verdict

**FIX-FIRST** — but narrowly. All four claims check out; the only CONFIRMED defect in the delta is the NaN hole at tests/test-governor-v0.cpp:130 (std::max silently ignores NaN diffs, so the new oracle can pass over NaN-corrupted logits). One two-line fix (reject non-finite diffs in compare_logits), then APPLY.
