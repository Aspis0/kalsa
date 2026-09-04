# PREREG — Cell #61: first run of the fused Kalsa app on real hardware (QRD8650, headless via adb)

Date: 2026-09-04 (owner full delegation; owner's own list: "test apk su una board qdc"). The app
merged 3/09 night (main c513f00: llama.rn 0.12.8 + `kalsa-native-patches` + 23 MB kalsallama
overlay, engine pin a0cabca6b) has passed the emulator E2E (x86_64, real inference) but has
NEVER run on a phone: S23 and Jelly are lost. Two release APKs exist, built by CI and hashed:

- APK-A `~/kalsa-qdc/apk/apk-A-c513f00/app-release.apk`, sha256 `e0d56a398bbd1cb102dbab635272b7b88c43b22e6cd8896538c313603b774403`, pin a0cabca6b.
- APK-B `~/kalsa-qdc/apk/apk-B-09bdfe9/kalsa-apk-arm64-v8a-09bdfe949403db7cd793da9471c5a78c50d62966/app-release.apk`, sha256 `1e2709e57561e97149664ea30588b7df9141c25a6813642cdda1c3ddf9d7f86d`, pin 12f6d9b6d (+3 OpenCL picks).
Both 135,593,407 B, `lib/arm64-v8a/` only (38 .so incl. the librnllama_jni_* variants), minSdk 33.

## Question

On a Snapdragon 8 Gen 3 reference phone (QRD8650, Adreno 750 — the shipped-phone class, GPU
numbers already banked in #55/#58), does each APK (a) install, (b) load the shipping model
LFM2.5-2.6B QAD-Q4_0 from the app's own model directory, (c) answer ONE prompt with the
kalsallama engine, headlessly over adb (QDC "SSH only" session, no screen mirroring)? A vs B on
the same board: does the pin bump with the OpenCL picks change any of (a)-(c)?
**This is a smoke test, not a benchmark.** No tok/s claim is made; incidental numbers are
recorded in raw/ and not reported.

## Procedure (per APK, A then B, same session)

S1 `adb install -r` (arm64-v8a; record `pm dump` version, installer output).
S2 Model sideload without the app's downloader (the CI device mode REFUSES to sideload and
   expects a prior in-app download, ci-lib.sh:1338-1355; on QDC there is no UI): push the gguf
   once to `/data/local/tmp/kalsa61/LFM2.5-2.6B-QAD-Q4_0.gguf` (sha `a247afd6…` verified on
   device), then `run-as com.kalsa.app sh -c 'mkdir -p files/models/lfm2.5-2.6b && cp
   /data/local/tmp/kalsa61/… files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf'` and verify the
   size through run-as = 1,593,894,944 B (the app's only completeness check, ModelDownloader.ts:79).
   If `adb root` works on the board it may be used, but the run-as path is the one preregistered.
S3 First launch 25 s + force-stop (creates the AsyncStorage DB, as ci-lib does), then the CI SQL
   knobs through run-as: `kalsa.model.id = lfm2.5-2.6b`; compaction and thinking left at the
   CI defaults (`COMPACTION=on`, `THINKING=default`).
S4 Launch, wait for `KALSA_SESSION {"op":"load", … "ok":true}` in logcat (cap 5 min).
S5 One alphanumeric prompt typed via `adb shell input text` with `IME_SUSPEND=1` (ci-lib
   pattern), Send tapped via uiautomator bounds; wait for a `KALSA_TELEMETRY` line with
   `tokensEvaluated > 0` and `tokensPredicted > 0` (cap 10 min). Prompt: `Reply with one short
   sentence about mountains`.
S6 Evidence: full `logcat -d` (all buffers), the KALSA_SESSION/KALSA_TELEMETRY lines, the
   engine's system-info banner line containing `kalsa-native-patches` (proves the patched
   engine is the one running), `/proc/<pid>/maps` filtered on `librnllama` through run-as
   (which JNI variant loaded), `adb exec-out screencap -p` after the answer (headless
   screenshot), `uiautomator dump`, and the chat DB through run-as (CI helper). Thermal read
   before/after (HAL max temp), informative.
S7 `pm uninstall` before installing the other APK (clean state; the gguf in /data/local/tmp is
   reused, the run-as copy is redone).
Reuse: the driver wraps the existing `scripts/ci-e2e.sh` / `scripts/ci-lib.sh` (app repo @
c513f00, read-only) wherever their device-mode functions apply (tap_node, type_into_composer,
sql, wait_for_engine_ran, IME suspend, DB pull); if the 3-turn E2E flow cannot be cut to one
turn without editing the scripts, the driver re-implements only the one-turn flow with the same
helpers and says so. Nothing in the app repo is modified.

## Binding interpretation grid

- G1 (BOTH PASS): A and B install, load, answer (telemetry tokensPredicted ≥ 1), banner
  present → the fused app runs on hardware for the first time; the pin bump does not break
  load/generation. Owner decision "which APK" stays open (no perf data here); ALIVE row banked.
- G2 (A PASSES, B FAILS at any of S1/S4/S5): regression attributable to the pin bump
  (12f6d9b6d vs a0cabca6b) → banked as a blocker for APK-B with the logcat evidence; APK-A is
  the candidate.
- G3 (A FAILS at S4/S5): the merged assembly has a runtime defect on hardware that the emulator
  E2E did not catch → banked as the top app blocker with the native log; B's result recorded
  but no A/B claim.
- G4 (INSTALL FAILS for both): environment/ABI/signature finding, not an app verdict; cell is
  METHOD-VOID for (b)-(c).
- METHOD-VOID (per APK): the app reports the model as missing after S2 (sideload not recognized)
  or the UI automation cannot find the composer/Send (uiautomator dump attached) — the flow,
  not the app, failed; retry once with `adb root` sideload if available, then stop.
- Banner absent while generation works → banked as a separate finding (which engine ran?),
  no PASS claimed for that APK until explained.

## Materials, budget, ops

Model `~/kalsa-qdc/models/LFM2.5-2.6B-QAD-Q4_0.gguf` (1,593,894,944 B, sha `a247afd6…`). Device
QRD8650 (8 Gen 3 pool ≈ 970 min), SSH-only session booked 45 min, expected ~20 min (push 1.6 GB
≈ 2 min once; per APK: install 20 s, copy 15 s, first launch 25 s, load ≤ 1 min, one answer
1-3 min, evidence 30 s). One session at a time; End Session = ref-click End + ref-click Yes +
reload + "Ended On" within one minute. Port 6037. Driver `d_run.sh` (Luna) + `connect.sh` (copied
from #60), audited by mimo before the session.

## Non-goals

No tok/s or A/B speed claim, no KV-reuse second turn, no session-restore turn, no thermal
verdict, no GPU-vs-CPU attribution (the app's backend choice is read from the log, not judged),
no HDK8550 arm (queued if budget allows after this cell).

## Pre-data amendment 1 (declared during the session, before any load/generation data)

First launch (job 798935, QRD8650 `80003b9c`, Android 14 userdebug, `adbd` already root —
raw/recon_sa803004.txt): S1 install of APK-A succeeded, then S2 failed with
`run-as: package not debuggable: com.kalsa.app` (raw/A_sa803004_s2_copy.txt): the CI release
APKs are NOT debuggable, so the preregistered run-as sideload/DB path is impossible on ANY
device; the driver then aborted on a `set -u` bug (`phase: unbound variable`, line 56) before
reaching APK-B. No load or generation data was produced (steps ledger: A S1 ok, S2-S5
METHOD-VOID). Substitution: every run-as operation (S2 copy + size check, S3 RKStorage
pull/push, evidence maps/DB) is done from the root adb shell this board provides (cp into
/data/data/com.kalsa.app/files/models/…, chown to the app uid, restorecon). Steps, ledger,
evidence and grid unchanged. Confound added: the sideload/DB path is root-only, so this cell
says nothing about sideloading on a non-rooted consumer phone (there the app's own downloader
would be the path). Owner note: a debuggable variant of the release APK is needed for any
run-as-based field test (memory rule "S23 solo APK debuggabili").

## Pre-data amendment 2 (declared during the second session, before any load/generation data)

Second launch (job 798961, unit `cacfeec9`, also adbd root): S1 ok (uid 10224), S2 ok
(root sideload, 1,593,894,944 B), S3 FAILED (`sql=1`): the first launch ran with the screen
OFF (`mWakefulness=Dozing`, focus `NotificationShade` — the Device Configuration toggle
"Screen Always On" was left unchecked); the app process started and JS ran (`Running "main"`)
but AsyncStorage never created `databases/RKStorage`, and the composer would not have been
reachable by uiautomator either. Manual probe on the same unit: wake + `wm dismiss-keyguard`
+ `svc power stayon true`, relaunch → focus on MainActivity, `RKStorage` (20 KB) created,
JS logs `model.fit fits`. The driver run was stopped before S4 produced data (S4 logcat has
no KALSA line), the app uninstalled, the pushed model kept. Substitution: the driver wakes
the device (WAKEUP, dismiss-keyguard, stayon, 30-min timeout, restored at exit) before the
S3 first launch and before S4, and retries the first launch once if the DB is still absent.
Steps, ledger, evidence and grid unchanged. Session accounting so far: job 798935 23 min
(2 useful), job 798961 running since 07:30.
