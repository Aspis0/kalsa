# Kalsa report Worker

Cloudflare Worker that receives the desktop app's log file from alpha testers
and stores it privately in R2. The log never contains chat content, prompts,
answers, file contents, pairing codes or invite links — the app enforces that.
This Worker only receives and stores the upload; it has no read path.

## Routes (declared in `wrangler.toml`, zone `kalsa.io`)

- `kalsa.io/report` — `POST` only, exact path.

The Worker itself enforces exactness regardless of how much of a path the
route pattern captures: `/report/…`, `/reports`, `/`, a foreign host, or any
other path still reaching the Worker gets `404`
(`{"error":{"code":"not_found",…}}`); a non-`POST` on `/report` gets `405`.
There is no `GET` for a stored report and no listing — the bucket is read only
by the owner in the Cloudflare dashboard.

## Request contract

- **Body**: `text/plain; charset=utf-8`, the log text as sent. Missing or any
  other content type → `415`.
- **`Content-Length`**: required — missing (or not a plain integer) → `411`.
  Over the 4 MiB cap (two 2 MiB log files) → `413`. The cap is also enforced
  while reading the stream, so a `Content-Length` that lies cannot get more
  than 4 MiB stored → `413`.
- **Empty body** → `400`.
- **`X-Kalsa-App: <version>/<os>/<arch>`**: required, matched strictly
  against `^[0-9A-Za-z._-]{1,32}/[a-z0-9_]{1,16}/[a-z0-9_]{1,16}$`;
  missing or malformed → `400`.
- **Rate limit**: 5 accepted `POST`s per client IP per 60 s via the Workers
  Rate Limiting binding `REPORT_RATE_LIMITER` → `429`. The IP
  (`CF-Connecting-IP`) is used only as the limiter key.

## What is stored

One R2 object per accepted upload:

- **Key**: `YYYY-MM-DD/<id>.log`, where `id` is 8 chars drawn with
  `crypto.getRandomValues` from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` — no
  0/O/1/I/L, so a tester can read an id out over the phone — with rejection
  sampling so every character is equiprobable.
- **Value**: the log bytes exactly as sent.
- **`httpMetadata.contentType`**: `text/plain`.
- **`customMetadata`**: `{ app = <X-Kalsa-App value>,
  received = <ISO-8601 receipt time> }`.

## What is never stored

- The connecting IP — it exists only as the rate-limiter key, inside the
  limiter binding, and never reaches the `put`.
- Any header other than `X-Kalsa-App` (no User-Agent, no URL, no referer).
- Chat content, prompts, answers, file contents, pairing codes or invite
  links: the app never puts them in the log this Worker receives.

## Responses

- `201` → `{"id":"<id>"}`.
- Errors → `{"error":{"code":"<snake_case>","message":"<English>"}}`
  (`not_found`, `method_not_allowed`, `length_required`, `payload_too_large`,
  `unsupported_media_type`, `empty_body`, `bad_app_header`, `rate_limited`,
  `internal_error`).
- Every response carries `Cache-Control: no-store` and
  `X-Content-Type-Options: nosniff`.
- **No CORS headers.** The desktop app uploads from Rust, not a browser, so a
  browser page cannot issue a credentials-free cross-origin fetch and read
  the response here.

## One-time setup (owner)

```bash
cd workers/report
npx wrangler r2 bucket create kalsa-reports
npx wrangler deploy
```

`wrangler deploy` needs the owner's explicit OK — do not deploy without it.
No secrets, no vars; `workers_dev = false` and the route are declared in
`wrangler.toml` so every deploy keeps them. `namespace_id = "1001"` must be a
positive-integer string not already used by another rate-limit binding in
this account.

Note: the `[[ratelimits]]` binding syntax above is taken from the current
Cloudflare docs (Rate Limiting API) and was not validated by a real
`wrangler deploy` from this checkout — wrangler is not installed in the repo.

## Reading reports

Cloudflare dashboard → R2 → `kalsa-reports` → browse objects (one per
`YYYY-MM-DD/<id>.log`) and download to read. The Worker exposes no endpoint
that returns stored data.

## Tests

From the repo root (real exit code; `tail` on noisy output):

```bash
npx jest -c workers/report/jest.config.js > /tmp/kalsa-report-test.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-report-test.log
```

Type check:

```bash
npx tsc -p workers/report/tsconfig.json > /tmp/kalsa-report-tsc.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-report-tsc.log
```
