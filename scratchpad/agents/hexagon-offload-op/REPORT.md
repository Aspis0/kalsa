# Hexagon one-copy governor — Phase A

## Scope and implementation

Host-only feasibility spike on branch `spike/hexagon-offload-op`, based on `spike/governor-htp-prefill`. No ADB/device commands were run; the S23 remains untouched.

Implemented in the Hexagon device callback (`ggml/src/ggml-hexagon/ggml-hexagon.cpp:94,6828-6846,7221,7269-7276`): only supported `GGML_OP_MUL_MAT` ops with `ne[1] >= GGML_OP_OFFLOAD_MIN_BATCH` are offered to HTP; the environment threshold defaults to 32. The callback requires `GGML_HEXAGON_MM_SELECT=1` (flat-only), so host-layout weights cannot enter the HMX/tiled paths. Small remainder matmuls below 32 stay on CPU. The existing default buffer selection remains unchanged.

The scheduler gate also needed to change: it previously called `offload_op` only when the weight mapped to the final CPU backend. Hexagon `-HOST` maps to HTP because HTP supports its own host buft. Host weights now ask supported backends to opt in, then fall back to CPU if the source buft is host-readable (`ggml/src/ggml-backend.cpp:967-985`). The CPU and HTP both support the Hexagon host buft, avoiding scheduler input copies.

The override parser now lists backend host buffer types as well as primary buffer types, allowing `-ot '.*=HTP0-HOST'` in common tools and `llama-bench` (`common/arg.cpp:255-265`; `tools/llama-bench/llama-bench.cpp:947-956`). `GGML_HEXAGON_HOSTBUF=1` is required: host buft is otherwise unavailable (`ggml-hexagon.cpp:6550-6554`).

## Weight placement and CPU compatibility

Recommended Phase B load: enable `GGML_HEXAGON_HOSTBUF=1`, select HTP0 with `-dev HTP0 -ngl 99`, override weights with `-ot '.*=HTP0-HOST'`, and pass `-lm none`. The loader honors non-CPU overrides directly (`src/llama-model-loader.cpp:1227-1250`), but when mmap is enabled it deliberately replaces a device host buft with CPU buft (`:1262-1270`); `-lm none` avoids that substitution. The host buffer's `set_tensor` is a plain `memcpy` (`ggml-hexagon.cpp:1987-1993`), preserving row-major q4_0. `--no-repack` is unnecessary here: it toggles llama.cpp's extra CPU buffer types (`common/arg.cpp:2422-2428`), not Hexagon host-buffer layout.

CPU compatibility is supported by source: CPU `supports_buft` accepts any buft whose `is_host` is true (`ggml/src/ggml-cpu/ggml-cpu.cpp:482-485`); CPU `supports_op` accepts `MUL_MAT` when the RHS type is supported (`:453-454`); and the CPU matmul reads the weight from `src0->data` (`ggml/src/ggml-cpu/ggml-cpu.c:1422`). This establishes compatibility, not measured S23 correctness/performance.

Relevant source lines:

```cpp
// ggml/src/ggml-hexagon/ggml-hexagon.cpp:2079-2080
static bool ggml_backend_hexagon_host_buffer_type_is_host(ggml_backend_buffer_type_t buft) {
    return true;
}

// ggml/src/ggml-cpu/ggml-cpu.cpp:482-484
static bool ggml_backend_cpu_device_supports_buft(ggml_backend_dev_t dev, ggml_backend_buffer_type_t buft) {
    return ggml_backend_buft_is_host(buft) || ggml_backend_cpu_is_extra_buffer_type(buft);
}

// ggml/src/ggml-cpu/ggml-cpu.cpp:453-454
case GGML_OP_MUL_MAT:
    return src1->type == GGML_TYPE_F32 || src1->type == ggml_get_type_traits_cpu(src0->type)->vec_dot_type;

// ggml/src/ggml-cpu/ggml-cpu.c:1422
const char * src0_row = (const char*)src0->data + (0 + i02 * nb02 + i03 * nb03);
```

## HMX edge cases

The HTP `-HOST` buft has `is_host=true` and HTP `supports_buft` accepts it (`ggml-hexagon.cpp:2079-2081,6819-6825`). The source `GGML_HEXAGON_MM_SELECT` ladder documents `1 = Flat -> CPU` (`:96`); Phase B must set it to 1. This avoids the HMX path implicated by [#24201](https://github.com/ggml-org/llama.cpp/issues/24201) (Q4_0 corruption at ubatch ≥32, reported on v79) and [#24963](https://github.com/ggml-org/llama.cpp/issues/24963) (small remainder HMX hang, reported on v73). With the default threshold 32, sub-32 matmuls remain CPU; flat-only protects the ≥32 offloaded matmuls. Device validation remains pending.

## Phase B measurement plan and exact commands

Use the established device serial `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`, model `/data/local/tmp/heat3way/ship.gguf` (SHA-256 `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`), and the existing fixed English fixture `/data/local/tmp/govhtp/input/kld_english_fixture.txt` (4,096 tokens; SHA-256 `bca6ac9fd2d398f73bd21b7910e279d12f79c9744dfa49294cb810e781c06728`). Push the newly built `llama-bench` and `llama-perplexity` into `/data/local/tmp/govhtp/bin/` with the kit libraries. For each run, preflight and postflight Awake, thermal status `<3`, battery `<43 C`, traced `0`, and force-stop `com.kalsa.app`; stop if a gate fails.

Binary transfer commands:

```sh
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp push /Users/marco/Projects/kalsallama-wt-oom/build-s23-step0-v73/bin/llama-bench /data/local/tmp/govhtp/bin/
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp push /Users/marco/Projects/kalsallama-wt-oom/build-s23-step0-v73/bin/llama-perplexity /data/local/tmp/govhtp/bin/
```

Keep the screen awake for the whole future session:

```sh
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell 'svc power stayon true'
```

Gate command (run before and after every measurement):

```sh
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell 'dumpsys power | grep mWakefulness=; dumpsys battery | grep "^  temperature:"; dumpsys thermalservice | grep "Thermal Status" | head -1; getprop persist.traced.enable; am force-stop com.kalsa.app; pidof com.kalsa.app || true'
```

Set common paths and RPC environment in the device shell:

```sh
cd /data/local/tmp/govhtp
export LD_LIBRARY_PATH=/data/local/tmp/govhtp/lib ADSP_LIBRARY_PATH=/data/local/tmp/govhtp/lib
export GGML_HEXAGON_DEVICES=HTP0:0 GGML_HEXAGON_HOSTBUF=1 GGML_OP_OFFLOAD_MIN_BATCH=32
```

Prefill timing, 1,024 tokens, three repetitions, ubatch 128 (every full ubatch is ≥32):

```sh
GGML_HEXAGON_MM_SELECT=2 ./bin/llama-bench -m /data/local/tmp/heat3way/ship.gguf -p 1024 -n 0 -b 512 -ub 128 -r 3 -ngl 99 -dev HTP0 -lm none > /data/local/tmp/govhtp/two-copy-prefill.log 2>&1; rc=$?; echo EXIT=$rc; tail -5 /data/local/tmp/govhtp/two-copy-prefill.log
GGML_HEXAGON_MM_SELECT=1 ./bin/llama-bench -m /data/local/tmp/heat3way/ship.gguf -p 1024 -n 0 -b 512 -ub 128 -r 3 -ngl 99 -dev HTP0 -ot '.*=HTP0-HOST' -lm none > /data/local/tmp/govhtp/one-copy-prefill.log 2>&1; rc=$?; echo EXIT=$rc; tail -5 /data/local/tmp/govhtp/one-copy-prefill.log
```

CPU decode comparison, 32-token warm prompt and 64 generated tokens; read TG tok/s. The first run reads the RPCMEM-backed HTP host weights on CPU; the second uses ordinary CPU weights:

```sh
GGML_HEXAGON_MM_SELECT=1 ./bin/llama-bench -m /data/local/tmp/heat3way/ship.gguf -p 32 -n 64 -b 512 -ub 128 -r 3 -ngl 99 -dev HTP0 -ot '.*=HTP0-HOST' -lm none > /data/local/tmp/govhtp/one-copy-cpu-decode.log 2>&1; rc=$?; echo EXIT=$rc; tail -5 /data/local/tmp/govhtp/one-copy-cpu-decode.log
GGML_HEXAGON_HOSTBUF=0 ./bin/llama-bench -m /data/local/tmp/heat3way/ship.gguf -p 32 -n 64 -b 512 -ub 128 -r 3 -ngl 0 -lm none > /data/local/tmp/govhtp/cpu-buffer-decode.log 2>&1; rc=$?; echo EXIT=$rc; tail -5 /data/local/tmp/govhtp/cpu-buffer-decode.log
```

For peak RSS, launch each benchmark in the background and sample the process high-water mark until exit; retain the final `wait` status:

```sh
run_peak() { name=$1; shift; "$@" > "/data/local/tmp/govhtp/$name.log" 2>&1 & pid=$!; peak=0; while kill -0 "$pid" 2>/dev/null; do rss=$(awk '/VmHWM:/ {print $2}' "/proc/$pid/status" 2>/dev/null); if [ -n "$rss" ] && [ "$rss" -gt "$peak" ]; then peak=$rss; fi; sleep 1; done; wait "$pid"; rc=$?; echo "EXIT=$rc RSS_peak_kB=$peak"; tail -5 "/data/local/tmp/govhtp/$name.log"; return "$rc"; }
```

Correctness: generate the CPU logits base first, then compare both HTP paths against it on the same fixture, context 512, batch 512, ubatch 128. One-copy uses flat kernels and the host override; two-copy uses tiled HVX (`MM_SELECT=2`) and normal HTP weights:

```sh
GGML_HEXAGON_HOSTBUF=0 ./bin/llama-perplexity -m /data/local/tmp/heat3way/ship.gguf -f /data/local/tmp/govhtp/input/kld_english_fixture.txt -c 512 -b 512 -ub 128 -ngl 0 -lm none --kl-divergence-base /data/local/tmp/govhtp/input/cpu-base.logits > /data/local/tmp/govhtp/cpu-base.log 2>&1; rc=$?; echo EXIT=$rc; tail -5 /data/local/tmp/govhtp/cpu-base.log
GGML_HEXAGON_MM_SELECT=2 ./bin/llama-perplexity -m /data/local/tmp/heat3way/ship.gguf -f /data/local/tmp/govhtp/input/kld_english_fixture.txt -c 512 -b 512 -ub 128 -ngl 99 -dev HTP0 -lm none --kl-divergence-base /data/local/tmp/govhtp/input/cpu-base.logits --kl-divergence > /data/local/tmp/govhtp/two-copy-kld.log 2>&1; rc=$?; echo EXIT=$rc; tail -5 /data/local/tmp/govhtp/two-copy-kld.log
GGML_HEXAGON_MM_SELECT=1 GGML_HEXAGON_VERBOSE=1 ./bin/llama-perplexity -m /data/local/tmp/heat3way/ship.gguf -f /data/local/tmp/govhtp/input/kld_english_fixture.txt -c 512 -b 512 -ub 128 -ngl 99 -dev HTP0 -ot '.*=HTP0-HOST' -lm none --kl-divergence-base /data/local/tmp/govhtp/input/cpu-base.logits --kl-divergence > /data/local/tmp/govhtp/one-copy-kld.log 2>&1; rc=$?; echo EXIT=$rc; tail -5 /data/local/tmp/govhtp/one-copy-kld.log
```

Report per-run prefill ms, CPU decode tok/s, peak RSS, KLD mean/p99/max and PPL, plus hashes, op-level dispatch proof, and all gate logs. No Phase B measurements were made in this spike.

## Phase A build

Android Snapdragon toolchain build: `llama-bench` and `llama-perplexity`, exit 0 (`raw/build_android_final.log`). Both are AArch64 Android PIE binaries. SHA-256: `llama-bench` `4f71a0ffdc473d8e3e4b970fbbc0cdd23bc04e5d771ba968a48d3dc0c4179e1c`; `llama-perplexity` `eb0d9c0da2d227f44e309344fe432fc0e78a4e33315eae84909113f6ad4b22c`. Engine commit: `ef18040fe` on `spike/hexagon-offload-op`.
