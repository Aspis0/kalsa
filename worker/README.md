# kalsa-site Worker

Serves the generated static site and the sign-in endpoints on one origin, so the session
cookie stays first-party. `/api/*` and `/auth/*` are the Worker's own routes. Every answer that
could name a removed engine or developer also reaches the Worker — the HTML lists, `engines.json`,
`pages.json`, the badges and `sitemap.xml` — so a removal takes effect without a redeploy. Scripts,
styles and the prose pages are served straight from `../site/dist` and keep their own caching.

## Test toolchain

`@cloudflare/vitest-plugin` 1.8.5 with vitest 4.1.12. It is the official successor to
`@cloudflare/vitest-pool-workers`, which is deprecated and no longer updated. The successor
bundles miniflare 5.20261118.0-beta → **workerd 1.20261118.1**, which supports this Worker's
`compatibility_date` of 2026-11-18, so the tests run on a current runtime with no date fallback.

For the record, the deprecated pool could not run this Worker at all: its 0.23.0 release bundled
workerd 1.20260815.1, whose newest supported date is 2026-08-22, and it refused to start. Overriding
`MINIFLARE_WORKERD_PATH` to Wrangler's newer binary cleared the date refusal but broke the pool's
module-fallback protocol (`Module not found: cloudflare:test-internal`). Do not reintroduce that
override; the plugin and its miniflare must stay in step.

CI runs this suite in `.github/workflows/ci.yml` (job `worker`, Node 22): generate the site, then
`npm ci`, `npm run typecheck`, `npm test`. The site generation step is required because the assets
binding points at `../site/dist`, which is generated and git-ignored.

## Dependency audit

`npm audit --omit=dev` reports 0. The 6 remaining "high" findings are dev-only, inside
Cloudflare's own wrangler/miniflare tree (sharp, undici, zod). They are accepted: they are not in
the deployed bundle, and clearing them would mean changing the pinned Cloudflare versions.

## Routes

| Route | What it does |
|---|---|
| `GET\|HEAD /auth/{github\|huggingface\|gitlab}/start` | Redirects to the provider with state and an S256 PKCE challenge. Optional `?next=` must be an allowlisted relative path. |
| `GET\|HEAD /auth/{provider}/callback` | Verifies the signed state cookie, spends the state row, exchanges the code, reads the identity once, opens a session, returns to `next`. |
| `POST /auth/signout` | Deletes the session row and expires the cookie. JSON only, `Origin` must equal `SITE_ORIGIN`. |
| `GET\|HEAD /api/me` | `{username, avatar, provider}`, or 401. |
| `GET\|HEAD /api/page?kind=&id=` | `{kind, id, name, removed}`. A live entry is public; a removed one is answered only to the account that removed it. |
| `POST /api/remove` | The owner removes an engine or developer page. JSON only, same `Origin` check, GitHub session required. |
| `POST /api/undo` | The account that removed the page puts it back. The same guard and allow-list; no GitHub call. |

Any other `/api/*` or `/auth/*` path is the Worker's own JSON 404. A wrong method is 405 with
an `Allow` header. HEAD is answered wherever GET is.

Scopes: GitHub none, Hugging Face `openid profile`, GitLab `read_user`. The provider access
token is spent on one identity read and then dropped — never stored, logged or returned.
Provider fetches use `redirect: "manual"`: a 3xx from a token or identity endpoint is a
failure, not something to follow. D1 holds the public identity and SHA-256 hashes, never a
cookie value or a state value.

## The origin is configuration, not the Host header

`SITE_ORIGIN` (a `vars` entry) is the only origin used for `redirect_uri`, the `Origin`
comparison and the final redirect. Every `/api/*` and `/auth/*` request whose own origin
differs from it is refused with 400 `unknown_origin` before any routing, so a request sent to
`https://attacker.example/auth/github/start` can never produce a `redirect_uri` on that host.

The origin is `https://preview.kalsa.io` and nothing else. That is the one custom domain this Worker
answers on, with `workers_dev` off. It must equal `paths::ORIGIN` in the generator, which builds every
canonical URL, sitemap entry and badge link.

## Sign-in state is single-use

`start` writes a row to `signin_states` (SHA-256 of the state, provider, expiry) alongside the
signed 10-minute cookie. `callback` spends it with one `DELETE … RETURNING`, so a replayed
cookie and state find no row and are refused. Expired state rows are swept when a new sign-in
starts; expired sessions are swept when a new session opens.

A refused callback only expires the state cookie when the cookie is unusable (forged,
malformed, expired) or the attempt was verified and is now spent. A cookie that belongs to a
different provider, or a state parameter that does not match, leaves the live cookie alone —
a refusal must not cancel someone's in-flight sign-in.

## What is validated

- `SESSION_HMAC_KEY`: at least 32 bytes after base64 decode, and not the shipped placeholder.
  Absent, empty, short, non-base64 or placeholder → 503 "Sign-in is not configured", before any
  crypto runs. Generate it with `openssl rand -base64 32`.
- Provider username: 1–64 characters, no control characters, else the sign-in fails.
- Provider avatar: https only, at most 512 characters, else stored as null.

## Headers

Every Worker response carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
`Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`,
`Strict-Transport-Security: max-age=31536000; includeSubDomains`, a `Permissions-Policy` that denies
camera, microphone, geolocation, display-capture, payment, usb, serial, bluetooth and the motion
sensors, `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Resource-Policy: same-origin`.
The HTML pages the Worker writes add a strict CSP (`default-src 'none'`, `style-src 'self'`,
`frame-ancestors 'none'`, no script source at all).

The static pages are hardened by `site/_headers`, which `kalsa-site` writes to the root of
`site/dist`: nosniff, `Referrer-Policy: strict-origin-when-cross-origin`, and a CSP of
`'self'` scripts/styles/connect plus `img-src 'self' https:` for provider avatars,
`frame-ancestors 'none'`, `object-src 'none'`. Workers static assets does **not** apply
`_headers` to Worker-generated responses, which is why the Worker sets its own.

`/badge/*` alone overrides `Cross-Origin-Resource-Policy` to `cross-origin`: a README badge is meant
to be embedded on any host, and GitHub only survives `same-origin` because camo proxies the fetch.
Every other answer stays `same-origin`.

## One origin

`paths::ORIGIN` in the generator is the single constant behind every canonical URL, `og:url`, sitemap
`<loc>`, badge markdown link and `llms.txt` link. It is `https://preview.kalsa.io` and must equal
`SITE_ORIGIN` in `wrangler.jsonc`. `vitest.config.ts` reads `SITE_ORIGIN` out of `wrangler.jsonc`
rather than hardcoding a second value, the tests take the origin from that binding, and
`test/isolation.test.ts` pins the expected value so a config change cannot pass silently. Sitemap
stripping matches on the path, not the origin, so it works even if the two ever disagree.

The pages carry no inline style or script: spacing and layout live in utility classes in
`base.css`, benchmark bar widths are `.w0`–`.w100` classes, and the select arrow is
`static/chevron.svg` rather than a `data:` URI. Nothing needs `unsafe-inline`.

## Removals

Every engine and developer page ends with a plain "Remove this page" link to
`/remove/?kind=<engine|developer>&id=<id>`. That page is generated; `static/remove.js` reads the query
and asks `/api/page`, which answers on a **fresh load** too: a removed entry is told to the account
that removed it, so Undo works after a reload without republishing the entry to anyone else. One
button POSTs `/api/remove`; once removed, one button POSTs `/api/undo`.

Ownership is resolved at that moment from the GitHub API, by numeric id, never by the login string
in the catalog:

- an engine: `GET /repos/{owner}/{repo}` → `owner.id`. A **personal** account's id must equal the
  signed-in id.
- a developer page: `GET /users/{login}` → `id`, compared the same way. GitHub documents 200/404 for
  that endpoint, so a renamed account's old login simply 404s.
- an **organisation**'s repository or developer page: no self-removal at all. The route answers 403
  `organisation` and the page shows the mailbox fallback. Membership is not ownership, so no
  membership endpoint is called.
- a renamed **repo** answers 301 to its numeric id. That redirect is followed **once**, and only to
  `api.github.com`; an off-host `Location` is never fetched.
- a GitHub **404** is 403 `github_missing` ("No repository or account matches on GitHub."), not an
  outage: a deleted repo or a stale catalog login is a permanent state, and the owner is told so.
  A refusal (403/429), a 5xx or a network failure is 502 `github_unavailable`. Neither is ever
  reported as `not_owner`.

These calls are unauthenticated and use no scope beyond what sign-in already asks for; no provider
token is stored, so there is none to spend here. The session's username plays no part in the
decision, only its numeric id.

Only `kind` and `id` are read from the request body, and only an id the generated `pages.json` lists
is accepted; the canonical spelling from that file is what gets stored. `removals` holds the page
kind and id, the GitHub user id and the time — nothing else about the person. Undo is allowed only
to that recorded account, needs no GitHub call, and deletes the row. Undo of a live page is 404
`not_removed`.

The effect is immediate, with no redeploy. With no removals stored, `serve` passes the asset answer
through untouched. With one, it answers 410 for the removed page (and its badge), strips every
element carrying that `data-engine` or `data-dev` id from the HTML with `HTMLRewriter`, drops the
rows from `engines.json` and `pages.json`, drops the URLs from `sitemap.xml`, and recomputes each
`data-count` phrase from the allow-list using the generator's own `data-one`/`data-many` wording.
A developer page's stats block goes when one of its engines is removed: the benchmark count and gain
range come from the catalog's own rules, which the Worker does not duplicate.

Paths are normalised before matching — percent-decoded (bounded), repeated slashes collapsed, case
folded — because the asset layer resolves `/engines/%66rink/` to the same file as `/engines/frink/`.
A removed page answers 410 on every form that would serve it.

A reference to a removed engine inside **another** engine's own data is kept as a fact and loses the
name where the reference is structured: the generator marks the upstream link, the "Fork of …"
relation and the Details upstream row with `data-ref-repo` and the words to substitute
(`data-ref-text`), and the Worker replaces the text and drops the link and the markers. What is
**not** rewritten: the baseline name inside a benchmark sentence ("than llama.cpp") and any engine
name in an authored summary. Those are facts about another engine's own measurement or description,
and rewriting them would falsify the catalog author's data. The submit page's example entry is
invented, so it never republishes a catalog entry.

### Caching while removals exist

One D1 read per request. The removals set is hashed into a version, and the rewritten answer is
stored in `caches.default` under a key carrying that version, built from the **raw** pathname, with a
60-second edge TTL. Any removal or undo changes the version, so a cached rewrite can never outlive
the decision. The visitor always gets `Cache-Control: public, max-age=0, must-revalidate` with a
version-keyed `ETag`, and a matching `If-None-Match` is answered 304 — from the cached copy too — so a
removal shows at once and a repeat view costs no body. The 410 itself is `no-store`.

**HEAD runs the same pipeline as GET** (a cache hit, or a GET to the assets) and then returns the
headers with a null body. A HEAD asset body is null: parsing it would 500 on the JSON paths, and
caching it would blank the page for every later GET in that colo. Nothing from a HEAD is ever stored.

**The page cache is best-effort.** A failed `match` is treated as a miss and a failed `put` is
swallowed, so neither can 5xx a page — the cost is one extra rewrite. The allow-list read is guarded
the same way: if the asset cannot be fetched, the cards whose ids are known from D1 are still
stripped, and only the counts and reference labels (which need the allow-list) stay as they are.

**A D1 outage does not take the catalog down and does not serve a removed page.** Every successful
read publishes the set to the isolate and to a long-lived edge snapshot. When D1 fails, the last
known set is used. With no last known set at all, the affected paths answer 503 with `Retry-After`
rather than guess; paths outside `run_worker_first` are unaffected.

## Rate limits

`abuse_limits` is a fixed window per key, counted in one `INSERT … ON CONFLICT … RETURNING` that also
sweeps rows whose window has expired, in the same batch. `LIMIT_WINDOW_SECONDS` is 3600 and the
privacy notice states that hour; a Rust test ties the two together. The key carries a keyed hash of
`CF-Connecting-IP`, never the address, under a key **derived** from `SESSION_HMAC_KEY` with the domain
label `abuse-counter-v1`, so the counter and the OAuth state cookie do not share one key.

Limits: `/api/remove` and `/api/undo` 30 an hour per GitHub account and 60 per address;
`/auth/*/callback` 60 an hour per address. `/auth/*/start` is a **navigation-only** endpoint: a
request whose Fetch metadata says it is a subresource (`Sec-Fetch-Dest`/`Mode` other than
document/navigate) is refused 403 before it writes a state row or touches a counter, so a cross-site
`<img>` flood cannot lock a real visitor out. Navigations, and clients that send no Fetch metadata at
all, are counted at 60 an hour per address. `/api/page` has **no** limiter: it is read-only, the
allow-list is cached in the isolate and the removal check is one indexed point read, so there is no
bucket for a third party to burn. Over the limit is 429.

## Logging

`observability.logs.invocation_logs` is `false` in both environments. Invocation logs are the
record that carries `<Method> <URL>`, which for a callback would include the OAuth `code` and
`state` in the query string. Custom logs and traces stay enabled; the Worker itself logs
nothing. There is no per-path sampling control, so this is the precise switch rather than a
sampling rate that would still store some codes.

## Local development

```sh
cargo run -p kalsa-site            # writes ../site/dist, which the assets binding serves
cp .dev.vars.example .dev.vars     # then fill in real values; .dev.vars is git-ignored
npx wrangler d1 migrations apply kalsa --local
npx wrangler dev
```

`.dev.vars` does not shadow the test bindings: `vitest.config.ts` sets `SITE_ORIGIN`, a valid
32-byte `SESSION_HMAC_KEY` and the provider ids explicitly, and `test/isolation.test.ts`
asserts those exact values are the ones in force.

## Checks

```sh
npx vitest run      # provider endpoints mocked with @msw/cloudflare
npx tsc --noEmit    # strict
npm run types       # regenerate worker-configuration.d.ts after editing wrangler.jsonc or .dev.vars
```

`worker-configuration.d.ts` is generated, not hand-written: it carries the bindings, the
`SITE_ORIGIN` literal union and the secret names. `Env` in the source comes from it.

The tests run on vitest 4.1.12 with `@cloudflare/vitest-plugin` (`cloudflareTest` in `plugins`)
and mock the provider endpoints with `@msw/cloudflare`: `setupNetwork()`, plus `http`/`HttpResponse`
from `msw`. `onUnhandledFrame: "error"` replaces the old `disableNetConnect`, so an unmocked
provider call fails instead of reaching the network. Interception works through `SELF.fetch`, and
`useWorker()` asserts that every registered mock was reached; the two suites that deliberately
register an unreachable mock opt out with `requireAllMocks: false`. Ambient types come from
`@cloudflare/vitest-plugin/types`, and `test/env.d.ts` adds `MIGRATIONS` to `Cloudflare.Env` inside
`declare global`. `test/isolation.test.ts` asserts the test bindings win over a local `.dev.vars`,
which the plugin does load.

## What the owner must create

1. **The D1 database** `kalsa`:

   ```sh
   npx wrangler d1 create kalsa
   ```

   Put the printed id into `database_id` in `wrangler.jsonc`, then apply the migrations:

   ```sh
   npx wrangler d1 migrations apply kalsa --remote
   ```

2. **OAuth apps**, one per provider. The Worker sends
   `SITE_ORIGIN/auth/<provider>/callback`, which is now on **`preview.kalsa.io`**. GitHub allows only
   one callback URL per app, so **all three apps must be updated before this is deployed** — until
   they are, every sign-in fails with `redirect_uri_mismatch`.

   | Provider | Where | Callback URL | Scopes |
   |---|---|---|---|
   | GitHub | Settings → Developer settings → OAuth apps | `https://preview.kalsa.io/auth/github/callback` | none |
   | Hugging Face | `https://huggingface.co/settings/applications/new` | `https://preview.kalsa.io/auth/huggingface/callback` | `openid profile` |
   | GitLab | User settings → Applications | `https://preview.kalsa.io/auth/gitlab/callback` | `read_user` |

   The site moved from `kalsa.io` to `preview.kalsa.io`. Every existing embed, badge link and bookmark
   points at the old host, so decide which host is public before deploying, and give staging its own
   D1 database: `database_id` is currently the same one a `kalsa.io` Worker would read, so a removal
   made on preview would take the page down there too.

3. **Secrets**, via env only — never in `wrangler.jsonc` or source:

   ```sh
   openssl rand -base64 32 | npx wrangler secret put SESSION_HMAC_KEY
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   npx wrangler secret put HF_CLIENT_ID
   npx wrangler secret put HF_CLIENT_SECRET
   npx wrangler secret put GITLAB_CLIENT_ID
   npx wrangler secret put GITLAB_CLIENT_SECRET
   ```

   Rotating `SESSION_HMAC_KEY` invalidates sign-in attempts in flight and makes existing state
   cookies unreadable; sessions keep working, because they are checked against D1.

4. **Deploy**, after the site is generated:

   ```sh
   cargo run -p kalsa-site
   npx wrangler deploy
   ```

Until the OAuth apps exist, `/auth/<provider>/start` answers 503 and the tests run against
mocked provider endpoints.

## Sign-in page and nav item

The generator owns these. `site/templates/signin.html` is rendered to `/signin/` by
`kalsa-site`, and `site/static/account.js` loads on every page: it reads `/api/me` and swaps
the nav's "Sign in" item for the avatar, the username and a Sign out button. The script sets an
avatar `src` only when the URL is https, through `setAttribute`, and builds no markup from the
answer — username and initial go in as text.
