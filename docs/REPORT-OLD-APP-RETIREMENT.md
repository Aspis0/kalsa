# Old App Retirement

Branch `ux-2026-09-21`, HEAD `f6689b6e` at final validation. The owner confirmed the Jelly Star build before this deletion.

## Removed and rewired

- Deleted `src/app/AppShell.tsx` and `src/screens/AiChatPage.tsx`; no copy, archive, renamed file, or sibling directory was created.
- Deleted `src/app/AppShell.remoteWiring.test.ts`, a 17-test source-text suite tied to the removed controllers. Its runtime contracts are covered by the host suites listed below.
- `App.tsx:34,187` imports and mounts `HostRoot` directly. `NEW_SHELL` and its AppShell branch are gone; the separate screenshot-only `SHELL_PREVIEW` remains.
- No commit was made. The worktree also retains the preceding uncommitted remote-port changes that were present when this retirement turn began.
- Moved `ModelPipelineState`, `VoicePipelineState`, and `EmbeddingPipelineState` to `src/host/hostPipelineState.ts:1-24`. The host hooks, model helpers, tests, `HostOverlays.tsx:42-46`, and the still-mounted legacy `SettingsScreen.tsx:21-25` now import from this host-owned module. No shim points back to AppShell.
- Moved the chat payload types (`MessageSource`, `ResultImage`, `ResultDownload`, `ChatCta`, `LocalAttachment`) into `src/host/hostMessage.ts:7-39`; `Message` is host-owned there as well. `hostMessage.ts` has no AiChatPage import.
- `HostRoot.tsx` remains within its 241-line ratchet; all new files are below 350 lines. No ratchet changed.

## The 15 source-reading test files

| Test | Behavior retained and current owner | Verdict |
|---|---|---|
| `src/ui/shell/ctaChips.test.ts:20-62` | CTA is labelled, static text; `TranscriptTurns.tsx`, `transcriptTypes.ts`, `messageMapper.ts:103`. The test now maps a CTA and checks its label plus the non-action renderer. | Repointed; removed the old AppShell no-op callback pin. |
| `src/ui/shell/caretSpec.test.ts:17-100` | Caret predicate, motion, accessibility, and routing; `caretSpec.ts:40`, `StreamCaret.tsx`, `messageMapper.ts`. | Retained against current owners; old AiChatPage references are comments only. |
| `src/host/notesNotice.test.ts:26-72` | Note truncation notice and one-slot behavior; `engineTurn.ts`, `sendHost.ts`, `HostNotice.tsx`. | Replaced the old voice-toast source pin with a rendered HostNotice assertion. The old voice-specific path is not mounted; mic/Whisper remains in PARITY. |
| `src/host/modelBarPress.test.ts:31-94` | Model-state tap decisions, including hung refusal; `modelBarPress.ts`, with states from `hostPipelineState.ts`. | Repointed to host-owned state types and pure action policy. |
| `src/host/keyboardFocus.test.ts:20-77` | Drawer dismissal, template fill/focus, and field focus; `HostDrawer.tsx`, `templateSelection.ts:2`, `HostChatSurface.tsx`, `ShellComposer.tsx`. | Repointed; template behavior is exercised through the extracted helper. The absent transcript-tap focus remains PARITY row 46. |
| `src/host/attachments.test.ts:25-150` | Cap, dedupe, vision, routing, and error mapping; `attachments.ts:36`, `useAttachments.ts`. | Replaced controller literals with boundary behavior assertions. |
| `src/host/shareImport.test.ts:61-178` | Text/PDF shared import, failures, and attachment; `shareImport.ts:38+`, `useShareIn.ts`. | Retained against the host implementation. |
| `src/host/hostOverlay.test.ts:24-54` | Miniapp overlay open/replace/refusal policy; `hostOverlay.ts:39`, `HostOverlays.tsx`. | Retained against the host policy. |
| `src/host/downloadNotifications.test.ts:72-175` | Notification permission, throttle, outcomes, and dismissal; `downloadNotifications.ts`. | Retained against the host notification adapter. |
| `src/host/docxAttach.test.ts:49-190` | DOCX caps, failure mapping, cleanup, and commit; `docxAttach.ts:57`, `documentStorage.ts`, `useAttachments.ts`. | Retained against the host import path. |
| `src/host/shareIn.test.ts:28-122` | Consume-once, hold/flush, nonce merge; `shareIn.ts`, `useShareIn.ts`. | Retained against the host share path. |
| `src/host/sendDraft.test.ts:14-53` | Only the submitted draft text clears; `sendDraft.ts:16`, `sendHost.ts`. | Kept the host rule and both clear sites. Removed the two old-only tests “the controller cleared the field on EVERY send, card or not” and “the card reached that send with the CARD's text, never the draft”: the v2 welcome surface is an image and has no suggestion-card send path. |
| `src/host/modelBar.test.ts:45-329` | Status, errors, remote-ready label, and battery lines; `modelBar.ts:76`, `useModelBar.ts`. | Retained against host derivations. |
| `src/host/toolFlags.test.ts:33-84` | Shared storage key/encoding, ref mirror, and notify-on-change; `toolFlags.ts`, `toolTogglePersistence.ts`, `staticPrefixNotify.ts`. | Repointed storage behavior to the extracted persistence helper and exercised both values. |
| `src/host/translateFlow.test.ts:60-213` | Translate ownership, abort/orphan cleanup, engine gates, and volatility; `useTranslateMessage.ts`, `translateState.ts`, `historyMessages.ts`, `messageMapper.ts`. | Replaced the old Message-type text pin with a persisted/restore/projection behavior check. |

The removed 17 source-only remote-wiring tests are superseded by host behavior suites: facade/tools/research (`engineBackendStream.test.ts`, `engineTurnResearch.test.ts`); boot and read-failure recovery (`remoteHostBoot.test.ts`, `remoteBootFallback.ts`); selection and refusal (`remoteModelSelection.test.ts`, `remoteModelHostActions.test.ts`, `remoteModelTransition.test.ts`, `modelSwitchRemote.test.ts`); local-only actions/attachments (`remoteLocalAction.test.ts`, `remoteAttachmentGate.test.ts`); errors (`remoteEngineError.test.ts`); readiness (`modelBar.test.ts`, `remoteHostEnsure.test.ts`); and configuration invalidation (`remoteEngine.lifecycle.test.ts`). The old background embed/rebuild guards had no host operation to guard: the host overlay reports rebuild as unavailable, and no background semantic embed job is mounted.

## Harness owners and parity ledger

- Repointed CI source checks from AppShell to the host owners: `thinkHistoryHarness.mjs:75,264,732` checks `historyMessages.ts`, the host emission writers, and the three turn-window phases; `memoryFactsTailHarness.mjs:618` checks `engineTurnCompactor.ts`; `memoryTelemetryHarness.mjs:447` checks `engineTurnMemory.ts` / `engineTurnStream.ts`; `embeddingServiceHarness.mjs:420` checks the shared `engineEnsureLoad.ts` path and host gates. The old two AppShell init sites are one shared host `performEngineLoad` site, so the harness now checks the single bounded init and its callers.
- The deleted controller also owned a foreground static-prefix re-kick. Added `foregroundPrewarm.ts:27` and mounted it from `useHostEngine.ts:124-145`; `foregroundPrewarm.test.ts:31-91` drives active/background events, matching-model dispatch, thermal/remote refusals, and the skip reasons. `prefixPrewarmHarness.mjs:323,2315` now pins that host seam. This preserves the old local prewarm behavior without dispatching local prewarm in remote mode.
- `docs/PARITY.md` was not edited (`git diff -- docs/PARITY.md` is empty). The mic/Whisper rows 29 and 31 (`docs/PARITY.md:51,53`) and transcript-tap focus row 46 (`:70`) remain visible for the later slice. Their old source files are recoverable only from Git history.

## Validation

- `npx tsc --noEmit` — EXIT=0.
- `npx jest --silent` — EXIT=0; 219 suites / 2,387 tests passed.
- CI workflow's 59 `node scripts/...` logic harnesses (`.github/workflows/apk.yml:87-157`) — EXIT=0; 59/59 passed.
- `git diff --check` — EXIT=0.
- An initial post-delete Jest run exited 1 on two stale source assertions (storage inline in `toolFlags.ts`, template fill inline in `HostChatSurface.tsx`); both tests now exercise their extracted helpers and the full rerun passes. The first harness batch exited 1 because its history budget audit expected six monolithic occurrences; it now checks the same five consumers across the three host phases, and the complete rerun passes.
- No build, APK install, device action, or commit was run. Device confirmation is the owner's report; this turn could not independently verify the phone.
