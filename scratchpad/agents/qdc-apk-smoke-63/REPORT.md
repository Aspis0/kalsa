# REPORT — Cell #63: debuggable release APK smoke through `run-as`

Date: 2026-09-04. Board: QRD8650 / SM8650, Snapdragon 8 Gen 3, Android 14
`userdebug`. The recon records `ro.debuggable=1` and `id` as `uid=0(root)`;
this is therefore a root/userdebug board, not a field-phone simulation
(raw/recon_sa803197e.txt:3-14).

## Verdict: **G1 — both debug release APKs pass S0–S5 through `run-as`**

The binding PREREG grid is satisfied by attempt 5: both arms installed, proved
`DEBUGGABLE`, copied the model into the sandbox through `run-as`, initialized
RKStorage, loaded and prewarmed the model, and produced positive telemetry
(raw/steps_sa803197e.txt:1-16). Attempts 1–4 are retained as operational data;
they do not change the final G1 result.

APK-A is `main` at `c513f00`, engine pin `a0cabca6b`; APK-B is
`chore/engine-pin-12f6d9b6d` at `09bdfe9`, pin `12f6d9b6d` (PREREG.md:21-26).
The preregistered build input was `debuggable=true` (PREREG.md:8-12).
The installed SHA-256 values begin `c645f691` for A and `1b8e2793` for B
(raw/steps_sa803197e.txt:1,9). Both final S0 captures contain
`flags=[ DEBUGGABLE HAS_CODE ALLOW_CLEAR_USER_DATA ]`
(raw/A_sa803197e_s0_flags.txt:1-5; raw/B_sa803197e_s0_flags.txt:1-5).

| attempt | APK-A | APK-B | interpretation |
|---|---|---|---|
| 1 `sa803197` | S0/S1 ok; S2 refused | S0/S1 ok; S2 refused | `/data` mode blocked `run-as` |
| 2 `sa803197b` | S0–S4 ok; S5 METHOD-VOID EditText missing | S0–S4 ok; S5 METHOD-VOID Send missing | keyguard/UI state, not app load |
| 3 `sa803197c` | S2 ok; S3 “file is not a database”; later S4/S5 fail | S2 refused | `/data` reverted during the run |
| 4 `sa803197d` | S0–S4 ok; S5 Send missing | S0–S7 pass | holder loop stabilized `/data`; A screen state still failed |
| 5 `sa803197e` | S0–S7 pass | S0–S7 pass | final binding result: G1 |

Attempt 1’s raw refusal is exact: `run-as: /data readable or writable by
others: 40777` for both arms (raw/A_sa803197_s2_copy.txt:1;
raw/B_sa803197_s2_copy.txt:1). After the preregistered board fix to mode 771,
attempt 2 recorded exact-size run-as copies and S3/S4 success for both arms
(raw/steps_sa803197b.txt:3-5,11-13). Its S5 XML shows only `com.android.systemui`
and the keyguard values `100%`, `Fri, Sep 4` with the clock at `3:59` for A
and `4:01` for B (raw/A_sa803197b_s5_edit.xml:1; raw/B_sa803197b_s5_send.xml:1).

Attempt 3 recorded the two different board-state failures: A’s host sqlite
step returned `file is not a database`, while B again returned the 40777
`run-as` refusal (raw/A_sa803197c_s3_sql.txt:1-2;
raw/B_sa803197c_s2_copy.txt:1). The prereg amendment records that `/data` had
reverted to 0777 and that attempt 4 used a Mac-side 2-second holder loop
(PREREG.md:182-190).

## Final engine and answer evidence

The attempt-5 S4 proof files contain the required loader and prewarm lines:

```text
09-04 09:33:25.552 ... llama_model_loader: loaded meta data with 38 key-value pairs and 266 tensors from /data/user/0/com.kalsa.app/files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf (version GGUF V3 (latest))
09-04 09:33:36.372 ... 'KALSA_PREWARM', '{"op":"done","promptMs":9986.373,"hash":"30001358"}'
```
(raw/A_sa803197e_s4_proof.txt:1-2)

```text
09-04 09:35:35.499 ... llama_model_loader: loaded meta data with 38 key-value pairs and 266 tensors from /data/user/0/com.kalsa.app/files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf (version GGUF V3 (latest))
09-04 09:35:46.537 ... 'KALSA_PREWARM', '{"op":"done","promptMs":10156.62,"hash":"30001358"}'
```
(raw/B_sa803197e_s4_proof.txt:1-2)

Both final telemetry records have `tokensEvaluated=1329`. A produced
`tokensPredicted=90`, `predictedPerSecond=23.60897245882202`, and
`promptMs=30040.307`; B produced `tokensPredicted=65`,
`predictedPerSecond=23.771593750045714`, and `promptMs=27776.585`
(raw/A_sa803197e_session_telemetry.txt:3;
raw/B_sa803197e_session_telemetry.txt:3). Both also saved a successful session
(raw/A_sa803197e_session_telemetry.txt:4;
raw/B_sa803197e_session_telemetry.txt:4). Attempt 4 B separately recorded 223
predicted tokens at `23.538655856195913` predicted tokens per second
(raw/B_sa803197d_session_telemetry.txt:3).

The final model directory listing was captured via the driver’s
`run-as com.kalsa.app ls` path (d_run.sh:157-166). It shows the expected model
file at exactly `1593894944` bytes for both arms
(raw/A_sa803197e_model_ls.txt:1-4; raw/B_sa803197e_model_ls.txt:1-4).
RKStorage was pulled with `exec-out run-as ... cat`, and then restored with
run-as copy/remove operations (d_run.sh:120-154); the raw SQL recorder identifies
the same path as “run-as-pulled RKStorage; adb push then run-as cp/rm”
(raw/A_sa803197e_s3_sql.txt:1-2).

The final logcats report an OpenCL device, but the actual tensor placement was
zero GPU layers for each arm: `load_tensors: offloaded 0/31 layers to GPU`
(raw/A_sa803197e_logcat_all.txt:8912;
raw/B_sa803197e_logcat_all.txt:9320). This is diagnostic only. The final PNGs
and app-package UI XMLs are retained for both arms; the screenshots show the
entered mountains prompt and generated answer (raw/A_sa803197e.png;
raw/B_sa803197e.png).

## What this does NOT show

This is not a performance result: no throughput claim, A/B speed claim, thermal
verdict, GPU/NPU claim, second turn, KV-reuse claim, or settings comparison is
made. The reported `predictedPerSecond` values are single-turn telemetry, and
`promptMs` is the known timer artifact, not a usable prompt-performance number.

It does not show behavior on a non-rooted consumer phone. The board’s root
adbd proves the `run-as` data-path behavior for these debuggable APKs, while
the board conditions `/data` held at 0771 and keyguard disabled were external
preconditions, not app properties (PREREG.md:14-19,154-180).

It does not isolate why APK-A's S5 failed in attempt 4 after the keyguard had
been disabled: the UI dump taken at the Send step shows only the status bar
again (raw/A_sa803197d_s5_send.xml:1, clock `4:28`) while the dump taken
seconds earlier at the EditText step shows the full chat UI. The display
dropped between typing and Send — display sleep versus keyguard re-engagement
was not distinguished (the board is not USB-powered, so `svc power stayon`
cannot hold the screen). Attempt 5 passed with no further change, so this is
recorded as a board display flake, not an app property.

## Session accounting

The orchestrator metadata for session 799128 reports billing at the 45-minute
cap, with roughly 25 of those 45 minutes spent on the three board-state
amendments. The local raw contains the five driver attempt tags and timestamps,
but not the portal billing record; this accounting is therefore explicitly
portal metadata, not independently recomputed here (raw/driver_attempt_sa803197.log:1-25;
raw/driver_attempt_sa803197b.log:1-24; raw/driver_attempt_sa803197c.log:1-25;
raw/driver_attempt_sa803197d.log:1-24; raw/driver_attempt_sa803197e.log:1-24).

The final attempt uninstalled both APKs successfully
(raw/A_sa803197e_s7_uninstall.txt:1; raw/B_sa803197e_s7_uninstall.txt:1).
No device was touched while preparing this report; this deliverable changes
only this REPORT.md file.
