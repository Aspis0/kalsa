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
- `lib/tauri.ts` unwraps Tauri event envelopes by sniffing for `payload`; no unit test.
- `command-contract.mjs`'s type-argument group can span lines.
- `chat/src/surfaces/useChat.ts` is 652 lines — declared, not split.
- `verify.mjs`: 33 checks fail in the local harness for environmental reasons (the brain stub answers only `brain_state`); not proven environmental by anything but an identical baseline.
- Stray English strings in the Italian UI (e.g. the AI page's "You chose this model…") — translation is post-alpha.
- Opening chat B while chat A streams waits for A to finish (one seat) with only "Opening the chat…" on screen (27 s on the Mac walk).
- The last attachment error stays under the composer across chat switches until relaunch.
- With Kalsa already off, a failed row still advises "Turn Kalsa off and on again from Home".
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

## Post-alpha features (owner decisions)
- Images in the chat (mmproj download + `--mmproj` + attach) — see the memory note; LFM2.5-VL-3B is weak at tool calls.
- Small tool-calling model beside a bigger writer — Lab.
- Advanced "every AI" list, BYO GGUF.
- All translation/copy polish.
