# Hostile audit — Step 1 remote-brain port

Audited detached commit 5780add6daa751ef9600e7e22e573a8e93490853, parent e206a945bf39610681bc50b989f5a4d179a0b889, against ce71e78cd4b9bb59dbd1422ed9f4a173bd8b460b.

The subject worktree was clean before the authorized disclosure-test mutation and is clean after restoration. src/app/AppShell.tsx is byte-identical to the parent (git diff --quiet e206a945b 5780add6d -- src/app/AppShell.tsx exit 0). The disclosure block was removed only from src/screens/RemoteBrainSettings.tsx for the negative test, then restored using git checkout -- src/screens/RemoteBrainSettings.tsx. No other worktree was touched.

## 1. Provenance and scope

**Verdict: REFUTED as a two-exception byte-identity claim; CONFIRMED for the stated 40-file scope and the coder's actual 37/3 accounting. CONFIRMED: no branch changes from the excluded directories landed.**

STEP1.md itself says: “37 landed byte-identical (A ); 3 needed drift fixes inside the copied file (AM), marked [FIX].” That is what the required per-path checks show. The two-file exception formulation omits src/screens/RemoteBrainSettings.tsx, which also differs.

I ran git diff --quiet ce71e78cd 5780add6d -- <path> for each of the following 40 paths. Exit 0 means byte-identical; exit 1 means different:

| Path | Result |
|---|---|
| src/engine/remote/RemoteEngine.ts | exit 1 — DIFF |
| src/engine/remote/latestSave.test.ts | exit 0 — SAME |
| src/engine/remote/latestSave.ts | exit 0 — SAME |
| src/engine/remote/openaiMessages.test.ts | exit 0 — SAME |
| src/engine/remote/openaiMessages.ts | exit 0 — SAME |
| src/engine/remote/openaiSse.test.ts | exit 0 — SAME |
| src/engine/remote/openaiSse.ts | exit 0 — SAME |
| src/engine/remote/openaiTransport.test.ts | exit 0 — SAME |
| src/engine/remote/openaiTransport.ts | exit 0 — SAME |
| src/engine/remote/redactForLog.test.ts | exit 0 — SAME |
| src/engine/remote/redactForLog.ts | exit 0 — SAME |
| src/engine/remote/remoteBoot.test.ts | exit 0 — SAME |
| src/engine/remote/remoteBoot.ts | exit 0 — SAME |
| src/engine/remote/remoteBrainErrors.test.ts | exit 0 — SAME |
| src/engine/remote/remoteBrainErrors.ts | exit 0 — SAME |
| src/engine/remote/remoteComputerModel.ts | exit 0 — SAME |
| src/engine/remote/remoteDefaults.ts | exit 0 — SAME |
| src/engine/remote/remoteEngine.lifecycle.test.ts | exit 0 — SAME |
| src/engine/remote/remotePrompt.test.ts | exit 0 — SAME |
| src/engine/remote/remotePrompt.ts | exit 1 — DIFF |
| src/engine/remote/remoteSecret.test.ts | exit 0 — SAME |
| src/engine/remote/remoteSecret.ts | exit 0 — SAME |
| src/engine/remote/remoteSettings.test.ts | exit 0 — SAME |
| src/engine/remote/remoteSettings.ts | exit 0 — SAME |
| src/engine/remote/remoteSettingsDraft.test.ts | exit 0 — SAME |
| src/engine/remote/remoteSettingsDraft.ts | exit 0 — SAME |
| src/engine/remote/remoteUrl.test.ts | exit 0 — SAME |
| src/engine/remote/remoteUrl.ts | exit 0 — SAME |
| src/engine/remote/serverContext.test.ts | exit 0 — SAME |
| src/engine/remote/serverContext.ts | exit 0 — SAME |
| src/engine/engineBackend.ts | exit 0 — SAME |
| src/engine/ensureIntent.ts | exit 0 — SAME |
| src/engine/ensureIntent.test.ts | exit 0 — SAME |
| src/engine/modelIndexProbe.ts | exit 0 — SAME |
| src/engine/modelIndexProbe.test.ts | exit 0 — SAME |
| src/engine/regenState.test.ts | exit 0 — SAME |
| src/screens/RemoteBrainSettings.tsx | exit 1 — DIFF |
| src/screens/RemoteBrainSettings.hydration.test.ts | exit 0 — SAME |
| src/util/devBuild.ts | exit 0 — SAME |
| plugins/withLoopbackCleartext.js | exit 0 — SAME |

The commit path list contains no server/, vendor/, src/documents/, or scripts/ paths. The exact filter git diff-tree --no-commit-id --name-only -r 5780add6d | rg '^(server/|vendor/|src/documents/|scripts/)' produced no matches. The added src/screens/RemoteBrainSettings.disclosure.test.ts is a new owner-requested test, not a branch file.

## 2. Memory-fact policy duplication

**Verdict: REFUTED as a sound port of the current main policy. CONFIRMED: the copied fact-sanitizing algorithm matches the branch-only helper's fact behavior.**

At ce71e78cd:src/engine/memoryPrompt.ts:8-22, the branch defines a 10-fact cap, a 120-character cap, and this sanitizer:

> ce71e78cd:src/engine/memoryPrompt.ts:9-11: MAX_PROMPT_FACTS = 10; MAX_PROMPT_FACT_CHARS = 120.
> return fact
> .replace(/[\u0000-\u001f\u007f]/g, " ")
> .replace(/\s+/g, " ")
> .trim()
> .slice(0, MAX_PROMPT_FACT_CHARS);

The port repeats the constants at src/engine/remote/remotePrompt.ts:16-17 and the same operations inline at lines 23-37: it maps fact.text, filters empty results, keeps only the final ten facts, and formats each as a dash-prefixed line. So for a withTools=false branch call and the same ordered strings, the fact text sanitization and fact-block output are behaviorally equivalent. The template is also the same English template: main src/i18n/en.ts:1002-1004 and branch ce71e78cd:src/i18n/en.ts:1012-1014 both say facts are untrusted data and substitute {facts}.

That does not make this the right policy for main. Main already has the formatter to reuse:

> src/engine/memoryFactsTail.ts:26-34
> export function buildMemoryFactsBlock(locale: Locale, facts?: readonly MemoryFact[] | null): string
> const { bounded } = boundMemoryFacts(facts ?? []);
> return template.replace("{facts}", bounded);

Its bounder is src/memory/dnaBounding.ts:17, 22-23, 53-59, 92-158. It caps each fact at the shared 120-character limit, but bounds the complete block to 1,200 estimated tokens, not ten facts. It date-labels notes, keeps original order when all fit, and when it must drop notes ranks by createdAt (newest first, later insertion wins ties), then appends a deferral marker. Main storage permits up to 40 facts (src/memory/MemoryStore.ts:51). The remote copy instead keeps the last ten non-empty inputs by array position, has no whole-block token budget, no date labels, and no deferral marker. The character sanitization happens to match today; the cap, overflow behavior, ordering rule, and output shape do not.

The main values and ordering contract are explicit:

> dnaBounding.ts:17: MEMORY_SUB_BUDGET_TOKENS = 1200.
> dnaBounding.ts:23: PROMPT_FACT_CHARS = 120.
> dnaBounding.ts:93-96: ranking is by createdAt, newest first; original order when everything fits.
> dnaBounding.ts:53-59: control characters become spaces, whitespace collapses, text trims, then slices at PROMPT_FACT_CHARS.

The existing main prompt builder already delegates to that helper:

> e206a945b:src/engine/LlamaService.ts:587-600
> if (!MEMORY_FACTS_ON_USER_TAIL) {
>   const factBlock = buildMemoryFactsBlock(locale, facts);

But e206a945b:src/engine/ttftFlags.ts:26 sets MEMORY_FACTS_ON_USER_TAIL = true, so reusing buildSystemPrompt alone would omit the memory facts. Remote prompt construction should reuse buildMemoryFactsBlock(locale, facts) for formatting and keep its remote-specific system/operative-block composition. The helper's module says it imports locale catalogs directly “so Node harnesses do not pull React” (memoryFactsTail.ts:8-15), so the remote unit test does not need to import the React Native-heavy LlamaService just to share the policy.

## 3. EmissionSource

**Verdict: REFUTED for the unconditional "parsed" classification. A completed remote stream can use parsed; an interrupted partial cannot be stamped parsed under main's contract. The adjacent “after think-tag stripping” comment is also false.**

Main defines:

> src/engine/modelEmittedText.ts:53: export type EmissionSource = "parsed" | "raw";

The callback type requires that source (e206a945b:src/engine/LlamaService.ts:767). Its contract at lines 760-765 says "parsed" is a parsed completed turn and "raw" is interrupted-turn token accumulation. The local completed path uses "parsed" at LlamaService.ts:4534; the local interrupted path uses "raw" at LlamaService.ts:4099-4103.

Remote finishOnce(err?) emits callbacks.onModelEmittedText?.(emitted, "parsed") unconditionally at RemoteEngine.ts:320-323. Yet onFinish routes interrupted, truncated, and error through settle(err) at lines 415-431. Thus a stream interrupted after partial output still gets "parsed", unlike main's explicit interrupted path. At minimum source classification must depend on the finish outcome; do not call an incomplete partial a completed parse.

The comment on lines 321-322 says emitted is “after think-tag stripping.” It is not: the delta handler appends raw delta.content to emitted at lines 401-403. The visible text is separately passed through think.cleanDelta; think.finalize(emitted) is assigned to finalVisible at lines 312-315, but emitted itself is never replaced before the callback. The existing lifecycle test named “onModelEmittedText throw still fires onDone” only checks the throw/settlement at remoteEngine.lifecycle.test.ts:620-643; it does not assert the source argument or stored text.

## 4. Privacy disclosure and negative test

**Verdict: CONFIRMED. The disclosure is rendered before the selection button, uses the requested English text, and the one-file test goes red when the disclosure is removed.**

The component renders the disclosure at RemoteBrainSettings.tsx:271-276, immediately after its hint and before the selection card/button beginning at lines 278 and 295. English source line src/i18n/en.ts:135 is:

> "To answer, your computer receives the conversation: messages, memory, summaries and document names."

The Italian locale entry is at src/i18n/it.ts:134 and matches the owner-supplied wording. I have not reproduced the Italian value in this English-only audit document, per the project language rule.

The test resolves the real English catalog (RemoteBrainSettings.disclosure.test.ts:23-35, 145-147) and requires the disclosure node index to precede the “Use my computer” label (lines 160-171). I removed only the disclosure JSX block, ran only npx jest src/screens/RemoteBrainSettings.disclosure.test.ts --runInBand > /tmp/audit-disclosure-negative.log 2>&1; echo $?, and got exit 1. The failure was the expected missing disclosure index: “Expected: >= 0 / Received: -1” at the assertion on test line 169. I then restored only src/screens/RemoteBrainSettings.tsx with git checkout -- src/screens/RemoteBrainSettings.tsx; git status --porcelain is empty, and the restored block remains at lines 271-276.

## 5. Document retrieval and remote-message contents

**Verdict: REFUTED as an absolute “document passages cannot reach a remote turn” claim. CONFIRMED: the client has no fresh remote document-retrieval/tool round. Carried-forward conversation text is a separate path.**

For a newly attached library document, AiChatPage constructs only an id/name hint:

> AiChatPage.tsx:2450-2453
> [document:<libraryDocId> name="<document name>"]

That docHints string is appended to modelText and sent through onSendStream(modelText, ...) (AiChatPage.tsx:2475-2479, 2564-2567). It is not document text.

The raw retrieval path is local document_chat: AppShell calls documentExec and puts docOutcome.text and docOutcome.passages in an EngineToolResult (AppShell.tsx:2305-2332); LlamaService declares passages on that result (LlamaService.ts:725) and calls options.executeTool("document_chat", ...) in its local loop (LlamaService.ts:4666-4674). The deep-research path is separately entered only under if (sendOpts?.research) (AppShell.tsx:5687-5725); AiChatPage gates useResearch with !isRemoteEngineBackend() at lines 2457-2458.

The remote client does not serialize tool declarations or execute a tool loop. RemoteEngine.ts:378-394 calls toOpenAiMessages; openaiTransport.ts:359-366 sends only model, messages, stream, max_tokens, and temperature, with no tools. toOpenAiMessages drops every role except user and assistant (openaiMessages.ts:17-18) and serializes string content only (lines 19-28). Thus the missing AppShell tools-off spread is not required to stop a fresh remote transport request from asking this client to retrieve a document.

However, this is not a guarantee that document-derived text can never be in a remote request. AppShell assembles prior chat history and preserves assistant modelEmittedText (AppShell.tsx:6560-6578); AiChatPage passes messagesRef.current as history (AiChatPage.tsx:2704-2707); the remote converter forwards prior user/assistant content, preferring that assistant emitted text (openaiMessages.ts:17-28). A local assistant answer that quoted a retrieved passage can therefore be forwarded as conversation history on a later remote turn. The privacy disclosure does say the conversation/messages are sent, but the coder's categorical “passages cannot reach a remote turn” must be narrowed to “no raw retrieval result is freshly fetched by the remote client.”

Embeddings are not serialized into EngineMessage/OpenAI messages: the converter emits role/content strings only. But background indexing is not gated on remote mode in this commit: AppShell calls embedDocumentChunk(chunk.text, { signal }) at AppShell.tsx:1839-1845, and rg isRemoteEngineBackend src/app/AppShell.tsx has no match. That is local work, not an embedding-vector egress path; it does contradict the visible Settings hint's broad promise that embeddings “stay off in this mode” unless step 2 adds the gate.

Finally, AppShell is still on the parent implementation in this commit: its import at AppShell.tsx:123-156 comes directly from ../engine/LlamaService, and its send call remains streamAssistantTurn there at lines 6628-6685. So step 1 alone does not route ordinary app chat through RemoteEngine at all. The tools-off spread planned for step 2 is defense in depth for the eventual shell integration; the transport's omission of tools is sufficient only for the remote transport path itself.

## 6. Hand hunks and step-1 integration state

**Verdict: CONFIRMED that the hand edits align with the listed main anchors; REFUTED that this commit alone is a working remote feature. Step 2 must finish the backend boundary. No ordinary remote-turn exfiltration is active in this commit because AppShell still calls local LlamaService.**

The observed diffs for AiChatPage, SettingsScreen, locale additions, ModelRegistry, app config, Jest config, and package metadata match the intended hunks. TypeScript passes (item 9), so the locale shape and imports compile. The current RemoteBrainSettings calls onSelectModel(REMOTE_COMPUTER_MODEL_ID) only after saving its URL (RemoteBrainSettings.tsx:307-313); SettingsScreen forwards model.onSelectModel (SettingsScreen.tsx:2549-2553). Main's callback selectModelById still searches only MODEL_REGISTRY and returns for an unknown id (AppShell.tsx:4630-4632); the remote row is explicitly “Not in MODEL_REGISTRY” (remoteComputerModel.ts:14-15). So in step 1, pressing “Use my computer” saves the address and then silently does not select the remote model.

The applied UI/model hunks are visible at these anchors:

> AiChatPage.tsx:2457-2458: useResearch = !isRemoteEngineBackend() && (armedResearch || keywordResearch).
> SettingsScreen.tsx:2549-2553: RemoteBrainSettings receives currentModelId, busy, and model.onSelectModel.
> ModelRegistry.ts:394-396: getModelById returns REMOTE_COMPUTER_MODEL for the remote id.
> app.config.js:69-73: withLoopbackCleartext is registered after withLintOff; the existing debug-only plugin remains conditional.
> jest.config.js:6-9: tsx is added to moduleFileExtensions and the transform matches ts or tsx.
> package.json:74: react-test-renderer is pinned to 19.2.3.
> AppShell.tsx:4630-4632: const nextIndex = MODEL_REGISTRY.findIndex(...); if (nextIndex < 0) return.

The boot path is also local-only: it finds a saved id with MODEL_REGISTRY.findIndex and returns if the index is negative (AppShell.tsx:2948-2963). The remote-settings hydrator returns a snapshot and explicitly “Does not write backendCache” (remoteSettings.ts:220-226); only the gated setter changes the live backend (lines 139-149). AppShell has no remote-backend import or hydration call in this commit. These are exactly the seams step 2 must wire: remote selection, boot snapshot application/local recovery, and facade use for init/stream/dispose.

Other incomplete wiring:
- nameKey?: TranslationKey is added to ModelInfo (ModelRegistry.ts:107-111), and remoteComputerModel.ts:17-19 says the UI renders it, but rg nameKey src finds no renderer—only this type declaration and the remote row. The Settings card itself separately renders t("settings.remoteComputer"); the ModelInfo nameKey does not currently localize any generic model renderer.
- The English Settings hint says tools, memory extraction, translation, embeddings, and voice “stay off in this mode” (i18n/en.ts:131-134). Step 1 adds chat gates for research and translation, but leaves AppShell unchanged; the background embedding call above remains live. Step 2 must make the hint true across the shell, or narrow the copy.
- readyRemote is added for the planned AppShell hunk and is not used yet. chat.truncated is used by RemoteEngine at RemoteEngine.ts:420-425.

The app is incomplete/broken as a selectable remote feature, but not remotely unsafe in its current ordinary path: the settings action is a no-op at the parent callback, while AppShell continues to invoke local LlamaService. Do not treat the Settings panel's mere presence as successful remote selection.

## 7. Ported-client security spot check

**Verdict: CONFIRMED for persistent token storage, Authorization scheme restriction, and Android cleartext scope. PLAUSIBLE caveat: one generic network catch returns a raw exception message, although no token interpolation path was found.**

The persistent bearer credential uses expo-secure-store and key kalsa.secret.remote-brain (remoteSecret.ts:6-8); reads/writes/deletes use SecureStore at lines 15-23 and 26-37. Remote settings persist URL/model/tuning values through AsyncStorage, but no token key exists there (remoteSettings.ts:18-23). The token does necessarily exist transiently in component/transport memory while the user enters/sends it; no second persistent store was found.

Authorization is added only when canSendAuthorization(url) accepts the URL. That predicate allows HTTPS or HTTP on the explicit loopback hosts only (remoteUrl.ts:73-81); both probe headers (RemoteEngine.ts:62-65, 74-79) and XHR headers (openaiTransport.ts:287-289) use the gate. The URL gate independently accepts HTTPS or loopback HTTP only (remoteUrl.ts:99-117), and normalization removes userinfo, query, and fragment before storage (remoteUrl.ts:40-50).

The enforcement lines are:

> remoteUrl.ts:73-80: HTTPS returns true; otherwise authorization requires HTTP and isLoopbackHost(parsed.hostname); parse errors return false.
> openaiTransport.ts:287-289: if (req.token && canSendAuthorization(url)), set Authorization to Bearer plus the token.
> remoteSecret.ts:6-8: import expo-secure-store and use the kalsa.secret.remote-brain key.

The Android config plugin writes a global cleartextTrafficPermitted="false" base and permits only 127.0.0.1, localhost, and ::1 (withLoopbackCleartext.js:11-19); app config keeps usesCleartextTraffic: false and registers the plugin (app.config.js:59, 69-74). No broad cleartext exception was found.

No code interpolates the bearer value into a log. The confusing remote.brain.token log at RemoteEngine.ts:407-410 contains only { n: visibleChunk.length }, not the token. Server error logs are structured as code and byte count, with only a dev-only redacted excerpt (openaiTransport.ts:95-103); production logs no server excerpt. One caveat: testRemoteConnection returns err.message from its generic catch (RemoteEngine.ts:153-158). The checked request URL has had credentials stripped and the token is sent in a header, so this is not a demonstrated token leak, but the exception is not converted to a stable code at that boundary.

## 8. Test hygiene

**Verdict: REFUTED. At least one test leaves global state installed; there are also failure-path cleanup weaknesses.**

remoteEngine.lifecycle.test.ts:38-40 assigns globalThis.fetch = fetchMock at module scope:

> (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

Its only afterEach is:

> afterEach(async () => {
>   await disposeRemoteEngine();
> });

There is no saved original fetch and no restoration. The same file's AsyncStorage mock owns a module-level map (lines 13-20); each beforeEach resets the URL but not the whole map (lines 84-105). This is fake storage, not device storage, but it makes cases share residual settings.

Good cleanup found: remoteUrl.test.ts:11-21 restores __DEV__ including whether the property was absent; openaiTransport.test.ts:34-47 does the same. Its fake-timer tests use try/finally and jest.useRealTimers() (lines 645-677, 731-771). remoteSecret.test.ts:12-17 resets SecureStore mocks before each case. The Settings hydration test restores its Act-environment value and console spies in RemoteBrainSettings.hydration.test.ts:97-123; the disclosure test does likewise (RemoteBrainSettings.disclosure.test.ts:95-121). Those two restore the previous value, though they do not preserve whether an initially absent global property was absent. In openaiTransport.test.ts:464-520, console.warn spies are restored after assertions rather than in finally; if an assertion fails early, that spy remains for the rest of the file.

## 9. Targeted verification (real exit codes)

No full suite was run. These are the requested targeted commands and exits:

| Command | Exit | Result |
|---|---:|---|
| npx tsc --noEmit > /tmp/a1-tsc.log 2>&1; echo $? | 0 | /tmp/a1-tsc.log is 0 bytes |
| npx jest src/engine/remote --runInBand > /tmp/a1-jest-remote.log 2>&1; echo $? | 0 | 14 suites, 144 tests passed |
| npx jest src/engine/ensureIntent.test.ts src/engine/modelIndexProbe.test.ts src/engine/regenState.test.ts --runInBand > /tmp/a1-jest-wiring.log 2>&1; echo $? | 0 | 3 suites, 28 tests passed |
| npx jest src/screens/RemoteBrainSettings.hydration.test.ts src/screens/RemoteBrainSettings.disclosure.test.ts --runInBand > /tmp/a1-jest-panel.log 2>&1; echo $? | 0 | 2 suites, 18 tests passed |
| npx jest ModelRegistry engineBackend historyPersistable llamaContextGate --runInBand > /tmp/a1-jest-neighbours.log 2>&1; echo $? | 0 | 2 suites, 9 tests passed |
| Disclosure negative check, only RemoteBrainSettings.disclosure.test.ts after removing its JSX | 1 | Expected failure at disclosureIndex assertion; source restored afterward |

All green targeted tests do not cover the unconditional EmissionSource argument or the whole main memory-facts policy. Final git status --porcelain in the subject worktree is empty.

## Verdict

**FIX-FIRST** — share main's buildMemoryFactsBlock/bounding policy instead of retaining the branch's ten-fact copy; classify partial remote output consistently with EmissionSource and correct the think-strip claim; restore globalThis.fetch in the lifecycle test. Step 2 must also wire remote selection/boot and gate the features promised off in remote mode. Narrow the retrieval guarantee to exclude raw fresh lookup while acknowledging carried-forward conversation text.

## Re-audit (d580d2457)

Scope: `git diff 5780add6d d580d2457` only. I did not modify the app worktree. The requested targeted command exited `0`; its tail was `Test Suites: 14 passed, 14 total` / `Tests: 149 passed, 149 total`. `git diff --quiet e206a945b d580d2457 -- src/app/AppShell.tsx; echo $?` printed `0`; `git status --porcelain` printed nothing.

### 1. Fact policy — CONFIRMED

The second fact formatter is gone from `src/engine/remote/`. `remotePrompt.ts:17` now says `const factBlock = buildMemoryFactsBlock(opts.locale, opts.memoryFacts);`; `rg` for `MAX_PROMPT_FACTS`, `MAX_PROMPT_FACT_CHARS`, `memoryFactsBlock`, or `sanitizeFact` under that directory returned no matches. The shared formatter at `memoryFactsTail.ts:30-33` says `const { bounded } = boundMemoryFacts(facts ?? []);` and returns the localized `promptSection` around that result.

That is the main policy: `dnaBounding.ts:53-59` strips control characters, collapses whitespace, trims, and slices each fact to `PROMPT_FACT_CHARS`; `dnaBounding.ts:17` sets `MEMORY_SUB_BUDGET_TOKENS = 1200`; `dnaBounding.ts:84` formats dated bullets as `- [${date}] ${text}`. `dnaBounding.ts:113-118` preserves original order when all facts fit; on overflow, `dnaBounding.ts:121-157` ranks by timestamp, keeps newest first (later insertion wins ties), and adds a deferral marker. The removed copy in `5780add6d:remotePrompt.ts:16-37` had `MAX_PROMPT_FACTS = 10`, the same 120-character per-item slice, and `.slice(-MAX_PROMPT_FACTS)`; it had no dates or shared token budget. So the cap and sanitization policy are now single-source.

`StreamTurnOptions.memoryFacts` is real on main: `LlamaService.ts:3883` declares `export type StreamTurnOptions = EngineTurnOptions & {`, and `:3891` says `memoryFacts?: readonly MemoryFact[];`. Main's live caller supplies it at `AppShell.tsx:6684`: `memoryFacts: promptFacts,`. But `AppShell.tsx:156` still imports the stream functions from `../engine/LlamaService`; step 1 added `engineBackend.ts`, whose `:185-188` dispatches to `streamRemoteAssistantTurn`, without changing that caller. Therefore the remote prompt receives actual facts only in the direct prompt test (`remotePrompt.test.ts:21`: `memoryFacts: facts`), not from the step 1 app path. Step 2 must route the live call through the facade and carry this option.

There is a real placement difference to decide in step 2. Remote `remotePrompt.ts:16-18` appends the block to `systemPrompt`; main has `ttftFlags.ts:26`: `MEMORY_FACTS_ON_USER_TAIL = true`, and `LlamaService.ts:4442-4446` applies `buildMemoryFactsBlock` via `applyMemoryFactsToLastUser`. The formatter is shared, but the remote prompt role/order differs from local. Step 2 should explicitly preserve or change that behavior.

### 2. EmissionSource — CONFIRMED, with the stale-turn boundary

Main's type is `modelEmittedText.ts:53`: `export type EmissionSource = "parsed" | "raw";`. The local abort path calls `onModelEmittedText?.(rawEmittedAccum, "raw")` (`LlamaService.ts:4103`); the completed local path calls `onModelEmittedText?.(modelEmitted, "parsed")` (`:4534`). The fix now emits `err ? "raw" : "parsed"` (`RemoteEngine.ts:325-327`).

For a live stream, all non-complete transport finishes set `err`: `RemoteEngine.ts:420-435` settles without an error only for `finish.kind === "complete"`; every other kind constructs an `Error` and calls `settle(err)`, including `truncated` (`:424-435`). A pre-aborted signal also constructs an interrupted error (`:361-365`). Transport abort and user-signal abort finish as `interrupted` (`openaiTransport.ts:344-354`); network loss without a terminal marker finishes as `error` (`:330-335`); `finish_reason: length` becomes `truncated` (`:230-234`, with the test at `openaiTransport.test.ts:168-179`). EOF without any terminal marker is interrupted (`openaiTransport.test.ts:181-191`), so it reaches the error path.

One nuance: the transport defines a terminal `finish_reason` as sufficient even without `[DONE]`; its header says success requires `[DONE]` **or** a terminal finish reason (`openaiTransport.ts:4-9`), and `openaiTransport.test.ts:273-284` explicitly expects `reason-without-DONE` with `stop` to be `complete`. That case leaves `err` undefined by design. A dead turn that becomes stale before the token lookup returns exits at `RemoteEngine.ts:355-356` without settling, but it has emitted no content; after a started turn is replaced, `finishOnce` suppresses the model-text callback under `if (mine)` (`:305-327`). Thus no stale partial is mislabeled parsed.

### 3. Test hygiene — CONFIRMED for the fix; PLAUSIBLE residual isolation weakness

The new lifecycle test saves/restores fetch (`remoteEngine.lifecycle.test.ts:43-53`, including deleting it when it was absent), and its fake AsyncStorage removes every key in `__reset` (`:20-23`), called by `beforeEach` (`:147-152`). The targeted suite's `__DEV__` helpers restore in `finally` (`openaiTransport.test.ts:34-47`, `remoteUrl.test.ts:11-21`); fake-timer cases restore real timers in `finally` (`openaiTransport.test.ts:645-657`, `:659-677`, `:731-746`, `:749-771`). SecureStore is mocked and its Jest functions reset before each case (`remoteSecret.test.ts:4-17`); the settings fake store and its flags reset before each relevant test (`remoteSettings.test.ts:61-69`).

Remaining weakness, not introduced by d580: three `console.warn` spies in `openaiTransport.test.ts` call `mockRestore()` only after assertions (`:464-490`, `:493-520`, `:523-545`). An assertion failure skips that restore and leaks the spy to later cases in the same file. Also, the lifecycle `streamOpenAiChat` mock is declared as `jest.fn()` (`remoteEngine.lifecycle.test.ts:31-33`) but is not reset in its `beforeEach` (`:147-167`); current streaming cases install an implementation before use, so I found no present contamination, but isolation depends on that convention. This is a test-hygiene defect, not a runtime defect.

### 4. Revert sensitivity — CONFIRMED by assertions (not by rerunning a mutation)

The four emission tests assert one completed `parsed` and three partial `raw` sources (`remoteEngine.lifecycle.test.ts:711-781`). Reverting to the old unconditional `parsed` call (`5780add6d:RemoteEngine.ts:321-324`) would leave the completed test green and fail the interrupted, truncated, and error tests. Both fact tests are sensitive: `remotePrompt.test.ts:17-24` compares the exact main-formatted block, which includes the date label (`dnaBounding.ts:81-85`) absent from the old formatter (`5780add6d:remotePrompt.ts:34-37`); `remotePrompt.test.ts:26-35` requires all 15 short facts, while the old implementation dropped all but the last ten (`5780add6d:remotePrompt.ts:16-17,23-37`). That predicts exactly five failing test cases when reverting both fixes. I did not mutate the read-only app worktree.

### 5. AppShell boundary — CONFIRMED

The byte comparison against `e206a945b` returned `0` for `src/app/AppShell.tsx`; the final app-worktree `git status --porcelain` was empty.

## Re-audit verdict

**FIX-FIRST** — the functional fixes are sound and the remote-only run is green, but the explicit test-hygiene requirement is not fully closed: put the three `console.warn` spies behind unconditional cleanup (for example `try/finally` or `afterEach(jest.restoreAllMocks)`). Then proceed to step 2, where the remote facts path and system-versus-user placement must be resolved.

## Re-audit 2 (7ed2c0b03)

Scope check: `git diff --stat d580d2457 7ed2c0b03` reports `2 files changed, 8 insertions(+), 3 deletions(-)`. `git diff --name-only` lists only `src/engine/remote/openaiTransport.test.ts` and `src/engine/remote/remoteEngine.lifecycle.test.ts`.

### (a) Spy cleanup scope — CONFIRMED

`openaiTransport.test.ts:84` opens `describe("streamOpenAiChat", () => {`; its line 87 installs `afterEach(() => jest.restoreAllMocks());`. The three `console.warn` spies are at lines 471, 498, and 527, all inside that describe. The cleanup therefore runs after each of those cases, including a failed assertion.

### (b) Jest mock behavior — CONFIRMED

The installed Jest version read from `node_modules/jest/package.json:4` is `30.4.2` (the package declaration is `^30.4.2` at `package.json:72`); installed `jest-mock` is `30.4.1` (`node_modules/jest-mock/package.json:3`). In that exact `jest-mock` source, `restoreAllMocks()` is `for (const restore of this._spyState) restore(); this._spyState = new Set();` (`node_modules/jest-mock/build/index.js:757-760`). `resetAllMocks()` is a separate method that replaces `_mockConfigRegistry` and `_mockState` (`:753-756`). So `restoreAllMocks()` does not clear or replace a module-level `jest.fn()` implementation.

There is no module-level `jest.fn()` in `openaiTransport.test.ts`: line 1 imports the real `streamOpenAiChat`, and the only `jest.fn`/`jest.mock` search hits in that file are the `afterEach` and the three `jest.spyOn(console, "warn")` calls. The lifecycle file's module mock is separate and now resets explicitly before every case (`remoteEngine.lifecycle.test.ts:153-156` says `jest.requireMock("./openaiTransport")` followed by `streamOpenAiChat.mockReset()`).

### (c) Reset target — CONFIRMED

`RemoteEngine.ts:13` imports `streamOpenAiChat` from `"./openaiTransport"`. In the same directory, `remoteEngine.lifecycle.test.ts:31-33` mocks that exact module specifier, and `:153-156` obtains that same mock with `jest.requireMock("./openaiTransport")` before resetting it. The installed Jest runtime implements `requireMock` by resolving a CJS module ID and fetching the registry entry for that ID (`node_modules/jest-runtime/build/index.js:3684-3696`). Both imports resolve from the same directory to the same path/module ID, so this reset reaches the instance used by `RemoteEngine`.

### (d) Scope and AppShell — CONFIRMED

The only delta paths are the two test files listed above. `git diff --quiet e206a945b 7ed2c0b03 -- src/app/AppShell.tsx; echo $?` printed `0`; the AppShell is still byte-identical to `e206a945b`. The app worktree status remained empty.

### Targeted verification

Ran only `npx jest src/engine/remote --runInBand > /tmp/reaudit2.log 2>&1; echo $?`: exit `0`. Tail: `Test Suites: 14 passed, 14 total`; `Tests: 149 passed, 149 total`; `Ran all test suites matching src/engine/remote.`

## Re-audit 2 verdict

**PROCEED** — all four checks are confirmed; the prior console-spy cleanup and transport-mock isolation findings are closed in this delta.
