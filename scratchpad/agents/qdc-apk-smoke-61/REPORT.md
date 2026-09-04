# REPORT — Cell #61: the fused Kalsa app runs on real hardware — both APKs install, load the ship model and answer (QRD8650)

Date: 2026-09-04 morning (owner full delegation). QDC job 798961 (`sa803030`), QRD8650 unit
`cacfeec9` (Snapdragon 8 Gen 3 / Adreno 750, Android 14 userdebug, adbd root), SSH-only
session Started 07:32:32 → Ended 08:03:21 (portal, verified after reload) = 30.8 min billed. PREREG + two pre-data
amendments (release APKs not debuggable → root sideload; screen off on the QDC unit → wake +
dismiss-keyguard) audited before data (AUDIT-PRERUN.md: RUN, then two delta audits clean).
First attempt (job 798935) produced no data: 23 min billed, driver crash on `run-as` + `set -u`.

## Verdict: **G1-AMENDED — both APKs pass on the engine evidence; two preregistered signals were unsatisfiable as written**

The PREREG's literal G1 needs (i) `KALSA_SESSION {"op":"load",…"ok":true}` and (ii) the
`kalsa-native-patches` banner in logcat. Neither ever appears (ledger: `STEP A S4 fail`,
`STEP B S4 fail`; raw/*_native_banner.txt 0 bytes) — both signals were misidentified by the
recon, not missing from the app. The pass below therefore rests on a DECLARED AMENDMENT to
the pass criterion (engine loader lines + prewarm + generation as "loaded"; APK sha + CI
marker check as "intended build"), written after the data. The owner may reject the
amendment; then the cell is G1-pending, not a fail.

| step | APK-A (main c513f00, pin a0cabca6b, sha e0d56a39…) | APK-B (09bdfe9, pin 12f6d9b6d + 3 OpenCL picks, sha 1e2709e5…) |
|---|---|---|
| S1 install -r | ok (uid 10225) | ok (uid 10226) |
| S2 sideload (root cp + chown + restorecon) | ok, 1,593,894,944 B | ok, 1,593,894,944 B |
| S3 first launch + AsyncStorage `kalsa.model.id=lfm2.5-2.6b` (host sqlite3) | ok | ok |
| S4 model load | **engine loaded** (see re-read) — driver ledger says `fail` | same |
| S5 one prompt → `KALSA_TELEMETRY` | ok: tokensEvaluated 1329, **tokensPredicted 129**, predictedMs 4882 → **26.4 tok/s** | ok: tokensEvaluated 1329, **tokensPredicted 196**, predictedMs 7544 → **26.0 tok/s** |
| S6 evidence (logcat -b all, screenshot, ui xml, chat DB, thermal) | ok — raw/A_sa803030.png shows header "LFM2.5 2.6B · QAD-Q4_0 · Ready · local", the prompt and the answer | ok — raw/B_sa803030.png |
| S7 uninstall | ok | ok |

Thermal (HAL max, informative): A pre 45.0 °C / post 35.6 °C; B pre 39.1 / post 44.6; status 0.

## Declared amendment to the pass criterion (S4 signal and banner)

PREREG S4 waited for `KALSA_SESSION {"op":"load", … "ok":true}` as "model loaded" (from
RECON-APP.md). The raw shows that line is the **KV-session restore**, not the model load:
`KALSA_SESSION {"op":"load","ms":3,"ok":false,"reason":"no_file"}` (raw/A_sa803030_s5_logcat.txt,
04:46:06.864) — no saved session on a fresh install, as expected. Model load is proven by the
engine's own lines in the same logcat: `llama_model_loader: loaded meta data with 38 key-value
pairs and 266 tensors from /data/user/0/com.kalsa.app/files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf`,
`load_tensors: CPU_REPACK model buffer size = 1511.20 MiB`, `KALSA_PREWARM {"op":"done",
"promptMs":9374.501}` (1319 system-prompt tokens in 9.4 s), and by the generation itself.
The recon's claim was wrong; the driver's S4 timer (300 s) therefore expired on both APKs and
the ledger records `fail` — the PREREG's pass criterion (a) install (b) load (c) answer is met
by the raw under this amendment, and this REPORT says so explicitly instead of editing the
ledger. Timing source for "~30 s from Send to telemetry": raw/driver_attempt3_sa803030.log
(`[07:52:43] ime suspended` → `[07:53:16] STEP A S5 ok`) against the logcat telemetry line at
04:53:12 device time (device clock = Mac clock − 3 h).

## What the cell established

1. **The merged app (llama.rn 0.12.8 + kalsa-native-patches + 23 MB kalsallama overlay) runs on
   a Snapdragon 8 Gen 3 phone**: installs, finds the sideloaded gguf without a download
   (exact-size check), loads it, prewarms the system prompt with tools (toolCount 5), answers
   a prompt, saves the session (`KALSA_SESSION {"op":"save","ok":true,"usedTokens":1459}`).
   First time ever on hardware (the emulator E2E was x86_64).
2. **APK-B (pin bump 12f6d9b6d with the 3 OpenCL picks) behaves the same as APK-A** on every
   step; no regression at this smoke depth. No speed A/B is claimed.
3. **Backend actually used: CPU.** Both logcats: `lm_ggml_opencl: device: 'QUALCOMM Adreno(TM) 750'`
   is selected and the HTP skels are extracted (`RNLlama: Extracted HTP library: libggml-htp-v73/
   v75/v79/v81.so`), but `load_tensors: offloaded 0/31 layers to GPU` — the app sends no GPU
   layers (the known "the app never implements GPU" finding, now seen on hardware). Decode
   26.0-26.4 tok/s on the QRD8650 CPU is in line with the #57/#58 CPU lane for this model
   (incidental, one turn, not a benchmark).
4. **Telemetry artifact to fix in the app**: `promptMs` = 411,063 (A) / 410,008 (B) ms while the
   turn evaluated 15 new tokens (`Input processed: n_past=1314, embd.size=1329`) and the
   telemetry landed ~30 s after the Send (driver log 07:52:43 → 07:53:12). Readings, none verified here: the prompt timer started at prewarm/launch instead of at
   the turn; a monotonic-clock value carried over from the prewarm turn; a clock-type mismatch
   between the native and JS sides. Banked as an app bug candidate, not a perf number.
5. **Marker/banner**: the `kalsa-native-patches` system-info banner does NOT appear in logcat
   (raw/*_native_banner.txt empty) — the recon's expectation was wrong; llama.rn does not log
   that line. The engine variant cannot be read from /proc/maps either: SoLoader maps the .so
   directly from `base.apk` (DirectApkSoSource), so `librnllama*` names never appear
   (raw/A_sa803030_maps_librnllama.txt empty). Evidence that the intended build ran: the APK sha
   on the phone equals the CI artifact whose libs `scripts/assert-native-patch.sh` verified for the
   marker, plus the OpenCL platform line and the HTP extraction — read as "the OpenCL- and
   Hexagon-enabled variant ran" only on the naming of the JNI variants in RECON-APP.md, an
   UNSUPPORTED inference in this folder (no evidence maps a log line to a specific .so).
   Indirect and declared as such; the APK sha is the only hard link to the CI-verified build.
6. **Ops lessons**: release APKs from apk.yml are NOT debuggable (`run-as` impossible; the
   S23 rule "solo APK debuggabili" is not what CI builds); the QDC unit boots with the screen
   off and keyguard up — every UI-driving cell must wake + dismiss-keyguard + stayon before the
   first launch (Device Configuration "Screen Always On" was left unchecked); the CI helpers'
   device mode refuses sideloading, so root is the QDC path.

## Not established / confounds

Nothing about a non-rooted consumer phone (sideload and DB write used root); nothing about
GPU or NPU paths in the app (0 layers offloaded); no thinking/compaction settings varied
(CI defaults); single prompt, single turn; IME suspended for typing. The two S4 `fail` ledger
lines stand as written by the driver.

## Session accounting

Job 798935 (first attempt): 06:56:01 → 07:19:00, 23 min billed, ~2 useful (driver crash),
ended via ref-click End + Yes + reload. Job 798961: Started 07:32:32, driver attempt 1
07:32:53 → 07:35 (S3 failed, stopped), manual wake probe 07:37, driver attempt 2 07:44:39 →
08:01:58 (both APKs), End Session ref-click + Yes + reload → Completed, Ended On 08:03:21 (30.8 min billed). Two
sessions for this cell: 54 min billed in total, ~20 of device work. 8 Gen 3 pool: 968 → ~913 min.

## Audit response (AUDIT-REPORT.md, before banking)

- 2a BLOCKER accepted: verdict relabelled G1-AMENDED with the amendment stated up front and the
  owner's right to reject it. 2b accepted (wording). 4 accepted: alternatives named. 5 accepted:
  inference marked unsupported. 1b accepted: the three driver logs are now in raw/
  (driver_attempt{1,2,3}_*.log) and the timing claim cites attempt 3.
