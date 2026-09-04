# PREREG — Cell #63: debuggable release APK smoke through `run-as`

Date: 2026-09-04. Board: QRD8650 (Snapdragon 8 Gen 3 / Adreno 750), Android 14
`userdebug`, headless through adb. Package: `com.kalsa.app`.

## Question

Does the debuggable release variant (`apk.yml` input `debuggable=true`, with the
release signing and R8/minification configuration unchanged) install, load the
shipping model, and answer one prompt on QRD8650 hardware through the non-root
`run-as` path? The model and RKStorage must enter the app sandbox only through
`run-as`; no root command may write `/data/data/com.kalsa.app`.

This board is `userdebug`, so `adbd` may still be root. The preamble records
`id`, `ro.build.type`, and `ro.debuggable` for that honesty note. A root adbd
does not invalidate this cell: the cell tests whether the installed APK is
debuggable and whether `run-as` can perform the data-path operations. The
semantics are representative of a user build only for the debuggable check
itself; this cell does not establish behavior on a non-rooted consumer phone.

Arms, run in order on the same board and session:

- APK-A-debug: `main` at `c513f00`, engine pin `a0cabca6b`,
  `~/kalsa-qdc/apk/apk-A-debug-c513f00/app-release.apk`.
- APK-B-debug: `chore/engine-pin-12f6d9b6d` at `09bdfe9`, engine pin
  `12f6d9b6d`, `~/kalsa-qdc/apk/apk-B-debug-09bdfe9/app-release.apk`.

The driver refuses to touch the device if either APK path is missing. It records
the local APK SHA-256 when the artifacts are present. The model is
`~/kalsa-qdc/models/LFM2.5-2.6B-QAD-Q4_0.gguf`, SHA-256
`a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`, exact
size `1593894944` bytes. Its app destination is
`/data/data/com.kalsa.app/files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf`.

## Procedure

The prompt is exactly: `Reply with one short sentence about mountains`.
`ANDROID_ADB_SERVER_PORT=6037` and `IME_SUSPEND=1` are retained from #61.
Every adb operation is capped by the driver's `adbT` wrapper.

S1. Install the arm64 APK with `adb install -r`; save installer output and
`pm dump`.

S0. Immediately after S1, prove the installed package is debuggable on the
device with:

```sh
dumpsys package com.kalsa.app | grep -i flags
```

The saved output must contain `DEBUGGABLE`. If it does not, that APK is
`METHOD-VOID`; do not attempt its run-as data path. A flag-present APK for which
`run-as` is refused is a G2 signing/flag finding, not a hardware app verdict.

S2. Push the model once to
`/data/local/tmp/kalsa63/LFM2.5-2.6B-QAD-Q4_0.gguf`, resume-safely reusing it
only after the full device SHA-256 matches, and `chmod 644` the temporary file.
For each installed APK, copy it into the sandbox only with:

```sh
run-as com.kalsa.app sh -c 'mkdir -p files/models/lfm2.5-2.6b && cp /data/local/tmp/kalsa63/LFM2.5-2.6B-QAD-Q4_0.gguf files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf'
```

Verify the app copy with `run-as com.kalsa.app stat -c %s
files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf` and require exactly
`1593894944` bytes. No `su`, `adb root`, or root `cp`/`chown`/`restorecon` is
used.

S3. Wake the device before each launch, retaining #61's
`device_wake()`/`device_wake_restore()` behavior. Start the app for 25 seconds,
force-stop it, and retry that first launch once if `databases/RKStorage` is
still absent. Pull the database through `adb exec-out run-as com.kalsa.app cat
databases/RKStorage`; pull `RKStorage-wal` and `RKStorage-shm` the same way if
present. Edit the host copy with sqlite3 as in #61, inserting
`kalsa.model.id = lfm2.5-2.6b`. Leave compaction and thinking at the CI defaults
(`COMPACTION=on`, `THINKING=default`). Run
`PRAGMA wal_checkpoint(TRUNCATE);` before pushing the base database to
`/data/local/tmp/kalsa63`. Put it back with `run-as com.kalsa.app cp`, then
delete any `RKStorage-wal`/`RKStorage-shm` with `run-as ... rm` after the
checkpoint. Every write into the app sandbox is therefore through `run-as`.

S4. Clear logcat, wake the device, launch, and wait up to five minutes for both
load-proof markers after that launch. Do not use `KALSA_SESSION op:load`: on a
fresh install it is KV-session restore and may report `reason":"no_file"`.
The exact grep patterns are derived from the #61 raw logcats:

```sh
grep -E 'llama_model_loader: loaded meta data with .* from /data/user/0/com.kalsa.app/files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf'
grep -E 'KALSA_PREWARM.*"op":"done"'
```

S4 passes only when both patterns match the post-launch logcat. The first
pattern proves the model file was opened; the second proves prewarm completed.

S5. Suspend and restore the IME as in #61. Dump uiautomator, find the
`android.widget.EditText`, tap its live bounds, type the prompt word-by-word
with `input text` and `KEYCODE_SPACE`, dump again, find the `Send` node, and tap
its live bounds. Pass requires a `KALSA_TELEMETRY` line with
`"tokensPredicted":` followed by a positive integer:

```sh
grep -E 'KALSA_TELEMETRY.*"tokensPredicted"[[:space:]]*:[[:space:]]*[1-9][0-9]*'
```

Missing composer, Send, or prompt entry is `METHOD-VOID` with the UI dump
attached.

S6. Capture full `logcat -d -b all`, filtered session/telemetry lines, the
S4 proof lines, screenshot, uiautomator XML, thermal records, and RKStorage
through `run-as cat`. Also capture the model directory with:

```sh
run-as com.kalsa.app ls -la files/models/lfm2.5-2.6b
```

Retain #61's diagnostic native-banner and `/proc/<pid>/maps` artifacts, using
run-as for the latter too; neither is a pass condition. IME restoration and
screen-timeout restoration are handled by the exit trap.

S7. Uninstall the APK with `pm uninstall`. The model in `/data/local/tmp/kalsa63`
may be reused for the next arm, but the run-as sandbox copy is redone.

The STEPS ledger records S0 through S7 for each arm, including skipped steps and
`METHOD-VOID` details. The script is safe to rerun after an interrupted session:
the temporary model is reused only after SHA verification, while each APK is
installed, configured, evidenced, and uninstalled independently.

## Binding interpretation grid

- G1: A-debug and B-debug both pass S0 through S5 through run-as. Both
  debuggable release APKs install, load, and answer on hardware; no performance
  or A/B speed claim is made.
- G2: S0 proves `DEBUGGABLE`, but run-as is refused or returns a uid/identity
  error. Bank as a signing/manifest/flag finding; do not call it an app runtime
  failure.
- G3: run-as works, but load or answer fails. Bank as an app/hardware runtime
  finding with the native log; record the other arm without making an A/B claim
  unless its comparison is valid.
- G4: both APK installs fail. Bank an environment/ABI/signature finding and
  mark the cell `METHOD-VOID` for model load and answer.
- Per-arm `METHOD-VOID`: missing APK, absent on-device `DEBUGGABLE` flag, model
  not recognized after the run-as copy, or missing uiautomator composer/Send.
  The flow—not the app—is void. No root retry is allowed in this cell.

## Non-goals and declared confounds

No throughput/performance claim, GPU claim, NPU claim, thermal verdict, second
turn, KV reuse, or thinking/compaction comparison. The board is Android 14
`userdebug`, and `adbd` may be root; only the debuggable check's run-as semantics
are intended to correspond to a user build. One prompt and one turn per arm,
headless adb, IME suspended for typing. Nothing in the app repository is
modified, and this cell does not push or commit anything.
