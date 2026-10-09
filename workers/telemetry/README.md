# Kalsa telemetry Worker

Cloudflare Worker + Durable Object buffer for **opt-in** error reports.
Design contract: `docs/TELEMETRY_OPTIN.md` (v14 FINAL + diag-addendum).

## What it does

- `POST /report` — strict schema validation (§7), IP rate limit 10/h (best-effort,
  `cf-connecting-ip` only), then DO `TelemetryBuffer` (singleton), the only dedupe
  authority. A duplicate signature increments `count` and sets `lastSeenAt` on the
  stored entry in one storage write and answers `accepted:false, reason:"duplicate"`
  (HTTP 200, no quota used, clients must not retry). A new signature goes through
  quota (50/h) → append. Quota rejection is **HTTP 429**. No KV is used.
  **Never** opens GitHub issues.
- `GET /flush` — `Authorization: Bearer FLUSH_TOKEN` only. Fail-closed `503` if
  token unset. With `AUTO_OPEN_ISSUES=false` (default): sets `reviewAck` only.
  With `true`: Worker leases via the DO, then searches GitHub itself
  (`GITHUB_TOKEN` never enters the DO). Search is 8s-bounded; HTTP errors /
  timeouts / malformed `total_count` release the lease and do **not** create.
  Issue created only after two consecutive `not_found`. Issue body is an
  allowlisted projection (no raw JSON, no `_reportId`).
- `POST /admin/flush-and-purge` — `Authorization: Bearer ADMIN_TOKEN` (separate
  from `FLUSH_TOKEN`). Wipes DO buffer. Fail-closed `503` if unset.
- `GET /admin/reports` — `Authorization: Bearer READ_TOKEN` (separate from the
  other two). Read-only: newest first, `?since=<ISO>` (inclusive), `?before=<ISO>`
  (exclusive cursor), `?limit=<n>` (default 100, cap 500). Returns `{total, count,
  skipped, nextBefore, entries}`; each entry is `{sig, receivedAt, lastSeenAt,
  count, logRefs, reviewAck, report}`: `report` is the first accepted copy, `count`
  the number of occurrences, `lastSeenAt` the latest one, `logRefs` the log
  references of the newest occurrences. Entries stored before counting read as
  `count` 1, `lastSeenAt` = `receivedAt`, `logRefs` `[]`. `since`/`before`/paging
  use `receivedAt` (first arrival). A page never splits one receive-time millisecond.
  Stored entries that cannot be served are counted in `skipped`, not fatal.
  `Cache-Control: no-store`. Fail-closed `503` if unset.

Accepted reports are never silently evicted. The buffer keeps every accepted
entry until a maintainer flush or `/admin/flush-and-purge`. There is no
5000-entry cap.

## Staging deploy runbook (required order)

1. **Set `GITHUB_REPO`** in `[vars]`:
   - staging: a throwaway test repo you control
   - production: `Aspis0/kalsa`
   Keep `AUTO_OPEN_ISSUES = "false"` until the first reviewed flush.

2. **Put secrets** (never commit; never put in `[vars]`):

   ```bash
   npx wrangler secret put GITHUB_TOKEN    # fine-grained, issues:write on GITHUB_REPO
   npx wrangler secret put FLUSH_TOKEN     # long random; GET /flush
   npx wrangler secret put ADMIN_TOKEN     # different long random; POST /admin/flush-and-purge
   npx wrangler secret put READ_TOKEN      # third long random; GET /admin/reports
   ```

3. **Deploy**:

   ```bash
   npx wrangler deploy
   ```

   The production origin is the `telemetry.kalsa.io` custom domain, and the
   route is declared in `wrangler.toml`, so the deploy binds it. `workers_dev`
   is `false`: the custom domain is the only origin, and the previous
   `*.workers.dev` host is retired because no released build ever used it.
   That custom-domain origin is the production `TELEMETRY_WORKER_URL`.

4. **Flush**:

   ```bash
   FLUSH_TOKEN=… TELEMETRY_WORKER_URL=https://telemetry.example.com \
     node workers/telemetry/flush.mjs
   ```

   Default (`AUTO_OPEN_ISSUES=false`) only sets `reviewAck`. Flip the flag
   in the dashboard when you are ready to open issues.

Point the app at the Worker:

1. Production / release APK: **must** set `TELEMETRY_WORKER_URL` in
   `src/telemetry/config.ts` to `https://telemetry.kalsa.io`.
   An empty URL silently disables all network send — correct for local/dev,
   **not** for a store build.
2. Device tests: AsyncStorage override
   `kalsa.telemetry.url = http://<lan-host>:8787` (or staging URL).

Unset / empty `TELEMETRY_WORKER_URL` → client silently disables network send.

## Reading reports

```bash
READ_TOKEN=… TELEMETRY_WORKER_URL=https://telemetry.kalsa.io \
  node workers/telemetry/read.mjs [--since 2026-10-01T00:00:00Z] [--out file]
```

Pages through the whole buffer (500 per request, until empty) and writes the
entries to `--out`, default `/tmp/kalsa-telemetry-<timestamp>.json`. The file is
created exclusively with mode 0600: an existing path or symlink is refused and
never overwritten. Prints counts by platform, version, error, diagnostics
component/stage, top-10 engine signatures, and the newest five. Reads never
change buffer state. `--logs` downloads each stored log reference with `npx
wrangler r2 object get` into `R2READ_DIR` (default `/tmp/r2read`) as
`<day>_<ID>.log`. The report Worker stamps the object with its own receive day,
which can differ from the logRef day, so the logged day is tried first, then the
previous and next UTC day. The summary prints the key actually found, or
`missing` with the days tried.

## Deletion

- Preferred: `POST /admin/flush-and-purge` with `ADMIN_TOKEN`.
- Manual last resort: `npx wrangler delete` tears down the Worker (and its
  DO storage) — use only if you intend to destroy the environment.

## Schema notes (diag-addendum)

`error.detail` is per-code enum (`unknown` accepts only `unknown`).
`error.signal` is allowlisted token only (max 80, charset `[A-Za-z0-9_ .-]`;
any `ggml_<id>` is stored as `ggml_*`). `appVersion` must match
`^\d+(\.\d+){1,3}[a-z0-9.-]*$`. `platform` must be `android` or `ios`.
Invalid detail/signal/unknown keys → `400`.
Body > 4KB (Content-Length or streamed) → `413`. Malformed UTF-8 → `400`.

Canonical dedupe signature is
`{platform, code, detail, appVersion, deviceBucket, modelCategory, dateBucket}`
for v1; v2 adds its diagnostics fields to the same set. `platform` is in both,
so android and ios reports never merge. v2 already included `platform`; the
change only affects v1. `signal` is **not** in the signature.

v1 entries stored before `platform` joined the signature keep their old
signature, so the first recurrence of one is stored as a new entry. Accepted
for the alpha (production holds about 10 reports); there is no migration.

`diagnostics.logRef` (v2, optional) names the desktop's redacted log in the
report Worker bucket `kalsa-reports`, key `<logRef>.log`. Accepted only as
`^[0-9]{4}-[0-9]{2}-[0-9]{2}/[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$` (the report
Worker's UTC day and id alphabet; the regex does not check calendar validity).
It is not part of the signature. A duplicate appends its logRef to the stored
entry's `logRefs` (no repeats, newest last, at most 10: the oldest fall off;
`count` still counts every occurrence).

## Privacy

- No payload logs (counts / status only). `flush.mjs` logs status +
  `{created,skipped,duplicates,released,reviewed}` — never the raw body.
- Cloudflare may retain connection metadata per their policy; IP is not stored
  in the report body. Rate limit uses `cf-connecting-ip` only.

## Desktop v2

The shared wire contract is [contract-v2.ts](contract-v2.ts). `schema.ts` keeps
v1 validation for phones and validates optional v2 diagnostics through
`schema-v2.ts`. v2 issue signatures distinguish component, stage, backend,
engine/model and GPU/driver (see the dedupe signature above).

Run `node workers/telemetry/test.mjs` from the repository root. It runs the
existing Worker harness (`node scripts/telemetryWorkerHarness.mjs`),
then v2 allowlist and canary tests. No phone source is changed. Set
`KALSA_TELEMETRY_SAMPLE` to a desktop test report file to verify Rust/Worker
wire compatibility. Desktop constants are generated by
`kalsa-brain/dev/generate-telemetry-spec.mjs`; `--check` detects drift.
