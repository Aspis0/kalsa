# q66 Kalsa lifecycle hooks

Preparation only: the short-root APK build was attempted once and failed during C++ compilation; no APK was installed and no device action was taken. These commands target only the S23 serial containing `R3CW406P8CV`; never use `adb connect` and never reuse them with the Xiaomi/Jelly device.

## Target and package

```powershell
$ADB = 'C:\Users\gualt\AppData\Local\Android\Sdk\platform-tools\adb.exe'
& $ADB devices -l
# Set this from the exact R3CW406P8CV line; preserve any displayed suffix verbatim.
$SERIAL = 'R3CW406P8CV'
$PKG = 'com.kalsa.app'
```

If using Git Bash, first set `export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'`.

## Start, background, stop, return

```powershell
& $ADB -s "$SERIAL" shell am start -n "$PKG/.MainActivity"
& $ADB -s "$SERIAL" shell input keyevent KEYCODE_HOME
& $ADB -s "$SERIAL" shell am force-stop "$PKG"
& $ADB -s "$SERIAL" shell am start -n "$PKG/.MainActivity"
```

There is no source-defined model-select intent or q66-specific ADB test intent. The declared `kalsa://` deep link is for share import (`kalsa://share?...`), not model selection. Select a model through the UI: open the drawer → Settings → Models → choose a catalog entry. The current registry contains Qwen 3.5 4B/Q3/2B and Gemma 4 E2B; it does not contain `Marco-Mini-Instruct-KEXP.gguf` or OLMoE, so Marco cannot be selected by this current tree without an app change.

## Model storage and safety

Production model paths are under Expo `documentDirectory/models/<registry-id>/<file>` (Android app-private files, normally `/data/user/0/com.kalsa.app/files/models/...`). The bench-only draft convention is `/data/data/com.kalsa.app/files/models/draft/...`. `/data/local/tmp` is not the production model path. Do not delete or move its Marco/OLMoE copies.

On resume, inspect before installing or copying:

```powershell
& $ADB -s "$SERIAL" shell df -h /data
& $ADB -s "$SERIAL" shell ls -lah /data/local/tmp
& $ADB -s "$SERIAL" shell run-as "$PKG" ls -lah files
& $ADB -s "$SERIAL" shell run-as "$PKG" find files/models -maxdepth 3 -type f -print
& $ADB -s "$SERIAL" shell ls -lah /sdcard/Android/data/$PKG/files
```

Before `install -r`, record the installed package/version and back up every path returned by `pm path`:

```powershell
& $ADB -s "$SERIAL" shell pm list packages | Select-String 'com.kalsa'
& $ADB -s "$SERIAL" shell dumpsys package "$PKG" | Select-String 'versionCode|versionName'
& $ADB -s "$SERIAL" shell pm path "$PKG"
New-Item -ItemType Directory -Force 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\device-backup' | Out-Null
# Pull each exact base/split APK path returned above; do not delete anything.
& $ADB -s "$SERIAL" pull '<exact pm path>' 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\device-backup\'
```

Install only the eventual arm64 release artifact and keep data:

```powershell
& $ADB -s "$SERIAL" install -r '<q66 app-release.apk>'
& $ADB -s "$SERIAL" shell dumpsys package "$PKG" | Select-String 'versionCode|versionName'
```

## Smoke procedure (not run)

1. Clear/capture logcat, start `MainActivity`, and record the foreground PID with `pidof com.kalsa.app`.
2. Use UI Automator/screenshot to open Settings → Models. Marco is not a current catalog option; do not download or copy a different file under its name.
3. For a selectable catalog model, select/download it if the device has the required free disk, return to Chat, enter one short prompt, and tap Send. Confirm visible output and the log lines below; do not collect timing or throughput.
4. Capture foreground memory and oom adjustment, then close:

```powershell
$pid = (& $ADB -s "$SERIAL" shell pidof "$PKG").Trim()
& $ADB -s "$SERIAL" shell dumpsys meminfo "$PKG" | Select-String 'TOTAL PSS|Private Dirty'
& $ADB -s "$SERIAL" shell cat "/proc/$pid/oom_score_adj"
& $ADB -s "$SERIAL" shell am force-stop "$PKG"
```

Useful app-side log strings are emitted through React Native JS: `KALSA_PREWARM`, `KALSA_TELEMETRY`, `[engine-init-native-tail]`, and engine-init/error text. Use:

```powershell
& $ADB -s "$SERIAL" logcat -v threadtime -s ReactNativeJS:* | Select-String 'KALSA_PREWARM|KALSA_TELEMETRY|engine-init-native-tail|engine.init|llama|mmap'
& $ADB -s "$SERIAL" logcat -s lowmemorykiller ActivityManager:*
```

Detect a process kill/restart with `pidof com.kalsa.app` before and after a lifecycle event. A model reload is indicated by a new `engine.init`/native-tail sequence after a new PID or a model switch; `KALSA_PREWARM` indicates the subsequent static-prefix prewarm. `KALSA_TELEMETRY` is a turn-completion line, not a measurement request here.

Chat history is persisted in AsyncStorage: conversation index `kalsa.conversations.v1` and per-chat keys `kalsa.messages.<sanitized-id>`. Completed turns persist; in-flight assistant text is persisted as an interrupted partial at lifecycle/unmount checkpoints when non-empty, so a kill can preserve a partial but cannot guarantee the last unsaved token.

`Q66 PREP: BLOCKED prebuild gate failed — corrected patch-package order still leaves the wrapper/core API mismatch; assert-native-patch.sh found no release librnllama.so. No APK, device mutation, or smoke evidence exists.`
