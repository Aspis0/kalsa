# S23 Expo 57 patch-line bump smoke — BLOCKED at step 0/4 (adb link lost, phone healthy)

Date: 2026-10-02 03:40–05:00 EDT (Mac clock). Device: Galaxy S23 (SM-S911U, SM8550 /
Adreno 740 / Hexagon v73), serial `R3CW406P8CV`, wireless adb `192.168.1.152:34673`.
Session goal: smoke the Expo SDK 57 patch bump (app main `7ddf39ad`, CI run
`36979390863`) per the audit
`ios-readiness/AUDIT-expo57-bump.md` — the failure signature to watch for is a
SILENT HANG (expo-modules-core 57.0.10+ turns a double-settled promise into a
promise that never settles), not a crash.

**STATUS: BLOCKED. 0 of 7 smoke items could start. The phone is healthy and the
session's state changes are armed/recorded, but my adb link to it is down and
cannot be revived remotely (see "The incident"). Everything is staged so the
smoke can run the moment Wireless debugging is re-enabled on the phone (10 s of
physical action) or the link returns.**

## What is staged and verified

- **APK:** CI run `36979390863` "APK (device build)", headSha `7ddf39ad`
  (expo57 bump line, base `101c2bdd`), success, artifact
  `kalsa-apk-arm64-v8a-7ddf39ad…/app-release.apk`, 182,071,049 B, sha256
  `edbc7c1c83f6591f633b378c49faebaf090127730d82ce62035868e3d78b77d0`
  (`raw/apk.sha256`). Downloaded to `artifacts/` (not committed).
- **HTP skel check (item 3 static clause, done):** `unzip -l` lists FOUR skels —
  v73/v75/v79/v81 (`raw/apk-htp-listing.txt`; v81 is new vs the 101c2bdd
  baseline which had three). The extracted `assets/ggml-hexagon/libggml-htp-v73.so`
  hashes to `7c693a438dbb32d6c788aa3a6580dbff09bf7abba05027e54d854e7d9709adfa`,
  byte-identical to
  `~/Projects/llama.rn-kalsa-gov-platform/bin/arm64-v8a/libggml-htp-v73.so` and
  to the pin recorded in that directory's `HTP_SKELS` manifest
  (`libggml-htp-v73.so=7c693a43…`).
- **Bench keys (step 0, part 1 — done on the still-installed debuggable
  101c2bdd build, via the s23-layers-device-proof run-as harness):**
  - Found before any write (`raw/keys-before.txt`): `route=gpu`,
    `npu_lane=off`, `energy_trace=1`, `kvtranscript=1`, `nativelog=off`
    (exactly the values the previous campaign restored).
  - Armed (`raw/keys-armed.txt`): `npu_lane=on`, `route=auto`, plus
    `kalsa.bench.devmodels=1` (needed so the release build's catalog lists the
    sha256-pinned `[DEV] MiniCPM5 2B` for the item-4 SHA-sidecar clause).
    `energy_trace/kvtranscript/nativelog` left as found.
  - These keys live in the app's AsyncStorage RKStorage and survive
    `adb install -r`; on the release build there is no run-as, so the survival
    check is behavioral (a lane-on turn must log `layers_device:"HTP0"`), and
    the keys are intentionally LEFT SET at session end for the coordinator to
    restore.
- **Models on phone** (`raw/models-onphone.txt`): qwen3.5-4b (+mmproj),
  lfm2.5-8b-a1b, lfm2.5-8b-a1b-kexp, lfm2.5-2.6b, qwen3.5-2b, dev-minicpm5-2b
  (with `.sha256-ok`). The in-app picker (verified on-device) offers
  Qwen 3.5 4B · Q4_K_M and LFM2.5 2.6B · QAD-Q4_0 — the two item-1 models.
- **Fixtures pushed** to `/sdcard/Download/`: `kalsa-smoke-12p.pdf` (12-page
  synthetic PDF, 48,043 B) and `kalsa-smoke.docx` (minimal synthetic docx,
  1,483 B) for item 6.
- **Harness** copied + adapted from `s23-layers-device-proof/raw/`
  (`raw/{env,turn,sqlq,sqlw,extract}.sh`, prompts, `/tmp/s23-smoke/`), with all
  its known fixes (force-stop per turn, share-link `%27`, Samsung
  background-apps dialog guard, dead-marker retry, 300 s hang guard).
- **UI paths mapped on-device** (same UI — the audit proves prebuild output is
  byte-identical across the bump): model status chip at (624,165); Settings →
  Modello sheet rows; attach sheet: Foto dalla libreria (42,1308),
  Scatta foto (42,1452), PDF o Word (42,1596); Settings → Avanzate; POST_NOTIFICATIONS
  already `granted=true`.

## The incident (why the link is down — full record)

At 03:56 EDT I ran a 5-second airplane-mode DRILL (not the item-4 test itself)
to validate the toggle pattern the item-4 sub-test needs: one on-device command
`( cmd connectivity airplane-mode enable; sleep 5; cmd connectivity airplane-mode disable ) &`.

- The on-device restore DID run: WiFi came back (ping to 192.168.1.152 OK from
  03:59, the phone's Termux sshd on 8022 answers, mDNS re-announces). Airplane
  mode is OFF — WiFi/mDNS/sshd are unreachable in airplane mode, so their
  presence proves the restore (I could not read `settings get global
  airplane_mode_on` directly because adb was already down; the physical state
  is verifiable on the phone).
- The wireless-adb link did NOT come back: adbd's wireless listener is gone.
  Evidence (`raw/reconnect.log`, 03:58–05:00, 94 cycles): mdns still announces
  `192.168.1.152:45119` (new port; old was 34673) but TCP connect to it is
  REFUSED; a full TCP scan of 1024–65535 on the phone found exactly one open
  port — 8022 (Termux sshd; both keys on this Mac, `id_ed25519` and
  `qdc_ed25519`, are refused there). `adb kill-server/start-server` + fresh
  mDNS resolve + connect retries over an hour: never up. Conclusion: One UI
  disabled wireless debugging's adbd listener on the airplane toggle and left
  a zombie mDNS record; reviving it needs the Developer-options toggle on the
  phone (or one USB plug-in, which would break the unplugged rule).

No uninstall, no data clear, no app-state change happened at any point. The
installed build is still the 101c2bdd debuggable APK from last night.

## Item results

| item | verdict | evidence |
|---|---|---|
| step 0 keys record+arm | PARTIAL DONE (record + arm done; post-install survival check NOT RUN) | `raw/keys-before.txt`, `raw/keys-armed.txt` |
| 1 model load/unload ×3 | NOT RUN | — |
| 2 thermal pause mid-gen | NOT RUN | — |
| 3 HTP long prompt (dynamic part) | NOT RUN (static skel clause: PASS, see above) | `raw/apk-htp-listing.txt` |
| 4 download/resume/cancel/airplane | NOT RUN | — |
| 5 camera/picker + don't-keep-activities | NOT RUN | — |
| 6 PDF/docx import | NOT RUN | — |
| 7 share-in + notification tap | NOT RUN | — |

## End state (as found at 05:00 EDT)

Phone: airplane OFF (proven via WiFi/mDNS/sshd reachability), battery ~51 %
(baseline level 52 at 03:40, draining idle), screen presumably dozing (last
user activity 03:50), Thermal Status was 0, `persist.traced.enable=0`, Kalsa
was left in FOREGROUND on the chat screen (101c2bdd build). Bench keys left
ARMED in AsyncStorage: `npu_lane=on`, `route=auto`, `devmodels=1`,
`energy_trace=1`, `kvtranscript=1`, `nativelog=off` — coordinator restores
(`route=gpu`, `npu_lane=off`, `devmodels` removed/0; the first five were the
values found). My files: this report, `raw/` (text only — no APK, no binaries;
`artifacts/` stays out of git).

A background poll (`nohup /tmp/s23-smoke/reconnect.sh`, fresh mDNS resolve +
connect every ~25 s, horizon reset to 24 h) keeps watching for the link and
auto-connects the moment Wireless debugging is re-enabled, so the next session
inherits a live transport without extra steps.

## How to unblock (10 s, physical)

Developer options → Wireless debugging → toggle OFF then ON (or plug USB once).
Then from this Mac: `adb mdns services` → `adb connect <ip:port>`; the poll
loop `nohup /tmp/s23-smoke/reconnect.sh` is still watching and auto-connects.

---

# Rerun — 2026-10-02 09:05–11:10 EDT (full smoke, all 7 items attempted)

Session: the owner re-enabled Wireless debugging; the staged link came up at
`192.168.1.152:35017` (the poll loop inherited from the blocked session had
auto-connected it). Only the S23 was driven; no QDC, no other phone, no
airplane/WiFi/data/wireless-debugging toggles, screen wake via keyevent 224
only. FUNCTIONAL smoke on the charger: no speed/heat/energy numbers are
reported as results (the raw files hold whatever the logcat carried).

Staged state reused, re-verified before touching anything:
- APK sha256 re-hashed `edbc7c1c…b77d0` (match, `raw/rerun/install-rerun.log`);
  `adb install -r` **Success** at 09:05 (no uninstall, no data clear). The new
  build is non-debuggable (`run-as` refused) — POST_NOTIFICATIONS survived
  (granted=true).
- Bench keys confirmed via run-as on the still-installed 101c2bdd build BEFORE
  the install (`raw/rerun/keys-before-install.txt`): exactly the armed values
  `npu_lane=on, route=auto, devmodels=1, energy_trace=1, kvtranscript=1,
  nativelog=off`.
- Key survival after the install verified behaviorally: boot
  `KALSA_GOVERNOR_PLAN` shows `npu_lane:"on"`, `npu_device:"HTP0"` and the
  Modello sheet lists the [DEV] rows (`raw/rerun/boot-first-kalsa.txt`); turns
  log `route=auto / route_push=applied`.

## Item results

| item | verdict | evidence |
|---|---|---|
| step 0 keys record+arm + install | **PASS** | `raw/rerun/keys-before-install.txt`, `install-rerun.log`, `boot-first-kalsa.txt` |
| 1 model load/unload ×3, different models | **PASS** | 4 engine loads / 3 switch-unloads in ONE process across Qwen 3.5 4B ↔ LFM2.5 2.6B; turns i1-t1/i1-t3 (LFM: prefill NPU, `layers_device:"HTP0"`), i1-t2 (Qwen: CPU — governor `fit:"NoFit"`, required 4344.83 MiB vs 3458.93 available: memory refusal, not a hang), i1-t4 completed after a KV-restore prewarm; every turn reached `KALSA_TELEMETRY`; no stuck spinner. Note: the prewarm's restore-success path logs `restore ok:true` and returns without a `done` line BY DESIGN (LlamaService.ts restore early-return) — initially misread as a hang, see `i1-sw-qwen2-*` |
| 2 thermal pause mid-gen, resume | **NOT TRIGGERED** | The governor's pause line is 43.0 °C battery (`k_warn_c`, kalsa-governor-policy); three monitored long generations on the charger peaked at 43.7 °C but the PREFILL — the only phase with a Wait gate below CRITICAL — always started at 40.5–42.6 °C because the battery cools ~3 °C during the between-turn staging gap; decode (CPU) has no pause below 44 °C. Zero `KALSA_THERMAL_COOLING` lines across all three turns (`raw/rerun/i2-therm-monitor.txt`). No forced overheating used. Platform status reached 3 with no app brake (by design it gates at Android CRITICAL=4 between turns) |
| 3 HTP long prompt, all chunks HTP0, n_common=0 | **FAIL (intermittent hang) — retry PASS** | FIRST attempt: native `loadPrompt prompt_n=3145 n_common=0` began at 09:51:27 and NEVER returned (>9 min; not one further app log line; no error; stall/prefill watchdogs never fired; CPU spinning ~128 % with 0 % iowait — not swap thrash; ZERO fastrpc/HTP dispatch lines — the prefill never reached the DSP) and the UI sat on "In attesa che parta la risposta" — the audit's silent-hang signature (screenshot `/tmp/s23-proof/shots/i3-after-300s.png`, full logcat kept workspace-only at `raw/rerun/i3-long-hang-logcat.txt`, 145k lines / 19 MB — the committed subset is `raw/rerun/i3-long-hang-window.txt`). Clean force-stop + relaunch (free RAM 123 MB → 1.3 GB): the SAME 3145-token prompt COMPLETED with every one of the 11 route chunks `layers_device:"HTP0"`, `npu_device:"HTP0"`, `n_common=0` (`raw/rerun/i3-long-r2-kalsa.txt`). Not reproducible in a fresh process; the hang-time environment was memory-starved (123 MB free, 2.1 GB swap in use); engine and binding pins are byte-identical to base, so attribution to the bump is NOT established by the device evidence |
| 4 download: progress/ready, force-stop→resume, SHA sidecar, UI-cancel; stalled-spinner | **FAIL (blocked at entry)** — stalled sub-item **NOT RUN** | No reachable download trigger exists on this build: (a) the Settings Voce/embedding panel is absent from the rendered screen (its download code unreachable); (b) pressing a not-downloaded `[DEV]` row in the Modello sheet only SELECTS it — no confirm gate ever appears; (c) the pill sheet's "Scarica 3.1 GB" row is a NON-interactive status View for `missing` models — ModelBar renders its Pressable only when `retryLabel` is set, which `modelBarStatus` never sets for `missing`, and `decideModelPress`'s "download" action is wired only to that absent Pressable (`ShellStrip.tsx` pill press only opens the sheet). Taps verified dead across a fresh process, three display configurations (`wm density`/`wm size`/`font_scale` — all reverted) and immersive nav-hiding (`policy_control`, reverted): screenshots `/tmp/s23-proof/shots/i4-*.png`, `st8.png`, UI dumps `raw/rerun/i4-*.xml`. Additionally NO downloadable catalog model carries a sha256 pin (only the already-present dev-minicpm5-2b), so the SHA-sidecar clause had no exercisable target. Stalled/no-infinite-spinner: NOT RUN — no `kalsa.bench.*` stall-simulation hook exists in `ModelDownloader.ts` (searched; not invented) and airplane mode is forbidden. Delete-test-model: N/A (nothing downloaded) |
| 5 camera + image picker; don't-keep-activities kill→restore | **PASS** | Camera: permission prompt → "While using the app" → shutter → OK → attachment chip "Legge da ….jpeg" (screenshot `i5-camera-result.png`); library: Google photo picker → 229.png chip. DKA: before=`null` (OFF) → set 1 → HOME (activity finished, launcher resumed) → relaunch → conversation AND both attachments restored → set 0. `raw/rerun/i5-dka-before.txt`, `i5-dka-on.txt`, `i5-dka-after.txt`, `i5-attachments-before.xml`, `i5-restore.xml` |
| 6 PDF/docx import, meminfo before/after | **FAIL** | meminfo before TOTAL PSS 954,269 kB (`i6-meminfo-before.txt`). PDF (48 KB, 12-page fixture) picked via SAF long-press→Select: the page pipeline started ("Lettura pagine…") then failed with **"Timeout nel rendering della pagina PDF."**; a second PDF attempt returned silently with NO attachment and no error; a docx attempt likewise produced no attachment and no error. meminfo after PDF 867,710 kB / after docx 870,671 kB — no blowup, because nothing processed (`i6-meminfo-after-pdf.txt`, `i6-meminfo-after-docx.txt`, `i6-pdf-timeout-logcat.txt`, screenshots `i6-*.png`). Note: this is the exact `readAsStringAsync` import path the audit's F7 flags (byte-array materialisation in expo-file-system 57.0.7), but a timeout to render is not F7's signature; attribution not established |
| 7 share-into-Kalsa; notification tap | **PASS** / **NOT RUN** | `am start -a android.intent.action.SEND -t text/plain … -p com.kalsa.app` → the shared text landed in the compose (`raw/rerun/i7-share-compose.xml`, screenshot `i7-share.png`). Notification tap NOT RUN: `downloadNotifications.ts` is the app's ONLY `scheduleNotificationAsync` caller (progress on `downloads`, ready on `default`) and downloads cannot start (item 4); no generation-completion notification exists to tap, and inventing one was out of scope |

## Overall verdict for the Expo 57 bump on Android

**No expo57 double-settle signature was observed anywhere the promise paths
were exercised** — engine load/unload/switch (4 loads, 3 unloads, one process),
HTP prefill with every chunk on HTP0 and n_common=0, camera/photo-picker
activity-results including the don't-keep-activities process-kill restore
(audit F8's exact scenario), and share-in. The core chain is functionally
sound on the CI APK. Two failures must be owner-triaged before merge, neither
of them attributable to the bump by device evidence: (1) an intermittent
native prefill hang with the audit's silent-hang signature — unrecovered
>9 min, not reproducible after a clean relaunch, memory-starved at the time;
(2) the document path — PDF page-render timeout plus silent no-op retries,
and model download cannot be started from the UI at all (a wiring gap that
likely predates the bump: prebuild output and the involved UI sources are
byte-identical to base, per the audit). Neither failure can be cleared
without a rerun; the smoke's item-3 FAIL stands on the first occurrence.

## End state (11:10 EDT)

Phone: Kalsa FOREGROUND (MainActivity topResumed, chat screen, compose empty),
screen Awake (keyevent 224 only), keyguard not showing, ON CHARGER, battery
77 % / 32.0 °C, Thermal Status 0, `persist.traced.enable=0`. Don't-keep-
activities = 0. All display overrides reverted (`font_scale 1.0`, `wm size`/
`wm density` physical, `policy_control` row deleted). Bench keys LEFT AS ARMED
in RKStorage (`npu_lane=on`, `route=auto`, `devmodels=1`, `energy_trace=1`,
`kvtranscript=1`, `nativelog=off`) — they cannot be restored from adb on the
release build (no run-as); the coordinator restores them at the next
debuggable install (`route=gpu`, `npu_lane=off`, `devmodels` removed/0).
Text evidence in `raw/rerun/`; screenshots (not committed, per the text-only
raw convention) in `/tmp/s23-proof/shots/` — the load-bearing ones are
`i3-after-300s.png` (the hang spinner), `i4-tap-scarica.png`/`st8.png` (the
unreachable Scarica row), `i6-pdf-retry.png`, `i7-share.png`.
