# STEP 2 — AppShell wiring (boot, selection, tools off, facade)

Worktree `~/Projects/kalsa-wt-bench-apk`, detached at `7ed2c0b03` at start, clean tree.
Scope: RECON §9b hunks #1–#7 (`src/app/AppShell.tsx`) + Open-items item 6 (a)(b)(d)(e).
One commit on top of `7ed2c0b03`, no branch, no push, no sub-agents, no formatter run
(the `ux-2026-09-21` line also edits AppShell: 28 changed hunks, all hand-placed, no reformatting).

## Commit

- **sha: `ec6a22592`** (parent `7ed2c0b03`; an intermediate `e9cf2e7de` was amended in place —
  still exactly one commit on top — to add the fallback intent sync found during this report's
  own merge audit; the amended and unamended states have identical proofs, both exit 0)
- message: `remote : wire the Brain client into the shell (boot, selection, tools off, facade)`
- `git show --stat HEAD` → **7 files changed, 725 insertions(+), 79 deletions(-)**
  (`AppShell.tsx` +422/−42 — corrected per audit F10b; `AppShell.remoteWiring.test.ts` +93 NEW,
  `engineBackend.test.ts`
  +136 NEW, `RemoteEngine.ts` 13, `remoteEngine.lifecycle.test.ts` +57, `remotePrompt.test.ts` 32,
  `remotePrompt.ts` 9)
- `git status --porcelain | wc -l` after commit → **0**
- `ModelInfo` unchanged (no `backend` field — UX decision respected); production hunks only
  where the port needs them.

## Hunks with final file:line (all in `src/app/AppShell.tsx` unless noted)

| # | Hunk | Final location |
|---|---|---|
| 1 | import blocks: `ensureIntent` (:62-70), `humanRemoteBrainError` (:71), `decideRemoteBoot` (:72), `modelIndexProbe` ×6 (:73-80) — inserted after `detectOrphansAtBoot`, before the embed import (branch order) | :62-80 |
| 2 | LlamaService keeps only main-new locals `buildSystemPrompt, chatKvLastSaveTokens, chatKvNPast, getAttemptedAssembleStart, lastNativeTokenAtMs, logPrewarmSkip, resolvedStaticPrefixTokens` (:144-151); new facade import = 20 wrapped fns + 5 types + 13 backend-only names from `../engine/engineBackend` (:152-191) | :144-191 |
| 3 | boot `useEffect` semantic merge: hydrate (:3009) → `decideRemoteBoot({…})` (:3015) → remote branch (intent/`setRemoteActive(true)`/`setEngineBackendMode("remote")`, :3027-3033) or local branch (`recoverLocalBackend()` :3035, persist `decision.persistModelId` :3036, migrated-to-local error :3052-3057, `pickStartModel({ savedId: decision.persistModelId, … })` :3041-3047… :3060-3066, `loadSetAside` + intent sync on flip :3072-3078 region) + branch catch (`recoverLocalBackend` :3078, force-default intent, persist default :3082-3087) + `finally setPrefsReady(true)` (:3090) | :3004-3090 |
| 4 | states `remoteActive`/`prefsReady`/`presenceProbeEpoch` (:2801-2804); `currentModel = remoteActive ? REMOTE_COMPUTER_MODEL : …` (:2812); refs `engineIntentRef` (:3113-3117), `remoteInitErrorRef` (:3118), typed `ensureEngineForModelRef → Promise<EnsureOutcome>` (:3120-3122), `inFlightEnsuresRef` (:3124); `ENSURE_DEADLINE_MS` (:506); initial-check probe effect — `prefsReady` gate, `decideModelIndexProbe({ switchInFlight, backendRemote: isRemoteEngineBackend(), intentRemote })` (:3984), `canEagerInitLocal` (:4007), deps `[modelIndex, prefsReady, presenceProbeEpoch]` (:4033); `remoteActive` ensure effect (:4035-4038); `runEnsureEngineForModel` (:4157) with `liveIntent`/`stillCurrent` via `ensureIntentStale`, remote path `if (captured.remote)` (:4184-4221: setEngineBackendMode→setRemoteActive→`initEngine("", REMOTE_COMPUTER_MODEL_ID, { locale, backend: "remote" })`, superseded rethrow, `humanRemoteBrainError` + `remoteInitErrorRef`), local gate `if (isRemoteEngineBackend()) return false;` (:4222); boundary `ensureEngineForModel` with `captureEnsureIntent`/`ensureIntentKey`/`InFlightEnsures.run`/`ensureOutcome` (:4653-4684) | see rows above |
| 3/4 | load-fallback site syncs intent before the direct fallback ensure (`engineIntentRef.current = { modelId: MODEL_REGISTRY[fallbackIndex].id, remote: false }`) | :4424-4427 |
| 4c | send path: `const ensure = await ensureEngineForModel(currentModel)` + `"superseded"` cede (`finish(); return;`) + `"failed"` with remote-brain copy `humanRemoteBrainError(remoteInitErrorRef.current …)` | :6019-6050 |
| 5 | `shouldNoopLocalSelect({ nextIndex, currentIndex, remoteActive: remoteActive \|\| engineIntentRef.current.remote })` (:4698-4704); intent + `beginBackendSwitch("local")` after the gen bump (:4721-4724); dispose: `let disposeOk` in IIFE scope, `wasRemote ? disposeRemoteEngine() : runNativeOpBounded(disposeEngine, …)` (:4800-4814), `switchDisposeUi` + `setEngineBackendMode("local")` on success (:4816-4829), branch-style catch error UI (:4831-4836), `finally` `endBackendSwitch()` + `shouldReprobeAfterSwitch → setPresenceProbeEpoch` (:4839-4844); **new** `selectRemoteComputer` (:4873-4941, `beginBackendSwitch("remote")` :4892, `afterRemoteSwitchDispose` :4911/:4926, persist `REMOTE_COMPUTER_MODEL_ID`, `ensureEngineForModel(REMOTE_COMPUTER_MODEL)`); `selectModelById` routes `modelId === REMOTE_COMPUTER_MODEL_ID` → `selectRemoteComputer()` (:4977-4980) with deps `[selectModel, selectRemoteComputer, t]` | see rows |
| 6 | tools-off spread `...(isRemoteEngineBackend() ? { tools: undefined, executeTool: undefined } : null)` | :7049-7051 |
| 7 | ready label ternary → `t("download.readyRemote")` with the branch comment | :7154-7160 |
| (a) | embed gate — job entry `if (isRemoteEngineBackend()) return;` (:1635), mid-job before `embedDocumentChunk` (:1889, call at :1893), rebuild preflight refuse (:2101) | see rows |
| (e) | `RemoteEngine.ts` :375-377 (`buildMemoryFactsBlock` → `applyMemoryFactsToLastUser`) + :397 (`turnMessages` into `toOpenAiMessages`); `remotePrompt.ts` :11-14 (facts no longer in the system slot) | — |

## Boot-merge reasoning (hunk #3)

Main invariants kept, branch graft added — they coexist; nothing was dropped silently:

1. **Which saved id feeds the death-marker defence:** `decideRemoteBoot` runs FIRST; its
   `decision.persistModelId` (which has already demoted a remote id to a local default — orphan /
   hydration-fail / stale cases) is the `savedId` handed to main's `pickStartModel`, and only the
   local branch runs it. Remote boot skips it entirely: nothing loads locally, and the probe effect
   (`decideModelIndexProbe` → `ensure-remote`) starts the remote engine instead.
2. **Main's defence fully retained:** `readLastGoodModelId` + `isMarked` + `startId === null`
   early-out, the `loadSetAside` message, and `loadFallbackTargetRef` all survive, operating on the
   demoted local id. Branch's `recoverLocalBackend()` + persist + migrated-to-local notice run
   before them; branch's `catch` keeps `recoverLocalBackend` fail-closed.
3. **Tension A — the catch:** main's comment says "preference read failure → keep the default boot
   model"; branch's catch also *writes* the default to storage. Both hold: the session boots the
   default either way (main's invariant), and the write enforces remoteBoot's headline rule
   (persisted id and forced-local backend must not disagree, else next boot flip-flops). Accepted
   trade-off (branch commit `2eb782e`): a transient storage read failure overwrites a saved local
   selection with the default. Noted, not silent.
4. **Tension B — intent vs index:** `ensureIntentStale` compares the captured model against
   `engineIntentRef`, not `modelIndexRef`. Every place that flips the index now writes the intent in
   the same synchronous step: boot flip (:4424… :3072-3075 region), `selectModel` (:4721-4723), and
   — found while writing this report — the **load-fallback** flip (:4424-4425), which had been left
   behind and would have made the fallback ensure read stale and refuse to load (dropping main's
   one-hop fallback invariant). That omission is why the commit was amended before this report.
   Boot paths that return without flipping leave the intent at its initial value, which stays
   aligned with the unchanged index. Remote intentionally diverges from the index (intent=remote id
   while the index keeps the last local row) — `currentModel` follows the intent via `remoteActive`.
5. **Overlap of the two error messages** (migrated-to-local vs load-set-aside): both can fire in
   one boot; the set-aside message is written last because it pairs with
   `loadFallbackTargetRef` — the model that will actually load. Both are errors, so main's
   "no silent flip" invariant holds either way.
6. **`prefsReady`:** new state released in the boot effect's `finally` (both branches and the
   catch), gating the probe effect so it never races hydration.

## Decision (a) — the embeddings promise: make the hint TRUE, don't rewrite it

The hint ("… embeddings … stay off in this mode", en `en.ts:132`, it mirror) stays as shipped; the
background indexing is gated in three places instead:

1. **Job entry** (`scheduleBackgroundEmbed`, :1635): skip before the embedder download, RAM probe,
   text extraction — no native embed work at all in remote mode.
2. **Mid-job flip** (:1889, above the `embedDocumentChunk` call at :1893): a backend switch during
   a running job stops it at the next chunk, logged as `partial`/`aborted` like the thermal gate.
3. **Rebuild preflight** (:2101): `rebuildSemanticIndex` refuses with the existing
   `{ ok: false, reason: "unavailable" }` **before** `deleteVectorIndexFile` — remote mode can
   never destroy a vector index it then refuses to rebuild. No new reason type (item: no types
   nobody constructs).

Why gate rather than reword: the other four items the hint lists are already gated (tools: hunk
#6; memory extraction/translation: `RemoteEngine` no-ops + AiChatPage gates; embeddings: the three
gates above) — voice was the exception, NOT gated at step 2 (the earlier “voice: step-1 gates”
claim here was false; fix round 1 traced dictation and reworded the hint instead),
so gating embeddings keeps ONE truthful sentence instead of diluting the promise. Resume semantics
match the file's existing acceptance class (thermal-gate skip, embedder-missing skip): an aborted
job re-runs on the next import or an explicit rebuild after switching back to local — indexed docs
are unaffected (the gate only stops new embedding work).

## Decision (e) — fact placement: ALIGN to the last user turn (the porter's call — the brief asked
the porter to decide; the owner did NOT decide fact placement)

**Decision: remote turns now put the fact block on the last USER message (format B), not the
system prompt.** Reused main's functions, not copies: `buildMemoryFactsBlock` and
`applyMemoryFactsToLastUser` from `src/engine/memoryFactsTail.ts` (:26-34, :331-346); applied in
`streamRemoteAssistantTurn` (`RemoteEngine.ts:375-377`, :397). `remotePrompt.ts` no longer accepts
facts — its comment (:11-14) records where they went and why.

The reason main gives (`ttftFlags.ts:24-31`): *"A new fact then re-encodes only that tail — the
stable history prefix (and its KV) stays valid"* plus the prewarm clause. Splitting it:

- **The prefix-cache half applies to llama-server verbatim.** llama-server prefix-matches the full
  prompt across requests to reuse its KV/context. Facts in prompt position 0 mean every fact edit
  invalidates position 0 → re-encode of the *entire* conversation; facts on the last user turn
  leave the system prompt and all history byte-stable and re-encode only the tail. Same machine
  reasoning, same conclusion — local and remote now share one placement policy.
- **The prewarm half does NOT apply remotely:** there is no local model loaded in remote mode, so
  `queueStaticPrefixPrewarm` and the facts-in-system prewarm objection are moot. Nothing argues
  *for* system placement remotely; the cache argument argues against it. Hence align, not keep.
- **The revert flag is not consulted remotely:** `MEMORY_FACTS_ON_USER_TAIL = false` is a local-KV
  escape hatch; remote follows the default (format B) unconditionally — if it were ever flipped,
  remote placement would stay put and the privacy disclosure's "memory … is sent" stays true.
- **Pinned:** lifecycle test "memory facts ride the last user turn, not the system prompt"
  (`remoteEngine.lifecycle.test.ts:788`) asserts on the actual `streamOpenAiChat` request: system
  prompt contains no fact marker, last user message contains the fact and its text. It goes red if
  facts disappear OR leak back into the system slot. `remotePrompt.test.ts` was cut to 2 tests
  (exact system prompt, operative block) — the facts tests moved to the engine level with the
  behaviour. The fix-round-1 system-slot tests are superseded by this placement decision (porter's,
  per the section header — not an owner instruction).
- **Out of the brief's scope, flagged for audit:** the operative digest/summary still rides the
  SYSTEM prompt remotely (`remotePrompt.ts:15-19`), while local puts it on the tail
  (`LlamaService.ts:4442-4446`); the digest refreshes per user turn, so remote system position
  changes every turn (branch-shipped, documented in RECON §5). Not changed here — fact placement
  was the question; moving the operative block too is a separate call for the audit.

## Tests: what is pinned, and how it was sabotaged

Behaviour tests (real assertions, each sabotaged once, red, restored):

| Pin | File | Sabotage → result |
|---|---|---|
| (d) facade dispatch local/remote + `memoryFacts` pass-through on the REAL path | `src/engine/engineBackend.test.ts` (3 tests) | `if (backend === "remote")` → `if (false && …)` in `engineBackend.ts` → exit **1**, `Tests: 1 failed, 2 passed` (the remote-stream test), restored |
| (e) facts on the last user turn, absent from system | `remoteEngine.lifecycle.test.ts:788` | dropped the tail apply → exit **1**, `1 failed, 24 passed`, restored |
| (a) embed gates present | `src/app/AppShell.remoteWiring.test.ts` | removed the entry gate line → exit **1**, `1 failed, 5 passed`, restored |

Source pins (line-level only — see honesty note in the file header): `src/app/AppShell.remoteWiring.test.ts`
pins the facade import split (+LlamaService keeps only main-new locals), boot-graft order
(`decideRemoteBoot` before `pickStartModel`, `recoverLocalBackend`, migrated message), selection
flow text (`selectRemoteComputer`, the `selectModelById` remote route, `currentModel` swap,
both `beginBackendSwitch` arms + `endBackendSwitch`), the tools spread, the ready-label ternary,
and the three embed gates.

## Untested wiring (no behaviour test — needs rendering, native init, or a device)

1. **Boot merge glue** — hydration snapshot → `decideRemoteBoot` → backend flip / `recoverLocalBackend`
   → `pickStartModel` sequencing, `loadSetAside`/migrated error UIs, `prefsReady` release
   (`AppShell.tsx:3004-3090`). Only `decideRemoteBoot`/`pickStartModel` themselves are unit-tested.
2. **Probe effect sequencing** — `prefsReady` gate, skip/ensure-remote/probe-local order, eager-kick
   suppression in remote mode (`:3973-4033`). Helper `decideModelIndexProbe` tested; the effect is not.
3. **`remoteActive` effect** kicking the remote ensure after boot (`:4035-4038`).
4. **`runEnsureEngineForModel` remote path at runtime** — backend flip, `initRemoteEngine`, state
   writes, superseded-marker propagation through the boundary into the send path's cede
   (`:4157-4226`, `:4653-4684`, `:6019-6050`). `ensureIntent`/`InFlightEnsures` are unit-tested; the wiring is not.
5. **`selectRemoteComputer` full switch** — dispose → flip → persist → ensure, Alert guards
   (`:4873-4941`).
6. **`selectModel` local-switch graft** — intent write, `beginBackendSwitch("local")`, wasRemote
   dispose split, `setEngineBackendMode("local")`, catch error UI, finally end/reprobe
   (`:4698-4850`).
7. **`selectModelById` remote route at runtime** (`:4977-4980`) — text-pinned only.
8. **Real send path** — `...agentOptions` + tools spread + `memoryFacts: promptFacts` reaching the
   facade during an actual turn (`:7049-7061`); the facade half is behaviour-tested, the
   AppShell call site is text-pinned only.
9. **Embed gates' runtime effect** — job actually stops mid-run; rebuild refusal surfaces in the
   Settings UI (`:1635`, `:1889`, `:2101`). Text-pinned only.
10. **Out of scope, observed, NOT ported** (not in hunks #1-#7): branch sites for humanizing remote
    errors *in the conversation* (`isInternalErrorCode`/`humanRemoteBrainError` at branch
    `AppShell.tsx:5268` and the stream-side `isSupersededRemoteOp` check at branch `:6164`).
    Main's stream `onError` still renders `⚠️ ${error.message}` — a remote transport failure would
    show a raw `remote_brain_*` code there. The branch commits that fixed this (`e657550`,
    `1d90e9e`) are outside the RECON hunk table; flagged for the audit/step-3 decision rather than
    silently widened here.

## Exit codes (real, `cmd > log 2>&1; echo $?`; never the full suite)

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `npx tsc --noEmit > /tmp/port-tsc.log 2>&1` | **0** | empty log |
| 2 | `npx jest src/engine/remote --runInBand > /tmp/port-jest-remote.log 2>&1` | **0** | 14 suites, **148** tests |
| 3 | `npx jest src/engine/ensureIntent.test.ts src/engine/modelIndexProbe.test.ts src/engine/regenState.test.ts --runInBand > /tmp/port-jest-wiring.log 2>&1` | **0** | 3 suites, 28 tests |
| 4 | `npx jest src/screens/RemoteBrainSettings.hydration.test.ts --runInBand > /tmp/port-jest-panel.log 2>&1` | **0** | 1 suite, 17 tests |
| 5 | `npx jest ModelRegistry engineBackend historyPersistable llamaContextGate --runInBand > /tmp/port-jest-neighbours.log 2>&1` | **0** | 3 suites, **12** tests (engineBackend now 3 of them) |
| 6 | `npx jest src/app --runInBand > /tmp/s2-app.log 2>&1` (dir has tests) | **0** | 6 suites, 59 tests |
| 7 | sabotage: facade dispatch broken → `npx jest src/engine/engineBackend.test.ts` | **1** | 1 failed / 3, restored |
| 8 | sabotage: tail apply removed → `npx jest src/engine/remote/remoteEngine.lifecycle.test.ts` | **1** | 1 failed / 25, restored |
| 9 | sabotage: embed entry gate removed → `npx jest src/app/AppShell.remoteWiring.test.ts` | **1** | 1 failed / 6, restored |
| 10 | proof re-run of 1-6 after the fallback-intent fix (identical commands) | **0, 0, 0, 0, 0, 0** | same counts as above |
| 11 | `git commit --amend --no-edit` (fold the fallback fix into the single commit) | **0** | sha `ec6a22592` |
| 12 | `git status --porcelain \| wc -l` post-commit | **0** | clean |

Full suite: never run. Other worktrees (`kalsa`, `kalsa-ux`, Paseo): never touched. No push.

## Fix round 1

Audits: `AUDIT-STEP2-luna.md` + `AUDIT-STEP2-deepseek.md`, both FIX-FIRST on `ec6a22592`.
One NEW commit on top (no amend): **sha `77f487a65`**, message
`remote : disclose notes, close switch and rebuild races, humanize remote errors` →
**14 files changed, 188 insertions(+), 65 deletions(-)**; `git status --porcelain | wc -l` → **0**.
Line refs below are at `77f487a65`. In-place corrections applied above (item 11): AppShell step-2
numstat **+422/−42** (audit F10b — the earlier +464/−~30 came from grepping before the
fallback-intent amend; step-2 anchors drift by +3 from `4424` down, e.g. the tools spread is now
`:7105-7107`, ready label `:7211`, send ensure `:6069`), “voice: step-1 gates” retracted, and (e)
re-attributed to the porter, not the owner.

### Per item

1. **Disclosure names notes — FIXED.** Owner's exact texts landed: en `en.ts:134-135`, it
   `it.ts:133-134`. The disclosure test now pins BOTH literals (`RemoteBrainSettings.disclosure.test.ts`:
   “the shipped disclosure and its Italian mirror are the owner's exact texts”) — a copy regression
   fails there, not in review. Feature (notes chip) untouched, per owner.
2. **Voice hint — FIXED after trace (did NOT stop).** Trace: `handleMicPress`
   (`AiChatPage.tsx:1516`) → `startCapture`/`stopAndTranscribe` → `ensureWhisper` +
   `transcribePcm` (`WhisperService.ts:58,:104`, whisper.rn, its own bundle) → `setDraft(text)`
   (`AiChatPage.tsx:1381`) → ordinary text send. `grep 'LlamaService|initEngine|…' src/voice/*.ts`
   → **empty**; `voiceReady` is the whisper bundle, not the chat LLM; audio never leaves the phone
   and no local LLM is required. So dictation works in remote mode → “voice” removed from
   `settings.remoteBrainHint` (en `:132-133`, it mirror), rest of sentence untouched; test
   “the hint no longer claims voice is off in remote mode” pins the absence (en `/voice/`,
   it `/voce/`).
3. **Rebuild race — FIXED.** Fresh check directly before the delete with only sync calls between:
   `AppShell.tsx:2133-2137` (`if (isRemoteEngineBackend()) return unavailable` →
   `bumpEmbedJobGeneration()` → `await deleteVectorIndexFile`) after the two awaiting preflights.
   Pinned by source pin “rebuild re-checks the backend with no await before the delete (race fix)”.
   **The interleaving itself stays untested** (needs a render); the pin is textual.
4. **Boot catch + F6 — FIXED, next-boot coherence below.** Boot is read-only again: the catch
   restores main's comment and contract — “Preference read failure → keep the default boot model
   (main's contract): this launch only, nothing persisted” (`AppShell.tsx:3089-3091`), and the
   `AsyncStorage.setItem(..., getDefaultModel().id)` write is gone. The local-branch persist
   (F6) is narrowed to the one real demotion:
   `if (decision.reason === "orphan" && saved === REMOTE_COMPUTER_MODEL_ID)` → persist
   `decision.persistModelId` (`:3046-3048`) — a hydration failure (whose `persistModelId` is the
   default) can no longer overwrite a saved local choice; a stored remote id without a URL still
   dies (step-1's `b564fff` invariant).
   **Why the next boot stays coherent without the write:** a transient read failure leaves the
   model key untouched, so the NEXT boot re-reads the same durable choice and (with hydration
   healthy) boots exactly what the user had picked; if that choice was the remote id and the URL
   is still absent, `decideRemoteBoot` demotes it again as `orphan` — now with the persist rule
   above, which writes only then. The backend cache in the catch is handled by item 5(a), so no
   boot state depends on the removed write.
5. **Intent/cache agreement on failure — FIXED ×3.**
   (a) Boot catch when `recoverLocalBackend()` fails (`:3096-3111`): the old “cache still forced
   local” comment was false (the setter rolls back on write failure). Now: align intent +
   `remoteActive` to the ACTUAL cache (`isRemoteEngineBackend()`), surface
   `settings.remoteBrainSaveFailed`, and the `prefsReady` release re-probes — ensuring whichever
   side the cache landed on, so a local `currentModel` can never sit on a remote backend with no
   ensure.
   (b) Remote→local flip whose `setEngineBackendMode("local")` fails after the remote dispose
   (`:4867-4879`): align back to the remote cache (`engineIntentRef = remote id`,
   `setRemoteActive(true)`), surface saveFailed, and `setPresenceProbeEpoch` re-probes so the
   just-disposed remote engine is re-armed behind the error. The IIFE `finally` runs after this
   catch, so the probe sees `modelSwitchInFlightRef === false` (no skip).
   (c) The fire-and-forget model-id write (`:4783-4787`) now surfaces
   `showNotice(t("settings.remoteBrainSaveFailed"))` on failure instead of silently letting the
   stored remote id win next launch. `showNotice` added to `selectModel` deps.
6. **Pre-IIFE switch-intent leak — FIXED.** The local outer catch now calls `endBackendSwitch()`
   (`:4898-4901`) beside the lock/gen release. **Check requested:** `grep` pairing —
   `beginBackendSwitch(` = 2 sites (selectModel `:4772`-area “local”, selectRemoteComputer
   “remote”); `endBackendSwitch();` = 3 call sites (local IIFE `finally` `:4884`, local outer
   catch `:4901` — mutually exclusive with the finally, as that catch only sees pre-launch
   throws — and remote IIFE `finally` `:4984`), plus `recoverLocalBackend()` ends it internally
   (`remoteSettings.ts:57-58`). Every begin now ends on every path, so a STALE intent cannot
   survive into a later boot; boot's direct remote setter can only meet an intent that belongs to
   a LIVE switch, which that switch's own `finally` clears — the stale-refusal scenario (deepseek
   F8) is closed at its root rather than worked around in boot.
7. **Raw codes — FIXED.** Stream `onError` (`:7089-7093`): messages starting `remote_brain_` go
   through `humanRemoteBrainError`, everything else keeps its exact old text (local errors
   byte-identical — the gate is the prefix, not `isInternalErrorCode`, so `context_full` etc.
   are untouched). `selectRemoteComputer` catch (`:4977-4980`): same pattern on the raw message.
   `remote_brain_sse_error` added to `CODE_KEYS` → `settings.remoteBrainFailNetwork`
   (`remoteBrainErrors.ts:16-18`) instead of relying on the generic fallback, with a test
   assertion in `remoteBrainErrors.test.ts`.
8. **Re-probe every turn — FIXED.** Ready short-circuit at the top of the remote branch
   (`:4207-4214`): `isEngineReady() && getActiveModelId() === REMOTE_COMPUTER_MODEL_ID` →
   `return true`, before `setModelState("loading")` — mirrors the local one; no `/props` +
   `/v1/models` round trips and no loading flash per turn. Config staleness is already handled:
   `stillCurrent()` runs immediately above and `ensureIntentKey` carries `url|serverModel`, and
   the stream reads url/model fresh per request, so an edited configuration is a different
   attempt.
9. **Attachments — FIXED with the SMALLER option: gate (not tell-after).** Chosen: gate the
   attach option exactly like translate — `onComposerAttach` (`AiChatPage.tsx:3631-3641`, the
   SOLE `setAttachSheetOpen(true)` site) early-returns with `showVoiceNote(t("settings.remoteGated"))`
   in remote mode. One gate covers photo/camera/PDF/library rows behind the sheet. Known edge
   accepted: attachments already in the draft when the user switches to remote still travel
   through the normal send (docs → names only, images dropped by `toOpenAiMessages`) — no notice
   for that pre-armed case; listed under untested/unpinned.
10. **Dead code — REMOVED per grep.** `isOrphanRemoteWithoutUrl`: production callers **0**
    (`decideRemoteBoot` re-implements the check); its only callers were its own two unit cases →
    function, `engineBackend` re-export, `engineBackend.test` mock line, and both test usages
    removed (the “virgin storage” test keeps its non-orphan assertions). `switchDisposeUi.reprobe`
    and `afterRemoteSwitchDispose.reprobe`/`inFlightReleased`: production readers **0** (AppShell
    uses `shouldReprobeAfterSwitch` + `surfaceError`/`remoteActive`) → fields removed, tests
    re-pointed at `shouldReprobeAfterSwitch` and the remaining fields. Left alone (not named in
    the item): the misleading `remote.brain.token` log tag — payload is a length, flagged as a
    leftover nit only.
11. **STEP2 corrections — DONE in place** (see top of this file: stat +422/−42, voice-claim
    retraction, (e) attribution).

### Sabotages (13 cycles, each: mutate → run → the named test red → restore; `cmp` verified)

| # | Mutation | Red test |
|---|---|---|
| S1 | revert en disclosure copy | disclosure literal + “shows what is sent” (2 red) |
| S2 | remove rebuild pre-delete re-check | “rebuild re-checks the backend with no await before the delete (race fix)” |
| S3 | remove attach gate | “composer attach is gated in remote mode with the gated note” |
| S4 | revert stream humanize to `${error.message}` | “stream errors humanize remote codes and leave everything else alone” |
| S5 | revert selectRemoteComputer humanize | “selectRemoteComputer humanizes its catch” |
| S6 | remove ready short-circuit | “remote ensure short-circuits when ready, before the loading flash” |
| S7 | re-add default-write in boot catch | “boot catch keeps main's read-only contract: no persistent write” |
| S8 | remove `endBackendSwitch()` from outer catch | “failure paths agree intent with the backend cache” |
| S9 | unconditional boot persist | same boot-catch pin (orphan-rule assertion) |
| S10 | remove flip-catch re-probe bump | “failure paths agree intent with the backend cache” |
| S11 | silent model-id write again | same failure-paths pin |
| S12 | `cacheRemote` no longer reads the cache | same boot-catch pin (cacheRemote assertion) |
| S13 | remove `remote_brain_sse_error` mapping | “transport failures get actionable copy…” |

Every gate added this round has its own red run. All files restored byte-identical (`cmp` OK).

### Untested after this round (honest list)

- **Rebuild race behaviour** — interleaving untestable without rendering AppShell; source pin only.
- **Failure-path alignments at runtime** (5a/5b): whether the probe actually re-ensures after the
  aligned intent — text-pinned, not behaviour-tested.
- **Attach gate runtime** (does the note paint) — text-pinned.
- **Chat humanization runtime** (what the bubble shows) — text-pinned; the underlying
  code→copy mapping IS behaviour-tested (`remoteBrainErrors.test.ts`).
- **Short-circuit runtime** (no HTTP round trips, no flash) — text-pinned.
- **endBackendSwitch-on-throw path** — text-pinned; the F8 live-switch window (boot setter meeting
  a LIVE intent) is reasoned closed, not tested.
- **Pre-armed attachments across a switch to remote** (item 9 edge) — no test, accepted.
- Behaviour-tested this round: disclosure/hint literals (both locales), sse_error mapping,
  dead-code removals covered by the surviving suites (23 suites / 236 tests green).

### OPEN FOLLOW-UP (not changed this round, per instruction): operative digest on the remote system prompt

luna P3, recorded verbatim in substance: remote keeps the operative digest/summary in the SYSTEM
prompt (`remotePrompt.ts:8-20`; applied at `RemoteEngine.ts:396-402`), while main puts both on the
last-user tail (`ttftFlags`/`LlamaService.ts:3893-3900,4437-4446`) because the query-time digest
refreshes every user turn. A changed digest at prompt position 0 means a prefix-cache server
(llama-server) can reuse only the common prefix before it and must reprocess the whole later
conversation — a real structural cache cost, magnitude unmeasured. Same shape as the facts
question decided above, but explicitly OUT of this round. Decision deferred to the audit/owner.

### Proofs (real exit codes, `cmd > log 2>&1; echo $?`, `tail -5`; never the full suite)

| # | Command | Exit | Result (tail) |
|---|---|---|---|
| 1 | `npx tsc --noEmit > /tmp/fix2-tsc.log 2>&1` | **0** | empty log |
| 2 | `npx jest src/app src/engine/remote src/engine/engineBackend src/screens/RemoteBrainSettings --runInBand > /tmp/fix2-jest.log 2>&1` | **0** | `Test Suites: 23 passed, 23 total` / `Tests: 236 passed, 236 total` / `Ran all test suites matching src/app\|src/engine/remote\|src/engine/engineBackend\|src/screens/RemoteBrainSettings.` |
| 3 | 13 sabotage cycles (S1–S13 above) | each **1/nonzero** (expected) | exactly the named test(s) failed; `cmp` verified restores |
| 4 | `git commit -m "remote : disclose notes, close switch and rebuild races, humanize remote errors"` | **0** | sha `77f487a65`, one commit on top of `ec6a22592`, no amend |
| 5 | `git status --porcelain \| wc -l` post-commit | **0** | clean |

Full suite: never run. No push. No sub-agents.

## Fix round 2

Re-audits: luna `## Re-audit (77f487a65)` FIX-FIRST, deepseek `## Re-audit (77f487a65)`
SHIP-WITH-FIXES. One NEW commit on top of `77f487a65` (no amend):
**sha `0fa9bde99`**, message
`remote : gate every attach path, invalidate stale readiness, normalize remote errors` →
**10 files changed, 204 insertions(+), 24 deletions(-)**; `git status --porcelain | wc -l` → **0**.
Line refs below are at `0fa9bde99`.

### Per item

1. **Copy — FIXED.** `en.ts:133` now reads exactly *"Use your computer as the model. Set its
   address below. Tools, memory extraction, translation and embeddings stay off in this mode."*
   Italian untouched. The disclosure test pins the exact EN literal (plus the no-`voice`
   assertions), so a wording regression goes red (sabotage T1).
2. **Rebuild race, second half — FIXED.** `selectRemoteComputer` now refuses with the same
   Alert pattern as stream/regen while `semanticRebuildInFlight || isDeleteActive()`
   (`AppShell.tsx:4938-4943`), with `semanticRebuildInFlight` added to its deps. Both flags
   already existed — no new ref: `isDeleteActive()` is true from `tryAcquireDelete()` through the
   awaited preflights and the awaited delete (acquired before the first await), and
   `semanticRebuildInFlight` covers the scheduled embed pass; the handoff between them is
   synchronous, so no interleaving window remains. With the switch refused for the whole arc, the
   embed entry gate can never reject a rebuild's own pass → the index cannot be lost (luna's
   remaining interleaving closed). Source-pinned (sabotage T2).
3. **Persistence (c) — FIXED at the decision.** `remoteBoot.ts:47`:
   `const wantsRemote = input.backend === "remote";` — `savedWantsRemote` deleted. The backend key
   is the live choice; the model id alone never re-opens remote, so a stale saved remote id (id
   write failed during remote→local while the backend write succeeded) cannot override the user's
   later local selection. **Why it cannot flip-flop:** boot writes at most two things —
   `recoverLocalBackend()` re-persists `backend=local` (idempotent) and the orphan rule writes the
   model id only when `backend=remote && reason==="orphan"` (then backend also becomes local).
   Under the new rule a `backend=local` store can never again evaluate `wantsRemote=true`, so boot
   never rewrites anything toward remote; going remote again requires a fresh user selection
   (which writes both keys together). One-directional convergence, no oscillation. New behaviour
   test in `remoteBoot.test.ts` (sabotage T3). Existing remoteBoot tests untouched — none pinned
   the deleted disjunct (verified: every `savedModelId: remote` case had `backend: "remote"` or
   failed hydration).
4. **Stale ready after config change — FIXED.** Cycle-free hook: `remoteSettings.ts:45-53`
   holds `onRemoteConfigChanged` + `setRemoteConfigChangedHook` (module stays a leaf, no import of
   RemoteEngine); both `setRemoteBrainUrl` (:172) and `setRemoteServerModelId` (:181) fire it
   after a *changed, successful* write. `RemoteEngine.ts:50-52` registers the hook and drops
   `ready`, so the next ensure re-probes the edited server instead of the short-circuit trusting
   the old verdict. Collateral handled: the config gate now runs before the ready gate
   (`RemoteEngine.ts:245-253`), so a cleared URL still reports the actionable `url_missing`
   (the existing lifecycle test passes unchanged) and a config edit reads as `url_missing` /
   `model-not-loaded` rather than a misleading probe verdict. Behaviour test
   "editing the URL or server model drops remote readiness" (sabotage T4).
5. **Native remote exceptions — FIXED at the BOUNDARY (my choice: RemoteEngine, not AppShell
   branching).** The stream's outer catch (`RemoteEngine.ts:478-489`) converts anything that is
   not already an internal code into `remote_brain_internal` before `finishOnce`, so every error
   leaving the remote path carries the `remote_brain_` prefix and reaches the user through
   `humanRemoteBrainError`'s generic copy (`remoteBrainErrors.ts` fail-closed fallback). The
   SecureStore-throw path (`remoteSecret.ts:15-23`) can no longer reach chat verbatim.
   `selectRemoteComputer` (`AppShell.tsx:4991`) is now unconditional
   `setModelError(humanRemoteBrainError(raw, t))` — no raw fallback branch left. **Local errors
   stay byte-identical:** the stream's non-prefix else-branch (`: error.message`) is untouched, so
   LlamaService/local-engine messages render exactly as before, and `remoteBrainErrors` only ever
   echoes translation keys. Behaviour tests: "a native remote exception never reaches the UI
   verbatim" (sabotage T5) + pin (sabotage T6).
6. **Attach gates — ALL PATHS FIXED.** Three new gates, same `settings.remoteGated` note:
   - library chip `onComposerDocument` (`AiChatPage.tsx:3673-3677`) — blocks the picker entry;
   - share path `attachLibraryDoc` effect (`:3744-3749`) — a doc shared into a remote session is
     refused with the note instead of silently armed;
   - file import `addPdfAttachment` (`:1714-1718`) — the function that owns the docx branch at
     the cited `:1749` (one gate covers the sniffed docx/pdf/legacy rows of that picker).
   Together with round 1's `onComposerAttach` gate (`:3659`), every `setAttachSheetOpen(true)`,
   `setDocPickOpen(true)` and `addLibraryDocumentAttachment` caller is behind a remote gate
   (grep-verified: the three `addLibraryDocumentAttachment` sites are the gated effect, the gated
   `importAndAttachDocx` (only reachable via the gated picker), and the gated doc-chip picker row).
   **Pre-armed attachment decision:** an attachment armed *before* a switch to remote is KEPT, not
   silently deleted — it travels with its honest content profile: library docs become disclosed
   `[document:id name]` names only, media images are dropped by `toOpenAiMessages` (text-only), and
   the user can remove items from the composer. Silent removal would destroy user intent; the
   disclosure already names what does travel. Source-pinned (sabotages T7/T8/T9).
7. **N1 — FIXED.** One guard after the decision, before either branch:
   `if (modelSwitchInFlightRef.current) return;` (`AppShell.tsx:3035`). A tap landing during
   hydration owns intent and index; boot skips its application entirely (the switch's own flip,
   `finally` epoch bump and the probe's `switchInFlight` skip take over), and `prefsReady` still
   releases in the `finally`. Pinned (sabotage T10).
8. **N2 — FIXED.** The stream-humanize pin is now an order-sensitive regex on the full ternary
   (`startsWith("remote_brain_") ? humanRemoteBrainError(error.message, t) : error.message`), so
   the inversion fails it; the loose `toContain`s that let the inversion through are gone.
   **Sabotage T11 = the inversion itself → pin red**, as required.
9. **False comment — FIXED.** Boot catch (`AppShell.tsx:3093-3096`) now says: the *model choice*
   is read-only this launch (no `MODEL_STORAGE_KEY` write); only `recoverLocalBackend` may write,
   and only the backend key, as `"local"`. True statement (verified: `recoverLocalBackend` →
   `setEngineBackendMode("local")` → `ENGINE_BACKEND_KEY` write).
10. **Orphan boot write — RECORDED as a coordinator-accepted deviation from main's read-only
    boot contract.** Main never wrote `MODEL_STORAGE_KEY` at boot. The accepted exception
    (`AppShell.tsx:3046-3048`) rewrites ONLY a stored `REMOTE_COMPUTER_MODEL_ID` under
    `reason === "orphan"` — a synthetic id that main never wrote (the port persists it in
    `selectRemoteComputer`), whose presence with an empty URL is exactly the state `decideRemoteBoot`
    demotes. It can never touch a local id the user chose through main's own UI; everything else at
    boot stays read-only.

### Sabotages (11 cycles: mutate → run → the named test red → restore; `cmp` verified)

| # | Mutation | Red test |
|---|---|---|
| T1 | drop the "and" from the EN hint | “the hint no longer claims voice is off…” (exact literal) |
| T2 | remove the rebuild guard in `selectRemoteComputer` | “selectRemoteComputer refuses while a rebuild is in flight” |
| T3 | restore `savedWantsRemote` | “a stale saved remote id cannot override a later local choice” |
| T4 | remove the URL-setter readiness hook call | “editing the URL or server model drops remote readiness” |
| T5 | revert the boundary normalization | “a native remote exception never reaches the UI verbatim” |
| T6 | `selectRemoteComputer` back to the prefix ternary | “selectRemoteComputer humanizes its catch unconditionally” |
| T7 | remove the library-chip gate | “library chip, share path and file import are all gated…” |
| T8 | remove the share-effect gate | same attach-gate pin |
| T9 | remove the `addPdfAttachment` gate | same attach-gate pin |
| T10 | remove the N1 boot guard | “boot does not overwrite the intent of a switch in flight (N1)” |
| T11 | **invert** the stream-humanize ternary (N2) | “stream errors humanize remote codes…” |

Every new gate has its own red run; all restores byte-verified.

### Untested after fix round 2 (honest list)

- **Rebuild-refusal behaviour** (does the Alert actually block the tap, does the rebuild arc stay
  un-interrupted) — source-pinned only; no render.
- **N1 at runtime** (a real tap inside the hydration window) — source-pinned; the scenario is
  ms-scale and reasoned.
- **Attach gates at runtime** (notes actually paint on chip/share/import) — source-pinned;
  underlying gating logic is the same one-line shape as the tested round-1 opener.
- **Pre-armed attachment KEEP decision** — stated policy, no test (content profile itself is
  covered by `openaiMessages`' text-only contract and the disclosure test).
- **`remote_brain_internal` end-to-end display** — the boundary conversion and the code→generic
  mapping are each behaviour-tested (lifecycle + `remoteBrainErrors.test`); the chat bubble render
  stays a source pin (AppShell unrenderable).
- Behaviour-tested this round: hint/disclosure literals, `wantsRemote` rule, readiness
  invalidation (URL + model), boundary normalization; **23 suites / 242 tests green.**
- Unchanged open nits (not in items): `remote.brain.token` log tag name; deepseek F15
  (setState-without-mounted-guard, 120 s ensure deadline) — low, previously declared open.

### Proofs (real exit codes, `tail -5`; never the full suite)

| # | Command | Exit | Result (tail) |
|---|---|---|---|
| 1 | `npx tsc --noEmit > /tmp/fix2-tsc.log 2>&1` | **0** | empty log |
| 2 | `npx jest src/app src/engine/remote src/engine/engineBackend src/screens/RemoteBrainSettings --runInBand > /tmp/fix2-jest.log 2>&1` | **0** | `Test Suites: 23 passed, 23 total` / `Tests: 242 passed, 242 total` |
| 3 | 11 sabotage cycles (T1–T11) | each nonzero (expected) | exactly the named test red; `cmp` verified restores |
| 4 | `git commit -m "remote : gate every attach path, invalidate stale readiness, normalize remote errors"` | **0** | sha `0fa9bde99`, one commit on top of `77f487a65`, no amend |
| 5 | `git status --porcelain \| wc -l` post-commit | **0** | clean |

Full suite: never run. No push. No sub-agents.

## Fix round 3

Re-audits: `## Re-audit 2 (0fa9bde99)` in both audit files (luna FIX-FIRST, deepseek
SHIP-WITH-FIXES). ONE new commit on top of `0fa9bde99` (no amend):
**sha `d7d33e90f`**, message
`remote : close boot/rebuild and config-write races, own copy for the rebuild refusal` →
**8 files changed, 245 insertions(+), 26 deletions(-)**; `git status --porcelain | wc -l` → **0**.
Line refs below are at `d7d33e90f`.

### Per item

1. **Boot flip during a delete — FIXED.** The single boot guard after the decision is now
   compound (`AppShell.tsx:3044-3053`): `modelSwitchInFlightRef.current ||
   semanticRebuildBusyRef.current || isDeleteActive()`. With a rebuild running, boot returns
   before EITHER branch: no remote flip, and it persists nothing new — the live backend cache is
   the fresh-process default `"local"` (hydrate never writes it), the index stays at its default,
   no `MODEL_STORAGE_KEY`/`ENGINE_BACKEND_KEY` write happens, and the next launch retries the
   stored choice (the rebuild will be done). Pinned (boot-guard pin; sabotage **C1**).
2. **Pre-render gap — FIXED with the REF (their option b).** New
   `semanticRebuildBusyRef` (`AppShell.tsx:1196-1200`, "Synchronous mirror of the state above").
   It is set `true` at `:2157` in the same synchronous stretch as `releaseDelete()` (no `await`
   between — no tap handler can run in the gap) and cleared in the schedule's `.finally` (`:2160`).
   BOTH guards read the ref — selector `:4957`, boot `:3050` — which also fixes boot's frozen
   render-closure (the boot effect captures state once, refs are read live). The React state stays
   purely for the `isSemanticRebuildBusy` UI prop, and drops out of the selector's deps. Chose the
   ref over moving the setState because moving state earlier still leaves the setState→render
   window; the ref has none. Pinned (guard pin asserts ref-not-state; sabotage **C2**).
3. **Config invalidation race — FIXED both halves.** (i) The hook now fires BEFORE
   `await commit(...)` (`remoteSettings.ts:172` URL, `:181` model) — commit assigns the new cache
   value synchronously, so readiness drops in the SAME synchronous stretch as the assign; no
   ensure can observe the new config with `ready=true`. A failed write leaves readiness dropped,
   the safe direction. Source pin is order-sensitive (sabotage **C3**). (ii) The hook also does
   `initGeneration += 1` (`RemoteEngine.ts:54`), so a probe already in flight re-checks its
   generation after the probe and throws `supersededInitError` instead of marking ready against
   the old server (deepseek R2-2). Behaviour test "a config edit during a probe supersedes it"
   (sabotage **C4**).
4. **URL/model mixing mid-turn — FIXED.** Both captured together at turn start, before the token
   await: `const serverModel = getRemoteServerModelId();` next to `const base = getRemoteBrainUrl()`
   (`RemoteEngine.ts:255-256`), request uses `model: serverModel` (`:415`). One turn = one server
   identity; the running stream is NOT aborted on a config edit (the hook only drops readiness and
   supersedes future probes — `streamGeneration` is untouched), the next turn uses the new config.
   Behaviour test edits BOTH the model and the URL while the token await is pending and asserts
   the request carries the pre-edit identity (sabotage **C5**).
5. **Rebuild refusal copy — FIXED, own keys in en and it.** `settings.switchWhileRebuildingTitle/
   Body` (`en.ts:199-201` "Index rebuild in progress" / "Switch to your computer after the document
   index finishes rebuilding."; `it.ts:198-200` "Ricostruzione indice in corso" / "Passa al computer
   quando l'indice dei documenti ha finito di ricostruirsi.") — exact owner wording, no "Continue?".
   The rebuild branch uses them (`AppShell.tsx:4961-4964`); the stream/regen guard keeps its own
   streaming alert inside the same callback. Both locales pinned as literals (disclosure test) and
   the branch text is pinned scoped to the rebuild `if` (sabotages **C6** key-usage, **C7** copy).
6. **Boundary pass-through — FIXED (tightened).** `RemoteEngine.ts:490-498`: an error crosses
   verbatim only if its message starts with `remote_brain_`, OR it carries the `interrupted` code
   marker, OR the own `superseded` flag; everything else — including any foreign snake_case token a
   dependency might throw (deepseek R2-1's `not_found`) — becomes `remote_brain_internal`. The
   `isInternalErrorCode` import is gone (it accepted non-prefixed tokens the AppShell gate would
   have shown raw). Behaviour test asserts both halves: `not_found` → `remote_brain_internal`,
   and an interrupted-coded error crosses with `message` and `code` unchanged (sabotage **C8**).

### Sabotages (8 cycles: mutate → run → the named test red → restore; `cmp` verified)

| # | Mutation | Red test |
|---|---|---|
| C1 | shrink the boot guard back to the switch-only check | “boot does not overwrite a switch or a rebuild in flight (N1 + R2 boot)” |
| C2 | selector guard reads the render-lagged state instead of the ref | “selectRemoteComputer refuses while a rebuild is in flight” |
| C3 | URL hook moved back after `await commit(...)` | “config setters invalidate readiness before the write's first await” |
| C4 | remove `initGeneration += 1` from the hook | “a config edit during a probe supersedes it…” |
| C5 | request reads `getRemoteServerModelId()` late again | “a mid-turn config edit cannot mix URL and model in the request” |
| C6 | rebuild branch borrows the streaming alert | “selectRemoteComputer refuses while a rebuild is in flight” |
| C7 | EN rebuild body wording drift | “the rebuild refusal has its own copy in both locales” |
| C8 | boundary back to `isInternalErrorCode` | “the boundary passes only its own codes and the control markers” |

Every fix has its own red run; all restores byte-verified (`cmp`).

### Untested after fix round 3 (honest list)

- **Boot guard behaviour at runtime** (a rebuild actually running during hydration) — source-pinned;
  the scenario needs a render plus a timed rebuild.
- **The refusal Alert itself** (tap → dialog text shown) — source-pinned on the branch text +
  literal-pinned keys; rendering is an AppShell concern.
- **Hook-before-commit's failure path** (write rejects → readiness stays dropped, cache rolls back,
  next ensure re-probes) — reasoned from `commit`'s code, not exercised.
- **The synchronous-stretch property itself** (no ensure interleaving between hook and assign) —
  the order is pinned; actual interleaving would need a scheduler-level test.
- Behaviour-tested this round: probe supersession, mid-turn identity capture, boundary
  pass-through/markers, both locales' rebuild copy; **23 suites / 247 tests green.**

### Open follow-ups (explicitly NOT in this round)

- **(a) A picker or import started locally that finishes after a switch to remote**
  (luna re-audit 2, attachment section): the async `ImagePicker`/`DocumentPicker` awaits and the
  PDF-conversion completion re-enter with no backend recheck. Nothing undisclosed goes on the wire —
  library docs travel as disclosed names, and images are dropped silently by `toOpenAiMessages`,
  which is exactly the accepted pre-armed policy. **Follow-up: tell the user when remote drops an
  image** (a note at completion), rather than gating mid-flight pickers.
- **(b) ID-only legacy installs boot local — ACCEPTED.** With `wantsRemote` keyed on the backend
  key alone, a store holding only a remote model id (no `ENGINE_BACKEND_KEY`) hydrates as
  `backend: "local"` and `decideRemoteBoot` returns `saved-local` → default, with no migration
  notice (luna regression check). Accepted because **that format only ever existed in unshipped
  `remote-brain` dev builds, and main never wrote it** — no supported install can hold it, so no
  real user-facing break exists; requiring re-selection for a dev-build leftover is correct.
- **(c) The operative digest in the remote system prompt** — already recorded in fix round 1
  (luna P3): digest refreshes per turn and sits at system position 0 remotely, a structural
  prefix-cache cost; decision deferred.
- **(d) The config hook never unregisters** — luna re-audit 2, confirmed benign: it is a module
  singleton registered once at RemoteEngine load, captures no component state, and there is no
  component it could outlive; Jest's per-file module registry keeps tests isolated. No cleanup
  needed unless a future test loads the real RemoteEngine under a partial `remoteSettings` mock
  (deepseek R2-3, noted).

### Proofs (real exit codes, `tail -5`; never the full suite)

| # | Command | Exit | Result (tail) |
|---|---|---|---|
| 1 | `npx tsc --noEmit > /tmp/fix3-tsc.log 2>&1` | **0** | empty log |
| 2 | `npx jest src/app src/engine/remote src/engine/engineBackend src/screens/RemoteBrainSettings --runInBand > /tmp/fix3-jest.log 2>&1` | **0** | `Test Suites: 23 passed, 23 total` / `Tests: 247 passed, 247 total` |
| 3 | 8 sabotage cycles (C1–C8) | each nonzero (expected) | exactly the named test red; `cmp` verified restores |
| 4 | `git commit -m "remote : close boot/rebuild and config-write races, own copy for the rebuild refusal"` | **0** | sha `d7d33e90f`, one commit on top of `0fa9bde99`, no amend |
| 5 | `git status --porcelain \| wc -l` post-commit | **0** | clean |

Full suite: never run. No push. No sub-agents.

## Fix round 4

Luna `## Re-audit 3 (d7d33e90f)` **BLOCKER** (deepseek R3-2 same): the round-3 compound boot
guard returned before BOTH branches whenever a rebuild/delete was busy, so `pickStartModel` never
ran and a saved non-default LOCAL model was silently replaced by the default for the whole launch —
a regression of main's "restore the last model used" and "no silent flip" contracts
(`AppShell.tsx:3013-3017,3094-3104` at `d7d33e90f`). The coordinator's wording clarified: "stays
local for this launch" meant *do not flip to REMOTE*, never *skip the local restore*.

ONE new commit on top of `d7d33e90f` (no amend): **sha `a8e5f5d77`**, message
`remote : a busy rebuild only blocks the remote boot flip, never the local restore` →
**2 files changed, 60 insertions(+), 38 deletions(-)**; `git status --porcelain | wc -l` → **0**.
Line refs below are at `a8e5f5d77`.

### The split guard (minimal hunk, boot block only)

- **`modelSwitchInFlightRef.current` keeps the early return** (`AppShell.tsx:3045`) — the user's
  live switch wins outright; N1 unchanged, before both branches.
- **Rebuild/delete busy moved INSIDE the remote decision** (`:3049-3067`): the remote branch now
  evaluates `const rebuildBusy = semanticRebuildBusyRef.current || isDeleteActive()` (`:3052-3053`)
  and applies the remote flip only when NOT busy. Busy → it falls through; nothing is written (no
  `setEngineBackendMode("remote")`, no `recoverLocalBackend`, no persist — the live cache is the
  fresh-process `"local"` and hydrate never writes it), so the stored remote choice survives
  untouched for the next launch.
- **A LOCAL decision never consults rebuild state**: the `else` branch (`:3060-3069`) runs
  `recoverLocalBackend` + the orphan persist rule exactly as before, unconditionally.
- **The restore is now shared and covers BOTH outcomes** (`:3080-3088`):
  `restoreId = decision.kind === "local" ? decision.persistModelId : (saved ?? getDefaultModel().id)`,
  fed to `pickStartModel({ savedId: restoreId, ... })`. A local decision restores its persisted id
  (main's behaviour, including the death-marker defence, `loadSetAside` via `startId !== restoreId`
  at `:3108`, and the intent-follows-index write). A deferred remote decision passes the raw saved
  id — exactly what main's boot did — so: stored remote id → unknown to the registry → `startId`
  outside → `startIndex < 0` → default stands silently (no misleading surface, migrated-error
  block gated to `decision.kind === "local"` at `:3094-3099`); stored *local* id (the odd
  backend-remote/id-local shape) → **restored properly**, which is the blocked regression.

### Test + sabotage

The boot glue needs a render to exercise, so per the brief it is **source-pinned** (and listed as
untested behaviour below). New pin `"boot: a live switch skips everything; a busy rebuild only
defers the remote flip"` asserts: (1) the N1 one-liner still present; (2) the blanket compound
guard is GONE (`not.toMatch` on `modelSwitchInFlightRef… || …semanticRebuildBusyRef`); (3)
`rebuildBusy` is evaluated *inside* `decision.kind === "remote"`; (4) `restoreId` has the
local-id → raw-saved-id fallback and feeds `pickStartModel`.

**Sabotage (1 cycle):** reinstated the old blanket guard (return before both branches) → pin red
(`Tests: 1 failed, 16 passed`), `cmp`-verified restore.

### Untested (behaviour needing a render)

- A rebuild actually active during boot with a **local** decision → saved non-default model
  restored (the regression itself) — source-pinned only.
- A rebuild active during boot with a **remote** decision → silent local-default session, stored
  remote choice untouched, next launch remote — source-pinned only.
- The live-switch early return at runtime (N1) — source-pinned, unchanged from round 2.

### Proofs (real exit codes, `tail -5`; never the full suite)

| # | Command | Exit | Result (tail) |
|---|---|---|---|
| 1 | `npx tsc --noEmit > /tmp/fix4-tsc.log 2>&1` | **0** | empty log |
| 2 | `npx jest src/app src/engine/remote src/engine/engineBackend src/screens/RemoteBrainSettings --runInBand > /tmp/fix4-jest.log 2>&1` | **0** | `Test Suites: 23 passed, 23 total` / `Tests: 247 passed, 247 total` |
| 3 | sabotage (blanket guard reinstated) | **1** (expected) | the new boot pin failed; `cmp` verified restore |
| 4 | final re-run of 1–2 after restore | **0, 0** | same counts |
| 5 | `git commit -m "remote : a busy rebuild only blocks the remote boot flip, never the local restore"` | **0** | sha `a8e5f5d77`, one commit on top of `d7d33e90f`, no amend |
| 6 | `git status --porcelain \| wc -l` post-commit | **0** | clean |

Full suite: never run. No push. No sub-agents.
