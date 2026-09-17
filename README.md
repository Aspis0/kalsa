# Crescent Chat

A calm desktop chat client for one person. Talks to an OpenAI-compatible
endpoint (`POST /v1/chat/completions`, `stream: true`), stores everything
locally, phones home to nobody.

- **Stack**: Vite + React + TypeScript. No Node APIs in the frontend, so the
  `dist/` bundle drops into Tauri v2 (`src-tauri/tauri.conf.json` included).
- **Offline rule**: the only network call the app ever makes is the
  user-configured endpoint. System fonts only, no CDN, no telemetry.
  Model images are never loaded (a blocked-image notice is shown instead),
  and a CSP meta tag pins this down (`img-src 'self'`).
- **Endpoint note**: because the app is a web view, the server must allow the
  browser origin (CORS: `Access-Control-Allow-Origin` + preflight for
  `content-type, authorization`). The mock in `scripts/mock-server.mjs` shows
  the headers.
- **Layout**: the crescent switches between six surfaces (Chat, Models,
  Server, Devices, Advanced, Settings). Conversations live in a sidebar
  grouped by recency, with ⌘K search, rename and two-step delete.
- **Storage**: an index of capped metadata plus one key per conversation;
  lists and search never touch message payloads
  (`src/lib/store.ts` is the only module that knows).

## Scripts

- `npm run dev` — frontend on http://localhost:5173
- `npm run build` — typecheck + production bundle
- `node scripts/mock-server.mjs` — fake endpoint on 127.0.0.1:18081
  (`/ok/...` streams incl. hard cases, `/denied/...` 401, `/forbidden/...` 403)
- `node scripts/shots.mjs [name ...]` — screenshot driver, fail-loud markers
- `node scripts/verify.mjs [test ...]` — functional assertions (exit 1 on failure)
- `node scripts/contrast-dom.mjs` — WCAG contrast from computed DOM styles
- `node scripts/palette.mjs` — oklch derivation of the accent scale (not verification)

## Palette

Green family, derived in oklch (same hue, lightness steps only).
Verification: `node scripts/contrast-dom.mjs` — all pairs AA.
