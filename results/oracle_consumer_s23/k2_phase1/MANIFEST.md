# K2 phase 1 — device run manifest

Device: Galaxy S23 `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` (SM_S911U / Adreno 740). Jelly Star `192.168.1.82:39591` NOT used. `s3base`/`s3fix`/`s3printf` UNTOUCHED.

Build: `moe-experiments/build-android-opencl-s3oracle`, llama.cpp `55f43a574`.

## PC artifacts (HEAD rebuild 2026-08-20 19:32)

| artifact | bytes | sha256 |
|---|---:|---|
| `libggml-opencl.so` | 8022056 | `d88a8301429365eecf128dc488e0a49c94b684db8762f50b044cac7e97ccd5a8` |
| `test-backend-ops` | 10166824 | `e5f2ecd431eae87cdb7a6fcb6197976b71eb8fa901b0d7338ae6d607b568503c` |
| `libggml.so` | 536880 | `3f07bb31e79da8698635286a1a39dd2f21836e32dff9bdf578a1cce01351fb27` |
| `libggml-base.so` | 6103496 | `7c4a575e4c6c97b8ca06f2e5d202e8a546b284c78a811f146d3d3ccff06f59ec` |
| `libggml-cpu.so` | 5165056 | `fd9cb4b1f49c60a64eea964a4c19200c2878b74df450bc287cbbe6fdf8dcb0da` |
| `libllama.so` | 39807624 | `f8b11fc34be81291c01cc77a657d267eaf7f102ed6cb6ef708bbaab7730a667d` |
| `libllama-common.so` | 78377240 | `f901fa499c0e036666b124d2bf9d65d7ecc1c028059acc447d9306d949d886c8` |
| `libc++_shared.so` (NDK aarch64) | 1794776 | `e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6` |
| `libomp.so` (NDK clang 18 aarch64) | 1229304 | `ea27efff687f8359fabc728af9a4ea45766714399792344af94b09037d52d0b0` |

## Push 2026-08-20 — `/data/local/tmp/s3oracle` recreated

On-device `sha256sum` **PC==device for every artifact**. On-device `libggml-opencl.so` = `d88a8301429365eecf128dc488e0a49c94b684db8762f50b044cac7e97ccd5a8`.

`/data` 21G free. USB also attached as `R3CW406P8CV` (same S23); all commands used the TLS serial.

## Runs

### E0_q6 — HEAD reproduction q6_K
- on-device sha: `d88a8301429365eecf128dc488e0a49c94b684db8762f50b044cac7e97ccd5a8`
- cmd: `./test-backend-ops -o MUL_MAT_ID -p type_a=q6_K`
- env: `LD_LIBRARY_PATH=/data/local/tmp/s3oracle` `GGML_OPENCL_LOG_KERNELS=1`; HOST_REPACK/DUMP_Q/ORACLE/MOE_OPTS/CVT_OPTS unset
- result: **3/3 PASS**. Kernels (stderr): `kernel_moe_histogram/scan/fill/scatter`, `kernel_moe_reorder_b`, `kernel_gemm_moe_q6_k_f32_ns`, `kernel_gemv_moe_q6_k_f32_ns`. **No `_ila`.** q6_K GEMV and GEMM both executed on GPU.
- logs: `e0_q6.out` `e0_q6.err`

### E0_q5 — HEAD reproduction q5_K
- on-device sha: `d88a8301429365eecf128dc488e0a49c94b684db8762f50b044cac7e97ccd5a8`
- cmd: `./test-backend-ops -o MUL_MAT_ID -p type_a=q5_K,`
- env: same as E0_q6 (LOG_KERNELS=1, HOST_REPACK/DUMP_Q/ORACLE/MOE_OPTS/CVT_OPTS unset)
- result: **0/4 FAIL**. ERR = 0.926, 0.862, 0.915, 0.858 (garbage ~1e0, threshold 5e-4). 2 GEMV + 2 GEMM all FAIL. Kernels: `kernel_gemm_moe_q5_k_f32_ns`, `kernel_gemv_moe_q5_k_f32_ns`, `kernel_moe_reorder_b`. **No `_ila`.**
- logs: `e0_q5.out` `e0_q5.err` `e0_q5.summary.txt`

### E0_q4 — HEAD reproduction q4_K
- on-device sha: `d88a8301429365eecf128dc488e0a49c94b684db8762f50b044cac7e97ccd5a8`
- cmd: `./test-backend-ops -o MUL_MAT_ID -p type_a=q4_K,`
- env: same as E0_q6
- result: **0/80 FAIL**. 80/80 ERR lines. Range **0.5667–0.9592**. Kernels: `kernel_gemm_moe_q4_k_f32_ns`, `kernel_gemv_moe_q4_k_f32_ns`, `kernel_moe_reorder_b`. **No `_ila`.** Full dump 123339889 B left on device at `logs/e0_q4.out`; PC has `e0_q4.err` + `e0_q4.summary.txt`.

### E1_q6 — MOE_OPTS=-cl-opt-disable (ABORT, not a test verdict)
- on-device sha: `d88a8301429365eecf128dc488e0a49c94b684db8762f50b044cac7e97ccd5a8`
- cmd: harness + `export GGML_OPENCL_MOE_OPTS=-cl-opt-disable`
- **Override line present:** `ggml_opencl: MoE compile opts overridden: '-cl-std=CL3.0 -cl-opt-disable'`
- result: **kernel compile error err=-6** during `load_cl_kernels` (LLVM `@llvm.qgpu.opencl.image.load.v4f32...`). Zero tests ran. In-tree "MoE programs survive -cl-opt-disable" **FALSIFIED** on E031.41.03.62. E1 abort ≠ H1–H3 evidence. Fall through to E2.
- logs: `e1_q6.out` `e1_q6.err`

### E2 — MOE_OPTS=-cl-mad-enable (drop fast-relaxed, keep opt)
- on-device sha: `d88a8301429365eecf128dc488e0a49c94b684db8762f50b044cac7e97ccd5a8`
- override: `MoE compile opts overridden: '-cl-std=CL3.0 -cl-mad-enable'`
- e2_q6: **3/3 PASS** (compile succeeded). Kernels same q6_K GEMV+GEMM.
- e2_q4: **0/80 FAIL** (still garbage; dump 123286175 B on device). Artifact-backed: `e2_q4.summary.txt` — 80 ERR lines, `0/80 tests passed`.
- e2_q5: **0/4 FAIL** ERR 0.889, 0.785, 0.910, 0.933 (exact: 0.888727631 / 0.785408716 / 0.909778643 / 0.932921124). Artifact-backed: `e2_q5.summary.txt`.
- H3 as sole cause: **REFUTED** (dropping `-cl-fast-relaxed-math` did not flip q4_K/q5_K).
- logs: `e2_q6.{out,err}` `e2_q4.err` `e2_q5.err` `e2_q4.summary.txt` `e2_q5.summary.txt`

### E3a — CVT_OPTS=-cl-opt-disable (ABORT, expected possible, NOT H4 evidence)
- on-device sha: `d88a8301429365eecf128dc488e0a49c94b684db8762f50b044cac7e97ccd5a8`
- env: `GGML_OPENCL_CVT_OPTS=-cl-opt-disable`, MOE_OPTS unset
- override: `program_cvt compile opts overridden: '-cl-std=CL3.0 -cl-opt-disable'`
- result: **kernel compile error err=-6** during program_cvt. Zero tests. Fall through to E3b.
- logs: `e3a_q6.out` `e3a_q6.err`

### E3b — CVT_OPTS=-cl-mad-enable (completed H4 discriminator, weaker)
- on-device sha: `d88a8301429365eecf128dc488e0a49c94b684db8762f50b044cac7e97ccd5a8`
- override: `program_cvt compile opts overridden: '-cl-std=CL3.0 -cl-mad-enable'`
- e3b_q6: **3/3 PASS** (cvt compiled)
- e3b_q4: **0/80 FAIL**. Artifact-backed: `e3b_q4.summary.txt` — 80 ERR lines, `0/80 tests passed`.
- e3b_q5: **0/4 FAIL** ERR 0.904, 0.828, 0.932, 0.936 (exact: 0.904070598 / 0.828423078 / 0.932363694 / 0.935937768). Artifact-backed: `e3b_q5.summary.txt`.
- H4 (cvt math-opts as sole cause): **not supported**. Dropping unsafe/finite/fast-relaxed from cvt did not flip.
- logs: `e3b_q6.{out,err}` `e3b_q4.err` `e3b_q5.err` `e3b_q4.summary.txt` `e3b_q5.summary.txt`

### E4 — dense MUL_MAT q4_K m=131072 control
- on-device sha: `d88a8301429365eecf128dc488e0a49c94b684db8762f50b044cac7e97ccd5a8`
- cmd: `./test-backend-ops -o MUL_MAT -p type_a=q4_K.*m=131072`
- env: LOG_KERNELS=1, all MOE/CVT/HOST_REPACK/DUMP_Q unset
- result: **2/2 PASS** (n=1 GEMV and n=64 GEMM). Kernels: `kernel_gemv_noshuffle_q4_k_f32`, `kernel_gemm_noshuffle_q4_k_f32`, `kernel_transpose_32_16`. Localizes defect to the **MoE** path, not q4_K dequant in general.
- logs: `e4_dense.out` `e4_dense.err`

### E5-P2 — shift-first nibble extract only (P2). sha `b531095660704b3b60909e737ee04e14a6fca3e3c06d2b1f69d2e2d6bdcf753a` (8022768 B)
- PC==device. Diff: `e5_p2.diff`. get_scale_min_k4 literals **unchanged**.
- env: LOG_KERNELS=1, MOE/CVT/HOST_REPACK unset
- e5p2_q6: **3/3 PASS** (no regression)
- e5p2_q4: **0/80 FAIL** (123MB dump; same garbage)
- e5p2_q5: **0/4 FAIL** ERR 0.889, 0.867, 0.932, 0.940
- **P2 zero effect.** Reverted before P1.
- logs: `e5p2_q6.{out,err}` `e5p2_q4.err` `e5p2_q5.err`

### E5-P1 — get_scale_min_k4 masks as kernel args (P1 alone, P2 reverted). sha `62431160ba4a3dbf92133ccf6996f16e8dc14a2a8b96b7f7c4fc6c144e28c8cc` (8030912 B)
- PC==device. Diff: `e5_p1.diff`. Nibble extract still mask-then-shift.
- e5p1_q6: **3/3 PASS**
- e5p1_q4: **80/80 PASS**
- e5p1_q5: **4/4 PASS** (GEMV and GEMM)
- **P1 full flip.** Semantic-identity transform ⇒ miscompile of literal-mask `get_scale_min_k4`. H5 killed for this idiom. Dense dodge is load-bearing, not cargo-cult. H7 not fired.
- logs: `e5p1_q{4,5,6}.{out,err}`

### post-review rebuild (ILA guard + comments) — sha `a09ef68f6e4e0f8d0f778c9e4c9310780d57fbd4f891ff366dff49a7a7e502da` (8031848 B)
PC==device. Three review fixes only (q4_K GEMM mask args wrapped in `if (!kernel_gemm_moe_q4_k_f32_ns_bin)`; falsified -O0 comment; upstream-facing kernel comments).

### e5fix_mmid — full `-o MUL_MAT_ID`
- env: LOG_KERNELS=1, HOST_REPACK/DUMP_Q/ORACLE/MOE_OPTS/CVT_OPTS unset
- **391/391 PASS.** Per-type OK: q4_K 80, q5_K 4, q6_K 3, q4_0 74, q4_1 75, q5_0 3, q5_1 3, q8_0 75, mxfp4 74. Zero FAIL. Matches retrial counts (those types now including the previously-failing K-quants).
- logs: `e5fix_mmid.{out,err}`

### e5fix_full — unfiltered `test-backend-ops`
- sha `a09ef68f…`. Process **SIGSEGV rc=139** near the end during PAD after writing a **7102454802 B** dump log (FAIL dumps). No `N/M tests passed` line. Not pulled. Do not treat as a clean suite total. Regression check is `e5fix_mulmat` below.

### e5fix_mulmat — `-o MUL_MAT` (retrial dense baseline)
- **915/925 tests passed.** Exactly 10 FAIL, all `MUL_MAT type_a=q6_K m=16 n=1..9 k=256` (known flat kernel, unchanged vs retrial cell4d).
- logs: `e5fix_mulmat.{out,err}`

### e5fix_roundtrip — `test-opencl-moe-roundtrip` bytewise, HOST_REPACK unset
- exe sha `1e50038be1d264aaccd7d80e9c90b9af9ed1aac78e3eff3a81d128ea64a4d0e1` PC==device
- All 10 cases **mismatch=0**, class=clean (q4_0/q4_1/q5_0/q5_1/mxfp4/q4_K/q5_K/q6_K MoE as + 2 dense q4_0). K-quant 0 matches retrial; narrow-quant 0 is post-defect-P (f63746555), expected.
- logs: `e5fix_roundtrip.{out,err}`

## MAX RECALL 2026-08-20 — evidence-gap close

Device still S23 TLS serial, plugged. `s3base`/`s3fix`/`s3printf` UNTOUCHED. HOST_REPACK/DUMP_Q never exported.

### Task 1 — E2/E3b q4_K/q5_K dumps FOUND, extracted, MATCH (no re-run)

On-device dumps still present under `/data/local/tmp/s3oracle/logs/` (mtime 21:25–21:29, contemporaneous with the .err files already on PC). Summaries grepped on-device (`ERR =` + `tests passed` only; dumps **not** pulled):

| file | dump bytes | ERR lines | tests passed | vs MANIFEST |
|---|---:|---:|---|---|
| `e2_q4.summary.txt` | 123286175 | 80 | 0/80 | MATCH |
| `e2_q5.summary.txt` | 1923195 | 4 | 0/4 | MATCH (ERR 0.888727631 / 0.785408716 / 0.909778643 / 0.932921124) |
| `e3b_q4.summary.txt` | 123314758 | 80 | 0/80 | MATCH |
| `e3b_q5.summary.txt` | 1930009 | 4 | 0/4 | MATCH (ERR 0.904070598 / 0.828423078 / 0.932363694 / 0.935937768) |

Env attested by the already-pulled `.err` override lines (same run): E2 `MoE compile opts overridden: '-cl-std=CL3.0 -cl-mad-enable'`; E3b `program_cvt compile opts overridden: '-cl-std=CL3.0 -cl-mad-enable'`. sha `d88a8301…` from contemporaneous MANIFEST + those runs. **No re-run. No 123MB pull.**

### Task 2 — PAD control on PRE-FIX `.so` d88a8301: **rc=0 PASS**

PC no longer had `d88a8301` (overwritten by later builds). Rebuilt `ggml-opencl` at llama.cpp `55f43a574` → sha **identical** `d88a8301429365eecf128dc488e0a49c94b684db8762f50b044cac7e97ccd5a8` (8022056 B). Archived `libggml-opencl.d88a8301.so`. Pushed, on-device sha verified, then:

- cmd: `./test-backend-ops -o PAD` with stdout `/dev/null`, stderr `pad_d88a8301.err` (1464 B)
- env: `LD_LIBRARY_PATH=/data/local/tmp/s3oracle` `GGML_OPENCL_LOG_KERNELS=1`; HOST_REPACK/DUMP_Q/ORACLE/MOE_OPTS/CVT_OPTS unset
- **rc=0**. stderr loads `kernel_pad`, no crash. `N/M tests passed` not captured (stdout discarded by spec). **No diagnosis.**
- logs: `pad_d88a8301.{err,rc,sha}` `run_pad_d88a8301.sh`

### Device restore

Pushed archived `libggml-opencl.a09ef68f.so`. On-device sha **verified** `a09ef68f6e4e0f8d0f778c9e4c9310780d57fbd4f891ff366dff49a7a7e502da`. PC `bin/libggml-opencl.so` restored from the same archive. llama.cpp back on `kalsa/kernel-s3-repack` `c1bb48d32`. STOP.
