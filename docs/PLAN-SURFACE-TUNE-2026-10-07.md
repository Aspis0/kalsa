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

#### Result 2026-10-07 (walk)

Build **8f30e43c**, built on the Surface from a fresh `git archive` (the first Windows build since
c7da4875 — it **compiled clean**: `npm ci` in `chat/`, then `npx --yes @tauri-apps/cli@2.12.1 build`
from the repo root, `TAURI_BUILD_EXIT=0`, cargo release 10m47s, 7 pre-existing warnings, no
errors). Artifacts: `target\release\kalsa-brain.exe` 29 030 400 B, NSIS
`Kalsa_0.0.1_x64-setup.exe` 7 719 717 B, both kept in `C:\Users\gualt\kalsa-src-8f30e43c`.
Installed at `%LOCALAPPDATA%\Kalsa\kalsa-brain.exe`; the 43740d87 exe is backed up beside it as
**`kalsa-brain.exe.bak-43740d87-20261007`** (27 853 824 B, sha256 `58389eb7…3501`; the first
install attempt's `ren` was eaten by cmd-over-ssh quoting and the copy overwrote in place — the
backup was restored byte-identical from our old `kalsa-src\target\release`, same size and
timestamp as what was installed). The app's Gemma tuning record was moved aside as
`runtime\tuning-85a896a0….txt.aside-20261007` (never deleted); models, drafter, engine builds and
`verdict.txt` untouched. GUI starts went through a one-shot `/IT` task (`KalsaLab1007`, deleted
afterwards); all times UTC, from `%LOCALAPPDATA%\ai.kalsa.brain\logs\kalsa-brain.log`.

**First start (15:58:37):** tune from zero, 15:58:40 → 16:18:12 = **19m32s, 8 lifetimes** (not the
hoped 6–7): four first lifetimes, the off-winner's full sweep (2/3/4 — none slower than its own off
decode), the graphics sweep's first setting refused → stopped, and the budget then cutting the
**mixed** shape's still-owed sweep — its prefill (20 tok/s) sat exactly on the 1.05 `PREFILL_EDGE`
over the winner's 19. So the verdict was **withheld once** (`unfinished (Sweep; 4/4 candidates
ran)`), NOT saved at the first start. Winner `processor 8 threads + drafter 3`; engine ready 36.4 s;
`door started: 127.0.0.1:8131, 1 seats` at 16:18:49 (20m16s after launch). Verbatim:

```
16:18:12Z tune: graphics: backend vulkan, prompt 25 tok/s, decode 4 tok/s, reply 91.3s
16:18:12Z tune: graphics + processor 4 threads: backend vulkan, prompt 20 tok/s, decode 6 tok/s, reply 91.1s
16:18:12Z tune: processor 4 threads: backend cpu, prompt 17 tok/s, decode 6 tok/s, reply 99.4s
16:18:12Z tune: processor 8 threads: backend cpu, prompt 19 tok/s, decode 6 tok/s, reply 92.1s
16:18:12Z tune: processor 8 threads + drafter 2: … decode 6 tok/s, reply 91.5s
16:18:12Z tune: processor 8 threads + drafter 3: … decode 8 tok/s, reply 84.9s
16:18:12Z tune: processor 8 threads + drafter 4: … decode 6 tok/s, reply 91.4s
16:18:12Z tune: graphics + drafter 2: backend vulkan, refused (NoUsableAnswer, prompt rate Some(25.415288728944702))
16:18:12Z the tune's verdict is unfinished (Sweep; 4/4 candidates ran); withheld once — the next start finishes the measuring
16:18:12Z tune winner: processor 8 threads + drafter 3
```

**Second start (16:25:22):** the retry (step 4's mechanism) ran **only the 2 missing lifetimes**
(2m41s): `graphics + processor 4 threads + drafter 2: … decode 7 tok/s, reply 84.7s` (7 > its off
6, no stop), `… + drafter 3: … decode 5 tok/s, reply 98.3s` (5 ≤ 6 → **sweep stopped**, drafter 4
never ran), pooled the first attempt's trials verbatim, saved a normal verdict — no "withheld"
line — same winner, `door started` 16:28:27, **3m05s after launch**. **Third start (16:32:01):**
record hit — `tune winner: processor 8 threads + drafter 3` logged from the record at 16:32:06
with no measuring, engine ready 14.7 s (warm), `door started` 16:32:20, **~19 s to the door**. The
winner's engine argv is the CPU-build shape (`--threads 8 --threads-batch 8`, no device flags,
drafter 3) — identical to the 2026-10-06 winner.

**Close (WM_CLOSE via the `/IT` task):** two valid closes, **3.05 s** and **3.09 s** (`CloseMainWindow=True`, `app exit` logged); after each, no `kalsa-server`, no `kalsa-brain` left, and our WebView2 children exit with the app. The first "close" was NOT a measurement: the close task was refused twice (0x800710E0, the task name still held the running app), and a `schtasks /End` of that task at ~16:24:15 hard-killed the app mid-teardown (`door stopped` 16:24:16, no `app exit`; next start: `WARN the previous session did not exit cleanly`). A walker error, not an app bug: use a separate task name for the close.

**Minimized idle, 5 min (app running, window minimized, engine up):** kalsa-brain 0.094 CPU-s
(0.004 % of total capacity; ×8 = 0.03 % of one core), our 6 webview children 0.297 CPU-s (0.012 %
of total; ×8 = 0.099 %), kalsa-server 1.438 CPU-s (0.06 % of total; ×8 = 0.48 %). Against
2026-10-05 (brain 0.04 %, webview 0.02 %, engine 0.8 %): the brain's idle did **not** rise with the
new mDNS endpoint — at or below the old number under either reading; the engine idles lower too.

**No WARN/ERROR lines in the whole walk — and no mDNS WARN** on this corporate network (the
desktop endpoint's discovery either works silently or stays quiet here).

Left in place at the end: the 8f30e43c build installed and **running** (minimized, door on 8131),
the backup `kalsa-brain.exe.bak-43740d87-20261007`, the moved-aside record, and our build tree
`C:\Users\gualt\kalsa-src-8f30e43c` + `kalsa-src-8f30e43c-build.log` (nothing of the owner's was
modified; `kalsa-src2` and the three `Kalsa*1001` tasks untouched).

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

**Result 2026-10-07 (Mac side PASS):** build 8eb24932 launched at 13:18:52Z with the screen locked (`CGSSessionScreenIsLocked` true) and no page running: engine ready 13:19:07Z, `door started: 127.0.0.1:8131, 3 seats` 13:19:09Z, 8131 listening, no WARN/ERROR. Phone dial still to check (the Jelly was not on adb; the S23 is the coordinator's).

### 8. Phone tests (Jelly, app main 67c3eea5 or later)
Owner 2026-10-06: the iOS/UX session is archived and these tests are mine. The Android background
behaviour (reply in background, iroh stop after 30 s) is decided and stays as is. Open:
- Room author name live: write in the desktop Room while the Jelly has the Room open → the entry
  reads the host's label, never "Former member" (history already checked on 2026-10-06).
- Room list emptying for a few seconds after background → foreground: read logcat
  `KALSA_ROOM_FEED` (op/entries/seqFirst/seqLast/epoch8/status) and say which side empties it.
- Keyboard (react-native-keyboard-controller 1.22.6) in chat and Room.
Phone code lives in the app repo (`/Users/marco/Projects/kalsa`, branch main); a phone-side fix
follows that repo's rules.

**Result 2026-10-08 ~00:07 EDT (Jelly, APK c48e5ddd, Mac app build of 2026-10-07 11:42):**
- Keyboard in chat: PASS — the composer rides above the keyboard, typed text visible. Room composer not typed into.
- Room list on reopen: NOT reproduced. Open: `mount` (0 entries, loading) → `read` 5 entries seq 14–18 epoch faa2f8f2 in ~110 ms.
  Background 5 s → foreground: no feed event, list intact. Background 40 s (`background_stop` stopped) → foreground:
  `start` + dial 259 ms, no feed event, list full in the first frame after the transition.
- Room author name live: NOT run — the Mac screen had another app in front (likely another session); driving Kalsa
  with clicks would steal its focus. With the owner.
- Lock-screen dial from the phone: NOT run (needs the Mac locked; owner asleep, other sessions use the screen).

## Order and gates
1, 2 and 6 first (labs; 1 and 2 may change 3). Then 3 → review → 4 → review (one hostile review each, writer and
reviewer different models, P0/P1 fixed, the rest to `docs/BACKLOG.md`). Then 5, 8, and 7 if still open. Push to `brain`; no
tags or releases.

## Not in this plan
Windows type-check from the Mac (BACKLOG), the LFM re-download, the download that resumes by itself,
the updater (beta).
