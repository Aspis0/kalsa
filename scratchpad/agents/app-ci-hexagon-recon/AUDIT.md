# Hostile audit: Kalsa Android Hexagon host backend

Verdict: FIX FIRST. The app workflow is pinned to binding parent c0bbbd35, not 0c694e72; the installed binding rejects lane-on loads. The CI also executes an unverified external SDK toolchain with checkout credentials persisted.

Scope: app commit bc0f701c and binding commit 0c694e72, static review only. No build, tests, commits, or device use. The 10/10 host-test result is coordinator-reported, not rerun.

## 1. Security / secrets

### F1 — CONFIRMED, high: SDK artifact has no integrity pin and is executed

The script downloads and unpacks the public release, then runs QAIC from it. No checksum or signature verification is present. A replaced/compromised asset can execute arbitrary code in the runner.

> /Users/marco/Projects/kalsa/scripts/prepare-hexagon-host.sh:57:   URL="https://github.com/snapdragon-toolchain/hexagon-sdk/releases/download/v${SDK_VERSION}/hexagon-sdk-v${SDK_VERSION}-amd64-lnx.tar.xz"
> /Users/marco/Projects/kalsa/scripts/prepare-hexagon-host.sh:60:   curl --fail --location --show-error --silent -o "$TMP/hexagon-sdk.tar.xz" "$URL"
> /Users/marco/Projects/kalsa/scripts/prepare-hexagon-host.sh:62:   tar -xJf "$TMP/hexagon-sdk.tar.xz" -C "$INSTALL_DIR"
> /Users/marco/Projects/kalsa/scripts/prepare-hexagon-host.sh:77: "$QAIC" -mdll -o "$GEN" \

A cache hit is accepted based on directory existence and also skips any download-time verification. A new digest check must cover restored caches too.

> /Users/marco/Projects/kalsa/scripts/prepare-hexagon-host.sh:52: if [ -d "$SDK_ROOT" ] && [ -d "$TOOLS_ROOT" ]; then
> /Users/marco/Projects/kalsa/scripts/prepare-hexagon-host.sh:65: test -d "$SDK_ROOT" || fail "$SDK_ROOT missing after download/restore"

A fresh cache miss fails if the release is unavailable. If the asset changes at the same URL, the script accepts it. The cache key covers the SDK version only, not tools version or digest.

> /Users/marco/Projects/kalsa/scripts/prepare-hexagon-host.sh:21: set -euo pipefail
> /Users/marco/Projects/kalsa/.github/workflows/apk.yml:192:           key: hexagon-sdk-${{ env.HEXAGON_SDK_VERSION }}

### F2 — CONFIRMED, high conditional impact: compromised QAIC can access checkout token

The workflow uses actions/checkout@v4 without disabling credential persistence; later it runs QAIC in the same workspace. The v4 action defaults to storing github.token in Git config for scripts. A compromised SDK can read/use it. Actual token scope depends on repository Actions settings.

> /Users/marco/Projects/kalsa/.github/workflows/apk.yml:56:       - uses: actions/checkout@v4
> /Users/marco/Projects/kalsa/.github/workflows/apk.yml:195:         run: bash scripts/prepare-hexagon-host.sh
> https://github.com/actions/checkout/blob/v4/action.yml:459: default: ${{ github.token }}
> https://github.com/actions/checkout/blob/v4/action.yml:509: default: true
> https://github.com/actions/checkout/blob/v4/action.yml:450: Personal access token (PAT) used to fetch the repository. The PAT is configured
> https://github.com/actions/checkout/blob/v4/action.yml:451: with the local git config, which enables your scripts to run authenticated git

Pin and verify the exact SDK archive, verify cached contents, and disable checkout credential persistence if no later step needs authenticated Git.

### Direct secret printing — REFUTED for changed workflow/scripts

No secret interpolation was found in the changed files. The added script logs the public URL; the workflow exports SDK paths only. This does not reduce F2.

> /Users/marco/Projects/kalsa/scripts/prepare-hexagon-host.sh:59:   echo "Downloading $URL"
> /Users/marco/Projects/kalsa/.github/workflows/apk.yml:199:           echo "HEXAGON_SDK_ROOT=$HOME/.hexagon-sdk/$HEXAGON_SDK_VERSION" >> "$GITHUB_ENV"
> /Users/marco/Projects/kalsa/.github/workflows/apk.yml:200:           echo "HEXAGON_TOOLS_ROOT=$HOME/.hexagon-sdk/$HEXAGON_SDK_VERSION/tools/HEXAGON_Tools/$HEXAGON_TOOLS_VERSION" >> "$GITHUB_ENV"

## 2. Privacy

No new direct model-data telemetry or upload was found — REFUTED as a finding. The build script feeds QAIC the installed engine IDL; the runtime URI names a local DSP library. A malicious QAIC remains the F1 exception.

> /Users/marco/Projects/kalsa/scripts/prepare-hexagon-host.sh:30: IDL="$HTP_DIR/htp_iface.idl"
> /Users/marco/Projects/kalsa/scripts/prepare-hexagon-host.sh:86:   "$IDL"
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:3752:         snprintf(htp_uri, sizeof(htp_uri), "file:///libggml-htp-v%u.so?htp_iface_skel_handle_invoke&_modver=1.0", opt_arch);

## 3. Bugs

### F3 — CONFIRMED, blocker: app does not install binding commit 0c694e72

Both app manifests pin c0bbbd3545ba90acaf937dc2b9e898ae6b8dd54d. CI runs npm ci and checks the installed engine against that pin, so the new loader filtering and GGML_HEXAGON_DEVICES=1 change are not in this APK.

> /Users/marco/Projects/kalsa/package.json:52:     "llama.rn": "github:Aspis0/kalsa.rn#c0bbbd3545ba90acaf937dc2b9e898ae6b8dd54d",
> /Users/marco/Projects/kalsa/package-lock.json:44:         "llama.rn": "github:Aspis0/kalsa.rn#c0bbbd3545ba90acaf937dc2b9e898ae6b8dd54d",
> /Users/marco/Projects/kalsa/.github/workflows/apk.yml:68:         run: npm ci
> /Users/marco/Projects/kalsa/.github/workflows/apk.yml:74:         run: bash scripts/assert-engine-provenance.sh

The app can set npu_lane_enabled true; the package currently installed from the pinned parent throws for it. Lane-on therefore fails before model load.

> /Users/marco/Projects/kalsa/src/engine/governorInputs.ts:281:     npu_lane_enabled: laneEnabled,
> /Users/marco/Projects/kalsa/node_modules/llama.rn/cpp/rn-governor-params.cpp:135:     params.npu_lane_enabled = bool_or(governor, "npu_lane_enabled", false);
> /Users/marco/Projects/kalsa/node_modules/llama.rn/cpp/rn-governor-params.cpp:150:     if (params.npu_lane_enabled) {
> /Users/marco/Projects/kalsa/node_modules/llama.rn/cpp/rn-governor-params.cpp:151:         throw std::invalid_argument("Governor NPU lane is not supported");

### F4 — CONFIRMED: QAIC command only approximates engine build_idl

It uses the same IDL and -mdll and includes the same SDK, examples, HTP, and output include roots, but adds the Android FastRPC rtld include and spells SDK incs/stddef twice. The engine helper also appends target includes after its default SDK includes. QAIC writes to a temporary directory and the script copies the pair into htp/v73; the engine helper writes directly to CMAKE_CURRENT_BINARY_DIR. No failure is proven, but the commands are not identical and were not build-verified.

> /Users/marco/Projects/kalsa/scripts/prepare-hexagon-host.sh:77: "$QAIC" -mdll -o "$GEN" \
> /Users/marco/Projects/kalsa/scripts/prepare-hexagon-host.sh:78:   -I"$SDK_ROOT/incs/" \
> /Users/marco/Projects/kalsa/scripts/prepare-hexagon-host.sh:79:   -I"$SDK_ROOT/incs/stddef/" \
> /Users/marco/Projects/kalsa/scripts/prepare-hexagon-host.sh:80:   -I"$SDK_ROOT/ipc/fastrpc/rtld/ship/android_aarch64" \
> /Users/marco/Projects/kalsa/scripts/prepare-hexagon-host.sh:81:   -I"$SDK_ROOT/incs" \
> /Users/marco/Projects/kalsa/scripts/prepare-hexagon-host.sh:82:   -I"$SDK_ROOT/incs/stddef" \
> /Users/marco/Projects/kalsa/scripts/prepare-hexagon-host.sh:83:   -I"$SDK_ROOT/utils/examples" \
> /Users/marco/Projects/kalsa/scripts/prepare-hexagon-host.sh:84:   -I"$HTP_DIR" \
> /Users/marco/Projects/kalsa/scripts/prepare-hexagon-host.sh:85:   -I"$GEN" \
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/CMakeLists.txt:32: target_include_directories(htp_iface PUBLIC
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/CMakeLists.txt:33:     ${HEXAGON_SDK_ROOT}/incs
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/CMakeLists.txt:34:     ${HEXAGON_SDK_ROOT}/incs/stddef
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/CMakeLists.txt:35:     ${HEXAGON_SDK_ROOT}/utils/examples
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/CMakeLists.txt:36:     ${CMAKE_CURRENT_SOURCE_DIR}/htp
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/CMakeLists.txt:37:     ${CMAKE_CURRENT_BINARY_DIR})
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/CMakeLists.txt:39: build_idl(htp/htp_iface.idl htp_iface)
> /Users/marco/.hexagon-sdk/6.4.0.2/build/cmake/hexagon_fun.cmake:262:     set(QIDLINC "")
> /Users/marco/.hexagon-sdk/6.4.0.2/build/cmake/hexagon_fun.cmake:264:         ${HEXAGON_SDK_ROOT}/incs/
> /Users/marco/.hexagon-sdk/6.4.0.2/build/cmake/hexagon_fun.cmake:265:         ${HEXAGON_SDK_ROOT}/incs/stddef/
> /Users/marco/.hexagon-sdk/6.4.0.2/build/cmake/hexagon_fun.cmake:267:     foreach(path ${defaultIncs})
> /Users/marco/.hexagon-sdk/6.4.0.2/build/cmake/hexagon_fun.cmake:271:     get_target_property(dirs ${currentTarget} INCLUDE_DIRECTORIES)
> /Users/marco/.hexagon-sdk/6.4.0.2/build/cmake/hexagon_fun.cmake:272:     foreach(path ${dirs})
> /Users/marco/.hexagon-sdk/6.4.0.2/build/cmake/hexagon_fun.cmake:277:     set(cmdLineOptions -mdll -o ${CMAKE_CURRENT_BINARY_DIR} ${QIDLINC} ${idlFile})

### F5 — CONFIRMED: APK assertion is link-presence evidence, not runtime proof

The assertion checks two marker strings in the named engine DSO and a cdsprpc dynamic dependency. Those are useful compiled-link markers, and their literals are in the Hexagon backend/driver sources. It does not prove the HTP registry can open a compatible skel, or that runtime dispatch uses HTP0. An unrelated linked object containing the same literals could also satisfy the grep.

> /Users/marco/Projects/kalsa/scripts/assert-hexagon-backend.sh:24: LIB_ENTRY="lib/arm64-v8a/librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so"
> /Users/marco/Projects/kalsa/scripts/assert-hexagon-backend.sh:28:   "ggml-hex: Hexagon backend (experimental)"
> /Users/marco/Projects/kalsa/scripts/assert-hexagon-backend.sh:29:   "ggml-hex: Loading driver"
> /Users/marco/Projects/kalsa/scripts/assert-hexagon-backend.sh:49:   if grep -aqF -- "$MARKER" "$OUT/host.so"; then
> /Users/marco/Projects/kalsa/scripts/assert-hexagon-backend.sh:62: if grep -q cdsprpc "$OUT/dynamic.txt"; then
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/android/src/main/rnllama/CMakeLists.txt:104:             target_sources(${target_name} PRIVATE
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/android/src/main/rnllama/CMakeLists.txt:105:                 ${RNLLAMA_GGML_HEXAGON_DIR}/ggml-hexagon.cpp
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/android/src/main/rnllama/CMakeLists.txt:106:                 ${RNLLAMA_GGML_HEXAGON_DIR}/htp-drv.cpp
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:6848:     GGML_LOG_INFO("ggml-hex: Hexagon backend (experimental) : allocating new registry : ndev %zu\n", opt_ndev);
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/htp-drv.cpp:343:     GGML_LOG_INFO("ggml-hex: Loading driver %s\n", drv_path.c_str());

x86_64 stays on the prior CPU-only path: prepare/export/assert are gated by arm64-v8a. The cache key includes SDK version but not tools version/digest.

> /Users/marco/Projects/kalsa/.github/workflows/apk.yml:188:         if: contains(inputs.abi, 'arm64-v8a')
> /Users/marco/Projects/kalsa/.github/workflows/apk.yml:194:         if: contains(inputs.abi, 'arm64-v8a')
> /Users/marco/Projects/kalsa/.github/workflows/apk.yml:197:         if: contains(inputs.abi, 'arm64-v8a')
> /Users/marco/Projects/kalsa/.github/workflows/apk.yml:53:       HEXAGON_SDK_VERSION: "6.4.0.2"
> /Users/marco/Projects/kalsa/.github/workflows/apk.yml:54:       HEXAGON_TOOLS_VERSION: "19.0.04"
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/scripts/bootstrap.sh:59: HEXAGON_SDK_VERSION="6.4.0.2"
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/scripts/bootstrap.sh:60: HEXAGON_TOOLS_VERSION="19.0.04"

No first-run path/permission failure is proven. npm install precedes preparation; the script validates the IDL, SDK, tools, libcdsprpc and executable QAIC, and is invoked through bash. Disk headroom remains PLAUSIBLE: the archive stays in TMP while expanded, and the only df runs before download. No build was run.

> /Users/marco/Projects/kalsa/.github/workflows/apk.yml:68:         run: npm ci
> /Users/marco/Projects/kalsa/.github/workflows/apk.yml:171:           df -h /
> /Users/marco/Projects/kalsa/scripts/prepare-hexagon-host.sh:50: test -f "$IDL" || fail "$IDL not found — is llama.rn installed and provenance-asserted?"
> /Users/marco/Projects/kalsa/scripts/prepare-hexagon-host.sh:67: test -f "$CDSPRPC" || fail "$CDSPRPC missing (rnllama CMakeLists.txt requires it verbatim)"
> /Users/marco/Projects/kalsa/scripts/prepare-hexagon-host.sh:70: test -x "$QAIC" || fail "qaic not found or not executable at $QAIC"
> /Users/marco/Projects/kalsa/scripts/prepare-hexagon-host.sh:92: cp "$GEN/htp_iface_stub.c" "$GEN/htp_iface.h" "$STAGE_DIR/"

## 4. Races

No new race is confirmed — REFUTED as a finding. Backend initialization uses call_once, Java native loading is synchronized, and Hexagon registration holds a mutex for one-time initialization.

> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/jsi/RNLlamaJSI.cpp:96: static std::once_flag backend_init_once;
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/jsi/RNLlamaJSI.cpp:249:         std::call_once(backend_init_once, []() {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/android/src/main/java/com/rnllama/RNLlama.java:192:   public static synchronized boolean loadNative(ReactApplicationContext context) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:7507:         static std::mutex           mutex;
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:7508:         std::lock_guard<std::mutex> lock(mutex);

## 5. Leaks

No failure-path leak confirmed. The eager successful session is retained in a unique_ptr until registry teardown; failed construction calls release and the registry drops failed device contexts. This is process-lifetime retention and startup cost, not a per-load leak.

> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:515:     ggml_hexagon_session * session() {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:517:             sess = std::make_unique<ggml_hexagon_session>(config, dev);
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:6875:     for (size_t i = 0; i < opt_ndev; i++) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:6878:             dev_ctx->session();
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:3968:     } catch (const std::exception & exc) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:3969:         release();
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:3970:         throw;
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:6898:         delete dev_ctx;

## 6. Edge cases

### F6 — CONFIRMED: actual pinned lane-off governor can send prefill to HTP

The default JSI enumerator excludes HTP, but only assigns cparams.devices if the filtered list is nonempty. When no non-HTP GPU exists but HTP does, the list stays empty. The JSI accelerator check then counts HTP as a GPU and lets governor load through. In the pinned parent, lane-off loading does not add the new native exclusion; llama.cpp's implicit default sweep includes HTP. Governor prefill asks for 99 GPU layers, so HTP can receive them while the lane is off.

> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/jsi/RNLlamaJSI.cpp:118:         if (shouldExcludeHexagonDevice(dev)) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/jsi/RNLlamaJSI.cpp:153:     if (devices.empty()) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/jsi/RNLlamaJSI.cpp:157:     if (!devices.empty()) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/jsi/RNLlamaJSI.cpp:158:         devices.push_back(nullptr);
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/jsi/RNLlamaJSI.cpp:503:             if (isGpuDeviceType(rnllama::backend_dev_type(dev))) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/jsi/RNLlamaJSI.cpp:545:             anyGpuAvailable = hasGpuBackendDevice();
> /Users/marco/Projects/kalsa/node_modules/llama.rn/cpp/rn-llama.cpp:74:     common_params prefill_params = owner.params;
> /Users/marco/Projects/kalsa/node_modules/llama.rn/cpp/rn-llama.cpp:76:     prefill_params.n_gpu_layers = 99;
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/src/llama.cpp:185:     } else {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/src/llama.cpp:230:                     case GGML_BACKEND_DEVICE_TYPE_GPU: {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/src/llama-model.cpp:1524:     const int act_gpu_layers = devices.empty() ? 0 : std::min(n_gpu_layers, n_layer_all + 1);

### F7 — CONFIRMED: an explicitly supplied HTP device bypasses the default filter

The JSI filter is only used for automatic defaults. The explicit devices path matches names and pushes matching GPU devices without excluding HTP. The new lane-off loader preserves nonempty owner.params.devices. A caller that supplies HTP0 with lane off can therefore offload prefill to HTP. LlamaService currently supplies no devices property, but JSI can populate owner.params.devices automatically with its filtered OpenCL list; so nonempty owner.params.devices is a real app path too.

> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/jsi/RNLlamaJSI.cpp:465:             if (!requestedDevices.empty()) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/jsi/RNLlamaJSI.cpp:468:                 auto it = std::find(requestedDevices.begin(), requestedDevices.end(), nameStr);
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/jsi/RNLlamaJSI.cpp:482:             selected.push_back(dev);
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/jsi/RNLlamaJSI.cpp:520:         if (devicesProvided) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/jsi/RNLlamaJSI.cpp:523:                 cparams.devices = overrideDevices;
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/jsi/RNLlamaJSI.cpp:529:             auto defaultDevices = getFilteredDefaultDevices();
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/jsi/RNLlamaJSI.cpp:531:                 cparams.devices = defaultDevices;
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/rn-llama.cpp:116:     } else if (owner.params.devices.empty()) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/rn-llama.cpp:122:         // as today. A non-empty owner list is kept as-is: the JSI filter
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/rn-llama.cpp:124:         prefill_params.devices = gpu_devices_excluding_hexagon();

### F8 — CONFIRMED caveat: [nullptr] is CPU-only for default split, but not “exactly as today”

The binding's new lane-off fallback stores one null terminator, so common conversion passes a non-null devices pointer. llama.cpp then bypasses its default device sweep; with an empty resulting device vector, zero layers are active on GPU and weights use CPU. That is CPU-only in the app's default layer split. It is not behaviorally identical to the pinned parent in the no-OpenCL/HTP-only case, where the old implicit sweep could use HTP. Also, tensor split mode rejects an explicitly empty device list.

> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/rn-llama.cpp:124:         prefill_params.devices = gpu_devices_excluding_hexagon();
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/rn-llama.cpp:125:         prefill_params.devices.push_back(nullptr);
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/common/common.cpp:1698:     if (!params.devices.empty()) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/common/common.cpp:1699:         mparams.devices = params.devices.data();
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/src/llama.cpp:160:     if (params.devices) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/src/llama.cpp:166:             if (n_devs == 0) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/src/llama.cpp:167:                 LLAMA_LOG_ERROR("%s: LLAMA_SPLIT_MODE_TENSOR needs >= 1 devices\n", __func__);
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/src/llama-model.cpp:1524:     const int act_gpu_layers = devices.empty() ? 0 : std::min(n_gpu_layers, n_layer_all + 1);
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/src/llama-model.cpp:1527:         if (il < i_gpu_start || (il - i_gpu_start) >= act_gpu_layers) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/src/llama-model.cpp:1529:             return {cpu_dev, &pimpl->cpu_buft_list};
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/common/common.h:485:     enum llama_split_mode split_mode = LLAMA_SPLIT_MODE_LAYER; // how to split the model across GPUs

### F9 — PLAUSIBLE: host-stub / shipped-skel ABI provenance is not demonstrated

No tool-version mismatch is indicated: the CI and binding scripts pin SDK 6.4.0.2 / tools 19.0.04, and the DSP build script selects toolv19 prebuilt inputs for v73/v75/v79/v81. Both host and DSP CMake targets generate QAIC artifacts from the same checked-in htp_iface.idl. That is evidence against an IDL/tool mismatch. The shipped architecture skels are still prebuilt binaries with no per-file digest or embedded build manifest cited here, so exact ABI provenance cannot be proven from this checkout. No mismatch is confirmed; residual risk is PLAUSIBLE.

> /Users/marco/Projects/kalsa/.github/workflows/apk.yml:53:       HEXAGON_SDK_VERSION: "6.4.0.2"
> /Users/marco/Projects/kalsa/.github/workflows/apk.yml:54:       HEXAGON_TOOLS_VERSION: "19.0.04"
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/scripts/bootstrap.sh:59: HEXAGON_SDK_VERSION="6.4.0.2"
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/scripts/bootstrap.sh:60: HEXAGON_TOOLS_VERSION="19.0.04"
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/scripts/build-hexagon-htp.sh:113: PREBUILT_DIRS=("toolv19_v73" "toolv19_v75" "toolv19_v79" "toolv19_v81")
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/CMakeLists.txt:39: build_idl(htp/htp_iface.idl htp_iface)
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/htp/CMakeLists.txt:54: build_idl(htp_iface.idl ${HTP_LIB})
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/android/src/main/java/com/rnllama/RNLlama.java:27:     "libggml-htp-v73.so",
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/android/src/main/java/com/rnllama/RNLlama.java:28:     "libggml-htp-v75.so",
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/android/src/main/java/com/rnllama/RNLlama.java:29:     "libggml-htp-v79.so",
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/android/src/main/java/com/rnllama/RNLlama.java:30:     "libggml-htp-v81.so"

### F10 — CONFIRMED, medium: the compiled backend changes lane-off startup on Hexagon-selected devices

The first model load calls backend initialization, which registers Hexagon and eagerly opens a session for each configured device. The audited binding commit sets GGML_HEXAGON_DEVICES=1, but the app pin in F3 means the APK actually uses the parent value 16 and can attempt up to 16 sessions; updating the pin would reduce that count but retain at least one eager probe. Either path performs FastRPC startup regardless of governor/lane state, so a lane-off Snapdragon can incur the failure/hang risk below. This is limited to devices that select this JNI variant, not all users.

> /Users/marco/Projects/kalsa/node_modules/llama.rn/android/src/main/java/com/rnllama/RNLlama.java:166:       android.system.Os.setenv("GGML_HEXAGON_DEVICES", "16", true);
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/android/src/main/java/com/rnllama/RNLlama.java:181:       android.system.Os.setenv("GGML_HEXAGON_DEVICES", "1", true);
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/jsi/RNLlamaJSI.cpp:660:                     ensureBackendInitialized();
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/src/llama.cpp:133:         ggml_backend_load_all();
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:6875:     for (size_t i = 0; i < opt_ndev; i++) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:6878:             dev_ctx->session();

HTP initialization behavior:

- On non-Qualcomm devices, Java heuristics normally avoid the Hexagon JNI variant. If the variant is attempted but the Hexagon JNI DSO itself fails to load, Java catches UnsatisfiedLinkError and tries its fallback; separately, if libcdsprpc cannot dlopen during backend registration, driver init returns failure and the registry skips the null backend.
- With a compatible Qualcomm device and a missing exact-arch skel, FastRPC open throws; eager registry probing catches std::exception and truncates the available HTP device list to zero. This is a clean degrade if the RPC returns. No timeout is evident in this path, so a hang cannot be ruled out by this static review.
- The Hexagon backend registration/session probe occurs on first model load even with the governor switch off or lane off, because JSI calls llama_backend_init and the registry constructor probes sessions. It is limited to devices that select the Hexagon JNI variant, not every Android user.

> /Users/marco/Projects/llama.rn-kalsa-gov-platform/android/src/main/java/com/rnllama/RNLlama.java:219:         if (hasDotProd && hasI8mm && hasHexagon && hasAdreno) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/android/src/main/java/com/rnllama/RNLlama.java:220:           if (tryLoadLibrary("rnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl")) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/android/src/main/java/com/rnllama/RNLlama.java:324:       System.loadLibrary(libraryName);
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/android/src/main/java/com/rnllama/RNLlama.java:326:     } catch (UnsatisfiedLinkError ignored) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/android/src/main/java/com/rnllama/RNLlama.java:398:     return hasQualcommHint && hasHexagonCodenameHint();
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/jsi/RNLlamaJSI.cpp:660:                     ensureBackendInitialized();
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/src/llama.cpp:133:         ggml_backend_load_all();
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-backend-reg.cpp:153: #ifdef GGML_USE_HEXAGON
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-backend-reg.cpp:154:         register_backend(ggml_backend_hexagon_reg());
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:6875:     for (size_t i = 0; i < opt_ndev; i++) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:6878:             dev_ctx->session();
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:6886:             opt_ndev = i;
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-backend-reg.cpp:187:         if (!reg) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-backend-reg.cpp:188:             return;

## 7. Test hygiene

The coordinator reports the host suite passed 10/10. The added test exercises the registry-filter helper on fabricated devices; it does not exercise JSI configuration, the two-model loader, null-terminated empty-list conversion, vendor selection, or device RPC. The APK workflow runs JS harnesses and no governor_params_test command. Therefore the main integration and fallback bugs above are not covered by this CI gate.

> /Users/marco/Projects/llama.rn-kalsa-gov-platform/tests/governor_params_test.cpp:220: static bool test_devices_excluding_registry() {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/tests/governor_params_test.cpp:225:     const std::vector<ggml_backend_dev_t> mixed = {&opencl_dev, &htp0_dev, &htp1_dev, &cpu_dev};
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/tests/governor_params_test.cpp:241:     const auto only_htp = devices_excluding_registry({&htp0_dev}, &htp_reg);
> /Users/marco/Projects/kalsa/.github/workflows/apk.yml:94:       - name: Typecheck + logic harnesses
> /Users/marco/Projects/kalsa/.github/workflows/apk.yml:96:           npm run typecheck
> /Users/marco/Projects/kalsa/.github/workflows/apk.yml:97:           node scripts/retrieverHarness.mjs

## 8. Removed behaviour

CONFIRMED: GGML_HEXAGON_DEVICES numeric 16 configured sixteen virtual devices/session attempts; new binding commit sets 1, removing access to HTP1+ on Android architectures 75 and above. The engine already forces one on Android architectures below 75, so the change is a no-op there. HTP0-only matches this governor lane, but it is still a binding-visible capability reduction.

> /Users/marco/Projects/kalsa/node_modules/llama.rn/android/src/main/java/com/rnllama/RNLlama.java:166:       android.system.Os.setenv("GGML_HEXAGON_DEVICES", "16", true);
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/android/src/main/java/com/rnllama/RNLlama.java:181:       android.system.Os.setenv("GGML_HEXAGON_DEVICES", "1", true);
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:7297:             int n = atoi(str_devices);
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:7300:             opt_ndev = n;
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:7467:     if (opt_arch < 75) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:7468:         opt_ndev = 1;

## 9. Cross-file call paths

### App call chain and three requested modes

App governor input is built only when the feature is enabled. The lane preference defaults to off unless explicitly on/auto and eligible. The Android backend policy returns CPU-only, so app params start with n_gpu_layers=0; the governor path is separately attached only when governorLoad is eligible. LlamaService supplies no devices property.

> /Users/marco/Projects/kalsa/src/engine/LlamaService.ts:2280:     const governorFeatureEnabled = await readGovernorEnabled();
> /Users/marco/Projects/kalsa/src/engine/LlamaService.ts:2284:     const benchNpuLane = governorFeatureEnabled ? await readBenchNpuLane() : undefined;
> /Users/marco/Projects/kalsa/src/engine/governorInputs.ts:264:     : false; // default OFF: flips only after the device soak and the heat arm (DESIGN step 6)
> /Users/marco/Projects/kalsa/src/engine/LlamaService.ts:2469:       n_gpu_layers: nGpuLayersForBackend(tuning.backend),
> /Users/marco/Projects/kalsa/src/engine/LlamaService.ts:2476:       ...(governorLoad ? { governor: governorLoad } : {}),
> /Users/marco/Projects/kalsa/src/engine/deviceTuning.ts:397:   return { kind: "cpu-only", reason: "gpu-fit-gate-blind" };

At JSI, no app devices array means devicesProvided=false. On Android, configureBackendDevices automatically stores the filtered GPU list if it is nonempty. Thus owner.params.devices is nonempty in a real app run with an OpenCL GPU, despite no JS devices property. If the list is empty, it remains unspecified. loadModel copies those params into owner.params.

> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/jsi/RNLlamaJSI.cpp:622:                 if (auto it = params.find("devices"); it != params.end() && it->is_array() && !it->empty()) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/jsi/RNLlamaJSI.cpp:529:             auto defaultDevices = getFilteredDefaultDevices();
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/jsi/RNLlamaJSI.cpp:531:                 cparams.devices = defaultDevices;
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/rn-llama.cpp:831:     params = params_;

The binding then copies owner.params to prefill and decode. When lane-on resolves, it pins prefill to HTP0 and decode to CPU layers. When lane-off, 0c694e72 excludes HTP only if owner.params.devices is empty; otherwise it trusts the JSI-filtered list. The installed parent lacks this empty-list safeguard. Native common conversion passes explicit devices only when its vector is nonempty. llama.cpp treats a non-null device pointer as an explicit list, otherwise enumerates registered GPUs and iGPUs. With an explicit [nullptr], the device loop has zero devices and the layer assignment is CPU.

> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/rn-llama.cpp:99:     common_params prefill_params = owner.params;
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/rn-llama.cpp:101:     if (governor_params.npu_lane_enabled) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/rn-llama.cpp:113:             prefill_params.devices = { resolved.device, nullptr };
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/rn-llama.cpp:116:     } else if (owner.params.devices.empty()) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/rn-llama.cpp:124:         prefill_params.devices = gpu_devices_excluding_hexagon();
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/rn-llama.cpp:125:         prefill_params.devices.push_back(nullptr);
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/common/common.cpp:1699:         mparams.devices = params.devices.data();
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/src/llama.cpp:160:     if (params.devices) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/src/llama.cpp:181:             for (ggml_backend_dev_t * dev = params.devices; *dev; ++dev) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/src/llama.cpp:185:     } else {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/src/llama.cpp:230:                     case GGML_BACKEND_DEVICE_TYPE_GPU: {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/src/llama-model.cpp:1524:     const int act_gpu_layers = devices.empty() ? 0 : std::min(n_gpu_layers, n_layer_all + 1);

Mode table:

| Mode | App/JSI behavior | Native/vendor outcome |
|---|---|---|
| Governor on, lane off | App sends governor object with npu_lane_enabled=false; JSI's default list is populated when OpenCL is found, and that list excludes HTP. | With 0c694e72, the nonempty list is kept. If it is empty, native sends [nullptr], CPU prefill. In the actual app pin, the parent leaves it empty and llama.cpp default-enumerates HTP; HTP can get prefill layers. |
| Governor on, lane on | App can set npu_lane_enabled=true; JSI parent rejects it before load. | If 0c694e72 is actually installed, resolved HTP0 is explicit prefill; CPU decode. If the device plan refuses HTP, it leaves inherited devices unchanged. With an empty inherited list and stale Java fallback while HTP is still registered, implicit default enumeration can still select HTP despite the plan reporting fallback. |
| Governor switch off (ordinary default) | No governor property; Android n_gpu_layers=0. No JS devices list. | JSI may pass filtered OpenCL devices; if none, vendor implicit selection can enumerate HTP as a candidate, but n_gpu_layers=0 assigns no model layers there. Backend registration and eager session probing still change startup for the Hexagon JNI variant. |

The lane-on fallback inconsistency above is PLAUSIBLE/conditional: decide_governor_prefill_device returns use_device=false on a Java fallback reason, but load_governor_models does not install an explicit GPU-only/CPU-only list in that lane-on branch.

> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/rn-governor-params.cpp:180:     if (htp_init_reason != nullptr && *htp_init_reason != '\0') {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/rn-governor-params.cpp:182:         return plan;
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/rn-llama.cpp:112:         if (device_plan.use_device) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/rn-llama.cpp:113:             prefill_params.devices = { resolved.device, nullptr };

### Startup and non-Qualcomm degradation

JSI calls llama_backend_init on first load. That loads all compiled registries; the Hexagon registry calls htpdrv_init, which dlopens libcdsprpc.so. When that fails, Hexagon returns null and registry registration ignores null. When the library loads but FastRPC session open fails, the eager constructor catches the standard exception and truncates device count. This is a clean degrade if those calls return. Static source review cannot exclude a FastRPC hang; there is no visible timeout around the eager session probe.

> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/src/llama.cpp:133:         ggml_backend_load_all();
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-backend-reg.cpp:154:         register_backend(ggml_backend_hexagon_reg());
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-backend-reg.cpp:187:         if (!reg) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-backend-reg.cpp:188:             return;
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:7510:             auto nErr = htpdrv_init();
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:7512:                 return NULL;
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/htp-drv.cpp:346:     dl_handle_ptr handle { dl_load_library(path) };
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:6875:     for (size_t i = 0; i < opt_ndev; i++) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:6878:             dev_ctx->session();
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:6880:             GGML_LOG_WARN("ggml-hex: failed to create session for %s: %s; using %zu device(s)\n",
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:6886:             opt_ndev = i;
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:3774:     int err = htp_iface_open(session_uri, &this->handle);
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:3777:         throw std::runtime_error("ggml-hex: failed to open session (see log for details)");

Jelly Star (MediaTek) will not meet the Qualcomm hint. A Google Tensor Pixel ordinarily follows the same fallback; Qualcomm Pixel models are not categorically excluded, since the actual gate is the SoC/CPU/GPU heuristic. On Qualcomm without its exact skel, open failure should drop the HTP device if RPC returns. The assets name skels v73/v75/v79/v81 and the engine caps queried architecture above v81 to v81; a device with an unsupported intermediate arch has no matching asset. “Clean degrade” is conditional on RPC returning, not a guarantee against hangs/crashes.

> /Users/marco/Projects/llama.rn-kalsa-gov-platform/android/src/main/java/com/rnllama/RNLlama.java:27:     "libggml-htp-v73.so",
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/android/src/main/java/com/rnllama/RNLlama.java:28:     "libggml-htp-v75.so",
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/android/src/main/java/com/rnllama/RNLlama.java:29:     "libggml-htp-v79.so",
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/android/src/main/java/com/rnllama/RNLlama.java:30:     "libggml-htp-v81.so"
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:7244:             } else if (opt_arch > 81) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:7245:                 GGML_LOG_WARN("ggml-hex: Hexagon arch v%d is over supported range, capping at v81\n", opt_arch);
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:3752:         snprintf(htp_uri, sizeof(htp_uri), "file:///libggml-htp-v%u.so?htp_iface_skel_handle_invoke&_modver=1.0", opt_arch);

## 10. Reuse / simplify

There are two HTP filters with different rules: JSI automatic selection checks a name prefix; native lane-off fallback checks registry identity; explicit JSI overrides bypass the name filter entirely. Centralize selection or apply one registry-based exclusion to every Android device list.

> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/jsi/RNLlamaJSI.cpp:99: static bool shouldExcludeHexagonDevice(ggml_backend_dev_t dev) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/jsi/RNLlamaJSI.cpp:102:     if (dev_name != nullptr && strncmp(dev_name, "HTP", 3) == 0) {
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/rn-llama.cpp:86:     return devices_excluding_registry(gpus, ggml_backend_reg_by_name("HTP"));

The preparation script manually duplicates the build_idl include expansion. Prefer one generation rule or a shared helper so SDK/CMake include changes cannot drift.

> /Users/marco/Projects/kalsa/scripts/prepare-hexagon-host.sh:77: "$QAIC" -mdll -o "$GEN" \
> /Users/marco/Projects/kalsa/scripts/prepare-hexagon-host.sh:80:   -I"$SDK_ROOT/ipc/fastrpc/rtld/ship/android_aarch64" \
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/vendor/llama.cpp/ggml/src/ggml-hexagon/CMakeLists.txt:39: build_idl(htp/htp_iface.idl htp_iface)

## 11. Dead code

No newly added file or helper appears dead: the preparation/assertion scripts are called from the arm64 workflow, and the registry exclusion helper is used by the new loader and host test. The binding change is unreachable from this app only because F3's dependency pin omits its commit.

> /Users/marco/Projects/kalsa/.github/workflows/apk.yml:195:         run: bash scripts/prepare-hexagon-host.sh
> /Users/marco/Projects/kalsa/.github/workflows/apk.yml:396:         run: bash scripts/assert-hexagon-backend.sh
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/cpp/rn-llama.cpp:86:     return devices_excluding_registry(gpus, ggml_backend_reg_by_name("HTP"));
> /Users/marco/Projects/llama.rn-kalsa-gov-platform/tests/governor_params_test.cpp:227:     const auto without_htp = devices_excluding_registry(mixed, &htp_reg);

