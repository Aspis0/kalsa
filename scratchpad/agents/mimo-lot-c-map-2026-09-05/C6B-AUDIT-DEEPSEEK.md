# C6b Hostile Audit — `f659bda` `create_miniapp` tool + builders

Auditor: hostile pass, READ-ONLY. Commit `f659bda` on `feat/moe-stream`.
Verification re-ran on the exact commit: `npx tsc --noEmit` → **0**; `npx jest src/agent/createMiniappTool.test.ts src/agent/toolRegistry.test.ts` → **22 passed / 2 suites**. The impl report's numbers are real, not invented.

Verdict on the MVP checklist first, then findings.

## Checklist

| # | Claim | Verdict |
|---|-------|---------|
| 1 | Tool registered, default on, no gate | ✅ CONFIRMED — `toolRegistry.ts:136–141` `toggleKey:null, defaultOn:true, gateTable:null`; `assembleTools` returns it for every flag combo (see §registry) |
| 2 | Schema enum 3 templates + slots | ✅ CONFIRMED — `createMiniappTool.ts:28–45` |
| 3 | Builder null on invalid, never broken UI | ⚠️ CONFIRMED with holes — crash-safe, but two "success" paths yield degraded renderer output (F2, F3) |
| 4 | Success → onMiniapp; failure → no | ✅ CONFIRMED — `createMiniappTool.ts:91–101`; tests cover |
| 5 | Wired in AppShell executeTool, live onMiniapp | ✅ CONFIRMED — `AppShell.tsx:1943–1945` (executor), `:2154–2156` (branch), `:4507–4511` (per-send hook) |
| 6 | EN+IT descriptions | ❌ **FAILED** — error strings are EN+IT, but the binding's system/tool guidance "when to call vs prose" exists nowhere; no system-prompt text in either locale (F1) |
| 7 | Prose-parse fallback untouched | ✅ CONFIRMED — zero diff in `askAssistant.js` / `AiChatPage.tsx` finalize path |
| 8 | Tests real | ✅ CONFIRMED, but with blind spots (F10) — 22/2 re-verified |

Tool-loop reality check (hunt #1): **yes, `create_miniapp` is in the tools array for every normal chat turn.** `assembleTools()` output is `agentOptions.tools`; `AppShell.tsx:5262` spreads `...agentOptions` into `streamAssistantTurn`; `LlamaService.ts:2896` `hasTools = Boolean(options?.tools?.length && options?.executeTool)`; completion receives `tools: options!.tools` (`:2914`). It is active even with web/device/calendar all disabled (`toolRegistry.ts:59–65`). No toggle defense is needed or present — correctly ungated.

---

## Findings

### F1 — CONFIRMED · HIGH · The feature's core premise is never sold to the model: zero system-prompt coverage, EN or IT

Binding §6 requires a system/tool description that says **when to call `create_miniapp` vs answering in prose** and lists the 3 templates. The commit adds only the JSON-schema description (`createMiniappTool.ts:22–27`, English) — which the model sees only inside the `tools` array — plus 3 error strings.

Both locales' system prompts still instruct prose-first and never mention the tool name:

- `src/i18n/en.ts:1114` (tools variant): `"Emit a miniapp as a JSON object with schema miniapp_v1, kind, title, and blocks (optionally inside a ```json fence). "` — and `:1077` (no-tools variant), `it.ts:1037` / `:1073` likewise. No `"create_miniapp"` string anywhere in either prompt (`grep create_miniapp src/i18n/*.ts` → only the 3 error keys).
- `systemPromptWithSearch` spends ~200 words teaching `web_search` / `web_fetch` / `document_chat` usage (`en.ts:1083–1119`) and zero on the miniapp tool.

Severity is high precisely because the binding identifies the target model as a **small on-device model that fails free-form miniapp JSON** — the tool exists to bypass exactly the prose path the system prompt still actively recommends. A 2B model follows the system prompt's explicit "Emit a miniapp as a JSON object…" instruction far more reliably than a schema description buried in the tool list. Without this text the success criterion ("small model can emit a short tool call with template enum + slots") is wishful. This is binding item 6, unmet on both locales.

### F2 — CONFIRMED · MEDIUM · Quiz accepts >4 options; answerIndex validated against pre-truncation length, so a "successful" build can silently lose grading

- `src/domain/miniappBuilders.ts:124–125` only checks `options.length < 2` — no upper bound. The binding contract is "answerIndex 0–3".
- `:132` validates `answerIndex` against the **full** option list: `safeAnswerIndex(slots.answerIndex, options.length)`.
- The renderer then truncates: `src/ui/blocks/QuizBlock.tsx:35` `list.slice(0, 4)` and `src/domain/askAssistant.js:286–289` `rawOptions.slice(0, MAX_QUIZ_OPTIONS)` (MAX = 4, `:245`) → `parseAnswerIndex(block.answerIndex, options.length)` on the **sliced** list.

Concrete failure: model passes `options: [5 items], answerIndex: 4` → builder succeeds, `onMiniapp` fires, result text "Miniapp created: …" → user gets a 4-option quiz whose `answerIndex` is `null` → "answer not available", grading silently disabled. The tool declared success and produced a quiz the user can never get right, and nothing in the executor's error path catches it. The test at `createMiniappTool.test.ts:96–101` *codifies* the mis-alignment ("out of range → null disables grading") for the 2-option case, so the suite will not flag the >4-option hole. Also unbounded `options` (e.g. 40) shrink to 4 with no builder error.

Fix direction: cap `options` to 2..4 in the builder and validate `answerIndex` against the capped length, or reject `length > 4` as invalid slots.

### F3 — CONFIRMED · MEDIUM · `quick_calculator` formula is not validated at build time; "strict per-template validation" (impl report) overstates

`src/domain/miniappBuilders.ts:106–117`: any non-empty trimmed string passes as `formula`. The renderer's evaluator re-validates with a charset/length gate (`src/domain/miniappCalculator.js:187–206`, `CALC_MAX_FORMULA_LEN`), and any formula failing it renders "Formula unsupported" (`AskAssistantMiniappRenderer.tsx:1209–1211`). So `formula: "что угодно"` or `"a b c"` or a 10 KB string is a **successful build** that renders a dead calculator — the same class of broken-UI-adjacent output the builder exists to prevent. The builder also never checks that referenced identifiers match `fields` ids (renderer degrades to unsupported). Contract: "Invalid slots → null" is false for every formula the charset gate rejects at render time.

### F4 — CONFIRMED · LOW–MEDIUM · Duplicate / missing calculator field `id` → duplicate React keys + cross-field value bleed

`miniappBuilders.ts:98` `const id = asString(field.id) ?? "";` — no dedupe, no uniqueness requirement, empty string fallback. `input`+`label`-only fields (no `id`) all get `id: ""`. Renderer keys the `values` state and the `<NumberField key=…>` on `fieldId` (`AskAssistantMiniappRenderer.tsx:1206–1211, 1222`). Two `id:""` fields → duplicate React keys and both inputs mutate the same `values[""]` slot — one typed value overwrites the other. Not a crash; a real logic corruption a small model will hit (it frequently omits `id`).

### F5 — CONFIRMED · LOW · `compare_data` with columns but zero rows is a success (header-only table)

`miniappBuilders.ts:68–85`: `rows` optional; `columns` alone → `data_table` with an empty body, "Miniapp created". Binding's `compare_data` implies columns + rows data. Borderline by design (title-only tables are harmless), but it widens the window of "success" that looks broken to the user.

### F6 — CONFIRMED · LOW · Double normalization (dead work / contract distrust)

`buildMiniappV1` already returns `normalizeMiniapp(built)` (`miniappBuilders.ts:170`) and the executor normalizes again (`createMiniappTool.ts:92` `const normalized = built ? normalizeMiniapp(built) : null;`). Idempotent, so harmless — but it signals the builder's "already normalized" contract isn't trusted by its own caller, and the second call is what the executor's null check actually tests.

### F7 — CONFIRMED · LOW · `onMiniappRef` is set-only, never reset (the hunt's race question)

- Set at each send: `AppShell.tsx:4507–4511` (`if (liveMiniapp) onMiniappRef.current = liveMiniapp;`), no-op default `:848`.
- Never cleared after the turn, and a future `onSendStream` caller that omits `onMiniapp` silently **keeps the previous turn's hook**.

Why it is not exploitable today (this is the answer the hunt wants):
1. Sends are serialized — `AiChatPage.tsx:2053–2058` `sendClaimRef.current || sendingRef.current || regenInFlightRef.current` → one stream at a time; a second send cannot interleave inside a turn.
2. Each send overwrites the ref before any tool round runs.
3. The executor is synchronous with no `await` before `onMiniapp?.(normalized)` (`createMiniappTool.ts:101`) — an abort event cannot interleave between `bailIfStopped()` and the callback, so a stale turn's tool call cannot route into a newer turn's hook.
4. Defense even if it happened: the hook is gated on `regenGenerationRef` / `sendRunIdRef` (`AiChatPage.tsx:2473–2475`) and `updateMessage` no-ops when `idx === -1` or generation/runId mismatch (`:1798–1815`).
5. Unmount: `updateMessage` checks `mountedRef.current` (`:1801`).

Residual risk: any future code path that runs this executor outside a send (e.g. a replay/bench harness that reuses `agentOptions.executeTool`) will target the last turn's `assistantId` — silently dropped by the gates, or worse, mis-attached if the last send is still live. One-line hardening: reset to no-op in `finish()`.

### F8 — PLAUSIBLE · LOW · `slots` is a property-less catch-all object; on-device grammar behavior untested

`createMiniappTool.ts:36–42`: `slots: { type: "object", additionalProperties: true }` with **zero declared properties** — the schema the native overlay feeds through `json-schema-to-grammar` for GBNF derivation (per `C6B-TOOL-MINIAPP-MAP.md` §1/§3). Every other tool declares typed properties. Property-less catch-all objects are the exact corner where GBNF generation in llama.cpp historically degenerates (empty-object-only or explosive loop). If the overlay mis-derives it, the 2B model either never emits `slots` or emits unparseable args — and nothing in the unit suite exercises the end-to-end emit path, so this is unverified on the actual stack. Needs one on-device smoke turn before trusting the "small model can emit a tool call" premise.

### F9 — CONFIRMED · LOW · Fallback titles hardcoded English, not i18n

`miniappBuilders.ts:63, 83, 115, 137`: `"Miniapp"`, `"Comparison"`, `"Calculator"`, `"Quiz"` literals. Consistent with the app's English-content language rule, but it is user-visible copy the i18n system has no handle on; if the language policy ever follows the setting, these leak.

### F10 — CONFIRMED · LOW · Test hygiene: pass, but with blind spots

Verified real: 22/2 re-ran green; tests genuinely cover builder valid/invalid per template, executor success→`onMiniapp` / failure→none, `it` locale error path, registry row + `assembleTools` membership. Weaknesses:
- `expectMiniapp` (`createMiniappTool.test.ts:21–23`) asserts only `error === undefined` — a result with empty `text` or an un-marked `error` would pass.
- No test asserts the success text is `"Miniapp created: {title}"` (the `createMiniappCreated.replace` path is untested).
- No test for the >4-option truncation mismatch (F2) or duplicate/empty field `id`s (F4).
- The enum-order assertion (`:66–74`) only re-checks the code it's generated from (`MINIAPP_TEMPLATE_IDS` is both the source and the expectation), so it adds no independent signal.
- No regression guard that system prompts (F1) mention the tool — the biggest gap in the feature has no test facade at all.

### F11 — INFO · Privacy / security posture checks out (hunt angles)

- **Egress**: executor is pure (no network, no FS); ungated like `write_note`, no `runToolGate` table (`toolGateRegistry.ts:15–19` — unregistered names exempt by construction).
- **Slots not logged**: telemetry carries tool **names** only (`LlamaService.ts:3069`); `onTool` args are dropped at `AiChatPage.tsx:2417–2421` (`payload.proposed_actions` is undefined for tool payloads → no CTAs, no persistence).
- **Native KV**: tool rounds mark `tool_calls_detected` → `kvReproState.reproducible = false` (`LlamaService.ts:3042`) → `saveEngineSession` skips (`:1826+, 1868` comment) → slot content never lands in durable KV. The miniapp itself persists only via the AsyncStorage conversation (`message.miniapp`), which is the feature's intent and equivalent to the prose path.
- **Injection**: builder outputs go to RN `<Text>`, no HTML block produced; calculator formula is parsed by a recursive-descent parser with charset gate — no `eval` (`miniappCalculator.js:187–206`).
- **`__proto__` / spread**: `JSON.parse` output can't trigger prototype setters; `normalizeMiniappBlock` spreads own keys only — no pollution path.
- **Malformed args** (`args` array, `slots` string/array): `isPlainObject` guard → safeSlots `{}` → clean `invalid_slots` error. Good.
- **Refuted as field**: the model-controlled `title` echoed into the tool-result transcript (`createMiniappTool.ts:103–106`) is normal tool-result behavior, not a new leak; `formatToolResultContent` appends the use-rule (`LlamaService.ts:493–515`).

### F12 — CONFIRMED · COSMETIC · Template `kind`s hit the generic icon

`miniappIcon` (`AiChatPage.tsx:405–418`) switches on `"calculator" | "comparison" | "planner" | "quiz"` — none of `"compare_data" | "quick_calculator" | "reading_quiz"` — all three built kinds get `Sparkles`. No crash (default exists), just a missed mapping.

### REFUTED / checked-clean (hunt list)

- **Stale completion holding tool schema** (AppShell `:2102` comment context): create_miniapp has no toggle, so nothing to bypass; the `bailIfStopped()` checks (`LlamaService.ts:3022, 3144`) plus the sync executor make cross-turn `onMiniapp` contamination unreachable (see F7).
- **onMiniapp before assistant placeholder exists**: placeholder is created before `onSendStream` (`AiChatPage.tsx:2318–2331`), `updateMessage` no-ops only if missing — order safe.
- **Locale catalog**: only `en`/`it` exist (`i18n/types.ts:3`), both carry all three keys; the `?.` guards are unneeded but harmless.
- **`calendar_agenda` default-off regression**: registry test covers all flag combos, re-verified.
- **impl-report tsc/jest claims**: reproduced exactly.

---

## Ship / fix-first (ordered)

**Fix first (blocking):**
1. **F1** — add `create_miniapp` guidance to `systemPromptWithSearch` in `en.ts` + `it.ts`: tool name, the 3 templates, "prefer the tool over writing miniapp JSON by hand", and soften the prose-emit instruction to fallback. This is binding item 6 and the difference between the feature working on a 2B model and it silently never firing. (Optionally add a test-side invariant that the prompt mentions the tool.)
2. **F2** — cap quiz `options` to 2..4 in the builder and validate `answerIndex` against the capped count; reject >4 as invalid slots. Fix the mis-aligned test to assert rejection instead of "grading disabled".
3. **F3** — validate `formula` at build time with the same charset/length contract as `miniappCalculator` (import the constants) so a "success" can't render a dead calculator.

**Fix next (cheap, real):**
4. **F4** — dedupe and require `id` (fallback `field_${i}`), cap fields.
5. **F7** — reset `onMiniappRef.current = () => {}` in `handleSendStream`'s `finish()`.
6. **F10** — add the missing assertions (success-text identity, >4-option rejection, dup-id rejection).

**Ship with notes (cosmetic / defer):**
7. **F8** — one on-device smoke run with a 2B model emitting `template` + `slots` before calling the premise proven; unit-level fix if GBNF mis-derives.
8. **F5, F6, F9, F12** — follow-up polish; none affect correctness or privacy.

Net: the plumbing (registry, executor, wiring, tests) is real and verified, but as shipped the tool is unlikely to ever fire on the target model class (F1), and two success paths can emit degraded UI the design explicitly promised to eliminate (F2, F3). Not ship-blocking as code — ship-blocking as *feature*.