# Kalsa download Worker

Download page and two installer routes for the alpha testers, behind a secret
link on the `kalsa.io` zone. No KV, no Durable Objects, no vars. Bindings: the
private R2 bucket `kalsa-installers` (binding `DOWNLOADS`) and the secret
`LINK_KEY`. `[observability] enabled = false` in `wrangler.toml` turns off Workers
Logs for this script; it says nothing about the other systems listed below.

## The secret link

Only people with the link should see the page or download. The rules below apply
to requests that reach this Worker. The route `kalsa.io/download*` sends such
requests here once the Worker is deployed.

| Path | Method | Answer with the right key |
| --- | --- | --- |
| `/download/<key>`, `/download/<key>/` | GET, HEAD | the page (200), or 304 if the ETag matches |
| `/download/<key>/windows` | GET, HEAD | the installer, or 302 to its `?v=` URL, or 404 |
| `/download/<key>/mac` | GET, HEAD | same, for the Apple silicon installer |
| any other method on those | POST, PUT, … | 405, `Allow: GET, HEAD` |

Every other request that reaches this Worker gets one 404, with the same status,
body and headers. That covers: no key, a wrong key, a prefix of the key, extra
characters or segments, an unknown platform, a percent-encoded or re-cased path,
a doubled slash, a query on a wrong key, a plaintext `http:` request, a host other
than `kalsa.io` (a trailing dot is the same host), and a missing or short
`LINK_KEY`. A wrong key with POST gets that 404 too, not a 405.

Every such request runs the same work: one key comparison, which hashes both sides
with SHA-256 and compares the 32-byte digests with an XOR loop that never exits
early (`link.ts`, `admit` and `keyMatches`). A failure while hashing gets the same
404. Only a request whose key has matched can get the 503 page (bucket or manifest
failure). The key is never compared as a plain string.

Responses from this Worker carry `X-Robots-Tag: noindex, nofollow` and
`Referrer-Policy: no-referrer`, including the 404 and the 503.

### Where the link can leak

The key is part of the URL, so the URL is the secret. This Worker only sees
requests that reach it. Other places can record the full URL, and the Worker has
no control over them:

- Cloudflare zone-level analytics, any sampled-URI report, and any Logpush job
  you may configure later, which record request lines outside the Worker.
- The tester's browser: history, browser sync, and extensions.
- Chat, email and other apps that fetch a link to build a preview. Their servers
  may request the URL, and their logs and preview caches keep it.
- Shell history, the process list, and terminal recorders when a key is typed
  into a command.

So: send the link as plain text, to one tester at a time, and do not paste it
into a channel whose link previews you have not checked.

### Generate and set the key (owner)

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

That prints 43 URL-safe characters. Keep the output in a password manager, not in
a file in the repo. Set it as a Worker secret, from `workers/download`:

```bash
npx wrangler secret put LINK_KEY
```

`wrangler secret put` publishes a new version of this Worker with the secret. It
is a publish, so it needs the owner's OK like `wrangler deploy` does. Whether it
publishes the local code as well, or only the secret on the current version, is
not verified here: check the result with curl (below) before sending any link.
The key never goes in the repo, in `wrangler.toml`, in the guide, or in a test.
The tests use a fake key from `fakes.ts`.

### Rotate the key (owner)

Run `npx wrangler secret put LINK_KEY` again with the new value. That publishes a
new version, as above. The old link stops working when that version is live. Check
both links with curl before you send the new one to testers:

```bash
read -rs LINK_KEY && export LINK_KEY    # typed, not echoed, not in shell history
curl -sI "https://kalsa.io/download/$LINK_KEY" | head -1      # 200 with the new key
curl -sI "https://kalsa.io/download" | head -1                # 404
unset LINK_KEY
```

Use the old key in place of the new one to confirm the old link now gets the 404.
While `curl` runs, the expanded URL is visible in the process list for a moment.
How long the old version stays live after a publish is not verified here.

## Routes (declared in `wrangler.toml`, zone `kalsa.io`)

`kalsa.io/download*` is this Worker's route. Other paths on `kalsa.io` belong to
`kalsa-pair` and `kalsa-report` (see One-time setup).

## The manifest: `current.json`

The page and the installer routes read `current.json` from the bucket on every
request. A release is an upload plus a rewritten manifest; the Worker is not
redeployed.

```json
{
  "windows": {
    "key": "releases/0.0.1/Kalsa-alpha-0.0.1-windows.exe",
    "name": "Kalsa-alpha-0.0.1-windows.exe",
    "size": 123456789,
    "sha256": "<64 lowercase hex chars>"
  },
  "mac": { "key": "…", "name": "…", "size": 98765432, "sha256": "…" }
}
```

Each platform is validated on its own (`manifest.ts`). A missing or invalid
entry shows "coming soon" on the page and 404s its route; the other platform is
unaffected. A key must start with `releases/<version>/` and use only
`A-Za-z0-9._-` in its segments; a name uses `A-Za-z0-9._ -` and cannot start with
a dot, so the Content-Disposition header cannot be broken.

## Integrity

The bytes served must match the manifest before they leave the Worker:

- the object's size must equal the manifest's `size`;
- if R2 reports a `sha256` checksum for the object, it must equal the manifest's
  `sha256`.

A mismatch answers 503 and no bytes. R2 reports a checksum only when one was
stored with the object; whether `wrangler r2 object put` stores one is not verified
here. So the release script's read-back re-hash is the gate that matters.

## Versioned URLs and caching

The page links `/download/<key>/windows?v=<sha256>`. A URL with the current hash
streams the installer; a URL with an old hash, or none, 302s to the current one
(`no-store`). Files and the page carry `Cache-Control: private, no-cache` and an
ETag (the installer's sha256, or a hash of the page), so a browser revalidates and
gets 304 when nothing changed. Nothing is cached as immutable. `private` keeps
shared caches from storing the response; the browser may keep it but must
revalidate.

## Failures

A bucket or manifest error after the key matched answers the 503 page. An installer
whose bytes do not match the manifest answers the same 503. A failure before the key
matched answers the 404 described above. The Worker code contains no logging call.

## Page and tester guide

One static document, no script, no cookies, no third-party requests. Headers:
`Content-Security-Policy: default-src 'none'; style-src 'sha256-…'; img-src 'none';
base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
`Cache-Control: private, no-cache`, plus `Referrer-Policy: no-referrer` and
`X-Robots-Tag: noindex, nofollow` as on every response. The one inline `<style>`
is pinned by hash; `page.test.ts` recomputes it.

The tester guide is generated: `guide.ts` is written by `scripts/build-guide.mjs`
from `kalsa-brain/docs/ALPHA-TESTERS.md`. Edit the markdown, then run
`node scripts/build-guide.mjs <path to the markdown>` and commit `guide.ts`. The
release script refuses to publish while `guide.ts` is stale. The guide contains no
URL: section 7 is dropped from the page, and the markdown asks testers to use the
private link they were sent.

## One-time setup (owner)

```bash
npx wrangler login
cd workers/download
npx wrangler r2 bucket create kalsa-installers
npx wrangler secret put LINK_KEY    # publishes a version; see "Generate and set the key"
npx wrangler deploy                  # only with the owner's explicit OK
```

> **`kalsa-installers` must never get an `r2.dev` URL or a custom domain.** The bucket `kalsa-downloads` is a different one: public, served at `dl.kalsa.io`, and it holds the desktop app's engine downloads. Never use it here.

Before deploying:

- Check that nothing else routes `kalsa.io/download*` and that the bucket has no
  public access: no `r2.dev` domain, no custom domain. Installers leave the bucket
  only through this Worker.
- Routing, read from the Cloudflare API on 2026-10-10: `kalsa.io` is already a
  Workers Custom Domain of `kalsa-pair`, and the zone has the routes `kalsa.io/pair*`
  and `kalsa.io/.well-known/assetlinks.json` (both `kalsa-pair`) and
  `kalsa.io/report*` (`kalsa-report`). A route runs in front of the Custom Domain,
  so `kalsa.io/download*` needs no DNS record. The root of `kalsa.io` answers
  `kalsa-pair`'s plain "Not Found". Plain `http://kalsa.io` is not redirected to
  https at the edge and reaches the Worker, which is why it rejects non-https
  requests.
- Until this version is deployed, the old unkeyed page and its installer routes are
  still served. Check right after deploy that `https://kalsa.io/download` gets the
  404, before telling testers anything.

Until the first `current.json` exists, the page shows "coming soon" for both
platforms and the installer routes return 404.

## Per release (owner)

Build the installer, then run the release script for each platform. The first
release also needs `--new-manifest`, because there is no `current.json` to read yet.

```bash
node scripts/release.mjs windows ./Kalsa-alpha-0.0.1-windows.exe 0.0.1
node scripts/release.mjs mac ./Kalsa-alpha-0.0.1-mac.dmg 0.0.1
```

`--dry-run` runs the local checks (guide freshness, size, sha256, key rule) and
prints the wrangler commands without running them. Without it the script:

1. uploads the file to `releases/<version>/<name>`;
2. downloads that object again and re-hashes it; a mismatch stops here, with
   `current.json` unchanged;
3. reads `current.json`; if it cannot be read, the script stops unless
   `--new-manifest` is given;
4. replaces only that platform's entry, keeping the other one;
5. uploads the new `current.json`.

Set `ALPHA_TESTERS_MD` if the markdown is not at the sibling path
`../kalsa-brain/docs/ALPHA-TESTERS.md`. Afterwards, check with the keyed link, as in
the rotation section. A release needs no `wrangler deploy`; only a page or route
change does.

## Tests

Not in CI yet: run them by hand before a release.

```bash
cd ~/Projects/kalsa
npx jest -c workers/download/jest.config.js   # Worker, link, page, guide, converter, release script
npx tsc --noEmit -p workers/download          # Worker modules
```

`converter.test.ts` runs `scripts/markdown-subset.test.mjs` with `node --test`.
`release.test.ts` runs the release script with an empty PATH, so any real wrangler
call would fail the test. `secret-link.test.ts` compares every non-link request
with one reference 404; `admission.test.ts` checks that each request does the same
two digests and that a failing hash still gives the 404.

## Not verified here

- No `wrangler` command has been run and no Cloudflare call made: the bucket, the
  route, the `LINK_KEY` secret, `wrangler deploy` and the
  `r2 object put` and `get` flags are all untested live.
- Whether `wrangler secret put` publishes the local code or only the secret.
- How long the old version of the Worker stays live after a rotation.
- Whether `wrangler r2 object put` stores an R2 sha256 checksum.
- Range requests are not supported; an interrupted download restarts.
