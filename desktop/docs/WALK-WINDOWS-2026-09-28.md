# Windows walk, both machines, 2026-09-28

The first full Windows walk of the new first run (Start → Test → one pick → "Download X GB?" →
download → tune → start) and of the catalog rows that took LFM2.5, Qwen3.8-27B and the F16 rules.
Source `3f48dcbd`, synced by `git archive --prefix=kalsa-src-3f48dcbd/` → tar 13 998 080 bytes,
sha256 `c21fc8aad7535f03159e3d470f55787c46ed891ecdd4ac7e16a2d8e6e401812a`, the same on the Mac, the
Lenovo (`Get-FileHash`) and the Surface (`certutil`). Two machines:

- **the Lenovo** (owner's personal PC; `qdc_ed25519`, PowerShell 5.1 shell, elevated session-0 SSH):
  Core Ultra 9 185H, 32 GB, RTX 4050 Laptop 6141 MiB + Intel Arc, Windows 11.
- **the Surface** TABLET-V477JRIG (corporate-managed; `id_ed25519`, cmd shell): Surface Laptop 3,
  i7-1065G7, 16 GB, Iris Plus, Windows 11 25H2, no `wmic`.

Times are each machine's local clock (both America/New_York). Everything of ours lives in
`C:\kalsa-bench` on the Lenovo and `C:\Users\gualt\kalsa-src-3f48dcbd\bench` on the Surface.

Three labels, as in the last walk. Unmarked statements were measured today. **CODE-DERIVED** means
read from the source at `3f48dcbd`. **INFERRED** means neither measured nor in our code.

## 1. The real walk: it fails on both machines, for different reasons

`cargo test -p kalsa-brain --release real_walk -- --ignored --nocapture` with
`KALSA_BRAIN_REAL_WALK=unsloth/gemma-4-E4B-it-GGUF`, one run each (fresh `target` on both):

| | Lenovo | Surface |
|---|---|---|
| exit | 101 (200 s total: build + 6.35 s test) | 101 (478 s total: build + 13.1 s test) |
| chosen row | Google Gemma 4 E4B, 4 977 171 584 bytes, sha256 `85a896a0…` | same |
| machine | 32 GiB RAM, decode 84.6 GB/s, `DiscreteGpu { vram_bytes: Some(6439305216) }` | 16 GiB RAM, decode 53.1 GB/s, `Cpu` |
| engine chosen | the Vulkan build (decide returned Ok — the log reached "the catalog is choosing"; the verdicts of 09-26 stand) | none — decide failed |
| tune, speed line, chat | not reached | not reached |
| panic | `real_walk.rs:178` — "Kalsa isn't set up yet. Go to Home and press Start." | `real_walk.rs:178` — "None of the ways of running the assistant work on this computer. An app update may fix this." |

Both panics are the walk's own `.expect` on `startup::run` (`src-tauri/src/real_walk.rs:178`), so the
measurement numbers above (RAM, decode, detection) are the probe's real output; everything after
"deciding" never ran. Detection on the Surface is `Cpu` despite the Iris Plus, as in the night run.

**The Lenovo failure is the catalog, not the machine.** The walk stores the E4B choice in its scratch
state file, then `choose_model` judges a stored row against the budget of the build that won
(`src-tauri/src/startup.rs:380`): the Vulkan winner budgets the card — 6.0 GiB minus the
`max(3 GiB, 25%)` margin leaves 3.0 GiB — and every row's footprint at the 65 536-token pricing
window exceeds that (the smallest, LFM2.5 Q8, needs 3.7 GiB). An unrunnable stored row answers
`AwaitingChoice`, and `choose_with_processor_fallback` buys the CPU build only for `NothingFits`
(`startup.rs:435-436`), so the walk stops. On stop, `run` also **forgets the stored choice**
(`startup.rs:272-275`). At `a2cb3c93` the same situation fell back to the automatic answer with a
stale-note prefix — that is why the 09-26 walk passed. The sentence is `AwaitingChoice`'s
("Kalsa isn't set up yet…", `src-tauri/src/failure.rs:172-173`), which is false here in both halves:
something was set up, and pressing Start is exactly what already failed.

**The Surface failure is the network.** `dl.kalsa.io` does not answer from the Surface: a HEAD
request times out, and the walk's own fetch left
`runtime\archives\kalsa-server-v1.1.2-bin-win-cpu-x64.zip.part` **0 bytes** (created 13:33, never
grown). The same URL answers `HTTP/2 200, Content-Length 13 762 007` from the Mac and from the
Lenovo, while `huggingface.co` and `registry.npmjs.org` answer 200 from the Surface — INFERRED:
corporate filtering, not the site. The runtime holds only the b10950-era CPU build (its verdict
`36acf4d8…` names `llama-b10950-…zip`) beside an extracted v1.1.2 DLL set under `builds\cpu` whose
`.kalsa-build` record also names the b10950 archive and whose `kalsa-server.exe` launcher is absent —
so no build verifies, nothing can be fetched, `NoBackendWorked`. The verdict and tuning files were
untouched by all of this.

## 2. The catalog CLI, per machine

`kalsa-catalog --ram N --bandwidth B --no-phone`, N and B from each walk's measured line:

- **Lenovo** `--ram 32 --bandwidth 84.6`: budget 24.0 GiB, backend Cpu. **starts: Alibaba Qwen 3.6**
  (`Qwen/Qwen3.6-35B-A3B`), 20.6 GiB of weights, 23.6 GiB in memory at the 65 536-token pricing
  context, fetch 22 134 528 992 bytes; **second: Liquid LFM 2.5 — 2.7 GiB of weights**. The
  phone-free route prints no rationale line of its own; in the app this pick carries
  `PHONE_FREE_REASON` ("This is the biggest model this computer runs well…", `capability.rs:36`).
  A `--vram 6` variant (the app's detected-backend question) refuses with `NothingFits`:
  "This computer is not worth using: it can give a model 3.0 GiB and the smallest one in the catalog
  needs 3.7 GiB."
- **Surface** `--ram 16 --bandwidth 53.1`: budget 12.0 GiB. **starts: Liquid LFM 2.5**
  (`LFM2.5-2.6B-Q8_0.gguf`, 2 874 779 648 bytes), 3.7 GiB in memory; **second: none (nothing beside
  it clears the speed bar)**. Gemma 4 E4B fits but its predicted 6.6–9.6 tok/s does not clear the bar.

## 3. The installed app's first run

### Lenovo

- **Build**: `npx --yes @tauri-apps/cli@2 build` from the repo root (toolchain bin prepended to
  PATH, `npm ci` in `chat/` first, exit 0). Artifact `Kalsa_0.0.1_x64-setup.exe`, 6 833 409 bytes,
  sha256 `a0013415921aa74e56cc5cfa2a5013b382d29765dd1ecf57e817a5781672c794`.
- **Install** (`/S`): exit 0 in 4 s. Per-user: `%LOCALAPPDATA%\Kalsa\kalsa-brain.exe`
  (26 226 176 bytes) + `uninstall.exe`, an HKCU-only uninstall entry, Start Menu and Desktop
  shortcuts. `%APPDATA%\ai.kalsa.brain` and `%LOCALAPPDATA%\ai.kalsa.brain` did not exist before.
- **Elevated first launch, then a normal one — the DACL fix holds.** The app started from the SSH
  session created `pairing.json` within 1 s with SDDL
  `D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;S-1-5-21-120512253-2501214553-4001154198-1001)` — the third
  ACE names the current user's SID, which is what `1dd83765` changed it to do. `kalsa-instance.lock`
  carries only inherited ACEs (`D:AI(A;ID;0x1200a9;;;…-1002)(A;ID;FA;;;SY)(A;ID;FA;;;BA)(A;ID;FA;;;…-1001)`),
  not the pinned form — it is not one of the twins the fix covers. After the kill, the normal launch
  (one-shot `schtasks /Create … /IT` + `/Run`, task `KalsaWalk3f48dcbd`, deleted and confirmed gone)
  came up in the owner's session, opened its DevTools port, and drove.
- **What the first run did, in order** (WebView2 CDP, port 9333):
  1. "Checking the model already on your computer…" — the legacy migration
     (`legacy_choice.rs`) hashed the on-disk E4B against the digest in `runtime\tuning.txt`
     (`kalsa-tune/src/record/mod.rs:495`) and **stored it as the choice**.
  2. A stored choice means `firstRun` is false, so the opening's one automatic start fired — the
     walk measured ("Checking your computer…"), decided ("Getting ready…"), and hit the §1
     AwaitingChoice refusal, which **forgot the choice** (`startup.rs:272-275`).
  3. The page fell back to the plain Start screen. **No error was shown anywhere** — the first-run
     page owns the screen and the failure lives on the surface it displaced.
  4. The runtime tree was byte-for-byte identical before launch and after Test: **nothing downloads
     before Test and Allow.** `advanced.json` reads `"model": null` (written by `forget_choice`),
     and no `legacy-choice-checked` marker exists — so the next launch migrates, walks, fails and
     forgets again. **Every launch repeats the ~5 GB hash and the failed walk.**
  5. Pressing Start runs Test (the kept measurement answered in ~3 s) and the pick screen says:
     "Pick a model — This computer is not worth using: it can give a model 3.0 GiB and the smallest
     one in the catalog needs 3.7 GiB. — Show details". **No model is offered and there is no Start
     button any more** — on a 32 GB machine with a 6 GiB card, the first run is a dead end. The
     details card: "31.6 GiB of memory, 3.0 GiB free for a model, running on the graphics card.
     Memory speed was measured on the processor: at least 79.2 GB/s, and a model would run on
     something faster."
  6. The app's pick does not exist, so it cannot equal the CLI's Qwen 3.6 answer. The reason is the
     same card-budget question as §1: the preview sizes its menu by the **detected** backend
     (`capability.rs:185`, refusal path `:274-310`) and has no processor fallback, while the walk
     has one (`startup.rs:426-447`) and the CLI defaults to RAM.
- **Uninstall** (`uninstall.exe /S`): exit 0 in 3 s; install dir, HKCU entry and Desktop shortcut
  gone. Left: the empty `HKCU\Software\Kalsa` key (as last walk) plus the app data this test
  created — `%APPDATA%\ai.kalsa.brain` and `%LOCALAPPDATA%\ai.kalsa.brain` — both removed by exact
  path. Verdict/tuning files kept their 09-26 timestamps; no chosen model existed before this test,
  so nothing needed restoring.

### Surface

- **Build**: `npm ci` exit 0; same NSIS invocation, exit 0. Artifact `Kalsa_0.0.1_x64-setup.exe`,
  **6 836 172 bytes**, sha256 `69ce33098918fe77521a2f80509c2d787d6a33574d5d5faa1ac443faeb2f3c7b` —
  a different file from the Lenovo's build of the same commit (the frontend dist is rebuilt per
  machine).
- **Install** (`/S`): exit 0 in 3 s, per-user, HKCU-only, app data absent before.
- **The pick screen** (the owner was at the machine and pressed Start himself): "Pick a model —
  **Google Gemma 4 12B** — Smarter answers. — 7.7 GB download — Use this; **Liquid LFM 2.5** —
  Faster answers. — 2.9 GB download — Use this — Show details". Machine card: "15.6 GiB of memory,
  11.7 GiB free for a model, running on the processor. Memory speed was measured at 45.1 GB/s — the
  path a model would use." Predictions: 12B 4.1–5.8 tok/s, LFM 10.5–15.3 tok/s.
  - The app's probe measured **45.1 GB/s** where the walk's run measured **53.1 GB/s** — same probe
    class, two runs, 15 % apart; the catalog is fed whichever run answered last.
  - **The app's pick (Gemma 4 12B) differs from the CLI's (LFM 2.5).** This is the known catalog
    behaviour of `54651665`: when no row clears the dense speed floors the floors stand down and the
    biggest fitting row wins. Recorded as shown; not investigated here (a fix is already in flight).
- **Allow, on the smaller card** (per the 7 GB rule; 12B was not taken): "Use this" on Liquid LFM
  2.5 → "Download 2.9 GB? — Kalsa needs this file to run Liquid LFM 2.5. — Download / Cancel" →
  Download → "Getting ready…" → after 9 s: "Did not start — None of the ways of running the
  assistant work on this computer. An app update may fix this. — Try again", with both model cards
  ("Use this model") still on the page. The walk dies at the engine decide (§1, dl.kalsa.io) before
  any model byte moves — the runtime tree gained nothing but a still-0-byte `.part`. The choice was
  stored anyway (`advanced.json`, `"model": "e56e9deee8dd4819"` = LFM 2.5), so every turn-on now
  walks into the same wall.
- **Try again hangs.** The owner pressed Try again (~13:58) and the page has sat on "Getting
  ready…" since (≥ 6 minutes at last read): `brain_state` answers `{"kind":"stopped"}`, the app
  process is idle (22 s CPU across 12 min of uptime), it holds **no outbound socket** (only its door
  listeners 8132/8134), no engine child exists, and the `.part` is untouched. Two earlier walks with
  the same inputs failed cleanly in 9–13 s, so the hang is intermittent. CODE-DERIVED: it is not the
  downloader's read path — `range.rs:16,19` carry 10 s connect and 30 s read deadlines, and
  `PartFile::claim` is a `try_lock` that errors rather than waits (`part.rs:54`). Where it blocks is
  unresolved from outside; the page renders no Try again while the stuck step holds it, so the
  window is a dead end until restart.
- **Not uninstalled.** The owner is using the app; tearing it out from under him would be the one
  destructive act left, so the walk leaves it: `%LOCALAPPDATA%\Kalsa` (exe 26 228 224 bytes),
  the HKCU uninstall entry, both shortcuts, `%APPDATA%\ai.kalsa.brain` (choice = LFM 2.5 — created
  by this test; no chosen model existed before, so nothing of the owner's was overwritten) and
  `%LOCALAPPDATA%\ai.kalsa.brain`. The scheduled task `KalsaWalkSurf3f48dcbd` was deleted and
  confirmed gone. Until `dl.kalsa.io` is reachable from that network, the installed app cannot start
  any model.

## 4. The served id and /props

No app-started engine existed on either machine today, so the check ran against the engine by hand
on the Lenovo (vulkan build, `stories260K.gguf`, `--alias stories260K`, port 8139):

- `/v1/models` answered `id: "stories260K"` — **the file stem, never the path** (`c34150a7`; the
  alias is built per file at `crates/kalsa-launch/src/argv.rs:22-30`).
- The engine's own `/props` still names `model_path` (and `model_alias`). The strip is the door's
  relay (`c76dfe4c`, `crates/kalsa-door/src/proxy.rs:255-258`) — CODE-DERIVED only: the door answers
  401 without a credential and hunting for one was out of scope.

## 5. Things this run found

1. **The real walk cannot pass on a card-budgeted machine.** A stored row that misses the card's
   budget refuses as `AwaitingChoice` (`startup.rs:380`), the Vulkan→CPU fallback buys only
   `NothingFits` (`startup.rs:435-436`), the refusal also **forgets the choice**
   (`startup.rs:272-275`), and the sentence (`failure.rs:172-173`) is false twice over. Measured:
   both walks, exit 101. `a2cb3c93` fell back to the automatic answer instead — the behaviour
   changed in the first-run rework.
2. **The same refusal runs the installed app's first launch on the Lenovo, silently, in a loop.**
   The legacy migration re-adopts the E4B every launch (it writes no `legacy-choice-checked` marker
   when it succeeds — `legacy_choice.rs:107-113` — and the walk then forgets the choice), each
   launch re-hashes ~5 GB and re-fails, and the first-run page shows no error. Measured end to end.
3. **The first run on the Lenovo offers nothing and then removes Start.** "This computer is not
   worth using: it can give a model 3.0 GiB and the smallest one in the catalog needs 3.7 GiB." —
   the preview sizes by the detected card (`capability.rs:185,274-310`) with no processor fallback,
   on a machine whose RAM route answers Qwen 3.6. App pick ≠ CLI pick (finding per the brief).
4. **The Surface's app pick (Gemma 4 12B, 7.7 GB) differs from its CLI pick (LFM 2.5)** — the known
   `54651665` floor stand-down, recorded not investigated. Its own probe also read 45.1 GB/s where
   the walk's run read 53.1 GB/s.
5. **`dl.kalsa.io` is blocked on the Surface** (0-byte `.part`, HEAD timeout; 200 from the Mac and
   the Lenovo; HF and npmjs reachable from the Surface — INFERRED: corporate filter). Consequence:
   the app there can never start a model, and Try again left it hung (finding 6).
6. **An intermittent walk hang with no deadline.** Third walk on the Surface: "Getting ready…"
   forever, `brain_state` stopped, no CPU, no socket, no child, `.part` untouched; not inside the
   fetch's 10 s/30 s deadlines (`range.rs:16,19`) nor a part-claim wait (`part.rs:54`). Site
   unresolved — it needs a run with logging or a debugger on that machine.
7. **The elevated-launch DACL fix is verified on real hardware.** Elevated first launch wrote
   `pairing.json` with the user's SID in the SDDL (quoted in §3); the next normal launch started
   normally. The 09-26 lockout did not reproduce.
8. **`/v1/models` id is the file stem** (engine measured, `argv.rs:22-30`); the engine's `/props`
   still names the path and only the door's relay strips it (`proxy.rs:255-258`) — door untested
   (401 without a credential).
9. **Nothing downloads before Test and Allow** — the Lenovo runtime was byte-identical across
   launch, migration and Test; on the Surface the Allow moved no model bytes (the engine decide
   precedes placement). The 09-26 finding of an unasked 22 GB download at first launch is gone at
   `3f48dcbd`.
10. **Environment:** executing through the 0-byte rustup proxy symlinks now fails with `os error
    448 — untrusted mount point`; every cargo invocation on these machines must prepend the
    toolchain's `bin` (the `a2cb3c93` scripts already did). INFERRED: Windows hardening changed
    between 09-26 and 09-28.

## 6. What changed on each machine

**Lenovo (`C:\kalsa-bench`)** — added: `kalsa-3f48dcbd.tar`, `kalsa-src-3f48dcbd\` (with `target`
and `chat\node_modules`), `walk-3f48dcbd-1.log/.ps1/-watch.txt` (the watch is empty — no engine
ever ran), `nsis-3f48dcbd.log/.ps1`, `npm-ci-3f48dcbd.log`, `catalog-build.log`, `dl-test.ps1`,
`stem-3f48dcbd.ps1`, `app-3f48dcbd-*` scripts, pages and logs, `app-3f48dcbd-runtime-state.txt`,
`backup-3f48dcbd\` (the three runtime `.txt` files, copied), and two `load.log` lines. In the
product's dirs: nothing survived this walk — the install was uninstalled, the app data it created
was removed by exact path, the engine archives, models and verdicts are byte-identical, the
scheduled task is gone (`schtasks /Query`: not found), and the hand-started engine on port 8139 was
killed. Restored: nothing needed it (no chosen model existed before the test).

**Surface (`C:\Users\gualt`)** — added: `kalsa-3f48dcbd.tar`, `kalsa-src-3f48dcbd\` (with `target`,
`chat\node_modules` and `bench\` holding the scripts, logs and the `backup-3f48dcbd\` copies of the
runtime `.txt` files). In the product's dirs: the verdict and tuning files are untouched; the 0-byte
`.part` from the morning's walk is still there; the scheduled task is deleted. **The app is left
installed and running in the owner's hands** (see §3): `%LOCALAPPDATA%\Kalsa`, the HKCU uninstall
entry, both shortcuts, `%APPDATA%\ai.kalsa.brain` (whose stored choice — Liquid LFM 2.5 — this walk
created) and `%LOCALAPPDATA%\ai.kalsa.brain`.
