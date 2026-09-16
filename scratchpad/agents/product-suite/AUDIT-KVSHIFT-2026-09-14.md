# KV-shift audit — 2026-09-14

Verdict: **FIX**. Do not ship this as-is. The native refusal avoids the unsafe position remap, but the JS contract and recovery path are broken. The patch is not ready to apply as a product fix.

## Claim audit

**CONFIRMED — `ctx_shift` is enabled on the S23 text path.**

> `src/engine/LlamaService.ts:1650` — `const isMultimodal = Boolean(options.mmprojPath);`  
> `src/engine/LlamaService.ts:1684` — `ctx_shift: isMultimodal ? false : true,`

**CONFIRMED, narrowly — the decode-time K-shift branch refuses `seq_rm`/`seq_add`.**

> `patches/llama.rn+0.12.8.patch:1922-1927` — removes `n_discard`, `llama_memory_seq_rm`, and `llama_memory_seq_add`.  
> `node_modules/llama.rn/cpp/rn-completion.cpp:1124-1127` — `KALSA_KVSHIFT refused ...`.  
> `node_modules/llama.rn/cpp/rn-completion.cpp:1128-1133` — `embd.resize(n_past)`, `has_next_token = false`, `truncated = true`, `return result`.

This does **not** mean the file has no `seq_rm`: ordinary prompt reuse still calls it at `node_modules/llama.rn/cpp/rn-completion.cpp:597`.

**CONFIRMED — no `context_full` and no `clearStateCheckpoints()` in that decode refusal branch.**

**REFUTED, if stated globally — prompt overflow still sets `context_full`.**

> `node_modules/llama.rn/cpp/rn-completion.cpp:477-486` — `num_prompt_tokens >= n_ctx` logs refusal, sets `context_full = true`, and returns.

> `context_full = true;`  
> `return;`

**REFUTED — the current refusal does not produce the old `tokensCached=4304` arithmetic.** The removed code used `n_left = n_past - n_keep - 1` and `n_discard = n_left/2` (`patches/llama.rn+0.12.8.patch:1922-1923`), so `n_past=8191,n_keep=0` gives `4095`. The current code never subtracts it; it only does `embd.resize(n_past)` (`:1128-1129`). The bridge reports `tokens_cached = n_past` (`node_modules/llama.rn/cpp/jsi/JSICompletion.h:188-195`). The 4304 observation describes the old shift path, not this one.

**PLAUSIBLE — the supplied old trace is arithmetically consistent.** `8191 - 4095 + 208 = 4304`; the source cannot confirm the exact `~207` generated-token count or the provenance of that log.

**CONFIRMED — the pin and skip-checkpoint guard are untouched in source.**

> `native/kalsallama.pin:2-4` — repo/branch/commit remain unchanged.  
> `node_modules/llama.rn/cpp/rn-completion.cpp:234-236` — `KALSA_KVRESUME skip_ckpt` remains.

## Blocking defects

1. **`truncated=true` is silently reported as success.** The native result exposes both flags:

   > `node_modules/llama.rn/cpp/jsi/JSICompletion.h:188-190` — `truncated`, `context_full`, `interrupted`.

   JS only handles `context_full`:

   > `src/engine/LlamaService.ts:3878-3885` — `if (result.context_full) { ... err.code = "context_full"; ... }`

   There is no `result.truncated` branch.

   The no-tool path immediately finalizes:

   > `src/engine/LlamaService.ts:3931-3938` — `emitFinalText(result)` then returns.  
   > `src/engine/LlamaService.ts:3590-3595` — calls `onDone()`.

   The UI consequently clears `interrupted`, marks the bubble non-streaming, persists it, and saves the engine session:

   > `src/screens/AiChatPage.tsx:2601-2610,2635-2640,2703-2735`.

   No `clearCache()` is triggered. `finally` even marks the native KV as held:

   > `src/engine/LlamaService.ts:4274-4278` — `kvHoldsChatSession = true`.

2. **Prompt overflow has no working recovery loop.** `truncatePrompt()` still exists (`node_modules/llama.rn/cpp/rn-completion.cpp:378-398`), but its only call is removed (`patches/llama.rn+0.12.8.patch:1631`). The overflow branch now sets `context_full`; JSI converts that into a rejected promise:

   > `node_modules/llama.rn/cpp/jsi/RNLlamaJSI.cpp:1284-1287` — `throw std::runtime_error("Context is full");`

   `LlamaService` forwards the raw exception without adding `code="context_full"`:

   > `src/engine/LlamaService.ts:4263-4270`.

   AppShell’s rebuild is gated on that missing code:

   > `src/app/AppShell.tsx:5771-5780`.

   In other words, the exact path the patch claims to avoid does not reach `n_common`, and the anchored retry mechanism is disconnected.

3. **The next-turn “10k vs native 8k” premise is wrong in an important way.** While KV is held, non-anchored assembly is forced to start at zero:

   > `src/engine/windowKvInvariant.ts:101-117` — “While KV is held, always start=0.”  
   > `src/app/AppShell.tsx:5307-5319` — positive `nPast` contributes to `kvHeld`.

   If that produces a prompt at or above 8192 tokens, native checks length at `:477` **before** `find_common_prefix_length` at `:498`; there is no `n_common` result to reconcile. It throws instead. Smaller prompts can reach `n_common`, but the 10k case cannot.

4. **Release logging leaks prompt identity.** This is not debug-only:

   > `rn-completion.cpp:463-469` — `prompt_tokens =` followed by every token ID.  
   > `rn-completion.cpp:502-505` — `KALSA_KVPREFIX ... this=%p`.  
   > `rn-completion.cpp:551-556` — `shared_ids=[%s] embd_ids=[%s] text_ids=[%s]`.  
   > `rn-completion.cpp:571-580` — `cache_head=[%s] prompt_head=[%s]`.  
   > `rn-llama.h:262-264` — `LOG_INFO`/`LOG_WARNING` call `log` unconditionally.  
   > `rn-llama.cpp:201-210` — warnings/info go directly to Android logcat.

   The Android debug define only gates detokenized snippets (`CMakeLists.txt:162-164`); token IDs remain in release. Token IDs are sensitive conversation metadata and can be mapped back with the tokenizer. The pointer leak is needless. Remove or compile-gate these diagnostics before release.

5. **The test is a source-string smoke test, not validation.** The only assertions are patch substrings and a diff-line regex:

   > `src/engine/kvShiftRefuse.test.ts:13-25`.

   Local result: `1` suite passed; `2` tests passed; `0` failed. It does not compile native code, invoke `nextToken`, inspect `truncated/context_full/has_next_token`, check `n_past`/`embd`, exercise `clearCache`, test the rejected-promise path, or verify next-turn persistence. It can pass while the JS integration above is broken.

## Bottom line

The unsafe K-shift is indeed removed, and the pin/skip-checkpoint edits remain. That is the only clean win. The current behavior is either a falsely successful partial turn or a context-full error with no anchored recovery, while release logs expose token IDs. **FIX** the result contract, recovery signaling/window rebuild, and logging; then add an integration test before considering ship/apply.
