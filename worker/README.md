# kalsa-site Worker

Serves the generated static site and the sign-in endpoints on one origin, so the session
cookie stays first-party. Only `/api/*` and `/auth/*` reach the Worker; every other path is
served from `../site/dist`.

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

The origin is `https://kalsa.io` and nothing else. Production is that one custom domain, with
`workers_dev` off, so the Worker answers on no other host.

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

Every Worker response carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`
and `Cache-Control: no-store`. The HTML error page adds a strict CSP (`default-src 'none'`,
`style-src 'self'`, `frame-ancestors 'none'`, no script source at all).

The static pages are hardened by `site/_headers`, which `kalsa-site` writes to the root of
`site/dist`: nosniff, `Referrer-Policy: strict-origin-when-cross-origin`, and a CSP of
`'self'` scripts/styles/connect plus `img-src 'self' https:` for provider avatars,
`frame-ancestors 'none'`, `object-src 'none'`. Workers static assets does **not** apply
`_headers` to Worker-generated responses, which is why the Worker sets its own.

The pages carry no inline style or script: spacing and layout live in utility classes in
`base.css`, benchmark bar widths are `.w0`–`.w100` classes, and the select arrow is
`static/chevron.svg` rather than a `data:` URI. Nothing needs `unsafe-inline`.

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
   `SITE_ORIGIN/auth/<provider>/callback`; GitHub allows only one callback URL per app.

   | Provider | Where | Callback URL | Scopes |
   |---|---|---|---|
   | GitHub | Settings → Developer settings → OAuth apps | `https://kalsa.io/auth/github/callback` | none |
   | Hugging Face | `https://huggingface.co/settings/applications/new` | `https://kalsa.io/auth/huggingface/callback` | `openid profile` |
   | GitLab | User settings → Applications | `https://kalsa.io/auth/gitlab/callback` | `read_user` |

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
