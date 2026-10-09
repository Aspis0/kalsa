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

- P3: when the tuned winner is a processor shape, the start still logs `engine: kalsa-server v1.1.5 · vulkan build` and `device pin: Vulkan0 (target and drafter)`, though the engine that runs is `builds\cpu\…\kalsa-server.exe` with no device flags (checked on the Surface). These lines describe the machine's backend, not the launch. Log the launch's real build and devices.

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
- F4, remaining scope: the quit save's budget is 8 s (`exit::SAVE_BUDGET`), and it is skipped when a restore holds the slot. The brain stop (`brain_stop`, `src-tauri/src/main.rs`) and a force-quit or an OS takeover do not save at all. Only the clean exit does.
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
