# Plan — the first start on a slow laptop (Wednesday 2026-10-07)

Owner, 2026-10-05 night: "fai tutto mercoledì". Goal: on a machine like the Surface (i7-1065G7,
Iris Plus, no dedicated GPU) the first start tunes once, inside the budget, and the result is
saved the first time.

## Where we are (measured on the Surface 2026-10-05, build 43740d87)

- The drafted pass now sweeps the off-winner and every shape reading the prompt ≥5 % faster
  (`crates/kalsa-tune/src/passes/mod.rs`, `PREFILL_EDGE`): 16 → 10 lifetimes. The tune line says
  "up to N min", then "about N min left", never climbing.
- Each lifetime costs ~2 min there. First tune: 9 of 10 ran, the budget (1080 s,
  `crates/kalsa-tune/src/measure/mod.rs`) stopped `graphics + drafter 4`, the verdict was
  "unfinished (Sweep) — withheld once", and the next start ran the WHOLE tune again (18.6 min) and
  pooled it (`src-tauri/src/tune_step.rs:378-420`). First use ≈ 37 min across two starts.
- Winner: processor 8 threads + MTP 3, reply 70.0 s vs 77.0 s off (−9 %).
- MTP on the Iris (Vulkan `graphics` shape): `refused (NoUsableAnswer)` at n=2 and n=3 in the first
  tune; in the second, one setting measured 3 tok/s, one refused. Its off lifetime answers
  (prompt 25 tok/s, decode 5 tok/s).
- Vulkan off numbers: graphics 88.4 s, mixed (`-ngl 0`) 84.0 s, CPU 4T 87.0 s, CPU 8T 77.0 s. On
  2026-10-01 (LFM 2.5) the mixed shape won on the same machine; with Gemma E4B it does not.

## Steps

### 1. Lab: why MTP on the Iris gives no usable answer
Run `kalsa-server` by hand on the Surface with the E4B drafter on the Vulkan build, n=2/3/4, `-lv 5`,
the tune's own decode ask (`crates/kalsa-tune/src/sample.rs` `DRAFT_PROMPT`, 128 tokens). Read
`timings` and `draft_n` / `draft_n_accepted`. Questions: does it finish within the 60 s request
bound at 3–5 tok/s, is the drafter on the iGPU or the CPU (`crates/kalsa-launch/src/argv.rs:68-73`),
is acceptance near zero, is it an engine bug. Deliverable: `docs/LAB-IRIS-MTP-2026-10-07.md` with
numbers, and one decision: fix (engine or launch flags) or never sweep drafted settings on an iGPU
shape.

### 2. Lab: Vulkan on the Iris
Same machine, same model: graphics vs mixed vs CPU, prompt and decode, two runs each, to see whether
any Vulkan shape can ever win Gemma E4B there. If none can, record it — dropping a shape saves one
lifetime plus its sweep on every Iris-class machine.

### 3. A shape whose drafter refuses stops sweeping
In pass two, the first `NoUsableAnswer` (or any refusal) on a drafted setting ends that shape's
remaining settings, and they leave the plan through `lower()`. On the 2026-10-05 tune this saves two
lifetimes (~4 min) and lets the tune finish inside the budget. Test with the Surface's numbers;
mutation proves it.

### 4. A retry measures only what is missing
When the verdict is withheld once, the next start runs only the lifetimes the first attempt did not
complete and pools them with the saved trials, instead of the whole tune. The plan total and the
"up to / about N min" line start from what is left. Test: an unfinished Sweep marker → the retry
runs only the missing drafted settings.

### 5. Walk on the Surface
Move the tuning record aside (never delete), first start from zero: one tune, inside ~18 min,
verdict saved the first time, the second start straight to the door. Close ×3 and minimized idle as
on 2026-10-05.

### 6. Lab: the phone reaches the PC on the home network without the relay
Owner OK 2026-10-06. On the night of 2026-10-05/06 the Mac's link to the n0 relay failed for 2+ h
(`Ping timeout`, DNS `Resolve failed`, `tls handshake eof` in the app log from ~06:04Z), while the
Mac's internet worked. The Jelly, on the same LAN, could not dial the door (node 459c914b) at all:
the dial goes only through the relay. Questions: does the desktop endpoint
(`crates/kalsa-iroh/src/bridge.rs`, `RelayChoice::N0Public`; `transport.rs` `presets::N0`) publish
its direct addresses, and does the phone's dial use them; would local discovery (iroh mDNS or the
address carried in the pairing) let a phone at home connect with the relay down. Test: block the
relay on the Mac (hosts entry or firewall, restored after), dial from the Jelly on the same Wi-Fi.
Deliverable: `docs/LAB-IROH-LAN-2026-10-07.md` and a fix plan. Phone-side changes go to the iOS/UX
session; the wire stays unchanged unless the owner agrees.

### 7. Lock-screen door check on the Mac (morning of 2026-10-06; here only if not done then)
Rebuild the Mac app from brain while unlocked, then relaunch it behind the lock: 8131 must listen
and the Jelly must dial without anyone unlocking (fix 22eed856 + bec3614a).

### 8. Phone tests (Jelly, app main 67c3eea5 or later)
Owner 2026-10-06: the iOS/UX session is archived and these tests are mine. Open from that session:
- Room author name live: write in the desktop Room while the Jelly has the Room open → the entry
  reads the host's label, never "Former member" (history already checked on 2026-10-06).
- Room list emptying for a few seconds after background → foreground: read logcat
  `KALSA_ROOM_FEED` (op/entries/seqFirst/seqLast/epoch8/status) and say which side empties it.
- Keyboard (react-native-keyboard-controller 1.22.6) in chat and Room.
- Android iroh background stop: 30 s after HOME, no tokio threads, no avc; first dial after resume
  still reaches the door.
Phone code lives in the app repo (`/Users/marco/Projects/kalsa`, branch main); a phone-side fix
follows that repo's rules.

## Order and gates
1, 2 and 6 first (labs; 1 and 2 may change 3). Then 3 → review → 4 → review (one hostile review each, writer and
reviewer different models, P0/P1 fixed, the rest to `docs/BACKLOG.md`). Then 5, 8, and 7 if still open. Push to `brain`; no
tags or releases.

## Not in this plan
Windows type-check from the Mac (BACKLOG), the LFM re-download, the download that resumes by itself,
the updater (beta).
