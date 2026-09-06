# AUDIT — app commit 28424c3 (logit-oracle hook)

## Findings

F1 — CONFIRMED (pre-sampler guarantee). rn-completion.cpp nextToken hunk:
`if (bench_raw_probs > 0) { result.raw_probs = benchRawTopProbs(parent_ctx->active_ctx(),
vocab, bench_raw_probs); }` runs BEFORE `common_sampler_sample(ctx_sampling,
parent_ctx->active_ctx(), -1)`. Per llama.cpp semantics the sampler chain fills and filters
the `cur_p` candidate array (a copy built from the logits) — grammar, logit-bias and penalty
samplers mutate `cur_p` entries, not the context's logits buffer — so the read is genuinely
pre-sampler/pre-grammar/pre-bias. `-1` = the last batch row, matching the pre-existing sample
call (the same `-1`); `llama_synchronize` before the read. Numerics correct:
max-subtracted exp-sum, `log_norm = max_logit + ln(exp_sum)`, `logprob = logit − log_norm`;
`partial_sort` to top_N (N = min(count, vocab)); NaN/inf max_logit → `{}` safe.
F2 — CONFIRMED (forced ids). Exhaustion: `if (bench_force_ids_enabled &&
bench_force_index >= bench_force_ids.size()) { has_next_token = false; return result; }` —
clean stop, no extra sampled token, EOS-like; the forced `new_token_id` flows through the
SAME accept/next-batch code as a sampled token (KV/context identical); the JSIParams hunk
RE-sets `bench_force_ids.clear(); bench_force_index = 0; bench_force_ids_enabled = false;`
at every init with a strict validation (numbers only, finite, floor(id)==id, id ≥ 0, else
clear-and-ignore — a malformed list is ignored, not a crash). Production unreachable: the
params enter only via LlamaService's `benchSampling === "greedy" ? await
readBenchOracleParams() : {}` gate (LlamaService:2796-2797) and `applyBenchSampling`.
F3 — CONFIRMED (streaming/log): `createTokenResult` adds tok/forced/raw_probs when
raw_probs non-empty; the TS `emitBenchProbs` logs
`KALSA_BENCH_PROBS {turnId, step, forced, tok, top}` with `Number(logp.toFixed(4))` —
4 decimals; `benchProbStep` increments per emitted item, step 0 = first generated token,
aligned with the KALSA_BENCH_TOKENS ids order (same completion stream).
F4 — CONFIRMED (patch integrity): hunks = JSICompletion.h +12 (createTokenResult),
JSIParams.cpp +39 (param parsing), rn-completion.cpp +~50 (incl. `#include <cmath>`,
benchRawTopProbs ~37 lines, nextToken +13), rn-completion.h +14 (raw_token_prob struct +
4 fields), the .d.ts/.ts TypeData/NativeCompletionParams hunks — total ≈ the claimed
160+/4- ✓; types (llama_token, llama_token_data, std::vector, size_t) all included; the
default path (bench_raw_probs=0, force disabled) is byte-identical apart from the two guard
branches and `result.forced = forced` (a struct field write).
F5 — CONFIRMED TS: keys parsed only under greedy; malformed force_ids → console.warn +
ignored (verified in readBenchOracleParams: `Number.isSafeInteger` for every id, else warn);
probs==="1" → bench_raw_probs=5 (matches the top-5 oracle contract).
F6 — MINOR: the fallback-completion path (LlamaService:3571-area) ALSO calls emitBenchProbs
under the same turnId and the same `benchProbStep` counter — a governor-fallback retry would
log a second prob stream with continuing step numbers, and the oracle helper's per-step dict
keeps the last line — a step-alignment/masking hazard if a fallback ever fires. Mitigated
by the row-void governor_fallback pre-registration (the helper then never runs on that row),
but gate the emit to the primary completion path for hygiene.
F7 — CONFIRMED privacy: nothing is logged outside bench mode (raw_probs only when the
bench_raw_probs>0 branch sets them; the emit is reached only in the greedy path).

## Verdict

GO for pushing and building the APK. 0 blockers, 0 majors, 1 minor (F6: restrict
emitBenchProbs to the primary completion path). The pre-sampler guarantee, forced-id
semantics (clean exhaust, per-init reset, production-unreachable), streaming format,
numerics, patch integrity, default-path neutrality, and TS validation are all confirmed.
## Audit #27 — deepseek (Reviewer bench, pi/opencode-go/deepseek-v4-flash max), agent e6df762c, 6/09 14:00 EDT
Target: app commit 1ec63a0 (bench toolchoice=none gate) vs 28424c3. Verdict **GO-WITH-FIXES**.
CONFIRMED gated: document_chat pre-pass (LlamaService.ts:3081-3084), tools spread (:3210), fallback parser (:3293);
pref absent → "auto" → parent behaviour byte-identical (benchConfig.ts:383). Residuals (bench fidelity only):
1. system prompt still `systemPromptWithSearch` under `hasTools` (LlamaService.ts:2900 → :456; en.ts:1072 "You have a
   web_search tool…") → the model is still told it can search;
2. KV prefix prewarm still passes `tools` (LlamaService.ts:770-771, EAGER_PREFIX_PREWARM=true ttftFlags.ts:57) → the
   prewarmed prefix never matches the tool-free turn → re-prefill every turn (would distort TTFT in the TF runs);
3. structured execution path (:3423) unguarded (defense in depth).
Test hygiene: new tests cover only the pure helper; the gate is untestable without a heavy llama.rn mock.
Action: round 2 on Luna 467e65e3 closing 1-3 → re-audit → rebuild both APKs. APKs from 1ec63a0/14be59b NOT used.

## Audit #28 — deepseek e6df762c (same agent), 6/09 14:35 EDT — app commit 19b67b6 vs 1ec63a0
Verdict **GO-WITH-FIXES** (residuals are production micro-races, not correctness; instrument accepted as is).
CONFIRMED closed: system prompt tool-free under "none" (LlamaService.ts:2910), prewarm prefix == turn prefix in BOTH
modes (prewarm :698-699 vs turn :2910/:2916, same hash fn prefixPrewarm.ts:138; MEMORY_FACTS_ON_USER_TAIL=true makes
facts irrelevant), env hash self-consistent (save :2565 / restore :2362), structured guard honest (:3297, :3339;
markup stripped :2993; KALSA_BENCH_TOKENS still on the path). REFUTED: unhandled rejection (getToolChoiceMode has
try/catch → "auto"), sync-return reliance (callers AppShell.tsx:2069/3041/3359 ignore the promise).
Open (production, perf only, not on the R5 path): `busy` decided inside the `.then` (stale by one AsyncStorage read;
direction benign = skips more); two rapid mode-less `queueStaticPrefixPrewarm` calls with different hashes can enqueue
two prewarms (wasted prefill); 3041/3359 floating promises (add `void`); 3-round loop still on ungated hasTools (dead
weight). → TODO cleanup commit later on feat/governor-in-app, not blocking.
Decision: APKs from 19b67b6 (normal) and e54f529 (fault) are the R5 instruments.
