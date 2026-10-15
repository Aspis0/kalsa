# Backlog — known, deferred on purpose

Rule (owner, 2026-10-02): fix P0, P1 and the P2s that visibly hurt users, the app or performance.
Everything else is written here, one line each, and work moves on. Take items from here only when
they are promoted.

## First-run progress screen
- A second cut whose marker write fails keeps the previous marker on disk (atomic replace), but the final report says no retry is owed — the next start does retry. Copy is wrong, behaviour is fine (`src-tauri/src/tune_step.rs`, `retry_next = owed_still && staged.is_ok()`).
- The estimate jumps at the close of a candidate much faster than the average; "almost done" can stay up while the last candidate overruns (`chat/src/surfaces/tuneProgress.ts`).

## Room
- The phone's Room title still reads the English "This computer" (`crates/kalsa-door/src/room/routes.rs:70`) — translation work is post-alpha.
- The live streaming row never joins the previous Kalsa group, so "Kalsa" can appear twice in a row (`RoomSurface.tsx`).
- `scripts/name-contrast.mjs` checks only `--ink` on the tints; `--silence`, links (`--accent`) and the 3 px border all pass today but are unguarded.
- `room_title`'s test spells "This computer" instead of using `kalsa_pairing::store::HOST_LABEL` (`src-tauri/src/room.rs`).
- The browser check covers 3 members: slots 3–5 and the former-member fallback colours are never rendered.

## Door / paging
- A handover racing an idle-tick save that is already inside the engine can write the same file twice; harmless (same state, the tick's rename is dropped) (`crates/kalsa-door/src/paging.rs` `handover`).
- `handover` holds the slot lock across an engine save of up to 10 s (same discipline as `activate`); the idle tick waits behind it.
- The chat save's log line is written while the slot lock is held (`paging/io.rs:137`) — small synchronous I/O inside the lock, no deadlock.
- `id_hash` (4 bytes of SHA-256 of the chat id) is a stable correlator across log files — fine for debugging, not anonymous across sends.
- A restore that times out is followed by an erase; nothing proves a late restore cannot land after it (relies on the engine running one slot action at a time, in order) (`paging.rs` activate fallback).
- Paging engine calls may take 60 s under the slot lock; four slow ones can occupy all four door workers and stall the idle tick (`paging.rs:70`, `lib.rs:96`).
- A closed job's producer notices only after its current upstream read returns (≤10 s when the engine is silent) (`stream.rs` producer loop).

## App / tooling
- `brain_vision_enable` is registered engine-side but has no invoke site in `chat/src` yet — `chat/scripts/command-contract.mjs` fails on it until the chat calls it (the vision state shape to consume: `brain_state` running arm carries `vision: {"state":"none"} | {"state":"offer","bytes":N} | {"state":"on"}`).
- `lib/tauri.ts` unwraps Tauri event envelopes by sniffing for `payload`; no unit test.
- `command-contract.mjs`'s type-argument group can span lines.
- `chat/src/surfaces/useChat.ts` is 652 lines — declared, not split.
- `verify.mjs`: 33 checks fail in the local harness for environmental reasons (the brain stub answers only `brain_state`); not proven environmental by anything but an identical baseline.
- Stray English strings in the Italian UI (e.g. the AI page's "You chose this model…") — translation is post-alpha.
- Opening chat B while chat A streams waits for A to finish (one seat) with only "Opening the chat…" on screen (27 s on the Mac walk).
- The last attachment error stays under the composer across chat switches until relaunch.
- With Kalsa already off, a failed row still advises "Turn Kalsa off and on again from Home".
- Engine lines (`engine:`, `engine device:`, argv) are logged once per process (`system.rs:222` `Once`), so an in-process restart (vision enable, model switch) leaves no trace of the new start in the log.
- On Windows the log-folder opener logs a WARN because explorer.exe always exits 1.
- Windows on ARM prints no `cpu:` line (CPUID path is x86 only).
- Attach preflight fits the new files against history only, not the documents already pinned to the chat; send can then refuse what attach accepted (`useChat.ts:334` vs `useChatTurns.ts:145`).
- The fit counts each document's text but not its block framing (name, kind, pages line) (`attachments.ts` `docBlockText`).
- The budget meter shows the fixed system prompt's ~78 tokens inside "Earlier messages" (`BudgetMeter.tsx:40`).
- `scripts/system-prompt.mjs` closes its server and removes its temp dir only on the success path.

## Log and report
- Add "awaiting trigger" to the engine stderr denylist (defence in depth; not printed at default verbosity).
- The download log line names the model file (`placement.rs:295-300`) — a catalog name, not user data; kept.
- The "first send in a new chat vanishes" from the Surface walk (P1-3) was not reproduced in ~90 harness runs; suspected the walk's synthetic Enter. Watch for it.
- The kalsa.io report Worker's rate limiter is approximate (≈20 requests before a 429); the daily cap is the real bound.

## Measurement
- The tune key now uses the per-slot context (e6778dfc, owner 2026-10-03: pairing must not re-tune). A winner measured at one seat is reused at two (and back) although the second seat's KV reservation changes memory headroom during measurement — matters only near the memory limit (`tune_step.rs:150`, `policy.rs:170-175`).
- A v4 record written at parallel ≥2 before e6778dfc (key = total ctx) can collide with a later parallel-1 plan whose per-slot window equals that total (`record/mod.rs:401-406`).
- One model switch's tune on the Surface ended "verdict unfinished … withheld once — the next start measures again" (18 min, 2026-10-03 11:36Z).
- The mixed (iGPU prefill + CPU decode) shape is measured only at the physical-core thread count (`crates/kalsa-tune/src/candidates.rs:69`).

## Vision (reviews of 1801cbdd..fb30130a and ..7d1c7626)
- Four concurrent 16 MiB bodies hold ~128 MiB in the door (buffered body + parsed JSON strings) (`proxy.rs:795`, `media.rs:88`, `lib.rs:97`).
- An image small on disk but huge in pixels is decoded whole before the 1536 px resize; dimensions are checked after `createImageBitmap` (`images.ts:126-136`).
- Image bytes can be orphaned in IndexedDB when a chat is deleted while an attach is writing, or when a later `putImage` in a batch fails (`useChat.ts:423`, `imageStore.ts:81`).
- The context-size cache is keyed by endpoint, not model; a model switch at the same endpoint keeps the old n_ctx for preflight (`contextSize.ts:76`, `useChat.ts:305`).
- Two attach batches started at once can each pass preflight against the same image count; send-time catches it as a failed turn (`useChat.ts:395-428`).
- The door refuses raw-base64 `image_url.url` (llama-server accepts it); clients must send `data:image/…;base64,` (`media.rs:246`) — stated in the phone contract.
- `scripts/image-attach.mjs` deletes a fixed `.image-attach-dist` dir before and after a run.

- Animated GIFs are accepted but become still images after the canvas re-encode (`images.ts:36,191`).
- The stick-to-bottom hook can miss the first scroll-up when content grew since the last scroll event (`stickToBottom.ts:40,90`).
- `scripts/room-media.mjs` deletes fixed `.room-media-dist` / `.room-media-probe` dirs before a run.
- A video kept in its original codec (remux fallback) records the client-declared pixels; the room never parses MP4 boxes.

- Enabling vision restarts the engine; a 1:1 answer still streaming past the shutdown grace ends as a failed row with Retry (the confirm card says Kalsa restarts) (`vision.rs:276`).
- A failed frame write while attaching a chat video leaves the frames already written orphaned in IndexedDB until the chat is deleted (`useChat.ts:541-569`).
- Mac vision walk anomalies, unverified: one chat image turn (2026-10-04 05:12Z) reportedly answered on screen with no door line; two sends died before the POST with "stopped responding" right after a `chat activate … ok 11991ms` on a reloading engine (activate slower than the chat's 10 s patience?).

## Post-alpha features (owner decisions)
- Small tool-calling model beside a bigger writer — Lab.
- Advanced "every AI" list, BYO GGUF.
- All translation/copy polish.
- Room, for the beta (owner 2026-10-05): Kalsa's tables rendered on the phone (the phone Room shows plain text, `origin/main:src/screens/room/RoomTranscript.tsx`; the chat's `TranscriptMarkdown` already draws GFM tables) plus a table hint in the Room prompt; then a `create_poll` Room tool — the model proposes question and options, the door counts one vote per member and closes it, shown on desktop and phone (needs a protocol field).

## First-run progress (review of 7fc7d0d7)
- P2: a paced download still starts one `brain_state` read per gated event (~6.7/s) whenever the previous read has finished — the coalescing removes overlap, not rate; byte-carrying events could skip the read entirely (`chat/src/surfaces/useBrain.ts:329` `void poll();`, `src-tauri/src/progress.rs:20`).
- P3: `publish()` allocates and `JSON.stringify`-compares two snapshots on every event (`chat/src/surfaces/useBrain.ts:187-188`).
- P3: `getBrainRead()` is exported for the harness and hands out the mutable singleton snapshot (`chat/src/surfaces/useBrain.ts:380`).

## LFM2.5-VL-3B row (review of eb825f00)
- Done (owner accepted the 32k window, 2026-10-04): the chooser prices each row at `min(CHOOSER_CONTEXT_TOKENS, trained_context_tokens)` (`crates/kalsa-catalog/src/manifest.rs:274`, `crates/kalsa-catalog/src/candidate.rs:139`), so the ~7 GB machine the item named starts Liquid LFM 2.5 (3.4 GiB in memory at the 32 768-token pricing context, was refused by 203 MB). What remains: the menu's `speed_context_tokens` still reports 65 536 for a capped row whose speed was priced at the cap (`src-tauri/src/capability.rs:294`, `:326`, `:389`, `:564`, `:586`; nothing renders it today).
- P2, plausible: `host_bytes_on_gpu` 278_528_000 B was measured on the M1 Max (unified memory) and is subtracted from discrete-GPU budgets (`crates/kalsa-catalog/src/footprint.rs:187`, `:209-210`); unmeasured on Vulkan.
- P2: the default tests pin only the Q8 projector and model; the F16 projector (`crates/kalsa-catalog/src/manifest.rs:1112`) and the F16 model sha are pinned only in ignored suites (`crates/kalsa-catalog/src/manifest/tests.rs:645` picks the first pin).
- P3: Done — the four stale comments are corrected: `crates/kalsa-launch/src/policy.rs:1055`/`:1070` now say 31_592, `:1261` no longer claims the automatic contexts are the 65 536 default, and `src-tauri/src/startup.rs:2769` no longer says "trained 131_072".

## Room media shelf (review of 388b23c2)
- P2: a clear ignores every `remove_file` failure (`crates/kalsa-room/src/shelf.rs:439`) and the open sweep covers only `uploads` (`:100-106`), so a delete that fails leaves an orphan blob no index names — charged to nobody and reclaimed by nothing.
- P2: the heal's frame pruning touches only the shelf's copy of a video's descriptor — transcript entries loaded before it (`crates/kalsa-room/src/room.rs:121-126`) still name dead frames, which the door counts against the image budget (`crates/kalsa-door/src/room/turn.rs:652`) and then skips when the bytes are gone (`:663-665`), so phones ask and get a 404.
- P3: the ghost test does not assert the dropped record's charge came back: `used` and MAX_PUBLISHED are not checked (`crates/kalsa-room/src/tests/media.rs:1065-1101`).

## Room time (review of 67de9929)
- P2, plausible: a server clock that steps backwards across midnight gives the later `seq` the earlier day while every label follows seq (`chat/src/surfaces/roomFeed.ts:88,120` sorts by seq; `chat/src/surfaces/roomTime.ts:111` labels each entry by its own time) — one calendar day can take a second pill, "Today" after "Yesterday".
- P3: Intl failures are swallowed to "" (`chat/src/surfaces/roomTime.ts:93-95`, `:102-104`, `:117-119`), so a runtime that cannot format the tag or the zone blanks the clock and the pill with no signal and no fallback.
- P3: `chat/scripts/room-time.mjs` pins exact CLDR strings for en/it (an ICU upgrade could red the run) and covers no es/fr/zh; the zone section adds a Rome spring-forward hour, a 23-hour day and a zone switch, but no fall-back hour and no other zone.

## Desktop chat at the window's edge (review of 21369589)
- P2: a successful prune is silent while the full thread stays visible — the wire drops the oldest turns and the reader is never told, so the answer looks like it read everything (`chat/src/lib/attachments.ts:584` `dropped` unused, `chat/src/surfaces/useChatTurns.ts:258`). The owner chose to measure the live case before deciding on a word or a `notice` (CisWire).
- P3: the overflow tests measure the mock's chars/4 (`chat/scripts/mock-server.mjs:520`, `:532-536`), not llama.cpp's own tokenizer, and no retry carries an image — a picture-bearing overflow (IMAGE_TOKENS against whatever the engine counts) is unmeasured.
- P3, pre-existing: `prunekeep`/`oversizesend` cannot run at HEAD — the shared `seed` answers no `brain_capability` (`chat/scripts/verify.mjs:51-55`, `chat/scripts/lib/brain-stub.mjs:22-25`), so the home renders blank and both time out on selectors; `oversizesend` additionally waits for the "exceeds the context" copy removed by 372f867e (`chat/scripts/verify.mjs:2272`, `.error-detail`).

## Chooser at the trained cap (review of 916fc7e8)
- P2: the chooser prices ONE slot for every row, while the launcher reserves per-slot × slots (`crates/kalsa-launch/src/policy.rs:143`, `:222-227`) — with paired phones LFM's real cache is N×32 768 and Gemma's N×65 536; `funded_parallel` absorbs it by lowering the slot count (`src-tauri/src/startup.rs:1119`), and `ChoiceInput` carries no slot count to do better with.
- P3: the chooser prices 32 768 where the launcher funds 31 592 at 7.0 GB (`crates/kalsa-launch/src/policy.rs:1055`) — 9.76 MiB optimistic, and no refusal flips.
- P3: the paired route (`choose`) at 7.0 GB is untested, and the CLI cannot express 7.0e9 (`crates/kalsa-catalog/src/bin/kalsa-catalog.rs:205`).
- P3: the printouts show the raw 65 536 beside a row priced at 32 768 (`crates/kalsa-catalog/src/bin/kalsa-catalog.rs:40-46`), and the audit's footprint carries no window label (`crates/kalsa-catalog/src/bin/kalsa-catalog-audit.rs:163-166`).
- P3: `fits` and `footprint_bytes` are re-exported cap-free (`crates/kalsa-catalog/src/lib.rs:70`), so every caller applies `priced_context` by hand and the mistake it prevents stays spellable.

## Desktop mini apps (review of ce840b19)
- P3: pros/cons silently keeps the first 50 rows and still answers "Miniapp created" (`chat/src/lib/miniapp/prosCons.ts:35`) — inherited from the phone builder.
- P3: the 64 KiB block cap counts UTF-16 characters, not bytes (`chat/src/lib/miniapp/build.ts:27`, `normalize.ts:80`) — same as the phone; new input is bounded by the 4 096-char argument cap.
- P3: miniapp labels, controls and the tool's result/error text are English only, where the phone passes localized strings (`prosCons.ts:12`, `chat/src/lib/tools/createMiniapp.ts:14`) — translation work is post-alpha.

## Waiting line (review of ca60c354)
- P3: leaving the chat page and coming back mid-wait remounts `WaitingRow`, so the 3 s delay starts again for the same turn (`chat/src/components/Thread.tsx` `WaitingRow`).
- P3: a Room turn that waited for a seat (`waiting`) and then sees another member enqueue gets state `queued`, so the bubble shows the reading line while the turn is still waiting for a seat (`crates/kalsa-room/src/queue.rs:315`, `RoomSurface.tsx` `kalsaWorking`).

## Idle work (batch of 2026-10-05)
- P2: the phone's door is raised by the UI's `brain_state` poll (`src-tauri/src/main.rs` `brain_state` → `start_door_if_paired`), so the door's life depends on a webview timer; it belongs in Rust, on the supervisor's state change. Today the hidden window keeps a 15 s poll for this reason.
- P2: the window-event bridge to the page exists (`src-tauri/src/window_visibility.rs`, its `window_hidden` read and `chat/src/lib/pageVisible.ts`), so the hidden-window savings no longer wait on WebView2 firing `visibilitychange` (Tauri #10592); nothing has yet seen a real minimized window announce itself — the Lenovo run is that live check.
- P3: the Brain page's capability retry (`chat/src/surfaces/BrainSurface.tsx:110`, 1 s while capability is null/migrating) and `useElapsed` (1 s during the setup walk) ignore page visibility.
- P3: the Room event pump's stop can lag 30 s (`src-tauri/src/room_events.rs:50`) — `kalsa-room`'s notify is crate-private, so no wake reaches it; the thread keeps its AppHandle until then.
- P3: `queue.rs` expiry test measures from inside the spawned thread (`crates/kalsa-door/src/queue.rs:174`), so a late thread start can flake the ≥250 ms bound.
- P3: no end-to-end test drives the door's busy `sweeper` through the accept queue (`crates/kalsa-door/src/tests.rs:804` calls `proxy::handle` directly), and no test pins that a push wakes a blocked worker rather than the sweeper (`notify_all` is required, `queue.rs`).

## Bounded exit (review of 4607ee82)
- P2: if the exit watchdog's thread cannot be spawned, `arm` returns none and the exit runs unbounded (`src-tauri/src/exit.rs:116-120`).
- P2: the instance guard's Drop joins its watcher after the RunEvent callback, outside the deadline; the watcher can be inside `on_knock()` (`src-tauri/src/instance.rs:335`, `:363`).
- P2: no test proves the post-kill wait is bounded end to end — the "never landed" test feeds `reaped` synthetic results (`crates/kalsa-supervisor/src/child.rs:333` vs `:951`, `:968`).

## Windows walk on the Surface (2026-10-05)
- P1 process gap: `cargo check --target x86_64-pc-windows-msvc -p kalsa-brain` cannot run from the Mac (ring's MSVC build script), so src-tauri's `cfg(windows)` code is only compiled on a Windows machine — a wrong windows-sys constant shipped in `logging.rs` until the Surface build caught it (fixed c7da4875). Needs a Windows CI job or cargo-xwin.
- P2: a machine holding the old LFM 2.5 Q8 file re-downloads 2.9 GB for the LFM2.5-VL-3B row (`crates/kalsa-catalog/src/manifest.rs:1056`); same byte size, sha not compared. Only affects pre-VL installs.
- P3: an aborted model download resumes on the next launch with no walk and no user action.
- Lab (owner, 2026-10-07/08): MTP on the Iris Plus iGPU — both drafted lifetimes refused `NoUsableAnswer` while the off lifetime answered; and Vulkan on the Surface in general.

## Tune sweep and wait (review of dfac842e, 83d62e2f)
- P2 accepted trade-off (owner chose it): a shape reading the prompt less than 5 % faster than the off-winner is never swept, so a large MTP gain on it cannot be seen (`crates/kalsa-tune/src/passes/mod.rs` `PREFILL_EDGE`). The sound alternative is a capped best-case bound per backend (~13 lifetimes on the Surface instead of ~10).
- P3: `chat/scripts/walk-shots.mjs` sends tuning payloads without `budget_seconds`, so its screenshots show no ceiling.

## Room host name (review of 24ff59db)

- P3: `crates/kalsa-door/src/tests/room_support.rs` `scratch()` clears a room directory only before a test, never after: the 10 kalsa-door test files that use it, `room_names.rs` included, leave their rooms in the temp dir. A drop guard would clean them.

## The door follows the engine from Rust (review of 22eed856)

- P3: with no door up, every one-second tick re-reads the pairing store (`src-tauri/src/main.rs` `reconcile_door`, Tick → `start_door_if_paired`). A normal install always holds the host, so this only bites a store that is missing or unreadable: a file read a second for as long as the engine runs. Back off after an empty/failed read and retry on a pairing change.

## Tune retry (review of 863b4a41)

- P2: the tune line's "up to N min" ceiling is the budget plus 120 s (`chat/src/surfaces/tuneProgress.ts:63`), but the budget is checked only BEFORE a lifetime, and one lifetime's listed bounds add up to ~670 s (`crates/kalsa-tune/src/measure/mod.rs:62`). The last lifetime can overrun the shown ceiling by minutes. Either bound a lifetime hard or stop calling budget + 120 s a maximum.
- P3: when the retry's normal save fails, the atomic write leaves the old marker in place (`crates/kalsa-tune/src/record/mod.rs:214`), so the next start retries again, while the page was told the retry was spent.
- P3: the tune fingerprint (`record/mod.rs:83`) omits launch inputs that shape a measurement (batch, micro-batch, cache type, device, the rule's threads). Prior trials outside the current candidate set are now dropped, but a changed batch under the same candidates is still pooled.

## mDNS on the desktop's iroh endpoint (review of f8e9129f)

- P3: discovery queries every ~700 ms forever (`iroh-mdns-address-lookup` uses `Discoverer::new_interactive`, swarm-discovery 0.6.3 `lib.rs:247-250`), even when idle. Small on the desktop; on the phone it runs while the bridge runs. Slow the cadence after a first discovery window.
- P3: on any LAN (café, hotel), the PC announces its node id, private addresses and port, and its relay URL. No hostname or label. Consider announcing only on networks the owner marks as home.
- P3: mDNS records are unauthenticated. A LAN peer can inject a bad address for the PC's node id. iroh still authenticates the node key, so the worst case is a failed or slower dial. Prefer link-local candidates.
- P3: if a discovery actor dies after bind (socket or interface error), LAN discovery stays dead until the endpoint is rebuilt. The relay still works.
- P3: `crates/kalsa-iroh/tests/mdns_lan.rs` needs working multicast and waits up to 30 s where it is blocked.
- P3 (from 6a43b5b5): the LAN discovery now lives for the whole process, so while the door is down (brain off, engine restarting) the PC keeps announcing its LAST record, with a stale port, and keeps querying every ~700 ms. iroh has no un-publish on close. A phone dialing then fails the same way as with the door down.
- Phone side DONE 2026-10-08 (kalsa main 1455be66 + 3edc1b14): Android stops the bridge after 120 s in foreground with no dial or tunnel close, so the 700 ms queries and the MulticastLock end with it. Open P3s from that review: a 3 s stop wait (`irohBridge.ts` STOP_WAIT_TIMEOUT_MS) can fail one dial against a bridge being torn down; `closeDuringStop = false` on active postpones a refused stop's retry by 120 s; the idle timer callback has no identity check; `irohBackgroundStop.ts` names still say "background" though it holds both policies. Not measured on the device yet.
- P3: the desktop cadence (700 ms forever) can only change by patching iroh-mdns-address-lookup 0.6.0 (`Discoverer::new_interactive` at its lib.rs:497, no builder knob). τ = 10 s would make a cold LAN dial take up to ~12 s, above the phone's 10 s dial deadline.

## Tune retry and sweep stop (review of 8352c5e2, c0d86f25)

- Decided, not bugs: a drafted setting that times out at the 60 s bound (`NoUsableAnswer`) is an answer, and a lifetime with one good request out of two is a reply. Both are skipped on retry. The fixed 5 % `PREFILL_EDGE` can leave out a shape whose drafter would win (owner's option 2, 2026-10-05). The sweep assumes a drafted n that loses to off is not followed by a higher n that wins (docs/LAB-IRIS-MTP-2026-10-07.md).
- P2: the tune fingerprint (`crates/kalsa-tune/src/record/mod.rs:74`) omits the sampling settings the measurement uses (temperature, top-p, top-k, `src-tauri/src/tune_step.rs:179`). A marker from another rule can be reused.
- P2: no test drives a real budget cut → persisted marker → retry through the pass runner. `retry.rs` drops an entry by hand, and the tune_step handoff test stubs the measurement.

## Surface walk (2026-10-07, build 8f30e43c)

- FIXED 2026-10-09: the start block now names the launch's build and pin (tuned winner or the walk's build, pin read from argv), and `engine now:` logs every later swap. Still open (P3): the `engine device:` list comes from the pre-tune exe's `--list-devices`, so a CPU winner still lists the Vulkan adapters; the speed check's failed-processor → graphics restore (`src-tauri/src/main.rs` ~:1988) logs no `engine now:` line.

## Tune "100%" batch (review of fb03c060, 454a1f14, 288c022f, 84da8025, 4e769a3c)

- P3: the setup screen's "up to N min" adds 120 s to the 1500 s budget (`chat/src/surfaces/tuneProgress.ts:63-69`), but a lifetime started just before the budget runs out can spend up to ~670 s of request bounds (`crates/kalsa-tune/src/measure/mod.rs:62-68`), plus connect and DNS time. The real end can pass the ceiling the screen shows.

## Desktop chat UI fixes (review of 59863ed5, 69dba19f, 3877864c)

- P2: closing the files panel with its × on a wide window hides the focused button (`Panel.css` `.panel:not(.panel-open) { display: none }`) and nothing returns focus to the topbar Files toggle (`ChatSurface.tsx:203`). Keyboard users lose their place.
- P3: the vision chip carries `title={visionLabel}` and the same text inside (`Composer.tsx:286-289`), so a chip that fits shows a duplicate tooltip.
- P3: no verify check asserts that a closed panel is hidden on a wide window; the 1400 px attach test only checks the opened panel's row (`verify.mjs:1425-1435`).

## Interactive mini apps and the attach gate (reviews of 970a573d..6e68fb44, 385ebbe4)

- P2: saved conversations with a `metric_strip` (the retired kpi_strip) still render it, static. The owner's rule is "interactive or removed"; old messages keep it so history reads whole.
- P2: the quiz's custom radios (`Quiz.tsx` `role="radio"`) have no roving tab stop and no arrow-key handler; keyboard users Tab through every option.
- P3: reloading the page while an answer streams keeps whatever the last throttled persist (500 ms) wrote — a partial answer.

## One-turn and pinned documents (review of dac28c92, 99fe7e78)

- P2: `chat/scripts/attach-send-race.mjs` binds documents with its own `sendWith` helper (`:152-170`) and checks production by source-string matches (`:105`). A production change that drops the `docs` assignment while keeping the matched lines still passes.
- P3: the web-call gate collects every active attachment and every bound doc before the fit trims history (`useChatTurns.ts:191-193`), so a retry of an older turn can ask about a staged document that turn never carries.
- P3: re-attaching a sent document and then pinning it puts its text in the system message while the old message still carries it — sent and counted twice.
- P3: `verify.mjs` assumes a dev server on 5173 and a mock on 18081 and resets the mock at `/__reset`; two agents running it at once clear each other's state.

## Phone mini apps (review of kalsa main 945875c5..df41e3ae)

- P2: a tick made while a turn streams stays in memory until the stream's partial (every 10 s) or final write (`src/host/miniappStateWrite.ts:42`, `useHistoryFlushes.ts:82`); the background flush is not awaited (`useHistoryFlushes.ts:108`). A crash or force-stop before it lands loses the tick.
- P2: state lines are appended to `modelEmittedText` (`src/host/turnCorpus.ts:266`), which is replayed byte-for-byte for the KV prefix (`hostMessage.ts:47`); the replay now differs from the saved completion, so the engine re-reads from that message on. Correct, slower.
- P3: the "transient" state lines can reach the compaction digest through retrieval units (`turnCorpus.ts:1023` → `compactor.ts:829`) and be stored in AsyncStorage (`engineTurnSlide.ts:304`).

## Vision ubatch floor (review of 6c4809cd)

- P3: the tune record's fingerprint has no ubatch (`crates/kalsa-tune/src/record/mod.rs:82-88`), so a tune measured before the floor is reused unchanged at the floored buffers — the rule picked under ubatch 512 runs at 1024.
- P3: 560 is copied as a literal outside `kalsa-launch` with no pin to `args.rs`'s `IMAGE_MAX_TOKENS` — `chat/src/lib/attachments.ts:37` and `crates/kalsa-door/src/room/turn.rs:61` each hold their own copy, and a JS/Rust drift compiles clean.
- P3: the floor's math is one-image-per-ubatch; an engine bump to a build that packs text and image into one ubatch halves the room and invalidates `VISION_UBATCH`'s derivation without failing any test here.

## Content gate port (review of 1d5d08c3 + cf8d90e0)

- F3: no test asserts equivalence with the phone's `contentFilter.js`; `chat/scripts/content-filter.mjs` is run by nothing and partly greps `useChat.ts` source instead of driving `sendNow` and `retry`. The equivalence runs (141 lines, then the reviewer's 4066 cases) were one-off and are not kept.
- F4: `[^.?!]{0,30}` counts UTF-16 units in the phone and the desktop and Unicode scalars in Rust, so the windows diverge on 15–29 astral-plane letters before a keyword.
- F5 (PLAUSIBLE): Rust's `(?i)` uses Unicode simple case folding, while the phone's `/i` is ASCII-only for non-ASCII input. NFKD and lowercasing run first, so the reachable difference is probably empty; not checked.
- F7: `compile()` rewrites every `\b` textually and `expect`s the compile, so a pattern edit that breaks compilation panics on the first gate use on the turn thread instead of failing at build or test time.
- F8: `room_gate.rs` has no non-ASCII boundary cases (`ö` beside a keyword, Cyrillic before `kill`) and no test for the cancelled path (`running_call_text` returning `None`).
- F9: `decline_for` normalises before its empty-text check, so the first empty call still compiles every pattern on the turn thread.
- The decline reads "· read the last 1" (`read = 1`, F2): `readLast` has no singular form, so the label reads as a count. The honest value stays 1; the copy is the owner's.
- `chat/scripts/contrast-dom.mjs` already times out at `a7d507bd` ("Seeded thread" in `.sidebar`), so the composer disclaimer's contrast is unchecked.

## Disclaimer line (review of ab34891c, 127d4120, phone ebc93d90)

- P3 #5: the Italian power line now opens with the same words as the "starting" line (`it/power.ts:9-10`), and the setup stepper maps two different steps to "starting" (`it/setup.ts:5`) and "Avvio in corso…" (`it/setup.ts:7`), so the boot sequence reads as a stutter. The other four locales keep the start and prepare steps apart.
- P3 #6: the "older computer" softening reached Italian only (`it/firstPage.ts:9`, `it/power.ts:10`). English, Spanish, French and Chinese still tell the user the computer is old.
- P3 #8: the chat has no test suite, so the disclaimer's copy and placement are checked by `tsc` alone; `chat/scripts/contrast-dom.mjs` is the only check that reaches the DOM, and it times out at `a7d507bd`. On the phone the fit test is real (`6c78de38`); the sentinel pins at `shellGeometry.test.ts:156` were not reviewed.
- P3 #9: the design margin the transcript pins were argued from shrank. The live keyboard band is 147 dp, so 24 / 147 is 16 % against the 20 % bound (`transcriptLayout.test.ts:140`), and the clearance over the cloud falls from 47.8 dp to 27.8 dp. The commit message says "nothing overlaps" and does not state the smaller margin.
- P3 #11: no screenshot or vision read was reported for a band-height change on a three-band partition. `docs/DESIGN.md` says the pixels are proven by screenshots at three sizes, and the phone's `mock/` holds no tracked files, so the pixel proof for this change does not exist.

## Chat warmth after sleep and quit

- Prompt processing is not logged. The door's chat line carries the completion's status and bytes only, so a slow completion (the Surface's 195 s one) cannot be split into re-prefill and generation from the logs. The door should record the engine's prompt-cache numbers per completion.
- The engine's stderr is not kept on disk (`kalsa-supervisor/src/child.rs`). A sleep is seen only through the stderr line, and the Surface logged no sleep over a 34-minute idle gap on 08/10, so it cannot be told whether the engine slept. Keep the stderr in a file.
- A model switch stops the door without saving the open chat (`stop_door` in `src-tauri/src/main.rs` has no save). The turns since the last timer save are lost the same way a quit lost them before the quit save.
- F4, remaining scope: the quit save's budget is 12 s (`exit::SAVE_BUDGET`, tied to the 15 s `DEADLINE` by a unit test), and it is skipped when a restore holds the slot. The brain stop (`brain_stop`, `src-tauri/src/main.rs`) and a force-quit or an OS takeover do not save at all. Only the clean exit does.
- F2: a dirty checkpoint whose save never reached the engine before a sleep is abandoned. A save that failed before its request left the door stamps no backoff (`cadence.rs:134-139`), so the engine sleeps with the slot still dirty. The release keeps `dirty_at` (`paging/invalidate.rs`), and `recall` clears it after it loads the older file. The turns since the last file that reached disk are lost on that restore.
- F3: an unreachable restore leaves the open chat `Unknown`, so its next completion runs cold. Keeping the chat named (`Evicted`) for one retry is not cheap: the residency carries no "already tried" mark, so a silent engine would be asked on every completion with the 60 s patience. A retry cap needs that mark first.
- F5: the quit and sleep tests check call paths and the engine's request order. They do not check the slot's contents after the call, and they do not check the order of the app's own steps (the quit save before the engine stop, the tick's sample before its invalidation). The second is only pinned by reading `main.rs`.

## App sentences in the prompts (review of c266dec5)

- P2-3: `chat/scripts/verify.mjs` fit arithmetic is still pinned to a 78-token prompt: `verify.mjs:2152-2153`, `:2183-2186`, `:2253-2254`, `:2287`, `:4327-4329`, `:4378-4380`, and `docs/BACKLOG.md:42` ("~78 tokens"). The prompt is now 206 to 263 tokens, so those sums are 128 to 185 tokens short. Not edited here: `verify.mjs` is append-only with one writer.
- P2-4: `dev/lab-restraint/engine.mjs` copies the pre-c266dec5 prompt and claims byte-for-byte fidelity (`:3`). `dev/lab-calendar/engine.mjs:7-15` is also stale. `docs/LAB-LFM-TOOLS-2026-10-04.md:112` and `docs/LAB-CALENDAR-2026-10-05.md:52` describe `promptBytes(false)` as verbatim, and it is not. Before any lab runs again it must take the current prompt, `systemPrompt(false, false)` for the chat or `room_system_prompt(false)` for the Room; its recorded numbers predate this change.
- P3-1: `create_miniapp` is named in the prompt, but the tool is offered only inside the Tauri webview (`chat/src/lib/tools/registry.ts:45-46`, `chat/src/lib/tauri.ts:21`). The miniapp sentence is sent in browser and harness contexts too. Left as written.
- P3-3: "Phones paired to this computer can get answers from you too" (chat) and "join the room and can call you too" (Room) are true only when the phone can reach the computer. The last measured state failed (`docs/LAB-IROH-LAN-2026-10-07.md`). Left as written.
- P3-4: the Room prompt's blind variant is 674 bytes (the seeing variant 641), up from 510. At the test slot's 256-token budget the transcript share shrinks by the growth. The engine fixture in `room_turn_wire.rs` moved from 700 to 1200 bytes for that reason. The production cost is not measured in a live run.
- P3 (new): `engine_vision` fails closed. A `/props` probe that fails returns blind for that turn, so one turn can carry the blind Room prompt while the engine can see. That turn's engine request usually fails too, and the cost is one cache miss. Not fixed.
- P3 (new): the attach-send-race windows (trial 1000, shed 756) are pinned to the blind no-Think prompt's size. Any prompt change moves the shed boundary; the script's own check brackets it (756 sheds, 790 keeps).
- P3 (new): `chat/scripts/image-attach.mjs:728` pins "You cannot see images, audio or video.", which is unchanged, but that script was not run for this change.

## After the alpha (owner 2026-10-08)

- Think toggle cache cost: on Gemma 4 the template puts `<|think|>` at the start of the system turn, so switching Think mid-chat drops the prefix cache and the whole history is read again (measured cache_n 0, prompt_n 1452). Budget-0 and empty-thought prefill keep the cache but leak planning into the answer (4/4 probes). Proposal: Think chosen per conversation, with a warning when it is switched mid-chat. Owner: decide after the alpha.
- LFM2.5-VL ignores `--image-max-tokens`: a 1920-wide frame costs ~2480 tokens, while the chat's budget assumes 560 per image. Pre-existing.
- Chooser speed estimate on the Surface: predicted LFM 9-13 and E4B 5-8 tok/s; the owner saw E4B 9.9 (MTP on) and LFM 8.3. Measure both without MTP before changing the estimate.

## Phone iOS parity (phone main b36552ee, 2026-10-08)

- Telemetry Worker redeployed 2026-10-08 from phone main b36552ee (version ae0db10c-ea59-435e-be03-7c481075c816). It accepts android and ios; live probe with "windows" answers 400 "platform must be android or ios".
- The Worker's dedupe signature (`workers/telemetry/schema.ts` ~:420) omits platform, so an iOS and an Android report with the same fields count once.
- Still missing on iOS: Share Extension (send to Kalsa from other apps), the `https://kalsa.io/pair` universal link (associatedDomains + apple-app-site-association), LAN discovery (off on purpose since 150c5e03, entitlement and prompt undecided), CPU threads fixed at 4 (`threadProfile.ts:51`).
- Simulator build from main 6c78de38: BUILD SUCCEEDED with no fixes, and the app ran LFM on the simulator. A device build, the iroh road at runtime and a Release build are not verified (no iPhone yet).
- iOS Governor: research in docs/RESEARCH-IOS-GOVERNOR-2026-10-08.md. No llama.cpp ANE backend exists and no Core ML to ggml KV handoff exists, so the ANE route is a Lab only. First Lab on a real iPhone: 600 s of sustained decode, Metal vs CPU, wall-clock timing.

## Before the desktop engine pin moves to the b11514 engine (fork main 2e723bd9d, binding 1babccb9; governor note, 2026-10-09)

Owner 2026-10-09: not a blocker, we are in dev with no released users. Old slot files may just be lost on the bump.

- `LLAMA_STATE_SEQ_VERSION` goes from 3 to 4. Every slot file saved by v1.1.5 under `ai.kalsa.brain/slots` is refused by the new engine with a 400 on restore. Before the bump, check that the door's recall (`crates/kalsa-door/src/paging*`) treats that 400 as a cold start: it should delete or ignore the stale file, should not retry it on every completion, and should not mark the chat broken. Test it with one real v1.1.5 slot file against the new engine.
- The phone has the same issue: rn-slot-manager reports a load failure instead of a cold start. The phone pin is the owner's call.

## Sent-on date (review of dc83864a, 2026-10-09)

- By design, a Room call posted at 23:59 and answered after midnight tells the model the day it was sent, not the day of the answer.
- Downgrade: an older build ignores `sent_on` in the Room log and replays those calls without their date, so their bytes change once.
- No test pins the Room budget boundary with the date line counted (`turn.rs` windowing and halving).
- The send-path check in `chat/scripts/sent-date.mjs` matches source text: a different call shape in `useChat.ts` would slip past it.
- Live check on Qwen 3.6 35B-A3B (engine 8130): with "Sent on Friday, 9 October 2026." it answered "Today is Friday, October 9, 2026.", and with an older turn from 5 October it counted "4 days ago" correctly.

## Alpha polish batch (two-reviewer review of 87a49860..37cfc56c, 2026-10-09)

Fixed in the same pass: engine-log filter and redaction, Help privacy/default/label copy, Brain composer locked while busy, `?` hidden on Help, the brain_stop pin (order + await). Deferred:

- Attach error crosses chats: a late rejection in `chat/src/surfaces/useChat.ts:703-714` (and `attachFromDisk` :735-741) writes its status after a chat switch. Rare timing; the switch-time clear covers the common case.
- Vision restart (`src-tauri/src/vision.rs:274-286`) calls `supervisor.stop()` without the save `brain_stop` now does: the warm checkpoint can lag one turn. Transcript is safe.
- The 12 s save budget is not a hard wall: socket reads re-arm per byte (`crates/kalsa-door/src/response.rs:83-96`); a trickling engine could stretch it. Pathological.
- The save in `brain_stop` runs outside the start/stop gate (`src-tauri/src/main.rs:2077`): a start during the save could bind-fail against the old engine. Not seen; the UI blocks it via `busy`.
- Turn off can now take up to 12 s before the button changes (save before stop). Show progress if it is noticed.
- A failed switch save is swallowed (`brain_stop` returns Ok). Log only.
- `keep_stderr_in` wiring (`main.rs:2430`) has no test; removing it drops the engine log silently.
- `completion_timings.rs` no-counter test matches a generic line other unlocked tests also emit; can pass on a foreign line.
- Timing parser: non-stream last-key-wins can be spoofed by model text, and multi-line SSE `data:` yields no counters. Log-only.
- Each `AssistantRow` subscribes to the brain-state store (`chat/src/components/Thread.tsx:120`): O(rows) callbacks per publish.
- Help is not rendered by any test; "Up to four phones" is inherited copy, not a limit in code.
- Long module comments in `timings.rs` / `stderr_log.rs` exceed the two-line WHY rule.
- The engine-log filter is a denylist built from the v1.1.5 source: re-grep the engine's `LOG_WRN/ERR` with `%s` on every engine bump. Lines with `name=` are withheld whole, which also hides some model-load diagnostics.
- `chat/scripts/verify.mjs` needs `npm run dev` and a brain stub; on a plain dev server nearly every UI case times out at `locator.fill` (2026-10-09), so it gave no signal for this batch. `dev/smoke-react.mjs` imports a missing `AdvancedSurface`.

## Phone date stamp (kalsa main 82c9c9ba, 2026-10-09)

- Pre-existing: on attachment, notes and research-trigger sends the model sees `modelText` but the record stores `trimmed`, so the replayed turn differs from the first send and the KV prefix breaks there (`src/host/sendHost.ts:222-282`). Not caused by the date.
- The content-filter refusal path in `sendHost.ts` (~:180) stores its user turn without `sentOn`.
- `engineTurn.ts:63` still takes a dead positional `_lastUserBare`.
- Not run on a device or the simulator yet.

## Alpha telemetry (phone kalsa fb6bcd2a, desktop, Worker e29f75b4, 2026-10-09)

Owner: on by default for the alpha on phone and desktop; revisit the default for the beta (EU consent). Deferred from the two-reviewer review:

- Owner 2026-10-09: no authentication is fine for the alpha; decide for the beta. The Worker `/report` has no sender authentication; the in-memory IP limiter is per isolate and the 50/hour global cap can be eaten by fabricated valid reports (`kalsa/workers/telemetry/index.ts:63-64, :163-182, :405-427`).
- The desktop report's local save fsyncs inline on the engine-failure path (`src-tauri/src/telemetry/store.rs`, called from `main.rs` ~:1693); a slow disk delays the next fallback.
- A crash between saving ON and removing the `off` marker can silently revert ON to OFF (safe direction).
- `npm run command-contract` stops at the pre-existing `window_visibility::window_hidden` entry, so the new telemetry commands are not guarded.
- `dev/generate-telemetry-spec.mjs` reads the contract from the sibling phone repo path; a moved checkout breaks `--check`.
- The phone notice is a 4-second toast through the notice slot, marked seen on the next launch; not seen on a device yet.
- Not verified: a real POST from an installed app (only a live 400 check against the deployed Worker), Windows/Linux hardware capture; Linux gives no GPU inventory; thermal and battery are not sent.

## Crash restart + phone telemetry v2 (2026-10-09)

- The restart walk (`restart_after_exit`, the `decided_at` veto, Home's "starting" during the walk) has no test: it needs an AppHandle harness. Live kill -9 check on the Mac is the proof.
- The restart re-measures like "Try again", so the same model/launch is likely, not guaranteed. `exit_code` of a crash is ignored by the policy.
- `slot_restore` failures are coded `engine.init` with phase `turn` (desktop `telemetry/mod.rs` ~:195-204).
- Phone v2 sends no RAM figures: the only JS source is the process-cached device profile. A fresh available-memory read at report time needs a small native module (app module, not kalsa.rn — coordinate with the governor session). CPU load likewise has no source.
- Phone v2 has no KALSA_SESSION (save/restore) hooks yet: that LlamaService code belongs to the governor session; add after its work lands. Leg failures are native-only (KALSA_GOVERNOR_FALLBACK); ask the governor session to expose them in stats if needed.
- Bearer compare leaks the token length through timing (Worker `auth.ts`); accepted: READ/FLUSH/ADMIN tokens are long random values. The read route has no rate limit (authenticated only).

## Automatic log upload + recovered line (2026-10-09)

Owner: on serious errors the desktop uploads the redacted log by itself (max 3 per UTC day), the report carries its logRef, the crash card is gone. Deferred from the two-reviewer review:

- The Worker `count` counts deliveries: a report stored whose response was lost is retried and counted twice (no idempotency key; `kalsa/workers/telemetry/index.ts` duplicate branch).
- Without KV every duplicate rewrites the whole DO state, which grows until purge (`index.ts` ~:417-433). Fine at alpha volume; cap or shard before the beta.
- The redactor is not a general path/secret scrubber: external-volume or network paths and odd error strings can reach R2 (`src-tauri/src/logging.rs` pass list; `main.rs` ~:1176 logs command error text). The report Worker stores the bytes as sent.
- LOG_SETTLE (5 s) is a window, not a completion signal: slow restart diagnostics written later miss the upload.
- The 3/day cap is client-side only (deleting the telemetry folder resets it) and shares the manual send's Worker limits (5/IP/min, 300/day); a rate-limited automatic log is not retried, the report goes without it.
- logRef is unauthenticated client input; the maintainer tool only prints what it would fetch.
- The engine's own stderr (kalsa-engine.log) is not in the uploaded body, by privacy choice; assertion text is therefore missing.
- A failed start that never recovers uploads the log with no notice in the UI (by design: the notice is only for recoveries).
- v1-shaped phone reports changed signature (platform added); their first recurrence after the deploy is a new entry.
- `chat/scripts/verify.mjs` ~:2152 still pins the old 78-token prompt/889 total; `dev/lab-restraint/` (uncommitted lab) sends the old prompt sentence.
- `chat/scripts/turn-failures.mjs` is red at HEAD (one "retry of the older row" check, date stamp in the expected text); the new UI (recovered line, Turn Kalsa on) has no harness coverage.
- `record`/`record_locked` carry `#[allow(clippy::too_many_arguments)]`; a report-shape type would remove both.

## Refusal retry, interrupted line, telemetry log lines (2026-10-10)

Owner: when a model refuses because tools are in the request (LFM2.5-VL-3B refuses EN stories with any tool, lab 2026-10-10), the app re-asks once without tools. Deferred from the two-reviewer review:

- A genuine policy refusal is also re-asked without tools; safety then rests on the model refusing again. The detector is lexical only.
- The re-ask is a fresh request: a second prefill, and the prompt reorder misses old cached prefixes once after the upgrade. Not measured.
- The interrupted-turn line is session-only: after a reload the failed row shows the ordinary card again (the failure's time and the restart event are not persisted).
- Surface network (2026-10-09): `kalsa.io` and `telemetry.kalsa.io` resolve to `::1` / `100.64.255.100` there, so nothing from that PC reaches either Worker. Check where the resolution comes from before testing telemetry on it again.
- LFM2.5-VL-3B (Mac Q4 run, 2026-10-10): asked for a story with web tools on, it sometimes web-searches first and then answers "I wasn't able to locate a story…" with no story; the retry covers only a first-round refusal, so that turn ends without the story (1 of 4 runs). Post-alpha fix: [small tool model / big writer split].

## Download page, Italian guide (2026-10-10)

- kalsa `workers/download` tests (168) do not run in CI: `jest.config.js` roots is `src` and ci.yml never points at the worker config.
- No IT/EN parity gate: build-guide checks section numbers only; a sentence added to one guide and not the other passes.
- `If-None-Match` matches one exact strong tag only (`*`, lists, weak tags → 200).
- `pickLang` reads only the first Accept-Language tag (q-values ignored); `?lang=IT` uppercase is ignored.
- The English diagnostic quoted in the Italian guide has no `lang="en"` markup.
- The app shows "Getting ready" as "si sta preparando" (power) and "si sta avviando" (first page) — two Italian strings for one English line.
- "Windows ha protetto il PC" / "Ulteriori informazioni" / "Esegui comunque" not verified on an Italian Windows 11.

## After tester feedback (owner 2026-10-10)

- Mac: in-app "Delete the downloaded AIs (X GB)" on the AI page — a Mac uninstall (drag to Trash) leaves 3–22 GB in ~/Library/Application Support/kalsa-brain. Owner: a new feature, so later, once testers have reported.
- After switching to another AI (e.g. the 8 GB machines moved from LFM Q8_0 to Q4_K_M), the old model file stays on disk (2.9 GB for LFM Q8). Ask or delete automatically — owner call, same timing.
- `chat/scripts/command-contract.mjs` fails on base: `window_visibility::window_hidden` in generate_handler! is a name the guard cannot parse.

## Stop/save gate, tool arguments (review of d05c0dfa, 75a91228, 2026-10-11)

- `begin_walk` takes the gate with a blocking `std::sync::Mutex::lock` from async `walk`/`brain_test` (`src-tauri/src/main.rs` ~:491, :1617): a Turn on or crash restart during a Turn off save holds a Tokio worker up to SAVE_BUDGET (12 s). Fix needs an owned `Arc` threaded through `walk_and_settle`/`brain_test`/`restart_after_crash` into `spawn_blocking`.
- Fake-engine test teardown (`src-tauri/src/tests.rs` ~:2345-2408) does not join its health thread or wait for the fixture child to be reaped; a failure before `RunningEngine::stop` leaves the health flag up.

## OTA updater + 8 GiB line (second review, deepseek, of 678c746e..ab9681a9, 2026-10-11)

Fixed in the follow-up: install guard, stale notice version, redaction of a key-terminated update URL, web client version, progress clamp, release script signature/version check. Deferred:

- P0 "endpoint is the placeholder" refuted for shipped builds: the real endpoint comes from `--config ~/.kalsa/updater-endpoint.json` at build time (0.0.2 → 0.0.3 verified live). Nothing in the build fails if the overlay is forgotten; a release check that the binary does not contain `REPLACE_WITH_UPDATE_KEY` would close it.
- The install's reply re-check is not atomic with the door stop (`stop_for_update`): a phone turn that starts during the chat save and engine drain is cut without a message. Same shape as quit and Turn off.
- 8 GiB with a paired phone: the Q4 row (1.67 GB) falls under SAME_CLASS_BAND of a 4B-class phone, so `choose()` says NothingBetter while startup silently runs the Q4 via the fallback. Moot until phones ship; decide before the phone release.
- Two seats on a small machine share 16 384 tokens (8 192 each) instead of one seat at 32 768. Deliberate; revisit with tester logs.
- The 16 384 window sits on the telemetry `ctxTokens` bucket edge (reports as 16–64k).
- Two sources of the app version (`brain_app_version` vs the updater's current version); the tune ETA may now climb (deliberate); the uninstall hook repeats a guard the bundler already applies; the two semver comparators (Rust plugin vs Worker BigInt) differ above u64; the removed 8 GiB test's three user-facing assertions were not re-added; release.mjs `--dry-run --new-manifest` prints a step 5 it never prepared; the walk-step and tune-progress harnesses are not run by anything.

## Hearth port, piece 1 (rail + Home), left for later pieces
- Copy still to apply on later screens: update copy (INVENTORY change 7), new Phones lines (19), Report a problem moves to Help (13) and the recovered banner's "Send the log" opens Help, the rest of change 12 in Help, "Stop generating" → "Stop".
- Home "Using <model>" is shown only while Kalsa runs: the stored model name never reaches the frontend when off (`capability.rs` reports the chooser's pick, `main.rs` only `chosen: stored.is_some()`). Needs a small backend field; do it with piece 3 (Your AI).
- Text under 15px with `--tx3` on `--rail` in Thread (code label, 4.57:1) and Room; room name colours clear 4.5:1 by ~0.1.
- `contrast-dom.mjs`: 4 selectors per theme no longer exist (`.markdown a`, `.error-block .btn-quiet`, `.settings-field input`, `.budget-unknown`), so it exits 1 although all 74 measured pairs pass AA.
- `brain-shots.mjs`: walk-progress check ("of 22.1 GB" while stopped) and first-run texts ("Pick a model", "Use this model") no longer match the app.
- `shots.mjs` "surfaces" screenshot can no longer fail (it only waits for the rail).
- 900px breakpoints don't account for the 112px rail.
- Two identical "Try again" accessible names on problem states.
- Italian tense mismatch between `puttingAway` and `nextTimeChoice`.
- Full `npm run verify` already had ~45 failures at 5f268ae0 (40 after piece 1): quota, badurl, html, forbidden, deleterow, network, attach*, oversizesend, metersum, gate url/twoconv, toolfit, loop, burn, fetch, files* (`stubFileDoor` answers null to brain_state). Needs its own repair pass.

## Hearth port, piece 2 (chat), left for later
- smoke-react renders no chat page at all (chat states are covered only by verify/shots).
- Video chip "Compressing… %" label is under 13px.
- The streamed answer text is not announced live (only "Kalsa has answered"); deliberate, revisit with a screen-reader pass.
- Report a problem moves to Help, and the rest of Help copy change 12 (piece 5).

## Hearth port, piece 3 (Your AI, For experts), left for later
- For experts context help still says "2 GiB" (mockup "2.1 GB"); speeds read "About 31.0–46.0 tokens/s" (mockup "31–46 tokens per second").
- Server settings vs mockup: "In force" not bold, the switch has no "Off" text, "Model name" has no (i), long "Unload after idle" text, the numeric context field is still there.
- The token window the speeds are priced on is shown nowhere any more; the guard checks the "short conversation" sentence instead.
- Home "Using <model>" uses the backend's full name ("Alibaba Qwen 3.6") while the cards say "Qwen 3.6 by Alibaba".
- Pre-existing at c35ed539: verify `metersum`, brain-shots `refusal` fixture ("of 22.1 GB"), contrast-dom missing "Show thinking".

## Hearth port, piece 4 (first run, growing tree), left for later
- A one-second clock tick no screen reads (SetupProgress/walkState).
- "Show details" shows nothing for a failure without a backend code (in practice a choice that failed to save).
- Start screen omits "Takes about 10 minutes." (no measured basis for the claim).
- Faint leftover leaves drawn along the trunk in the tuning stage (tree geometry polish).
- verify `hiddenonload` is timing-dependent (fails alone at d9705a6a too).

## Hearth port, piece 5 (remaining screens), left for later
- Owner decision pending: the 09-phones-invite screen.
- The update notice off Home is an in-flow banner of our own design (no mockup draws it).
- At 720×480 the empty Chat leaves almost no spare height: the empty state's 72 px of padding (`EmptyState.css`) is fixed, so the notice slots are capped at 12% of the window to keep the composer in view.
- verify failures shared with 7b5631b4: quota, networkurl, refusefit, filestree, filessearch and the "line is open" waits (scenario setup, not the app); image-attach crashes waiting for the slot notice. Needs its own harness pass.
- Mini apps render as a card before the answer bubble (mockup nests them after the text); calculator shows formula chips and raw numbers; the table has no default sort or best-row highlight.
- Files panel is a tree opening on "In this chat" (mockup: breadcrumb list); 09-phones-allow is split across two screens in the app.
- No mp4 fixture: the chat video tile and its label were never shot; dark theme only shot for Settings and Room.

## 0.0.4 copy and logo batch (luna + deepseek review, 2026-10-12)
- `MachineCard.tsx` `reasonSentence` still indexes `byCode[code]` without an own-property check (same class as the `rustText.ts` fix); `reason_code` comes from our backend, so unreachable today.
- The removed "You picked this AI" reason is filtered in the webview only (`MachineCard.tsx`); `capability.rs` still emits `model.reason.chosen` and no test pins that nothing renders.
- `en/rust.ts` header says the table holds "the same sentence on the wire"; `capability.rs` English and the tables now differ in wording.
- Rail brand mark uses fixed logo colours (`Rail.css`), not theme tokens; leaf on lime is ~2:1 (a logo, not text). RULES/mockup still draw the old mark.
- `AiPage.css` `@container (min-width: 1080px)` two-column branch is unreachable while the Your AI column caps at 840px; drop it or widen the card.
- Screenshot stubs (brain-shots, the phase-B probe) carry no `iroh_code` and an automatic context inconsistent with `parallel`; their For experts shots show the English road sentence and "Automatic: 64k" with 3 chats.
- `verify.mjs:5335`, `:5409` assertion names overstate what the retargeted checks prove; `ui-log.mjs:17` sentence is decoration.
- Help: the update screen no longer says installing waits for the user (owner called the old line patronising; revisit only if testers ask).

## Tool-call repair (CisWire port, reviews of 2026-10-12)
- SECURITY, owner decision for the beta: a fetched page (or pasted text) can steer the model into a STRUCTURED `web_fetch` to an outside URL carrying conversation data, with no confirmation — the web gate asks only when a document is pinned (`registry.ts:125`). Pre-existing, independent of the repair (text recovery is now off whenever any web result is in the conversation). Candidate fix: ask before fetching a URL whose query/path carries text from the conversation, or before any fetch after web content entered the chat.
- `<function=` inside a parameter value makes recovery refuse the whole call (deepseek N8).

## web_fetch provenance rule (reviews of 2026-10-12, deferred)

- Redirects: Rust `kalsa_web::fetch` follows `Location` without re-checking provenance, so a user-typed URL carrying a credential can be redirected to another host with it (crates/kalsa-web/src/fetch.rs). Consider refusing cross-origin redirects when the query names a credential.
- The rule lives in the webview (`chat/src/lib/tools/fetchProvenance.ts`); `brain_web_fetch` and `brain_open_url` (src-tauri/src/web.rs) have no notion of it. Any other IPC caller bypasses it.
- `web_search` still sends the model's query to Exa unchecked: injected text can push private chat text to the search provider (not to the attacker). The pinned-document gate covers it only when a document is pinned.
- The localized refusal line on a tool row is lost on reload; the stored record shows the model-facing English.

## macOS 26 app icon (2026-10-12)

- `src-tauri/icons/Assets.car` is precompiled from `src-tauri/icons/Icon.icon` and listed in bundle.icon, because `actool` run by the Tauri bundler from this checkout fails with "Bad file descriptor". Regenerate it whenever the icon changes: copy Icon.icon to /tmp, then `xcrun actool Icon.icon --compile out --app-icon Icon --output-partial-info-plist p.plist --platform macosx --minimum-deployment-target 26.0`. Root cause unknown.
- Check that the Windows NSIS build ignores the `.car` entry before the next release.

## Mail sidecar hidden-text label (security reviews of 2026-10-14)

The hidden-text label is best effort. The boundary is the fence, the host's taint and the confirm before anything leaves the machine. Tricks that only go unflagged, while the text still reaches the model fenced, collect here and are fixed in batches against the real-Gmail run.
- CSS custom properties: `color:var(--x);background:var(--x);--x:red` is not flagged (`html_hide.rs` `declarations_hide`).
- `MAX_CSS_BYTES` (64 KiB) and the 4096-name bound stop collecting rules silently.
- The 40-character alt threshold is a guess. Check it against real mail in other languages.
- Mails over the 16 KiB HTML parse cap are labelled `not_parsed` and read from their text/plain part. Measure how many real mails this hits on the Gmail run.
- Deliberate (2026-10-14): `not_parsed` does not set `hidden`, because most real newsletters exceed the cap and the badge would lose its meaning. The security review flagged it as a verdict downgrade: the plain part the model reads may differ from the HTML the person sees. It stays fenced and tainted. If the Gmail run shows abuse, give the model only headers plus the 200-character snippet for `not_parsed` mails.
- Signals (11912e96) are hints only: they never override suspicious, and the model still picks. The security review flagged two of them. `known_sender` trusts the From address, which can be spoofed; gate it on the auth result when one is trusted. `read` takes its deadline reference date from the mail's own Date header, which the sender controls; use the newest INTERNALDATE instead.

## Mail: several accounts (owner 2026-10-14: "multiaccount per un'altra versione")
- Settings → Mail lists the accounts, with "Aggiungi un altro account", and each password sits in the keychain. "Mail importanti di oggi" looks in all of them. Every card carries a small account label in a stable colour. A reply always leaves from the account that received the mail; the code decides that, never the model. The host side is one registry record per account.

## Mail: audit of the night fixes (2026-10-15, P2 left over)
- Credential wiring has no end-to-end test: the page mock accepts any saved password and the IMAP fake accepts every LOGIN, so removing `prepareCredentials` from `connect()` stays green. Make the fake check the password it was given.
- `test_saved` (`src-tauri/src/mail/accounts.rs`) releases the account lock before probing, so a save or delete during a slow probe can return the old account's subjects. Plausible, not reproduced.

## Security audit of the desktop, GLM-5.3 (2026-10-15)
Report: 0 P0, 2 P1, 8 P2. The engine-key P1 (llama-server answered any Origin, no key) is fixed separately. The rest:
- P1: every gate lives in the WebView. `brain_mail_send`, `brain_mail_read`, `brain_files_read` and the other commands are callable by any script in the page. No injection into the page was found (closed CSP, raw HTML shown as text, no remote images). A Rust-side send token was considered and not done, because a script that can call send can also call draft. The real defence is keeping the page free of script injection. Revisit if mini apps or attachments ever render active content.
- `web_search` query words can carry mail text to Exa without an ask: the gate is armed only by pinned documents. Arm a lighter ask when fenced mail is in the conversation (`toolLoop.ts` already knows `MAIL_NAMES`).
- Telemetry uploads the log folder. The llama-server stderr filter is a blacklist (`supervisor.rs` `REQUEST_LINE_MARKS`). Invert it to an allowlist.
- `mailbox.rs` `headers()` fetches whole header blocks with no size cap. One mail with a multi-megabyte header costs memory and the call's deadline. Fetch only FROM and DATE, partially.
- Sidecar pin: there is a verify → spawn → verify swap race (`kalsa-mcp/src/launch.rs`). Hash and execute a private copy.
- Pairing desk lane: six free identities exhaust it (declared at `kalsa-iroh/src/bridge.rs:122`). Open the lane only while an offer is live.
- Control characters from a hostile Message-ID reach `In-Reply-To`/`References` (no CR/LF, so this is not injection). Pass both through `invisible::one_line` in `compose.rs`.
- `brain_mail_account_save` accepts any typed host for a known provider's address. Warn when the host does not match the provider.
- The updater endpoint is still the `REPLACE_WITH_UPDATE_KEY` placeholder in tauri.conf.json.

## Engine key and phone chat leftovers (reviews of 2026-10-15)
- Dev runners still start a keyless engine: `dev/engine-harness.py`, `measure-model-switch.py`, `measure-slot-restore.py`, `spike-kv-paging.py`. Mint a key per run, set `LLAMA_API_KEY`, send Bearer. `measure-concurrency.py --door-bin` refuses until then.
- `EngineKey::mint().expect(..)` at app start (`src-tauri/src/main.rs`) panics if the OS RNG fails. Show a startup failure instead; never start a keyless engine.
- No automated test runs the real fork against the key: add a real-engine smoke (no key → 401, key → 200). Checked by hand on the rig on 2026-10-15.
- `Owned.adopted_pid` in `kalsa-supervisor` is now set only by tests (adoption is gone). Remove it with its stop and watch branches.
- Phone chat: a card or draft event over the caps (subject > 1 KiB, gist > 4 KiB) is refused whole and the phone silently gets no cards for that turn. Truncate on the page instead.
- Phone chat, idempotent send (luna P2-5): a send whose answer is lost cannot be retried safely.
- Qwen 3.6 35B on the rig looped in reasoning after `mail_list` ("One last check…", 6.7k tokens, 237 s) on 1 of 2 tries. Desktop and phone share the loop; consider a reasoning budget.
- `telemetry::privacy_tests::public_catalog_ids_match_shared_contract` fails on brain: "missing public model 392e6e30aa21cb00" (catalog data drift).
- Phone chat (GLM-5.3 P3): a failed thread spawn in `chat/mod.rs`, `turn.rs` and `mail.rs` drops the socket with no terminal frame; no test revokes a device mid-turn or mid-read; one phone can hold all 8 body-admission slots until the connection deadline (300 s).
- Phone chat: a send already inside `send_confirmed` (blocking SMTP) still completes if the phone is revoked during it.
- Phone chat, shared seat: the window runs a phone turn's completions with this computer's own credential (`chat/src/lib/phone/phoneTurn.ts` `token: settings.token`), so the door leases the host's slot and cache salt for both. A desktop turn and a phone turn that overlap queue on one slot and each re-prefills the other's prefix. Nothing is lost: `abandon_detached` (`kalsa-door/src/proxy.rs`) closes only detached answers. The fix needs a phone-turn identity in the pairing store and the door, revoked on forget. Decided 2026-10-15 (owner delegated the call to this session): do not fix, because a latency cost does not justify work on the credential path.
- Phone chat, reasoning of a refused round: when round 0 is refused as a tool refusal and asked again without tools, its reasoning has already streamed to the phone (`phoneTurn.ts` passes no `onWithdraw`; `phoneEvents.ts` `reasoning` is append-only). Decided 2026-10-15 (owner delegated the call to this session): the phone must not see it. A refused round is the model's mistake, and showing the reasoning of a mistake we then hide is noise, not transparency. Built 2026-10-15: a phone turn holds each round's reasoning (`holdReasoning`, `createReasoningHold` in answerHold.ts) and sends it only once the round stands; a refused round's reasoning is dropped. No new frame.

## Mail kept IMAP session, deepseek review (2026-10-15, left over)
- The global mail state lock is still held across `host.call` (`src-tauri/src/mail/state.rs`), so settings, save and delete queue behind a live IMAP or SMTP round trip (up to 60 s). The runtime no longer starves; serialization remains. Making `Host` (kalsa-mcp) callable concurrently is a redesign.
- Idle expiry of the kept IMAP session is lazy: an authenticated session stays open until the next call. Close it on a timer, or LOGOUT when the sidecar goes idle.
- The senders "known" set is only appended to, never pruned on EXPUNGE, so a deleted sender still counts as known for the `PaymentUrgencyNewSender` hint.
- Concurrent tool calls queue on the one kept session: a 50-item list delays an unrelated single read.
- Each read now sends 2-3 IMAP CHECKs (before and after the body); the cost on a real server is not measured.
- A `spawn_blocking` panic in `open_in_background` (`src-tauri/src/mail/host.rs`) becomes `MailError::Failed` with no log line.

## Mail live fixes, luna review of 6bd34292 (2026-10-15, left over)
- Link signals skip anchors with no host: `javascript:`, `data:` and relative hrefs get no phishing signal (`label/phishing.rs` continues when `domain::host_of` is None), so a URL-looking label can hide such a target. The pane renders text only, so nothing runs; it is a warning blind spot. The rule for those schemes is the owner's call.
- Test gaps: `tests/body_urls.rs` checks the raw href reaches `parsed.links`, not that the labeler emits a signal, and has no userinfo, IDN, trailing-dot, IPv6, non-HTTP or scheme-less case. `mail-cards.mjs` normalizes 12 items, so the 50-item cap and a 50-item store write are not pinned.
- Mail reads are slow: every read logs in to IMAP afresh, runs SEARCH ALL and fetches headers. Reuse the session or cache the list's UIDs.
- The send confirmation (`SendConfirm` in `ChatSurface.tsx`) stays on screen across a chat switch or a closed pane; it still sends the draft the person saw, but it should close with the mail (pre-existing, luna re-check of 92d071e0).

## Phone mail, luna review of baac1a3c (2026-10-15, left over; phone repo)
- HTTPS mail reads have no response-size cap (`src/remote/doorRoad.ts` uses `res.json()`); tunnel reads cap at 512 KiB. Cap both.
- A turn that started before a pairing change can still deliver a draft afterwards, sendable through the new door. Needs a turn-level pairing identity.
- `workers/download/guide.test.ts` still reads the guide from the sibling kalsa-brain checkout when present (skips visibly in CI). `GUIDE_TS` set by accident during a real release would check another module than the committed one.

## Phone: boot mode and load marker, luna reviews of ef8482cc and fe43287f (2026-10-15, phone repo)
- Boot keeps «Il tuo computer» when the computer is off or forgot the phone, and the pill says the computer does not answer; it does not fall back to the phone (same as a typed address). Owner may prefer an automatic local fallback.
- `deferred-remote` (a document delete in flight at boot) falls through to local and is never retried (`usePipelineScans.ts` boot effect).
- A removed pairing record plus an old typed address can still select remote at boot.
- The boot readiness check awaits secure-store reads with no timeout.
- Load marker: storage failures fail open (marker write, the confirmed write, read errors → false), so a real crash can be forgotten after a later clean exit.
- Load marker: stamp and Android exit timestamps are both wall clock; a clock step can flip the "older than the stamp" rule.
- Load marker: Android `DEPENDENCY_DIED` (and other unmapped reasons) map to "other" = clean in `KalsaLifecycleModule.kt`; a dependency death during native init is not treated as a death.
- Low-memory line (phone 20ac2eb8): the runtime CPU fallback inside a turn (`LlamaService.ts` ~6095) reloads without a React state change, so the line updates only at the next render; a GPU init that fails from memory pressure while the estimate said Fit falls back to CPU (`LlamaService.ts` ~2942) without the line.
- `src/engine/LlamaService.ts` is a God file (6942 lines, 245 commits). Owner 2026-10-15: split it with the usual pipeline (explorer map → plan → one cut at a time, each reviewed and checked on the S23), coordinated with the governor session.

## Phone: LlamaService split, cut 1 (phone 4f571791, 2026-10-15, phone repo)
- `cleanTranslationOutput` (now in `src/engine/outputCleaners.ts`, moved verbatim) turns a single-line "Ecco la traduzione: Ciao" into "": the lead-in strip eats the only line. Pre-existing; the cut kept it as is.

## Mail redraft and «Modifica» removal, deepseek review (2026-10-15, left over)
- Draft tool runs are stripped on persist (`lib/store.ts` `forDisk` drops `mail`), so after a reload the draft cards are gone and a change asked in chat carries no redraft note.
- "Never sign as Kalsa" is prompt-only (`definitions.ts` mail_draft description); no code checks the body, and the mail-cards check only reads the description back.
- A redraft adds a second card for the same mail instead of replacing the first; both show the one stored record, so neither offers the old words.
- The fresh-chat branch of `send` drops the mail riders (note, subject, pin); unreachable from a card today because cards need an active chat.
