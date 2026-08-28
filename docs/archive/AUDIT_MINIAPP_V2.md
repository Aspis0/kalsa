# AUDIT — PLAN_MINIAPP_V2.md (hostile external audit)

Date: 2026-08-25. Method: primary-source verification — GitHub API (star counts, license,
archive status, pushed_at), npm registry metadata, live docs (ai-sdk.dev, docs.copilotkit.ai,
tool-ui.com, a2ui repo, huggingface.co LiquidAI GGUF + chat template), and on-disk inspection of
`node_modules/llama.rn` + `vendor/kalsallama-cpp` + Kalsa `src/`. All URLs accessed today.

---

## 1. Findings table — every claim, one verdict

### 1.1 Online claims

| # | Claim (plan / research doc) | Verdict | Evidence |
|---|---|---|---|
| O1 | `vercel-labs/json-render` exists, ~16k★, Apache-2.0 | **CONFIRMED** | api.github.com: 16,033★, Apache-2.0, not archived, pushed 2026-08-19 |
| O2 | `@json-render/react-native` exists as published package | **CONFIRMED** | registry.npmjs.org: 0.20.0, published 2026-08-16; `@json-render/core` + `@json-render/react` same version line |
| O3 | json-render = catalog + Zod props + declarative JSON tree + stream render | **CONFIRMED** | README: `defineCatalog(schema, {components:{... z.object(...)}})`, spec `{root, elements:{id:{type,props,children}}}`; SpecStream "Stream AI responses progressively"; RN package: "25+ standard components", `defineRegistry` + `<Renderer spec registry/>` |
| O4 | CopilotKit ~36k★ / ~36.5k★ (plan "~36k★"), MIT | **CONFIRMED** | 37,034★, MIT, pushed 2026-08-25 |
| O5 | docs.copilotkit.ai/reference/react-native/hooks/useComponent exists; ``useComponent`` renders named-tool params as native component | **CONFIRMED** | Page live: "registers a tool and renders a React Native component in chat using the tool call parameters"; built on `useFrontendTool`; Zod `parameters` → inferred props |
| O6 | vercel/ai Apache-2.0 | **CONFIRMED** | raw LICENSE starts "Copyright 2023 Vercel, Inc. Licensed under the Apache License, Version 2.0"; npm `ai` license field Apache-2.0 (GitHub API "NOASSERTION" is SPDX-detector noise) |
| O7 | AI SDK `strict` exists as described | **CONFIRMED** (warts) | ai-sdk.dev: "strict: Enables strict tool calling when supported by the provider"; per-tool opt-in, **ignored by providers that don't support it**. Not a guarantee |
| O8 | AI SDK active-tool filtering exists | **CONFIRMED** (experimental) | `experimental_filterActiveTools` / `activeTools` property (ai-sdk.dev reference + tool-calling docs); marked experimental; open issue vercel/ai#8653: activeTools does not restrict execution in streamText |
| O9 | AI SDK "deterministic repair" | **REFUTED as worded** | `repairToolCall` / `experimental_repairToolCall` exist but are experimental **and re-invoke the LLM** ("failed tool calls will be sent back to the model", ai-sdk.dev). Stochastic, model-dependent — nothing "deterministic" about it (see D5) |
| O10 | A2UI `a2ui-project/a2ui` exists, Apache-2.0 | **CONFIRMED** | 16,206★, Apache-2.0, pushed 2026-08-25; README "Early stage public preview", v0.9.1 stable / v1.0 RC / v0.8 legacy |
| O11 | A2UI flat incrementally-updatable stream + stable IDs | **CONFIRMED** | README: "flat list of components with ID references… incremental changes… progressive rendering" |
| O12 | A2UI community RN renderer real | **CONFIRMED** (feeble) | a2ui docs reference/renderers.md ecosystem list: `a2ui-react-native` (sivamrudram-eng) — **~9★, supports only v0.8 (legacy protocol)**; official mobile renderers are SwiftUI/Jetpack Compose 🚧 "Planned". "Real" yes; "safe dependency" no |
| O13 | Tool UI MIT | **CONFIRMED** | 772★, MIT, pushed 2026-05-09 |
| O14 | Tool UI schema-first result patterns | **CONFIRMED** | tool-ui.com: "Every Tool UI component has a corresponding schema: a Zod definition… parsing fails safely"; card/table/option list/chart/approvals/receipts; built on shadcn/Radix (research's port-not-copy warning valid) |
| O15 | assistant-ui ~10k, active, MIT | **CONFIRMED** | 11,839★, MIT, pushed 2026-08-25 |
| O16 | Star counts in RESEARCH_GENERATIVE_UI_OSS.md | **MINOR DRIFT, nothing gross** | json-render 16,033 (~16k ✓) · CopilotKit 37,034 (~36.5k ✓) · vercel/ai 26,408 (~25k, +6%) · assistant-ui 11,839 (~10k, +18%) · tool-ui 772 (~700 ✓) · A2UI 16,206 (~15k, +8%) · OpenUI **8,456 vs "~6.5k" (+30% — worst miss)** · mcp-ui 5,101 (~4.5–5k ✓) · openai-apps 2,317 (~2.3k ✓) · Fragments 6,371 (~6.4k ✓) · open-canvas 5,490, archived 2026-02-25 ✓ · Open-claude 109 ✓ exact · RN-AI 1,387 (~1.4k ✓) |
| O17 | CopilotKit/generative-ui "MIT" (research: "The repo is MIT") | **CONFIRMED for CopilotKit repo; REFUTED for generative-ui repo** | CopilotKit/CopilotKit = MIT; **CopilotKit/generative-ui has NO license file (GitHub API license: NONE) → all-rights-reserved default**. The plan's "all permissive licenses" table is false for anything taken from generative-ui (see L2) |
| O18 | LFM2.5 tool-call dialect exists as plan §3.6 assumes | **CONFIRMED** | Liquid docs + `LiquidAI/LFM2.5-2.6B` chat_template.jinja: `render_tool_calls` emits `<|tool_call_start|>[fn(args…)]<|tool_call_end|>`, python-style args, JSON literals for dicts/arrays; line 63: `"List of tools: ["` in system prompt; **template raises exception if args arrive as JSON-encoded strings** (mapping required) |

### 1.2 Code claims (on-disk)

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| C1 | llama.rn 0.12.8 passes grammar params at index.ts:408–412 from jinja path | **CONFIRMED verbatim** | `node_modules/llama.rn/src/index.ts:408` `nativeParams.grammar`, `:410` `grammar_lazy`, `:412` `grammar_triggers`, fed from `jinjaResult` (OAI chat path); package.json version 0.12.8 |
| C2 | "jinja route is the **only** entry; extend the overlay (kalsallama owns that code)" | **REFUTED** | (a) Completion-level structured output exists without jinja: `response_format: {type:"json_schema"}` → `nativeParams.json_schema` (index.ts:447–449, 858–860); native param documented as "JSON schema for convert to grammar… override by grammar if both set" (src/types.ts:230–231); chat.cpp builds GBNF from `json_schema` in every template path (1019–1095, 1170–1255). (b) **Kalsa already exposes it**: `completeOnce` sends `response_format json_schema` (src/engine/LlamaService.ts:3827–3829). (c) The overlay **already implements the LFM2.5-dialect tool grammar**: `vendor/kalsallama-cpp/common/chat.cpp:1671–1776` `common_chat_params_init_lfm2` — python-style tool-call PEG, `allow_json_literals=true`, per-tool GBNF from `function.parameters` via json-schema-to-grammar, lazy trigger WORD `<|tool_call_start|>`; LFM2.5 detection at :2600–2604 (`src.find("List of tools: [")`, no `<|tool_list_start|>`) **exactly matches the shipped GGUF template** (O18). vendor tree and node_modules tree are identical (overlay applied) |
| C3 | "This is the piece nobody external can give us" (§P1 step 2) | **REFUTED** | It shipped in llama.rn 0.12.8 (and therefore in the vendored fork). The residual risk is template-**detection** fragility, not missing code (D4) |
| C4 | EngineTool (LlamaService.ts:531) can carry per-tool JSON schemas | **CONFIRMED — no gap** | `{type:"function", function:{name, description, parameters: Record<string, unknown>}}` — `parameters` IS a JSON Schema; native `foreach_function` reads `tool.function.parameters`, `builder.resolve_refs(schema)`, derives grammar (chat.cpp:1250–1260). Tools already flow to llama.rn (`tools: options.tools`, :2910) |
| C5 | tool_choice wired at ~:728 | **CONFIRMED** | Prewarm `tool_choice:"auto"` (LlamaService.ts:728); main loop `resolveCompletionToolChoice` (:2896–2911) with bench modes `none|required|auto` (src/bench/benchConfig.ts:515–528) — "required" ⇒ non-lazy grammar, exactly arm-(a)'s lever |
| C6 | parseMiniappFromText / normalizeMiniapp in src/domain/askAssistant.js | **CONFIRMED** | :479 / :334; balanced-brace scan (:457–492); tolerant normalize; `answerIndex` never defaulted to 0 (:240, :281–297) |
| C7 | sanitizeHistoryMessages normalizes miniapp + migrates from text (AiChatPage.tsx) | **CONFIRMED** | :616; normalize at :671–679, text migration at :685–691; caps MAX_TEXT 100k / MAX_ITEMS 100 |
| C8 | Calculator recursive-descent parser, no eval | **CONFIRMED** | Renderer :2497–2675: CALC_MAX_DEPTH 20, CALC_MAX_TOKENS 100, tokenizer + recursive descent, no `Function`; i18n `formulaUnsupported` path (MINIAPP_AUDIT accurate) |
| C9 | Quiz privacy contract + caps as MINIAPP_AUDIT documents | **CONFIRMED** | cap constants :17–23 (depth 3, children 24, rows 50×12); quiz normalize (askAssistant.js:281–297); prompt "never reveal answerIndex" (src/i18n/en.ts:1018, 1044–1045); registry table/chart/calculator/tabs/expandable/quiz present (renderer :2938+, :3121) |
| C10 | "§7.37 shows tool rounds now keep ≥90% cache" | **CONFIRMED** (context matters) | docs/reports/HARNESS_FINDINGS.md:124: "15 of 16 tool-preceded turns kept 90–98 %"; the 1-in-16 failure cost **128,167 ms prefill** (:132–134). **Measured with thinking OFF** — HARNESS :120–123: "the whole `fase4` matrix is hardcoded to `thinking: "off"`". P4 runs "thinking default" ⇒ the premise does not transfer (D8) |
| C11 | LFM2.5-2.6B QAD-Q4_0 in ModelRegistry; VL-3B not yet | **CONFIRMED** | src/engine/ModelRegistry.ts:293–299 (`lfm2.5-2.6b`, `LFM2.5-2.6B-QAD-Q4_0.gguf`); no VL-3B entry |
| C12 | "LlamaService exposes onMiniapp but never emits it" (MINIAPP_AUDIT) | **CONFIRMED** | `onMiniapp?` declared :575 and client-wired (AiChatPage.tsx:2459, "cloud path may also call onMiniapp directly" :2590); no emit site in LlamaService or AppShell |
| C13 | CI emulator exists for P4 | **CONFIRMED** | scripts/ci/ci-bench.sh (KVM-emulator BENCH_TARGET), HARNESS measurements on it |
| C14 | Jelly ≈ 6 tok/s | **CONFIRMED** (rounds up) | HARNESS: 7.05 tok/s (§7.28), ≤10 tok/s "testbed, not a target"; cold start **120.8 s** (77.7 prewarm + 43.1 first prefill) (:36) — the number that matters for D2/D5 |

---

## 2. Design judgment (hostile)

**D1 — The plan's core architecture is capped by `MAX_TOOL_ROUNDS = 3` (LlamaService.ts:435) and never mentions it.** One-block-per-call means a multi-block miniapp (tabs with 3 children + table + chart + quiz) needs N sequential tool rounds **plus** a text summary round. That is ≥ 4–5 rounds for anything non-trivial; the loop hard-stops at 3 (`isFinalToolRound = round === MAX_TOOL_ROUNDS - 1` forces text-only, :2910–2913). The only escape is parallel tool calls in one wrapper — which LFM2.5 natively supports (`[f1(...), f2(...)]`, python_style_tool_calls with `parallel_tool_calls`) — and then you are emitting an envelope-sized multi-call payload again, which is precisely the token shape the plan claims to ban ("never one giant envelope"). The plan resolves neither horn. This is the single biggest design hole.

**D2 — No token/latency budget anywhere.** At 7 tok/s Jelly, a 400-token table call ≈ 60 s decode, plus per-round prefill of the (large) prefix, plus PEG parse, plus tool-result re-injection. Five blocks ≈ 5×(prefill+decode)+summary. The plan's "small-model rule" is asserted, never costed. Note `n_predict` floor is **1024** (:2914–2919) — GBNF makes JSON *valid*, it does not make it *short*; a 50×12 table (~600 cells) or a json-render adjacency spec (every element pays `id`+`type`+`props`+`children`) exceeds 1024 tokens and truncates mid-grammar → PEG parse error → repair → second completion. The 2026-08-07 field report the code itself cites (truncation mid-payload at 512) repeats at the new cap; arm (b) hits it first.

**D3 — Child-by-reference coherence is underspecified to the point of being a new protocol.** No resolver, no dangling-id policy, no duplicate-id policy, no cross-turn id stability, no interaction with existing caps (MAX_BLOCK_DEPTH=3 / MAX_CHILD_BLOCKS=24 / MAX_MINIAPP_BLOCKS=24 / 64 KB per block). Refs *bypass* the depth-3 recursion cap by indirection — sanitize/render caps cease to mean anything unless redefined (renderer `sanitizeRenderBlock` and all block views consume **inline** `blocks`/`tabs`/`items` arrays only; nothing resolves references today). "History persistence keeps the last full tree" is hand-waving: whose job is materializing patches into a tree on reload, and where does that live in `sanitizeHistoryMessages`? Unspecified.

**D4 — The §3.6 dialect risk is real but already solved; the actual residual risk is mis-scoped.** The overlay contains the full LFM2.5-dialect PEG+grammar (C2). What the plan does not identify: (a) specialized-handler selection depends on the GGUF template string containing literally `"List of tools: ["` — if the GGUF's embedded template diverges, it silently falls to the generic differential autoparser, with different grammar_lazy semantics; (b) json-schema-to-grammar silently degrades unsupported keywords/schemas (recursive adjacency specs, oneOf-heavy json-render schemas are exactly its failure class). The plan's P1.0 "work needed" list targets already-built machinery and omits both.

**D5 — The repair ladder re-introduces the exact failure being fixed, and "deterministic repair" is a mislabel.** AI SDK repair = re-invoke the model with the error appended (O9) — on Jelly that is a second multi-minute completion; the plan's "1 retry" is never budgeted in P4 metrics. Rung 3 (`parseMiniappFromText`) is the prose-JSON path the plan retires, verbatim. Grammar makes *structure* valid; it does not make *values* valid (model can produce schema-valid nonsense rows) — so violations will still happen, and the ladder's cost dominates arm-(a) at the exact latency the plan claims to fix. The P4 metrics (valid-call rate, repair rate) do not include repair *cost*.

**D6 — P4 arms are not fair and omit the plan's own architecture.**
- Arm (b) depends on the **undecided** P0 vendor decision (if P0's spike fails, arm (b) is unbuildable) and on GBNF deriving from json-render's full spec schema (D4b).
- Arm (c) as "status-quo text-embedded envelope" is not a controlled baseline for the native-tool path: the envelope path runs with no grammar and a different prompt; differences conflate grammar with call-shape.
- The research doc's recommended arm — "A2UI-like flat update stream" — was swapped out for status-quo (c) in the plan, so **P2's own patch mechanism is never measured**.
- "First-render latency" as specified measures the first block, which arm (a) trivially wins while the real UX cost is *time-to-full-miniapp* (the sum over N calls). Missing metrics: repair tokens+latency, miniapp-absent rate (model chooses not to call; grammar does not force calls under `auto`), per-arm KV cache reuse.
- "CI emulator first" is grounded (C13) ✓; "thinking default" contradicts the §7.37 evidence base (C10).

**D7 — Tool-call → miniapp plumbing gap.** The plan targets the registry and invocation but never specifies the end-of-turn conversion of tool-call records into `Message.miniapp` for persistence/export — `onMiniapp` has never emitted (C12), `sanitizeHistoryMessages` has **zero** tool-call record support, and `Message` has no tool-call shape. P1.4 says history "must accept per-block tool-call records" — i.e., it acknowledges new schema work but not which layer owns the materialized-tree conversion that every other phase depends on.

**D8 — The KV-cache premise for P3's "≥90% cache" was measured with thinking OFF** (C10), and its 1-in-16 failure costs 128 s prefill. P3/P4 run "thinking default". The plan's cheap-follow-up-turn economics is not established on the settings it proposes, and no arm measures cache reuse.

---

## 3. License compliance

| Source | Actual license | Plan's claim | Consequence |
|---|---|---|---|
| json-render (repo + npm) | Apache-2.0, **no NOTICE file** (GitHub API) | "Apache-2.0 — vendor with NOTICE" | "Vendor with NOTICE" is the wrong mechanism: Apache-2.0 §4(a) retain license+copyright; §4(b) **prominent notices on modified files** — mandatory the moment "copy catalog/registry/schema core into `src/miniapp/`" happens; §6 trademark. A NOTICE file is only for reproducing upstream-issued NOTICEs (none exist). The plan omits 4(b) entirely |
| vercel/ai ("port semantics", Apache-2.0 claimed) | Apache-2.0 (LICENSE file verified; no NOTICE) | ✓ correct | Copying the repair/validation code = 4(b) modified-file notices again; "port semantics" (clean-room) = no duty, but the plan never distinguishes copied-verbatim vs reimplemented |
| CopilotKit main repo / `@copilotkit/react-native` (npm) | MIT | "MIT" ✓ | Fine for the main repo/npm package; retain copyright+permission text if `useComponent` code is copied rather than referenced |
| **CopilotKit/generative-ui** | **no license file → all rights reserved** | implicit "MIT" umbrella | **Do not copy from generative-ui.** The four-line steal table ("all permissive") is factually wrong for this repo; reading for ideas is fine, verbatim extraction is not |
| A2UI | Apache-2.0, no NOTICE | "adopt the wire concepts" | Concepts-only = no duty. Any schema/code copy (patch semantics, stable-ID model) triggers 4(b) |
| assistant-ui/tool-ui | MIT | MIT ✓ | As above |
| llama.rn (the layer the grammar work actually touches) | MIT | never mentioned | If miniapp tool-prototype code or fork patches are lifted into `src/`, MIT notice applies; the plan's license table omits the one codebase the plan will actually modify most |

Net: the plan's permissive-table is correct on 5 of 6 entries, but the *conveyance duties* it actually incurs (Apache 4(b) modification notices; generative-ui's license-less state) are absent. For a project that already vendors a fork with a pinned SHA and a NOTICE discipline, this is cheap to fix and the plan should name each borrowed artifact + license + modification notice in one table.

---

## 4. What the plan got wrong

1. **"If the jinja route is the only entry, extend the overlay"** — wrong on both counts: a completion-level `response_format: json_schema` route exists (llama.rn index.ts:447/858; already used by Kalsa's `completeOnce`), and the overlay **already** contains the LFM2.5-dialect tool grammar (vendor/kalsallama-cpp/common/chat.cpp:1671–1776, detection :2600–2604) matching the shipped GGUF template. P1.0's "work needed" is mostly already done.
2. **"This is the piece nobody external can give us"** (grammar-inside-template-dialect) — it's shipped in llama.rn 0.12.8 and present in the vendored fork. The real §3.6 risk is template-detection fragility + json-schema-to-grammar degradation; neither is named.
3. **"Deterministic repair"** — AI SDK repair is a *model re-invocation* (stochastic, experimental, minutes on Jelly). Mislabeling it deterministic licenses a false reliability expectation.
4. **One-block-per-call busts MAX_TOOL_ROUNDS=3** — the plan's central mechanism cannot express the multi-block miniapps it targets within one turn, and its own anti-envelope rule is unenforceable (parallel calls re-create envelopes; grammar cannot force exactly-one).
5. **Repair-ladder rung 3 resurrects prose-JSON** — the exact failure mode the plan says it is retiring; with no cost accounting (D2, D5).
6. **"sanitizeHistoryMessages already normalizes on reload"** — true for v1 envelopes, false for tool-call records/per-block ids: there is no tool-call record shape, no end-of-turn tool→miniapp conversion, and `onMiniapp` has never emitted (C12).
7. **GBNF ≠ brevity** — n_predict 1024 cap stands; big tables and arm-(b) adjacency specs truncate and trigger the ladder. The field-report truncation failure recurs, bigger.
8. **P4 swapped the A2UI arm out** — the update-stream mechanism P2/P3 depend on is never benchmarked; "first-render latency" as metric trivially favors arm (a) while hiding full-miniapp latency.
9. **§7.37 cache premise is thinking-off evidence** for a thinking-default plan (C10); the ≥90% claim does not transfer.

## 5. What the plan missed

1. `MAX_TOOL_ROUNDS = 3` (LlamaService.ts:435) — the binding constraint on the whole design; needs explicit per-block batching or round-budget redesign.
2. Token/latency budget. On Jelly: 7 tok/s decode (HARNESS §7.28), 120.8 s cold start (§:36). Per-block cost = prefill + decode + parse + result re-injection, ×N, +summary. "Equal token cost" hypothesis (P4) is asserted against no numbers. Prefix growth is also uncosted (§7.36: 3,203 chars + 3 tool schemas ≈ 1,300 tokens; +8 miniapp schemas ≈ +50–100% of system prompt, re-read every cold start).
3. Parallel tool calls are the only way to beat the round cap, and they contradict the anti-envelope rule — the plan must decide, and test, one of them.
4. Template-detection assertion: a runtime check that the LFM2.5-specialized handler actually engaged (log line / grammar_lazy flags) — cheap, and the true §P1 risk.
5. Child-reference protocol: resolver, dangling/dup ids, cross-turn stability, cap redefinition (refs bypass depth-3), and materialized-tree persistence — who, where, with which fallback.
6. Quiz privacy contract extension to tool-arg records: `answerIndex` will now also live in tool-call arguments in history/export — the contract says "persisted history/export JSON: present; bubble: never" — tool records are a *new* surface that must be named explicitly, not "preserved verbatim".
7. n_predict ceiling per tool round (1024) vs schema size — needs per-tool or per-round raises, or arm (b) is dead on arrival for tables.
8. Strict-mode semantics: native grammar is already unconditional on the tool path — the AI SDK `strict` port is mostly a no-op; the actual delta is JS-side validation + repair. The plan presents porting `strict` as new work.
9. Arm (c) baseline definition (grammar off? same prompt?), miniapp-absent rate, repair cost, and cache-reuse metrics; P4's "end-to-end tok/s penalty" is undefined.
10. License duties: Apache-2.0 4(b) modified-file notices; generative-ui's license-less state (O17); llama.rn (MIT) — the codebase the plan modifies most — absent from the license table entirely.

## 6. Unverifiable

- C14-adjacent: P0 exit criterion "< 16 ms/frame on the S23" — a target, not a claim.
- CisWire's "deterministic enforcement doesn't depend on model strength" — internal project, no external primary source; PLAUSIBLE/UNVERIFIABLE externally.
- Research doc assertions about MCP Apps / OpenAI Apps SDK internals — outside the targeted claim set; not re-checked.

---

**Bottom line:** the plan's factual substrate (licenses, packages, docs, star counts, in-repo line numbers, §7.37) holds up almost everywhere — every online claim verified CONFIRMED except the two mislabeled licenses (generative-ui: none; "deterministic repair": stochastic) and the §P1 jinja-exclusivity claim, which is REFUTED by the vendored fork itself. The design, however, is not executable as written: MAX_TOOL_ROUNDS=3, the 1024-token cap, per-round prefill at 7 tok/s, and the missing end-of-turn tool→miniapp conversion are unaddressed constraints that individually block the central mechanism, and the repair ladder re-imports the failure mode the plan exists to remove. P1 shrinks from "extend the overlay" to "assert the handler engaged + write JS-side validation"; the hard work the plan never budgets is the token/latency economy of N calls, the reference-resolution protocol, and the persistence/privacy surface for tool-call records.