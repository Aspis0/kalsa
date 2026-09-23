# Pairing client slice

## Implementation

- `src/pairing/sha256.ts:1-137` adds synchronous SHA-256, HMAC-SHA256, UTF-8, and strict lowercase-hex byte helpers without adding a dependency.
- `src/pairing/pairingWire.ts:23-158` implements the ordered canonical writer, `10.0` integral-f64 rule, 8-byte big-endian framing, phone MAC, stream-key derivation, XOR opening, exact 32-byte ciphertext validation, and constant-time ciphertext-MAC comparison. `pairingWire.test.ts:33-67` passes frozen A, B, C, and Python D; D agrees with A/B's byte contract.
- `src/pairing/pairingTransport.ts:60-181` posts only `/pair/claim` and `/pair/complete` to the desk URL. It preflights body and request-head limits, sets JSON content type, `Connection: close`, and one byte-counted `Content-Length`. Every non-success resolves to one null/refusal outcome. A lost complete response retries complete with the same token; any received response ends that attempt. `pairingTransport.test.ts:33-129` pins headers/body, caps, retry reuse, 200 termination, and fresh-token behavior after refusal.
- `src/pairing/pairingUrls.ts:3-35` validates HTTPS (or loopback HTTP) and prefills the editable desk address on the same host at port 8443. The two fields stop following each other after initialization; `PairingScreen.test.ts:114-142` exercises independent edits.
- `src/pairing/pairingCredentialStore.ts:1-31` keeps the verified credential as 64 lowercase hex in SecureStore, alongside the door URL. Pairing failures do not write or delete it. `PairingScreen.test.ts:144-177` verifies the waiting state after a seal, desk-only requests, one generic refusal across 401/403/503, and preservation of a pre-existing credential.
- `src/screens/PairingScreen.tsx:23-181` adds the manual debug screen with door/desk URL, reachable, code, nonce, and node fields. `RemoteBrainSettings.tsx:38-45,482-492` exposes its entry; `SettingsScreen.tsx:208-210,926-936,1448-1455,2471-2479` mounts it full-screen and returns to Advanced. No camera or live door probe was added.
- `src/i18n/en.ts:456-470` and `src/i18n/it.ts:451-465` add the neutral refusal and the confirmation-waiting copy. `src/pairing/pairingCopy.test.ts:4-16` pins both.
- The phone declaration uses the current registry model's `sizeBytes`; parameter counts, measured throughput, and battery state are null because this tree has no corresponding phone facts. No files exceed 350 lines.

## Boundaries

- The credential is isolated from the live remote-engine token store until that integration is authorized. No door request is made after completion.
- A live door `401` and its quiet retry cannot be exercised in this slice without adding the prohibited door connection. This client never clears a credential on an HTTP failure; the pairing screen presents the same refusal for all statuses. The actual door retry remains unverified until the live route exists.
- Explicit headers are asserted at the Fetch boundary, but native transport behavior (including whether the platform preserves one `Content-Length`) was not device-verified. No build or device run was performed.

## Verification

- `npx jest src/pairing/pairingCopy.test.ts src/pairing/pairingWire.test.ts src/pairing/pairingTransport.test.ts src/pairing/pairingUrls.test.ts src/pairing/pairingCredentialStore.test.ts src/screens/PairingScreen.test.ts src/screens/RemoteBrainSettings.hydration.test.ts --runInBand --silent` — EXIT=0; 7 suites / 44 tests.
- `npx tsc --noEmit` — EXIT=0.
- `npx jest --silent` — EXIT=0; 218 suites / 2,399 tests.
- `git diff --check` — EXIT=0.
- During implementation, typecheck first exited 2 because a new `.test.tsx` was included by app `tsconfig`; the test was converted to `.test.ts`, and typecheck passed. An intermediate full Jest run exited 1 on the existing Settings page state-shape assertion; the pairing screen was separated from the `home | advanced` page state, preserving that assertion, and the full suite passed.
- HEAD advanced from requested `2bb3f0ae` to `645c95c4` during this work through a capture-only commit of four PNGs. I made no commit. No build, install, or device operation was run.
