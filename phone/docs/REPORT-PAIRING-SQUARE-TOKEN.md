# Pairing square token guard

## Changes

- `src/screens/PairingScreen.test.ts:230-287` drives the screen path independently for code, nonce, and reachable edits. Each edit is visible in the field, then a second claim/complete carries a fresh deterministic token. The first completion loses its response to ensure this is a new square, not the retry path. No production behavior changed for token allocation.
- `src/pairing/pairingTransport.test.ts:34-72` already pins the mirror: after a completion response is lost, retrying the same session sends the identical completion body and token, without a second claim.
- `src/pairing/pairingTransport.ts:41-44,176-218` adds an opt-in diagnostic record when a completion retry receives the desk's 403 refusal. It names the known possibility that the desk spent the delivery before its response was lost and says recovery is to request a fresh square. `PairingScreen.tsx:94-96,168-176` connects this to the visible diagnostics switch. `src/pairing/pairingTransport.test.ts:74-101` exercises that event after a lost response and refusal.

## Runtime guard decision

I did not add a `PairingSession` square-mismatch guard. The current screen clears its session on every field edit (`PairingScreen.tsx:59-62`) and only reuses it while a completion retry is pending (`:81-101`). The screen-level test now exercises all three square fields and would fail if an edit reused the old token. A second runtime check would defend against a future internal mutation the current flow does not perform, so I judged it defense in depth rather than a correctness requirement for this APK.

## Verification

- `npx tsc --noEmit` — EXIT=0.
- `npx jest --silent` — EXIT=0; 225 suites, 2,414 tests passed.
- APK workflow logic harness list — EXIT=0; all 59 scripts passed.
- `git diff --check` — EXIT=0.
- No tests were weakened. No build or device run was performed. The new diagnostic event is source code and is not in the APK already building from `9aee6606`; the token lifecycle behavior in that APK remains the previously verified screen structure.

## Limits

I verified the client-side token lifecycle and diagnostic callback with automated tests. I did not verify tomorrow's real Tailscale pairing or inspect desktop logs from that run.

## Correction (2026-09-24, measured after the commit)

The commit message for this work says: *"forcing a fresh token on retry fails 3 tests"*. **That is false**, and
the way it became false is worth keeping.

What actually happened, in order:

1. My first mutation of the retry path produced `Tests: 0 total` — the suite **failed to run** because my edit
   left `existing` unused and TypeScript refused to compile it. I read the non-zero exit code as a passing
   verification.
2. A second attempt, type-safe at the call site but still leaving the variable unused, gave the same
   `0 total`.
3. The third attempt — `const retryingCompletion = existing?.needsCompletionRetry() === true && false;`, which
   keeps the variable used — ran the suite properly: **EXIT=0, 10 tests passed.** The mutation **survives**.

So the half of the rule that says *a lost completion response is retried with the same token* is **not
protected by a test that bites**, while the other half (a new square mints a fresh token) is: changing the
field handler fails 3 tests. The mirror test is being written, and this note stays until it lands, because
the difference between "the tests cover the rule" and "the tests cover one end of the rule" is exactly the
kind of thing a green run hides.

**The rule this leaves behind, and it is not about pairing**: a mutation is evidence only after reading what
it actually ran. `Tests: N total` of zero, or a suite that failed to load, is not a failing test — it is no
test, and it looks the same in the exit code.
