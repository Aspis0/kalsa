# K-G boundary prototype — does GPU prefill's 1.29× survive the CPU↔GPU boundaries?

Date: 2026-08-14
Device: Galaxy S23 (SM_S911U, `adb-R3CW406P8CV`), Adreno 740, OpenCL 3.0
UNPLUGGED entire timed campaign. Battery 87% → 81%. Peak 39.5 °C (abort 43 °C never hit).
Screen: Awake; Termux in foreground (`/top-app` cpuset 0–7) for every cited CPU number.
Artifacts: `results/kernel_kg/`
Spec: `docs/kernel-plan-v2.md` §3.2. No executor code was written.

## Verdict

**KG_KILL(dense-tier 2B 1.12× / 4B 1.15× warmed, hybrid 1.07× — 1.29× does not survive).**

The 1.29× from K2.2 was real as published and is not a measurement error. It does not
survive a fair same-session CPU baseline. Boundaries are not the reason: a 512×2048 f32
handoff is 330/288 µs write/read (median), ~35 ms of copies across 40 CalaQwen layers
per 512-token ubatch (0.068 ms/tok vs 64 ms/tok of CPU prefill). The 1.29× dies on the
CPU side of the ratio.

M0 expert-FFN is 39% of traced prefill (gate was "kill early if >60%"). The ceiling is
not small. The GPU simply does not have a 1.3× on the other 61% either.

No staged executor plan is funded by this prototype. If someone still wants a dense-tier
prefill path it is months of OpenCL work for a measured 1.1×, not a 1.3×.

## What was measured (and what was not)

| cell | what | approximation? |
|---|---|---|
| M0 | Campaign `bmoe-cli.CAMPAIGN` (`1ca51420…`) CalaQwen k6d065, `--compute-trace` split + untraced wall | No. Shares from isolation; wall from untraced run. |
| M1 | New `~/bin/kernel_kg/kg_boundary` on the 740. Same primitive as ggml-opencl F32 `set_tensor`/`get_tensor` (`clEnqueueWrite/ReadBuffer` `CL_TRUE`) | No convert kernel exists for F32 activations. A 1:1 copy kernel was timed as an upper bound only. |
| M2 | K2.2b `llama-bench` (`04c5d362a`, sha `1456239b…`) 2B/4B pp128 and pp512, `-ngl 0` vs `-ngl 99 -fa off` | Dense end-to-end is direct. Hybrid layer is **not** wired (Q7-LANDMINE: experts stay CPU). Hybrid uses M0 split + M1 copies + 2B pp512 ratio. |
| M3 | Arithmetic below | Hybrid is the spec-allowed approximation. |

True one-layer hybrid (attn+dense on GPU, expert-FFN on CPU, real scheduler handoffs) was
not built. That is engine surgery, which this gate forbids until the budget is proven.
The approximation is conservative on the GPU side (2B dense FFN is *wider* than CalaQwen
attn+shared, so the 1.12× is slightly optimistic as an attn speedup).

## Device / binaries

K2.2b OpenCL binaries still on device at `~/gdn_k2/bin_fix2/`, shas match
`results/gdn_gpu_k22b/BUILD_MANIFEST.md`. Campaign pin untouched. New binary only in
`~/bin/kernel_kg/`. See `results/kernel_kg/SHAS.txt`.

**Cpuset landmine.** Termux sshd starts in `/background` (CPUs 0–2, little A510). First
CPU p128 under that cpuset was 6.44 t/s and was discarded. After launching
`com.termux/.app.TermuxActivity` the same binary on `/top-app` (0–7) produced 82.8 t/s,
matching K2.2's first-rep 82.3. All cited CPU numbers are the foreground rerun. GPU
numbers do not care. Anyone repeating this must check `Cpus_allowed_list` before a CPU
cell.

## M0 — CalaQwen prefill split (campaign path)

Model: `Qwen3.6-35B-A3B-KEXP.gguf` (qwen35moe, n_layer=40, n_embd=2048, n_expert=256,
expert_ff=512, k=6, drop-cold=0.65, `--ubatch 512 --moe-stream --cache-mb 2000
--dense-weights anon --overlap --io-threads 4 --chatml --no-think`).

Untraced wall (prompt designed ~1.4k tokens; chatml produced **984** tokens):

```
prefill: 984 tokens, 63.445 s (15.5 tok/s) | load 9.442 s | TTFT 72.886 s
```

`--compute-trace` on a 272-token ubatch (one graph, 3567 isolated nodes, 18.080 s traced).
Isolation barely moved tok/s vs the untraced 15.5 (traced 15.0) — ubatch compute dominates
the barrier. Shares:

| bucket | time | share |
|---|---:|---:|
| expert-FFN (`MUL_MAT_ID` 34.6% + routing) | 7.07 s | **39.1%** |
| attn + dense + lm_head | 10.48 s | 57.9% |
| glue (CPY/VIEW/ADD/…) | 0.46 s | 2.5% |
| other | 0.08 s | 0.5% |

`MUL_MAT` 51.8%, `MUL_MAT_ID` 34.6%, `GATED_DELTA_NET` 4.3%, `FLASH_ATTN_EXT` 1.3%.
Expert-FFN is **not** >60%. The hybrid ceiling if attn were free is 1/0.39 ≈ 2.56×.
That ceiling is not spendable: we do not have a free attn.

## M1 — Boundary costs on the 740

Shape 512×2048 f32 = 4.000 MiB. N=16 after 4 warmup. Host wall (CLOCK_MONOTONIC) around
blocking enqueue — the same `CL_TRUE` path ggml-opencl uses for F32 activations.

| op | median µs | p95 µs |
|---|---:|---:|
| CPU→GPU `WriteBuffer` | **330** | 623 |
| GPU→CPU `ReadBuffer` | **288** | 411 |
| handoff pair (read+write) | **874** | 1545 |
| empty kernel launch+wait (host) | 297 | 578 |
| empty kernel (device profile) | 3.1 | 3.8 |
| `clFinish` idle | 1.7 | 2.5 |
| layout-copy kernel (device; **not** on the F32 path) | 347 | 348 |

1-token (decode-sized) activation is 2.6 µs for the copy; the empty-kernel *host* cost
stays ~300 µs. That is the M1-decode 60 ms/tok glue, restated: launch tax is per-op, not
per-byte. Prefill amortizes it.

40 MoE layers × 874 µs pair = **35 ms / 512-token ubatch = 0.068 ms/tok**.
On the 984-token CalaQwen wall that is 67 ms, **0.11% of 63.4 s**. Boundaries do not
move the gate.

## M2 — Dense 2B/4B, and the hybrid approximation

K2.2b `llama-bench` `-t 4 -n 0 -r 2`. GPU `-ngl 99 -fa off`.

| cell | CPU t/s (reps) | GPU t/s (reps) | GPU/CPU |
|---|---:|---:|---:|
| 2B pp128 | 82.77 (83.75 / 81.79) | 85.45 (85.14 / 85.75) | **1.03×** |
| 2B pp512 | 80.69 (81.19 / 80.19) | 90.54 (90.60 / 90.49) | **1.12×** |
| 4B pp512 average | 22.93 (14.98 / 30.89) | 35.65 (35.70 / 35.60) | 1.55× |
| 4B pp512 **warmed** (CPU 2nd rep) | 30.89 | 35.65 | **1.15×** |

K2.2 published 1.29× at pp128 was 82.26 / 63.62, and the 63.62 is the mean of 82.29 and
**44.95**. Same first-rep CPU we just reproduced (82.8). The 1.29× is a weak-CPU average,
not a GPU win against a healthy 8 Gen 2.

4B's 1.55× is the same shape: first CPU rep 15 t/s (cold 2.6 GiB mmap), second 31 t/s.
GPU is flat at 35.7. Cite 1.15×, not 1.55×.

Hybrid CalaQwen (approximation):

```
t_hyb = t_cpu * 0.391 + t_cpu * 0.609 / 1.122 + t_bound
      = 24.79s + 34.45s + 0.067s
      = 59.31s
speedup = 63.445 / 59.31 = 1.07×
```

Using 4B's warmed 1.15× as `s_attn` gives 1.09×. Neither is 1.3×.

## M3 — Arithmetic and energy

**(i) Dense 2B/4B fully-GPU** (no per-layer boundaries; weights stay resident):
1.12× (2B pp512) / 1.15× (4B warmed). Below the 1.3× gate.

**(ii) CalaQwen hybrid** (boundaries every MoE layer, experts on CPU): 1.07×.
Boundaries add 0.07 ms/tok. They are not the story.

Energy is **screening only** (termux `current` × `voltage` point samples, no idle
subtraction, no soak). Order 2.7 W CPU / 3.0 W GPU on the 2B cells; CalaQwen prefill
~0.18 J/tok. GPU is not cheaper per token in any way that would rescue a 1.1×.
Not a K-E confirmatory number.

## Why this kills the executor

1. The spendable budget was "1.29× prefill on this 740 with this OpenCL backend".
   Against a CPU that actually hits 80+ t/s on the 2B, the same backend is 1.12× at
   the ubatch the hybrid would use.
2. Hybrid makes it worse: 39% of CalaQwen prefill is expert `MUL_MAT_ID` that must
   stay on CPU (Q7-LANDMINE — the expert-ready hook lives only in the CPU loop).
3. Boundaries are cheap. Building an executor to discover that would have been the
   M1 "months of glue" failure mode. The prototype did its job.

A later GPU prefill effort would need a *new* kernel win (not this backend's 1.12×)
or a different SoC. This 740 + this OpenCL stack + this geometry is closed at ~1.1×.

## File map

```
results/kernel_kg/
  kg_boundary.c              M1 microbench (Termux clang)
  run_kg_s23.sh              on-device orchestrator
  analyze_m0.py / analyze_m3.py
  SHAS.txt  DEVICE.txt  cells.csv  master.log
  m1/m1_512x2048.txt  m1/m1_1x2048.txt
  m2/bench_{2b,4b}_{cpu,gpu}*.json
  m0/wall_14h.out  m0/compute_512.csv  m0/split_512.txt
  m3/projection.json
reports/moe-kernel-kg-boundary.md
```

DONE
