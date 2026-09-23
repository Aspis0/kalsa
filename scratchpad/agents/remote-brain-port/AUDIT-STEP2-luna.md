# Step 2 audit — `ec6a22592`

Compared `7ed2c0b03..ec6a22592` in `~/Projects/kalsa-wt-bench-apk` (7 files, +725/-79). I treated `STEP2.md` as claims, not proof. The app worktree was not edited; `git status --porcelain` was empty after the targeted checks.

## Findings, severity-ranked

### P1 — CONFIRMED: local notes are sent remotely without being named in the disclosure

The notes chip remains usable in remote mode: `AiChatPage.tsx:4222-4228` has `disabled={sending || voiceBlocksComposer || !!pdfToRender}` and no remote-backend condition. Its send path forwards `notes: armedNotes` (`AiChatPage.tsx:2708-2714`). AppShell then loads every note body, up to 24,000 characters, and appends it to the prompt (`AppShell.tsx:6117-6122`; `AppShell.tsx:451-481`). That content becomes the last user message (`AppShell.tsx:6969-6976`) and RemoteEngine serializes that message content into the remote request (`RemoteEngine.ts:392-402`; `openaiMessages.ts:17-28`).

The visible copy says only: `en.ts:134-135` — “To answer, your computer receives the conversation: messages, memory, summaries and document names.” The Italian copy at `it.ts:133-134` likewise omits notes. These local note bodies are prompt-only reference material, not visible conversation messages. The disclosure therefore does not identify a category of private data the client can transmit. **Fix before shipping:** disable notes context remotely or name it explicitly in the disclosure shown before selection.

### P1 — CONFIRMED: rebuild can delete an index after the remote-mode check has gone stale

`AppShell.tsx:2099-2103` checks remote mode once. The function then awaits `mustSkipEmbedForRam()` and `ensureEmbedderDownloaded()` (`2121-2131`) before `bumpEmbedJobGeneration(); await deleteVectorIndexFile(id);` (`2133-2137`). `selectRemoteComputer` can switch the backend during those awaits; it does not acquire the document delete gate or invalidate a rebuild (`AppShell.tsx:4876-4927`). The rebuild has no second backend check before deletion. It can consequently delete the old index while remote is active; the subsequent scheduler refuses at its entry gate (`AppShell.tsx:1630-1635`), leaving that document without its vectors until rebuilt locally. The source-pin test checks ordering/text only (`AppShell.remoteWiring.test.ts:80-91`) and cannot catch this interleaving.

The other `embedDocumentChunk` call is only the background loop (`AppShell.tsx:1883-1893`); its remote check is immediately before the call with no await between them. A new chunk therefore cannot start after a remote flip in the same JS event loop, though an already-running chunk may finish. The rebuild deletion race remains.

### P2 — CONFIRMED regression: transient preference-read failure overwrites a saved local model

Main previously caught a failed preference read and kept the default only for this launch: `git show e206a945b:src/app/AppShell.tsx:2948-2976` ends with `// Preference read failure → keep the default boot model.` Step 2's catch now calls `AsyncStorage.setItem(MODEL_STORAGE_KEY, getDefaultModel().id)` (`AppShell.tsx:3076-3088`). A temporary `getItem` failure therefore turns a session fallback into a persistent preference change. `decideRemoteBoot` also explicitly chooses the default when hydration fails or is stale (`remoteBoot.ts:33-39`). The coder calls this an accepted trade-off (`STEP2.md:51-56`); that is a product decision made in the port, not preservation of main's behavior. Treat it as a regression unless the user explicitly accepts losing the saved local choice.

The ordinary main safeguards do survive: boot still calls `readLastGoodModelId`, `pickStartModel`, and the death-marker reader (`AppShell.tsx:3041-3048`); `startId === null` still returns and a fallback sets `loadSetAside` (`3061-3069`). The load gate still limits the automatic fallback to one hop (`4403-4407`) and carries the refusal message. The source comment still states “no load, no silent flip” (`3059-3061`). The preference-read catch above is a separate persistent flip.

### P2 — CONFIRMED: persistence failures can leave UI intent and backend cache disagreeing

`remoteSettings.ts:124-135` assigns the new backend mode before writing storage, then restores the previous cached mode and rethrows if storage rejects. But the boot catch swallows a failed `recoverLocalBackend()` and assumes “cache still forced local” (`AppShell.tsx:3077-3083`), then sets `remoteActive` false and local intent. If the previous cached backend was remote and the local-mode write fails, the cache remains remote. The probe then deliberately skips the local probe for `intentRemote=false && backendRemote=true` (`modelIndexProbe.ts:21-25`), leaving a local `currentModel` with a remote backend and no ensure.

The same rollback matters when switching from remote to local: a failed `setEngineBackendMode("local")` follows a successful remote dispose, but the catch sets `remoteActive` false and does not reprobe (`AppShell.tsx:4803-4847`). It can leave local UI intent with the backend cache rolled back to remote and the remote engine already disposed. The happy path is coherent; the failure path is not.

There is also a silent restart mismatch if the local model-id write fails during a remote-to-local switch: the write is fire-and-forget (`AppShell.tsx:4753-4754`), while boot treats a saved remote id as sufficient to request remote even when the backend preference says local (`remoteBoot.ts:41-50`). The previously saved synthetic remote id can therefore win on the next launch after the user selected local.

### P2 — CONFIRMED cleanup gap: a pre-IIFE local-switch throw leaks the backend-switch intent

The local path calls `beginBackendSwitch("local")` before the awaited marker clear (`AppShell.tsx:4721-4743`). Its IIFE `finally` calls `endBackendSwitch()` (`4840-4847`), but the outer catch for throws before the IIFE starts clears the model lock and rethrows without ending the backend switch (`4850-4865`). `setEngineBackendMode` refuses a conflicting mode while that intent remains (`remoteSettings.ts:139-148`). The normal remote selector overwrites this intent with `beginBackendSwitch("remote")`; however, boot's direct remote setter does not begin a new switch (`AppShell.tsx:3026-3033`). If a pre-IIFE throw is followed by an AppShell remount that should boot remote, the stale local intent can make that setter silently no-op. The remote IIFE has a `finally` around its post-dispose work (`AppShell.tsx:4914-4937`); the uncovered exit is the local outer catch.

### P2 — CONFIRMED: stream transport errors still surface raw internal codes in chat

Remote transport failures become error messages such as `remote_brain_timeout` (`RemoteEngine.ts:433-444`; `openaiTransport.ts:155-161`). The AppShell stream callback inserts `error.message` directly into the conversation (`AppShell.tsx:7028-7047`). This differs from the new humanized *init/ensure* failure path and is explicitly acknowledged as unported in `STEP2.md:167-173`. It is a user-facing defect in the shipping commit even if the error-humanization hunk was outside the port plan.

### P2 — CONFIRMED: an initial remote selection can race a send only by ceding; item (b) is otherwise closed

The real Settings route first defers model selection while `sendClaimRef` is held, then waits for both the claim and send to clear (`AppShell.tsx:4943-4978`). A remote selection also refuses an active regen/stream (`4876-4887`). If a send starts after the remote intent is written but before `remoteActive` changes, the local ensure is stale and the send calls `finish(); return` on `"superseded"` before the research/tool branch (`AppShell.tsx:6022-6058`; `ensureIntent.ts:53-75`). Remote turns also clear `tools` and `executeTool` at the facade call (`AppShell.tsx:7051-7058`), and the remote transport request contains messages/model/generation settings but no tool definitions (`RemoteEngine.ts:392-407`). I found no reachable normal UI path that both selects remote and continues a local stream or executes research tools.

This does not cover the notes-context disclosure issue above: notes are ordinary prompt text, not tool calls.

### P3 — CONFIRMED behavior, PLAUSIBLE performance cost: memory facts use the local tail helper on the real path

AppShell passes `memoryFacts: promptFacts` with the stream options (`AppShell.tsx:7051-7059`); the facade forwards those options to `streamRemoteAssistantTurn` (`engineBackend.ts:177-188`). RemoteEngine calls the shared `buildMemoryFactsBlock` and `applyMemoryFactsToLastUser` before constructing the request (`RemoteEngine.ts:373-402`). The helper prefixes a string as `factsBlock + "\n\n" + content` (`memoryFactsTail.ts:331-350`), matching local composition where the current user already has the persona tail (`AppShell.tsx:6965-6976`; local call at `LlamaService.ts:4437-4446`). `MEMORY_FACTS_ON_USER_TAIL` is true in main (`ttftFlags.ts:18-26`), and AppShell passes an empty list when memory is disabled (`AppShell.tsx:6259-6261`).

The lifecycle assertion proves the fact and original text reach the actual transport request and that the system message lacks the fact (`remoteEngine.lifecycle.test.ts:810-843`), but it checks `toContain`, not exact ordering or the `"\n\n"` separator. The implementation helper establishes that shape. Remote does not consult `MEMORY_FACTS_ON_USER_TAIL`; flipping that local escape hatch later would make the paths diverge.

The coder's “owner decision” wording is **REFUTED**: `STEP2.md:94-100,116-121` calls this “Decision” and “this owner decision,” but the code records a coder-selected policy; no owner instruction is cited. Also, remote operative digest/summary remains in the system prompt (`remotePrompt.ts:8-20`; `RemoteEngine.ts:396-402`), while main says the query-time digest refreshes every user turn and belongs on the last-user tail to preserve the stable KV prefix (`LlamaService.ts:3893-3900,4437-4446`). Moving it into the remote system message means a changed digest precedes the whole history, so a prefix-cache server can reuse only the common prefix before that change and must reprocess the later conversation. That is a real structural cache cost; its latency magnitude was not measured here.

### P3 — CONFIRMED: the tests are honest about source pins, but do not prove AppShell runtime behavior

`AppShell.remoteWiring.test.ts:1-9` explicitly says the checks are source pins and “do NOT prove runtime behaviour.” Its embed check asserts source text/order only (`80-91`), not that a rebuild racing a switch preserves the vector file. The facade test uses mocked `LlamaService`, `RemoteEngine`, and settings (`engineBackend.test.ts:1-74`); it proves dispatch and option identity at the facade, not the AppShell call-site wiring. The lifecycle test exercises RemoteEngine with a mocked transport and verifies marker/text presence (`remoteEngine.lifecycle.test.ts:788-843`); it does not assert exact fact-prefix bytes. The three claimed pins turn red for their stated source/dispatch failures, but the embed-pin sabotage is not a behavioral test.

## Requested race and intent checks

- **Index writes:** all semantic `setModelIndex` calls have same-step intent writes: boot `3073-3075`, load fallback `4425-4427`, and local selection `4723-4733` followed by the state flip at `4748`. `modelIndexRef.current = modelIndex` at `2992-2993` is only the render mirror. No semantic index flip is missing its intent write. Remote selection intentionally leaves the local row index intact and changes `remoteActive`/intent instead (`2812`, `4890-4895`).
- **`prefsReady`:** initialized false and released in boot `finally` (`AppShell.tsx:2801-2804,3089-3090`); probe effect returns before hydration is ready (`3975-3980`).
- **In-flight ensures / send cede:** one promise is shared per intent key and bounded (`4652-4682`; `ensureIntent.ts:92-143`). Superseded sends finish without a fake model error or tool invocation (`AppShell.tsx:6022-6058`).
- **Switch pairing:** normal local and remote IIFE exits end the backend switch (`AppShell.tsx:4840-4847,4935-4937`); see the explicit pre-IIFE local catch leak above.
- **Dispose:** normal local→remote disposes local before changing mode (`4899-4927`); remote→local calls `disposeRemoteEngine` before changing to local (`4803-4831`). Remote disposal clears `ready`, `activeId`, and `inFlight` (`RemoteEngine.ts:198-210`). I found no double dispose on the successful switch path; persistence failures can still create the mismatched state described above.

## Verification

- `npx tsc --noEmit > /tmp/s2a-tsc.log 2>&1; echo $?` → **0**; `/tmp/s2a-tsc.log` has 0 lines.
- `npx jest src/app src/engine/remote src/engine/engineBackend --runInBand > /tmp/s2a-jest.log 2>&1; echo $?` → **0**.
- Exact final Jest lines:

  ```text
  Test Suites: 21 passed, 21 total
  Tests:       210 passed, 210 total
  Snapshots:   0 total
  Time:        1.868 s, estimated 2 s
  Ran all test suites matching src/app|src/engine/remote|src/engine/engineBackend.
  ```

## Verdict

**FIX-FIRST** — disclose or suppress remote note injection; recheck backend state before deleting vectors; repair boot/switch persistence rollback handling; close the pre-IIFE backend-switch cleanup gap; and humanize remote stream errors before merge.

## Re-audit (77f487a65)

Scope: `ec6a22592..77f487a65`, 14 files, +188/−65.

### Earlier FIX-FIRST findings

- **Notes disclosure — CLOSED.** English says “messages, notes you attach, memory, summaries and document names” (`src/i18n/en.ts:134-135`); Italian names “note che alleghi” (`src/i18n/it.ts:133-134`). The real settings component renders the disclosure at `RemoteBrainSettings.tsx:271-276`, before the select button at `:295-329`; the render test asserts `disclosureIndex < buttonIndex` (`RemoteBrainSettings.disclosure.test.ts:184-190`).
- **Rebuild race — PARTIAL.** The new check is immediately before `bumpEmbedJobGeneration(); await deleteVectorIndexFile(id)` (`AppShell.tsx:2133-2140`), closing the preflight-await race. A switch can still start during the awaited delete: the selector checks download/model-switch/loading and stream/regen (`:4920-4931`), not rebuild/delete; after delete, rebuild schedules embedding (`:2148-2151`), while the scheduler returns in remote mode (`:1630-1636`). That interleaving can destroy the old index and skip its rebuild.
- **Boot catch overwriting saved local model — CLOSED for the model ID.** Main’s catch only says “Preference read failure → keep the default boot model” (`git show e206a945b:src/app/AppShell.tsx:2974-2976`). The new catch says “this launch only” and does not write `MODEL_STORAGE_KEY` (`AppShell.tsx:3088-3095`).
- **Persistence rollback (a), boot cache alignment — CLOSED.** On failed local recovery the catch reads `isRemoteEngineBackend()` and aligns intent/`remoteActive` to that cache (`AppShell.tsx:3096-3106`), then releases `prefsReady` (`:3111-3112`).
- **Persistence rollback (b), failed remote→local flip — CLOSED for cache/UI re-arm; no retry loop found.** The catch restores remote intent and bumps the presence epoch once (`AppShell.tsx:4866-4879`); `finally` clears the switch lock and ends the backend switch (`:4880-4886`). The probe is gated by `prefsReady` and skips while a switch is in flight (`:4000-4012`); failed ensure does not bump the epoch again (`:4233-4244`).
- **Persistence rollback (c), failed model-ID write — PARTIAL.** The rejected write now shows a notice (`AppShell.tsx:4783-4787`), but does not roll back the in-memory selection. Boot still sets `wantsRemote = input.backend === "remote" || savedWantsRemote` (`remoteBoot.ts:41-43`), so a saved remote ID can still win next launch after the user selected local.
- **Pre-IIFE `endBackendSwitch` — CLOSED.** The outer catch now calls `endBackendSwitch()` (`AppShell.tsx:4890-4901`); the launched IIFE has its own `finally` (`:4880-4887`).
- **Raw stream codes — CLOSED for internal `remote_brain_*` codes.** The callback humanizes that prefix and otherwise returns `error.message` unchanged (`AppShell.tsx:7088-7093`); `remote_brain_sse_error` now maps to network copy (`remoteBrainErrors.ts:17-18`). A separate remote native-exception leak is below.

### New checks

- **Boot read-only contract — CONFIRMED deviation.** The narrowed write protects saved local IDs, but is not strictly read-only: “`if (decision.reason === "orphan" && saved === REMOTE_COMPUTER_MODEL_ID)`” then `AsyncStorage.setItem(MODEL_STORAGE_KEY, decision.persistModelId)` (`AppShell.tsx:3046-3048`). Main’s fallback only did “`modelIndexRef.current = startIndex; setModelIndex(startIndex);`” (`e206a945b:src/app/AppShell.tsx:2971-2973`) and did not persist the selected fallback. This is a deliberate orphan migration, but it changes main’s boot persistence policy. Also, the catch comment says “`this launch only, nothing persisted`” (`AppShell.tsx:3089-3091`), yet the catch calls `recoverLocalBackend()` (`:3092-3094`), which calls “`await setEngineBackendMode("local")`” (`remoteSettings.ts:57-59`); that setter writes `ENGINE_BACKEND_KEY` (`:146-148`). The model ID remains untouched on this catch, but the broader “nothing persisted” statement is false.
- **Flip-never-landed re-arm loop — REFUTED.** The failure catch increments `presenceProbeEpoch` once (`AppShell.tsx:4873-4879`); the `finally` only adds another epoch when `shouldReprobeAfterSwitch(disposeOk)` is true (`:4880-4886`), and that helper is exactly `return disposeOk === true` (`modelIndexProbe.ts:45-47`). Failed ensure does not schedule another epoch (`AppShell.tsx:4233-4244`).
- **Remote ready after dispose/config change — disposed: REFUTED; changed config: CONFIRMED stale-ready state.** Dispose clears `ready` and `activeId` (`RemoteEngine.ts:198-209`), so the short-circuit cannot accept a disposed engine. But it tests only `isEngineReady()` plus the synthetic remote ID (`AppShell.tsx:4211-4213`). URL/model setters only update their caches (`remoteSettings.ts:151-162`) and do not invalidate remote readiness; a fresh ensure for edited settings can therefore return ready without probing that server. The subsequent stream does read the current URL/model (`RemoteEngine.ts:353-360,392-405`).
- **Prefix humanization — local errors: CONFIRMED byte-identical; remote native exception: CONFIRMED leak.** The non-prefix branch is exactly `: error.message` (`AppShell.tsx:7090-7093`), and `rg` found no `remote_brain_` literal in `LlamaService.ts` or `engineBackend.ts`. However, `getRemoteBrainToken()` rethrows non-not-found SecureStore errors (`remoteSecret.ts:15-23`); RemoteEngine forwards caught exceptions through `finishOnce`/`onError` (`RemoteEngine.ts:338-342,359-360,464-467`), while AppShell humanizes only the prefix (`AppShell.tsx:7090-7093`). Such a native remote error can still reach the chat verbatim despite `humanRemoteBrainError` specifying unknown native exceptions should become generic copy (`remoteBrainErrors.ts:54-56`).
- **Attachment gate — CONFIRMED incomplete.** The new gate begins “`if (isRemoteEngineBackend())`” inside `onComposerAttach` (`AiChatPage.tsx:3631-3642`). The separate library chip still has “`onPress={onComposerDocument}`” and “`disabled={sending || voiceBlocksComposer || !!pdfToRender}`” (`:4219-4227`), then the row calls “`addLibraryDocumentAttachment(doc)`” (`:4665-4672`). The external share path passes “`attachLibraryDoc={shareAttachDoc}`” (`AppShell.tsx:7445-7451`) and its effect calls “`addLibraryDocumentAttachment({ id: doc.id, name: doc.name })`” (`AiChatPage.tsx:3733-3737`). These paths bypass the gate. Send assembly creates only “`[document:${a.libraryDocId} name="${a.name}"]`” (`AiChatPage.tsx:2450-2453`); remote mode disables research (`:2457-2458`), so those paths pass document hints, not retrieved passages. The remote serializer also says “`Images are dropped (text-only).`” (`openaiMessages.ts:8-15`).
- **Embedding starts in remote mode — no other start path found; rebuild race remains above.** The sole AppShell call is “`const vec = await embedDocumentChunk(chunk.text, { signal });`” after “`if (isRemoteEngineBackend())`” returns (`AppShell.tsx:1888-1893`); the job entry likewise says “`if (isRemoteEngineBackend()) return;`” (`:1630-1636`). A call already awaiting native embedding may overlap a later switch: the selector checks “`regenInFlightRef.current || streamInFlightRef.current`” (`:4929-4931`), not embed-job state. The mid-job check stops subsequent chunks (`:1888-1893`).
- **Dead-code removals — CONFIRMED.** `rg -n 'isOrphanRemoteWithoutUrl|\\.reprobe\\b|inFlightReleased' src` returned no hits. The remaining `shouldReprobeAfterSwitch` helper is used by the switch `finally` (`modelIndexProbe.ts:45-47`; `AppShell.tsx:4885-4886`).
- **Test limits.** The disclosure test renders the component and checks “`expect(disclosureIndex).toBeLessThan(buttonIndex)`” (`RemoteBrainSettings.disclosure.test.ts:166-190`). The rebuild/attach tests assert regex/source text (`AppShell.remoteWiring.test.ts:95-110`), so they do not exercise the asynchronous delete/switch interleaving or the library-chip/share attach paths.

### Verification

- `npx tsc --noEmit > /tmp/s2a2-tsc.log 2>&1; echo $?` → **0**.
- `npx jest src/app src/engine/remote src/engine/engineBackend src/screens/RemoteBrainSettings --runInBand > /tmp/s2a2-jest.log 2>&1; echo $?` → **0**.
- `tail -5 /tmp/s2a2-jest.log`: **23 passed suites; 236 passed tests**; targeted filter only.

## Verdict

**FIX-FIRST** — the rebuild can still delete an index across a backend switch; a changed remote config can inherit stale ready state; attachment entry points bypass the gate; and native remote exceptions can still be shown raw. Also decide whether the orphan boot write is an accepted exception to main’s read-only model-choice contract.

## Re-audit 2 (0fa9bde99)

Scope: `77f487a65..0fa9bde99`, 10 files, +204/−24.

### Prior open items

- **Rebuild race — PARTIAL.** The manual selector now refuses on “`semanticRebuildInFlight || isDeleteActive()`” (`AppShell.tsx:4938-4943`), and `semanticRebuildInFlight` is React state (`:1192-1193`) included in the callback deps (`:4998`); `isDeleteActive()` is a synchronous module gate (`docOpGate.ts:37-45,51-53`). No stale closure on the rendered selector path. But boot can still flip remote during a delete: boot checks “`if (modelSwitchInFlightRef.current) return;`” then runs “`await setEngineBackendMode("remote")`” (`AppShell.tsx:3032-3043`), while rebuild holds the delete gate across “`await deleteVectorIndexFile(id)`” (`:2139-2145`). The documents overlay is rendered independently (`:7615-7627`); `prefsReady` only gates the probe effect (`:4005-4007`). A rebuild started during slow boot hydration can therefore pass the local recheck and lose its rebuild when boot changes the backend.
- **Persistence (c), stale remote model ID after a local choice — CLOSED for the original case.** Boot now says “`const wantsRemote = input.backend === "remote";`” (`remoteBoot.ts:47`), so a stale saved remote ID cannot override a successfully persisted local backend key. The suggested path “remote model ID write succeeds but remote backend write fails” is REFUTED for this selector: it first awaits “`setEngineBackendMode("remote")`” and only then starts the model-ID write (`AppShell.tsx:4979-4982`); a throw skips that write. A separate boot/hydration regression is below.
- **Stale ready after config change — PARTIAL.** A successful URL/model write now invokes the hook (`remoteSettings.ts:163-181`), whose module-scope callback is “`setRemoteConfigChangedHook(() => { ready = false; })`” (`RemoteEngine.ts:50-52`), so readiness is invalidated after commit. But `commit` first does “`assign(next);`” and then “`await write(next);`” (`remoteSettings.ts:142-144`); invalidation runs only after `await commit(...)` (`:166-172`, `:177-181`). A concurrent ensure can plausibly see the new config with old `ready=true` during that window. Settings fields are “`editable={!fieldsLocked}`” (`RemoteBrainSettings.tsx:335-342,363-370`); `fieldsLocked` is only “`!hydratedReady`” (`:61-62`), not `busy`, so the hook can fire during a live stream. It only clears `ready`; it does not abort `activeStream` or bump `streamGeneration` (`RemoteEngine.ts:47-52`). The current turn continues: “`const base = getRemoteBrainUrl();`” precedes “`await getRemoteBrainToken()`” (`:248`, `:371`), while “`model: getRemoteServerModelId()`” is read later (`:404-408`); a mid-await edit can therefore mix the captured URL and current model.
- **Native remote exception leak — CLOSED for the SecureStore/ordinary thrown-exception path.** The boundary maps non-code exceptions to “`remote_brain_internal`” (`RemoteEngine.ts:476-487`); AppShell humanizes the prefix (`AppShell.tsx:7099-7104`). The lifecycle test rejects SecureStore with “`keystore exploded`” and asserts it is absent from the reported error (`remoteEngine.lifecycle.test.ts:862-886`).
- **Attachment gate — PARTIAL.** Direct entry points now check “`if (isRemoteEngineBackend())`” in `onComposerAttach` (`AiChatPage.tsx:3635-3645`), `onComposerDocument` (`:3675-3685`), the share effect (`:3741-3750`), and `addPdfAttachment` (`:1713-1717`). But a picker/import started locally can finish after switching remote. `addImageAttachment` does “`await ImagePicker.launchCameraAsync(...)`” / “`await ImagePicker.launchImageLibraryAsync(...)`” and later “`setAttachedItems((prev) =>`” (`AiChatPage.tsx:1664-1701`) without a backend recheck. `addPdfAttachment` checks only before “`await DocumentPicker.getDocumentAsync(...)`” (`:1713-1729`), then may call “`importAndAttachDocxRef.current(asset.uri, name || "document.docx")`” or arm `pdfToRender` (`:1747-1769`); `importAndAttachDocx` later calls “`addLibraryDocumentAttachment({ id, name })`” (`:3849-3854`) without rechecking. PDF conversion completion likewise adds pages (`:1781-1816`). The selector’s guards do not include picker/import state (`AppShell.tsx:4926-4944`). Pre-armed items also remain by the coder’s stated policy; remote serialization says “`Images are dropped (text-only).`” (`openaiMessages.ts:8-15`).
- **False boot-catch comment — CLOSED.** It now says “`the model choice is read-only this launch — no MODEL_STORAGE_KEY write`” and “`Only recoverLocalBackend may write, and only the backend key, as "local"`” (`AppShell.tsx:3093-3096`); `recoverLocalBackend` does set only the backend key (`remoteSettings.ts:57-59,158-160`).

### Regression checks

- **Backend local while last explicit choice was remote — CONFIRMED state; candidate write-failure sequence REFUTED.** The proposed selector sequence cannot persist the remote model ID if its awaited backend write rejects: “`await setEngineBackendMode("remote")`” precedes “`AsyncStorage.setItem(MODEL_STORAGE_KEY, REMOTE_COMPUTER_MODEL_ID)`” (`AppShell.tsx:4979-4982`). Another path does create the state: failed hydration returns “`backend: "local"`” and “`hydrationOk: false`” (`remoteSettings.ts:293-299`); AppShell reads the model ID only under “`hydrated.hydrationOk ? await AsyncStorage.getItem(...) : null`” (`:3017-3019`) and then calls “`await recoverLocalBackend()`” (`:3045`). That writes local backend while leaving a prior remote model ID untouched. On the next successful boot, the backend-only rule ignores that ID.
- **ID-only legacy migration — REFUTED (it does not migrate).** Missing/non-remote `ENGINE_BACKEND_KEY` hydrates as “`backend: backendRaw === "remote" ? "remote" : "local"`” (`remoteSettings.ts:273-275`). With only a saved remote model ID, `wantsRemote` is false (`remoteBoot.ts:47`) and the local decision’s `persistModelId` falls back to the default (`:56-63`). That reason is `saved-local`, outside AppShell’s migration-error reasons (`AppShell.tsx:3066-3073`), so an old ID-only install silently boots local. This only avoids a real user-facing break if no supported install ever stored that format or requiring re-selection is intentional.
- **Rebuild refusal message — CONFIRMED misleading.** The rebuild branch displays the stream alert (`AppShell.tsx:4938-4942`); English says “`Response in progress`” and “`Changing model will stop generation. Continue?`” (`i18n/en.ts:196-198`). The branch immediately returns and offers no continue action; a rebuild is not a response.
- **Config hook registration/lifetime — CONFIRMED.** It is installed at module scope with “`setRemoteConfigChangedHook(() => { ready = false; })`” (`RemoteEngine.ts:50-52`) and is not unregistered. This process-wide singleton captures no screen/component state; there is no component cleanup leak. It does not cancel an already-running stream, as noted above.
- **Boundary normalization and control signals — REFUTED for normal supersede/abort flow.** `finishOnce` adds the own `superseded` marker when the generation is stale (`RemoteEngine.ts:319-326`), after the boundary conversion calls it (`:482-487`), so AppShell can still recognize it. Normal pre-send abort carries “`code = "interrupted"`” and “`preservePartial = true`” through direct `finishOnce` (`:377-382`); transport aborts likewise reach `settle(err)`/`finishOnce` directly (`:344-356,445-456`), not the outer normalizer. An unusual thrown abort-shaped exception through the outer catch would lose custom fields, but the transport’s `xhr.send` throw is converted to an `onFinish` error (`openaiTransport.ts:358-370`), not that path.

### Verification

- `npx tsc --noEmit > /tmp/s2a3-tsc.log 2>&1; echo $?` → **0**.
- `npx jest src/app src/engine/remote src/engine/engineBackend src/screens/RemoteBrainSettings --runInBand > /tmp/s2a3-jest.log 2>&1; echo $?` → **0**.
- `tail -5 /tmp/s2a3-jest.log`: **23 passed suites; 242 passed tests**; targeted filter only.

## Verdict

**FIX-FIRST** — boot-only remote switching still bypasses the rebuild lock; config invalidation races its cache write and leaves active streams running; async attachment work can complete after a remote switch; and ID-only legacy remote selections silently become local. The settings alert also gives the wrong reason and promises a Continue action that is not offered.

## Re-audit 3 (d7d33e90f)

Scope: `0fa9bde99..d7d33e90f`, 8 files, +245/−26.

### Prior open items

- **Boot flip during delete — CLOSED / CONFIRMED.** Boot returns before either backend branch when `modelSwitchInFlightRef.current || semanticRebuildBusyRef.current || isDeleteActive()` (`AppShell.tsx:3048-3053`). The selector also checks the synchronous ref and delete gate before starting the remote switch (`:4957-4964`).
- **Config invalidation vs cache write — CLOSED / CONFIRMED.** URL and model setters call the hook before `await commit(...)` (`remoteSettings.ts:163-184`); the hook clears ready and increments the init generation (`RemoteEngine.ts:49-55`). A failed write restores the old cache (`remoteSettings.ts:142-147`), while readiness stays dropped, so the next ensure must re-probe.
- **Mixed URL/model in one turn — CLOSED / CONFIRMED.** The stream captures `base` and `serverModel` together before the token await (`RemoteEngine.ts:251-256`) and sends the captured values (`:412-416`).
- **Misleading rebuild alert — CLOSED / CONFIRMED.** The rebuild guard now uses its own keys (`AppShell.tsx:4957-4964`): English says “Index rebuild in progress” / “Switch to your computer after the document index finishes rebuilding.” (`i18n/en.ts:199-201`); Italian has matching rebuild wording (`i18n/it.ts:198-200`).

### New-code checks

- **`semanticRebuildBusyRef` lifecycle — CONFIRMED, no latch regression.** Early `unavailable` returns occur before setting the ref (`AppShell.tsx:2102-2146,2154`). After it is set, the scheduled function is async (`:1636`) and the attached `.finally` clears both ref and state (`:2157-2162`), including rejection.
- **Hook before commit on write failure — CONFIRMED, safe invalidation.** `commit` assigns the new cache then rolls back to `previous` on write failure (`remoteSettings.ts:142-147`). The hook has already cleared ready and bumped the generation (`RemoteEngine.ts:49-55`); that forces a probe of the restored settings on the next ensure. The active stream uses its captured URL/model (`RemoteEngine.ts:251-256,412-416`).
- **Boundary control signals — REFUTED (it does not swallow the checked controls).** The catch passes `code === "interrupted"` and `superseded === true` unchanged (`RemoteEngine.ts:491-497`). The lifecycle test asserts `interrupted.message` is “Generation was interrupted.” and `interrupted.code` is “interrupted” (`remoteEngine.lifecycle.test.ts:1010-1012`).
- **Boot guard persistence — CONFIRMED: no write occurs on the guarded return.** The return is before the remote backend setter and the orphan model-key write (`AppShell.tsx:3048-3071`); `hydrateRemoteBrainSettings` reads settings and explicitly “Does not write backendCache” (`remoteSettings.ts:234-251`).
- **BLOCKER — CONFIRMED consequence, PLAUSIBLE startup interleaving: guarded boot silently skips restoring a saved local model for this launch.** `modelIndex` starts at the registry default (`AppShell.tsx:2814-2816`); the rebuild/delete guard returns before `pickStartModel` and the later index/intent updates (`:3048-3053,3078-3110`). The documents overlay receives the rebuild callback (`:7637-7644`), while `prefsReady` gates only the later probe (`:4024-4027`). If a delete or rebuild is active when the boot effect reaches this guard, the `prefsReady` probe checks the still-current default (`:4024-4044`); clearing the busy flag only clears ref/state and does not rerun boot (`:2159-2162`). This violates the startup contract to “restore the last model used” (`:3013-3017`) and the explicit “no silent flip” rule (`:3094-3104`) when a non-default local model was saved. Storage is not overwritten, but the saved choice is ignored for the whole session.

### Verification

- `npx tsc --noEmit > /tmp/s2a4-tsc.log 2>&1; echo $?` → **0**.
- `npx jest src/app src/engine/remote src/engine/engineBackend src/screens/RemoteBrainSettings --runInBand > /tmp/s2a4-jest.log 2>&1; echo $?` → **0**.
- `tail -5 /tmp/s2a4-jest.log`: **23 passed suites; 247 passed tests**; targeted filter only.

## Verdict

**FIX-FIRST** — the new rebuild boot guard can skip restoration of a saved non-default local model and silently run the default for the rest of that launch. The four previously open races/copy items are closed.

## Re-audit 4 (a8e5f5d77)

Scope: `d7d33e90f..a8e5f5d77`, 2 files, +60/−38.

### Findings

- **Previous blocker — CLOSED / CONFIRMED.** The separate N1 switch guard remains (`AppShell.tsx:3045`). Rebuild/delete state is read only inside `decision.kind === "remote"` (`:3046-3063`). A local decision takes the `else` path and reaches shared restore with `decision.persistModelId` as `restoreId`, then `pickStartModel({ savedId: restoreId, ... })` (`:3063-3091`). The independent in-flight user-switch return remains the intentional N1 exception.
- **Deferred remote ID — CONFIRMED safe in a fresh process.** `pickStartModel` returns `savedId` unchanged when it is not marked (`loadMarker.ts:85-96`). `isMarked` here calls `readLoadMarker`, which reads `kalsa.load.dead.${modelId}` with `getItem` (`loadMarker.ts:23,40-45`); it does not write. `getModelById("kalsa-remote-mac")` would return `REMOTE_COMPUTER_MODEL` (`ModelRegistry.ts:394-397`), but that helper is not called in this boot path: the code uses `MODEL_REGISTRY.findIndex(...)` (`AppShell.tsx:3105-3107`), and the remote row is explicitly “Not in MODEL_REGISTRY” (`remoteComputerModel.ts:14-16`). An unmarked remote id therefore produces index `-1`; the guard returns before indexing/updating/loading (`AppShell.tsx:3105-3107`). No remote load marker is written: this path only reads markers, and returns before the local `guardedLoad` call (`:3105-3107,4623-4626`).
- **Fresh-process backend / stream — CONFIRMED local.** The backend cache initializes as `"local"` (`remoteSettings.ts:32`); hydration says it “Does not write backendCache” and reads persisted keys (`:234-251`). On the busy remote path, the `setEngineBackendMode("remote")` call is skipped (`AppShell.tsx:3052-3061`), then `remoteActive` is set false (`:3073-3083`); the initial engine intent is also `remote: false` (`:3167-3171`). AppShell passes no backend override in its stream options (`:7145-7163`); `EngineTurnOptions` only defines tools and executeTool (`LlamaService.ts:740-749`), and the facade defaults to `getEngineBackendMode()` (`engineBackend.ts:181-187`). Thus this fresh-process branch streams locally; the stored remote setting remains for the next launch.
- **FOLLOW-UP — no behavioral pin for deferred-remote boot.** The test describes itself as “LINE-LEVEL pins, not behaviour tests” (`AppShell.remoteWiring.test.ts:4-8`); its new case asserts source regexes for the split guard and `restoreId` (`:150-167`). A render-level test could verify the default-local/no-remote-stream outcome. This is a coverage gap, not a blocker.

### Verification

- `npx tsc --noEmit > /tmp/s2a5-tsc.log 2>&1; echo $?` → **0**.
- `npx jest src/app src/engine/remote src/engine/engineBackend src/screens/RemoteBrainSettings --runInBand > /tmp/s2a5-jest.log 2>&1; echo $?` → **0**.
- Jest tail: **23 passed suites; 247 passed tests**; targeted filter only.

## Verdict

**SHIP-WITH-FOLLOW-UPS** — the blocker is closed; the deferred remote id cannot crash or route a fresh-process turn remotely. Follow-up is runtime coverage for that boot branch.
