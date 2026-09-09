# §3 session contract — reconnaissance of kalsa main@332aeed (2026-09-09)

Author: deepseek-v4-flash (Paseo agent 4a1da067), read-only. Verified by the orchestrator on the
quoted lines marked ✔ below. Plan reference: `kalsa/docs/PROPOSTA-OTTIMIZZAZIONE-CHAT-2026-09-08.md` §3.
Doc §3 line refs (restore-disabled `LlamaService.ts:1720`, save-skip `:2078`, snapshot `:3756`) match main.

## 1. Session save
- Entry `saveEngineSession` `LlamaService.ts:2073`. Triggers: every finished turn (`AiChatPage.tsx:2784`,
  FIFO "saveEngineSession FIRST, then memory extract" `:2766`), app background (`AppShell.tsx:2878-2881`),
  chat switch (`AppShell.tsx:2236-2241`), new conversation (`:2299`).
- Native: `ctx.saveSession` `LlamaService.ts:2178` → llama.rn `JSISession.h:153/177` `llama_state_save_file`
  → `llama-context.cpp:3000` `state_write_data`, writes KV **and** memory (`:3093`, recurrent planes
  `llama-memory-recurrent.cpp:861+`).
- Identity: `sessionStem = ${modelId}__${conversationId}__${promptEnvHash}` (`sessionKey.ts:47-57`) ✔;
  `promptEnvHash = computePromptEnvHash(locale, facts, hasTools, toolNames, blockFormat)`
  (`sessionPersistence.ts:322-345`). Sidecar `SessionMeta` (`:19-51`): formatVersion, nCtx, cacheTypeK/V,
  historyHash, historyMessageCount, promptEnvHash, mtpNMax, specType, engineKnob, conversationId,
  bakedUserTails; compared by `sessionMetaMismatchField` `:366-390`.
  **GAP: quant, template and engine version are NOT part of the identity.**
- Governor: save skipped `:2076-2079`, restore disabled `:1719-1724`, snapshot `:3756`, native throws
  (`JSISession.h:155-157`).

## 2. Restore
- Boot: `AppShell.tsx:3565 getBootHistoryHash()` → `initEngine` → `tryLoadEngineSession` `LlamaService.ts:1723`.
  Chat switch: `restoreEngineSession` (`LlamaService.ts:2559-2570`).
- Match: app layer `sessionHistoryPrefixAccepts` (`sessionPersistence.ts:180-218`, "content hash of the
  prefix is the only history check — never token counts", suffix must be role user) + meta mismatch;
  engine layer `find_common_prefix_length` → `n_past = n_common` (`rn-completion.cpp:467/534`).
- Reuse telemetry: `KALSA_TELEMETRY.tokensCached = tokens_cached` (`turnTelemetry.ts:170`) = n_past at
  completion start; `KALSA_KVPREFIX embd=… text_tokens=… n_common=…` (`rn-completion.cpp:472`);
  load logs `tokens` (`LlamaService.ts:2497`). **No single "reused" line: derive from tokensCached + promptMs.**

## 3. Hybrid / recurrent (LFM2.5)
- Whole-context save/load (not seq_*); `n_rs_seq = 0` everywhere (`llama-context.cpp:3431`, `rn-llama.cpp:810`).
- Upstream issue 25913 scenario is guarded: after load `resumable = pos_max + 1 == n_tokens`
  (`JSISession.h:109-118`); if not → seq_rm + full clear → `tokens_loaded=0` → app rejects → cold, never a
  false warm. "Kalsa patch #2" `:118-132` registers the restored memory as a state checkpoint so recurrent
  `loadPrompt` adopts it (the §7.29 n_past=0 defect). Decode path `rn-completion.cpp:575-589`.
- Residual: resumability is KV-position only; nothing verifies the restored RNN tensors match the prefix (PLAUSIBLE).

## 4. Prefix stability (what precedes the last user message)
- System prompt `buildSystemPrompt(locale, withTools, facts)` (`memoryPrompt.ts:29-46`); facts in system only
  when `!MEMORY_FACTS_ON_USER_TAIL` (`ttftFlags.ts:27`; flag is true on main).
- Operative block only for compaction/research turns (`LlamaService.ts:2649-2685`); baked user prefixes
  (`ttftFlags.ts:38`, `LlamaService.ts:2966-2973`); tools schema hashed in promptEnvHash.
- Last user carries persona tail, facts tail (`:2980-2984`), notes (`AppShell.tsx:4858`, cap 24 000 chars).
- No date/time in the prompt (CONFIRMED absent).
- Locale/tools/blockFormat change → promptEnvHash miss → cold; idle change → `notifyStaticPrefixInputs`
  (`:864-900`, clearCache + re-prewarm).
- **Prewarm renders with `enable_thinking:false, thinking_budget_tokens:0` (`:783-786`) ✔ while real turns
  send `enable_thinking:true` (`:3242`, `thinkingBudgets.ts:88-99`).** Divergence is template-dependent and
  UNMEASURED → device test 12.

## 5. Stop / edit / regenerate / tools
- Stop: `handleStop` `AiChatPage.tsx:2917` → `engine.stopCompletion()` (`LlamaService.ts:2782-2795`); KV kept in
  RAM (`:3662-3669`), **no saveEngineSession in the stop path** — relies on the background flush.
- Edit = the regenerate flow (`editMessage` `AiChatPage.tsx:3092-3210`, `edited` flag): truncates the store,
  re-sends; KV never truncated by the app, engine re-decodes only the tail via n_common + checkpoints
  (`rn-completion.cpp:563-600`). No dedicated regenerate button.
- **Tools: after a tool round `kvReproState = tool_calls_detected` (`:3188` ✔ / `:3355`) → save skipped
  (`:2117` "kv_not_reproducible after a tool turn" ✔) → `.kvs` stays at the pre-tool prefix → boot restore
  is COLD for any conversation that used a tool.** Tools are on by default: this is a product-visible gap.

## 6. Side jobs on the chat context
- `extractMemory` (`:3836-3938`): same engine, FIFO, `enable_thinking:false` `:3888`; default
  `EXTRACT_MEMORY_PRESERVE_CHAT_KV` (`ttftFlags.ts:48`) snapshots/restores the `.kvs`; snapshot failure → skip.
  A send queues behind it (latency, not corruption).
- **`translateText` (`:4054` ✔) and `completeOnce` (`:4143`) clearCache first → they DESTROY the chat KV prefix.**
- Prewarm (`:714-849`) skips when chat KV is held (`:736-739`); FIFO is the join.
- Embeddings run on a separate embedder context.

## 7. Device suite — required cases (each tied to a code path)
1. Cold boot + real warm restore: `KALSA_SESSION op:load ok:true tokens=N>0` AND next `tokensCached≈N`.
2. Restore-then-extend: `tokensCached == tokens_loaded`, `promptMs` ≪ cold.
3. Edit = partial re-prefill: `KALSA_KVPREFIX n_common` == tokens before the edit.
4. Stop mid-stream then send: reuse up to divergence; no `stale_kv_completed_turn` false trigger.
5. Tool turn → `KALSA_SESSION op:save ok:false reason:kv_not_reproducible`; `.kvs` stays pre-tool.
6. Governor on → restore never runs, save skipped `reason:"governor-mode"`.
7. Hybrid real reuse (LFM2.5): `KALSA_KVRESUME resumable=1` and `tokensCached>0`; else `tokens_loaded:0` cold.
8. Memory extract preserves KV: next `tokensCached` unchanged, `.kvs` intact.
9. translate/completeOnce nuke: next send cold — decide whether that is acceptable.
10. Meta mismatch fail-closed: change n_ctx/cache type → `meta_mismatch` + cold.
11. Settings change while idle → clearCache + `KALSA_PREWARM start`; next launch cold via promptEnvHash.
12. Prewarm↔real prefix parity: first send after prewarm → `n_common` == prewarmed prefix length.

## Hostile gaps (ordered by product impact)
1. Tool turns make the session unsaveable → cold reopen for every conversation that used a tool (§5).
2. Prewarm/extract render without thinking, real turns with thinking → possible prefix miss (§4, test 12).
3. translate/completeOnce clear the chat cache (§6).
4. quant/template/engine version absent from the session identity (§1).
5. Stop path does not save; a kill in that window loses the last prefix (§5).
6. RNN-state identity never verified on restore (§3).
7. No explicit per-turn reused-token log line (§2).
