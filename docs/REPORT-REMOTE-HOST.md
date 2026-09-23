# Remote mode in the host shell

Branch `ux-2026-09-21`; port base `3597425`; reviewer-fix base `ccaaf06`. No commit or deletions. Reference: `ca2dcc0:src/app/AppShell.tsx` and lab `STEP2.md` (hunks 1–7, fix rounds 1–4).

## Ported gates

| Main reference | Host implementation and coverage |
|---|---|
| Stream facade / tools off — `AppShell.tsx:7087,7148` | `engineBackendStream.ts:8-14` routes through `engineBackend`; remote stream options clear `tools` and `executeTool`. The stream call is in `engineTurnStream.ts:224`. Facade dispatch also covers session, translation, memory, completion, and switch operations. |
| Boot decision — `AppShell.tsx:3031-3090` | `remoteHostBoot.ts:22-68` preserves `decideRemoteBoot`, local `pickStartModel`, and defers only a remote flip while document deletion is active. `usePipelineScans.ts:109-185,274-317` hydrates, probes, and resumes after a switch. Boot/probe tests cover these paths. |
| Remote selection/refusals — `AppShell.tsx:4953-5029` | `HostOverlays.tsx:180-197` routes the Advanced Settings model row to `selectModelById`; `remoteModelHostActions.ts:47-69` guards download/switch/loading, stream, regeneration, and delete; `remoteModelTransition.ts:31-71` disposes, flips, persists, and ensures. Refusal and transition tests assert no dispatch or the accepted order. |
| Three embedding gates — `AppShell.tsx:1636,1894,2100` | No host background embed or semantic rebuild job exists. `HostOverlays.tsx:244-248` reports rebuild unavailable and `usePipelineScans.ts:129-131` supplies `semanticRebuildBusy: false`; there is no production rebuild target to gate. Delete remains the live document lock. |
| Remote errors — `AppShell.tsx:7133` and selection catch | Setup errors still use `hostEngineErrorText` (`remoteHostEnsure.ts:48-58`). Stream errors now use `hostStreamErrorText` (`engineTurnStream.ts:266`): only `remote_brain_` codes are mapped; other engine detail passes through, matching main. `remoteEngineError.test.ts:21-34` exercises both results and pins the stream callback. |
| Attachment gates — main `AiChatPage` composer, picker, share, and import paths | `remoteAttachmentGate.ts:1-12` guards the attach sheet, camera/library picker, document picker, and library row (`HostChatSurface.tsx:193,201,241,306`). Shared files are refused by `useShareIn.ts:72-87`; text shares remain allowed. Tests exercise both backend modes. |
| Remote ready/location — `AppShell.tsx:7253` | `modelBar.ts:84-120` returns `download.readyRemote`; `useModelBar.ts:61` supplies remote state. `hostModelLocation.ts:5-18` and `HostChatSurface.tsx:112-117,224-225` show remote server/location and refusal-aware local copy. Tests pin both modes. |

## Reviewer fixes at `ccaaf06`

1. **Send ensure dispatch:** `useHostEngine.ts:159` passes `modelHost.scanRefs.ensureEngineForModelRef`; `hostDeps.ts:140` binds the turn through `createTurnEnsure` (`turnEnsureDispatch.ts:4-7`). `useModelHost.ts:218-237` builds the ref with `createModelEnsureDispatch`, routing the remote ID to `ensureRemoteHostModel` and local IDs to the local loader. The strengthened `turnEnsureDispatch.test.ts:30-89` builds real turn deps and drives `handleSendStream` with the remote model; remote ensure is called and the local loader is not.
2. **Research/tools gate:** `sendHost.ts:199-212` gates keyword and armed research, reports `settings.remoteGated`, and clears the one-shot arm. `HostChatSurface.tsx:181-192,308` refuses remote research taps, clears stale research when remote mode activates, and hides the active state. `engineTurn.ts:185-205` delegates to `engineTurnResearch.ts:26-75`, which refuses remote requests before `runDeepResearch` and preserves local execution. `composerArms.test.ts:93-110` and `engineTurnResearch.test.ts:34-66` cover both sides.
3. **Stream error boundary:** `remoteEngineError.ts:14-18` maps only `remote_brain_` codes and preserves other messages. The stream callback uses it at `engineTurnStream.ts:266`; `remoteEngineError.test.ts:21-34` verifies remote code, unknown remote code, and native detail behavior.
4. **Remote-to-local switch window:** `engineEnsure.ts:38-43` checks the facade backend through `runLocalEnsureGate` (`localEnsureGate.ts:2-7`) before entering the local loader. `localEnsureGate.test.ts:7-18` verifies a remote backend refuses without invoking local load and the local backend still loads.

## Remaining limits

- The three embedding gates still have no host job to protect: rebuild is explicitly unavailable at `HostOverlays.tsx:244-248`, and boot passes `semanticRebuildBusy: false` at `usePipelineScans.ts:129-131`.
- A picker started locally may finish after switching to remote. The staged image/PDF chip now says that its image is not sent (`remoteAttachmentChips.ts:5-18`); document-name hints remain eligible for the remote text request as disclosed. The in-flight picker edge was not device-tested.
- Shared `ModelPipelineState` imports from `AppShell.tsx` remain for the later old-app deletion slice.
- I could not verify a live computer connection or native device behavior. No build or device run was performed.

## Verification

- First focused Jest attempt: exit 1 because the new test expected an un-destructured `deps.ensureEngineForModel` call; corrected it to the actual guarded call in `engineTurn.ts`.
- `npx jest --silent --runInBand src/host/turnEnsureDispatch.test.ts src/host/localEnsureGate.test.ts src/host/composerArms.test.ts src/host/remoteEngineError.test.ts`: exit 0, 4 suites / 22 tests.
- `npx tsc --noEmit`: exit 0.
- `npx jest --silent`: exit 0, **207 suites / 2358 tests** (the pre-fix port was 205 / 2354).
- `git diff --check`: exit 0.
- Ratchets unchanged: `HostRoot.tsx` 241/241, `useModelHost.ts` 347 lines, `sendHost.ts` 348/350; new files are below 350 lines.

## Reviewer follow-up at `4d05801`

- **Turn dispatch test:** `modelEnsureDispatch.ts:4-10` is the model host's shared local/remote dispatcher, used at `useModelHost.ts:218-237`. `turnEnsureDispatch.test.ts:30-89` constructs `buildTurnDeps`, calls the real `handleSendStream` with `REMOTE_COMPUTER_MODEL`, and asserts the remote ensure ran while the local loader stayed untouched. This replaces the earlier synthetic-ref-only proof.
- **Research stays local:** `composerArms.ts:23-34` defines the intent, refusal, and visible-chip predicates. Remote chip taps go through `runHostLocalAction` at `HostChatSurface.tsx:190-192`; keyword or previously armed remote research receives the existing reason at `sendHost.ts:199-212`. Even if a stale/direct request reaches the engine, `engineTurnResearch.ts:30-35` refuses before starting the pipeline. Its tests prove remote refusal and prove local research reaches `executeTool` through the local research callback (`engineTurnResearch.test.ts:37-65`). The deep-research implementation itself is mocked in that test; native model execution was not verified.
- **Translate:** the menu row remains available (`messageMenuRows.ts:55`); its action still reaches `runTranslate` (`messageActions.ts:276-279`). The hook gates all translation entry points, including retry, at `useTranslateMessage.ts:83-124` and speaks `settings.remoteGated`. `remoteLocalAction.test.ts:7-44` covers remote refusal, local execution, and the wiring.
- **Images:** `openaiMessages.ts:8-30` remains text-only. `remoteAttachmentChips.ts:5-18` labels image and rendered-PDF chips in remote mode; documents keep the normal label. The copy is in `en.ts:1392` and `it.ts:1338`. `HostChatSurface.tsx` passes the live attachment list and remote state to this mapper; `remoteAttachmentChips.test.ts:18-30` checks remote and local results.
- **Boot note, delete deferral:** `usePipelineScans.ts:114-132` evaluates `isDeleteActive()` after the settings and saved-model awaits; `docOpGate.ts:51-52` reads the module's live delete flag. The boot effect intentionally makes one startup decision, so the mount-only dependency list does not freeze the gate value. No code change was needed for this note.
- **Boot note, saved remote sentinel:** a busy remote boot previously fed `REMOTE_COMPUTER_MODEL_ID` into the local model picker. The deferred plan now falls back to the real default local id at `remoteHostBoot.ts:42-51`; `remoteHostBoot.test.ts:33-54` verifies the id is in `MODEL_REGISTRY` and is what the picker receives. The old path would skip restoring that sentinel as a local model; the follow-up local probe could still resolve the initially selected model, so “stays checking” was not permanent, but the selected restore path was wrong.
- **Disclosure finding:** the data inventory remains accurate. `documentChatHarvest.ts:33` is the local `document_chat` path, while the remote message serializer drops images; the new chip explains that omission. No additional remote payload was introduced.
- **Still absent:** there is no host background embedding or semantic rebuild target to gate (`HostOverlays.tsx:244-248`, `usePipelineScans.ts:129-131`). This remains a reported boundary, not an untested host job.

### Current verification

- `npx tsc --noEmit`: `EXIT=0`.
- `npx jest --silent`: `EXIT=0`, **210 suites / 2366 tests**.
- `git diff --check`: `EXIT=0`.
- The first full run after the UI wiring change was `EXIT=1` because `attachUi.test.ts` still expected the direct `arms.toggleResearch()` source expression. That assertion now pins the guarded call, and the same test exercises both remote refusal and local toggle (`attachUi.test.ts:223-237`). The final full run above is green.
- No ratchet changed. Current line counts: `HostRoot.tsx` 241, `useModelHost.ts` 349, `sendHost.ts` 350, `engineTurn.ts` 311; all newly added files are below 350 lines.
- Not verified: a live remote computer connection, the in-flight picker transition on device, or native remote image serialization on device. No build, install, or device run was performed.
