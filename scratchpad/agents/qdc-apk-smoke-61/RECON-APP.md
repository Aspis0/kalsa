# QDC APK Smoke — App Recon (read-only, commit c513f00)

## 1. Package / SDK / ABI

`android/app/build.gradle:60-62`:
```
applicationId 'com.kalsa.app'
minSdkVersion rootProject.ext.minSdkVersion  → 33 (app.config.js:110)
targetSdkVersion rootProject.ext.targetSdkVersion → 36 (merged manifest:7)
```
`AndroidManifest.xml:160,168-170` launcher activity:
```
android:name="com.kalsa.app.MainActivity"
<action android:name="android.intent.action.MAIN" />
<category android:name="android.intent.category.LAUNCHER" />
```
ABI filters: NOT FOUND in build.gradle (no `ndk { abiFilters }`).
Expo arch override in CI: `-PreactNativeArchitectures=x86_64` (e2e-emulator.yml:71).
Scheme: `kalsa` (app.config.js:8).

## 2. CI E2E workflow — how it drives inference

**Tool:** raw `adb` commands (tap/type via `uiautomator` dump, `adb shell input text/keyevent/tap`). No Maestro, no Detox.

**Model loading:** CI downloads GGUF from HuggingFace, then `install_and_sideload` pushes it via `adb push` → `mv` into app private dir.
`scripts/ci-lib.sh` (install_and_sideload, ~line 1124):
```bash
adb shell "mkdir -p /data/data/$PKG/files/models/$model_dir"
adb push "$model_src" /data/local/tmp/model.gguf
adb shell "mv /data/local/tmp/model.gguf /data/data/$PKG/files/models/$model_dir/$model_file"
```
Model selection is set via AsyncStorage (SQLite) before launch:
`scripts/ci-e2e.sh:57`:
```bash
sql "INSERT OR REPLACE INTO catalystLocalStorage (key,value) VALUES ('kalsa.model.id','$MODEL_DIR');"
```

**Launch + type + send:** `scripts/ci-e2e.sh:66,86,89`:
```bash
adb shell am start -n $PKG/.MainActivity >/dev/null   # line 66
adb shell input text "$msg"                            # line 34 (type_into_composer)
tap_node "Send"                                        # line 89
```

**Assertion (engine ran):** KALSA_TELEMETRY JSON lines in logcat with `tokensEvaluated > 0`.
`scripts/ci-e2e.sh:120`: `adb logcat -d | grep -iE "RNLlama|llama|ReactNativeJS"`
`scripts/ci-e2e.sh:210`: `adb logcat -d | grep -F "KALSA_TELEMETRY"`

**Duration:** timeout 120 min; measured ~8.6 min/turn on 2-vCPU, ~35 min total.
`e2e-emulator.yml:12`: `timeout-minutes: 120`

## 3. Model path on device + registry

**On-device path:**
`src/engine/ModelDownloader.ts:17`: `const MODELS_DIR = ${FileSystem.documentDirectory ?? ""}models/`;
→ resolves to `/data/data/com.kalsa.app/files/models/`
`src/engine/ModelRegistry.ts` (id→dir): model id IS the directory name (e.g. `lfm2.5-2.6b`).
**Full path for LFM2.5-2.6B:** `/data/data/com.kalsa.app/files/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf`

**Registry entry (ModelRegistry.ts:293-310):**
```ts
id: "lfm2.5-2.6b",
file: "LFM2.5-2.6B-QAD-Q4_0.gguf",
sizeBytes: 1_593_894_944,
hfRepo: "LiquidAI/LFM2.5-2.6B-GGUF",
revision: "f4a289c8a200a5ca71005ba7abc2dad33058a450",
```
**No manifest/index file required.** App checks `isFileComplete()` (exact byte match) only:
`src/engine/ModelDownloader.ts:79-80`:
```ts
const info = await FileSystem.getInfoAsync(target);
return info.exists && (info.size ?? 0) === sizeBytes;
```
A correctly-sized GGUF pushed via `adb push` + `run-as` is recognized without download.
The CI sideload pattern: `adb push → mv → chown` (ci-lib.sh ~line 1149-1152).

## 4. Headless entry points

**Deep links:** `kalsa://share?text=...` / `kalsa://share?file=...` — fills the composer only, does NOT auto-send.
`src/app/shareIntent.ts:46`: `if (scheme !== "kalsa") return null;`

**No benchmark/self-test/debug mode found.** No intent extras, no SharedPreferences debug flags, no test-only screen.

**AsyncStorage knobs used by CI** (ci-e2e.sh:57-61):
```
kalsa.model.id → model directory name
kalsa.context.compaction → "1" or "0"
kalsa.bench.thinking → thinking budget mode
```
These set model selection but do NOT trigger a send — CI still types via `adb shell input text` + taps Send.

**No Maestro flows in repo.** NOT FOUND.

**Minimum UI steps for headless send (what ci-e2e.sh does):**
1. `adb shell am start -n com.kalsa.app/.MainActivity`
2. Wait ~30s for model load
3. `uiautomator dump` → find EditText bounds → `adb shell input tap <center>`
4. `adb shell input text "<prompt>"`
5. `uiautomator dump` → find Send button → `adb shell input tap <center>`
6. Poll logcat for `KALSA_TELEMETRY` or poll SQLite for `"role":"assistant"`

## 5. Logcat tags / lines for verification

**(a) Native engine banner (kalsa-native-patches marker):**
`patches/llama.rn+0.12.8.patch:358`:
```cpp
os << " | kalsa-native-patches";
```
Emitted by `common_params_get_system_info()` into the llama.cpp init banner.
CI verification: `scripts/assert-native-patch.sh` greps `strings librnllama.so` for `kalsa-native-patches`.

**(b) Model loaded:**
`adb logcat -d | grep -iE "RNLlama|llama"` — the `RNLlama` tag is the llama.rn JSI binding log tag.
`KALSA_SESSION` JSON with `"op":"load"` confirms model load:
`src/engine/LlamaService.ts:2086`:
```ts
`KALSA_SESSION ${JSON.stringify({ op: "load", ms: Date.now() - t0, ok, ...extra })}`
```

**(c) Generation done + perf:**
`KALSA_TELEMETRY` JSON line with `tokensEvaluated`, `tokensPredicted`, `promptMs`, `predictedMs`:
`src/engine/turnTelemetry.ts:191`:
```ts
return `KALSA_TELEMETRY ${JSON.stringify({ turnId, ...telemetry, ... })}`;
```
**Native prefix-reuse / n_past line:**
`patches/llama.rn+0.12.8.patch:752`:
```
embd.size(), text_tokens.size(), n_common,
```
CI greps: `grep -oE "Input processed: n_past=[0-9]+, embd\.size=[0-9]+"` (ci-lib.sh capture_kv_reuse).

**GPU backend (OpenCL/Adreno):** logged by llama.cpp's own backend init; no custom kalsa tag for this.
`patches/llama.rn+0.12.8.patch:63,68`: OpenCL-Headers + Adreno q2_k/q3_k kernel references.

## 6. Blocks for headless run on fresh device

**Model download gate:** The app checks `isModelBundleDownloaded()` before loading. If the GGUF is NOT on disk, the app enters `"missing"` state (`AppShell.tsx:3042`). The CI bypass: push GGUF via adb BEFORE first launch, then force-stop/relaunch.

**First-launch force-stop cycle:** CI runs a "first launch" to create the AsyncStorage DB, then force-stops:
`ci-lib.sh (install_and_sideload)`: `adb shell am start -n "$PKG/.MainActivity"; sleep 25; adb shell am force-stop "$PKG"`

**No login / no account required.** No Google account, no network required for onboarding.
`app.config.js:39`: `extra: { /* Tutto locale: nessun backend */ }`

**No mandatory onboarding screen.** App goes straight to AiChatPage with welcome chips.

**Network permission present but not required** for local inference (AndroidManifest.xml:17: `android.permission.INTERNET`).

**Anaconda:** `adb shell input text` has IME mangling risk; CI disables IME on device arms (`IME_SUSPEND=1`). On a fresh QDC phone, test with IME suspend or accept potential autocorrect.
