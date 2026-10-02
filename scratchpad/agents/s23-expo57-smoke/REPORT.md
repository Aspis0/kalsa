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
