# B3 — Telemetry + model download + share egress privacy

Repo: `/Users/marco/Projects/kalsa`

---

## 1. Telemetry: enable path, sanitizeReport, fields, kill switches

### Enable path

Default **OFF**. Multi-layered opt-in:

- **SettingsScreen.tsx:1191** — `Switch` for telemetry toggle. Calls `setTelemetryEnabled(true/false)`.
- **telemetry.ts:256** — `setTelemetryEnabled(true)`:
  1. Writes `enabled:true` journal → clears tombstone → clears pendingOff + quarantine → releases `tombstoneGate`
  2. Any marker-clear failure rolls back to OFF and keeps gate active (fail-closed)
- **telemetry.ts:210** — `initTelemetry()`: on load, reads tombstone first. If torn/ambiguous → fail-closed OFF. If pendingOff present → fail-closed OFF. Only proceeds to `optedOut=false` when a clean tombstone is absent AND journal is hash-valid.

**Kill switches:**
- Tombstone (dual-slot A/B + pointer, highest-valid-seq wins, torn → fail-closed)
- `PENDING_OFF_KEY` — written before tombstone; survived crashes
- `QUARANTINE_KEY` — written FIRST on OFF; leftover `enabled:true` envelope cannot transmit after restart even if other writes fail
- `tombstoneGate` — in-process boolean, blocks `reportTelemetry` while transition incomplete
- `optedOut` — defaults `true`; only set `false` when tombstone absent + journal valid
- `TELEMETRY_WORKER_URL` — empty string silently disables (config.ts:22)
- Device-test override: `kalsa.telemetry.url` AsyncStorage key

### sanitizeReport (pure.ts:198)

Allowlist-only. **Never accepts free text, stacks, URLs, paths.**

```
Code:       only from REASON_CODES enum ("engine.init" | "chat.generation" | "embed.native" | "web.fetch" | "web.search" | "unknown")
Detail:     only from per-code enum (e.g. "oom", "dns", "timeout") — anything else is omitted
Signal:     extracted via extractSignal() → allowlist regexes → charset [A-Za-z0-9_ .-] ≤80 chars
AppVersion: regex-validated (^\d+(\.\d+){1,3}[a-z0-9.-]*$)
Platform:   hardcoded "android"
DeviceBucket: only "low"|"mid"|"high"
OsMajor:    digits only, ≤8 chars
ModelCategory: only "dense.2b"|"dense.4b"|"moe"|"unknown"
MemoryClass: only "lt-4gb"|"4-6gb"|"ge-6gb"|"unknown"
Phase:      only "download"|"load"|"turn"|"embed"|"flush"
```

### Fields that leave device

```json
{
  "v": 1,
  "app": "kalsa",
  "appVersion": "x.y.z",
  "platform": "android",
  "deviceBucket": "low|mid|high",
  "osMajor": "14",
  "error": { "code": "engine.init", "detail": "oom", "signal": "ENOMEM" },
  "context": { "modelCategory": "dense.4b", "memoryClass": "4-6gb", "hadWebTools": true, "phase": "load", "attempt": 1, "chunks": 0 },
  "dateBucket": "2026-09-04",
  "manual": false
}
```

**No chat content. No document text. No URLs. No file paths. No API keys. No stacks. No user strings.**

### Kill switches summary

| Mechanism | Location | Effect |
|-----------|----------|--------|
| Tombstone (dual-slot) | `pure.ts:266` | Durable OFF proof; torn → fail-closed |
| pendingOff | `config.ts:55` | Written before tombstone; survives crash |
| quarantine | `config.ts:58` | Written FIRST on OFF; blocks leftover envelope |
| tombstoneGate | `telemetry.ts:31` | In-process gate during transition |
| optedOut | `telemetry.ts:32` | Default `true`; only `false` when load proves OFF absent |
| TELEMETRY_WORKER_URL | `config.ts:22` | Empty string = silent disable |
| BODY_SOFT_LIMIT_BYTES | `config.ts:68` | 4KB cap on outbound JSON body |
| QUEUE_CAP | `config.ts:54` | Max 50 queued items |

---

## 2. ModelDownloader: URLs, user content upload

### URLs

**ModelDownloader.ts:81** — `hfFileUrl()`:
```
https://huggingface.co/{owner}/{repo}/resolve/{revision}/{file}
```

All URLs are **pinned to a SHA revision** in the model registry (`ModelRegistry.ts`). No mutable refs. No LFS redirects at runtime.

**Registry URLs (ModelRegistry.ts):**
| Model | Repo | Revision |
|-------|------|----------|
| qwen3.5-4b | `unsloth/Qwen3.5-4B-MTP-GGUF` | `86835bf9...` |
| qwen3.5-4b-mmproj | `unsloth/Qwen3.5-4B-GGUF` | `e87f1764...` |
| gemma-4-e2b | `unsloth/gemma-4-E2B-it-GGUF` | `0314792d...` |
| qwen3.5-2b | `unsloth/Qwen3.5-2B-GGUF` | `f6d5376b...` |
| lfm2.5-2.6b | `LiquidAI/LFM2.5-2.6B-GGUF` | `f4a289c8...` |
| lfm2.5-8b-a1b | `LiquidAI/LFM2.5-8B-A1B-GGUF` | `dfd5fdca...` |
| lfm2.5-8b-a1b-kexp | `LiquidAI/LFM2.5-8B-A1B-GGUF` | `dfd5fdca...` |
| whisper-tiny | `ggerganov/whisper.cpp` | `5359861c...` |
| e5-small | `keisuke-miyako/multilingual-e5-small-gguf-q8_0` | `e1da9446...` |

**Unpublished artifact guard:** `modelHost.ts:10` — `KALSA_HF_ORG` is `null`. When a model has `hfArtifactRepo` set (only `lfm2.5-8b-a1b-kexp`), `resolveModelArtifact()` returns `status:"unpublished"` → `UnpublishedArtifactError` thrown before any network call. No fallback to upstream.

### User content uploaded?

**No.** `downloadFile()` (ModelDownloader.ts:162) issues `FileSystem.createDownloadResumable()` — an HTTP GET to HuggingFace. The request body is empty. No user text, no chat history, no documents, no API keys are sent. The only data leaving the device is the HTTP request headers (standard UA, TLS fingerprint).

---

## 3. expo-sharing / Linking.openURL — can chat/docs leak without user intent?

### Share (user-initiated only)

**AiChatPage.tsx:2924** — `exportChat()`:
```typescript
Share.share({ message: markdown, title: t("chat.exportTitle") })
```
This is the React Native `Share` API — opens the Android share sheet. **User must tap Export and choose a destination.** No automatic upload.

**AiChatPage.tsx:3363** — `Share.share({ message: value })` — copy single message to share sheet. User-initiated.

**AiChatPage.tsx:4929** — `Share.share({ message: content })` — share attachment. User-initiated.

### Linking.openURL

**SettingsScreen.tsx:1543** — `Linking.openURL(GITHUB_ISSUE_CHOOSE_URL)` — opens `https://github.com/Aspis0/kalsa/issues/new/choose`. User taps "Report Problem" → "Open GitHub". **User-initiated.**

**AiChatPage.tsx:5426** — `Linking.openURL(rawUrl)` — opens URLs the model found in search results. User taps a source card. **User-initiated.**

**AiChatPage.tsx:5563/5621** — `Linking.openURL(img.url)` / `Linking.openURL(dl.url)` — opens images/documents the model cited. User-initiated.

### shareIntent.ts (incoming only)

**shareIntent.ts:14** — `parseShareUrl()` parses `kalsa://share?text=...` deep links. This is **inbound** — the app receives content from other apps via the Android share sheet. The `SHARE_TEXT_CAP` is 20k chars. No data leaves the device on this path.

### Verdict

**No automatic egress.** Every Share/Linking call requires explicit user tap. No background sharing. No "share on send". No analytics SDK auto-sharing.

---

## 4. Any other non-tool network?

### Search providers (user-initiated, via tool call)

When the model invokes `web_search`, the query string is sent to a third-party API:

| Provider | Endpoint | Auth | Query sent |
|----------|----------|------|------------|
| Exa MCP (free) | `https://mcp.exa.ai/mcp` | None (per-IP) | `query` |
| Exa API | `https://api.exa.ai/search` | `x-api-key` header | `query` |
| Brave | `https://api.search.brave.com/res/v1/web/search` | `X-Subscription-Token` | `query` |
| Tavily | `https://api.tavily.com/search` | `Bearer` token | `query` |

**The search query is model-generated text, not raw user chat.** The model formulates a search query from the user's question — the query may contain keywords or rephrased concepts from the conversation. The user's full chat history is never sent. The search query is whatever the local model chose to search for.

**Fallback:** If the active provider fails, `searchWeb()` falls back to free Exa MCP automatically (search/index.ts:82).

### Web fetch (user-initiated, via tool call)

When the model invokes `web_fetch`, the URL is fetched from a publicly routable HTTP(S) endpoint. The request is a standard GET with no body containing user data. The URL must be on a per-turn allowlist seeded from search results and user-provided links.

**Privacy gate (webFetchTool.ts):** `isPubliclyRoutableHttpUrl()` blocks private IPs, IPv6 literals, backslash authority, non-ASCII, and localhost. Redirects are re-validated: final URL must be publicly routable and same-host or allowlisted.

### Telemetry Worker

**config.ts:22:** `https://kalsa-telemetry.aspislauncher.workers.dev`
- Only reachable when telemetry is ON (default OFF)
- Only sends the sanitized report (§1 above)
- No user content, no chat, no URLs

### No other network

- **No expo-updates** — not in dependencies, not imported anywhere
- **No OTA updates** — no `Updates.checkForUpdate`, no `Updates.reloadAsync`
- **No analytics SDK** — no Sentry, no Amplitude, no Firebase Analytics
- **No push notification registration** — `expo-notifications` is imported in AppShell but only for local notifications (`setNotificationHandler`), not `registerForPushNotificationsAsync`
- **No crash reporting** — no Crashlytics, no Bugsnag
- **No config fetch** — no remote config, no feature flags server
- **WhisperService** — on-device ASR, no network calls (whisper.rn runs locally)
- **TtsService** — on-device TTS via expo-speech, no network calls

---

## 5. Gaps / hardening patches

### Gap: Search queries leak conversation-derived text to third parties

The `web_search` tool sends the model-generated query to Exa/Brave/Tavily. The query is derived from the user's question and may contain sensitive keywords. This is the **primary non-telemetry egress path** for user-adjacent content.

**Severity:** Medium. The query is model-interpreted, not raw user text. But a model might search for `"how to treat ${USER_CONDITION}"` verbatim.

**Mitigation options:**
- Document this in privacy policy
- Add a client-side filter that strips obviously PII patterns from search queries before sending
- Make search explicitly user-confirmed (tap to search, not auto-search)

### Gap: No dedicated sanitizeReport test suite

`pure.ts` exports `sanitizeReport`, `extractSignal`, `acceptSignal`, `classifyHttpStatus`, `classifyNetworkFailure`, `classifyEngineInitFailure`, `classifyChatFailure`, `classifyEmbedFailure` — but there is **no `src/telemetry/pure.test.ts`**.

The only telemetry-related tests are:
- `ciswireFlagsTelemetry.test.ts` — tests ciswire flags omission in formatTelemetryLine
- `memoryTelemetryOrdering.test.ts` — tests extract ordering

**Missing test coverage:**
- `sanitizeReport` with free-text detail (should be omitted)
- `sanitizeReport` with URL in detail (should be omitted)
- `sanitizeReport` with stack trace in rawMessage (signal extraction should not leak it)
- `extractSignal` with path-containing messages (should extract only ENOSPC etc.)
- `extractSignal` with URL-heavy messages (should return undefined)
- `acceptSignal` with malicious tokens (should reject)
- `classifyHttpStatus` boundary cases
- `classifyNetworkFailure` with mixed error messages
- Queue ops: `enqueueCapped`, `expungeDead`, `finalizeItemOutcome`
- Integrity: `withIntegrity`, `verifyEnvelopeIntegrity`, tombstone verification

### Gap: No tests for the dual-slot journal corruption recovery

The dual-slot journal (A/B + pointer + highest-valid-seq) is complex and critical for fail-closed behavior. No test exercises torn slot recovery, pointer mismatch, or seq comparison logic.

### Patch set (contained)

1. **Create `src/telemetry/pure.test.ts`** — unit tests for `sanitizeReport`, `extractSignal`, `acceptSignal`, `classify*` functions. Target: 20+ cases covering free-text rejection, URL stripping, charset enforcement, boundary values.

2. **Create `src/telemetry/journal.test.ts`** — integration tests for dual-slot read/write, tombstone verification, `selectJournalSlot`/`selectTombstoneSlot` with torn/corrupt slots.

3. **Add `SIGNAL_PATTERNS` negative tests** — verify that messages containing file paths, URLs, email addresses, JWTs, and API keys all produce `undefined` signal (not leaked).

---

## 6. Tests covering sanitizer — missing cases

### Existing tests

| File | What it tests |
|------|---------------|
| `ciswireFlagsTelemetry.test.ts` | ciswire flags omission in formatters |
| `memoryTelemetryOrdering.test.ts` | extract ordering, snapshot vs reset |
| `ModelDownloader.test.ts` | unpublished artifact guard, URL pinning |

### Missing sanitizer cases

| Case | Expected | Why it matters |
|------|----------|----------------|
| `sanitizeReport({code:"chat.generation", detail:"file:///data/user/0/..."})` | detail omitted | Path in detail field |
| `sanitizeReport({code:"web.fetch", detail:"http://evil.com"})` | detail omitted | URL in detail field |
| `sanitizeReport({rawMessage:"Error at /app/src/telemetry.ts:42"})` | signal=undefined or ENOSPC-like | Path in rawMessage |
| `extractSignal("https://api.example.com/key=sk_live_abc123")` | undefined | URL + API key |
| `extractSignal("user@example.com sent ENOSPC")` | "ENOSPC" | Email alongside valid signal |
| `extractSignal("Segmentation fault in /data/app/...")` | "segmentation fault" | Path after valid signal |
| `acceptSignal("../../../etc/passwd")` | undefined | Path traversal attempt |
| `acceptSignal("<script>alert(1)</script>")` | undefined | XSS attempt |
| `acceptSignal("")` | undefined | Empty string |
| `acceptSignal("A".repeat(81))` | undefined | Over-length signal |
| `classifyNetworkFailure("ECONNREFUSED 127.0.0.1:8080")` | "dns" or "unknown" | Localhost in error |
| `classifyEngineInitFailure("model.gguf: no space left on device")` | "disk_full" | Realistic error |
| `finalizeItemOutcome` with generation mismatch | action:"drop" | Stale generation |
| `enqueueCapped` at cap+1 | drops oldest | Queue cap enforcement |
| `selectJournalSlot` with both slots corrupt | null | Fail-closed |

---

## Verdict

### Already solid

- **Telemetry design is production-grade.** Dual-slot journal, tombstone, quarantine, pendingOff, fail-closed defaults, integrity hashing, allowlist-only sanitizer. This is not "we never send chat" — it's provably structured to prevent it.
- **Model download is pure GET.** Pinned revisions, no user content uploaded, unpublished artifact guard.
- **Share/Linking is user-initiated.** No background egress, no analytics SDK, no auto-share.
- **No hidden network.** No expo-updates, no analytics, no crash reporting, no config fetch.

### Gaps

- **Search queries to third parties** — the only real privacy exposure. Model-interpreted, not raw chat, but PII could leak through query formulation.
- **No `pure.test.ts`** — the sanitizer is the most security-critical function in the telemetry stack and has zero direct test coverage.

### Overall

**Already solid** on the telemetry/download/share front. The two gaps (search query egress, missing sanitizer tests) are real but contained — neither involves automatic or silent egress of user content.
