# Lenovo walk with the fork, 2026-09-26

The first Windows walk on the kalsa fork (`kalsa-server` v1.1.2) instead of upstream llama.cpp, plus the
first NSIS installer built, installed, started and uninstalled on Windows. Source: `a2cb3c93`, synced by
`git archive a2cb3c93` (tar sha256 `0ad22ca7…5f097f94`, the same on both ends) → scp → `tar -xf` into the
fresh `C:\kalsa-bench\src-a2cb3c93`. Machine: the owner's Lenovo "marcolenovo" (Core Ultra 9 185H 16C/22T,
32 GB, RTX 4050 Laptop 6141 MiB + Intel Arc, Windows 11). Times are the Lenovo's clock. Everything below
is measured unless it says INFERRED. The raw logs are in `C:\kalsa-bench` and on the Mac as
`/tmp/lenovo-walk-a2cb3c93-*`.

## 1. VC++ runtime on this machine

Present. `HKLM\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64`: `Installed=1`, `Version=v14.50.35719.00`
(the WOW6432Node key says the same). In `C:\Windows\System32`: `vcruntime140.dll`, `vcruntime140_1.dll`,
`msvcp140.dll` and `vcomp140.dll`, all FileVersion `14.50.35719.0`. The uninstall list carries
"Microsoft Visual C++ v14 Redistributable (x64) - 14.50.35719". So this machine cannot show what happens
without the runtime: nothing tonight exercised that path.

## 2. The real walk

`cargo test -p kalsa-brain --release real_walk -- --ignored --nocapture` with
`KALSA_BRAIN_REAL_WALK=unsloth/gemma-4-E4B-it-GGUF`, run twice.

| | run 1 | run 2 |
|---|---|---|
| exit | 0 (408 s: 3 m 42 s build, 184.12 s test) | 0 (104 s, 32.10 s test) |
| machine | decode 85.3 GB/s, `DiscreteGpu { vram_bytes: Some(6439305216) }` | 73.1 GB/s, same |
| engine archives | downloaded: `runtime bytes 26491005` (Vulkan), `13762007` (CPU) | none (verdicts stand) |
| tune | graphics 47.5 tok/s, processor 16 threads 11.0, 22 threads 7.5 | same record |
| up | 9.8 s | 11.8 s |
| speed line | `speed: checked 44.9 tokens/s against 47.5 recorded` | `speed: checked 45.2 tokens/s against 47.5 recorded` |
| chat timings | prompt 18 tok in **21 353.3 ms** (0.8 tok/s); decode 2 tok in 32.1 ms (31.2 tok/s) | prompt 18 tok in 153.5 ms (117.3 tok/s); decode 2 tok in 31.2 ms (32.0 tok/s) |
| stop | `Gone { needed: Kill }; process Reaped; port 127.0.0.1:8130 — Gone` | same |

**Download, hash, extraction.** The runtime now holds `kalsa-server-v1.1.2-bin-win-vulkan-x64.zip`
(26 491 005 bytes, sha256 `24f0a982…c85c245e`) and `…-win-cpu-x64.zip` (13 762 007 bytes, `60b6cb68…ff57cc`).
Both equal the pins in `crates/kalsa-runtime/src/assets.rs:229` and `:215`. The extracted launchers hash to
`6e3c8714…b3e12` (Vulkan) and `a8591905…d673` (CPU), equal to the `exe_sha256` pins at `:227` and `:213`.
They extract to `builds\{vulkan,cpu}\kalsa-server-v1.1.2\`. The old verdicts (`fingerprint=787061f5…`,
upstream) were replaced by `backend=vulkan fingerprint=24f0a982…` and `backend=cpu fingerprint=60b6cb68…`.

**Why Vulkan.** Detection said `DiscreteGpu`. For that, `crates/kalsa-runtime/src/candidates.rs:39-41`
orders `[Vulkan, Cpu]`, and the Vulkan probe on `stories260K.gguf` answered, so Vulkan won. The CPU build
was fetched as well, for the processor fallback slot and the tune's processor candidates. The walk's
engine, from the process watcher:

```
builds\vulkan\kalsa-server-v1.1.2\kalsa-server.exe --host 127.0.0.1 --port 8130 --model …\gemma-4-E4B-it-Q4_K_M.gguf
--threads 16 --threads-batch 16 --batch-size 2048 --ubatch-size 512 --ctx-size 65536 --flash-attn on
--cache-type-k q8_0 --cache-type-v q8_0 --sleep-idle-seconds 300 --no-webui --parallel 1 --cache-ram 4755
--slot-save-path …\slots --ctx-checkpoints 1
```

Peak GPU memory during run 1: 3659 MiB.

**`--parallel` is 1, and it should be.** The walk calls `startup::run(…, devices = 1, …)`
(`src-tauri/src/real_walk.rs:170`). The app passes the enrolled device count (`src-tauri/src/main.rs:1537`),
which on a machine with no phone paired is the host alone. The plan is `funded_parallel(devices)`, and the
inlet can only take it down (`src-tauri/src/startup.rs:700-705`). So one device gives `--parallel 1` with
or without the fork. What the fork changes is the clamp, and that is proven separately:

- **Inlet detected.** Both `llama-server-impl.dll` files (Vulkan and CPU) contain the literal `x-kalsa-slot`
  (a case-sensitive byte search, the same test as `crates/kalsa-runtime/src/inlet.rs:62`). So
  `planned_parallel` keeps whatever it is asked for.
- **The engine serves more than one slot.** The fork's Vulkan launcher, run by hand with `--parallel 2`
  on `stories260K.gguf`, answered `/props` `total_slots=2` and logged `n_slots = 2`.
- NOT exercised: `--parallel` > 1 from the app itself. That needs a second enrolled device, and no phone
  has been paired to the Lenovo.

**The 21-second first prompt.** Run 1's chat prompt took 21 353 ms, and run 2's took 153.5 ms.
The upstream walks of 2026-09-25 whose speed check ran on graphics took 142.6–166.1 ms for the same
prompt (`walk-3aa97bd5-1-fresh`, `-2-record`, `-3-pressure`). The speed
check did not see it (decode 44.9 tok/s). INFERRED: Vulkan compiling its pipelines once for the
freshly extracted `ggml-vulkan.dll` on the first prompt-sized batch. The tune and the speed check only
decode. If so, a new install's first chat stalls about 20 s once. Measure it in the app before shipping.

**Graphics init failure / the rule retry.** It did not happen: VRAM was free (5920 MiB at the start), and
the graphics launch came up both times. The question stays open for a busy GPU. `real_walk.rs` panics on
`ServerState::Failed`. The app instead retries once with the rule's launch when the tuned start fails
`NotReady`/`ServerExited`/`ServerNotStarted` and the tune changed the argv (`src-tauri/src/main.rs:1323-1335`).

## 3. NSIS installer

Node was already there (`C:\Program Files\nodejs`, v26.7.0), and so was Tauri's NSIS toolset
(`%LOCALAPPDATA%\tauri\NSIS`, dated 2026-05-27). The repo pins no `@tauri-apps/cli`, so
`npx --yes @tauri-apps/cli@2` fetched it into the user's npm cache (`%LOCALAPPDATA%\npm-cache\_npx`). That
is not a global install. WebView2 153.0.4234.48 was present.

- The build must run from the repo root. From `src-tauri` the CLI finds no `package.json` below it, the
  `beforeBuildCommand` `npm --prefix ../chat run build` resolves to `C:\kalsa-bench\chat`, and the build
  fails (ENOENT, exit 1).
- From the root: exit 0 in 187 s. Artifact:
  `C:\kalsa-bench\src-a2cb3c93\target\release\bundle\nsis\Kalsa_0.0.1_x64-setup.exe`, 6 750 411 bytes,
  sha256 `96a78b67c90e929d998200aabe99d96860739c0176b00732255a59d02e6e64b3`.
- **Install** (`/S`): exit 0 in 5 s, with no elevation. Per-user: `%LOCALAPPDATA%\Kalsa\kalsa-brain.exe`
  (25 793 024 bytes) and `uninstall.exe`, an uninstall entry under HKCU only (none in HKLM), a Start Menu
  and a Desktop shortcut.
- **The installed app has no VC++ dependency.** `dumpbin /dependents kalsa-brain.exe` lists no
  `VCRUNTIME*`/`MSVCP*`/`VCOMP*` (INFERRED: the Tauri CLI links the CRT statically). Only the downloaded
  engine needs the runtime.
- **Launch.** From the SSH session (session 0) the app process stayed up, but WebView2's DevTools port
  never opened, so it could not be driven. INFERRED: WebView2 does not render in session 0. The next
  launches went through a one-shot scheduled task (`/IT`, owner's session 1; the task was deleted every
  time and `schtasks /Query` confirms it is gone). They drove the page's own `invoke(…)` calls over
  WebView2 DevTools. That put a Kalsa window on the owner's desktop for a few minutes.
- **Engine start.** The page turns the brain on by itself once per launch
  (`chat/src/surfaces/BrainSurface.tsx:93-97`). With Gemma 4 E4B chosen, the state went `stopped` (28 s)
  → `starting` (77 s) → `running` (90 s), and the engine came up as the app's child with the same argv as
  the walk (slot path `%APPDATA%\ai.kalsa.brain\slots`, `--parallel 1`). `/health` answered
  `{"status":"ok"}`, `/props` gave `total_slots=1`, and the app listened on 127.0.0.1:8131/8132/8134.
  `brain_stop` answered `ok` and 0 engines were left.
- **Uninstall** (`uninstall.exe /S`): exit 0. The install dir, the HKCU uninstall entry and both shortcuts
  are gone. Left behind: an empty `HKCU\Software\Kalsa\Kalsa` key, plus the app data
  (`%APPDATA%\ai.kalsa.brain`, `%LOCALAPPDATA%\ai.kalsa.brain\EBWebView`). None of these existed before
  the install, and I removed them by exact path. `%LOCALAPPDATA%\kalsa-brain\runtime` (engines, models)
  is outside the installer and stays.
- **SmartScreen: not exercised.** It cannot be over SSH, and a locally built file carries no
  Mark-of-the-Web anyway. The download → SmartScreen → install path is unverified.

## 4. Things this run found

1. **An elevated first launch locks the app out of its own pairing store.** My first launch ran from the
   elevated SSH token. It created `pairing.json` and `kalsa-instance.lock` with owner
   `BUILTIN\Administrators`, and the DACL `D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;OW)`
   (`crates/kalsa-pairing/src/store.rs:651`; the same SDDL is at `crates/kalsa-iroh/src/key.rs:163`). The
   next, non-elevated launch refused to start: "This computer could not read its existing phone
   connection. Fixing permissions and trying again may help." INFERRED: an owner who runs Kalsa once "as
   administrator" reaches the same state. Not fixed tonight. The direction: grant the user's own SID
   explicitly, or set the owner to the user.
2. **A fresh install downloads the automatic choice at first launch, and on this machine that is 22 GB.**
   With no stored choice, the automatic route picks Qwen 3.6 35B-A3B (22 134 528 992 bytes; the VRAM route
   refuses at a 3.0 GiB budget, and the RAM route has 24.0 GiB). My run set Gemma through
   `brain_choose_model` right after launch, but the self-started walk had already begun and fetched
   21 192 741 393 bytes in about 10 min before I killed the app. INFERRED: the walk reads the choice when
   it starts. I deleted the `.part` by exact name. Whether a 22 GB unasked download on first launch is
   acceptable is an owner call.
3. **The panel says "processor" while the graphics build runs.** The installed app's state read "No model
   fits this computer's graphics card's memory, so this model runs on the processor", with
   `builds\vulkan\…\kalsa-server.exe` running and the tune's winner being graphics (47.5 vs 11.0 tok/s).
   `real_walk.rs` accepts that reason by design (the `PROCESSOR_FALLBACK_REASON` prefix).
4. **Orphans.** `runtime\archives` still holds `llama-b10950-bin-win-{cpu,vulkan}-x64.zip` (18 426 198 and
   31 673 509 bytes). Nothing uses them any more.

## 5. VC++: what we must do

Measured with dumpbin: every fork module imports the dynamic runtime. `kalsa-server.exe` imports
`VCRUNTIME140.dll`. `llama-server-impl.dll`, `llama-common.dll`, `llama.dll`, `ggml.dll`, `ggml-base.dll`,
`ggml-vulkan.dll` and `mtmd.dll` import `MSVCP140.dll`, `VCRUNTIME140.dll` and `VCRUNTIME140_1.dll`. The
CPU variants (`ggml-cpu-alderlake.dll` sampled) also import `VCOMP140.DLL`, MSVC's OpenMP runtime. The fork
ships none of these, and the app itself needs none (§3).

**(a) The NSIS installer runs `vc_redist.x64.exe`.**
- Covers all four DLLs. INFERRED: the redistributable ships `vcomp140.dll`. Measured: on this machine it
  sits beside the others at the same 14.50.35719 version.
- Our installer is per-user and asks for no elevation (measured). INFERRED: `vc_redist.x64.exe` installs
  per machine and needs admin, so every install that lacks it gains a UAC prompt, and a standard user
  cannot finish.
- It only covers installs made by our installer. The engine is downloaded by the app at runtime, so the
  app should still check the runtime before a probe.

**(b) The fork is built with the static CRT (`/MT`).**
- Removes `VCRUNTIME140`/`MSVCP140`, with no installer work.
- Does NOT remove `VCOMP140`. MSVC 14.44 on this machine ships only `vcomp.lib` and `vcompd.lib`, and
  INFERRED these are import libraries: MSVC has no static OpenMP. The CPU build would also need
  `GGML_OPENMP=OFF` (ggml's own thread pool). Its speed on these machines is unmeasured.
- INFERRED risk: the fork is a dozen C++ DLLs. Under `/MT` each DLL gets its own CRT and heap, so any
  `std::string`/`std::vector` or allocation that crosses a DLL boundary and is freed on the other side
  corrupts memory. Nobody has checked the fork's DLL interfaces for that.

**Recommendation.** Of the two, **(a)**. (b) is two changes (`/MT` plus OpenMP off), and each has a risk
nobody has measured. (a) is a known Microsoft package whose only cost is a UAC prompt.

A third option beat both on the facts above, and I recommend it over (a): **ship the four DLLs beside
`kalsa-server.exe` in the fork's Windows zips** (Microsoft's app-local deployment; INFERRED as supported).
The three measured here total 724 288 bytes. There is no elevation, the per-user install stays per-user,
and it covers every way the engine arrives, because the engine is the thing that needs them. Its cost:
Windows Update does not service app-local copies, so each fork release must carry current DLLs. In every
case the app should turn a missing runtime into a sentence, not a failed probe. INFERRED: today a launch
without it would die at load (STATUS_DLL_NOT_FOUND) and surface as "no build works". That path has not
been run on any machine.

## 6. What changed on the Lenovo

Added in `C:\kalsa-bench`: `kalsa-a2cb3c93.tar`, `src-a2cb3c93\` (with its `target` and `chat\node_modules`),
the `walk-a2cb3c93-*`, `nsis-a2cb3c93-*`, `app-a2cb3c93-*`, `par2-a2cb3c93-*`, `dumpbin-a2cb3c93.ps1` and
`cdp-a2cb3c93.mjs` files, and two lines in `load.log`. In the product's runtime: the v1.1.2 archives and
builds, both verdicts rewritten, and the model files unchanged. In the user's npm cache: `@tauri-apps/cli`.
Removed after use, by exact name: the Qwen `.part`, the installer's leftovers listed in §3, and the
scheduled task.
