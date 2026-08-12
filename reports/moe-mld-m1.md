# M1 — ML-Drift-style decode GEMV for Adreno A7X

Date: 2026-08-12
Device: Galaxy S23, Adreno 740, driver 0676.73, compiler E031.41.03.62
`vector subgroup broadcast support: false` (A7X, as expected)
Fork: `BigMoeOnEdge/third_party/llama.cpp` branch `kalsa/mld-gemv-m1`
Base: `kalsa/opencl-q6k-dispatch-fix` @ `04c5d362a`
Artifacts: `results/mld_m1/`
Device logs: `~/gdn_k2/mld_m1/logs/`

## TL;DR

**M1 gate: FAIL.**

A custom subgroup-free Q4_K GEMV (the kernel the milestone asked for) is
**numerically wrong** on this 740 (`NMSE ≈ 0.67–0.90`, threshold `5e-4`) in
every formulation tried, including a 1-thread-per-row transcription of
`dequantize_row_q4_K`. The **same convert** plus the stock
`kernel_mul_mv_q4_K_f32_flat` **PASSES**. So the convert/layout plumbing is
fine; Adreno E031.41 will not correctly compile a straightforward
subgroup-free Q4_K dequant.

Default `GGML_OPENCL_MLD_GEMV=1` therefore runs **generic SOA convert (no
noshuffle transpose) + the stock flat GEMV**. That is a layout experiment
against noshuffle, not a new subgroup-free kernel. It is off by default.

4B GGUF was not on the S23 (`~/gdn_k2/models/` has only the 2B). 4B-class
shapes (`k=4096`) were still microbenched as synthetic tensors.

## 1. Design as-built

### 1.1 What shipped

| piece | path | default |
|---|---|---|
| Env gate | `GGML_OPENCL_MLD_GEMV=1` | **off** |
| Predicate | 2D Q4_K, `ne0≥512`, `ne1≥512`, `ne0%256==0`, `ne1%4==0` | |
| Convert | existing `kernel_convert_block_q4_K` (AOS→SOA, **no** noshuffle bit-split, **no** 16-bit transpose) | |
| Compute (default MLD) | `kernel_mul_mv_q4_K_f32_flat` | has `REQD_SUBGROUP_SIZE_64` |
| Compute (diagnostic) | `kernel_gemv_mld_q4_k_f32` via `GGML_OPENCL_MLD_SCALAR=1` | subgroup-free, **wrong on E031.41** |
| Tune env | `GGML_OPENCL_MLD_LS`, `_NROWS`, `_VEC` | compile-time for the scalar kernel |
| n>1 | same path (flat handles n>1) | |

`n>1` does **not** fall through to noshuffle when MLD layout is active
(noshuffle would read the wrong physical order). Justification: convert
happens at load, before n is known. Using noshuffle on generic SOA is
numerically wrong.

### 1.2 What was tried for the custom kernel

1. 4-row tiled qs with nibble-split planes + WG local reduce. `vstore` into
   a **private** `float[32]` (undefined in OpenCL). NMSE ≈ 1.0.
2. Same tile, original GGUF qs packing, no `vstore`. NMSE ≈ 0.89.
3. Drop tiling; read the proven generic SOA. Same dequant. NMSE ≈ 0.97.
4. 1 thread / row, identical `dequantize_row_q4_K` loop, `ulong` offsets on
   `float*`. NMSE ≈ 0.68.
5. Same, `char*` + `int` offsets like the flat kernel. NMSE ≈ 0.82.
6. `-cl-opt-disable`: kernel **failed to compile** (`err=-6`).
7. Isolation: same convert + `kernel_mul_mv_q4_K_f32_flat`. **OK**.

Conclusion: convert and dispatch are correct. A new subgroup-free dequant
does not survive E031.41. This matches the 750 recon (A7X, no broadcast,
Qualcomm kernels that need subgroups).

### 1.3 Explicitly out of M1 (untouched)

int4 requant, stage-split, fusions, KV layout, MoE/`MUL_MAT_ID`, flash-attn.

## 2. Real Q4_K tensors (2B GGUF)

File: `~/gdn_k2/models/Qwen3.5-2B-Q4_K_M.gguf` (1.18 GiB, 5.40 BPW).
Dump: `results/mld_m1/tensor_types_2b.txt`.
`n_embd=2048`, `n_ff=6144`, `n_layer=24`. No 4B GGUF on device.

Type counts: **f32 133, q4_K 98, q5_K 36, q6_K 17, q8_0 36**.

| tensor class | type | logical shape `[k, m]` | decode GEMV `(m,n,k)` | #layers |
|---|---|---|---|---:|
| `ffn_gate` / `ffn_up` | **Q4_K** | `[2048, 6144]` | `(6144,1,2048)` | 24+24 |
| `ffn_down` | Q4_K or Q6_K | `[6144, 2048]` | `(2048,1,6144)` | mix |
| `attn_gate` (GDN) | **Q4_K** | `[2048, 2048]` | `(2048,1,2048)` | 18 |
| `attn_q` (full) | **Q4_K** | `[2048, 4096]` | `(4096,1,2048)` | 6 |
| `attn_output` (full) | **Q4_K** | `[2048, 2048]` | `(2048,1,2048)` | 6 |
| `attn_k` | Q4_K | `[2048, 512]` | `(512,1,2048)` | 6 |
| `attn_qkv` (GDN) | **Q5_K** — skip | `[2048, 6144]` | | 18 |
| `ssm_out` | **Q5_K** — skip | `[2048, 2048]` | | 18 |
| `token_embd` / lm_head | **Q6_K** — skip | `[2048, 248320]` | | 1 |
| `attn_v` | mostly Q6_K | `[2048, 512]` | | 6 |

Dominant Q4_K bytes/token: **ffn_gate + ffn_up** (every layer), then Q4_K
`ffn_down`, then `attn_gate`. M1 only moves Q4_K; Q5_K qkv and Q6_K lm_head
stay on existing paths.

4B-class synthetic shapes used for microbench: `(4096,1,4096)`,
`(12288,1,4096)`, `(4096,1,12288)`.

## 3. Correctness

Device UNPLUGGED, battery started 66%. Logs under `results/mld_m1/` (pulled
from `~/gdn_k2/mld_m1/logs/`).

| config | shape | result | log |
|---|---|---|---|
| env off (noshuffle) | `m=6144,n=1,k=2048` | **OK** | `corr_n1_off.txt` |
| env on, scalar kernel | `m=2048,n=1,k=2048` | **FAIL ERR≈0.67–0.90** | `corr_scalar_n1.txt` etc. |
| env on, convert + flat | `m=2048,n=1,k=2048` | **OK** | `corr_mld_flat.txt` |
| env on, convert + flat | `m=6144,n=1,k=2048` | **OK** | same |
| env on, convert + flat | `m=2048,n=1,k=6144` | **OK** | same |
| env on, convert + flat | `m=2048,n=4,k=2048` | **OK** | same |

NMSE gate for a new kernel: **FAIL**. Isolation gate (convert is bit-preserving
enough for the stock SOA GEMV): **PASS**.

## 4. Micro-perf (THE M1 gate)

**PASS criterion:** geometric-mean speedup ≥ 1.4× vs noshuffle on dominant
FFN shapes.

**Result: FAIL, and not close.** Noshuffle is already at the device memory
roof on the FFN shapes (~34–41 GB/s vs a ~33 GB/s estimate). A 1.4× win
would need ~48 GB/s, above what this 740 delivers to a GEMV.

Worse: the only *correct* MLD path (generic SOA + stock flat GEMV) is a
**~21× regression** on `(2048,1,2048)` (4029 µs vs 191 µs). The noshuffle
transpose+image layout is not a +20% tweak — it is the thing that makes
Q4_K GEMV bandwidth-bound at all.

The specified subgroup-free kernel cannot enter the gate (NMSE ~0.8).

Cmd: `test-backend-ops perf -b GPUOpenCL -o MUL_MAT -p '<m,n,k>'`
UNPLUGGED. Raw: `results/mld_m1/perf_noshuffle_extract.txt`,
`~/gdn_k2/mld_m1/logs/perf_mld_flat.txt`.

Effective bytes = `m·k·18/32` (Q4_K) + `k·4` (F32 x).

### Noshuffle (env off) — the baseline to beat

| m | n | k | µs/run | GFLOP/s | GB/s | vs 33 GB/s |
|---:|---:|---:|---:|---:|---:|---:|
| 2048 | 1 | 2048 | 191.48 | 43.81 | 12.4 | 0.37× |
| **6144** | 1 | **2048** | **207.82** | **121.09** | **34.1** | **1.03× roof** |
| **2048** | 1 | **6144** | **290.21** | **86.72** | **24.5** | 0.74× |
| 4096 | 1 | 4096 | 245.52 | 136.67 | 38.5 | 1.17× |
| 12288 | 1 | 4096 | 685.94 | 146.75 | 41.3 | 1.25× |
| 4096 | 1 | 12288 | 732.76 | 137.38 | 38.7 | 1.17× |

Bold rows = 2B FFN gate/up and down. Gate/up is already at the roof.

### MLD = generic SOA + flat GEMV (env on)

| m | n | k | µs/run | GFLOP/s | GB/s | vs noshuffle |
|---:|---:|---:|---:|---:|---:|---:|
| 2048 | 1 | 2048 | 4028.83 | 2.08 | 0.59 | **0.048×** |
| **6144** | 1 | **2048** | **13264.44** | **1.90** | **0.53** | **0.016×** |
| **2048** | 1 | **6144** | **11130.36** | **2.26** | **0.64** | **0.026×** |

Geo-mean on the two dominant 2B FFN shapes (gate/up + down):
**√(0.016×0.026) ≈ 0.020×**. Gate/up is a **64× regression**.
4B-class MLD-flat rows may still be running; they cannot change the verdict.

## 5. E2E / greedy (informative)

2B `-ngl 99 -fa off`, prompt `The capital of France is`, `--temp 0 -s 42 -n 32`.
Greedy A/B and `llama-bench` tg: `greedy_off.txt` / `greedy_on.txt`,
`bench_off.txt` / `bench_on.txt`. UNPLUGGED only.

## 6. Numbers

See §4 tables. Battery: UNPLUGGED 66% at start (`measure_setup.txt`).
Greedy A/B and llama-bench were still running on-device when this report
was closed; they cannot change the micro-gate. Pull
`~/gdn_k2/mld_m1/logs/{greedy,bench}_{on,off}.txt` when they finish.

## 7. What M2 should be

M1 killed the cheap layout bet.

1. **Do not** write another subgroup-free Q4_K dequant for E031.41. The
   compiler that already breaks `mul_mv_q6_K_f32_flat` also breaks a
   textbook `dequantize_row_q4_K` loop without `REQD_SUBGROUP_SIZE_64`.
2. **Do not** drop the noshuffle transpose. Generic SOA + flat is 20–60×
   slower. Noshuffle *is* the layout win, and it is already at the DRAM
   roof on FFN gate/up.
3. **A 1.4× GEMV speedup is not available on this device with Q4_K bits.**
   You cannot read 7.1 MB in much less than 208 µs when the kernel already
   does 34 GB/s. Projected E2E ≥1.15× at 4B from a GEMV-only win is dead
   on 740/750 with GGUF Q4_K_M.
4. Honest M2 options, in order of how much they change the bet:
   - **Stop the port.** Cheapest true FAIL. A7X + Q4_K_M + this backend
     cannot clear the 1.15× CPU gate.
   - **Change the quant** (M1 variant b: int4 requant, or re-export Q4_0).
     Quality risk; LiteRT's 1.43× at 3.8B used per-channel int8, not K-quants.
   - **Don't chase decode GEMV.** OpenCL already wins prefill. Productize
     prefill-on-GPU / decode-on-CPU if that is acceptable.
5. Do **not** start KV-as-conv or flash-attn. A7X declines FA. GEMV was
   the only kernel that could have flipped decode, and it is at the roof.

## 8. File map

```
results/mld_m1/
  BUILD_MANIFEST.md
  bin/                  (android arm64)
  tensor_types_2b.txt
  dump_gguf_tensors.py
  run_device_*.sh
  s23 logs pulled from ~/gdn_k2/mld_m1/logs/
reports/moe-mld-m1.md
```
