# iOS parity gaps

Read-only recon of `~/Projects/kalsa` (`main`) against `~/Projects/kalsa-ios` (`ios/first-build`). No builds were run. The existing simulator and iPad-on-Mac runs establish that the iOS app can compile, launch, run LFM2.5 on Metal, and generate; this list is about product parity and a safe merge.

## 1. Android-only native pieces and source branches

| Piece | Evidence (quoted source line) | iOS impact and required path |
|---|---|---|
| `modules/kalsa-iroh` | `modules/kalsa-iroh/expo-module.config.json:2` — `"platforms": ["android"]`; `modules/kalsa-iroh/src/index.ts:46` — `KalsaIroh native module unavailable (Android only)` | Pairing and remote-brain transport are absent. **(b)** Port/register the Rust-UniFFI bridge for Apple and implement iOS pairing URL/universal-link entry. Foreground P2P can exist; iOS suspension prevents promising an always-on peer. |
| `modules/kalsa-lifecycle` on `main` | `modules/kalsa-lifecycle/expo-module.config.json:2` — `"platforms": ["android"]`; `modules/kalsa-lifecycle/android/src/main/java/expo/modules/kalsalifecycle/KalsaLifecycleModule.kt:85` — `object : ComponentCallbacks2` | No Android trim levels, native timers, or memory-pressure event bridge on iOS. **(c)** Use Swift/UIKit memory-warning and background-task APIs; there is no iOS equivalent for Android trim levels or guaranteed periodic background timers. The branch adds an Apple module, but deliberately does not map UIKit warnings to Android trim-level events. |
| `modules/kalsa-thermal` | `modules/kalsa-thermal/expo-module.config.json:2-4` — `"platforms": ["apple", "android"]` and `"modules": ["KalsaThermalModule"]`; main has only `android/src/.../KalsaThermalModule.kt:46` — `manager.getCurrentThermalStatus()` | Main declares an Apple module that is absent from its tracked tree, so iOS thermal bridge registration is a gap. **(b/c)** Add the Swift module using `ProcessInfo.thermalState`; the iOS branch already adds it. iOS reports states, not Android temperature/sysfs values. |
| `GovernorBattery` | `plugins/withGovernorBattery.js:13` — `withDangerousMod(config, ["android"`; `native/GovernorBatteryModule.kt:168` — `BatteryManager.BATTERY_PROPERTY_CURRENT_NOW` | Detailed current/charge-counter readings and native energy traces are unavailable. **(c)** `UIDevice`/Expo battery APIs provide coarse level/state; there is no public iOS current-draw equivalent. Energy-trace UI must show unavailable rather than imply parity. |
| Android share-in plugin | `plugins/withAndroidShareIntent.js:2-4` — `ACTION_SEND / SEND_MULTIPLE` are rewritten because they are not visible to RN Linking; `app.config.js:49-66` — Android `SEND`/`SEND_MULTIPLE` text/PDF filters | Users cannot share text/PDF *into* Kalsa from another app through this Android intent path. **(b/c)** Add an iOS Share Extension with App Group/file-URL handoff. Outbound sharing already uses Expo Sharing. |
| Android-only config plugins and project | `plugins/withGovernorBattery.js:12-24` copies Kotlin into Android; `app.config.js:131` — `"./plugins/withGovernorBattery"`; `app.config.js:167` — `"./plugins/withCalendarReadOnly"` | These mods are Android manifest/MainApplication/Gradle changes; they do not themselves provide iOS functionality. **(a)** Keep them Android-scoped. iOS calendar permission text is separately configured at `app.config.js:25-28`. The checked-in `android/` tree is Gradle project scaffolding; Expo config/plugins and `native/` are the canonical custom sources. |
| Android-specific vision/image load retry | `src/engine/LlamaService.ts:2715` — `if (Platform.OS === "android" && (params.n_gpu_layers ?? 0) > 0)` | GPU-init CPU retry is intentionally Android-only; iOS does not run this retry path. **(a)** No iOS port is needed unless Metal failures require a separately designed retry policy. |

### `Platform.OS` branches in `src/`

| Source | Quoted evidence | iOS result / treatment |
|---|---|---|
| `src/theme/createStyles.ts:18` | `Platform.OS === "android" ? colors.panelSolid : "transparent"` | Platform styling; iOS takes the transparent branch. **(a)** |
| `src/theme/components/GlassPanel2.tsx:57` | `Platform.OS === "android" ? Math.min(intensity, 24) : intensity` | iOS keeps full blur intensity. **(a)** |
| `src/theme/components/Drawer.tsx:83` | `behavior={Platform.OS === "ios" ? "padding" : undefined}` | Existing iOS keyboard layout. **(a)** |
| `src/hooks/useThermalMonitor.ts:115` | `if (Platform.OS === "android")` | Main reads Android sysfs; iOS falls through to memory proxy/no OS thermal state. **(c)** Use the Apple thermal module (added on the branch). |
| `src/voice/VoiceCapture.ts:185` | `if (Platform.OS !== "android") return true;` | iOS proceeds without Android permission APIs and relies on the microphone Info.plist prompt. Voice capture is already cross-platform. **(a)** |
| `src/ui/AskAssistantMiniappRenderer.tsx:1921,2027` | `Platform.select({ ios: "ios", android: "android", default: "android" })`; `Platform.OS === "web"` | Existing iOS variant and web-only guard. **(a)** |
| `src/engine/deviceProfile.ts:575` | `if (Platform.OS !== "android") return null;` | Android CPU sysfs probe is absent; SoC lookup at `:511-519` reads `NativeModules.GovernorBattery`, also Android-only. **(c)** iOS branch adds Apple model/chip classification and memory headroom. |
| `src/engine/threadProfile.ts:243-245` | `if (Platform.OS !== "android") { ... "fallback:non-android" }` | iOS uses conservative fallback thread count, no Android CPU capacity/affinity probe. **(c)** Use Apple device class/available core count where useful; never map Android affinity controls directly. |
| `src/engine/memoryEstimate.ts:294-296` | `if (Platform.OS !== "android") { cachedAvailableBytes = null; return null; }` | Main RAM headroom estimate is unknown on iOS. **(c)** Read `os_proc_available_memory()` as a fresh advisory sample; branch implements this. |
| `src/engine/monitor.ts:58,79,107` | `if (Platform.OS !== "android") return null;` / `return empty;` | `/proc/meminfo`, `/proc/self/status`, and `/proc/self/stat` telemetry is unavailable. **(c)** Use Apple per-process available-memory API where a meaningful equivalent exists; RSS/major-fault/swap fields remain unavailable absent a different supported API. |
| `src/account/storeSource.ts:44,53` | `Platform.OS === "ios"` / `Platform.OS === "android"` | Both store-source paths already exist. **(a)** |
| `src/engine/LlamaService.ts:2715,2811` | Android-only GPU retry; `use_gpu: Platform.OS === "ios"` | iOS requests GPU for multimodal inference while keeping Android retry behavior separate. **(a)** Validate model/backend capability per device. |
| `src/theme/typography.ts:22-26` | `Platform.select({ default: typeFaces... })` | Shared defaults, no Android-only behavior. **(a)** |

### npm dependencies

No declared third-party npm dependency without iOS support was identified. The package set is at `package.json:19-69`; in particular the PCM audio dependency contains `node_modules/@fugood/react-native-audio-pcm-stream/ios/RNLiveAudioStream.m`, and `react-native-fs`, `whisper.rn`, and `llama.rn` have iOS native sources/pod integration. Local `kalsa-iroh`, lifecycle, thermal and `GovernorBattery` are handled above as native modules, not as unsupported third-party npm packages. Recheck these facts when changing dependency versions.

## 2. Explicit product checks

| Feature | Current evidence and gap | iOS action |
|---|---|---|
| Model download/resume in background | `src/engine/ModelDownloader.ts:366-389` uses `FileSystem.createDownloadResumable`; `:393-405` persists pause state. No app Android foreground-service implementation was found. Expo's current native legacy record defaults `sessionType` to `.background` (`node_modules/expo-file-system/ios/Legacy/FileSystemLegacyRecords.swift:45`), so iOS uses a background URLSession for transfer while suspended. A terminated/relaunched JS runtime does not restore the JS task/callback/promise. | Test suspension, user force-quit, relaunch, resume-data validity, and completion reconciliation on device. If downloads must complete robustly across process death, integrate URLSession background completion handling and persist/reconcile native task identifiers; do not describe it as an Android foreground-service feature. |
| Share-in | Android intent rewriting is in `plugins/withAndroidShareIntent.js:2-8`; outbound share package is already present at `package.json:50`. | Share Extension + App Group or supported URL handoff, PDF/text/file URL security-scope handling, and extension-to-app import tests. **(b/c)** |
| Notifications | `src/host/downloadNotifications.ts:79-90` requests permission and sets Android channels; `:91-115` schedules progress/ready notices. | Local notifications exist on iOS, but Android channels, sticky progress semantics, and channel importance do not map directly. Add platform-safe behavior and permission QA. Remote APNs push is a separate capability and needs paid-program signing; no evidence of a remote-push product feature. |
| Thermal and battery | Android thermal reads sysfs (`src/hooks/useThermalMonitor.ts:115-117`); custom battery module is Android-only (`native/GovernorBatteryModule.kt:168`). | Add Swift `ProcessInfo.thermalState` module (on branch); accept state-only/no °C. Use Expo/UIDevice for battery level/state; detailed current draw is unavailable via public API. |
| Memory headroom | Main returns unknown off Android (`src/engine/memoryEstimate.ts:294-296`). Apple `os_proc_available_memory()` returns bytes available to this app, can return 0 at/over limit, changes quickly, and must not be cached: [Apple API](https://developer.apple.com/documentation/os/os_proc_available_memory). | Branch implements the native read and zero-is-real semantics. Keep it uncached; treat 0 as zero headroom. `com.apple.developer.kernel.increased-memory-limit` is not in `app.config.js:15-31`; Apple says it can raise limits only on supported devices and code must work without the increase: [entitlement docs](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.kernel.increased-memory-limit). Do not make model fit depend on entitlement approval. |
| Governor lanes | Android build enables OpenCL/Hexagon (`app.config.js:122-128`); the llama service has Android GPU fallback (`src/engine/LlamaService.ts:2715`) while iOS requests GPU for vision (`:2811`). | The Android Adreno/OpenCL and Qualcomm Hexagon/HTP/NPU lanes do not exist on Apple. iOS inference should choose CPU or the binding's Metal backend based on Apple-device/memory data; an HTP/NPU lane must be unavailable unless separately implemented through an Apple-supported backend. No Android governor behavior should be inferred from the iOS lane name. |
| Pairing / remote brain (`iroh`) | Module is Android-only (`modules/kalsa-iroh/expo-module.config.json:2`); missing bridge throws at `modules/kalsa-iroh/src/index.ts:43-47`. | Rust/UniFFI and Expo Apple bridge plus universal-link/share acceptance. Background reachability is constrained by iOS; promise only foreground connected sessions unless separately designed/tested. **(b)** |
| Voice (`whisper.rn`) | `package.json:69` declares `whisper.rn`; voice permission has iOS path at `src/voice/VoiceCapture.ts:183-190`; dependency includes iOS native sources and Metal-capable framework. | No platform port indicated. Explicitly test microphone permission strings, audio session interruptions/backgrounding, model download/storage, and whisper inference on physical iPhones. **(a)** |
| PDF/document import | `src/host/useAttachments.ts:185-193` uses Expo DocumentPicker; `package.json:41,77` declares Expo picker and JS `pdfjs-dist`; conversion is in `src/components/PdfToImages.tsx`. | File picker/PDF conversion are cross-platform. Test Files-provider URLs, security-scoped access copied to cache, large PDFs, and WebView memory. No Share Extension currently provides the share-in entry point. **(a)** |
| Camera | `src/host/useAttachments.ts:168-175` calls `ImagePicker.launchCameraAsync` and library picker; `expo-image-picker` is declared at `package.json:45`. | Camera capture exists via Expo ImagePicker, not a missing native Android camera module. Test usage prompt, denied permission/recovery, rotation, and large-image memory. **(a)** |

## 3. `ios/first-build` commits and a behavior-safe landing

Commits unique to the branch, oldest first: `d3456a50`, `2858a048`, `a15f5c10`, `4590f50d`, `c67e2df1`, `7c324067`. The last commit is explicitly an Expo SDK 58 beta trial. The branch is not a clean “iOS-only” merge: the SDK/RN dependency upgrade and several zero-memory gate changes have Android build or edge-case effects.

Touched-file inventory (`git diff --name-status main...ios/first-build`). “Android path?” means direct runtime or Android build-resolution impact, not merely that a shared TypeScript file is compiled on Android.

| Touched file | Android path changed? | Landing requirement |
|---|---:|---|
| `.gitignore` | No runtime | Keep Apple native sources unignored. |
| `App.tsx` | **Yes** — removes Android `StatusBar.backgroundColor` | SDK58/RN type workaround changed an Android UI prop. Keep/reapply Android appearance intentionally and verify before landing. |
| `app.config.js` | **Build risk** — SDK/plugin list shared; iOS scene option removed in SDK58 trial | Take only the iOS source-build plugin/module changes; keep `enableSceneSupport: true` (required by the tested iOS 27 lifecycle) and current Android build properties. Do not land SDK58 config by accident. |
| `modules/kalsa-lifecycle/expo-module.config.json` | No; retains Android registration and adds Apple | Safe with Android module entry preserved. |
| `modules/kalsa-lifecycle/ios/KalsaLifecycle.podspec` | No, iOS-only | Keep. |
| `modules/kalsa-lifecycle/ios/KalsaLifecycleModule.swift` | No, iOS-only | Keep; review zero/simulator semantics and native event registration. |
| `modules/kalsa-lifecycle/src/index.ts` | No Android runtime; shared TS API | Keep Android trim event API unchanged; Apple memory read is additive. |
| `modules/kalsa-thermal/ios/KalsaThermal.podspec` | No, iOS-only | Keep. |
| `modules/kalsa-thermal/ios/KalsaThermalModule.swift` | No, iOS-only | Keep. |
| `package.json` | **Yes, build/runtime risk** | Do not take SDK 58 beta/RN/Expo dependency version changes as part of an iOS-only landing. Select required plugin/config dependencies only after compatibility review. |
| `package-lock.json` | **Yes, build graph** | Regenerate only with the chosen dependency set; don't merge the beta lock wholesale. |
| `plugins/withLlamaIosSourceBuild.js` | No Android path intended | Keep only after verifying iOS pod source generation and preserving Android plugin order/config. |
| `scripts/assert-engine-provenance.sh` | No shipped runtime | Its accepted generated Metal divergence changes a manual gate; retain only if the exception remains narrowly scoped/documented. |
| `scripts/gen-metal-embed.js` | No shipped runtime; iOS build tool | Keep with the iOS source-build plugin; ensure it does not rewrite vendor-tracked files. |
| `src/components/PdfToImages.tsx` | No runtime; typing only | Keep type workaround only if still needed at the selected RN/WebView versions. |
| `src/components/reactNativeCodegenTypes.d.ts` | No runtime; shared type resolution | Keep only with matching RN/codegen versions. |
| `src/engine/appleDeviceClass.test.ts` | No | Tests only; preserve if landed. |
| `src/engine/appleDeviceClass.ts` | No Android selection intended | Keep Apple model mapping as iOS-only fallback. |
| `src/engine/deviceProfile.test.ts` | No | Tests only. |
| `src/engine/deviceProfile.ts` | **Potential Android edge change** | Apple fallback is additive, but branch changes memory gate comparisons from `> 0` to `>= 0`; scope zero-as-real to iOS so Android zero retains main semantics. |
| `src/engine/loadGate.test.ts` | No | Tests only. |
| `src/engine/memoryEstimate.test.ts` | No | Tests only. |
| `src/engine/memoryEstimate.ts` | No Android path intended | Preserve Android `/proc` cache; add iOS uncached native reader as a separate branch. |
| `src/engine/modelGateRAM.ts` | **Potential Android edge change** | Scope `>= 0`/zero-is-known behavior to iOS; keep Android gate semantics unchanged. |
| `src/engine/monitor.test.ts` | No | Tests only. |
| `src/engine/monitor.ts` | No Android behavior intended | Add iOS branch while leaving Android `/proc` readers/cache semantics untouched. |
| `src/engine/platformThermalStatus.test.ts` | No | Tests only. |
| `src/engine/platformThermalStatus.ts` | No Android behavior intended | Apple thermal mapping is additive. |
| `src/engine/thermalThresholds.ts` | Type/state union only | Keep existing Android states and temperatures unchanged. |
| `src/hooks/useThermalMonitor.ts` | No Android behavior intended | Add iOS state branch; retain Android sysfs read and proxy order. |
| `src/host/engineGateHelpers.ts` | **Potential Android edge change** | `>= 0` accepts a zero sample for all platforms; scope zero replacement to iOS. |
| `src/host/loadRetryFreshness.test.ts` | No | Tests only. |
| `src/host/useShareIn.ts` | No meaningful Android behavior; nullish typing normalization | Safe if `undefined` remains equivalent to absent URL. |
| `src/theme/typography.ts` | No runtime intended | Typing cast only; keep only if needed for selected RN types. |
| `tsconfig.json` | **Shared build/type-resolution risk** | SDK58 legacy deep-import custom condition is global; retain only with exact RN/WebView/view-shot versions that need it. |

Recommended landing shape: rebase the iOS fixes onto current `main`; keep iOS pod/plugin/module additions and Apple-specific readers; isolate the zero-headroom semantics by `Platform.OS === "ios"`; leave the SDK58 beta dependency/package-lock/App typing workaround stack out until its Android effect is separately accepted. Preserve `enableSceneSupport: true` from `main`. This keeps Android behavior stable while accepting explicit additive iOS code.

### CI cost

Current CI is Android-only: `.github/workflows/apk.yml:43-46` — `runs-on: ubuntu-latest`; `:339-343` — `expo prebuild --platform android`. Add an iOS prebuild/pod/Xcode build job on a macOS runner if we want compile coverage. GitHub's current billing docs list macOS 3/4-core at **$0.062/minute** and Linux 2-core at **$0.006/minute** (about **10× the Linux baseline**); included private-repository Actions minutes are finite (GitHub Free: 2,000/month). See [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) and [runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing). Keep iOS CI scoped to relevant paths/manual dispatch if the free-tier budget matters.

## 4. Prioritised plan

### Blocks TestFlight distribution

1. **Paid Apple Developer Program membership** — Apple Account/Personal Team is enough to build and install locally, but not App Store Connect/TestFlight distribution. Membership is **US$99 per year** (or local equivalent). It provides distribution certificates/profiles and App Store Connect access; TestFlight requires uploading an identified/provisioned build. [Membership comparison](https://developer.apple.com/support/compare-memberships/) · [TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/). Push Notifications capability also failed under the free Personal Team in the recorded Mac run; paid signing is required if the product keeps APNs push. Local notifications do not by themselves block TestFlight.
2. **A repeatable signed iOS archive/upload path** — Xcode on macOS, bundle ID/profile, App Store Connect app record, export compliance, and a successful TestFlight upload. The recorded build proves a local Release build, not an uploaded TestFlight build.
3. **Merge only reviewed iOS fixes while preserving Android** — especially scope zero-memory gate changes to iOS and avoid silently taking the SDK58 beta dependency upgrade. Keep iOS 27 scene lifecycle support.
4. **Minimum first-beta product checks** — model download through suspension/relaunch, share-in decision (extension or explicitly defer), permission flows, memory-pressure refusal/recovery on physical devices, and pairing feature either implemented or clearly unavailable. These are product readiness gaps; not all block an internal beta if deliberately deferred.

### Free work available now

- Rebase/cherry-pick the iOS-only thermal/lifecycle/module, Apple device-class, memory, and Metal source-build pieces; separate shared gate behavior by platform; preserve Android logic and SDK versions.
- Use existing free Apple Account/Personal Team for local simulator/device builds and UX checks (profiles expire/reprovision periodically); keep the successful Metal/generation path as a development proof, not distribution proof.
- Implement/test share extension and pairing bridge; audit download completion after suspension/termination, local notification mapping, camera/document permissions, and iOS thermal/memory UI.
- Add an optional/manual macOS CI job or run Xcode locally; defer always-on macOS CI until its roughly 10× Linux-baseline cost is budgeted.
- Decide whether increased-memory-limit entitlement is worth requesting/using on supported devices; first use `os_proc_available_memory()` correctly and make the product safe without elevated limits.
