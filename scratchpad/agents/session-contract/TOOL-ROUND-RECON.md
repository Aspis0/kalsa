# Why a tool round makes the session unsaveable — recon of kalsa main@332aeed (2026-09-09)

Author: mimo-v2.5 (Paseo agent dda60251), read-only; orchestrator verified :2117, :3188 and the
`clearCache` sites. Companion of `RECON-MAIN-332aeed.md` (gap #1).

## Mechanism
- During a turn the engine receives `currentMessages` rebuilt from the persisted history
  (`LlamaService.ts:2933-2947`). The tool loop appends messages that never reach the chat store:
  auto-inject RAG path `:3175-3188` (`{role:"assistant", tool_calls:[autoCall]}` + `{role:"tool", …}`),
  tool-loop rounds `:3526-3538` (assistant+tool_calls, then one `tool` message per executed/skipped call).
- The store's `Message` type (`AiChatPage.tsx:221-258`) has only `role: "user"|"assistant"` and `text`;
  `buildPersistableMessages` (`:536`) keeps the final assistant bubble (+ `modelEmittedText` for prefix replay).
- Next turn: rendered history = final text only; KV = tool_calls + tool result + synthesis → divergence →
  `kvReproState.reproducible=false` → `shouldSaveSession` returns `kv_not_reproducible` (`:2126`) → no save.

## State machine `src/engine/kvReproducibility.ts`
`turn_start` keeps `reproducible`, clears `turnInjected` (:77); `tool_calls_detected` → `{false,true}` (:79);
`miniapp_stripped` → reproducible=false (:81); `clean_completion` returns the state unchanged when
`turnInjected` (:83) else `{true,false}`; only `dispose` resets (:87, called at `LlamaService.ts:1845`).
**Once a tool fired, the conversation never becomes saveable again in that process.**

## What HARNESS_FINDINGS measured
- §7.12: tool round = total cache loss (10/10 at reuse 0; 3-4 s hit vs 195-405 s miss), thinking off.
- §7.37: re-measured, 15/16 seeds kept 90-98 % **in-process** reuse after a tool (engine `n_common` finds the
  divergence at the last exchange); the 1/16 loss had shape `rounds:1, executed:1` (turn ended with a tool
  result no stored assistant answer accounts for). Tool-round replay demoted to an edge-case fix.
- All with `thinking: "off"`; never re-measured in the shipping config.
- **Not covered by §7.37: the disk save.** In-process reuse survives; the reopen after a restart is cold
  for every conversation that used a tool, because the last saved `.kvs` predates the tool turn and the
  app-layer acceptance (`sessionHistoryPrefixAccepts`, suffix must be a single user message) rejects it.

## Fix shapes
(a) Persist the tool round in the store as engine-internal messages (hidden from the UI) so the render
    reproduces the KV. Highest fidelity; cost: tool payloads (document chunks, web pages) stay in the
    rendered history forever and eat the 8k context every turn; bigger `.kvs`.
(b) Keep saving the pre-tool prefix (already the case) and let the reopen accept a `.kvs` that matches a
    proper prefix of the history with any suffix, re-prefilling only the last exchange. Cheapest; needs the
    reason behind the "suffix must be user" rule (`stale_kv_completed_turn`) understood before relaxing it.
(c) Snapshot/restore around the tool loop like `EXTRACT_MEMORY_PRESERVE_CHAT_KV` (`:3797-3934`). Keeps the
    KV clean of tool content, but the synthesis answer then has no tool context in KV either → next turn
    re-prefills the answer only. Infrastructure exists; per-turn snapshot cost unknown on phones.

Proof for any fix: `KALSA_SESSION {op:"save", ok:true}` after a tool turn, and on the post-restart turn
`KALSA_TELEMETRY tokensCached` ≈ tokens loaded with `promptMs` ≪ cold.

Decision deferred to the session-contract window (16-18/09) with the S23 restore numbers in hand.
