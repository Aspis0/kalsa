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

1. **Send ensure dispatch:** `useHostEngine.ts:159` passes `modelHost.scanRefs.ensureEngineForModelRef`; `hostDeps.ts:140` binds the turn through `createTurnEnsure` (`turnEnsureDispatch.ts:4-7`). The ref routes the remote ID to `ensureRemoteHostModel` (`useModelHost.ts:217-235`). `turnEnsureDispatch.test.ts:12-30` drives a remote ID and proves the remote ensure runs while local ensure does not; it also ties the tested dispatcher to the send path.
2. **Research/tools gate:** `sendHost.ts:199-207` gates both keyword research and the armed research chip with `isRemoteEngineBackend()`. `engineTurn.ts:185-221` keeps its existing research branch, but remote sends cannot set `sendOpts.research`, so its tool executor is not reached. `composerArms.test.ts:59-83` exercises remote and local options, checks the executor is skipped remotely, and pins the live send wiring.
3. **Stream error boundary:** `remoteEngineError.ts:14-18` maps only `remote_brain_` codes and preserves other messages. The stream callback uses it at `engineTurnStream.ts:266`; `remoteEngineError.test.ts:21-34` verifies remote code, unknown remote code, and native detail behavior.
4. **Remote-to-local switch window:** `engineEnsure.ts:38-43` checks the facade backend through `runLocalEnsureGate` (`localEnsureGate.ts:2-7`) before entering the local loader. `localEnsureGate.test.ts:7-18` verifies a remote backend refuses without invoking local load and the local backend still loads.

## Remaining limits

- The three embedding gates still have no host job to protect: rebuild is explicitly unavailable at `HostOverlays.tsx:244-248`, and boot passes `semanticRebuildBusy: false` at `usePipelineScans.ts:129-131`.
- A picker started locally may finish after switching to remote. Entry points are gated; already-staged document names remain eligible for the remote text request and remote conversion drops images. This in-flight picker edge was not device-tested.
- Shared `ModelPipelineState` imports from `AppShell.tsx` remain for the later old-app deletion slice.
- I could not verify a live computer connection or native device behavior. No build or device run was performed.

## Verification

- First focused Jest attempt: exit 1 because the new test expected an un-destructured `deps.ensureEngineForModel` call; corrected it to the actual guarded call in `engineTurn.ts`.
- `npx jest --silent --runInBand src/host/turnEnsureDispatch.test.ts src/host/localEnsureGate.test.ts src/host/composerArms.test.ts src/host/remoteEngineError.test.ts`: exit 0, 4 suites / 22 tests.
- `npx tsc --noEmit`: exit 0.
- `npx jest --silent`: exit 0, **207 suites / 2358 tests** (the pre-fix port was 205 / 2354).
- `git diff --check`: exit 0.
- Ratchets unchanged: `HostRoot.tsx` 241/241, `useModelHost.ts` 347 lines, `sendHost.ts` 348/350; new files are below 350 lines.
