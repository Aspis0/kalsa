# K2-bis — Adreno 750 verdict (Xiaomi 14)

Date: 2026-08-12
Device: Xiaomi 14 (`23127PN0CG` / `houji` / SM8650 / Adreno 750), Android 16
Binary: cpufix `kalsa/opencl-q6k-dispatch-fix` @ `a92a51627` (REPACK=OFF, stripped)
  `llama-cli` / `llama-bench` from `results/cpu_build_gap/bin/`
  `test-backend-ops` from `results/gdn_gpu_k22/bin/` (same commit; not in cpu_build_gap)
Model: `Qwen3.5-2B-Q4_K_M.gguf` 1 280 835 840 B
Artifacts: `results/gdn_gpu_750/`
Prior: `reports/research-adreno750.md` (web recon, **LIKELY_FAIL**), `reports/moe-gdn-k22-fix.md` (740)

S23 (`192.168.1.152`) and Jelly (`192.168.1.82`) were **not** touched.

## TL;DR

| gate | result |
|---|---|
| Driver facts vs recon | **CONFIRMED**: `vector subgroup broadcast support: false`. Compiler E031.45.02.25, build 0762.36.1. |
| Per-op correctness | **PASS** — GDN-family 140/140, MUL_MAT q6_K **14/14** (flat *and* real-shape), q4_K 33/33 |
| Greedy A/B token-identity | **PASS** — CPU `-ngl 0` == GPU `-ngl 99 -fa off` |
| FA auto/on | **DECLINED** — `sub_group_shuffle_xor` missing, `clBuildProgram` err=-11, abort 134 |
| Speed (tg GPU/CPU ≥ 1.15×) | **SPEED_PENDING_UNPLUG** — 45 min waiter, still on AC at 100%. No bench JSON. |

**Strategic one-liner:** 750 does **not** flip the recon's kernel-path claim. Broadcast is still false, FA still dies, we are on the same degraded A7X GEMV as the 740. What 750 *does* change is q6_K **correctness of the small-flat kernel** (14/14 vs 740's 4/14): that bug tracks compiler E031.41 vs E031.45, not GPU generation. Speed gate was not run (phone never unplugged); recon's **LIKELY_FAIL** stands until an unplugged `llama-bench` pair exists.

## 0. Device + binary

Serial used for every command: `adb-625689a2-9xEOfw._adb-tls-connect._tcp` (`192.168.1.193:39643`). Connection log: `results/gdn_gpu_750/connection_log.txt`.

Hashes (on-device `sha256sum`, match PC):

| file | sha256 | source |
|---|---|---|
| llama-cli | `4986ff30447cb866656bce6762e6d30266669a2ebc4055a9c2ada00b9e4fdd80` | cpu_build_gap (stripped) |
| llama-bench | `5092a319dd43a4e62095cc49ce15b329be96d0188734e7380d8935fe56b01ea3` | cpu_build_gap (stripped) |
| test-backend-ops | `e96b7d4c107b9c9dcff50fbdbe51f2ce36a70de5c8b74dae5a02d3b2785261e3` | gdn_gpu_k22 (a92a51627) |
| libc++_shared.so | `e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6` | NDK |
| Qwen3.5-2B-Q4_K_M.gguf | `aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223` | models_staging, 1280835840 B |

Execution context: `adb shell` uid=2000 / `u:r:shell:s0` under `/data/local/tmp/gdn_750`. `run-as com.termux` cannot write `/data/local/tmp` (SELinux) and cannot init OpenCL (S0). sshd binary present, not started. Model already existed in Termux `$HOME/models/` from S0; re-pushed from PC and sha-verified.

`cpu_capacity`: `379 379 923 923 923 867 867 1024`. Max=1024, 50% threshold=512. Cores ≥512: cpu2–cpu7 → **`-t 6`**. Marketing 1+5+2 (X4+5×A720+2×A520) is the same 8 cores; the two A520 (379) are excluded. Same choice as S0.

llama-cli banner: `build : b9969-a92a51627`.

## 1. Driver facts (phase 1)

Full stderr: `results/gdn_gpu_750/logs/phase1_driver_cumsum.txt`. Extract: `results/gdn_gpu_750/driver_header.txt`.

```
ggml_opencl: device: 'QUALCOMM Adreno(TM) 750 (OpenCL 3.0 Adreno(TM) 750)'
ggml_opencl: OpenCL driver: OpenCL 3.0 QUALCOMM build: 0762.36.1 Compiler E031.45.02.25
ggml_opencl: vector subgroup broadcast support: false
ggml_opencl: subgroup shuffle support: true
ggml_opencl: cl_qcom_subgroup_shuffle support: true
ggml_opencl: using kernels optimized for Adreno (GGML_OPENCL_USE_ADRENO_KERNELS)
```

VRAM reported: 5584 MB (4560 MB free).

| recon claim (`research-adreno750.md`) | this unit | verdict |
|---|---|---|
| 750 is A7X | Adreno 750, Adreno kernels ON | CONFIRMED |
| `vector subgroup broadcast: false` | **false** | **CONFIRMED** |
| compiler ~E031.45.02.16 (#16854) | E031.45.02.25 / build 0762.36.1 | newer micro, **same missing feature** |
| FA mixed/quant declined on A7X | see §3 — compile err=-11 on `sub_group_shuffle_xor` | **CONFIRMED** |
| 830 is the first phone gen with broadcast=true | not measured (no 830 here) | n/a |

The official “verified Adreno 750” list does **not** imply the fast GEMV path. Our unit is a live counter-example: verified GPU, broadcast still false.

## 2. Per-op correctness (phase 2)

All runs: `test-backend-ops test -b GPUOpenCL …` while **plugged** (allowed). Logs under `results/gdn_gpu_750/logs/test_*.txt`. Status: `logs/phase2_status.txt`.

| op | result | vs 740 (K2.2) |
|---|---|---|
| **GATED_DELTA_NET** | **36/36 OK** | same |
| **SSM_CONV** | **45/45 OK** | same |
| **L2_NORM** | **20/20 OK** (10 noncontig = `not supported`, not FAIL) | same |
| **SOLVE_TRI** | **24/24 OK** | same (K2.2 bundled 104/104 glue) |
| **CUMSUM** | **15/15 OK** | same |
| **MUL_MAT q6_K** | **14/14 OK, EXIT=0** | **different** — 740 was 4/14 (small-flat FAIL ERR≈4–11) |
| **MUL_MAT q4_K** | **33/33 OK, EXIT=0** (f16-rhs / weird-perm = `not supported`) | same class as 740 33/33 |

### 2.1 q6_K shapes — the informative row

From `logs/test_MUL_MAT_q6_K.txt`:

| case | path | 750 (E031.45.02.25) | 740 (E031.41, K2.2) |
|---|---|---|---|
| `m=16,n=1..9,k=256` (10 cases) | flat GEMV | **OK** | FAIL ERR≈4–11 |
| `m=248320,n=1,k=2048` (2B decode lm_head) | noshuffle (cpufix) | **OK** | OK after K2.2 fix |
| `m=248320,n=16,k=2048` (2B short prefill) | noshuffle | **OK** | OK after K2.2 |
| `m=32768,n=1,k=2048` | noshuffle | **OK** | OK after K2.2 |
| `m=1,n=64,k=256` (LM GEMM) | — | **OK** | OK |

The small-flat q6_K bug is **driver/compiler-specific**, not A7X-universal. Matches PR #26476 (E031.41 broken, E031.45 band fixed for that codegen). Recon already flagged this as a *different* issue from subgroup broadcast; this unit confirms both halves: broadcast still false, flat q6_K now numeric-OK.

## 3. Greedy A/B + FA probe

Prompt `The capital of France is`, `--temp 0 -s 42 -n 32 -no-cnv -st -c 512 -t 6`. GPU correctness cell: `-ngl 99 -fa off`. Logs: `logs/greedy_cpu.txt`, `logs/greedy_gpu_faoff.txt`.

Generated body, **byte-identical** after the `>` prompt (both):

```
[Start thinking]

Thinking Process:

1.  **Analyze the Request:** The user is asking a simple factual question: "The capital of France is".

2.
```

Same string as S23 K2.2 after the Q6_K dispatch fix. Pre-fix 740 GPU garbage is gone on 750 too.

Greedy wall-clock (plugged, n=32, **not the speed gate**):

| cell | pp t/s | tg t/s |
|---|---:|---:|
| CPU `-ngl 0` | 25.0 | 6.3 |
| GPU `-ngl 99 -fa off` | 15.2 | 8.6 |

Do not cite these as the campaign number. llama-cli n=32 on AC is not `llama-bench -r 2`.

### 3.1 FA auto/on

Command: same prompt, `-ngl 99` (fa default), `-n 8`. Exit **134** (abort). Log: `logs/greedy_gpu_fa_auto.err`.

```
ggml_opencl: kernel compile error (err=-11) building fa f32_f16:
BC-src-code:2010:22: error: implicit declaration of function 'sub_group_shuffle_xor'
                s += sub_group_shuffle_xor(s, step);
...
ggml_opencl: kernel compile error (err=-11) building fa f32_f16 split:
BC-src-code:299:33: error: implicit declaration of function 'sub_group_shuffle_xor'
...
libc++abi: terminating due to uncaught exception of type std::out_of_range: map::at:  key not found
```

Not a SIGSEGV (PR #26430 wording). It is `CL_BUILD_PROGRAM_FAILURE` (−11) because the FA kernel calls standard `sub_group_shuffle_xor` which this ICD does not expose, then an uncaught `map::at` after the failed compile. Init still prints `subgroup shuffle support: true` / `cl_qcom_subgroup_shuffle support: true` — that flag is **not** the builtin FA uses. Same hole as 740. FA-on is unavailable / unsafe on this 750.

## 4. Speed (phase 3) — SPEED_PENDING_UNPLUG

Gate (pre-declared): GPU tg **median** ≥ 1.15× CPU tg median, same binary, `-t 6`, `-p 128 -n 256 -r 2`, GPU `-ngl 99 -fa off`. Unplugged only, start temp ≤35 °C, battery ≥60%.

Waiter: on-device `run_phase3.lf.sh`. Poll every ~60 s. Log: `logs/phase3_wait.txt`. Marker: `logs/SPEED_PENDING_UNPLUG`.

| event | device clock | AC | level | batt temp |
|---|---|---|---:|---:|
| waiter start | 22:18:28 | true | 75 | 33.1 °C |
| first poll | 22:18:35 | true | 75 | 33 °C |
| last poll | 23:07:22 | true | 100 | 29 °C |
| abort | 23:08:46 | true | 100 | 29 °C |

45 minutes, 28 polls, **never unplugged**. No `llama-bench` was launched. No JSON. Greedy plugged timings in §3 are **not** a substitute.

To close the gate later: unplug, confirm level ≥60 and temp ≤35, run the same script (bins+model already on `/data/local/tmp/gdn_750`).

## 5. Does 750 change the recon's LIKELY_FAIL?

**Kernel path: no.** Broadcast=false and FA-dead on this exact unit. The fast Adreno GEMV / FA cluster the recon said we would not get, we did not get.

**Correctness: yes, a little.** Small-flat q6_K is healthy on E031.45.02.25. Combined with the K2.2 dispatch fix, this 750 produces correct E2E GDN text with `-fa off`. First measured correct phone-GPU GDN on 750 (740 K2.2 was the first anywhere).

**Speed: no number.** Recon's 0.93–1.04× scaling argument is not refuted and not confirmed. Do not cite greedy 8.6 vs 6.3.

Treat 750 as **PASS on correctness, SPEED_PENDING_UNPLUG on the 1.15× gate**. Recon's central driver claim is **empirically confirmed**. The speed LIKELY_FAIL is **not overturned**.

## 6. Artifacts

```
results/gdn_gpu_750/
  driver_header.txt
  connection_log.txt
  SHA256SUMS.txt
  run_phase2.sh  run_phase2b_greedy.sh  run_phase3_speed.sh
  logs/
    phase1_driver_cumsum.txt
    test_GATED_DELTA_NET.txt  test_SSM_CONV.txt  test_L2_NORM.txt
    test_SOLVE_TRI.txt        test_CUMSUM.txt
    test_MUL_MAT_q6_K.txt     test_MUL_MAT_q4_K.txt
    greedy_cpu.txt            greedy_gpu_faoff.txt
    greedy_gpu_fa_auto.txt    greedy_gpu_fa_auto.err
    battery_notes.txt
    phase2_status.txt         phase2b_status.txt
    phase3_wait.txt           phase3_status.txt
    SPEED_PENDING_UNPLUG
```

On device (nothing deleted): `/data/local/tmp/gdn_750/` bins + model + logs. Re-run phase 3 only after unplug.
