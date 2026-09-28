# Hexagon one-copy governor — Phase A

## Scope and implementation

Host-only feasibility spike on branch `spike/hexagon-offload-op`, based on `spike/governor-htp-prefill`. No ADB/device commands were run; the S23 remains untouched.

Implemented in the Hexagon device callback (`ggml/src/ggml-hexagon/ggml-hexagon.cpp:95,6829-6846,7213,7270-7278`): only supported `GGML_OP_MUL_MAT` ops with `ne[1] >= GGML_OP_OFFLOAD_MIN_BATCH` are offered to HTP; the environment threshold defaults to 32. The callback requires `GGML_HEXAGON_MM_SELECT=1` (flat-only), so host-layout weights cannot enter the HMX/tiled paths. Small remainder matmuls below 32 stay on CPU. The existing default buffer selection remains unchanged.

Threshold parsing now resets `errno` before `strtol` and accepts only a fully parsed integer ≥1 that did not overflow (`ggml-hexagon.cpp:7270-7278`). Invalid input is warned and ignored, leaving the default threshold intact.

The scheduler gate also needed to change: it previously called `offload_op` only when the weight mapped to the final CPU backend. Hexagon `-HOST` maps to HTP because HTP supports its own host buft. Host weights now ask supported backends to opt in, then fall back to CPU if the source buft is host-readable (`ggml/src/ggml-backend.cpp:967-985`). The CPU and HTP both support the Hexagon host buft, avoiding scheduler input copies.

The override parser now lists backend host buffer types as well as primary buffer types, allowing `-ot '.*=HTP0:0-HOST'` in common tools and `llama-bench` (`common/arg.cpp:255-265`; `tools/llama-bench/llama-bench.cpp:947-956`). `GGML_HEXAGON_HOSTBUF=1` is required: host buft is otherwise unavailable (`ggml-hexagon.cpp:6550-6554`).

## Weight placement and CPU compatibility

Recommended Phase B load: enable `GGML_HEXAGON_HOSTBUF=1`, select device `HTP0:0` with `-dev HTP0:0 -ngl 99`, override weights with `-ot '.*=HTP0:0-HOST'`, and pass `-lm none`. The loader honors non-CPU overrides directly (`src/llama-model-loader.cpp:1227-1250`), but when mmap is enabled it deliberately replaces a device host buft with CPU buft (`:1262-1270`); `-lm none` avoids that substitution. The host buffer's `set_tensor` is a plain `memcpy` (`ggml-hexagon.cpp:1987-1993`), preserving row-major q4_0. Therefore the one-copy RPCMEM arm is non-repacked by construction. `--no-repack` toggles llama.cpp's extra CPU buffer types (`common/arg.cpp:2422-2428`); use it on the ordinary CPU-buffer arm to match the app's current 8 GB S23 setup. Compare that arm with a repacked CPU-buffer arm; expected decode gap is about 1.41× in favor of repacking.

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

The HTP `-HOST` buft has `is_host=true` and HTP `supports_buft` accepts it (`ggml-hexagon.cpp:2079-2081,6819-6825`). The source `GGML_HEXAGON_MM_SELECT` ladder documents `1 = Flat -> CPU` (`:96`); the one-copy candidate must set it to 1. Setting `MM_SELECT=2` on that candidate selects the tiled path and brings back the #24201/#24963 edge cases: Q4_0 corruption at ubatch ≥32 and the small remainder HMX hang. With the default threshold 32, sub-32 matmuls remain CPU; flat-only protects the ≥32 offloaded matmuls. Device validation remains pending.

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
GGML_HEXAGON_VERBOSE=1 GGML_HEXAGON_MM_SELECT=2 ./bin/llama-bench -v -m /data/local/tmp/heat3way/ship.gguf -p 1024 -n 0 -b 512 -ub 128 -r 3 -ngl 99 -dev HTP0:0 -lm none > /data/local/tmp/govhtp/two-copy-prefill.log 2>&1; rc=$?; echo EXIT=$rc; tail -5 /data/local/tmp/govhtp/two-copy-prefill.log
GGML_HEXAGON_VERBOSE=1 GGML_HEXAGON_MM_SELECT=1 ./bin/llama-bench -v -m /data/local/tmp/heat3way/ship.gguf -p 1024 -n 0 -b 512 -ub 128 -r 3 -ngl 99 -dev HTP0:0 -ot '.*=HTP0:0-HOST' -lm none > /data/local/tmp/govhtp/one-copy-prefill.log 2>&1; rc=$?; echo EXIT=$rc; tail -5 /data/local/tmp/govhtp/one-copy-prefill.log
```

The Android device is named `HTP0:0` in this configured build (`llama-bench --list-devices`); use that exact name for `-dev` and the host buffer override. Dispatch proof is a pass/fail gate for each decision run. `GGML_HEXAGON_VERBOSE=1` enables the backend's `execute-op` log (`ggml-hexagon.cpp:150-155`), while `-v` lets llama-bench/perplexity emit debug-level logger messages. The decode arms use a one-token prompt so no ≥32-token prefill operation contaminates the decode-only dispatch check. Run this check after the commands; a prefill count of 0 fails the run (for example, `MM_SELECT!=1` silently disables the one-copy candidate offload path), so do not report its timing as HTP:

```sh
count_htp_matmuls() { grep -c 'ggml-hex: HTP0:0 execute-op MUL_MAT|' "$1" || true; }
for log in two-copy-prefill.log one-copy-prefill.log; do n=$(count_htp_matmuls "/data/local/tmp/govhtp/$log"); echo "$log HTP_MUL_MAT=$n"; test "$n" -gt 0 || exit 1; done
for log in one-copy-cpu-decode.log cpu-buffer-no-repack-decode.log cpu-buffer-repacked-decode.log; do n=$(count_htp_matmuls "/data/local/tmp/govhtp/$log"); echo "$log HTP_MUL_MAT=$n"; test "$n" -eq 0 || exit 1; done
```

CPU decode comparison, one-token prompt and 64 generated tokens; read TG tok/s. The first run reads the non-repacked RPCMEM-backed HTP host weights on CPU. The second is the app-equivalent ordinary CPU buffer with `--no-repack`; the third is an ordinary CPU buffer with repacking enabled:

```sh
GGML_HEXAGON_VERBOSE=1 GGML_HEXAGON_MM_SELECT=1 ./bin/llama-bench -v -m /data/local/tmp/heat3way/ship.gguf -p 1 -n 64 -b 512 -ub 128 -r 3 -ngl 99 -dev HTP0:0 -ot '.*=HTP0:0-HOST' -lm none > /data/local/tmp/govhtp/one-copy-cpu-decode.log 2>&1; rc=$?; echo EXIT=$rc; tail -5 /data/local/tmp/govhtp/one-copy-cpu-decode.log
GGML_HEXAGON_VERBOSE=1 GGML_HEXAGON_HOSTBUF=0 ./bin/llama-bench -v -m /data/local/tmp/heat3way/ship.gguf -p 1 -n 64 -b 512 -ub 128 -r 3 -ngl 0 -lm none --no-repack > /data/local/tmp/govhtp/cpu-buffer-no-repack-decode.log 2>&1; rc=$?; echo EXIT=$rc; tail -5 /data/local/tmp/govhtp/cpu-buffer-no-repack-decode.log
GGML_HEXAGON_VERBOSE=1 GGML_HEXAGON_HOSTBUF=0 ./bin/llama-bench -v -m /data/local/tmp/heat3way/ship.gguf -p 1 -n 64 -b 512 -ub 128 -r 3 -ngl 0 -lm none > /data/local/tmp/govhtp/cpu-buffer-repacked-decode.log 2>&1; rc=$?; echo EXIT=$rc; tail -5 /data/local/tmp/govhtp/cpu-buffer-repacked-decode.log
```

The one-copy arm and both CPU arms must each show zero `execute-op MUL_MAT` lines. Compare repacked CPU TG tok/s with the `--no-repack` CPU arm; the expected gap is approximately 1.41×. `--no-repack` is the current app-equivalent baseline.

For peak RSS, launch each benchmark in the background and sample the process high-water mark until exit; retain the final `wait` status:

```sh
run_peak() { name=$1; shift; "$@" > "/data/local/tmp/govhtp/$name.log" 2>&1 & pid=$!; peak=0; while kill -0 "$pid" 2>/dev/null; do rss=$(awk '/VmHWM:/ {print $2}' "/proc/$pid/status" 2>/dev/null); if [ -n "$rss" ] && [ "$rss" -gt "$peak" ]; then peak=$rss; fi; sleep 1; done; wait "$pid"; rc=$?; echo "EXIT=$rc RSS_peak_kB=$peak"; tail -5 "/data/local/tmp/govhtp/$name.log"; return "$rc"; }
```

Correctness: generate the CPU logits base first, then compare both HTP paths against it on the same fixture, context 512, batch 512, ubatch 128. One-copy uses flat kernels and the host override; two-copy uses tiled HVX (`MM_SELECT=2`) and normal HTP weights:

```sh
GGML_HEXAGON_HOSTBUF=0 ./bin/llama-perplexity -v -m /data/local/tmp/heat3way/ship.gguf -f /data/local/tmp/govhtp/input/kld_english_fixture.txt -c 512 -b 512 -ub 128 -ngl 0 -lm none --kl-divergence-base /data/local/tmp/govhtp/input/cpu-base.logits > /data/local/tmp/govhtp/cpu-base.log 2>&1; rc=$?; echo EXIT=$rc; tail -5 /data/local/tmp/govhtp/cpu-base.log
GGML_HEXAGON_VERBOSE=1 GGML_HEXAGON_MM_SELECT=2 ./bin/llama-perplexity -v -m /data/local/tmp/heat3way/ship.gguf -f /data/local/tmp/govhtp/input/kld_english_fixture.txt -c 512 -b 512 -ub 128 -ngl 99 -dev HTP0:0 -lm none --kl-divergence-base /data/local/tmp/govhtp/input/cpu-base.logits --kl-divergence > /data/local/tmp/govhtp/two-copy-kld.log 2>&1; rc=$?; echo EXIT=$rc; tail -5 /data/local/tmp/govhtp/two-copy-kld.log
GGML_HEXAGON_MM_SELECT=1 GGML_HEXAGON_VERBOSE=1 ./bin/llama-perplexity -v -m /data/local/tmp/heat3way/ship.gguf -f /data/local/tmp/govhtp/input/kld_english_fixture.txt -c 512 -b 512 -ub 128 -ngl 99 -dev HTP0:0 -ot '.*=HTP0:0-HOST' -lm none --kl-divergence-base /data/local/tmp/govhtp/input/cpu-base.logits --kl-divergence > /data/local/tmp/govhtp/one-copy-kld.log 2>&1; rc=$?; echo EXIT=$rc; tail -5 /data/local/tmp/govhtp/one-copy-kld.log
```

The Phase B results and per-run gates follow. Raw logs and the guard runner are under `raw/phase-b/`.

## Phase A build

Android Snapdragon toolchain rebuild after review fixes: exit 0 for targets `llama-bench` and `llama-perplexity` (`raw/build_android_reviewfix.log`), using the `spec-dspark-gpu-draft/KIT-BUILD.md` Docker image/recipe. Both are AArch64 Android PIE binaries. SHA-256: `llama-bench` `1e754c1af2645d4b21990a55b4ec0e93622685dcb7ac7a5b7659b27b9140c374`; `llama-perplexity` `1be32fb7300a4de1ce4f3a5a076e2e0485b9483542f1aedbb6ae2b97fc25c41d`. Engine fix commit: `0ec9e3649a22e1784baa787510880422de64dfe0` on `spike/hexagon-offload-op`.

## Phase B — S23 measurements

Device: Galaxy S23 / SM8550 / HTP v73; configured device name `HTP0:0`. Model SHA-256 `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`; fixture SHA-256 `bca6ac9fd2d398f73bd21b7910e279d12f79c9744dfa49294cb810e781c06728` (4,096 English tokens). Uploaded binaries are the hashes in Phase A build; all six backend shared libraries were refreshed from that build. CPU reference logits: 499 MiB, SHA-256 `66b8868318c3b6501a126ddd3885f7de38f6b698804bc1b8f991b99c7307f49c`.

The guarded runner checked Awake, unplugged state, battery level and temperature, thermal status, and traced before and after every binary command; it force-stopped `com.kalsa.app` before each. All recorded runs stayed Awake, unplugged, traced `0`, thermal `<3`, and battery temperature `<43 C`. Battery ended at 65%. Peak observed battery temperature was 41.4 C and peak thermal status was 2. `svc power stayon true` remains set; the screen was left on. No app preferences were read or changed.

### HTP dispatch and timings

Dispatch proof **PASS**: the two-copy prefill logged 2,864 and one-copy prefill 3,104 `HTP0:0 execute-op MUL_MAT` lines. One-copy RPCMEM decode, CPU `--no-repack`, and repacked CPU decode each logged zero such lines. Prefill used `-v` plus `GGML_HEXAGON_VERBOSE=1`; decode used a one-token prompt to keep prefill matmuls out of its count.

| Run | Result | Approx. time for 1,024 prefill tokens | HTP MUL_MAT |
|---|---:|---:|---:|
| Two-copy HTP (`MM_SELECT=2`) | 20.70 ± 0.00 tok/s | 49.47 s | 2,864 — PASS |
| One-copy HTP-HOST (`MM_SELECT=1`) | 18.41 ± 0.19 tok/s | 55.62 s | 3,104 — PASS |

The one-copy run retained 88.9% of the two-copy throughput in these trace-enabled runs, with 12.4% longer prefill latency. `-v` produces large synchronous debug logs, so these absolute times are instrumented diagnostics and should not be compared directly with the earlier untraced 1.6 s result.

| CPU decode arm | TG tok/s | HTP MUL_MAT |
|---|---:|---:|
| One-copy RPCMEM, non-repacked weights | 7.24 ± 1.06 | 0 — PASS |
| CPU buffer, `--no-repack` (app baseline) | 15.02 ± 0.42 | 0 — PASS |
| CPU buffer, repacked | 20.39 ± 0.60 | 0 — PASS |

One-copy CPU decode delivered 48.2% of the app-equivalent baseline throughput (2.08× slower). The repacked CPU arm was 1.36× faster than `--no-repack`, close to the expected 1.41×.

### Peak process RSS

High-water RSS was sampled from `/proc/<pid>/status` during one-repetition (`-r 1`) runs. Values are kB:

| Arm | Peak RSS |
|---|---:|
| Two-copy HTP prefill | 650,816 |
| One-copy HTP-HOST prefill | 79,340 |
| One-copy RPCMEM CPU decode | 76,228 |
| CPU buffer `--no-repack` decode | 1,619,556 |
| CPU buffer repacked decode | 1,829,412 |

One-copy reduced process peak RSS by 571,476 kB (558.1 MiB, 87.8%) versus the two-copy prefill arm, and by 1,504.1 MiB versus the app-equivalent CPU buffer arm. This is process RSS only; it does not account for all physical memory in the shared RPCMEM/HTP allocation.

### KLD against CPU reference

The CPU base completed 8 chunks at context 512 with PPL `34.8972 ± 2.6257`. Both HTP comparisons exited 0 and logged HTP matmuls. The two-copy results were numerically plausible; the one-copy result failed correctness severely:

| Arm | Mean KLD | p99 KLD | Max KLD | Same top token | Mean PPL |
|---|---:|---:|---:|---:|---:|
| Two-copy HTP | 0.002546 | 0.018402 | 0.131321 | 96.912% | 35.4976 |
| One-copy HTP-HOST | 174,513,277.137637 | 240,281,360 | 283,809,344 | 0.000% | `inf` |

One-copy KLD is a **correctness failure** despite `EXIT=0` and confirmed HTP execution: every chunk had zero top-token agreement, and aggregate PPL was infinite. The host-buffer one-copy path is not feasible for this model as measured.

### Per-run gate record

Each row gives pre/post battery, battery temperature, and thermal status; all had Awake, unplugged, and traced `0`. Detailed raw gate logs are named `<run>.pre.gate.log` and `<run>.post.gate.log` in `raw/phase-b/`.

| Run | Pre | Post |
|---|---|---|
| Two-copy prefill | 77% / 32.0 C / T0 | 76% / 35.2 C / T0 |
| One-copy prefill | 76% / 34.8 C / T0 | 74% / 38.9 C / T1 |
| One-copy CPU decode | 73% / 36.9 C / T1 | 73% / 37.3 C / T1 |
| CPU `--no-repack` decode | 73% / 39.3 C / T1 | 72% / 38.3 C / T1 |
| CPU repacked decode | 72% / 38.3 C / T1 | 72% / 38.6 C / T1 |
| Two-copy prefill RSS | 72% / 36.6 C / T1 | 71% / 37.9 C / T1 |
| One-copy prefill RSS | 71% / 37.9 C / T1 | 70% / 39.8 C / T1 |
| One-copy decode RSS | 70% / 39.9 C / T1 | 70% / 38.7 C / T1 |
| CPU `--no-repack` RSS | 72% / 36.6 C / T1 | 72% / 36.6 C / T1 |
| CPU repacked RSS | 70% / 38.7 C / T1 | 70% / 38.7 C / T1 |
| CPU KLD base | 70% / 39.4 C / T1 | 69% / 41.2 C / T2 |
| Two-copy KLD | 69% / 39.0 C / T2 | 67% / 40.3 C / T2 |
| One-copy KLD | 67% / 40.4 C / T2 | 65% / 41.4 C / T2 |

### Failures and verdict

Initial attempts exposed three harness/configuration errors before valid measurements: (1) the local gate script missed `]` and refused preflight before launching a binary; (2) a fresh `adb shell` lacked the exported library paths and `llama-bench` printed `llama_bench: error: failed to load model '/data/local/tmp/heat3way/ship.gguf'` (`EXIT=1`); (3) report command `-dev HTP0` was rejected with `error: invalid device: HTP0` and `error: invalid parameter for argument: -dev` (`EXIT=1`). The configured name is `HTP0:0`; the runner now exports the required environment on each shell. A successful `HTP0:0` run without `-v` exited 0 but produced zero dispatch lines, so it was invalidated and replaced by the trace-enabled run. These attempt messages are retained in `raw/phase-b/attempt_failures.log`.

**Verdict:** one-copy preserved most of the instrumented HTP prefill throughput and substantially reduced process RSS, but it failed KLD catastrophically and made CPU decode 2.08× slower than today's `--no-repack` baseline. No corrected one-copy configuration was found in this phase; no process crashed. Raw verbose logs are compressed as `.log.gz` alongside the gate, summary, push, and RSS records.

## Phase B follow-up — isolate one-copy correctness and decode cost

S23 / SM8550, HTP v73; model `/data/local/tmp/heat3way/ship.gguf` SHA-256 `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`. All KLD arms used the same 4,096-token English fixture (`bca6ac9fd2d398f73bd21b7910e279d12f79c9744dfa49294cb810e781c06728`), `-c 512`, `--chunks 2`, and one CPU-only base (PPL 32.3370; base logits SHA-256 `5aa28ec2057f857ff96f463b3562a8ce9eb8f3b2f3186cb6dd06f01f23bcca6f`). Every KLD binary command exited 0.

### Correctness isolation

| Arm | Configuration | Mean KLD | Max KLD | Same top token | PPL |
|---|---|---:|---:|---:|---:|
| a. Two-copy HTP, flat | Normal HTP buffer, `MM_SELECT=1` | 0.002788 | 0.032330 | 96.471% | 33.3748 |
| b. CPU matmul on rpcmem | `HTP0:0-HOST`, offload threshold 2,147,483,647 | 0.001316 | 0.016001 | 97.647% | 32.5753 |
| c. One-copy HTP | `HTP0:0-HOST`, threshold 32, `MM_SELECT=1` | 175,370,565.885071 | 255,755,840 | 0.000% | `inf` |

Result: flat HTP matmuls on the regular HTP buffer are not the catastrophic failure; CPU matmuls reading the `-HOST` rpcmem weights also agree with the CPU base. The corruption appears only when HTP matmuls consume the host-buffer weights. This isolates the failing interaction to HTP reading the row-major host-buffer weight representation; these measurements do not identify whether the remaining fault is layout interpretation or cache/coherency.

Dispatch was checked separately with verbose logs. Arm a executed 182 HTP `MUL_MAT` ops in its 64-token proof run. Arm b executed 558 HTP ops overall but **zero** HTP `MUL_MAT` ops with the very high threshold. Arm c's two-chunk scheduler trace contained 784 HTP `MUL_MAT` ops. Thus arm b exercises CPU matmul on rpcmem (although non-matmul ops can still run on HTP).

The `-lv 5` plus `GGML_SCHED_DEBUG=1` split log for arm c showed 2,423 HTP splits with zero split inputs. There are no HTP `COPY`/`CONVERT` execution ops. The direct execution line is representative: `MUL_MAT ... | q4_0 x f32 -> f32 | ... | HTP0:0-HOST x HTP0:0-HOST -> HTP0:0 | hvx-flat`. HTP therefore sees q4_0 weights and f32 activations in the HTP host buffer directly; no scheduler copy/convert sits between `-HOST` and HTP. The ordinary-buffer flat proof instead reports HTP buffer sources (`HTP0:0 x HTP0:0`) and also gives plausible KLD.

### Allocation flags and decode

Engine allocation is the same shared RPCMEM block for both buft variants (`ggml-hexagon.cpp:542-548, 2031-2045`):

```cpp
base = (uint8_t *) rpcmem_alloc2(RPCMEM_HEAP_ID_SYSTEM, RPCMEM_DEFAULT_FLAGS, size);
ggml_hexagon_shared_buffer * sbuf = new ggml_hexagon_shared_buffer(sess, size, false);
```

The actual Snapdragon SDK header `/opt/hexagon/6.6.0.0/incs/rpcmem.h:47-53,89,100-105` defines `RPCMEM_DEFAULT_FLAGS` as `ION_FLAG_CACHED` (fallback `1`), `RPCMEM_FLAG_CACHED` as that default, `RPCMEM_FLAG_UNCACHED` as `0`, and `RPCMEM_HEAP_ID_SYSTEM = 25`. Thus the allocation is cacheable, not CPU-uncached. Runtime logs say `rpcmem_alloc2 not found, falling back to rpcmem_alloc`, passing the same flags. `GGML_HEXAGON_HOSTBUF` only controls whether `get_host_buffer_type` returns the host type (`:6550-6555`, parsed at `:7221,7269`); it does not alter allocation flags. The host setter is plain memcpy (`:1988-1995`):

```cpp
memcpy((char *) tensor->data + offset, data, size);
```

The regular device setter marks quantized weights for tiled repack (`:1736-1753`), unlike `-HOST`.

The decode benchmark used the current default cached allocation, no verbose/optrace, `-p 1 -n 64 -r 1`: rpcmem `-HOST` achieved **9.47 tok/s**, versus **14.07 tok/s** for CPU `--no-repack` in the paired clean run (1.49× slower). Thus the slowdown is not explained by an uncached rpcmem allocation; this was not a cached-vs-uncached A/B because the current engine has no flag override.

### Clean prefill timings

Verbose/optrace were off; each row is one benchmark repetition with `-p 1024`, same model and batch/ubatch settings:

| Arm | Throughput | Approx. 1,024-token time |
|---|---:|---:|
| Two-copy, normal HTP buffer, flat | 20.78 tok/s | 49,278 ms |
| One-copy, HTP host buffer, flat | 17.49 tok/s | 58,548 ms |

One-copy retained 84.2% of the two-copy throughput in these diagnostic runs. The phone was unplugged; these are diagnostic, not energy measurements.

### Gates, failures, and raw logs

`run_guarded.sh` force-stopped `com.kalsa.app` before every binary run and recorded pre/post state. All completed commands remained Awake, unplugged, traced `0`, thermal status `<3`, battery temperature `<43 C`; battery stayed above 30%. Peak observed battery temperature was 39.6 C, peak thermal status 1; the last run ended at 59%, and the final post-session read was 58% / 33.7 C / thermal 0. Screen remains Awake and on. No app preferences were touched.

| Run | Battery pre→post | Temp pre→post | Thermal pre→post | Exit |
|---|---:|---:|---:|---:|
| CPU base | 64→64% | 33.1→33.1 C | 0→0 | 0 |
| a KLD | 64→64% | 34.6→35.6 C | 0→0 | 0 |
| b KLD | 64→63% | 35.6→36.5 C | 0→0 | 0 |
| c KLD | 63→63% | 36.5→38.2 C | 0→1 | 0 |
| Scheduler `-lv 5` trace | 62→61% | 37.4→39.0 C | 1→1 | 0 |
| Two-copy clean prefill | 61→61% | 39.0→38.7 C | 1→1 | 0 |
| One-copy clean prefill | 61→60% | 38.8→39.5 C | 1→1 | 0 |
| One-copy cached decode | 60→60% | 39.5→39.6 C | 1→1 | 0 |
| CPU no-repack decode | 60→60% | 39.6→39.6 C | 1→1 | 0 |
| a dispatch proof | 59→59% | 37.3→37.3 C | 1→1 | 0 |
| b OPTRACE-only diagnostic | 59→59% | 37.3→37.3 C | 1→1 | 0 |
| b verbose dispatch proof | 59→59% | 37.8→37.8 C | 1→1 | 0 |
| Perplexity verbose trace | 63→62% | 36.6→37.7 C | 1→1 | 0 |
| Invalid bench-verbosity attempt | 63→63% | 36.6→36.6 C | 1→1 | 1 |

The only failed command was the first scheduler diagnostic using `llama-bench -lv 5`; it exited 1 with `error: invalid parameter for argument: -lv` (`raw/phase-b/cause-sched-debug.log.gz`, line 11). `llama-bench` does not expose that option. The corrected `llama-perplexity -lv 5` run succeeded. A first OPTRACE-only b diagnostic exited 0 but emitted no `execute-op` lines; it was not used as proof and was repeated with `GGML_HEXAGON_VERBOSE=1`, confirming zero HTP matmuls. No crash occurred. Raw logs, summaries, pull records, and per-run gates are compressed beside this report under `raw/phase-b/` as `cause-*.log.gz`; `raw/phase-b/cause-commands.txt` records the exact binary arguments and the ineffective/failed diagnostics.

## Follow-up — why the clean prefill timings differ from run 6

The `49.3 s` two-copy and `58.5 s` one-copy values are the reciprocal of the
`llama-bench` `pp1024` rates, not failed CPU runs: the exact commands in
`raw/phase-b/cause-commands.txt:12-13` both use `-ngl 99 -dev HTP0:0`, but
force `GGML_HEXAGON_MM_SELECT=1` and `-ub 128`. Their saved tables report
`backend OpenCL,HTP`, `n_ubatch 128`, and `20.78` / `17.49 tok/s`
(`cause-two-copy-clean-prefill.log.gz:11-13`,
`cause-one-copy-clean-prefill.log.gz:11-13`; both summaries say `EXIT=0`).
Separate verbose dispatch evidence for the same two-copy flags logs
`HTP0 execute-op MUL_MAT ... hvx-flat` (for example,
`cause-a-flat-dispatch.log.gz:18180`); the one-copy scheduler proof likewise
shows direct HTP `hvx-flat` execution from `HTP0:0-HOST` inputs
(`cause-sched-split.log.gz`). The timed logs themselves had tracing off, so
they do not independently prove per-op dispatch, but their device/backend
configuration plus matching dispatch proofs show these were intended as HTP
flat-kernel arms, not CPU fallback.

Run 6 instead used `llama-completion` with `-b 2048 -ub 1024` on the verified
1,010-token file (`scratchpad/agents/qdc-heat-3way/arm.sh:104-110`); its NPU load proof records
`n_batch=2048`, `n_ubatch=1024`, `HTP0 hwinfo ... hmx 1`, and matmuls labeled
`hvx-tiled` (`scratchpad/agents/qdc-heat-3way/raw/s23-3way-6/s23-3way-6-t3npu.load.log:274,
1105,24771`). Source defaults `opt_mm_select=3` to “HMX -> Tiled -> Flat ->
CPU” (`ggml-hexagon.cpp:97`); the measured completion command did not set
`GGML_HEXAGON_MM_SELECT`, whereas the bench commands forced `1`, which disables
HMX and tiled selection. Thus the ubatch is eight times larger in run 6, and
the kernel selection differs. The run 6 completion log reports
`prompt eval time = 1668.22 ms / 1010 tokens` and `offloaded 31/31 layers`
(`scratchpad/agents/qdc-heat-3way/raw/s23-3way-6/s23-3way-6-t3npu.log:130,187`); the matching CPU completion arm reports
`10389.45 ms / 1010 tokens` and `offloaded 0/31`
(`scratchpad/agents/qdc-heat-3way/raw/s23-3way-6/s23-3way-6-t6cpu.log:131,205`).

The fit messages do not explain the gap or indicate CPU fallback: run 6 warns
`device HTP0 did not report memory; --fit will not use it` and
`n_gpu_layers already set by user to 99, abort` (`scratchpad/agents/qdc-heat-3way/raw/s23-3way-6/s23-3way-6-t3npu.log:8,15`), then
explicitly loads `offloaded 31/31 layers to GPU` and allocates a 1525.87 MiB
HTP0 model buffer (`scratchpad/agents/qdc-heat-3way/raw/s23-3way-6/s23-3way-6-t3npu.log:130-132`). The CPU arm's analogous fit warning ends with
user-set `n_gpu_layers ... 0` and its model reports `offloaded 0/31`
(`scratchpad/agents/qdc-heat-3way/raw/s23-3way-6/s23-3way-6-t6cpu.log:18,130-133`). The clean `llama-bench` logs have no fit output;
they are not `llama-perplexity` runs. `llama-perplexity` was used for the
two-chunk KLD and scheduler investigations (`cause-commands.txt:5-11`), while
the prefill rates came from `llama-bench -p 1024 -n 0`; run 6's measured prompt
time came from `llama-completion` `common_perf_print`. These are different
frontends/workloads, so their times are not a controlled benchmark comparison.

Conclusion: the prior “clean” arms were misconfigured as comparators for run
6: they intentionally measured flat-only HTP at ubatch 128, while run 6
measured the default tiled/HMX ladder at ubatch 1024. They do not establish
that the governor's normal HTP prefill regressed to ~50 seconds. The trace-off
timings also lacked per-op proof within those exact timed invocations, so do
not use them to claim a precise flat-vs-tiled speed ratio.

**Previous phase verdict — PARK (superseded below).** One-copy on Hexagon is currently incorrect: when HTP reads
the `-HOST` weights, KLD explodes and top-token agreement is zero; whether the
cause is q4_0 layout interpretation or cache/coherence remains unresolved.
The cacheable RPCMEM decode arm measured 9.47 tok/s versus 14.07 tok/s for the
CPU `--no-repack` baseline (1.49× slower; `cause-one-copy-cached-decode.log.gz:14`,
`cause-cpu-no-repack-decode-clean.log.gz:14`). The memory saving alone does
not justify advancing a broken path. If reopened, the cheapest discriminating
experiment is a single synthetic q4_0 `MUL_MAT`, with the same flat kernel
first reading copied HTP-buffer weights and then `-HOST` weights, comparing
CPU/HTP outputs while toggling an explicit cache flush; this isolates
layout/coherence before another full-model run.

## Host-only follow-up — unpark one-copy and isolate corruption

No device was accessed in this follow-up. The three prior controls remain
distinct: CPU-on-rpcmem was numerically sound, flat HTP on the normal device
buffer was numerically sound, and HTP on `-HOST` failed catastrophically.

### Code evidence and current leading cause

Both buffer types allocate from `RPCMEM_HEAP_ID_SYSTEM` with
`RPCMEM_DEFAULT_FLAGS` by default (`ggml-hexagon.cpp:547-549`); the SDK defines
the system heap as non-contiguous system memory, default flags as cached, and
uncached as flag `0` (`rpcmem.h:47-53,89,100-105`, quoted in the allocation
section above). The device-buffer `set_tensor` marks quantized weight tensors
REPACK and calls `repack_tensor_tiled` for a full write
(`ggml-hexagon.cpp:1742-1759`). The `-HOST` setter instead wrote the source
bytes directly by `memcpy` (`:1994-2017` before this experiment patch). Neither
setter had a host-side DMA-BUF/FastRPC cache sync call. The firmware's
`htp_tensor_flush_all` tracks and flushes DSP dirty output ranges
(`htp/htp-tensor.c:322-350`); it is not a CPU-to-DSP flush after model loading.
So the evidence does **not** support a host-only missing sync call in the
normal buffer path; a cache-policy/coherency effect remains testable, but is
not the leading explanation.

The setter difference is explicit (`ggml-hexagon.cpp:1742-1759` versus the
pre-patch HOST setter at `:1994-1995`):

```cpp
if (ggml_backend_buffer_get_usage(buffer) == GGML_BACKEND_BUFFER_USAGE_WEIGHTS) {
    extra->flags |= GGML_HEXAGON_TENSOR_WEIGHT;
    if (ggml_hexagon_is_repack_type(tensor->type)) {
        extra->flags |= GGML_HEXAGON_TENSOR_REPACK;
    }
}
if (offset == 0 && size == ggml_nbytes(tensor) && extra->shadow_buf.empty()) {
    repack_tensor_tiled(tensor, data, size);
}
// HOST before the experiment patch:
memcpy((char *) tensor->data + offset, data, size);
```

The layout evidence is direct. HTP tensor descriptors select either padded
tiled shape/strides or the original tensor shape/strides from the REPACK flag
(`ggml-hexagon.cpp:2297-2313`). For Q4_0 flat matmul, the backend selects
`hvx_mm_2d_repacked_q4_0_flat` or `hvx_mv_2d_repacked_q4_0_flat`
(`htp/matmul-ops.c:1521-1540`; the fused path selects
`hvx_mm_nx_2d_repacked_q4_0_flat` at `:4283-4289`). Normal device weights are
repacked and marked; `-HOST` stores raw GGUF Q4_0 bytes and, by default, carries
the original strides into an HTP kernel that assumes its repacked Q4_0 layout.
That mismatch is the leading cause. The separate `-HOST` padding allocation
does not itself transform the bytes.

Descriptor and kernel code confirm the expected representation:
`ggml-hexagon.cpp:2297-2313` chooses the tensor shape and row stride, and
`htp/matmul-ops.c:1526-1540` selects the flat Q4_0 functions:

```cpp
if (is_repack) {
    h.ne[0] = hex_round_up(t->ne[0], 32);
    h.ne[1] = hex_round_up(t->ne[1], 32);
    h.nb[1] = ggml_hexagon_tiled_row_size(t->type, h.ne[0]);
} else {
    h.ne[0] = t->ne[0]; h.ne[1] = t->ne[1];
    h.nb[1] = t->nb[1];
}
case HTP_TYPE_Q4_0: matmul_job_func = hvx_mm_2d_repacked_q4_0_flat; break;
```

### Android diagnostic patches

On `spike/hexagon-offload-op`, commit
`0a5c782317d48746099b0e5e2f52ed6050606a5f`, `ggml-hexagon.cpp` now has three
opt-in experiments, all disabled by default:

- `GGML_HEXAGON_HOSTBUF_FLUSH=1` brackets the `-HOST` setter write with
  `DMA_BUF_IOCTL_SYNC START|WRITE` and `END|WRITE`. Either ioctl failure aborts
  with an errno line, so a passing KLD result cannot hide unsupported sync.
- `GGML_HEXAGON_HOSTBUF_UNCACHED=1` allocates only the `-HOST` rpcmem buffer
  using `RPCMEM_FLAG_UNCACHED` and logs the selected flags under
  `GGML_HEXAGON_VERBOSE=1`.
- `GGML_HEXAGON_HOSTBUF_REPACK=1` repacks full quantized tensor writes into the
  tiled Q4 layout and sets the HTP REPACK descriptor flag. This is a layout
  diagnostic only: the CPU decode cannot read these repacked host weights.

All three modes require `GGML_HEXAGON_HOSTBUF=1`, `GGML_HEXAGON_MM_SELECT=1`,
and threshold 32. Compare each two-chunk KLD against the existing CPU base;
also require `HTP_MUL_MAT > 0` in each log. A fix is supported if sync or
uncached allocation restores KLD while raw layout stays unchanged. A KLD
recovery only with the repack experiment points to layout. These runs are not
executed here because the S23 is occupied by the governor session.

### RPCMEM sequential-read probe

The existing allocator uses heap ID 25 (system, non-contiguous) and flags 1
(`RPCMEM_DEFAULT_FLAGS`, cacheable); it does not request TCM or the small
contiguous heap (`ggml-hexagon.cpp:547-549`; SDK `rpcmem.h:89,100-105`). The
engine maps the fd into FastRPC with `fastrpc_mmap` (`ggml-hexagon.cpp:578-582`).
That proves the requested heap and flag, not the CPU's effective mapping
attribute or page backing. The new `hexagon-rpcmem-bench` compares sequential
reads from a 256 MiB page-aligned `posix_memalign` allocation and a 256 MiB
rpcmem allocation, seven passes each. It prints median GB/s, the rpcmem fd,
`/proc/self/smaps` page-size/THP fields for both mappings, and whether
`MADV_HUGEPAGE` was accepted for malloc. Compare `AnonHugePages` and page
sizes to test the THP/TLB hypothesis; compare read GB/s to identify a large
effective bandwidth gap. Heap 25 rules out the specifically requested TCM and
contiguous heaps, but not a driver-specific mapping attribute; `/proc/self/smaps`
does not directly prove cacheability.

### Android build and exact commands for the next S23 slot

Android build used the Snapdragon toolchain image and build directory from
`spec-dspark-gpu-draft/KIT-BUILD.md`, targeting `llama-perplexity` and
`hexagon-rpcmem-bench`. Final incremental build exited `0`; raw output is
`raw/host-fix/build_android_final.log`. Both artifacts are AArch64 Android PIE
binaries. SHA-256: `llama-perplexity`
`97027ce93a078f91fb2e067cc6196fae049996a758b3a0aa9f87c79d047508db`,
`hexagon-rpcmem-bench`
`7a6fe525933db503ca0722a1e0f596c54e2a455f0894c931d58ebc45f367c82e`.
An intermediate incremental link was intentionally stopped (EXIT=137) after
adding the REPACK weight metadata; the final build includes that change and
exited 0. No ADB commands were run.

```sh
docker run --rm --volume /Users/marco/Projects/kalsallama-wt-oom:/workspace --workdir /workspace --platform linux/amd64 -u 501:20 ghcr.io/snapdragon-toolchain/arm64-android:v0.7 bash -c 'cmake --build /workspace/build-s23-step0-v73 --target llama-perplexity hexagon-rpcmem-bench -j6' > /Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/hexagon-offload-op/raw/host-fix/build_android_final.log 2>&1; echo EXIT=$?
```

Push only after the owner returns the S23:

```sh
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp push /Users/marco/Projects/kalsallama-wt-oom/build-s23-step0-v73/bin/llama-perplexity /data/local/tmp/govhtp/bin/
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp push /Users/marco/Projects/kalsallama-wt-oom/build-s23-step0-v73/bin/hexagon-rpcmem-bench /data/local/tmp/govhtp/bin/
```

Each KLD command uses the same two-chunk fixture and CPU logits base from the
isolation run. Preflight/postflight device gates and force-stop remain required
for every binary invocation; none was performed in this host-only phase.

```sh
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell 'cd /data/local/tmp/govhtp && export LD_LIBRARY_PATH=/data/local/tmp/govhtp/lib ADSP_LIBRARY_PATH=/data/local/tmp/govhtp/lib GGML_HEXAGON_DEVICES=HTP0:0 GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_MM_SELECT=1 GGML_OP_OFFLOAD_MIN_BATCH=32 GGML_HEXAGON_VERBOSE=1 && GGML_HEXAGON_HOSTBUF_FLUSH=1 ./bin/llama-perplexity -m /data/local/tmp/heat3way/ship.gguf -f /data/local/tmp/govhtp/input/kld_english_fixture.txt -c 512 -b 512 -ub 128 -ngl 99 -dev HTP0:0 -ot ".*=HTP0:0-HOST" -lm none --chunks 2 --kl-divergence-base /data/local/tmp/govhtp/input/cause-cpu-base.logits --kl-divergence > /data/local/tmp/govhtp/host-flush-kld.log 2>&1; rc=$?; echo EXIT=$rc; grep -c "HTP0 execute-op MUL_MAT" /data/local/tmp/govhtp/host-flush-kld.log; tail -5 /data/local/tmp/govhtp/host-flush-kld.log'
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell 'cd /data/local/tmp/govhtp && export LD_LIBRARY_PATH=/data/local/tmp/govhtp/lib ADSP_LIBRARY_PATH=/data/local/tmp/govhtp/lib GGML_HEXAGON_DEVICES=HTP0:0 GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_HOSTBUF_UNCACHED=1 GGML_HEXAGON_MM_SELECT=1 GGML_OP_OFFLOAD_MIN_BATCH=32 GGML_HEXAGON_VERBOSE=1 && ./bin/llama-perplexity -m /data/local/tmp/heat3way/ship.gguf -f /data/local/tmp/govhtp/input/kld_english_fixture.txt -c 512 -b 512 -ub 128 -ngl 99 -dev HTP0:0 -ot ".*=HTP0:0-HOST" -lm none --chunks 2 --kl-divergence-base /data/local/tmp/govhtp/input/cause-cpu-base.logits --kl-divergence > /data/local/tmp/govhtp/host-uncached-kld.log 2>&1; rc=$?; echo EXIT=$rc; grep -c "HTP0 execute-op MUL_MAT" /data/local/tmp/govhtp/host-uncached-kld.log; tail -5 /data/local/tmp/govhtp/host-uncached-kld.log'
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell 'cd /data/local/tmp/govhtp && export LD_LIBRARY_PATH=/data/local/tmp/govhtp/lib ADSP_LIBRARY_PATH=/data/local/tmp/govhtp/lib GGML_HEXAGON_DEVICES=HTP0:0 GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_HOSTBUF_REPACK=1 GGML_HEXAGON_MM_SELECT=1 GGML_OP_OFFLOAD_MIN_BATCH=32 GGML_HEXAGON_VERBOSE=1 && ./bin/llama-perplexity -m /data/local/tmp/heat3way/ship.gguf -f /data/local/tmp/govhtp/input/kld_english_fixture.txt -c 512 -b 512 -ub 128 -ngl 99 -dev HTP0:0 -ot ".*=HTP0:0-HOST" -lm none --chunks 2 --kl-divergence-base /data/local/tmp/govhtp/input/cause-cpu-base.logits --kl-divergence > /data/local/tmp/govhtp/host-repack-kld.log 2>&1; rc=$?; echo EXIT=$rc; grep -c "HTP0 execute-op MUL_MAT" /data/local/tmp/govhtp/host-repack-kld.log; tail -5 /data/local/tmp/govhtp/host-repack-kld.log'
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell 'cd /data/local/tmp/govhtp && LD_LIBRARY_PATH=/vendor/lib64:/data/local/tmp/govhtp/lib ./bin/hexagon-rpcmem-bench 268435456 7 > /data/local/tmp/govhtp/rpcmem-bandwidth.log 2>&1; rc=$?; echo EXIT=$rc; tail -5 /data/local/tmp/govhtp/rpcmem-bandwidth.log'
```

**Current verdict: CONTINUE fixing.** The source points first to a Q4_0
representation mismatch, while the build also supplies isolated cache-sync and
uncached controls plus a host-vs-rpcmem read-bandwidth probe. The next device
session should run flush, uncached, then repack KLD and the one-minute memory
probe. If repack alone restores KLD, the production fix needs an HTP kernel for
raw row-major Q4_0 or a per-operation repack scratch; it must not rewrite the
shared host weights because CPU decode reads their original layout. Promote
only the mechanism that restores KLD and preserves the CPU consumer contract.

## S23 host-buffer correctness diagnostics — 2026-09-28

Correctness-only runs on the plugged-in S23 used the existing two-chunk,
`-c 512` English fixture and the same CPU logits base as the isolation results
above. No timing or bandwidth probe was run. Before pushing, both binary SHA-256
values matched this report: `llama-perplexity`
`97027ce93a078f91fb2e067cc6196fae049996a758b3a0aa9f87c79d047508db` and
`hexagon-rpcmem-bench`
`7a6fe525933db503ca0722a1e0f596c54e2a455f0894c931d58ebc45f367c82e`.
The device copies matched; the bandwidth probe binary was not run.

The exact three registered KLD arms ran with their corresponding
`GGML_HEXAGON_HOSTBUF_FLUSH=1`, `GGML_HEXAGON_HOSTBUF_UNCACHED=1`, or
`GGML_HEXAGON_HOSTBUF_REPACK=1`, with `GGML_HEXAGON_HOSTBUF=1`,
`GGML_HEXAGON_MM_SELECT=1`, `GGML_OP_OFFLOAD_MIN_BATCH=32`,
`GGML_HEXAGON_VERBOSE=1`, and `-lv 5`. The added `-lv 5` exposes the backend's
`GGML_LOG_DEBUG` execute-op records. Each logged 784 `HTP0:0 execute-op
MUL_MAT` operations. The first flush attempt without `-lv 5` had zero visible
op records; it exited 0 and is retained as an incomplete dispatch-proof
attempt. The runner's initial count expression omitted the `:0` device suffix;
counts below were recomputed from the raw logs using the full device name.

| Arm | Exit | HTP MUL_MAT | Mean KLD | Max KLD | Same top p | PPL |
|---|---:|---:|---:|---:|---:|---:|
| Existing normal-buffer HTP | 0 | see earlier dispatch proof (182) | 0.002788 | 0.032330 | 96.471% | 33.3748 |
| Existing raw `-HOST` | 0 | 784 in two-chunk comparison | 175,370,565.885071 | 255,755,840 | 0.000% | inf |
| `HOSTBUF_FLUSH` | 0 | 784 | 175,370,565.885071 | 255,755,840 | 0.000% | inf |
| `HOSTBUF_UNCACHED` | 0 | 784 | 175,370,565.885071 | 255,755,840 | 0.000% | inf |
| `HOSTBUF_REPACK` | 0 | 784 | 175,370,565.885071 | 255,755,840 | 0.000% | inf |

The flush arm reported no sync failure and did not change KLD. Uncached allocation
was confirmed in its log (`HOST RPCMEM allocation flags=0 uncached=1`) and also
did not change KLD. These outcomes do not support cache coherence as the cause.
The repack arm remained numerically identical to raw `-HOST`, but its log did not
contain the expected `HOST repack experiment uses tiled weight layout` marker.
Although the requested environment variable was set, the log does not prove the
setter repack branch ran; therefore this arm cannot establish or rule out a
layout fix. **Verdict: unresolved; coherence is disfavored, while layout remains
open.** Next, instrument the repack option at backend initialization and the
host-buffer setter, verify the marker and tensor-write count, then repeat only
the repack KLD arm against this same base.

All three runs passed pre/post gates and force-stop checks. They remained Awake
with `AC powered=true`, battery 74–77%, temperature 34.1–39.0 °C, thermal status
0–1, and traced 0; screen stay-on returned exit 0. Per-run gates, binary logs,
exact payload hashes, push receipts, and the first incomplete attempt are under
`raw/hostbuf-correctness-20260928/`. Summary values and hashes are also in
`raw/hostbuf-correctness-20260928/results.txt`. The phone remained plugged after
the final gate, so the separate unplugged A/B/C heat campaign has not resumed.
