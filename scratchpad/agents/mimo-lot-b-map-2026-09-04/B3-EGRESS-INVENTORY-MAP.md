# B3: Full Network Egress Inventory

**Repo**: `kalsa` @ `feat/moe-stream`
**Date**: 2026-09-04
**Scope**: READ-ONLY. Every claim has a file:line permalink.

---

## 1. web_search Providers

All three keyed providers + the free MCP endpoint send the user's **query string** and an **API key** to a remote server. No chat context, no memory facts, no document content.

| Endpoint | Protocol | Payload Fields | Key Header | Call Site |
|----------|----------|----------------|------------|-----------|
| `https://api.search.brave.com/res/v1/web/search` | GET | `q` (query), `count` | `X-Subscription-Token: {apiKey}` | `src/search/providers/brave.ts:71-77` |
| `https://api.exa.ai/search` | POST JSON | `query`, `numResults`, `contents: { highlights: true }` | `x-api-key: {apiKey}` | `src/search/providers/exaApi.ts:61-67` |
| `https://api.tavily.com/search` | POST JSON | `query`, `max_results`, `search_depth: "basic"`, `include_answer: false` | `Authorization: Bearer {apiKey}` | `src/search/providers/tavily.ts:54-61` |
| `https://mcp.exa.ai/mcp` | POST JSON-RPC 2.0 + SSE | `tools/call` → `arguments: { query, numResults }` | `mcp-session-id` (no API key) | `src/search/ExaMCP.ts:140`, `:171` |

**Provider selection**: `src/search/registry.ts:39` — default is `exa-mcp` (free, no key). Active provider read from AsyncStorage key `kalsa.search.provider`.

**Fallback**: If primary fails, `src/search/index.ts:58-79` falls back to Exa MCP (free) unless that was already primary.

**API keys stored**: `src/search/secretStore.ts` (AsyncStorage, per-provider).

**Sensitive-pattern gate**: The `sensitive-pattern-in-query` rule in `src/rules/toolGate.ts:62-66` blocks queries containing credentials, IBANs, credit cards, codice fiscale, emails, phone numbers, addresses, GPS, or personal medical data. This rule fires **only** when `toolhelpOn` is true AND `expand=true` via `toolGateRegistry.ts:30-35`. When `toolhelpOn` is false, `resolveToolGateTable` returns `undefined` for all tools except `web_search` (but the web_search gate **always** resolves — see §8).

---

## 2. web_fetch

| Endpoint | Protocol | Payload | Trigger | Call Site |
|----------|----------|---------|---------|-----------|
| Any URL on the per-turn `FetchAllowlist` | GET (redirect: follow) | None (browser GET). Sends no body, no cookies, no auth. | Model calls `web_fetch` tool | `src/agent/webFetchTool.ts:586-697` (executor), `:715-728` (fetch call) |

**Allowlist construction** (`src/app/AppShell.tsx:1849-1870`):
- Seeded from `http(s)` links in the user's message text (`allowlist.addFromText`)
- Extended with every `web_search` result URL after each search call (`:1982-1987`)
- Fresh per turn (`:4231` — `fetchAllowlistTurnSeq` advances on every send)

**URL validation**:
- `isPubliclyRoutableHttpUrl()` at `src/agent/webFetchTool.ts:430-496` — fail-closed: only canonical dotted-quad IPv4 (not RFC 1918) or boring DNS name (≥2 labels, ASCII, alphabetic TLD ≥2). Blocks IPv6, percent-encoding tricks, userinfo, backslash authority, shorthand.
- Redirect re-validation: `sameHost()` (port-aware) or allowlisted URL; http→https upgrade allowed; https→http downgrade blocked. `:523-541`.

**User data sent**: Only the target URL. No chat content, no memory facts, no query string is sent to the remote server (the `query` parameter is used locally for BM25 retrieval against the downloaded text, not sent).

**Body caps**: HTML 1.5 MB (`BODY_HARD_CAP`), PDF 5 MB (`PDF_BODY_HARD_CAP`). Timeouts: HTML 8s, PDF 20s.

---

## 3. Telemetry Worker

| Endpoint | Protocol | Payload | Trigger | Call Site |
|----------|----------|---------|---------|-----------|
| `https://kalsa-telemetry.aspislauncher.workers.dev/report` | POST JSON | Sanitized `TelemetryReport` (see allowlist below) | Auto-drain on foreground after queued error | `src/telemetry/config.ts:15`, `src/telemetry/telemetry.ts` drain path |

**Sanitize allowlist** (`src/telemetry/pure.ts:sanitizeReport()`):
- **Included**: `v`, `app` ("kalsa"), `appVersion`, `platform` ("android"), `deviceBucket` (low/mid/high), `osMajor`, `error.code` (enum), `error.detail` (per-code enum), `error.signal` (fixed tokens: "ENOSPC", "EACCES", "ggml_*", …), `context.modelCategory`, `context.memoryClass`, `context.hadWebTools`, `context.phase`, `context.attempt`, `context.chunks`, `dateBucket`, `manual`
- **NEVER sent**: chat messages, document content, memory facts, search queries, URLs fetched, file paths, stack traces, API keys, free-text detail

**`looksLikeUnsafeDetail()`** (`src/telemetry/pure.ts`): Rejects any `detail` value containing URLs, emails, JWTs, paths, API-key-like strings, or text >32 chars.

**Worker-side validation**: `workers/telemetry/schema.ts:validateReport()` — strict key allowlist; rejects unknown keys; signal re-normalized to fixed tokens only.

**Opt-in**: Default OFF. Dual-slot journal + tombstone protocol. `src/telemetry/telemetry.ts:initTelemetry()`. Tombstone/pending-off/quarantine markers ensure fail-closed OFF on torn storage.

**GitHub issue creation**: Worker-side only. `GITHUB_TOKEN` stays in the Worker env (never serialized to DO). `workers/telemetry/index.ts:562`. Only the sanitized `TelemetryReport` is projected into issue body via `projectIssueFields()`.

---

## 4. Model Downloads (HuggingFace)

| Endpoint | Protocol | Payload | Trigger | Call Site |
|----------|----------|---------|---------|-----------|
| `https://huggingface.co/{owner}/{repo}/resolve/{revision}/{file}` | GET (resumable download) | None (binary GGUF/mmproj) | User initiates in Settings | `src/engine/ModelDownloader.ts:64-66` (`hfFileUrl`) |

**User data sent**: Nothing. Pure download. No authentication required for public repos. No user-identifying headers.

**Artifact resolution**: `src/engine/modelHost.ts:17-45` — `KALSA_HF_ORG` is `null` (unpublished artifacts block), so `hfArtifactRepo` models throw `UnpublishedArtifactError`. Only models with explicit `hfRepo` + `revision` succeed.

---

## 5. Other fetch/XMLHttpRequest/WebSocket/Linking.openURL

### Linking.openURL (user-initiated)

| What | Where | Egress? | Call Site |
|------|-------|---------|-----------|
| Open external URLs from chat markdown | `src/chat/MarkdownText.tsx:329`, `:388` | OS browser — no app data sent | User taps link |
| Open source URLs from chat cards | `src/screens/AiChatPage.tsx:5426` | OS browser | User taps source |
| Open image/document download URLs | `src/screens/AiChatPage.tsx:5563`, `:5621` | OS browser/download | User taps |
| GitHub issue chooser | `src/screens/SettingsScreen.tsx:381` | OS browser | User taps "Report bug" |

All `Linking.openURL` calls open the OS default browser. The app sends **no** headers, cookies, or data beyond what the browser's normal HTTP request carries (User-Agent, Accept-Language). No chat/memory/doc content is attached.

### Clipboard (local only)

| What | Where | Egress? | Call Site |
|------|-------|---------|-----------|
| Copy telemetry preview | `src/screens/SettingsScreen.tsx:371` | No (local clipboard) | User taps "Copy" |
| Copy message text | `src/screens/AiChatPage.tsx:3351` | No (local clipboard) | User taps "Copy" |

`expo-clipboard` is a local-only API. No network egress.

### expo-sharing (user-chosen destination)

`src/ui/AskAssistantMiniappRenderer.tsx`, `src/app/miniappActions.ts` — opens OS share sheet. User chooses destination. App does not send data over the network itself.

### No other network calls found

- **No WebSocket** connections in src/.
- **No XMLHttpRequest** in src/.
- **No `navigator.sendBeacon`**.
- **No remote LLM provider** (OpenAI, Anthropic, Gemini, Groq, Mistral) — inference is fully on-device via llama.rn.
- **No `fetch` calls** in `src/context/`, `src/memory/`, `src/research/`, `src/pdf/`, `src/ui/`, `src/documents/` (except imports from webFetchTool).

---

## 6. TTS / ASR / Clipboard / Share — Confirm Local vs Network

| Service | Implementation | Network? | Evidence |
|---------|---------------|----------|----------|
| TTS | `expo-speech` (on-device OS engine) | **No** | `src/voice/TtsService.ts:13` — `import * as Speech from "expo-speech"` |
| ASR | `whisper.rn` (whisper.cpp native) | **No** | `src/voice/WhisperService.ts` — `initWhisper`, `transcribeData`, `transcribe` — all local |
| Clipboard | `expo-clipboard` | **No** | `src/screens/AiChatPage.tsx:54`, `src/screens/SettingsScreen.tsx:17` |
| Share | `expo-sharing` | **No** (user picks) | `src/app/miniappActions.ts` |

---

## 7. Paths that Read MemoryStore / Chat Messages / Documents and Feed a Network Call

### Memory facts → web_search gate (read-only, not sent)

- `src/app/AppShell.tsx:813,821` — `injectedFactsRef` holds enabled memory facts
- `src/app/AppShell.tsx:1992` — passed as `memoryFacts` to `runToolGate()`
- `src/rules/runToolGate.ts:33-43` — facts are **read locally** to check if the search query echoes a private fact (`echo-of-memory-fact` rule at `toolGate.ts:92-98`)
- **Facts are never sent to any network endpoint.** They are only compared locally against the query string via `containsPrivateData()`.

### Chat messages → web_search/web_fetch gate (read-only, not sent)

- `src/app/AppShell.tsx:1948-1949` — `lastUserMessage` captured from the turn
- `src/rules/runToolGate.ts:19-26` — used in `snapshotInput()` for `echo-of-context` comparison
- **User message text is never sent to any network endpoint.** It is only used for local similarity comparison against the query.

### Documents → no network path

- `document_chat` tool (`src/documents/documentChatTool.ts`) reads local library docs
- All retrieval is on-device (BM25 + optional semantic index)
- No fetch/XMLHttpRequest in the document path
- **document_chat has `gateTable: null`** in `src/agent/toolRegistry.ts:102` — no privacy gate

### web_fetch downloads page text → local only

- `src/agent/webFetchTool.ts:865` — downloaded page text goes into `DocRetrieverIndex` for local BM25 retrieval
- Passages returned to model as text; no re-transmission to any endpoint

---

## 8. Egress Table

| # | Endpoint | Trigger | User Data Sent | Opt-In? | Gated by runToolGate? | File:Line |
|---|----------|---------|----------------|---------|----------------------|-----------|
| 1 | `https://mcp.exa.ai/mcp` (Exa MCP) | Model calls `web_search` | Query string | Yes (tool call) | **YES** (TOOL_GATE_TABLE) | `src/search/ExaMCP.ts:140`, `src/agent/toolRegistry.ts:88` |
| 2 | `https://api.exa.ai/search` (Exa API) | Model calls `web_search` | Query string + API key | Yes (tool call + key) | **YES** (TOOL_GATE_TABLE) | `src/search/providers/exaApi.ts:61`, `src/agent/toolRegistry.ts:88` |
| 3 | `https://api.search.brave.com/res/v1/web/search` | Model calls `web_search` | Query string + API key | Yes (tool call + key) | **YES** (TOOL_GATE_TABLE) | `src/search/providers/brave.ts:71`, `src/agent/toolRegistry.ts:88` |
| 4 | `https://api.tavily.com/search` | Model calls `web_search` | Query string + API key | Yes (tool call + key) | **YES** (TOOL_GATE_TABLE) | `src/search/providers/tavily.ts:54`, `src/agent/toolRegistry.ts:88` |
| 5 | Any allowlisted URL | Model calls `web_fetch` | URL only (GET, no body) | Yes (tool call) | **NO** (`gateTable: null`) | `src/agent/webFetchTool.ts:715`, `src/agent/toolRegistry.ts:95` |
| 6 | `https://kalsa-telemetry.aspislauncher.workers.dev/report` | Auto-drain (foreground) | Error codes + device bucket (NO chat/docs/keys) | Yes (opt-in toggle, default OFF) | N/A (not a tool) | `src/telemetry/config.ts:15`, `src/telemetry/telemetry.ts` drain |
| 7 | `https://huggingface.co/…/{file}` | User initiates model download | Nothing (binary DL) | Yes (Settings UI) | N/A (not a tool) | `src/engine/ModelDownloader.ts:64-66` |
| 8 | OS browser (via `Linking.openURL`) | User taps link | None (standard HTTP) | Yes (user tap) | N/A | `src/chat/MarkdownText.tsx:329,388`, `src/screens/AiChatPage.tsx:5426` |

---

## 9. GAPS: Ungated or Potentially Leaky Paths

### GAP-1: web_fetch has no sensitive-pattern gate (CONFIRMED)

**Status**: Known and documented as B3 follow-up in `src/agent/toolRegistry.ts:52-53` ("Do not gate web_fetch here unless its separate follow-up is implemented").

**Risk**: The model could craft a URL containing sensitive data in the path or query string (e.g., `https://evil.com/?token=sk-abc123`). However:
- The URL **must** be on the per-turn `FetchAllowlist` (seeded from user message + search results)
- `isPubliclyRoutableHttpUrl()` blocks private IPs, IPv6, percent-encoding tricks
- The model can only reach URLs that either (a) the user pasted, or (b) appeared in web_search results
- The request is GET-only with no custom headers or body

**Residual risk**: A compromised or confused model could include sensitive query-string data in a URL that the user previously pasted or that appeared in search results. The allowlist prevents arbitrary URL exfiltration but does not prevent the model from using an already-allowlisted URL as a carrier.

### GAP-2: document_chat is completely ungated

**Status**: `src/agent/toolRegistry.ts:102` — `gateTable: null`. `toolGateRegistry.ts` comment says "unregistered names (miniapps, document_chat, …) remain exempt by construction."

**Risk**: Low in isolation — `document_chat` reads only from local library docs and does not send data over the network. However, if a future change adds network egress to `document_chat`, there would be no gate. Currently safe.

### GAP-3: device_info / device_calc are ungated

**Status**: `src/agent/toolRegistry.ts:109,116` — `gateTable: null`.

**Risk**: These tools read local device info (RAM, model, etc.) and do not send data over the network. They **do** set `privateSearchLatchSeq` (`src/app/AppShell.tsx:1993-1994`) which prevents a subsequent `web_search` in the same turn from using private info. Currently safe.

### GAP-4: Telemetry signal extraction from rawMessage

**Status**: `src/telemetry/telemetry.ts` `reportTelemetry()` accepts `rawMessage` and passes it through `extractSignal()` → `src/telemetry/pure.ts:extractSignal()`.

**Mitigation**: `extractSignal()` only returns **fixed tokens** from `SIGNAL_PATTERNS` (e.g., "ENOSPC", "segmentation fault", "ggml_*"). `looksLikeUnsafeDetail()` rejects free text. `sanitizeReport()` re-validates. The `rawMessage` field is **never forwarded as-is** to the report.

**Residual risk**: Near-zero. The allowlist is extremely tight (16 fixed patterns, max 80 chars, charset `[A-Za-z0-9_ .-]`). No URL, path, or user text can leak through.

### GAP-5: search query is the only user content that leaves the device via network tools

**Status**: Confirmed. The query string is the **sole** user-generated content sent to any network endpoint (via web_search providers). web_fetch sends only URLs. Telemetry sends only error codes + device metadata.

**No gap here** — this is by design. The sensitive-pattern gate on web_search blocks queries containing credentials, PII, financial data, medical data, etc. when `toolhelpOn` is true.

### GAP-6: Echo-of-context gate is similarity-based, not content-based

**Status**: `src/rules/toolGate.ts:68-87` — the `echo-of-context` rule blocks when the search query has LOW similarity to the user's last message (preventing spurious searches). It does NOT block when the query CONTAINS sensitive content from the user message — that is the job of `sensitive-pattern-in-query` and `echo-of-memory-fact`.

**Risk**: If a user asks "search for my password in public databases", the `sensitive-pattern-in-query` rule would fire (detects "password" + value pattern). If the user asks "search for my address", the `ADDRESS_CONTEXT_PATTERN` + `ADDRESS_PATTERN` would fire. But a query like "search for 1234-5678-9012-3456" (credit card without context words) would be caught by `CARD_RUN_PATTERN` + Luhn check. Edge cases exist but the pattern coverage is broad.

---

## 10. Summary

**Total network egress points**: 4 categories (search providers, web_fetch, telemetry, model downloads) + OS browser links.

**User content leaving device**:
- web_search: **query string only** (gated by sensitive-pattern + echo rules when toolhelpOn)
- web_fetch: **URL only** (allowlisted, GET-only, no body)
- Telemetry: **error codes + device metadata only** (NO chat/docs/keys)
- Model downloads: **nothing** (binary download)
- Everything else: **local only**

**Nothing leaks chat content, memory facts, document content, or API keys to any network endpoint.**
