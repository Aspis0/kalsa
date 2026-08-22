# Queue #17 — host-side OpenCL guards, S23 regression re-verify

Status: **DONE**. Correctness only. No commits, no remotes, no speed claims. PLUGGED fine.

Engine: `BigMoeOnEdge/third_party/llama.cpp`, branch `kalsa/kernel-s3-repack`, HEAD `7686ca6fc5685c70f95bf60116dd7c8e5dec01c1`.
Parent of the three fixes: `c77fe1354` (barrier-verify).

| commit | subject |
|---|---|
| `dc3870579` | opencl: guard q6_K flat workaround by GPU family |
| `8e0063d2a` | opencl: make unknown compiler versions explicit |
| `7686ca6fc` | opencl: skip empty MoE matmul dispatch |

Claim under test: none of these may change anything on E031/Adreno 740. Proof = same suite totals as barrier-verify (407/407, 925/925) plus q6_K flat still on the ADRENO_OLD_COMPILER scalar path.

## Step 1 — rebuild

Ninja exit 0. CMake re-ran (`ggml commit: 7686ca6fc`) and relinked. ggml-opencl.cpp.o was then force-rebuilt so the three host edits are in the shipped `.so` (object mtime after source).

PC SHA-256 in `results/q17_verify_s23/pc_sha256.txt`. vs barrier-verify `c77fe1354`:

- `libggml-opencl.so` **changed** (`f4325483…`, 8376320 B) — expected, only host file that moved
- `libggml-base.so` **changed** (git stamp)
- `libllama-common.so` **changed** (`build-info.cpp`)
- `libggml.so` / `libggml-cpu.so` / `libllama.so` / `test-backend-ops` / `llama-bench` / `libllama-bench-impl.so` **same hashes** as barrier-verify

## Step 2 — deploy

Done. Pushed over existing `/data/local/tmp/s3oracle` (no `rm -rf`; OLMoE GGUF and `s15vk` left in place). `PUSH_FAILS=0`. On-device `sha256sum` matches PC for all 11 artifacts (`device_sha256.txt`). Env: `LD_LIBRARY_PATH=/data/local/tmp/s3oracle`, `GGML_OPENCL_LOG_KERNELS=1`, HOST_REPACK/DUMP_Q/ORACLE/CVT_OPTS/MOE_OPTS/CVT_VARIANT unset.

## Step 3 — MUL_MAT_ID 407/407

Done. **407/407 passed**, rc 0, SHA block matches deploy pins. No FAIL. All ten m=96 discriminators (q2/q3/q4/q5/q6 GEMV+GEMM) still OK. Duration 22:25:25–22:26:36 EDT. Same total as barrier-verify at `c77fe1354`.

## Step 4 — MUL_MAT 925/925 + q6_K ADRENO_OLD_COMPILER gate

Done. **925/925 passed**, rc 0, SHA block matches.

Gate-unchanged evidence (all required):

1. Driver still `Compiler E031.41.03.62`. With `gpu_family==ADRENO` (new conjunct in `dc3870579`) and `type==E031` and major 41 < 45, `q6_k_flat_old_compiler` stays **TRUE**. The family guard cannot fire false on this GPU.
2. Dispatched kernel is still `kernel_mul_mv_q6_K_f32_flat`, not `kernel_mul_mv_q6_K_f32`.
3. The #26476 canaries (`q6_K` `m=16` `n=1..9` plus the later `n=1` repeat) are all **OK**. Those cases fail if the scalar `ADRENO_OLD_COMPILER` dequant is not compiled in.
4. `dense.err` is **bit-identical** to barrier-verify (`b2c377f0…`). `mmid.err` likewise (`5e32248a…`). Unique kernel-dispatch set did not move.

`8e0063d2a` (UNKNOWN_COMPILER fallback) is not taken: the driver string contains `E031`. `7686ca6fc` (ne01==0 skip) is not exercised by these suites; 407/407 is the proof it does not disturb admitted positive-row MoE shapes.

## Verdict

| item | verdict |
|---|---|
| MUL_MAT_ID | **407/407 PASS** |
| MUL_MAT | **925/925 PASS** |
| q6_K flat ADRENO_OLD_COMPILER gate on E031.41.03.62 | **unchanged TRUE** |

Evidence: `results/q17_verify_s23/`.
