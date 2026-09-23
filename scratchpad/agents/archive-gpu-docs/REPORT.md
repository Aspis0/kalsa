# GPU on these phones — what the written record already worked out

Explorer report, read-only. Prepared 2026-09-21.
Scope: the archived plans and living documents under `~/Projects/kalsa-moe-experiments`
(`archived/PLAN-2026-09-full.md`, `archived/ALIVE-2026-09-full.md`,
`archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md`, the rest of `archived/`, `PLAN.md`,
`docs/ALIVE.md`, `analysis/`, `ops/`, `prompts/`), with `reports/`, `results/` and
`scratchpad/` used only as the raw evidence an index points at.
Question: before spending a day on a zero-copy / host-pinned shared-weights path for the
Galaxy S23's Adreno 740, what do we already know about GPU on these phones?

## 0. How to read this report

Labels used on every fact:

| label | meaning |
|---|---|
| **MEASURED** | an on-device or CLI number with a named artefact |
| **ESTIMATE** | arithmetic, inference or extrapolation, derived from measurements |
| **DECISION** | an owner or orchestrator decision on the record |
| **CLAIM-UNVERIFIED** | an assertion with no artefact located; the plans label these UNSOURCED |

Citation form is `path:line` (or `path:line-range`) against the trees as they stand on
2026-09-21. Where the archived Italian body and the living English rewrite of the governor
plan disagree, both are cited and the disagreement is recorded in §7.

Source inventory and dates (archived material frozen 2026-09-20):

| source | date / status | GPU content |
|---|---|---|
| `reports/research-adreno-opencl.md` | 2026-08-09 | the K1–K7 Adreno research; K4 is the zero-copy answer |
| `reports/research-adreno740-custom.md` | 2026-08-11 | custom-kernel / LiteRT path on the 740 |
| `reports/moe-litert-f0-f1.md` | 2026-08-11/12 | LiteRT on the S23 (MEASURED, caveated) |
| `reports/moe-gdn-750.md` | 2026-08-12 | 750 FA compile failure |
| `reports/moe-gpu-sustained.md` | 2026-08-12/13 | S23 740 sustained decode |
| `results/cmdbuf/recon_q1_driver.md` | 2026-08-13 | driver / recordable-queue recon |
| `ops/memory-backup-2026-08-27/adreno-moe-two-defects.md` | 2026-08-23 | the consolidated Adreno kernel-campaign verdicts |
| `archived/ALIVE-2026-09-full.md` | frozen 2026-09-20 | the dated GPU rows (23, 36–39, 44, 48, 50–61) |
| `archived/PLAN-2026-09-full.md` | frozen 2026-09-20 | the Italian diary |
| `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md` | 2026-09-19, audited | the Italian governor plan |
| `analysis/GOVERNOR-DEVICE-PLAN.md` | 2026-09-20 | the English governor plan; S23/Jelly/GPS sections |
| `analysis/FORK-VENDOR-MIGRATION.md` | 2026-09-18/20 | the OpenCL merge surface we must keep |
| `PLAN.md` | living, 2026-09-21 | governor brought forward |
| `docs/ALIVE.md` | living, 2026-09-21 | **zero GPU/Adreno rows** |

Structural finding before anything else: `PLAN.md` and `docs/ALIVE.md` carry no Adreno or
GPU measurement of their own. `docs/ALIVE.md` mentions the OpenCL MoE mask fix only
(`docs/ALIVE.md:22`). The GPU record lives entirely in `archived/`, in `analysis/GOVERNOR-DEVICE-PLAN.md`,
and in the `reports/`–`scratchpad/` evidence. `analysis/README-governor-kv-contract.md`,
`analysis/CISWIRE-CHAR3GRAM-KV-AND-THERMAL-2026-09-19.md` and the Xiaomi analysis carry no
GPU content. `prompts/` carries no GPU notes (model prompts only); the GPU material under
`ops/` is the 2026-08-27 memory snapshot `ops/memory-backup-2026-08-27/`.

### Headline for the decision at hand

1. The zero-copy question has already been asked and answered for this exact stack:
   **no zero-copy path exists in the llama.cpp OpenCL backend on Adreno; UMA with a load
   copy and a device buffer** (2026-08-09, verdict GIALLO). **MEASURED** (code reading) +
   **ESTIMATE** (RAM budget) — `reports/research-adreno-opencl.md:140-170`.
2. The S23's 740 loses to its own CPU on OpenCL decode (0.56–0.74×) because its driver,
   `0676.73` / compiler `E031.41.03.62`, lacks subgroup broadcast and the Adreno GEMM falls
   back to a degraded GEMV. **MEASURED** — `reports/research-adreno750.md:268, :320`.
3. The same phone beats its own CPU on the same workload under a foreign stack that does not
   use llama's subgroup GEMM: LiteRT/ML Drift decode ≈26.8 tok/s (estimated) vs 9.70 tok/s
   llama CPU ≈2.76× (2026-08-11/12, heavy caveats). **ESTIMATE** —
   `reports/moe-litert-f0-f1.md:73-97`.
4. An in-app GPU prefill on the **740 has never been measured**: the governor is off **by
   table** (`V73: false`), not by measurement. **CLAIM-UNVERIFIED / DECISION** —
   `analysis/GOVERNOR-DEVICE-PLAN.md:470-479`, `:181`.
5. "Shared weights" already exist in the fork's sense: `DenseWeights` residency policies
   `Mmap / Warmed / Anonymous / Pinned`, with the streaming path expert-only. A GPU backend
   bolted onto that dense path was assessed **GIALLO** for fork integration. **MEASURED**
   (code reading) — `reports/research-adreno-opencl.md:245, :288-292`.
6. An engine flip is a **context reload**; a `reload_budget_available` wire field exists but
   is fixed `false` in JS, so the decode cool-mode lane is unreachable by construction.
   **MEASURED** (code) + **DECISION** — `analysis/GOVERNOR-DEVICE-PLAN.md:149, :593`;
   `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:991`.

---

## 1. Dated findings, newest first

### 2026-09-21 — governor brought forward, GPU probe moves ahead of G2
- **DECISION** — Owner, 2026-09-21: after enough CPU turns the phone enters Android's
  severe thermal mode and long sessions cannot run at all; the governor is therefore
  anticipated. The first three steps of the governor order of work
  (`analysis/GOVERNOR-DEVICE-PLAN.md`, Part 9: fixes 5.1/5.2/5.3, then the GPU probe, then
  the runtime probe with `gpubusy`) move AHEAD of G2's closure. `PLAN.md:199-211`.
- **DECISION** — GPU/V75/q4_K, the other generations, the NPU and the governor are
  evidence-gated in the 24–29 Sep window and are explicitly NOT "after M1".
  `PLAN.md:181-183` citing `archived/PLAN-2026-09-full.md:1813, :1825`.
- **MEASURED** — G1 closed 10 Sep on LFM2.5-2.6B Q4_0 QAD; M1 not done; G2 not claimed.
  `PLAN.md:188-197`.

### 2026-09-20 — living governor plan (English): S23, Jelly, GPU probe, fit gate
- **DECISION (park status open)** — the governor plan itself is parked pending an owner
  decision; no un-park is recorded. `analysis/GOVERNOR-DEVICE-PLAN.md:4-9`.
- **MEASURED / DECISION** — S23: `V73: false` in `GPU_PREFILL_CORRECT`; the governor is off
  **by table, not by measurement**; GPU decode is a cool-mode trade-off (all-GPU −19% speed
  for −2.75 °C in the archived KEXP cell, against all-CPU `17.55` and `27.69` tok/s).
  `analysis/GOVERNOR-DEVICE-PLAN.md:470-473`.
- **CLAIM-UNVERIFIED** — GPU prefill on the 740 **has never been measured in-app**; the
  known risk is the f16 defect (`adreno-f16-gemm-is-the-culprit`); until measured it is
  "unproven". `analysis/GOVERNOR-DEVICE-PLAN.md:478-480`.
- **MEASURED** — the two-context GPU fit budget is `gpuReserveMiB = 800 + 1.05 ×
  offloadedBytes`; `requiredMiB = nonEvictable + gpuReserve + compute + kv`.
  `analysis/GOVERNOR-DEVICE-PLAN.md:156-166`.
- **CLAIM-UNVERIFIED** — "the fit gate is structurally blind to GPU memory … `lmkd` kills the
  app instead of throwing, so no fallback fires"; the earlier draft's "a 6.4 GB model at full
  GPU restarted the kernel" is marked **UNSOURCED** in the rewrite.
  `analysis/GOVERNOR-DEVICE-PLAN.md:268-272`. See §7 for the Italian original.
- **MEASURED** — the E031 miscompile that forced the q4_K masks to become kernel arguments
  depends on the **driver version** (`E031.41.03.62`, Adreno 740), not the chip model.
  `analysis/GOVERNOR-DEVICE-PLAN.md:237-242`.
- **DECISION** — GPU probe must be a **real program build** recording `ok|fail` per
  `(device, driver)`, cached, failing closed; a kernel-compile error must not call `exit(1)`
  (today `ggml-opencl.cpp:1298-1300`). `analysis/GOVERNOR-DEVICE-PLAN.md:232-266`.

### 2026-09-19 — audited governor plan (Italian body) and its own audit
- **DECISION** — Apple/Metal is OUT because **unified memory breaks `gpuFit()`**, which
  assumes GPU memory is separate and must be reserved; on Apple "there is nothing to reserve,
  and the computation is not merely useless but wrong". `analysis/GOVERNOR-DEVICE-PLAN.md:42-47`.
- **MEASURED (code)** — an engine change is a context reload: `rn-llama.cpp:72-73` fixes
  `prefill n_gpu_layers=99 / decode 0`; `select_decode` returns `-2` on `requires_reload`;
  existing ratchets `k_dwell_ms = 10 min` and `k_flip_window_ms = 60 min` are removed by the
  proposed single selector. "One flip = one reload, and a jittery key = a reload per turn."
  `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:991`.
- **DECISION** — `kernels_compile: ok|fail` is a single boolean for a set; with the cache rule
  "if fail, the GPU does not exist until the driver changes", one bad kernel permanently
  disables a GPU that works for the product kernels. `…audited.md:1014`.

### 2026-09-07 — the Adreno prefill infidelity is the f16 multiply, and V75 is switched ON
- **MEASURED** — on QRD8650 / Adreno 750, model LFM2.5-2.6B QAD-Q4_0: stock KLD median
  `0.453822`, same-top `62.823%`, PPL `+8.40`; keeping the product in float
  (`convert_float8(B) * (float)w`) gives KLD `0.004736`, same-top `94.826%`, PPL `+0.349`
  (95.8× reduction). Compiler math flags are identical to the sixth digit; f16 accumulators
  are NOT the cause. Cost of the fix at the bench: **0.659×** (`190.25` vs `288.62` t/s),
  with a pre-registered validity read that FAILS on a 5.71 °C excursion.
  `archived/ALIVE-2026-09-full.md:496-497`; `archived/docs/GPU-PREFILL-DIVERGENCE-2026-09-06.md`.
- **MEASURED** — five axes refuted (attention, compiler flags, f16 accumulator,
  dequantisation, operand precision); only the product ever moved the KLD. Residual ~5×
  against the batch-1 GEMV path is attributed to tile geometry and summation order, still
  unmeasured. `archived/ALIVE-2026-09-full.md:494`; `…GPU-PREFILL-DIVERGENCE…md`.
- **DECISION** — Owner, 2026-09-07: turn GPU prefill ON for V75
  (`GPU_PREFILL_CORRECT.V75` false → true) on the effect size, NOT on the binary verdict,
  which stays `FAIL rule=R2` by design. Accepted knowingly: n=1, q4_K (high tier) unmeasured
  in-app, 732/735/8 Elite not re-run, V73 stays false.
  `archived/ALIVE-2026-09-full.md:492`; `scratchpad/agents/gemm-f32-ship/DECISION.md`.

### 2026-09-06 — divergence isolated to the 750 and to the Q4_0 GEMM
- **MEASURED** — same APK, QRD8750 / Adreno 830 / V79: oracle **PASS 4/4** on GPU-prefilled
  turns, decode parity B/A `0.993`; on QRD8650 / Adreno 750 the same turns fail
  deterministically at token 14 (or index 7 in later runs). Prewarm 1024 tokens 4.06–4.30 s
  GPU vs 6.60–6.82 s CPU = 1.6–1.65×. `archived/ALIVE-2026-09-full.md:485`.
- **MEASURED** — with `-fa off` on both arms the 750 result does not change (KLD `0.4538`,
  same-top `62.8%`), so attention is not the cause; batch-1 (GEMV, fp32 operands) gives KLD
  `0.000962`, same-top `98.0%`. `archived/ALIVE-2026-09-full.md:497`;
  `archived/docs/GPU-PREFILL-DIVERGENCE-2026-09-06.md`.

### 2026-09-05/06 — in-app GPU prefill, forced, on 732 / 735 / 750
- **MEASURED** — in-app GPU prefill vs CPU on the same turn: 750 **1.98×** (8504.8 ms CPU vs
  4294.9 ms GPU, 925 tokens), 732 median **0.613** (1.63×, GPU 7.42 s vs CPU 11.77–12.48 s),
  735 median **0.581** (1.72×, GPU 6.88–6.93 s vs CPU 11.62–12.16 s). All pairs are outside
  the pre-registered parity band and below the 0.85 speed threshold.
  `archived/ALIVE-2026-09-full.md:488-491`.
- **MEASURED** — all three arms **FAIL** the strict greedy oracle, and the GPU token ids are
  byte-identical on 732 / 735 / 750 (`d4556574…`) while the CPU ids are identical on four
  boards (`647f906d…`). The divergence is a property of the A7X kernels, NOT of the 750's
  20-FAIL f16/bf16-batched dense defect (which the 732 passes 925/925). Therefore
  `GPU_PREFILL_CORRECT.V73` stays false. `archived/ALIVE-2026-09-full.md:488-491`.
- **DECISION (parked)** — QRD8635 and HDK8550 were banked as "PARCHEGGIATI per l'owner
  (nessuna B possibile senza estendere la policy)". `archived/ALIVE-2026-09-full.md:487`.

### 2026-09-03 — QDC sweep: the 732, the 740 class, the 750, the 735
- **MEASURED** — QRD7675 / **Adreno 732**: MUL_MAT **925/925**, MUL_MAT_ID **407/407**;
  GPU `-ngl 99 -fa 0` pp512 **151.78 ± 1.12** t/s, tg128 **17.26 ± 0.02**; CPU pure 13.77 /
  10.27. `scratchpad/agents/qdc-7pg3-govbench-52/REPORT.md:17-26, :50`.
- **MEASURED** — Adreno 732 FLASH_ATTN kernels do **not compile**, then a 1.68 GiB buffer
  alloc fails and the process segfaults (see §3 for the exact source).
  `scratchpad/agents/qdc-7pg3-govbench-52/REPORT.md:28-42`.
- **MEASURED** — HDK8550 / **Adreno 740**, compiler `E031.41.03.56`: MUL_MAT 925/925,
  MUL_MAT_ID 407/407, **FLASH_ATTN_EXT 229/229 PASS — FA compiles and passes on the 740**;
  the 732's failure is tier-specific. LFM2.5-2.6B **Q4_K_M**: pp512 84.09 / tg128 16.04
  (base) vs 84.64 / 16.02 (picks), Δ +0.65% / −0.12%, inside ±3%.
  `scratchpad/agents/qdc-8g2-oclpicks-53/REPORT.md:10-20, :34-55`;
  `raw/tbo_base_fa_sa801919.out:6`. **This conflicts with the S23's own 740 FA outcome —
  see §7.**
- **MEASURED** — QRD8650 / **Adreno 750**: MUL_MAT 905/925 (**20 FAIL**, all
  `f16|bf16 × f32, m=128 n=1 k=1056 k_v=2112` batched), MUL_MAT_ID 407/407; ship 2.6B
  QAD-Q4_0 GPU pp512 284.2 / tg128 23.4 vs CPU 16.3 / 11.6; re-run GPU 291.11 / 23.02.
  `archived/ALIVE-2026-09-full.md:475`; `scratchpad/agents/qdc-8g3-govbench-55/REPORT.md`;
  `scratchpad/agents/qdc-8g3-rerun-58/REPORT.md:29, :34, :48`.
- **MEASURED** — QRD8635 / **Adreno 735**: MUL_MAT 925/925, MUL_MAT_ID 407/407, zero FAIL →
  the 20-FAIL family is the 750's driver/compiler stack, not the generation; GPU pp512
  154.8 ± 1.3 / tg128 16.5 vs CPU 14.9 / 11.3. `archived/ALIVE-2026-09-full.md:476`.
- **MEASURED (ceiling)** — the 750's dense f16/bf16-batched defect was later gated at kernel
  level: `ADRENO && !ggml_is_contiguous(src0)` → MUL_MAT 925/0, MUL_MAT_ID 407/407, FA
  unchanged, pp512 289.6 (+0.2%) / tg128 22.2 (−2.2%). Root cause on the 750 remains
  unexplained; it is a workaround, not a fix. `archived/ALIVE-2026-09-full.md:490`.

### 2026-09-04 — the shipped APK on real hardware
- **MEASURED** — APK smoke on QRD8650 / Adreno 750: OpenCL platform and HTP skels initialise,
  but `offloaded 0/31 layers to GPU` — the app does not send layers to the GPU; decode 26.4 /
  26.0 tok/s on CPU. `archived/ALIVE-2026-09-full.md:481`.

### 2026-08-30 — Adreno 830 on the 8 Elite completes the generational series
- **MEASURED** — QRD8750 / **Adreno 830**, Marco-KEXP (qwen3moe 17.25B Q4_K): GPU pp512
  **274.5** / tg128 **48.9** vs CPU **107.4** / **60.7** → **GPU prefill 2.56×, CPU decode
  1.24×**. Three GPU generations now give three different verdicts, each re-measured, never
  transferred: **740 CPU-always → 750 GPU-2.21×-prefill / tie-decode → 830 GPU-2.56×-prefill
  / CPU-1.24×-decode**. `archived/ALIVE-2026-09-full.md:460`.
- **MEASURED (ops lesson)** — a session labelled `OpenCL ngl99` silently fell back to CPU
  because `/vendor/lib64` in `LD_LIBRARY_PATH` bypassed the sphal namespace, so the Adreno
  driver's `libCB.so` dlopen failed; the numbers matched arm C. `…:460`.

### 2026-08-22/23 — the Adreno kernel campaign closes; 740 verdicts fixed
Source for this block: `ops/memory-backup-2026-08-27/adreno-moe-two-defects.md` (dated
2026-08-23, confirmed by an independent forensic audit).
- **MEASURED** — the Adreno MoE compute kernels are **correct**. Four `E031` compiler
  miscompiles plus one latent defect were fixed and device-verified; `MUL_MAT_ID 401/401`
  after q2_K/q3_K were written from zero (upstream has them for no GPU).
- **MEASURED** — **Arm C (pure CPU) wins ALWAYS** on the 740/S23 small-active MoE:
  KEXP `17.55` (CPU) vs A `14.25` (GPU experts), OLMoE `27.69` vs `20.03`; every cell. Half
  offload (B) is always the worst. "GPU default candidate" RETRACTED.
- **MEASURED** — GPU experts on OLMoE-1B-7B Q4_K_M (S23, unplugged, ABBA×2): **2.17× burst**
  (27.5 vs 12.7 t/s), **~1.5× sustained** (15.3 vs 10.3), and cooler (CPU arm touches 40.2 °C,
  GPU does not). Real cool-mode only for KEXP (−2.75 °C); OLMoE is thermal parity.
- **MEASURED** — **Vulkan on the A740: ZERO executable K-quants** (`createComputePipeline`
  ErrorUnknown → SIGABRT; `supports_op` lies). The fork's OpenCL is the only GPU path.
  `archived/PLAN-archive.md:8999` (Gate Mali, 22/08) records the same class on Mali-G57.
- **MEASURED** — streaming (same-harness #23): CPU `0.216` ≈ dense-trunk-GPU `0.223` — GPU
  irrelevant; the 23× up to 5.10 is the recipe, never divide cross-harness.
- **MEASURED** — NPU HTP rejected with a number: `0.67 MiB` of weights loaded = it does not
  load the model; decode is DRAM-bound and the NPU has no bandwidth of its own.
- **MEASURED (memory trap)** — the S23 power-offs on Mellum2 were **not** the GPU: they were
  the default **ARM REPACK** (`use_extra_bufts=true`), ~6.5 GB of anonymous
  `posix_memalign` at Q4_K_M scale on 8 GB → kernel death, even at `-ngl 0`. Production is
  structurally immune (`use_extra_bufts=false` wired). For 8 GB bench: always the
  no-extra-bufts variant. `ops/memory-backup-2026-08-27/adreno-moe-two-defects.md` (oomwall
  paragraph).
- **MEASURED** — the 750 does NOT generalise the 740's verdict: decode parity confirmed
  (A/C `0.992`, N=5), prefill A = `2.48×` (KEXP), B worst everywhere. Hard fit gate:
  Marco-KEXP 6.4 GB full-GPU on the 750 = **kernel reboot (never retry)**; in RAM on CPU it
  does 28.2 t/s. Prefill dense: the historical 5.77× was a weak CPU baseline → honest
  1.43× / 2.62×. `…adreno-moe-two-defects.md` (750 paragraph).
- **DECISION** — Owner, 2026-08-22: **park G57-class Mali**; reopen when a G610/G615 MC6
  device is in hand. `archived/ALIVE-2026-09-full.md:445`.

### 2026-08-12/13 — S23 / 740 sustained decode loses
- **MEASURED** — Qwen3.5-2B Q4_K_M, 15 min per arm: CPU 12.2 → 10.2 tok/s (−16%, 42.3 °C,
  still rising) vs GPU (`-ngl 99 -fa off`) flat 8.2 (38.5 °C, plateau). Energy proxy:
  CPU ~0.61 vs GPU ~0.79 battery-% per 1k tokens. **Verdict: CPU wins sustained.**
  `reports/moe-gpu-sustained.md:137-152`.
- **MEASURED** — Qwen3.5-4B: CPU 5.8 → 5.0 (−14%, 42.4 °C) vs GPU 4.2 → 4.0 (−5%, 40.9 °C);
  sustained GPU/CPU ≈ 0.80× at both 2B and 4B. "On the 740, GPU decode loses sustained at
  every product size. The GPU dividend on A7X remains prefill/TTFT only."
  `reports/moe-gpu-sustained.md:163-175`.

### 2026-08-11/12 — LiteRT on the S23: the foreign-kernel counter-result
- **ESTIMATE (MEASURED wall time)** — Galaxy S23 (SM-S911U) / Adreno 740 / driver 0676.73,
  unplugged. LiteRT/ML Drift Gemma-4-E2B-it on GPU: UI wall 3.4 s for ~91 estimated tokens
  ≈ **26.8 tok/s** vs llama-bench CPU size-matched **9.70 tok/s** = **~2.76×**; gate F1
  (≥1.15×) **PASS**. Verdict: a non-llama, non-subgroup kernel path DOES beat the same-device
  CPU on the 740's decode.
  `reports/moe-litert-f0-f1.md:73-97`.
- **CLAIM-UNVERIFIED (caveats, mandatory in the source)** — different models (Gemma vs
  Llama-3.2-3B), UI wall includes prefill, token count estimated as words×1.3, sustained
  ≥60 s protocol NOT reached, and it is not an A/B on the same GGUF/stack.
  `reports/moe-litert-f0-f1.md:81-87`.
- **DECISION** — "Just update the driver without root" is REFUTED: driver `0676.73` is the
  no-root end of the line for stock S23 for the subgroup-broadcast requirement.
  `reports/research-adreno740-custom.md:208, :223, :247`.

### 2026-08-09/11 — the two Adreno research answers
- **MEASURED (code) / ESTIMATE (RAM) / DECISION** — K4 zero-copy: see §5.1.
  `reports/research-adreno-opencl.md:140-170`.
- **MEASURED (published, not ours)** — ML Drift on Adreno 740 (S23 Ultra 8 GB), Table 2:
  Gemma 2B q8 decode **20.4** tok/s (prefill 1120), Gemma 2B 8/4/4 decode **38.1**
  (prefill 1150). No CPU column published on the 740.
  `reports/research-adreno740-custom.md:70-90`.
- **MEASURED (published)** — llama.cpp discussion #22791, S23 / Adreno 740 / driver 0676.73 /
  build b9071: Llama-3.2-3B Q4_K_M CPU 9.8 vs OpenCL 5.9 tg128; Qwen3.5-2B Q4_K_M CPU 14.6 vs
  OpenCL 10.8. `reports/research-adreno740-custom.md:15-26`.

### 2026-08-13 — dispatch overhead / recordable queues
- **MEASURED (web + driver dumps)** — neither our 740 (`0676.73` / `E031.41.03.62`) nor the
  750 (`0762.36.1` / `E031.45.02.25`) advertises `cl_khr_command_buffer`; both advertise
  Qualcomm's shipping `cl_qcom_recordable_queues`. Qualcomm IWOCL 2026 reports **up to ~10%
  uplift on selected large (MoE) models** from recordable queue replay.
  `results/cmdbuf/recon_q1_driver.md:12-22, :60-70`; `reports/research-cmdbuf.md:30, :41`.
- **ESTIMATE** — the measured enemy is ~60–150 ms/token of dispatch/glue overhead
  (~1000 kernel launches + 82 synchronous graph splits per token).
  `archived/mandates/cmdbuf-recon.md`.

---

## 2. Device inventory — what was attempted and what the numbers are

All on-device/CLI numbers below are `llama-bench` unless noted. `pp` = prefill, `tg` = decode.

| device | GPU | driver / compiler | kernels | GPUs vs CPU | source |
|---|---|---|---|---|---|
| Galaxy S23 (SM-S911U/B) | Adreno 740 | `0676.73` / `E031.41.03.62` | MoE q4_0/q4_1/q5_0/q5_1/mxfp4 + q4_K/q5_K/q2_K/q3_K PASS; **FA does NOT compile** | OpenCL decode `0.56–0.74×` CPU; sustained `0.80×`; LiteRT foreign stack `~2.76×` (est.) | `reports/research-adreno750.md:268, :320`; `reports/moe-gdn-k2-e2e.md:81`; `reports/moe-gpu-sustained.md:174`; `reports/moe-litert-f0-f1.md:77` |
| HDK8550 (QDC, SM8550 *class of S23*) | Adreno 740 | QDC image, `E031.41.03.56` | MUL_MAT 925/925, MUL_MAT_ID 407/407, **FA 229/229 PASS** | Q4_K_M: pp512 84.09, tg128 16.04 | `scratchpad/agents/qdc-8g2-oclpicks-53/REPORT.md`; `raw/tbo_base_fa_sa801919.out:6` |
| Xiaomi 14 (`houji`, SM8650) | Adreno 750 | `0762.36.1` / `E031.45.02.25` | MoE 407/407; dense 905/925 (20 f16/bf16-batched FAIL); **FA does NOT compile** | decode `0.66×` (2 interleaved pairs); A/C `0.992`; prefill A `2.48×`; KEXP prefill `2.21×` | `reports/moe-gdn-750.md:128-141`; `analysis/GOVERNOR-DEVICE-PLAN.md:427-441`; `…adreno-moe-two-defects.md` |
| QRD8650 (QDC, SM8650) | Adreno 750 | `E031.45.02.06` | MUL_MAT 905/925 (20 FAIL), MoE 407/407 | ship Q4_0: GPU pp512 284.2/291.1, tg128 23.4/23.0; CPU build 16.3/11.6 | `archived/ALIVE-2026-09-full.md:475, :490` |
| QRD7675 (QDC, SM7675, 7+ Gen 3) | Adreno 732 | `E031.45.02.09` | MUL_MAT 925/925, MoE 407/407; **FA does NOT compile** | ship Q4_0 GPU pp512 151.78, tg128 17.26; CPU 13.77/10.27 | `scratchpad/agents/qdc-7pg3-govbench-52/REPORT.md` |
| QRD8635 (QDC, SM8635, 8s Gen 3) | Adreno 735 | `E031.45` line | MUL_MAT 925/925, MoE 407/407, zero FAIL | ship Q4_0 GPU pp512 154.8, tg128 16.5; CPU 14.9/11.3 | `archived/ALIVE-2026-09-full.md:476` |
| QRD8750 (QDC, SM8750, 8 Elite) | Adreno 830 | `0800.71` / `E031.47.18.49` | MoE q2/q3 correct; oracle PASS on GPU prefill | KEXP: GPU pp512 274.5, tg128 48.9 vs CPU 107.4/60.7 | `archived/ALIVE-2026-09-full.md:460`; `reports/research-adreno750.md:301` |
| (research only) | Adreno 840 | `E031.50` | FA-on beats FA-off by 9–13% | inert by construction elsewhere | `reports/research-adreno750.md:107-108, :118` |
| Jelly Star (Helio G99) | Mali-G57 MC2 | ARM OpenCL 3.0 | f32 MUL_MAT 202/202; **q4_0/q6_K SIGILL 132, q4_K `CL_INVALID_WORK_GROUP_SIZE` (−54)**; MUL_MAT_ID q8_0 75/75 | GPU < CPU on all 20 green cases, max `0.962×`; no tok/s exists | `archived/ALIVE-2026-09-full.md:445`; `analysis/GOVERNOR-DEVICE-PLAN.md:503-516` |

Generic micro-architecture statements on the record:

- **MEASURED (code)** — the fork classifies `730/740/750` as `A7X`
  (`ggml-opencl.cpp:274-294`), has an A7X Flash-Attention compile carve-out, and no dense
  f16/bf16 result gate. `archived/docs/GPU-PREFILL-DIVERGENCE-2026-09-06.md`.
- **MEASURED (upstream)** — upstream carries a gate that excludes A6X/A7X entirely "for
  now", instead of fixing the restore path; still active at master as of 2026-08-20.
  `ops/memory-backup-2026-08-27/adreno-moe-two-defects.md` (trans4 paragraph).
- **MEASURED (upstream)** — the Adreno 740 and 850 "cannot reach these kernels: the A7X
  declines every mixed and quantized FA combination (`clBuildProgram` SIGSEGV)"; 750 is
  A7X, 830/840 are A8X. `reports/research-adreno750.md:107-108, :308`.
- **ESTIMATE (published)** — ALU utilisation during compute-bound prefill: **<3% on
  Mali-G720 vs ~20% on Adreno 750**; Adreno 750 is 1.6× Mali-G720 in decode.
  `archived/docs/research-adreno-vs-mali-8xx-2026-08.md`.
- **DECISION** — for 8xx tuning, cloud device farms first (QDC/Firebase/AWS); physical
  hardware only for thermal questions. `ops/memory-backup-2026-08-27/qdc-device-cloud.md`;
  `archived/docs/research-adreno-vs-mali-8xx-2026-08.md`.

---

## 3. Kernel compilation outcomes on Adreno — exact errors

### 3.1 The quoted Adreno 732 failure — SOURCE FOUND

The claim as it appears in the governance recon table:

> "Adreno 732 | prefill | FA kernels do not compile: missing `sub_group_shuffle_xor`, then a
> 1.68 GiB alloc failure and segfault"

**Source:** `scratchpad/agents/governor-gpu-recon/REPORT.md:520`, which cites
`scratchpad/agents/qdc-7pg3-govbench-52/REPORT.md`. The primary text is
`scratchpad/agents/qdc-7pg3-govbench-52/REPORT.md:28-42` (**MEASURED**, 2026-09-03):

> `ggml_opencl: kernel compile error (err=-11) building fa f32_f16`
> `error: implicit declaration of function 'sub_group_shuffle_xor'`
>
> "Every FA-enabled context init then fell into an OpenCL buffer alloc failure
> (1,804,626,176 bytes ≈ 1.68 GiB) and a segfault."

Raw evidence, `scratchpad/agents/qdc-7pg3-govbench-52/raw/loadprobe_FAcrash_sa801864.out:2-25`
(**MEASURED**):

```
0.10.897.846 E ggml_opencl: kernel compile error (err=-11) building fa f32_f16:
BC-src-code:2010:22: error: implicit declaration of function 'sub_group_shuffle_xor' is invalid in C99
                s += sub_group_shuffle_xor(s, step);
BC-src-code:2056:19: error: call to builtin 'max' is ambiguous due to multiple possible argument type matches
            m_c = max(m_c, sub_group_shuffle_xor(m_c, step));
...
0.18.374.316 E ggml_gallocr_reserve_n_impl: failed to allocate OpenCL buffer of size 1804626176
0.18.374.330 E graph_reserve: failed to allocate compute buffers
0.18.397.057 E llama_init_from_model: failed to initialize the context: failed to allocate compute pp buffers
Segmentation fault
nproc=8 cpu_mask=0xf0 exit=139
```

Two details the recon table drops: the raw error also contains the **ambiguous `max`**
diagnostic, and the crash is **exit 139 (SIGSEGV)**, after a failed `graph_reserve`. The
independent audit confirmed the byte count against the raw file
(`scratchpad/agents/qdc-7pg3-govbench-52/AUDIT-REPORT.md:34, :41`) and required the wording
"1.68 GiB" instead of the ambiguous "1.8 GB".

### 3.2 Adreno 740 — the S23's own hardware fails FA; the QDC board passes

- **MEASURED** — S23, driver `0676.73` / compiler `E031.41.03.62`: official `-ngl 99`
  **aborts** compiling flash-attn; log shows `sub_group_shuffle_xor` implicit-declaration and
  an ambiguous `max`, then `std::out_of_range: map::at`; exit 139 then 134. With `-fa off`
  the graph runs but greedy output is repetition garbage and decode is ~3 tok/s vs ~11 CPU.
  `reports/moe-gdn-k2-e2e.md:13, :56, :81, :108, :164`.
- **MEASURED** — same class documented in `reports/moe-gdn-750.md:141` as "Same hole as
  740", and in `archived/PLAN-archive.md:8999` where the 732's failure is called
  "tier-specific" relative to the 740.
- **MEASURED** — the 740 on QDC's HDK8550, compiler `E031.41.03.56`: FA **compiles and
  passes 229/229**; the report calls the 732 crash tier-specific and recommends a per-GPU FA
  capability probe. `scratchpad/agents/qdc-8g2-oclpicks-53/REPORT.md:38-41`.
- **MEASURED** — the driver version is load-bearing for the q4_K mask miscompile:
  `E031.41.03.62` on the 740 forced masks to kernel arguments.
  `analysis/GOVERNOR-DEVICE-PLAN.md:237-242`.

**Unresolved:** the S23 (`.62`) and the QDC 740 (`.56`) are the same chip class on different
micro-versions of the same `E031.41` compiler. No document we hold reconciles the FA
outcome; see §7.

### 3.3 Adreno 750 — FA compile failure, exact text

**MEASURED** — Xiaomi 14, `-ngl 99` with fa default, exit **134**:

```
ggml_opencl: kernel compile error (err=-11) building fa f32_f16:
BC-src-code:2010:22: error: implicit declaration of function 'sub_group_shuffle_xor'
                s += sub_group_shuffle_xor(s, step);
...
libc++abi: terminating due to uncaught exception of type std::out_of_range: map::at:  key not found
```

`reports/moe-gdn-750.md:128-141`. The report stresses: not a SIGSEGV, but
`CL_BUILD_PROGRAM_FAILURE` (−11) plus an uncaught `map::at`; init still prints
`subgroup shuffle support: true` / `cl_qcom_subgroup_shuffle support: true`, and that flag is
NOT the builtin FA uses. `reports/research-adreno750.md:308` adds that upstream PR #26430
has Qualcomm confirming A7X declines every mixed/quantized FA combination.

### 3.4 Compiler micro-versions and the miscompile map

- **MEASURED** — `E031.41.03.62` (S23 740) broken for the q4_K mask case; `E031.45` (Adreno
  619) fixed for a specific q6_K codegen bug; `E031.50` (840) fine.
  `reports/research-adreno750.md:293`.
- **MEASURED** — the 750's 20-FAIL family is present in both `.02.06` and `.02.16` and the
  732 passes with `.02.06` → the discriminant is the GPU (750), not the compiler version.
  `archived/ALIVE-2026-09-full.md:489-490`.
- **MEASURED** — `-cl-opt-disable` does **not** compile at all on `E031` (err −6), so `-O0`
  is not a usable experiment on this compiler.
  `ops/memory-backup-2026-08-27/adreno-moe-two-defects.md` (K2 paragraph).
- **MEASURED** — the binary kernel library (`GGML_OPENCL_USE_ADRENO_BIN_KERNELS`) is a hard
  `#error` in our tree; the library targets X2 parts (Snapdragon X2, Windows) and is
  irrelevant to phone 750/830 dense decode. `analysis/FORK-VENDOR-MIGRATION.md:732, :775`;
  `reports/research-adreno750.md:41`.
- **MEASURED** — Vulkan is not an escape: on the A740 zero K-quants are executable
  (`createComputePipeline` ErrorUnknown → SIGABRT, `supports_op` lies); on Mali-G57 the
  Vulkan backend requires `vkGetBufferDeviceAddress`, which the driver does not expose
  (`ggml_vk_create_buffer:3233`) → SIGSEGV on first alloc.
  `ops/memory-backup-2026-08-27/adreno-moe-two-defects.md`;
  `archived/ALIVE-2026-09-full.md:445`; `archived/PLAN-archive.md:8999`.

### 3.5 Compilation success on Adreno — what DOES compile

- **MEASURED** — the six-fix MoE kernel set runs and passes on the 740:
  `MUL_MAT_ID 391/391 → 401/401 → 407/407` across the campaign, all types, dense
  `915/925 → 925/925` after the cherry-pick. `…adreno-moe-two-defects.md`.
- **MEASURED** — the fork ships an OpenCL MoE kernel chain whose masks are passed as kernel
  arguments; both fix commits (`2361be359`, `26c7affb7`) are ancestors of the shipped pin
  `8537d097c`, so the fix IS in the shipped engine. `PLAN.md:105-125`; `docs/ALIVE.md:22`.
- **MEASURED** — the OpenCL merge surface we must protect: `ggml-opencl.cpp` +3124/−117 in
  our tree (41/90 upstream hunks, 46% of days, 77 hunks); kernels directory +1913/−356 with
  6 files upstream never touches. `analysis/FORK-VENDOR-MIGRATION.md:119, :358-361, :526-530`.

---

## 4. Memory behaviour on Adreno

### 4.1 Allocation failures and OOM

- **MEASURED** — FA-enabled context init on the 732 fails to allocate a **1,804,626,176-byte
  (1.68 GiB)** OpenCL buffer, then `graph_reserve` fails, then SIGSEGV (exit 139).
  `scratchpad/agents/qdc-7pg3-govbench-52/raw/loadprobe_FAcrash_sa801864.out:19-25`.
- **MEASURED** — the S23's power-offs on Mellum2 were the default **ARM REPACK**
  (`use_extra_bufts=true`), ~6.5 GB of anonymous `posix_memalign` at Q4_K_M scale on 8 GB →
  kernel death even at `-ngl 0`. Production is immune (`use_extra_bufts=false` wired); for
  bench on 8 GB devices always use the no-extra-bufts variant.
  `ops/memory-backup-2026-08-27/adreno-moe-two-defects.md` (oomwall paragraph).
- **MEASURED** — hard fit gate on the 750: Marco-KEXP 6.4 GB at full GPU = **kernel reboot,
  never retry**; on CPU in RAM it does 28.2 t/s. `…adreno-moe-two-defects.md`.
- **MEASURED** — two contexts on the 8 Elite: RAM 12.3 → 8.0 GB, **0 lmkd kills**; on the
  750 the same shape gives MemAvailable 8.7 → 4.4 GB with `lmkd` "critical" and 1 system
  kill. `archived/ALIVE-2026-09-full.md:485`.
- **CLAIM-UNVERIFIED** — "`lmkd` killed the app, and a 6.4 GB model at full GPU restarted
  the kernel; `lmkd` is not caught, no fallback fires." Present in the audited Italian body
  `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:274-276`; the 2026-09-20 re-verification
  marks the 6.4 GB part **UNSOURCED** (`analysis/GOVERNOR-DEVICE-PLAN.md:272`). See §7.

### 4.2 The two-context GPU budget and the fit gate

- **MEASURED (code) / ESTIMATE** — `gpuFit()` computes
  `gpuReserveMiB = 800 + 1.05 × offloadedBytes / MiB`, then
  `requiredMiB = nonEvictable + gpuReserve + compute + kv`; it rejects `total <= 8 GiB` (which
  excludes the Jelly outright) and `generation === Unknown`.
  `analysis/GOVERNOR-DEVICE-PLAN.md:156-166`.
- **MEASURED (code)** — the fit estimator is "structurally blind to GPU memory": the input to
  `estimateMemory` has no backend field, and the test treats weights as file-backed evictable
  pages, which GPU offload inverts. `analysis/GOVERNOR-DEVICE-PLAN.md:268-272`.
- **CLAIM-UNVERIFIED** — `gpuReserveMiB = 800 + 1.05 × offloadedBytes` is an S23-derived
  constant; ALIVE row 12 required a second model/device before shipping.
  `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:995-996`.
- **MEASURED (code)** — the loopback route contradicts the telemetry: below 45% battery
  (`requested == CPU`) admission is `Admit`, which lands on `prefill_route_ = GPU` and sends
  the batch to `ctx_prefill` (`n_gpu_layers = 99`). `analysis/GOVERNOR-DEVICE-PLAN.md:340-347`.

### 4.3 Host-pinned, zero-copy, mmap

- **MEASURED (code)** — the backend's weight path is a plain device buffer with a write, not
  host-pinned: `clCreateBuffer(context, CL_MEM_READ_WRITE, size, NULL, …)`, no
  `CL_MEM_ALLOC_HOST_PTR` / `CL_MEM_USE_HOST_PTR` in the main path. Detail in §5.1.
  `reports/research-adreno-opencl.md:146`.
- **MEASURED** — the fork's `DenseWeights` carries explicit residency policies
  `Mmap / Warmed / Anonymous / Pinned`, separate from the expert streamer; the expert rebind
  of `->data` only works if experts stay on CPU buffers.
  `reports/research-adreno-opencl.md:245, :262`.
- **MEASURED (CPU/IO path, not GPU)** — on the same file/UFS 4.0, mmap page-fault gives
  **0.2–0.4 GB/s** vs prefetch **1.8 GB/s**; the pattern dominates the flash.
  `ops/memory-backup-2026-08-27/measurement-ceiling-method.md` (item 6).
- **CLAIM-UNVERIFIED (plan-only)** — `AHardwareBuffer` is not integrated in ggml and "would
  have to be written"; this is the only place in the corpus that names it.
  `archived/PLAN-archive.md:4436`.
- **MEASURED (code)** — SVM is queried and logged (`CL_DEVICE_SVM_*`) but weights are not
  mapped zero-copy via SVM in the `set_tensor` path. `reports/research-adreno-opencl.md:148`.

---

## 5. Shared weights, zero-copy, reload — prior attempts and decisions

### 5.1 K4: the zero-copy answer of 2026-08-09 — the direct hit on this mission

**CLAIM-UNVERIFIED (mandate question)** — the K4 mandate explicitly asks whether the weights
live "in unified memory (zero-copy) or must be copied", names `CL_MEM_ALLOC_HOST_PTR` and the
Qualcomm extensions `cl_qcom_ext_host_ptr` / ION / dmabuf, and states the budget: 8 GB total
with ~3.9 GiB already taken by our process, so "how much does it cost in RAM to move
~1.5–2 GiB of dense to GPU buffers?"
`archived/mandates/research-adreno-opencl.md:39-42`.

**MEASURED (code) / ESTIMATE (RAM) — the answer, verdict GIALLO:**

- `clCreateBuffer(..., NULL, …)` — a standard **device buffer**, not
  `CL_MEM_ALLOC_HOST_PTR` / `CL_MEM_USE_HOST_PTR` in the main path.
  `reports/research-adreno-opencl.md:146`.
- SVM is probed and logged but the weights are not mapped zero-copy.
  `reports/research-adreno-opencl.md:148`.
- Qualcomm features shipping are layout/copy optimisations (image-backed weights, large
  buffer, xmem GEMM prepack), "not elimination of GPU residency".
  `reports/research-adreno-opencl.md:149`.
- `cl_qcom_ext_host_ptr` / ION / dmabuf for llama.cpp weights: **NOT FOUND** in the
  backend. `reports/research-adreno-opencl.md:151, :153`.
- Conclusion: "not magic zero-copy. It is **UMA with a load copy and a device buffer**."
  Moving 1.5–2 GiB of dense to GPU is feasible **only if** the corresponding host residency
  is released and the expert cache is kept tight; otherwise `3.9 + 1.75 + expert cache` is
  outside the 8 GB budget. Verdict **GIALLO**. `reports/research-adreno-opencl.md:168-170,
  :289`.

**DECISION (2026-08-09)** — the research recommendation was **NO-GO** on the full
fork+OpenCL+stream integration spike as the primary "serious experiment"; a low-cost 1–3 day
kill sequence was offered instead (S1 backend smoke, S2 small MoE `-ot`/`n-cpu-moe`, S3
fidelity+RSS, S4 only if S1–S3 pass). `reports/research-adreno-opencl.md:339-381`.

### 5.2 The related foreign-kernel gate (2026-08-11) and its decision

- **MEASURED (published) / ESTIMATE** — ML Drift's tensor-virtualisation path does not depend
  on llama's subgroup broadcast; on the 740 it publishes decode 20.4–38.1 tok/s (Gemma 2B).
  Our own LiteRT F1 on the S23 gave ~2.76× over the same-device llama CPU (estimated).
  `reports/research-adreno740-custom.md:70-90`; `reports/moe-litert-f0-f1.md:73-97`.
- **DECISION** — the "different kernel" door is technically open in nature but practically
  closed for our stack until the cost is (a) rewriting the no-subgroup Adreno MUL_MAT inside
  a llama fork (permanent maintenance) or (b) abandoning llama/BigMoe for LiteRT
  (incompatible with the current hybrid MoE streaming). An F3 kernel spike was gated on
  F1 GO plus owner acceptance. `reports/research-adreno740-custom.md:253-278`.
- **CLAIM-UNVERIFIED** — "any port of kernels into our stack = local llama.cpp fork
  (AGENTS policy) — include the maintenance cost in the estimate."
  `archived/mandates/research-adreno740-custom.md`.

### 5.3 Reload-on-flip and the reload budget

- **MEASURED (code)** — an engine change is a context reload: contexts are built with fixed
  `n_gpu_layers` (`rn-llama.cpp:72-73`), the KV route is validated at construction, and
  `select_decode` returns `-2` on `requires_reload`; `clear_cache` resets the route and both
  side-states. Existing hysteresis `k_dwell_ms = 10 min` and `k_flip_window_ms = 60 min` with
  `last_gpu_engagement_ms_` exists precisely for this; the proposed single-selector refactor
  silently drops both. `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:991`.
- **MEASURED (code) / DECISION** — `reload_budget_available` is a wire field: the fork header
  defaults it `true` (`archived/ALIVE-2026-09-full.md:2162`) while the JS sends `false`
  (`analysis/GOVERNOR-DEVICE-PLAN.md:149`). It "kills the decode cool lane":
  `select_decode` requires thirteen simultaneous clauses including `generation == V73` (while
  the app enables only V75/V79), `cool_delta_measured`, `kexp_cool_scope` (never serialised)
  and `reload_budget_available` written `false` by hand. "The hot → move decode to GPU to cool
  down lane is unreachable on every phone." `analysis/GOVERNOR-DEVICE-PLAN.md:593`;
  `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:680`.
- **MEASURED (code)** — the parser defaults `t_idle_valid` to `false` at
  `cpp/rn-governor-params.cpp:86`; `profile_is_valid` requires it when `plugged`, so
  `plugged = true` → profile `Invalid` → `Abort` → sticky `failed = true`. This is the
  charger defect (5.2) that blocks in-app GPU measurement. `analysis/GOVERNOR-DEVICE-PLAN.md:565-575`.
- **MEASURED (code)** — `moe_stream.reset()` is required at each CPU↔governor reload; the
  history records it as a fix residue (2026-09-04). `archived/ALIVE-2026-09-full.md:1934, :1947`.
- **DECISION** — for 2026-09-19/20 the governor plan's Rule 3 would drop the two
  reload-ratchet mechanisms; the audit recorded this as a defect to fix before measuring.
  `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:991`; `analysis/GOVERNOR-DEVICE-PLAN.md:22-30, :585-595`.

### 5.4 What was never proposed

- No document anywhere in scope proposes a **host-pinned / `CL_MEM_ALLOC_HOST_PTR` weight
  buffer**, a **shared-weights buffer between two contexts**, or a **reload-on-flip budget as
  a product feature**. `CL_MEM_ALLOC_HOST_PTR` appears once, as the K4 question
  (`archived/mandates/research-adreno-opencl.md:39`), and is answered no
  (`reports/research-adreno-opencl.md:146`).
- The word "zero-copy" appears in the plan history once, in the AHardwareBuffer note
  (`archived/PLAN-archive.md:4436`), and otherwise only in the K4 answer.
- `analysis/README-governor-kv-contract.md`, `analysis/CISWIRE-…`, and the Xiaomi/Qwen
  analyses contain no GPU, zero-copy or shared-weight content.

---

## 6. What was decided about each phone, and the stated next step

### Galaxy S23 — Adreno 740 (V73)
- **DECISION** — governor off **by table** (`GPU_PREFILL_CORRECT.V73: false`), not by
  measurement; GPU prefill on the 740 has never been measured in-app.
  `analysis/GOVERNOR-DEVICE-PLAN.md:470-479, :181`.
- **MEASURED** — the llama.cpp OpenCL path loses decode to CPU (0.56–0.74×); sustained
  decode loses at 2B and 4B; GPU experts win burst (2.17×) and sustained (~1.5×) on
  OLMoE-1B-7B Q4_K_M but Arm C (pure CPU) still wins absolute (27.69 vs 20.03), and
  KEXP cool-mode is −19% speed for −2.75 °C. `reports/moe-gpu-sustained.md:174`;
  `ops/memory-backup-2026-08-27/adreno-moe-two-defects.md`.
- **DECISION** — half-offload never; streaming GPU irrelevant (CPU 0.216 ≈ dense-trunk-GPU
  0.223); Vulkan dead on K-quants; NPU rejected (0.67 MiB). `…adreno-moe-two-defects.md`.
- **Next step stated** — `analysis/GOVERNOR-DEVICE-PLAN.md` §6.2 cell 4: "**S23, GPU prefill
  on the 740**, with the `adsprpcd`/`cdsprpcd` background declared alongside"; Part 9 step 9
  ("S23 and Jelly … the two phones currently excluded by table") depends on the refactor
  and on the Jelly research. `analysis/GOVERNOR-DEVICE-PLAN.md:641, :690-694`.
- **Next step (current)** — the GPU probe (Part 9 step 2) and the runtime probe with
  `gpubusy` (step 3) are pulled ahead of G2 by the owner on 2026-09-21.
  `PLAN.md:199-211`.

### Jelly Star — Mali-G57 MC2
- **MEASURED / DECISION** — lane closed by measurement and by owner decision; owner parked
  G57-class on **2026-08-22** ("Reopen when a G610/G615 MC6 device is in hand").
  `analysis/GOVERNOR-DEVICE-PLAN.md:494-501`; `archived/ALIVE-2026-09-full.md:445`.
- **MEASURED** — after portability patches, dense quant still fails on architecture gaps:
  `q4_0` SIGILL 132, `q4_K` `CL_INVALID_WORK_GROUP_SIZE` (−54), `q6_K` SIGILL 132; f32
  MUL_MAT 202/202 passes; MUL_MAT_ID q8_0 75/75. No tok/s exists on this lane.
  `analysis/GOVERNOR-DEVICE-PLAN.md:497-516`.
- **MEASURED** — with the shipped APK the Jelly has no accelerator: 8 GB total trips
  `total <= EIGHT_GIB` ⇒ `NoFit`, and `Unknown` generation turns the governor off first.
  `analysis/GOVERNOR-DEVICE-PLAN.md:530`.
- **DECISION (recommendation)** — GPU off by default; decode on the A76 pair; the only lever
  is the CPU itself. `analysis/GOVERNOR-DEVICE-PLAN.md:541`.
- **CLAIM-UNVERIFIED** — the plan says the earlier "half a day of PC plus 30 minutes of
  Jelly" estimate to finish the lane is superseded because it predates the architecture-gap
  result. `analysis/GOVERNOR-DEVICE-PLAN.md:501`.

### Xiaomi 14 — Adreno 750 (V75) and the other QDC tiers
- **DECISION** — Owner, 2026-09-07: GPU prefill ON for V75 on effect size, even though the
  binary oracle verdict stays `FAIL rule=R2` by design; q4_K high tier remains unmeasured
  in-app and V73 stays false. `archived/ALIVE-2026-09-full.md:492`;
  `scratchpad/agents/gemm-f32-ship/DECISION.md`.
- **DECISION (parked)** — QRD8635 / HDK8550: no in-app B is possible without extending the
  policy table; "PARCHEGGIATI per l'owner". `archived/ALIVE-2026-09-full.md:487`.
- **DECISION** — V79 (830) is `GPU_PREFILL_CORRECT: true`; V73 (732/735/750-8s) is false and
  stays false (speed condition met, oracle condition not). `archived/ALIVE-2026-09-full.md:489-491`;
  `analysis/GOVERNOR-DEVICE-PLAN.md:124-128`.

---

## 7. Where documents disagree

1. **`lmkd` / the 6.4 GB kernel restart.** The audited Italian body states it as measured:
   "Misurato: lmkd ha ucciso l'app, e un modello da 6,4 GB a GPU piena ha riavviato il
   kernel." `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:274-276`. The English rewrite
   of 2026-09-20 marks that exact claim **UNSOURCED**: "the earlier draft's 'a 6.4 GB model
   at full GPU restarted the kernel' has no artefact located in the re-check".
   `analysis/GOVERNOR-DEVICE-PLAN.md:272`. The rewrite's verification table keeps the item as
   numbered 4 (the Thermal Status census) but not this one; treat the Italian sentence as
   **CLAIM-UNVERIFIED**.
2. **Does FA compile on the Adreno 740?** Two measured answers on the same nominal GPU:
   - **NO** on the S23 at driver `0676.73` / `E031.41.03.62`: `sub_group_shuffle_xor`
     implicit-declaration + ambiguous `max` + `map::at`, exit 139 then 134.
     `reports/moe-gdn-k2-e2e.md:81, :164`; `reports/moe-gdn-750.md:141` ("Same hole as 740").
   - **YES** on QDC HDK8550 (SM8550, the S23's SoC class) at compiler `E031.41.03.56`:
     FLASH_ATTN_EXT **229/229 PASS**, and the 732's failure is called "tier-specific".
     `scratchpad/agents/qdc-8g2-oclpicks-53/REPORT.md:38-41`;
     `raw/tbo_base_fa_sa801919.out:6`.
   The two boards differ in the compiler micro-version (`.62` vs `.56`) and possibly in the
   ICD build; no document reconciles them. This matters directly: if the S23's FA failure is
   the `.62` micro-version, a driver probe is a hard fork in any GPU plan for this phone.
3. **750 KEXP prefill ratio.** `archived/ALIVE-2026-09-full.md:460` gives the 8 Elite numbers
   and calls the 750 "GPU-2.21×-prefill / tie-decode"; the consolidated memory
   (`ops/memory-backup-2026-08-27/adreno-moe-two-defects.md`, 750 paragraph) records
   "prefill A=2.48× (KEXP)". Both are labelled measured; the difference (2.21 vs 2.48) is
   not explained in either. Use with caution.
4. **Mali lane status.** The audited Italian governor draft reopened the Mali lane under a
   heading that presented itself as a correction ("Mali non e' utilizzabile" is false).
   `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:534-535`. The 2026-09-20 rewrite
   rejects the reopening: gates 3 and 4 ran, architecture gaps remain, and the owner parked
   G57 on 22/08; the half-day estimate is superseded.
   `analysis/GOVERNOR-DEVICE-PLAN.md:494-501`; verification item 2 in the same file.
5. **"The corrected Adreno prefill path is measured."** `archived/PLAN-2026-09-full.md:38`
   reads "The governor and corrected Adreno prefill path are measured, but each
   generation/model path still requires its own correctness evidence". Read against
   `analysis/GOVERNOR-DEVICE-PLAN.md:478` ("GPU prefill on the 740 has never been measured
   in-app"), the two are reconcilable only if "measured" means the 750/830 CLI cells. The
   S23's 740 remains unmeasured in-app.
6. **The zero-copy question itself.** The K4 answer (no zero-copy; UMA with a load copy) is a
   **code reading of the mainline/fork backend** (`reports/research-adreno-opencl.md:140-170`),
   not a device probe of `cl_qcom_ext_host_ptr` on `0676.73`. It answers "what the shipped
   backend does", not "what the driver could do if we wrote the path". The two claims are
   often conflated; keep them separate.

---

## 8. WHAT WE DO NOT KNOW

1. **Whether an Adreno 740 host-pinned / zero-copy weight buffer is reachable at all on
   `0676.73`.** The K4 answer says the current backend does not use
   `CL_MEM_ALLOC_HOST_PTR`; no device probe of `cl_qcom_ext_host_ptr` / ION / dmabuf on this
   ICD exists (`reports/research-adreno-opencl.md:151-153`).
2. **What a host-pinned dense buffer costs in RAM on an 8 GB S23 with two contexts.** No
   measurement; `gpuReserveMiB = 800 + 1.05 × offloadedBytes` is an estimate and the plan
   itself says it must be measured once per phone (`analysis/GOVERNOR-DEVICE-PLAN.md:276`).
3. **Whether host residency can be released after upload in the fork's `DenseWeights`
   design.** The K4 conclusion requires it ("only if you release the corresponding host
   residency"), but no experiment was run (`reports/research-adreno-opencl.md:168`).
4. **Whether the S23's 740 can beat its own CPU on decode with a no-subgroup kernel inside
   our fork.** LiteRT says the silicon/toolchain can (~2.76× est., caveated); our fork has
   never been tried. `reports/moe-litert-f0-f1.md:73-97`.
5. **Why FA compiles on the QDC 740 and not on the S23 740** (`.56` vs `.62`, ICD build
   unknown). No clinfo-level diff between the two is archived; see §7 item 2.
6. **The real cost of one engine flip on the S23.** "Switch decode = reload (mmap, seconds)"
   is an estimate in the tri-engine design study (`archived/PLAN-archive.md:8991`), never
   measured on the S23; the plan's hysteresis constants (`10 min`, `60 min`) exist because of
   that unmeasured cost.
7. **`gpubusy` baseline.** Unmarked in the plan; the corpus's only value is `~49%`,
   hand-transcribed and already flagged `PLAUSIBLE (unevidenced)`
   (`analysis/GOVERNOR-DEVICE-PLAN.md:663-666`).
8. **In-app GPU prefill on the S23 at all.** Blocked by the charger defect (5.2) and by
   `V73: false`; the measurement cell (Part 9 step 9 / §6.2 cell 4) has not run.
9. **Any tok/s on the Mali-G57 lane.** `llama-bench` was never run there; the quantised path
   aborts (`analysis/GOVERNOR-DEVICE-PLAN.md:516`).
10. **Adreno 840 as hardware.** Only published web figures (FA-on +9–13% over FA-off); we
    have never held an 840 device and the plan's 8xx stance is cloud-first.
    `reports/research-adreno750.md:107-118`.
11. **Sustained 740 GPU decode at product sizes beyond 4B.** The sustained campaign closed at
    2B and 4B; the KEXP/OLMoE verdicts are burst/short-session
    (`reports/moe-gpu-sustained.md:174`; `…adreno-moe-two-defects.md`).
12. **Whether the 750's dense f16/bf16-batched 20-FAIL root cause is fixed or merely gated.**
    The gate (`ADRENO && !ggml_is_contiguous(src0)`) is a workaround; the cause on the 750 is
    "still unexplained" (`archived/ALIVE-2026-09-full.md:490`).
13. **Whether the `GPU_PREFILL_CORRECT` table will be replaced by a probe for the S23 in this
    cycle.** The refactor is Part 9 step 7; nothing on disk records it as started.
    `analysis/GOVERNOR-DEVICE-PLAN.md:682-694`.

---

## 9. INDEX — where the raw evidence for each number lives

| number / claim | raw evidence |
|---|---|
| 732 FA compile error, 1.68 GiB, segfault 139 | `scratchpad/agents/qdc-7pg3-govbench-52/raw/loadprobe_FAcrash_sa801864.out`; audit `…/AUDIT-REPORT.md:34, :41` |
| 732 pp512 151.78 / tg128 17.26; 925/925; 407/407 | `…/qdc-7pg3-govbench-52/raw/bench_gpu_sa801864.out`, `bench_cpu_pure_sa801864.out`, `tbo_mm_sa801864.out`, `tbo_mmid_sa801864.out` |
| 740 (HDK8550) pp512 84.09 / tg128 16.04; FA 229/229; compiler .56 | `scratchpad/agents/qdc-8g2-oclpicks-53/raw/bench_{base,picks}_{1,2}_sa801919.out`, `tbo_{base,picks}_fa_sa801919.out:6`, `kit_verify_sa801919.txt`, `recon_sa801919.txt` |
| 750 pp512 284.18 / 291.11; 905/925 with 20 FAIL | `scratchpad/agents/qdc-8g3-govbench-55/`; `qdc-8g3-rerun-58/REPORT.md:29, :34, :48`; `qdc-750-mulmat-view/ANALYSIS-f16-l4.md` |
| 735 pp512 154.82 / tg128 16.49 | `scratchpad/agents/qdc-8s3-govbench-56/REPORT.md:49` |
| 830 KEXP GPU 274.5/48.9 vs CPU 107.4/60.7 | `scratchpad/agents/qdc-8elite-speed-kexp/`; `qdc-8elite-governor-8b/` |
| 740 sustained decode 2B/4B, −16% / −14% CPU, 42.3 / 42.4 °C | `reports/moe-gpu-sustained.md:137-175`; `results/gpu_sustained/`, `results/gpu_sustained_4b/` |
| 740 LiteRT ~26.8 tok/s est vs 9.70 CPU | `reports/moe-litert-f0-f1.md`; `results/litert_f1/{llama_bench_unplugged.json,gpu_quick_rep1.json,gpu_quick_rep2.json}` |
| 740 driver 0676.73 / E031.41.03.62 | `results/gdn_gpu_k2/s23/logs/support_gdn.txt:5`; `reports/moe-gdn-k2-e2e.md:56`; `reports/research-cmdbuf.md:41, :422` |
| 750 FA err=-11 / map::at / exit 134 | `reports/moe-gdn-750.md:128-141`; `results/gdn_gpu_750/` |
| 750 in-app divergence (token 14; ids lines) | `scratchpad/agents/qdc-governor-s5/raw/sa803459/QRD{8650,8750}_{A,B}_t*_ids.txt`; `…/qdc-governor-s5b/raw/sa808770`, `sa811420`, `sa811930` |
| 750 KLD 0.4538 → 0.004736; 0.659× fix cost | `scratchpad/agents/adreno-precision-bisect/`, `adreno-acc-type/`, `adreno-operand-b/`; `archived/docs/GPU-PREFILL-DIVERGENCE-2026-09-06.md` |
| 740/750 arm C wins; OLMoE 2.17×/1.5×; Vulkan dead; NPU 0.67 MiB; repack OOM | `ops/memory-backup-2026-08-27/adreno-moe-two-defects.md`; `scratchpad/agents/oomwall/`; `evidence-audit/` |
| q16-xiaomi A/C 0.992, pp 2.477 (750) | `scratchpad/agents/q16-xiaomi/REPORT.md:4, :26, :336, :378`; `q16-xiaomi-audit/REPORT.md:137` |
| Xiaomi GPU prefill 3.18× / decode 0.66×; length curves | `results/gpu_prefill_recheck_xiaomi/report.md:20-32, :42, :48-85` |
| Mali-G57 gates 1–4 | `results/mali_gate_jelly/raw/`, `raw2/`, `raw3/`, `raw4/`; `scratchpad/agents/q26-mali-gate/REPORT.md:5, :69`; `q26b-mali-probe/REPORT.md:3, :174, :218-221, :268` |
| 740/750 recordable queues; no `cl_khr_command_buffer` | `results/cmdbuf/recon_q1_driver.md`; `reports/research-cmdbuf.md:30, :41, :107, :422` |
| K4 zero-copy / host-pinned answer | `reports/research-adreno-opencl.md:140-170, :289`; mandate `archived/mandates/research-adreno-opencl.md:39-42` |
| AHardwareBuffer note | `archived/PLAN-archive.md:4436` |
| gpuFit / two-context budget / reload budget | `analysis/GOVERNOR-DEVICE-PLAN.md:149, :156-166, :268-276, :593`; `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md:274-276, :680, :991, :995-996` |
| Thermal census / gpubusy / S23 daemons | `scratchpad/agents/governor-audit-recheck/REPORT.md:146-150`; `scratchpad/agents/n10-kexp-audit/REPORT.md:42, :79` |

---

*End of report. Read-only exploration; no device, no edits outside this file, no commits, no push.*
