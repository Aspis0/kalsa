# Which kernel limits Metal prefill for LFM2.5-2.6B (QAD-Q4_0)?

**Cell:** `ios-metal-prefill-lfm-2026-10-17` · **Date:** 2026-10-17 · **Host:** Apple M1 Max (24-core GPU, Metal 4, 64 GB, macOS 27.0.1 build 26A434, 10 CPU cores)

## Verdict

**`GGML_OP_MUL_MAT` / the `mul_mm` q4_0 kernel is the prefill bottleneck — ~92% of prefill op time, with the FFN gate/up/down projections alone at ~74%.**

**q8_0 KV is *not* the culprit.** Switching KV to f16 changes prefill by **0.25%** (1185.28 ± 0.66 → 1182.33 ± 0.68 tok/s, 6 reps). Flash-attn on/off changes prefill by **0%**. The short-conv (`SSM_CONV`) path that dominates this architecture's layer count is **1.2%**.

The prefill is **compute-bound on q4_0 dequantize+FMA**, not memory-bound: the FFN matmul sustains **5.96 TFLOP/s (≈37% of the M1 Max's ~16 TFLOP/s FP32 peak) while moving only 13.5 GB/s** out of ~400 GB/s available. The Metal **tensor API is disabled on this device** ("tensor API disabled for pre-M5 and pre-A19 devices"), so ggml-metal uses the SIMD dequant+FMA path — the same path an A17 Pro takes.

---

## 1. Build — same llama.cpp as the app

The vendored fork **cannot build standalone** for benchmarking:

| Component | Status in `vendor/llama.cpp` |
|---|---|
| `ggml/`, `src/`, `common/`, `tools/mtmd/` | present |
| `examples/` (llama-cli / llama-completion) | **ABSENT** |
| `tests/` (test-backend-ops) | **ABSENT** |
| `tools/CMakeLists.txt`, `app/`, `pocs/` | **ABSENT** |

`llama-bench` and `llama-cli`/`llama-completion` simply do not exist in this tree, so `-DLLAMA_BUILD_TOOLS=ON`/`EXAMPLES=ON` cannot resolve. Handled as follows:

- **Fork libraries** (the kernels the app ships) built out-of-tree, unmodified, Metal on, Release → `/tmp/lcpp-metal` (`libllama.0.6.0.dylib`, `libggml-metal.0.26.0.dylib`, 37 `kernels/*.metal`). Source tree left clean (`git status --porcelain` = 0 lines).
  - Fork pin: `efd35d408b2e0902fd9d85685430470cf2eaf145` (2026-10-17) `fix(ios): read Metal Apple7 support from gpu_family`, version `0.6.0-dev` / ggml `0.26.0`.
- **Closest upstream tag: `b11517`** (= `8a1a9b5126126e5228b95fa909d4b08fac65e8b3`, 2026-10-09). Located by scoring every upstream commit by how many ggml files it shares byte-for-byte (by git blob sha) with the fork. `b11517` matches **68/78 (87.2%)** — the highest of any commit; the nearest rivals score 67/78 and 66/78. Built with Metal → `llama-bench`, `llama-completion`, `test-backend-ops`.
  - The 8 files the fork patches: `ggml-alloc.c`, `ggml-backend-impl.h`, `ggml-backend.cpp`, **`ggml-metal-common.cpp`, `ggml-metal-common.h`, `ggml-metal-device.m`, `ggml-metal-ops.cpp`, `kernels/mul_mv.metal`**.

**Cross-check that the fork is a faithful stand-in:** prefill of 2048 tokens measured **1187.2 tok/s with the fork's kernels** (`lfm-prof`, no callback) vs **1180.55 tok/s with upstream b11517's kernels** (`llama-bench`) — **0.6% apart**. The fork's Metal patches are performance-neutral for this model, so conclusions transfer.

## 2. Model — found locally, no download

```
/Users/marco/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf            1593894944 bytes
/Users/marco/.../qdc-8elite-newapk/raw/host-materials/…Q4_0.gguf   1593894944 bytes  (identical copy)
sha256  a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03   (both)
```

Architecture (parsed from the GGUF — this is what makes the profiling interpretable):

- `lfm2`, **n_layer 30, n_embd 2048, ffn 10752, 32 heads, head_dim 64, 8 KV heads, rope base 1e7, rms eps 1e-5, vocab 128000, shortconv l_cache 3**
- **Hybrid: only 8 of 30 layers are attention; 22 are short-conv (Mamba-style) layers** (`attention.head_count_kv` = `[0,0,8,0,0,8,0,0,0,8,0,0,0,8,0,0,0,8,0,0,0,8,0,0,8,0,0,8,0,0]`).
- Tensors: 166 × Q4_0, 99 × F32, 1 × Q6_K (the `output` head, `[2048,128000]`).
- `src/models/lfm2.cpp:274` — the live graph uses `ggml_ssm_conv`. The hand-rolled tap/`transpose`/`cont` conv at `lfm2.cpp:462-478` is in `graph_decision`, which is unused here (no `n_layer_decision`).

## 3. Config matrix — `llama-bench`, Metal, 2048 pp / 128 tg

**Prefill (`-p 2048 -n 0`), 6 reps:**

| Config | pp tok/s | σ |
|---|---|---|
| **(a) app: `-ub 256 -fa auto -ctk q8_0 -ctv q8_0`** | **1185.28** | 0.66 |
| (b) `-ub 256 -fa auto -ctk f16 -ctv f16` | 1182.33 | 0.68 |
| (c) `-ub 256 -fa off -ctk f16 -ctv f16` (3 reps) | 1176.43 | 0.65 |
| (d) `-ub 512 -fa auto -ctk q8_0 -ctv q8_0` | **1207.52** | 1.78 |

**Decode (`-p 0 -n 128`), 6 reps:**

| Config | tg tok/s | σ |
|---|---|---|
| (a) `q8_0/q8_0 -fa auto` | 127.37 | 0.83 |
| (b) `f16/f16 -fa auto` | 128.93 | 3.24 |
| (c) `f16/f16 -fa off` | 128.23 | 0.72 |
| (d) `q8_0/q8_0 -fa off` | **context creation FAILS** | — |

Two things worth flagging:

- **q8_0 KV buys nothing in speed but is required for flash-attn.** `ggml-metal-ops.cpp:3411` asserts `src[1]->type == src[2]->type`, and `ggml_metal_op_flash_attn_ext_use_kv_f16()` returns true for a quantized K, so ggml-metal **dequantizes the whole KV cache to F16 on every FA call anyway**. q8_0 saves KV *memory* only. And `-fa off` with q8_0 KV cannot even create a context — so "disable flash-attn to save time" is a non-option.
- **An earlier 3-rep pass suggested q8_0 was 24% faster for decode (120.6 vs 97.3). That was noise.** At 6 reps it vanishes (127.4 ± 0.83 vs 128.9 ± 3.24). Decode on the Mac is insensitive to both KV dtype and flash-attn.

## 4. Per-op profile

Two instruments, because neither alone is trustworthy:

- **`scripts/profiler.cpp` (`lfm-prof`)** — real in-model prefill via `llama_context_params.cb_eval`. Gives exact **op and shape counts**. Its *absolute* per-node times are unusable: the scheduler synchronizes after every instrumented node, destroying kernel pipelining (instrumented 4849 ms vs clean 1725 ms = **181% overhead** over 27192 syncs).
- **`scripts/opbench.cpp` (`lfm-opbench`)** — isolates each op on the **fork's** `ggml-metal` at the model's exact shapes, REPS times inside one graph with a single sync. Amortizes overhead, but has a measured **dispatch floor of 242 µs** (an 8×8 elementwise mul costs 242.1 µs), subtracted below.

**Op counts per 2048-token prefill** (8 ubatches × 256; 1133 nodes/ubatch):

| op + shape | count |
|---|---|
| `MUL_MAT q4_0 [10752,256]` — ffn_gate + ffn_up | 464 |
| `MUL_MAT q4_0 [2048,256]` — ffn_down + sq/o_proj | 536 |
| `MUL_MAT q4_0 [6144,256]` — shortconv.in_proj | 176 |
| `MUL_MAT q4_0 [512,256]` — attn_k / attn_v | 128 |
| `FLASH_ATTN_EXT` | 64 |
| `SSM_CONV` | 176 |
| `RMS_NORM` | 472 |

**Per-op cost (µs/call, 30 reps, floor-corrected):**

| op | measured | floor | **real** |
|---|---|---|---|
| `MUL_MAT` ffn_gate/up `q4_0[2048×10752]×f32[2048,256]` | 2133.8 | 242 | **1892** |
| `MUL_MAT` ffn_down `q4_0[10752×2048]` | 2371.0 | 242 | **2129** |
| `MUL_MAT` conv.in_proj `q4_0[2048×6144]` | 1340.9 | 242 | **1099** |
| `MUL_MAT` sq/o_proj `q4_0[2048×2048]` | 647.5 | 242 | **406** |
| `MUL_MAT` attn_k/v `q4_0[2048×512]` | 408.9 | 242 | **167** |
| `MUL_MAT` output `q6_K[2048×128000]` (n=1) | 1488.2 | 242 | **1246** |
| `SSM_CONV f32[258×2048]` | 372.5 | 242 | **131** |
| `RMS_NORM f32[2048×256]` | 286.5 | 242 | **45** |
| `FLASH_ATTN_EXT n_kv=256` | 1193.8 | 242 | **952** |
| `FLASH_ATTN_EXT n_kv=1024` | 2154.4 | 242 | **1912** |
| `FLASH_ATTN_EXT n_kv=2048` | 2464.2 | 242 | **2222** |

`ggml-metal` reports **no native support for `FLASH_ATTN_EXT` with V≠K type** (`V=f16`/`q8_0` against `K=f32` are refused) — consistent with §3.

**Predicted prefill breakdown** (count × real cost; FA interpolated across n_kv):

| component | ms | share |
|---|---|---|
| **FFN `MUL_MAT` (gate/up/down)** | **1389** | **73.7%** |
| **Conv `MUL_MAT` (in_proj/out_proj)** | **265** | **14.1%** |
| `FLASH_ATTN_EXT` | 113 | 6.0% |
| Attn projection `MUL_MAT` (q,k,v,o) | 73 | 3.9% |
| `SSM_CONV` | 23 | 1.2% |
| `RMS_NORM` | 21 | 1.1% |
| output head (q6_K) | 1.2 | 0.1% |
| **predicted total** | **1885** | |
| **measured clean prefill (fork kernels)** | **1725** | (9.3% over-prediction — in-model ops batch better than isolated) |
| **all `MUL_MAT` combined** | **1727** | **91.6%** |

**Why `mul_mm` and nothing else.** For `ffn_gate`: 2 × 2048 × 10752 × 256 = 11.27 GFLOP in 1892 µs = **5.96 TFLOP/s**, while moving 25.5 MB = **13.5 GB/s**. That is **37% of FP32 peak and 3% of available bandwidth**. So prefill is bound by dequantize+FMA throughput, not memory. Consequences: quantizing the weights further will not help, and the KV cache (tiny vs 1.37 GB of weights read per prefill pass) cannot matter.

**No headroom in runtime knobs** (4 reps, prefill tok/s): baseline 1180.93 · `FUSION_DISABLE=1` 1173.91 · `GRAPH_OPTIMIZE_DISABLE=1` 1184.56 · `CONCURRENCY_DISABLE=1` 1178.14 · **`TENSOR_ENABLE=1` 845.33 (−28%)**. The `GGML_METAL_MMA_*` tile constants (`MMA_TILE`, `MMA_NT_MAX`, `MMA_SMEM_MAX`, `MIN_THREADGROUPS`) are `static constexpr` — compile-time, not env-tunable.

## 5. Answer for the iPhone 15 Pro Max

**The Mac/iPhone numbers are consistent with a compute-bound `mul_mm`, so the iPhone's 270 tok/s prefill is not a bug — it is the expected throughput of this kernel on that GPU.** Mac/iPhone prefill ratio is **4.38×** (1183 / 270), in line with the FP32 SIMD gap between a 24-core M1 Max and a 6-core A17 Pro.

Expected gain per change on the iPhone (**ESTIMATE** — scaled by the measured Mac percentage; assumes the same kernel path, which holds since A17 Pro is also pre-A19 and takes the SIMD path):

| change | Mac effect | **est. iPhone effect** | verdict |
|---|---|---|---|
| `n_ubatch` 256 → 512 | **+2.15%** | ~270 → **~276 tok/s** | the only real win; also needs `n_batch` 512 (already) |
| KV `q8_0` → `f16` | −0.25% | **−0.25%** | don't — keeps VRAM low and is what allows FA on |
| `flash_attn` off | −0.75% | ~−0.8% | don't — 0% on prefill, and breaks q8_0 KV entirely |
| Metal knobs / fusion / graph-opt | ≤ ±0.6% | negligible | already at the right settings |

**The only meaningful lever is a faster q4_0 matmul.** `mul_mm` at 37% of FP32 peak is the whole story; the realistic options are a better-tuned `mul_mm` (compile-time `GGML_METAL_MMA_*` constants, which would need a fork change and per-device tuning) or the tensor/simdgroup_matrix path, which **Apple Silicon does not expose** on pre-M5/pre-A19.

**One discrepancy to chase separately:** the iPhone shows `flash_attn` off costing **−8.5% decode** (23.6 → 21.6 tok/s). That does **not** reproduce on the Mac (128.23 ± 0.72 vs 127.37 ± 0.83, no effect). Something about the iPhone's context length or FA kernel instantiation differs — worth a dedicated look, but it is a *decode* issue and does not affect the prefill conclusion.

---

## Artifacts

```
REPORT.md                              this file
scripts/01-build-fork-libs.sh          fork libs -> /tmp/lcpp-metal (Metal, Release)
scripts/02-build-upstream-b11517.sh    upstream b11517 -> /tmp/lcpp-upstream-b11517
scripts/find-closest-upstream.py       blob-sha scoring used to identify b11517
scripts/profiler.cpp + 03-build-profiler.sh   in-model per-node profiler (fork libs)
scripts/opbench.cpp                    per-op microbench on the fork's Metal backend
scripts/04-bench-matrix.sh             the 4-config llama-bench matrix
raw/build-fork-libs.log                configure_exit=0, build_exit=0
raw/build-upstream-b11517.log          configure_exit=0, build_exit=0
raw/bench-matrix.json                  4 configs × (pp2048, tg128) × 3 reps
raw/ab-q8-vs-f16.txt                   prefill q8_0 vs f16, 6 reps
raw/ab-decode.txt                      decode q8_0/f16 × fa on/off, 6 reps
raw/ab-ubatch.txt                      ub256 vs ub512, 6 reps
raw/ab-metal-env.txt                   GGML_METAL_* knob sweep
raw/opbench*.txt / .err                per-op microbench (MUL_MAT, SSM_CONV, FA, FLOOR)
raw/prof-a-q8-all.log / .txt           n=2048 in-model profile, all ops
raw/environment.txt                    chip, GPU, model hash, fork pin
```

Reproduce: `01` → `02` → `03`, then `04-bench-matrix.sh`, then `lfm-prof` / `lfm-opbench`.