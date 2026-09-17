# Crescent Chat

A calm desktop chat client for one person. Talks to an OpenAI-compatible
endpoint (`POST /v1/chat/completions`, `stream: true`), stores everything
locally, phones home to nobody.

- **Stack**: Vite + React + TypeScript. No Node APIs in the frontend, so the
  `dist/` bundle drops into Tauri v2 (`src-tauri/tauri.conf.json` included).
- **Offline rule**: the only network call the app ever makes is the
  user-configured endpoint. System fonts only, no CDN, no telemetry.
- **Endpoint note**: because the app is a web view, the server must allow the
  browser origin (CORS: `Access-Control-Allow-Origin` + preflight for
  `content-type, authorization`). The mock in `scripts/mock-server.mjs` shows
  the headers.

## Scripts

- `npm run dev` — frontend on http://localhost:5173
- `npm run build` — typecheck + production bundle
- `node scripts/mock-server.mjs` — fake endpoint on 127.0.0.1:18081
  (`/ok/...` streams, `/denied/...` answers 401)
- `node scripts/shots.mjs [name ...]` — screenshot driver (needs dev +
  mock running). Saves into `shots/`.

## Palette

Green family, derived in oklch (same hue, lightness steps only).
Verification: `node scripts/palette.mjs` — all pairs AA, numbers in LOG.md.
