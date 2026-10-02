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

## App / tooling
- `lib/tauri.ts` unwraps Tauri event envelopes by sniffing for `payload`; no unit test.
- `command-contract.mjs`'s type-argument group can span lines.
- `chat/src/surfaces/useChat.ts` is 652 lines — declared, not split.
- `verify.mjs`: 33 checks fail in the local harness for environmental reasons (the brain stub answers only `brain_state`); not proven environmental by anything but an identical baseline.
- Stray English strings in the Italian UI (e.g. the AI page's "You chose this model…") — translation is post-alpha.
- Windows on ARM prints no `cpu:` line (CPUID path is x86 only).

## Log and report
- Add "awaiting trigger" to the engine stderr denylist (defence in depth; not printed at default verbosity).
- The kalsa.io report Worker's rate limiter is approximate (≈20 requests before a 429); the daily cap is the real bound.

## Measurement
- The mixed (iGPU prefill + CPU decode) shape is measured only at the physical-core thread count (`crates/kalsa-tune/src/candidates.rs:69`).

## Post-alpha features (owner decisions)
- Images in the chat (mmproj download + `--mmproj` + attach) — see the memory note; LFM2.5-VL-3B is weak at tool calls.
- Small tool-calling model beside a bigger writer — Lab.
- Advanced "every AI" list, BYO GGUF.
- All translation/copy polish.
