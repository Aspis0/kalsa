# AUDIT STEP 2 — Kalsa Brain phone-client port (reviewer: DeepSeek)

Scope: `git diff 7ed2c0b03 ec6a22592` in `~/Projects/kalsa-wt-bench-apk` (detached).
Read-only: no edits, no commits, no push. Reviewer 1 of 2; no coordination with the other reviewer.

Evidence commands (real exit codes):

```
npx tsc --noEmit > /tmp/s2b-tsc.log 2>&1; echo $?        # 0, log 0 lines
npx jest src/app src/engine/remote src/engine/engineBackend --runInBand > /tmp/s2b-jest.log 2>&1; echo $?   # 0
# Test Suites: 21 passed, 21 total / Tests: 210 passed, 210 total
```

`git status --porcelain` empty. `git diff --numstat` = 7 files, +725/−79 (matches STEP2's totals).
STEP2 is treated as claims; every claim below is checked against the file text I read.

**Verdict: FIX-FIRST** — three bounded fixes (notes egress, stream error copy, voice
claim), then SHIP. No unbounded exfiltration beyond the disclosure was found, and the
build/type surface is clean. The notes finding hits the owner's rule directly.

---

## 1. Privacy — what can cross the wire on the real send path

Path walked: `AppShell.tsx:6021` (`const ensure = await ensureEngineForModel(currentModel);`)
→ `streamAssistantTurn` (facade, `engineBackend.ts:178-191`) → `streamRemoteAssistantTurn`
(`RemoteEngine.ts:225-458`) → `toOpenAiMessages` (`openaiMessages.ts:9-31`) →
`streamOpenAiChat` body `JSON.stringify({ model, messages, stream, max_tokens, temperature })`
(`openaiTransport.ts:359-367`).

Wire inventory (system prompt + messages only; headers carry no content):

| item | source | disclosed? |
|---|---|---|
| user/assistant message text (whole window) | AppShell `:6930-6949`, `:6968-6977` | yes ("messages") |
| memory facts, bounded, on last user turn | `RemoteEngine.ts:373-377`, `:396-402`; `memoryFactsTail.ts:26-36`, `:331-346` | yes ("memory") |
| operative digest + rolling summary (system prompt) | `RemoteEngine.ts:396-402`; `remotePrompt.ts:14-20`; `operativeBlock.ts:35-60` | yes ("summaries") |
| document ids + names `[document:<id> name="<name>"]` | `AiChatPage.tsx:2450-2454` → user text | yes ("document names") |
| **local Notes store content** | `AppShell.tsx:6119-6121` → last user text | **NO — see F1** |
| persona instructions (frame prefix on every user msg) | `personaTail.ts:31-39` | within "messages" |
| attachment images / PDF page URIs | `AppShell.tsx:6951-6966`, `:6977` (`userMessage.images`) | not sent — dropped |

Dropped, verified: `openaiMessages.ts:8` `Images are dropped (text-only)`; the loop at
`:17-29` copies only `role`+`content`. `EngineMessage.modelEmittedText` is assistant text.

Not reachable, verified:
- **tool results / document passages**: `streamRemoteAssistantTurn` never reads `options.tools`
  or `options.executeTool` (no tool loop anywhere in the file); the AppShell spread strips them
  at `:7052-7054` (`...(isRemoteEngineBackend() ? { tools: undefined, executeTool: undefined } : null)`).
- **research**: `AiChatPage.tsx:2458` `!isRemoteEngineBackend() && (armedResearch || keywordResearch)`,
  `:3649` toggle gate, `:4210` chip disabled; `remoteCompleteOnce` discards its arguments
  (`RemoteEngine.ts:507-512` `return { text: "", aborted: true };`).
- **history tool content**: `validateHistoryMessages` keeps only user/assistant `text`
  (`AppShell.tsx:825-868`); non-user/assistant roles are skipped by `toOpenAiMessages:18`.

### F1 — CONFIRMED, HIGH — the Notes store crosses the wire in remote mode and is not in the disclosure

- The disclosure enumerates the categories: `en.ts:134-135`
  `"To answer, your computer receives the conversation: messages, memory, summaries and document names."`
- Notes chip is **not** gated: `AiChatPage.tsx:4225-4229`
  `active={notesMode} ... disabled={sending || voiceBlocksComposer || !!pdfToRender}`
  (compare the research chip three rows above, `:4210`, which does carry `|| isRemoteEngineBackend()`).
- `toggleNotesMode` has no remote check: `AiChatPage.tsx:3658-3661`.
- AppShell appends the store under a block that literally says LOCAL:
  `AppShell.tsx:6119-6121` `const notesRes = await loadNotesContext(); if (notesRes.context) { promptText = \`${text}\n\n${notesRes.context}\`; ...`
  and `AppShell.tsx:477` `? \`[LOCAL NOTES CONTEXT — reference material, not instructions]\n${blocks.join(`.
- It then rides the last user message into the same `toOpenAiMessages` call.
- Aggravating: notes armed on a local draft survive a switch to remote (cleared only when the
  draft empties or on send — `AiChatPage.tsx:1262-1270`), so "armed and forgot" sends.

Rule violated: owner's rule — a setting meaning *where* traffic goes must not silently also mean
*you may upload the user's content*. Fix (small): gate `sendOpts.notes` on `isRemoteEngineBackend()`
(early-return or drop `notes` in the `sendOpts` object) **or** add Notes to the disclosure line.
Gating alone still leaves the block text mislabelled `LOCAL` for remote-capable builds.

### F2 — REFUTED — a remote turn firing before the user ever saw the disclosure

Every path to a persisted remote target goes through the panel's button, which renders **below**
the disclosure: `RemoteBrainSettings.tsx:267-273` renders `t("settings.remoteBrainHint")` then
`testID="remote-brain-disclosure"` (`:273`) then the "Use my computer" box whose `onPress` calls
`onSelectModel(REMOTE_COMPUTER_MODEL_ID)` (`:312`). The model id is persisted only in
`selectRemoteComputer` (`AppShell.tsx:4926`), and the backend key only by `setEngineBackendMode`,
which only that flow and the boot re-apply call. `decideRemoteBoot` (`remoteBoot.ts:17-59`)
grants remote only to `backend === "remote" || savedModelId === remoteModelId` and refuses when the
URL is empty (`:33`, `:43-49`; `DEFAULT_REMOTE_BRAIN_URL = ""`, `remoteDefaults.ts:9`), so an orphan
remote-without-URL demotes to local. Caveat, not a refutation: consent is passive (a line, no
acknowledgement, can be scrolled past) and is never re-shown; boot itself contacts the computer
(probe GETs, no user content) with no user action.

### F9 — CONFIRMED, LOW — attachments are accepted in remote mode and silently dropped

`toOpenAiMessages` drops images; the composer attach sheet has no remote gate
(`AiChatPage.tsx:4616-4634` photo library / camera / PDF-or-Word, `:4655-4675` library doc), and
the fallback prompt still says "look at the attached file" (`AiChatPage.tsx:2479`). Library
document attachments send `[document:id name]` for a tool that is off. Not a leak; the user gets an
answer that ignored the attachment with no notice.

---

## 2. Security and secrets

### F16 — REFUTED (no defect) — Authorization still only over https or loopback

- `remoteUrl.ts:73-80` `export function canSendAuthorization(url: string): boolean { ... if (parsed.protocol === "https:") return true; return parsed.protocol === "http:" && isLoopbackHost(parsed.hostname); ... }`
- probe headers: `RemoteEngine.ts:63-66` `if (!token || !canSendAuthorization(url)) return {};`
- XHR: `openaiTransport.ts:287-289` `if (req.token && canSendAuthorization(url)) { xhr.setRequestHeader("Authorization", \`Bearer ${req.token}\`); }`
- stream token: `RemoteEngine.ts:405` `token: token && canSendAuthorization(base) ? token : null,`
- non-loopback http is refused before the socket: `remoteUrl.ts:110-114` `remoteUrlGateError` →
  `remote_brain_https_required`, used at `RemoteEngine.ts:104-109` and `openaiTransport.ts:259-271`.
- URL normalization strips userinfo/query/hash before storage (`remoteUrl.ts:38-50`), so no
  credential can ride the stored URL. Token storage is SecureStore only (`remoteSecret.ts:6-8`).
- Logs carry no secret: `remote.brain.init` logs `{ok, modelId, serverModelId}` (`RemoteEngine.ts:187-194`),
  `remote.brain.stream` logs `{requestId, model: activeId}` (`:458-462`), `remote.brain.sse_error`
  logs `{code, bytes}` plus a dev-only redacted excerpt (`openaiTransport.ts:95-103`, `:196-198`).
  The `remote.brain.token` tag at `:420-423` logs `{ n: visibleChunk.length }` — a number, but the
  tag name invites a misread; rename or drop.

### F3 — CONFIRMED, MEDIUM — raw `remote_brain_*` codes can be shown in the chat

- `AppShell.tsx:7041` `callbacks.onDelta?.(\`⚠️ ${error.message}\`, \`⚠️ ${error.message}\`);`
- Reachable codes on the remote stream path: `remote_brain_busy` (`RemoteEngine.ts:241`),
  `remote_brain_url_missing` / `remote_brain_https_required` (`RemoteEngine.ts:356` via
  `remoteUrlGateError`), `remote_brain_token_required` (`:362`), `remote_brain_sse_error`
  (`openaiTransport.ts:203`), `remote_brain_network` (`:334`), `remote_brain_timeout` (`:160`, `:341`),
  `remote_brain_http_<3-digit status>` (`:226`, `:310`).
- **What the string can contain:** only those fixed in-app codes. The server's own error text is
  never echoed into the thrown error — `loggableServerError` logs it and `emitFinish` throws the
  constant `new Error("remote_brain_sse_error")` (`openaiTransport.ts:195-207`). The URL is
  query-stripped and the token is a header, so neither can appear. This is a copy/contract
  violation, not a secret leak.
- Contradicts the module's stated rule: `remoteBrainErrors.ts:2-3`
  `Snake_case codes must never reach the UI, and neither must a native exception: anything
  unrecognised fails closed to human copy.`
- STEP2 item (10) admits this and defers it (branch `e657550`/`1d90e9e` outside the hunk table).
  If fixed by routing through `humanRemoteBrainError`, note `remote_brain_sse_error` is **missing**
  from `CODE_KEYS` (`remoteBrainErrors.ts:9-28`) and would fall to generic copy — add it.

### F7 — CONFIRMED, LOW — `selectRemoteComputer` renders a raw exception in the model error

`AppShell.tsx:4933` `setModelError(error instanceof Error ? error.message : String(error));`
in the catch, bypassing `humanRemoteBrainError`. The reachable errors here are storage/JS errors
(`setEngineBackendMode` → `AsyncStorage.setItem`), no token-bearing path was found, but the rule
above applies. Every other remote error site does humanize (`AppShell.tsx:4214-4216`,
`:6045-6047`), and `remoteInitErrorRef` is only ever read through `humanRemoteBrainError`
(`:3118`, `:4186`, `:6045`).

---

## 3. UI claims are promises — five hint items, one gate each

Hint: `en.ts:132-133` `"Use your computer as the model. Set its address below. Tools, memory
extraction, translation, embeddings and voice stay off in this mode."` (it mirror `it.ts:132-133`).

| promise | status | gate line |
|---|---|---|
| tools | HELD (structurally) | `AppShell.tsx:7052-7054` spread strips; `streamRemoteAssistantTurn` never reads `options.tools`/`executeTool`; research gated `AiChatPage.tsx:2458`, `:3649`, `:4210` |
| memory extraction | HELD | `engineBackend.ts:222` `if (isRemoteEngineBackend()) return Promise.resolve(remoteExtractMemory());`; no-op at `RemoteEngine.ts:489-497` |
| translation | HELD | `engineBackend.ts:229` `if (isRemoteEngineBackend()) return remoteTranslateText();`; no-op `RemoteEngine.ts:500-505`; UI gates `AiChatPage.tsx:3538`, `:4457` |
| embeddings | HELD | `AppShell.tsx:1635` job entry `if (isRemoteEngineBackend()) return;`; `:1889-1891` mid-job above `embedDocumentChunk` (`:1893`); `:2101-2103` rebuild refusal before index deletion |
| **voice** | **BROKEN** | **no gate exists** — see F2h below |

### F2h — CONFIRMED, MEDIUM — "voice stays off" is false; STEP2's "voice: step-1 gates" is wrong

`grep -rn isRemoteEngineBackend src --include=*.ts --include=*.tsx | grep -v .test. | grep -v remote/`
returns exactly: `RemoteBrainSettings.tsx:11,61`, `AiChatPage.tsx:85,2458,3538,3649,4210,4457`,
plus the facade. No voice file (`src/voice/{TtsService,VoiceCapture,WhisperService}.ts`) references
the backend, and `handleMicPress` (`AiChatPage.tsx:1516-1600`) has no remote check; the mic is
rendered through `ComposerActionRow` with no remote disable (`AiChatPage.tsx:4380`).
Consequence: voice capture + local Whisper still run in remote mode, and the transcript becomes a
message the user sends. Audio does not leave the phone (whisper.rn/expo-speech are local), so the
harm is a false privacy claim, not an egress path. Fix: gate the mic like translation, or reword
the hint (RECON/AUDIT-STEP1 both flagged the copy; only embeddings were addressed).

---

## 4. Bugs and edge cases

### F4 — CONFIRMED, MEDIUM — every remote turn re-probes the computer and flickers the bar to "loading"

- Send path awaits the ensure unconditionally: `AppShell.tsx:6021`
  `const ensure = await ensureEngineForModel(currentModel);`
- The remote branch has **no ready short-circuit**: `AppShell.tsx:4184-4191`
  ```
  if (captured.remote) {
    setModelState("loading");
    ...
    await setEngineBackendMode("remote");
    setRemoteActive(true);
    await initEngine("", REMOTE_COMPUTER_MODEL_ID, { locale, backend: "remote" });
  ```
  while the local path does short-circuit: `:4224-4227`
  `if (isEngineReady() && getActiveModelId() === model.id) { queueStaticPrefixPrewarm(...); return true; }`
- `initRemoteEngine` → `testRemoteConnection` (`RemoteEngine.ts:168`, `:103-118`) → GET `/props`
  then `/v1/models` (or `/health`). So ~2 extra HTTP round trips before every completion, a
  per-turn `setModelState("loading")`, and a transient probe failure aborts a turn even though the
  engine is ready. Same shape as branch `ce71e78cd` (fidelity OK), but it ships to main.
- If fixed, the config staleness must be handled: `ensureIntentKey` already includes `url|serverModel`
  (`ensureIntent.ts:104-110`), so keying the ready short-circuit on the intent (not the bare flag)
  keeps a URL/model edit from reusing a ready engine.

### F8 — PLAUSIBLE, LOW — boot's remote flip can be silently dropped, leaving the remote engine armed under a local backend

`setEngineBackendMode` refuses a conflicting switch intent by silent `return`:
`remoteSettings.ts:142-145` `if (backendWriteIntent != null && backendWriteIntent !== next) { return; }`.
Interleaving: boot remote branch runs `setRemoteActive(true)` then
`await setEngineBackendMode("remote")` (`AppShell.tsx:3027-3033`); if the user starts a local
switch in the boot window (model bar is interactive before `prefsReady`), the boot's remote write
no-ops. Then the probe effect (`:3984-3994`, `intentRemote: true, backendRemote: false`) calls
`ensure-remote` → the ensure's `setEngineBackendMode("remote")` is blocked by the local intent →
`initEngine(..., backend: "remote")` still runs (explicit backend) → remote engine `ready`,
`isEngineReady()` false (facade dispatches on the cache) → `modelState` "error" with no
`setModelError` copy (`:4193-4195`). Fail-closed for privacy (nothing goes remote), but a wedged
state until a switch changes the epoch. Not reachable by the plain select path (the ensure's
`stillCurrent()` refuses after the generation bump).

### F6 — CONFIRMED, MEDIUM — a hydration failure at boot overwrites the saved model id

`AppShell.tsx:3036` `await AsyncStorage.setItem(MODEL_STORAGE_KEY, decision.persistModelId);`
runs for every local decision, including `reason: "hydration-failed" | "stale-hydration" | "orphan"`,
for which `decideRemoteBoot` returns `defaultLocalModelId` (`remoteBoot.ts:35-42`). One transient
AsyncStorage read failure (or a Settings-panel hydration race) permanently demotes the user's model
selection to the default. STEP2 "Tension A" admits this; it is a regression against main's
read-only boot. Fix: persist only when the id came from storage (`saved-local`) or when the remote
demotion produced a real local id.

### F15 — CONFIRMED (minor) — `setState` after unmount / unhandled rejections

- boot catch calls `setRemoteActive(false)` / `setModelState(...)` without a `mounted` guard
  (`AppShell.tsx:3079-3088`); the `finally` does guard `prefsReady` (`:3089-3091`).
- `runEnsureEngineForModel` and the `remoteActive` effect (`:4035-4038`) have no mounted guard and
  no `.catch`; the ensure contract (`ensureEngineForModel` maps rejections to outcomes,
  `AppShell.tsx:4672-4679`) makes the missing catch safe today.
- `selectModel`'s pre-dispose catch rethrows (`AppShell.tsx:4865` `throw error;`) into a discarded
  promise — pre-existing main code, deliberately kept (comment at `:4856-4860`), practically
  unreachable (all awaits before it are `.catch`ed). Not a regression.
- New code adds no timers/listeners outside `InFlightEnsures.run`, whose deadline timer is
  cleared on settle (`ensureIntent.ts:139-168`); `disposeRemoteEngine` aborts the active stream
  (`RemoteEngine.ts:201-215`).
- `ENSURE_DEADLINE_MS = 120_000` (`AppShell.tsx:506`): on deadline the caller gets `"failed"`
  while the attempt keeps running (`ensureIntent.ts:139-168`), so a late success can still write
  `modelState: "ready"` after the UI already reported a generic failure. Rare; note only.

### F10 — stale-closure / null-model checks (no finding)

Deps arrays checked against reads: `selectRemoteComputer` `[ensureEngineForModel, modelState, t]`
reads only refs otherwise; `selectModelById` `[selectModel, selectRemoteComputer, t]` (+ stable
module helper); `selectModel` gained `remoteActive` and reads `engineIntentRef` (ref);
`ensureEngineForModel` `[runEnsureEngineForModel]`; `runEnsureEngineForModel` reads refs and has its
pre-existing deps. `currentModel = remoteActive ? REMOTE_COMPUTER_MODEL : MODEL_REGISTRY[modelIndex]`
(`:2812`) is in `handleSendStream`'s deps (`:7082`), so no stale model. `REMOTE_COMPUTER_MODEL` is
a constant `ModelInfo` (`remoteComputerModel.ts:15-38`), so no null model when `remoteActive` flips.

---

## 5. Test hygiene

- **No globals mutated without restore** in the new files. `remoteEngine.lifecycle.test.ts` installs
  `globalThis.fetch` at module scope and restores it unconditionally in `afterAll`
  (`:36-54`), resets `fetchMock` and `streamOpenAiChat` in `beforeEach` (`:146-160`) — the STEP1
  finding is closed.
- **F11 — CONFIRMED, LOW — untested promise.** `remoteExtractMemory` (`RemoteEngine.ts:489`),
  `remoteTranslateText` (`:500`), `remoteCompleteOnce` (`:507`) and their facade dispatches
  (`engineBackend.ts:222`, `:229`, `:236`) have **no test anywhere**:
  `grep -rn "remoteExtractMemory|remoteTranslateText|remoteCompleteOnce" src --include=*.test.ts`
  matches only the mock factory in `engineBackend.test.ts:37-44`. The "memory extraction,
  translation stay off" promise rests on read code, not on a pin. Three assertions in the existing
  facade test close it.
- **F12 — CONFIRMED, LOW — two pins are weaker than their table row.** `AppShell.remoteWiring.test.ts:68`
  `expect(shell).toContain("? { tools: undefined, executeTool: undefined }")` cannot detect an
  inverted condition (`!isRemoteEngineBackend()` passes the same string), and the embed proximity
  pin `expect(embedCall - gate).toBeLessThan(400)` (`:87`) would also pass with the gate text
  inside a comment. The file header honestly declares "LINE-LEVEL pins, not behaviour tests", and
  the real tools-off barrier is structural (the remote client has no tool loop) — but STEP2 lists
  this file under "Behaviour tests (real assertions)" for row (a) *and* under "Source pins", which
  is inconsistent. `engineBackend.test.ts` is a real behaviour test (real dispatch, `toBe` on the
  `memoryFacts` reference) and red-able.
- Failure-path cleanup weakness in the lifecycle suite: the rejected
  `getRemoteBrainToken` mock is restored inside the test body
  (`remoteEngine.lifecycle.test.ts:226-233`), not in `beforeEach`; if the assertion at `:232` fails,
  every later test inherits a rejecting mock. Minor, same class the previous fix addressed.

---

## 6. Dead code

- `isOrphanRemoteWithoutUrl` (`remoteSettings.ts:213-218`), re-exported by `engineBackend.ts:80`,
  is used nowhere in `src` outside its own definition (grep of `src` non-test): `decideRemoteBoot`
  re-implements the check as `url.trim().length > 0` (`remoteBoot.ts:44-51`). Either wire it or drop it.
- `switchDisposeUi`'s `reprobe` field and `afterRemoteSwitchDispose`'s `reprobe` / `inFlightReleased`
  fields (`modelIndexProbe.ts:50-83`) are never read; callers use `shouldReprobeAfterSwitch`
  (`AppShell.tsx:4845`) and `ui.surfaceError` / `ui.remoteActive` only. Inert surface.
- `remote.brain.token` log tag (`RemoteEngine.ts:420-423`) is misleading (payload is a char count).
- `isOrphanRemoteWithoutUrl` is the only dead production export found in the diff.

---

## 7. STEP2 claims vs evidence

- Hunk table: `git diff --numstat` says `src/app/AppShell.tsx 422 42`; STEP2 says "+464/−~30".
  Totals (+725/−79) are right; the per-file figures are not. Line anchors drift by ~3
  (tools spread is `:7052-7054`, not `:7049-7051`); the embed gate lines `:1635`, `:1889`, `:2101`
  are exact.
- "voice: step-1 gates" is false (F2h). "the other four items are already gated" is true.
- Item (10) correctly self-reports the raw-code display; the answer to "what can that string
  contain" is in F3 — fixed in-app codes only, never server text, URL or token.
- "the amended and unamended states have identical proofs" is not checkable (the amended sha is
  gone) — unverifiable claim, listed here rather than treated as evidence.
- The sabotage claims (facade dispatch, facts tail, embed entry gate) are plausible and
  red-able from the test text; not re-run (read-only, and re-running them would require edits).

---

## Findings, severity-ranked

| # | verdict | sev | finding |
|---|---|---|---|
| F1 | CONFIRMED | HIGH | Notes-store content is sent to the remote computer and is absent from the consent disclosure; block text says `LOCAL NOTES CONTEXT` (`AppShell.tsx:6119-6121`, `:477`; `AiChatPage.tsx:3658-3661`, `:4225-4229`; `en.ts:134-135`) |
| F3 | CONFIRMED | MEDIUM | raw `remote_brain_*` codes rendered in chat via `⚠️ ${error.message}` (`AppShell.tsx:7041`), against `remoteBrainErrors.ts:2-3` |
| F2h | CONFIRMED | MEDIUM | hint claims voice "stays off"; no voice gate exists (grep evidence; `AiChatPage.tsx:1516`) |
| F4 | CONFIRMED | MEDIUM | remote ensure re-probes the computer every turn (no ready short-circuit, `AppShell.tsx:4184-4191` vs local `:4224-4227`) |
| F6 | CONFIRMED | MEDIUM | boot overwrites the saved model id with the default on a hydration failure (`AppShell.tsx:3036`, `remoteBoot.ts:35-42`) |
| F9 | CONFIRMED | LOW | attachments accepted and silently dropped in remote mode (`openaiMessages.ts:8-29`; attach sheet ungated) |
| F7 | CONFIRMED | LOW | raw exception shown in the model-error line from `selectRemoteComputer` (`AppShell.tsx:4933`) |
| F8 | PLAUSIBLE | LOW | boot's remote flip can be silently refused by a conflicting switch intent, arming a remote engine under a local backend (`remoteSettings.ts:142-145`, `AppShell.tsx:3027-3033`) |
| F11 | CONFIRMED | LOW | no test pins the memory-extraction/translation/completeOnce no-op dispatch |
| F12 | CONFIRMED | LOW | two source pins are weaker than the STEP2 table implies; the file is listed as behaviour and as source pins |
| F15 | CONFIRMED | LOW | setState-after-unmount shape in the boot catch / ensure paths; 120 s ensure deadline can report failure while the attempt later succeeds |
| F13 | CONFIRMED | LOW | dead exports/fields: `isOrphanRemoteWithoutUrl`, `reprobe`/`inFlightReleased` |
| F10b | CONFIRMED | INFO | report arithmetic: AppShell +422/−42, not +464/−30 |
| F2 | REFUTED | — | remote turn before the disclosure was ever shown (every persistent remote target comes from the panel button under the disclosure) |
| F16 | REFUTED (no defect) | — | Authorization only over https or loopback; token never in logs, errors or URL |

**FIX-FIRST** — minimum set before merge:
1. F1: gate `sendOpts.notes` on `isRemoteEngineBackend()` and/or add Notes to
   `remoteBrainDisclosure`; fix the `LOCAL NOTES CONTEXT` label for a remote-capable build.
2. F3: humanize the stream `onError` copy (add `remote_brain_sse_error` to `CODE_KEYS` if routing
   through `humanRemoteBrainError`).
3. F2h: gate the mic in remote mode or reword the hint so it stops promising voice is off.
4. F4/F6 are behaviour fixes with small diffs and should ride along; F9/F7/F11/F13 are follow-ups.

---

## Re-audit (77f487a65)

Delta: `git diff ec6a22592 77f487a65` — 14 files, +188/−65 (`git diff --numstat` matches STEP2).
HEAD `77f487a65889b9d15cc145e075905d64a4fe428e`, `git status --porcelain` = 0. STEP2 "Fix round 1"
read as claims; every quote below is from the file text at 77f487a65.

```
npx tsc --noEmit > /tmp/s2b2-tsc.log 2>&1; echo $?      → 0 (0-line log)
npx jest src/app src/engine/remote src/engine/engineBackend src/screens/RemoteBrainSettings --runInBand > /tmp/s2b2-jest.log 2>&1; echo $?
                                                        → 0  (23 suites, 236 tests)
```

### Earlier findings

| # | status | evidence |
|---|---|---|
| F1 notes | **CLOSED** | `en.ts:134-135` `"To answer, your computer receives the conversation: messages, notes you attach, memory, summaries and document names."`; it mirror `it.ts:133-134`. Both literals pinned (`RemoteBrainSettings.disclosure.test.ts:148-157`). Feature untouched per owner. |
| F3 raw codes | **CLOSED** | stream `AppShell.tsx:7090-7093` `const shown = error.message.startsWith("remote_brain_") ? humanRemoteBrainError(error.message, t) : error.message;`; `selectRemoteComputer` `:4977-4979` same gate; `remote_brain_sse_error` mapped (`remoteBrainErrors.ts:16-18`), asserted in `remoteBrainErrors.test.ts:41-43`. |
| F2h voice claim | **CLOSED** | hint `en.ts:132-133` now `"...translation, embeddings stay off in this mode."`; it mirror. Trace verified below. |
| F4 re-probe | **CLOSED** | `AppShell.tsx:4209-4212` `if (isEngineReady() && getActiveModelId() === REMOTE_COMPUTER_MODEL_ID) { return true; }` sits before `setModelState("loading")` (`:4215`). Safe: the ready flag is config-agnostic and the request reads `getRemoteBrainUrl()`/`getRemoteServerModelId()` fresh (`RemoteEngine.ts:395-396`); `stillCurrent()` (`:4206`) is immediately above with no await in between. |
| F6 hydration overwrite | **CLOSED** | boot persist narrowed `AppShell.tsx:3046-3048` `if (decision.reason === "orphan" && saved === REMOTE_COMPUTER_MODEL_ID) { await AsyncStorage.setItem(...) }`; catch is read-only `:3088-3091` and aligns intent/cache on recovery failure (`:3096-3109`). |
| F9 attachments | **PARTIAL** | `onComposerAttach` gated (`AiChatPage.tsx:3631-3641`); the library-document chip is not: `onComposerDocument` (`:3671-3678`) opens `docPickOpen` (chip `:4219-4227` has no remote term), the `attachLibraryDoc` effect (`:3732-3737`) and the docx import (`:1749`) attach directly. Content sent in those paths is still only `[document:id name]` (disclosed) or nothing (images dropped), so no undisclosed egress; the "attachments cannot travel this backend" note covers the attach sheet only. Pre-armed attachments (coder's admitted edge) travel with the same content profile. |
| F7 raw exception | **PARTIAL** | `:4977-4979` humanizes only `remote_brain_`-prefixed messages; a non-prefixed JS/storage exception still renders raw in `modelError` (`:4979` `: raw`). No token/URL path found; the module rule ("neither must a native exception", `remoteBrainErrors.ts:37-39`) is still not fully met. |
| F13 dead code | **CLOSED** | `grep isOrphanRemoteWithoutUrl|inFlightReleased|\.reprobe` over `src` → empty; re-export removed (`engineBackend.ts`), `modelIndexProbe.ts:52-79` shapes reduced, `remoteSettings.test.ts` virgin-storage case keeps its live assertions. Residual nit: `remote.brain.token` still logs a length (`RemoteEngine.ts:420-423`) — admitted, not named in the item. |
| F15 unmount/deadline | **OPEN (unchanged)** | no delta: boot catch still setStates without a mounted guard (`:3093-3109`), ensure has none, `ENSURE_DEADLINE_MS = 120_000` can report failure while the attempt later succeeds. Low, not claimed fixed. |

**Voice trace (owner's premise) — CONFIRMED.** `handleMicPress` (`AiChatPage.tsx:1516`) → `startCapture` / `stopAndTranscribe` (`:1355`) → `ensureDefaultWhisper` (`:1376`) + `transcribePcm(pcm, locale)` (`:1378`) → `setDraft` (`:1385-1391`) → ordinary send. `src/voice/*.ts` imports only whisper.rn (`whisperRn.ts`), `ModelDownloader`/`ModelRegistry` (`WHISPER_MODEL`), i18n, expo-speech, the PCM stream and RN permissions — no `LlamaService`, no `engineBackend`, no network. Dictation needs no chat LLM; its text crosses only if the user sends it, as a message (disclosed).

### New findings

- **N1 — PLAUSIBLE, LOW — boot's remote-intent write can clobber a live local switch.** Boot remote branch writes `engineIntentRef.current = { modelId: REMOTE_COMPUTER_MODEL_ID, remote: true }` (`AppShell.tsx:3032-3036`) without checking `modelSwitchInFlightRef`; `selectModel` writes its local intent synchronously at the start (`:4751-4755`). If a tap lands in boot's hydration window, boot overwrites the intent back to remote, its `setEngineBackendMode("remote")` is refused by the live `beginBackendSwitch("local")`, the switch completes local, then its epoch bump (`:4883-4887`) runs the probe with `intentRemote: true` → `ensure-remote` (`:4012-4018`) → the app flips back to remote against the tap. Needs two taps inside the boot window (cold start, ms-scale): reasoned from code, not observed. One-line guard (`modelSwitchInFlightRef.current` check in the remote branch) closes it.
- **N2 — CONFIRMED, LOW (test hygiene) — the new stream-humanize pin cannot go red on an inversion.** `AppShell.remoteWiring.test.ts:112-117` asserts `toContain('startsWith("remote_brain_")')`, `toContain("humanRemoteBrainError(error.message, t)")`, `toContain("⚠️ ${shown}")`, `not.toContain("⚠️ ${error.message}")`. The inverted ternary (`? error.message : humanRemoteBrainError(...)`) satisfies all four. The sabotage that was run (revert to `${error.message}`) does go red; the inversion does not.
- **N3 — REFUTED — humanization leaking server text, URL or token.** `humanRemoteBrainError` returns only translation keys, or `settings.remoteBrainFailServer` with `{status}` from `/^remote_brain_http_(\d{3})$/`, else generic (`remoteBrainErrors.ts:41-57`) — it never echoes its input. Every reachable `remote_brain_*` message is app-constructed (`RemoteEngine.ts:241`, `:356`, `:362`; `openaiTransport.ts:160`, `:203`, `:226`, `:310`, `:334`, `:341`), and the SSE server text is discarded before the throw (`openaiTransport.ts:195-207`). The prefix gate leaves non-remote messages byte-identical to before.
- **N4 — REFUTED — the dispose-failure wedge (intent local over a remote cache).** `switchDisposeUi(disposeOkInner)`'s `surfaceError` branch skips `setEngineBackendMode("local")` (`AppShell.tsx:4854-4862`), but it can only be reached with a remote cache when `disposeRemoteEngine()` fails, and that function has no throw path (`RemoteEngine.ts:201-215`: generation bumps, a try/caught `abort`, field resets). With a local cache the intent and cache already agree. The throw branch is the one the new alignment covers.
- **N5 — CONFIRMED, INFO — disclosure coverage.** Re-walked at 77f487a65: every user-content item on the wire is now named — messages (`AppShell.tsx:6930-6949`, `:6968-6977`), notes (`:6166-6169`), facts (`RemoteEngine.ts:373-377`, `:396-402`), digest/summary (verbatim older messages + rolling summary, covered by "messages"/"summaries"), document names (`AiChatPage.tsx:2452`). Attachments are gated (F9, PARTIAL above). Residual: document **ids** ride with the names (`[document:<id> name=...]`); ids are opaque and were accepted as within "document names" in the first audit. No gap found.
- **Test hygiene, new tests.** No globals added; the disclosure file's pre-existing `IS_REACT_ACT_ENVIRONMENT` restore and `console.error` spy are untouched by the +19 lines; `engineBackend.test.ts`/`remoteSettings.test.ts` changes are deletions only; no `.only`/`.skip`/debug leftovers in the diff; `git status` clean, so no sabotage residue in the tree. The remaining weak pins (N2, and the proximity regexes in "failure paths agree intent with the backend cache") are declared line-level pins.

**Verdict: SHIP-WITH-FIXES.** All three FIX-FIRST items from the first round are closed on the merits (notes disclosed per owner, remote codes humanized at every display site, voice claim removed and the trace verified). The privacy re-walk finds no undisclosed category. Remaining are low follow-ups: N1's one-line boot guard, the F9 attach-gate gaps (doc chip / `attachLibraryDoc` / docx), the F7 non-prefixed-exception copy, and N2's pin strength.

---

## Re-audit 2 (0fa9bde99)

Delta: `git diff 77f487a65 0fa9bde99` — 10 files, +204/−24 (`git diff --numstat` matches STEP2).
HEAD `0fa9bde994fbe2d15ae93b96563496b54d941e7e`, `git status --porcelain` = 0.

```
npx tsc --noEmit > /tmp/s2b3-tsc.log 2>&1; echo $?     → 0 (0-line log)
npx jest src/app src/engine/remote src/engine/engineBackend src/screens/RemoteBrainSettings --runInBand > /tmp/s2b3-jest.log 2>&1; echo $?
                                                       → 0 (23 suites, 242 tests)
```

### Open items from re-audit 1

| # | status | evidence |
|---|---|---|
| F9 attach paths | **CLOSED** | `addPdfAttachment` gate `AiChatPage.tsx:1714-1718` (owns the docx branch at `:1753`, the only caller of `importAndAttachDocxRef.current`); `onComposerDocument` gate `:3676-3679` (only `setDocPickOpen(true)` site, `:3685`); share effect gate `:3744-3749` (`attachLibraryDoc` is the only consumer, prop passed at `AppShell.tsx:7461`). With round 1's `onComposerAttach`, every `setAttachSheetOpen(true)` (`:3645`), `setDocPickOpen(true)` and `addLibraryDocumentAttachment` caller (`:3750`, `:3854` only reachable via the gated picker, `:4684` only via the gated chip) is behind a remote gate. |
| F7 non-prefixed exceptions | **CLOSED** | `AppShell.tsx:4991` `setModelError(humanRemoteBrainError(raw, t));` — unconditional, no raw branch left. Nit: a storage failure now renders the remote-flavoured generic copy ("Could not reach your computer"); rule-compliant, less actionable. |
| N1 boot vs in-flight switch | **CLOSED** | `AppShell.tsx:3035` `if (modelSwitchInFlightRef.current) return;` after `decideRemoteBoot` and before either branch; `prefsReady` still releases in the `finally`. |
| N2 pin strength | **CLOSED** | `AppShell.remoteWiring.test.ts:112-121` now matches the full ordered ternary `/error\.message\.startsWith\("remote_brain_"\)\s*\?\s*humanRemoteBrainError\(error\.message, t\)\s*:\s*error\.message/`; the inversion (T11) fails it. |

### Privacy — pre-armed attachments kept across a switch

Walked at 0fa9bde99: a library document pre-armed on a local draft reaches the wire as
`[document:<id> name="<name>"]` (`AiChatPage.tsx:2452` → user text), i.e. **names** (disclosed) plus an
opaque `doc-<base36>-<rand>` id (`importSharedDocument.ts:38`); images and PDF page URIs are dropped
by `toOpenAiMessages:8,17-29` (role/content only), and no path injects attachment text into the
prompt (`requestPdfText` is called only by the off `document_chat` and the library import). Notes
are named. **R2-P — REFUTED as a disclosure gap:** nothing undisclosed is sent by the KEEP policy;
the only residual is the document id, already accepted in audit 1 as within "document names".

### Secrets — does any original exception text still escape?

- **Log:** no. The outer catch (`RemoteEngine.ts:476-490`) has no logging; the only remote logs are
  init/stream/token metadata (`:187-194`, `:420-423`, `:458-462`) and the SSE code+bytes line.
- **Chat:** the boundary maps unknown messages to `remote_brain_internal`, which the AppShell prefix
  gate humanizes to generic copy. The installed `expo-secure-store` throws sentences ("Could not
  parse the encrypted JSON item…"), so the demonstrated SecureStore path is covered.
- **`remoteInitErrorRef`:** **yes, raw text still lands there** — `AppShell.tsx:4248`
  `remoteInitErrorRef.current = raw` (fed by `testRemoteConnection`'s catch, which returns
  `err.message` verbatim). Every read is through `humanRemoteBrainError` (`:6103`), which never
  echoes, so this is a stored string, not a display or log leak.
- **R2-1 — PLAUSIBLE, LOW — the boundary pass-through is broader than the display gate.**
  `RemoteEngine.ts:482-488` passes a message through when `isInternalErrorCode(message)`; that regex
  is `/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/` (`remoteBrainErrors.ts:34`), which also accepts non-prefixed
  tokens (`node -e` check: `not_found` → true, `err_secure_store` → true). AppShell's gate
  (`:7101`) humanizes only `startsWith("remote_brain_")`, so such a message would render
  **verbatim** in the chat bubble — contradicting STEP2 item 5's "every error leaving the remote
  path carries the `remote_brain_` prefix". No producer was demonstrated in the installed dependency
  (its messages are sentences), hence PLAUSIBLE; the new lifecycle test uses `"keystore exploded"`
  (spaces) and cannot catch it. Fix: gate the boundary on `startsWith("remote_brain_")`.

### Bugs — `setRemoteConfigChangedHook` (`remoteSettings.ts:49-53`, registered `RemoteEngine.ts:50-52`)

- **Registered once:** yes — one module-load call, `setRemoteConfigChangedHook(() => { ready = false; })`.
  `setRemoteConfigChangedHook(null)` is never called (grep: definition + registration only).
- **Can it fire during a stream:** yes, and it is safe — the stream captured `base` and the token
  before the await (`RemoteEngine.ts:248`, `:370`), so an edit does not redirect or abort it; it only
  drops readiness so the next ensure re-probes. Consequence: the model bar can show a mismatch
  (`getActiveModelId()` returns null while `modelState` stays "ready") until the next ensure.
  Cosmetic.
- **R2-2 — PLAUSIBLE, LOW — the hook does not invalidate an in-flight init.** The hook sets only
  `ready = false`; `initRemoteEngine`'s `ready = true` after the probe (`:193`) wins if the URL or
  server model changed mid-probe, with no config re-check before the assignment. Result: readiness
  validated against the previous server. Traffic still goes to the freshly-read URL and the new
  model id, so the mismatch surfaces as a server error, not a silent misroute. Fix: bump
  `initGeneration` in the hook (the in-flight init then throws `supersededInitError`).
- **R2-3 — CONFIRMED, INFO — test-side registration fragility.** Three files partially mock
  `remoteSettings` without the new export (`RemoteBrainSettings.hydration.test.ts:70`,
  `RemoteBrainSettings.disclosure.test.ts:74`, `engineBackend.test.ts:49`). They are safe only
  because each also mocks `engineBackend`/`RemoteEngine`, so the real `RemoteEngine` never loads. A
  future test that imports the real RemoteEngine through a partial mock will crash at module load.
  A defensive `setRemoteConfigChangedHook?.(...)` or an added key in those factories hardens it.

### Bugs — rebuild guard

`AppShell.tsx:4938-4943` `if (semanticRebuildInFlight || isDeleteActive()) { Alert.alert(...); return; }`.
The delete half is synchronous (`tryAcquireDelete` → `releaseDelete` in a `finally`), and the handoff
to the embed pass is synchronous: `releaseDelete(); … setSemanticRebuildInFlight(true);
void scheduleBackgroundEmbed(entry)` (`:2145-2152`), whose async body sets `embedJobInFlightRef`
before its first await — so the round-1 interleaving is closed.
- **R2-4 — CONFIRMED (narrow), LOW — the state half is not synchronous.** `semanticRebuildInFlight`
  is React state read from `selectRemoteComputer`'s render-time closure; `isDeleteActive()` is
  already false at the handoff. A tap processed before React re-renders with `true` takes the stale
  `false`, switches to remote, and the round-1 mid-job gate aborts the embed after the index was
  deleted. Window is ms-scale; `embedJobInFlightRef` is set before the yield, so exposure is the
  pre-render gap only.
- Nit: the guard reuses `switchWhileStreamingTitle/Body` ("Response in progress") for a rebuild —
  misleading copy.

### Other regression checks

- **`remoteBoot.ts:47`** `const wantsRemote = input.backend === "remote";` — the deleted disjunct is
  covered by the new behaviour test (`remoteBoot.test.ts:105-127`); the only existing
  `savedModelId: REMOTE_COMPUTER_MODEL_ID` cases (`:37`, `:94`) both pass `backend: "remote"`, so
  nothing pinned the old rule. The model key is now ignored toward remote, which removes the
  flip-flop; the orphan persist (`AppShell.tsx:3046-3048`) still demotes a stored remote id.
- **Hint copy** `en.ts:133` now has the "and"; the disclosure test pins the exact literal
  (`RemoteBrainSettings.disclosure.test.ts:159-168`).
- **No sabotage residue:** no `.only`/`.skip`/debug lines in the diff; `git status` clean.
- **New tests:** 6 (236→242). The two lifecycle tests are real behaviour (readiness invalidation;
  `keystore exploded` → `remote_brain_*` + generic copy). The `remoteWiring` additions are declared
  source pins; the N2 one is now order-sensitive, the N1/attach/rebuild ones use proximity regexes
  as declared. Hook cleanup is absent but moot per Jest's per-file module registry.

**Verdict: SHIP-WITH-FIXES.** F9, F7, N1 and N2 are closed on the merits; the pre-armed KEEP policy
puts only disclosed content on the wire, and no secret reaches a log or the chat. Two small
hardening fixes are worth doing first: tighten the boundary pass-through to `startsWith("remote_brain_")`
(R2-1) and bump `initGeneration` in the readiness hook (R2-2); R2-4 is a ms-scale residual, R2-3 a
test-side fragility note.

---

## Re-audit 3 (d7d33e90f)

Delta: `git diff 0fa9bde99 d7d33e90f` — 8 files, +245/−26 (`git diff --numstat` matches STEP2).
HEAD `d7d33e90f554c3176655b82818ebaedfbfd50b38`, `git status --porcelain` = 0.

```
npx tsc --noEmit > /tmp/s2b4-tsc.log 2>&1; echo $?     → 0 (0-line log)
npx jest src/app src/engine/remote src/engine/engineBackend src/screens/RemoteBrainSettings --runInBand > /tmp/s2b4-jest.log 2>&1; echo $?
                                                       → 0 (23 suites, 247 tests)
```

### Open items from re-audit 2

| # | status | evidence |
|---|---|---|
| R2-1 boundary prefix | **CLOSED** | `RemoteEngine.ts:489-497` `const ours = failure.message.startsWith("remote_brain_") \|\| control.code === "interrupted" \|\| control.superseded === true; finishOnce(ours ? failure : new Error("remote_brain_internal"));` — the `isInternalErrorCode` import is gone; `not_found` is a behaviour case (`remoteEngine.lifecycle.test.ts:975-1012`). Residual R3-3 below. |
| R2-2 `initGeneration` | **CLOSED** | `RemoteEngine.ts:50-55` hook `ready = false; initGeneration += 1;`; `initRemoteEngine`'s post-probe check throws `supersededInitError`; test `remoteEngine.lifecycle.test.ts:889-916` asserts `isSupersededRemoteOp(err)` and `isRemoteEngineReady() === false`. |
| R2-4 rebuild flag timing | **CLOSED** | `AppShell.tsx:1199` `const semanticRebuildBusyRef = useRef(false);`, set `:2157` in the same sync stretch as `releaseDelete()` (no await between), cleared `:2160`; both guards read the ref (`:4957` selector, `:3050` boot); `semanticRebuildInFlight` kept only for the UI prop. Residual R3-1 below. |

### Privacy and secrets re-walk

- **Boundary (`RemoteEngine.ts:489-497`) — REFUTED as a leak.** Only in-repo codes
  (`remote_brain_*`) and the two control markers cross; anything else collapses to
  `remote_brain_internal` → AppShell humanizes → generic copy. No thrown message can carry the
  token (it is a header, and every thrown URL is query-stripped); the only `code: "interrupted"`
  producer is the module's own error at `:386-388` (human copy), and it goes straight to
  `finishOnce` without traversing the catch.
- **URL and model captured once per turn — REFUTED as a mix.** `RemoteEngine.ts:251` `const base = getRemoteBrainUrl();` and `:256` `const serverModel = getRemoteServerModelId();` sit before the token await; the request uses `joinRemoteApiUrl(base, "/v1/chat/completions")` and `model: serverModel` (`:414-415`). `maxTokens`/`temperature` (`:423-424`) are read live but are not server identity. The mid-turn edit test (`:918-973`) asserts the pre-edit model + `127.0.0.1:8000` survive an edit to `new-model` + `:9300`.
- **Rebuild copy — REFUTED as a problem.** `en.ts:199-201` "Index rebuild in progress" / "Switch to your computer after the document index finishes rebuilding."; `it.ts:198-200` mirror; locale parity is a type ratchet (`it: typeof en`), the branch uses them (`AppShell.tsx:4961-4964`) and keeps the streaming alert for the stream/regen guard; literals pinned (`RemoteBrainSettings.disclosure.test.ts:196-209`); no false "Continue?".

### New findings (all FOLLOW-UP unless stated)

- **R3-3 — PLAUSIBLE, FOLLOW-UP (LOW, secrets/copy).** A *thrown* error carrying
  `code: "interrupted"` with arbitrary text crosses the boundary verbatim, and the AppShell gate
  (`AppShell.tsx:7123`) humanizes only `remote_brain_`-prefixed messages, so such text would render
  raw. No in-repo producer: the marker at `RemoteEngine.ts:386-388` is passed directly to
  `finishOnce` and never thrown, so the clause is defensive. The `superseded` clause is the same
  shape (`supersededInitError` is thrown by `initRemoteEngine`, not the stream). No secret trace:
  the message would be native text, and the token is never in one. If tightened later, gate the
  control markers on a message that is already user copy.
- **R3-1 — PLAUSIBLE, FOLLOW-UP (LOW, availability).** `semanticRebuildBusyRef` clears only when
  `scheduleBackgroundEmbed` settles (`AppShell.tsx:2159-2161`). A hung embed job (a pre-existing
  wedge class — `embedJobInFlightRef` has the same property) would now also permanently refuse the
  remote switch (`:4957`) and make every boot skip its application (`:3050`). No new evidence of
  reachability; a hung job already blocks indexing.
- **R3-2 — CONFIRMED, FOLLOW-UP (LOW, boot UX).** The compound boot guard returns before *both*
  branches when `isDeleteActive()`/rebuild/switch is live during hydration (`AppShell.tsx:3048-3053`),
  so that launch skips `pickStartModel`, the orphan persist and the migrated/load-set-aside
  notices and runs the default local model. No persisted write, no data loss; next launch re-reads
  the stored choice. Window is ms-scale and needs a user-triggered delete/rebuild/switch inside it.
- **R3-4 — CONFIRMED, INFO (test scope).** `AppShell.remoteWiring.test.ts` now reads
  `remoteSettings.ts` and `RemoteEngine.ts` (`:157-178`), extending a file whose header scopes it to
  AppShell wiring. Declared line-level pins; no defect.

### Test hygiene (8 sabotage cycles)

- 5 new tests (242→247): `remoteEngine.lifecycle.test.ts:889` (probe supersession), `:918`
  (mid-turn identity), `:975` (boundary both halves), `AppShell.remoteWiring.test.ts:129`
  (ref-not-state + own copy), `:150` (compound boot guard), `:157` (hook order + `initGeneration`),
  `RemoteBrainSettings.disclosure.test.ts:196` (copy literals).
- Pins are order-sensitive where claimed: the config-setter regex requires
  `onRemoteConfigChanged?.();` immediately before `await commit(...)` (`C3` red if moved after), the
  boot regex requires the three-part condition (`C1`), the engine regex requires `initGeneration += 1`
  (`C4`), the rebuild-branch regex rejects `switchWhileStreamingTitle` (`C6`), and the N2 ternary
  regex remains inversion-safe (`C8`'s boundary test covers `not_found` → `remote_brain_internal`
  and the marker pass-through).
- Residue: `git status` clean; no `.only`/`.skip`/debug lines in the delta; the two
  `mockImplementationOnce` hooks are one-shot and consumed before the assertions
  (`remoteEngine.lifecycle.test.ts:895`, `:926`), and `beforeEach` resets `fetchMock` and
  `streamOpenAiChat`. The interrupted-marker half of the boundary test injects a synthetic error
  (no real throw-path producer), which is legitimate for a pure transform but should be read as a
  boundary unit test, not an end-to-end path.

**Verdict: SHIP-WITH-FOLLOW-UPS.** No BLOCKER: no privacy or secret leak, no data loss on a normal
path, no crash, no main-invariant regression (tsc 0, 247 tests green). R2-1/R2-2/R2-4 are closed on
the merits. R3-3, R3-1, R3-2, R3-4 are recorded follow-ups only; the coordinator's accepted (a)-(d)
are not re-raised.

---

## Re-audit 4 (a8e5f5d77)

Delta: `git diff d7d33e90f a8e5f5d77` — 2 files, +60/−38 (`git diff --numstat`: AppShell +44/−35,
`AppShell.remoteWiring.test.ts` +16/−3). HEAD `a8e5f5d77a695f4a011197bb2c3fdc1d634d06dc`, tree clean.

```
npx tsc --noEmit > /tmp/s2b5-tsc.log 2>&1; echo $?     → 0 (0-line log)
npx jest src/app src/engine/remote src/engine/engineBackend src/screens/RemoteBrainSettings --runInBand > /tmp/s2b5-jest.log 2>&1; echo $?
                                                       → 0 (23 suites, 247 tests)
```

### 1. R3-2 (busy rebuild skipped the local restore) — CLOSED

The guard is split. `AppShell.tsx:3045` keeps `if (modelSwitchInFlightRef.current) return;`. The
rebuild/delete check moved inside the remote decision only:

```
3052:          const rebuildBusy =
3053:            semanticRebuildBusyRef.current || isDeleteActive();
3054:          if (!rebuildBusy) {
```

and the `else` branch (local decision) is unconditional:

```
3063:        } else {
3064:          await recoverLocalBackend();
```

A `decision.kind === "local"` boot therefore always falls through to the shared restore at
`:3074-3130` (`setRemoteActive(false)` → `restoreId` → `pickStartModel` → `findIndex` → intent and
index). The saved non-default local model is restored exactly as in main, whether the rebuild ref
is busy or not. Luna's blocker case is gone.

### 2. Deferred-remote path feeding the raw `saved` id — no blocker, all four hazards walk clean

`RemoteEngine`-style remote traffic is not started: the deferred path writes neither
`setEngineBackendMode("remote")` nor the intent; `setRemoteActive(false)` runs at `:3074`, the
intent stays the initial `{modelId: MODEL_REGISTRY[modelIndex]?.id, remote: false}`, and the probe
effect's `decideModelIndexProbe` sees `backendRemote === false`, `intentRemote === false` →
`probe-local`. No `/props`, no `/v1/models`.

- **Crash: none.** `restoreId = decision.kind === "local" ? decision.persistModelId : (saved ?? getDefaultModel().id)`
  (`:3080-3082`) is always a string; the only consumers are `readLoadMarker` (an AsyncStorage read,
  errors swallowed at the call site) and `MODEL_REGISTRY.findIndex`.
- **Bad index: none.** `pickStartModel` (`loadMarker.ts:91` `if (!(await input.isMarked(input.savedId))) return input.savedId;`)
  returns the raw saved id; `AppShell.tsx:3106-3107` `const startIndex = MODEL_REGISTRY.findIndex(...);
  if (startIndex < 0 || startIndex === modelIndexRef.current) return;` — for `REMOTE_COMPUTER_MODEL_ID`
  the index is `-1` (the remote row is not in the catalog: `ModelRegistry.ts:208` array, `:395` only
  `getModelById` maps it; `grep kalsa-remote-mac src/engine/devModelCatalog.ts` = 0), so boot returns
  before touching intent/index. If `saved` is a real local id, the index is valid and the model is
  restored — the intended fix.
- **Load marker for the remote id: none.** `pickStartModel` only reads via `isMarked`
  (`loadMarker.ts:91-94`); `writeLoadMarker` runs only through `guardedLoad` (`AppShell.tsx:4623`
  local ensure, `:5426` download path), and `writeLastGoodModelId` only at `:4694`/`:5492` after a
  successful local load — all with registry ids. `readLoadMarker(store, "kalsa-remote-mac")` reads
  `kalsa.load.dead.kalsa-remote-mac`, a harmless miss.
- **Marker/lastGood fallback messages: unchanged from main.** `pickStartModel` returns
  `lastGood`/`default` only when `isMarked(saved)` is true; for the remote id no marker can exist
  (above), so it returns the remote id and boot returns at `startIndex < 0` — no `loadSetAside`,
  matching the coder's "default stands silently". For a saved local id the `startId !== restoreId`
  path (`:3108`) is exactly main's `startId !== saved` shape.
- **Cache coherence.** The deferred path assumes `backendCache === "local"` without calling
  `recoverLocalBackend()`: true today — `remoteSettings.ts:32` `let backendCache: EngineBackendMode = "local";`
  and `:235` "Read-only snapshot. Does not write backendCache". No write intent can be pending
  either: `beginBackendSwitch` is always set with `modelSwitchInFlightRef = true`, which returned
  earlier.

### 3. Other delta

The only other change is the rewritten boot pin (`AppShell.remoteWiring.test.ts:150-168`): it
asserts the N1 one-liner, the absence of the blanket compound guard, `rebuildBusy` inside
`if (decision.kind === "remote")`, and the `restoreId` fallback feeding `pickStartModel`. The
`not.toMatch` is safe against the selector guard at `:4957` (that conjunction is >80 chars from a
`modelSwitchInFlightRef.current |`). Sabotage claim (reinstating the blanket guard → red) is
consistent with the pin text.

### Findings (strict classification)

- **No BLOCKER.** No privacy/secret leak (no new I/O, no new copy, no remote call), no data loss
  (nothing written on the deferred path; the stored choice survives), no crash (walked above), no
  main-invariant regression (the local restore is main's shape; the `restoreId` fallback matches
  main's `savedId: saved` for the deferred case).
- **R4-1 — FOLLOW-UP (LOW, UX).** A deferred remote boot (rebuild/delete or switch busy during
  hydration) boots local with no notice that the remote choice was skipped for this launch; the
  user must relaunch. Pre-existing from round 3, now narrower. `AppShell.tsx:3049-3058`.
- **R4-2 — FOLLOW-UP (LOW, robustness).** The deferred path relies implicitly on the backend cache
  being the process default `"local"` (`remoteSettings.ts:32`); it skips `recoverLocalBackend()`.
  True today (hydrate never writes the cache, no pre-boot writer), but an explicit
  `recoverLocalBackend()`/assert would make the assumption self-defending.
- **R4-3 — FOLLOW-UP (INFO, test).** The fix's core behaviour (local restore with a rebuild busy)
  remains source-pinned only — AppShell cannot render under node jest. The pin covers the text;
  no behaviour test exists for the deferred path, as STEP2's untested list states.

**Verdict: SHIP-WITH-FOLLOW-UPS.** R3-2/luna's BLOCKER is closed, the deferred-remote path is safe
on all four asked hazards, and no new blocker was found. R4-1..R4-3 are recorded only.
