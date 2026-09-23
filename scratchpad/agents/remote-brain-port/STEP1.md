# STEP 1 — port the Kalsa Brain phone client (everything except AppShell)

Worktree: `/Users/marco/Projects/kalsa-wt-bench-apk`, detached at `e206a945b` (= origin/main),
tree clean at start (0 dirty paths). No branch, no pull/rebase/push/tag. Plan: RECON.md §2–§6, §9.

## Commit

- **sha: `5780add6d`**
- message: `remote : port the Kalsa Brain phone client (engine, settings, gates), shell wiring next`
- `git show --stat HEAD` → **50 files changed, 6817 insertions(+), 6 deletions(-)**
- tree clean after commit (`git status --porcelain | wc -l` → 0)
- AppShell: **untouched** (`grep -c AppShell <status>` → 0). Step 2 not started.

## File list

### A. Copied from `ce71e78cd` — 40 files (`git checkout ce71e78cd -- <paths>`, exit 0)

RECON §9a says "39"; the enumeration is actually **40** (30 + 10) — see Corrections #1.
Accounting (corrected per audit §1): **37 byte-identical** to the branch, plus **3 copied files
with drift fixes inside them**, named: `src/engine/remote/RemoteEngine.ts`,
`src/engine/remote/remotePrompt.ts`, `src/screens/RemoteBrainSettings.tsx` (marked [FIX] below).
"Verbatim" in this section means copied from the branch, not byte-identical to it.

`src/engine/remote/` — all 30 (`git ls-tree ce71e78cd src/engine/remote/` → 30):

| Sources (16) | Tests (14) |
|---|---|
| RemoteEngine.ts [FIX] | remoteEngine.lifecycle.test.ts |
| openaiTransport.ts | openaiTransport.test.ts |
| openaiSse.ts | openaiSse.test.ts |
| remoteSettings.ts | remoteSettings.test.ts |
| remoteUrl.ts | remoteUrl.test.ts |
| latestSave.ts | latestSave.test.ts |
| remoteSecret.ts | remoteSecret.test.ts |
| remoteBoot.ts | remoteBoot.test.ts |
| remoteBrainErrors.ts | remoteBrainErrors.test.ts |
| redactForLog.ts | redactForLog.test.ts |
| remoteComputerModel.ts | remotePrompt.test.ts |
| remotePrompt.ts [FIX] | openaiMessages.test.ts |
| serverContext.ts | serverContext.test.ts |
| remoteSettingsDraft.ts | |
| remoteDefaults.ts | |
| openaiMessages.ts | |

Plus: `src/engine/engineBackend.ts`, `src/engine/ensureIntent.ts`, `src/engine/ensureIntent.test.ts`,
`src/engine/modelIndexProbe.ts`, `src/engine/modelIndexProbe.test.ts`, `src/engine/regenState.test.ts`,
`src/screens/RemoteBrainSettings.tsx` [FIX], `src/screens/RemoteBrainSettings.hydration.test.ts`,
`src/util/devBuild.ts`, `plugins/withLoopbackCleartext.js`.

None of the 40 existed on main before the copy (checked with `git cat-file -e e206a945b:<f>` → none).
The three [FIX]es are Corrections #3a/#3b/#5 below — required for tsc, semantics pinned by tests;
the RemoteEngine/remotePrompt two were reworked per audit §2/§3 in Fix round 1 (bottom).

### B. Hand-hunked (hunks #8–#26 of §9b) — 9 files + 1 new test

| File | Hunk(s) applied | Final anchor lines |
|---|---|---|
| `src/screens/AiChatPage.tsx` | #8 import → `../engine/engineBackend` + `isRemoteEngineBackend`; #9 `useResearch` gate; #10 `runTranslate` early-return; #11 `toggleResearchMode` early-return (+ deps `[]`→`[t]`); #12 chip `disabled += \|\| isRemoteEngineBackend()`; #13 translate row wrapped | import :86, gate :2457–2458, :3538, :3649, :4210, :4457 |
| `src/screens/SettingsScreen.tsx` | #14 import; #15 render `<RemoteBrainSettings …/>` before Models panel | :114, :2549 |
| `src/i18n/en.ts` | #16 settings block (key-by-key, after `modelsHint`, before `governor`) + new disclosure key; #17 `models.remoteComputer`; #18 `chat.truncated`; #19 `download.readyRemote` | :131–170 (+disclosure :134), :308, :537, :510 |
| `src/i18n/it.ts` | #20 the four mirrors + new disclosure key | :130–169 (+disclosure :133), :303, :533, :505 |
| `src/engine/ModelRegistry.ts` | #21 remote import; #22 `nameKey?: TranslationKey` + comment; #23 `getModelById` guard | :22, :111, :395 |
| `app.config.js` | #24 `"./plugins/withLoopbackCleartext",` after `withLintOff` (skipped engineBuildId/intent-filter/governor; `withDebuggableRelease` not re-added) | :71 |
| `jest.config.js` | #25 `moduleFileExtensions` + `tsx?` transform | :6, :8 |
| `package.json` | #26 `"react-test-renderer": "19.2.3",` ONLY — branch package.json never copied | :74 |
| `package-lock.json` | refreshed by `npm install react-test-renderer@19.2.3 --save-exact` (exit 0) → `git diff --stat` = **1 file changed, 22 insertions(+)**; full diff shows only the `react-test-renderer` entry + its nested `react-is` (its subtree) | — |
| `src/screens/RemoteBrainSettings.disclosure.test.ts` | **NEW** — privacy-disclosure test (owner requirement) | — |

i18n was edited key by key, never file-copied (en/it parity enforced by tsc — see proof 1).

## Lines verified against RECON (all leads checked; corrections in next section)

All §9b anchors were re-located before editing. RECON's numbers held except where noted:

- #8 main import block :75–85 (`} from "../engine/LlamaService"` at :85) ✓
- #10 `runTranslate` main:3533 ✓; inserted gate at :3538. Branch keeps deps `[locale]` even after
  adding `t()` — verified at branch (`[locale],` is runTranslate's array) and kept verbatim.
- #11 `toggleResearchMode` main:3642 ✓
- #12 chip `disabled` main:4200 (pre-edit) ✓ — only the deepResearch chip (first of three identical
  lines, disambiguated by preceding `active={researchMode}`)
- #13 translate `AttachSheetRow` main:4449–4457 (`runTranslate(...)` at :4451) ✓
- #14 main:113 ✓; #15 blank line main:2547 before Models comment :2548 ✓
- #16 `modelsHint` :130 / `governor` :131 ✓ (insert between); #17 `models: {` :257 ✓;
  #18 `interrupted` :481 ✓ (RECON note "chat.truncated missing on main" confirmed — grep showed it
  absent, only `translate` truncation existed); #19 `readyLocal` :455 ✓
- #20 it mirrors: `modelsHint` :128, `models: {` :252, `readyLocal` :450, `interrupted` :477 ✓
- #21 `DEV_MODEL_REGISTRY` main:21 ✓ (import added on :22, DEV line untouched);
  #22 `descriptionKey` main:105 ✓; #23 `getModelById` main:388 ✓
- #24 `"./plugins/withLintOff"` main:70 ✓; #25 jest :6/:8 ✓; #26 `pdfjs-dist` main:73 ✓
- §9a list: confirmed `git grep 'historyPersistable' ce71e78cd -- src/engine/remote` → empty and
  `git grep '\.tsx' ce71e78cd -- src/engine/remote` → empty (exclusions and jest-config claim hold).
- §2: all 30 remote files present at `ce71e78cd`; none existed on main.

## Corrections to RECON (found and fixed during the port)

1. **§9a/§7 count: "39 files" → the list enumerates 40** (30 remote + 10 outside). All 40 brought.
2. **§5 line ref**: request body is `openaiTransport.ts:360–366` in the ported file, not "315-322".
3. **§7 said "0 edits [to LlamaService-facing code]; verify via tsc" — tsc found two real breaks:**
   - **(a) `remotePrompt.ts:7` imported `../memoryPrompt`** — a branch-only module
     (`src/engine/memoryPrompt.ts` exists at ce71e78cd, NOT in §9a and NOT on main; main's
     `buildSystemPrompt` lives in `LlamaService.ts:587`, an impure module — LlamaService.ts:1
     `import { AppState, Platform } from "react-native"` would break `remotePrompt.test` in node
     jest). **Fix:** `remotePrompt.ts` now builds the prompt itself from pure sources —
     `getStrings(locale).systemPrompt` + a local fact block (sanitize → cap 10 facts/120 chars →
     `memory.promptSection`). Template byte-identical across SHAs (branch `en.ts:1012-1014` vs
     main `en.ts:1058-1061`). `remotePrompt.test.ts` (verbatim) pins the behaviour: 3/3 pass.
   - **(b) `RemoteEngine.ts:321` called `onModelEmittedText?.(emitted)` with 1 arg** — main's
     `EngineCallbacks` (`LlamaService.ts:767`) is `(text: string, source: EmissionSource) => void`,
     `EmissionSource = "parsed" | "raw"` (`modelEmittedText.ts:53`). **Fix:** pass `"parsed"` —
     `emitted` is post-think-strip model text, the same provenance local turns report
     (`LlamaService.ts:4534`). Lifecycle test (verbatim) doesn't pin args: 14/144 pass.
4. **Hunk #11 incomplete in RECON**: branch also flips `toggleResearchMode` deps `[]` → `[t]`
   (branch `AiChatPage.tsx:3374`), required because the gate calls `t(...)`. Applied.
5. `RemoteBrainSettings.tsx` [FIX]: only the disclosure insertion (owner requirement #3) — not a
   RECON item; RECON §5 had *recommended* a line, owner supplied exact wording.

## Privacy disclosure (owner wording, exact)

- Key: `settings.remoteBrainDisclosure`, added to BOTH locales (parity ratchet: tsc).
  - en `src/i18n/en.ts:134-135`: **"To answer, your computer receives the conversation: messages, memory, summaries and document names."**
  - it `src/i18n/it.ts:133-134`: **"Per rispondere, il tuo computer riceve la conversazione: messaggi, memoria, riassunti e nomi dei documenti."**
- Rendered at `src/screens/RemoteBrainSettings.tsx:271-276` (`testID="remote-brain-disclosure"`),
  directly under the panel hint and **before** the "Use my computer" button (`remoteSelect`) in the
  render tree — visible before the act that switches the backend.
- Test: `src/screens/RemoteBrainSettings.disclosure.test.ts` renders the real component (RN mocked as
  host tags; `t` resolves the real English catalog) and asserts the exact shipped line is present and
  its render index precedes the button label.
  - **Negative check**: deleting the disclosure block makes the test fail (jest exit 1, restored after).

## §5 OPEN QUESTION — can attached-document retrieval inject document PASSAGES into a remote turn?

### Verdict: **No FRESH document retrieval or tool round reaches a remote turn. No gate written (per brief: prove, write no code).**

**Narrowed per audit §5** — this is NOT the claim "document-derived text can never appear in a
remote request". Carried-forward conversation history is a separate path: AppShell preserves
assistant `modelEmittedText` (`AppShell.tsx:6560-6578`), AiChatPage passes `messagesRef.current`
as history (`AiChatPage.tsx:2704-2707`), and `openaiMessages.ts:17-28` forwards prior
user/assistant content preferring the assistant's emitted text — so a LOCAL assistant answer that
quoted a retrieved passage rides along on a later remote turn as ordinary history. The disclosure
("your computer receives the conversation: messages … and document names") covers exactly that.
What the quoted path proves is narrower: no raw retrieval result is freshly fetched by the remote
client for a remote turn, and the transport never asks for one.

Quoted code path (line numbers at `5780add6d`):

1. **Documents enter the message as ids/names only.** `AiChatPage.tsx:2448-2453`:
   ```
   // Library documents are retrieval sources (document_chat tool), not vision.
   // Annotate the model-facing text with doc ids so the tool can select them.
   const docHints = snapshotAttachments
     .filter((a) => a.kind === "document" && a.libraryDocId)
     .map((a) => `[document:${a.libraryDocId} name="${a.name}"]`)
     .join(" ");
   ```
2. **Passages only exist as `EngineToolResult.passages`** — `LlamaService.ts:725`
   `passages?: import("../context/retrievalLoop").RetrievedPassage[];` — produced by the
   `document_chat` tool, whose ONLY execution sites are the local engine round loop and research:
   - `LlamaService.ts:4667` `options.executeTool(` (document_chat, local round loop)
   - `LlamaService.ts:5093` `options.executeTool(` (other tools, local round loop)
   - `AppShell.tsx:5722` `? executeTool(name, args, toolSignal, text)` — inside
     `AppShell.tsx:5687` `if (sendOpts?.research) {` … `AppShell.tsx:5716`
     `const outcome = await runDeepResearch({` — and `sendOpts.research` is
     `AiChatPage.tsx:2710` `research: useResearch,` where **`AiChatPage.tsx:2457-2458`**:
     ```
     const useResearch =
       !isRemoteEngineBackend() && (armedResearch || keywordResearch);
     ```
     → research (the only non-round-loop passage producer) is false in remote mode. Its branch ends
     `finish(); return;` (`AppShell.tsx:5742`) — it never dispatches a remote turn at all.
3. **A remote turn has no tool loop.** `engineBackend.ts:186`
   `return streamRemoteAssistantTurn(messages, callbacks, signal, rest);` routes remote turns past
   LlamaService entirely; `grep -n 'executeTool|tools|passages' src/engine/remote/*.ts` → **empty**;
   `grep -n 'tool_calls' src/engine/remote/*.ts` → **empty** (transport cannot parse or continue a
   tool round). `RemoteEngine.ts:382-391` builds only
   `messages: toOpenAiMessages(messages, buildRemoteSystemPrompt({ locale, memoryFacts, operativeContext }))`.
4. **The request never offers tools.** `openaiTransport.ts:360-366`:
   ```
   JSON.stringify({
     model: req.model,
     messages: req.messages,
     stream: true,
     max_tokens: req.maxTokens,
     temperature: req.temperature,
   }),
   ```
   no `tools` field — a compliant server can never even produce a tool call. (The
   `tools: undefined` spread, AppShell hunk #6 / step 2, is defense-in-depth, not load-bearing here.)
5. **The other context riders are not document passages:** compactor/`retriever` run over
   conversation history for the operative digest/summary (both sent, and now disclosed), and notes
   context (`sendOpts.notes`) is the user's notes, not attached documents. `EmbeddingService` jobs
   index the library for the tool's use; nothing on the send path invokes embedding or
   `runRetrievalLoop` (`grep` shows their consumers are document_chat / webFetchTool / deepResearch
   only), so no index content is freshly fetched into a remote turn. **Residual note:** library indexing itself is
   not keyed on `isRemoteEngineBackend()` — it is background maintenance with no path into a turn;
   the panel's "embeddings stay off in this mode" claim is not contradicted by any turn content.

## Every command's exit code (real, `cmd > log 2>&1; echo $?`)

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `git rev-parse --short=9 HEAD && git status --porcelain \| wc -l` | 0 | `e206a945b` / `0` (preflight gate passed) |
| 2 | `git ls-tree --name-only ce71e78cd src/engine/remote/ \| wc -l` | 0 | 30 |
| 3 | per-path `git cat-file -e ce71e78cd:<f>` (10 outside remote) | 0 | all OK |
| 4 | per-path `git cat-file -e e206a945b:<f>` (all 40) | 0 | none exists on main |
| 5 | `git checkout ce71e78cd -- <40 paths>` | 0 | 40 staged `A` |
| 6 | first `edit` call on jest.config.js (backslash escaping) | tool error | atomic, nothing applied; retried → success |
| 7 | `npm install react-test-renderer@19.2.3 --save-exact > /tmp/port-npm.log 2>&1; echo $?` | **0** | tail: only allow-scripts warnings |
| 8 | `git diff --stat package-lock.json` | 0 | `1 file changed, 22 insertions(+)` (subtree verified by full diff) |
| 9 | `npx tsc --noEmit > /tmp/port-tsc.log 2>&1` (run 1) | **2** | `RemoteEngine.ts(321,43) TS2554`; `remotePrompt.ts(7,35) TS2307` → Corrections #3a/#3b |
| 10 | `npx tsc --noEmit` (after fixes) | **0** | empty log |
| 11 | `npx jest src/engine/remote --runInBand > /tmp/port-jest-remote.log 2>&1` | **0** | 14 suites, 144 tests passed |
| 12 | `npx jest src/engine/ensureIntent.test.ts src/engine/modelIndexProbe.test.ts src/engine/regenState.test.ts --runInBand` | **0** | 3 suites, 28 tests passed |
| 13 | `npx jest ModelRegistry engineBackend historyPersistable llamaContextGate --runInBand` | **0** | 2 suites, 9 tests passed |
| 14 | `npx jest src/screens/RemoteBrainSettings.hydration.test.ts src/screens/RemoteBrainSettings.disclosure.test.ts --runInBand` (run 1) | **1** | my new test used JSX in `.ts` (testMatch is `**/*.test.ts`; tsconfig excludes `src/**/*.test.ts` from tsc, so ts-jest caught it) → rewrote with `React.createElement` |
| 15 | same panel jest (run 2) | **0** | 2 suites, 18 tests passed |
| 16 | negative check: disclosure block deleted, jest disclosure test | **1** (expected) | test fails without the line; file restored (`grep -c` → 1) |
| 17 | final proof re-run: `npx tsc --noEmit` | **0** | |
| 18 | final proof re-run: jest remote | **0** | 14/144 |
| 19 | final proof re-run: jest wiring | **0** | 3/28 |
| 20 | final proof re-run: jest neighbours | **0** | 2/9 |
| 21 | final proof re-run: jest panel | **0** | 2/18 |
| 22 | `git status --porcelain \| wc -l` (pre-commit) | 0 | **50** = 41 new (40 verbatim + 1 test) + 9 hunked; AppShell absent |
| 23 | `git commit -m "remote : port the Kalsa Brain phone client (engine, settings, gates), shell wiring next"` | **0** | sha `5780add6d` |
| 24 | `git rev-parse --short=9 HEAD` / `git status --porcelain \| wc -l` | 0 | `5780add6d` / `0` |

Full suite: **never run** (per brief). Other worktrees (`kalsa`, `kalsa-ux`, Paseo): **never touched**.

## Next

Step 2 (after audit): AppShell.tsx hunks #1–#7 — the hard ones (boot hydration merge,
import split, probe/supersede, switch dispose, tools-off spread, ready label).

## Fix round 1

Audit: `AUDIT-STEP1.md` verdict **FIX-FIRST** (items 1–3 fixed in code, item 4 in this file).
One commit on top of `5780add6d` — detached HEAD, no amend, no branch, no push, no sub-agents.

- **new sha: `d580d2457`** (parent `5780add6d`)
- message: `remote : reuse main's memory-facts policy, emission source by outcome, restore fetch in tests`
- `git show --stat HEAD` → **4 files changed, 177 insertions(+), 46 deletions(-)**:
  - `src/engine/remote/RemoteEngine.ts` — 10 lines changed (emission by outcome, comment fixed)
  - `src/engine/remote/remoteEngine.lifecycle.test.ts` — 139 insertions (hygiene + 4 tests)
  - `src/engine/remote/remotePrompt.test.ts` — 34 lines changed (rewritten)
  - `src/engine/remote/remotePrompt.ts` — 40 lines changed (policy copy removed)
- tree clean after commit (`git status --porcelain | wc -l` → 0); AppShell still byte-identical
  to `e206a945b` (only these 4 paths changed).

### What changed

1. **Duplicated policy removed (audit §2).** `remotePrompt.ts` now reuses main's
   `buildMemoryFactsBlock(locale, facts)` from `src/engine/memoryFactsTail.ts:26-34` (which bounds
   via `src/memory/dnaBounding.ts`: 1200-token block budget, 120-char fact cap, createdAt ranking,
   date labels, deferral marker). The facts parameter is main's own type — quoted:
   `StreamTurnOptions.memoryFacts?: readonly MemoryFact[]` (`LlamaService.ts:3891`), with
   `MemoryFact = { id: string; text: string; createdAt: number }` (`src/memory/MemoryStore.ts:16`).
   `MAX_PROMPT_FACTS` / `MAX_PROMPT_FACT_CHARS` / the inline sanitiser are gone. The file says why
   in one comment line (`remotePrompt.ts:15`):
   > `// buildSystemPrompt would drop the facts here (MEMORY_FACTS_ON_USER_TAIL is true, ttftFlags.ts:26), so append main's fact block directly.`

   Only the remote-specific composition remains: system prompt + fact block + operative block.
   `remotePrompt.test.ts` rewritten (4 tests): the facts test asserts the **exact** composition
   `systemPrompt + "\n\n" + buildMemoryFactsBlock(...)` — red if facts ever drop — and a 15-fact
   test keeps every fact, red under the removed ten-fact copy.

2. **EmissionSource by outcome (audit §3).** `RemoteEngine.ts:326` now stamps
   `callbacks.onModelEmittedText?.(emitted, err ? "raw" : "parsed")`. Mirrors main's contract and paths:
   - contract `LlamaService.ts:760-767`: *"parsed" = native parse of a completed turn … "raw" = raw token accumulation of an interrupted turn*; `onModelEmittedText?: (text: string, source: EmissionSource) => void`;
   - completed local path `LlamaService.ts:4534`: `if (modelEmitted) callbacks.onModelEmittedText?.(modelEmitted, "parsed");`
   - interrupted local path `LlamaService.ts:4099-4103`: `if (rawEmittedAccum) { … callbacks.onModelEmittedText?.(rawEmittedAccum, "raw"); }`
   - `EmissionSource = "parsed" | "raw"` (`modelEmittedText.ts:53`).
   Remote routing: `finish.kind === "complete"` → `settle()` (no err) → "parsed"; interrupted /
   truncated / error go through `settle(err)` → `finishOnce(err)` → "raw". The false
   "after think-tag stripping" comment is deleted — the comment now records that `emitted` is raw
   `delta.content` (think tags stripped only for display via `onDelta`). Four new tests at
   `remoteEngine.lifecycle.test.ts:711,729,747,765`: complete → `["parsed"]`; interrupted,
   truncated, error-with-partial → `["raw"]`.

3. **Test hygiene (audit §8).** `remoteEngine.lifecycle.test.ts:43` saves the original
   `globalThis.fetch` (including whether the property existed — `hadFetch`) and restores it in
   `afterAll` (:47); the fake AsyncStorage factory gained `__reset()` (:21) which clears the whole
   map, called first in `beforeEach` (:149-151) so cases share no residual settings.

4. **STEP1.md corrected (audit §1, §5):** accounting above now reads 37 byte-identical + 3 named
   drift fixes; the §5 retrieval verdict is narrowed to "no FRESH retrieval or tool round reaches a
   remote turn", acknowledging carried-forward assistant history covered by the disclosure.

### Proofs (real exit codes, `cmd > log 2>&1; echo $?`)

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `npx tsc --noEmit > /tmp/fix1-tsc.log 2>&1` (run 1) | **0** | 0-byte log |
| 2 | `npx jest src/engine/remote --runInBand > /tmp/fix1-jest-remote.log 2>&1` (run 1) | **0** | 14 suites, **149** tests (144 + 4 emission + 1 facts) |
| 3 | `npx jest src/screens/RemoteBrainSettings.hydration.test.ts src/screens/RemoteBrainSettings.disclosure.test.ts --runInBand > /tmp/fix1-jest-panel.log 2>&1` (run 1) | **0** | 2 suites, 18 tests |
| 4 | mutation check: unconditional `"parsed"` + fact block dropped, then jest remote | **1** (expected) | exactly **5 failed**: the 3 emission-raw tests + the 2 fact-policy tests; files restored from `/tmp` backups |
| 5 | final `npx tsc --noEmit > /tmp/fix1-tsc.log 2>&1` | **0** | 0-byte log |
| 6 | final `npx jest src/engine/remote --runInBand` | **0** | 14 suites, 149 tests |
| 7 | final `npx jest …panel… --runInBand` | **0** | 2 suites, 18 tests |
| 8 | `git status --porcelain` (pre-commit) | 0 | exactly the 4 intended paths |
| 9 | `git commit -m "remote : reuse main's memory-facts policy, emission source by outcome, restore fetch in tests"` | **0** | sha `d580d2457` |
| 10 | `git rev-parse --short=9 HEAD` / `git status --porcelain \| wc -l` | 0 | `d580d2457` / `0` |

Full suite: **never run**. Other worktrees: **never touched**.

## Fix round 2

Re-audit: `AUDIT-STEP1.md` `## Re-audit (d580d2457)` — functional fixes CONFIRMED; FIX-FIRST on
two test-hygiene leftovers (re-audit §3 residual). One commit on top of `d580d2457` — detached
HEAD, no amend, no branch, no push, test files only, no production change.

- **new sha: `7ed2c0b03`** (parent `d580d2457`)
- message: `remote : unconditional spy cleanup and mock reset in tests`
- `git show --stat HEAD` → **2 files changed, 8 insertions(+), 3 deletions(-)**
  (`openaiTransport.test.ts` +7/-3, `remoteEngine.lifecycle.test.ts` +4)
- tree clean after commit; AppShell still byte-identical to `e206a945b` (`git diff --quiet` → 0)

### What changed

1. **`src/engine/remote/openaiTransport.test.ts`** — the three `jest.spyOn(console, "warn")`
   spies (old lines 467, 495, 525) restored only after their assertions (old 489, 519, 544), so a
   failing assertion leaked the spy into later cases. Smallest clean form chosen: ONE
   `afterEach(() => jest.restoreAllMocks());` at the head of `describe("streamOpenAiChat")`
   (now :87) — covers every case pass-or-fail — and the three trailing `warned.mockRestore()`
   calls deleted, so exactly one cleanup mechanism exists (grep: only :87 remains).
2. **`src/engine/remote/remoteEngine.lifecycle.test.ts`** — `streamOpenAiChat` (the
   `jest.fn()` from the `./openaiTransport` mock) is now `mockReset()` in the existing
   `beforeEach`, directly next to `fetchMock.mockReset()`, so isolation no longer depends on each
   case installing its own implementation.

### Sabotage check (spy-leak proof)

Temporarily mutated `openaiTransport.test.ts` (restored from `/tmp/oat.bak` afterward, 0 markers
left): sabotaged the "production logs what is ours and none of the server's words" assertion
(`toBe(sent.length + 1)`) and inserted a probe case right after it asserting
`expect(jest.isMockFunction(console.warn)).toBe(false)` — i.e. the NEXT case must see a real
`console.warn`.

- `npx jest src/engine/remote/openaiTransport.test.ts --runInBand > /tmp/fix2-sabotage.log 2>&1`
  → exit **1** (expected): `Tests: 1 failed, 41 passed, 42 total`.
- The single failure was the sabotaged case (`● streamOpenAiChat › production logs what is ours
  and none of the server's words`); the **probe passed** → the `afterEach` restored the spy
  despite the mid-case failure → no leak into the next case. (Pre-fix, the probe would have seen
  a mocked `console.warn` and gone red.) File restored; `git diff --stat` back to only the two
  intended fixes.

### Proofs (real exit codes, `cmd > log 2>&1; echo $?`)

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `npx tsc --noEmit > /tmp/fix2-tsc.log 2>&1` (run 1) | **0** | |
| 2 | `npx jest src/engine/remote --runInBand > /tmp/fix2-jest.log 2>&1` (run 1) | **0** | 14 suites, 149 tests |
| 3 | sabotage run (see above) | **1** | expected; only the sabotaged case failed |
| 4 | final `npx tsc --noEmit > /tmp/fix2-tsc.log 2>&1; echo $?` | **0** | |
| 5 | final `npx jest src/engine/remote --runInBand > /tmp/fix2-jest.log 2>&1; echo $?` + `tail -5` | **0** | `Test Suites: 14 passed, 14 total` / `Tests: 149 passed, 149 total` |
| 6 | `git commit -m "remote : unconditional spy cleanup and mock reset in tests"` | **0** | sha `7ed2c0b03` |
| 7 | `git status --porcelain \| wc -l` post-commit | **0** | clean |

Full suite: **never run**. Only the two named test files touched; no production change.
