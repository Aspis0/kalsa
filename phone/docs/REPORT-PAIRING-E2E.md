# Pairing E2E readiness

## Changes

- **Paired door bridge:** [remoteDoorConfig.ts](../src/engine/remote/remoteDoorConfig.ts:12) chooses the saved pairing URL and credential together. When no pairing exists, it uses the typed remote URL and API token. A saved pairing wins if both sources exist. [RemoteEngine.ts](../src/engine/remote/RemoteEngine.ts:115) uses this for probes and :270 for streams. Pair-store wording is updated at [pairingCredentialStore.ts](../src/pairing/pairingCredentialStore.ts:7).
- **Wire credential proof:** [pairedDoorIntegration.test.ts](../src/pairing/pairedDoorIntegration.test.ts:26) runs the seal through storage and the door transport, then asserts the outgoing request has exactly one Authorization header containing the same 64 lowercase hex characters. The live header is set at [openaiTransport.ts](../src/engine/remote/openaiTransport.ts:287).
- **Honest phone declaration:** [PairingScreen.tsx](../src/screens/PairingScreen.tsx:23) uses the catalog GGUF byte size only when a concrete local model exists; otherwise it refuses before sending and shows `pairing.modelRequired` (:65-71). Parameters and throughput remain null; `battery_powered` is true.
- **Diagnostics:** [pairingTransport.ts](../src/pairing/pairingTransport.ts:184) can emit signed payload, MAC, delivery token and seal ciphertext as hex, plus only a SHA-256 credential fingerprint. The visible opt-in switch is [PairingScreen.tsx](../src/screens/PairingScreen.tsx:168); logs use the `KALSA_PAIRING_DIAGNOSTIC` tag.
- **Wire payload visibility:** [pairingWire.ts](../src/pairing/pairingWire.ts:88) exposes the exact framed signed payload for diagnostics. The frozen D payload is pinned in [pairingWire.test.ts](../src/pairing/pairingWire.test.ts:52).

## Tests and checks

- `remoteDoorConfig.test.ts`: paired URL and credential win together over manual values; no pairing preserves the manual path.
- `remoteEngine.lifecycle.test.ts`: probe and stream both use the paired address and credential.
- `pairedDoorIntegration.test.ts`: ceremony credential reaches the XHR header once and byte-identically.
- `PairingScreen.test.ts`: unknown/remote model refuses before desk I/O; declaration uses nonzero model bytes and phone power; diagnostics are reachable and never print the credential.
- `pairingTransport.test.ts`: diagnostic payload/MAC match the signed request, token/ciphertext are hex, and only the credential hash is logged.

Commands and results:

- `npx tsc --noEmit` — EXIT=0.
- `npx jest --silent` — EXIT=0, 225 suites / 2,410 tests.
- All 59 `node scripts/*.mjs` logic harness commands listed in `.github/workflows/apk.yml`'s “Typecheck + logic harnesses” step ran sequentially — EXIT=0, 59/59 completed with no early-stop marker.
- `git diff --check` — EXIT=0.

## Not verified

No APK build or phone run was performed. The real Tailscale desk/door ceremony remains for tomorrow. If the screen has no concrete local GGUF model id and catalog size, it now refuses rather than signing `weights_bytes: 0`.
