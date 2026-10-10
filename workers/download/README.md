# Kalsa download Worker

Download page and two installer routes for the alpha testers, served on the
`kalsa.io` zone. No KV, no Durable Objects, no secrets, no vars. The only binding
is the private R2 bucket `kalsa-downloads` (binding `DOWNLOADS`). Logs are off
(`[observability] enabled = false`).

## Routes (declared in `wrangler.toml`, zone `kalsa.io`)

| Path | Method | Answer |
| --- | --- | --- |
| `/download`, `/download/` | GET, HEAD | the page (200), or 304 if the ETag matches |
| `/download/windows` | GET, HEAD | the installer, or 302 to the current `?v=` URL, or 404 |
| `/download/mac` | GET, HEAD | same, for the Apple silicon installer |
| any other path | any | 404 |
| known path, other method | POST, PUT, … | 405, `Allow: GET, HEAD` |
| bucket or manifest failure | any | 503 page, `Retry-After: 300` |

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

The page links `/download/windows?v=<sha256>`. That `?v=` is a version pin, not a
cache key guarantee: a URL with the current hash streams the installer and a URL
with an old hash 302s to the current one (`no-store`). Every file response and the
page carry `Cache-Control: no-cache` and an ETag (the installer's sha256, or the
page's own hash), so a browser revalidates and gets 304 when nothing changed.
Nothing is cached as immutable.

## Failures

Any exception from the bucket or the manifest answers the 503 page. An installer
whose bytes do not match the manifest answers the same 503. Nothing is logged:
observability is off on purpose.

## Page and tester guide

One static document, no script, no cookies, no third-party requests. Headers:
`Content-Security-Policy: default-src 'none'; style-src 'sha256-…'; img-src 'none';
base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
`Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`,
`Cache-Control: no-cache`. The one inline `<style>` is pinned by hash;
`page.test.ts` recomputes it.

The tester guide is generated: `guide.ts` is written by
`scripts/build-guide.mjs` from `kalsa-brain/docs/ALPHA-TESTERS.md`. Edit the
markdown, then run `node scripts/build-guide.mjs <path to the markdown>` and commit
`guide.ts`. The release script refuses to publish while `guide.ts` is stale.

## One-time setup (owner)

```bash
npx wrangler login
cd workers/download
npx wrangler r2 bucket create kalsa-downloads
npx wrangler deploy            # only with the owner's explicit OK
```

Before deploying, check that nothing else routes `kalsa.io/download*` and that the
bucket has no public access: no `r2.dev` domain, no custom domain. Installers leave
the bucket only through this Worker.

Until the first `current.json` exists, the page shows "coming soon" for both
platforms and both installer routes return 404.

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
`../kalsa-brain/docs/ALPHA-TESTERS.md`. Afterwards, check:

```bash
curl -sI https://kalsa.io/download | head -1
curl -s https://kalsa.io/download | grep -c 'sha256'
```

A release needs no `wrangler deploy`. Only a page or route change does.

## Tests

Not in CI yet: run them by hand before a release.

```bash
cd ~/Projects/kalsa
npx jest -c workers/download/jest.config.js   # Worker, page, guide, converter, release script
npx tsc --noEmit -p workers/download          # Worker modules
```

`converter.test.ts` runs `scripts/markdown-subset.test.mjs` with `node --test`.
`release.test.ts` runs the release script with an empty PATH, so any real wrangler
call would fail the test.

## Not verified here

- No `wrangler` command has been run: no Cloudflare access in this session. The
  bucket, the route, the R2 binding and the `r2 object put` and `get` flags are
  untested live.
- Whether `wrangler r2 object put` stores an R2 sha256 checksum is not verified.
- Range requests are not supported; an interrupted download restarts.
