# Barrier-port + llama-bench `-nr` S23 verification manifest

Date: 2026-08-21 (America/New_York)

Result: **PASS** (correctness only; no speed claims). Engine head `c77fe135456b878e78f2840555eeb4acda34dda8`. Queue #13 barrier-safe q4/q5/q6 MoE kernels (`9a4112106`) plus queue #11 llama-bench `-nr` (`815b8edc2` / `c77fe1354`).

| item | verdict |
|---|---|
| barrier-port device | **VERIFIED** — MUL_MAT_ID **407/407**, isolated m=96 **10/10**, q4/q5/q6 GEMV+GEMM dispatched on m=96 |
| #26476 dense q6_K flat | **still green** — MUL_MAT **925/925** |
| q4 ILA residual | **resolved** — ILA path compiled out; source `kernel_gemm_moe_q4_k_f32_ns` dispatched, never `_ila` |
| llama-bench `-nr` smoke | **PASS** — (a) SKIP (RAM margin); (b) `-nr` jsonl rc=0 `no_repack=true`; (c) `--no-extra-bufts` md rc=0 `no_repack=1` |
| `ne01==0` wrap | **open / not device-testable** (same positive-row precondition as q2/q3) |

## Scope and device

- Engine submodule: `BigMoeOnEdge/third_party/llama.cpp`
- Branch: `kalsa/kernel-s3-repack`
- HEAD: `c77fe135456b878e78f2840555eeb4acda34dda8`
- Remotes: none (confirmed `git remote -v` empty; nothing was committed or pushed)
- Device: Galaxy S23 `SM-S911U`, Adreno 740, board `kalama`
- Serial: `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`
- Device run directory: `/data/local/tmp/s3oracle` (recreated; GGUFs preserved)
- `s3base`, `s3fix`, and `s3printf` were not touched
- Runs issued from PC-side `adb shell`, not Termux
- Preflight: AC powered (plugged is in-scope), battery 54%, temperature 27.3 °C, `MemAvailable` 4053568 kB, `/data` ~8.8 GiB free
- Driver in every OpenCL log: `OpenCL 3.0 QUALCOMM build: 0676.73 Compiler E031.41.03.62`

## Build recipe

```text
Build tree: C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-android-opencl-s3oracle
Generator: Ninja
Configuration: Release, BUILD_SHARED_LIBS=ON, GGML_OPENCL=ON,
  GGML_OPENCL_EMBED_KERNELS=ON, GGML_OPENCL_USE_ADRENO_KERNELS=ON
  GGML_OPENCL_USE_ADRENO_BIN_KERNELS: not in CMakeCache (ILA path compiled out)
Android: arm64-v8a, android-29, NDK 27.1.12297006
C:\Users\gualt\AppData\Local\Android\Sdk\cmake\3.22.1\bin\ninja.exe -C build-android-opencl-s3oracle test-backend-ops ggml-opencl llama-bench -j 8
```

Ninja exit 0, `ninja: no work to do`. Artifact mtimes are after the `9a4112106` / `815b8edc2` / `c77fe1354` source mtimes (`pc_timestamps.txt`). Working tree clean.

## Deployment

GGUFs in the old `s3oracle` were moved to `/data/local/tmp/_gguf_keep/` before `rm -rf`. After recreate, OLMoE was moved back into `s3oracle`. Mellum2 remains in `_gguf_keep` (not deleted). LFM2.5-KEXP is `/data/local/tmp/LFM2.5-8B-A1B-KEXP.gguf`.

The eleven files below were then pushed and `chmod 755` applied to `test-backend-ops` and `llama-bench`. SHA-256 values were confirmed on the device after push (`device_sha256.txt`) and again in the pre-run SHA block of **each** run log.

| file | bytes | PC SHA-256 | device SHA-256 |
|---|---:|---|---|
| `libggml-opencl.so` | 8381304 | `bbd700de84e32c30c7ea68725e6ed553c5ac25d842f7d0d9b4271917f79f81ea` | same |
| `libggml.so` | 536880 | `3f07bb31e79da8698635286a1a39dd2f21836e32dff9bdf578a1cce01351fb27` | same |
| `libggml-base.so` | 6103496 | `2e16b95119208c7bb70cf3be444670611259a050480e9923f2790541d3e489a8` | same |
| `libggml-cpu.so` | 5165056 | `fd9cb4b1f49c60a64eea964a4c19200c2878b74df450bc287cbbe6fdf8dcb0da` | same |
| `libllama.so` | 39807624 | `f8b11fc34be81291c01cc77a657d267eaf7f102ed6cb6ef708bbaab7730a667d` | same |
| `libllama-common.so` | 78377240 | `7547a07298165871f415b835bc66852713ca02afcc43c0d3e3abcb2eca8be2c8` | same |
| `test-backend-ops` | 10182432 | `9a3fd4b07dd2edce2723ce2d17503f76d2b6bea0d254d616e3de199456b587bc` | same |
| `llama-bench` | 7600 | `b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c` | same |
| `libllama-bench-impl.so` | 4253160 | `8adc148c0909e8ebbbf6ed41970b2c07ac0319db96454ad0dd7b2f281a9b8807` | same |
| `libc++_shared.so` (NDK aarch64) | 1794776 | `e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6` | same |
| `libomp.so` (NDK clang 18 aarch64) | 1229304 | `ea27efff687f8359fabc728af9a4ea45766714399792344af94b09037d52d0b0` | same |

Fixture GGUFs (not rebuilt; hashed on-device in `presmoke.txt`):

| file | bytes | device SHA-256 |
|---|---:|---|
| `/data/local/tmp/s3oracle/OLMoE-1B-7B-0924-Instruct-Q4_K_M.gguf` | 4213513024 | `3bd9ec48045f526508956ef663c5c11dbb3ef791a06f4e10a6be88379c40e1fe` (n10 pin) |
| `/data/local/tmp/LFM2.5-8B-A1B-KEXP.gguf` | (aboard) | `b07c80870f8a864549f4a419ccbfb4d4282ba2d55a2e8d808b7c377d3fc6c3f4` |

## Run configuration

```text
export LD_LIBRARY_PATH=/data/local/tmp/s3oracle
export GGML_OPENCL_LOG_KERNELS=1
unset GGML_OPENCL_HOST_REPACK GGML_OPENCL_DUMP_Q GGML_OPENCL_ORACLE
unset GGML_OPENCL_CVT_OPTS GGML_OPENCL_MOE_OPTS GGML_OPENCL_CVT_VARIANT
```

Runner: `run_one.sh` writes the SHA block to stdout **before** the executable, then rc and timestamps.

### MoE run — `mmid` (`./test-backend-ops -o MUL_MAT_ID`)

- Device start: `Fri Aug 21 20:55:38 EDT 2026`
- Device end: `Fri Aug 21 20:57:25 EDT 2026`
- Result: **407/407 tests passed**, OpenCL OK, rc 0
- +6 vs q6k_cherry 401/401: q4_K/q5_K/q6_K `m=96` `n=1` (GEMV) and `n=4` (GEMM), all `OK`
- Unique-case diff vs q6k_cherry: 0 old-OK missing, 0 regressions, 6 added, 0 new-bad (`baseline401_subset.txt`)
- No FAIL / ERR / hang / SIGSEGV
- `mmid.out` 79080 bytes, SHA-256 `26e8ebe2c7f5f787ebccd00d036298b0331dac50674dbac25448f205660aad90`
- `mmid.err` 3380 bytes, SHA-256 `5e32248a12b188813cffc25dcdc0593cef08a3f95d3fcca96e04f7ee315fa5a3`

### Isolated m=96 dispatch control — `mmid_m96` (`-o MUL_MAT_ID -p m=96`)

Required because `GGML_OPENCL_LOG_KERNELS` logs each kernel name **once**. A full-suite log cannot attribute q4/q5/q6 names to the m=96 cases (those kernels already dispatched on earlier `%64` shapes).

- Device start/end: `20:58:49`–`20:59:14 EDT 2026`
- Result: **10/10 tests passed**, rc 0
- Only the ten m=96 discriminators ran (4 q2/q3 + 6 new q4/q5/q6)
- Dispatch evidence (`mmid_m96.err`):

```text
GGML_OPENCL_LOG_KERNELS: kernel_gemv_moe_q2_k_f32_ns
GGML_OPENCL_LOG_KERNELS: kernel_gemv_moe_q3_k_f32_ns
GGML_OPENCL_LOG_KERNELS: kernel_moe_histogram
GGML_OPENCL_LOG_KERNELS: kernel_moe_scan
GGML_OPENCL_LOG_KERNELS: kernel_moe_fill
GGML_OPENCL_LOG_KERNELS: kernel_moe_scatter
GGML_OPENCL_LOG_KERNELS: kernel_moe_reorder_b
GGML_OPENCL_LOG_KERNELS: kernel_gemm_moe_q2_k_f32_ns
GGML_OPENCL_LOG_KERNELS: kernel_gemm_moe_q3_k_f32_ns
GGML_OPENCL_LOG_KERNELS: kernel_gemv_moe_q4_k_f32_ns
GGML_OPENCL_LOG_KERNELS: kernel_gemv_moe_q5_k_f32_ns
GGML_OPENCL_LOG_KERNELS: kernel_gemv_moe_q6_k_f32_ns
GGML_OPENCL_LOG_KERNELS: kernel_gemm_moe_q4_k_f32_ns
GGML_OPENCL_LOG_KERNELS: kernel_gemm_moe_q5_k_f32_ns
GGML_OPENCL_LOG_KERNELS: kernel_gemm_moe_q6_k_f32_ns
```

No `_ila` name. q4/q5/q6 MoE GEMV (`n=1`) and GEMM (`n=4`) ran on the padded m=96 shapes against the CPU reference. Not a CPU fallback.

### Dense run — `dense` (`./test-backend-ops -o MUL_MAT`)

- Device start: `Fri Aug 21 21:00:12 EDT 2026`
- Device end: `Fri Aug 21 21:04:34 EDT 2026`
- Result: **925/925 tests passed**, OpenCL OK, rc 0
- The ten known dense q6_K flat cases (`m=16`, `n=1..9`, plus the later repeat `n=1`) are all `OK`
- OpenCL trace includes `kernel_mul_mv_q6_K_f32_flat`
- `dense.out` 163978 bytes, SHA-256 `76519e9ad8f9f24890c8d89731d4035ffd5b83fcb4905757451faae7d4768771`
- `dense.err` 3722 bytes, SHA-256 `b2c377f078f9b24e820127e5974769314f89691a91affafdd85edcc3827e2ff8`

### q4 ILA residual

Source-compiled path taken. ILA binary path not taken.

- CMake: `GGML_OPENCL_USE_ADRENO_BIN_KERNELS` absent → `use_adreno_bin_kernels()` compile-time false; no `dl_load_library(KERNEL_LIB_NAME)`
- No log line `loaded bin kernel library` / `failed to load` in any `*.err` (compiled-out, not a runtime miss)
- Dispatched name is `kernel_gemm_moe_q4_k_f32_ns`, never `kernel_gemm_moe_q4_k_f32_ns_ila`
- Host therefore takes the mask-arg branch at `ggml-opencl.cpp:23203-23209` (new signature) rather than the old 13-arg ILA signature

### llama-bench `-nr` smoke (functional, plugged, not a speed cell)

`./llama-bench -h` lists `-nr, --no-repack` (default disabled). `--no-extra-bufts` is accepted as a legacy alias in the parser; it is not printed in `-h`.

Headroom before smoke: `MemAvailable` 4754704 kB (~4.53 GiB). OLMoE Q4_K_M is 3.92 GiB. 2 GiB margin over the model is 5.92 GiB. **Arm (a) SKIPPED.**

| arm | flags | format | rc | repack field | notes |
|---|---|---|---:|---|---|
| (a) default | none | — | — | — | SKIP: 4.53 GiB avail < 3.92 GiB model + 2 GiB margin. Stock extra_bufts of OLMoE Q4_K is oomwall-class. |
| (b) `-nr` | `-ngl 0 -p 0 -n 8 -r 1 -nr -o jsonl` | jsonl | 0 | `no_repack: true` | `build_commit=c77fe1354`, `n_gpu_layers=0`, `n_gen=8`. JSON parsed OK. |
| (c) `--no-extra-bufts` | `-ngl 0 -p 0 -n 8 -r 1 --no-extra-bufts -o md` | md | 0 | `no_repack = 1` | Well-formed markdown table. Same binary pins. |

No tg512. Throughput numbers appear in llama-bench's default columns; they are **not** recorded as claims.

## Raw files

- `pc_sha256.txt`, `pc_timestamps.txt`, `device_sha256.txt`, `preflight.txt`, `deploy.log`, `ninja_build.log`, `presmoke.txt`, `evidence_sha256.txt`
- `run_one.sh`
- `mmid.out` / `mmid.err` / `mmid.rc`
- `mmid_m96.out` / `mmid_m96.err` / `mmid_m96.rc`
- `dense.out` / `dense.err` / `dense.rc`
- `baseline401_subset.txt`
- `bench_nr.out` / `bench_nr.err` / `bench_nr.rc`
- `bench_alias.out` / `bench_alias.err` / `bench_alias.rc`
- This manifest

Narrative: `scratchpad/agents/barrier-verify/REPORT.md`.
