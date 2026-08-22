# Gate #26b — Mali OpenCL real-matmul probe (Jelly / Mali-G57)

**Status:** DONE (Gate 3 complete — portability not sufficient for Q4_K ship path)  
**Owner-approved:** yes  
**Device:** Unihertz Jelly Star, Mali-G57 MC2, serial `192.168.1.82:35785` (product `Jelly_Star`). **PLUGGED / AC** the entire cell (level 100, GPU ~38→42 °C). S23 `SM_S911U` and Xiaomi `houji` were attached on adb and **not touched**.  
**Timebox:** ~2.5h  
**Lineage:** worktree `C:\Users\gualt\Desktop\Kalsa\moe-experiments\worktree-mali-probe` / branch `kalsa/mali-probe` off `kalsa/kernel-s3-repack` @ `1882bf8cd`. Engine checkout `BigMoeOnEdge/third_party/llama.cpp` was **not** switched (still `kalsa/kernel-s3-repack` @ `1882bf8cd`).  
**Env gate:** `GGML_OPENCL_ALLOW_UNKNOWN_GPU` — unset/`0` = historical allowlist drop; any other value (e.g. `1`) accepts `GPU_FAMILY::UNKNOWN`.  
**Probe branch: never merge.**

## 0. Pointers

| Item | Path |
|------|------|
| This report | `scratchpad/agents/q26b-mali-probe/REPORT.md` |
| Raw logs | `results/mali_gate_jelly/raw2/` |
| First-gate drop | `results/mali_gate_jelly/raw/ocl_*.out` |
| Worktree | `worktree-mali-probe` (`kalsa/mali-probe`) |
| Build dir | `build-android-mali-probe` |
| Device workdir | `/data/local/tmp/kalsa26/ocl2` |
| Engine (untouched) | `BigMoeOnEdge/third_party/llama.cpp` @ `1882bf8cd` |

## 1. Session log

| Step | Result |
|------|--------|
| worktree | `git worktree add worktree-mali-probe -b kalsa/mali-probe 1882bf8cd`. Engine checkout unchanged. |
| patch | UNKNOWN env-gated; Intel-like generic launch; Adreno kernels/ILA/bin/MoE-ragged skipped; GDN skipped; q6_K workaround stays `ADRENO && E031`. |
| commit 1 | `836813816` `opencl: env-gate UNKNOWN GPU family (mali probe, do not merge)` |
| commit 2 | `5a5dd9b73` `opencl: non-fatal kernel compile on UNKNOWN GPU (mali probe)` — ARM compiler errors are data; load continues. |
| push | `origin/kalsa/mali-probe` on kalsallama (`836813816..5a5dd9b73`) |
| cmake | `build-android-mali-probe`, same style as s3oracle: NDK 27.1, android-29, ninja 3.22.1, `GGML_OPENCL=ON`, embed ON, Adreno kernels ON (skipped at runtime). |
| build | ninja `test-backend-ops llama-bench ggml-opencl` exit 0 |
| device | Jelly only. LF runner `run_ocl2.sh` (od `23 21 … 0a`). KEYCODE_WAKEUP before runs. PC sha256 == device sha256. |

## 2. PC — patch

`ggml/src/ggml-opencl/ggml-opencl.cpp` on `kalsa/mali-probe` only.

- `ggml_opencl_is_device_supported`: `GPU_FAMILY::UNKNOWN` no longer `return false` when `GGML_OPENCL_ALLOW_UNKNOWN_GPU` is truthy. Control (unset) still drops Mali — reproduced on device.
- `GGML_OPENCL_USE_ADRENO_KERNELS` non-Adreno reject: UNKNOWN+env continues; Intel still rejected if Adreno kernels are compiled in (unchanged).
- UNKNOWN launch uses `ggml_opencl_use_intel_like` (portable 16-wide path, not Adreno wave-64). FA split that was `!= INTEL` (which included UNKNOWN) is now `== ADRENO`.
- Adreno-tuned kernel compile block, ILA binaries, bin-kernel dload, MoE-ragged default: Adreno-only.
- `q6_k_flat_old_compiler` still `ADRENO && E031` (dc3870579). Mali ARM driver is `UNKNOWN_COMPILER` (8e0063d2a) — Adreno workarounds stay off.
- GDN: skip compile + `supports_op` false (no portable subgroup size).
- Second commit: `load_cl_kernels` non-fatal on UNKNOWN so a 1d-quant kernel that needs `INTEL_GPU`/`ADRENO_GPU` macros does not `exit(1)` before f32.

**Build:** Release, `GGML_OPENCL_USE_ADRENO_KERNELS=ON`, `GGML_OPENCL_EMBED_KERNELS=ON`. ggml commit in cache: `5a5dd9b73`.

### Artifact hashes (PC == device) — final probe binary

| File | sha256 | bytes |
|------|--------|------:|
| `libggml-opencl.so` | `afd668dc59c008ad7a7ab3a9c2f619f113dc2cc5a1edef6e2df9b94d7fdfea81` | 8343848 |
| `libggml.so` | `f888a721797a97cb1d9f8072d71865433c49d6b9c1841fa9861a81d84c50eab0` | 536616 |
| `libggml-base.so` | `fbd1802c49ad99432aa6f18c1104ad92212a816013f60f0778ad5ad3c8f8fb87` | 6102384 |
| `libggml-cpu.so` | `122fa99ecd5a2e850f6b4a2feb0b4bd0d15523f372a887e91e31b540380f2a77` | 5163080 |
| `libllama.so` | `1a8619839b6b4f98727de752f839aa5d24d1ce8002143174c564950dbc41c8a5` | 39741552 |
| `libllama-common.so` | `0e8ddb068642a3de4734f02306b6f8aa3c608467e9e723f5704270ce9a627b00` | 78074600 |
| `test-backend-ops` | `4680be0d0e1c9656d6f2121d4d493889964c18e23f0b6bc1e60e03981d0a575e` | 10179936 |
| `llama-bench` | `e3ab93f14d88bf9e6509cff5ddb6cdf17cb389ffc3526c4ff19588a0d1aab0e9` | 7568 |
| `libllama-bench-impl.so` | `b9be488495f9d4f8b1511e0617158d4eb353dccaa566d8bed2f1dc5c529e3446` | 4252928 |
| `libc++_shared.so` | `e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6` | 1794776 |
| `libomp.so` | `ea27efff687f8359fabc728af9a4ea45766714399792344af94b09037d52d0b0` | 1229304 |

## 3. Device

**Jelly serial:** `192.168.1.82:35785` (not S23, not houji).  
**PLUGGED.** AC powered, level 100, HAL GPU 38.0 °C → 42.1 °C.  
Workdir `/data/local/tmp/kalsa26/ocl2`. Scripts LF-only.

## 4. Backend registration

| env | outcome | PLUGGED |
|-----|---------|---|
| unset | platform `ARM Platform`, device `Mali-G57 MC2 r0p1`, **`unsupported GPU` + `drop unsupported device`**. Only CPU. Same as gate #26. | PLUGGED |
| `GGML_OPENCL_ALLOW_UNKNOWN_GPU=1` | **registers `GPUOpenCL`**. Logs: family UNKNOWN, skip Adreno kernels, generic path. Device 7777 MB, FP16 true, max WG 512, subgroup shuffle false, vector subgroup broadcast false. | PLUGGED |

Backend name: **`GPUOpenCL`**. Raw: `raw2/ocl_noenv_badbackend.*`, `raw2/ocl_env_badbackend.*`.

Init extras (with env): OpenCL 3.0, mem align 128 B, IMAGE align 32 B, `cl_khr_fp16` yes, `cl_qcom_*` no.

## 5. `test-backend-ops test -b GPUOpenCL -o MUL_MAT`

ARM compiler errors = **DATA**. First fatal build (`836813816`) died at first 1d-quant kernel (`exit(1)`). Soft-compile build (`5a5dd9b73`) continues.

| type | compile (portable kernel) | run | result | PLUGGED |
|------|---------------------------|-----|--------|---|
| f32 | yes (generic `mul_mv_f32`) | yes | **202/202 OK**, rc 0, ~19 s including kernel load | PLUGGED |
| f16 | partial | 12 OK then SIGABRT 134 | first 12 GEMV-like shapes OK; next shape `clSetKernelArg` on NULL specialized kernel (`ggml-opencl.cpp:20318`, CL_INVALID_KERNEL −48) | PLUGGED |
| q4_0 | 1d kernels **fail frontend** (`N_SIMDGROUP`/`N_DST`/`N_SIMDWIDTH` undeclared) | SIGABRT 134 before any test line | intel-like dispatch picks 1d_16x_flat which is NULL (`:20440`) | PLUGGED |
| q8_0 | same class | SIGABRT 134, 0 tests | same | PLUGGED |
| q4_K | same class | SIGABRT 134, 0 tests | same | PLUGGED |
| q6_K | same class | SIGABRT 134, 0 tests | same | PLUGGED |
| q2_K | n/a | 0/0 | backend does not claim the op | PLUGGED |
| q3_K | n/a | 0/0 | backend does not claim the op | PLUGGED |

First compiler error (verbatim, ARM OpenCL C frontend, err=−11, code 62):

```text
<source>:108:27: error: use of undeclared identifier 'N_SIMDGROUP'
<source>:108:63: error: use of undeclared identifier 'N_DST'
<source>:119:16: error: use of undeclared identifier 'N_DST'
<source>:127:38: error: use of undeclared identifier 'N_SIMDWIDTH'
error: Compiler frontend failed (error code 62)
```

Those macros are `#ifdef INTEL_GPU` / `#elif ADRENO_GPU` in `mul_mv_q4_0_f32_1d_*.cl` etc. Both defines come from `cl_intel_required_subgroup_size` / `cl_qcom_reqd_sub_group_size`. Mali has neither, so the “generic” 1d quant kernels are not portable C.

Second error class (also in the 32 compile-fail blocks):

```text
error: loading directly from pointer to type '__global half' requires cl_khr_fp16.
Use vector data load builtin functions instead
```

Device **does** expose `cl_khr_fp16`; the ARM compiler still rejects some `half*` loads that Adreno accepts. 32 `kernel compile error` blocks + 36 `CL_CHECK` errors in `raw2/ocl_mm_f32.err`.

f32 202/202 is correctness, not speed. Raw: `raw2/ocl_mm_f32.{out,err}`, `ocl_mm_f32_fatal_first.err` (all-or-nothing first attempt), `ocl_mm_{f16,q4_0,q8_0,q4_K,q6_K,q2_K,q3_K}.*`.

## 6. `test-backend-ops test -b GPUOpenCL -o MUL_MAT_ID`

| type | result | PLUGGED |
|------|--------|---|
| f32 | all cases `not supported [OpenCL]` (0 executed). rc 0 | PLUGGED |
| f16 | same, not supported | PLUGGED |
| q4_0 | SIGABRT 134, 0 tests (NULL kernel, same −48) | PLUGGED |
| q4_K | SIGABRT 134, 0 tests | PLUGGED |

MoE path in this backend is Adreno/Intel 1d kernels, not a portable f32 fallback. Raw: `raw2/ocl_mmid_*.{out,err}`.

## 7. llama-bench

**SKIP.** Dense f32 MUL_MAT is healthy; the GGUFs already on Jelly are Q4_K_M / Q4_0. GPU ngl 99 would hit the aborting quant path (q4_K/q4_0 SIGABRT 134 on first op). No f32/f16 GGUF on device. 3–5× prefill comparison is **not measurable** in this cell.

On-device hashes:

| path | sha256 | bytes |
|------|--------|------:|
| `/data/local/tmp/llamabench/Qwen3.5-2B-Q4_K_M.gguf` | `aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223` | 1280835840 |
| `/data/local/tmp/llamabench/Qwen3.5-2B-Q4_0.gguf` | `cd70221bebaee0503e0f6717e174250cd7825aa88438b3aabec9ad55731d9bb1` | 1214873856 |

## 8. Verdict

**Mali OpenCL stack is REAL for portable f32 GEMM. The “generic” quantized kernels are not generic and do not even parse on the ARM compiler. Dedicated Mali kernels are justified for the ship path (Q4_K / Q4_0 / MoE). Do not read a 3–5× prefill number out of this cell.**

Framing vs the three buckets:

| bucket | this cell |
|--------|-----------|
| Compiles + passes + 3–5× prefill | **f32 MUL_MAT only** (202/202). Prefill N/A (no matching GGUF; quant path dead). |
| Compiles but garbage | **not observed.** Failures are compile-front-end or NULL-kernel abort, not wrong numbers. |
| Won’t compile | **quant 1d / Intel-or-Adreno-ifdef kernels** (32 programs). Error class: undeclared `N_SIMDGROUP`/`N_DST`/`N_SIMDWIDTH`; plus ARM `half*` load rule. |

What this proves: llama.cpp OpenCL on Mali-G57 can enumerate, compile `cl_khr_subgroups` portable f32 matmul, and match CPU on 202 shapes. Gate #26’s allowlist drop was the only thing between us and that. What it does not prove: quantized GEMM, MoE `MUL_MAT_ID`, or any tok/s.

Next engineering (not this gate): (1) portable `#else` SIMD macros + `vload_half` for quant kernels, **or** (2) Mali-specific kernels from scratch. (1) is a compiler-portability patch; (2) is the dedicated-kernel project. f32 proof-of-life says OpenCL on G57 is worth that work.

## 9. What this does NOT claim

- Not a ship decision, not unplugged, not thermal-steady.
- Not Adreno-tuned kernels on Mali (explicitly skipped).
- Not “quantized models run on Mali OpenCL”.
- Not a 3–5× prefill number.
- Branch `kalsa/mali-probe` must not land on `kalsa/kernel-s3-repack`.
- Engine fork checkout was not switched.

**PLUGGED** everywhere.

---

# Gate 3 — portability patch (quant kernels on Mali)

**Status:** IN PROGRESS  
**Owner GO:** yes  
**Timebox:** ~3h  
**Branch:** `kalsa/mali-probe` only. **NEVER MERGE** to `kalsa/kernel-s3-repack`.  
**Raw:** `results/mali_gate_jelly/raw3/`  
**Device:** Jelly Star **PLUGGED**. Same rules: adb only, no sleep >60s, KEYCODE_WAKEUP, LF-only.

## G3.0 Plan

1. Class 1: `#else` portable `N_SIMDGROUP` / `N_DST` / `N_SIMDWIDTH` on 1d quant kernels (warp 16, Intel-like conservative). Do not touch Adreno/Intel branches.
2. Class 2: `half*` loads → `vload_half` / `vstore_half` where ARM frontend rejected them.
3. q2_K / q3_K claim on UNKNOWN: only if kernels actually compile; else leave out and annotate.
4. Rebuild `build-android-mali-probe`, sha256, push, retest MUL_MAT + MUL_MAT_ID, llama-bench iff a quant type passes.

## G3.1 Session log

| UTC | Step | Result |
|-----|------|--------|
| (skeleton) | dirs | `results/mali_gate_jelly/raw3/` |

## G3.2 Patch notes

_TBD_

## G3.3 Artifact hashes (PC == device)

| File | sha256 | bytes |
|------|--------|------:|
| | | |

## G3.4 MUL_MAT (quant)

| type | compile | run | pass/fail/ERR | notes |
|------|---------|-----|---------------|-------|
| q4_0 | | | | |
| q8_0 | | | | |
| q4_K | | | | |
| q6_K | | | | |
| q2_K | | | | |
| q3_K | | | | |

## G3.5 MUL_MAT_ID

| type | compile | run | pass/fail/ERR | notes |
|------|---------|-----|---------------|-------|
| q4_0 | | | | |
| q8_0 | | | | |
| q4_K | | | | |
| q6_K | | | | |

## G3.6 llama-bench (only if a quant type passes)

**PLUGGED.** pp128 + pp512, 3 reps, ngl 99 vs ngl 0.

| config | ngl | pp | t/s (3 reps) | GPU temp pre/post | notes |
|--------|-----|----|--------------|-------------------|-------|
| | | | | | |

## G3.7 Verdict

- (a) quant compiles+passes+prefill within 3–5× plausible → Mali lane REAL with portability patches only.
- (b) compiles+passes but prefill garbage → paper confirmed; Mali-tuned kernels needed (owner decision).
- (c) still won’t compile / garbage → remaining Adreno assumptions.

**VERDICT:** _TBD_

