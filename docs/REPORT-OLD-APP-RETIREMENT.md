# Old app retirement preparation

## Status

Read-only audit and retirement plan. No source or test files were changed, no route was collapsed, and neither controller was deleted. The requested starting commit was `4251527`; the checked-out branch is `ux-2026-09-21` at `e11c4dc`, one docs-only commit ahead (`docs/DESIGN-PAIRING.md`). The worktree was clean before this report.

**Stop: the `docs/PARITY.md` gate is not satisfied.** `App.tsx:50-56` says the branch stays until parity says it can go. The checklist has stale statuses, but it still records behavior that is absent from the new shell and has only an old implementation. That is a parity defect, not a deletion decision.

## Type extraction plan

1. Add `src/host/pipelineState.ts` for `ModelPipelineState`, `VoicePipelineState`, and `EmbeddingPipelineState`. Repoint `HostOverlays.tsx:42-46`, `SettingsScreen.tsx:21-25`, and every host/test importer currently reaching into `AppShell.tsx`; the full current set includes `usePipelineScans`, `modelBar`, `modelBarPress`, `composerView`, `useModelHost`, `useModelDownload`, `engineLoad`, `composerPhase`, `remoteHostEnsure`, `remoteModelSelection`, `remoteModelHostActions`, `hostModelLocation`, and the three named tests. These are type-only changes; they do not alter remote behavior or `src/engine/remote/`.
2. Make the message schema in `src/host/hostMessage.ts` own `ChatCta`, `LocalAttachment`, `MessageSource`, `ResultDownload`, and `ResultImage`, alongside `Message`. Repoint `AppShell.tsx` and `AiChatPage.tsx` to those host-owned declarations and remove `hostMessage.ts`'s type import from `AiChatPage.tsx:17`. No shim may point back to either controller.
3. Keep `AppShellProps`, the private `ModelState` alias, and the old overlay union local to `AppShell` until the later route-removal step; they are not shared host types. `HostOverlay` already owns the new shell's overlay union.

## Fifteen test-file verdicts

The supplied list is not fifteen raw reads of the controllers at this HEAD. Seven files read controller text, one imports a controller type, and the rest test current host modules or read a separate storage module. Keep each suite and its behavior; only replace obsolete controller comparisons with the current owner.

| Test file | Behavior pinned | Current status / owner after controller removal |
|---|---|---|
| `src/ui/shell/ctaChips.test.ts` | CTA payload reaches transcript; CTA is labelled text, not a dead button. | Still exists in `TranscriptTurns.tsx` / `Transcript.tsx`. Replace its `AppShell` no-op source assertion with the host renderer's non-pressable behavior; the old controller stub is historical. |
| `src/ui/shell/caretSpec.test.ts` | Caret predicate, animation, accessibility, and mapper use. | Already tests `caretSpec.ts`, `StreamCaret.tsx`, and `messageMapper.ts`; it does not read controller text. Keep; update the stale `AiChatPage.tsx` comment reference. |
| `src/host/notesNotice.test.ts` | Notes-context truncation speaks once through the one-slot notice. | Still in `engineTurn.ts` → `sendHost.ts` → `useNotice.ts` / `HostNotice.tsx`; replace the `AiChatPage` copy/source pin with a behavior assertion on the host notice event and catalog keys. |
| `src/host/modelBarPress.test.ts` | Download/retry/reload/inert decision table, including hung precedence. | Behavior remains in `modelBarPress.ts`; only its type import points to `AppShell`. Repoint to `pipelineState.ts`. |
| `src/host/keyboardFocus.test.ts` | Drawer keyboard dismissal, template selection focus, composer focus target. | Host routes are in `HostDrawer.tsx`, `HostChatSurface.tsx`, and `ShellComposer.tsx`. Replace the old `AiChatPage` count with assertions against those owners. The separate transcript-tap focus behavior is still missing; see parity stop below. |
| `src/host/attachments.test.ts` | Five-item cap, distinct refusal keys, document dedupe, vision predicate, document hints, picker routing, PDF error mapping. | These behaviors live in `attachments.ts`, `attachFlow.ts`, and `useAttachments.ts`. Retarget old-controller constant comparisons to the host contract while preserving each behavioral case. |
| `src/host/shareImport.test.ts` | Text/PDF share import outcomes, attachment, busy/cap/failure notices, and bilingual keys. | Already exercises `shareImport.ts`; it does not read a controller. Keep; update historical line references only. |
| `src/host/hostOverlay.test.ts` | Miniapp normalization, exclusive-overlay precedence, replacement, invalid-payload refusal. | Already exercises `hostOverlay.ts`; it does not read a controller. Keep; update historical line references only. |
| `src/host/downloadNotifications.test.ts` | Progress throttle, permission denial, channel setup, ready/failure notification, best-effort dismissal. | Already exercises `downloadNotifications.ts`; it does not read a controller. Keep; update historical line references only. |
| `src/host/docxAttach.test.ts` | Import order, caps, extraction/storage errors, cleanup, commit-before-attach. | Already exercises `docxAttach.ts`. Its one text read is `documents/documentStorage.ts`'s mirrored byte cap, not either controller; keep that drift guard. |
| `src/host/shareIn.test.ts` | Consume-once, pending-until-ready, invalid URL, nonce merge, draft preservation and cap. | Already exercises `shareIntent.ts` / `useShareIn.ts`; no controller source is read. Keep; update historical line references only. |
| `src/host/sendDraft.test.ts` | Composer sends clear only their own text; suggestion sends preserve an unrelated draft. | The new behavior lives in `sendHost.ts` and its `HostRoot` call site. Replace the two `AiChatPage` historical comparisons with a behavioral call-site assertion; retain the old/new distinction as context, not as an executable dependency. |
| `src/host/modelBar.test.ts` | Model status, remote-ready copy, failure hints, and battery ETA decisions. | Tests current `modelBar.ts` / `useModelBar.ts`; no controller text is read. Keep; update comments that cite old line numbers. |
| `src/host/toolFlags.test.ts` | Persisted Web key/encoding, state+ref mirror, default, and notify-on-change behavior. | Current owner is `toolFlags.ts` / `staticPrefixNotify.ts`. Replace the `AppShell` string comparison with a behavioral assertion against the host storage/ref path; preserve all persistence and notification cases. |
| `src/host/translateFlow.test.ts` | Translation run ownership, abort/cleanup, engine exclusion, and non-persistence. | Current owner is `useTranslateMessage.ts`, `translateState.ts`, `hostMessage.ts`, and `historyMessages.ts`. Replace the old `AiChatPage` type comparison with the host message/history contract; retain the existing host assertions. |

## PARITY walk and stop condition

`PARITY.md` D1 is not a current inventory: rows 9 and 11 still call the caret/send path absent, while `messageMapper.ts`, `StreamCaret.tsx`, `HostRoot.tsx`, `sendHost.ts`, and `engineTurn.ts` implement them. Rows 12-14, 22-28, 33-37, 41, and 43-45 also contain stale `✗`/`◐` claims for surfaces now present in `welcomeBlock.tsx`, `Transcript*`, `messageActions.ts`, `HostOverlays.tsx`, `useModelBar.ts`, `useShareIn.ts`, `useAttachments.ts`, and `HostDrawer.tsx`. Those statuses should be reconciled before the gate is relied on.

The following entries remain material:

- **D1 rows 29-32 and 40; D2 row 15 (voice):** `AiChatPage.tsx:1354-1426,1515-1611` contains the listen/stop/transcribe/prefill flow and cleanup. In the new shell, `HostChatSurface.tsx:249` maps the mic press to `shell.notice.mic`; there is no host `VoiceCapture` flow, voice-state row, or voice-note toast. `HostOverlays.tsx:205` maps Whisper download to an unavailable notice. TTS read-aloud itself has moved to `useReadAloud.ts`, and the TTS preference is wired; those parts are not blockers. The new device path therefore does not reproduce mic/Whisper behavior, and the only implementation source to reproduce it is the old chat/controller. **This is an unresolved parity obligation: do not delete the controllers.**
- **D1 row 46 (focus):** template choice focuses via `HostChatSurface.tsx:299`, and the composer has a field-area focus handler in `ShellComposer.tsx:98`. `Transcript.tsx` receives no focus callback, so the old behavior of tapping the transcript to focus the field is not represented. The old source is the only documented implementation. Add/reconcile this row before retirement.
- **D1 row 50 (keyboard-debug badge):** `AiChatPage.tsx:866-915,4668-4691` is the only implementation; the new shell has none. PARITY itself says “decide keep/drop.” It is dev-only and not counted as a settled user-facing obligation, but its disposition remains open.
- **D1 row 2:** export exists as a per-conversation action in `conversationActions.ts` / `HostDrawer.tsx`; the old header placement is not the new design. Mark this as moved rather than missing.
- **D1 row 38 and D2 row 18:** the old memory banner has setters but no reader in the old code; the new code need not preserve an invisible row.
- **D1 rows 48-49:** PARITY records haptics and chat-surface swipe-to-delete as nonexistent; neither is an old-only behavior to preserve.

## Retirement boundary

When parity is accepted and the Jelly Star build is confirmed, the only source files in this requested deletion are:

1. `src/app/AppShell.tsx`
2. `src/screens/AiChatPage.tsx`

`App.tsx` will be edited to remove `NEW_SHELL` and its old branch; it will not disappear. No renamed copies, archives, or sibling directories are planned. None of these deletions or the route edit was made in this preparation.

## Commands and verification

- `git branch --show-current` — exit 0 (`ux-2026-09-21`).
- `git rev-parse --short HEAD` — exit 0 (`e11c4dc`; expected `4251527` is its parent).
- `git status --short` — exit 0 (clean before this report).
- `rg` / `nl -ba` reads of `docs/PARITY.md`, the fifteen named tests, current host owners, and the controller imports — exit 0.
- TypeScript, Jest, device, APK, and Gradle were not run. No source/test changes were made to verify; no device build was requested or performed.
