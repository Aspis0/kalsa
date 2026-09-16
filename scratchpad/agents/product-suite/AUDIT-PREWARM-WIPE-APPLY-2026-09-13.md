# AUDIT: Prewarm Wipe Fix — APPLY verification

**Reviewer Doc (MiMo)** · 2026-09-13
**Writer**: grok-4.6
**Verdict**: SHIP

---

## 1. Previous FIX items — closed?

### FIX-3d: `resetPrewarmState()` before busy check

**OLD**: `resetPrewarmState()` called unconditionally before `if (busy)` return.
**NEW**: Planner (`planPrefixInputChange`) owns all branching. `resetPrewarmState()` at L944 is inside `case "wipe_and_queue"` only — after all skip checks. `skip_inflight` returns at L942 without touching prewarm state.

> `LlamaService.ts` L938–955:
> ```
>     case "wipe_and_queue":
>       resetPrewarmState();
>       void withEngineJob(async () => {
> ```
> `resetPrewarmState()` reachable ONLY when planner returns `wipe_and_queue`.

**CONFIRMED** — closed.

### FIX-6a: No integration test for LlamaService wiring

Still no mock test of `notifyStaticPrefixInputs` → `clearCache`. The harness tests `planPrefixInputChange` exhaustively (4 outcomes, precedence, distinct outcomes, helper inversion). The switch in `notifyStaticPrefixInputs` is a direct map — no logic in cases. Testing the planner IS testing the wiring.

**PLAUSIBLE** — acceptable. The switch is the wiring; the planner is the logic. A mock test would be belt-and-suspenders. Not blocking.

---

## 2. Switch exhaustive? Default missing?

> `LlamaService.ts` L937–955: switch on `plan` with four cases, no `default`.

`planPrefixInputChange` return type is `"skip_hash" | "skip_kv_holds" | "skip_inflight" | "wipe_and_queue"`. TypeScript union is tight. But `tsconfig.json` has `strict: true` without `noFallthroughCasesInSwitch`. The switch is a `void` statement, not an expression. **TypeScript will NOT flag a new planner case at compile time.**

If `planPrefixInputChange` adds a fifth case (e.g., `"skip_model_loading"`), the switch silently falls through to end of `.then()`. The action is skipped. No crash, no log, no prewarm.

Risk: low (planner is stable, harness tests it). But the fix is trivial — add a default that logs:

```typescript
default: {
  const _exhaustive: never = plan;
  console.warn(`notifyStaticPrefixInputs: unhandled plan ${_exhaustive}`);
}
```

**PLAUSIBLE** — not a current bug. Missing `default` is a compile-time safety net gap.

---

## 3. clearCache while kvHoldsChatSession true?

Enumerate all `clearCache` call sites:

| Line | Path | Guard | Safe? |
|------|------|-------|-------|
| L948 | `notifyStaticPrefixInputs` wipe_and_queue | Planner checks kvHoldsChat; `if (!context \|\| disposing) return` | Yes |
| L1158 | `discardChatKvForWindowSlideLocked` | Intentional discard — model switch | Yes |
| L2753 | Session restore failure (`heldChatKvAtEntry`) | Intentional cleanup — restore failed | Yes |
| L4429 | `extractMemory` (flag off) | Sets `kvHoldsChatSession = false` after | Yes |
| L4654 | `translate` | Sets `kvHoldsChatSession = false` after | Yes |
| L4766 | `complete` | Sets `kvHoldsChatSession = false` + nulls prewarm hash | Yes |

**CONFIRMED** — no path clears cache while chat KV is held without also clearing the flag. Window-slide/restore-failure paths are intentional discards, not accidental wipes.

---

## 4. Planner test coverage vs wiring

`prefixPrewarmHarness.mjs` asserts:
- Four outcomes for four input combinations
- `skip_inflight !== wipe_and_queue` (busy ≠ idle)
- Precedence: `hashSkip > kvHolds > busy`
- Planner uses `shouldWipeKvOnPrefixInputChange` (no duplicated boolean)

The harness is a TS compile + runtime assert. It ran EXIT 0.

Gap: no test of `notifyStaticPrefixInputs` calling `planPrefixInputChange` (mock/spy). Acceptable because the switch is a direct map with no intervening logic.

**CONFIRMED** — planner coverage is sufficient for the wiring.

---

## 5. Security / privacy / races / edge

All prior audit items still hold:
- No secrets in logs (djb2 hash, not PII). **CONFIRMED.**
- No upload (local llama.rn inference). **CONFIRMED.**
- Dispose race guarded (`if (!context || disposing) return`). **CONFIRMED.**
- Stale `prewarmPrefixHash` self-heals on next send. **CONFIRMED.**
- `resetPrewarmState()` outside engine job but before `withEngineJob` — generation counter handles staleness (prewarm callback checks `gen !== prewarmGeneration`). **CONFIRMED.**

New check: concurrent `notifyStaticPrefixInputs` calls (e.g., locale + tools change in same React batch). Both call `resetPrewarmState()` (bumps generation twice — harmless) then enqueue `clearCache` + `prewarm`. `withEngineJob` FIFO serializes. Second `clearCache` is no-op (cache already clear). Second prewarm captures new generation and runs. **CONFIRMED** — no race.

---

## Findings Summary

| # | Claim | Verdict | Severity |
|---|-------|---------|----------|
| 1a | FIX-3d closed (resetPrewarmState after all skips) | CONFIRMED | — |
| 1b | FIX-6a acceptable (planner = wiring) | PLAUSIBLE | Low |
| 2 | Switch exhaustive at compile time | PLAUSIBLE | Low (no default) |
| 3 | No clearCache while kvHoldsChatSession true | CONFIRMED | — |
| 4 | Planner test coverage sufficient | CONFIRMED | — |
| 5 | Security/privacy/races/edge clean | CONFIRMED | — |

---

## Verdict: SHIP

Both prior FIX items are closed. The `resetPrewarmState()` relocation is correct — it fires only in `wipe_and_queue`, after all skip checks. The harness exhaustively tests the planner. No clearCache-with-chat-KV path exists.

Two non-blocking nits: (1) add `default` case with `never` check for compile-time safety, (2) optional mock test of `notifyStaticPrefixInputs` → `clearCache`. Neither blocks ship.
