# Hexagon dspqueue hang fix — hostile audit follow-up

Date: 2026-10-01. Repository: Aspis0/kalsallama, branch main.
No push and no device access. The existing untracked CMakeUserPresets.json was not staged or modified.

## Commits

The audit fixes are on top of test commits already present at f4bdd0f29:

- 7d953dab09f0e06a8e5d0fb3e360a70ab215f474 — kalsallama main f4bdd0f29: address Hexagon engine audit
- b00d48a060d3ba46c9e52c167ccacf737bd15024 — kalsallama main 7d953dab0: declare Hexagon proc APIs
- 3d159e864eac6691a4a64417edf73d2e71ce84e0 — kalsallama main b00d48a06: isolate Hexagon health probe
- 2202631196ebb9fc99a92256c81f4aaaec663f87 — kalsallama main 3d159e864: serialize Hexagon probes
- 643332f8fcdc2b344064c5fb4c991fe1d4705c90 — kalsallama main 220263119: fail errored sessions immediately

Final HEAD: 643332f8fcdc2b344064c5fb4c991fe1d4705c90.

## Changes

All code changes are in upstream-owned ggml/src/ggml-hexagon/ggml-hexagon.cpp. The host-only timeout status was removed from shared host/DSP htp-ops.h.

- ggml-hexagon.cpp:125-128,8120,8496-8497,8550-8580: strict positive-decimal parsing, 30,000 ms default batch/fence deadline (GGML_HEXAGON_RSP_TIMEOUT_MS), independent 2,000 ms default probe deadline (GGML_HEXAGON_PROBE_TIMEOUT_MS); both are logged once at initialization.
- ggml-hexagon.cpp:3578-3695: sticky session errors for expired batch waits, invalid response size/payload/shape, response sequence mismatch, and DSP queue read errors. The first session failure is logged once. Validation checks the DSP guarantee rsp.n_ops == req.n_ops along with buffer and tensor counts, removing the unrelated cache-capacity check. Timeout logs sequence and elapsed ms. Skew returns normal failure, without abort/assert.
- ggml-hexagon.cpp:3716-3815,7012-7018,7076-7088,7579-7630: errored sessions reject future work immediately; queue writes and get-tensor callbacks report errors without aborting; graph compute and synchronize return/report failure.
- ggml-hexagon.cpp:4371-4426: stop/queue-close errors during release are warnings and do not abort teardown.
- ggml-hexagon.cpp:7462-7508: event fence waits share the batch deadline, set the sticky timeout error, and sleep between polls.
- ggml-hexagon.cpp:7023-7048,7682-7715: a real one-op F32 fill and readback probe runs through a dedicated temporary dspqueue session. It uses an available virtual session on the same physical HTP, serializes with other queue users, fails if busy, and applies the short probe deadline. PASS logs at INFO; failures log at ERROR.
- ggml-hexagon.cpp:78-79,7682-7715,8330-8339: exported typed entry points are declared before use and exposed through the existing registry proc-address mechanism. No public header API was added. A binding can get the registry with ggml_backend_dev_backend_reg(dev), resolve ggml_backend_hexagon_device_healthcheck using ggml_backend_reg_get_proc_address(reg, "ggml_backend_hexagon_device_healthcheck"), cast it to ggml_status (*)(ggml_backend_dev_t), then call it with dev before selecting HTP. Success is GGML_STATUS_SUCCESS only after a validated data-plane round-trip. ggml_backend_hexagon_device_status is also available for sticky session failure.
- ggml-hexagon.cpp:7673-7676: GGML_HEXAGON_HEALTHCHECK=1 enables a CLI-side init probe with visible PASS/FAIL logging.
- htp/htp-ops.h:8-13: the shared wire enum contains no host-only timeout value.

## Build and artifacts

- Host: cmake --build build-metal -j8 — EXIT=0. Hexagon is disabled in this host configuration; the Android build below compiled and linked the changed Hexagon source.
- Source archive: git archive HEAD — EXIT=0, SHA-256 24d667f4bbdd304158d829d009394d1e1b5a1ae2a88330cc4ee5b5ecceeb4121.
- Android was built from that archive extracted into a container-local directory in one docker run --rm --platform linux/amd64 -u 501:20 using ghcr.io/snapdragon-toolchain/arm64-android:v0.7. The checkout was not bind-mounted. Outputs/logs are in ~/Projects/kalsallama-htpfix-android-artifacts/643332f8f/. The local preset was read-only mounted into the container because it is untracked and omitted by git archive.
- Static configure: cmake --preset arm64-android-snapdragon-release -B /tmp/work/src/build -DPREBUILT_LIB_DIR=android_aarch64 -DBUILD_SHARED_LIBS=OFF — EXIT=0.
- Shared Hexagon configure: cmake --preset arm64-android-snapdragon-release -B /tmp/work/src/build-hex -DPREBUILT_LIB_DIR=android_aarch64 -DBUILD_SHARED_LIBS=ON -DGGML_BACKEND_DL=ON — EXIT=0.
- Static build command: cmake --build /tmp/work/src/build --target llama-cli llama-bench -j "$(nproc)"; retry attempt 1 EXIT=1 (transient generated kernel process failure), attempt 2 EXIT=0.
- Dynamic Hexagon build command: cmake --build /tmp/work/src/build-hex --target ggml-hexagon htp-v73 -j "$(nproc)"; attempt 1 EXIT=0.
- No compiler warnings came from changed files (ggml-hexagon.cpp, htp-ops.h). Logs contain existing warnings from generated Qualcomm headers/stubs and the OpenCL TODO pragma.

Android artifact SHA-256:

| Artifact | SHA-256 |
|---|---|
| llama-cli | 99701637cee4c68a44facbdcf8f757fbe4cba570fcc6ae639b4a7709ffd52cc8 |
| llama-bench | e30792afbe029805f8b17eea6dfd8b004ebbc73912b93847f09981a5cd86e551 |
| libggml-hexagon.so | 31fd2c3d6b5e2607335c987328b31af5fa7f9c66dd378f51b95f6871f2aa6302 |
| libggml-htp-v73.so | 941326584df527d478cced90092d373f7b0f58a67b7f9a80c9ff0a00ea4baab0 |

## S23 test recipe for the coordinator — not run here

Use static llama-bench with -v; capture its complete stdout/stderr and complete unfiltered logcat for each run. Do not use grep as the capture source. The raw captures retain session INFO lines; inspect filters only after preserving the files.

    S23=adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp
    ART=~/Projects/kalsallama-htpfix-android-artifacts/643332f8f
    RAW=~/Projects/kalsa-moe-experiments/scratchpad/agents/inapp-htp-dspqueue-hang/raw/final-643332f8f
    DEV=/data/local/tmp/htp-fix
    STALE=~/Projects/llama.rn-kalsa-gov-platform/bin/arm64-v8a/libggml-htp-v73.so
    mkdir -p "$RAW"
    shasum -a 256 "$STALE"
    adb -s "$S23" shell 'mkdir -p /data/local/tmp/htp-fix/bin /data/local/tmp/htp-fix/stale /data/local/tmp/htp-fix/matched /data/local/tmp/htp-fix/lib'
    adb -s "$S23" push "$ART/llama-bench" "$DEV/bin/llama-bench"
    adb -s "$S23" push "$ART/libggml-hexagon.so" "$DEV/lib/libggml-hexagon.so"
    adb -s "$S23" push "$STALE" "$DEV/stale/libggml-htp-v73.so"
    adb -s "$S23" push "$ART/libggml-htp-v73.so" "$DEV/matched/libggml-htp-v73.so"

Stale skel run (shell timeout is a 40-second guard over the 30-second batch deadline):

    adb -s "$S23" shell 'logcat -c'
    set +e
    adb -s "$S23" shell 'cd /data/local/tmp/htp-fix; start=$(date +%s); LD_LIBRARY_PATH=/data/local/tmp/htp-fix/lib:/data/local/tmp/govhtp/lib ADSP_LIBRARY_PATH=/data/local/tmp/htp-fix/stale GGML_HEXAGON_HEALTHCHECK=1 GGML_HEXAGON_PROBE_TIMEOUT_MS=2000 GGML_HEXAGON_RSP_TIMEOUT_MS=30000 timeout 40 ./bin/llama-bench -v -m /data/local/tmp/heat3way/ship.gguf -p 64 -n 0 -ub 64 -ngl 99 -dev HTP0 -r 1 > /data/local/tmp/htp-fix/stale.stdout-stderr.log 2>&1; rc=$?; elapsed=$(($(date +%s)-start)); echo "BENCH_EXIT=$rc ELAPSED_SECONDS=$elapsed"'
    stale_adb_exit=$?
    set -e
    adb -s "$S23" pull "$DEV/stale.stdout-stderr.log" "$RAW/stale.stdout-stderr.log"
    adb -s "$S23" logcat -d -v threadtime > "$RAW/stale.logcat.txt" 2>&1
    echo "ADB_EXIT=$stale_adb_exit"

Matched skel run:

    adb -s "$S23" shell 'logcat -c'
    set +e
    adb -s "$S23" shell 'cd /data/local/tmp/htp-fix; start=$(date +%s); LD_LIBRARY_PATH=/data/local/tmp/htp-fix/lib:/data/local/tmp/govhtp/lib ADSP_LIBRARY_PATH=/data/local/tmp/htp-fix/matched GGML_HEXAGON_HEALTHCHECK=1 GGML_HEXAGON_PROBE_TIMEOUT_MS=2000 GGML_HEXAGON_RSP_TIMEOUT_MS=30000 timeout 90 ./bin/llama-bench -v -m /data/local/tmp/heat3way/ship.gguf -p 64 -n 0 -ub 64 -ngl 99 -dev HTP0 -r 1 > /data/local/tmp/htp-fix/matched.stdout-stderr.log 2>&1; rc=$?; elapsed=$(($(date +%s)-start)); echo "BENCH_EXIT=$rc ELAPSED_SECONDS=$elapsed"'
    matched_adb_exit=$?
    set -e
    adb -s "$S23" pull "$DEV/matched.stdout-stderr.log" "$RAW/matched.stdout-stderr.log"
    adb -s "$S23" logcat -d -v threadtime > "$RAW/matched.logcat.txt" 2>&1
    echo "ADB_EXIT=$matched_adb_exit"

Inspect both full benchmark captures and logcat files. Required evidence:

- Both: init line “ggml-hex: batch response timeout 30000 ms, probe timeout 2000 ms”.
- Stale: healthcheck line “ggml-hex: HTP data-plane healthcheck FAIL”; BENCH_EXIT nonzero and not 124, within 35 seconds; plus one exact diagnostic form:
  “ggml-hex: <session> batch response timeout : seq <n> elapsed <ms> ms”;
  “ggml-hex: <session> batch response sequence mismatch : expected <n>, got <n>”; or
  “ggml-hex: <session> batch response shape mismatch : expected ... got ...”.
  The stale skel is ~/Projects/llama.rn-kalsa-gov-platform/bin/arm64-v8a/libggml-htp-v73.so, reported SHA prefix f81f95e9.
- Matched: healthcheck line “ggml-hex: HTP data-plane healthcheck PASS”, BENCH_EXIT=0, and the pp64 row near the prior S23 baseline of about 511 tok/s. The performance number is historical, not re-measured here.

## Not verified

No phone was used. Stale-skel failure timing, both runtime health-check results, and matched-skel pp64 performance remain for the coordinator to verify.

