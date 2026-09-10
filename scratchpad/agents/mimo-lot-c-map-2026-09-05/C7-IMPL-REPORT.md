# C7 — Battery ETA MVP · Implementation Report

**Date:** 2026-09-05 · **Branch:** `feat/moe-stream` · **Commit:** `3600000` line work

## What was built
Slope-based battery ETA projected **under the chat model bar** in `AppShell`, advisory only (never blocks chat).

## Files changed (staged only)
| File | Δ | Role |
|---|---|---|
| `src/engine/batteryEta.ts` | rewrite (~120 lines) | Pure slope→rate→ETA estimator, fail-open. |
| `src/engine/batteryEta.test.ts` | fix 1 assertion | 13 tests, all pass. |
| `src/hooks/useBatteryEta.ts` | unchanged (already wired) | Rolling window + power/State detection. |
| `src/app/AppShell.tsx` | +~69 | Move `currentModel` up; render battery line ≤50% & model ready. |
| `src/i18n/en.ts` | +6 | `chat.battery*` keys. |
| `src/i18n/it.ts` | +6 | Italian `chat.battery*` keys. |

Unrelated dirty tree (`device-decode-lineup-out/`, `docs/AUDIT_*`, `out/`, `results/`, `n3.txt`) left untouched.

## Engine design (vs. MVP map)
- **Slope from `expo-battery` level samples**, not `CURRENT_NOW`/µA.
- **Fail-open ordering:** non-finite → `unknown`; `n<minSamples` → `measuring`; `span<minSpanMs` → `measuring`; battery rose → `charging`; observed drain rate below `minDropPct/minSpanMs` → `unknown`; reserve exceeds level / ETA > `maxHours` → `unknown`; else `eta` with a half-hour band.
- Defaults: `minSamples 3, minSpanMs 600s, minDropPct 1, reservePct 5, maxHours 24`.

## Test result
`node_modules/.bin/jest src/engine/batteryEta.test.ts` → **EXIT 0 · 13 passed / 13**.
Full `tsc --noEmit` → **0 errors**.

## Corrections made (both were bugs in the provided artifacts)
1. **Engine sign + type.** `netDrop` must be `first − last` (drain = level falling). Also `BatteryEtaResult` is a single object type (`kind` + optional eta fields) so the test's un-narrowed `.lowHours` access type-checks.
2. **Test 6 contradiction.** The "healthy drain" test asserted `lowHours > 2.5` **and** `lowHours === 2.5` — impossible. Its own comment says `low=2.5`, so the strict `toBeGreaterThan(2.5)` was changed to `toBeGreaterThanOrEqual(2.5)` (value unchanged at 2.5).

## AppShell wiring notes
- Moved `const currentModel = MODEL_REGISTRY[modelIndex];` up before the `useBatteryEta` hook (was a TDZ error — the hook referenced `currentModel.id` ~90 lines before its declaration).
- Fixed malformed JSX: a stray `}>` left the `{kind === "eta" …}` expression unclosed and produced a duplicate `</Text>`.

## Left unfinished
- None for C7. No push performed.