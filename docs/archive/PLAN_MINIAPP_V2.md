# PLAN — Miniapp v2: native tool calls + stolen-where-possible rendering — rev 2

Rev 2, 2026-08-25: incorporates `docs/archive/AUDIT_MINIAPP_V2.md` (online + code verification).
Problem: no small local model ever managed to emit the `miniapp_v1` JSON envelope in prose.
Fix the *invocation*, keep the *registry*.

## Target architecture

```
LFM2.5-2.6B (local, on-device)
  → native tool call { name, args }     ← grammar-constrained. ⚡ THE GRAMMAR ENGINE
  → validation (+ bounded retry)          ALREADY EXISTS: kalsallama overlay builds
  → whitelisted RN registry               tool-call GBNF from the chat template with
  → interactive block + typed events      lazy triggers (common/chat.cpp:675,1021-1101,
                                          json-schema-to-grammar.h), and llama.rn
                                          already passes response_format/json_schema
                                          to native (used in-app, LlamaService.ts:3827).
```

Rev-1 claimed this was "the piece nobody external can give us" — **REFUTED by audit**: the
overlay already implements it. The work is WIRING, not writing a grammar engine.

## What we steal, from whom

| Source | License | Steal | ⚡ Audit correction |
|---|---|---|---|
| json-render (`vercel-labs`, ~16k★) | Apache-2.0 ✓ verified | `@json-render/react-native@0.20.0` exists; catalog+Zod+JSON-tree real | First candidate to adopt wholesale; else copy catalog core |
| AI SDK Core (`vercel/ai`) | Apache-2.0 ✓ | Tool contract shape: names, schemas, active-tool filtering | ⚡ `strict`/repair are **experimental**, and repair re-invokes the MODEL — "deterministic repair" withdrawn; our ladder is deterministic because rung 2 is grammar-constrained re-decode, not model retry |
| CopilotKit (~37k★) | MIT ✓ | `useComponent` RN semantics (docs page verified) | ⚡ `CopilotKit/generative-ui` repo has NO LICENSE FILE — reference docs only, copy nothing from that repo |
| A2UI (~16k★) | Apache-2.0 ✓ | Flat IDs + incremental patch concepts | ⚡ community RN renderer is ~9★ on legacy v0.8 protocol — concepts only, never code |
| Tool UI (assistant-ui) | MIT ✓ | Schema-first result UX patterns | Implement with OUR components |
| CisWire (ours) | — | Enforcement thesis: guarantees independent of model strength | — |

License duty corrected: vendoring Apache-2.0 code ⇒ retain LICENSE + **§4(b): carry
NOTICE headers on MODIFIED files** ("vendor with NOTICE" was too vague). MIT ⇒ keep
copyright lines.

## Phases

### P0 — Vendoring spike
Demo catalog through `@json-render/react-native` in a throwaway Expo screen, offline.
Exit: table+chart renders natively < 16 ms/frame on S23.

### P1 — Grammar-constrained transport (wiring, not invention)
0. ✅ Verified on disk: overlay grammar path (chat.cpp) + `response_format` route
   (LlamaService.ts:3451 comment, :3827 usage). Work: confirm tool definitions reach
   `build_grammar` for app completions (tools param → chat-template → lazy trigger),
   add a direct test at the rnllama boundary.
1. Register block types as `EngineTool`s. ⚡ Round-cap reality: `MAX_TOOL_ROUNDS = 3` and
   `MAX_TOOL_EXECUTIONS_PER_TURN = 3` (LlamaService.ts:435-439) make one-block-per-call
   die on any multi-block miniapp. Fix chosen: ONE call per logical miniapp whose schema is
   a **bounded array of typed blocks** (≤ 6 blocks) — grammar handles the repetition, so we
   keep small-model safety AND fit the round cap; composite children stay by reference
   inside the array.
2. The grammar constrains JSON inside the LFM2.5 dialect wrapper (`<|tool_call_start|>…`,
   detection via "List of tools: [" in the shipped GGUF's chat_template) — constrain the
   payload, never bypass the template.
3. ⚡ Token budget: `n_predict` cap (1024) truncates big tables and GBNF cannot prevent
   truncation. Measure tokens/block in P0-P1; either raise the cap for miniapp calls or
   chunk emission across calls. No miniapp ships without a measured worst-case token count.
4. Repair ladder (rev): schema violation → constrained re-decode (same turn, 1 retry) →
   ⚡ FAIL LOUDLY with an unsupported-block card. The prose-JSON fallback is demoted to
   telemetry only — rendering prose-extracted JSON is the exact failure mode we are killing;
   keeping it as a silent rung resurrects it.

### P2 — Registry/renderer swap
Map existing block views behind json-render's catalog API or a thin `useMiniappComponent`
hook (CopilotKit-style registration). History migration: `sanitizeHistoryMessages` keeps
normalizing legacy envelopes AND accepts block-array records; quiz privacy contract verbatim
(answerIndex in history/export, never in the bubble).

### P3 — Interaction loop
Block events become tool RESULTS next turn (append-only, KV-friendly). ⚠️ Cache premise:
§7.37's ≥ 90 % reuse was measured thinking-OFF on CI; re-verify once on-device with
thinking default before relying on it.

### P4 — Three-way benchmark (arms rebalanced ⚡)
Models: LFM2.5-2.6B-QAD-Q4_0 (+ VL-3B when registered). Arms:
(a) one grammar-constrained call, bounded block-array · (b) narrow json-render tree ·
(c) status-quo text envelope.
Metrics ⚡ equalized against audit criticism: valid-call rate · repair rate · total output
tokens · **total time-to-complete-miniapp** (not first-render alone, which trivially favors
a) · frame cost · tok/s penalty · truncation rate at the n_predict cap.
CI emulator ≥ 30 prompts × 3 seeds; then S23 + Jelly confirmation (production config,
thinking default; Jelly budgeted per PLAN_CISWIRE Part-3 logistics).

### House rules
Paseo delegation (writer ≠ auditor), one hostile audit per step, verify on disk, targeted
jest, CI green. Update MINIAPP_AUDIT.md in the same pass as any code change.
