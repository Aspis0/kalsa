# PARITY-STATUS — the answer to `docs/PARITY.md` at commit `69ac2d4`

This file is the row-by-row answer to the specification in `docs/PARITY.md`, verified on
branch `ux-2026-09-21` at commit `69ac2d4`. The previous walk described `f01a7f4`
(committed as `f64f96a`); rows whose verdict moved say **CHANGED since f01a7f4 (was …)**.
Slices landed since that walk: `84a948f` (comment diet — 821 comment lines removed, which
moved nearly every line reference below), `437a57d` (draft survives a foreign send, CTAs as
static chips, notes-truncation notice wired, keyboard/focus remainder), `e0a012b` (share-in,
mini-app card + sheet, overlay deletion reversed in writing), `69ac2d4` (translate, edit,
read-aloud; root relieved into `HostLayout.tsx` — `HostRoot.tsx` is 241 lines, the ratchet's
`ROOT_FILE_LIMIT`).
Method: read-only walk of `src/host/**`, `src/ui/shell/**`, `App.tsx` against the two
controller files by grep + bounded reads; no test was executed (existence claims only).
**Re-walk and regenerate this file after any slice that touches `src/host/**` or
`src/ui/shell/**`** — every verdict below is only true of the tree that produced it.

**Verification of the last slice's claimed move list** (rows 15, 16, 17, 18, 19, 21, Table 3
gap 1, every `HostRoot.tsx` ref; plus 3, 4, 28, 41, D2-16 from earlier slices): **confirmed**
15, 17, 18, 19 (→ IMPLEMENTED), 3, 4, 28, 41 (→ IMPLEMENTED), D2-16 (checks now exist), gap 1
(replaced), and every `HostRoot.tsx` ref (241 lines; composition in `HostLayout.tsx:53-125`).
**Not confirmed:** row 16 keeps its verdict (DIFFERENT — read-aloud landed, the "more" chip is
still not drawn) and row 21 was already IMPLEMENTED (evidence changed to the shared handoff).
**Moved but NOT on any claimed list:** rows 1, 6, 26, 45, 46.

**The three entries a wrong line would poison — verified directly:**
1. **Mini-app persistence is byte-stable**: save → disk → restore → save pins
   `JSON.stringify(resaved) === JSON.stringify(saved)` (`src/host/miniappHistory.test.ts:48`);
   `src/engine/historyPersistable.ts` and `src/engine/sessionPersistence.ts` are untouched
   (empty diff across all four slices), so the frozen-hash path is the same code.
2. **Edit and regenerate share ONE truncate**: `src/host/truncateAndResend.ts:44-80` is the
   single lock → truncate → claim → declare block; `useEditMessage.submit`
   (`useEditMessage.ts:85-97`) and `messageActions.regenerate` (`messageActions.ts:239`)
   both enter it, plans from the same `regenPlan.ts` (`planRegenerate:31`, `planEdit:66`).
   Pinned: `editFlow.test.ts:113,119,129,166`, `messageActions.test.ts:169`. No second
   truncate exists (`grep "setMessages(() => plan.base)"` → only `truncateAndResend.ts`).
3. **Translation is absent from the persisted message in both apps**: neither `Message`
   type carries a translation field (`src/host/hostMessage.ts:22-77`; old `Chat:240-300`);
   the result lives in volatile hook state keyed by id (`useTranslateMessage.ts:8-11`);
   `historyMessages.ts` has no translation branch; `historyPersistable.ts` untouched —
   `toPersistableHistoryMessages` cannot see a translation in either app, so the hash
   contract holds.

Vocabulary (D1): IMPLEMENTED · STUBBED (held, with the toast key or hold line — §2.7) ·
MISSING · DIFFERENT (with the how). Shorthand: `App` = `src/app/AppShell.tsx`,
`Chat` = `src/screens/AiChatPage.tsx` (both untouched — controller line refs stay valid).

---

## Table 1 — Deliverable 1: the 50 feature rows

| # | Feature | Verdict | New location / hold signal (and the how) |
|---|---|---|---|
| 1 | Drawer: list, tap-switch, long-press delete, new-chat, persona row, 180 ms search, keyboard dismiss per row | **IMPLEMENTED** — **CHANGED since f01a7f4 (was DIFFERENT — persona dismiss landed)** | List/tap/long-press: `src/host/conversationActions.ts:247-259` (confirm `:220-229`); new-chat `src/host/HostDrawer.tsx:82` → `conversationActions.ts:118-172`; persona row `HostDrawer.tsx:88-93` **with `Keyboard.dismiss()` before close** (old `App:7104`); debounce `src/host/useConversationHost.ts:21`; static-item dismiss `conversationActions.ts:268,280,291,302` + export row `HostDrawer.tsx:69`. Every old dismiss site (`App:2576,2588,2599,2610,7104`) now has its counterpart — pinned with the controller's own order in `keyboardFocus.test.ts:27-44`. |
| 2 | Chat header: menu, export/share, new chat | **DIFFERENT** (evidence updated) | Menu `src/ui/shell/Shell.tsx:173-181` → `HostRoot.tsx:220`; new chat `Shell.tsx:250-257` → `HostRoot.tsx:221`. **How different:** export is not in the header — it is a **drawer tile** (`HostDrawer.tsx:60-77`: dismiss → close → same `shareConversation`; wiring `HostRoot.tsx:231`; builder `src/host/shareConversation.ts:20-41`, test `shareConversation.test.ts:58`) because five 349 dp controls squeezed the pill (`shellGeometry.ts:186-192`). Same markdown, same `Share` sheet; different chrome. Old `Chat:3206-3218, 4757-4769`. |
| 3 | Eight exclusive overlays | **IMPLEMENTED** — **CHANGED since f01a7f4 (was DIFFERENT — miniapp kind restored)** | All eight: `src/host/hostOverlay.ts:17-24` with the controller's precedence policy `withMiniappOverlay` `:39-46` (old `App:7035-7046`), mounts `src/host/HostOverlays.tsx:158,209,217,220,239,248,260,269` (settings/account/pro/documents/notes/personas/help/**miniapp**), assembled `HostFurniture.tsx:50-97`. Tests `hostOverlay.test.ts:25-54` (open, exclusive wins, replace-not-stack, refused payload opens nothing). The deletion reversal is written into `hostOverlay.ts:1-15`. |
| 4 | Mini-app card **and** full-screen sheet | **IMPLEMENTED** — **CHANGED since f01a7f4 (was MISSING)** | Card `src/ui/shell/MiniappCard.tsx:120-165` (open press `:157`), rendered `src/ui/shell/TranscriptTurns.tsx:243-250`, mapped `src/host/messageMapper.ts:120`, prop chain `HostChatSurface.tsx:177` → `Transcript.tsx:90,297` → open `HostRoot.tsx:225` through the controller's policy (`hostOverlay.ts:39-46`). Sheet `src/host/HostMiniappSheet.tsx:31-118` around the CALLED renderer, mounted `HostOverlays.tsx:269-274` (old chrome `App:7214-7252`), block actions routed `HostMiniappSheet.tsx:100` (old `App:5346-5362`). Persistence + mapper + text-migration pinned `miniappHistory.test.ts:48-115`. |
| 5 | Web switch in the top bar (persisted) | **DIFFERENT** (evidence updated) | Switch `Shell.tsx:216-247`, flip + persist `src/host/toolFlags.ts:88-96` (key write `"1"/"0"` `:92`), wiring `HostChatSurface.tsx:162-163`; tests `stripWebSwitch.test.ts:2-10`, `toolFlags.test.ts`. **How different:** old chip 36×22 on `hitSlop` (`App:6926-6959`); new is a labelled 48 dp box. Strip contract: **THREE icon buttons** (menu, Web, new chat — export left, row 2), pill 154 dp with `stripPillTextColumn` budget (`shellGeometry.ts:49,186-192`, `stripTextBudget.test.ts`); the pill's logo mark is gone (new-shell item, recorded `Shell.tsx:189`). Persistence + notify-on-change unchanged (D2 14/21). |
| 6 | Composer field: typing, focus, tap-to-focus, held placeholders (§2.7) | **IMPLEMENTED** — **CHANGED since f01a7f4 (was DIFFERENT — both focus paths landed)** | Field `ShellComposer.tsx:93-104`; input-area tap-to-focus `ShellComposer.tsx:83-91` — the controller's second focus site is exactly this (`Chat:4330`, "Input-area only"; PARITY's row text called it tap-the-transcript); template fill+focus `HostChatSurface.tsx:204-206` (old `Chat:3636-3637`); controller has exactly two `inputRef.current?.focus()` sites, both now present — pinned `keyboardFocus.test.ts:46-76`. Hold reason row `Shell.tsx:281-287`; decisions `composerState.ts:146-163` over the phase table `:108-120` (typing through every known wait — §2.7 vs the controller's single-`disabled` defect `Chat:4337-4339`). Notes: keyboard handled by insets instead of the KAV lift (`Shell.tsx:147-151`, `useKeyboardHeight.ts`) — mechanism, same visible outcome; the card/regen sends no longer clear the field (row 12 / Section 4.18). |
| 7 | Action row: templates ✦, attach, mic (3 voice states), send⇄stop, per-control disabled | **DIFFERENT** (evidence updated) | Faces + disabled `ShellComposer.tsx:116-141` (`:119,121`), decisions `composerState.ts:146-163`. Attach/mic remain §2.7 **stubs**: `ShellComposer.tsx:70,106` → `HostChatSurface.tsx:159-160`, toasts from the `notice` block `en.ts:1248` (`shell.notice.attach` / `shell.notice.mic`). Templates ✦ entry `ComposerToolbar.tsx:114` (row 13). **Still absent:** mic's three voice states, voice/PDF busy rules. |
| 8 | One `canSend` boolean | **IMPLEMENTED** (one input restored) | `composerState.ts:159`, consumed `composerView.ts:70` (`canSend && draft.trim() && !translating`) — the `translating` input restores the controller's translate hold (`Chat:3605`), dimming `ShellComposer.tsx:119-121`. Remaining caveat: the attachments/voice/pdf inputs left with systems this host does not mount. |
| 9 | Streaming caret after last segment | **IMPLEMENTED** | Predicate `src/ui/shell/caretSpec.ts:40-46` (old `Chat:5484`), draw `StreamCaret.tsx:21+`, plain-text-while-streaming `TranscriptTurns.tsx:190-200` (controller rule `Chat:5486-5490`), mapper `messageMapper.ts:114`; tests `caretSpec.test.ts`, `messageStop.test.ts:38-60`. |
| 10 | Stop: abort, 3 s watchdog, interrupted marker, empty drop, thermal note, failure row | **IMPLEMENTED** | Watchdog `src/host/sendStop.ts:41-95` (timer `:54`, retire-first `:60`, drop-empty/mark `:63-79`, unlock-own `:83-95`, regen lock `:89`); outcomes via `runSendStream` → finalize `sendHost.ts:293-310`; marker drawn as §2.8 stop line: `mapStop` `messageMapper.ts:87-101`, render `TranscriptTurns.tsx:280-288`; `stopOutcome` `composerState.ts:213` mounted + tested (`stopOutcome.test.ts`, `messageStop.test.ts:62-138`); thermal hold line via `composerPhase.ts:34-49`. `stoppedEmpty` unreachable by construction (`messageMapper.ts` mapStop comment). |
| 11 | Send path: fit gate → claim → stream → turn-end save | **DIFFERENT** | Claim `sendHost.ts:123`, `beginRun` `:129`, content gate `:137-156`, arms capture `:163-170`, append `:172-184`, engine half `src/host/engineTurn.ts:53-332`, turn-end `sendFinalize.ts:55-176`. **How different (reported `sendHost.ts:8-16`):** no chat-side pre-send fit gate (load path runs it, `engineLoad.ts:76`); no bench-command branch (old `Chat:2317-2330`); no doc-hint composition; classification `sendStream.ts:90+` (tested). **New and present:** the translate guard refuses a send (`sendHost.ts:117`, old `Chat:2233`). |
| 12 | Empty state: art, greeting, welcome, 4 suggestions | **DIFFERENT** (two evidence halves changed) | Gate `welcomeCopy.ts:41-43` applied `HostChatSurface.tsx:135-136`; block `src/host/welcomeBlock.tsx:39-181` (raster `:39`, greeting `:59`, four cards `:131-181` each SENDING `:155`); copy `welcomeCopy.ts:23-43`; inside the transcript's scroll `Transcript.tsx:238-239`; tests `welcomeBlock.test.ts`, `welcomeCopy.test.ts`. **How different:** (a) **the second hue is still lost** — `compute` resolves to the neutral tile (`welcomeBlock.tsx:145-147`, reported `welcomeCopy.ts:17-19`, single accent `design.ts:38-42`, old two-tone `Chat:429,451`); (b) **behaviour now BETTER than the controller**: a card/regenerate send no longer clears the words you typed (`sendDraft.ts` — the controller cleared on every send, `Chat:2523`, pinned `sendDraft.test.ts:61,69`); (c) greeting name suffix — not a loss: `App:7014` passes `userName={null}` (old `Chat:4078-4080` dead). Cards' tap-through-keyboard fixed (`Transcript.tsx:233`). |
| 13 | Quick templates sheet | **IMPLEMENTED** | Sheet CALLED `HostChatSurface.tsx:199-208` (entry `ComposerToolbar.tsx:114`, state `:110` area), choose → fill **then focus** `:204-206` (old `Chat:3636-3641` complete); tests `composerToolbar.test.ts`, `keyboardFocus.test.ts:46-55`. |
| 14 | Research / library-doc / notes chips + auto-clear | **DIFFERENT** (one residue resolved, one remains) | Research + notes armed: `composerArms.ts:19-90` (draft-empty rule `:19-21`, options `:28-36`), capture-and-clear `sendHost.ts:163-170`, clear on conversation `HostRoot.tsx:81-85`, chips `ComposerToolbar.tsx:136,149` gated while face≠send (`HostChatSurface.tsx:120-127`), tests `composerArms.test.ts`. **Resolved:** truncated-notes notice now wired — `sendHost.ts:256-257` hands the engine `onNotice: () => showNoticeKey("chat.notesContextTruncated")` (key `en.ts:586`, firing only on truncation, pinned `notesNotice.test.ts:23-60`); it rides the ONE-slot notice, not the controller's voice-note toast. **How different:** the **library-document chip is gone from the row** (`ComposerToolbar.tsx:10-13` — a §2.7 stub could not fit or work); the attach button keeps `shell.notice.attach` (`HostChatSurface.tsx:159`, pinned `messageActions.test.ts:300`). |
| 15 | Long-press (350 ms) message menu: copy, save-to-notes, translate, edit, regenerate, cancel | **IMPLEMENTED** — **CHANGED since f01a7f4 (was DIFFERENT)** | All five + cancel, in the controller's order: `messageMenuRows.ts:45-63` (gates `sheetCopyVisible` `src/screens/sheetCopyVisible.ts:8`, `canRegen` `src/screens/regenTarget.ts:23` — controller files CALLED), union `MessageMenu.tsx:35`, opener `messageActions.ts:181-204` (refs-only trap + the translate gate `:117` of `onMessageLongPress`'s guards), sheet `MessageMenu.tsx:74-170` (swallow `:144`, backdrop, Android back), mounted `HostChatSurface.tsx:187-195`. Every row has an implementation. **Noted difference:** the caption/hint is this build's honest line naming all five actions (`messageMenuRows.ts:74-76`, `en.ts:544`) where the controller's `a11yLongPress` (`en.ts:537`) omitted edit and regenerate. Tests: `messageMenu.test.ts` (12), `messageActions.test.ts` (34). |
| 16 | Inline chips under a message: copy, read-aloud/stop, "more"; copied flash | **DIFFERENT** (claimed move not confirmed — read-aloud landed, "more" still not drawn) | Copy chip `src/ui/shell/TranscriptChips.tsx:41-91` (+400 ms flash `copiedFlash.ts:8`, copy through `copyText.ts:14`, flash only when the clipboard took it); read-aloud/stop chip `TranscriptChips.tsx:93-115` (labels `voice.readAloud`/`voice.stopReading` `:107`, old `Chat:5601-5616`); rendered under capsule `TranscriptTurns.tsx:83-86`, under answer `:214-227`. **How different:** the **"more" chip is not drawn** (old `Chat:5593-5624`) — its only action (open this menu) is reachable by the 350 ms hold the controller also shipped; reported at `TranscriptChips.tsx:1-16`. |
| 17 | Edit-then-resend modal | **IMPLEMENTED** — **CHANGED since f01a7f4 (was MISSING)** | Modal `src/ui/shell/EditMessageModal.tsx:30+`, mounted `HostChatSurface.tsx:211-218`; state + controller busy guard `useEditMessage.ts:48-97` (old `Chat:3343-3347`, `chat.editEmpty`/`chat.regenBusy` notices, modal stays open on refused save); truncate half plan `regenPlan.ts:66-80` and the ONE shared handoff `truncateAndResend.ts:44-80`. Tests `editFlow.test.ts:68-166` (truncate rules, identity, refusals-before-truncate, both callers enter `truncateAndResend`). Old `Chat:4500-4581, 3329-3465`. |
| 18 | Translate a message → block, expand/close, abort, orphan cleanup | **IMPLEMENTED** — **CHANGED since f01a7f4 (was MISSING)** | Run `useTranslateMessage.ts:63-190`: run-id fence, conversation-switch/unmount aborts `:130-158`, orphan cleanup `:160-170` (old `Chat:3533-3582, 1875-1905, 1951-1957`); sync engine guard `translateState.ts:13` read by opener AND send (`sendHost.ts:117`, old `Chat:2233, 3495`); block `src/ui/shell/TranslationBlock.tsx:38+` mounted under the message `TranscriptTurns.tsx:102-107,230-236`, view routed per-message `Transcript.tsx:43-47,283,307`. **Hash contract:** result is volatile state, never a `Message` field — absent in BOTH apps (header `useTranslateMessage.ts:8-11`). Tests `translateFlow.test.ts` (12). |
| 19 | Read aloud / stop reading | **IMPLEMENTED** — **CHANGED since f01a7f4 (was MISSING)** | `useReadAloud.ts:38-112`: speak/stop toggle, TTS-off answers with `voice.ttsDisabled` (`en.ts:333`) before any engine call, conversation-switch + unmount cleanup (old `Chat:1613-1660, 1903-1905, 1419`); chip `TranscriptChips.tsx:93-115`, rendered `TranscriptTurns.tsx:219-227`, handler passed `HostChatSurface.tsx:180` → `Transcript.tsx:300`. Tests `readAloud.test.ts:63-164` (import graphs, 48 dp box, cleanup, guard samples). |
| 20 | Save message to notes + confirmation notice | **IMPLEMENTED** | `messageActions.ts:206-214`: `saveNote` + notices `notes.saved`/`notes.errorSave` (`en.ts:1076,1079`, old `App:3749-3763`), menu row `messageMenuRows.ts:54`; keys resolve in both catalogues (`messageActions.test.ts` catalogue test). |
| 21 | Regenerate from a target turn | **IMPLEMENTED** (claimed move not confirmed — was already IMPLEMENTED; evidence is now the shared handoff) | Checks + plan `messageActions.ts:222-243` (`regenBusy`/`regenFailed` notices), plan `regenPlan.ts:31-53` (controller rule `Chat:3411-3421`), then ONE synchronous block `truncateAndResend.ts:44-80` — lock `:55`, truncate `:56-58`, `send()`'s claim `:59`, `armDeclaredShrink(base)` `:68` (guard `src/chat/historyWriteGuard.ts:88`, guard tests `historyWriteGuard.test.ts:132,143,377,391`), rollback `:61-69`. **Release on every path:** `sendHost.releaseOwned` `sendHost.ts:92-102` (clears `regenInFlightRef` for the owning token), stop watchdog `sendStop.ts:89`, conversation change `useHostEffects.ts:126`. Pinned: `messageActions.test.ts:169`, `messageMenu.test.ts` truncate rules + identity. |
| 22 | Source chips under an answer | **IMPLEMENTED** | Mapper `messageMapper.ts:128`, policy `sourceLinkPolicy.ts:154`, render `TranscriptEvidence.tsx:130-163`, tests `sourceChipBox.test.ts`, `sourceLinkPolicy.test.ts`, `transcriptNoFetch.test.ts`. Representation still index+host (old `PROVIDER_COLORS` `Chat:5213-5225` unused). |
| 23 | Tool rows (volatile) | **IMPLEMENTED** | Capture `sendCallbacks.ts:92-99` (decoder `messageMapper.ts:155`), map `HostRoot.tsx:116-121`, cleared per conversation (`HostRoot.tsx:81-85,123`), render `TranscriptTurns.tsx:186`, labels `toolLabels.ts:61`. |
| 24 | Thinking status chip + status history | **IMPLEMENTED** (different representation) | Cloud `messageMapper.ts:61-74` → `TranscriptTurns.tsx:175-185`; status written `sendCallbacks.ts:78-85`, volatile on restore (`historyMessages.ts:7`). |
| 25 | Error rows: engine reason, content filter, interrupted | **IMPLEMENTED** | Engine reason verbatim `engineTurn.ts:118`, `engineTurnStream.ts:269`, captured `sendCallbacks.ts:72-77` → finalize `sendFinalize.ts:94-95` → persists `historyMessages.ts:79-87` → danger stop line `messageMapper.ts:87-101` + `TranscriptTurns.tsx:280-288`; content filter `contentFilterCopy.ts:14` (call in `sendHost.ts:137-156`); interrupted = row 10's line. Tests `messageStop.test.ts:73-138`. |
| 26 | CTA buttons on answers | **IMPLEMENTED** — **CHANGED since f01a7f4 (was MISSING)** | Rendered as **static chips** — after sources, before the stop line: `TranscriptTurns.tsx:251-265` (`transcript.ctas.<id>` `:256`), mapped `messageMapper.ts:130-137`, captured `sendCallbacks.ts:92-118`, persisted `historyMessages.ts:197-214`. **No press — and that is parity:** the controller's press was a no-op (`App:7047`), pinned as "text, not button" `ctaChips.test.ts:40-55`. |
| 27 | Day divider | **IMPLEMENTED** | Rule `transcriptLayout.ts:124-132` (floor `:46`), render `Transcript.tsx:246-273`, tested `transcriptLayout.test.ts`. |
| 28 | Mini-app card inside a message | **IMPLEMENTED** — **CHANGED since f01a7f4 (was MISSING)** | `MiniappCard.tsx:120-165`, render `TranscriptTurns.tsx:243-250`, mapper `messageMapper.ts:120`, restore + text migration `historyMessages.ts:130-145` (old `Chat:731-734`), tests `miniappHistory.test.ts` (mapper section + user turns never carry a card). Old `Chat:6033-6093`. |
| 29 | Mic: listen → transcribe → prefill | **STUBBED** | Chrome `ShellComposer.tsx:106-113`; toast **`shell.notice.mic`** (`HostChatSurface.tsx:160`, copy `en.ts:1248` block). No voice pipeline (0 hits for `voiceRunId`). Old `Chat:1515-1611`. |
| 30 | Voice status row + voice-note toast | **MISSING** — consequence reduced | No voice UI and no second toast (old `Chat:1329-1338, 4299-4314`); the notes-truncation line the controller shipped to that toast now rides the one-slot notice (row 14) — pinned `notesNotice.test.ts:60`. |
| 31 | Whisper download, TTS toggle, voice-ready gate | **STUBBED** (mixed) | Presence scan `usePipelineScans.ts:170`, TTS toggle real (`:80`, passed `:243` → `HostOverlays.tsx:196`), download held → toast **`shell.notice.voiceDownload`** (`HostOverlays.tsx:195`). Old `App:5155-5295`. |
| 32 | Voice cleanup on unmount/conversation change | **MISSING** (capture system absent) | No voice capture to clean (old `Chat:1412-1426`); the read-aloud chip has its own equivalent cleanup (`useReadAloud.ts:99-111`). |
| 33 | Top-bar model chip: name · quant · status + tap semantics | **DIFFERENT** | Pill `Shell.tsx:183-215` (name + "On this phone"; logo mark gone, `Shell.tsx:189`). Tap `HostChatSurface.tsx:103-114`: hung → inert, missing/download → toast **`shell.notice.download`** `:107`, busy/resident → no-op, else `userReloadModel`. **How different:** no quant/status/%/downloading (old `App:6873-6911, 6746-6788, 6720`); missing→download is a toast; strip is three buttons + pill (`shellGeometry.ts:186-192`). |
| 34 | Download progress bar, %, notifications | **MISSING** | `downloadPercent: null` (`HostOverlays.tsx:175,190,200`); no `startDownload`/`notifyDownload`. Old `App:6971-6985, 2625-2712`. |
| 35 | Error + hint lines under the bar | **DIFFERENT** | Hint builder Settings-only (`HostOverlays.tsx:140-152`, passed `:177`); the strip has no error row (`Shell.tsx:167-257` = menu/pill/web/new-chat). Composer shows `unloaded` (`composerPhase.ts:34-49` → hold line). Old `App:6987-7008`. |
| 36 | Advisory battery ETA line | **MISSING** | 0 hits in `src/host/**`. Old `App:2758-2830, 6921`. |
| 37 | Web on/off switch (row 5 dup) | **DIFFERENT** | Same as row 5: `Shell.tsx:216-247`, `toolFlags.ts:88-96`, three-button strip. |
| 38 | Memory banner (set-only, never rendered) | **MISSING** (deliberate, reported) | `memoryHost.ts:5`; old declaration `App:3021` only. Owner decision carried by PARITY (D1:38 / D2:18). |
| 39 | Notice toast (single slot, 4 s, bottom 96) | **IMPLEMENTED** (+ new consumers) | `useNotice.ts:19-27` (4 s `:22`; text slot `showNotice` `:19` added for string-speakers), render `HostNotice.tsx:16-36` (`bottom: 96` `:22`) mounted `HostFurniture.tsx:95`. Now also serves the notes-truncation key (`sendHost.ts:257`) and the mini-app action feedback strings (`HostFurniture.tsx:39,69` → `HostMiniappSheet.tsx:103-107`). Keys `en.ts:1248` block. |
| 40 | Voice-note toast (separate system) | **MISSING** — consequence resolved | The controller's second toast system is still absent (old `Chat:1329-1338`), but its load-bearing passenger — truncated notes context — now informs through the one-slot notice (row 14; `notesNotice.test.ts:60` pins the controller shipped this exact line to its voice-note toast). |
| 41 | Share-in: text prefill, files, notices | **IMPLEMENTED** — **CHANGED since f01a7f4 (was MISSING)** | `useShareIn.ts:48-118` mounted `HostRoot.tsx:129` (`Linking` listener + `getInitialURL`); four load-bearing behaviours: **consume-once** `shareIn.ts:51-70` (record at claim, old `App:3561`), **hold-until-ready** `:76-81` + flush `useShareIn.ts:103-110` (old `App:3562,3661-3671`), **nonce re-merge** `shareIn.ts:85-93` + merge effect `useShareIn.ts:112-118` (old `Chat:1959-1969`), **notices** for busy/too-large/failed `shareImport.ts:47-101` (keys `en.ts:750-756`); parser CALLED (`shareIntent.ts`). Tests: `shareIn.test.ts:29` (same URL twice → once), `:106` (merge keeps draft), `:110` (twice lands twice), `shareImport.test.ts` (10). **ADAPTATION, reported:** a shared PDF lands in Documents and says `errors.shareImportNotAttached` (`shareImport.ts:26-31`, `en.ts:756`) — the controller attached it to the composer (`App:3616-3621` → `Chat:3717-3722`), which this build's attachment flow (row 43) cannot do. Old `App:3553-3671`. |
| 42 | History-guard Alerts | **IMPLEMENTED** | `useHistoryHost.ts:170-238`: begin `:170`, settle `:194`, throw-guard `:177`, preservation-failed `:204`, unreadable `:215`, partial-count `:225`, lossy flush `:233`. |
| 43 | Attach / context chip rows | **MISSING** (shape only) | `attachment` hard-wired `null` (`composerView.ts:64`); no `attachedItems`; the toolbar's document chip is gone (row 14) and share-PDF cannot attach (row 41 adaptation) — all one hole. Old `Chat:4222-4247, 1249-1252`. |
| 44 | Stick-to-bottom + auto-scroll | **IMPLEMENTED** (mechanism, tested) | Machine `transcriptScroll.ts:100+` with `messageCount`/`placedBefore`; view reports only (`Transcript.tsx:157` first-placement animation, `:211` placed ref, `:238` empty vs messages, jump pill `:326`); welcome places at offset 0 and no resize moves it. Tests `transcriptScroll.test.ts`, `transcriptRelayout.test.ts`, `transcriptJumpPill.test.ts`. |
| 45 | Keyboard dismissal on dismissible surfaces | **IMPLEMENTED** — **CHANGED since f01a7f4 (was DIFFERENT)** | All five old dismiss sites: four static items `conversationActions.ts:268,280,291,302` + persona row `HostDrawer.tsx:91` (order pinned `keyboardFocus.test.ts:27-44`; old `App:7104`), plus the new export row `HostDrawer.tsx:69`. `keyboardShouldPersistTaps="handled"` on the transcript `Transcript.tsx:233` (old `Chat:4025,4146`; pinned `messageActions.test.ts:106-110`, which also forbids `"never"`). |
| 46 | Focus: after template choice, tap-to-focus | **IMPLEMENTED** — **CHANGED since f01a7f4 (was MISSING)** | Both controller focus sites: template fill-then-focus `HostChatSurface.tsx:204-206` and input-area tap `ShellComposer.tsx:83-91` (controller `Chat:4330` — its comment "Input-area only" is the row's real second site; the controller has exactly two, pinned `keyboardFocus.test.ts:73-76`). Handle threaded `HostChatSurface.tsx:84` → `Shell.tsx:91,129,305` → `ShellComposer.tsx:39,57,91`. |
| 47 | Long-press delay 350 ms + a11y hint on messages | **IMPLEMENTED** | `delayLongPress={350}` + `accessibilityHint` on pressables with ONLY `onLongPress`: `TranscriptTurns.tsx:43-47` (controller shape `Chat:5332-5334,5395-5398`), label from the message `:34-41`, both boxes `:52+` (capsule) and `:120+` (answer text), wired `Transcript.tsx:279,295`; hint `en.ts:544`; tests `messageActions.test.ts:84,98`. |
| 48 | Haptics | **NOTHING TO PRESERVE** | Old grep empty; new grep `haptic\|vibrat` = 0. Parity holds. |
| 49 | Swipe-to-delete | **NOTHING TO PRESERVE** | New grep `swipe` = 0; delete is drawer long-press (`conversationActions.ts:258`). Matches old. |
| 50 | Keyboard-debug badge (dev) | **MISSING** | 0 hits. Old `Chat:865-904, 4668-4691`. Dev-only; keep/drop open (PARITY carries it). |

**Tally:** IMPLEMENTED 28 (1, 3, 4, 6, 8, 9, 10, 13, 15, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 39, 41, 42, 44, 45, 46, 47) · DIFFERENT 10 (2, 5, 7, 11, 12, 14, 16, 33, 35, 37) · STUBBED 2 (29, 31) · MISSING 8 (30, 32, 34, 36, 38, 40, 43, 50) · nothing-to-preserve 2 (48, 49). 28 + 10 + 2 + 8 + 2 = 50.
**Verdicts moved since f01a7f4:** 1, 3, 4, 6, 15, 17, 18, 19, 26, 41, 45, 46 (→ IMPLEMENTED). Evidence-only: 12, 14, 16, 21, 40, 43. Unchanged: all others.

---

## Table 2 — Deliverable 2: the 21 state/plumbing rows

| # | Row | Verdict (new location) | Does the named check exist against the new code? |
|---|---|---|---|
| 1 | Epoch trio | **REPRODUCED** — checks before build and before write `historyWrite.ts:79,85`; load bump `useHistoryHost.ts:142` (re-checks `:164,197`); delete bump injected `HostRoot.tsx:109` → called `conversationActions.ts:212`; switch flush-before-bump `conversationActions.ts:88`. `flushThenBump` (`historyWrite.ts:94-102`) still **no production caller** (Section 4.3). | **Yes, replaced.** `historyWrite.test.ts:78,91,107,119,131` (file untouched). Grep → **`epoch !== stamped` = 2, both `historyWrite.ts:79,85`**. |
| 2 | Hash symmetry (7 old callers; 3 raw) | **REPRODUCED at 5 sites** — `useHistoryFlushes.ts:119-126` (AppState, persistable), `sendFinalize.ts:156-162` (turn-end, persistable), `modelSwitch.ts:148-153` (raw), `conversationActions.ts:97-103` + `:157-163` (raw ×2). Raw readers still exactly 3 (old `App:2391,2453,4536`). **Lost:** old `Chat:2161` (background-discard hash — lifecycle unmounted); old's two turn-end saves folded into one finalize. | Frozen-hash test exists: `sessionPersistence.test.ts:179` (file untouched). No `src/host/**` caller hashes a live `Message[]` (persistable via `historyMessages.ts:36-41`, raw via `readBootMessages`). No new-side hash test. |
| 3 | `updateMessage` guards (9 sites) | **REPRODUCED** as the fence — **28** non-test `fence.*` sites: `sendCallbacks.ts` 12, `sendHost.ts` 8, `sendFinalize.ts` 3, `sendStop.ts` 3, `useHostEffects.ts` 2. The regenerate/edit truncate is deliberately NOT a fence site: `truncateAndResend.ts:55-68` is one synchronous claim-fenced block (pinned `messageActions.test.ts:169`, `editFlow.test.ts:129`). `updateMessage` absent from `src/host/**`. | **Replaced.** `turnGuards.test.ts:4-55` + the two ordering pins above. |
| 4 | Run-id + generation lifecycle | **REPRODUCED** — `beginRun` `sendHost.ts:129`; `invalidate` `useHostEffects.ts:79,109`; `retire` `sendStop.ts:60`; regen locks now genuinely held + released (row 21: `sendHost.ts:92-102`, `sendStop.ts:89`, `useHostEffects.ts:126`). | Partly. Retire test `turnGuards.test.ts:61-70`; **named watchdog test ("abort never settles → 3 s unlocks only its own run") still absent** (no fake-timer test in `src/host/**`). Old greps (`regenGenerationRef.current +=`, `++sendRunIdRef`) → 0 in `src/host/**`. Replacement counts: `beginRun` 1, `invalidate` 2, `retire` 1. |
| 5 | Abort path (7 old sites) | **REPRODUCED (3 of 7 + new)** — send-path `abortRef`: stop `sendStop.ts:44` (direct on captured controller), conversation change `useHostEffects.ts:76`, unmount `useHostEffects.ts:107`. The translate job has its own controller with 3 abort sites (`useTranslateMessage.ts:126,143,156`; controller equivalent `translateAbortRef.current?.abort()` = 4 old sites — the fourth was clearChat's). Edit no longer aborts a live send — it refuses via the busy guard (`useEditMessage.ts:70-80`, old `Chat:3359`). Not reproduced: background (`Chat:2103,2134`), clearChat (`Chat:3230`). Flush-before-abort ordering note stands (`conversationActions.ts:88` → `useHostEffects.ts:76`). | Replaced: send-path grep = **2 + `sendStop.ts:44`**; translate grep = **3** (new). Identity property covered by `turnGuards.test.ts:4-28`. |
| 6 | Stop watchdog (3 s) | **REPRODUCED** — `sendStop.ts:41-95` (timer `:54`, retire-first `:60`, token match, mark, persist-in-updater, unlock-own-only); drop-on-clear = `fence.invalidate()` + watchdog clear `useHostEffects.ts:79-92,109-115`. | **No** named watchdog test. Grep `stopWatchdogRef` → `sendStop.ts:21,54`, `useHostEffects.ts:28,86-92,111-115`, `HostRoot.tsx:166`. |
| 7 | History load + guard | **REPRODUCED** — `useHistoryHost.ts:142-238` (bump `:142`, key `:145-151` area, begin `:170`, re-checks `:164,197`, settle `:194`, alerts `:177,204,215,225`, lossy flush `:233`, readable-first `:188-194`). | Partly: `sessionPersistence.test.ts:224` exists; **named corrupt-raw/quarantine test still absent** against the host load path. Adjacent new coverage: declared-shrink writes (`historyWriteGuard.test.ts:132,143,377,391`). |
| 8 | Four save FIFOs | **REPRODUCED (3 of 4 + engine untouched)** — index `.then(run, run)` `useConversationHost.ts:76-77`, library `libraryHost.ts:90`, turn-end `settleHold` + 10 s fallback `sendFinalize.ts:135-146` (`:35`,`:143`); engine FIFO untouched (`LlamaService.ts:1033`). `turnEndSavePromiseRef`/`sendInFlightPromiseRef` not lifted (`sendFinalize.ts` header). | Test **no**. Grep `.then(run, run)` → **5 repo-wide** (`useConversationHost.ts:77`, `libraryHost.ts:90`, `App:1066,1248`, `src/notes/NotesStore.ts:189`). |
| 9 | Epoch-stamped in-flight turn persistence | **REPRODUCED** — debounce `useHistoryFlushes.ts:53-61` (stamp `:56`), 10 s throttle `:65-84` (stamp `:82`), AppState `:86-127` (stamp `:90`, landing-keyed `saveEngineSession` `:119-127`), unmount flush-before-abort `useHostEffects.ts:104-116`, turn-end `sendFinalize.ts:124-166`. NEW: the truncate writes immediately under a declared shrink (rows 17/21). | Named tests still don't exist as such; drop logic covered `historyWrite.test.ts:78-105`. `getEpoch` shim `HostRoot.tsx:143` area. |
| 10 | Engine lifecycle | **REPRODUCED for load+boot; NOT REPRODUCED for the background machine.** Load `engineEnsure.ts:36+`, `engineEnsureLoad.ts:64+`, gate `engineLoad.ts:76+`; boot `usePipelineScans.ts:93-97` (saved id + `pickStartModel`), unmount dispose `:146`; thermal hook `turnRefs.ts:57`. **Still not lifted:** background/foreground discard (`App:3026-3526`) and thermal edge effect (`App:3672-3748`) — greps 0. | Replaced. `ensureEngineForModelRef.current =` → **2**: `useModelHost.ts:195` + `App:4446` (the old `engineEnsure.ts` comment was removed in the diet). Named fit/foreground test **still absent**. |
| 11 | `handleSendStream` + one bridge | **REPRODUCED**, same seams: `engineTurn.ts:53+` (failure-reason hook `:118`), `engineTurnWindow.ts:36`, `engineTurnCompactor.ts:44`, `engineTurnSlide.ts:34`, `engineTurnMemory.ts:39`, `engineTurnStream.ts:36` (single `streamAssistantTurn` + bridge `:224`). Regenerate and edit enter this path through `send()` — one bridge per send, always. | **Yes:** `engineCallbackBridge.test.ts` exists; grep **`bridgeEngineCallbacks(` = 2 call sites**: `App:6630` + `engineTurnStream.ts:224` (+ def `engineCallbackBridge.ts:41`, test `:31`). |
| 12 | Model index storage | **REPRODUCED** — key `modelSwitch.ts:41`, write `:117`, boot read `usePipelineScans.ts:93`, `modelIndexRef`/fallback in `useModelHost.ts`, hash re-save `modelSwitch.ts:148-160`. | Replaced. Grep `MODEL_STORAGE_KEY` → **7 matches / 3 files** (was 8/4 — `useModelHost` dropped its import): `App:405,2948,4501`; `modelSwitch.ts:41,117`; `usePipelineScans.ts:34,93`. Per app: 1 read + 1 write. |
| 13 | Conversation index store | **REPRODUCED** — `useConversationHost.ts:67-144` (boot hash after index load `:119,130`), switch `conversationActions.ts:81-115` (flush `:88`, UI-first `:93`, save old stem `:94-105`, bind `:107`, restore `:110`), delete `:176-217` (reset `:182`, index first `:188`, quarantine `:192`, invalidate `:210`, bump `:212`, bind `:213`), touched `:231`. | Partly: named switch-flush test **still absent**; delete-order tests exist (`conversations.test.ts:84-100`, `historyWrite.test.ts:107-141`). `bumpPersistEpoch` passed `HostRoot.tsx:109`, called once `conversationActions.ts:212` (old `App:2506`). |
| 14 | Tool-flag persistence + refs | **REPRODUCED + toggle restored** — mirror `toolFlags.ts:39-62`, refresh `:64-86`, `toggleWebTools` `:88-96` (key write `:92`), refs read mid-run `agentTurnOptions.ts:207,218,225`, wiring `HostChatSurface.tsx:162-163`. | Replaced + tested: `staticPrefixNotify.ts:10` factory, tests `staticPrefixNotify.test.ts` + `toolFlags.test.ts`; toggle flips → `useHostEffects.ts:59-65` deps change → notify-on-change, never on mount. |
| 15 | Voice state | **NOT REPRODUCED** (beyond scan + TTS toggle). Read-aloud is new capability on the same TTS service (row 19), not the capture pipeline. | `voiceRunIdRef` → old file only; 0 in `src/host/**`. |
| 16 | Share-in | **REPRODUCED** — **CHANGED (check now exists)**: `useShareIn.ts:48-118` mounted `HostRoot.tsx:129`; gate `shareIn.ts:51-93`; file half `shareImport.ts:47-101`. | **Yes — the named checks exist:** "same URL twice → one apply" `shareIn.test.ts:29`; "merge keeps existing draft" `:106`; "same passage twice lands twice" `:110`; nonce `:95`; hold/flush `:51,74`; file notices `shareImport.test.ts:57-165`. Parser still CALLED (`shareIntent.ts` untouched). |
| 17 | Notices — not a queue | **REPRODUCED** — `useNotice.ts:19-27` (one slot + 4 s; text slot `showNotice` for string-speakers), render `HostNotice.tsx:16-36` (`HostFurniture.tsx:95`). New key consumers ride the same slot (rows 14, 39). | Grep `setNotice(` → **2, both `useNotice.ts:20,22`**; old `App:3548,3550`. No queue. |
| 18 | Memory banner (set-only) | **NOT REPRODUCED — by decision, reported** (`memoryHost.ts:5`). | Old grep still true (`App:3021` only). |
| 19 | Compactor/digest per-chat maps | **REPRODUCED** — `turnCorpus.ts:45` (`MAX_DIGEST_CORPUS_MESSAGES`), reset `:179`, hygiene/sync in-file, reset on delete `conversationActions.ts:182`, KV load `engineTurnCompactor.ts:44+`. | Grep `resetCompactorChat(` → **8 repo-wide, 3 calls per app**: new def `turnCorpus.ts:179` + `engineTurn.ts:276`, `engineTurnCompactor.ts:109`, `conversationActions.ts:182`; old def `App:769` + `:2476,5776,6048`. |
| 20 | Notes-context injection | **REPRODUCED, REACHABLE, and the notice is wired (CHANGED — trigger AND consumer now exist)** — cap `notesContext.ts:8` (24 000), injection `engineTurn.ts:247-256`, options `sendHost.ts:256-257` (`onNotice → chat.notesContextTruncated`, `en.ts:586`), fired only on truncation (`engineTurn.ts:254`), served by the one-slot notice. | Grep `loadNotesContext(` → **4 repo-wide, 2 per app** (`App:416,5749`; `notesContext.ts:10`, `engineTurn.ts:249`); new tests `composerArms.test.ts` + `notesNotice.test.ts:21-60` (key exists, fires once, controller ships the same line). |
| 21 | Static-prefix skip-once | **REPRODUCED + TESTED** — `staticPrefixNotify.ts:10`, wired `useHostEffects.ts:59-65`, test `staticPrefixNotify.test.ts`. The strip toggle exercises the change path. | Yes. |

### Greps whose meaning changed (verified counts at `69ac2d4`)

| Grep (old meaning) | New reality |
|---|---|
| `bridgeEngineCallbacks(` = 1 | **2 call sites**: `App:6630`, `engineTurnStream.ts:224` (+ def `engineCallbackBridge.ts:41`, test `:31`) |
| `ensureEngineForModelRef.current =` = 1 | **2**: `App:4446`, `useModelHost.ts:195` (comment in `engineEnsure.ts` removed by the diet) |
| `MODEL_STORAGE_KEY` = 2 sites | **7 matches / 3 files**: `App:405,2948,4501`; `modelSwitch.ts:41,117`; `usePipelineScans.ts:34,93` |
| `getEpoch() !== opts.epoch` (`Chat:619,629`) | `epoch !== stamped` — **2, both `historyWrite.ts:79,85`** |
| `updateMessage(` / `regenGenerationRef.current +=` / `++sendRunIdRef` | **0 in `src/host/**`** — fence: **28** `fence.*` sites (`sendCallbacks.ts` 12, `sendHost.ts` 8, `sendFinalize.ts` 3, `sendStop.ts` 3, `useHostEffects.ts` 2); the truncate at `truncateAndResend.ts:55-68` is claim-fenced instead |
| `abortRef.current?.abort()` = 7 | send path: **2** (`useHostEffects.ts:76,107`) + `sendStop.ts:44`; translate job (was `translateAbortRef…`): **3** (`useTranslateMessage.ts:126,143,156`) |
| `armDeclaredShrink(` (controller `Chat:3434`) | new: def `historyWriteGuard.ts:88`, **one production caller** `truncateAndResend.ts:68` (shared by edit + regenerate), guard tests `historyWriteGuard.test.ts:132,143,377,391` |
| `.then(run, run)` | **5 repo-wide**: `useConversationHost.ts:77`, `libraryHost.ts:90`, `App:1066,1248`, `NotesStore.ts:189` |
| `setNotice(` | new app: **2, `useNotice.ts:20,22`**; old `App:3548,3550` |
| `bumpPersistEpochRef.current?.()` = 1 | injected: passed `HostRoot.tsx:109`, called once `conversationActions.ts:212` |
| `resetCompactorChat(` / `loadNotesContext(` | **8** / **4** repo-wide (3 / 2 calls per app) |
| `toggleWebTools` | 2 apps: `App:878,6926`; `toolFlags.ts:88`, `HostChatSurface.tsx:163` |
| `keyboardShouldPersistTaps` (`Chat:4025,4146`) | both apps: old ×2; new `Transcript.tsx:233` (pinned `messageActions.test.ts:106-110`) |
| `delayLongPress` (`Chat:5333,5396,5524`) | both: new `TranscriptTurns.tsx:44` |
| `inputRef.current?.focus()` = 2 (`Chat:3637,4330`) | both: template `HostChatSurface.tsx:205`, input-area `ShellComposer.tsx:85` (pinned `keyboardFocus.test.ts:46-76`) |
| `staticPrefixNotifySkipRef…false`, `voiceRunIdRef`, `memoryBannerKey`, `shouldShowLongChatNudge`, `isBenchCommand` (host) | still old-only (0 in `src/host/**`) |

---

## Table 3 — Gaps still open, ranked by what a user notices first

(Resolved since `f01a7f4` listed after the table.)

| # | Gap | What is lost | Old location | Size to restore | In PARITY already? |
|---|---|---|---|---|---|
| 1 | **Attach/mic with their pipelines** — the last two dead-with-a-toast buttons | Attach sheet, image/PDF/docx import, context chips, attached-document chip, share-PDF auto-attach (row 41's adaptation exists because of this hole); whisper dictation, voice status row, capture cleanup | `Chat:1661-1833, 4222-4247, 1515-1611, 4299-4314, 1412-1426`; `App:5155-5320, 3616-3621` | attachments ~173 + sheet glue; voice ~307 + downloads ~158 | **Carried** — D1 rows 7, 29-32, 43 (stubs toast per §2.7) |
| 2 | **Model bar lost its status life** | Download %, thin progress bar, error+hint lines under the strip, battery ETA — the pill is name+where only | `App:6971-7008, 6746-6788, 2625-2712, 2758-2830` | model-bar ~130 + notify ~88 + battery ~40 | **Carried** — D1 rows 33-36 |
| 3 | **No downloads at all** | Model / Whisper / embedding downloads, progress, notifications, confirm dialog — Settings toasts `shell.notice.download` / `voiceDownload` / `embeddingDownload` (`HostOverlays.tsx:183,195,204`) | `App:4657-5154` (442), `App:5155-5312` (158) | the download pipeline (~600) | **Carried** — D1 rows 31, 34 |
| 4 | **The voice-note toast as its own system** | The transient voice-note strip above the composer (its notes-truncation passenger now rides the one-slot notice — row 40) | `Chat:1329-1338, 4299-4314` | ~40-60 lines (second toast system) | **Carried** — D1 row 40 |
| 5 | **The painted background never mounted** | `PainterlyBg` — the app's background art; the new root renders a flat shell colour. A slice report calls this deliberate; **no note saying so exists in the tree** (grep across `src/** docs/**` finds only this file and `PARITY.md`) | `App:6849`, component `src/theme/components/PainterlyBg.tsx:10` | one mount line — or one written decision | **Not a D1 row** — D3a only (`docs/PARITY.md:160`); **added** (Section 4.1) |
| 6 | **The suggestion cards' second hue** | `compute` tiles resolve to the neutral tile — cards 1 and 4 read flat next to 2 and 3 | `Chat:429,451` | one palette token + `welcomeCopy.ts:23-30` mapping (cosmetic) | **Not a D1 row** — **added in row 12(a)** (Section 4.8) |
| 7 | **The long-chat nudge** | The one-shot warning that a long conversation starts dropping context | `Chat:921-922, 1314-1327` (`src/chat/longChatEstimate.ts:132`) | ~30 lines (state + effect + row) | **Not a D1 row** — D3b names the unit (`docs/PARITY.md:184`); **added** (Section 4.5) |
| 8 | **The 180-second foreground idle dispose** | Engine never idles out — battery/thermal cost on the campaign rig, invisible in the UI | `App:3284,3311,4676,5417`; `src/app/foregroundIdleDispose.ts:4` | one ref assignment + grace wiring, or a written decision | **Not a D1 row** — D2:10 names only the discard machine; **added** (Section 4.4) |
| 9 | **`/bench …` debug commands** | The on-device bench command console (typed commands go to the model as prose) | `Chat:2317-2330`; `src/bench/benchConfig.ts:824,848` | ~15-line branch in `sendHost` (harness impact undetermined — Section 4.6) | **Not a D1 row** — reported `sendHost.ts:9-10`; **added** (Section 4.6) |
| 10 | **The inline "more" chip** | The visible affordance to open the menu under an answer (the 350 ms hold reaches the same menu) | `Chat:5593-5624` | ~15 lines (third chip in `TranscriptChips`) | Covered by **row 16's DIFFERENT verdict**; listed here because it is the row's only remaining delta |
| 11 | **kb-debug badge** (dev-only) | The keyboard-debug overlay behind `kalsa.kbDebug` | `Chat:865-904, 4668-4691` | ~40 lines | **Carried** — D1 row 50 (keep/drop pending) |
| 12 | **Memory banner** — set-only in the old app, dropped by decision | Nothing visible (never rendered) | `App:3021` + setters | owner decision, ~0 | **Carried** — D1:38 / D2:18 |

**Resolved since `f01a7f4`:** row 1 persona dismiss + row 45 (all five sites, prop); row 46
(both focus paths); rows 15 (all five menu rows), 17 (edit modal), 18 (translate), 19
(read-aloud); row 26 (CTAs render); row 41 (share-in); rows 3, 4, 28 (mini-app kind, card,
sheet); row 14's truncation-notice residue; old Table 3 gap 1 (interactions), gap 5 (mini-app),
gap 6 (share-in), gap 8 (CTA), gap 9 (keyboard/focus). **Earlier:** first screen, caret, failed/
interrupted markers, export (relocated), PDF host, research/notes chips, templates, root
ratchet.

---

## Section 4 — behaviour no PARITY row covers (so the new code probably dropped it)

**Current findings:**

1. **The painted background is gone.** Old root renders `<PainterlyBg />` (`App:6849`,
   component `src/theme/components/PainterlyBg.tsx:10`); grep over `src/host/**`,
   `src/ui/shell/**`, `App.tsx`, `docs/**` finds no mount and **no written decision** —
   `437a57d` is reported to have made it deliberate, but the tree does not say so (only this
   file and `PARITY.md:160` mention it). Now Table 3 gap 5 + could-not-determine 8.

2. ~~`PdfTextExtractorHost` never mounted~~ — **RESOLVED**: `HostFurniture.tsx:97` (old
   `App:7257`); was a former Section 4.2 / Table 3 gap 12.

3. **The old strip's "New chat" and the drawer's "New chat" were different behaviors; the new
   strip runs only the drawer's.** Old nav new-chat called `clearChat` (`Chat:3949,:4004` →
   `Chat:3219-3328`: synchronous abort → flush → epoch bump → full wipe → `onNewConversation()`
   `Chat:3318-3322`). New strip (`HostRoot.tsx:221`) + drawer (`HostDrawer.tsx:82`) both call
   `handleNewConversation` (`conversationActions.ts:118-172`): flush `:88` + switch, no
   synchronous multi-system reset (draft/arms/tools cleared later via `HostRoot.tsx:81-85`;
   abort after commit `useHostEffects.ts:76`). D2 row 1's "clear flushes before bump" still has
   **no production caller**: `flushThenBump` (`historyWrite.ts:94`) is exercised only by
   `historyWrite.test.ts:107`.

4. **The 180-second foreground idle dispose never runs.** Old assigns
   `bumpForegroundIdleRef.current` (`App:3311`), bumps at turn/download start
   (`App:4676,5417`), consults `shouldRunForegroundIdleDispose` (`App:3284`;
   `FOREGROUND_IDLE_DISPOSE_MS` `src/app/foregroundIdleDispose.ts:4`). The new host calls the
   ref (`engineTurn.ts:134`) but **nothing assigns it** (`hostDeps.ts:128` — default no-op,
   "(unmounted) idle-dispose system"). PARITY never names it. Now Table 3 gap 8.

5. **The long-chat nudge is gone.** Old `Chat:921-922, 1314-1327` over
   `shouldShowLongChatNudge` (`src/chat/longChatEstimate.ts:132`); new tree 0 hits. Carried
   only as a D3b unit (`docs/PARITY.md:184`). Now Table 3 gap 7.

6. **`/bench …` / `bench:…` debug commands no longer intercept.** Old `Chat:2317-2330` /
   `src/bench/benchConfig.ts:824,848`; `grep isBenchCommand` in `src/host/**` = 0 (reported
   `sendHost.ts:9-10`). PARITY has zero bench rows; harness impact undetermined (could-not-
   determine 1). Now Table 3 gap 9.

7. **Ordering nit (D2 rows 5/13):** new conversation switch/delete flushes **before** it
   aborts the live send (`conversationActions.ts:88` → `useHostEffects.ts:76`), where old
   `clearChat` aborted first (`Chat:3231`). Fence ownership makes it state-safe.

**Findings folded in from earlier slices (each changed a verdict or prevented a false one):**

8. **Palette lost the second hue the old suggestion cards used** → row 12(a), still open:
   `welcomeCopy.ts:17-19`, `design.ts:38-42`, old `Chat:429,451`.
9. **The greeting's name suffix is dead in the controller too** → NOT a gap (row 12(c)):
   `App:7014` passes `userName={null}`.
10. ~~A truncated notes context informs nobody~~ — **RESOLVED** (`437a57d`): wired
    `sendHost.ts:256-257` → one-slot notice; tests `notesNotice.test.ts:21-60`.
11. ~~Suggestion cards inherit the tap-through-keyboard gap~~ — **RESOLVED** (`f01a7f4`):
    `Transcript.tsx:233`.
12. **Restoring the web chip changed the strip contract** → row 5: still open, settled at
    THREE buttons/154 dp pill after export left (`shellGeometry.ts:186-192`,
    `stripWebSwitch.test.ts:2-10`); old 36×22 `hitSlop` chip `App:6926-6959`.
13. **The notes branch is reachable and armed** → D2 row 20 now fully green (notice consumer
    included).
14. **The menu caption is deliberately NOT the controller's**: `chat.a11yMessageActions`
    (`en.ts:544`) names all five actions; the controller's `a11yLongPress` (`en.ts:537`)
    omitted edit and regenerate — reported `messageMenuRows.ts:66-74`, pinned
    `messageActions.test.ts` (old-hint-never-used test).
15. **The inline "more" chip is not drawn** — its action is the 350 ms hold
    (`TranscriptChips.tsx:1-16`). Row 16's verdict; Table 3 gap 10.
16. **Export lives in the drawer, not the header** (strip-budget trade, written down:
    `shellGeometry.ts:186-192`, `HostDrawer.tsx:60-77`). Row 2 stays DIFFERENT.
17. **The pill's logo mark was dropped** (`Shell.tsx:189`, `e8bcc80` in DESIGN.md) — a
    new-shell design item, NOT old parity (the old strip's chip carried no mark).

**New in the `437a57d`–`69ac2d4` slices:**

18. **The draft survives a foreign send — a deliberate IMPROVEMENT over parity.** A card or
    regenerate send clears the field only if the field itself sent the words
    (`sendDraft.ts`, applied `sendHost.ts:155,190`); the controller cleared unconditionally
    (`Chat:2523`) and ate typed words (pinned `sendDraft.test.ts:61,69`). PARITY has no row
    for it; a strict parity-restore would re-introduce the data loss.
19. **Share-PDF import does not attach to the composer** — it lands in Documents and says so
    (`shareImport.ts:26-31`, `en.ts:756`); the controller attached (`App:3616-3621` →
    `Chat:3717-3722`). Reported adaptation; its true cost is row 43's hole.
20. **Edit now refuses where the controller aborted**: a busy save answers `chat.regenBusy`
    (`useEditMessage.ts:70-80`) instead of aborting a live send (`Chat:3359`) — counted in
    D2 row 5's site arithmetic.

---

## Could not determine (and which file decides it)

| # | Question | Deciding file |
|---|---|---|
| 1 | Whether the e2e/campaign harness ever types `/bench` or `bench:` into the composer (would make Section 4.6 harness-critical) | `scripts/ci-e2e.sh`, `scripts/ci-dflash-ab.sh`, any `scripts/campaign/*` sender |
| 2 | Whether the owner wants the old `compute` hue restored for the suggestion cards, or the single-accent palette accepted (row 12(a) is a verdict either way) | `src/theme/design.ts:38-42` + `src/host/welcomeCopy.ts:17-19` |
| 3 | Whether the owner wants `clearChat`'s flush→bump→synchronous-reset order re-expressed as a production caller of `historyWrite.flushThenBump` (`historyWrite.ts:94`), or accepted as flush + load-effect bump | `src/host/conversationActions.ts:118-172` + `src/host/useHistoryHost.ts:142` |
| 4 | Whether idle-dispose (Section 4.4) is scheduled with the background-machine lift or dropped by decision | `src/app/AppShell.tsx:3026-3526` + `src/app/foregroundIdleDispose.ts` |
| 5 | Test results — no jest was executed in this walk (read-only pass); all test claims are existence-only | run `npx jest src/host src/ui/shell` when the machine is free |
| 6 | Minor: PARITY's `keyboardShouldPersistTaps` line refs (`Chat:4029-4030`) are drifted; actual lines `Chat:4025,4146` | `src/screens/AiChatPage.tsx:4025,4146` |
| 7 | Whether an open message menu across a conversation switch behaves as the controller did (the host closes it on send/unmount/backdrop/Android back, `messageActions.ts:149-167`; the controller cleared it in `clearChat` `Chat:3311` — its drawer-switch behavior is not named by PARITY rows) | `src/screens/AiChatPage.tsx:1044-1162` + `src/host/messageActions.ts:149-167` |
| 8 | Where the "PainterlyBg is deliberately not mounted" decision is recorded — the slice's report claims it, the tree does not contain it | `docs/HANDOFF-2026-09-21.md`, `docs/DESIGN.md`, or the `437a57d` report outside the repo |
