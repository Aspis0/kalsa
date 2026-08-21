# Task #3 — upstream #26476 S23 verification manifest

Date: 2026-08-21 (America/New_York)

Result: **PASS**. Upstream PR #26476 commit `6503355df0eb4f65875012523263c302fe0088c1` was cherry-picked and finalized as local commit `5c7e16fa682834ee4d4ba9dca8a18b283af95393`. Dense q6_K flat `MUL_MAT` is 925/925; `MUL_MAT_ID` remains 401/401.

## Scope and device

- Engine submodule: `BigMoeOnEdge/third_party/llama.cpp`
- Branch: `kalsa/kernel-s3-repack`
- Final submodule commit: `5c7e16fa682834ee4d4ba9dca8a18b283af95393`
- CMake build-time commit string: `532ac356c` (the final amend changed commit metadata only; the Git tree is identical)
- Device: Galaxy S23 `SM-S911U`, Adreno 740, board `kalama`
- Serial: `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`
- Device run directory: `/data/local/tmp/s3oracle`
- `s3base`, `s3fix`, and `s3printf` were not touched.
- Pre-deploy state: wireless TLS reachable, AC/USB/wireless powered false, battery 79%, temperature 27.4 °C; `/data` had about 1.8 GiB free as reported by the preflight command.
- Runs were issued from PC-side `adb shell`, not Termux. The PC shell was PowerShell; the Git-Bash `MSYS_NO_PATHCONV=1` prefix was therefore not applicable.

## Build recipe

Existing tree and recipe reused from the previous chapters:

```text
Build tree: build-android-opencl-s3oracle
Generator: Ninja
Configuration: Release, BUILD_SHARED_LIBS=ON, GGML_OPENCL=ON,
  GGML_OPENCL_EMBED_KERNELS=ON, GGML_OPENCL_USE_ADRENO_KERNELS=ON
Android: arm64-v8a, android-29, NDK 27.1.12297006
C:\Users\gualt\AppData\Local\Android\Sdk\cmake\3.22.1\bin\ninja.exe -C build-android-opencl-s3oracle test-backend-ops ggml-opencl -j 8
```

Build exit code was 0. CMake regenerated the embedded q6_K flat kernel header and compiled `ggml-opencl.cpp`; only the existing unused-parameter and TODO pragma warnings appeared.

## Deployment command and PC/device artifact hashes

The deployment first ran:

```text
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell "rm -rf /data/local/tmp/s3oracle; mkdir -p /data/local/tmp/s3oracle/logs"
```

Then it pushed the nine files below to the same directory and ran `chmod 755 /data/local/tmp/s3oracle/test-backend-ops`. The following exact SHA-256 values were confirmed by `sha256sum` on the device after push and again in the pre-run block of **each** run log.

| file | bytes | PC SHA-256 | device SHA-256 |
|---|---:|---|---|
| `libggml-opencl.so` | 8378584 | `b9d99fa8d8be3e40661fb2edbde27229d8666fcc58c481cbb0944dd0cfd36773` | same |
| `libggml.so` | 536880 | `3f07bb31e79da8698635286a1a39dd2f21836e32dff9bdf578a1cce01351fb27` | same |
| `libggml-base.so` | 6103496 | `e51ed14311cec90136ed76cd9755696b0e81c6897b9e0b173d525da9cc3ee8e5` | same |
| `libggml-cpu.so` | 5165056 | `fd9cb4b1f49c60a64eea964a4c19200c2878b74df450bc287cbbe6fdf8dcb0da` | same |
| `libllama.so` | 39807624 | `f8b11fc34be81291c01cc77a657d267eaf7f102ed6cb6ef708bbaab7730a667d` | same |
| `libllama-common.so` | 78377240 | `646bd2d83576e8b6f2755e5ae7d7bee6064cf920bef4a89718a1b9bc115c543d` | same |
| `test-backend-ops` | 10173424 | `21d6110dc147adf249505a9808fc36075eb58b02e688366a112d02629c58bdb1` | same |
| `libc++_shared.so` (NDK aarch64) | 1794776 | `e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6` | same |
| `libomp.so` (NDK clang 18 aarch64) | 1229304 | `ea27efff687f8359fabc728af9a4ea45766714399792344af94b09037d52d0b0` | same |

## Run configuration

Both runs used:

```text
export LD_LIBRARY_PATH=/data/local/tmp/s3oracle
export GGML_OPENCL_LOG_KERNELS=1
unset GGML_OPENCL_HOST_REPACK GGML_OPENCL_DUMP_Q GGML_OPENCL_ORACLE
unset GGML_OPENCL_CVT_OPTS GGML_OPENCL_MOE_OPTS GGML_OPENCL_CVT_VARIANT
```

The runner wrote the complete artifact SHA block to the run stdout **before** invoking the executable, then captured the executable return code and timestamp. No environment override was used.

### Dense run — `q6k_dense`

```text
./test-backend-ops -o MUL_MAT
```

- Device start: `Fri Aug 21 15:14:19 EDT 2026`
- Device end: `Fri Aug 21 15:20:04 EDT 2026`
- Result: **925/925 tests passed**, OpenCL OK, rc 0.
- The ten known dense q6_K flat failures (`m=16`, `n=1..9`, plus repeat `n=1`) are all `OK` in `q6k_dense.out`.
- OpenCL trace includes `kernel_mul_mv_q6_K_f32_flat` and the normal dense q6_K GEMM kernels.
- `q6k_dense.out`: 163776 bytes; PC/device SHA-256 `66bb63a5fc16c86140070a1b0aaea051a40fc917d85cf88acf5d2cf4ed111a21`.
- `q6k_dense.err`: 3722 bytes; PC/device SHA-256 `b2c377f078f9b24e820127e5974769314f89691a91affafdd85edcc3827e2ff8`.

### MoE run — `q6k_mmid`

```text
./test-backend-ops -o MUL_MAT_ID
```

- Device start: `Fri Aug 21 15:20:53 EDT 2026`
- Device end: `Fri Aug 21 15:29:26 EDT 2026`
- Result: **401/401 tests passed**, OpenCL OK, rc 0.
- Relevant totals: q2_K 5, q3_K 5, q4_K 80, q5_K 4, q6_K 3; existing q2/q3/q4/q5/q6 MoE GEMV/GEMM kernel names appear in stderr.
- `q6k_mmid.out`: 78344 bytes; PC/device SHA-256 `c6ba0405d40c7689f08daa1a6d410501e53890431641532a861b190e34ea44e5`.
- `q6k_mmid.err`: 3380 bytes; PC/device SHA-256 `5e32248a12b188813cffc25dcdc0593cef08f95d3fcca96e04f7ee315fa5a3`.

## Raw files

- `q6k_dense.out`, `q6k_dense.err`
- `q6k_mmid.out`, `q6k_mmid.err`
- This manifest
