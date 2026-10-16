# Kalsa report Worker

Cloudflare Worker that receives an app's log file from alpha testers and stores
it privately in R2. The app's log writer is still what keeps chat content,
prompts, answers, file contents, pairing codes and invite links out of a report;
on top of it the Worker screens the body itself before the put, so a leak that
gets past the client is caught here too (see **The server-side screen**).

## Routes (declared in `wrangler.toml`, zone `kalsa.io`)

- `kalsa.io/report*` — `POST` only, exact path.

On the pattern itself:

- The trailing `*` is what lets query strings through: route matching sees
  the full URL including the query, patterns may not contain `?`
  (`kalsa.io/report?*` is not a valid pattern), so a terminal wildcard is
  the only documented way to match `/report?x=1`. The `*` also captures
  `/reports`, `/reporting` and `/report/…` at the edge — accepted, because
  the Worker's own check (`url.pathname === "/report"`) 404s all of them;
  that check is the guard.
- A pattern without a scheme matches `http://` as well as `https://`, and
  the Worker never accepts plaintext: `http://kalsa.io/report` gets the
  same `404` as an unknown path.

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
4. **Rate limit**: 5 requests per client IP per 60 s via the Workers Rate
   Limiting binding `REPORT_RATE_LIMITER` → `429`. The IP
   (`CF-Connecting-IP`) is used only as the limiter key, and the checks
   above run first, so rejected requests cannot poison it. The counter
   charges every request that passes header validation — not only accepted
   uploads: an empty body, an oversized stream, or a request turned away
   by the daily cap still spends one of the five.
5. **Body read**: empty body → `400`; the 4 MiB cap is enforced mid-read
   regardless of the header → `413`.
6. **Daily cap**: before storing, `REPORTS.list({ prefix: "<YYYY-MM-DD>/",
   limit: 300 })` — if the day already holds `DAILY_CAP = 300` reports →
   `503` `{"error":{"code":"daily_limit",…}}`.
7. **Server-side screen**: the body is filtered and redacted before the `put`
   (**The server-side screen** below). It changes what is stored, and it has the
   two refusals listed there: `400` `invalid_utf8` and `413`
   `payload_too_large` when screening would grow the report past the cap.

## The server-side screen

Everything below runs on the bytes the Worker is about to store, after the
daily cap and before the `put`. It is a **second defense, not a replacement**
for the clients' own log writers: a bug in a client can no longer be the only
thing between a chat message and our bucket, but the client's writer is still
the primary control.

**Which body it is.** `X-Kalsa-App` is the only thing in the request that names
the sender, and its os component decides: the phone builds
`${version}/${Platform.OS}/arm64` (`sendLog`'s `app`, `src/logReport/sendLog.ts`)
— `android` or `ios` — and the desktop `${version}/${std::env::consts::OS}/${arch}`
(`report::app_header`, kalsa-brain `src-tauri/src/report.rs`), whose os is
`macos`, `windows` or `linux`. The Worker never reads the body to decide: there
is no other field, and there is no client attestation to check. So a caller that
lies *toward* a phone os gets the gate, and a phone that claims a desktop os
gets the desktop treatment — redaction only. **A lying phone loses the line
filter.** That residual risk is the price of having no attestation, not a bug in
the filter.

**A phone body keeps only the client's two line shapes.** The phone's log writer
has exactly two writers, and both end in `finalizeLine` (an ISO-8601 timestamp,
a space, then the record), so the gate accepts:

1. `<ISO> KALSA_<TAG> {json}` — the console writer (`captureConsoleLine` →
   `formatRecord`, `src/logReport/collector.ts`). The tag is matched against the
   `KALSA_` prefix the client requires of every log call, not against its
   `TAG_SCHEMAS` key set, so a tag a future build adds is never dropped. A
   payload that parses as JSON always passes; one that does not is kept **only**
   when the `TAG {json}` record is exactly `MAX_LINE_CHARS` (300), which is what
   a line the client clipped mid-object looks like.
2. `<ISO> js_error name=<name> frame=<basename:line:col>|none` — `recordJsError`
   → `formatJsErrorLine` (`src/logReport/jsErrorLine.ts`), the **crash lines the
   reports exist for**. Both fields are matched as shapes, not against the
   client's `SAFE_NAMES` / `BUNDLE_BASENAMES` values: those sets hold only
   letters, digits, dots and dashes, so nothing identifying can ride in, and a
   name a future build adds is never dropped.

Anything else is dropped and counted: prose, a pasted answer, a file name on a
line of its own, a forged `js_error` carrying a path. The filter runs **before**
the redaction pass — the clip length is what tells a truncated real line from an
invented one, and redaction shortens lines. A line longer than the phone can
write (timestamp + clip = 325 characters) is dropped without being parsed.

**Both bodies are redacted** (`redact.ts`), mirroring the clients' rules:

| What | Becomes | Note |
| --- | --- | --- |
| A URL's query and fragment | `<query>` | the address stays; a query can be a credential |
| A URL's credentials (`user:pass@`) | `<cred>@` | the desktop's own spelling; the phone has no rule for it |
| An email address | `<email>` | **new here**: neither client redacts addresses today |
| `/Users/<name>`, `/home/<name>`, `/data/user/<n>/<pkg>` | `/Users/<user>`, `/home/<user>`, `/data/user/<n>/<pkg>` | |
| `C:\Users\<name>` | `C:\Users\<user>` | case-insensitive, spaces in the name allowed; the drive letter stays |
| An IPv4 literal | `<ip>` | |
| An IPv6 literal | `<ip6>` | needs a `::`, as in the clients, plus a leading `::1` |

**On the markers.** Only the *phone's* spellings are reused (`<ip>`, `<ip6>`,
`/Users/<user>`, …), so a phone report reads the same wherever it was redacted.
The desktop spells these `~`, `<addr>` and `?…`, and the server does **not**
reuse those: a desktop report can therefore read slightly differently from what
the desktop would have written locally.

**Known limits of the mirror.** The server does not reproduce the desktop's
other passes — its tmp-tree, owner-hostname, download-key or Windows-temp rules —
because each of those is built from the machine's own environment, which the
Worker does not have. It also requires a group before a `::`, so a compressed
`2001:db8::1` keeps its leading group (`2001:<ip6>`, nothing identifying) and
`std::io::Error` survives intact. Like the clients, it over-redacts a dotted
quad that is really a version number — the safe direction.

**Cost.** The route is unauthenticated and the body ceiling is 4 MiB, so every
rule is bounded, the URL pass is a forward scan rather than a regex, and each
rule is skipped unless the line holds the one character it cannot match without.
A body is worked line by line under a per-line cap of
`MAX_CLIENT_LINE_CHARS` (the desktop's own `LINE_CHAR_CAP` of 8 KiB plus its
truncation marker); a longer line comes from neither client and is dropped
without being scanned. Measured on the machine that wrote this, best of three:
the adversarial bodies a quadratic version needed minutes for cost under 1 ms
each, a legitimate 4 MiB phone body ~39 ms and a 4 MiB desktop body ~36 ms
(`cost.test.ts` holds the budgets and prints what each case actually cost).

**What the screen is not.** It is a filter and a redactor, not a classifier: it
cannot tell a prompt that happens to sit inside a well-formed `KALSA_` line
from any other field, and it cannot redact prose that contains no address, IP,
email or home path. The clients' writers remain the real guarantee.

**Counts only.** `customMetadata` carries `dropped` and `redacted` — how many
lines the screen refused and how many replacements the pass made. The dropped
text is never stored, counted in metadata only. A phone body of nothing but
prose is stored as an empty object with its `dropped` count, so the owner can
see in the dashboard that a body was emptied.

**Two refusals**, both client bugs rather than attacks:

- A body that is not valid UTF-8 → `400` `invalid_utf8`. Decoding it leniently
  would turn every bad byte into a 3-byte U+FFFD and could triple what one
  object stores against the 4 MiB arithmetic above. Neither real client can
  send this: the phone writes UTF-8 text and the desktop sends a Rust `String`.
- A screened report that outgrew the cap → `413` `payload_too_large`, since a
  `<query>` marker is longer than the `?` it replaces and a body of
  query-carrying URLs grows while being screened. One stored object therefore
  never exceeds `MAX_BODY_BYTES`.

## Storage bound and cost

- Daily cap: 300 reports × 4 MiB ≈ **1.26 GB/day** at most. The cap is
  soft: concurrent uploads checked before each `put` can push a day
  slightly past 300 objects.
- The lifecycle rule (owner runs once, see below) deletes objects after 30
  days; deletion can lag up to ~24 h, so the bound is approximate:
  ~30 days × 1.26 GB ≈ **38 GB** at worst.
- R2 storage is $0.015/GB-month with the first 10 GB free → worst-case
  monthly storage cost ≈ (38 − 10) GB × $0.015 ≈ **$0.42/month**
  (typically far less: only what testers actually send).

## What is stored

One R2 object per accepted upload:

- **Key**: `YYYY-MM-DD/<id>.log`, where `id` is 8 chars drawn with
  `crypto.getRandomValues` from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` — no
  0/O/1/I/L, so a tester can read an id out over the phone — with rejection
  sampling so every character is equiprobable.
- **Value**: the log text after the server-side screen — byte-identical to the
  body for a report with nothing to replace, the redacted and filtered text
  otherwise, and never larger than `MAX_BODY_BYTES`.
- **`httpMetadata.contentType`**: `text/plain`.
- **`customMetadata`**: `{ app = <X-Kalsa-App value>,
  received = <ISO-8601 arrival time, taken before the body is read>,
  dropped = <lines the screen refused>,
  redacted = <replacements the redaction pass made> }`. The two counts are the
  only record of what the screen removed.
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
- Text the screen removed: what the phone gate dropped is not written at all,
  and what the redaction pass replaced is stored only as its marker. The
  Worker logs nothing about a body.
- Chat content, prompts, answers, file contents, pairing codes or invite
  links: the app's log writer keeps them out, and the server-side screen
  catches a phone body that is not in the client's own shape. The screen is a
  second line, not the guarantee — see **The server-side screen**.

## Responses

- `201` → `{"id":"<id>"}`.
- Errors → `{"error":{"code":"<snake_case>","message":"<English>"}}`
  (`not_found`, `method_not_allowed`, `unsupported_media_type`,
  `bad_app_header`, `payload_too_large`, `empty_body`, `invalid_utf8`,
  `rate_limited`, `daily_limit`, `storage_conflict`, `internal_error`).
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

From the repo root (real exit code; `tail` on noisy output). Three suites:
`report.test.ts` (routes and header validation), `storage.test.ts` (what the
bucket gets), `filter.test.ts` (the screen's behaviour: both body shapes, both
client line shapes, every redaction class, its refusals) and `cost.test.ts`
(the CPU budgets, adversarial and legitimate).

```bash
npx jest -c workers/report/jest.config.js > /tmp/kalsa-report-test.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-report-test.log
```

Type check:

```bash
npx tsc -p workers/report/tsconfig.json > /tmp/kalsa-report-tsc.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/kalsa-report-tsc.log
```
