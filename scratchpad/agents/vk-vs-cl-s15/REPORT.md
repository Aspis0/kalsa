# Queue #15 — Vulkan vs OpenCL satellite cell (S23)

Status: **DONE**. **Plugged exploratory.** Absolute numbers are NOT comparable to unplugged sessions. The deliverable was the Vulkan/OpenCL **ratio**. **No ratio exists:** Vulkan is not functional for the models' expert types on this device. No ship claims.

Device: Galaxy S23, serial `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`, AC plugged, brightness 128, `screen_off_timeout=900000`.
Engine: `c77fe1354` `kalsa/kernel-s3-repack`. No commits, no remotes.
Evidence: `results/vulkan_vs_opencl_s23/`.

## Pre-declaration

plugged exploratory — absolute numbers NOT comparable to the unplugged sessions; ratio is the deliverable.

O arm = `/data/local/tmp/s3oracle` (barrier-verify OpenCL set, not clobbered).
V arm = `/data/local/tmp/s15vk` (`build-android-vulkan-s15`, `libggml-vulkan.so` `5ff2db3d…`).

## Step 0 — deploy / pins

Done. On-device SHA of both sets and both GGUFs match the MANIFEST pins (`probes/session_start.txt`). `s3oracle` not clobbered. MemAvailable 4761140 kB. level 60, temp 28.2 °C, AC powered.

Vulkan device enumeration (every stderr):

```text
ggml_vulkan: 0 = Adreno (TM) 740 (Qualcomm Technologies Inc. Adreno Vulkan Driver)
  uma: 1 | fp16: 1 | bf16: 0 | warp size: 64 | shared memory: 32768 | int dot: 0 | matrix cores: none
```

First Vulkan-on-Adreno-740 data of the campaign.

## Step 1 — Vulkan sanity

**FINDING: quantized MUL_MAT / MUL_MAT_ID pipeline creation aborts. Backend is not functional for OLMoE Q4_K or KEXP Q2_K/Q3_K.**

`supports_op` (mode `support`) over-claims. Execution throws uncaught `vk::SystemError` (`createComputePipeline: ErrorUnknown`) and `test-backend-ops` / `llama-bench` die with rc 134 (SIGABRT).

### MUL_MAT_ID

| run | cmd | rc | result |
|---|---|---:|---|
| `vk_mmid` | `-o MUL_MAT_ID` | 134 | f16 ID cases OK, then abort on `matmul_id_subgroup_q4_0_f32_f16acc_aligned_s` |
| `vk_mmid_support` | `support -o MUL_MAT_ID` | 0 | q2_K 5/5 SUPPORTED, q3_K 5/5, q4_K 82/82, q4_0 73/74 |
| `vk_mmid_q4k` | `-o MUL_MAT_ID -p type_a=q4_K` | 134 | abort `matmul_id_subgroup_q4_k_f32_f16acc_aligned_s` (no test line printed) |
| `vk_mmid_q2k_id` | `-o MUL_MAT_ID -p type_a=q2_K` | 134 | abort `matmul_id_subgroup_q2_k_f32_f16acc_aligned_s` |
| `vk_mmid_q3k_id` | `-o MUL_MAT_ID -p type_a=q3_K` | 134 | abort `matmul_id_subgroup_q3_k_f32_f16acc_aligned_s` |

f16 MUL_MAT_ID ran OK in the full-suite attempt before the first q4_0 pipeline create.

### MUL_MAT (dense)

| run | cmd | rc | result |
|---|---|---:|---|
| `vk_mm_support` | `support -o MUL_MAT` | 0 | q2_K 11/11 SUPPORTED, q3_K 11/11, q4_K 42 SUPPORTED / 36 NOT |
| `vk_mm_q4k` | `-o MUL_MAT -p type_a=q4_K` | 134 | abort `mul_mat_vec_q4_k_f32_f32` |
| `vk_mm_f16` | `-o MUL_MAT -p type_a=f16` | 0 | **242/242 passed** |

Dense f16 is the one fully green execute suite.

Accidental full-eval (`vk_mmid_q2k` / `vk_mmid_q3k`, `-o` dropped by a PowerShell `$args` clash): unary f16 ops OK; GET_ROWS q2_K–q6_K OK; abort on `get_rows_iq2_xxs_f32`. Not a q2/q3 ID result.

### llama-bench smoke (not a speed cell)

`./llama-bench -m OLMoE Q4_K_M -ngl 99 -fa off -t 4 -nr -p 0 -n 8 -r 1` from `s15vk`: rc 134 at `llama_decode` → `ggml_backend_sched_graph_compute_async` → `mul_mat_vec_q4_k_f32_f32`. No jsonl. SHA block present. MemAvailable 4605128 kB, Awake, AC, level 61, temp 30.2 °C.

## Step 2 — OLMoE speed cell V,O,O,V ×2

**SKIP.** Vulkan is not functional for Q4_K (dense GEMV pipeline create fails; MUL_MAT_ID q4_K pipeline create fails). A VOOV bag would be eight SIGABRTs, not a ratio. OpenCL on this same HEAD already passed MUL_MAT_ID 407/407 in barrier-verify; that is the asymmetry, not a number to invent by running O alone.

## Step 3 — KEXP speed cell

**SKIP.** Vulkan MUL_MAT_ID q2_K and q3_K abort on `matmul_id_subgroup_q{2,3}_k_f32_f16acc_aligned_s`. Source audit said supported subject to shared-memory checks; `supports_op` says yes (`shmem=32768`); shader compile still fails. OpenCL on this device dispatches those kernels. Dossier point.

## Step 4 — ratios / verdict

| item | verdict |
|---|---|
| Vulkan enumerates Adreno 740 | yes (`matrix cores: none`, warp 64, shmem 32 KiB, no int-dot) |
| f16 dense MUL_MAT | 242/242 |
| f16 MUL_MAT_ID | OK (partial, before q4_0 abort) |
| q4_K MUL_MAT / MUL_MAT_ID | **ABORT** pipeline create |
| q2_K / q3_K MUL_MAT_ID | **ABORT** pipeline create |
| llama-bench OLMoE ngl 99 | **ABORT** same q4_K GEMV pipeline |
| V/O tg512 ratio | **not estimable** |
| ship | **no** (exploratory; backend not functional for the models) |

`supports_op` vs runtime: support mode lists the expert types as SUPPORTED; first real dispatch throws an uncaught `vk::SystemError`. That is a Vulkan-backend defect on this driver, not a Kalsa OpenCL regression.

`runs.csv` has the KEXP column header plus `backend`/`sha_vulkan` and **zero rows**.
