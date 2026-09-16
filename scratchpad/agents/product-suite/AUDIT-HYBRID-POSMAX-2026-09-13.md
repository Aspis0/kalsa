# Hybrid `pos_max` audit — 2026-09-13

VERDICT: FIX

The arithmetic is not a native regression test. The change is not safe to apply.

## CONFIRMED

1. **Full checkpoint recovery duplicates the last prompt token.**

   > `patches/llama.rn+0.12.8.patch:1564-1572`  
   > `llama_pos k = ...n_tokens();`  
   > `llama_memory_seq_rm(kv, 0, k, -1);`  
   > `if (total_tokens > 0 && k >= total_tokens) k = total_tokens - 1;`  
   > `n_past_out = k;`

   When `k == total_tokens`, native memory is trimmed at `total_tokens`, so it still contains position `total_tokens - 1`; only the local counter is decremented. `loadPrompt` then feeds `embd[total_tokens - 1]` (`node_modules/llama.rn/cpp/rn-completion.cpp:584-587`), while a no-position batch starts at `memory->seq_pos_max()+1` (`vendor/kalsallama-cpp/llama-batch.cpp:90-107`). That is a duplicate token at the next position. The old `total_tokens - 1` selection bound was the correct safety constraint.

2. **`pos_max+1 == n` is not a hybrid-consistency proof.**

   > `vendor/kalsallama-cpp/llama-memory-hybrid.cpp:225-228`  
   > `return std::min(mem_attn->seq_pos_max(seq_id), mem_recr->seq_pos_max(seq_id));`

   The save gate and capture gate inspect that minimum (`patches/llama.rn+0.12.8.patch:893-896`, `:230-236`). One subcache can be longer while the aggregate passes. A full save can therefore serialize a long recurrent tail under a short token list. Checkpoint capture is worse: `PARTIAL_ONLY` writes only recurrent state for ordinary hybrid memory (`vendor/kalsallama-cpp/llama-memory-hybrid.cpp:242-245`). The recovery `seq_rm_ok` check reduces one failure mode, but does not repair the save/capture invariant or prove both domains agree.

3. **Checkpoint lifetime is now unsafe.**

   > `patches/llama.rn+0.12.8.patch:1737-1743`  
   > `llama_memory_clear(kv, false);`  
   > `/* clearStateCheckpoints removed */`

   A context replacement/failed recovery clears live KV but leaves the snapshots. `loadSession` also does not establish a checkpoint epoch. Worse, `captureStateCheckpoint` returns early when token prefixes and lengths match (`node_modules/llama.rn/cpp/rn-completion.cpp:239-245`), so a stale same-length snapshot is not replaced after a correct cold re-prefill. Token equality is not state identity. An old false-label can survive, be selected again, or remain permanently if restore itself fails: the new loop returns before erasing or trying a shorter candidate (`node_modules/llama.rn/cpp/rn-completion.cpp:337-340`).

4. **The claimed `.kvs` preservation is narrow, not a fix.**

   The main JS save path does write native state to a temporary file and deletes only that temporary file on failure (`src/engine/LlamaService.ts:2395`, `:2533-2544`); the native refusal also precedes sidecar/file writes (`patches/llama.rn+0.12.8.patch:897-906`). That part is confirmed. It leaves the live inconsistent KV and stale RAM snapshots untouched, so a later extraction or prompt can still re-enter the bad state.

5. **The new restore behavior deliberately regresses reuse after a shorter divergence.**

   > `patches/llama.rn+0.12.8.patch:849-857`  
   > `captureStateCheckpoint(embd, embd.size());`

   Message-boundary captures were removed. `findStateCheckpoint` rejects any checkpoint longer than `n_common` (`node_modules/llama.rn/cpp/rn-completion.cpp:302-322`). A fresh process that restores a long prompt and then diverges before its end has no eligible checkpoint and falls to full clear (`node_modules/llama.rn/cpp/rn-completion.cpp:605-622`). `skip_ckpt` makes this worse when the aggregate frontier is not exact: safe refusal, but no replacement and no recovery guarantee.

6. **The public partial-save API is broken.**

   `saveSession` still exposes `options.tokenSize` (`node_modules/llama.rn/src/index.ts:658-663`) and still computes a partial `save_size` (`node_modules/llama.rn/cpp/jsi/JSISession.h:187-188`). The new unconditional exact-frontier gate (`:893-902`) rejects a legitimate shorter save on a pure transformer whose live KV is longer. Either preserve partial-save semantics or explicitly remove/change the API.

7. **Production logs expose token IDs and spam warnings.**

   > `patches/llama.rn+0.12.8.patch:1624-1627`  
   > `KALSA_KVPREFIX ... this=%p`  
   > `patches/llama.rn+0.12.8.patch:1673-1678`  
   > `KALSA_KVDIVERGE ... shared_ids ... embd_ids ... text_ids`

   The detokenized snippets are debug-gated, but token IDs are not. `WARNING` maps directly to Android warning logcat in release (`node_modules/llama.rn/cpp/rn-llama.cpp:191-210`). Token IDs are reversible with the model vocabulary and can disclose user text; the prefix warning runs for every prompt. Remove or gate these diagnostics and rate-limit the failure logs.

8. **The tests provide no native coverage.**

   > `src/engine/sessionPersistence.test.ts:321-331`  
   > `src/engine/sessionPersistence.ts:633-647`

   The S23 test only evaluates constants and pure predicates. It does not instantiate two hybrid memories, exercise `n_rs_seq`, call `seq_rm`, restore partial state, test batch positions, or cross a clear/load boundary. CI only runs `tsc` and Jest (`.github/workflows/ci.yml:40-44`). The reported 24/24 therefore proves almost nothing about this patch. `npm test` is not defined in `package.json`.

## PLAUSIBLE

- The generic failure mechanism is real: recurrent rollback returns false when the requested rollback exceeds `n_rs_seq` (`vendor/kalsallama-cpp/llama-memory-recurrent.cpp:181-189`). `2441 - 1827 = 614` is confirmed arithmetic; the specific device incident being caused by this path remains unproven without a native trace or fixture.
- The retry loop can operate on partially mutated attention state for hybrid-ISWA: recurrent removal runs first, then ISWA removes both subcaches with non-short-circuit `&` (`vendor/kalsallama-cpp/llama-memory-hybrid-iswa.cpp:148-155`, `vendor/kalsallama-cpp/llama-kv-cache-iswa.cpp:111-117`). The recovery code does not restore a clean baseline before trying the shorter checkpoint (`node_modules/llama.rn/cpp/rn-completion.cpp:343-359`).
- Repeated `skip_ckpt`/stale-snapshot paths can starve recovery and turn every later divergence into a cold prefill. That is a performance failure even when the clear prevents incorrect output.

## REFUTED

- **Infinite-loop / erase-by-index claim:** not supported. `eraseStateCheckpointAt` erases by token count, not vector index (`node_modules/llama.rn/cpp/rn-completion.cpp:190-195`), and `search_max` decreases after each trim failure (`:352-360`). The trim-failure loop is finite. Restore failure is the separate, confirmed fallback bug above.

Minimum required before applying: restore the old `total_tokens - 1` selection rule (or trim and revalidate the returned frontier), validate both hybrid subcache frontiers rather than their minimum, invalidate/epoch snapshots whenever memory is replaced, remove invalid candidates on restore failure, and add a native hybrid integration test covering the 614-token rollback case and the full-checkpoint case. 
