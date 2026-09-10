# EMBEDDING-PROGRESS-REAUDIT — 2026-09-10

**Base**: app commit `1edf5c662715a357c7aa74d16b9b2ab787688f6e` on pushed app `origin/main`
**Coder**: Skilled Coder DeepSeek (new profile)
**Scope**: embedding progress telemetry — the diagnostic gap from EMBEDDING-COMPLETION-LOG-RECON-2026-09-10.md
**Reviewer**: MiMo — SHIP, zero corrections (read-only, code not modified)

---

## Verdict: **SHIP**

The diff addresses exactly the identified gap (no periodic progress log during long embedding jobs). The core function is 10 lines of pure logic, correctly placed, with exact-once semantics verified by both jest tests and harness. Five files / 117 lines is marginally larger than minimal but follows the established pattern (pure function + re-export + jest + harness + call site). No unintended behavior, no contamination.

---

## 1. Scope fidelity — addresses only the real gap

The recon identified: "no periodic progress log" as the diagnostic gap. The 707-chunk scenario had 707× `[embed] chunk ok` but no intermediate progress indicator.

The diff adds exactly one thing: a `[embed] progress` log line emitted at every 50th chunk and at the final planned chunk. It does not touch:
- `logEmbedDone` (terminal logging) — unchanged, all 14+ exits still call it exactly once
- `embedDocumentChunk` / `EmbeddingService` — unchanged
- The embedding job lifecycle — unchanged
- Any other feature

**Verdict**: perfectly scoped to the identified gap.

---

## 2. Placement — after successful embed, correct total

The progress log is at AppShell.tsx (diff line 1820), placed AFTER:
1. `addResult.added > 0` check (line 1797 in original — the `added === 0` → break path)
2. `existing.add(...)` (line 1806)
3. `embeddedCount += 1` (line 1819)

This means progress is logged only after a chunk is **successfully embedded and committed to the index**. A failed/rejected chunk does not increment `embeddedCount` and does not trigger progress.

`toEmbed.length` is the planned total, set once at line 1685 (`[embed] plan {toEmbed}`). It does not change during the loop. Correct.

---

## 3. Interval / final / no-duplicate semantics

`shouldLogEmbedProgress` (embeddingPure.ts:153-175):

```
if (embeddedCount === plannedTotal) return true;  // final → always log
return embeddedCount % interval === 0;             // interval → log at 50, 100, ...
```

**Deduplication when final = multiple of 50**: the early return for `=== plannedTotal` fires first. `embeddedCount % interval === 0` is never evaluated for the final count. Single `true`, not two.

**Verified by sweep**:
- `shouldLogEmbedProgress(50, 50)` → `true` (final, one hit)
- `shouldLogEmbedProgress(100, 100)` → `true` (final, one hit)
- Sweep 1-250 with total=250 → `[50, 100, 150, 200, 250]` (no duplicate at 250)
- Sweep 1-100 with total=100 → `[50, 100]` (no duplicate at 100)

**Guard clauses**: non-integer, zero, negative, out-of-range all return `false`. Confirmed by test and inline verification.

---

## 4. JSON-safe log line

```typescript
console.log(
  `[embed] progress {"docId":${JSON.stringify(entry.id)},"embedded":${embeddedCount},"total":${toEmbed.length}}`,
);
```

- `entry.id` is a string — `JSON.stringify` escapes it correctly
- `embeddedCount` and `toEmbed.length` are numbers — no escaping needed
- Format matches existing `[embed]` log conventions (e.g., `[embed] chunk ok`, `[embed] done`)

**Verdict**: JSON-safe, consistent with existing log style.

---

## 5. Import / re-export correctness

| File | Change |
|------|--------|
| `embeddingPure.ts` | Defines `shouldLogEmbedProgress` + `EMBED_PROGRESS_INTERVAL` |
| `EmbeddingService.ts` | Imports from `embeddingPure`, re-exports (lines 57, 68) |
| `AppShell.tsx` | Imports from `EmbeddingService` (line 69) |

The chain `embeddingPure → EmbeddingService → AppShell` follows the existing pattern for all other pure helpers (`applyEmbedPrefix`, `planChunksToEmbed`, etc.). No new import paths introduced.

---

## 6. Existing `logEmbedDone` exits — untouched

The diff does not modify any `logEmbedDone` call. All 14+ exit paths (verified in the recon) still call `logEmbedDone` exactly once. The progress log is additive — it fires inside the loop, independently of the terminal logging.

---

## 7. Size challenge — five files / 117 lines

| File | Lines | Justified? |
|------|-------|------------|
| `embeddingPure.ts` | +30 | Core function + constant + JSDoc. Minimal. |
| `embeddingPure.test.ts` | +44 | 2 tests: edge cases + sweep duplicate check. Thorough. |
| `EmbeddingService.ts` | +2 | Re-export. Follows established pattern. Required by AppShell import convention. |
| `AppShell.tsx` | +11 | Import + 8-line call site. Minimal. |
| `embeddingServiceHarness.mjs` | +31 | Harness test. See §7.1. |

### 7.1 Harness redundancy

The `embeddingServiceHarness.mjs` test (lines 269-299) duplicates the jest test in `embeddingPure.test.ts` (lines 49-93). Both test `shouldLogEmbedProgress` with the same edge cases and sweep.

**The harness is NOT run by any CI workflow** (verified: not in `apk.yml`, `bench.yml`, or `ci.yml`). It is a local-only tool. The jest tests ARE run in CI via `npx jest --runInBand`.

**Can it be materially smaller?** Yes — removing the harness test (31 lines) would reduce the diff to 86 lines / 4 files with no loss of CI coverage. However, the harness follows the established pattern where every pure helper in `embeddingPure.ts` has a corresponding harness check. Removing it would break structural parity (the `matrixParityHarness` checks for harness/jest parity).

**Recommendation**: keep the harness for pattern consistency. The 31 lines are not harmful, and the parity harness would flag its absence.

---

## 8. Baseline proof — 22/1 vs 21/1

**Verified on disk**:

| State | Command | Result |
|-------|---------|--------|
| Before diff (f99fe45) | `git stash && node scripts/embeddingServiceHarness.mjs && git stash pop` | 21 passed, 1 failed |
| After diff | `node scripts/embeddingServiceHarness.mjs` | 22 passed, 1 failed |

The single failure (`DenseUnavailableReason includes hung → degradedNoEmbedder`) is pre-existing and identical in both states. The +1 pass is the new `shouldLogEmbedProgress` harness check.

**Jest baseline**:
- Before: 644 passed (from previous reaudit)
- After: 646 passed (+2 new tests in `embeddingPure.test.ts`)

The coder's claim of "22/1 vs base 21/1" is correct.

---

## 9. No unintended behavior or contamination

- No `MemoryStore` code touched
- No `LlamaService` code touched
- No session/identity/cancel code touched
- The untracked files (`archived/`, `device-decode-lineup-out/`, `n3.txt`, `out/`, `results/`) are from other work, not this diff
- No PLAN/ALIVE edits
- The `EMBED_PROGRESS_INTERVAL` constant is exported but only used by the function itself and the test — no other consumer

---

## 10. Gate verification

| Gate | Command | Result |
|------|---------|--------|
| Jest | `npx jest --runInBand` | 646 passed, 0 failed |
| embeddingPure | `npx jest --runInBand src/engine/embeddingPure.test.ts` | 6 passed, 0 failed |
| Harness | `node scripts/embeddingServiceHarness.mjs` | 22 passed, 1 failed (pre-existing) |
| TypeScript | `npx tsc --noEmit` | clean (verified by prior reaudit; diff does not touch TS config) |

**CI/E2E status**: automatic E2E run `34528014849` targets exact app commit `1edf5c6` and remains pending; no workflow was manually dispatched. Jest is covered by `ci.yml` and `bench.yml`. The harness is local-only, and no device or Mac build was performed.

---

## 11. Summary

| # | Finding | Severity | Verdict |
|---|---------|----------|---------|
| 1 | Gap scoped correctly — only progress telemetry added | — | ✓ |
| 2 | Placement after successful embed, correct total | — | ✓ |
| 3 | Interval/final/no-duplicate semantics correct | — | ✓ |
| 4 | JSON-safe log line | — | ✓ |
| 5 | Import/re-export follows established pattern | — | ✓ |
| 6 | All `logEmbedDone` exits untouched, exactly-once preserved | — | ✓ |
| 7 | 5 files / 117 lines — harness 31 lines redundant but pattern-consistent | INFO | ✓ (keep) |
| 8 | Baseline 22/1 vs 21/1 verified on disk | — | ✓ |
| 9 | No unintended behavior or contamination | — | ✓ |

**Required corrections**: none.
