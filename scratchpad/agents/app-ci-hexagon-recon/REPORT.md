# App CI Hexagon Recon

Scope: read-only inspection for coordinator session `3f035b4e`. Binding source is inspected at commit `c0bbbd3545ba90acaf937dc2b9e898ae6b8dd54d`. No source edits, builds, Docker, or QAIC were run. The only created file is this report.

## 1. Android Hexagon enablement and host vs DSP inputs

**Verdict: CONFIRMED.** At the pinned binding, Gradle's check is directory existence, not a successful SDK/toolchain probe. Environment values take precedence; otherwise it uses `$HOME/.hexagon-sdk/6.4.0.2` and its `tools/HEXAGON_Tools/19.0.04` directory. It passes these paths to CMake only if both directories exist. CMake gates the Hexagon code on the `_hexagon` substring in the target name and `ENABLE_HEXAGON`, then additionally requires the SDK and tools roots and `libcdsprpc.so` at the SDK's Android AArch64 FastRPC location.

> android/build.gradle:142:     def homeDir = System.getProperty("user.home")

> android/build.gradle:143:     def hexagonSdkRoot = System.getenv('HEXAGON_SDK_ROOT') ?: "${homeDir}/.hexagon-sdk/6.4.0.2"

> android/build.gradle:144:     def hexagonToolsRoot = System.getenv('HEXAGON_TOOLS_ROOT') ?: "${homeDir}/.hexagon-sdk/6.4.0.2/tools/HEXAGON_Tools/19.0.04"

> android/build.gradle:145:     def hexagonPresent = file(hexagonSdkRoot).exists() && file(hexagonToolsRoot).exists()

> android/build.gradle:171:     if (hexagonPresent) {

> android/build.gradle:172:       println("✅ Hexagon SDK detected — enabling DSP build")

> android/build.gradle:174:         "-DHEXAGON_SDK_ROOT=${hexagonSdkRoot}",

> android/build.gradle:175:         "-DHEXAGON_TOOLS_ROOT=${hexagonToolsRoot}"

> android/src/main/rnllama/CMakeLists.txt:39:     set(ENABLE_HEXAGON OFF)

> android/src/main/rnllama/CMakeLists.txt:40:     if (${target_name} MATCHES ".*_hexagon.*")

> android/src/main/rnllama/CMakeLists.txt:41:         set(ENABLE_HEXAGON ON)

> android/src/main/rnllama/CMakeLists.txt:88:             # Verify libcdsprpc.so exists

> android/src/main/rnllama/CMakeLists.txt:89:             set(CDSPRPC_LIB "${HEXAGON_SDK_ROOT}/ipc/fastrpc/remote/ship/android_aarch64/libcdsprpc.so")

> android/src/main/rnllama/CMakeLists.txt:90:             if (EXISTS ${CDSPRPC_LIB})

The Android **host** target compiles `ggml-hexagon.cpp`, `htp-drv.cpp`, and a QAIC-generated FastRPC stub. It needs SDK headers (including `incs`, `incs/stddef`, `rpcmem/inc`, `utils/examples`) and links `libcdsprpc.so`, whose symbols include the FastRPC and rpcmem entry points. It also requires generated `htp_iface_stub.c` and `htp_iface.h` in `htp/v73/`. The skels are separate DSP-side shared libraries. They are built for v73/v75/v79/v81 by the script and copied to `bin/arm64-v8a`; the Gradle asset sync includes files matching `libggml-htp-*.so` from there. Existing skels do not satisfy the host QAIC requirement.

> android/src/main/rnllama/CMakeLists.txt:105:                 ${RNLLAMA_GGML_HEXAGON_DIR}/ggml-hexagon.cpp

> android/src/main/rnllama/CMakeLists.txt:106:                 ${RNLLAMA_GGML_HEXAGON_DIR}/htp-drv.cpp

> android/src/main/rnllama/CMakeLists.txt:112:             set(HEXAGON_PREBUILT_HTP_DIR "${RNLLAMA_GGML_HEXAGON_DIR}/htp/v73/")

> android/src/main/rnllama/CMakeLists.txt:113:             set(HEXAGON_HOST_STUB "${HEXAGON_PREBUILT_HTP_DIR}/htp_iface_stub.c")

> android/src/main/rnllama/CMakeLists.txt:114:             set(HEXAGON_HOST_HEADER "${HEXAGON_PREBUILT_HTP_DIR}/htp_iface.h")

> android/src/main/rnllama/CMakeLists.txt:116:             if (NOT EXISTS ${HEXAGON_HOST_STUB} OR NOT EXISTS ${HEXAGON_HOST_HEADER})

> android/src/main/rnllama/CMakeLists.txt:117:                 message(FATAL_ERROR

> android/src/main/rnllama/CMakeLists.txt:119:                     "Run scripts/build-hexagon-htp.sh to generate ${HEXAGON_PREBUILT_HTP_DIR}.")

> android/src/main/rnllama/CMakeLists.txt:126:             target_include_directories(${target_name} PRIVATE

> android/src/main/rnllama/CMakeLists.txt:127:                 ${HEXAGON_SDK_ROOT}/incs

> android/src/main/rnllama/CMakeLists.txt:129:                 ${HEXAGON_SDK_ROOT}/ipc/fastrpc/rpcmem/inc

> android/src/main/rnllama/CMakeLists.txt:141:             target_link_libraries(${target_name} PRIVATE ${CDSPRPC_LIB})

> android/build.gradle:56:       into(assetsRootDir)

> android/build.gradle:58:         include "libggml-htp-*.so"

> android/build.gradle:59:         into "ggml-hexagon"

> vendor/llama.cpp/ggml/src/ggml-hexagon/CMakeLists.txt:39: build_idl(htp/htp_iface.idl htp_iface)

> vendor/llama.cpp/ggml/src/ggml-hexagon/CMakeLists.txt:60: # Build HTP skels

> vendor/llama.cpp/ggml/src/ggml-hexagon/CMakeLists.txt:79: build_htp_skel(v73)

> vendor/llama.cpp/ggml/src/ggml-hexagon/CMakeLists.txt:80: build_htp_skel(v75)

> vendor/llama.cpp/ggml/src/ggml-hexagon/CMakeLists.txt:81: build_htp_skel(v79)

> vendor/llama.cpp/ggml/src/ggml-hexagon/CMakeLists.txt:82: build_htp_skel(v81)

> vendor/llama.cpp/ggml/src/ggml-hexagon/CMakeLists.txt:85: install(FILES ${HTP_SKELS} TYPE LIB)

> scripts/build-hexagon-htp.sh:112: DSP_VERSIONS=("v73" "v75" "v79" "v81")

> scripts/build-hexagon-htp.sh:113: PREBUILT_DIRS=("toolv19_v73" "toolv19_v75" "toolv19_v79" "toolv19_v81")

> scripts/build-hexagon-htp.sh:184: # The Android host build compiles the generated FastRPC stub; keep it next to

> scripts/build-hexagon-htp.sh:187: cp build-hexagon-htp/v73/htp_iface_stub.c "${HTP_SOURCE_DIR}/v73/htp_iface_stub.c"

> scripts/build-hexagon-htp.sh:188: cp build-hexagon-htp/v73/htp_iface.h "${HTP_SOURCE_DIR}/v73/htp_iface.h"

> scripts/build-hexagon-htp.sh:40: HTP_OUTPUT_DIR="${ROOT_DIR}/bin/arm64-v8a"

> android/build.gradle:57:       from(htpLibSourceDir) {

> android/build.gradle:70:     applicationProject.tasks.matching { it.name == "preBuild" }.configureEach {

The binding's gitignore marks `htp/v73/` as generated, and the pinned tree inventory contains the IDL but not the generated header/stub. So QAIC outputs are not committed in this binding pin, nor present as checked-in outputs in either inspected engine checkout. The `kalsallama-onecopy-hmx` cache records an SDK 6.6.0.0 build, while this binding defaults to 6.4.0.2; do not assume its SDK version/path matches the binding script's default.

> .gitignore:96: # Generated by scripts/build-hexagon-htp.sh

> .gitignore:97: vendor/llama.cpp/ggml/src/ggml-hexagon/htp/v73/

> vendor/llama.cpp/ggml/src/ggml-hexagon/htp/htp_iface.idl:1: // FastRPC IDL interface for GGML HTP

> ~/Projects/kalsallama-onecopy-hmx/build-onecopy-hmx-fused-v73/CMakeCache.txt:467: GGML_HEXAGON:BOOL=ON

> ~/Projects/kalsallama-onecopy-hmx/build-onecopy-hmx-fused-v73/CMakeCache.txt:705: HEXAGON_SDK_ROOT:UNINITIALIZED=/opt/hexagon/6.6.0.0

> ~/Projects/kalsallama-onecopy-hmx/build-onecopy-hmx-fused-v73/build.ninja:3088:   COMMAND = cd /workspace/ggml/src/ggml-hexagon && /opt/hexagon/6.6.0.0/ipc/fastrpc/qaic//bin/qaic -mdll -o /workspace/build-onecopy-hmx-fused-v73/ggml/src/ggml-hexagon -I/opt/hexagon/6.6.0.0/incs/ -I/opt/hexagon/6.6.0.0/incs/stddef/ -I/opt/hexagon/6.6.0.0/ipc/fastrpc/rtld/ship/android_aarch64 -I/opt/hexagon/6.6.0.0/incs -I/opt/hexagon/6.6.0.0/incs/stddef -I/opt/hexagon/6.6.0.0/utils/examples -I/workspace/ggml/src/ggml-hexagon/htp -I/workspace/build-onecopy-hmx-fused-v73/ggml/src/ggml-hexagon htp/htp_iface.idl

## 2. Does the host need QAIC output, and where does it exist?

**Verdict: CONFIRMED.** Yes. The CMake `FATAL_ERROR` makes the two host artifacts a hard prerequisite when the SDK gate enables Hexagon. The IDL source is committed; the generated host header and stub are not. The pinned binding's script produces the four DSP skels and copies the v73 host `htp_iface_stub.c` and `htp_iface.h` into the ignored vendor directory. The engine build's CMake uses `build_idl()` to generate interface artifacts into the build tree, but no generated header/stub is checked into either engine fork.

> android/src/main/rnllama/CMakeLists.txt:109:             # The Android host build consumes generated QAIC artifacts copied by

> android/src/main/rnllama/CMakeLists.txt:116:             if (NOT EXISTS ${HEXAGON_HOST_STUB} OR NOT EXISTS ${HEXAGON_HOST_HEADER})

> android/src/main/rnllama/CMakeLists.txt:118:                     "Hexagon host QAIC artifacts are missing. "

> android/src/main/rnllama/CMakeLists.txt:123:                 ${HEXAGON_HOST_STUB}

> vendor/llama.cpp/ggml/src/ggml-hexagon/CMakeLists.txt:28: add_library(htp_iface OBJECT

> vendor/llama.cpp/ggml/src/ggml-hexagon/CMakeLists.txt:29:     ${CMAKE_CURRENT_BINARY_DIR}/htp_iface_stub.c)

> vendor/llama.cpp/ggml/src/ggml-hexagon/CMakeLists.txt:39: build_idl(htp/htp_iface.idl htp_iface)

> vendor/llama.cpp/ggml/src/ggml-hexagon/htp/CMakeLists.txt:54: build_idl(htp_iface.idl ${HTP_LIB})

> scripts/build-hexagon-htp.sh:187: cp build-hexagon-htp/v73/htp_iface_stub.c "${HTP_SOURCE_DIR}/v73/htp_iface_stub.c"

> scripts/build-hexagon-htp.sh:188: cp build-hexagon-htp/v73/htp_iface.h "${HTP_SOURCE_DIR}/v73/htp_iface.h"

> android/src/main/rnllama/CMakeLists.txt:139:             # libcdsprpc.so contains all needed symbols: remote_handle64_*, dspqueue_*, rpcmem_*

I inspected the tracked paths at the requested binding commit and in the two engine trees; the only tracked binding-side input under that HTP interface path is `htp/htp_iface.idl`. The QAIC generated outputs are artifacts, not source already available to this build.

## 3. Is the documented `.hexagon-sdk` trap about host or skels, and does it hold at c0bbbd35?

**Verdict: CONFIRMED.** The trap is specifically the **host backend configure/build path**. A present SDK root/tools directory makes Gradle pass SDK arguments; when `ENABLE_HEXAGON` is true and `libcdsprpc.so` exists, CMake adds host code and immediately fails if the generated `htp/v73/htp_iface_stub.c` or `.h` is absent. The skels are a separate build/package concern and are already present as assets in the APKs inspected by the lab. The trap still applies at the requested pin. Pointing the environment variables to nonexistent directories suppresses the gate but yields CPU-only native code.

> docs/DESIGN.md:495: `~/.hexagon-sdk` present makes `llama.rn` auto-enable a DSP build that fails for missing QAIC artifacts.

> android/src/main/rnllama/CMakeLists.txt:116:             if (NOT EXISTS ${HEXAGON_HOST_STUB} OR NOT EXISTS ${HEXAGON_HOST_HEADER})

> android/src/main/rnllama/CMakeLists.txt:118:                     "Hexagon host QAIC artifacts are missing. "

> android/src/main/rnllama/CMakeLists.txt:157:                     "Hexagon SDK not found. Hexagon backend will not be built.")

> docs/DEVICE-CAPTURE-2026-09-22.md:39: 2. **With `=true`, the Hexagon branch fires and the configure dies.** `build.gradle:143-168` enables

> docs/DEVICE-CAPTURE-2026-09-22.md:41:    `Hexagon host QAIC artifacts are missing ... htp/v73/htp_iface_stub.c`

> docs/DEVICE-CAPTURE-2026-09-22.md:45:    `HEXAGON_SDK_ROOT=/nonexistent-hexagon-sdk HEXAGON_TOOLS_ROOT=/nonexistent-hexagon-tools`.

> docs/DEVICE-CAPTURE-2026-09-22.md:46:    That yields the CPU-only engine — which is the variant this device uses anyway.

## 4. Binding skill, CI recipe, and SDK availability/licensing

**Verdict: CONFIRMED (skill intent and public CI recipe); UNKNOWN (SDK redistribution permission).** The skill intends to build the SDK-enabled variant and validate runtime logs, but its APK filename/asset check is insufficient: the `_hexagon_opencl` target name is still produced when the Hexagon CMake gate is off, and the skel assets can be packaged independently of the host code. It therefore mistakes a variant name plus DSP assets for proof that the host backend was compiled. The meaningful runtime checks it lists (`libcdsprpc.so loaded`, an HTP device) are stronger, but would need to be run in the app APK.

> .agents/skills/device-test/SKILL.md:117: Gradle auto-detects the SDK: the build log prints

> .agents/skills/device-test/SKILL.md:119: Prebuilt HTP DSP libs in `bin/arm64-v8a/libggml-htp-v{69,73,75,79,81}.so` are

> .agents/skills/device-test/SKILL.md:120: synced into APK assets by the `prepareHTP` gradle task; when the SDK+Docker are

> .agents/skills/device-test/SKILL.md:134: # expect: lib/arm64-v8a/librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so (+ _jni_)

> .agents/skills/device-test/SKILL.md:135: #         assets/ggml-hexagon/libggml-htp-v{69,73,75,79,81}.so

> .agents/skills/device-test/SKILL.md:138: If these are missing the build silently fell back to CPU-only - fix the SDK /

> .agents/skills/device-test/SKILL.md:156: Healthy signs: `nativeloader` loading `librnllama_jni_..._hexagon_opencl.so`,

> .agents/skills/device-test/SKILL.md:157: `fastrpc_apps_user_init done` with a DSP domain, `libcdsprpc.so loaded`, and

> android/src/main/rnllama/CMakeLists.txt:157:                     "Hexagon SDK not found. Hexagon backend will not be built.")

> android/src/main/rnllama/CMakeLists.txt:34:     set(ENABLE_OPENCL OFF)

> android/src/main/rnllama/CMakeLists.txt:35:     if (${target_name} MATCHES ".*_opencl$")

> android/src/main/rnllama/CMakeLists.txt:39:     set(ENABLE_HEXAGON OFF)

> android/src/main/rnllama/CMakeLists.txt:40:     if (${target_name} MATCHES ".*_hexagon.*")

> android/src/main/rnllama/CMakeLists.txt:41:         set(ENABLE_HEXAGON ON)

At the binding pin, upstream `mybigday/llama.rn` CI does install the SDK: its shared setup action runs `npm run bootstrap`, and `scripts/bootstrap.sh` downloads the 6.4.0.2 SDK from a public `snapdragon-toolchain/hexagon-sdk` GitHub release into `~/.hexagon-sdk`. The Android job then exports that SDK/tools location and selects the Hexagon variant. This demonstrates a no-Qualcomm-login download path. However, the Android-from-source workflow's SDK variables alone do not guarantee the two host QAIC outputs are present; the host CMake still fails if its cache/artifact preparation has not populated `htp/v73/`.

> .github/workflows/ci.yml:199:       - name: Build example for Android

> .github/workflows/ci.yml:201:           HEXAGON_SDK_VERSION: 6.4.0.2

> .github/workflows/ci.yml:207:           ORG_GRADLE_PROJECT_rnllamaVariants: rnllama,rnllama_v8_2_dotprod_i8mm_hexagon_opencl,rnllama_x86_64

> .github/workflows/ci.yml:210:           export HEXAGON_SDK_ROOT="$HOME/.hexagon-sdk/$HEXAGON_SDK_VERSION"

> .github/workflows/ci.yml:211:           export HEXAGON_TOOLS_ROOT="$HEXAGON_SDK_ROOT/tools/HEXAGON_Tools/$HEXAGON_TOOLS_VERSION"

> .github/actions/setup/action.yml:30:     # `npm run bootstrap` downloads the Hexagon SDK into ~/.hexagon-sdk and

> .github/actions/setup/action.yml:35:     # running it here would have corrupted the checkout. That rewrite is gone,

> .github/actions/setup/action.yml:36:     # so it belongs here again.

> .github/actions/setup/action.yml:43:     - name: Bootstrap & Build

> .github/actions/setup/action.yml:44:       run: npm run bootstrap && npm run build

> scripts/bootstrap.sh:63: if [ ! -d "$HEXAGON_INSTALL_DIR/$HEXAGON_SDK_VERSION" ]; then

> scripts/bootstrap.sh:75:   curl -L -o hex-sdk.tar.gz \

> scripts/bootstrap.sh:76:     "https://github.com/snapdragon-toolchain/hexagon-sdk/releases/download/v${HEXAGON_SDK_VERSION}/hexagon-sdk-v${HEXAGON_SDK_VERSION}-amd64-lnx.tar.xz"

Current online `ggml-org/llama.cpp` CI demonstrates the container pattern: it runs the Snapdragon Android build in `ghcr.io/snapdragon-toolchain/arm64-android:v0.7`, then configures, builds, and installs. The toolchain docs describe the image as bundling the Android NDK, OpenCL SDK, Hexagon SDK, CMake, and cross compilers.

> https://raw.githubusercontent.com/ggml-org/llama.cpp/master/.github/workflows/build-and-test-snapdragon.yml:29:   android-ndk-snapdragon:

> https://raw.githubusercontent.com/ggml-org/llama.cpp/master/.github/workflows/build-and-test-snapdragon.yml:32:       image: 'ghcr.io/snapdragon-toolchain/arm64-android:v0.7'

> https://raw.githubusercontent.com/ggml-org/llama.cpp/master/.github/workflows/build-and-test-snapdragon.yml:47:           cmake --preset arm64-android-snapdragon-release -B build

> https://raw.githubusercontent.com/ggml-org/llama.cpp/master/.github/workflows/build-and-test-snapdragon.yml:48:           cmake --build build

> https://raw.githubusercontent.com/ggml-org/llama.cpp/master/docs/backend/snapdragon/README.md:6: These Docker images include the Android NDK, OpenCL SDK, Hexagon SDK, CMake, and the necessary cross-compilers:

Qualcomm's official SDK page currently says login is required to download, and Qualcomm's access policy says registered resources require a Qualcomm ID and license-agreement acceptance. The `snapdragon-toolchain` GitHub org publicly describes its SDK repo as repackaged from Qualcomm Software Center; a public GHCR/GitHub distribution route exists, but that alone does **not** establish Qualcomm's redistribution license terms. Publicly fetchable without a login is not the same as legally redistributable; seek the license terms before mirroring SDK files or baking them into Kalsa artifacts.

> https://www.qualcomm.com/developer/software/hexagon-npu-sdk:22: Log in to download

> https://www.qualcomm.com/support/working-with-qualcomm:31: #### Registered

> https://www.qualcomm.com/support/working-with-qualcomm:33: Registered resources require a Qualcomm ID and acceptance of Qualcomm's license agreement.

> https://raw.githubusercontent.com/snapdragon-toolchain/hexagon-sdk/main/README.md:1: This repository contains Hexagon SDK Community Edition releases trimmed and repackaged for Github Actions and other CI and Dev Container environments.

## 5. Cheapest correct app CI fix and tradeoffs

**Verdict: PLAUSIBLE.** Lowest-work candidate: in `.github/workflows/apk.yml`, add a preparation step that checks out the exact binding pin, invokes the same `scripts/bootstrap.sh` SDK download route used by upstream CI, and generates only the host QAIC outputs from the pinned IDL. Stage `htp_iface_stub.c` and `htp_iface.h` in the installed binding's `vendor/llama.cpp/ggml/src/ggml-hexagon/htp/v73/`, then expose SDK root/tools root to Gradle/CMake before prebuild/build. Retain the current `bin/arm64-v8a/libggml-htp-*.so` assets; rebuilding four DSP skels is unnecessary. The app's installed npm package manifest excludes `scripts/`, so obtain the binding's pinned source separately or generate the QAIC files from the installed package IDL with an explicit workflow command. This avoids copying the whole SDK image or its duplicate Android NDK onto the runner. Public download access is evidenced; Qualcomm SDK redistribution rights remain UNKNOWN without reviewing the SDK agreement.

> .github/workflows/apk.yml:43:     runs-on: ubuntu-latest

> .github/workflows/apk.yml:57:       - name: Install JS deps

> .github/workflows/apk.yml:63:       - name: Assert the installed engine is the pinned fork commit

> .github/workflows/apk.yml:271:       - name: Prebuild (CNG)

> .github/workflows/apk.yml:339:       - name: Build APK (${{ inputs.abi }})

> .github/workflows/apk.yml:342:           ./gradlew assembleRelease -PreactNativeArchitectures="${{ inputs.abi }}" --console=plain

> package.json:10:   "files": [

> package.json:19:     "cpp",

> package.json:20:     "cmake",

> package.json:41:   ],

> package.json:55:     "build:android-libs": "./scripts/build-hexagon-htp.sh && ./scripts/build-opencl.sh && ./scripts/build-android.sh",

> android/src/main/rnllama/CMakeLists.txt:116:             if (NOT EXISTS ${HEXAGON_HOST_STUB} OR NOT EXISTS ${HEXAGON_HOST_HEADER})

> android/src/main/rnllama/CMakeLists.txt:127:                 ${HEXAGON_SDK_ROOT}/incs

> android/src/main/rnllama/CMakeLists.txt:141:             target_link_libraries(${target_name} PRIVATE ${CDSPRPC_LIB})

Option comparison (costs are estimates; no builds or image pulls were run here):

| Approach | Changes | CI minutes / size | Main risks |
|---|---|---|---|
| Build APK job in `ghcr.io/snapdragon-toolchain/arm64-android:v0.7` | `.github/workflows/apk.yml` job at line 43 gets a container image; adapt runner setup/cleanup for container constraints; add QAIC-only prep before prebuild/build | One full image pull on each fresh hosted job; expected several minutes of transfer/setup plus native build, exact image bytes/time not verified. APK adds no new skel copies; only host code/linkage delta, exact binary/APK delta unmeasured. | The v0.7 image path/version must be reconciled with binding's default 6.4.0.2 paths (the inspected HMX CMake cache uses `/opt/hexagon/6.6.0.0`). SDK redistribution/license terms are not established by public availability. Need QAIC prep: merely setting SDK env triggers the missing-artifact fatal error. |
| Copy SDK from image to hosted runner | Add export/copy step and set the SDK variables before the Gradle step in `apk.yml` | Copies a large SDK/toolchain tree each run unless cached; likely slower and larger than running in the existing toolchain environment; exact bytes/time UNKNOWN. | Same redistribution terms; path permissions/symlinks/tool version drift; still must generate and stage both QAIC files. |
| Download SDK archive | Add the same public-release download path used by the pinned binding bootstrap to `apk.yml`, then unpack and set paths | Download/unpack each run unless cached; archive size/time UNKNOWN; the runner's Android NDK is already installed. | Public GitHub release is fetched by the binding bootstrap without an auth step; official Qualcomm portal requires login/license acceptance, and redistribution rights for the repackaged archive remain unknown. QAIC outputs still need generation. |

For any path, add an APK assertion that checks backend evidence/symbols or strings such as `ggml-hex: Loading driver libcdsprpc.so`; checking the variant filename is not sufficient. This also resolves the misleading target-name risk: `rnllama_v8_2_dotprod_i8mm_hexagon_opencl` remains a target name even if CMake prints that the Hexagon backend was not built.

> .github/workflows/apk.yml:339:       - name: Build APK (${{ inputs.abi }})

> .github/workflows/apk.yml:342:           ./gradlew assembleRelease -PreactNativeArchitectures="${{ inputs.abi }}" --console=plain

> android/src/main/rnllama/CMakeLists.txt:157:                     "Hexagon SDK not found. Hexagon backend will not be built.")

> android/build.gradle:172:       println("✅ Hexagon SDK detected — enabling DSP build")

The recommendation follows the binding's own SDK download path and limits new work to a host QAIC artifact step. It is not a legal conclusion: before relying on the public release in CI, review the Qualcomm license agreement. Exact download size/time and generated host-library/APK delta are UNKNOWN; no archive/image pulls or builds were run. The container alternative is technically demonstrated by llama.cpp CI, but adds a complete image pull and requires adapting this workflow's Node/Java/Android setup.

## 6. Any past app APK with the Hexagon host backend?

**Verdict: UNKNOWN for the universal historical question; CONFIRMED that no retained app APK I scanned has host-backend markers.** The current CI APK is CPU-only for the host backend per the coordinator's supplied CI log and binary inspection. I also scanned every retained Kalsa app APK found in the lab (11 APK archives) by reading each `lib/arm64-v8a/librnllama*.so` entry and checking printable strings for `ggml-hex`, `hexagon backend`, `libcdsprpc`, `htp_iface`, and `hexagon arch`; every scanned entry had zero matches. This binary inspection has no source line numbers, so I record it as an archive-entry scan below. The earlier app APK record proves only that skel assets were packaged. App logs showing the `hexagon_opencl` JNI filename are not proof of host code.

> /tmp/m1/ci.log:3812: apk	Build APK (arm64-v8a)	2026-09-30T15:14:43.7262932Z 🚫 Hexagon SDK not found — building CPU-only

> /tmp/m1/ci.log:4587: apk	Build APK (arm64-v8a)	2026-09-30T15:17:31.6264999Z C/C++:   Hexagon SDK not found.  Hexagon backend will not be built.

> /tmp/m1/ci.log:5440: apk	Assert the native patch is in the binary	2026-09-30T15:58:56.8075510Z [assert] kalsa-native-patches present in android/app/build/intermediates/merged_native_libs/release/mergeReleaseNativeLibs/out/lib/arm64-v8a/librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so

> governor-npu-prefill/DESIGN.md:25: | packaging + env | **already in the APK**: `unzip -l …/aba67977-debuggable/…/app-release.apk` → `assets/ggml-hexagon/libggml-htp-v73.so` (653 416 B) + v75/v79/v81; binding `android/build.gradle:50,58`; `RNLlama.java:27-30` (v73–v81); `RNLlama.java:151-170` `resolveHtpDirectory` → `ensureHtpLibraries` → `Os.setenv("ADSP_LIBRARY_PATH")` + `GGML_HEXAGON_DEVICES=16` (`:165-166`) | done; **the failure paths only `Log.w` and disable Hexagon — see §3 degrade rule** |

> governor-htp-prefill-spike/REPORT.md:46: - Android Snapdragon toolchain v0.7, target `test-governor-v0-hybrid`: `DOCKER_EXIT=0`, `BUILD_EXIT=0` (`raw/build_android_final2.log`).

> governor-htp-prefill-spike/raw/handoff_commands.txt:11:   KALSA_PREFILL_DEVICE=HTP0 ./bin/test-governor-v0-handoff-long

> governor-htp-prefill-spike/REPORT.md:105: Each valid run used the same fixed English prompt for both backends, a fresh CPU-only reference, three prefill/commit/decode turns, 64 generated tokens per turn, then one rewind. Initial prompts were at least 1,000 tokens. KLD is `D_KL(CPU || governor)` at each decoded step. Divergence and KLD-maximum steps are zero-based.

> governor-htp-prefill-spike/REPORT.md:125: **Build and artifacts:** Android rebuild exit 0 (`raw/build_android_handoff_variance.log`); final binary SHA-256 `09fb336414d050929bc8ec33d395a89298ea9b72e8bbcc6e8bd63547a06102bc`; device copy matched. Model SHA-256 `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`. Each run exited 0; complete stdout/stderr and per-turn diagnostic timings are in `raw/handoff_p1_htp.log`, `raw/handoff_p1_opencl.log`, `raw/handoff_p2_htp.log`, `raw/handoff_p2_opencl.log`, `raw/handoff_p3_htp.log`, and `raw/handoff_p3_opencl.log`.

> qdc-8g2-npu-upstream-62/REPORT.md:3: Date: 2026-09-04 (owner full delegation). QDC job 798985 (`sa803054`), HDK8550 unit `300b45e6`

> qdc-8g2-npu-upstream-62/REPORT.md:5: (sha 1baee516…, built from upstream/master 64a155d24 = branch kalsa/upstream-snapshot-2026-09-04,

> qdc-8g2-npu-upstream-62/REPORT.md:20: Host side in all four: `ggml-hexagon.cpp:2734: ggml-hex: dspqueue_read failed: 0x0000002e`

> logs/hexagon-build4.log:274: [169/480] Linking CXX shared library bin\libggml-hexagon.so

> logs/hexagon-build4.log:412: -- Installing: C:/Users/gualt/Desktop/Kalsa/moe-experiments/build-android-hexagon/ggml/src/ggml-hexagon/libggml-htp-v73.so

> ~/Projects/kalsallama-onecopy-hmx/build-onecopy-hmx-fused-v73/CMakeCache.txt:467: GGML_HEXAGON:BOOL=ON

> ~/Projects/kalsallama-onecopy-hmx/build-onecopy-hmx-fused-v73/CMakeCache.txt:705: HEXAGON_SDK_ROOT:UNINITIALIZED=/opt/hexagon/6.6.0.0

> ~/Projects/kalsallama-onecopy-hmx/build-onecopy-hmx-fused-v73/build.ninja:3088:   COMMAND = cd /workspace/ggml/src/ggml-hexagon && /opt/hexagon/6.6.0.0/ipc/fastrpc/qaic//bin/qaic -mdll -o /workspace/build-onecopy-hmx-fused-v73/ggml/src/ggml-hexagon -I/opt/hexagon/6.6.0.0/incs/ -I/opt/hexagon/6.6.0.0/incs/stddef/ -I/opt/hexagon/6.6.0.0/ipc/fastrpc/rtld/ship/android_aarch64 -I/opt/hexagon/6.6.0.0/incs -I/opt/hexagon/6.6.0.0/incs/stddef -I/opt/hexagon/6.6.0.0/utils/examples -I/workspace/ggml/src/ggml-hexagon/htp -I/workspace/build-onecopy-hmx-fused-v73/ggml/src/ggml-hexagon htp/htp_iface.idl

The lab's successful HTP engine artifacts are non-app outputs: the upstream Windows Android cross-build log links `bin\libggml-hexagon.so` and installs `libggml-htp-v73.so`; the onecopy HMX build directory is configured with `GGML_HEXAGON=ON`, records `/opt/hexagon/6.6.0.0`, and contains QAIC-generated `htp_iface.h`/`htp_iface_stub.c` and `libggml-htp-v73.so`. The governor prefill spike record names a standalone test target built with the Android Snapdragon toolchain and its handoff command invokes `test-governor-v0-handoff-long`, not an app APK. A past SDK-enabled app configure attempt logged “enabling DSP build” but failed at the explicit QAIC check before an APK existed. Across all 11 retained APK archives scanned, none has host-backend markers. I cannot prove that no older, unretained APK ever had them; there is no verified past app APK with the host backend in the inspected evidence.

Read-only APK scan results (ZIP members are binary files and have no source line numbers):

- `scratchpad/agents/g1-model-select/device/jelly/.base.apk!/lib/arm64-v8a/*.so`: 0 marker matches in 14 inspected llama/hexagon libraries.
- `scratchpad/agents/g1-model-select/device/s23/.base.apk!/lib/arm64-v8a/*.so`: 0 marker matches in 14 inspected llama/hexagon libraries.
- `scratchpad/agents/governor-nofit/raw/ci-apk/android/app/build/outputs/apk/release/app-release.apk!/lib/arm64-v8a/*.so`: 0 marker matches in 14 inspected llama/hexagon libraries.
- `scratchpad/agents/qdc-8elite-newapk/raw/host-materials/app-release.apk!/lib/arm64-v8a/*.so`: 0 marker matches in 14 inspected llama/hexagon libraries.
- `scratchpad/agents/qdc-heat-per-backend/raw/s23-20260926/preflight/installed-base.apk!/lib/arm64-v8a/*.so`: 0 marker matches in 14 inspected llama/hexagon libraries.
- `scratchpad/agents/s23-single-apk/raw/apk-from-uploaded-artifact.apk!/lib/arm64-v8a/*.so`: 0 marker matches in 14 inspected llama/hexagon libraries.
- `scratchpad/agents/s23-single-apk/raw/ci-download/kalsa-apk-arm64-v8a-debuggable-67ade7a88e2fc1887b05e355d9c1ee648e0a3878/app-release.apk!/lib/arm64-v8a/*.so`: 0 marker matches in 14 inspected llama/hexagon libraries.
- `scratchpad/agents/s23-single-apk/raw/device-base.apk!/lib/arm64-v8a/*.so`: 0 marker matches in 14 inspected llama/hexagon libraries.
- `scratchpad/agents/xiaomi-governor-night/raw/ci-35961215542/kalsa-apk-arm64-v8a-debuggable-57eca6077bf4b850b0ad4484ab870f29a29a4184/app-release.apk!/lib/arm64-v8a/*.so`: 0 marker matches in 14 inspected llama/hexagon libraries.
- `scratchpad/agents/xiaomi-governor-night/raw/materials/app-release.apk!/lib/arm64-v8a/*.so`: 0 marker matches in 14 inspected llama/hexagon libraries.
- `scratchpad/agents/xiaomi-governor-night/raw/materials/installed-base.apk!/lib/arm64-v8a/*.so`: 0 marker matches in 14 inspected llama/hexagon libraries.

> q66-app-lifecycle-s23/PHASE3_STATUS.md:72: ✅ Hexagon SDK detected — enabling DSP build

> q66-app-lifecycle-s23/PHASE3_STATUS.md:76: C/C++:   Hexagon host QAIC artifacts are missing.  Run scripts/build-hexagon-htp.sh

> q66-app-lifecycle-s23/PHASE3_STATUS.md:85: the configured fork therefore enabled the optional DSP path before compiling

> q66-app-lifecycle-s23/PHASE3_STATUS.md:87: or packaged marker result for this attempt.

## Recommendation

Use the binding's existing public SDK bootstrap download path in `.github/workflows/apk.yml`, checking out the exact binding pin because its npm package omits `scripts/`. Generate only QAIC host outputs from the pinned IDL, stage `htp_iface_stub.c` and `htp_iface.h` under the installed binding's `vendor/llama.cpp/ggml/src/ggml-hexagon/htp/v73/`, and expose SDK/tool paths before Gradle/CMake configure. Keep the existing `bin/arm64-v8a/libggml-htp-v*.so` skels. Add a post-package host-backend assertion using backend symbols/strings, not the `_hexagon_opencl` filename. Review the Qualcomm license terms before depending on the repackaged SDK release.
