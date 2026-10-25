# Stale callback ownership fix

Branch `ux-2026-09-21`, starting HEAD `1a790d7c`. No commit or build was made.

## Fixes and behavioral tests

- **Token callback** — `src/host/sendHost.ts:276-279` now delegates through `handleOwnedSendToken` in `src/host/turnGuards.ts:61-73`. Ownership is checked before any write. Only non-empty owned text sets `hasTokens`; an owned empty delta still reaches the coalescer to clear a failed CPU partial and keeps the composer in prefill. Same-token retry and abort callbacks remain owned by the original fence token.
  - `src/host/ownedSendToken.test.ts:17-54` drives stale text, an owned empty retry delta, and ordinary owned output through that handler, asserting the visible composer phase as well as the ref.
  - **Expected breaking mutations:** moving the flag write above the ownership check makes the stale-send test fail (`hasTokens` becomes true and phase becomes `writing`). Counting an empty delta as output makes the retry test fail. Never setting the flag makes the ordinary-output test fail.
- **Turn completion** — `src/host/sendHost.ts:274` binds `isTurnOwner` to `fence.owns(token)`. `src/host/sendEngineAdapter.ts:18-35` carries that named predicate into `OwnedEngineTurnDeps` (`src/host/engineTurnDeps.ts:74-76`). `src/host/engineTurn.ts:105-112` creates the completion callback in `engineTurnFinish.ts:12-26`. It releases shared refs and calls `setStreaming(false)` only for the owner; it still resolves a stale invocation. The same guard also protects active-document and miniapp refs.
  - `src/host/engineTurnFinish.test.ts:20-69` retires the first token through the real stop watchdog, starts a second token, invokes the first completion late, and checks that streaming remains set. Its mirror confirms the owning completion clears streaming.
  - `src/host/sendHostOwnership.test.ts:32-115` renders the real hook, verifies its adapter receives the send's live ownership predicate and stable attachment snapshot, then invalidates the fence and delivers a late delta through the real `runSendStream` callback path. It asserts the actual token ref stays false and the composer remains in prefill.
  - **Expected breaking mutations:** removing or bypassing the owner guard in `engineTurnFinish.ts:18` makes the late-completion assertions fail; rejecting the owner instead makes the mirror fail. Replacing the send-scoped predicate with an always-true predicate makes `sendHostOwnership.test.ts:94-110` fail.
- `src/ui/shell/attachUi.test.ts:170-176` retains the append-path checks; the engine handoff and copied snapshot are now exercised behaviorally by `sendHostOwnership.test.ts`. `src/host/turnEnsureDispatch.test.ts:84-89` supplies an explicit owner predicate to its direct engine-turn invocation.

## Validation

- `npx jest --runInBand --silent src/host/ownedSendToken.test.ts src/host/engineTurnFinish.test.ts src/host/sendHostOwnership.test.ts src/host/turnEnsureDispatch.test.ts src/ui/shell/attachUi.test.ts` — EXIT=0, 5 suites / 31 tests.
- `npx tsc --noEmit` — EXIT=0.
- `npx jest --silent` — EXIT=0, 222 suites / 2,392 tests.
- `git diff --check` — EXIT=0.
- Earlier targeted attempts: `npx jest --runInBand --silent src/host/ownedSendToken.test.ts src/host/engineTurnFinish.test.ts src/host/turnEnsureDispatch.test.ts` — EXIT=1 on a watchdog fixture type mismatch; `npx jest --runInBand --silent src/host/sendHostOwnership.test.ts` — EXIT=1 because Jest does not transform the Expo filesystem import. The fixture was typed correctly and the hook test now mocks the terminal outcome seam; both pass in the final runs above.

No device behavior or build was verified; this change was validated with the TypeScript check and Jest only.
