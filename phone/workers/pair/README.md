# Kalsa pair Worker

Static Cloudflare Worker for pairing invite links on the `kalsa.io` zone.
No KV, no D1, no Durable Objects, no bindings of any kind. Observability and
logging are off (`[observability] enabled = false`); the Worker does not log.

## Routes (declared in `wrangler.toml`, zone `kalsa.io`)

- `kalsa.io/pair*` — static invite page (`text/html`).
- `kalsa.io/.well-known/assetlinks.json` — Android Digital Asset Links
  (`application/json`).

The apex and everything else stay unrouted; any other path that still reaches
the Worker (`/pairfoo`, `/`, a foreign host) gets `404`.

## Invite page

One static HTML document, identical for every visitor. Client-side JS reads
`location.hash`, validates it against base64url (`[A-Za-z0-9_-]+`), and only
then builds the `kalsa://pair#<fragment>` deep link for the "Open in Kalsa"
button via the `URL` constructor + `setAttribute` — never `innerHTML`, never
string HTML. With no fragment, or a fragment that fails the charset check,
the page shows "This invite link is incomplete." and renders no link.

There is no store in the alpha, so the page points to the human channel:
"Ask the person who invited you for the Kalsa app."

**The fragment never leaves the browser.** The page makes no fetch/XHR/beacon,
has no form, no analytics, no third-party assets, no external fonts, and the
CSP (`default-src 'none'`) blocks anything the markup might grow later.
`pair.test.ts` asserts all of this and exercises the script against valid,
invalid, and missing fragments.

## Strict headers (page)

- `Content-Security-Policy: default-src 'none'; script-src 'sha256-<script>';
  style-src 'sha256-<style>'; img-src 'none'; base-uri 'none';
  form-action 'none'; frame-ancestors 'none'` — the inline `<script>` **and**
  `<style>` are both hashed; **no `'unsafe-inline'` anywhere**.
- `Referrer-Policy: no-referrer`
- `X-Content-Type-Options: nosniff`
- `Cache-Control: no-store`

The two `'sha256-…'` values are pinned constants in `page.ts`;
`pair.test.ts` recomputes both from the exact inline sources, so they cannot
drift.

## assetlinks.json

Standard statement list for `com.kalsa.app`, relation
`delegate_permission/common.handle_all_urls`, with the SHA-256 fingerprint of
the certificate that signs our CI APKs:

```
FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C
```

Provenance: read from the real APK
(`~/kalsa-apks/2641144c-debuggable/kalsa-apk-arm64-v8a-debuggable-2641144cff9ca70d4ddcab981e650b144aac2773/app-release.apk`)
by parsing the APK Signing Block (located via the end-of-central-directory
record; pair id `0x7109871a`, APK Signature Scheme v2 — the APK has no JAR
signature entries) and hashing the signer certificate DER with python3
`hashlib`, cross-checked with `openssl x509 -fingerprint -sha256`
(subject `CN=Android Debug`, the Expo/React Native prebuild template key).

**BETA DEBT: swap assetlinks.json to the release signing key before any public
invite link — the debug keystore is public and authenticates nothing.**

Any APK named `com.kalsa.app` signed with that public key verifies for
`kalsa.io/pair` and can receive an invite fragment. This is acceptable for the
alpha only: the desk's Allow still gates everything, and a fake `com.kalsa.app`
cannot coexist with the real one on the same device. `Cache-Control: no-store`
on the JSON keeps a future release-key swap effective immediately.

## Deploy

`wrangler deploy` needs the owner's explicit OK — do not deploy without it.
No secrets, no vars, no bindings; `workers_dev = false` and the routes are
declared here so every deploy keeps them.

## Tests

From the repo root (real exit code; `tail` on noisy output):

```bash
npx jest -c workers/pair/jest.config.js > /tmp/kalsa-pair-test.log 2>&1; echo $?
```

Type check:

```bash
npx tsc -p workers/pair/tsconfig.json > /tmp/kalsa-pair-tsc.log 2>&1; echo $?
```
