# Step 0 on Galaxy S23 (Hexagon v73): preparation record

## Decision and build provenance

Rebuilt for the current phone engine pin. `REPORT.md` records the QRD8750/v79 outcome using engine `4c7101af4` and explicitly says that the v73 lane was not run; those v79 measurements cannot answer whether the weaker S23 CPU changes the result. The old archive did contain v73 skels, so it could have exercised the S23, but it would still measure an older Hexagon implementation. Since `4c7101af4`, the pinned tree includes material Hexagon changes, including device discovery/session creation, HMX eligibility, more HTP ops, and v79 diagnostics/error propagation. This run therefore uses `kalsa-opencl-upload-oom-throw` at `f25f0c1c5594963c23f0d6f943ddacd8fd052418`.

Build used the lab-discovered official Snapdragon container and preset, not a guessed toolchain: `ghcr.io/snapdragon-toolchain/arm64-android:v0.7`, `arm64-android-snapdragon-release`, Android arm64/API 34, Hexagon SDK 6.6.0.0 and Hexagon Tools 19.0.07. Local image ID was `sha256:91714433626f0d94a926538a1e46ec43756c5b8e3262b91b95df1e812940aed1`. This image resolved to NDK r29; the older v79 preregistration names NDK r28b, so exact historical image/toolchain identity is not established.

Recorded build commands (each command's full output and exit code are in the named log):

```sh
docker run --rm --volume /Users/marco/Projects/kalsallama-wt-oom:/workspace --workdir /workspace --platform linux/amd64 -u 501:20 ghcr.io/snapdragon-toolchain/arm64-android:v0.7 bash -c 'cmake --preset arm64-android-snapdragon-release -B /workspace/build-s23-step0-v73 -DBUILD_SHARED_LIBS=OFF && cmake --build /workspace/build-s23-step0-v73 -j6 && cmake --install /workspace/build-s23-step0-v73' > raw/s23-prep/build_f25_android_v07_shared_off.log 2>&1; echo EXIT=$?
docker run --rm --volume /Users/marco/Projects/kalsallama-wt-oom:/workspace --workdir /workspace --platform linux/amd64 -u 501:20 ghcr.io/snapdragon-toolchain/arm64-android:v0.7 bash -c 'cmake --build /workspace/build-s23-step0-v73 --target htp-v73 -j1 && cmake --build /workspace/build-s23-step0-v73 --target htp-v75 -j1 && cmake --build /workspace/build-s23-step0-v73 --target htp-v79 -j1 && cmake --build /workspace/build-s23-step0-v73 --target htp-v81 -j1' > raw/s23-prep/build_htp_serial_v07.log 2>&1; echo EXIT=$?
docker run --rm --volume /Users/marco/Projects/kalsallama-wt-oom:/workspace --workdir /workspace --platform linux/amd64 -u 501:20 ghcr.io/snapdragon-toolchain/arm64-android:v0.7 bash -c 'cmake --build /workspace/build-s23-step0-v73 --target llama-bench llama-cli -j6' > raw/s23-prep/build_tools_v07.log 2>&1; echo EXIT=$?
docker run --rm --volume /Users/marco/Projects/kalsallama-wt-oom:/workspace --workdir /workspace --platform linux/amd64 -u 501:20 ghcr.io/snapdragon-toolchain/arm64-android:v0.7 bash -c 'cmake --build /workspace/build-s23-step0-v73 --target llama-completion -j6' > raw/s23-prep/build_completion_v07.log 2>&1; echo EXIT=$?
docker run --rm --volume /Users/marco/kalsa-qdc/npu-step0-v73/stage:/out --platform linux/amd64 ghcr.io/snapdragon-toolchain/arm64-android:v0.7 bash -c 'S=/opt/android-ndk-r29/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip; H=/opt/hexagon/6.6.0.0/tools/HEXAGON_Tools/19.0.07/Tools/bin/hexagon-strip; "$S" --strip-all /out/bin/llama-bench /out/bin/llama-completion; "$S" --strip-unneeded /out/lib/libggml-base.so /out/lib/libggml-cpu.so /out/lib/libggml.so /out/lib/libggml-hexagon.so /out/lib/libggml-opencl.so; "$H" --strip-unneeded /out/lib/libggml-htp-v73.so' > raw/s23-prep/strip_payloads.log 2>&1; echo EXIT=$?
```

The full all-target build hit unresolved `AHardwareBuffer_*`; `BUILD_SHARED_LIBS=OFF` follows the lab's existing Android fix. The shared-off all-target build then hit concurrent QAIC generation, so the four documented HTP targets were built serially. The timing kit contains `llama-bench` and `llama-completion`; `llama-cli` is omitted because this engine's `llama-cli` is a server-wrapping UI/client, not a direct completion binary. The current archive contains only the v73 DSP skel, not v79.

SHA-256 for every executable and library in the kit:

| File | SHA-256 |
|---|---|
| `bin/llama-bench` | `5b52c79f2491daeab5995635de946d345cd13de06e6952ef785c52f00706cd1e` |
| `bin/llama-completion` | `790e38986321ff244535d297fbe66fc7d025454a07c5db904554e40dd4846109` |
| `lib/libggml-base.so` | `7f22aa79a1cbe99a8c0c9e253402b35c128fd019b45d06d1ad1ac6473a28874f` |
| `lib/libggml-cpu.so` | `14818705d30c97c8c28a85978dd06b90116abd2c1d4022e5a1b037d0d306bde0` |
| `lib/libggml.so` | `43bb954ff035a86f7a40ed1cc06f3a8089c9c43b544084c314347a7d9df7cffe` |
| `lib/libggml-hexagon.so` | `0679df5550f582775177858fd3482f1c43533cc465db9c33c46826d276e8afb2` |
| `lib/libggml-opencl.so` | `bf0d9a3cce6be290588b30a8f36190229fbd58a4d7dc17074115dd0cb9552935` |
| `lib/libggml-htp-v73.so` | `33e4e586f54c7c151d112d2cb8f8bbd8b8fd6ed2cf65339341813be9fbefcf46` |

Archive SHA-256: `dccf0865753557eb76e253af0157cb53a70346978ea48184fdf0cd884424c7ea` (`npu-kit-f25f0c1c5.tgz`). `raw/s23-prep/binary_sha256.log`, `kit_SHA256SUMS.txt`, `package_manifest_check.log`, and `package_archive_sha256.txt` retain the checksum records.

## Device validation (no timing)

The kit and model are at `/data/local/tmp/npu-step0/`; device manifest checks passed and the model SHA matched `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`. `llama-completion --list-devices` listed `HTP0: Hexagon`. The HTP correctness call returned exit 0, generated the same output bytes as the CPU reference, and the device token hashes matched. HTP diagnostics selected the v73 URI `libggml-htp-v73.so` on the CDSP path after FastRPC URI lookup error `0x14` triggered the documented single-session URI fallback. The DSP service initialization is therefore attempted on the v73 path, but the expected explicit `Hexagon Arch version v73` / HTP execute-op proof was not present; full HTP kernel execution could not be independently confirmed from the saved logs. `raw/s23-prep/correctness_result.log`, `list_devices.log`, and `post_correctness_state.log` contain the output evidence.

Correctness calls used `--no-perf`; their generated output stayed in device-local token files and the retained record contains only exits and hashes:

```sh
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell "cd /data/local/tmp/npu-step0 && export LD_LIBRARY_PATH=\$PWD/lib ADSP_LIBRARY_PATH=\$PWD/lib GGML_HEXAGON_NDEV=1 GGML_HEXAGON_VERBOSE=1 && ./bin/llama-completion -m /data/local/tmp/npu-step0/ship.gguf -lm none -p 'The capital of France is' -n 4 -c 128 -b 16 -ub 16 -t 8 -fa 1 -ngl 0 --seed 1 --temp 0 --no-perf --simple-io --no-display-prompt > cpu.tokens 2> cpu.stderr.tmp; rc=\$?; echo \$rc > cpu.exit; echo EXIT=\$rc" > raw/s23-prep/cpu_correctness_call.log 2>&1; echo EXIT=$?
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell "cd /data/local/tmp/npu-step0 && export LD_LIBRARY_PATH=\$PWD/lib ADSP_LIBRARY_PATH=\$PWD/lib GGML_HEXAGON_NDEV=1 GGML_HEXAGON_VERBOSE=1 && ./bin/llama-completion -m /data/local/tmp/npu-step0/ship.gguf -lm none -p 'The capital of France is' -n 4 -c 128 -b 16 -ub 16 -t 8 -fa 1 --device HTP0 -ngl 99 --fit off -nkvo --seed 1 --temp 0 --no-perf --simple-io --no-display-prompt > htp.tokens 2> htp.stderr.tmp; rc=\$?; echo \$rc > htp.exit; grep -Ei 'hexagon|htp|device|backend|arch|skel|rpc|rpcmem|fast_rpc' htp.stderr.tmp | grep -Eiv '(^|[^[:alpha:]])[0-9]+([.][0-9]+)?[[:space:]]*(ms|us|s|sec|seconds|t/s)' > htp.init.filtered; echo EXIT=\$rc" > raw/s23-prep/htp_correctness_call.log 2>&1; echo EXIT=$?
```

`persist.traced.enable` was `0` before and after. The display remained awake. The strict zero-tick DSP check did **not** pass: before correctness, `adsprpcd` was `0/0` and `cdsprpcd` was `0/2` (utime/stime); after, they were `0/0` and `0/3`. Thus the CDSP counter was already nonzero and advanced one tick. No attempt was made to reset or restart either daemon.

The S23 reported AC powered, thermal status 0, and battery temperature 28.9 C. No benchmark was run and no timing results were recorded. The driver charging guard was exercised: it printed `CHARGING_REFUSED` and exited 11 before setup or timing. The guard also refuses thermal status 3 or higher and battery temperature 44.0 C or higher. Its battery and thermal gates are syntax checked; the thermal thresholds were not exercised independently because charging refusal correctly ran first.

The earlier `llama-cli` attempt was rejected by its argument parser, then the server-wrapping UI path emitted excessive output and was stopped. Only task-owned temporary files under `/data/local/tmp/npu-step0/` were involved. The final kit omits `llama-cli`; an older copy already unpacked in that temporary device directory was left untouched. No Kalsa app or app data was accessed, cleared, or changed.

## Follow-up: HTP execution proof (no timing)

**Verdict: HTP_EXECUTES.** The first correctness log was insufficient: identical tokens alone allow silent CPU fallback, and logger verbosity had suppressed the debug execution records. A diagnostic call with `-lv 5`, `GGML_SCHED_DEBUG=2`, and `GGML_HEXAGON_VERBOSE=1` enabled them. It generated one token with `--no-perf`; no profiling timers were enabled. The graph is mixed: HTP0 handled the nodes shown below while CPU nodes remain for operations such as KV/attention under `-nkvo`.

The non-timing diagnostic invocation was:

```sh
cd /data/local/tmp/npu-step0
export LD_LIBRARY_PATH=$PWD/lib ADSP_LIBRARY_PATH=$PWD/lib GGML_HEXAGON_NDEV=1 GGML_HEXAGON_VERBOSE=1 GGML_SCHED_DEBUG=2
./bin/llama-completion -m /data/local/tmp/npu-step0/ship.gguf -lm none -p 'The capital of France is' -n 1 -c 128 -b 16 -ub 16 -t 8 -fa 1 --device HTP0 -ngl 99 --fit off -nkvo --seed 1 --temp 0 --no-perf --simple-io --no-display-prompt -lv 5
```

```text
ggml-hex: HTP0 failed to get URI (physical 0, virtual 0) : error 0x14. Falling back to single session URI: file:///libggml-htp-v73.so?htp_iface_skel_handle_invoke&_modver=1.0&_dom=cdsp&_session=0
ggml-hex: HTP0 hwinfo: threads 4, hvx 4, hmx 1, vtcm 8 MB
ggml-hex: HTP0 new session : session-id 0 domain-id 3 uri file:///libggml-htp-v73.so?htp_iface_skel_handle_invoke&_modver=1.0&_dom=cdsp&_session=0 handle 0xb400007de91d6df0
## SPLIT #1: HTP0 # 2 inputs: [model.embed_tokens (   8K)] [node_5 (reshaped) (  16K)]
node # 14 (   MUL_MAT): model.layers.{}.conv (  24K) [ HTP0         ]
ggml-hex: HTP0 execute-op MUL_MAT|blk.0.shortconv.in_proj.weight x model.layers.{}.operator_norm-0 (reshaped) -> model.layers.{}.conv.in_proj-0|...|HTP0 x HTP0 -> HTP0|hvx-tiled vtcm 2801664|flags 0x0
ggml-hex: HTP0 execute-op SSM_CONV|node_19 x blk.0.shortconv.conv.weight -> model.layers.{}.conv.conv-0|...|HTP0 x HTP0 -> HTP0|----|flags 0x0
ggml-hex: HTP0 opqueue-pop batch #1 : n-bufs 2 n-tensors 10 n-ops 4 : m-size 1728 b-size 48 t-size 560 o-size 928
ggml-hex: HTP0 opqueue-pop batch #2 : n-bufs 2 n-tensors 21 n-ops 13 : m-size 4864 b-size 48 t-size 1176 o-size 3016
ggml-hex: HTP0 opqueue-pop batch #3 : n-bufs 2 n-tensors 27 n-ops 15 : m-size 5760 b-size 48 t-size 1512 o-size 3480
execute-op=1063; opqueue-push=93; opqueue-pop=93; process exit=0
```

`0x14` is `AEE_EUNSUPPORTED` (“API is not supported”) in Qualcomm FastRPC `AEEStdErr.h` (base offset 0 plus `0x014`). Engine source shows it came from `FASTRPC_GET_URI`; on that lookup failure, the engine forms the fallback URI and then calls `htp_iface_open`. The `hwinfo` and `new session` records prove that fallback opened a real HTP session on domain 3 (CDSP); the HTP0 `execute-op` lines and matched 93 queue submissions/responses prove graph work was dispatched and returned. This is not evidence of CPU fallback, so no library/path/skel/signing fix was needed. Reference: [Qualcomm FastRPC AEEStdErr.h](https://android.googlesource.com/platform/external/fastrpc/%2B/refs/tags/android-platform-12.1.0_r4/inc/AEEStdErr.h).

DSP counters (utime/stime ticks) were adsprpcd `0/0`, cdsprpcd `0/3` before the call; `0/4` immediately after; and still `0/4` after 3 seconds idle. The short CDSP activity during successful HTP work is expected; there was no continuing tick growth in the idle check. `persist.traced.enable` stayed `0`, screen stayed awake, and no app or app data was touched. Logs: `raw/s23-prep/htp_exec_before.log`, `htp_exec_after_idle.log`, `htp_exec_dispatch_summary.log`, and `htp_exec_proof_excerpt.txt`. The phone remained charging throughout; this was correctness/dispatch validation only, with no timing values collected.

## Timing run when unplugged

Unplug the S23, keep it idle, and run this exact command from the lab cell. It rechecks charge, thermal state, battery temperature and `persist.traced.enable` before each arm and refuses timing if any gate fails:

```sh
cd /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/npu-spec-verify && ./d_run.sh s23 5037 s23-v73-step0 > raw/s23/timing_driver.log 2>&1; echo EXIT=$?
```

The resulting run is arms A (CPU), B (HTP with CPU KV), and C (HTP with KV offload), using `-nkvo` as a flag (no value) and `--fit off`. Timing remains unverified until that command runs while unplugged.
