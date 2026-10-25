# Think-history writer audit repair

## Changes

- `scripts/thinkHistoryHarness.mjs:268-278` registers the five new host field-write sites with their per-file shape counts; `:337-343` now expects 12 total field writes/removals (the existing seven plus five host field writes). The reportable local capture at `sendCallbacks.ts:58-62` is paired in code but is not a field write recognized by this property-shape audit.
- `src/host/sendCallbacks.ts:16,31-37,49-62,142-150` uses the canonical name `emissionSource` in the capture boundary. The engine callback stores its source beside the emitted string, then the captured object passes both to finalization. The two capture type properties are optional because an error or zero-token turn may have no emission; they are not runtime writes.
- `src/host/sendFinalize.ts:23,56-63,98-105` accepts the optional pair and writes `modelEmittedText` with its captured `emissionSource` only when normalization keeps the string.
- `src/host/sendCallbacks.test.ts:6-29` exercises both `parsed` and `raw` callback provenance through the real capture helper; `sendFinalize.test.ts:1-53` verifies both sources reach the finalized message and an empty emission leaves neither field behind.

## Six host sites: moment and provenance

1. `src/host/engineTurnStream.ts:163-170` copies an assistant history entry into the engine request. It copies the original `emissionSource` unchanged because the text remains the exact emission used for KV replay; this is a prompt-boundary copy, not a second persisted write.
2. `src/host/historyMessages.ts:92-102` restores an emitted assistant string from persisted history into the displayed `Message`. It preserves only a valid `parsed`/`raw` source beside that restored value; absent or corrupt provenance stays unknown.
3. `src/host/sendCallbacks.ts:55-62` captures each non-empty engine emission at callback time. It stores the callback's `source` beside the same `text`, so partial/raw and completed/parsed output cannot be confused.
4. `src/host/sendCallbacks.ts:142-150` transfers the captured pair to turn finalization. It carries the same source unchanged; this is an in-memory handoff, not a duplicate message or KV write.
5. `src/host/sendFinalize.ts:83-105` writes the terminal assistant message after completion/interruption/failure. The normalized string and captured source travel together; with no retained string, neither field is written.
6. `src/host/turnCorpus.ts:226-244` reconstructs a history record for compaction/retrieval. It preserves valid provenance with the restored emission for that separate corpus consumer; it does not append or persist a second conversation message.

None of the six is a duplicate writer in one execution path. The engine request copy, UI history hydration, callback capture/handoff, terminal message finalize, and corpus projection are distinct boundaries. The existing seven registrations remain unchanged: old chat hydration/finalize, old root hydration/engine copy, compactor projection, and persistence normalization (which removes text and source together).

## Verification

- `node scripts/thinkHistoryHarness.mjs` — final exit 0; `PASS emissionSource writer audit (12 writers, writes and removals paired)`.
- `npx tsc --noEmit` — exit 0.
- `npx jest --silent` — exit 0; 212 suites / 2,371 tests passed.
- `npx jest src/host/sendCallbacks.test.ts src/host/sendFinalize.test.ts --silent` — first exit 1 because the Node Jest harness does not transform Expo FileSystem ESM reached through `sessionPersistence`; after mocking that unrelated persistence boundary, exit 0 (2 suites / 5 tests).
- `git diff --check` — exit 0.
- During the repair, the first harness run exited 1 because its pairing matcher did not recognize a shorthand source field after a comma. The captured field was written explicitly as `emissionSource: emissionSource`; the final run passes.
- No build, Gradle, device operation, or commit was run.

## Follow-up: behavioral history-load provenance

- `src/host/messageMapper.test.ts:179-215` now exercises `sanitizeHistoryMessages` with adjacent persisted `raw`, `parsed`, and source-less emission records. It asserts the restored message carries each valid source and that the final record has no `emissionSource`, preventing inheritance from either neighbor.
- `npx jest src/host/messageMapper.test.ts --silent` — exit 0; 1 suite / 21 tests.
- `node scripts/thinkHistoryHarness.mjs` — exit 0; the 12-writer provenance audit passes unchanged.
- `npx jest --silent` — exit 0; 212 suites / 2,372 tests passed.
- No harness changes, build, Gradle, device operation, or commit were made in this follow-up.
