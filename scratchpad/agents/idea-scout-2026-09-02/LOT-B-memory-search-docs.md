# LOT-B: Memory / Search / Documents — Codebase Reconnaissance

**Repo**: `kalsa` (public, React Native / Expo)
**Date**: 2026-09-02
**Scope**: Read-only. Every claim has file:line.

---

## B1. Memory System (CisWire)

### Schema & Storage

- **Backend**: AsyncStorage (no SQLite, no MMKV).
- **Schema**: `MemoryFact = { id: string, text: string, createdAt: number }` — flat array, max 40 facts, max 200 chars/fact.
  - `src/memory/MemoryStore.ts:16-19` (type)
  - `src/memory/MemoryStore.ts:23-24` (MAX_FACTS=40, MAX_TEXT_LEN=200)
- **Keys**: `kalsa.memory.facts` (JSON array), `kalsa.memory.enabled` (opt-in, default OFF).
  - `src/memory/MemoryStore.ts:26-27`
- **In-memory cache**: `factsCache` / `enabledCache` — avoids storage hop every turn.
  - `src/memory/MemoryStore.ts:31-32`

### How Written

- **Extraction**: LLM extracts facts from user messages → `applyExtractResults(add[], remove[], epoch)`.
  - `src/memory/MemoryStore.ts:398-456` — mutex-guarded batch add/remove.
- **Sensitive filter**: `isSensitiveFact()` rejects passwords, IBANs, credit cards, codice fiscale, emails, phones, addresses, GPS, health data. Broad false-positive preference.
  - `src/memory/MemoryStore.ts:121-236`

### How Recalled

- **System prompt injection**: top 10 facts → `buildSystemPrompt(locale, withTools, facts)` appends as untrusted block.
  - `src/engine/memoryPrompt.ts:17-38` (MAX_PROMPT_FACTS=10, MAX_PROMPT_FACT_CHARS=120)
- **User-prefix injection (format B)**: `buildMemoryFactsBlock()` + `applyMemoryFactsToLastUser()` prefixes facts onto the last user message.
  - `src/engine/memoryFactsTail.ts:155-174`
- **DNA bounding**: `boundMemoryFacts()` token-budgets facts before injection.
  - `src/memory/dnaBounding.ts` (imported at `memoryFactsTail.ts:10`)

### Embedding/Vector Component

- **None for memory facts.** Facts are plain text strings, keyword-matched, never embedded. The E5-small embedder (B5) operates on document chunks only, not memory facts.

### FEASIBILITY INPUT

**Contained.** Memory is a self-contained AsyncStorage module with no dependencies beyond pure functions. Adding embedding-based recall for facts would require: (1) deciding whether facts live in the vector index or remain text-only, (2) the existing embedding pipeline targets documents — facts would need a separate corpus entry point. Key coupling: the epoch/mutex pattern in MemoryStore is battle-tested; any new path must use it. Risk: low.

---

## B2. Chat Search

### Current Implementation

- **Search scope**: Titles + `searchBlob` (concatenated lowercased message text, capped at 8000 chars).
  - `src/conversations/ConversationsStore.ts:130-139` — `searchBlobFromMessages()` joins all message texts, lowercases, clips to SEARCH_BLOB_CAP=8000.
  - `src/conversations/ConversationsStore.ts:145-151` — `filterConversations()` delegates to `filterByTokens(list, query, (item) => [item.title, item.searchBlob])`.
- **Search algorithm**: Keyword AND via `filterByTokens()` in `src/util/filterByTokens.ts:13-35`. Tokens <3 chars ignored when longer tokens exist. Pure substring `includes()` match — no fuzzy, no stemming, no TF-IDF.
  - `src/util/filterByTokens.ts:21-33`
- **Where invoked**: `AppShell.tsx:2237` — `filterConversations(conversations.items, chatSearch)`.
- **UI**: `Drawer.tsx:141` — search bar placeholder "Search chats".

### What It Searches

- **Does search message content** (via searchBlob), not just titles. The searchBlob is a 8KB-capped concatenation of all message texts per conversation.
  - `src/conversations/ConversationsStore.ts:130-139`

### What It Does NOT Search

- No other-chat cross-search (the codebase notes "Future: a retrieve-other-chats tool" at `ConversationsStore.ts:10-13`).
- No notes search integration with chat search.
- No fuzzy / semantic search.

### FEASIBILITY INPUT

**Contained.** Chat search is a pure function over ConversationMeta[] with a keyword AND filter. "Search chats should work for stuff inside the chat itself" — it already does via searchBlob. Limitations: 8KB cap truncates long conversations; no cross-chat search exists. Adding cross-chat search is a UI/routing change, not a structural refactor. Risk: low.

---

## B3. Network Egress Points (Privacy-Critical)

### 1. Web Search (opt-in tool call)

| Provider | URL | Payload | File:Line |
|----------|-----|---------|-----------|
| Exa MCP (free) | `https://mcp.exa.ai/mcp` | JSON-RPC: query string, numResults | `src/search/ExaMCP.ts:20,140,171` |
| Exa API (keyed) | `https://api.exa.ai/search` | POST: query, numResults, contents | `src/search/providers/exaApi.ts:14,61` |
| Brave Search | `https://api.search.brave.com/res/v1/web/search` | GET: q, count + API key header | `src/search/providers/brave.ts:13,71` |
| Tavily | `https://api.tavily.com/search` | POST: query, max_results + API key | `src/search/providers/tavily.ts:10,54` |

- **Trigger**: Only when `web_search` tool is called by the model during a turn.
- **Data sent**: User query string + numResults. No chat history, no memory facts, no files.
  - `src/agent/webSearchTool.ts:88-113` — query comes from model args.

### 2. Web Fetch (opt-in tool call)

| Target | Protocol | Payload | File:Line |
|--------|----------|---------|-----------|
| User-specified URL | `GET` (native fetch) | URL from per-turn allowlist only | `src/agent/webFetchTool.ts:685` |

- **Allowlist gate**: URLs must be in `fetchAllowlistTurnSeq` (seeded from user message + search results). Cannot fetch arbitrary URLs.
  - `src/app/AppShell.tsx:1835-1836,1842`
- **Data sent**: Only the URL. No chat content, no memory.
  - `src/agent/webFetchTool.ts:586-697`

### 3. Telemetry (opt-in, fire-and-forget)

| Endpoint | URL | Payload | File:Line |
|----------|-----|---------|-----------|
| Kalsa telemetry worker | `https://kalsa-telemetry.aspislauncher.workers.dev/report` | Sanitized error report (code, detail, device bucket, osMajor, model category — NEVER chat/docs/keys) | `src/telemetry/config.ts:15` (`TELEMETRY_WORKER_URL`), `src/telemetry/telemetry.ts:drainOnce()` ~line 680 |

- **Payload**: Only allowlisted fields — error code, app version, device bucket (low/mid/high), OS major, model category (dense.2b/dense.4b/moe), memory class. Explicitly NO chat content, NO documents, NO API keys, NO URLs, NO paths.
  - `src/telemetry/pure.ts:sanitizeReport()` — allowlist-only sanitizer.
  - `src/telemetry/config.ts:SIGNAL_PATTERNS` — only fixed tokens like "ENOSPC", "segmentation fault".
- **Data never sent**: Chat messages, document content, memory facts, search queries, URLs fetched, file paths, stack traces.
  - `src/telemetry/config.ts` header comment: "No secrets. No GitHub token."
  - `src/telemetry/pure.ts:looksLikeUnsafeDetail()` rejects free text, URLs, emails, JWTs, paths.

### 4. Model Downloads (user-initiated)

| Source | URL | Payload | File:Line |
|--------|-----|---------|-----------|
| HuggingFace | `https://huggingface.co/{owner}/{repo}/resolve/{revision}/{file}` | Binary GGUF/mmproj files | `src/engine/ModelDownloader.ts:64-66` |

- **Trigger**: Only when user explicitly downloads a model in Settings.
- **Data sent**: None (pure download). No user data leaves device.

### 5. TTS (expo-speech, local)

- `expo-speech` uses on-device TTS engine. **No network egress** — purely local.
  - `src/voice/TtsService.ts:15`

### 6. Whisper ASR (whisper.rn, local)

- On-device inference via `whisper.rn`. **No network egress**.
  - `src/voice/WhisperService.ts`, `src/voice/whisperRn.ts`

### 7. Clipboard / ImagePicker / DocumentPicker

- `expo-clipboard`, `expo-image-picker`, `expo-document-picker` — all local APIs. **No network egress**.
  - `src/screens/AiChatPage.tsx:54-57`

### 8. expo-sharing (share sheets)

- `expo-sharing` opens the OS share sheet. The **user** chooses the destination. The app does not send data over network.
  - `src/ui/AskAssistantMiniappRenderer.tsx:6`, `src/app/miniappActions.ts:2`

### Summary of All Egress Points

| # | Egress Point | User Data Sent | User Opt-In? |
|---|-------------|----------------|--------------|
| 1 | Exa MCP search | query string only | Yes (tool call) |
| 2 | Exa/Brave/Tavily search | query string only | Yes (tool call + API key) |
| 3 | Web fetch | URL only (allowlisted) | Yes (tool call) |
| 4 | Telemetry worker | error codes + device metadata only | Yes (opt-in toggle) |
| 5 | HuggingFace model DL | nothing (binary download) | Yes (Settings) |
| 6 | expo-speech TTS | nothing (local) | N/A (local) |
| 7 | expo-sharing | user-chosen destination | Yes (OS share) |

**Nothing leaks chat content, memory facts, document content, or API keys to any network endpoint.**

### FEASIBILITY INPUT

**Contained — privacy architecture is solid.** The memory no-leak constraint is already enforced: `MemoryStore.ts` header says "never leave the device" and there is zero network code in the memory module. Adding password/ID storage to memory does not create egress risk as long as (1) memory facts stay in AsyncStorage, (2) no new network path reads from the facts store. The telemetry sanitizer explicitly rejects free text, URLs, and API keys. Risk: near-zero for the memory→network isolation. Any new tool that sends user data over the network would need to be audited, but the existing gate pattern (`runToolGate` at `AppShell.tsx:1970`) is the choke point.

---

## B4. AI Creating MD / Doc / PDF

### Existing File-Creation Capability

- **Notes**: `NotesStore.ts` creates `.md` files under `documentDirectory/kalsa-notes/`.
  - `src/notes/NotesStore.ts:100-119` — `saveNote(body, id?)` writes markdown files to disk.
  - Notes are **user-authored** (not AI-created in current flow).
- **Miniapp export**: `AskAssistantMiniappRenderer.tsx` supports exporting data as PNG/JPEG/SVG/JSON/CSV via `expo-sharing`.
  - `src/ui/AskAssistantMiniappRenderer.tsx:269-273` (EXPORT_PNG/JPEG/SVG/JSON/CSV)
  - `src/app/miniappActions.ts:2` — uses `expo-sharing`.
- **Document import**: `expo-document-picker` for PDF/TXT import; `expo-sharing` for share-out.
  - `src/screens/DocumentsScreen.tsx:18`

### Markdown Rendering

- **Full markdown parser**: `src/chat/markdown.ts` — dependency-free O(n) parser supporting headings, lists, bold, italic, code, links, citations, horizontal rules.
  - `src/chat/markdown.ts:1-350+`
- **React Native renderer**: `src/chat/MarkdownText.tsx` — renders parsed blocks with theme tokens.
  - `src/chat/MarkdownText.tsx:1-400+`

### PDF Libraries

- **pdfjs-dist** in devDependencies (for text extraction, not generation).
  - `package.json:74` — `"pdfjs-dist": "^3.11.174"` (devDependencies only)
- **No PDF generation library** in `package.json`. No `react-native-pdf`, no `jspdf`, no `@react-native-community/pdf`.

### AI Tool for File Creation

- **No existing `create_file` or `write_note` tool** exposed to the model.
- The model has no tool to create markdown/notes/PDFs. Notes are created via UI only.

### FEASIBILITY INPUT

**Contained — but requires new tool + library.** The markdown parser/renderer already exists (for chat display). Creating AI-generated files would require: (1) a new tool (e.g., `create_note` or `save_file`) in the tool registry, (2) the NotesStore already supports writing `.md` files — it can be called from a tool executor, (3) for PDF generation, a library would need to be added (e.g., a markdown-to-PDF converter). Key coupling: the tool registry pattern is well-established (B6). Risk: low for markdown notes, medium for PDF (new dependency).

---

## B5. Multilingual Embedder (E5-Small) & Vector Store

### Embedding Model

- **Model**: `multilingual-e5-small` (intfloat), Q8_0 quantized, 384 dims, 100+ languages.
  - `src/engine/ModelRegistry.ts:445-461` — `EMBEDDING_MODEL: EmbeddingModelInfo`
- **Runtime**: `llama.rn` second context (`embedding: true`). NOT onnxruntime.
  - `src/engine/EmbeddingService.ts:37` — `import { initLlama } from "llama.rn"`
  - `src/engine/EmbeddingService.ts:437-443` — `initLlama({ model: path, embedding: true, n_ctx: 512 })`
- **Download**: Optional via Settings, same ModelDownloader pipeline as chat models.
  - `src/screens/SettingsScreen.tsx:131` — optional embedding model section.
  - `src/app/AppShell.tsx:4060-4094` — download flow.

### Vector Store

- **In-memory**: `SemanticVectorIndex` class — brute-force cosine over L2-normalized fp32 vectors.
  - `src/documents/semanticIndex.ts:1-400+` — `SemanticVectorIndex` with Map<string, StoredVector>.
- **Persistent sidecar**: Per-document `{docId}.vec.json` files under `kalsa-documents/`.
  - `src/documents/documentStorage.ts:297-366` — `writeVectorIndexFile()` / `readVectorIndexFile()`.
- **No LanceDB, no sqlite-vec, no external vector DB.** Pure in-memory brute-force.
- **Float cap**: 400k floats (~1.6 MB fp32) default cap.
  - `src/documents/semanticIndex.ts:92` — `DEFAULT_SEMANTIC_FLOAT_CAP = 400_000`

### E5 Protocol

- Query prefix: `"query: "` / Document prefix: `"passage: "`
  - `src/documents/semanticIndex.ts:184-199` — `embedQueryPrefix()`, `embedDocPrefix()`
- L2 normalization: defensive on both add and query.
  - `src/documents/semanticIndex.ts:199-215` — `l2Normalize()`

### Where Document/Note Text Is Stored (Corpus)

- **Documents**: PDF/TXT files under `documentDirectory/kalsa-documents/`, text extracted via `pdfTextService.ts` and stored per-page.
  - `src/documents/documentStorage.ts:93-96` — `documentsDir()`
- **Notes**: Markdown files under `documentDirectory/kalsa-notes/`.
  - `src/notes/NotesStore.ts:46-49` — `NOTES_DIR_NAME = "kalsa-notes"`
- **Conversation messages**: AsyncStorage under `kalsa.messages.{conversationId}`.
  - `src/conversations/ConversationsStore.ts:51`

### Current Hybrid Retrieval

- **BM25 + dense → RRF** for document chat.
  - `src/documents/documentChatTool.ts` — `tryHybridRetrieve()` uses both arms.
- **No hybrid for chat messages or notes.** Embedding pipeline targets documents only.

### FEASIBILITY INPUT

**Structural — new corpus entry points needed.** E5-small multilingual embedder already exists and works. The vector index is in-memory brute-force (no LanceDB/sqlite-vec). To support chat/note embedding: (1) conversation messages and notes would need to be chunked and fed through `embedDocumentChunk()`, (2) a per-conversation/per-note vector sidecar (like documents) would be needed, (3) the in-memory index may need to scale (400k float cap may be tight for all chats). Key coupling: the `EmbeddingService.withEmbedder()` pattern handles the native-op lifecycle; new corpus types can reuse it. Risk: medium — the embedding runtime works, but corpus management (chunking, incremental re-embed, storage) for chats/notes is new work.

---

## B6. Tool-Call Infrastructure

### Tool Registry

- **Type**: `EngineTool = { type: "function"; function: { name, description, parameters } }` (OpenAI-compatible schema).
  - `src/engine/LlamaService.ts:533-541`
- **Registration**: Tools array assembled in `AppShell.tsx:1926-1934`:
  ```typescript
  const tools = [
    ...(webToolsEnabled ? [WEB_SEARCH_TOOL, WEB_FETCH_TOOL] : []),
    DOCUMENT_CHAT_TOOL,
    ...(deviceToolsEnabled ? [DEVICE_INFO_TOOL, DEVICE_CALC_TOOL] : []),
    ...(calendarToolsEnabled ? [CALENDAR_AGENDA_TOOL] : []),
  ];
  ```
- **Tool toggle keys**: `kalsa.tools.device` (default ON), `kalsa.tools.calendar` (default OFF).
  - `src/agent/toolToggles.ts:3-4`

### Current Tools

| Tool | File | Description |
|------|------|-------------|
| `web_search` | `src/agent/webSearchTool.ts` | Web search via configurable provider |
| `web_fetch` | `src/agent/webFetchTool.ts` | Fetch URL content (allowlisted) |
| `document_chat` | `src/documents/documentChatTool.ts` | Query local PDF/TXT library |
| `device_info` | `src/agent/deviceTools.ts` | Device info |
| `device_calc` | `src/agent/deviceCalc.ts` | Calculator |
| `calendar_agenda` | `src/agent/calendarTool.ts` | Calendar access |

### Tool Call Round-Trip

1. **Model emits** `tool_calls` (OpenAI format) or fallback `<tool_call>` / `<|tool_call_start|>` markup.
   - `src/engine/toolCallParser.ts:1-250` — `parseFallbackToolCalls()` handles Qwen XML + LFM2.5 Python-call dialects.
   - `src/engine/LlamaService.ts:2987-3030` — structured + fallback parsing.
2. **`executeTool`** dispatches by name:
   - `src/app/AppShell.tsx:1935-2069` — single `executeTool` async function with per-tool dispatch.
3. **Result** returned as `EngineToolResult = { text, sources?, passages?, kind?, strategy? }`.
   - `src/engine/LlamaService.ts:542-560`
4. **Tool result injected** back into conversation as `role: "tool"` message.
   - `src/engine/LlamaService.ts:3044-3122` — tool result formatting and next-round completion.
5. **Tool gate**: `runToolGate()` in AppShell for privacy/safety checks.
   - `src/app/AppShell.tsx:1970`

### Adding a New Tool

**Difficulty: Low.** Steps:
1. Create a new `EngineTool` object (OpenAI function schema).
2. Create an executor function matching `(name, args, signal) => Promise<EngineToolResult>`.
3. Add both to the `tools[]` array in `AppShell.tsx:1926`.
4. Add the dispatch case in `executeTool` at `AppShell.tsx:1935`.
5. (Optional) Add a toggle in `toolToggles.ts` and AsyncStorage key.

The pattern is mechanical — every existing tool follows this exact pattern. No DI framework, no plugin system, no registration ceremony.

### FEASIBILITY INPUT

**Contained — pattern is mechanical.** Adding a new tool (e.g., `create_note`, `memory_search`, `save_file`) requires: (1) define the `EngineTool` schema, (2) implement the executor, (3) wire into AppShell's tools array + executeTool dispatcher. The round-trip is well-tested across 6 existing tools. Key coupling: tool results go through `toolSourceLedger.ts` for citation tracking — new tools that return sources need to participate. Risk: low.

---

## Files Read

| File | Purpose |
|------|---------|
| `package.json` | Dependencies, scripts |
| `src/memory/MemoryStore.ts` | Memory fact storage (AsyncStorage) |
| `src/memory/dnaBounding.ts` | Token-budget bounding for memory injection |
| `src/memory/memoryTelemetry.ts` | Memory telemetry accumulator |
| `src/engine/memoryPrompt.ts` | System prompt builder with memory facts |
| `src/engine/memoryFactsTail.ts` | User-prefix injection (format B) |
| `src/conversations/ConversationsStore.ts` | Conversation index + searchBlob + filterConversations |
| `src/util/filterByTokens.ts` | Keyword AND search utility |
| `src/search/index.ts` | Web search facade (provider-agnostic) |
| `src/search/registry.ts` | Search provider registry |
| `src/search/ExaMCP.ts` | Exa MCP free search provider |
| `src/search/providers/brave.ts` | Brave Search API provider |
| `src/search/providers/exaApi.ts` | Exa API provider |
| `src/search/providers/tavily.ts` | Tavily provider |
| `src/telemetry/telemetry.ts` | Opt-in crash/error telemetry |
| `src/telemetry/config.ts` | Telemetry config, URLs, allowlists |
| `src/telemetry/pure.ts` | Sanitizer, classifiers, journal ops |
| `src/engine/ModelDownloader.ts` | HuggingFace model download |
| `src/engine/ModelRegistry.ts` | Model catalog + EMBEDDING_MODEL |
| `src/engine/EmbeddingService.ts` | On-device E5 embedder (llama.rn) |
| `src/engine/LlamaService.ts` | Chat engine, tool loop, completion |
| `src/engine/toolCallParser.ts` | Fallback tool_call markup parser |
| `src/documents/semanticIndex.ts` | In-memory vector index (brute-force cosine) |
| `src/documents/documentChatTool.ts` | document_chat tool (BM25+dense hybrid) |
| `src/documents/documentStorage.ts` | Document FS storage + vector sidecars |
| `src/agent/webSearchTool.ts` | web_search tool definition + executor |
| `src/agent/webFetchTool.ts` | web_fetch tool (allowlisted URLs) |
| `src/agent/toolToggles.ts` | Tool on/off AsyncStorage keys |
| `src/agent/toolSourceLedger.ts` | Citation tracking for search+fetch |
| `src/notes/NotesStore.ts` | Markdown notes (file-based, no SQLite) |
| `src/chat/markdown.ts` | Dependency-free markdown parser |
| `src/chat/MarkdownText.tsx` | RN markdown renderer |
| `src/voice/TtsService.ts` | Text-to-speech (expo-speech, local) |
| `src/app/AppShell.tsx` | Tool registration + executeTool dispatcher |
| `src/theme/components/Drawer.tsx` | Chat search UI |
| `src/ui/AskAssistantMiniappRenderer.tsx` | Miniapp export (PNG/SVG/JSON/CSV) |
