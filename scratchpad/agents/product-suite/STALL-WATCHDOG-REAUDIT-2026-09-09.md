# RE-AUDIT — stall fix v2 (read-only)
Files: stallWatchdog.ts (2 rules), prefillDeadline.ts, prefillSpeed.ts(+getLastPromptTokens), admissionModel.ts(+test), LlamaService.ts, AiChatPage.tsx. jest 16/16 (4 suites); tsc exit 0.

## (1) Previous CONFIRMED items — closed?
- CONFIRMED closed: tonight's crawl caught. stallWatchdog.ts:8-10 gap 10 s + rate <0.5 tok/s after 30 s. Tonight 15 tok/259.7 s: gap rule trips at ≥10 s token gap (17.3 s avg gap → trips ~first silent stretch), rate rule independently trips at elapsed≥30 s (stallWatchdog.ts:53-58). Test at stallWatchdog.test.ts:51-75 proves 4 tok/30 s = 0.133 <0.5 → reason "rate". Abort at ~10-30 s instead of 260 s.
- CONFIRMED closed: prefill watched when EMA exists. armPrefillDeadline (LlamaService.ts:2896-2932) called at :3370 (each round, after governor refresh) and :3735-3736 (fallback); timer cleared on first token (:3410 clearPrefillDeadline) and at round end via stopStallWatchdog (:3424, which also calls clearPrefillDeadline :2834).
- CONFIRMED closed: double emit gone. onModelEmittedText now INSIDE finishOnce (LlamaService.ts:2847-2856): a second abort() (checkStall then signal onAbort) hits finishOnce no-op — no re-emit, no double onError/onDone. The one side effect I flagged is now guarded.

## (2) Rate-rule false-trip analysis
- Long reasoning: noteToken fires BEFORE cleanStreamDelta on every TokenData (LlamaService.ts:3407-3410), think content counts as tokens — no false stall during reasoning. (Carried from v1 audit; unchanged.)
- Tool rounds: stopStallWatchdog at round-loop top (:3348) clears interval AND resets watchdog (firstTokenAt=null) → the rate window restarts at the next round's first token; tool execution between rounds is unwatched by design. CONFIRMED.
- Healthy <0.5 tok/s in catalog? Evidence says no: Jelly MiniCPM5 2.8-3.7 tok/s (archived/docs/KALSA.md:661), MiniCPM5 S23 6.5, LFM 10.4-11.7, dense Qwen3.5-4B 8.06/5-8 (HARNESS_FINDINGS.md:5324, :321), emulator CI 2.45 (BENCH_FASE4:155). The sub-0.5 numbers in docs (0.357/0.861/0.4) are all measured page-cache-storm pathologies; the 0.4 tok/s bimodal KEXP artefact was DROPPED from the catalog (KALSA.md:646). 5× margin over 0.5 even at 2× thermal slowdown. CONFIRMED safe. Caveat PLAUSIBLE: a future slow tier (e.g. 35B streamed, 5.7 tok/s CLI but bimodal in-app) could sit near the floor — the threshold is a constant, not per-model.
- One real residual: the rate rule can fire on a LEGITIMATELY slow-but-alive bursty start (1 token in the first 30 s → 0.033 <0.5 → abort at 30 s even if decode would have settled at 2 tok/s). Window starts at first token so prefill doesn't count — acceptable, but a 0.3 tok/s cold model that warms up gets killed at 30 s. Not tonight's case; PLAUSIBLE acceptable.

## (3) Prefill deadline
- CONFIRMED per-model: lastPromptTokensByModel Map keyed by modelId (prefillSpeed.ts:20, :42); no reset on switch but keys never cross-contaminate; stale larger values only LENGTHEN the deadline (max() at :2907-2910). Never shorter than a healthy hot prefill: 5× EMA covers 2× thermal + 2× estimate error (prefillDeadline.ts:7-9 documents the 225 s measured case vs 90 s floor); floor 90 s prevents jitter trips on short prompts.
- CONFIRMED unwatched-first-turn: prefillDeadlineMs returns null with null EMA (prefillDeadline.ts:18-24); armPrefillDeadline returns silently (LlamaService.ts:2926-2928 "if (deadlineMs === null) return;") — no timer, no error log, no false claim. Decode gap/rate rules still cover the turn.
- PLAUSIBLE (minor): chars/4 via JSON.stringify(currentMessages) (:2899-2901) underestimates promptN when tool schemas are large (tools are NOT in currentMessages) — but lastPromptTokens (which includes template+schema overhead, comment :2897-2898) covers rounds 2+ and all post-first turns; 5× margin covers the rest.

## (4) Timers and finally
- CONFIRMED: stopStallWatchdog clears BOTH interval and prefill timer (:2827-2835); invoked at round top (:3348), round end (:3423-3424), fallback round end (:3769-3770), fallback catch (:3800-3801), inside abort (:2846), and the function finally (:3839-3840). bailIfStopped() early-returns fall through to the same finally. Late prefill-tick guards `if (finished || aborted) return;` (:2924). dispose safety-net path covered by finally. REFUTED (no leak).

## (5) Admission
- CONFIRMED: resolveAdmissionModel returns {mid: selectedModelId, alreadyResidentPossible: activeModelId===selectedModelId} (admissionModel.ts:10-13) — active=A/selected=B → mid=B, not-resident, memory check runs against B's bytes. 4-case test.each (admissionModel.test.ts:4-27) pins the contract including cold and lost≠selected. reasonKey allow-marker "no_active_model" only reaches the log (banner still uses decision.bannerKey, AiChatPage.tsx:1947-1949). Undownloaded B still fails later in ensureEngine with modelNotDownloaded — acceptable.

## (6) i18n
- CONFIRMED: generationStalled en:653-654/it:652-653 and prefillStalled en:655-656/it:654-655, both `{seconds}`, both inside errors:{} (en.ts:642, it.ts:641). Both consumed at LlamaService.ts:2887/:2936.

## Dead code
- REFUTED: all new exports consumed (getLastPromptTokens LlamaService.ts:2904; prefillDeadlineMs :2915; resolveAdmissionModel AiChatPage.tsx:93). Note: resolveAdmissionModel accepts lostModelId but never reads it — intentional per its doc comment (admissionModel.ts:2-3, recovery scoped by caller via shouldRecoverLost); documented, not dead.

## Verdict
All three v1 CONFIRMED items closed; no new leaks or races found; thresholds evidence-backed. Remaining (non-blocking):
1. MIN_DECODE_TOK_PER_SEC is a global constant — pin a per-model floor when a tier ships with measured decode <1 tok/s (none today).
2. Rate rule aborts at 30 s even for a turn that would have recovered (bursty cold start) — acceptable tradeoff, document it.
3. Consider logging KALSA_STALL when a prefill is left unwatched (null EMA) once per model, so field logs show the coverage gap instead of silence.
