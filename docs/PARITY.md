# PARITY — walk the OLD files against the new code

The owner's rule: `src/app/AppShell.tsx` (7261 lines) and `src/screens/AiChatPage.tsx` (6092) are
the CONTROLLER for the rewrite. This document is the checklist that makes that possible.

How a checker uses it: take Deliverable 1 row by row, find the new implementation of each
capability under `src/ui/shell/**` (or wherever the new shell mounts), and mark missing rows as
parity defects. Deliverable 2 lists the state and side-effect paths where a wrong rewrite
corrupts history or loses a message — each row names the test or grep that proves reproduction.
Deliverable 3 is the module map (sizes and seams) so the cut into ≤350-line files is not a guess.
Status vocabulary for row 3 of D1: **✔** equivalent exists · **◐** partial (component named) ·
**✗** nothing. Shorthand: `App` = `src/app/AppShell.tsx`, `Chat` = `src/screens/AiChatPage.tsx`,
`Shell` = `src/ui/shell/Shell.tsx`. Line references are as verified on branch `ux-2026-09-21`.

## Deliverable 1 — feature parity checklist

| # | What the user sees / does | Old location | State / service it needs | New shell (`src/ui/shell/**`) |
|---|---|---|---|---|
| **Chrome & navigation ||||
| 1 | Conversation drawer: list, tap to switch, long-press → confirm delete, new-chat, persona row, search box (180 ms debounce), keyboard dismissed on every row press | App:7083-7105; open state App:2367; items App:2549-2624; delete confirm App:2516-2529; search App:1028-1046, debounce const App:460; dismiss App:2576,2588,2599,2610,7104 | conversations store, `chatSearch`, overlay union | ◐ hook only: `onMenuPress` Shell:66,131-142; the drawer itself is `src/theme/components/Drawer.tsx:56` (call, don't rebuild) |
| 2 | Chat header: menu, export/share chat, new chat | Chat:4730-4741 (menu), 4757-4769 (export), 4771-4781 (new); `exportChat` Chat:3206-3218 | Share API | ◐ menu + new-chat on strip (Shell:131-142,165-172); export missing (✗) |
| 3 | Eight exclusive overlays: settings, account, pro, help, documents, notes(+focusId), personas, miniapp | union App:394-404; state App:2369-2370; mounts App:7111-7252; miniapp precedence policy App:7035-7045 | `activeOverlay`, screens, keyboard | ✗ (no overlay concept in `src/ui/shell`) |
| 4 | Mini app as transcript card **and** full-screen sheet with header + close | card Chat:6033-6093, rendered Chat:5665; open prop Chat:350 → App:7035-7046; sheet App:7214-7252; stream capture Chat:2674-2679; block actions App:5346-5362 | `message.miniapp`, `onMiniappRef` App:1004, renderer | ✗ (renderer exists: `src/ui/AskAssistantMiniappRenderer.tsx`) |
| 5 | Permissions: Web switch in the top bar (persisted), device/calendar only inside Settings, static-prefix notice on change | switch App:6926-6959, persist App:861-887, key write App:882; refresh App:896-916 (keys App:866,899-900); notify-on-change App:2357-2366 | tool-flag state **and** refs (engine reads ref App:2233) | ✗ |
| **Composer & sending ||||
| 6 | Composer field: typing, focus, tap-on-transcript to focus, held-placeholder states (the §2.7 counterexample) | field Chat:4330-4344; tap-to-focus Chat:4329-4331; KAV + `kbPad` lift Chat:858-862, 3935-3940; `editable` bug Chat:4337-4339 | draft, `sending`, keyboard height | ◐ field chrome Shell:203-212 (local draft Shell:113, non-functional by contract Shell:8-10); keyboard solved by inset (Shell:100-110, `useKeyboardHeight`) |
| 7 | Action row: templates ✦, attach, mic (3 voice states), send⇄stop glyph swap, per-control disabled | Chat:4783-4942 (attach disabled rules 4841, mic 4866-4917, send/stop 4918-4941) | `sending`, `voiceUi`, `pdfToRender`, `canSend` | ◐ buttons exist non-functional Shell:190-246; **pure layer built and unmounted**: `composerState.ts:109-157` (phases/faces/holds) has **zero importers** (grep of `src` returns only self + its test) |
| 8 | One `canSend` boolean (draft/attachments/sending/translate/history/voice/thermal/pdf) | Chat:3601-3624 | 8 inputs | ◐ replacement pure logic `composerState.canSend` composerState.ts:150-151 (unmounted) |
| 9 | Streaming caret after last segment | import Chat:132; `showCursor` Chat:5484, 5559-5576, 5275+201 (`m.streaming`) | `m.streaming` flag | ✗ (grep `caret|streaming` in `src/ui/shell` = empty) |
| 10 | Stop: abort, 3 s watchdog, interrupted marker on partial; empty placeholder dropped; thermal refusal note; failure text row | `handleStop` Chat:3141-3205 (watchdog 3151-3204, drop-empty 3176-3180, mark 3181-3190); interrupted row Chat:5627-5630; thermal Chat:2184-2186 + edge effect App:3673-3748; failure Chat:2774-2779 | `abortRef`, run-ids, `inferenceBlocked` | ◐ all four outcomes decided purely in `composerState.ts:214-270` + phase table 109-136 — **unmounted**; no renderer |
| 11 | Send path (fit gate → claim → stream → turn-end save) | `handleSend` Chat:2177-3122, tracked wrapper 3123-3140, entry Chat:3664-3680; engine half `handleSendStream` App:5363-6719 | run-ids, guard refs, engine | ✗ host wiring missing (`onSendOrStop` prop only Shell:71) |
| 12 | Empty state: photo, hour greeting, welcome line, 4 suggestion cards that send | raster Chat:191-194, `showEmptyArt` Chat:967, gate on `historyLoaded` Chat:4015-4016, block Chat:4017-4131, suggestions Chat:423-453, send Chat:4095-4111 | `messages`, `historyLoaded` | ✗ (Shell renders `children` only, Shell:181-186) |
| 13 | Quick templates sheet | state Chat:925; `QuickActionSheet onlyTemplates` Chat:4375-4380; choose→draft+focus Chat:3633-3641; entry ✦ Chat:4821-4837 | `quickSheetVisible` | ✗ (component `src/theme/components/QuickActionSheet.tsx` to call) |
| 14 | Research chip, library-document chip, notes chip; auto-clear when the draft empties | Chat:4189-4221 (research 4194, doc 4203, notes 4211); toggles Chat:3642-3653; auto-clear effect Chat:1264-1273 | `researchMode`, `notesMode`, library | ✗ |
| **Message actions ||||
| 15 | Long-press (350 ms) message menu: copy (+400 ms "Copied!" flash), save-to-notes, translate, edit (user, idle), regenerate, cancel | call sites Chat:5332-5334, 5395-5398, 5523-5526; `openMessageMenu` Chat:3481-3505 (refs-only closure trap 3484-3487); modal Chat:4385-4496 (copy 4416-4435, notes 4437-4445, translate 4447-4454, edit 4456-4466, regen 4468-4486) | `messageMenu`, refs to avoid memo freeze | ✗ |
| 16 | Inline chips under a message: copy, read-aloud/stop, "more"; copied flash | Chat:5419-5434 (user), 5593-5624 (assistant), flash text Chat:4412, `copiedFlash` Chat:1307 | clipboard, `speakingId` | ✗ |
| 17 | Edit-then-resend modal | modal Chat:4500-4581; `editMessage` Chat:3329-3465 (busy guard 3343-3347) | regen guards | ✗ |
| 18 | Translate a message → translation block, expand/close, abort, orphan cleanup | `runTranslate` Chat:3533-3582; refs Chat:1308-1319; blocks Chat:5466, 5650; cleanup effect Chat:1951-1957 | `translationResult`, engine translate | ✗ |
| 19 | Read aloud / stop reading | `handleReadAloud` Chat:1613-1660; `speakingId` Chat:934; chip Chat:5601-5616 | TTS service, `ttsEnabled` | ✗ (mic hook only Shell:213-224) |
| 20 | Save message to notes + confirmation notice | App:3749-3763 (saveNote + `showNotice`) | NotesStore, notice | ✗ (`src/notes/NotesStore.ts` to call) |
| 21 | Regenerate from a target turn | Chat:4468-4486 (failure toast 4476); target logic `src/screens/regenTarget.ts` (import Chat:97) | `regenState` module | ✗ (`src/engine/regenState.ts:42-73` is the guard file) |
| 22 | Source chips under an answer (horizontal row, safe-URL check) | persist Chat:713-731; render Chat:5672-5697 (URL check 5680-5681); provider colours Chat:5213-5225 | `m.sources` | ✔ `TranscriptEvidence.tsx` + `sourceLinkPolicy.ts` (host mapper pending) |
| 23 | Tool rows for the running answer (volatile — deliberately not persisted) | name **dropped** at Chat:2623-2651; bridge forwards at App:6630 (`src/app/engineCallbackBridge.ts:65`); volatile rule Chat:709-713 | `payload.kind==="tool"` capture that doesn't exist | ◐ leaf exists (`TranscriptEvidence.tsx`, `toolLabels.ts`); capture branch is the host step |
| 24 | Thinking status chip + status history during generation | status callback Chat:2601-2614; render Chat:5509, `showThinking` 5275+210; engine owns thinking→writing Chat:2547-2550; volatile Chat:709-713 | `m.statusLabel` | ✔ (different representation: thought cloud `src/ui/thinking/` + `TranscriptThinking`; statusHistory is intentionally volatile) |
| 25 | Error rows: engine reason in the message, content-filter line, interrupted line | failure text Chat:2774-2779; `contentFilterMessage` Chat:532-558; interrupted Chat:5627-5630 | `m.text` / `m.interrupted` | ✗ |
| 26 | CTA buttons on answers (and CTA arrival during stream) | render Chat:5764-5790; stream `onActions` → ctas Chat:2628-2650, self-append 2652-2661; persist validation Chat:799-807; **host press is a no-op** App:7047 | `m.ctas` | ✗ (parity today = rendering only; press does nothing in the old app either) |
| 27 | Day divider between days | Chat:3886-3887, labels Chat:511-531 | `createdAt` | ✔ `transcriptLayout.ts:46` + `Transcript` |
| 28 | Mini-app card inside a message | Chat:5665, `MiniappCard` Chat:6033-6093 | `m.miniapp` (normalized on restore Chat:731-734) | ✗ |
| **Voice ||||
| 29 | Mic: listen → transcribe → prefill; per-phase a11y labels; disabled while sending/transcribing | `handleMicPress` Chat:1515-1611; `stopAndTranscribe` Chat:1354-1411; button Chat:4866-4917; phase reducer import Chat:151-153 | voice run-ids, Whisper | ◐ mic button chrome Shell:213-224 only |
| 30 | Voice status row + transient voice-note toast above the composer | Chat:4299-4314; `showVoiceNote` Chat:1329-1338 | `voiceUi`, `voiceNote` + timer Chat:951 | ✗ |
| 31 | Whisper download, TTS toggle, voice-ready gate | App:5155-5295, `handleToggleTts` App:5313-5320, wiring App:7024-7025, 7139-7148 | `voiceState` App:3530-3533 | ✗ (Settings overlay UI) |
| 32 | Voice cleanup on unmount/conversation change | Chat:1412-1426, invalidate Chat:1339-1353 | timers, capture cancel | ✗ |
| **Model bar / status strip ||||
| 33 | Top bar model chip: `name · quant · status`; tap = download if missing, retry if error, load if ready; disabled while downloading/loading/checking; hung = inert | chip App:6873-6911; status calc App:6746-6788; % App:6720; `modelErrorHint` App:6725-6745 | `modelState`, engine, downloads | ◐ strip pill Shell:145-164 shows name + where, `onModelPress` Shell:67 — no states |
| 34 | Thin download progress bar; download % handed to Settings; download notifications (2 s throttle) | bar App:6971-6985; App:7126; notify App:2625-2712 (throttle const App:459) | `download` App:2831, abort App:2995 | ✗ |
| 35 | Error + hint lines under the bar | App:6987-7008 | `modelError*` App:2832-2836 | ✗ |
| 36 | Advisory battery ETA line (≤50 % charge, model loaded) | builder App:2793-2830, render App:6921 | `useBatteryEta` App:2758 | ✗ |
| 37 | Web on/off switch (same as row 5) | App:6926-6959 | see row 5 | ✗ |
| 38 | Memory banner — **declared and set, never rendered** (invisible today) | only declaration App:3021; setters App:3124, 3483, 3488, 4424, 5044; chat prop App:7028 (grep `memoryBannerKey` matches only these) | fit reason keys | ✗ — owner decision: render it or drop it |
| **Toasts, share, micro ||||
| 39 | Notice toast (single slot, 4 s, absolute bottom:96) | App:3547-3552, timer App:857-860, render App:7062-7077 | `notice` state | ◐ Shell has a `notice` row but it is preview-only **by contract** (Shell:55-61) |
| 40 | Voice-note toast (separate system, chat-local) | Chat:4299-4314 | `voiceNote` | ✗ |
| 41 | Share-in: text prefill (nonce re-merge), .txt/.md read with size caps, PDF import → auto-attach, busy/too-large/failed notices | parse `src/app/shareIntent.ts:37`; listener App:3638-3660; pending flush App:3661-3671; `applySharePayload` App:3567-3637; nonce/dedupe refs App:3559-3562; props App:7016-7018; chat merge Chat:1959-1969; doc attach Chat:3717-3722 | `Linking`, FileSystem, library | ✗ |
| 42 | History-guard Alerts (preservation failed / unreadable / partial count) | Chat:1082-1116 (+ lossy flush 1131-1140) | `historyGuard` | ✗ (host behavior, must ride the load path) |
| 43 | Attach/library/context chip rows (attached item shown) | Chat:4222-4247+ | `attachedItems` Chat:1249-1252 | ✗ (attachment chip pure shape exists composerState.ts:62-65, unmounted) |
| 44 | Inverted list sticks to bottom (≤48 dp) and auto-scrolls on growth | list Chat:4136-4142; `atBottomRef` Chat:964; scroll Chat:3841-3852 (`scrollToOffset(0)` at 3849) | scroll events | ✔ different mechanism, tested: `transcriptScroll.ts:91` + jump pill + pin machine |
| 45 | Keyboard dismissal on dismissible surfaces | drawer rows App:2576,2588,2599,2610,7104; `keyboardShouldPersistTaps` Chat:4029-4030 | `Keyboard` | ✗ (grep `Keyboard.dismiss` in `src/ui/shell` = empty) |
| 46 | Focus: field focuses after choosing a template; tapping the transcript focuses the field | Chat:3637, Chat:4329-4331 | `inputRef` Chat:965 | ✗ |
| 47 | Long-press delay 350 ms + a11y hint on messages | Chat:5333-5334, 5396, 5524 | — | ✗ (new pressables carry labels, Shell:133-139, but no long-press) |
| 48 | Haptics | **does not exist** — grep `Haptic|haptic|vibrat` over `src/**` returns nothing | — | nothing to preserve |
| 49 | Swipe-to-delete | **does not exist on the chat surface** — no `Swipeable|swipe` in either big file; deletion is drawer long-press App:2557; only drag-hold swipes are in `src/screens/DocumentsScreen.tsx:637-638` | — | nothing to preserve |
| 50 | Keyboard-debug badge (dev, `kalsa.kbDebug` key) | state Chat:865-871, updater Chat:892-904, key read Chat:882, render Chat:4668-4691 | AsyncStorage | ✗ — dev-only, decide keep/drop |

## Deliverable 2 — state & plumbing inventory (the risky half)

| # | State / path | Location | Trigger → writes | What a rewrite must reproduce — and how a checker proves it |
|---|---|---|---|---|
| 1 | **Epoch trio (verified)**: write is stamped at schedule *and* re-checked before `setItem` | checks Chat:616-630 (inside `persistMessagesNow` Chat:598-655); bumps: load Chat:1045, parent hook registration Chat:1185-1196 called at **App:2506**, clearChat Chat:3244 | conversation delete/switch/clear/load → a stale write becomes a no-op | Every delayed write carries `epoch` + `getEpoch` and drops itself when they differ; clear/delete **flush before bump** (Chat:3228-3240, App:2378). *Checker:* test — schedule a write, bump, assert `AsyncStorage.setItem` never called (assert on the `opts.getEpoch() !== opts.epoch` path, which must survive; grep `getEpoch() !== opts.epoch`). |
| 2 | **Hash symmetry (7 callers in these two files; 3, not 2, read raw disk records — the handoff undercounts)** | Chat:1475 (AppState flush), Chat:2161 (background-discard snapshot, inside `awaitLifecycleForBackgroundDiscard` 2099-2166), Chat:2981 + Chat:3054 (turn-end/failure `saveEngineSession`); App:2391 (switch), App:2453 (new chat), App:4536 (selectModel) — the three App sites hash `readBootMessages()` output, which is raw `AsyncStorage` JSON (`src/engine/sessionPersistence.ts:357-365`) | model/session lifecycle → `.kvs` fingerprint accepted or rejected at load (`sessionPersistence.ts:302,319`); definition hashes `JSON.stringify(toPersistableHistoryMessages(…))` `sessionPersistence.ts:243-245`; boot hash frozen once `sessionPersistence.ts:367-375` | Same field set on both sides; `src/engine/historyPersistable.ts` untouched (import Chat:111). *Checker:* frozen-hash test already exists (`src/engine/sessionPersistence.test.ts:179`, `FROZEN_204298F_HASH`); grep rule — every new caller hashes `toPersistableHistoryMessages` output, never the live `Message[]`. |
| 3 | **`updateMessage` guards — all 9 call sites verified guarded** | definition Chat:1970-2003; call sites Chat:2551, 2601, 2617, 2644, 2657, 2674, 2686, 2731, 2774 — every one passes `(myGen, runId)` | stream callbacks → patches to `messages` | Capture `myGen`/`runId` at run start (Chat:2254, 2308); refuse the patch if either token moved. *Checker:* test — bump `regenGenerationRef` mid-stream, deliver a token callback, assert `messages` unchanged; grep — count of `updateMessage(` call sites must equal count carrying `myGen`. |
| 4 | **Run-id + generation lifecycle** | `sendRunIdRef` Chat:1854; bumps Chat:1866, 1928, 2308, 3161, 3244; `regenGenerationRef` bumps Chat:1867, 1929, 3162, 3264; module singletons `src/engine/regenState.ts:42-50` (`regenInFlightRef`, `sendClaimRef`, `sendingInFlightRef`, `regenAbortRef`, `regenHandleSendPassRef`), queue `:67-73` | send start / stop watchdog / clearChat / conversation switch / unmount | one monotonic token per turn; **bump generation BEFORE clearing the claim** (ordering comment Chat:3157-3160); every composer unlock checks the captured id (Chat:3193-3199). *Checker:* test — "abort never settles → watchdog at 3 s unlocks only its own run"; grep `regenGenerationRef.current +=` (4 sites) and `++sendRunIdRef` (1 site). |
| 5 | **Abort path** | `abortRef` Chat:1835; created Chat:2273/2530; aborted at Chat:1865 (conversation change, effect 1861-1907), 1920 (unmount), 2103/2134 (background lifecycle), 3142 (stop), 3230 (clearChat), 3359 (edit); identity guards Chat:2279-2335, 2487-2488 | switch/unmount/stop/clear/edit/background | one controller ref, cleared **only on identity match**; pre-send controller aborted before the gate. *Checker:* grep `abortRef.current?.abort()` (7 sites) + test that a stale `if (abortRef.current === controller)` never nulls a newer controller. |
| 6 | **Stop watchdog** | Chat:1856-1859, armed Chat:3151-3204; drop-on-clear Chat:3249-3254 | stop pressed → 3 s timer → invalidate ids, drop empty placeholders, mark `interrupted`, persist inside the updater, unlock composer | UI unlock is intentional even if the engine FIFO is wedged (comment Chat:3196-3199). *Checker:* test — watchdog fires after bump → no state change (id mismatch). |
| 7 | **History load + guard** | `historyGuard = createHistoryWriteGuard(AsyncStorage)` Chat:1002-1004; load effect Chat:1044-1162 (bump 1045, key 1048-1055, `beginHistoryLoad` 1075, `settleHistoryLoad` 1099, alerts 1082-1116, lossy flush 1131-1140, epoch re-check at every `.then`) | `conversationId` changes → clears messages/draft/nudge, loads, quarantines lossy raw before any write, refuses writes while gate closed | Gate **refuses, never shrinks** (Chat:644-651 logs counts only); show what is readable before awaiting preservation (Chat:1091-1097); three distinct user alerts. *Checker:* `sessionPersistence.test.ts:224` boot-raw shape + new test: corrupt raw → quarantine written, refusal counts logged, flush after settle. |
| 8 | **Save FIFOs (four)** | (a) conversation index: `enqueueConversationSave` chains `pendingConversationSaveRef` App:1052, 1057-1069, from `applyConversations` App:1070-1079 with mutation counter App:1051; (b) library: `enqueueLibrarySave` App:1213-1253 + `libraryMutationRef` App:1201 + `pendingSavePromiseRef` App:1209; (c) turn-end: `sendInFlightPromiseRef`/`turnEndSavePromiseRef` Chat:1840-1853, 10 s fallback `HISTORY_WRITE_FALLBACK_MS` Chat:588-597, `settleHold` Chat:2984-2990; (d) engine job FIFO (engine-owned, `src/engine/LlamaService.ts:1033`) | any state change → strictly chained promises | chain must keep draining on rejection (`pending.then(run, run)` App:1065-1066); a late write still lands the `.kvs` (comment Chat:591-592); rejection still reaches the guard (Chat:639-643). *Checker:* test — first save rejects, second still runs; grep `.then(run, run)`. |
| 9 | **Epoch-stamped persistence of an in-flight turn** | 10 s throttled partial write Chat:1223-1248 (epoch stamped at schedule 1239-1246); flush-ref registration Chat:1163-1205; AppState flush Chat:1427-1514 (+ `saveEngineSession` on landed ticket 1472-1479); unmount flush **from ref, before abort** Chat:1908-1950; clearChat flush-before-bump Chat:3228-3240; turn-end persist+session save Chat:2975-2990 and 3048-3060 | streaming text grows / app backgrounds / unmounts | partial text reaches disk throttled; unmount reads `messagesRef`, not state; write epoch-stamped everywhere. *Checker:* test — bump epoch inside the throttle window → no write; unmount mid-stream → exactly one `setItem` with partial text. |
| 10 | **Engine lifecycle** | `ensureEngineForModel` App:4002-4447, single ref assignment App:4446 (callers App:3871, 3998, 4233); `chatEngineCtxRef` App:1196 + state App:2918 + engine-sync effect App:2921-2933 + writes App:4406, 5028; `engineGenerationRef` App:2996, `chatGateGenRef` App:3006, `streamInFlightRef` App:3007-3013; boot selection effect App:2944-2991 (ANTI_OOM: no auto-load on foreground, marker fallback + "set aside" error 2966-2971); background/foreground discard state machine App:3026-3526 (45 s grace App:414, `BackgroundDiscard` 3037-3055); thermal hard-gate edge App:3673-3748 | model select/download/send/OS events → engine load/dispose, ctx, refusals | one writer, generation tokens around every load; **ctx comes from engine init, not the catalog** (comment App:4403-4406); background aborts stream, saves, disposes; foreground only *evaluates* fit. *Checker:* grep `ensureEngineForModelRef.current =` (exactly 1, App:4446); test — fit=unknown → allow + banner, foreground path never calls ensure. |
| 11 | **`handleSendStream` (1357 lines — the largest single unit)** | App:5363-6719: arm/hold/release memory extract ~5443, 5491-5546, 5637-5666; research branch + `onNotice` ~5737-5754; notes context `loadNotesContext()` at 5749; per-chat compactor load/state machine ~6002-6397; persona application 6597; `streamAssistantTurn` call 6628; `bridgeEngineCallbacks` 6630 | `onSendStream` prop (wired App:7019) from Chat:2177+ | gate order: fit gate → claim → stream → turn-end `saveEngineSession` → memory extract (deadlock note App:5550-5553); bridge called once. *Checker:* existing `src/app/engineCallbackBridge.test.ts` stays green; grep `bridgeEngineCallbacks(` = 1 site. |
| 12 | **Model index storage** | key App:405 (`kalsa.model.id`); boot read App:2948 + last-good marker App:2949-2957; write App:4501 (`selectModel` App:4448-4592); `modelIndexRef` App:2934; fallback target App:2937-2943; `downloadedById` App:3527 written App:4914, 4933, 5046, 5338; hash re-save on model change App:4528-4540 | boot / select / download success | persist **id not index**; boot never silently flips model (comment App:2959-2961); hash re-save only when engine ready and not sending (App:4528). *Checker:* grep `MODEL_STORAGE_KEY` (exactly 2 sites: 2948, 4501). |
| 13 | **Conversation index store** | state App:1018-1026; `applyConversations` App:1070-1079; `bindActiveConversation` App:1080-1090 + effect App:1091-1125 (boot hash captured *after* index load, comment App:2993-2994); switch ordering App:2371-2410 (flush → set active → save old stem → bind → restore); touched meta App:2530-2548 (title/preview/searchBlob); delete App:2469-2515 (quarantine delete + `invalidateConversationSessions` + epoch bump App:2506 + restore); store file `src/conversations/ConversationsStore.ts` (`messagesKey` :76, `getDefaultConversationsStorage` :432) | drawer taps, new chat, delete, successful persist | **flush-before-bind** and the UI-first switch so the session stem stays on the chat being left (comment App:2376-2377); delete must not leave the raw copy alive (comment App:2484-2485). *Checker:* test — switch with a pending flush writes the old chat's key; grep `bumpPersistEpochRef.current?.()` = 1 (App:2506). |
| 14 | **Tool-flag persistence + refs** | keys App:866, 899-900; write App:882; state+ref mirror App:861-895; refresh App:896-912; mount skip-once App:2357-2366 | Settings/chip toggle → engine reads `webToolsEnabledRef` **mid-run** (App:2233) | flags must exist as both state and ref; `notifyStaticPrefixInputs` fires on change but not on mount. *Checker:* grep `staticPrefixNotifySkipRef.current = false` (single site App:2359). |
| 15 | **Voice state** | chat refs Chat:932-959; invalidation Chat:1339-1353; unmount cleanup Chat:1412-1426; pipeline state App:3530-3533; downloads App:5155-5295; TTS App:5313-5320; wiring App:7024-7025, 7139-7148 | mic press, downloads, unmount | voice uses the same run-id idiom as send (`voiceRunIdRef` Chat:950); transcribe → draft path; timers always cleared. *Checker:* grep `voiceRunIdRef.current +=` sites and assert cleanup effect exists (Chat:1412-1426). |
| 16 | **Share-in** | see row 41 of Deliverable 1 for locations | Android `url` intent | consume-once (dedupe set App:3561), pending until conversations ready (App:3562, flush effect 3661-3671), nonce bump re-merges identical text (Chat:1959-1962), busy/too-large/failed map to notices (App:3600-3630). *Checker:* test — same URL twice → one prefill; merge keeps existing draft text. |
| 17 | **Notices — not a queue** | single-slot `notice` state App:856-860, `showNotice` App:3547-3552, render App:7062-7077; second independent `voiceNote` system Chat:1329-1338 / 4299-4314 | any error/info event | last-write-wins single slot with 4 s timer (a "queue" would be a behaviour change). *Checker:* grep `setNotice(` — if a queue appears, that is a decision, not parity. |
| 18 | **Memory banner plumbing (set-only)** | declaration App:3021, setters App:3124, 3483, 3488, 4424, 5044, prop App:7028; **no read anywhere** | fit-gate reasons, background unload, load success | Reproduce = *decide*: today a rewrite that renders it changes behaviour; a rewrite that drops it loses nothing visible. *Checker:* grep `memoryBannerKey` — today exactly 1 occurrence of the lowercase variable besides the setters' mixed-case name. |
| 19 | **Compactor/digest per-chat maps (module-level singletons)** | App:636-655 (six Maps + `MAX_DIGEST_CORPUS_MESSAGES` 400); hygiene filter App:674-695; reset/sync App:696-784; reset on delete App:2477; per-chat compactor KV load ~App:6002-6073 | sends, conversation delete | keyed by chat id, reset on delete, force-rebuild flag. *Checker:* grep `resetCompactorChat(` in the delete path (App:2477). |
| 20 | **Notes context injection** | cap 24 000 chars App:408; `loadNotesContext` App:416-454, called App:5749 inside the send stream | notes mode / every send | same cap and injection point. *Checker:* grep `loadNotesContext(` (2 sites: def + call). |
| 21 | **Static-prefix / notices on tool change** | App:2357-2366 (skip first run), locale + flag deps | locale or tool flag flips | no notice at mount, notice on real change. *Checker:* test on the skip ref. |

## Deliverable 3 — module map for the rewrite

Ranges are exact declaration starts (grep-verified); an end line is the next declaration's start − 1.
Classification: **(a)** pure / moveable as-is · **(b)** stateful, must be re-expressed ·
**(c)** thin wrapper over another file (call, don't re-implement). Component-body refs/state
declarations are merged into single rows where noted; every function/callback is its own row.

### 3a. `src/app/AppShell.tsx` (7261 lines; component `AppShell` = 843-7261, 6419 lines)

| Unit | Range | Lines | Class |
|---|---|---|---|
| Types `ModelPipelineState`/`VoicePipelineState`/`EmbeddingPipelineState`/`ModelState`/`ActiveOverlay` | 367-404 | 38 | (a) |
| Consts: storage keys & thresholds (`MODEL_STORAGE_KEY`…`MODEL_SWITCH_DISPOSE_TIMEOUT_MS`) | 405-477 | 73 | (a) |
| `loadNotesContext` | 416-454 | 39 | (c) wraps `src/notes/NotesStore` (App:254) |
| `warnIfNativePatchesInactive`, `rawErrorDetail`, `modelBundleSizeBytes` | 478-515 | 38 | (a) |
| `gateForModel` | 516-586 | 71 | (c) wraps `loadGateFitModel` (App:535) |
| `releaseEmbedderBounded`, `gateReasonMessage` | 587-635 | 49 | (b) |
| Compactor/digest module maps + `MAX_DIGEST_CORPUS_MESSAGES` | 636-673 | 38 | (b) module singletons |
| `filterCorpusHygiene`, `resetDigestIndex`, `syncDigestIndex`, `resetCompactorChat`, `validateHistoryMessages` | 674-826 | 153 | (a)/(b): `filterCorpusHygiene` 674-695 and `validateHistoryMessages` 785-826 are pure; the three index fns are (b) |
| `AppShellProps` | 827-842 | 16 | (a) |
| Refs/state cluster: typography…calendar flags | 845-895 | 51 | (b) merged |
| `onThermalHardGateChange`, `toggleWebTools`, `refreshToolFlags` + 2 effects | 849-920 | — | (b) |
| Personas: state/refs/`refreshPersonas` + effect | 917-989 | 73 | (b) |
| Memory/miniapp/toolhelp refs | 990-1010 | 21 | (b) merged |
| Library & conversation state cluster + search | 1011-1047 | 37 | (b) merged (incl. `handleChatSearchChange` 1028-1040, effect 1041-1046) |
| Flush/empty/epoch/mutation/queue refs | 1048-1056 | 9 | (b) merged |
| `enqueueConversationSave`, `applyConversations`, `bindActiveConversation`, bind effect | 1057-1125 | 69 | (b) **(save FIFO + switch ordering)** |
| Doc-embed cluster (refs + `bumpEmbedJobGeneration`) | 1126-1183 | 58 | (b) merged |
| `modelStateRef`, `chatEngineCtxRef`, library FIFO refs | 1184-1212 | 29 | (b) merged |
| `enqueueLibrarySave` + flush effect, `handleLibraryChange`, `deleteDocument`, `addDocument`, `reorderDocuments`, `updateDocumentPreview`, `isDocumentDeleteInFlight` | 1213-1447 | 235 | (b) |
| Semantic embed pipeline: `VECTOR_MEMORY_FLOAT_CAP`, `ensureSemanticIndexLoaded`, `isChatResidentForEmbed`, `mustSkipEmbedForRam`, `ensureEmbedderDownloaded`, **`scheduleBackgroundEmbed` (455)**, `rebuildSemanticIndex` | 1448-2109 | 662 | (b) — `scheduleBackgroundEmbed` alone 1590-2044 |
| **`agentOptions` (237)** + `agentOptionsRef`, `localeRef` | 2110-2356 | 247 | (b) |
| Static-prefix skip effect | 2357-2366 | 10 | (b) |
| `drawerOpen`/`modelBarHeight`/`activeOverlay` state | 2367-2370 | 4 | (b) |
| `handleSwitchConversation`, `handleNewConversation`, `handleDeleteConversation`, `confirmDeleteConversation`, `handleConversationTouched` | 2371-2548 | 178 | (b) **(ordering-critical)** |
| Drawer items: `drawerConversationItems`, `drawerItems` | 2549-2624 | 76 | (b) |
| Download notifications: `notifyDownload`, refs, `begin…`/`show…`/`dismiss…` | 2625-2712 | 88 | (b) |
| Memory facts state + `refreshMemoryFacts` + effect | 2713-2743 | 31 | (b) |
| Model state cluster + `currentModel` + battery: `batteryEta`, `formatEta*`, `batteryLine` | 2744-2830 | 87 | (b) (batteryLine is a pure IIFE) |
| Download/error state + bandwidth + `recordDecodeSample` | 2831-2873 | 43 | (b) merged |
| Ctx size: state + effect + `catalogEngineCtx` + `chatEngineCtx` + sync effect | 2874-2933 | 60 | (b) |
| Boot model effect + `modelIndexRef` + fallback target | 2934-2991 | 58 | (b) |
| Download/engine guard refs | 2992-3025 | 34 | (b) merged (incl. `ensureEngineForModelRef` 2998-3005, `streaming` 3019, `memoryBannerKey` 3021) |
| **Background/foreground discard `useEffect`** | 3026-3526 | 501 | (b) |
| Voice/embedding/TTS state | 3527-3546 | 20 | (b) merged |
| `showNotice` | 3547-3552 | 6 | (b) |
| Share-in: state cluster + `applySharePayload` + 2 effects | 3553-3671 | 119 | (b) |
| Thermal edge effect (+ `thermalGateEdgeRef`) | 3672-3748 | 77 | (b) |
| `handleSaveToNotes` | 3749-3763 | 15 | (b) thin (wraps `saveNote`, App:254) |
| 4 effects (fit/notice/clear paths) | 3764-3890 | 127 | (b) merged |
| `evaluateLoadGate`, `reportLoadRefusal`, `userReloadModel` | 3891-4001 | 111 | (b) |
| **`ensureEngineForModel` (446)** | 4002-4447 | 446 | (b) |
| `selectModel`, `selectModelById` | 4448-4656 | 209 | (b) |
| **`startDownload` (442)**, `confirmDownload` | 4657-5154 | 498 | (b) |
| Voice + embedding downloads (4 fns) | 5155-5312 | 158 | (b) |
| `handleToggleTts` + effect, `handleMiniappAction` | 5313-5362 | 50 | (b) |
| **`handleSendStream`** | 5363-6719 | **1357** | (b) |
| `progressPercent`, `modelErrorHint`, `modelBarStatus` | 6720-6788 | 69 | (a) pure derivations |
| JSX return (PainterlyBg, model bar, AiChatPage props, Drawer, 8 overlays, PDF host) | 6789-7261 | 474 | (b) |

### 3b. `src/screens/AiChatPage.tsx` (6092 lines; component `AiChatPage` = 819-4696, 3878 lines)

| Unit | Range | Lines | Class |
|---|---|---|---|
| `tryRequireAsset`, `EMPTY_STATE_RASTER` | 182-194 | 13 | (a) |
| Types: `AiChatSelectedRun`…`SuggestionItem` (incl. `Message` 240-286, `Props` 326-415) | 195-422 | 228 | (a) |
| `buildSuggestions`, `miniappIcon` | 423-482 | 60 | (a) |
| `parseMessageSegments`, `greetingForHour`, `formatDayLabel`, `isSameDay`, `contentFilterMessage` | 487-558 | 72 | (a) |
| `nextMsgId`, `nextLibraryDocId` | 559-575 | 17 | (a) |
| `buildPersistableMessages` | 576-587 | 12 | **(c)** wraps `toPersistableHistoryMessages` (import Chat:111, `src/engine/historyPersistable.ts`) |
| `HISTORY_WRITE_FALLBACK_MS`, `persistMessagesNow` | 588-655 | 68 | (b) **(epoch checks 616-630)** |
| `sanitizeHistoryMessages` | 656-818 | 163 | (a) pure (locale in) — sources persist 713-731, status volatility 709-713 |
| Theme/keyboard cluster (`typography`…`updateKbDebug`) incl. kb-debug effects | 854-919 | 66 | (b) merged |
| Core state: `messages`…`sending` + voice state | 920-959 | 40 | (b) merged |
| Scroll/input/greeting/empty/suggestions refs | 960-971 | 12 | (b) merged |
| `reversedMessages*`, `historyLoaded*`, `messagesRef`, persist refs, `historyGuard`, touched helpers | 972-1021 | 50 | (b) merged |
| **`persistActiveMessages`** | 1022-1043 | 22 | (b) |
| **Load effect** (conversation switch) | 1044-1162 | 119 | (b) |
| Flush-ref registration effect | 1163-1205 | 43 | (b) |
| Throttled partial-write effect | 1206-1248 | 43 | (b) (10 s throttle at 1233-1240) |
| Attach/mode state cluster (`attachedItems`…`importAndAttachDocxRef`) | 1249-1293 | 45 | (b) merged (incl. draft auto-clear effect 1264-1273) |
| Translate/edit state cluster | 1294-1319 | 26 | (b) merged |
| `longChat` + nudge effect, `showVoiceNote`, `invalidateVoice` | 1320-1353 | 34 | (b) |
| `stopAndTranscribe`, voice cleanup effect, AppState effect, `handleMicPress`, `handleReadAloud` | 1354-1660 | 307 | (b) |
| Attachments: `MAX_IMAGE_ATTACHMENTS`, `addImageAttachment`, `addPdfAttachment`, `handlePdfPage/Done/Error` | 1661-1833 | 173 | (b) |
| Send/abort refs + conversation-change abort effect + unmount-flush effect | 1834-1969 | 136 | (b) **(incl. `sendRunIdRef` 1854, watchdog 1856; translation-orphan effect 1951-1957, share-prefill effect 1959-1969)** |
| **`updateMessage`** | 1970-2003 | 34 | (b) **(guard core)** |
| `awaitPreSendFitGate`, `awaitLifecycleForBackgroundDiscard` | 2004-2166 | 163 | (b) (hash snapshot 2160-2163) |
| Publish effect for background discard | 2167-2176 | 10 | (b) |
| **`handleSend`** | 2177-3122 | **946** | (b) |
| `handleSendTracked`, `handleStop` | 3123-3205 | 83 | (b) |
| `exportChat` | 3206-3218 | 13 | (b) |
| `clearChat` | 3219-3328 | 110 | (b) **(flush→abort→bump order)** |
| `editMessage` + 2 menu effects | 3329-3480 | 152 | (b) |
| `openMessageMenu`, `copyTextToClipboard`, `runTranslate`, `closeTranslation`, `toggleTranslationExpanded` | 3481-3599 | 119 | (b) |
| `voiceBlocksComposer`, **`canSend`**, composer entry points (`onComposerAttach`…`onComposerSendOrStop`), `chipColorForKind`, `addLibraryDocumentAttachment`, docx effect, **`importAndAttachDocx`** | 3600-3829 | 230 | (b) |
| List plumbing (`keyExtractor`…`listExtraData`) | 3830-3869 | 40 | (b) |
| `renderMessageItem` | 3870-3934 | 65 | (b) |
| **JSX return** (nav, nudge, empty state, inverted list, context chips, field, action row, 4 modals, quick sheet, kb badge) | 3935-4695 | **761** | (b) |
| `ChatNavBar` (memo) | 4698-4782 | 85 | (a) presentational |
| `ComposerActionRow` (memo) | 4783-4942 | 160 | (a)/(b): presentational but encodes the §2.7 single-`disabled` defect |
| `ComposerContextChip`, `AttachSheetRow`, `MessageActionChip` | 4943-5066 | 124 | (a) presentational |
| `ThinkingBlock`, `CodeFenceBlock` | 5067-5212 | 146 | (a)/(b): presentational; ThinkingBlock consumes volatile status |
| `PROVIDER_COLORS`, `getProviderColor`, `ChatMessageRowProps`, `chatMessageRowPropsEqual` | 5213-5275 | 63 | (a) |
| **`ChatMessageRow`** (memo) | 5276-5918 | **643** | (b) (own JSX return at 5492) |
| `TranslationBlock`, `MiniappCard` | 5919-6093 | 175 | (a)/(b) presentational |

Units over the ~350-line rule today (seams a rewrite can cut without guessing): App —
`handleSendStream` 1357, background effect 501, `scheduleBackgroundEmbed` 455,
`ensureEngineForModel` 446, `startDownload` 442, JSX 474. Chat — `handleSend` 946, JSX 761,
`ChatMessageRow` 643.

### 3c. Files the rewrite must NOT touch — call them

| File | Size / entry | Role |
|---|---|---|
| `src/screens/SettingsScreen.tsx` (3050), `AccountScreen.tsx` (453), `ProScreen.tsx` (152), `HelpScreen.tsx` (168), `DocumentsScreen.tsx` (677), `NotesScreen.tsx` (350), `PersonasScreen.tsx` (509) | imports App:8-15; mounts App:7111-7213 | the overlay screens |
| `src/ui/AskAssistantMiniappRenderer.tsx` (2213) | mount App:7243 | mini-app sheet body (the sheet chrome around it, App:7214-7252, *is* in AppShell and must be re-expressed) |
| `src/theme/components/Drawer.tsx:56` (154) + `DrawerContent.tsx:51` | App:7083-7105 | drawer surface |
| `src/theme/components/QuickActionSheet.tsx` (200) | Chat:4375-4380 | quick templates sheet |
| `src/conversations/ConversationsStore.ts` (476; `messagesKey` :76, `getDefaultConversationsStorage` :432), `PersonasStore.ts`, `personasHook.ts` | App:1057-1079, App:927-941 | stores (incl. the save FIFO target) |
| `src/notes/NotesStore.ts`, `src/memory/MemoryStore.ts` (App:254, App:297), `src/documents/DocumentLibrary` (import App:17-24) | App:3749-3763, App:2724-2738, App:1213-1447 | notes / memory / document-library stores |
| `src/engine/sessionPersistence.ts` (1085; hash :243, verify :302/:319, `readBootMessages` :357, boot-hash freeze :367-375, `createHistoryWriteGuard` used Chat:1002) | — | history guard + hash authority |
| `src/engine/historyPersistable.ts` | import Chat:111 | the persisted field set — the hash contract |
| `src/engine/regenState.ts` (99; exports :42-73) | import Chat:89-95 | run/claim/generation guards |
| `src/app/engineCallbackBridge.ts` (69; pinned by `engineCallbackBridge.test.ts`) | App:6630 | engine→UI callbacks (tool names included) |
| `src/screens/regenTarget.ts`, `src/screens/sheetCopyVisible.ts` | Chat:97-98 | regen target + menu visibility rules |
| `src/engine/LlamaService.ts` (`streamAssistantTurn`, `saveEngineSession`, `restoreEngineSession`, `translateText`, FIFO :1033) | App:6628, Chat:2177+ | engine entry points — UI-only rule (AGENTS) |
| `src/app/shareIntent.ts:37`, `src/pdf/PdfTextExtractorHost.tsx:62` (mount App:7257), `src/voice/{VoiceCapture,WhisperService,TtsService}`, `src/chat/{longChatEstimate,markdown,markdownDocument,StreamCaret}` | Chat:132, Chat:155 | services the two files merely call |
| Guards **inside** the big files that a rewrite must carry verbatim: `persistMessagesNow` epoch checks Chat:616-630, `updateMessage` Chat:1970-2003, parent epoch bump App:2506 | — | the three corruption points; a rewrite must re-express them with the same names greppable |

## Could not determine (and which file decides it)

| # | Question | Deciding file |
|---|---|---|
| 1 | Scroll restoration across a conversation switch — the load effect clears messages (Chat:1051-1057) but never scrolls; stick-to-bottom lives in Chat:3841-3852 against an inverted list (Chat:4141). Top or bottom after a switch needs a running app. | `AiChatPage.tsx:3841-3852` + load effect 1044-1162 |
| 2 | The handoff's "two hash callers read raw records" — the source shows **three** (`App:2391`, `App:2453`, `App:4536`, all hashing `readBootMessages()` output). A rewrite must satisfy all three. | `src/engine/sessionPersistence.ts:357-365` |
| 3 | `memoryBannerKey` has no reader (`App:3021` is the only occurrence of the variable) — whether the banner was meant to render is an owner decision, not a parity fact. | `AppShell.tsx:3021` |
| 4 | The document-library store's own line numbers — pinned only as import `../documents/DocumentLibrary` at App:17-24. | `src/documents/DocumentLibrary.ts` |
| 5 | `downloadedById` completeness — written at App:4914/4933/5046/5338, read by Settings at App:7131; whether a boot-time rescan repopulates it (vs. download successes only) sits in unread download code (App:4657-5154). | `AppShell.tsx:4657-5154` |
| 6 | kb-debug's status as a user feature — rendered at Chat:4668-4691 behind key `kalsa.kbDebug` (Chat:882); looks dev-only, nothing marks it as such. | `AiChatPage.tsx:4668-4691` |
