# Walk — installed Surface app (Windows 11, LFM 2.5 on CPU, `--parallel 1`)

Date: 2026-10-03 (walk run 09:35–13:30 Eastern; log in UTC).
Build under test: 5c13a2d9 (installed 2026-10-02; the log file appends across builds, so
the retained log also holds lines from db38b9f7 and older — flagged where it matters).
Method: CDP (`127.0.0.1:9333`) via `Runtime.evaluate` from Node on the Surface; DOM text
only, no screenshots of the owner's screen; log read over scp with `LC_ALL=C`, filtered
by full UTC date+time. The app process (pid 31236) stayed alive the whole walk; no
restart was needed. All test conversations and test files were deleted afterwards; the
model was restored to Liquid LFM 2.5 (verified serving a chat turn).

The owner's two complaints from the previous session **reproduced and are understood**:

- "chat → room → chat works now" — confirmed; the log shows handover save → room turn →
  `chat restore … ok` → `recall … restored before the request` → completion 200.
- The perceived "app stops and starts again" is **not a crash**: pid 31236 never died.
  It is the composition of (a) the 5-minute engine sleep (model unload + ~12 s reload)
  during which every chat open fails once (see P1-1), and (b) the "previous session did
  not exit cleanly" prompt that was still pending from an older forced kill. No app
  restart happened during the walk.

## Bugs

### P1-1 — After the engine sleeps (5 min idle), every chat open fails once with a 502; the user must retry
- **Repro**: use the app, wait ≥ `sleep-idle-seconds` (300 s), then open any chat
  (sidebar click or "+ Nuova chat").
- **Expected**: the door wakes the engine (the restore waits for the model load) and
  opens the chat.
- **Observed**: activate answers **502 `door.engine_unreachable`** after exactly 10 s;
  the UI shows "Kalsa non ha potuto aprire questa conversazione. Riprova." A retry ~15 s
  later succeeds.
- **Log** (each failure; repeated 6+ times through the walk):
  ```
  10:41:39Z paging: chat activate: slot 0 device 0 chat 3a8df5f8 code door.engine_unreachable 10005ms
  10:41:39Z audit: POST /kalsa/chat/activate device 0 status 502 reason door.engine_unreachable 10008ms
  10:41:39Z ui: chat.activate.door.engine_unreachable
  10:41:39Z ui: chat.slot_door_silent
  ```
  The engine's own start lines show a model load takes **11–12 s** (`engine ready in
  11.0s`), while the door's patience on the paging engine call is **10 s**
  (`crates/kalsa-door/src/engine.rs`, deadline = `crate::PATIENCE`) — structurally too
  short for a cold restore. The restore call itself wakes the engine; the door just
  gives up before the load finishes.
- **Impact**: every ~5 idle minutes the next chat open fails; for CPU users this is the
  common case. Confidence: **high** (reproduced 6+ times, log-proven).
- **Suggested direction** (not fixed here): on the paging path, retry the restore/save
  once after the engine's own "model loaded" signal, or a paging-specific patience ≥ the
  measured load time.

### P1-2 — A chat whose slot file restores in >10 s locks the user out of ALL chats
- **Repro**: attach a ~200 KB text file in a chat and send (the slot's save file grows
  to ~14 MB); let the engine sleep; then try to open **any** chat (the big one, another
  one, or "+ Nuova chat").
- **Expected**: chats open (the big one may take longer).
- **Observed**: every activate fails `door.engine_unreachable` at 10 s — each activate
  first restores the resident 14 MB checkpoint (times out), then the target chat's
  restore also times out. "+ Nuova chat" fails the same way, so the user cannot open
  **any** conversation, old or new. Recovery found by the walk: **delete the big
  conversation** (its erase removes the slot file) — after that, chats open at once.
- **Log** (the ping-pong; repeated at 10:44, 10:51, 10:54, 10:59, 11:03):
  ```
  11:03:16Z paging::io: chat activate: slot 0 device 0 chat 3a8df5f8 code door.engine_unreachable 10009ms
  11:03:16Z paging: chat activate: slot 0 device 0 chat 0d33cce1 code door.engine_unreachable 10009ms
  11:03:16Z audit: POST /kalsa/chat/activate device 0 status 502 reason door.engine_unreachable 10018ms
  ```
- Note this interacted with P1-1 (the engine was also cold), but the lockout persisted
  into warm windows too; the 14 MB checkpoint restore on this CPU simply exceeds the
  10 s patience. Confidence: **high** (live-observed over ~25 min; recovery by delete
  proven).
- **Suggested direction**: the paging restore/save needs a patience that covers the
  checkpoint size (size-proportional, or retry-once like P1-1); or chunked checkpoints.

### P1-3 — The first send into a brand-new chat can vanish without a trace
- **Repro** (as observed; cause unresolved): on a freshly opened chat page, send the
  first message of a new conversation.
- **Expected**: the exchange lands in the thread and in the store.
- **Observed**: the user bubble rendered **empty**, no assistant row ever arrived, the
  exchange is absent from `localStorage` (the stored messages of that conversation start
  at the *second* prompt), and the log has **no completion and no activate** for it —
  nothing at all. It also broke the later memory test (the model truthfully said there
  was no secret code — it never received turn 1).
- **Store dump** (my conversation; note the missing first exchange):
  ```
  user len=45 head=Dimmi in una frase perché il cielo è azzurro.      ← this is turn 2
  assistant len=242 …
  ```
  The turn-1 text survived only as the sidebar *title*.
- Confidence: **high** on the observation (DOM + store + log all agree); **low** on the
  cause — the walk's synthetic Enter (a `keydown` dispatched on the textarea) may race
  the gate's first `create` on a cold page; needs a human-typing repro.
- **Suggested direction**: instrument the `send → gate.create → store.put` path; the
  message should be stored before the door answers or the draft provably kept (the
  sidebar title kept the words — but the row rendered empty, which is its own defect:
  an empty user row for a message the UI still lists).

### P2-1 — The turn after a Stop silently produces an empty answer
- **Repro**: Stop mid-stream, then send a short follow-up in the same chat.
- **Expected**: a normal answer.
- **Observed**: first the honest "Kalsa ha smesso di rispondere dopo un minuto senza
  parole nuove. Riprova." banner; the new assistant row is **empty** (0 chars, no
  stopped flag), and the banner stays on screen. Store confirms `assistant len=0`.
- Confidence: high (store + DOM). Related: the Stop itself worked correctly (partial
  answer kept, marked "Interrotta prima del tempo").

### P2-2 — i18n: untranslated English on the AI page and Home (Italian UI)
- AI page, under the model name: *"You chose this model, so it is the one this computer
  runs. Choose another, or let this computer choose again, from the same page."*
- Home, Gemma card: *"Smaller and much faster: it starts answering sooner. The one above
  is the more capable of the two."*
- Confidence: high (seen in DOM text, Italian UI active).

### P2-3 — Empty-file attach error names the wrong reason
- Attaching an empty `.txt` shows "Kalsa non ha potuto leggere questo file. Può essere
  danneggiato o protetto da password." — for a merely *empty* file. The drop itself is
  correct and is reported (nothing silent); the reason is misleading. The `.png`/`.jpg`
  case shows the correct "non sa leggere questo tipo di file" — and contra the model's
  own earlier claim "Posso vedere le immagini", this build cannot take images.

### P2-4 — The recall line in the retained log carries a raw chat UUID
- Lines from the **older build** (db38b9f7, before 4dcbf980) in the still-appended log:
  `slot 0 recall: device 0 chat 4084314e-47b5-4304-a4a9-7bd9df1221f0 …` — raw UUID. The
  current build hashes (`slot 0 recall: device 0 chat cf066799 …` is the hash form). Not
  a code bug anymore (fixed by 4dcbf980), but the owner may want to prune or hash the
  old retained log lines. Confidence: high.

### P3 — The tune-measurement record never persists on this machine
- Every app start logs: `the measurement could not be recorded, so the next launch will
  measure again: Not a directory (os error 20)` — the record path is a non-directory on
  the Surface, so the ~9-minute tune re-runs at some starts. Functionally self-healing,
  but it wastes CPU and delays readiness. (startup/tune_step are owned by another agent
  — reported only.)

## What worked
- Multi-turn chat: 6+ turns, long answers (907 chars), 16–68 s per turn; Stop
  mid-stream kept the partial answer honestly; rename works; switching between two of my
  chats is fast (~2.5 s, no door call needed once both are open) and content is intact.
- Recall across turns works when the turns actually landed (the KA-9311 pair: correct
  after 2 intervening turns).
- Attachments: txt/md/csv attach, appear in the pinned panel with a budget meter
  (Messaggi precedenti / Riservato alla risposta / Libero); the model read them (via its
  file tool) and answered content questions correctly; unsupported/empty files are
  refused with a visible status line (P2-3 is only about the wording); a ~200 KB txt
  attaches and is served — but the resulting slot file triggers P1-2.
- Web tools: search worked end-to-end (two searches + a page read of www.wikimedia.it,
  source quoted with URL, answer correct); the pinned-documents web gate appeared and
  held a call until answered; Stop during tool activity ended the turn; a failed page
  fetch (corporate proxy) degraded gracefully — the model answered from the attachment.
- Settings: the AI page renders with the merged Advanced panel (context/batch/KV/road
  knobs, the "In vigore:" line correct); Accensione shows the power state; Dispositivi
  renders (nothing paired, none touched); "Invia il log" shows the corporate-network
  refusal as expected (`report refused: offline` in the log); crescent navigation
  between Chat↔Room↔Home worked (the crescent correctly drops the current page).
- Change AI: Liquid LFM 2.5 → Google Gemma 4 E4B (already in runtime\models, 4.7 GiB):
  the app downloaded the MTP file, re-tuned (Prova 2 di 16…), came up serving at
  8.6 tok/s, chat works on Gemma, the old chat continues; switched back to LFM 2.5 and
  verified serving plus a chat turn.
- Room: @Kalsa from the Room answers; the log shows the full handover (save → room turn
  → restore → recall) with correct timings; the recall brings the chat back before the
  next completion.
- Privacy: the current build's log lines hash chat ids (`chat cf066799`); **no message
  text, URL query, or filename** appears in any log line read during the walk. The only
  raw-UUID lines are from the older build's segments (P2-4).
- Polling: `brain_state` at 2 s (one shared poll), `brain_advanced` read once per AI-page
  mount (no timer) — matches the fix landed earlier; no chat or AI-page remount observed
  over a 12 s watch window.

## Could not test
- Stop during a **page fetch** specifically (only during search/generation) — the fetch
  fails too fast behind the corporate proxy to catch mid-flight.
- The oversized-attachment refusal — 211 KB was accepted; pushing past the 64k-token
  context would need a ~400 KB file and a ~45 min prefill, and P1-2 made big attachments
  the trigger of the lockout, so it was skipped deliberately.
- Device pairing (owner rule: do not pair).
- A second model *download* (Gemma was already on disk; the corporate network blocks
  kalsa.io, so a fresh download would conflate two variables).
- Human-typing fidelity for P1-3 (my sends are synthetic Enter keydowns; a physical
  keyboard's key repeat and focus timing may differ).
- The app-restart path (`schtasks /Run /TN KalsaWalkSurf1001`) — never needed; the pid
  never died.
