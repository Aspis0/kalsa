# RE-AUDIT 2 — engine `1b70069cb` (binding `531b477b`)

**Verdict: SHIP.** The n_batch cap is arithmetically sound; every executed piece is ≥ 2 and ≤ n_batch
for all prompt lengths and temperatures I checked, and the policy is byte-identical in behaviour for
`prompt <= n_batch`.

## The fix — CONFIRMED

    llama-governor-policy.cpp:219-221  while (table > 0 && (k_table_tokens[table - 1] > prompt_tokens ||
                                           k_table_tokens[table - 1] > n_batch)) { --table; }
    llama-governor-policy.cpp:236      if (prompt_tokens < k_table_tokens[0] && prompt_tokens <= n_batch && below_warn) {
    llama-governor-policy.cpp:256-268  if (prompt_tokens - result.tokens == 1) { ... n_batch cases ... }
    llama-governor-runtime.cpp:76-79   const uint32_t n_batch = ctx_prefill && ctx_decode ? min(pre, dec) : UINT32_MAX;

Invariant proof by cases for one admission returning a piece: the table loop keeps only rows
`R <= prompt` and `R <= n_batch`; the promotion sets `tokens = prompt` only when `prompt <= n_batch`,
else the next row down `R' < R = n_batch` (so `tokens = R' <= n_batch`, remainder `>= 2`), else
`prompt - 2 = 127` at `n_batch = 128` (remainder 2); the `<128` tail requires `prompt <= n_batch`.
So every returned piece is ≥ 2 and ≤ n_batch, and the remainder after a piece is 0, 2, or
`prompt - R' >= 2` — never 1, so the runtime's `count <= 1` (`runtime.cpp:124-127`) stays unreachable.

Verified with a scratch model of the policy + runtime partition (no repo edits) over
`n < 8300` × 19 temperatures (0…39.9) × 17 n_batch values (2…UINT32_MAX, incl. 127/128/129/512/2048):
- **0 piece violations** (every executed piece ≥ 2, ≤ n_batch, total = n);
- **0 differences vs 6581c7a7b for every `prompt <= n_batch`** (the cap is inert below the bound);
- `2049 @ 34.0, n_batch 2048` → `[1024, 1025]` (6581 promoted `[2049]` → the assert);
- `129 @ 34.0, n_batch 128` → `[127, 2]`; `130 @ 34.0, n_batch 128` → `[128, 2]`;
- pauses (`-2`, no piece, no assert) occur only for `n_batch < 128` (the smallest table row cannot
  fit) — a design boundary, not an abort.

## Why my previous model missed the abort — plainly

My `/tmp/model_policy.py` partition model had **no `n_batch` input at all**: it modelled
`admit_prefill(prompt, now)` and returned the promoted whole, and my REAUDIT asserted
"`n_batch`: `:250` sets `tokens = prompt_tokens` = the current `remaining` <= the input batch <=
`n_batch`". The last inequality was an unverified assumption I never tested: the governor's
admission contract takes the caller's `batch.n_tokens` and chunking is *its* job, so the input batch
may exceed the decode capacity — the test harness submits 2049 tokens with `n_batch=2048`, and the
assert `GGML_ASSERT(n_tokens_all <= cparams.n_batch)` (`llama-context.cpp:1751`) fires. I checked
"every piece ≥ 2" but not "every piece ≤ the caller's decode capacity". Worse, the writer's own
round-1 report had already documented the same assert for their n_batch=512/513 draft, and I
treated it as a test-harness constraint instead of the engine-API hole. The model was only as good
as its input domain; the domain excluded `batch > n_batch`.

## Reachability note (not a fix defect) — PLAUSIBLE

The shipped app sets `n_batch: 512` (`kalsa/src/engine/LlamaService.ts:2478`) and the binding caps
every eval to it (`cpp/rn-completion.cpp:762-763` and `:1617-1619`
`if (n_eval > parent_ctx->params.n_batch) n_eval = parent_ctx->params.n_batch;`), so the binding
itself never hands the governor a batch larger than n_batch. The abort was reachable through the
engine API (tests, other callers, a future binding), and pre-fix a row larger than n_batch
(n_batch 512, cool, 3000-token input) would have asserted too (the report's declared hole). The
commit closes the engine contract hole; it was not a live S23 path with the current binding.

## Tests and runs — CONFIRMED

- Router pins the split/cap/tiny cases (`tests/test-governor-v02-router.cpp:447-455`); turns runs
  `context_params(4096, 2048, k_chunk_n_batch)` with temps {34.0, 35.0, 37.8}
  (`tests/test-governor-v0-turns.cpp:297,311`) — the abort shape included. The writer's sabotage
  (cap removed) went red with **EXIT=134** at the assert; my model reproduces the pre-fix promotion.
- `cmake --build … -j 3` EXIT=0 (current binaries; the router contains the new check string);
  router **0**, turns with the 2.6B **0** (`governor_row_plus_one_prefills=PASS`), hybrid with
  `KALSA_HYBRID_GGUF` **0** (not 77).
- Binding `531b477b`: sha256-equal for `llama-governor-policy.cpp`, `llama-governor-runtime.cpp`,
  `llama-governor-policy.h`; `VERSIONS=1b70069cb…`; 11 files (the three vendored + version/identity).

## Left as declared / out of scope

- `127 + 2` is policy-tested only (the report declares no turns-level n_batch-128 scenario).
- `n_batch < 128` pauses instead of splitting (no abort; a future capability, not a blocker).
- No device run.

# AUDIT — binding `1f841412` + `b23fc083`

**Verdict: SHIP.** The typed pause is honest (no failure↔pause confusion on the covered paths),
the two defects luna found in `1f841412` are fixed, and the host side now knows the fourth literal.

## CONFIRMED — real failures cannot be reported as pauses

    cpp/rn-llama.cpp:682-683    if (result == -2 && !governor->failed()) {
    cpp/rn-governor.h:16-17     return rc != 0 && (rc != -2 || engine_failed);
    vendor/llama-governor.cpp   failed = true; return rc;   (any nonzero rc latches the governor)

The raw `llama_decode` rc=-2 (ALLOC_FAILED) goes through the governor's rc site, latches `failed`,
sets the binding's shadow, and the classifier is skipped; the completion then takes the unchanged
`LOG_ERROR("failed to eval, …")` + `embd.resize` + `has_next_token = false` path
(`rn-completion.cpp:1728,1736-1737`). Conversely a flow-control -2 with an unfailed governor always
gets a label (all four branches assign), so the completion's `decode_rc == -2 ? governorPause() :
nullptr` (`rn-completion.cpp:1713-1714`) cannot fall through to the eval-error branch.

## CONFIRMED — `last_router_rule == 0` is a valid Wait stamp, not stale

    llama-governor-policy.cpp:206-212  early Wait/Abort returns before any rule assignment
    llama-governor-policy.cpp:235-244  table==0 branch: Wait returns with rule still 0
    llama-governor-policy.cpp:270      result.rule = … only on the admitted/chunk path
    llama-governor-runtime.cpp:73      stats_.last_router_rule = admission.rule;   (before the Wait return)
    llama-governor-runtime.cpp:54      refresh_policy_stats(): last_router_rule = policy_.prefill_rule(); (decode entry)

`result.rule` is 0 by default (`policy.h:15`) and the Wait branches return before `:270`, so the
runtime writes 0 exactly when the admission waited; admitted/chunk returns write {2,3,9}. The
classifier reads the stats after its own decode, and the single-token branch does not use the rule
(it uses `decode_requires_reload`, rewritten by `select_decode` for that call). `unexplained`
(non-zero-rule -2) has no live producer with the 1b70069cb engine (the `count <= 1` path is
unreachable) — a defensive label, correctly never called thermal.

## REFUTED — speculative/MTP gap

    cpp/rn-llama.cpp:748,755    if (governor_enabled) { … if (has_speculative_mode(params_)) … }
    cpp/rn-completion.cpp:847-849   if (parent_ctx->hasGovernor()) { return false; }

Governor mode refuses/falls back on speculative and MTP, so the `parent_ctx->decode(spec_batch)`
sites (`rn-completion.cpp:1036,1135`, `rn-slot.cpp:533,615`) cannot produce a governor pause in
governor mode. No typed-pause gap there.

## CONFIRMED — no leak

`governor_pause = "";` in `rewind()` (`rn-completion.cpp:104`, b23fc083) closes the
`1f841412` cross-completion leak (luna's finding 2); the JSI emits `pause_reason` only when
non-empty (`JSICompletion.h:188-192`); the warn is literals + counts
(`rn-completion.cpp:1722-1723`). The reset covers every entry (`RNLlamaJSI.cpp:1175`, `rn-tts.cpp:1959`).

## PLAUSIBLE — guards and the host side

- The jest guards are source-slice substring checks; luna's scratch shows a `if (false)` dead
  rewind reset still passes. Declared in the commit ("what stays unpinned without a native build").
  Test-quality, not runtime.
- The app side at its current HEAD (`bad66ec2`) knows all four literals:
  `thermalResume.ts:23 GovernorPauseReason = "thermal" | "profile" | "reload" | "unexplained"`,
  `:37 reason === "unexplained"`, and `governorPauseEnding` maps any non-thermal to
  `"serviceUnreachable"` (`thermalResume.ts:50-56`) — so an `unexplained` pause is never
  cool-and-resumed and never silently finalized. Luna's app-gap finding is REFUTED at this HEAD
  (it was true for the earlier app state she read).
- `src/types.ts` and the regenerated `lib/typescript/types.d.ts` carry the same four-literal union
  (`types.d.ts` grep "unexplained" = 2).

## Left as declared

No native build or native runtime test was run (the writer's and luna's environment); the
classifier's engine rule-stamping is verified here by reading the vendored engine shipped in
`531b477b`/`1b70069cb`, not by execution.
