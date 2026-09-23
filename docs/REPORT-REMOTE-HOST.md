# Remote mode in the host shell

Branch `ux-2026-09-21`, base `3597425`; no commit and no deletions. Reference: `ca2dcc0:src/app/AppShell.tsx` and lab `STEP2.md` (hunks 1–7, fix rounds 1–4).

## Ported gates

| Main reference | Host implementation and behavioral coverage |
|---|---|
| Stream facade / tools off — `AppShell.tsx:7087,7148` | `src/host/engineBackendStream.ts:8-14` routes the host stream through `engineBackend`; remote requests clear `tools` and `executeTool`. `engineTurnStream.ts:224` is the call site. `engineBackendStream.test.ts` drives both modes and checks the live call site. Backend-dispatched session, translation, memory, completion, and switch operations use the facade; local KV/profile metrics remain local. |
| Boot decision — `AppShell.tsx:3031-3090` | `remoteHostBoot.ts:22-68` applies `decideRemoteBoot`, defers only a remote flip while document deletion is active, and keeps `pickStartModel` for local/deferred decisions. `usePipelineScans.ts:109-185,274-317` hydrates before probing and resumes the probe after a switch. `remoteHostBoot.test.ts` and `remoteHostProbe.test.ts` exercise local restore, remote deferral, the switch lock, and cache/intent mismatch. |
| Remote selection/refusals — `AppShell.tsx:4953-5029` | The existing Settings route is preserved: `HostOverlays.tsx:180-197` passes `selectModelById` to the Advanced Settings model row. `remoteModelHostActions.ts:47-69` applies the download/switch/loading, stream, regeneration, and delete guards; `remoteModelTransition.ts:31-71` disposes, flips, persists, and ensures. `modelSwitch.ts:97-110,186-220,278-301` handles switching back to local and the same-index case. Action/transition tests assert refusals do not dispatch and the accepted transition order. |
| Three embedding gates — `AppShell.tsx:1636,1894,2100` | No host background embed job exists: documents are BM25-first (`libraryHost.ts:4-7`), and `HostOverlays.tsx:244-248` reports semantic rebuild unavailable. There is no job entry, mid-job chunk, or active rebuild to gate. The remote-selection predicate retains and tests the rebuild refusal input, but production supplies `false`; delete is the live document lock. |
| Human remote errors — `AppShell.tsx:7133` and selection catch | `remoteEngineError.ts:4-10` wraps `humanRemoteBrainError`; remote ensure (`remoteHostEnsure.ts:48-58`), transition (`remoteModelTransition.ts:56-63`), and stream errors (`engineTurnStream.ts:254-280`) use it. `remoteEngineError.test.ts` checks remote mapping and unchanged local text. |
| Attachment gates — main `AiChatPage` composer, picker, share, and import paths | `remoteAttachmentGate.ts:1-12` guards the attach sheet, camera/library picker, document picker, and library row (`HostChatSurface.tsx:193,201,241,306`); shared files are refused in `useShareIn.ts:72-87`, while text shares remain allowed. `remoteAttachmentGate.test.ts` and the updated attach tests exercise local-open and remote-refusal behavior. |
| Remote ready/location — `AppShell.tsx:7253` | `modelBar.ts:84-120` returns `download.readyRemote`; `useModelBar.ts:61` supplies remote state. `hostModelLocation.ts:5-18`, mounted at `HostChatSurface.tsx:112-117,224-225`, uses the server glyph/label remotely and retains the refusal-aware phone label locally. `modelBar.test.ts`, `hostModelLocation.test.ts`, and updated `modelFailureState.test.ts` pin both modes. |

## Gaps and limits

- The host has no semantic rebuild or background embedding job, so those three job-specific gates have no production target. Deletion-in-flight is wired and tested; an actual rebuild refusal cannot be reached in this branch.
- A picker started in local mode may finish after a switch to remote. Entry points are gated; already-staged document names remain eligible for the remote text request and remote conversion drops images. That in-flight picker edge was not device-tested.
- The explicit `sendOpts.research` branch in `engineTurn.ts:184-228` runs before the streamed call and can invoke the app-side tool executor. Main has the same separate branch (`AppShell.tsx:6146-6190`); the audited `tools`/`executeTool` gate applies to the stream options. I left that existing path unchanged and flag it for reviewer/owner decision before claiming every research operation is disabled remotely.
- The host still imports shared `ModelPipelineState` from `AppShell.tsx`; moving that type is work for the later old-app deletion slice. I did not verify on-device or against a live remote computer; Jest runs in Node and does not render these screens.

## Verification

- Initial full Jest run: exit 1 (stale source assertions for the attach callback/pill plus a test mock still targeting `LlamaService`). Repointed those tests to the behavior and the engine facade; coverage remains.
- `npx tsc --noEmit`: exit 0.
- `npx jest --silent`: exit 0 — 205 suites, 2354 tests (baseline 195 / 2323).
- `git diff --check`: exit 0. The ratchet suite passed; `HostRoot.tsx` remains 241 lines, `useModelHost.ts` 347, and every new file is below 350 lines. No build, install, device run, or commit.
