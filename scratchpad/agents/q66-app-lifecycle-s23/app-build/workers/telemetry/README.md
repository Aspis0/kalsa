# Kalsa telemetry Worker

Cloudflare Worker + Durable Object buffer for **opt-in** error reports.
Design contract: `docs/TELEMETRY_OPTIN.md` (v14 FINAL + diag-addendum).

## What it does

- `POST /report` — strict schema validation (§7), IP rate limit 10/h (best-effort,
  `cf-connecting-ip` only), DO `TelemetryBuffer` (singleton) for atomic dedupe →
  quota (50/h) → append. Quota rejection is **HTTP 429**. KV is **read-cache only**
  for dedupe (TTL 180d). **Never** opens GitHub issues.
- `GET /flush` — `Authorization: Bearer FLUSH_TOKEN` only. Fail-closed `503` if
  token unset. With `AUTO_OPEN_ISSUES=false` (default): sets `reviewAck` only.
  With `true`: Worker leases via the DO, then searches GitHub itself
  (`GITHUB_TOKEN` never enters the DO). Search is 8s-bounded; HTTP errors /
  timeouts / malformed `total_count` release the lease and do **not** create.
  Issue created only after two consecutive `not_found`. Issue body is an
  allowlisted projection (no raw JSON, no `_reportId`).
- `POST /admin/flush-and-purge` — `Authorization: Bearer ADMIN_TOKEN` (separate
  from `FLUSH_TOKEN`). Wipes DO buffer. Fail-closed `503` if unset.

Accepted reports are never silently evicted. The buffer keeps every accepted
entry until a maintainer flush or `/admin/flush-and-purge`. There is no
5000-entry cap.

## Staging deploy runbook (required order)

Do **not** deploy with the `REPLACE_WITH_KV_*` sentinels. Those are not IDs.
Inventing hex strings will bind the Worker to a namespace you do not own.

1. **Create KV namespaces** (once per environment; staging ≠ production):

   ```bash
   cd workers/telemetry
   npx wrangler kv namespace create TELEMETRY_DEDUPE
   npx wrangler kv namespace create TELEMETRY_DEDUPE --preview
   ```

   Wrangler prints two 32-hex ids. Copy them.

2. **Paste IDs into `wrangler.toml`** (`[[kv_namespaces]]` `id` and
   `preview_id`). The template with commented placeholders lives in
   `wrangler.example.toml`. Confirm the ids you paste belong to **this**
   account / this environment. Staging must use a different pair than
   production so a staging flush cannot read or write prod dedupe keys.

3. **Set `GITHUB_REPO`** in `[vars]`:
   - staging: a throwaway test repo you control
   - production: `Aspis0/kalsa`
   Keep `AUTO_OPEN_ISSUES = "false"` until the first reviewed flush.

4. **Put secrets** (never commit; never put in `[vars]`):

   ```bash
   npx wrangler secret put GITHUB_TOKEN    # fine-grained, issues:write on GITHUB_REPO
   npx wrangler secret put FLUSH_TOKEN     # long random; GET /flush
   npx wrangler secret put ADMIN_TOKEN     # different long random; POST /admin/flush-and-purge
   ```

5. **Deploy**:

   ```bash
   npx wrangler deploy
   ```

   Bind a custom domain in the CF dashboard (`workers_dev = false`). Record
   the origin; that is `TELEMETRY_WORKER_URL`.

6. **Flush**:

   ```bash
   FLUSH_TOKEN=… TELEMETRY_WORKER_URL=https://telemetry.example.com \
     node workers/telemetry/flush.mjs
   ```

   Default (`AUTO_OPEN_ISSUES=false`) only sets `reviewAck`. Flip the flag
   in the dashboard when you are ready to open issues.

Point the app at the Worker:

1. Production / release APK: **must** set `TELEMETRY_WORKER_URL` in
   `src/telemetry/config.ts` to the custom domain (keep `workers_dev = false`).
   An empty URL silently disables all network send — correct for local/dev,
   **not** for a store build.
2. Device tests: AsyncStorage override
   `kalsa.telemetry.url = http://<lan-host>:8787` (or staging URL).

Unset / empty `TELEMETRY_WORKER_URL` → client silently disables network send.

## Deletion

- Preferred: `POST /admin/flush-and-purge` with `ADMIN_TOKEN`.
- Manual last resort: `npx wrangler delete` tears down the Worker (and its
  DO storage) — use only if you intend to destroy the environment.

## Schema notes (diag-addendum)

`error.detail` is per-code enum (`unknown` accepts only `unknown`).
`error.signal` is allowlisted token only (max 80, charset `[A-Za-z0-9_ .-]`;
any `ggml_<id>` is stored as `ggml_*`). `appVersion` must match
`^\d+(\.\d+){1,3}[a-z0-9.-]*$`. Invalid detail/signal/unknown keys → `400`.
Body > 4KB (Content-Length or streamed) → `413`. Malformed UTF-8 → `400`.

Canonical dedupe signature is
`{code, detail, appVersion, deviceBucket, modelCategory, dateBucket}`.
`signal` is **not** in the signature.

## Privacy

- No payload logs (counts / status only). `flush.mjs` logs status +
  `{created,skipped,duplicates,released,reviewed}` — never the raw body.
- Cloudflare may retain connection metadata per their policy; IP is not stored
  in the report body. Rate limit uses `cf-connecting-ip` only.
