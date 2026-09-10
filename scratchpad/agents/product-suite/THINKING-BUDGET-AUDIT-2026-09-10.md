# HOSTILE AUDIT — speed-gated thinking budget (read-only)
Diff: decodeSpeed.ts(+3 tests), thinkingBudgets.ts(+test), ModelRegistry/devModelCatalog (LFM+MiniCPM5 → short 512/extended 1024), LlamaService (recordDecodeSample at emitTurnTelemetry, KALSA_THINKING log, speed into resolveThinkingParams). jest 13/13; tsc 0.

## (1) Sample hygiene
- CONFIRMED excludes prewarm/utility: recordDecodeSample is inside emitTurnTelemetry's `model != null` block (LlamaService.ts:967), and the util/prewarm callers pass NO model arg — util-extractMemory (:4085), util-translateText (:4256), util-completeOnce (:4382) call `emitTurnTelemetry(turnId, 0, result)` with no attribution/model → no sample. Prewarm path calls neither emitTurnTelemetry nor recordDecodeSample (grep: only recordPrefillSample at :843). Only the two chat-round call sites (:3455, :3793) pass model. CONFIRMED.
- CONFIRMED decode-only time: r.predictedMs = timings.predicted_ms ?? -1 (turnTelemetry.ts:177) — decode-only, prompt_ms is separate (promptMs). Prefill not counted.
- CONFIRMED (bias, accepted): a truncated/aborted round with ≥16 tokens DOES enter the EMA — the only guards are predictedN≥16 and predictedMs>0 (decodeSpeed.ts:8-15); an aborted 16-token round at 0.5 tok/s drags the EMA down (alpha 0.3). Mitigated: onDecodeSample's own `interrupted` flag exists (:968-972) but recordDecodeSample ignores r.interrupted — an interrupted flag is available at the call site and not passed. Minor: recommend skipping samples with r.interrupted true.

## (2) Persistence + key mismatch
- CONFIRMED per-process only: module-level Map, no storage; every cold start starts at short (512) until the first ≥16-token round. Acceptable (owner tradeoff), stated.
- REFUTED (key mismatch): both sites key on activeModel.id — record (LlamaService.ts:967) and getDecodeTokPerSec(activeModel.id) (:2964-2966); activeModelId comes from the same engine state; dev model ids (dev-minicpm5-2b etc.) are registry ids in both paths. getModelById fallback keeps ids consistent.

## (3) Resolution timing / mid-turn flips
- CONFIRMED resolved once per TURN: `const thinkingMode = await getThinkingMode(); … resolveThinkingParams(thinkingMode, activeModel, { decodeTokPerSec })` at :2956-2974, before the tool loop; thinkingFields spread into every round's completion — the budget CANNOT flip between rounds of one turn (EMA updates during the turn are ignored until the next turn). KV impact: none — thinking budget is a sampling cap, not a prompt change; prefix cache unaffected. CONFIRMED safe.

## (4) Budget fallbacks vs new registry numbers
- CONFIRMED (inverted-scale hazard, mostly cosmetic): positiveBudget fallbacks still assume the old scale — positiveBudget(model?.thinking?.short, 256) / extended, 512) (thinkingBudgets.ts:95-96). With registry short/extended now 512/1024, bench mode "budget256" actually sends 512 and "budget512" sends 1024 — the mode NAMES no longer match emitted values. The user-facing picker labels are Short/Extended (SettingsScreen.tsx:199-200), so semantics ("use the model's short budget") are preserved; the intent's "bench modes unchanged in meaning" holds semantically (short-slot/extended-slot), not numerically. The test at thinkingBudgets.test.ts:64-74 pins this deliberately (budget256+fast → 512). No model has short > another's extended: all registry thinking entries now {512,1024} (LFM :243, MiniCPM5 devModelCatalog.ts:52); qwen test fixture {256,512}. REFUTED (no cross-model inversion in the registry).
- PLAUSIBLE (null-model): resolveThinkingParams("default", null, fast) → extended=true → positiveBudget(undefined, 512)=512 = short fallback too — consistent.

## (5) Tests + dead code
- CONFIRMED covered: none (null speed → short, test "no speed measurement…"), 3.4→512, 5→1024 (boundary inclusive), 11→1024, bench modes with both speeds (test :64-74). decodeSpeed: min-16 rejection, bad timing, EMA blend, reset. The exact five cases asked.
- REFUTED (dead exports): EXTENDED_THINKING_MIN_DECODE_TOK_PER_SEC exported + used in tests... check: exported const (thinkingBudgets.ts:19) — grep shows test usage via behavior only. It IS consumed in prod? Only inside the module (:88). PLAUSIBLE dead export (doc-value), harmless.

## Verdict: CLEAN (one optional fix)
recordDecodeSample could skip r.interrupted===true samples to keep the EMA honest after user-stop turns. Everything else matches the owner decision: ≥5 tok/s → extended, else short; no measurement → short; bench modes pick the same slots.
