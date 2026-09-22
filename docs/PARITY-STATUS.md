# PARITY-STATUS — the answer to `docs/PARITY.md` at commit `f01a7f4`

This file is the row-by-row answer to the specification in `docs/PARITY.md`, verified on
branch `ux-2026-09-21` at commit `f01a7f4`. The previous walk described `e2b3aeb` (committed
as `942a3bf`); rows whose verdict moved say **CHANGED since e2b3aeb (was …)**, and rows whose
evidence moved without the verdict changing say so, so the two files can be read against each
 other. Slices landed since that walk: `8b0c236` (first screen composed + read from the
bottom), `7e1dab8` (pill built around the model's name; re-layout no longer moves the
reader), `e8bcc80` (docs: the logo changed home), `f01a7f4` (message menu, copy chip, the
document chip left the row, `keyboardShouldPersistTaps="handled"`).
Method: read-only walk of `src/host/**`, `src/ui/shell/**`, `App.tsx` against the two
controller files by grep + bounded reads; no test was executed (existence claims only).
The root only composes — `HostChatSurface`, `HostDrawer`, `HostFurniture` — under the
line-budget ratchet `src/host/fileSize.test.ts`.
**Re-walk and regenerate this file after any slice that touches `src/host/**` or
`src/ui/shell/**`** — every verdict below is only true of the tree that produced it.

**Verification of the last slice's own claim list** (rows 7, 12, 14, 15, 16, 20, 21, 45, 47):
actual verdict changes are **15, 16, 20, 21, 47** (each MISSING → new verdict); **7, 12, 14,
45 kept their verdict** and only their evidence moved; **row 2's verdict moved and was NOT on
that list** (export left the header for a drawer tile).

Vocabulary (D1): IMPLEMENTED · STUBBED (held, with the toast key or hold line that says why —
§2.7) · MISSING · DIFFERENT (with the how). Shorthand: `App` = `src/app/AppShell.tsx`,
`Chat` = `src/screens/AiChatPage.tsx`.

---

## Table 1 — Deliverable 1: the 50 feature rows

| # | Feature | Verdict | New location / hold signal (and the how) |
|---|---|---|---|
| 1 | Drawer: list, tap-switch, long-press delete, new-chat, persona row, 180 ms search, keyboard dismiss per row | **DIFFERENT** (evidence updated) | List/tap: `src/host/conversationActions.ts:248-260` (long-press → confirm `:258` → dialog `:221-230`); new-chat `src/host/HostDrawer.tsx:87` → `conversationActions.ts:119-172`; persona row `HostDrawer.tsx:91-97`; debounce `src/host/useConversationHost.ts:23,51-62`; static-item dismiss `conversationActions.ts:269,281,292,303` **plus the new export row** `HostDrawer.tsx:73`. **How different:** the persona row press still has no `Keyboard.dismiss` (old `App:7104`; new `HostDrawer.tsx:93-97`). Conversation rows never dismissed in the old app either (old sites `App:2576,2588,2599,2610`) — that part matches. |
| 2 | Chat header: menu, export/share, new chat | **DIFFERENT** — **CHANGED since e2b3aeb (was IMPLEMENTED — export was on the strip)** | Menu `src/ui/shell/Shell.tsx:180-188` → `HostRoot.tsx:210`; new chat `Shell.tsx:264-271` → `HostRoot.tsx:211`. **How different:** the header no longer carries export — it moved to a **drawer tile** (`HostDrawer.tsx:66-78`: dismiss keyboard → close drawer → same `shareConversation`, wiring `HostRoot.tsx:228`, builder `src/host/shareConversation.ts:21-43`, old `Chat:3206-3218, 4757-4769`) because five 349 dp controls squeezed the model pill to a 14 dp text column (`shellGeometry.ts:278-292`). The action is identical (same markdown, same `Share` sheet, test `shareConversation.test.ts`); its place in the chrome is not. |
| 3 | Eight exclusive overlays | **DIFFERENT** | 7 of 8 kinds: `src/host/hostOverlay.ts:4-15`, mounts `src/host/HostOverlays.tsx:149-263`, assembled by `HostFurniture.tsx:66-92`. **How different:** the `miniapp` kind is deleted, with a written report at `hostOverlay.ts:7-16`. |
| 4 | Mini-app card **and** full-screen sheet | **MISSING** | No miniapp field in `src/ui/shell/transcriptTypes.ts:23-77`, no mapper read (`src/host/messageMapper.ts:106-125`), no overlay kind (`hostOverlay.ts:7-16`), renderer `src/ui/AskAssistantMiniappRenderer.tsx` never mounted. Plumbing survives: persist `src/host/historyMessages.ts:139-148`, capture `src/host/sendCallbacks.ts:130-138`, hook `src/host/turnRefs.ts:63` (never has an opener). Old `Chat:6033-6093`, `App:7214-7252`. |
| 5 | Web switch in the top bar (persisted) | **DIFFERENT** (evidence updated — strip contract changed again) | Switch: render `Shell.tsx:229-261`, flip + persist `src/host/toolFlags.ts:90-99` (key write `:94`), wiring `src/host/HostChatSurface.tsx:150-151`; tests `stripWebSwitch.test.ts`, `toolFlags.test.ts`. **How different:** old chip 36×22 on `hitSlop` (`App:6926-6959`); new is a labelled 48 dp box. Strip contract now: **THREE icon buttons** (menu, web, new chat — export left, row 2), pill back to 154 dp with a text budget `stripPillTextColumn` (`shellGeometry.ts:83,278-293`, pinned `stripWebSwitch.test.ts:7-12`, `stripTextBudget.test.ts`), and the pill's logo mark is gone (new-shell design item, not old parity — recorded `Shell.tsx:197-203`). Persistence + notify-on-change unchanged (D2 rows 14/21). |
| 6 | Composer field, held placeholders (§2.7) | **DIFFERENT** (evidence line shifts only) | Field `src/ui/shell/ShellComposer.tsx:77-87`; hold reason row `Shell.tsx:296-302`; decisions `src/ui/shell/composerState.ts:159-176` fed by `src/host/composerView.ts:58-66` → `HostChatSurface.tsx:139`. Field takes typing in EVERY known phase (`composerState.ts:119-131`, fix `860973f`) where the controller kept one `disabled` (`Chat:4337-4339`). **Still how different:** no `focus()`/`inputRef` anywhere (0 hits; old `Chat:3637,4329-4331`) — reported at `HostChatSurface.tsx:182-184`; KAV lift replaced by keyboard-controller insets (`useKeyboardHeight.ts`, `Shell.tsx:143-146`). |
| 7 | Action row: templates ✦, attach, mic (3 voice states), send⇄stop, per-control disabled | **DIFFERENT** (claimed move not confirmed — verdict unchanged, lines shifted) | Faces + per-control disabled drawn by `ShellComposer.tsx:99-124` (disabled `:103`), faces from `composerState.ts:170-173`. Attach and mic remain §2.7 **stubs**: `ShellComposer.tsx:67-74,89-96` → `HostChatSurface.tsx:148-149` fire `shell.notice.attach` / `shell.notice.mic` (copy `src/i18n/en.ts:1237-1238`). Templates ✦ entry: `ComposerToolbar.tsx:117-130` (row 13). **Still absent:** mic's three voice states, voice/PDF busy rules. |
| 8 | One `canSend` boolean | **IMPLEMENTED** | `composerState.ts:172`, consumed as `sendEnabled` at `composerView.ts:64`, dimming `ShellComposer.tsx:103`. Only the inputs this build has. |
| 9 | Streaming caret after last segment | **IMPLEMENTED** | Predicate `src/ui/shell/caretSpec.ts:45-49` (old `Chat:5484`), draw `StreamCaret.tsx:24-86`, plain-text-while-streaming render now `TranscriptTurns.tsx:200-218` (controller rule `Chat:5486-5490`), mapper `messageMapper.ts:117`; tests `caretSpec.test.ts`, `messageStop.test.ts:38-60`. |
| 10 | Stop: abort, 3 s watchdog, interrupted marker, empty drop, thermal note, failure row | **IMPLEMENTED** | Machinery `src/host/sendStop.ts:43-96` (timer `:96`, retire-first `:62`, drop-empty `:67`, mark `:75`, persist `:79`, unlock-own-only `:83-95`); abort-before-token rollback `sendHost.ts:268-275`; marker drawn as §2.8's stop line: mapper `messageMapper.ts:90-103`, render `TranscriptTurns.tsx:224-230`; `stopOutcome` (`composerState.ts:229`) mounted (`messageMapper.ts:92,100`) + tested (`stopOutcome.test.ts`, `messageStop.test.ts:62-138`); thermal = hold line + attention row (`sendHost.ts:286-288`). `stoppedEmpty` unreachable by construction (`messageMapper.ts:84-86`). |
| 11 | Send path: fit gate → claim → stream → turn-end save | **DIFFERENT** | Claim `sendHost.ts:114`, `beginRun` `:120`, content gate `:128-147`, arms capture `:155-162`, append `:165-180`, engine half `src/host/engineTurn.ts:53-332`, turn-end save `sendFinalize.ts:59-176`. **How different** (`sendHost.ts:7-15`): no chat-side pre-send fit gate (fit only on load, `engineLoad.ts:104`); no bench-command branch (old `Chat:2317-2330`); no doc-hint composition; classification in `sendStream.ts:91-148` (tested). |
| 12 | Empty state: art, greeting, welcome, 4 suggestions | **DIFFERENT** (claimed move not confirmed — verdict unchanged; two of three deltas since fixed) | Gate `src/host/welcomeCopy.ts:43-45` applied `HostChatSurface.tsx:124-126`; block `src/host/welcomeBlock.tsx:52-181` (raster `:44`, greeting `:64,137`, prompt `:149`, four cards `:151-181` each SENDING `:164`); copy `welcomeCopy.ts:25-37`; inside the transcript's scroll (`Transcript.tsx:238-239`, prop `transcriptTypes.ts:126`); tests `welcomeBlock.test.ts`, `welcomeCopy.test.ts`. **FIXED since e2b3aeb:** the plate's layout traps (proportions now `Chat:4033-4047` exactly, `welcomeBlock.tsx:69-149`) and the cards' tap-through-keyboard (row 45's prop landed). **Still how different:** (a) **the second hue is still lost** — `compute` tiles resolve to the neutral tile (`welcomeBlock.tsx:154-156`, reported `welcomeCopy.ts:18-22`, single accent `design.ts:38-42`, old two-tone `Chat:429,451`); (b) greeting carries **no name suffix** — NOT a loss: controller passes `userName={null}` (`App:7014`), so old `Chat:4078-4080` never rendered it. |
| 13 | Quick templates sheet | **IMPLEMENTED** (evidence line shifts) | Sheet called not rebuilt: `HostChatSurface.tsx:185-191` (state `:84`), entry `ComposerToolbar.tsx:117-130`; choose → draft `HostChatSurface.tsx:189` (old `Chat:3633-3641`). The `focus()` half still missing (→ row 46, reported `HostChatSurface.tsx:182-184`). Test `composerToolbar.test.ts`. |
| 14 | Research / library-doc / notes chips + auto-clear | **DIFFERENT** (claimed move not confirmed — verdict unchanged; the third chip is now gone, not stubbed) | Research + notes landed: `src/host/composerArms.ts:21-90`, capture-and-clear `sendHost.ts:155-162`, clear on conversation change `HostRoot.tsx:86-91`, chips `ComposerToolbar.tsx:139-151,152-164` gated while the face says stop (`HostChatSurface.tsx:119`, old rule `Chat:4203`), test `composerArms.test.ts`. **How different (two):** the **library-document chip left the row entirely** (`ComposerToolbar.tsx:11-22` header: it could not do its job without the attachment flow and was clipped at 349 dp) — the attach button still wears `shell.notice.attach` (`HostChatSurface.tsx:148`); and **a truncated notes context still informs nobody** — `armsSendOptions` (`composerArms.ts:30-36`) returns no `onNotice`, so `sendHost.ts:230` is always `undefined` and `engineTurn.ts:253-255` fires at nothing while row 40's toast is missing (reported `sendHost.ts:12-14`). |
| 15 | Long-press (350 ms) message menu: copy, save-to-notes, translate, edit, regenerate, cancel | **DIFFERENT** — **CHANGED since e2b3aeb (was MISSING)** | The sheet exists: open `src/host/messageActions.ts:134-154` (refs-only gates, the controller's trap `Chat:3484-3487`; busy/regen/history/caret/empty guards), rows decided purely by `src/host/messageMenuRows.ts:45-61` (gates `sheetCopyVisible` + `canRegen` — old files called, not rebuilt), sheet `src/ui/shell/MessageMenu.tsx:108-181` (backdrop `:140-150`, swallow `:151`, Android back `:137`), wired `HostChatSurface.tsx:171-180`, tests `messageMenu.test.ts`, `messageActions.test.ts`. **How different:** only copy / save-to-notes / regenerate / cancel ship — **translate and edit are ABSENT, not inert** (pure builder cannot emit them; union `MessageMenu.tsx:37`; tests `messageMenu.test.ts:74`, `messageActions.test.ts:188,211`), and the caption uses this build's honest hint `chat.a11yMessageActions` (`messageMenuRows.ts:69-71`, `en.ts:543`) instead of the controller's translate-promising `a11yLongPress`. **No row is offered without an implementation**: ids `copy/notes/regenerate/cancel` (`MessageMenu.tsx:37`) all handled in `messageActions.ts:224-262`. |
| 16 | Inline chips under a message: copy, read-aloud/stop, "more"; copied flash | **DIFFERENT** — **CHANGED since e2b3aeb (was MISSING)** | Copy chip landed, both boxes: `src/ui/shell/TranscriptTurns.tsx:56-106` (chip `:84`, 48 dp box `:99`, paints `TranscriptParts.tsx:203-236`), right under a capsule `:135-138`, left under an answer `:219-223`, +400 ms flash `src/ui/shell/copiedFlash.ts:17` (controller's number `Chat:4424-4431`), copy through `src/host/copyText.ts:18-28` (controller's share-sheet fallback `Chat:3517-3522`), flash only on a copy that took. **How different:** **read-aloud/stop is absent** (TTS not wired — deferred, not inert; old `Chat:5601-5616`), and the **"more" chip is gone by design** — it only ever opened this same menu, which the 350 ms long-press now opens (`TranscriptTurns.tsx:14-16`). |
| 17 | Edit-then-resend modal | **MISSING** | No modal (`grep editMessage` in `src/host/**` = 0). Its truncate half is shared with regenerate (`src/host/regenPlan.ts:10-16` says so), but the modal, its badge and its guards do not exist. Old `Chat:4500-4581, 3329-3465`. |
| 18 | Translate a message | **MISSING** | `grep runTranslate\|translateAbort` = 0; deliberately absent from the menu (row 15). Old `Chat:3533-3582`, orphan cleanup `Chat:1951-1957`. |
| 19 | Read aloud / stop reading | **MISSING** | `grep handleReadAloud\|speak` = 0; absent from the inline row by report (`TranscriptTurns.tsx:14-16`). Old `Chat:1613-1660`. |
| 20 | Save message to notes + confirmation notice | **IMPLEMENTED** — **CHANGED since e2b3aeb (was MISSING)** | `messageActions.ts:156-164`: `saveNote` from `src/notes/NotesStore` with the controller's guard and both notices `notes.saved` / `notes.errorSave` (old `App:3749-3763`), menu row `messageMenuRows.ts:54`, tests `messageActions.test.ts:277` (keys resolve in both catalogues). |
| 21 | Regenerate from a target turn | **IMPLEMENTED** — **CHANGED since e2b3aeb (was MISSING)** | Plan `src/host/regenPlan.ts:31-54` (controller's rule `Chat:3411-3421`, refuses before any truncate — tests `messageMenu.test.ts:127-155`); execute `messageActions.ts:173-222`: busy → `chat.regenBusy` `:183`, plan-miss → `chat.regenFailed` `:188,204`, then **one synchronous block** — set lock + truncate (`:193-196`) → `send()`'s own claim (`sendHost.ts:114`, no await between) → `armDeclaredShrink(plan.base)` `:210` (guard `src/chat/historyWriteGuard.ts:88`, guard's own tests `historyWriteGuard.test.ts:132,143,377,391`) → `await run`. **Release verified reachable on every path:** `sendHost.releaseOwned` `:85-95` clears the regen locks for the owning token; the stop watchdog clears them (`sendStop.ts:91`); a conversation change clears them (`useHostEffects.ts:124-129`); rollback path if the claim did not take `messageActions.ts:197-207`. Ordering pinned: `messageActions.test.ts:146,162,177`; truncate rules + identity `messageMenu.test.ts:127,138,145`. |
| 22 | Source chips under an answer | **IMPLEMENTED** | Mapper `messageMapper.ts:122-124`; policy `sourceLinkPolicy.ts:165`; render now `TranscriptTurns.tsx:224` → `TranscriptEvidence.tsx:65-151`; tests `sourceChipBox.test.ts`, `sourceLinkPolicy.test.ts`, `transcriptNoFetch.test.ts`. Representation still index+host (old `PROVIDER_COLORS` `Chat:5213-5225` unused). |
| 23 | Tool rows (volatile) | **IMPLEMENTED** | Capture `sendCallbacks.ts:97-104`, decoder `messageMapper.ts:145-155`, volatile map `HostRoot.tsx:126-131`, cleared per conversation (`HostRoot.tsx:86-91`, `useHostEffects` clearTools), render `TranscriptTurns.tsx:195`, labels `toolLabels.ts:68`. |
| 24 | Thinking status chip + status history | **IMPLEMENTED** (different representation) | Cloud: `messageMapper.ts:61-74` → `TranscriptTurns.tsx:184-194`; status written `sendCallbacks.ts:83-95`, volatile `historyMessages.ts:119`. |
| 25 | Error rows: engine reason, content filter, interrupted | **IMPLEMENTED** | Engine reason verbatim `engineTurn.ts:118`, `engineTurnStream.ts:283`, `sendCallbacks.ts:76-81` → finalize `sendFinalize.ts:73,98-100` → persist `historyMessages.ts:86-93` (`hostMessage.ts:56-67`) → danger line `messageMapper.ts:91-95`, render `TranscriptTurns.tsx:224-230`; content filter `contentFilterCopy.ts:16` (call `sendHost.ts:140`); interrupted = row 10's stop line. Tests `messageStop.test.ts:73-138`. |
| 26 | CTA buttons on answers | **MISSING** (user-visible) | Captured (`sendCallbacks.ts:97-128`) and persisted (`historyMessages.ts:206-221`), but `TranscriptMessage` has no `ctas` field and nothing draws them. Old `Chat:5764-5790` (old press was a no-op too, `App:7047`). |
| 27 | Day divider | **IMPLEMENTED** (evidence line shifts) | Rule `transcriptLayout.ts:156-164`, render `Transcript.tsx:247-273`, tested `transcriptLayout.test.ts`. |
| 28 | Mini-app card inside a message | **MISSING** | Same as row 4. Old `Chat:6033-6093`. |
| 29 | Mic: listen → transcribe → prefill | **STUBBED** | Chrome `ShellComposer.tsx:89-96`; toast **`shell.notice.mic`** ("Dictation is not available in this build yet.") `HostChatSurface.tsx:149`, copy `en.ts:1238`. No voice pipeline (0 hits). Old `Chat:1515-1611`. |
| 30 | Voice status row + voice-note toast | **MISSING** — now consequential | No voice UI (old `Chat:4299-4314`); the notes path now RUNS and its truncation notice has no home (rows 14/40). |
| 31 | Whisper download, TTS toggle, voice-ready gate | **STUBBED** (mixed) | Scan `usePipelineScans.ts:176-190`; TTS toggle real (`:83-88` → `HostOverlays.tsx:191`); download → toast **`shell.notice.voiceDownload`** (`HostOverlays.tsx:190`, `en.ts:1240`). Old `App:5155-5295`. |
| 32 | Voice cleanup on unmount/conversation change | **MISSING** | No voice timers exist to clean (old `Chat:1412-1426`); `useHostEffects.ts:72-99,104-118` handles abort/flush/tools only. |
| 33 | Top-bar model chip: name · quant · status + tap semantics | **DIFFERENT** (evidence updated) | Pill `Shell.tsx:190-228` — name + "On this phone" only, **logo mark dropped for the text budget** (`Shell.tsx:197-203`, new-shell item). Tap `HostChatSurface.tsx:90-101`: hung → inert (`:91`), missing/download → toast **`shell.notice.download`** (`:95`), busy/resident → no-op, else `userReloadModel`. **How different:** no quant/status/%/downloading (old `App:6873-6911, 6746-6788, 6720`); missing→download is a toast; strip is three buttons + pill (`shellGeometry.ts:278-293`) where the old bar carried progress/error rows too. |
| 34 | Download progress bar, %, notifications | **MISSING** | `downloadPercent: null` (`HostOverlays.tsx:170,185,195`); no `startDownload`/`notifyDownload`. Old `App:6971-6985, 2625-2712`. |
| 35 | Error + hint lines under the bar | **DIFFERENT** (evidence line shifts) | Hint builder Settings-only (`HostOverlays.tsx:135-147`, passed `:172`); the strip has no error row (`Shell.tsx:175-271` = menu/pill/web/new-chat). Composer shows `unloaded` (`composerPhase.ts:34-49` → hold). Old `App:6987-7008`. |
| 36 | Advisory battery ETA line | **MISSING** | 0 hits in `src/host/**`. Old `App:2758-2830, 6921`. |
| 37 | Web on/off switch (row 5 dup) | **DIFFERENT** (evidence updated) | Same as row 5: `Shell.tsx:229-261`, `toolFlags.ts:90-99`, three-button strip contract. |
| 38 | Memory banner (set-only, never rendered) | **MISSING** (deliberate, reported) | `memoryHost.ts:6-8`, `engineEnsure.ts:14-18`; grep = old `App:3021` + comments. Owner decision carried by PARITY (D1:38 / D2:18). |
| 39 | Notice toast (single slot, 4 s, bottom 96) | **IMPLEMENTED** | `useNotice.ts:19-24` (4 s at `:22`), render `HostNotice.tsx:16-36` (`bottom: 96` `:22`), mounted `HostFurniture.tsx:93`. Keys `en.ts:1236-1243`. |
| 40 | Voice-note toast (separate system) | **MISSING** — now consequential | No second toast (old `Chat:1329-1338, 4299-4314`), and the armed notes path calls `sendOpts.onNotice?.()` (`engineTurn.ts:253-255`) into an always-undefined slot (`sendHost.ts:230`; `composerArms.ts:30-36` carries no `onNotice` — reported `sendHost.ts:12-14`). |
| 41 | Share-in: prefill, file imports, notices | **MISSING** | No `shareIntent` import / `Linking` listener (row 2's `Share` sheet is export-OUT). Old `App:3553-3671`, `shareIntent.ts:37`. |
| 42 | History-guard Alerts | **IMPLEMENTED** | `useHistoryHost.ts:172-244` (begin `:172`, settle `:196`, alerts `:179,206,217,227`, lossy flush `:235-244`). |
| 43 | Attach / context chip rows | **MISSING** (shape only; evidence updated — the toolbar's document chip is gone) | `attachment` still `null` (`composerView.ts:61`); no `attachedItems`; shape at `composerState.ts`; the only trace left is the attach button's `shell.notice.attach` (`HostChatSurface.tsx:148`). Old `Chat:4222-4247, 1249-1252`. |
| 44 | Stick-to-bottom + auto-scroll | **IMPLEMENTED** (mechanism changed since e2b3aeb; tests grew) | Machine now decides with two reported facts — `messageCount` and `placedBefore` (`transcriptScroll.ts:109,122,141-175`): a conversation places at the end, the welcome block at offset 0 and no resize of it moves the reader (`:160-169`); the view only reports (`Transcript.tsx:127-160`, first-placement animation rule `:152-155`, re-layout folding `:206-207`). Jump pill `Transcript.tsx:314-328`. Tests: `transcriptScroll.test.ts` (+143/+56), **new** `transcriptRelayout.test.ts`, `transcriptJumpPill.test.ts`. Old `Chat:4136-4142, 3841-3852`. |
| 45 | Keyboard dismissal on dismissible surfaces | **DIFFERENT** (claimed move not confirmed — verdict unchanged; one of two evidence halves fixed) | **Fixed:** `keyboardShouldPersistTaps="handled"` on the transcript ScrollView — the controller's own prop (`Chat:4025,4146`) — at `Transcript.tsx:233`, pinned by `messageActions.test.ts:96`; the welcome cards and every transcript press now keep their first tap (row 12's old delta (b) resolved). **Still different:** one of the old five dismiss sites remains missing — the persona row (old `App:7104` → `HostDrawer.tsx:93-97`); present: four static items `conversationActions.ts:269,281,292,303` + the new export row `HostDrawer.tsx:73`. |
| 46 | Focus: after template choice, tap-to-focus | **MISSING** | No `focus()`/`inputRef` (0 hits; only the report comment `HostChatSurface.tsx:182-184`). Old `Chat:3637, 4329-4331`. |
| 47 | Long-press delay 350 ms + a11y hint on messages | **IMPLEMENTED** — **CHANGED since e2b3aeb (was MISSING)** | `delayLongPress={350}` + `accessibilityHint` on pressables that carry ONLY `onLongPress` (no tap side effect): `TranscriptTurns.tsx:45-51` (the controller's shape, `Chat:5332-5334,5395-5398`), label cut at 200 chars (`:40-43`, old `Chat:5397`), both boxes `:113-145` (capsule) and `:147-244` (answer text `:201`), wired `Transcript.tsx:277-292`; hint key `en.ts:543` (honest subset of `a11yLongPress`); tests `messageActions.test.ts:76-104`. |
| 48 | Haptics | **NOTHING TO PRESERVE** | Old grep empty; new grep `haptic\|vibrat` = 0. Parity holds. |
| 49 | Swipe-to-delete | **NOTHING TO PRESERVE** | New grep `swipe` = 0; delete is drawer long-press (`conversationActions.ts:258`). Matches old. |
| 50 | Keyboard-debug badge (dev) | **MISSING** | 0 hits. Old `Chat:865-904, 4668-4691`. Dev-only; keep/drop open (PARITY carries it). |

**Tally:** IMPLEMENTED 15 (8, 9, 10, 13, 20, 21, 22, 23, 24, 25, 27, 39, 42, 44, 47) · DIFFERENT 15 (1, 2, 3, 5, 6, 7, 11, 12, 14, 15, 16, 33, 35, 37, 45) · STUBBED 2 (29, 31) · MISSING 16 (4, 17, 18, 19, 26, 28, 30, 32, 34, 36, 38, 40, 41, 43, 46, 50) · nothing-to-preserve 2 (48, 49). 15 + 15 + 2 + 16 + 2 = 50.
**Verdicts moved since e2b3aeb:** 15, 16 (MISSING → DIFFERENT), 20, 21, 47 (MISSING → IMPLEMENTED), **2 (IMPLEMENTED → DIFFERENT — export left the header; not on the slice's own list)**. Evidence-only (verdict unchanged): 7, 12, 14, 45.

---

## Table 2 — Deliverable 2: the 21 state/plumbing rows

| # | Row | Verdict (new location) | Does the named check exist against the new code? |
|---|---|---|---|
| 1 | Epoch trio | **REPRODUCED** — checks `historyWrite.ts:80,86`; load bump `useHistoryHost.ts:144`; delete bump injected `HostRoot.tsx:114` → called `conversationActions.ts:213`; switch flush-before-bump `conversationActions.ts:89`. `flushThenBump` (`historyWrite.ts:95-103`) still **no production caller** — Section 4.3. | **Yes, replaced.** `historyWrite.test.ts:78,91,107,119,131`. Grep → **`epoch !== stamped` = 2, both `historyWrite.ts:80,86`**. |
| 2 | Hash symmetry (7 old callers; 3 raw) | **REPRODUCED at 5 sites** — `useHistoryFlushes.ts:120-127`, `sendFinalize.ts` turn-end (~`:157-162`), `modelSwitch.ts:153-159` (raw), `conversationActions.ts:98-105,158-165` (raw ×2). Raw readers still 3 (old `App:2391,2453,4536`). **Lost:** old `Chat:2161` (background-discard hash); old's two turn-end saves folded into one finalize. | Frozen-hash test `sessionPersistence.test.ts:179`. No `src/host/**` caller hashes a live `Message[]`. No new-side hash test. |
| 3 | `updateMessage` guards (9 sites) | **REPRODUCED** as the fence — **28** non-test `fence.*` sites (count unchanged since e2b3aeb): `sendCallbacks.ts` 12, `sendHost.ts` 8, `sendFinalize.ts` 3, `sendStop.ts` 3, `useHostEffects.ts` 2. The new regenerate truncate is deliberately NOT a fence site: `messageActions.ts:193-196` runs in one synchronous block (set lock → truncate → `send()`'s claim), fenced instead by the claim + `regenInFlightRef`, with the rollback path `:197-207`. `updateMessage` absent from `src/host/**`. | **Replaced.** `turnGuards.test.ts:4-55` + ordering pin `messageActions.test.ts:146,177`. |
| 4 | Run-id + generation lifecycle | **REPRODUCED** — `beginRun` `sendHost.ts:120`; `invalidate` `useHostEffects.ts:81,111`; `retire` `sendStop.ts:62`; the regen locks are now genuinely held and released (row 21). | Partly. Retire test `turnGuards.test.ts:61-70`; **named watchdog test still absent**. Old greps 0 in `src/host/**`. Replacement counts: `beginRun` 1, `invalidate` 2, `retire` 1. |
| 5 | Abort path (7 old sites) | **REPRODUCED (3 of 7)** — `sendStop.ts:46`, `useHostEffects.ts:78,109`. Not reproduced: background (`Chat:2103,2134`), clearChat (`Chat:3230`), edit (`Chat:3359` — no edit modal, row 17). Flush-before-abort ordering note stands (`conversationActions.ts:89` → `useHostEffects.ts:78`). | Replaced: 2 + `sendStop.ts:46`; identity property covered `turnGuards.test.ts:4-28`. |
| 6 | Stop watchdog (3 s) | **REPRODUCED** — `sendStop.ts:47-96`; it also releases the regen lock (`sendStop.ts:91`), one of row 21's three release paths. | **No** named watchdog test. Grep `stopWatchdogRef` → `sendHost.ts`, `sendStop.ts`, `useHostEffects.ts`, `HostRoot.tsx:164`. |
| 7 | History load + guard | **REPRODUCED** — `useHistoryHost.ts:143-249` (bump `:144`, begin `:172`, re-checks `:166,199`, settle `:196`, alerts `:179,206,217,227`, lossy flush `:235-244`). | Partly: `sessionPersistence.test.ts:224` exists; **named corrupt-raw/quarantine test still absent**. NEW adjacent coverage: a truncate now writes through the guard with a declared shrink (`historyWriteGuard.test.ts:132,143,377,391`). |
| 8 | Four save FIFOs | **REPRODUCED (3 of 4 + engine untouched)** — index `useConversationHost.ts:79`, library `libraryHost.ts:97`, turn-end `settleHold` + 10 s `sendFinalize.ts:131-147`; engine FIFO untouched. `turnEndSavePromiseRef`/`sendInFlightPromiseRef` not lifted (`sendFinalize.ts:14-17`). | Test **no**. Grep `.then(run, run)` → **5 repo-wide** (`useConversationHost.ts:79`, `libraryHost.ts:97`, `App:1066,1248`, `NotesStore.ts:189`). |
| 9 | Epoch-stamped in-flight turn persistence | **REPRODUCED** — debounce `useHistoryFlushes.ts:53-63`, 10 s `:65-84`, AppState `:87-131`, unmount `useHostEffects.ts:104-118`, turn-end `sendFinalize.ts:124-166`. NEW: the regenerate truncate writes immediately under a declared shrink instead of a scheduled write (row 21). | Named tests still don't exist as such; `historyWrite.test.ts:78-105` covers the drop; `getEpoch` shim `HostRoot.tsx:138`. |
| 10 | Engine lifecycle | **REPRODUCED for load+boot; NOT REPRODUCED for the background machine.** Load `engineEnsure.ts:38-271`, `engineEnsureLoad.ts:56-281`, `engineLoad.ts:104-231`; boot `usePipelineScans.ts:94-166`; thermal hook `turnRefs.ts:47-57`. Still not lifted: background/foreground discard (`App:3026-3526`), thermal edge (`App:3672-3748`) — greps 0. | Replaced: `ensureEngineForModelRef.current =` → **2** (`useModelHost.ts:202`, `App:4446`). Named fit/foreground test **still absent**. |
| 11 | `handleSendStream` + one bridge | **REPRODUCED**, same seams: `engineTurn.ts:53-332`, `engineTurnWindow.ts:38`, `engineTurnCompactor.ts:47`, `engineTurnSlide.ts:39`, `engineTurnStream.ts:38`, `engineTurnMemory.ts:41`. Regenerate enters this path through `send()` (row 21), so the bridge stays one per send. | **Yes:** `engineCallbackBridge.test.ts` exists; grep **`bridgeEngineCallbacks(` = 2 call sites** (`App:6630`, `engineTurnStream.ts:238`; def `:41`, test `:31`). |
| 12 | Model index storage | **REPRODUCED** — key `modelSwitch.ts:43`, write `:121`, boot read `usePipelineScans.ts:100`, `modelIndexRef` `useModelHost.ts:71-73`, hash re-save `modelSwitch.ts:149-161`. | Replaced: grep `MODEL_STORAGE_KEY` → **8 matches / 4 files** (`App:405,2948,4501`; `modelSwitch.ts:43,121`; `usePipelineScans.ts:40,100`; `useModelHost.ts:37`). |
| 13 | Conversation index store | **REPRODUCED** — `useConversationHost.ts:67-144`, switch `conversationActions.ts:82-117`, delete `:177-219`, touched `:232-246`. | Partly: named switch-flush test **still absent**; delete-order tests exist (`conversations.test.ts:84-100`, `historyWrite.test.ts:107-141`). `bumpPersistEpoch` passed `HostRoot.tsx:114`, called once `conversationActions.ts:213`. |
| 14 | Tool-flag persistence + refs | **REPRODUCED + toggle restored** — mirror `toolFlags.ts:41-64`, refresh `:66-84`, `toggleWebTools` `:90-99` (key write `:94`), refs read mid-run `agentTurnOptions.ts:209,220,227`, wiring `HostChatSurface.tsx:150-151`. | Replaced + tested: `staticPrefixNotify.ts:12-20 skipNext`, tests `staticPrefixNotify.test.ts:4-15` + `toolFlags.test.ts`; toggle → `useHostEffects.ts:65-73` deps change → notify. |
| 15 | Voice state | **NOT REPRODUCED** (beyond scan + TTS toggle). | `voiceRunIdRef` → old file only; 0 in `src/host/**`. |
| 16 | Share-in | **NOT REPRODUCED** (export-out exists; import-in does not). | Nothing to run against; grep = 0. |
| 17 | Notices — not a queue | **REPRODUCED** — `useNotice.ts:19-24`, render `HostNotice.tsx:16-36` (`HostFurniture.tsx:93`). NEW consumers: the menu's save/regen notices (`messageActions.ts:183,188,204,160,163`) ride the same single slot. | Grep `setNotice(` → **2, both `useNotice.ts:20,22`**. No queue. |
| 18 | Memory banner (set-only) | **NOT REPRODUCED — by decision, reported** (`memoryHost.ts:6-8`, `engineEnsure.ts:14-18`). | Old grep still true (`App:3021` only). |
| 19 | Compactor/digest per-chat maps | **REPRODUCED** — `turnCorpus.ts:23-45,45,106-186`, reset on delete `conversationActions.ts:183`, KV load `engineTurnCompactor.ts:47+`. | Grep `resetCompactorChat(` → **8 repo-wide, 3 calls per app** (new def `turnCorpus.ts:179` + `engineTurn.ts:275`, `engineTurnCompactor.ts:112`, `conversationActions.ts:183`; old `App:769` + `:2476,5776,6048`). |
| 20 | Notes-context injection | **REPRODUCED and REACHABLE** — chip → `notesRef` (`composerArms.ts:73-77`), captured `sendHost.ts:155-162`, options `sendHost.ts:247` → `engineTurn.ts:247-256` (cap `notesContext.ts:5`, same point as old `App:5749`). **Residual:** `onNotice` has no consumer (`sendHost.ts:230` reads a field `armsSendOptions` never sets — rows 14/40). | Grep `loadNotesContext(` → **4 repo-wide, 2 per app** (`App:416,5749`; `notesContext.ts:10`, `engineTurn.ts:249`); arms path tested `composerArms.test.ts`. |
| 21 | Static-prefix skip-once | **REPRODUCED + TESTED** — `staticPrefixNotify.ts:12-20`, wired `useHostEffects.ts:65-73`, test `staticPrefixNotify.test.ts:4-15`; the strip toggle exercises the change path. | Yes. |

### Greps whose meaning changed (verified counts at `f01a7f4`)

| Grep (old meaning) | New reality |
|---|---|
| `bridgeEngineCallbacks(` = 1 | **2 call sites**: `App:6630`, `engineTurnStream.ts:238` (+ def `engineCallbackBridge.ts:41`, test `:31`) |
| `ensureEngineForModelRef.current =` = 1 | **2**: `App:4446`, `useModelHost.ts:202` (+ comment `engineEnsure.ts:7`) |
| `MODEL_STORAGE_KEY` = 2 sites | **8 matches / 4 files**: `App:405,2948,4501`; `modelSwitch.ts:43,121`; `usePipelineScans.ts:40,100`; `useModelHost.ts:37` |
| `getEpoch() !== opts.epoch` (`Chat:619,629`) | `epoch !== stamped` — **2, both `historyWrite.ts:80,86`** |
| `updateMessage(` / `regenGenerationRef.current +=` / `++sendRunIdRef` | **0 in `src/host/**`** — fence: **28** `fence.*` sites (unchanged: `sendCallbacks.ts` 12, `sendHost.ts` 8, `sendFinalize.ts` 3, `sendStop.ts` 3, `useHostEffects.ts` 2); the regenerate truncate at `messageActions.ts:193-196` is claim-fenced, not token-fenced (pinned `messageActions.test.ts:146`) |
| `abortRef.current?.abort()` = 7 | **2** (`useHostEffects.ts:78,109`) + `sendStop.ts:46` |
| `.then(run, run)` | **5 repo-wide**: `useConversationHost.ts:79`, `libraryHost.ts:97`, `App:1066,1248`, `NotesStore.ts:189` |
| `setNotice(` | new app: **2, `useNotice.ts:20,22`**; old `App:3548,3550` |
| `bumpPersistEpochRef.current?.()` = 1 | injected: passed `HostRoot.tsx:114`, called once `conversationActions.ts:213` |
| `armDeclaredShrink(` (controller `Chat:3434`) | **new**: `messageActions.ts:210` (1 production call) + guard def `historyWriteGuard.ts:88` + guard tests `historyWriteGuard.test.ts:132,143,377,391` |
| `resetCompactorChat(` / `loadNotesContext(` | **8** / **4** repo-wide (3 / 2 calls per app) |
| `toggleWebTools` | 2 apps: `App:878,6926`; `toolFlags.ts:90`, `HostChatSurface.tsx:151` |
| `keyboardShouldPersistTaps` (`Chat:4025,4146`) | now **both apps**: old `Chat:4025,4146`; new `Transcript.tsx:233` (pinned `messageActions.test.ts:96`) |
| `delayLongPress` (`Chat:5333,5396,5524`) | now both: old sites; new `TranscriptTurns.tsx:49` |
| `staticPrefixNotifySkipRef…false` / `voiceRunIdRef` / `memoryBannerKey` / `shouldShowLongChatNudge` | still old-only |

---

## Table 3 — Gaps still open, ranked by what a user notices first

(Resolved since the previous walk are listed after the table.)

| # | Gap | What is lost | Old location | Size to restore | In PARITY already? |
|---|---|---|---|---|---|
| 1 | **The message-interaction remainder: translate, edit modal, read-aloud** | Translating a message (block + expand/close + abort), edit-then-resend modal (badge, guards), read-aloud/stop on an answer — the menu and inline row are honest about their absence, so nothing is broken, the capability is simply not there | translate `Chat:3533-3582, 5466, 5650`; edit `Chat:4500-4581, 3329-3465`; read-aloud `Chat:1613-1660, 5601-5616` | translate ~120 + edit modal ~80 (truncate half exists: `regenPlan.ts`) + read-aloud ~50 + TTS glue | **Carried** — D1 rows 17, 18, 19 (✗) + rows 15/16 residues |
| 2 | **Attach and mic are honest dead buttons; attachment + voice pipelines absent** | Attach sheet, image/PDF/docx import, context chips (the toolbar's document chip left the row because of this hole), whisper dictation, voice status/toast, voice cleanup | `Chat:1661-1833, 4222-4247, 1515-1611, 4299-4314, 1412-1426`; `App:5155-5320` | attachments ~173 + sheet glue; voice ~307 + download block ~158 | **Carried** — D1 rows 7, 29-32, 43 (stubs toast per §2.7) |
| 3 | **Model bar lost its status life** | Download %, thin progress bar, error+hint lines under the strip, battery ETA — the pill is name+where only | `App:6971-7008, 6746-6788, 2625-2712, 2758-2830` | model-bar ~130 + notify ~88 + battery ~40 | **Carried** — D1 rows 33-36 (◐/✗) |
| 4 | **No downloads at all** | Model / Whisper / embedding downloads, progress, notifications, confirm dialog — Settings buttons toast `shell.notice.download` / `voiceDownload` / `embeddingDownload` (`HostOverlays.tsx:178,190,199`) | `App:4657-5154` (442), `App:5155-5312` (158) | the download pipeline (~600) | **Carried** — D1 rows 31, 34 (✗) |
| 5 | **Mini-app card + sheet unreachable** | Interactive mini-apps render nowhere; overlay kind deleted (`hostOverlay.ts:7-16`); engine still produces them (`historyMessages.ts:139-148`) | sheet `App:7214-7252` (~38), card `Chat:6033-6093` (~60) + mapper field | ~100 + sheet chrome re-expression | **Carried** — D1 rows 4, 28 (✗) |
| 6 | **Share-in dead** | Android `url` intent prefill, .txt/.md/PDF import, busy/too-large/failed notices (export-out exists; this is import-in) | `App:3553-3671`, `shareIntent.ts:37` | ~119 lines | **Carried** — D1 row 41 (✗) |
| 7 | **The voice-note toast — now load-bearing** | The old transient voice note, and now the only home for a truncated 24 000-char notes context: `engineTurn.ts:253-255` calls `sendOpts.onNotice?.()` into an always-undefined slot (`sendHost.ts:230`) — with notes armed the truncation happens and informs **nobody** | `Chat:1329-1338, 4299-4314` | ~40-60 lines (second toast + wire `onNotice` through `armsSendOptions`) | **Partly new** — D1 row 40 carries the toast (✗); the truncation consequence **added in rows 14/40** |
| 8 | **CTA buttons never render** though capture+persist work | Visible action buttons on answers | `Chat:5764-5790` | renderer ~27 + mapper field | **Carried** — D1 row 26 (✗) |
| 9 | **Keyboard/focus remainder** | The persona row's `Keyboard.dismiss` (the one old dismiss site still missing) and every `focus()` path — tap-to-focus the field, focus after choosing a template | `App:7104`; `Chat:3637, 4329-4331` | 1 line + an inputRef/focus path (~20) | **Carried** — D1 rows 45, 46 (◐/✗); row 46 reported in-code `HostChatSurface.tsx:182-184` |
| 10 | **The painted background never mounted** | `PainterlyBg` — the app's background art; the new root renders a flat shell colour | `App:6849`, component `src/theme/components/PainterlyBg.tsx:10` | one mount line | **Not a D1 row** — carried only in D3a's JSX row (`docs/PARITY.md:160`); **added here** (Section 4.1) |
| 11 | **The suggestion cards' second hue** | `compute` tiles resolve to the neutral tile — cards 1 and 4 read flat next to 2 and 3 | `Chat:429,451` | one palette token + `welcomeCopy.ts:27-30` mapping (cosmetic) | **Not a D1 row** — **added in row 12(a)** (Section 4.8) |
| 12 | **The long-chat nudge** | The one-shot warning that a long conversation starts dropping context | `Chat:921-922, 1314-1327` (`src/chat/longChatEstimate.ts:132`) | ~30 lines (state + effect + row) | **Not a D1 row** — D3b names the unit (`docs/PARITY.md:184`); **added** (Section 4.5) |
| 13 | **kb-debug badge** (dev-only) | The keyboard-debug overlay behind `kalsa.kbDebug` | `Chat:865-904, 4668-4691` | ~40 lines | **Carried** — D1 row 50 (✗, keep/drop pending) |
| 14 | **Memory banner** — set-only in the old app, dropped by decision | Nothing visible (never rendered) | `App:3021` + setters | owner decision, ~0 | **Carried** — D1:38 / D2:18 (decision) |

**Resolved since the `e2b3aeb` walk:** gap 1 shrank (menu + copy chip landed — rows 15, 16, 20,
21, 47); the welcome cards' tap-through-keyboard (row 45's prop, row 12(b)); the plate's layout
traps (`welcomeBlock.tsx:69-149`). **Resolved since `3777479`:** first screen, caret, failed/
interrupted markers, export (relocated since), `PdfTextExtractorHost` (`HostFurniture.tsx:95`),
research/notes chips + quick templates, root size ratchet.

---

## Section 4 — behaviour no PARITY row covers (so the new code probably dropped it)

**Current findings:**

1. **The painted background is gone.** Old root renders `<PainterlyBg />` (`App:6849`,
   component `src/theme/components/PainterlyBg.tsx:10`); `grep PainterlyBg` over
   `src/host/**`, `src/ui/shell/**`, `App.tsx` = 0 (re-verified at `f01a7f4`). PARITY names it
   only in D3a's JSX row (`docs/PARITY.md:160`) — no D1 row demands it. Now Table 3 gap 10.

2. ~~`PdfTextExtractorHost` never mounted~~ — **RESOLVED** at `3c2e4e3`/`e2b3aeb`: mounted
   unkeyed in `src/host/HostFurniture.tsx:95` (old `App:7257`); was the previous file's
   Section 4.2 and Table 3 gap 12.

3. **The old strip's "New chat" and the drawer's "New chat" were different behaviors; the new
   strip runs only the drawer's.** Old nav new-chat called `clearChat` (`Chat:3949, :4004` →
   `Chat:3219-3328`: synchronous abort → flush → epoch bump → full wipe, then
   `onNewConversation()` `Chat:3318-3322`). New strip (`HostRoot.tsx:211`) + drawer
   (`HostDrawer.tsx:87`) both call `handleNewConversation` (`conversationActions.ts:119-172`):
   flush + switch, no synchronous multi-system reset (draft/arms/tools cleared later via
   `HostRoot.tsx:86-91`; abort after commit `useHostEffects.ts:78`). D2 row 1's "clear flushes
   before bump" still has **no production caller**: `flushThenBump` (`historyWrite.ts:95-103`)
   is exercised only by `historyWrite.test.ts:107`.

4. **The 180-second foreground idle dispose never runs.** Old assigns
   `bumpForegroundIdleRef.current` (`App:3311`), bumps at turn/download start (`App:4676,5417`),
   consults `shouldRunForegroundIdleDispose` (`App:3284`; `FOREGROUND_IDLE_DISPOSE_MS`
   `src/app/foregroundIdleDispose.ts:4`). The new host calls the ref
   (`src/host/engineTurn.ts:134`) but **nothing assigns it** (`hostDeps.ts:132-137`). PARITY
   never names it. Battery/thermal consequence on the campaign rig.

5. **The long-chat nudge is gone.** Old `Chat:921-922, 1314-1327` over
   `shouldShowLongChatNudge` (`src/chat/longChatEstimate.ts:132`); new tree 0 hits;
   `useHistoryHost.ts:13` admits dropping only the reset. Carried only as a D3b unit
   (`docs/PARITY.md:184`). Now Table 3 gap 12.

6. **`/bench …` / `bench:…` debug commands no longer intercept.** Old `Chat:2317-2330` /
   `src/bench/benchConfig.ts:824,848`; new send has no branch (0 hits in `src/host/**`;
   reported `sendHost.ts:7-8`). PARITY has zero bench rows.

7. **Ordering nit (D2 rows 5/13):** new conversation switch/delete flushes **before** it aborts
   the live send (`conversationActions.ts:89` → `useHostEffects.ts:78`), where old `clearChat`
   aborted first (`Chat:3231`). Fence ownership makes it state-safe.

**Findings folded in (each changes a verdict or prevents a false one):**

8. **Palette lost the second hue the old suggestion cards used** → row 12(a): still open —
   `welcomeCopy.ts:18-22`, single accent `design.ts:38-42`, old two-tone `Chat:429,451`.

9. **The greeting's name suffix is dead in the controller too** → NOT a gap (row 12(b)):
   `App:7014` passes `userName={null}`, so old `Chat:4078-4080` never rendered it.

10. **A truncated notes context informs nobody** → rows 14/40 + Table 3 gap 7:
    `engineTurn.ts:253-255` → `sendHost.ts:230` undefined (`composerArms.ts:30-36`).

11. ~~Suggestion cards inherit the tap-through-keyboard gap~~ — **RESOLVED** at `f01a7f4`:
    `keyboardShouldPersistTaps="handled"` `Transcript.tsx:233` (pinned `messageActions.test.ts:96`).

12. **Restoring the web chip changed the strip contract** → row 5: still open and changed
    twice — four buttons/97 dp pill at `e2b3aeb`, now three buttons/154 dp with a text budget
    after export left for the drawer (`shellGeometry.ts:278-293`, `stripTextBudget.test.ts`);
    old chip 36×22 on `hitSlop` (`App:6926-6959`).

13. **The notes branch is reachable and armed** → D2 row 20 REPRODUCED.

**New in the `f01a7f4` slice:**

14. **The menu's caption line is deliberately NOT the controller's.** The controller used
    `chat.a11yLongPress` ("…copy, translate, or save to notes", `en.ts:541`) for both the hint
    and the sheet caption; this build ships `chat.a11yMessageActions` (`en.ts:543`,
    `messageMenuRows.ts:64-71`) because this menu cannot translate or edit — reported as an
    honest difference, pinned `messageActions.test.ts:295`.

15. **The inline "more" chip does not exist** — old `Chat:5601-5616` drew read-aloud + "more"
    under an answer; the new chip row is copy-only and "more" is folded into the 350 ms
    long-press (`TranscriptTurns.tsx:14-16`). Capability preserved (same menu), the visible
    affordance is not. Covered by row 16's verdict.

16. **Export's relocation is the strip-budget trade, written down**: header → drawer tile
    (`HostDrawer.tsx:66-78`, reason `shellGeometry.ts:278-292`). Row 2 now DIFFERENT; a
    reader of the old file should see this as the verdict that moved without being listed.

17. **The pill's logo mark was dropped** (`Shell.tsx:197-203`; DESIGN.md `e8bcc80`: "the logo
    changed home, it did not retire") — a new-shell design item, NOT old parity: the old strip
    carried no mark (0 hits for a logo in `App:6873-6911`'s chip). Listed so nobody re-adds it
    and re-squeezes the name column.

---

## Could not determine (and which file decides it)

| # | Question | Deciding file |
|---|---|---|
| 1 | Whether the e2e/campaign harness ever types `/bench` or `bench:` into the composer (would make Section 4.6 harness-critical) | `scripts/ci-e2e.sh`, `scripts/ci-dflash-ab.sh`, any `scripts/campaign/*` sender |
| 2 | Whether the owner wants the old `compute` hue restored for the suggestion cards, or the single-accent palette accepted as the answer (row 12(a) is a verdict either way) | `src/theme/design.ts:38-42` + `src/host/welcomeCopy.ts:18-22` |
| 3 | Whether the owner wants `clearChat`'s flush→bump→synchronous-reset order re-expressed as a production caller of `historyWrite.flushThenBump` (`historyWrite.ts:95`), or accepted as flush + load-effect bump | `src/host/conversationActions.ts:119-172` + `src/host/useHistoryHost.ts:144` |
| 4 | Whether idle-dispose (Section 4.4) is scheduled with the background-machine lift or dropped by decision | `src/app/AppShell.tsx:3026-3526` + `src/app/foregroundIdleDispose.ts` |
| 5 | Test results — no jest was executed in this walk (read-only pass); all test claims are existence-only | run `npx jest src/host src/ui/shell` when the machine is free |
| 6 | Minor: PARITY's `keyboardShouldPersistTaps` line refs (`Chat:4029-4030`) are drifted; actual lines `Chat:4025,4146` | `src/screens/AiChatPage.tsx:4025,4146` |
| 7 | Whether an open message menu across a conversation switch behaves as the controller did (the host closes the menu on send/unmount/backdrop/Android back, `messageActions.ts:110-127`; the controller cleared it in `clearChat` `Chat:3311` — its behavior on a drawer switch is not in the rows PARITY names) | `src/screens/AiChatPage.tsx:1044-1162` (load effect) + `src/host/messageActions.ts:110-127` |
