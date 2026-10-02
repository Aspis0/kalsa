# whisper.rn upgrade recon

Checked 2026-10-02. Kalsa checkout is on the requested app repo; working-tree status had pre-existing untracked `CLAUDE.md` and `calib.ok`, left untouched.

## 1. Version and React Native compatibility

- **Latest stable npm:** `0.7.4`, published 2026-08-27 (npm registry time: `2026-08-27T12:24:47.962Z`; npm dist-tag `latest` is 0.7.4). **Latest prerelease:** `0.8.0-rc.1`, published 2026-09-17. Sources: [npm package](https://www.npmjs.com/package/whisper.rn), [npm registry metadata](https://registry.npmjs.org/whisper.rn).
- **Yes, stable 0.7.4 removes the build-time `RCTCxxBridge` dependency.** In `ios/RNWhisper.mm`, it declares `RNWhisperBridgeRuntimeAccess` with `runtime` and `jsCallInvoker`, then accesses `bridge.batchedBridge` through that protocol. The 0.8.0-rc.1 source keeps the same pattern. Quotes from the published sources: “`@protocol RNWhisperBridgeRuntimeAccess <NSObject>`” and “`id<RNWhisperBridgeRuntimeAccess> cxxBridge = (id<RNWhisperBridgeRuntimeAccess>)bridge.batchedBridge;`” ([0.7.4 source](https://unpkg.com/whisper.rn@0.7.4/ios/RNWhisper.mm), [0.8.0-rc.1 source](https://unpkg.com/whisper.rn@0.8.0-rc.1/ios/RNWhisper.mm)). The 0.7.2 source still says “`RCTCxxBridge *cxxBridge = (RCTCxxBridge *)bridge.batchedBridge;`” ([0.7.2 source](https://unpkg.com/whisper.rn@0.7.2/ios/RNWhisper.mm)).
- This is the same protocol/dynamic-dispatch family as Kalsa’s trial patch and should compile against RN 0.87/0.88 headers without the removed type. It is **not** a migration to a TurboModule/RuntimeExecutor JSI installation path: the install still obtains the runtime via `batchedBridge` and protocol properties. Runtime risk remains because the RN 0.88 audit says `RCTBridgeProxy.batchedBridge` returns the proxy and is marked unsupported; the trial verified compile/launch/JSI load, not a Whisper voice flow. See [SDK 58 audit, §6](AUDIT-sdk58-trial.md) and [upstream releases](https://github.com/mybigday/whisper.rn/releases).
- The repository currently lists two open PRs: [#340, RealtimeTranscriber memory/work bounds](https://github.com/mybigday/whisper.rn/pull/340) and [#297, segment string building](https://github.com/mybigday/whisper.rn/pull/297). Neither is an RN 0.87/0.88 or JSI-install compatibility PR. The upstream [development notes](https://github.com/mybigday/whisper.rn/blob/main/AGENTS.md) describe a TurboModule spec, but that does not change the native iOS JSI installer described above.

## 2. Kalsa APIs used; 0.7.2 → 0.7.4 changes

App search: `git -C ~/Projects/kalsa grep -n "whisper.rn"`; call-site search limited to `src/**/*.ts(x)`. The 0.7.2 → 0.7.4 upgrade has **no breaking change in these calls or their used options**; the native bridge compatibility change is the relevant difference.

- Package entry: `require("whisper.rn/index")` — [src/voice/whisperRn.ts:99](../../../../kalsa/src/voice/whisperRn.ts:99). Kalsa intentionally loads the explicit subpath.
- `initWhisper({ filePath })` — [WhisperService.ts:84](../../../../kalsa/src/voice/WhisperService.ts:84), [126](../../../../kalsa/src/voice/WhisperService.ts:126), [165](../../../../kalsa/src/voice/WhisperService.ts:165).
- `context.transcribeData(pcm, { language, maxThreads })` with an `ArrayBuffer` and returned `promise`/`stop` — [WhisperService.ts:136](../../../../kalsa/src/voice/WhisperService.ts:136); awaits result at [142](../../../../kalsa/src/voice/WhisperService.ts:142), can stop at [30](../../../../kalsa/src/voice/WhisperService.ts:30).
- `context.transcribe(filePath, { language, maxThreads })`, also consuming returned `promise`/`stop` — [WhisperService.ts:175](../../../../kalsa/src/voice/WhisperService.ts:175); awaits at [181](../../../../kalsa/src/voice/WhisperService.ts:181).
- `context.release()` — [WhisperService.ts:75](../../../../kalsa/src/voice/WhisperService.ts:75), [207](../../../../kalsa/src/voice/WhisperService.ts:207).
- Kalsa declares `releaseAllWhisper` in its loader/type shim but does not call it. It is not part of the used API list.

## 3. Android upgrade impact

- `minSdkVersion=23`, default NDK property `27.3.13750724`, compile SDK 31 / target SDK 31 in `android/gradle.properties`; these defaults are unchanged in 0.7.2, 0.7.4, and 0.8.0-rc.1 ([0.7.4 Gradle properties](https://unpkg.com/whisper.rn@0.7.4/android/gradle.properties)).
- Gradle passes `-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON` ([0.7.4 Android build](https://unpkg.com/whisper.rn@0.7.4/android/build.gradle)); this is the 16 KB page-size build setting. The upstream [Android notes](https://github.com/mybigday/whisper.rn/blob/main/AGENTS.md) say “Supports 16KB page sizes (Android 15+).”
- No new minSdk/NDK/page-size regression is apparent in the upgrade. NDK selection is configurable from the host project; the package property uses lowercase `ndkversion`, so confirm the resolved NDK in the actual Gradle build if Kalsa overrides it. I did not inspect ELF alignment of downloaded release binaries.

## 4. Recommendation

Upgrade Kalsa from locked 0.7.2 to stable 0.7.4 on SDK 57: it preserves the calls above and includes the RN 0.87/0.88 compile fix that the local trial had to reproduce. Then use that exact package in the SDK 58 trial and run an actual Whisper transcription before treating it as cleared; upstream still relies on the unsupported `batchedBridge` proxy path, and no RuntimeExecutor migration is present. **Confidence: high** that 0.7.4 removes the `RCTCxxBridge` compile error and that the used JS APIs remain compatible; medium on bridgeless runtime safety until voice flow is exercised.
