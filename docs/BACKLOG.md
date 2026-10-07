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
