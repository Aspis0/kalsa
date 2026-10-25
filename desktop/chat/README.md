# Crescent Chat

A calm desktop chat client for one person. Talks to this computer's own
server over its OpenAI-compatible API (`POST /v1/chat/completions`,
`stream: true`), stores chats locally. During the alpha, the Rust backend sends technical error
reports to telemetry.kalsa.io by default; turn them off in Settings. Reports
include which AI, processor, graphics card and memory use, never chats or text.

- **Stack**: Vite + React + TypeScript. No Node APIs in the frontend, so the
  `dist/` bundle drops into the parent app's Tauri v2 configuration
  (`../src-tauri/tauri.conf.json`).
- **Network**: the renderer talks to this computer's own server. Web search
  and page fetching send search words or page addresses through the Rust
  backend. Error telemetry also uses Rust, without adding its endpoint to
  the renderer CSP. System fonts only, no CDN.
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
- `node scripts/csp-consistency.mjs` — the page's CSP and Tauri's must allow the
  same local origins (exit 1 when they drift)
- `node scripts/command-contract.mjs` — literal `brain_...` command names in
  frontend source must have a matching Tauri handler; registered-only handlers
  are reported, and event-shaped literals are called out separately.
- `node scripts/press-family-contract.mjs` — the codes a press that never went
  is, read from the Rust source and from the page's own function: the two lists
  must be the same list, or a refusal tells the model that a request it never
  sent was settled.
- `node scripts/browser-failure-log.mjs` — the fixed codes a failed browser call
  writes to the `ui:` log line, and that no address, argument or error text
  reaches it
- `node scripts/browser-fresh-read.mjs` — explicit reads and finds refresh the
  page while action deduplication and the browser step bound stay enforced.
- `node scripts/mail-notice.mjs` — the mail page's notice: which sentence it
  shows for an AI that may not read mail, decided from the AI options this
  computer offers
- `node scripts/context-prune.mjs` — the turns the fit leaves behind: the count
  is turns and not messages, the row appears only when a turn went, all five
  languages carry the sentence, and the count reaches the wire as zero tokens
- `node scripts/palette.mjs` — oklch derivation of the accent scale (not verification)

## Palette

Green family, derived in oklch (same hue, lightness steps only).
Verification: `node scripts/contrast-dom.mjs` — all pairs AA.
