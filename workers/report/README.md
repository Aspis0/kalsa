# Kalsa report Worker

Cloudflare Worker that receives the desktop app's log file from alpha testers
and stores it privately in R2. The Worker stores whatever it is sent and
cannot verify its content: the promise that the log never contains chat
content, prompts, answers, file contents, pairing codes or invite links is
enforced by the desktop app's log writer, not here.

## Routes (declared in `wrangler.toml`, zone `kalsa.io`)

- `kalsa.io/report*` — `POST` only, exact path (same `*` shape as
  kalsa-pair's route so query strings like `/report?x=1` still match at the
  edge; the Worker's own check is `url.pathname === "/report"`, which is the
  guard).

`/report/…`, `/reports`, `/`, a foreign host, or any other path still
reaching the Worker gets `404`
(`{"error":{"code":"not_found",…}}`); a non-`POST` on `/report` gets `405`
with `Allow: POST`. There is no `GET` for a stored report and no listing —
the bucket is read only by the owner in the Cloudflare dashboard.

## Request contract (in this order)

1. **Content type**: `text/plain; charset=utf-8`, the log text as sent.
   Missing or any other type → `415`.
2. **`X-Kalsa-App: <version>/<os>/<arch>`**: required, matched strictly
   against `^[0-9A-Za-z._-]{1,32}/[a-z0-9_]{1,16}/[a-z0-9_]{1,16}$`;
   missing or malformed → `400`.
3. **`Content-Length`**: optional. Present and over the 4 MiB cap (two 2 MiB
   log files) → `413` before the body is read. Absent is fine — the cap is
   enforced while reading the stream regardless, so a missing or lying
   header cannot get more than 4 MiB stored → `413`.
4. **Rate limit**: only after all validation passes does the request spend
   the client's quota: 5 accepted `POST`s per client IP per 60 s via the
   Workers Rate Limiting binding `REPORT_RATE_LIMITER` → `429`. The IP
   (`CF-Connecting-IP`) is used only as the limiter key, so invalid requests
   cannot poison it.
5. **Body read**: empty body → `400`; the 4 MiB cap is enforced mid-read
   regardless of the header → `413`.
6. **Daily cap**: before storing, `REPORTS.list({ prefix: "<YYYY-MM-DD>/",
   limit: 300 })` — if the day already holds `DAILY_CAP = 300` reports →
   `503` `{"error":{"code":"daily_limit",…}}`.

## Storage bound and cost

- Daily cap: 300 reports × 4 MiB ≤ ~1.2 GiB written per day.
- Lifecycle rule (owner runs once, see below) deletes objects after 30 days,
  so the bucket holds at most ~30 days × 1.2 GB ≈ **36 GB** at worst.
- R2 storage is $0.015/GB-month with the first 10 GB free → worst-case
  monthly storage cost ≈ (36 − 10) GB × $0.015 ≈ **$0.39/month**
  (typically far less: only what testers actually send).

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
- **Conditional write**: every `put` carries
  `onlyIf: { etagDoesNotMatch: "*" }`, so a key that already exists makes
  `put` return `null` and store nothing; the Worker then retries with a
  fresh id, up to 3 attempts, and answers `503`
  `{"error":{"code":"storage_conflict",…}}` if all three collide. A report
  is never overwritten by a later one.

## What is never stored

- The connecting IP — it exists only as the rate-limiter key, inside the
  limiter binding, and never reaches the `put`.
- Any header other than `X-Kalsa-App` (no User-Agent, no URL, no referer).
- Chat content, prompts, answers, file contents, pairing codes or invite
  links: the desktop app's log writer keeps them out; this Worker does not
  inspect or enforce that.

## Responses

- `201` → `{"id":"<id>"}`.
- Errors → `{"error":{"code":"<snake_case>","message":"<English>"}}`
  (`not_found`, `method_not_allowed`, `unsupported_media_type`,
  `bad_app_header`, `payload_too_large`, `empty_body`, `rate_limited`,
  `daily_limit`, `storage_conflict`, `internal_error`).
- Every response carries `Cache-Control: no-store` and
  `X-Content-Type-Options: nosniff`.
- **No CORS headers are sent.** That does not stop a browser from firing a
  cross-origin request at the endpoint — it stops the page from *reading*
  the response. What stops browser uploads is `X-Kalsa-App`: setting a
  custom header forces a CORS preflight, which this Worker never answers,
  and validation rejects any request that omits or mangles the header.

## One-time setup (owner)

```bash
npx wrangler login
cd workers/report
npx wrangler r2 bucket create kalsa-reports
npx wrangler r2 bucket lifecycle add kalsa-reports delete-after-30d --expire-days 30
npx wrangler deploy
```

`wrangler deploy` needs the owner's explicit OK — do not deploy without it.
No secrets, no vars; `workers_dev = false` and the route are declared in
`wrangler.toml` so every deploy keeps them. `namespace_id = "1001"` must be a
positive-integer string not already used by another rate-limit binding in
this account.

Syntax notes (not runnable from this checkout — wrangler is not installed in
the repo, so none of these commands were executed):

- `r2 bucket lifecycle add <BUCKET> [NAME] [PREFIX] --expire-days <n>` is
  the documented form; omitting `[PREFIX]` applies the rule to all objects.
- The top-level `[[ratelimits]]` binding follows the current Rate Limiting
  API docs; an older wrangler would want `[[unsafe.bindings]] type =
  "ratelimit"` instead.
- `onlyIf: { etagDoesNotMatch: "*" }` follows the R2 docs (precondition
  failure → `put` returns `null`, object not stored) and RFC 7232's
  first-upload pattern that those docs defer to; it was not exercised
  against a live bucket.

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
