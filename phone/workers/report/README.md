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

**A phone line's JSON is scrubbed by its decoded values** (`phone-json.ts`). The
gate validates that payload by *parsing* it, so scanning the escapes and storing
them would leave a gap between what was approved and what is kept: a line
carrying `{"m":"marco@example.com"}` stored verbatim and decoded back to
the address. The pass therefore parses the payload again, scrubs every string
value **and every object key** in its decoded form, and rebuilds the line with
`JSON.stringify`. The bytes stored are the bytes that were scanned, so no escape
can put a token in front of the pass and then decode itself out of what the pass
approved. It also ends a second failure: the raw scan used to begin a match
*inside* an escape and leave the backslash behind, storing `marco\<email>`, which
no reader can parse.

A payload the clip explains — cut at exactly the client's 300-character budget,
so it does not parse — is the case an attacker steers, because the length alone
moves it off the walk-the-values path and onto raw text, where `\u0040` means
nothing. Those escapes are therefore resolved tolerantly too (`\uXXXX` including
surrogate pairs, `\/`, `\\`, `\"`, `\b\f\n\r\t`; an unknown or half-cut escape is
left alone), the invisible characters are removed, and the result is scanned and
stored. A `js_error` line and a desktop line have no payload at all and go
through the raw text scan untouched.

**Percent-encoding is decoded and scanned on both paths.** `marco%40example.com`
and `https%3A%2F%2Fx.io%2Fp%3Ftoken%3Dabc` hide the very character every rule
starts from, and a reader that decodes them sees the address and the query.

The two scans **compose** rather than compete: the raw pass runs first, and the
decode runs on what it produced. A marker holds no `%`, so what the first pass
removed stays removed, and a second scan can only add. Choosing between the two
results instead — by which redacted more — was wrong, and measurably so:
`https://user:pa%3Fss@host/` redacts exactly once either way, but the decoded
scan stops at the `?` the escape becomes and stored `https://user:pa<query>`,
with the username and a password prefix in front of the marker, where the raw
scan stores `https://<cred>@host/`. Composing cannot lose that.

The decoded form is stored only when it is what found something, and text that
decodes to nothing sensitive is kept exactly as it arrived, so `100% done` does
not become `100 done`. An invalid sequence such as `%zz` is left as it is, and
`%00`–`%1F` and `%7F` are **never decoded**: a literal newline or NUL written
into the middle of a stored line would split one report line into two.

Decoding happens **once**. `marco%2540example.com` survives whole, and so does
`marco%5Cu0040example.com`, whose first decode produces a `\u0040` that a reader
would resolve on a second pass. Both are accepted limits: the pass is not an
encoder, and a body can be decoded once more than it was.

**Characters that carry nothing a reader can see are removed from a phone
payload** before it is scanned — the C0 controls and the format characters a
font will not draw (U+00AD, U+200B–U+200F, U+202A–U+202E, U+2060–U+2064,
U+FEFF). A token split across one of them, `marco<NUL>@example.com` or
`10.0.0<NUL>.7`, is two tokens to every rule and one word to a human. The
cleaned value is what gets stored, so what is stored is what was scanned. This
is scoped to a phone payload on purpose: a desktop log separates its columns
with tabs, and joining them would cost more than the character is worth.

**A JSON payload is walked, not re-typed.** Every string value and every key is
scrubbed, then the payload is rebuilt with `JSON.stringify` — so a number, a
`null` and a `__proto__` key are carried by the serializer rather than by a
plain assignment, which is what silently dropped the last one. A value JSON
cannot round-trip exactly (`1e400` becomes `null`, a 20-digit integer loses its
last digits) is changed by that round trip and not by any rule here.

**Both bodies are redacted** (`redact.ts`), mirroring the clients' rules:

| What | Becomes | Note |
| --- | --- | --- |
| A URL's query and fragment | `<query>` | the address stays; a query can be a credential |
| A URL's credentials (`user:pass@`) | `<cred>@` | the desktop's own spelling; the phone has no rule for it; **see the break set below** |
| An email address | `<email>` | **new here**: neither client redacts addresses today |
| `/Users/<name>`, `/home/<name>`, `/data/user/<n>/<pkg>` | `/Users/<user>`, `/home/<user>`, `/data/user/<n>/<pkg>` | |
| `C:\Users\<name>` or `\\server\Users\<name>` | `C:\Users\<user>` | the drive letter and the server stay |
| An IPv4 literal | `<ip>` | four octets, then an optional `:port`; a five-part dotted number is not a literal |
| An IPv6 literal | `<ip6>` | the whole run: full, compressed, `%zone`, or IPv4-mapped, closing on a port |

**Any scheme, any case.** A URL scheme is case-insensitive (RFC 3986) and is not
limited to `http(s)`. Matching `https://` literally stored the whole token of
`HTTPS://x.io/p?token=abc`, and a redirect through `ftp:` or `s3:` leaked the
same way, so the rule now takes any `scheme://` — RFC 3986 scheme characters,
first one a letter, at most 64 of them walked back — and redacts the query, the
fragment and any credentials on it.

**An authority ends where its URL ends.** A credential only exists inside the
authority, and everything past the URL's run — a space, a quote, a bracket — is
prose. `GET https://api.example.com failed, contact marco@example.com` therefore
stores the URL and redacts only the address; it used to store
`https://api.example.<cred>@example.com`, having taken `com failed, contact
marco` with it. The same rule is what keeps a pathless URL from leaving the
authority open for the rest of the line. For the same reason a `?` or `#` with
nothing behind it in the URL's own run is left alone: `see https://example.com? yes`
is a sentence, and calling it a query deleted the word after it.

**On the markers.** Only the *phone's* spellings are reused (`<ip>`, `<ip6>`,
`/Users/<user>`, …), so a phone report reads the same wherever it was redacted.
The desktop spells these `~`, `<addr>` and `?…`, and the server does **not**
reuse those: a desktop report can therefore read slightly differently from what
the desktop would have written locally.

**Known limits of the mirror.** The server does not reproduce the desktop's
other passes — its tmp-tree, owner-hostname, download-key or Windows-temp rules —
because each of those is built from the machine's own environment, which the
Worker does not have. An IPv6 run needs a `::` or four groups and stops at word
boundaries, so `std::io::Error` and `12:34:56` survive intact while all of
`2001:db8::1`, `fe80::1%eth0` and `::ffff:10.0.0.1:8080` goes. An address also
ends in a group or in `::`, never in a lone `:` — without that, `1:a::C:\Users\marco`
read as an address and swallowed the drive letter, dropping the profile name.
An IPv4 literal is exactly four octets, so `10.0.0.7.5` — a version, not an
address — is left alone, the opposite of the clients, which over-redact it.

**A Windows account name ends at the path, not at the sentence.** The segment
may hold a space, so the name ends at the separator that closes it
(`C:\Users\Marco Gualtieri\Documents` → `C:\Users\<user>\Documents`) — but only
when that separator arrives before any `:` and does not itself open another path.
With neither in reach, the name ends at the end of the word, so
`C:\Users\marco logged out` keeps `logged out` and
`C:\Users\marco and C:\Users\anna` has both names redacted. The UNC form follows
the same rule, with the share in place of the `:`.

Three rules are narrower than the text they read, because the shapes they would
otherwise accept are not the shapes real data has:

- **No address is longer than 64 characters.** Eight groups of four hex digits
  and seven colons is 39; an IPv4 literal with a port is 21; a zone index sits
  outside the run. A longer run of hex and colons is therefore not an address and
  is never handed to the parsers — which is also what keeps a body of `1:1:1:…`
  from being walked twice. Such a run is left as it is.
- **A domain label starts with a letter, a digit or a non-ASCII character**
  (RFC 1035 rules out a leading hyphen). `a@-b` is not an address; on a body of
  `-@-` the looser rule matched one on every third character.
- **A userinfo longer than 256 characters is replaced from the start of the
  authority**, not from 256 characters back. The walk to the `@` is capped because
  an uncapped one re-read the whole prefix for every `@` in the line, and stopping
  *at* the cap would have left the username and the next 44 characters in front of
  the marker. Replacing a long span costs nothing; walking it did.

Two limits the pass accepts rather than fixes:

- **These characters end the credential walk**, and the text before one is left
  where it is, so a password holding one keeps its leading part:
  `?` `#` `/` `@`, `"` `'` `<` `>` `)` `]` `}`, **every code unit ≤ 32** (space,
  tab, NUL, CR, LF and the rest of the C0 controls), and the 256-character cap
  above. Everything else walks whole: `.` `\`, `-` `_` `:` `=`, `!` `,`, `é`, and
  every code unit ≥ 0x80. So `https://user:pa.ss@host/` is replaced whole and
  `https://user:pass word@host/` keeps `pass`. Covering the space and quote cases
  means letting a credential walk across whitespace, which is what made an
  earlier version turn
  `GET https://api.example.com failed, contact marco@example.com` into
  `https://api.example.<cred>@example.com`; one space of tolerance does not
  rescue it either, because `see https://x.io for user@host` has the same shape
  as the case it would fix. Note also that a `?` or `#` inside a password is
  consumed by the query rule first, since the pass scans left to right.
- **An address that starts immediately after a `>` is left** (`peer>10.0.0.1`),
  while `<10.0.0.1>` is redacted. Refusing to read an address after a `>` is what
  keeps `<email>::` from becoming `<ip6>` on a second pass; the bracket forms are
  untouched because the character before them is `<`.

And these, which need a reader or a serializer we do not have:

- **A raw control or format character splits an address in a raw line** — a NUL,
  a TAB or a zero-width space written inside `10.0.0.7` in a body that is not a
  phone payload. Inside a phone payload it cannot: those characters are removed
  before the scan, in the decoded values and in a payload the clip left
  unparseable alike. What is left is the tab-separated desktop line, where a tab
  is a column separator and joining columns would cost more structure than the
  character is worth. A non-ASCII format character cannot split an address on
  either path: every code unit ≥ 0x80 is a word character to every rule.
- **An HTML entity or a fullwidth `@`** (`marco&#64;example.com`,
  `marco＠example.com`) is stored as it arrived. It is not an address to any
  parser we run; only a rendering or a reader treats it as one.
- **An address written as a number** (`{"ip":3232235527}`) is stored as it
  arrived. Every rule here is textual; a reader that widens a 32-bit integer
  would have to do the arithmetic the redactor deliberately does not.
- **A BOM empties the first phone line, and a CR-only body empties the whole
  one** — the gate splits on `\n`, which is what the phone writes. Data loss
  rather than a leak, on a body no real client sends.
- **A stored phone line is not re-validated against the gate.** Re-serializing a
  payload, resolving an escape or replacing a token all change its length, so a
  line the pass lengthened past the clip would be dropped by a second pass over
  the stored report. It matters only if reports are ever re-screened.

**Non-ASCII counts.** Every code unit above 0x80 is a word character, so
`/Users/用户/x`, `C:\Users\用户\x`, `josé@example.com` and `用户@example.com` are
replaced whole; a rule that stopped at the first non-ASCII character stored the
rest of the name in the clear (`/Users/<user>é/x`). A surrogate pair is two such
code units and is covered by the same rule. The cost is some over-redaction —
an em dash is now a name character — which is the safe direction.

**The pass is stable on its own output.** Redacting twice changes nothing, so a
stored report can be re-screened without markers moving
(`idempotence.test.ts`, 20 000 seeded lines plus the shapes that used to fail).

**Cost.** The route is unauthenticated and the body ceiling is 4 MiB, so no rule
backtracks: the pass is one left-to-right scan per line over a character-class
lookup table, and a rule that reads backwards — a credential, an address, a mail
local part — is capped and stops at the token it is reading. One regex pass per
class cost 100–210 ms on the same adversarial bodies. A body is worked line by
line under a per-line cap of `MAX_CLIENT_LINE_CHARS` (the desktop's own
`LINE_CHAR_CAP` of 8 KiB plus its truncation marker); a longer line comes from
neither client and is dropped without being scanned.

The raw body is capped mid-stream and the request is cancelled there, so
anything over 4 MiB never reaches the filter or the pass at all. The pass is then
handed the same cap for its **output** and stops at it, because a marker is
longer than what it replaces: `a@b` becomes `<email>`, so a body of them is
2.3× its own size once screened. Building that string first — 29 MB out of a
4 MiB body, the worst of the shapes the auditor tried — is what the cap exists to
avoid; the caller is told the screen stopped and refuses the report.

Measured in **CPU time** (what Cloudflare bills and limits), fresh process, best
of three, with the route's 4 MiB output cap in force:

| 4 MiB body | cost |
| --- | --- |
| realistic phone | 83 ms |
| realistic desktop | 67 ms |
| `http://h` + 8185 `@` | 109 ms |
| percent-dense desktop (`%41` storm) | 111 ms |
| dot-dense desktop (`10.0.0.7. `) | 70 ms |
| escape-dense phone (`@` storm, 160 KB) | 2 ms |

Going from 1 MiB to 4 MiB costs 3.87–4.03× on the same shapes: linear. A single
8192-character `@` line costs 0.26 ms.

Those figures move with the host. `cost.test.ts` therefore asserts **linearity**
— four times the bytes may not cost sixteen times the time — rather than an
absolute budget, because jest's module wrapper inflates the match-heavy paths
about five-fold. It runs the adversarial shapes at 1 MiB and at 4 MiB, then
repeats the exercise with the *line* as the variable. Every case prints what it
actually cost.

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
