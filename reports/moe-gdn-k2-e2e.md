# K2 — Android OpenCL E2E of the fork: GDN correctness + dense 2B (S23 740, Xiaomi 750)

Date: 2026-08-12
Fork: `BigMoeOnEdge/third_party/llama.cpp` @ `e5605f3bd` (not modified)
Build: out-of-tree `build-android-opencl-k2/`
Artifacts: `results/gdn_gpu_k2/`
K0: `reports/moe-gdn-k0-op-inventory.md`

## TL;DR

| device | correctness gate | speed gate (tg GPU/CPU ≥ 1.15×) | verdict |
|---|---|---|---|
| **S23 Adreno 740** driver 0676.73 | **FAIL_CORRECTNESS** | n/a (official GPU cell aborted; diagnostic `-fa off` is 0.27× and garbage) | **FAIL_CORRECTNESS** |
| **Xiaomi 14 Adreno 750** | — | — | **BLOCKED** (device unreachable) |

The fused GDN op is **numerically correct** on this 740 (36/36 `GATED_DELTA_NET` including `head_size=128`). That is not enough. Official `-ngl 99` **aborts** while compiling flash-attn (`sub_group_shuffle_xor` missing — the K5 740 driver hole). With `-fa off` the graph runs but greedy output is **repetition garbage** and decode is **~3 tok/s vs ~11 tok/s CPU**.

**K2 answer:** the hybrid Qwen3.5 dense 2B does **not** run-and-win on this Adreno 740 with this backend. Do not treat GPU offload as a speed or quality win for K3/35B until flash compiles (or is safely skipped) **and** E2E text matches CPU.

---

## 0. Build (PC cross-compile)

Full command + hashes: `results/gdn_gpu_k2/BUILD_MANIFEST.md`. Log: `results/gdn_gpu_k2/build_opencl_ndk.log`.

| item | value |
|---|---|
| NDK | r27b `27.1.12297006` |
| CMake | Android SDK 3.22.1-g37088a8-dirty + Ninja |
| ABI / API | `arm64-v8a` / `android-29` / `c++_shared` |
| Flags | `GGML_OPENCL=ON`, `GGML_OPENCL_USE_ADRENO_KERNELS=ON`, `GGML_VULKAN=OFF`, `GGML_OPENMP=OFF`, `GGML_NATIVE=OFF`, `GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+i8mm+fp16`, `LLAMA_CURL=OFF`, `LLAMA_BUILD_SERVER=ON` (needed for `llama-cli`), `LLAMA_BUILD_TESTS=ON`, `-j4` (PC PPL job left running) |
| OpenCL | Khronos headers + ICD loader in `deps/opencl-android/` (not copied into the NDK sysroot) |
| Host UI embed | MSVC `cl` produced `llama-ui-embed-host.exe`; cmake `HOST_CXX_COMPILER` wrapper (NDK clang++ cannot host-compile on Windows) |

Configure: `Found OpenCL 2.2`, Adreno kernels ON, `gated_delta_net` + `ssm_conv` embedded, `ggml commit: e5605f3bd`.

| binary | size | sha256 |
|---|---:|---|
| llama-cli | 188020280 | `c86bbe987e16dfb45feef4b860f0c03bb08f01894c153b108e0852f61741eaa9` |
| llama-bench | 126081792 | `a6fc70e3bbaa6b9bc7cb323332ada7044fe657f3e9b17706a773d7e3b20fd5ac` |
| test-backend-ops | 24986176 | `154506736cdbeda7ca3cd5263b2f98328828527af7b13ffebf6e21b3dd7b2bc4` |
| libc++_shared.so (NDK) | — | `e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6` |

DT_NEEDED: `libOpenCL.so` (vendor on device) + `libc++_shared.so` (pushed, `LD_LIBRARY_PATH=~/gdn_k2/bin`).

Model pushed: `Qwen3.5-2B-Q4_K_M.gguf` 1280835840 B, sha256 `aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223` (matches `models_staging/SHA256SUMS.txt` after push).

---

## 1. S23 (Adreno 740) — device + OpenCL

SSH `u0_a344@192.168.1.152:8022`. SoC `SM8550`. Vendor `libOpenCL.so` present.

```
ggml_opencl: device: QUALCOMM Adreno(TM) (OpenCL 3.0 Adreno(TM) 740)
ggml_opencl: OpenCL driver: OpenCL 3.0 QUALCOMM build: 0676.73 Compiler E031.41.03.62
ggml_opencl: vector subgroup broadcast support: false
ggml_opencl: subgroup shuffle support: true
ggml_opencl: cl_qcom_subgroup_shuffle support: true
ggml_opencl: using kernels optimized for Adreno
Backend name for -b: GPUOpenCL
VRAM reported: 3536 MB (2512 MB free)
```

This is the K5 re-test device (no subgroup broadcast).

Battery: started 90% UNPLUGGED 26.9 °C; ended 80% UNPLUGGED 30.9 °C. Never plugged, never <30%, never ≥45 °C. Notes: `results/gdn_gpu_k2/s23/battery_notes.txt`.

---

## 2. S23 per-op correctness (`test-backend-ops test -b GPUOpenCL`)

Logs: `results/gdn_gpu_k2/s23/logs/`.

| op | result | notes |
|---|---|---|
| **GATED_DELTA_NET** | **36/36 OK** | includes `head_count=32,head_size=128,n_seq_tokens=1` (decode shape) and prefill up to 256 tokens / K=4 rollback |
| **SSM_CONV + L2_NORM + SOLVE_TRI + CUMSUM** | **104/104 OK** | GDN-family glue |
| **MUL_MAT** `-p q4_K` | **33/33 OK** | 0 numeric `ERR=`; F16-rhs / weird-perm cases = `not supported` (not FAIL). Dense Q4_K path exists. |
| **MUL_MAT_ID** | **78/383, backend FAIL** | **305 numeric FAILs**. `q4_K`: 73 ERR (example `ERR=0.918` on `m=64,n=16,k=768`; `ERR=0.513` on `n=1` decode-like). `q5_K` also FAIL. `q6_K` cases OK. IQ/bf16 = `not supported`. **Dense 2B does not emit MUL_MAT_ID**; this blocks GPU MoE (K3+/35B). |
| **FLASH_ATTN_EXT** | **ABORT** (exit 139 then 134) | lazy compile `fa f32_f16` / prepass DK=40 then DK=256: `sub_group_shuffle_xor` implicit-decl + ambiguous `max`, then `std::out_of_range: map::at`. Driver advertises shuffle; the kernel still fails to compile. |

**GDN-family op gate (narrow):** fused GDN + SSM_CONV + L2_NORM + CUMSUM + SOLVE_TRI + dense MUL_MAT Q4_K = PASS.

**Listed filter set including FLASH + MUL_MAT_ID:** not a clean PASS. FLASH is a hard crash; MUL_MAT_ID Q4_K is numerically wrong.

### Micro-perf (unplugged)

`GATED_DELTA_NET` decode `head=32,S=128,n_seq=1`: **186 µs/run, 21.3 GB/s**. Prefill 256 tokens same heads: 62.9 ms/run.

`MUL_MAT` Q4_K `m=4096,n=1,k=14336` (decode-like): **138 GFLOPS**; `n=512`: 367 GFLOPS.

---

## 3. S23 E2E dense 2B

Same binary, same model. Prompt: `The capital of France is`. Greedy: `--temp 0 -s 42 -n 128 -no-cnv -st` (without `-st` the new CLI stays in chat and reads empty stdin forever — first attempt produced a 76 MB `>` log; killed; not used for gates).

### Official cells (no `-fa`; default `flash_attn=auto`)

| cell | cmd | exit | pp tok/s | tg tok/s | battery | notes |
|---|---|---|---:|---:|---|---|
| CPU | `llama-bench -m <2B> -t 4 -ngl 0 -p 128 -n 256 -r 2 -o json` | 0 | **79.11** (79.87 / 78.34) | **11.10** (11.78 / 10.41) | 83%→82% UNPLUGGED | JSON `results/gdn_gpu_k2/s23/logs/bench_cpu.json` |
| GPU | same, `-ngl 99` | **134 abort** | — | — | 82% UNPLUGGED | flash-attn compile → `map::at` |

Greedy CPU (`-ngl 0`): coherent. Model thinks through “capital of France → Paris”. `Prompt 33.2 t/s | Generation 9.9 t/s`.

Greedy GPU (`-ngl 99`): **abort**, same `sub_group_shuffle_xor` / `map::at`. No text.

`GGML_SCHED_DEBUG=2` is accepted (no rebuild) but this CLI prints application logs on stdout and left **empty stderr**; dump saved as `sched_debug_gpu_faoff.txt` (generation banner only). Not parsed.

### Diagnostic only (not the gate): `-fa off`

Needed to see whether GDN+dense offload works if flash is skipped.

| cell | pp | tg | greedy |
|---|---:|---:|---|
| GPU `-ngl 99 -fa off` | **77.02** (0.97× CPU) | **3.00** (0.27× CPU) | **garbage**: `Here're her thoughts through her search engine` × ~80 |

Official speed gate cannot be scored (GPU cell has no tg). Diagnostic tg ratio **0.27×** would fail 1.15× anyway. Prefill is ~parity; the loss is decode.

---

## 4. Gate verdicts (pre-declared, not renegotiated)

### S23

- **Correctness:** FAIL. Official GPU greedy does not produce coherent text (it aborts). Diagnostic GPU text is repetition-only. CPU text is coherent. Per-op GDN PASS does **not** rescue the cell.
- **Speed:** not applicable on the official GPU cell (crash). Diagnostic 0.27× would be FAIL.
- **Cell: FAIL_CORRECTNESS.**

### Xiaomi 14

**BLOCKED.** Attempts in `results/gdn_gpu_k2/xiaomi/connection_attempts.txt`. mDNS name from S0 (`adb-625689a2-9xEOfw._adb-tls-connect._tcp`) is not advertised; only S23 and a Jelly Star are on the LAN. No stored IPv4. S0 Termux sshd was off.

---

## 5. Caveats (honest)

1. `llama-cli` on this pin auto-enables conversation if a chat template exists. `-no-cnv` alone is not enough; `-st` + closed stdin is required. First greedy run is discarded.
2. Official GPU cell uses default `-fa auto`. Auto still **compiles** flash kernels and then **aborts** instead of falling back. That is a backend bug, not an operator error.
3. `test-backend-ops` “78/383 passed” for MUL_MAT_ID mixes `not supported` (skip) and numeric FAIL. The 305 `ERR=` lines are real mismatches, including Q4_K.
4. GDN op PASS + E2E garbage means the bug is **not** the fused `GATED_DELTA_NET` kernel on the shapes we tested. Suspects: non-flash attn path on OpenCL, graph splits / state `CPY`, or an op we did not isolate (GET_ROWS on Q4_K embd is UNSUPPORTED per K0 G4 — if tok_embd is Q4_K that lookup is CPU and may be fine; if something else splits per token, decode dies).
5. Micro-perf and `-fa off` benches were unplugged. Official GPU never produced a timing sample.
6. Xiaomi 750 is the family that matters for the 35B plan. 740 results are a lower bound / known-bad-driver data point, not a 750 prediction.

---

## 6. What this means for K3 (4B) and the 35B split

**K3 (dense 4B)** is the same hybrid graph (GDN + every-4th full attn + dense FFN). On this 740 binary it will:

- abort at first flash compile unless `-fa off` (or a backend patch that treats compile failure as `supports_op=false` without `map::at`);
- even then, produce garbage and lose decode (2B already 0.27× CPU).

Do **not** spend a 4B night on S23 740 expecting a win. Re-run K2-shaped E2E on **Xiaomi 750** first (driver may compile flash; subgroup broadcast may exist). If 750 also garbages with `-fa off`, the bug is above the 740-only shuffle hole.

**35B split (experts CPU / dense+GDN+attn GPU):**

| piece | K2 evidence | 35B implication |
|---|---|---|
| Fused GDN `S_v=128` | 36/36 PASS, 186 µs decode | Kernel is usable if the rest of the graph is. Confirm 35B `ssm.state_size` from GGUF (K0: not hardcoded). If `S_v∉{16,32,64,128}` → CPU fallback of the state slice (K0 G1) — still a real risk. |
| Dense MUL_MAT Q4_K | PASS | Dense projections can stay on GPU **if** E2E is fixed. |
| Full attn FLASH | compile abort on 740 0676.73 | Every 4th layer + MTP dies. Need compile-fail → CPU fallback, or `-fa off` **and** a correct non-flash OpenCL path (today’s non-flash path is associated with garbage). |
| MoE `MUL_MAT_ID` Q4_K | 73 numeric FAILs | **Do not** put experts on Adreno OpenCL. Keep the fork’s CPU expert-ready hook / streaming path. GPU MoE would also **bypass** that hook (K0 Q7). |
| GET_ROWS quantized embd | not re-tested here; K0 G4 = unsupported | If 35B tok_embd is Q4_K, lookup stays CPU. Fine if isolated. |

Practical 35B policy after K2: **experts stay CPU**. GPU offload of the hybrid trunk is **blocked on correctness**, not just speed. The GDN kernel work is not the remaining gap; flash-attn robustness on Adreno 740 and E2E parity with `-fa off` are.

---

## 7. File map

```
results/gdn_gpu_k2/
  BUILD_MANIFEST.md
  build_opencl_ndk.log
  bin/{llama-cli,llama-bench,test-backend-ops,libc++_shared.so,SHA256SUMS.txt}
  s23/logs/*          (test-backend-ops, benches, greedy, sched dump)
  s23/battery_notes.txt
  xiaomi/BLOCKED.md
  xiaomi/connection_attempts.txt
```

DONE
