# Engine fix — bounded Hexagon dspqueue errors

Date: 2026-10-01. Repository `Aspis0/kalsallama`, branch `main`.

## Commit

- `a493a436b37ab8cc557922945b8960b2ec0a6280` — `kalsallama main e775fb2bf: bound Hexagon dspqueue failures`
- `a48cc3e083ed5516649c038ff390ce4e2ae87308` — `kalsallama main a493a436b: validate dsp response buffer size`
- Parent of the first commit: `e775fb2bf01404db2b61382df444cc33f9253a78`.
- No push. No device access. The pre-existing untracked `CMakeUserPresets.json` was not staged.

## Changes

- `ggml/src/ggml-hexagon/ggml-hexagon.cpp:120,142-158,8386-8404`: default response deadline is 30,000 ms; `GGML_HEXAGON_RSP_TIMEOUT_MS` accepts only a positive decimal value in `uint32_t` range. Invalid values warn and retain the default. The chosen timeout is logged once when the registry is initialized.
- `ggml/src/ggml-hexagon/ggml-hexagon.cpp:3561-3664`: `flush_pending` uses a monotonic deadline, records `HTP_STATUS_TIMEOUT`, emits one timeout line with the expected sequence and elapsed milliseconds, and stops waiting. Existing graph compute returns `GGML_STATUS_FAILED`; `flush_pending` and graph compute both reject further work after a session error. Response size, buffer count, sequence, response counts, shared-memory payload bounds, returned buffer size, and trace counts are validated before `op_queue->pop`, replacing the response sequence assert and response-shape aborts with a logged session error.
- `ggml/src/ggml-hexagon/htp/htp-ops.h:14`: adds `HTP_STATUS_TIMEOUT`.
- `ggml/src/ggml-hexagon/ggml-hexagon.cpp:6964-6981,7525-7555,8175-8176`: adds a one-op F32 `FILL` data-plane health check. It is exported as `ggml_backend_hexagon_device_healthcheck` through the existing `ggml_backend_reg_get_proc_address` path, taking a `ggml_backend_dev_t` and returning `bool`. This avoids adding a public header API. Binding call shape: `reg = ggml_backend_dev_backend_reg(dev)`, cast `ggml_backend_reg_get_proc_address(reg, "ggml_backend_hexagon_device_healthcheck")` to `bool (*)(ggml_backend_dev_t)`, then call it with `dev` before selecting HTP. `GGML_HEXAGON_HEALTHCHECK=1` also runs the same probe on backend initialization and logs `HTP data-plane healthcheck PASS` or `FAIL`, allowing CLI-side checks.
- `ggml/src/ggml-hexagon/ggml-hexagon.cpp:7357-7389,6984-6991`: event synchronization drains pending responses through the bounded wait and returns on session failure; backend synchronize no longer aborts after graph failure.

## Build results

- Host: `cmake --build build-metal -j8` — **EXIT=0**. `build-metal/CMakeCache.txt` has `GGML_HEXAGON:BOOL=OFF`, so this verifies the configured host build but does not compile the modified Hexagon translation unit.
- Android verification now uses the step A layout: `git archive a48cc3e083ed5516649c038ff390ce4e2ae87308` was created on the host (EXIT=0; archive SHA-256 `cc5c7987fcf7ca1bd83fb0761e802e8c1c53a9a707deacb66b0d22b409ce6a53`) and streamed on stdin into one `docker run`; no checkout or `.git` bind mount was used. The container extracted it into `/tmp/build/src`, copied the tracked Snapdragon preset into the archive root, and mounted only `~/Projects/kalsallama-htpfix-android-artifacts/` for output. Docker run EXIT=0. The local untracked `CMakeUserPresets.json` was not staged or modified.

  ```sh
  cmake --preset arm64-android-snapdragon-release -B /tmp/build/src/build \
    -DPREBUILT_LIB_DIR=android_aarch64 -DBUILD_SHARED_LIBS=OFF
  cmake --preset arm64-android-snapdragon-release -B /tmp/build/src/build-hex \
    -DPREBUILT_LIB_DIR=android_aarch64 -DBUILD_SHARED_LIBS=ON -DGGML_BACKEND_DL=ON
  ```

  Both configure commands exited **0**. Inside the container, each unchanged CMake build command was retried up to eight times, with every attempt's exit logged. `cmake --build /tmp/build/src/build --target llama-cli llama-bench -j "$(nproc)"`: attempt 1 EXIT=1 when an OpenCL `embed_kernel.py` invocation stopped silently; attempt 2 EXIT=0. `cmake --build /tmp/build/src/build-hex --target ggml-hexagon htp-v73 -j "$(nproc)"`: attempt 1 EXIT=0. The successful static build produced both requested executables from the same config.

- The Android backend translation unit compiled and `libggml-hexagon.so` linked; CMake generated and built the v73 skel. No warnings came from changed files (`ggml-hexagon.cpp`, `htp-ops.h`). Other build warnings: GNU variadic-macro extensions from generated `htp_iface.h`/Qualcomm `HAP_farf.h`, const cast in generated `htp_iface_stub.c`, and the existing OpenCL TODO pragma.
- Artifacts and configure/build attempt logs are in `~/Projects/kalsallama-htpfix-android-artifacts/`:

  | Artifact | Build result | SHA-256 |
  |---|---:|---|
  | `llama-cli` | EXIT=0, static build attempt 2 | `520ebd7bdca58b47dee2798d46768f6095d70b44996487c5522358a28933e704` |
  | `llama-bench` | EXIT=0, static build attempt 2 | `831901f07dd892dc7a85e82e714c36decb96e633edfdff2d2459232db5fc63ce` |
  | `libggml-hexagon.so` | EXIT=0, dynamic build attempt 1 | `abafd69a4264172a5fe3fa7055bcf82df6f77f77b7d893a93190a9e14c86662d` |
  | `libggml-htp-v73.so` | EXIT=0, dynamic build attempt 1 | `8bb02f50db0703cfc489f109fc34de1fd116cbadf94b4a59a1da133f6401d459` |

## S23 test for the coordinator

Not run here. The commands below use the S23 adb transport from the project instructions, the already-present model from the skel-swap report, the stale binding skel, and the matched skel from the archive-only Android build. The build includes both static CLI/bench executables and the dynamic backend/v73 skel; the health check is enabled at backend initialization for both runs.

```sh
S23=adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp
adb -s "$S23" shell 'mkdir -p /data/local/tmp/htp-fix/bin /data/local/tmp/htp-fix/stale /data/local/tmp/htp-fix/matched'
adb -s "$S23" push ~/Projects/kalsallama-htpfix-android-artifacts/llama-cli /data/local/tmp/htp-fix/bin/llama-cli
adb -s "$S23" push ~/Projects/llama.rn-kalsa-gov-platform/bin/arm64-v8a/libggml-htp-v73.so /data/local/tmp/htp-fix/stale/libggml-htp-v73.so
adb -s "$S23" push ~/Projects/kalsallama-htpfix-android-artifacts/libggml-htp-v73.so /data/local/tmp/htp-fix/matched/libggml-htp-v73.so
```

Stale skel: the health-check should report `FAIL`, and the process should exit non-zero before the 30-second batch deadline (the 60-second shell timeout is a guard). The captured output must contain a sequence mismatch, shape mismatch, or batch response timeout line.

```sh
adb -s "$S23" shell 'cd /data/local/tmp/htp-fix; start=$(date +%s); LD_LIBRARY_PATH=/data/local/tmp/govhtp/lib ADSP_LIBRARY_PATH=/data/local/tmp/htp-fix/stale GGML_HEXAGON_HEALTHCHECK=1 GGML_HEXAGON_RSP_TIMEOUT_MS=30000 timeout 60 ./bin/llama-cli -m /data/local/tmp/heat3way/ship.gguf -ngl 99 -dev HTP0 -c 128 -b 64 -ub 64 -n 1 -p "The quick brown fox jumps over the lazy dog. Repeat this prompt to force a prefill batch through the HTP data path." > /tmp/htp-stale.log 2>&1; rc=$?; elapsed=$(( $(date +%s) - start )); echo EXIT=$rc ELAPSED=${elapsed}s; grep -E "HTP data-plane healthcheck|batch response (timeout|sequence mismatch|shape mismatch)" /tmp/htp-stale.log; test "$rc" -ne 0 && test "$rc" -ne 124 && test "$elapsed" -le 35 && grep -q "HTP data-plane healthcheck FAIL" /tmp/htp-stale.log && grep -Eq "batch response (timeout|sequence mismatch|shape mismatch)" /tmp/htp-stale.log'
```

Matched skel CLI: health-check should report `PASS` and the CLI should complete normally. Its prompt-evaluation throughput is a quick check against the previous pp64 result (~511 tok/s). The exact pp64 benchmark row uses `llama-bench` from the same build:

```sh
adb -s "$S23" shell 'cd /data/local/tmp/htp-fix; LD_LIBRARY_PATH=/data/local/tmp/govhtp/lib ADSP_LIBRARY_PATH=/data/local/tmp/htp-fix/matched GGML_HEXAGON_HEALTHCHECK=1 GGML_HEXAGON_RSP_TIMEOUT_MS=30000 timeout 60 ./bin/llama-cli -m /data/local/tmp/heat3way/ship.gguf -ngl 99 -dev HTP0 -c 128 -b 64 -ub 64 -n 1 -p "The quick brown fox jumps over the lazy dog. Repeat this prompt to force a prefill batch through the HTP data path." > /tmp/htp-matched.log 2>&1; rc=$?; echo EXIT=$rc; grep -E "HTP data-plane healthcheck|Prompt eval time" /tmp/htp-matched.log; test "$rc" -eq 0'
```

pp64 benchmark run:

```sh
adb -s "$S23" push ~/Projects/kalsallama-htpfix-android-artifacts/llama-bench /data/local/tmp/htp-fix/bin/llama-bench
adb -s "$S23" shell 'cd /data/local/tmp/htp-fix; LD_LIBRARY_PATH=/data/local/tmp/govhtp/lib ADSP_LIBRARY_PATH=/data/local/tmp/htp-fix/matched GGML_HEXAGON_HEALTHCHECK=1 GGML_HEXAGON_RSP_TIMEOUT_MS=30000 timeout 60 ./bin/llama-bench -m /data/local/tmp/heat3way/ship.gguf -p 64 -n 0 -ub 64 -ngl 99 -dev HTP0 -r 1 > /tmp/htp-matched-bench.log 2>&1; rc=$?; echo EXIT=$rc; grep -E "HTP data-plane healthcheck|pp64" /tmp/htp-matched-bench.log; test "$rc" -eq 0 && grep -q "HTP data-plane healthcheck PASS" /tmp/htp-matched-bench.log'
```

## Not verified

- No S23 execution, stale-skel failure timing, health-check runtime result, or matched-skel performance measurement was verified.
