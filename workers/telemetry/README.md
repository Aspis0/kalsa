# Kalsa telemetry Worker

Cloudflare Worker + Durable Object buffer for **opt-in** error reports.
Design contract: `docs/TELEMETRY_OPTIN.md` (v14 FINAL + diag-addendum).

## What it does

- `POST /report` — strict schema validation (§7), IP rate limit 10/h (best-effort),
  DO `TelemetryBuffer` (singleton) for atomic dedupe → quota (50/h) → append.
  KV is **read-cache only** for dedupe (TTL 180d). **Never** opens GitHub issues.
- `GET /flush` — `Authorization: Bearer FLUSH_TOKEN` only. Fail-closed `503` if
  token unset. With `AUTO_OPEN_ISSUES=false` (default): sets `reviewAck` only.
  With `true`: lease → GitHub search by `Telemetry signature: <sig>` (2 attempts,
  2s apart) → create issue with label `telemetry`.

## Deploy (maintainer)

```bash
cd workers/telemetry
# Create KV namespace once:
npx wrangler kv namespace create TELEMETRY_DEDUPE
# Put the id into wrangler.toml (DEDUPE_KV id / preview_id)

npx wrangler secret put GITHUB_TOKEN   # fine-grained, issues:write
npx wrangler secret put FLUSH_TOKEN    # long random
# Optional: set AUTO_OPEN_ISSUES=true in dashboard when ready

npx wrangler deploy
```

Point the app at the Worker:

1. Production: set `TELEMETRY_WORKER_URL` in `src/telemetry/config.ts` to the
   custom domain (keep `workers_dev = false`).
2. Device tests: AsyncStorage override  
   `kalsa.telemetry.url = http://<lan-host>:8787` (or staging URL).

Unset / empty `TELEMETRY_WORKER_URL` → client silently disables network send.

## Staging

Deploy to a separate Worker name / account. Use a test repo for `GITHUB_REPO`
until the first real flush on `Aspis0/kalsa`.

## Flush

```bash
# Via Worker (preferred)
FLUSH_TOKEN=… TELEMETRY_WORKER_URL=https://telemetry.example.com \
  node workers/telemetry/flush.mjs

# Or curl
curl -H "Authorization: Bearer $FLUSH_TOKEN" "$TELEMETRY_WORKER_URL/flush"
```

## Schema notes (diag-addendum)

`error.detail` is per-code enum; `error.signal` is allowlisted token only
(max 80, charset `[A-Za-z0-9_ .-]`). Invalid detail/signal/unknown keys → `400`.
Body > 4KB → `413`.

## Privacy

- No payload logs (signature prefix + counts only).
- Cloudflare may retain connection metadata per their policy; IP is not stored
  in the report body.
