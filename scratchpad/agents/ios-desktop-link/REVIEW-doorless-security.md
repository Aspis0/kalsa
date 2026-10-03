# Doorless iroh pairing — security + privacy review

Worktree `~/Projects/kalsa-node22`, branch `pairing/iroh-no-door`, `git diff origin/main...HEAD`
(daab9f2f + 3d0b07d0). Read-only: nothing in the worktree was changed
(`git status --porcelain` empty before and after). `tsc --noEmit` exit 0; the six touched suites
62/62 pass.

Angle: can the bearer or user content leave via plain network fetch; downgrade attacks; pairing
secrets in logs/storage; `reachable` handling; MAC coverage; `isNonLoopback` with the stand-in base.

---

## The exhaustive egress inventory (this is what the verdict rests on)

There are exactly four places in the app that put a door URL on a real socket:

| # | site | transport | base source |
|---|---|---|---|
| 1 | `src/remote/doorRoad.ts:127` `const res = await globalThis.fetch(url, init);` | platform fetch | caller's `base` |
| 2 | `src/room/roomStreamWire.ts:63` `if (road.road === "https") return new XMLHttpRequest() as unknown as XhrLike;` | platform XHR | `joinRemoteApiUrl(target.base, …)` |
| 3 | `src/engine/remote/openaiTransport.ts:126` `: (new XMLHttpRequest() as unknown as XhrLike);` | platform XHR | `completionsUrl` |
| 4 | `src/pairing/pairingTransport.ts:96`/`:157` `globalThis.fetch as PairingFetch` | platform fetch | `pairUrl(deskUrlForSession, …)` |

Verified with `rg -n "globalThis.fetch|new XMLHttpRequest" src/engine src/room src/pairing src/remote`
— no fifth site. 1–3 all take their base from `doorRequestBase` (except #1 via
`pairedPropsProbe`, see P1-1) and their transport from the `DoorRoad` that `establishDoorRoad`
returned. 4's URL and its fetcher are both keyed off the same local `viaIroh` flag in one function
body (`src/screens/PairingScreen.tsx:291`, `:296`, `:305`) — that one is airtight.

`https://iroh.kalsa.invalid` cannot resolve (RFC 2606/6761 reserved TLD, no root delegation →
NXDOMAIN), and even a hostile/captive resolver that answers cannot complete the TLS handshake
without a publicly-trusted cert for `.invalid`. So "the bearer never leaves on the network" holds
today — **but only because of the two invariants below, and neither is enforced in code.** Both
are violated by reachable-to-corruption paths. That is the whole review.

---

## P0

**None confirmed.** I could not build a record, from any invite, that puts a pairing bearer on a
socket to an attacker-chosen host, nor a live path where `IROH_TUNNEL_URL` reaches `globalThis.fetch`.
The two invariants that make it true:

1. `src/screens/PairingScreen.tsx:254`/`:261` — `if (!viaIroh && !isAllowedPairingUrl(doorUrl))`
   — mean `doorUrl === ""` is only reachable with `viaIroh === true`, and `viaIroh` requires
   `chooseRoad(square.node, …).road === "iroh"` (`src/screens/PairingScreen.tsx:251`), i.e. a valid
   64-hex node. So a saved record is never `{doorUrl:"", node:null}`.
2. `src/pairing/pairingCredentialStore.ts:29` —
   `const pairedVia = node !== null && (via === "iroh" || via === "https") ? via : null;` — so
   `pairedVia` is never set on a node-less record.

Both live in *other* commits' files, and this branch widens what may be saved next to them
(P2-2), so they are load-bearing now. They should be asserted, not assumed.

---

## P1

**P1-1 — `pairedPropsProbe` is the one doorless base site with no URL gate and no road check;
it can hand the fresh bearer to `globalThis.fetch`. CONFIRMED by code read; PLAUSIBLE as an
exploit (needs a corrupt `node` field in the SecureStore blob).**

```
src/pairing/pairingConfirmation.ts:157-166
    // An iroh-only pairing saved no door address: on the tunnel the URL
    // only names the request line's path, so the stand-in origin carries
    // the /props request and its bearer (https reads as safe to sign).
    const url = joinRemoteApiUrl(
      paired.doorUrl === "" ? IROH_TUNNEL_URL : paired.doorUrl,
      "/props",
    );
    const headers: Record<string, string> = { Accept: "application/json" };
    if (canSendAuthorization(url)) headers.Authorization = `Bearer ${paired.credential}`;
    const response = await fetcher(url, { method: "GET", headers, signal });
```

Compare the three sibling call sites, which all (a) reuse `doorRequestBase` and (b) apply
`remoteUrlGateError`: `src/room/roomApi.ts:130-135`, `src/engine/remote/RemoteEngine.ts:147-157`
and `:377-384`. This one re-derives the stand-in by hand (`paired.doorUrl === "" ?`) with
**no module-presence check** and **no gate**. Trace it with a record `{doorUrl:"", node:null,
pairedVia:"iroh"}`:

- `establishDoorRoad` (`src/remote/doorRoad.ts:62-71`): `chooseRoad(null,…)` → `{road:"https",
  reason:"no_node"}`; the guard at `:64` is `if (isValidNodeHex(door.node) && door.pairedVia !== "https")`
  — `isValidNodeHex(null)` is false, so the guard is **vacuous** and `:71` returns `{road:"https"}`.
- `doorFetchFor` → `globalThis.fetch("https://iroh.kalsa.invalid/props", {headers:{Authorization:
  Bearer <credential>}})` — `canSendAuthorization` is true because the string says `https:`.
- `pollForAllowance` retries that every `CONFIRM_POLL_INTERVAL_MS` for up to
  `CONFIRM_DEADLINE_MS = 180_000` (`src/screens/PairingScreen.tsx:60`), so up to 180 s of
  bearer-bearing egress attempts from a screen that just minted the credential.

Such a record decodes cleanly: `src/pairing/pairingRecord.ts:43-45` nulls `node` on a bad
`isValidNodeHex` but **keeps `pairedVia: "iroh"`** — the decoder never cross-checks the two, and
`decodePairingRecord` returns a valid record, so the map is not even damaged. Every other door
path refuses this record correctly (`doorRequestBase` → `chooseRoad(null)` → https →
`remote_brain_iroh_missing`, `src/room/roomApi.door.test.ts:151-161` proves it). Only the pairing
confirmation poll takes the network road. Fix: call `doorRequestBase`-equivalent logic here (or
gate on `establishDoorRoad` returning iroh before naming the stand-in), and never name
`IROH_TUNNEL_URL` from `doorUrl === ""` alone.

**P1-2 — `roomStream.refuse` turns the fail-closed into a silent, permanent stop, and the
condition it tests is a module-presence memo that never retries. CONFIRMED.**

```
src/room/roomStream.ts:143-147
  const refuse = (error: RoomError): void => {
    if (error.code !== "removed") {
      stop();
      return;
    }
```

A doorless pairing whose `irohModulePresent()` is false yields `door_unusable` +
`remote_brain_iroh_missing` (`src/engine/remote/doorRequestBase.ts:31-35`) → `refuse` → `stop()`,
no reconnect, no listener event ("Anything else terminal (an unusable door) stops silently").
Recovering needs an app restart. And the predicate that produced the error is sticky for the whole
session:

```
src/remote/irohBridge.ts:24-33
let cached: IrohModule | null | undefined;
function loadModule(): IrohModule | null {
  if (cached !== undefined) return cached;
  try { cached = require("../../modules/kalsa-iroh/src/index") as IrohModule; } catch { cached = null; }
  return cached;
}
```

One transient `require` failure (bridge not yet unpacked, hot reload, a bad native link on a fresh
install) makes `irohModulePresent()` false until the process dies — and now that predicate decides
not just "which road" but "is this door usable at all". Note the inconsistency: `ensureStarted`
(`irohBridge.ts:52-61`) *does* clear its memo and retry; `loadModule` does not. A user who installs,
scans, gets "unreachable", restarts, and pairs fine has no way to know the first attempt poisoned
the session. The room stream is the visible symptom; chat fails the same way
(`RemoteEngine.ts:377-381` → `reportPreStreamError`).

**P1-3 — `doorRequestBase`'s road check is not the one `establishDoorRoad` makes; the comment
claiming they cannot disagree is false. CONFIRMED.**

```
src/engine/remote/doorRequestBase.ts:3-7
 * pairing that saved none (it rode iroh) — the iroh stand-in origin,
 * which only works while this phone still has the iroh road its pairing
 * dialed. The road check here is the same one `establishDoorRoad` makes,
 * so the base and the road a request actually rides cannot disagree.
```

They are different predicates:

- base side (`doorRequestBase.ts:20-26`): `chooseRoad(door.node, irohModulePresent).road === "iroh"`
  — node valid **and** module present.
- road side, guard path (`src/remote/doorRoad.ts:64`): `isValidNodeHex(door.node) && door.pairedVia !== "https"`.
- road side, fallback path (`src/remote/doorRoad.ts:86-88`): `door.pairedVia === "https"` →
  `{road:"https"}`.

`doorRequestBase` never looks at `pairedVia`. So for a record `{url:"", node:<valid>, pairedVia:"https"}`
the base is `https://iroh.kalsa.invalid` and a failed dial hands it to `globalThis.fetch` /
`new XMLHttpRequest` with `Authorization: Bearer`. `savePairingCredential` makes that record
unreachable *today*, but nothing in `doorRequestBase` knows that, and the entire fail-closed
argument in `src/pairing/pairingUrls.ts:6-8` ("a bug that ever routed one of these to the network
fetch fails closed instead of leaking the request") is resting on it. Make it a single shared
predicate — ideally have `doorRequestBase` take the already-decided `DoorRoad`, or assert
`pairedVia === "iroh"` before naming the stand-in — and correct the comment either way.

---

## P2

**P2-1 — the iroh road's stand-in rides on the real URL pipeline, so a caller that forgets the
gate sends cleartext. CONFIRMED (no live caller today).**

`fetchJsonOverTunnel` accepts any http/https URL and copies `parsed.host` / `pathname+search` into
the request (`src/remote/tunnelFetch.ts:50-76`), and `canSendAuthorization` keys off the scheme
string alone (`src/engine/remote/remoteUrl.ts:73-81`). Nothing in the tunnel path knows the request
is riding a loopback bridge, so "https ⇒ safe to sign" is an assumption with no enforcement point.
The two real carry sites are `PairingScreen.tsx:295-296` and
`src/pairing/pairingConfirmation.ts:160-163`; the latter has no gate at all (P1-1). A cheap
hardening: make the tunnel fetch refuse a non-loopback `host` outright, which makes the assumption
a check rather than a comment.

**P2-2 — the pairing screen no longer validates `doorUrl` before persisting it, on the iroh road.
CONFIRMED.**

```
src/screens/PairingScreen.tsx:254   if (!viaIroh && !isAllowedPairingUrl(doorUrl)) {
src/screens/PairingScreen.tsx:327   await savePairingCredential(credential, doorUrl.trim(), {
```

`isAllowedPairingUrl` (`src/pairing/pairingUrls.ts:12-23`) is the only thing that rejected
userinfo, query and fragment, and `src/engine/remote/remoteUrl.ts:46-48` spells out why that
matters for a stored URL ("A query string can carry a credential (?token=…) … so it never survives
normalization"). With `viaIroh` true, any string the user typed in `pairing.doorUrl` /
scanned-in tailnet is saved verbatim — no scheme check, no `normalizeRemoteUrl`, no userinfo or
query rejection. `savePairingCredential` (`src/pairing/pairingCredentialStore.ts:32`) does not
validate `doorUrl` either; it is the only writer in the app. Today the damage is bounded —
`remoteUrlGateError` re-checks the base at every call site (`roomApi.ts:134`,
`RemoteEngine.ts:156`/`:383`) so a bad URL becomes an unusable door, and the record lives in
SecureStore, not the AsyncStorage the `remoteUrl.ts` comment is about. But the invariant "a saved
pairing doorUrl passed `isAllowedPairingUrl`" is now false, and that string is what becomes
`door.url` → `doorRequestBase` → the request-line `Host` and path prefix the desktop sees. Run the
value through `isAllowedPairingUrl` (or `normalizeRemoteUrl`) before the save regardless of road;
a doorless pairing does not need the field at all, so the cheapest fix is to store `""` when
`viaIroh`.

**P2-3 — `tailnet` is unauthenticated and, after this branch, it steers a value that is no longer
just cosmetic. CONFIRMED.**

```
src/pairing/pairingTransport.ts:55   /** Optional v3 tailnet URL (validated at scan); "" = absent. Never MAC'd. */
src/pairing/pairingWire.ts:96-101    frame(utf8Bytes(input.reachable)), frame(utf8Bytes(input.node)),
                                     frame(utf8Bytes(input.deliveryToken)), frame(utf8Bytes(canonical))
```

`phoneMacPayload` covers `reachable`, `node`, `deliveryToken`, `phone` — **the coverage is
unchanged by this branch and is correct** — and `tailnet` is outside it. Before this branch a
substituted `tailnet` could at worst misroute an HTTPS pairing to an attacker host that then had
to mint the credential itself (no escalation). Now, on the iroh road, the tailnet-derived URL is
*also* saved as the record's `doorUrl`, so it decides (a) whether `doorUrl` is `""` and (b) the
`Host:` header and path prefix the desktop receives on every later room/chat request
(`tunnelFetch.ts:72-73`). The bearer still rides the tunnel to the MAC-verified node — **no leak,
no downgrade**, I checked this specifically — but an unauthenticated field now controls a stored,
logged-by-the-desktop value. Either MAC `tailnet` (v4 domain bump) or, on the iroh road, ignore it
and store `""`, which is what the user gets anyway.

**P2-4 — `isNonLoopback` on the stand-in classifies the least-network-capable base in the app as
the most exposed, and a plausible future edit to `IROH_TUNNEL_URL` silently deletes the token
requirement. CONFIRMED as written; PLAUSIBLE as a future bug.**

```
src/room/roomApi.ts:137    if (token === null && isNonLoopback(resolved.base)) {
src/engine/remote/RemoteEngine.ts:165   if (isNonLoopback(base) && !token) {
src/engine/remote/RemoteEngine.ts:401   if (isNonLoopback(base) && !token) {
```

`isNonLoopback("https://iroh.kalsa.invalid")` is `true` (`remoteUrl.ts:83-89`), so a doorless
pairing is treated as a public-internet door and is forced to carry a bearer. **No wrong deny
today**: `decodeDoorFacts` (`src/pairing/pairingRecord.ts:35-37`) guarantees a 64-hex
`credential`, and `getRemoteDoorToken` returns it for `source:"pairing"`
(`remoteDoorConfig.ts:50-56`), so the branch never fires. **No wrong allow today** either. The
problem is the semantic: the check asks "is this base on the public network?" about a string that
is by construction *not* a network destination, and the answer is coupled to the spelling of a
constant. Change `IROH_TUNNEL_URL` to `http://127.0.0.1:<port>` — the more natural spelling for
"the desktop's loopback server", and one a reviewer would consider an improvement — and
`isNonLoopback` flips to `false`, so `remote_brain_token_required` disappears for every doorless
door, and `canSendAuthorization` (`remoteUrl.ts:77`) becomes the only thing deciding whether a
bearer rides out. Decide the question the guard is actually asking (road, not host) rather than
letting the host answer it.

**P2-5 — no test covers the disagreement this design depends on. CONFIRMED.**

`src/room/roomApi.door.test.ts:11` `jest.mock("../remote/doorRoad", () => ({ establishDoorRoad:
jest.fn(), doorFetchFor: jest.fn() }))` replaces the road entirely, so
`remoteEngineDoorless.test.ts` and `roomApi.door.test.ts` together assert base and road
*separately* and never together. The one `expect(fetchSpy).not.toHaveBeenCalled()`
(`remoteEngineDoorless.test.ts:211`, `:244`, `:254`, `:269`) runs only with
`pairedVia: "iroh"` and a successful dial. There is no test for
`{doorUrl:"", node:<valid>, pairedVia:"https"}` — the P1-3 downgrade — nor for
`{doorUrl:"", node:null, pairedVia:"iroh"}` — the P1-1 one. Add both; they are the two records the
fail-closed comment is about and the only two that reach a socket.

---

## P3

- **Verified clean, no action** — `reachable`: MAC'd at `pairingWire.ts:97` /
  `pairingTransport.ts:191`,`:241`, never used to build a URL or a request
  (`rg -n "reachable" src --glob '!*.test.*'` returns only the MAC frames, the `""` default at
  `PairingScreen.tsx:102`, the deliberate-absence comment at `PairingManualForm.tsx:4-5`, and
  unrelated copy), and **not stored**: `savePairingCredential` writes only `localId`,
  `credential`, `doorUrl`, `node`, `pairedVia`, `roomId` (`pairingCredentialStore.ts:32`).
- **Verified clean** — pairing secrets. `code`, `nonce` and `deliveryToken` reach no log:
  `logPairingFail` (`pairingFailLog.ts:25-32`) carries stage+status only; the optional diagnostics
  carry `mac_hex`, `ciphertext_hex` and a 128-bit-truncated SHA-256 of a 256-bit credential, none
  of which is a secret without the code. The desk lane puts them on the wire at
  `pairingTransport.ts:252` and nowhere else. `KALSA_ROAD` logs `node8` — the first 8 hex of a
  node id that is already public in the QR (`road.ts:84`, `:110`); pre-existing, low value.
- `src/engine/remote/doorRequestBase.ts:9` imports `IROH_TUNNEL_URL` from `../../pairing/` —
  the engine layer now depends on the pairing layer for a transport constant. It belongs beside
  `chooseRoad` in `src/remote/`, which is the module that actually owns road selection.
- `remoteEngineDoorless.test.ts:272-274` asserts `expect(IROH_TUNNEL_URL).toBe("https://iroh.kalsa.invalid")`
  — a test that pins a literal to itself. It would pass unchanged if the constant were hijacked,
  which is the one edit that matters (see P2-4). Assert the *behaviour* (no socket, the right
  `Host:` in the tunnel write) instead; those assertions already exist at `:201-208`.
- Copy: `pairing.doorRequired` still says a computer address is required
  (`PairingManualForm.tsx:114-118`), and it is the only guidance a doorless install ever sees
  before the ceremony. The message that would actually help — the `remote_brain_iroh_missing` one
  at `src/i18n/en.ts:193-194`, "Update Kalsa on this phone, or pair again using the computer's
  address" — only appears after a pairing that can no longer work.

---

## Ranking

| # | rank | finding |
|---|---|---|
| 1 | **P1** | `pairedPropsProbe` names the stand-in with no road check and no URL gate → the fresh bearer can reach `globalThis.fetch` on a `{doorUrl:"", node:null, pairedVia:"iroh"}` record, retried for 180 s |
| 2 | **P1** | a stuck `irohModulePresent()` memo turns the fail-closed into a permanent silent stop of the room stream (`roomStream.refuse` → `stop()`) |
| 3 | **P1** | `doorRequestBase`'s road check ≠ `establishDoorRoad`'s; its "cannot disagree" comment is false; a `{url:"", pairedVia:"https"}` record would put `iroh.kalsa.invalid` on a real socket |
| 4 | **P2** | the iroh tunnel path has no enforcement point for "https ⇒ safe to sign" — a caller that forgets the gate sends the bearer in cleartext over the tunnel |
| 5 | **P2** | the pairing screen no longer validates `doorUrl` before persisting it on the iroh road |
| 6 | **P2** | `tailnet` stays outside the MAC while now steering the saved doorUrl and the desktop-visible `Host` |
| 7 | **P2** | `isNonLoopback` on the stand-in answers the wrong question and would drop `remote_brain_token_required` if the constant were respelled as loopback http |
| 8 | **P2** | no test covers either record shape the fail-closed comment is about |
| 9 | **P3** | layering inversion (`engine/remote` → `pairing/pairingUrls`), self-pinning literal test, stale `doorRequired` copy |
| — | clean | `reachable` never dialed and never stored, still MAC-covered; MAC field set unchanged; `code`/`nonce`/`deliveryToken` never logged |

**No P0.** The bearer does not leave on the network today, and I could not construct an invite that
changes that. The exposure is entirely in the *unasserted* invariants (P1-1, P1-3) and in the fact
that one of the four fail-closed guards (P1-2) is a permanent negative cache, which is a
correctness bug today and a security-relevant one the moment a doorless pairing is the only pairing
a user has.