# Queue #17 — S23 regression re-verify (host-side OpenCL guards)

Date: 2026-08-21 (America/New_York)

Result: **PASS**. Three host-side fixes at `7686ca6fc` do not change E031/Adreno 740 behavior. Correctness only; no speed claims. No commits.

| commit | subject |
|---|---|
| `dc3870579` | opencl: guard q6_K flat workaround by GPU family |
| `8e0063d2a` | opencl: make unknown compiler versions explicit |
| `7686ca6fc` | opencl: skip empty MoE matmul dispatch |

HEAD: `7686ca6fc5685c70f95bf60116dd7c8e5dec01c1` on `kalsa/kernel-s3-repack`. Remotes: none. Parent: `c77fe1354` (barrier-verify).

Device: Galaxy S23 `SM-S911U`, Adreno 740, serial `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`. PC-side `adb shell`. `/data/local/tmp/s3oracle` overwritten in place (GGUF and `s15vk` not clobbered).

## Build

```text
C:\Users\gualt\AppData\Local\Android\Sdk\cmake\3.22.1\bin\ninja.exe -C C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-android-opencl-s3oracle test-backend-ops ggml-opencl llama-bench -j 8
```

CMake re-ran (`ggml commit: 7686ca6fc`). ggml-opencl.cpp.o was force-rebuilt so the three edits are in the shipped `.so`. Ninja exit 0.

## Artifact SHA-256 (PC = device)

| file | bytes | SHA-256 | vs barrier-verify `c77fe1354` |
|---|---:|---|---|
| `libggml-opencl.so` | 8376320 | `f432548328af0429fd0f885ccde70cae69f40666118836c713491602dedd6d6d` | changed (host edits) |
| `libggml.so` | 536880 | `3f07bb31e79da8698635286a1a39dd2f21836e32dff9bdf578a1cce01351fb27` | same |
| `libggml-base.so` | 6103496 | `ed6bba3bd2f539ad044e1cb3ddabae12807bbaa698fbfd41b97e3c9a7f91e85c` | changed (git stamp) |
| `libggml-cpu.so` | 5165056 | `fd9cb4b1f49c60a64eea964a4c19200c2878b74df450bc287cbbe6fdf8dcb0da` | same |
| `libllama.so` | 39807624 | `f8b11fc34be81291c01cc77a657d267eaf7f102ed6cb6ef708bbaab7730a667d` | same |
| `libllama-common.so` | 78377240 | `e58ece316ea0d8f829b748c8b663ac2bc2b53e66272c22f530291fd06a0a5200` | changed (`build-info`) |
| `test-backend-ops` | 10182432 | `9a3fd4b07dd2edce2723ce2d17503f76d2b6bea0d254d616e3de199456b587bc` | same |
| `llama-bench` | 7600 | `b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c` | same |
| `libllama-bench-impl.so` | 4253160 | `8adc148c0909e8ebbbf6ed41970b2c07ac0319db96454ad0dd7b2f281a9b8807` | same |
| `libc++_shared.so` | 1794776 | `e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6` | same |
| `libomp.so` | 1229304 | `ea27efff687f8359fabc728af9a4ea45766714399792344af94b09037d52d0b0` | same |

SHA block repeated in each run log before the executable.

Env (both runs):

```text
export LD_LIBRARY_PATH=/data/local/tmp/s3oracle
export GGML_OPENCL_LOG_KERNELS=1
unset GGML_OPENCL_HOST_REPACK GGML_OPENCL_DUMP_Q GGML_OPENCL_ORACLE
unset GGML_OPENCL_CVT_OPTS GGML_OPENCL_MOE_OPTS GGML_OPENCL_CVT_VARIANT
```

## MUL_MAT_ID

`./test-backend-ops -o MUL_MAT_ID`

- Start/end: `Fri Aug 21 22:25:25` – `22:26:36 EDT 2026`
- **407/407 tests passed**, OpenCL OK, rc 0
- m=96 q2/q3/q4/q5/q6 GEMV+GEMM all OK
- `mmid.err` SHA-256 `5e32248a12b188813cffc25dcdc0593cef08a3f95d3fcca96e04f7ee315fa5a3` — **bit-identical** to barrier-verify `mmid.err`

## MUL_MAT + q6_K ADRENO_OLD_COMPILER gate

`./test-backend-ops -o MUL_MAT`

- Start/end: `Fri Aug 21 22:26:53` – `22:28:38 EDT 2026`
- **925/925 tests passed**, OpenCL OK, rc 0
- Driver: `OpenCL 3.0 QUALCOMM build: 0676.73 Compiler E031.41.03.62`
- q6_K flat m=16 n=1..9 plus repeat n=1: all **OK** (these fail if the scalar `ADRENO_OLD_COMPILER` path is not compiled in)
- Dispatch: `GGML_OPENCL_LOG_KERNELS: kernel_mul_mv_q6_K_f32_flat` (not `kernel_mul_mv_q6_K_f32`)
- `dense.err` SHA-256 `b2c377f078f9b24e820127e5974769314f89691a91affafdd85edcc3827e2ff8` — **bit-identical** to barrier-verify `dense.err`

Gate reconstruction on this log: `gpu_family==ADRENO` (device Adreno 740) AND compiler type `E031` AND `!(E031 >= 45.0.0)` because major=41 → `q6_k_flat_old_compiler` remains **TRUE**. The `dc3870579` `gpu_family==ADRENO` conjunct does not flip the gate on this device. Kernel choice unchanged. m=16 cases did not regress.

## Verdicts

| item | verdict |
|---|---|
| MUL_MAT_ID | **407/407 PASS** (unchanged) |
| MUL_MAT | **925/925 PASS** (unchanged) |
| q6_K flat ADRENO_OLD_COMPILER gate | **unchanged TRUE** on E031.41.03.62 |
| `ne01==0` guard | not device-exercised (no empty tensor in these suites); does not affect 407/407 |
| UNKNOWN_COMPILER parser | not taken (driver string is E031); no behavior change |

## Raw files

`pc_sha256.txt`, `device_sha256.txt`, `deploy.log`, `ninja_build.log`, `ninja_rebuild_opencl.log`, `run_one.sh`, `mmid.{out,err,rc}`, `dense.{out,err,rc}`, `evidence_sha256.txt`, this manifest.

Narrative: `scratchpad/agents/q17-verify/REPORT.md`.
