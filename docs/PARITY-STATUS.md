# PARITY-STATUS — the answer to `docs/PARITY.md` at commit `e2b3aeb`

This file is the row-by-row answer to the specification in `docs/PARITY.md`, verified on
branch `ux-2026-09-21` at commit `e2b3aeb` (the walk previous to this one described commit
`3777479`; rows whose verdict moved say **CHANGED since 3777479 (was …)** so the two files
can be read against each other). Slices landed since that walk: `860973f` (drawer backdrop
taps + field types while it waits), `c2bfb1c` (size ratchet), `3c2e4e3` (caret, failed/
interrupted markers, export, PDF host, root split), `20e0712` (docs), `e2b3aeb` (first
screen, web switch, composer chips).
Method: read-only walk of `src/host/**`, `src/ui/shell/**`, `App.tsx` against the two
controller files by grep + bounded reads; no test was executed (existence claims only).
The root now only composes — `HostChatSurface`, `HostDrawer`, `HostFurniture` — under the
line-budget ratchet `src/host/fileSize.test.ts` pins.
**Re-walk and regenerate this file after any slice that touches `src/host/**` or
`src/ui/shell/**`** — every verdict below is only true of the tree that produced it.

Vocabulary (D1): IMPLEMENTED · STUBBED (held, with the toast key or hold line that says
why — §2.7) · MISSING · DIFFERENT (with the how). Shorthand: `App` = `src/app/AppShell.tsx`,
`Chat` = `src/screens/AiChatPage.tsx`.

---

## Table 1 — Deliverable 1: the 50 feature rows

| # | Feature | Verdict | New location / hold signal (and the how) |
|---|---|---|---|
| 1 | Drawer: list, tap-switch, long-press delete, new-chat, persona row, 180 ms search, keyboard dismiss per row | **DIFFERENT** | List/tap: `src/host/conversationActions.ts:248-260` (long-press → confirm `:258` → dialog `:221-230`); new-chat `src/host/HostDrawer.tsx:58` → `conversationActions.ts:119-172`; persona row `HostDrawer.tsx:59-68`; debounce `src/host/useConversationHost.ts:23,51-62`; static-item dismiss `conversationActions.ts:269,281,292,303`. **How different:** the persona row press still has no `Keyboard.dismiss` (old `App:7104`; new `HostDrawer.tsx:64-68`). Conversation rows never dismissed in the old app either (old sites are only `App:2576,2588,2599,2610` = the four static items) — that part matches. |
| 2 | Chat header: menu, export/share, new chat | **IMPLEMENTED** — **CHANGED since 3777479 (was DIFFERENT — export absent)** | Menu `src/ui/shell/Shell.tsx:194-202` → `HostRoot.tsx:200`; new chat `Shell.tsx:281-288` → `HostRoot.tsx:201`; **export/share landed**: strip button `Shell.tsx:271-278`, wiring `HostRoot.tsx:202`, builder + `Share` sheet `src/host/shareConversation.ts:21-43` (old `Chat:3206-3218`, button `Chat:4757-4769`), test `shareConversation.test.ts`. Note: the new export is a real 48 dp box — the old 36 dp box rode `hitSlop`, which the project forbids (`Shell.tsx:103-107`). |
| 3 | Eight exclusive overlays | **DIFFERENT** | 7 of 8 kinds: `src/host/hostOverlay.ts:4-15`, mounts `src/host/HostOverlays.tsx:149-263` (Settings `:155`, Account `:206`, Pro `:213`, Documents `:215-231`, Notes `:234-243` with `focusId`, Personas `:245-255`, Help `:257-263`), assembled by `HostFurniture.tsx:66-92`. **How different:** the `miniapp` kind is deleted, with a written report at `hostOverlay.ts:7-16`. |
| 4 | Mini-app card **and** full-screen sheet | **MISSING** | No miniapp field in `src/ui/shell/transcriptTypes.ts:23-77`, no mapper read (`src/host/messageMapper.ts:106-125`), no overlay kind (`hostOverlay.ts:7-16`), renderer `src/ui/AskAssistantMiniappRenderer.tsx` never mounted. Plumbing survives: persist `src/host/historyMessages.ts:139-148`, capture `src/host/sendCallbacks.ts:130-138`, hook `src/host/turnRefs.ts:63` (never has an opener). Old `Chat:6033-6093`, `App:7214-7252`. |
| 5 | Web switch in the top bar (persisted) | **DIFFERENT** — **CHANGED since 3777479 (was MISSING)** | Switch restored: render `src/ui/shell/Shell.tsx:235-267` (testID `:240`, switch role + both controller hints), flip + persist `src/host/toolFlags.ts:90-99` (key write `"1"/"0"` `:94`, controller key), wiring `src/host/HostChatSurface.tsx:145-146`; tests `stripWebSwitch.test.ts`, `toolFlags.test.ts`. **How different — the strip contract changed:** the old chip was 36×22 on `hitSlop` (`App:6926-6959`), which this project forbids; the new one is a labelled 48 dp box (globe + word + line-through while off), and the strip geometry now budgets FOUR icon buttons — the pill's 154 dp became 97 dp (`src/ui/shell/shellGeometry.ts:204-211`, pinned by `stripWebSwitch.test.ts:3-9` and `shellGeometry.test.ts`). Persistence and notify-on-change rules unchanged (D2 rows 14/21). |
| 6 | Composer field, held placeholders (§2.7) | **DIFFERENT** | Field `src/ui/shell/ShellComposer.tsx:77-87`; hold reason row `Shell.tsx:311-318`; decisions `src/ui/shell/composerState.ts:159-176` fed by `src/host/composerView.ts:58-66` → `HostChatSurface.tsx:134`. **CHANGED since 3777479:** the field now takes typing in EVERY known phase — `loading`/`tooHot`/`unloaded`/`converting` are `editable: true` (`composerState.ts:119-131`, fix `860973f`) — where the controller kept one `disabled` and showed the invite anyway (`Chat:4337-4339`); the hold line still names the SEND refusal. **Still how different:** tap-transcript-to-focus and `focus()` do not exist (0 hits in `src/host/**` + `src/ui/shell/**`; old `Chat:3637,4329-4331`) — reported in-code at `HostChatSurface.tsx:156-159`; KAV lift replaced by keyboard-controller insets (`src/ui/shell/useKeyboardHeight.ts`, `Shell.tsx:143-146`). |
| 7 | Action row: templates ✦, attach, mic (3 voice states), send⇄stop, per-control disabled | **DIFFERENT** — **CHANGED since 3777479** (templates ✦ landed, in the toolbar) | Faces + per-control disabled now drawn by `ShellComposer.tsx:99-124` (disabled `:103`), faces from `composerState.ts:170-173`. Attach and mic remain §2.7 **stubs**: `ShellComposer.tsx:67-74,89-96` → `HostChatSurface.tsx:143-144` fire toasts `shell.notice.attach` / `shell.notice.mic` (copy `src/i18n/en.ts:1237-1238`). Templates ✦ entry now exists — see row 13 (`ComposerToolbar.tsx:111-131`). **Still absent:** mic's three voice states, voice/PDF busy rules. PARITY's "composerState has zero importers" remains stale (mounted via `composerView.ts`). |
| 8 | One `canSend` boolean | **IMPLEMENTED** | `composerState.ts:172` (`canSend: rule.hold === null`), consumed as `sendEnabled` at `composerView.ts:64` and dimming `ShellComposer.tsx:103`. Caveat: only the inputs this build has; attachments/translate/voice/pdf inputs left with systems this host does not mount. |
| 9 | Streaming caret after last segment | **IMPLEMENTED** — **CHANGED since 3777479 (was MISSING)** | Predicate verbatim from `Chat:5484` → `src/ui/shell/caretSpec.ts:45-49`; glyph/blink data `caretSpec.ts:25-42`; draw `src/ui/shell/StreamCaret.tsx:24-86` (solid-on-arrival, reduce-motion, a11y-hidden); render as plain text while arriving — the controller's own rule `Chat:5486-5490` — `src/ui/shell/TranscriptParts.tsx:109-115`; mapper `src/host/messageMapper.ts:117`; tests `caretSpec.test.ts`, `messageStop.test.ts:38-60`. |
| 10 | Stop: abort, 3 s watchdog, interrupted marker, empty drop, thermal note, failure row | **IMPLEMENTED** — **CHANGED since 3777479 (was DIFFERENT — marker unrendered)** | Machinery unchanged: `src/host/sendStop.ts:43-96` (3 s timer `:96`, retire-first `:62`, drop-empty `:67`, mark `:75`, persist `:79`, unlock-own-only `:83-95`); abort-before-token rollback `src/host/sendHost.ts:268-275`. The interrupted marker now DRAWS: mapper `messageMapper.ts:90-103` (interrupted → `stopOutcome` user row `:100`), rendered as §2.8's stop line `TranscriptParts.tsx:126-134`; `stopOutcome` (`composerState.ts:229`) is mounted (importers `messageMapper.ts:92,100`) and tested (`stopOutcome.test.ts`, `messageStop.test.ts:62-138`). Thermal refusal = hold line `shell.held.tooHot` + attention row (`sendHost.ts:286-288` sets `failureThermal`). `stoppedEmpty` is unreachable by construction (an empty placeholder is dropped before any marker — mapper comment `messageMapper.ts:84-86`). |
| 11 | Send path: fit gate → claim → stream → turn-end save | **DIFFERENT** | Claim `sendHost.ts:114`, `beginRun` `:120`, content gate `:128-147`, arms capture `:155-162`, append `:165-180`, engine half `src/host/engineTurn.ts:53-332`, turn-end save `src/host/sendFinalize.ts:59-176`. **How different (all reported at `sendHost.ts:7-15`):** no chat-side pre-send fit gate (fit only on the load path, `src/host/engineLoad.ts:104`); no bench-command branch (old `Chat:2317-2330`) and no doc-hint composition; result classification in `src/host/sendStream.ts:91-148` (tested). |
| 12 | Empty state: art, greeting, welcome, 4 suggestions | **DIFFERENT** — **CHANGED since 3777479 (was MISSING)** | Block landed: gate `src/host/welcomeCopy.ts:43-45` applied at `src/host/HostChatSurface.tsx:118-120`; block `src/host/welcomeBlock.tsx:52-165` (raster `:44` via the controller's `tryRequireAsset`, greeting `:64,114`, four cards `:120-165` each SENDING for real `:133` → `sendHost.send`); copy `welcomeCopy.ts:25-37`; placed inside the transcript's scrolling content `src/ui/shell/Transcript.tsx:199-200` (prop `transcriptTypes.ts:126`); tests `welcomeBlock.test.ts`, `welcomeCopy.test.ts`. **How different (three, from the slice's own findings):** (a) **the palette lost the second hue** the old cards used — `compute` tiles resolve to the neutral tile because only one accent survived `design.ts` (reported `welcomeCopy.ts:18-22`; single accent `src/theme/design.ts:38-42`; old two-tone cards `Chat:429,451`); (b) **the cards inherit the tap-through-keyboard gap** — the transcript ScrollView still has no `keyboardShouldPersistTaps` (0 hits in `src/ui/**`+`src/host/**`; old `Chat:4025,4146`), so a first tap while the keyboard is up dismisses instead of sending; (c) the greeting carries **no name suffix** — that is NOT a loss: the controller passes `userName={null}` (`App:7014`), so old `Chat:4078-4080` never rendered it either. |
| 13 | Quick templates sheet | **IMPLEMENTED** — **CHANGED since 3777479 (was MISSING)** | The controller's sheet CALLED, not rebuilt: `HostChatSurface.tsx:159-165` (state `:79`), entry ✦ in the toolbar `ComposerToolbar.tsx:111-131`; choose → replaces the draft `HostChatSurface.tsx:164` (controller `Chat:3633-3641`). The `focus()` half of that handler is still missing (→ row 46, reported `HostChatSurface.tsx:156-159`). Test `composerToolbar.test.ts`. |
| 14 | Research / library-doc / notes chips + auto-clear | **DIFFERENT** — **CHANGED since 3777479 (was MISSING)** | Research + notes arms landed: state/auto-clear/toggles `src/host/composerArms.ts:21-90` (draft-empty predicate `:21`, one-shot options `:30-36`), capture-and-clear at the controller's point `sendHost.ts:155-162` (old `Chat:2454-2463`), clear on conversation change `HostRoot.tsx:85-90`, chips `ComposerToolbar.tsx:133-144,157-168` gated while the face says stop (`HostChatSurface.tsx:116`, old rule `Chat:4203`), test `composerArms.test.ts`. **How different (two):** the library-document chip is a §2.7 **stub** — press fires `shell.notice.attach` (`HostChatSurface.tsx:112`, chip `ComposerToolbar.tsx:146-155`) because `attachedItems` (row 43) does not exist; and **a truncated notes context now informs nobody** — `armsSendOptions` returns only `{research,notes}` (`composerArms.ts:30-36`), so `sendHost.ts:230`'s `onNotice` is always `undefined` and `engineTurn.ts:253-255` fires it at nothing while row 40's voice-note toast is still missing. |
| 15 | Long-press (350 ms) message menu | **MISSING** | No `onLongPress` in `src/ui/shell/**`; the only one in the new tree is the drawer's `conversationActions.ts:258`. Old modal `Chat:4385-4496`, openers `Chat:5332-5526`. |
| 16 | Inline chips: copy, read-aloud, "more", copied flash | **MISSING** | `grep Clipboard\|speakingId\|copiedFlash` in `src/host/** src/ui/shell/**` = 0. Old `Chat:5419-5434, 5593-5624`. |
| 17 | Edit-then-resend modal | **MISSING** | `grep editMessage` in `src/host/**` = 0. Old `Chat:4500-4581, 3329-3465`. |
| 18 | Translate a message | **MISSING** | `grep runTranslate\|translateAbort` in `src/host/**` = 0. Old `Chat:3533-3582`, orphan cleanup `Chat:1951-1957`. |
| 19 | Read aloud / stop reading | **MISSING** | `grep handleReadAloud\|speak` = 0. Old `Chat:1613-1660`. |
| 20 | Save message to notes + notice | **MISSING** | `grep handleSaveToNotes\|saveNote(` = 0 in `src/host/**` (`src/notes/NotesStore.ts` untouched and un-called from the new root). Old `App:3749-3763`. |
| 21 | Regenerate from a target turn | **MISSING** | No UI entry; `regenState` locks exist only to be cleared (`sendHost.ts`, `useHostEffects.ts:124-127`); `src/screens/regenTarget.ts` never imported by `src/host/**`. Old menu `Chat:4468-4486`. |
| 22 | Source chips under an answer | **IMPLEMENTED** | Mapper `messageMapper.ts:122-124`; safe-URL policy `src/ui/shell/sourceLinkPolicy.ts:165`; render + system-browser tap `src/ui/shell/TranscriptEvidence.tsx:65-151`; tests `sourceChipBox.test.ts`, `sourceLinkPolicy.test.ts`, `transcriptNoFetch.test.ts`. Representation still differs (index + host instead of provider colours/title — old `Chat:5213-5225` `PROVIDER_COLORS` unused). |
| 23 | Tool rows (volatile) | **IMPLEMENTED** | Capture branch `sendCallbacks.ts:97-104` (payload decoder `messageMapper.ts:145-155`), volatile map `HostRoot.tsx:120-125`, cleared per conversation (`HostRoot.tsx:85-90`, `useHostEffects.ts` clearTools), render `TranscriptEvidence.tsx:39-60`, label fallback `src/ui/shell/toolLabels.ts:68`. |
| 24 | Thinking status chip + status history | **IMPLEMENTED** (different representation, as PARITY anticipated) | Live cloud: `messageMapper.ts:61-74` → `ThoughtCloud` via `TranscriptParts.tsx:66-73`; status label/history written per callback (`sendCallbacks.ts:83-95`) and volatile by decision (`historyMessages.ts:119`). |
| 25 | Error rows: engine reason, content filter, interrupted | **IMPLEMENTED** — **CHANGED since 3777479 (was DIFFERENT)** | All three rows now render. Engine reason captured verbatim (`engineTurn.ts:118`, `engineTurnStream.ts:283`, `sendCallbacks.ts:76-81`) → finalize marks the message (`sendFinalize.ts:73,98-100`) → persists across reopen (`historyMessages.ts:86-93`, fields `hostMessage.ts:56-67`) → danger stop line with the engine's own words (`messageMapper.ts:91-95`, `TranscriptParts.tsx:126-134`); content filter moved to `src/host/contentFilterCopy.ts:16` (call `sendHost.ts:140`, old `Chat:532-558`); interrupted line = row 10's stop line. Tests `messageStop.test.ts:73-138`. |
| 26 | CTA buttons on answers | **MISSING** (user-visible) | Captured (`sendCallbacks.ts:97-128`) and persisted (`historyMessages.ts:206-221`), but `TranscriptMessage` has no `ctas` field and nothing draws them. Old render `Chat:5764-5790` (old press was a no-op too, `App:7047`). |
| 27 | Day divider | **IMPLEMENTED** | `src/ui/shell/transcriptLayout.ts:156-164` (`shouldShowDayMarker`, floor `:60`), render `Transcript.tsx:205-231`, tested `transcriptLayout.test.ts`. |
| 28 | Mini-app card inside a message | **MISSING** | Same as row 4: no card renderer; `MiniappCard` old `Chat:6033-6093`. |
| 29 | Mic: listen → transcribe → prefill | **STUBBED** | Chrome `ShellComposer.tsx:89-96`; press fires toast **`shell.notice.mic`** = "Dictation is not available in this build yet." (`HostChatSurface.tsx:144`, copy `en.ts:1238`). No voice pipeline (`grep voiceRunId` in `src/host/**` = 0). Old `Chat:1515-1611`. |
| 30 | Voice status row + voice-note toast | **MISSING** | No voice UI symbol anywhere (old `Chat:4299-4314`) — and now consequential: the truncated-notes notice has no home (row 14). |
| 31 | Whisper download, TTS toggle, voice-ready gate | **STUBBED** (mixed) | Presence scan live `src/host/usePipelineScans.ts:176-190`; TTS toggle real (`usePipelineScans.ts:83-88` → `HostOverlays.tsx:191`); download held → toast **`shell.notice.voiceDownload`** (`HostOverlays.tsx:190`, copy `en.ts:1240`). Old download UI `App:5155-5295`. |
| 32 | Voice cleanup on unmount/conversation change | **MISSING** | No voice timers/capture exist to clean (old `Chat:1412-1426`). Unmount/conversation effects at `useHostEffects.ts:72-99,104-118` handle only abort/flush/tools. |
| 33 | Top-bar model chip: name · quant · status + tap semantics | **DIFFERENT** | Pill draws name + "On this phone" only (`Shell.tsx:204-233`). Tap semantics at `HostChatSurface.tsx:85-96`: hung → inert (`:86`), missing/download-error → toast **`shell.notice.download`** (`:89`), checking/loading/resident → no-op, else `userReloadModel`. **How different:** no quant/status/%, no "downloading" state (old `App:6873-6911, 6746-6788, 6720`), missing→download is a toast; and the strip now carries six controls where the old carried four (row 5's contract change). |
| 34 | Download progress bar, %, notifications | **MISSING** | `downloadPercent: null` in all three Settings slots (`HostOverlays.tsx:170,185,195`); no `startDownload`/`notifyDownload` in `src/host/**`. Old `App:6971-6985`, notify `App:2625-2712`. |
| 35 | Error + hint lines under the bar | **DIFFERENT** | The hint builder is lifted but rendered **only inside Settings** (`HostOverlays.tsx:135-147`, passed `:172`); the strip has no error row (`Shell.tsx:192-288` = menu/pill/web/export/new-chat only). The composer shows `unloaded` on error (`composerPhase.ts:34-49` → hold line). Old render `App:6987-7008`. |
| 36 | Advisory battery ETA line | **MISSING** | `grep batteryEta` in `src/host/**` = 0. Old `App:2758-2830`, render `App:6921`. |
| 37 | Web on/off switch (row 5 dup) | **DIFFERENT** — **CHANGED since 3777479 (was MISSING)** | Same verdict and evidence as row 5: switch restored at `Shell.tsx:235-267` + `toolFlags.ts:90-99`, with the changed strip contract (`shellGeometry.ts:204-211`). |
| 38 | Memory banner (set-only, never rendered) | **MISSING** (deliberate, reported) | Dropped with a written report at `src/host/memoryHost.ts:6-8` and `src/host/engineEnsure.ts:14-18`; `grep memoryBannerKey` = old `App:3021` + prose comments only. Owner decision already carried by PARITY (D1 row 38 / D2 row 18). |
| 39 | Notice toast (single slot, 4 s, bottom 96) | **IMPLEMENTED** | `src/host/useNotice.ts:19-24` (one state, one 4 s timer, last-write-wins), render `src/host/HostNotice.tsx:16-36` (`bottom: 96` `:22`), mounted `HostFurniture.tsx:93`. Keys `en.ts:1236-1243`. |
| 40 | Voice-note toast (separate system) | **MISSING** — now consequential | No second toast system (old `Chat:1329-1338, 4299-4314`), and the notes path now RUNS: a truncated 24 000-char notes context calls `sendOpts.onNotice?.()` (`engineTurn.ts:253-255`) into an always-undefined slot (`sendHost.ts:230`; `armsSendOptions` `composerArms.ts:30-36` carries no `onNotice`) — the truncation informs nobody (reported at `sendHost.ts:12-14`). |
| 41 | Share-in: prefill, file imports, notices | **MISSING** | No `shareIntent` import and no `Linking` event listener in `App.tsx` or `src/host/**` (the `Share` sheet of row 2 is export-out, not share-in). Old `App:3553-3671`, `shareIntent.ts:37`. |
| 42 | History-guard Alerts | **IMPLEMENTED** | `src/host/useHistoryHost.ts:172-244`: begin `:172`, settle `:196`, throw-guard alert `:179`, preservation-failed `:206`, unreadable `:217`, partial-count `:227`, lossy flush `:235-244`. |
| 43 | Attach / context chip rows | **MISSING** (shape only) | `attachment` is still hard-wired `null` (`composerView.ts:61`); no `attachedItems` state; shape exists at `composerState.ts` and the toolbar's document chip is the row-14 stub. Old `Chat:4222-4247`, state `Chat:1249-1252`. |
| 44 | Stick-to-bottom + auto-scroll | **IMPLEMENTED** (different mechanism, tested) | `src/ui/shell/transcriptScroll.ts:91-133` + `Transcript.tsx:104-155` + jump pill `Transcript.tsx:257-270`; tests `transcriptScroll.test.ts`, `transcriptJumpPill.test.ts`. |
| 45 | Keyboard dismissal on dismissible surfaces | **DIFFERENT** | 4 of the old 5 dismiss sites: `conversationActions.ts:269,281,292,303`. Persona row still lacks its dismiss (old `App:7104` → `HostDrawer.tsx:64-68`). No `keyboardShouldPersistTaps="handled"` anywhere in the new tree (0 hits; actual old lines `Chat:4025,4146` — PARITY's 4029-4030 has line drift) — and the tap-through gap now lands on the welcome cards (row 12) and the transcript's chips: a first tap while the keyboard is open dismisses instead of acting. |
| 46 | Focus: after template choice, tap-to-focus | **MISSING** | No `focus()`/`inputRef` in `src/host/**` or `src/ui/shell/**`; reported in-code where it now bites (template choose) at `HostChatSurface.tsx:156-159`. Old `Chat:3637, 4329-4331`. |
| 47 | Long-press 350 ms + a11y on messages | **MISSING** | No long-press on any transcript element (`Transcript.tsx:198-250`, `TranscriptParts.tsx` pressables absent). Old `Chat:5333-5334,5396,5524`. |
| 48 | Haptics | **NOTHING TO PRESERVE** | Old grep empty (PARITY); new grep `haptic\|vibrat` over `src/host/** src/ui/shell/**` = 0. Parity holds. |
| 49 | Swipe-to-delete | **NOTHING TO PRESERVE** | New grep `swipe` = 0 in `src/host/** src/ui/shell/**`; delete is drawer long-press (`conversationActions.ts:258`). Matches old. |
| 50 | Keyboard-debug badge (dev) | **MISSING** | `grep kbDebug` in the new tree = 0. Old `Chat:865-904, 4668-4691`. Dev-only; keep/drop still an open decision (PARITY carries it as such). |

**Tally:** IMPLEMENTED 13 (2, 8, 9, 10, 13, 22, 23, 24, 25, 27, 39, 42, 44) · DIFFERENT 12 (1, 3, 5, 6, 7, 11, 12, 14, 33, 35, 37, 45) · STUBBED 2 (29, 31) · MISSING 21 (4, 15-21, 26, 28, 30, 32, 34, 36, 38, 40, 41, 43, 46, 47, 50) · nothing-to-preserve 2 (48, 49). 13 + 12 + 2 + 21 + 2 = 50.
**Verdicts moved since 3777479:** 2, 9, 10, 13, 25 → IMPLEMENTED; 5, 37 MISSING → DIFFERENT; 12 MISSING → DIFFERENT; 14 MISSING → DIFFERENT; rows 6, 7, 40, 43, 45 carry updated evidence.

---

## Table 2 — Deliverable 2: the 21 state/plumbing rows

| # | Row | Verdict (new location) | Does the named check exist against the new code? |
|---|---|---|---|
| 1 | Epoch trio | **REPRODUCED** — checks before build and before write `src/host/historyWrite.ts:80,86`; load bump `src/host/useHistoryHost.ts:144`; delete bump injected `HostRoot.tsx:113` → called `conversationActions.ts:213`; switch flush-before-bump `conversationActions.ts:89`. `flushThenBump` (`historyWrite.ts:95-103`) still has **no production caller** — see Section 4.3. | **Yes, replaced.** Test: `src/host/historyWrite.test.ts:78,91,107,119,131`. Grep changed: `getEpoch() !== opts.epoch` (old `Chat:619,629`) → **`epoch !== stamped` = 2, both `historyWrite.ts:80,86`**. |
| 2 | Hash symmetry (7 old callers; 3 raw) | **REPRODUCED at 5 sites** — `useHistoryFlushes.ts:120-127`, `sendFinalize.ts` turn-end (now ~:157-162, shifted by the failure fields), `modelSwitch.ts:153-159` (raw), `conversationActions.ts:98-105,158-165` (raw ×2). Raw readers still exactly 3 (old `App:2391,2453,4536`). **Lost:** old `Chat:2161` (background-discard hash) — lifecycle unmounted; old's two turn-end saves (`Chat:2981,3054`) folded into one finalize. | Frozen-hash test exists: `src/engine/sessionPersistence.test.ts:179`. Grep rule holds: no `src/host/**` caller hashes a live `Message[]` (persistable via `historyMessages.ts:37-41`, raw via `readBootMessages`). No new-side hash test. |
| 3 | `updateMessage` guards (9 sites) | **REPRODUCED** as the turn fence: run patches `fence.apply`-wrapped at `sendCallbacks.ts:42` (+ the new fenced `onFailedReason` `:76-81`), `sendHost.ts:144,164,186,268` region, `sendStop.ts:65`, `sendFinalize.ts:76`; load-path resets `useHistoryHost.ts:153,192` epoch-fenced by `:144`. `updateMessage` does not exist in `src/host/**`. | **Replaced.** Test `src/host/turnGuards.test.ts:4-55`. Grep → **28 non-test `fence.*` sites** (was 27; `sendCallbacks.ts` 12, `sendHost.ts` 8, `sendFinalize.ts` 3, `sendStop.ts` 3, `useHostEffects.ts` 2). |
| 4 | Run-id + generation lifecycle | **REPRODUCED** as fence ops: `beginRun` `sendHost.ts:120`; `invalidate` `useHostEffects.ts:81,111`; `retire` `sendStop.ts:62`; regenState locks still honored (`sendHost.ts`, `useHostEffects.ts:124-127`). | Partly. Retire test `turnGuards.test.ts:61-70`. **The named watchdog test still does not exist** (no fake-timer watchdog test in `src/host/**`). Old greps dead: `regenGenerationRef.current +=` → 0 in `src/host/**`; `++sendRunIdRef` → 0. Replacement counts: `beginRun` 1, `invalidate` 2, `retire` 1. |
| 5 | Abort path (7 old sites) | **REPRODUCED (3 of 7)** — stop `src/host/sendStop.ts:46`, conversation change `useHostEffects.ts:78`, unmount `useHostEffects.ts:109` (all three files untouched since 3777479). Not reproduced: background (`Chat:2103,2134`), clearChat (`Chat:3230`), edit (`Chat:3359`). Ordering note stands: new conversation-change abort runs after the flush (`conversationActions.ts:89` → effect `useHostEffects.ts:78`). | Replaced. Old grep (7) → **2 + `sendStop.ts:46`**. Identity-guard property covered by `turnGuards.test.ts:4-28`. |
| 6 | Stop watchdog (3 s) | **REPRODUCED** — `sendStop.ts:47-96` (file unchanged); drop-on-clear = `fence.invalidate()` + watchdog clear `useHostEffects.ts:81-89`. | **No** named watchdog test. Grep `stopWatchdogRef` → `sendHost.ts`, `sendStop.ts:21,49-96`, `useHostEffects.ts:30,83-89,112-116`, `HostRoot.tsx:163`. |
| 7 | History load + guard | **REPRODUCED** — `useHistoryHost.ts:143-249` (bump `:144`, begin `:172`, re-checks `:166,199`, settle `:196`, alerts `:206,217,227` + throw `:179`, lossy flush `:235-244`). | Partly. `sessionPersistence.test.ts:224` exists; **the named corrupt-raw/quarantine test still does not exist** against the host load path. |
| 8 | Four save FIFOs | **REPRODUCED (3 of 4 + engine untouched)** — index `.then(run, run)` `useConversationHost.ts:79`, library `libraryHost.ts:97`, turn-end `settleHold` + 10 s fallback `sendFinalize.ts:131-147` (`:39,:138`); engine FIFO untouched. `turnEndSavePromiseRef`/`sendInFlightPromiseRef` not lifted (`sendFinalize.ts:14-17`; only old reader was background discard `Chat:2112-2115`). | Test **no**. Grep `.then(run, run)` → **5 repo-wide** (`useConversationHost.ts:79`, `libraryHost.ts:97`, `App:1066,1248`, `src/notes/NotesStore.ts:189`). |
| 9 | Epoch-stamped in-flight turn persistence | **REPRODUCED** — debounce `useHistoryFlushes.ts:53-63` (stamp `:57`), 10 s `:65-84` (`:83`), AppState `:87-131` (`:91`, landing-keyed save `:117-127`), unmount flush-before-abort `useHostEffects.ts:104-118`, turn-end `sendFinalize.ts:124-166`. | Named tests still **do not exist as such**; covered indirectly `historyWrite.test.ts:78-105`. `getEpoch` shim now `HostRoot.tsx:137`. |
| 10 | Engine lifecycle | **REPRODUCED for load+boot; NOT REPRODUCED for the background machine.** Load `engineEnsure.ts:38-271`, `engineEnsureLoad.ts:56-281`, `engineLoad.ts:104-231`; boot `usePipelineScans.ts:94-140,141-166`; thermal hook moved to the seam: `src/host/turnRefs.ts:47-57` (was `HostRoot:60-63`). **Still not lifted:** background/foreground discard (old `App:3026-3526`) and thermal edge effect (old `App:3672-3748`) — greps still 0. | Replaced. `ensureEngineForModelRef.current =` → **2**: `useModelHost.ts:202` + `App:4446` (+ comment `engineEnsure.ts:7`). Named fit/foreground test still **does not exist**. |
| 11 | `handleSendStream` + one bridge | **REPRODUCED**, same seam split: `engineTurn.ts:53-332` (+1 line: the §2.8 failure-reason hook `:118`), `engineTurnWindow.ts:38`, `engineTurnCompactor.ts:47`, `engineTurnSlide.ts:39`, `engineTurnStream.ts:38`, `engineTurnMemory.ts:41`. | **Yes.** `src/app/engineCallbackBridge.test.ts` green-by-existence. Grep **`bridgeEngineCallbacks(` = 2 call sites** (unchanged): `App:6630` + `src/host/engineTurnStream.ts:238` (+ def `engineCallbackBridge.ts:41`, test `:31`). |
| 12 | Model index storage | **REPRODUCED** — key `modelSwitch.ts:43`, write `:121`, boot read `usePipelineScans.ts:100`, `modelIndexRef` `useModelHost.ts:71-73`, hash re-save `modelSwitch.ts:149-161`. | Replaced. Grep `MODEL_STORAGE_KEY` → **8 matches / 4 files** (unchanged): `App:405,2948,4501`; `modelSwitch.ts:43,121`; `usePipelineScans.ts:40,100`; `useModelHost.ts:37`. |
| 13 | Conversation index store | **REPRODUCED** — `useConversationHost.ts:67-144`; switch `conversationActions.ts:82-117`; delete `:177-219`; touched `:232-246` (file unchanged). | Partly. Named switch-flush test **still absent**; delete-order tests exist (`conversations.test.ts:84-100`, `historyWrite.test.ts:107-141`). `bumpPersistEpoch` passed `HostRoot.tsx:113`, called once `conversationActions.ts:213`. |
| 14 | Tool-flag persistence + refs | **REPRODUCED + the toggle restored** — state+ref mirror `toolFlags.ts:41-64`, refresh `:66-84`, **`toggleWebTools` `:90-99` (CHANGED since 3777479 — it did not exist then)** with the controller's key write `:94`; refs read mid-run `agentTurnOptions.ts:209,220,227`; wiring `HostChatSurface.tsx:145-146`. | Replaced + tested. Old grep `staticPrefixNotifySkipRef.current = false` → `staticPrefixNotify.ts:12-20 skipNext`, test `staticPrefixNotify.test.ts:4-15`; **new test `toolFlags.test.ts`** covers the toggle; notify-on-change-but-not-mount rides the existing wiring (toggle flips → `useHostEffects.ts:65-73` deps change). |
| 15 | Voice state | **NOT REPRODUCED** (beyond presence scan + TTS toggle). | Old check cannot exist by design: `voiceRunIdRef` → old file only; 0 in `src/host/**`. |
| 16 | Share-in | **NOT REPRODUCED** — no `Linking` listener / `shareIntent` import (row 2's `Share` sheet is export-out only). | Nothing to run against: named test has no target; grep = 0. |
| 17 | Notices — not a queue | **REPRODUCED** — `useNotice.ts:19-24`, render `HostNotice.tsx:16-36` (mounted `HostFurniture.tsx:93`). | Grep `setNotice(` → **2, both `useNotice.ts:20,22`**; old `App:3548,3550`. No queue. |
| 18 | Memory banner (set-only) | **NOT REPRODUCED — by decision, reported** (`memoryHost.ts:6-8`, `engineEnsure.ts:14-18`). | Old grep still true (`App:3021` only); nothing against new code. |
| 19 | Compactor/digest per-chat maps | **REPRODUCED** — `turnCorpus.ts:23-45,45,106-186`, reset on delete `conversationActions.ts:183`, KV load `engineTurnCompactor.ts:47+`. | Grep `resetCompactorChat(` → **8 repo-wide, 3 calls per app** (unchanged): new `turnCorpus.ts:179` + `engineTurn.ts:275`, `engineTurnCompactor.ts:112`, `conversationActions.ts:183`; old `App:769` + `:2476,5776,6048`. |
| 20 | Notes-context injection | **REPRODUCED and now REACHABLE** — **CHANGED since 3777479 (was "trigger missing")**: the notes chip arms `notesRef` (`composerArms.ts:73-77` toggle), `sendHost.ts:155-162` captures it and `sendHost.ts:247` hands `{research,notes}` to the engine half, so `engineTurn.ts:247-256` (cap `notesContext.ts:5`, injection same point as old `App:5749`) runs. **Residual:** the branch's `onNotice` has no consumer — `sendHost.ts:230` reads a field `armsSendOptions` never sets (row 40 / row 14). | Grep `loadNotesContext(` → **4 repo-wide, 2 per app** (`App:416,5749`; `notesContext.ts:10`, `engineTurn.ts:249`). Reachability now satisfied; new test for the arms→options path: `composerArms.test.ts`. |
| 21 | Static-prefix skip-once | **REPRODUCED + TESTED** — `staticPrefixNotify.ts:12-20`, wired `useHostEffects.ts:65-73`, test `staticPrefixNotify.test.ts:4-15`. A strip toggle now exercises the change path (row 14). | Yes — named rule tested. |

### Greps whose meaning changed (verified counts at `e2b3aeb`)

| Grep (old meaning) | New reality |
|---|---|
| `bridgeEngineCallbacks(` = 1 | **2 call sites**: `App:6630`, `src/host/engineTurnStream.ts:238` (+ def `engineCallbackBridge.ts:41`, test `:31`) — unchanged since 3777479 |
| `ensureEngineForModelRef.current =` = 1 | **2 assignments**: `App:4446`, `src/host/useModelHost.ts:202` (+ comment `engineEnsure.ts:7`) |
| `MODEL_STORAGE_KEY` = 2 sites | **8 matches / 4 files**: `App:405,2948,4501`; `modelSwitch.ts:43,121`; `usePipelineScans.ts:40,100`; `useModelHost.ts:37` (per app: 1 read + 1 write) |
| `getEpoch() !== opts.epoch` (`Chat:619,629`) | `epoch !== stamped` — **2, both `src/host/historyWrite.ts:80,86`** |
| `updateMessage(` / `regenGenerationRef.current +=` / `++sendRunIdRef` | **0 in `src/host/**`** — fence: **28** `fence.*` sites (was 27 at 3777479; `sendCallbacks.ts` 12); `beginRun` 1 (`sendHost.ts:120`), `invalidate` 2 (`useHostEffects.ts:81,111`), `retire` 1 (`sendStop.ts:62`) |
| `abortRef.current?.abort()` = 7 | **2** (`useHostEffects.ts:78,109`) + `sendStop.ts:46` direct |
| `.then(run, run)` | **5 repo-wide**: `useConversationHost.ts:79`, `libraryHost.ts:97`, `App:1066,1248`, `NotesStore.ts:189` |
| `setNotice(` | new app: **2, `useNotice.ts:20,22`**; old `App:3548,3550` |
| `bumpPersistEpochRef.current?.()` = 1 | injected fn: passed `HostRoot.tsx:113`, called **once** `conversationActions.ts:213` |
| `resetCompactorChat(` | **8 repo-wide** (3 calls per app) |
| `loadNotesContext(` | **4 repo-wide** (def+call per app) |
| `toggleWebTools` (absent in new tree at 3777479) | **now 2 apps**: old `App:878` (def), `:6926` (use); new `toolFlags.ts:90` (def), `HostChatSurface.tsx:146` (use) |
| `keyboardShouldPersistTaps` (`Chat:4025,4146`) | still **old-only** — 0 in `src/ui/**` + `src/host/**` (row 45 / row 12b) |
| `staticPrefixNotifySkipRef.current = false` | old-only (`App:2360`); new `staticPrefixNotify.ts:15 skipNext` |
| `voiceRunIdRef`, `memoryBannerKey` | old-only |
| `shouldShowLongChatNudge` | old-only (`Chat:155,1321`) — Section 4.4 |

---

## Table 3 — Gaps still open, ranked by what a user notices first

(Resolved since the `3777479` walk are listed after the table; those rows now carry their
new verdicts in Table 1.)

| # | Gap | What is lost | Old location | Size to restore | In PARITY already? |
|---|---|---|---|---|---|
| 1 | **Every message interaction gone** | Long-press menu (copy/flash, save-to-notes, translate, edit, regenerate, cancel), inline chips (copy, read-aloud, more), edit modal, translate block, read-aloud, save-to-notes, regenerate | `Chat:4385-4496, 4500-4581, 3481-3599, 3533-3582, 1613-1660, 5419-5434, 5593-5624`; `App:3749-3763` | ~500–600 lines (modal + handlers + TTS glue) | **Carried** — D1 rows 15-21 (all ✗) |
| 2 | **Attach and mic are honest dead buttons; attachment + voice pipelines absent** (the toolbar's document chip is stubbed on the same hole) | Attach sheet, image/PDF/docx import, context chips, whisper dictation, voice status/toast, voice cleanup | `Chat:1661-1833, 4222-4247, 1515-1611, 4299-4314, 1412-1426`; `App:5155-5320` | attachments ~173 + sheet glue; voice ~307 + download block ~158 | **Carried** — D1 rows 7, 29-32, 43 (stubs toast per §2.7) |
| 3 | **Model bar lost its status life** | Download %, thin progress bar, error+hint lines under the strip, battery ETA line — the pill is name+where only | `App:6971-7008, 6746-6788, 2625-2712, 2758-2830` | model-bar ~130 + notify ~88 + battery ~40 | **Carried** — D1 rows 33-36 (◐/✗) |
| 4 | **No downloads at all** | Model / Whisper / embedding downloads, progress, notifications, confirm dialog — Settings buttons toast `shell.notice.download` / `voiceDownload` / `embeddingDownload` (`HostOverlays.tsx:178,190,199`) | `App:4657-5154` (442), `App:5155-5312` (158) | the download pipeline (~600) | **Carried** — D1 rows 31, 34 (✗) |
| 5 | **Share-in dead** | Android `url` intent prefill, .txt/.md/PDF import, busy/too-large/failed notices (export-out landed; this is import-in) | `App:3553-3671`, `shareIntent.ts:37` | ~119 lines | **Carried** — D1 row 41 (✗) |
| 6 | **The voice-note toast — now load-bearing** | Not just the old transient voice note: a truncated 24 000-char notes context calls `sendOpts.onNotice?.()` (`engineTurn.ts:253-255`) into an always-undefined slot (`sendHost.ts:230`) — with notes armed (row 14) the truncation now happens and informs **nobody** | `Chat:1329-1338, 4299-4314` | ~40-60 lines (second toast system + wire `onNotice` through `armsSendOptions`) | **Partly new** — D1 row 40 carries the toast (✗); the notes-truncation consequence is **added here** |
| 7 | **CTA buttons never render** though capture+persist work — a restored answer carries ctas nobody can press | Visible action buttons on answers | `Chat:5764-5790` | renderer ~27 + mapper field | **Carried** — D1 row 26 (✗) |
| 8 | **Mini-app card + sheet unreachable** | Interactive mini-apps render nowhere; overlay kind deleted (`hostOverlay.ts:7-16`); engine still produces them (`historyMessages.ts:139-148`) | sheet `App:7214-7252` (~38), card `Chat:6033-6093` (~60) + mapper field | ~100 + sheet chrome re-expression | **Carried** — D1 rows 4, 28 (✗) |
| 9 | **Keyboard & focus cluster** | persona-row `Keyboard.dismiss` (1 line); `keyboardShouldPersistTaps="handled"` on the transcript — without it the welcome cards, source chips and any transcript control swallow their first tap while the keyboard is up (old `Chat:4025,4146`); `focus()` after template choose and tap-to-focus (old `Chat:3637,4329-4331`) | `App:7104`; `Chat:4025,4146`; `Chat:3637,4329-4331` | 1 line + 1 prop + a small inputRef/focus path (~20) | **Carried** — D1 rows 1, 45, 46 (◐/✗); the card inheritance is **added to rows 12/45** |
| 10 | **The suggestion cards lost their second hue** | Old two-tone icon tiles (`compute`/`accent`) — `compute` now resolves to the neutral tile, so cards 1 and 4 read flat next to 2 and 3 | `Chat:429,451` (colour keys), old palette compute hue | one palette token + the `welcomeCopy.ts:27-30` mapping (cosmetic) | **Not carried as a row** — **added to row 12(a)** from the slice's finding |
| 11 | **kb-debug badge gone** (dev-only) | The keyboard-debug overlay behind `kalsa.kbDebug` | `Chat:865-904, 4668-4691` | ~40 lines | **Carried** — D1 row 50 (✗, keep/drop pending) |
| 12 | **Memory banner** — set-only in the old app, dropped by decision | Nothing visible (never rendered) | `App:3021` + setters | owner decision, ~0 | **Carried** — D1 row 38 / D2 row 18 (decision) |

**Resolved since `3777479`** (former gaps 1, 2, 3, 12 and part of 9): first screen → row 12
DIFFERENT; caret + failed/interrupted markers → rows 9/10/25 IMPLEMENTED; export/share →
row 2 IMPLEMENTED; `PdfTextExtractorHost` mounted → `HostFurniture.tsx:95` (was Section 4.2);
research/notes chips + quick templates → rows 13/14 (document chip still stubbed, gap 2).

---

## Section 4 — behaviour no PARITY row covers (so the new code probably dropped it)

**Current findings (unchanged since 3777479 unless noted):**

1. **The painted background is gone.** Old root renders `<PainterlyBg />` (`App:6849`,
   component `src/theme/components/PainterlyBg.tsx:10`); `grep PainterlyBg` over
   `src/host/**`, `src/ui/shell/**`, `App.tsx` = 0 (re-verified at `e2b3aeb`). PARITY names
   it only inside D3a's JSX row (`docs/PARITY.md:160`) — no D1 row demands it.

2. ~~`PdfTextExtractorHost` never mounted~~ — **RESOLVED** at `e2b3aeb`: mounted unkeyed in
   `src/host/HostFurniture.tsx:95` (old `App:7257`), header cites this file's earlier gap 12.

3. **The old strip's "New chat" and the drawer's "New chat" were different behaviors; the
   new strip runs only the drawer's.** Old nav new-chat called `clearChat` (`Chat:3949`,
   `:4004` → `Chat:3219-3328`: synchronous abort → flush → epoch bump → wipe of messages/
   draft/attachments/modes/voice/translate/menu, then `onNewConversation()` at
   `Chat:3318-3322`). New strip (`HostRoot.tsx:201`) + drawer (`HostDrawer.tsx:58`) both
   call `handleNewConversation` (`conversationActions.ts:119-172`): flush + switch, no
   synchronous multi-system reset (the reset that exists — draft/arms/tools — runs later via
   `HostRoot.tsx:85-90`; abort after commit `useHostEffects.ts:78`). D2 row 1's "clear
   flushes before bump" still has **no production caller**: `flushThenBump`
   (`historyWrite.ts:95-103`) is exercised only by `historyWrite.test.ts:107`.

4. **The 180-second foreground idle dispose never runs.** Old assigns
   `bumpForegroundIdleRef.current` (`App:3311`) and bumps at turn/download start
   (`App:4676,5417`), consulting `shouldRunForegroundIdleDispose` (`App:3284`; constant
   `FOREGROUND_IDLE_DISPOSE_MS` `src/app/foregroundIdleDispose.ts:4`). The new host calls the
   ref (`src/host/engineTurn.ts:134`) but **nothing ever assigns it**
   (`src/host/hostDeps.ts:132-137`). PARITY never names idle dispose; D2 row 10 carries only
   the discard machine. Battery/thermal consequence on the campaign rig.

5. **The long-chat nudge is gone.** Old one-shot: state `Chat:921-922`, effect
   `Chat:1314-1327` over `shouldShowLongChatNudge` (`src/chat/longChatEstimate.ts:132`);
   new tree 0 hits; `useHistoryHost.ts:13` admits dropping only the reset. Carried only as a
   D3b unit (`docs/PARITY.md:184`), no D1 row.

6. **`/bench …` / `bench:…` debug commands no longer intercept.** Old `Chat:2317-2330` /
   `src/bench/benchConfig.ts:824,848`; new send has no branch (`grep isBenchCommand` in
   `src/host/**` = 0; reported `sendHost.ts:7-8`). PARITY has zero bench rows.

7. **Ordering nit (D2 rows 5/13):** new conversation switch/delete flushes **before** it
   aborts the live send (`conversationActions.ts:89` → `useHostEffects.ts:78`), where old
   `clearChat` aborted first (`Chat:3231`). Fence ownership makes it state-safe; the flush
   now deliberately persists a still-streaming snapshot.

**Findings folded in from the two new slices (each changes a verdict or prevents a false one):**

8. **Palette lost the second hue the old suggestion cards used** → row 12(a) DIFFERENT:
   `welcomeCopy.ts:18-22` reports `compute` has no hue; single accent `design.ts:38-42`;
   old two-tone cards `Chat:429,451`.

9. **The greeting's name suffix is dead in the controller too** → NOT a gap (row 12(c)):
   `App:7014` passes `userName={null}`, so old `Chat:4078-4080` never rendered `, name`.

10. **A truncated notes context now informs nobody** → row 14 residue + gap 6: branch runs
    (`engineTurn.ts:253-255`) but `armsSendOptions` (`composerArms.ts:30-36`) returns no
    `onNotice`, so `sendHost.ts:230` is always `undefined` while row 40's toast is missing
    (reported `sendHost.ts:12-14`).

11. **The suggestion cards inherit the tap-through-keyboard gap** → rows 12(b)/45: the
    transcript ScrollView still has no `keyboardShouldPersistTaps` (0 hits; old
    `Chat:4025,4146`); the new pressables inside it (cards, source chips, jump pill) swallow
    their first tap while the keyboard is up.

12. **Restoring the web chip changed the strip contract** → row 5 DIFFERENT, not
    IMPLEMENTED: old chip 36×22 on `hitSlop` (`App:6926-6959`) violated the 48 dp rule; the
    new labelled 48 dp box forced the geometry to budget four icon buttons — pill 154 → 97 dp
    (`shellGeometry.ts:204-211`, pinned `stripWebSwitch.test.ts:3-9`).

13. **The notes branch of the send path is now reachable and armed** → D2 row 20 flips to
    REPRODUCED: chip → `notesRef` → `sendHost.ts:155-162,247` → `engineTurn.ts:247-256`.

---

## Could not determine (and which file decides it)

| # | Question | Deciding file |
|---|---|---|
| 1 | Whether the e2e/campaign harness ever types `/bench` or `bench:` into the composer (would make Section 4.6 harness-critical) | `scripts/ci-e2e.sh`, `scripts/ci-dflash-ab.sh`, any `scripts/campaign/*` sender |
| 2 | Whether the owner wants the old `compute` hue restored for the suggestion cards, or the single-hue palette accepted as the answer (row 12(a) is a verdict either way) | `src/theme/design.ts:38-42` + `src/host/welcomeCopy.ts:18-22` |
| 3 | Whether the owner wants `clearChat`'s flush→bump→synchronous-reset order re-expressed as a production caller of `historyWrite.flushThenBump` (`historyWrite.ts:95`), or accepted as flush + load-effect bump | `src/host/conversationActions.ts:119-172` + `src/host/useHistoryHost.ts:144` |
| 4 | Whether idle-dispose (Section 4.4) is scheduled with the background-machine lift or dropped by decision | `src/app/AppShell.tsx:3026-3526` + `src/app/foregroundIdleDispose.ts` |
| 5 | Test results — no jest was executed in this walk (read-only pass); all test claims are existence-only | run `npx jest src/host src/ui/shell` when the machine is free |
| 6 | Minor: PARITY's `keyboardShouldPersistTaps` line refs (`Chat:4029-4030`) are drifted; actual lines `Chat:4025,4146` | `src/screens/AiChatPage.tsx:4025,4146` |
