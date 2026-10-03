# Doorless pairing flow review

Compared `~/Projects/kalsa-node22` (`3d0b07d0`) against `origin/main` (`c7bee6db`), read-only. No tests were run.

## Findings

### P1 — CONFIRMED: iroh pairing can save a disallowed nonempty address and leave the new pairing unusable

When an invite has a node but no tailnet, `PairingScreen` takes the configured URL prefill. The iroh path skips URL validation even when that prefill is nonempty and disallowed. It substitutes the synthetic origin for the *desk* only, then saves the original `doorUrl`. For example, an existing `http://192.168.1.20:8080` Remote Brain setting survives `pairingUrlPrefill` (it accepts HTTP at lines 31 and 37) but is disallowed by `isAllowedPairingUrl` (HTTP is accepted only for loopback, `src/pairing/pairingUrls.ts:16-19`).

Evidence:

- `src/screens/PairingScreen.tsx:254`: `if (!viaIroh && !isAllowedPairingUrl(doorUrl)) {`
- `src/screens/PairingScreen.tsx:295-296`: `const deskUrlForSession = viaIroh && !isAllowedPairingUrl(deskUrl) ? IROH_TUNNEL_URL : deskUrl;` (only the desk URL gets replaced)
- `src/screens/PairingScreen.tsx:327`: `await savePairingCredential(credential, doorUrl.trim(), {`
- `src/pairing/pairingConfirmation.ts:160-165`: the confirmation URL falls back only for `paired.doorUrl === ""`, then sends Authorization only when `canSendAuthorization(url)` allows it. A nonloopback HTTP URL gets no bearer, so Allow polling cannot confirm the pairing.
- `src/engine/remote/doorRequestBase.ts:19`: `if (door.url !== "") return { ok: true, base: door.url };`
- `src/engine/remote/remoteUrl.ts:114-116`: `if (!remoteUrlAllowedInThisBuild(url)) return "remote_brain_https_required";`

The record then also fails later remote probes/chat at the URL gate. Treat a disallowed prefill as absent on the iroh path (or reject it before saving); currently the doorless sentinel is selected only for an exactly empty string.

### P2 — CONFIRMED: room consumers do not receive the new human-readable iroh-missing error

`roomDoorForCall` returns the new code as the `message` on a generic `door_unusable` result. The room stream then stops for every non-`removed` error without emitting an error event. This bypasses `humanRemoteBrainError` and its `remote_brain_iroh_missing` translation, so room API callers receive a snake_case message and a room event stream silently disappears when its doorless pairing loses the iroh module/node. I found no in-repo UI caller for the room APIs, so this is P2 rather than a confirmed current screen failure.

Evidence:

- `src/room/roomApi.ts:130-132`: `return { ok: false, error: { code: "door_unusable", message: resolved.error } };`
- `src/room/roomStream.ts:141-146`: `if (error.code !== "removed") { stop(); return; }`
- `src/engine/remote/remoteBrainErrors.ts:15`: `remote_brain_iroh_missing: "settings.remoteBrainFailIrohMissing",` (this mapping is used by remote probe/chat UI, not by the room result or stream path).

## Checked; no additional finding

- A nonempty valid door URL remains the request base in probe, chat, room calls, room event reconnects, and pairing confirmation; the road is still chosen by `chooseRoad`/`establishDoorRoad`. Manual HTTPS pairing and scanned Tailscale URLs retain their existing request URLs and fallback policy.
- Doorless records persist `doorUrl: ""`; decoders accept that string and continue decoding missing `pairedVia` as `null`, so old records with populated URLs retain their existing behavior. Saving another pairing still appends it and makes it active through the existing map mutation path.
- `completeRetryPending` reuses the original `PairingSession` and its synthetic desk URL; the Allow poll keeps one road/fetcher and retries after failed establishment. I found no changed ordering or stale-tunnel replay in those paths.
- The new code is mapped to human copy for settings probes/model status and remote chat errors. The room finding above is the uncovered surface.
