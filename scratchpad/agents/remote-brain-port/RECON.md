# RECON — port Kalsa Brain phone client (`remote-brain` → `main`), scoped

Read-only session. All reads via git plumbing from `/Users/marco/Projects/kalsa-wt-bench-apk`
(detached at `e206a945b`, verified `git rev-parse --short=9 HEAD` → `e206a945b`).
SHAs: branch tip `ce71e78cd`, fork `9d3db1076`, UX branch `a7ea2c7c3`.
Unless marked **main:**, all `file:line` refs are at **`ce71e78cd`**. Inferences labelled **INFERENCE**.

## 0. Numbers (recomputed AFTER unshallow — coordinator item b)

```
git rev-list --left-right --count e206a945b...ce71e78cd  ->  419	189
git log --format=%h 9d3db1076..ce71e78cd | wc -l          ->  196   (commits since fork)
git log --format=%h 9d3db1076..ce71e78cd -- src/engine/remote | wc -l -> 48
git rev-list --count 9d3db1076..e206a945b                 ->  426
```
Corrected figures confirmed: **189 ahead / 419 behind** (brief's 413 was pre-unshallow).
Reconciliation: 196 commits since fork − 189 branch-only = **7 commits shared with main**
(2026-09-02 LOT-A chat work, same shas on both sides — `056b61d, 7f83ae9, 83333ef, 9d8bed4,
a27b298, dbbc75b, ffde39f`; none touch `src/engine/remote/`). 426 = 419 main-only + 7 shared.
`src/engine/remote/` does not exist on main (`git ls-tree e206a945b src/engine/remote` → empty).
Repo is no longer shallow (`git rev-parse --is-shallow-repository` → `false`).

## 1. The 48 commits touching `src/engine/remote/` + their OTHER paths

Other paths = `git diff-tree --no-commit-id --name-only -r <sha>` minus `src/engine/remote/`.

| # | sha | subject (abbrev) | other paths |
|---|-----|------------------|-------------|
| 1 | 2c3c452 | feat(engine): add remote Mac brain backend and settings | app.config.js, plugins/withDebugCleartext.js, src/app/AppShell.tsx, src/engine/ModelRegistry.ts, src/engine/engineBackend.ts, src/i18n/en.ts, src/i18n/it.ts, src/screens/AiChatPage.tsx, src/screens/RemoteBrainSettings.tsx, src/screens/SettingsScreen.tsx |
| 2 | fc0e59f | fix(app): wait for remote SSE to finish and hydrate backend first | index.js, src/app/AppShell.tsx |
| 3 | 7a0fb9d | fix(engine): remote stream succeeds only on onload plus terminal marker | src/app/AppShell.tsx, src/i18n/en.ts, src/i18n/it.ts, src/screens/AiChatPage.tsx |
| 4 | 11ef174 | fix(engine): remote inactivity timeout and abort-before-send | — |
| 5 | 780bcd3 | fix(engine): abort remote stream on dispose and switch backends in order | src/app/AppShell.tsx, src/engine/engineBackend.ts |
| 6 | 2ba308b | fix(engine): keep virtual remote model id separate from server model id | src/engine/engineBackend.ts, src/i18n/en.ts, src/i18n/it.ts, src/screens/RemoteBrainSettings.tsx |
| 7 | a6c76a0 | fix(engine): send kalsa system prompt on remote OpenAI turns | — |
| 8 | 20c341d | fix(security): lock remote URL policy and scrub tailnet identifiers | .gitignore, plugins/withDebugCleartext.js, server/mac-brain/NOTES.md, server/mac-brain/README.md, server/mac-brain/test-sse.sh, src/i18n/en.ts, src/i18n/it.ts, src/screens/RemoteBrainSettings.tsx |
| 9 | 76f56fe | fix(engine): strip think tags on remote stream, status monotonic | — |
| 10 | 643f456 | test(engine): remote stream/lifecycle edges, pin index.js entry | package.json |
| 11 | 83609f6 | fix(engine): explicit finish_reason wins over [DONE] | — |
| 12 | 4505130 | fix(engine): per-stream generation so dispose cannot clobber | — |
| 13 | 7c83fa2 | fix(engine): release remote inFlight before UI callbacks | — |
| 14 | 51be011 | fix(engine): stop delivering SSE frames after reentrant abort | — |
| 15 | 13a4143 | fix(engine): catch stringify/send failures inside transport | — |
| 16 | 49640d5 | fix(engine): non-2xx remote SSE is failure even with [DONE] | — |
| 17 | 0a394fa | fix(server): refuse non-loopback mtplx --no-auth, terminal onerror | server/mac-brain/README.md, server/mac-brain/run.sh, server/mac-brain/test-sse.sh |
| 18 | 372190e | fix(server): treat http(s)://[::1] as loopback in test-sse | server/mac-brain/test-sse.sh |
| 19 | 65a04e5 | fix(engine): freeze terminal SSE state after [DONE] | — |
| 20 | 58f09b2 | fix(engine): skip post-terminal abort consume, closed activeStream | — |
| 21 | d1fa670 | fix(engine): fire onDone/onError even if finalize/onModel throws | — |
| 22 | f9ea867 | test(engine): hydrate truncated from storage JSON, mid-stream A/B | src/engine/historyPersistable.test.ts, src/engine/historyPersistable.ts, src/screens/AiChatPage.tsx |
| 23 | 9c8cd2c | fix(engine): freeze SSE after any terminal finish_reason | — |
| 24 | 5bf1e76 | fix(engine): hydration read-only; only setEngineBackendMode writes cache | src/app/AppShell.tsx, src/engine/engineBackend.ts |
| 25 | 0608791 | fix(app): apply local boot backend through gated setter | src/app/AppShell.tsx |
| 26 | 2eb782e | fix(app): boot catch forces local backend through gated setter | src/app/AppShell.tsx, src/engine/engineBackend.ts |
| 27 | 2eb2ab3 | fix(engine): allow loopback http in release; empty URL ≠ https_required | src/app/AppShell.tsx, src/i18n/en.ts, src/i18n/it.ts, src/screens/RemoteBrainSettings.tsx |
| 28 | 732230e | fix(android): loopback cleartext in release network-security-config | plugins/withDebugCleartext.js |
| 29 | b564fff | fix(engine): demote orphan remote-without-URL to local on upgrade | src/app/AppShell.tsx, src/engine/engineBackend.ts, src/i18n/en.ts, src/i18n/it.ts |
| 30 | 589b8a5 | fix(ui): never show remote_brain_* codes to the user | src/app/AppShell.tsx, src/i18n/en.ts, src/i18n/it.ts, src/screens/RemoteBrainSettings.tsx |
| 31 | 094fb5b | fix(engine): gate remote URL before reading SecureStore | — |
| 32 | 41996b2 | fix(engine): fail-closed URL policy inside SSE transport | — |
| 33 | e8aa9c8 | fix(engine): persist local model when remote boot has no URL | src/app/AppShell.tsx |
| 34 | c6e80e5 | fix(settings): never commit an unhydrated remote draft | jest.config.js, package-lock.json, package.json, src/screens/RemoteBrainSettings.hydration.test.ts, src/screens/RemoteBrainSettings.tsx |
| 35 | e657550 | fix(chat): never print remote-brain error code in conversation | src/app/AppShell.tsx, src/i18n/en.ts, src/i18n/it.ts |
| 36 | 4112f09 | fix(settings): track remote draft dirty per field | src/screens/RemoteBrainSettings.hydration.test.ts, src/screens/RemoteBrainSettings.tsx |
| 37 | 1d90e9e | fix(copy): never show internal text, never state a false cause | src/app/AppShell.tsx, src/i18n/en.ts, src/i18n/it.ts |
| 38 | 40708d7 | fix(remote): close other paths that could destroy/leak the token | src/screens/RemoteBrainSettings.hydration.test.ts, src/screens/RemoteBrainSettings.tsx |
| 39 | e32fd59 | fix(remote): report the cause that actually happened | src/app/AppShell.tsx, src/i18n/en.ts, src/i18n/it.ts |
| 40 | 895d844 | fix(remote): a superseded operation never writes UI state | src/app/AppShell.tsx, src/engine/engineBackend.ts |
| 41 | 444d88a | fix(settings): no stale hydration, no silent loss, saved in order | src/i18n/en.ts, src/i18n/it.ts, src/screens/RemoteBrainSettings.hydration.test.ts, src/screens/RemoteBrainSettings.tsx |
| 42 | 7b3a32e | fix(remote): do not resolve error codes through Object.prototype | app.config.js, plugins/withLoopbackCleartext.js |
| 43 | af5de37 | refactor(remote): remote model is the user's computer | src/app/AppShell.tsx, src/engine/ModelRegistry.ts, src/engine/engineBackend.ts, src/engine/ensureIntent.test.ts, src/engine/ensureIntent.ts, src/engine/modelIndexProbe.test.ts, src/engine/modelIndexProbe.ts, src/engine/regenState.test.ts, src/i18n/en.ts, src/i18n/it.ts, src/screens/RemoteBrainSettings.hydration.test.ts, src/screens/RemoteBrainSettings.tsx |
| 44 | 312b583 | fix(remote): stop advertising a context window the client cannot know | — |
| 45 | d1ef0c5 | fix(remote): stale snapshots, redacted logs, token that never landed | src/app/AppShell.tsx, src/engine/engineBackend.ts, src/i18n/en.ts, src/i18n/it.ts, src/screens/RemoteBrainSettings.hydration.test.ts, src/screens/RemoteBrainSettings.tsx |
| 46 | 9ca47a1 | fix(remote): read server context window, own-property markers only | — |
| 47 | 0421ef0 | fix(remote): log what we choose, key attempt by what it reads, bound it | src/app/AppShell.tsx, src/engine/engineBackend.ts, src/engine/ensureIntent.test.ts, src/engine/ensureIntent.ts |
| 48 | 33d0dcc | fix(log): the server's own words no longer ship, in any build | src/bench/benchConfig.ts, src/util/devBuild.ts |

Out-of-scope paths that appear **inside** the 48: `server/mac-brain/*` (17, 18, 8), `.gitignore` (8),
`src/bench/benchConfig.ts` (48), `index.js`+`package.json "main"` (2, 10 — see §9 exclusions).
`src/util/devBuild.ts` (48) is **required**: `openaiTransport.ts:12` → `import { isDevBuild } from "../../util/devBuild"`.

## 2. `src/engine/remote/` at `ce71e78cd` — 30 files

Line counts from `git show ce71e78cd:<f> | wc -l`. Purposes from each file's own header.

**Sources (16):**
| file | lines | purpose |
|---|---|---|
| RemoteEngine.ts | 497 | Client core: `testRemoteConnection` probe (/props, /v1/models, /health), `initRemoteEngine`, `streamRemoteAssistantTurn` (SSE, per-stream generation, supersede flags), dispose, plus no-op local-session/memory/translate/complete stubs |
| openaiTransport.ts | 382 | XHR POST `/v1/chat/completions` stream; success = HTTP 2xx onload **and** terminal marker; inactivity timeout (120 s); bounded dev-only error excerpt |
| openaiSse.ts | 217 | Pure SSE split/parse + terminal `finish_reason` rules — no I/O |
| remoteSettings.ts | 295 | AsyncStorage prefs (`kalsa.engine.backend`, `kalsa.remote-brain.*`) + in-memory caches + hydration snapshot (seq-guarded) + **sole** gated writer `setEngineBackendMode` |
| remoteUrl.ts | 118 | URL policy: normalize (strips userinfo/query/hash), `redactUrl`, `canSendAuthorization`, `remoteUrlAllowedInThisBuild`, `remoteUrlGateError` |
| latestSave.ts | 48 | Serialises per-field writes so stored value = last value the user saw |
| remoteSecret.ts | 37 | Optional Bearer token in **SecureStore**, key `kalsa.secret.remote-brain`; empty ⇒ delete |
| remoteBoot.ts | 59 | Pure `decideRemoteBoot`: remote only if hydration ok ∧ not stale ∧ wants remote ∧ URL present; else local + reason (`orphan`/`hydration-failed`/`stale-hydration`/`saved-local`) |
| remoteBrainErrors.ts | 55 | Internal `remote_brain_*` code → human copy; fails closed (header: “Snake_case codes must never reach the UI”) |
| redactForLog.ts | 53 | Second-line scrubber for network text before logging (Bearer/Basic, URLs, `*token|key|secret*` labels, `sk-/ghp-/xox*` keys) |
| remoteComputerModel.ts | 41 | Virtual `ModelInfo` row, id `"kalsa-remote-mac"` — header: “Virtual catalog row for the user's computer. **Not in MODEL_REGISTRY.**” |
| remotePrompt.ts | 23 | `buildRemoteSystemPrompt`: system prompt **+ memory facts + operative block** |
| serverContext.ts | 28 | Parse server `/props` `n_ctx`; client sends no context length |
| remoteSettingsDraft.ts | 41 | Per-field dirty/hydration guards: unhydrated empty draft must never reach AsyncStorage/SecureStore |
| remoteDefaults.ts | 10 | Pure defaults, RN-free (separated from the AsyncStorage-coupled store) |
| openaiMessages.ts | 31 | `EngineMessage[]` → OpenAI `{role,content}` (prefers `modelEmittedText`) |

**Tests (14):** `remoteEngine.lifecycle.test.ts` 709 (init/stream/dispose/supersede/token-failure edges),
`openaiTransport.test.ts` 773 (fake XHR: onload/onerror/terminal/log bounds), `remoteSettings.test.ts` 232
(hydration races, commit rollback), `openaiSse.test.ts` 120, `remoteUrl.test.ts` 116, `remoteBoot.test.ts` 104,
`redactForLog.test.ts` 96, `remoteBrainErrors.test.ts` 94, `latestSave.test.ts` 91, `remoteSettingsDraft.test.ts` 76,
`remoteSecret.test.ts` 40 (SecureStore mocked), `remotePrompt.test.ts` 27, `openaiMessages.test.ts` 25,
`serverContext.test.ts` 25.

## 3. Wiring sites outside `src/engine/remote/` at `ce71e78cd`

`git grep -n 'engine/remote' ce71e78cd -- src app.json package.json android ios` → hits only in
`src/app/AppShell.tsx:74,78`, `src/screens/RemoteBrainSettings.tsx:6,15,19,23,24,31,32`,
`src/screens/RemoteBrainSettings.hydration.test.ts:70,82,126,132`. (`app.json` does not exist — **main:** NO;
**no `android/` or `ios/` directory is tracked at any SHA** — both are Expo-prebuild generated.)
A second grep for the symbol surface found the rest:

| site (ce71e78cd) | on main e206a945b? | divergence `9d3db1076 → e206a945b -- <file>` | hunk class |
|---|---|---|---|
| `src/engine/engineBackend.ts:40-244` (façade; imports LlamaService + remote, re-exports) | **NO** (new file) | n/a | file-add; **TRIVIAL** as copy, proof = tsc (all 23 fns + 9 types verified present on main, see §7) |
| `src/app/AppShell.tsx:74,78` (remoteBrainErrors, remoteBoot), `:170-176` (backend fns), `:2870-2935` (boot hydrate), `:3757,3780` (probe), `:3875-3895` (supersede), `:4371-4412,4422-4455` (switch/select-remote), `:6192-6194` (tools off), `:6296-6298` (readyRemote label) | YES | `1 file changed, 1870 insertions(+), 443 deletions(-)` | **HARD** |
| `src/screens/AiChatPage.tsx:82,2284,3256,3367,3928,4175` | YES | `652 insertions(+), 454 deletions(-)` | **MODERATE** (5 small hunks, anchors verified §9) |
| `src/screens/SettingsScreen.tsx:96` (import), `:2086-2090` (render panel) | YES | `513 insertions(+), 15 deletions(-)` | **MODERATE** (2 hunks; props `modelBusy`/`model.currentModelId` exist **main:**119,797) |
| `src/engine/ModelRegistry.ts:21` (remote import), type `nameKey` (branch :101-108), `:345` getModelById guard | YES | `85 insertions(+), 18 deletions(-)` (main converged `DEV_MODEL_REGISTRY` independently — **main:**21) | **MODERATE** |
| `src/i18n/en.ts:114-161,286-289,482` / `src/i18n/it.ts` mirrors | YES | en `75+/12-`, it `74+/11-` | **TRIVIAL** (additive key hunks; main interleaved `governor` keys — **main en:**131-133; `modelActive` already exists — **main en:**134) |
| `src/screens/RemoteBrainSettings.tsx` + `.hydration.test.ts` | **NO** (new) | n/a | file-add |
| `src/engine/ensureIntent.ts` (+`.test.ts`), `src/engine/modelIndexProbe.ts` (+`.test.ts`), `src/engine/regenState.test.ts` | **NO** (all new; fork lacks them) | n/a | file-add |
| `index.js` (plain `registerRootComponent(App)`) + `package.json "main": "index.js"` (2, 10) | **NO** | n/a | **excluded — see §9** |
| `app.config.js` plugin registration (1, 42) | YES | `22 insertions(+), 10 deletions(-)` | **TRIVIAL** (1 line; rest of branch diff = engineBuildId/governor/intent-filters = NOT remote) |
| `plugins/withLoopbackCleartext.js` (final name at tip; `withDebugCleartext.js` was renamed) | **NO** | n/a | file-add (40 lines) |
| `jest.config.js` (34) | YES | **unchanged since fork** | **TRIVIAL** (2 lines) |
| `package.json` (10, 34) | YES | `2 insertions(+), 3 deletions(-)` (main dropped `patch-package`/postinstall, repinned `llama.rn` to a github SHA) | **TRIVIAL**, hand-edit only — never copy branch package.json (provenance chain) |
| `src/util/devBuild.ts` (48, 16 lines) | **NO** (created on branch by 48) | n/a | file-add, **required** by openaiTransport |
| `src/engine/historyPersistable.ts/.test.ts` + AiChatPage hunk (22) | YES for the files, but feature absent: `restoreTerminalFlags` exists neither at fork nor on main (`git grep restoreTerminalFlags e206a945b -- src` → empty; main exports only `toPersistableHistoryMessages` **main:**35) | `87 insertions(+)` on a different axis | **excluded** — `git grep historyPersistable ce71e78cd -- src/engine/remote` → empty: client does not depend on it |
| `src/engine/llamaContextGate.test.ts` (imports ensureIntent on branch) | YES on main but **without** ensureIntent (grep empty) | branch version is outside the 48 | **excluded** |
| `App.tsx` (ModelCatalogBoot) | — | touched by branch, but NOT by any of the 48 (dev-models catalog boot) | **excluded** |

## 4. Dependencies & platform

- **package.json the client needs:** `"react-test-renderer": "19.2.3"` (devDep, added by 34/c6e80e5, used by
  `RemoteBrainSettings.hydration.test.ts:93` `} from "react-test-renderer";`) + matching `package-lock.json` entry.
  Branch diff also flips `"main"` → `index.js` and adds `test:governor-params` (already on **main:**10) — not client deps.
  Nothing else: no new runtime dependency. `jest` ^30.4.2, `ts-jest` ^29.4.12 identical both sides;
  `react-native 0.86.2` (**main:**53), `expo-secure-store ~57.0.1`, `@react-native-async-storage/async-storage 2.2.0` already present.
- **jest.config.js** needs `moduleFileExtensions: ["ts","tsx","js","json"]` and transform `"^.+\\.tsx?$"`
  (**main:**6,8) — only so the hydration test can load `./RemoteBrainSettings` (a `.tsx`).
- **Native code:** none new. Cleartext policy is an **Expo config plugin** writing the Android manifest at prebuild —
  `plugins/withLoopbackCleartext.js:4-6`: “It writes the MAIN source set, so it applies to every variant, and the
  global default stays cleartextTrafficPermitted=false”. It emits `network_security_config.xml`:
  `<base-config cleartextTrafficPermitted="false" />` + `<domain-config cleartextTrafficPermitted="true">` for
  `127.0.0.1`, `localhost`, `::1` only, and sets `android:networkSecurityConfig="@xml/network_security_config"`.
  Registered in app.config after `"./plugins/withLintOff"` (**main app.config.js:70**; main already has the
  `withDebuggableRelease` conditional at **main:72** — do not re-add).
  No tracked `android/`, `ios/`, `app.json` at any SHA. **INFERENCE:** iOS has no ATS exception added → plain-http
  loopback would be blocked by ATS on iOS; project ships Android APKs, so this is a functional note, not a hole.
- **Bearer token storage:** **SecureStore**, key `kalsa.secret.remote-brain`
  (`remoteSecret.ts:6` `const STORAGE_KEY = "kalsa.secret.remote-brain";`; get/set/delete via
  `SecureStore.getItemAsync/setItemAsync/deleteItemAsync`, lines 16, 31, 37). Never AsyncStorage, never a file.
  The **URL** (and model id/maxTokens/temperature/ctx/backend) go to **plain AsyncStorage**
  (`remoteSettings.ts:19-24` keys; `remoteUrl.ts:44-45` comment: “a query string can carry a credential … and this
  URL is stored in plain AsyncStorage, so it never survives normalization”).

## 5. SECURITY & PRIVACY — hostile reading

**Can the token reach a log / error / throw / telemetry / file?**
- Transport error logging is chosen, not echoed: `openaiTransport.ts:88-101` `loggableServerError` logs only
  `{code:"remote_brain_sse_error", bytes:n}` in production; dev adds `excerpt: redactForLog(message.slice(0,160))`
  (`MAX_LOGGED_EXCERPT = 160`, line 84) with the comment: “`{"apiKey":"…"}` … walk past `redactForLog`, and no
  pattern will catch a secret sitting under a neutral field name” (lines 76-79).
- The three `console.log` sites in `RemoteEngine.ts` carry no secret: `:183-188` `{ok, modelId, serverModelId}`;
  `:405-407` `console.log("remote.brain.token", JSON.stringify({ n: visibleChunk.length }))` — **tag** says "token",
  payload is a **number** (length of the first visible delta); `:443-445` `{requestId, model: activeId}` where
  `activeId = "kalsa-remote-mac"`.
- Thrown messages are stable codes: `new Error("remote_brain_timeout"|"remote_brain_network"|"remote_brain_sse_error"|
  \`remote_brain_http_${status}\`|"remote_brain_token_required"|"remote_brain_send")` (openaiTransport.ts:170,204-206,
  251-253, 344-346; RemoteEngine.ts:112,348). One leak-adjacent site: `testRemoteConnection` catch returns
  `err.message` verbatim (RemoteEngine.ts:174-177). **INFERENCE:** a fetch `TypeError` message can name the URL but
  never the Authorization header; the stored URL is query-stripped, so no credential rides it. UI never prints raw
  codes: `remoteBrainErrors.ts:3-5` “Snake_case codes must never reach the UI … anything unrecognised fails closed to
  human copy”, enforced by commits 30/37/39/35 (`589b8a5`, `1d90e9e`, `e32fd59`, `e657550`).
- Telemetry: `reportTelemetry` appears only in `src/agent/webFetchTool.ts` + `src/telemetry/*`; no remote file calls it,
  and remote mode disables tools anyway (`AppShell.tsx:6192-6194` spread `{ tools: undefined, executeTool: undefined }`).
  No console-override hooks (`git grep 'console.log =' ce71e78cd -- src index.js App.tsx` → empty).
- File: token is never written to a file; the empty-token draft guards (commit 34) exist precisely because
  `setRemoteBrainToken("")` runs `SecureStore.deleteItemAsync` (c6e80e5 message, quoted in §2 draft purpose).

**TLS — enforced or plain http?**
- Build gate: `remoteUrl.ts:95-106` `remoteUrlAllowedInThisBuild`: https allowed; http allowed **only** for
  `localhost/127.0.0.1/::1/0:0:0:0:0:0:0:1`; else `remoteUrlGateError` → `"remote_brain_https_required"` (:110-115).
  The gate runs **inside the transport before opening the XHR** (openaiTransport.ts:259-271) and **before SecureStore
  read** in boot (commits 32/31). Non-loopback http shows a warning and **withholds the token**:
  `canSendAuthorization` (remoteUrl.ts:74-83) `if (parsed.protocol === "https:") return true; return … http && isLoopbackHost`;
  `RemoteEngine.ts:63-65` `if (!token || !canSendAuthorization(url)) return {};`; openaiTransport.ts:287-289 same before
  `setRequestHeader("Authorization", …)`. Non-loopback with no token is refused outright:
  RemoteEngine.ts:109-115 → `"remote_brain_token_required"`.
- Android cleartext: globally false, three loopback domains excepted (§4). So: **TLS enforced for anything that
  leaves the phone; plain http is loopback-only, and the token never goes cleartext off-device.**

**What content goes over the wire?**
- Full chat conversation: `openaiTransport.ts:315-322` sends `JSON.stringify({model, messages, stream:true, max_tokens, temperature})`;
  `messages = toOpenAiMessages(messages, buildRemoteSystemPrompt(...))` (RemoteEngine.ts:374-381).
- **Memory facts + compaction state in the system prompt**: `remotePrompt.ts:16-18` `const facts = (opts.memoryFacts ?? []).map(f => f.text); let prompt = buildSystemPrompt(opts.locale, false, facts)` and `:19-22` appends the operative block — whose payload is `{digest, summary}` (`src/context/operativeBlock.ts:17-21` “Optional frozen context … digest … summary”), i.e. conversation-derived summary text.
- **Document identifiers**: `AiChatPage.tsx:2276-2279` `docHints = … map(a => \`[document:${a.libraryDocId} name="${a.name}"]\`)` is concatenated into the user message (:2301-2305) → library document **ids and file names** ship with every turn. Document **content** ships only via retrieval/passages or the `document_chat` tool: tools are off (AppShell:6192-6194) and research is gated (AiChatPage:2284) — **OPEN QUESTION / INFERENCE:** I found no code-level gate keyed on `isRemoteEngineBackend()` for the document-retrieval/embedding path itself (AppShell remote refs: 172,3757,3780,3889,4371,4445,6192,6296; AiChatPage: 82,2284,3256,3367,3928,4175 — none touch the embedder/retrieval loop). Verify before shipping whether attached-document retrieval can still inject passages into a remote turn.
- Explicitly **not** sent: memory extraction, translation, one-shot completion are no-ops in remote mode
  (`RemoteEngine.ts:455-496`: `remoteExtractMemory` returns `stopReason:"skipped_no_snapshot"`, `remoteTranslateText`
  `{text:"",truncated:false}`, `remoteCompleteOnce` `{text:"",aborted:true}`); translate UI row hidden
  (AiChatPage:4175-4182), translate/research early-return (:3256-3259, :3367-3370), research chip disabled (:3928).

**Which act authorises it?**
- The acts: type an address → press **“Use my computer”** (`RemoteBrainSettings.tsx:289-307`: validates non-empty,
  `await setRemoteBrainUrl(url)`, `onSelectModel(REMOTE_COMPUTER_MODEL_ID)`), optionally “Test connection” (:439-459).
  Backend mode flips only through the gated setter (`remoteSettings.ts:141-154 setEngineBackendMode`, refuses writes
  while a switch intent is in flight :145-147). Boot then honours stored state fail-closed (`remoteBoot.ts:41-48`;
  orphan remote-without-URL demoted to local, commit 29/`b564fff`).
- The consent copy: `en.ts:115-116` `remoteBrainHint: "Use your computer as the model. Set its address below. Tools,
  memory extraction, translation, embeddings and voice stay off in this mode."`; `:159` `remoteComputerHint: "Runs on
  your computer. No download on this phone."`; `:152-153` http warning; `:127-128` token hint “Stored in this device's
  secure storage.”
- **Hostile finding (INFERENCE — design judgement):** a setting that says *where* to send traffic is here also the
  consent to *upload* content, and no string says so. The hint enumerates what remote mode turns **OFF**; nothing
  states that conversation text, memory facts, the compaction digest/summary and document ids/names are sent to the
  typed address. The nearest thing to a disclosure is `remoteComputerHint` (“Runs on your computer”), which describes
  compute location, not upload. Recommended before ship: one explicit line in the panel (e.g. after
  `RemoteBrainSettings.tsx:270`) — “Your messages, saved memory facts and document names are sent to this address.”

## 6. Tests & jest under main

- **Cover the client:** the 14 `src/engine/remote/*.test.ts` (§2) + outside:
  `RemoteBrainSettings.hydration.test.ts` (557 lines — pins the unhydrated-draft token-loss bug, c6e80e5),
  `ensureIntent.test.ts` (248), `modelIndexProbe.test.ts` (96), `regenState.test.ts` (44);
  `historyPersistable.test.ts` (86) is part of excluded commit 22.
- **main jest config** (unchanged since fork): `testEnvironment node`, `roots ["<rootDir>/src"]`,
  `testMatch ["**/*.test.ts"]`, `moduleFileExtensions ["ts","js","json"]`, transform `"^.+\\.ts$"` ts-jest.
  - The **14 remote tests + ensureIntent + modelIndexProbe + regenState run as-is**: every in-dir import is `.ts`
    (`git grep '\.tsx' ce71e78cd -- src/engine/remote` → empty); RN modules are resolvable on main
    (`react-native 0.86.2` main:53, `expo-secure-store`, async-storage) and are factory-mocked
    (e.g. `remoteSettings.test.ts:6-15` mocks async-storage; `remoteSecret.test.ts:5` mocks expo-secure-store;
    hydration test `jest.mock("react-native", …)` :14-27).
  - `RemoteBrainSettings.hydration.test.ts` **will NOT run on main's config**: it imports `./RemoteBrainSettings`
    (`.tsx`) — needs `moduleFileExtensions` + `"^.+\\.tsx?$"` (both files unchanged on main → 2-line edit) and the
    `react-test-renderer` devDep.
- **Ratchets in main's test setup:** none inside jest — `jest.config.js` has no `coverageThreshold`;
  `git grep -i ratchet e206a945b` → empty; the `coverageThreshold` hits are harness-only
  (`scripts/htmlToTextHarness.mjs:155`, `scripts/retrievalLoopHarness.mjs:235…`). The real ratchets are CI:
  `.github/workflows/ci.yml:40-44` `Typecheck (tsc --noEmit)` then `Jest (in-band) npx jest --runInBand`, and
  `apk.yml:86 npm run typecheck`. i18n parity is itself a type-ratchet: `src/i18n/types.ts:4` `export type LocaleStrings = typeof en;`
  with `TranslationKey = DeepKeyOf<LocaleStrings>` (**main index.ts:33**) — every new `en` key must exist in `it` or tsc fails.

## 7. Conflicts with main (files the port must touch that main changed since fork)

| file (main divergence since fork) | nature of conflict | effort |
|---|---|---|
| `src/app/AppShell.tsx` (1870+/443−) | import split; boot effect grew a **boot-loop defence + death-marker/load-marker logic** (main:2941-2970 `pickStartModel`, `readLastGoodModelId`) that branch's `decideRemoteBoot` path doesn't know; model-switch dispose exists on both (main:4552 `MODEL_SWITCH_DISPOSE_TIMEOUT_MS` vs branch:4441-4451); `presenceProbeEpoch`, `switchDisposeUi`, `engineIntentRef`, `remoteActive`, `selectRemoteComputer` are branch-only; ready label moved (main:6782 vs branch:6296); tools-off spread at main:6682 | **HARD** — ~8 hunks, semantic merge in boot effect; est. 1 focused day + proofs |
| `src/engine/LlamaService.ts` (2956+/…; branch also diverged 1231+) | Port does **not** edit it, but engineBackend compiles against main's: all 23 imported fns (`git grep "export function <s>" e206a945b -- src/engine/LlamaService.ts` — none MISSING) and 9 types (none missing); `StreamTurnOptions` on main already has `memoryFacts` (main:3891), `operativeContext` (:3902), `lastUserMessage` (:3907) that remotePrompt/AppShell pass | 0 edits; **verify via tsc** — semantic drift is the residual risk (**INFERENCE**: names check out, behaviour proven only by tests) |
| `src/screens/AiChatPage.tsx` (652+/454−) | import retarget + 5 gates; anchors verified: import main:75-85, `useResearch` main:2455, `runTranslate` main:3533, `toggleResearchMode` main:3642, research chip `disabled=` main:4196-4200, translate row main:4449 | **MODERATE** |
| `src/screens/SettingsScreen.tsx` (513+/15−) | 2 hunks; main added governor/other sections elsewhere; props in scope (main:119,797) | **MODERATE** |
| `src/engine/ModelRegistry.ts` (85+/18−) | main already converged `DEV_MODEL_REGISTRY` (main:21) and `sha256?` (main:56) — port adds only remote import, `nameKey?` (main has none: grep empty), `getModelById` guard (main:388) | **MODERATE** |
| settings storage / engine selection | there is **no** settings-storage module and **no** backend selector on main — remote keys (`kalsa.engine.backend`, `kalsa.remote-brain.*`) are new, no collision; “engine selection” conflict = AppShell call-site rewiring only (above) | covered by AppShell row |
| `src/i18n/en.ts` (75+/12−), `it.ts` (74+/11−) | additive; main interleaved `governor` keys (main en:131-133) and already has `modelActive` (main en:134) — branch's block ends at `remoteSelect` (branch en:161); `chat.truncated` **missing on main** (only `translate` truncation exists, main en:967; branch chat section has it at :508 next to `interrupted` which main has at :481) → add it | **TRIVIAL** (8 small hunks, key-by-key, never file-copy) |
| `app.config.js` (22+/10−) | add 1 line; skip engineBuildId/intent-filter/governor hunks (main:72 already has withDebuggableRelease) | **TRIVIAL** |
| `jest.config.js`, `package.json` | unchanged / 1 devDep line | **TRIVIAL** |

Total: **39 files verbatim** (30 remote + engineBackend + ensureIntent×2 + modelIndexProbe×2 + regenState.test +
RemoteBrainSettings×2 + devBuild + withLoopbackCleartext), **9 files hand-hunked** (AppShell, AiChatPage,
SettingsScreen, ModelRegistry, en, it, app.config, jest.config, package.json). AppShell is ~70 % of the risk.

## 8. UX branch boundary test (`a7ea2c7c3`, `src/host/modelFailureState.test.ts:98-110`)

(Not on main — `git ls-tree e206a945b src/host` → empty; `a7ea2c7c3` is not an ancestor of main.)

```ts
  it("pins the phone-only boundary until remote backend state exists", () => {
    // Replace this boundary when `src/engine/remote/` arrives from `remote-brain`; that dependency supplies backend location state.
    for (const modelState of Object.keys(ALL_MODEL_STATES) as ModelPipelineState[]) {
      for (const modelError of [null, en.models.blockedRam, en.models.blockedTier, en.model.tooLarge, en.errors.connectionLost]) {
        const key = pillWhereLabel({ modelState, modelError, t });
        expect(["shell.where.thisPhone", "shell.where.notRunning"]).toContain(key);
        expect(key).not.toMatch(/remote|server/i);
      }
    }
    const modelInfo = MODEL_REGISTRY.match(/export type ModelInfo = \{([\s\S]*?)^\};/m)?.[1];
    expect(modelInfo).toBeDefined();
    expect(modelInfo).not.toMatch(/^\s*(?:backend|location)\??:/m);
  });
```
Context: `pillWhereLabel` (**a7ea2c7c3 src/host/modelBar.ts:130-140**) returns only
`refusedHere ? "shell.where.notRunning" : "shell.where.thisPhone"`; shell `where` keys are only
`thisPhone`/`notRunning` (**a7ea2c7c3 src/i18n/en.ts:1323-1328**).

**The exact pair of changes once the client is on main:**
1. **Comment (line 99):** the `` `remote-brain` `` reference is replaced by the on-main module that actually supplies
   the backend location state: **`src/engine/engineBackend`** — the façade UI imports instead of LlamaService
   (`engineBackend.ts:3-4` “UI imports this module instead of LlamaService at AppShell / AiChatPage only”), which
   re-exports `isRemoteEngineBackend` (`engineBackend.ts:81`) from `src/engine/remote/remoteSettings`
   (`remoteSettings.ts:71` `export function isRemoteEngineBackend(): boolean`). Sentence becomes e.g. “was supplied
   by `src/engine/engineBackend`”. (Literal-path alternative: `src/engine/remote/remoteSettings` — **INFERENCE**,
   both are the same export; engineBackend is the UI-facing one.)
2. **ModelInfo assertion (line 109):** flips from
   `expect(modelInfo).not.toMatch(/^\s*(?:backend|location)\??:/m)` to a positive match on **`backend`**:
   `expect(modelInfo).toMatch(/^\s*backend\?:/m)` — i.e. the port carries `backend?: "local" | "remote"`
   (`EngineBackendMode`, `remoteSettings.ts:16`) onto `ModelInfo`, while `location` stays out (UX's `location` prop is
   presentation, `ShellStrip` `location === "phone"`; catalog state is `backend`). **INFERENCE / decision needed:**
   verbatim `remote-brain` adds **no** `backend`/`location` field (grep both SHAs → empty); the only `ModelInfo` field
   it adds is `nameKey?: TranslationKey` (ModelRegistry fork→branch diff, comment “(the remote row)”). So either the
   port deliberately adds `backend?` (then the assertion above), or it stays strictly verbatim and the assertion flips
   to `expect(modelInfo).toMatch(/^\s*nameKey\?:/m)`. Marco/UX must pick; `backend` is the semantically correct field
   for this test's stated purpose (“backend location state”). The `/remote|server/i` loop (lines 100-106) then gains
   the remote case once `pillWhereLabel` consumes the backend flag (needs a new `shell.where.*` key — remote-brain only
   has `download.readyRemote`, branch en:482).

## 9. THE PORT PLAN

### 9a. Bring VERBATIM from `ce71e78cd` (39 files)
- all 30 files under `src/engine/remote/` (§2)
- `src/engine/engineBackend.ts` (247), `src/engine/ensureIntent.ts` (167) + `ensureIntent.test.ts` (248),
  `src/engine/modelIndexProbe.ts` (83) + `modelIndexProbe.test.ts` (96), `src/engine/regenState.test.ts` (44)
- `src/screens/RemoteBrainSettings.tsx` (477) + `RemoteBrainSettings.hydration.test.ts` (557)
- `src/util/devBuild.ts` (16 — required by `openaiTransport.ts:12`)
- `plugins/withLoopbackCleartext.js` (40)

Commands (review with `git show` / `git diff --no-index` before writing): `git checkout ce71e78cd -- <paths>`
is forbidden in this read-only session; the porting session does it on its own branch.

### 9b. Re-apply hunks BY HAND on `e206a945b` (targets verified)

| # | target file:line on e206a945b | hunk (source at ce71e78cd) |
|---|---|---|
| 1 | `src/app/AppShell.tsx:60` (after `detectOrphansAtBoot` import) | insert import blocks from branch `AppShell.tsx:66-86` (`ensureIntent`, `remoteBrainErrors`, `remoteBoot`, `modelIndexProbe`) — class HARD-adjacent, TRIVIAL content |
| 2 | `src/app/AppShell.tsx:123-156` (`} from "../engine/LlamaService"`) | keep on LlamaService only: `buildSystemPrompt, chatKvLastSaveTokens, chatKvNPast, getAttemptedAssembleStart, lastNativeTokenAtMs, logPrewarmSkip, resolvedStaticPrefixTokens` (branch does not use these — main-new); move the wrapped set (`chatKvIsHeld … streamAssistantTurn` + 5 types) into a new `import … from "../engine/engineBackend"` mirroring branch `AppShell.tsx:155-184`, plus backend-only names (`beginBackendSwitch, endBackendSwitch, getRemoteBrainUrl, getRemoteServerModelId, hydrateRemoteBrainSettings, isHydrationCurrent, isRemoteEngineBackend, recoverLocalBackend, setEngineBackendMode, disposeRemoteEngine, isSupersededRemoteOp, REMOTE_COMPUTER_MODEL, REMOTE_COMPUTER_MODEL_ID`) — **HARD** (list surgery) |
| 3 | `src/app/AppShell.tsx:2944-2977` (boot `useEffect`) | graft branch `2863-2935`: hydrate → `decideRemoteBoot` → remote/local decision, **merged with** main's `pickStartModel`/load-marker death-marker defence (main:2950-2970) and `recoverLocalBackend` catch (branch:2920-2929) — **HARD, semantic merge** |
| 4 | `src/app/AppShell.tsx` modelIndex ensure effect (symbol anchors: `ensureEngineForModel` main:4002; effect deps `[modelIndex, prefsReady, presenceProbeEpoch]` branch:3804) | add `presenceProbeEpoch` state (branch:2698), `backendRemote/intentRemote` probe fields (branch:3757,3780), supersede marker (branch:3878 `isSupersededRemoteOp`), error copy via `humanRemoteBrainError` (branch:3882-3884), `if (isRemoteEngineBackend()) return false` local gate (branch:3889) — **HARD** (new state + effect wiring; exact main line found during port) |
| 5 | `src/app/AppShell.tsx:~4545-4560` (model-switch dispose, `MODEL_SWITCH_DISPOSE_TIMEOUT_MS` main:4552) | `wasRemote ? disposeRemoteEngine() : runNativeOpBounded(disposeEngine…)` + `switchDisposeUi` + `endBackendSwitch` finally (branch:4371-4412); and insert new `selectRemoteComputer` callback (branch:4422-4455) adjacent — **HARD** |
| 6 | `src/app/AppShell.tsx:6682` (`...agentOptions,`) | add `...(isRemoteEngineBackend() ? { tools: undefined, executeTool: undefined } : null)` (branch:6191-6194) — TRIVIAL |
| 7 | `src/app/AppShell.tsx:6782` (`return { label: t("download.readyLocal"), color: colors.good };`) | ternary → `isRemoteEngineBackend() ? t("download.readyRemote") : t("download.readyLocal")` (branch:6292-6298) — TRIVIAL |
| 8 | `src/screens/AiChatPage.tsx:75-85` | retarget import to `../engine/engineBackend`, add `isRemoteEngineBackend` (branch:75-83) — TRIVIAL |
| 9 | `AiChatPage.tsx:2455` | `const useResearch = !isRemoteEngineBackend() && (armedResearch \|\| keywordResearch);` (branch:2283-2284) — TRIVIAL |
| 10 | `AiChatPage.tsx:3533` (`runTranslate`) | early-return `if (isRemoteEngineBackend()) { showVoiceNote(t("settings.remoteGated")); return; }` (branch:3255-3259) — TRIVIAL |
| 11 | `AiChatPage.tsx:3642` (`toggleResearchMode`) | same early-return (branch:3366-3370) — TRIVIAL |
| 12 | `AiChatPage.tsx:4196-4200` (research chip) | append `\|\| isRemoteEngineBackend()` to `disabled=` (branch:3928) — TRIVIAL |
| 13 | `AiChatPage.tsx:4449` (translate `AttachSheetRow`) | wrap with `{!isRemoteEngineBackend() ? ( … ) : null}` (branch:4175-4182) — TRIVIAL |
| 14 | `src/screens/SettingsScreen.tsx:113` | `import { RemoteBrainSettings } from "./RemoteBrainSettings";` (branch:96) — TRIVIAL |
| 15 | `src/screens/SettingsScreen.tsx:2547` (blank line before `{/* ── Models ── */}` 2548) | `<RemoteBrainSettings currentModelId={model.currentModelId} busy={modelBusy} onSelectModel={model.onSelectModel} />` (branch:2086-2090) — TRIVIAL |
| 16 | `src/i18n/en.ts:130` (after `modelsHint` value; **before** `governor` 131) | settings block branch en:114-161 (**stop before `modelActive`** — main:134 already has it) — TRIVIAL |
| 17 | `src/i18n/en.ts:257` (`models: {`) | add `remoteComputer: { description: … }` (branch en:286-289) — TRIVIAL |
| 18 | `src/i18n/en.ts:481` (after `interrupted`) | `truncated: "Reply stopped at the token limit.",` (branch en:508) — TRIVIAL (missing on main) |
| 19 | `src/i18n/en.ts:455` (after `readyLocal`) | `readyRemote: "Ready · remote",` (branch en:482) — TRIVIAL |
| 20 | `src/i18n/it.ts:128`, `:252` (models), chat `interrupted`, `:450` (readyLocal) | the four mirrors (it keys start branch it:113) — TRIVIAL; tsc enforces parity |
| 21 | `src/engine/ModelRegistry.ts:19-21` | add `import { REMOTE_COMPUTER_MODEL, REMOTE_COMPUTER_MODEL_ID } from "./remote/remoteComputerModel";` (do NOT touch main's DEV_MODEL_REGISTRY line 21) — TRIVIAL |
| 22 | `src/engine/ModelRegistry.ts:105` (after `descriptionKey: TranslationKey;`) | add `nameKey?: TranslationKey;` + comment (branch:104-108) — TRIVIAL |
| 23 | `src/engine/ModelRegistry.ts:388-389` (`getModelById`) | first line `if (id === REMOTE_COMPUTER_MODEL_ID) return REMOTE_COMPUTER_MODEL;` (branch:345) — TRIVIAL |
| 24 | `app.config.js:70` (after `"./plugins/withLintOff",`) | add `"./plugins/withLoopbackCleartext",` — TRIVIAL (skip branch's engineBuildId/intent-filter/governor lines) |
| 25 | `jest.config.js:6` and `:8` | `["ts","tsx","js","json"]`; `"^.+\\.tsx?$"` — TRIVIAL |
| 26 | `package.json:73` (after `pdfjs-dist`) | `"react-test-renderer": "19.2.3",` + lockfile refresh (see proofs/prereqs) — TRIVIAL, hand-edit only |

Prereq for 26: lockfile. Either run `npm install` (porting session, not this one) or transplant the
`react-test-renderer` subtree of `c6e80e5`'s `package-lock.json` hunk. **Never** copy branch package.json:
main intentionally dropped `patch-package`/postinstall and pins `llama.rn` to a github SHA (fork→main package.json diff).

### 9c. What NOT to bring
- The other **148** branch commits' trees: `server/**` (incl. the mac-brain hunks inside commits 8/17/18),
  `src/documents/**`, `vendor/**`, `scripts/**`, `src/bench/**` (`benchConfig.ts` hunk of 48 — main's bench has no
  `devBuild` reference), `.gitignore` (8), `App.tsx` ModelCatalogBoot (dev-models), branch `LlamaService.ts`,
  branch `devModelCatalog`/`configureModelRegistry` (main has its own, main ModelRegistry:21),
  `historyPersistable` terminal-flag trio (22 — feature absent on main, client-independent: grep proved no dep),
  branch `llamaContextGate.test.ts`, the 7 shared LOT-A commits (already on main).
- `index.js` + `package.json "main": "index.js"` (2, 10): the entry flip's stated rationale is “Expo does not keep its AppEntry promise when a foreign node_modules checkout lies under Metro's resolver” (`commit 643f456`) — an environment fix, not client behaviour; boot hydration lives in AppShell (branch 2870). **INFERENCE:** safe to leave main's `expo/AppEntry.js`; bring only if Marco wants branch/Metro parity. No remote test pins `package.json main` (`git grep 'index.js|package.json' ce71e78cd -- src/engine/remote` → empty).
- `plugins/withDebuggableRelease.js` (already on main), `withGovernorBattery`, intent-filter rewrites, `test:governor-params` (already on main:10).

### 9d. Proof commands (targeted only — never the full suite)

```
# 1) types (also enforces en/it parity via LocaleStrings = typeof en)
npx tsc --noEmit > /tmp/port-tsc.log 2>&1; echo $?; tail -40 /tmp/port-tsc.log

# 2) the client's own suite (14 files; main jest config OK for these)
npx jest src/engine/remote --runInBand > /tmp/port-jest-remote.log 2>&1; echo $?; tail -40 /tmp/port-jest-remote.log

# 3) wiring-helper tests brought with the port
npx jest src/engine/ensureIntent.test.ts src/engine/modelIndexProbe.test.ts src/engine/regenState.test.ts \
  --runInBand > /tmp/port-jest-wiring.log 2>&1; echo $?; tail -40 /tmp/port-jest-wiring.log

# 4) settings panel test (requires jest.config + react-test-renderer hunks)
npx jest src/screens/RemoteBrainSettings.hydration.test.ts --runInBand > /tmp/port-jest-panel.log 2>&1; echo $?; tail -40 /tmp/port-jest-panel.log

# 5) neighbours of hand-hunked files (name filters, not the suite)
npx jest ModelRegistry engineBackend historyPersistable llamaContextGate --runInBand \
  > /tmp/port-jest-neighbours.log 2>&1; echo $?; tail -40 /tmp/port-jest-neighbours.log
```
Optional env check for the dev-build log gate (exercises `isDevBuild` both ways is inside tests already).
CI afterwards is the hard ratchet: `ci.yml:40-44` (`npx tsc --noEmit`, `npx jest --runInBand`) and `apk.yml:86`.
Engine provenance (`scripts/assert-engine-provenance.sh`) is untouched by a JS-only port but cheap to re-run before any APK.

### Open items for Marco
1. **Item 8 field flip:** add `backend?` to `ModelInfo` (recommended, §8) or stay verbatim (`nameKey` only).
   **RESOLVED 2026-09-23 by the UX session (49e4aa01), the owner of that surface:** `ModelInfo` does
   NOT grow `backend?`/`location?`. The pill reads `isRemoteEngineBackend()` from
   `src/engine/engineBackend` directly. Their reason: where an answer comes from is a property of the
   ENGINE, not of the model, and a field would be a second source of truth for it (the same shape as
   the hardcoded `location="phone"` pill bug). In slice 2, after the client is on main, the boundary
   test `src/host/modelFailureState.test.ts:98-110` is REPLACED by a derivation test on
   (backend, model state, model error): notRunning wins under a hard refusal; remote gives the monitor
   glyph and the "Kalsa Brain" label; local gives the phone glyph. The port stays verbatim here.
2. **Consent string** for content upload (§5) — one line in `RemoteBrainSettings`.
3. **Retrieval/embedding gate in remote mode** — verify document passages cannot reach a remote turn (§5 OPEN QUESTION).
4. `index.js`/`main` field: bring or not (§9c).
6. **Carried into STEP 2 from AUDIT-STEP1.md (coordinator, 2026-09-23):** (a) the panel hint
   promises "embeddings ... stay off in this mode", but AppShell's background indexing
   (`embedDocumentChunk`, AppShell.tsx:1839-1845) is not gated on `isRemoteEngineBackend()`. Step 2
   must either gate it or change the hint. A UI claim is a promise. (b) The tools-off spread (#6), the
   boot wiring (#3) and the selection flow must land TOGETHER: step 1 alone leaves "Use my computer"
   selectable while AppShell still streams locally. (c) Step 2 gets TWO reviewers on different
   models, because it ships. From the re-audit of `d580d2457`: (d) AppShell still imports the stream
   functions from `../engine/LlamaService` (AppShell.tsx:156), so `engineBackend.ts:185-188` is never
   reached and the remote prompt gets memory facts only in a test. Step 2 routes the live call
   (`memoryFacts: promptFacts`, AppShell.tsx:6684) through the facade. (e) Placement: remote appends
   the fact block to the SYSTEM prompt (`remotePrompt.ts:16-18`); local puts it on the last USER turn
   (`MEMORY_FACTS_ON_USER_TAIL`, `LlamaService.ts:4442-4446`). Step 2 keeps or aligns it on purpose,
   with the reason written down.
5. `historyPersistable` trio: out of scope as analysed; revisit only if UX wants truncated markers to match remote `finish_reason: length` (commit 22 depends on branch-only `restoreTerminalFlags`).
