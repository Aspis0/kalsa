# QDC / GPU / NPU / governor / energy — what the corpus already knows (2026-09-16)

READ-ONLY reconnaissance map. Statuses: **MEASURED** (on-device number, with scope), **RETRACTED**
(quoted somewhere but withdrawn), **SUPERSEDED** (true when made, replaced later), **CONTESTED**
(two documents disagree — both quoted), **NOT MEASURED**. Every load-bearing row carries
`file:line` plus the verbatim line. Two roots: `kalsa/` = the app repo (paths below relative to
`/Users/marco/Projects/kalsa/`); `moe/` = the separate repo `/Users/marco/Projects/kalsa-moe-experiments/`.

## 0. Orientation — the shape of the corpus

Three layers, three truth levels:

1. **The measurement repo (`moe/`)** holds the primary numbers: `docs/ALIVE.md` (5 410 lines —
   curated §1–§9 plus a numbered cell ledger, rows 1–61, that banks every QDC-era cell),
   `reports/` (133 files), `results/` (165 top-level campaign dirs), and per-cell PREREG/REPORT/
   AUDIT under `scratchpad/agents/` (QDC cells live under `qdc-*`, `adreno-*`, `npu-decode-kv`,
   `gemm-f32-ship`). `archived/docs/GOVERNOR-STATE-2026-09-04.md` is a 139-line MEASURED/DECIDED/
   IMPLEMENTED/OPEN digest with file:line for the whole governor question.
2. **The app repo (`kalsa/`)** holds the product-side record: `archived/docs/HARNESS_FINDINGS.md`
   (5 351 lines, §7 device track + retraction ledger in the header and change log),
   `archived/docs/KALSA.md` (§2.1 lineup, §7 device/backend table with SUPERSEDED banners),
   `docs/ENERGY-*.md` (the merged energy framework) and eleven `ENERGY-*AUDIT*` files at the root.
3. **The living plan** is `moe/PLAN.md` (owner goal: "Kernel che usa NPU, GPU e CPU **per fase**…",
   PLAN.md:9-14) with `moe/docs/ALIVE.md` as its status view; the kalsa-side twin is
   `kalsa/kalsa-moe-experiments/PLAN.md` + `kalsa/kalsa-moe-experiments/docs/ALIVE.md` (KV/T20C work).

**Known stale citation, verified:** HARNESS_FINDINGS §7.33 and its change-log entry cite
"`KALSA.md:308`" for the A7X gate fact. In the current KALSA.md that fact lives at
`archived/docs/KALSA.md:413` (the SUPERSEDED row banner); line 308 is now the engine-knobs rule
preamble. The claim is real; the line number rotted when KALSA.md was rewritten on 2026-09-09.

---

## Q1. Does the GPU help decode? (the 0.41–0.44× story, fully traced)

**Q1a. The headline retraction — MoE decode on GPU never actually ran on our tree.**

| Claim | Status | Provenance |
|---|---|---|
| "GPU decode is 0.41–0.44× CPU" for MoE | **RETRACTED** (as a MoE claim) | §7.33 banner, HARNESS_FINDINGS.md:113 |

- `kalsa/archived/docs/HARNESS_FINDINGS.md:113` — "| GPU decode is 0.41–0.44× CPU | measured **CPU fallback**: `use_adreno_moe_kernels` excludes A7X, so K-quant MoE never reached the GPU | §7.33 |"
- `kalsa/archived/docs/HARNESS_FINDINGS.md:3086-3089` — "⛔ **RETRACTED IN PART, same day, by the parallel session — and the warning was already in this file.** … Worse, `KALSA.md:308` records that on our `llama.rn 0.12.8` tree `use_adreno_moe_kernels` excludes `A7X` and **730/740/750 are all A7X**, so K-quant MoE **never reached the GPU at all** — every "GPU decode" number we hold measured CPU fallback with graph splits, not a GPU."
- `kalsa/archived/docs/KALSA.md:413` — "| GPU — **our** Adreno 740 | ⛔ **SUPERSEDED 2026-08-21 — see §7.33's retraction banner.** This row said MoE decode was 0.41–0.44× the CPU … Both halves rested on **broken or gated-off kernels**: `use_adreno_moe_kernels` excludes A7X and 730/740/750 are all A7X, so K-quant MoE never reached the GPU — the decode figure measured **CPU fallback with graph splits**. The parallel session has since repaired those kernels, certified them bit-exact against the CPU reference (nfail=0), and measured **experts on GPU at 2.17× burst / 1.5× sustained, cooler**. Prefill remains a GPU lever. |"

**CONTESTED detail — what the 0.41×/0.44× actually measured.** HARNESS_FINDINGS §7.16 and
KALSA.md:413 call these numbers *MoE* decode; the underlying reports say **dense Qwen3.5-2B**:

- `moe/reports/moe-gdn-k22-fix.md:23` — "The first honest 740 decode number with correct output is **5.06 tok/s vs 12.37 tok/s CPU (0.41×)**. Prefill is a small win (1.29×)."
- `moe/reports/moe-gdn-k22-fix.md:16-19` (context) — the model is the **dense** Qwen3.5-2B tied lm_head hitting `gemv_noshuffle_q6_k_f32`, "numerically correct on this 740", greedy `-ngl 99 -fa off` "matches CPU token-for-token".
- `moe/reports/moe-gdn-750.md:196-202` — "llama-bench, same cpufix binary, Qwen3.5-2B Q4_K_M, `-t 6`, r=2: | CPU `-ngl 0` | 31.46 | **16.15** | | GPU `-ngl 99 -fa off` | **181.65** | 7.07 |"
- `moe/reports/moe-gdn-750.md:204-206` — "- **Decode gate (≥1.15×): FAIL — 0.44×.** … The A7X decode wall holds on 750 exactly as on 740."
- `moe/docs/ALIVE.md:146` — "Dense: GPU decode always loses (0.41× on 740); GPU prefill wins big only on 750-class (3.2–7×, §2), not on 740 (K-G dead)."

Reading: the A7X-gate retraction is airtight for **MoE** decode claims (k2-era MoE graphs fell back
to CPU), but the two raw rows cited for 0.41×/0.44× were dense-model GPU decode runs that the same
reports verified token-identical — i.e. real GPU decode on a dense model. Quote both readings; do
not quote either alone. What everyone agrees on: **GPU decode does not win on 740/750**, and the
later QDC cell #57 re-measured it against a properly tuned CPU build at 0.80–0.86×:

- `moe/docs/ALIVE.md:439` (cell #57) — "**7675: pp 95.2/tg 20.0 · 8635: pp 97.1/tg 20.5 · 8650: pp 99.0±12.8/tg 28.6** … Griglia: **G2 decode = CPU VINCE su tutti e tre i tier (GPU a 0.80-0.86×)**".

**Q1b. MoE experts-on-GPU at equal offload — the superseding measurement (S23, pre-QDC).**

| Claim | Status | Provenance |
|---|---|---|
| Experts on GPU 2.17× burst / 1.5× sustained, cooler (S23) | MEASURED (exploratory), then pre-registered at 1.553× (OLMoE) | moe/docs/ALIVE.md:45-51, 76-84 |
| Pure CPU beats full GPU on KEXP and OLMoE (S23) | MEASURED, preregistered — "GPU default candidate" retired | moe/docs/ALIVE.md:86-109, decision table :111-117 |
| Half-offload (trunk GPU / experts CPU) is the worst arm | MEASURED on both models | moe/docs/ALIVE.md:95-96, 117, 142-143 |

- `moe/docs/ALIVE.md:45-51` — "**And the repaired path is FAST (2026-08-21, exploratory):** on the S23, experts-on-GPU vs experts-on-CPU at equal offload (OLMoE-1B-7B Q4_K_M, full ngl=16, unplugged, ABBA×2): burst decode **27.5 vs 12.7 tok/s (2.17×)**, sustained **15.3 vs 10.3 (~1.5×)**, and the GPU arm runs COOLER (CPU arm hits 40.2°C)."
- `moe/docs/ALIVE.md:76-79` — "**The speed claim is now PRE-REGISTERED (2026-08-21 evening): SHIP 1.553×.** OLMoE confirmatory cell, prereg v1.2 (N≥5 ABBA, tg512-only, cooldown gate, battery floor, frozen pins): median **A 16.36 vs B 10.53 t/s = 1.553×**, GPU arm cooler (peak 38.4 vs 38.95 °C)".
- `moe/docs/ALIVE.md:98-100` — "**ANSWERED same day (#20 decision cell, audit BANK-with-corrections): pure CPU beats full GPU on OLMoE too — in EVERY cell of every block.** A(-ngl16) 20.034 vs C(-ngl0) 27.685 t/s, A/C 0.724, decision invariant under pruning."
- `moe/docs/ALIVE.md:108-109` — ""GPU default candidate" is retired. The OLMoE A/B 1.553× SHIP claim stands in its scope (expert placement at fixed ngl)."
- Decision table `moe/docs/ALIVE.md:113-117`: C all-CPU **17.55** (KEXP) / **27.69** (OLMoE) both 🥇; A all-GPU 14.25 (−19%) / 20.03 (−28%); B hybrid 7.90 / 10.53 ❌ worst. Thermal: KEXP −2.75 °C real cool mode; OLMoE −0.45 °C parity.

**Q1c. Dense decode marathon (the cool-mode evidence).** `moe/reports/moe-gpu-sustained.md:139-143` — "| CPU `-ngl 0` | 12.2 | 10.9 | 10.2 | **12.2** | **10.2** | **−16%** | **42.3°C (still rising)** | | GPU `-ngl 99 -fa off` | 8.2 | 8.2 | — | **8.2** | **8.2** | **0%** | **38.5°C (plateau)** | Energy proxy (batt% per 1k tokens): CPU ~0.61%, GPU ~0.79% → CPU more efficient per token even sustained (faster at similar drain)." and `:174-175` — "- Question closed: on the 740, GPU decode loses sustained at every product size. The GPU dividend on A7X remains prefill/TTFT only." (S23, Qwen3.5-2B then 4B, unplugged, 15 min/arm, 2026-08-12/13.)

**Q1d. Streaming MoEs beyond RAM: GPU placement moves nothing.** `moe/docs/ALIVE.md:130-140` — "Mellum2, llama-bench mmap, n=16: pure CPU `-ngl 0 -nr` **0.216** t/s … vs trunk-GPU partial `-ngl 2 -ncmoe 99` **0.223** (unplugged) — **GPU placement moves nothing in the streaming regime (±3%)** … Streaming verdict, now same-harness-backed: the wall is flash bandwidth; GPU is irrelevant to it; the recipe is everything."

## Q2. GPU prefill / TTFT — per generation, with the weak-CPU-baseline correction

The 5.77×/5.3–6.0× "GPU prefill wins" figures quoted in HARNESS_FINDINGS §7.33 were later scoped
down on the measurement repo: the August CPU baselines were lame builds.

| Claim | Status | Where |
|---|---|---|
| Prefill GPU/CPU 5.77/5.97/5.63/4.14× at pp128-2048, 750, dense 2B | MEASURED 2026-08-12, then **SUPERSEDED as ratio** (weak CPU baseline) | moe/reports/moe-gdn-750.md:196-208; moe/docs/ALIVE.md:369-371 |
| Honest 750 prefill ratio vs HEAD CPU: 1.43× (CPU repack) / 2.62× (CPU -nr) | MEASURED (exploratory A/B/C, N=3, Doze cells) | moe/docs/ALIVE.md:369-371 |
| Corrected pp128 ratio 3.18×; 2B 3.18/3.95/5.35/6.69×, 4B 4.17/5.70/6.95/6.46× | MEASURED (750-class, #16 validation) | moe/docs/ALIVE.md:263-269 |
| QDC tier map (ship 2.6B QAD-Q4_0, -fa 0, pp512): 732→151.8, 735→154.8, 750→284.2-291.1, 740→84.1 (Q4_K_M) | MEASURED (QDC #52/#55/#56/#58/#53) | moe/docs/ALIVE.md:435-441 |
| GPU decode ties CPU on 750 with our kernels (A/C 0.992), prefill 2.477× | MEASURED N=5 prereg | moe/docs/ALIVE.md:373-375 |

- `moe/docs/ALIVE.md:369-371` — "Dense prefill: GPU unchanged since August (181.5), but HEAD CPU is ~4× faster → honest ratio 1.43× (CPU repack) / 2.62× (CPU -nr), the historical 5.77× was a weak CPU baseline."
- `moe/docs/ALIVE.md:441` (cell #58) — "✅ Amendment post-hoc CHIUSO dalla riga 41 (#58, re-run sotto PREREG che anticipava lo split: stessi 20 FAIL byte-identici, pp512 291.1/tg128 23.0 entro ±10%) → i numeri 750 di questa riga SONO costanti del router."
- Superseded statement kept for the record — `kalsa/archived/docs/HARNESS_FINDINGS.md:3122` — "| **prefill**, Xiaomi 14 / **Adreno 750**, Qwen3.5-2B Q4_K_M, unplugged, `llama-bench -t 6 -r 2` | 31.5 / 35.9 / 38.4 / 51.1 t/s at pp 128/512/1024/2048 | 181.7 / 214.5 / 216.3 / 211.6 | **5.77 / 5.97 / 5.63 / 4.14×** |" (its "still stands" banner at :3110-3112 predates the weak-CPU finding).

**740 prefill:** 1.29× (k2.2, `moe/archived/docs/kernel-plan-v1.md:114` — "| A7X prefill on GPU | **1.29×** (740, measured) up to 5.77× (crossgen recon data) — "the GPU dividend on A7X is TTFT" |"); ALIVE §8 map: "On 740 the GPU prefill is ~1.1× (not worth it)" (`moe/docs/ALIVE.md:490`).

**830/8 Elite:** KEXP GPU prefill 2.56× (274.5 vs 107.4), CPU decode wins 1.24× — `moe/docs/ALIVE.md:422` (cell #40): "Block medians: A(GPU ngl99) pp512 **274.5** tg128 **48.9**; C(CPU ngl0) pp512 **107.4** tg128 **60.7**. Pre-written rule (block medians, >=5% win): **GPU prefill 2.56x, CPU decode 1.24x**".

## Q3. GPU vs battery / joules per token

| Claim | Status | Where |
|---|---|---|
| GPU costs ~30% more battery per token (0.61% vs 0.79% /1k tok) | MEASURED, scope: **dense** Qwen3.5-2B, S23/740, GPU at 0.67× CPU speed; **does not transfer** to a faster/cooler MoE arm | moe/reports/moe-gpu-sustained.md:142-143; HARNESS_FINDINGS.md:3105-3108 |
| GPU decode is thermally flat (0% decay) where CPU decays 14–16% | MEASURED (same cells; survives the retraction) | moe/reports/moe-gpu-sustained.md:139-141, 173; HARNESS_FINDINGS.md:3110-3112 |
| GPU cool mode on KEXP: −19% speed, −2.75 °C peak | MEASURED, preregistered scope | moe/docs/ALIVE.md:86-88, 116 |
| Matched-work NPU energy 0.86× J/token (Marco-B′) | MEASURED, single replica, unconfirmed | moe/docs/ALIVE.md:409; GOVERNOR-STATE-2026-09-04.md:78 |
| NPU v73 prefill spike: ~3× faster AND ~2.5–4× less heat per prompt | MEASURED (q57 B/C, q58 spike sweep) | moe/docs/ALIVE.md:410 |
| Charge-counter energy "inconclusive (5.3× spread on identical work — do not cite)" | RETRACTED instrument | moe/docs/ALIVE.md:410 |

- Non-transfer warning — `kalsa/archived/docs/HARNESS_FINDINGS.md:3105-3108` — "3. **The energy conclusion below was contingent on the GPU being slower.** 0.61 % vs 0.79 % per 1k tokens was measured on a **dense** Qwen3.5-2B with the GPU running at 0.67× the CPU's speed. Faster *and* cooler inverts that arithmetic, and their configuration is MoE experts, not a dense model. **The battery claim does not transfer to their arm and must not be quoted against it.**"
- Change-log twin — `kalsa/archived/docs/HARNESS_FINDINGS.md:5310` — "**the 0.61 % vs 0.79 % battery figure was contingent on the GPU being slower** — measured on a dense Qwen at 0.67× CPU speed, it does not transfer to a MoE-expert arm and must not be quoted against it."
- The in-app GPU-vs-CPU skin-temperature datum (750, governor cell) — `moe/docs/ALIVE.md:455` (row 60) — "Termica dello stesso turno: GPU +4,5 °C contro CPU +10,1 °C di skin."
- Energy framework verdict on absolute joules — `kalsa/docs/ENERGY-FRAMEWORK-STATUS.md:66-68` — "- Absolute joules are session-relative. Compare within-session deltas and ratios only after the session floor, temperature gate, ordering and coverage are recorded."

## Q4. Which GPU backend, and which kernels exist (Vulkan vs OpenCL vs LiteRT)

| Claim | Status | Where |
|---|---|---|
| Vulkan has q2_K/q3_K `MUL_MAT_ID` pipelines (KEXP covered on paper) | MEASURED-in-source (pipeline creation read, not run) — "allowed is not correct, and not fast" | HARNESS_FINDINGS.md:3145-3151, 3173-3175 |
| Vulkan runs NO K-quants at all on Adreno 740 (SIGABRT while `supports_op` says SUPPORTED) | MEASURED, device | moe/docs/ALIVE.md:170-176 |
| OpenCL was the missing backend for q2/q3 MoE; kernels written, 401/401 → 407/407 | MEASURED, device | moe/docs/ALIVE.md:53-66, 155-168 |
| Qualcomm compiler miscompiles: 4 bit-characterized + 4th (k4 masks) + latent 5th barrier defect, all fixed; `trans4` scalar-uint dataflow is the medicine | MEASURED, device | moe/docs/ALIVE.md:16-43, 155-168 |
| Kernel surface transfers across generations: 407/407 on 740, 750, 732, 735, 830 | MEASURED (QDC #22/#52/#55/#56) | moe/docs/ALIVE.md:421, 435, 437, 438 |
| 750-only f16/bf16-batched dense `MUL_MAT` defect (20 deterministic FAILs), reproduced on QDC QRD8650, gated at kernel level | MEASURED ×3 replications | moe/docs/ALIVE.md:358-363, 437, 441, 452 |
| FA lane must be capability-probed per GPU (732 lacks `sub_group_shuffle_xor` → kernels don't compile; 740 compiles fine) | MEASURED (QDC #52 vs #53) | moe/docs/ALIVE.md:435, 436 |
| Mali G57: f32 + q8_0-MoE run but GPU < CPU on all 20 green cases (max 0.962×); parked | MEASURED + owner decision | moe/docs/ALIVE.md:407 |
| "Try Vulkan, not OpenCL" on Adreno | RETRACTED (backwards: Qualcomm invests in the Adreno OpenCL path) | HARNESS_FINDINGS.md:3097-3101 |

- `kalsa/archived/docs/HARNESS_FINDINGS.md:3145-3151` — "**3. ⭐ For Vulkan there is no kernel to write. This is the finding that changes the question.** Verified in this tree, not inferred: `kalsa-engine/third_party/llama.cpp/ggml/src/ggml-vulkan/ggml-vulkan.cpp:17254-17255` lists `case GGML_TYPE_Q2_K:` and `case GGML_TYPE_Q3_K:` under `MUL_MAT_ID`, and the pipelines are real … **KEXP's 2-and-3-bit experts already have Vulkan kernels.**"
- `kalsa/archived/docs/HARNESS_FINDINGS.md:3173-3175` — "The Vulkan coverage above is `supports_op` and pipeline creation read in source — **allowed is not correct, and not fast**; §7.16's own MXFP4 note makes exactly that point."
- `moe/docs/ALIVE.md:170-176` — "**Vulkan on Adreno 740 (2026-08-22, first data ever in this campaign): the "backend of the future" runs NO K-quants at all.** It initializes, passes f16 (242/242), then every K-quant pipeline (q4_K dense, q2/q3/q4_K MoE) dies at `createComputePipeline ErrorUnknown` → uncaught vk::SystemError → SIGABRT, while `supports_op` reports SUPPORTED. Same device, same day: OpenCL with our kernels passes 407/407."
- `kalsa/archived/docs/HARNESS_FINDINGS.md:3097-3101` — "1. **"Try Vulkan, not OpenCL" is probably backwards on Adreno.** Vulkan kernels *existing* (§7.33 point 3, still true) is not Vulkan being fast on this silicon — Qualcomm's investment is in the Adreno-specific OpenCL path … The correct statement is the one this section itself made and then failed to apply: **`supports_op` says allowed, not correct and not fast.**"

**The `supports_op` trap, canonical instances:** MXFP4 MoE "would run on the S23 today" — corrected: `kalsa/archived/docs/HARNESS_FINDINGS.md:4136-4143` — "⚠️ **A claim made here earlier the same day, corrected.** … **`supports_op` returning true is not correctness.** Nobody has tested MXFP4 MoE correctness on a 740; in their tree mxfp4 takes the Adreno path and fails **0/74**. The only general-branch MoE quant with measured-green correctness on a 740 is **q8_0, 75/75** — at 8.5 bpw, ~8.8 GB for this model, which is not a candidate."

**GPU prefill numeric fidelity — the QDC deep-dive (why V75 was allowlist-OFF until 7/09):**
the batched (>1) GEMM path computed in half; the bisect chain: attention refuted → GEMM path found
(KLD 0.454 vs 0.000962 batch-1) → accumulator refuted → math flags refuted → dequant refuted →
operand refuted → **the multiply itself** (fix `convert_float8(B) * (float)w`: KLD 0.4538 →
0.004736, 95.8×).

- `moe/docs/ALIVE.md:459` (row 56) — "(1) CPU vs GPU così com'è → **KLD mediana 0,454, stesso-top 62,4 %, PPL +8,50** … (3) stesso confronto con **batch 1** … → **KLD mediana 0,000962 (472× meno), stesso-top 98,0 %, PPL +0,27**."
- `moe/docs/ALIVE.md:458` (row 57) — "**`stock:mul` (`convert_float8(B) * (float)w`) 0,004736 / 94,826 % / +0,349 → 95,8× di riduzione; `stock:deq` … non aggiunge nulla.** Ogni variante `strict` è identica alla `stock` corrispondente alla sesta cifra."
- `moe/docs/ALIVE.md:455` (row 60, in-app confirmation) — "**Fedeltà … mediana \|Δp₁\| 0,0861 → 0,0014 (61×), mediana max\|Δlogp\| 3,444 → 0,3037 (11×) … i flip del top-1 con la CPU sicura 8/32 → ZERO.**"
- Corrected-kernel speed cost — `moe/archived/docs/GOVERNOR-STATE-2026-09-04.md:32-36` — "[INDICATIVE, NOT MEASURED CLEAN] Correctness costs about 0.65x of prefill (pp512 189.73 vs the 289.98 reference) … If it holds, the in-app GPU prefill advantage on 750/735/732 (1.78x/1.72x/1.63x) drops to roughly 1.16x/1.13x/1.07x — near parity, which turns the GPU on those tiers from a speed lever into a thermal-and-CPU-offload lever."
- Owner decision — `moe/docs/ALIVE.md:455` — "**PROMOSSO: l'owner ha deciso il 7/09 di accendere il prefill GPU su V75** — `GPU_PREFILL_CORRECT.V75` false → true, decisione sotto R6 e presa sull'effect size, NON sul verdetto binario che resta `FAIL rule=R2` per disegno".
- Coverage caveat (Q4_K_M is a mix) — `moe/docs/ALIVE.md:455` — "**CORREZIONE 8/09 … `Qwen3.5-4B-Q4_K_M.gguf` = Q4_K 149, **Q6_K 35, Q5_K 24, Q8_0 1**, F32 232 (60 tensori quantizzati su 209 NON sono Q4_K)** … tre degli otto kernel non corretti **sono raggiungibili dal catalogo**".

## Q5. NPU / Hexagon, per generation

| Claim | Status | Where |
|---|---|---|
| v75 (8 Gen 3): dense prefill 3.19×; **experts-on-NPU 4.82×** (686 t/s, OLMoE Q4_0); decode 0.37–0.63× | MEASURED | moe/docs/ALIVE.md:410, 508; GOVERNOR-STATE:61 |
| v75 correctness certified (PPL r −0.02%/+0.064%, full graph on HTP0, KV on host `-nkvo`) | MEASURED (q55) | moe/docs/ALIVE.md:410 |
| v73 (S23/8 Gen 2): dense/hybrid prefill ~3.5×; experts lane dies `dspqueue_read 0x2e`; menu UNCERTIFIED; thermal incident 25/08 | MEASURED + policy F6 + incident | moe/docs/ALIVE.md:410 |
| v73 death root causes: VA alloc in `mmap_buf()` (htp/main.c:729); upstream TLBMISS culprit = #26049 `0a50d9909`; partial offload `-ngl 8/12` lives incl. decode | MEASURED (QDC #59/#60/#62/#64) | moe/docs/ALIVE.md:442, 443, 444, 446 |
| v79 (8 Elite): ship-model prefill 1512 t/s = 7.2×; correctness 0/301 was judge poison → repaired kit 301/301 + PPL r −0.029% PASS; 36 INTERNAL-ERROR fixed → 0; Class-B NaN parked (3 causes eliminated, containment) | MEASURED (QDC #43–#51) | moe/docs/ALIVE.md:425, 428-434 |
| NPU decode on the **shipped** 2.6B is slower than CPU, and KV-on-DSP makes it worse (FLASH_ATTN moves too): CPU 17.68 / NPU-nkvo 15.08 / NPU-KV 13.37 tg128 | MEASURED (row 58) | moe/docs/ALIVE.md:457 |
| HTP reads only Q4_0-family/Q8_0 — KEXP enters only via Q8_0 trunk (B′); B′ behaviorally FAILED (4/10 degeneration) | MEASURED (q43/q52) | moe/docs/ALIVE.md:409; §8 map :491-493 |
| v73 NPU sustained load thermally unusable (2.33 °C/min); as a spike: 3–5× faster, 2.5–4× less heat, N_max 512 tok, threshold 39.5 °C | MEASURED (q57/q58) | moe/docs/ALIVE.md:410 |
| NPU-for-streaming-MoE on 8 GB/UFS 2.2–3.1: NO-GO; UFS 4.0 extrapolation REFUTED (pattern-bound re-reads); honest headroom 1.3–2.2× | MEASURED (q60/q60b/q61) | moe/docs/ALIVE.md:410 |
| Tri-engine roles device-verified: NPU=prefill 3.19×, CPU=decode, GPU=cool-mode | MEASURED (2026-08-23) | moe/docs/ALIVE.md:408 |

- `moe/docs/ALIVE.md:457` (row 58) — "**A CPU 17,68 ± 4,17**; **B NPU con `-nkvo`** … **15,08 ± 0,55**; **C NPU con KV su HTP0 13,37 ± 0,25** … **Il meccanismo è l'opposto di quello ipotizzato**: con la KV sul DSP l'attenzione si sposta sull'NPU (`FLASH_ATTN` compare **3168 volte nel log di C e ZERO in quello di B**) … la KV sul DSP peggiora."
- `moe/docs/ALIVE.md:457` — "**Soffitto di mapping MISURATO, non ipotizzato**: `ggml-hex: HTP0 measured max vmem 3489660928` = **3328 MiB = 3,25 GiB** … **Incoerenza aperta e non risolta**: ALIVE 13 riporta 3,6 GiB di esperti OLMoE mappati su HTP0 … o il soffitto varia per device/sessione, o quel 3,6 GiB è dimensione di file e non di mapping."

## Q6. Backend placement — what is a flag, what is engineering (the owner's stated distinction)

**The distinction is stated exactly where the owner thought, twice:**

- `kalsa/archived/docs/HARNESS_FINDINGS.md:3164-3168` — "**What this means for the commission.** The shape of the only win the evidence supports is **GPU for prefill, CPU for decode** — 5.3-6.0× on the half that dominates the wait … ⚠️ **That split is not a flag.** llama.cpp does not switch backends mid-context, so it is real engineering, and its cost is **UNMEASURED** here."
- `kalsa/archived/docs/HARNESS_FINDINGS.md:3102-3104` — "2. **"That split is not a flag" is imprecise.** Trunk-vs-expert placement *is* a flag — `--n-cpu-moe` / `--override-tensor`, in use in their benches. My point was about a *temporal* split (GPU prefill, CPU decode), which is a different thing and is moot if the GPU wins decode."

So: **temporal prefill→GPU / decode→CPU = real engineering** (confirmed: the governor v0 with two
contexts + KV commit was subsequently BUILT in the fork — see Q8 — so "not a flag" is now also
"built, in the fork"); **trunk-vs-expert placement = a flag** (`--n-cpu-moe` / `--override-tensor`,
and `MoeStream` forces `no_extra_bufts` — `kalsa/archived/docs/HARNESS_FINDINGS.md:2396-2399`).
The engineering answer since exists and is called the governor: `moe/docs/ALIVE.md:420` (cell #38)
— "The three LiteRT gems on ggml, measured end-to-end: ctx_prefill on OpenCL/Adreno 830 + ctx_decode on CPU in ONE process, KV committed across the boundary."

**Q7. GPU memory accounting — the RAM gate is blind**

- `kalsa/archived/docs/HARNESS_FINDINGS.md:3998-4004` (§7.18) — "**This one is about the GPU.** Dense Qwen3.5-4B … `NGL=99` … | app `RssFile` | 136 MB | **26–33 MB** | the weights are not in the process | … | system `MemAvailable` | **4.02 GB** | **583 MB** | 3.4 GB gone anyway |"
- `kalsa/archived/docs/HARNESS_FINDINGS.md:4025-4030` — "**The finding is not "the GPU is slow", it is where the memory goes.** … the weights live in driver/CL allocations that `/proc/<pid>/status` does not account for. ⛔ **So the RAM fit gate is blind on this path, and that is a defect, not an imprecision.**"
- Measured constant (QDC-era, q44 sweep) — `moe/docs/ALIVE.md:411` — "**k (MemAvailable cost per offloaded weight byte) is NOT a constant**: k_set 1.74→1.05 from ngl 7 to full (N=25, LFM2.5-KEXP, S23), incremental k collapses 1.70→0.09. Post-hoc affine reading: partial offload ≈ **~750 MiB fixed (Adreno prealloc, present even at ngl 0) + ~1.0× offloaded bytes**; candidate conservative gate for the app `800 MiB + 1.05×bytes` (safe on all 5 measured points). Bonus proofs: mmap weights cost ~nothing in MemAvailable … and GPU weight copies are invisible to RssAnon (~80–110 MiB flat) — the app's gate blindness, now measured. Constants need a second model/device before shipping"
- lmkd is uncatchable — `moe/archived/docs/GOVERNOR-STATE-2026-09-04.md:131` — "[MEASURED] lmkd SIGKILL is not catchable by the app's exception fallback; GPU offload can leave ~150 MiB in `/proc` while consuming 3.4 GB system memory."

## Q8. The per-phase governor — measured, decided, implemented, open

Authoritative digest: `moe/archived/docs/GOVERNOR-STATE-2026-09-04.md` (labels MEASURED/DECIDED/
IMPLEMENTED/OPEN, file:line throughout). Owner goal — `moe/PLAN.md:9-14` — "## Il goal (owner, ripetuto 4/09)
Kernel che usa NPU, GPU e CPU **per fase** a seconda di temperatura, batteria e
profilo, ottimizzato su Snapdragon (MediaTek/Jelly se possibile). Il pezzo
mancante non è il motore: è che **l'app non lo usa**."

**Governor cells measured (all QDC, 8 Elite/QRD8750 unless noted):**

| Cell | Result | Quote (moe/docs/ALIVE.md) |
|---|---|---|
| #38 governor v0 cross-backend, 2.6B | G (GPU prefill + CPU decode) TTFT 1434-1470 ms vs C 16476-14412 (≥9.8×), decode ≥ C, KV commit 1.80-1.98% of prefill (<2% gate PASS) | :420 |
| #40 KEXP decision table, 830 | GPU prefill 2.56×, CPU decode 1.24× — "The three GPU generations now each give a DIFFERENT verdict, re-measured never transferred: 740 CPU-always -> 750 GPU-2.21x-prefill/tie-decode -> 830 GPU-2.56x-prefill/CPU-1.24x-decode" | :422 |
| #41 governor on the 8B | G passes, commit tax drops to 0.83-0.89% of prefill; BUT all-GPU A is the best single arm (decode 28.2 vs G/C 13.3-13.9) — "routing must be per-device AND per-model" | :423 |
| #42 VL-3B, third phase | vision encode → CPU (GPU loses 1.67×, unsupported CLIP ops), prefill → GPU 4.0×, decode → CPU 1.28×; composed 1.13× over best static arm | :424 |
| S5/S5b in-app governor runs (QRD8650/750, QRD7675/732, QRD8635/735) | in-app GPU prefill 1.86×/1.81× (8 Elite), 1.98× (750 forced), 1.63× (732 forced), 1.72× (735 forced); thermal degrade-to-CPU works end-to-end at 38.0-38.5 °C skin | :447-453 |
| #61 high-tier static gates | q4_K arm NOT measurable in-app: `kvBytesPerToken` missing on `qwen3.5-4b` → `gpuFit()`=NoFit always; any mmproj model disables the governor. "la fascia high … non riceve MAI il governor" | :454 |

- Thermal degrade proven live — `moe/docs/ALIVE.md:447` (row 48) — "**run 5 (6/09 …): LA DEGRADAZIONE TERMICA FUNZIONA END-TO-END — a skin 38.5 °C (WARM) la policy dice Wait, il runtime instrada l'intero turno su CPU e lo COMPLETA (`engine_prefill CPU`, `cpu:2+13`, 337.6 ms, decode 22.1, commit 0 …) — e quel turno PASSA l'oracolo (ids = A)**".
- Correctness gate ordering — `moe/docs/ALIVE.md:451` (row 52) — "Regola di aggiornamento policy (PREREG §Runs 9-11): condizione velocità SODDISFATTA (mediana ≤0,85, n=2), condizione oracolo NO → `GPU_PREFILL_CORRECT.V73` resta false."
- The two static gates quoted from source — `moe/docs/ALIVE.md:454` (row 61) — "**(1)** `src/engine/governorInputs.ts:82-83`, prime righe eseguibili di `gpuFit()`, `const kv = model.kvBytesPerToken;` → `if (typeof kv !== "number" || !Number.isFinite(kv) || kv <= 0) return "NoFit"` … ⇒ `gpu_fit` = NoFit **su qualunque device, sempre** … **(2)** `src/engine/LlamaService.ts:1387-1389`, il governor si aggancia solo se `governorBase.gpu_fit !== "NoFit" && !options.mmprojPath && !streamExperts` ⇒ **qualunque modello con testa vision disabilita il governor**."
- Presence ≠ enablement ≠ execution ≠ benefit — `moe/PLAN.md:477-488` — "**GPU_PREFILL_CORRECT.V75 = true** ammette V75 nella tabella, ma **non accende da solo il governor su un'installazione pulita**. `readGovernorEnabled()` legge `kalsa.governor.enabled` e restituisce false se il valore non è impostato."
- Fork-side implementation — `moe/archived/docs/GOVERNOR-STATE-2026-09-04.md:97-108` — two-context contract (`llama-ext.h:321-325` "two independent contexts"), policy thresholds "unplugged warm 38 °C, cool 39.5 °C, critical 42 °C, kill 43 °C; it also applies a 25% low-battery floor, plugged idle validation, hysteresis, dwell, and a one-hour GPU flip budget" (:100), chunked oversize prefill (:102), commit gate "not trustworthy for short hybrid prefills because recurrent-state copying is ~52.7 MB" (:108).
- App-side gap (as of 2026-09-04) — `moe/archived/docs/GOVERNOR-STATE-2026-09-04.md:83, 92-93` — "[IMPLEMENTED] Backend policy is static: Android returns `{kind: "cpu-only", reason: "gpu-fit-gate-blind"}`" and "[OPEN] The app has no on-disk phase router for prefill/decode/vision, no NPU host binding, and no production GPU fit measurement".
- Current plan slot — `moe/PLAN.md:565` — "- GPU/V75/q4_K, altre generazioni, NPU e governor (spento di default, fascia high mai eleggibile per `kvBytesPerToken` assente + mmproj): evidence-gated, fase 24–29/09." and `:553` — "GPU/governor NON sono "dopo M1": stanno in G3 (28-29/09)".
- `kalsa/src/engine/governorBatterySampler.ts` exists untracked in the working tree (git status), and the kalsa-side PLAN records the S23 shell fuel-gauge blocker feeding it — see Q10.

## Q9. CPU-side levers: threads, affinity, core placement, DVFS governors

| Claim | Status | Where |
|---|---|---|
| Jelly prefill thread scaling: 2/4/6/8 → 113.9/93.0/77.4/72.1 s; monotone; 8 not distinguishable from 6; preset correct | MEASURED, n=2 reversed-order, 0.1% repeat | HARNESS_FINDINGS.md:2842-2869 |
| "§7.32's 'the little cores are pacing the batch' is refuted" | MEASURED | HARNESS_FINDINGS.md:2829-2833 |
| Jelly topology: 6×A55 (cap 348) + 2×A76 (1024); big-pair governor `sugov_ext`; little policy unreadable (0660) | MEASURED (read-only) | HARNESS_FINDINGS.md:3183-3188; KALSA.md:435 |
| Thread affinity on Android is a NOOP (ggml affinity controls inert; external `taskset` works) | MEASURED | kalsa/kalsa-moe-experiments/PLAN.md:218-219; archived/docs/ANDROID_CPU_AFFINITY_IS_A_NOOP.md |
| A55-only decode costs 5.0–5.3× decode time; energy arm invalidated by doze; core placement CLOSED as a policy target | MEASURED + instrument-invalidated | kalsa/docs/CORE-PLACEMENT-PILOT-2026-09-16.md:14-17, 39-58 |
| SD 8 Gen 3 thread cliff `>=7` → 0.06 tok/s | MEASURED (historic) | KALSA.md:315 |
| S23 mid-run core loss (`nproc` 6 of 8) invalidated an S23 ratio; gate should record core availability, not degrees | MEASURED | HARNESS_FINDINGS.md:2452-2461 |

- `kalsa/docs/CORE-PLACEMENT-PILOT-2026-09-16.md:14-17` — "**Restricting decode to the six A55 cores costs 5.0–5.3x decode time.** Read directly from the per-rep speed lines …: `a76_t2` 3.7/3.7/3.7 … against `a55_t2` 0.8/0.7/0.7 … twelve reps."
- `kalsa/docs/CORE-PLACEMENT-PILOT-2026-09-16.md:26-28` — "Against the owner's reading rule — accept up to +25 % decode time for at least 15 % less joules per token — the arm reports **+402 % decode time** for −39 % J/token."
- `kalsa/docs/CORE-PLACEMENT-PILOT-2026-09-16.md:52-54` — "the A55 decode buckets imply 0.20–0.23 W over 350 s, below this session's own screen-awake idle floor of **0.506 W**. An inference workload cannot draw less than idle, so the −39 % is not a measurement of the lever; it is a measurement of the doze."
- `kalsa/docs/ENERGY-FRAMEWORK-STATUS.md:14` — "| Core placement | **CLOSED NEGATIVE.** A55-only decode costs about 5x the A76 control's time. … so no energy policy should be built on the little-cluster lever. |"
- `kalsa/kalsa-moe-experiments/PLAN.md:217-219` — "Android ggml affinity controls were inert; only thread count was effective, while external `taskset` worked. S23 shell fuel-gauge reads are permission-denied/empty; future high-rate energy work needs app-side `BatteryManager` coordination."

**Thermal behavior:** in-session drift −11%…−48% (context growth) vs eviction collapse −96% are
separate mechanisms (HARNESS_FINDINGS.md:1938-1944); thermal gate pauses at SEVERE/44 °C, resumes
LIGHT/39 °C, cooling 44→29 °C in ~10 min (HARNESS_FINDINGS.md:1618-1638); heat cost ~12% of
absolute rate, decay unchanged (HARNESS_FINDINGS.md:1982-1989); QDC board HAL sensors, not
`dumpsys` "Cached" group, are the live truth (moe/docs/ALIVE.md:420); "a gate that works records
per-run **core availability**, not degrees" (HARNESS_FINDINGS.md:2458-2460); v79 pre-run gates
did not constrain execution (61.5/63.0 °C in-run, GOVERNOR-STATE:137).

## Q10. Energy: what the framework measures and what energy numbers exist

- **Framework: DONE and merged.** `kalsa/docs/ENERGY-FRAMEWORK-STATUS.md:13` — "| Measurement framework | **DONE.** Jelly battery-terminal sampling, v2 fallback, engine-stamped v3 phase boundaries, coverage and bias reporting, counts provenance, and hostile-audit trail are merged. `energySchemaHarness` is 77/0 and `energyPhaseSplitHarness` is 94/0. |"
- **Per-phase baseline (Jelly/G99):** decode J/token 1.2B/REP 0.293–0.295 (95% coverage), 2.6B/REP 0.645–0.653; cross-stem doubling cost **2.18–2.20× cold, 2.31–2.33× throttled** (committed reference 2.20–2.21×) — `kalsa/docs/ENERGY-PERPHASE-FINDINGS.md:52-78`, retraction at :67-71: "> **Retraction (2026-09-16; campaign audit).** The original headline said: > "2.20–2.21x per decode token … the ratio is stable across reps." The committed 2.20–2.21x figure remains the earlier reference, but the stamped cold run is 2.18–2.20x paired per rep (2.175, 2.179, 2.203), straddling the lower edge of that band; under throttling it drifts to 2.31–2.33x."
- **v1 retraction (bias story):** `kalsa/docs/ENERGY-PERPHASE-FINDINGS.md:106-114` — "- **The v1 numbers are retracted.** … the v1 "prefill" bucket was inter-rep idle (0.03–1.1 W) in 8/12 campaign reps and the published decode J/tok carried load + prefill + decode: inflated 12–153 % against the mark-anchored recompute".
- **Discipline:** between-run spread 2–7% (not 0.68%); sequential A-then-B cannot resolve <5–10%; ABBA + temperature gate + per-session idle floor required — `kalsa/docs/ENERGY-FRAMEWORK-STATUS.md:72-81`; cold-to-warm decode time +26–52% while J/token −6 to +7% (`kalsa/kalsa-moe-experiments/PLAN.md:216-217`).
- **Owner reading rule:** `kalsa/docs/ENERGY-FRAMEWORK-STATUS.md:111-113` — 'Owner, 2026-09-15: "accept up to +25 % decode time if J/token drops by ≥15 %" — and, explicitly, **measure first, then decide**.'
- **S23 blocked from shell:** `kalsa/docs/S23-ENERGY-BLOCKER.md:16-19` — "`adb -s 192.168.1.152:43089 shell cat /sys/class/power_supply/battery/current_now` — `cat: …: Permission denied` … The same for `voltage_now`, `temp`, `status` and `capacity`". Data exists via `dumpsys battery` history (`current_avg`, `cc` — :28-32).
- **Engine axis is the open one:** `kalsa/docs/ENERGY-FRAMEWORK-STATUS.md:15` — "| Engine axis | **OPEN.** CPU versus GPU versus NPU is the governor's actual decision space now that core placement is closed. |"
- **ADPF:** platform lever, needs app-owned inference (hint session takes the caller's thread IDs) — `kalsa/docs/ENERGY-FRAMEWORK-STATUS.md:17`.
- **All GPU/NPU energy figures to date:** dense GPU decode 0.61% vs 0.79% batt/1k tok (Q3 above, scoped dense/S23); GPU prefill in-app skin +4.5 °C vs CPU +10.1 °C (row 60); NPU B′ 0.86× J/tok single replica; v73 spike heat numbers (Q5). **No QDC cell establishes production battery/energy** — `moe/archived/docs/GOVERNOR-STATE-2026-09-04.md:79` — "[OPEN] No QDC governor cell establishes production battery/energy or sustained thermal behavior; the v79 report explicitly says CPU arms exceeded 60 °C during execution despite pre-gates passing."
- The eleven root `ENERGY-*AUDIT*` files are the hostile-audit trail for the above (SCHEMA SHIP; PHASE v1 NO-SHIP → v2 re-anchor; STAMP R1–R3; SWEEP instrument + flipcheck; V3 campaign audit).

## QDC campaigns — inventory

**Devices rented (Qualcomm Device Cloud, free tier ~1000 min/SoC class, "~4600 min across 5 SoC classes"):**

| Board | SoC | GPU | NPU | Used for (cells) |
|---|---|---|---|---|
| QRD8750 "Sun" | Snapdragon 8 Elite / Oryon | Adreno 830 | Hexagon v79 | #20 day0 CPU; #39 kernel correctness; #40 KEXP table; #41 governor 8B; #42 VL-3B; #43–#51 v79 NPU arc; #38 governor v0; S5/S5b runs |
| QRD8650 "Pineapple" | 8 Gen 3 (SM8650) | Adreno 750 | Hexagon v75 | #55 tier bench + 20-FAIL family; #58 prereg rerun; #59 v73-death replication (on HDK); row 56-60 fidelity arc; #61/#60 gemm-f32-ship; S5/S5b governor; npu-decode-kv row 58 |
| QRD8635 | 8s Gen 3 (SM8635) | Adreno 735 | v73-class | #56 tier bench (clean, twin of 732); #54 forced GPU prefill 1.72×; #61 static-gate cell |
| QRD7675 | 7+ Gen 3 (SM7675) | Adreno 732 | — | #52 first 7xx datum (GPU "flies", FA doesn't compile); #50 allowlist-inert run; row 52 forced 1.63× |
| HDK8550 "Kalama" | 8 Gen 2 (SM8550) | Adreno 740 | Hexagon v73 | #53 OpenCL-picks A/B (zero regressions); #59 v73 death replication; #60 mmap-budget; #62 upstream death; #64 bisect |

Dates: day0 2026-08-28 (while the owner was away, per the signed 10-day plan, `moe/docs/ALIVE.md:415`,
cell #16: "Order: QDC 8 Elite (Adreno 830 + Hexagon v79; kill-date day 4; E031 third column, decision
table 8xx, NPU generation map) → S23 plugged baseline …"); peak activity 2026-09-03 → 2026-09-08.

**What the QDC campaign established (by theme):**
1. **Correctness portability** — our OpenCL MoE kernel surface passes 407/407 on every Adreno tier
   tested (732/735/740/750/830); the 20-FAIL f16/bf16-batched dense defect is 750-stack-specific and
   stable across three replications; v79 needs its own certified judge (poison fixed) — cells
   #22/#52/#55/#56/#58/#46/#47.
2. **Per-generation decision tables** — decode: CPU wins on every generation ("Decode is DRAM-bound → the CPU wins it on every generation, always. NPU decode 0.37–0.63×, GPU loses (740) or at best ties (750). No exception found." — moe/docs/ALIVE.md:486-487). Prefill: accelerators pay, ranking on v75: "experts-on-NPU **4.82×** > dense-NPU 3.2× > GPU 2.48× > trunk-NPU (B′) 1.46×" (moe/docs/ALIVE.md:488-489). "The generational jump 740→750 changes verdicts, not just speeds … Decision tables are re-measured per generation, never transferred" (moe/docs/ALIVE.md:510-512).
3. **The governor works and its commit tax is small** — KV commit 0.83–1.98% of prefill across 2.6B/8B; thermal degrade-to-CPU proven end-to-end; three data points proving "routing must be per-device AND per-model" (#38/#40/#41/#42).
4. **NPU arc** — v79 opened and correctness-certified; v73 death root-caused (VA alloc; upstream #26049); partial-offload exception; decode measured worse-than-CPU on the shipped model; sustained thermal unusable on v73.
5. **In-app governor reality** — first E2E turns on device; GPU-prefill fidelity problem found, root-caused to the f16 multiply, fixed, and V75 enabled by owner decision; the high tier is governor-ineligible for two static code reasons (#61).

**QDC operational traps on record (each cost minutes or voided a run):**
- `/data` perms: a QDC daemon resets `/data` to 0777 mid-run → `run-as` breaks; holder must `chmod 771` every ~2 s (cells #46/#61; `moe/PLAN.md:546`).
- Boards boot Dozing with keyguard; `svc power stayon` is a no-op (not USB-powered) → wake + `dismiss-keyguard` + `locksettings set-disabled true` (cell #44; PLAN.md:547).
- Portal: "End Session" click silently swallowed unless done at the first ref-click; a swallowed click idled 45 billed minutes (cell #52, "ops lesson 7"); session name ≤30 chars; the minutes field needs real events or caps at 120 (PLAN.md:546-548).
- Rack battery telemetry is a FROZEN stub — "plugged" is declared, not measured; no battery thermals on boards (cell #20; amendment in diary: "le board QDC non hanno temperatura batteria → override").
- Board HAL gives live skin temps; `dumpsys` "Cached" thermal group is frozen — read `Current temperatures from HAL:` (cell #38/#48).
- Silent CPU fallback poison: `GPUOpenCL` backend name with zero ops run (vacuous pass); `/vendor/lib64` in `LD_LIBRARY_PATH` broke the sphal namespace → silent CPU fallback labeled OpenCL (cells #22, #40).
- ADB via SSH tunnel on a local port; the Jelly's adb server must not be touched (cell #20).
- QDC boards are for correctness/targeted proofs, NOT retail battery/thermal certification — `moe/PLAN.md:369` — "| **QDC Qualcomm** | Correttezza nativa e prove mirate su generazioni non coperte … | Le misure valgono per quella board/driver/artefatto. Nessuna sostituzione della certificazione batteria e termica retail. |"

---

## ANSWERED — do not re-measure

1. **MoE decode on GPU on 740/750 was never measured — it was CPU fallback** (A7X gate). Every "GPU decode 0.41–0.44×"-as-MoE quote is dead. (HARNESS_FINDINGS.md:113, 3086-3089; KALSA.md:413.)
2. **Experts-on-GPU at equal offload: 1.553× preregistered (OLMoE), 1.803× replicated (KEXP)** — but pure CPU beats full GPU on both (A/C 0.724 / 0.812), and half-offload is always worst. "GPU default candidate" retired. Scope: S23/740, models that fit. (moe/docs/ALIVE.md:76-117.)
3. **Decode winner = CPU on every generation measured** (740/750/830 + NPU 0.37–0.63×). (moe/docs/ALIVE.md:486-487.)
4. **Vulkan is dead for K-quants on Adreno 740** (SIGABRT, `supports_op` lies); OpenCL with the repaired Kalsa kernels is the only working GPU path for quantized MoE there. (moe/docs/ALIVE.md:170-176.)
5. **Vulkan q2_K/q3_K `MUL_MAT_ID` pipelines exist in source** — no kernel-writing needed for Vulkan coverage; the risk is correctness/speed, not existence. (HARNESS_FINDINGS.md:3145-3151.)
6. **`supports_op` true ≠ correct ≠ fast** — MXFP4 fails 0/74 on the Adreno path; q8_0 75/75 at 8.5 bpw unusable. (HARNESS_FINDINGS.md:4136-4143.)
7. **KEXP cool mode is real**: all-GPU = −19% speed, −2.75 °C on KEXP; thermal parity on OLMoE. Dense decode marathon: GPU flat 0% decay vs CPU −16%, GPU 0.80× sustained. (moe/docs/ALIVE.md:86-117; moe/reports/moe-gpu-sustained.md:139-175.)
8. **GPU offload memory**: weights leave the process (RSS ~150 MB) while the system loses 3.4 GB → lmkd kill; the RAM fit gate cannot see driver memory; measured model ≈ 750 MiB fixed + ~1.05×bytes. (HARNESS_FINDINGS.md:3998-4030; moe/docs/ALIVE.md:411.)
9. **Mali G57 parked**: f32/q8_0 run but generic GPU never beats CPU (max 0.962×); reopen only with G610/G615 hardware. (moe/docs/ALIVE.md:407.)
10. **NPU by generation**: v75 experts-on-NPU 4.82× correctness-certified; v79 7.2× prefill, certified after judge repair; v73 dense-only ~3.5×, experts die (VA alloc), thermally unusable sustained; **NPU decode loses on all** (0.37–0.75×, measured on the shipped model too). (moe/docs/ALIVE.md:408-410, 425-434, 457.)
11. **The 750 GPU-prefill infidelity is root-caused**: f16 multiply in the batched GEMM path (not attention, accumulator, math flags, dequant, or operand); fixed; in-app divergence collapses 61×; V75 GPU prefill enabled by owner decision on effect size. (moe/docs/ALIVE.md:456-460.)
12. **Per-phase governor is measured at the fork/bench level**: G beats both single-backend arms on the 2.6B; per-model exceptions proven (8B → all-GPU best); VL adds a third phase; commit tax 0.83–1.98%; thermal degrade works. (moe/docs/ALIVE.md:420-424, 447.)
13. **Threads on Jelly**: more is monotonically faster to 6; preset correct; the A55s are not pacing the batch. (HARNESS_FINDINGS.md:2829-2869.)
14. **Core placement (little-cluster decode) fails on latency**: 5.0–5.3× slower; prior-art claim (MNN-AECS) does not transfer; CLOSED as an energy-policy lever. (kalsa/docs/CORE-PLACEMENT-PILOT-2026-09-16.md.)
15. **Streaming-MoE GPU placement moves nothing** (±3%); the wall is flash bandwidth; the recipe is everything. (moe/docs/ALIVE.md:130-140.)
16. **Energy framework + Jelly per-phase baseline exists** (J/token by stem; 2.18–2.33× doubling cost, thermally qualified), with the v1 retraction and measurement discipline on record. (kalsa/docs/ENERGY-PERPHASE-FINDINGS.md; ENERGY-FRAMEWORK-STATUS.md.)

## NOT MEASURED — explicit gaps the corpus itself flags

1. **GPU prefill fidelity on 830/8 Elite, 732, 735** — "su 732/735/8 Elite e sugli altri nove `gemm_noshuffle_*` nulla è misurato" (moe/docs/ALIVE.md:457); "GPU prefill fidelity has never been measured there [830]" (GOVERNOR-STATE:35-36).
2. **q4_K kernel fidelity in-app** — the correct q4_K kernel "non è mai stato eseguito e la sua fedeltà resta ignota"; no catalog vehicle has q4_K weights + no mmproj + non-null `kvBytesPerToken` (moe/docs/ALIVE.md:454, row 61).
3. **Joules per token GPU-vs-CPU on 750+ and Mali** — "for Adreno 750+ and for Mali, joules per token GPU-vs-CPU is **NOT PUBLISHED**" (HARNESS_FINDINGS.md:3172-3173); "Energy per token remains unmeasured by anyone" for NPU decode (GOVERNOR-STATE:54); NPU 0.86× J/tok is a single replica (GOVERNOR-STATE:78).
4. **Production battery/energy and sustained thermal for the governor** — "[OPEN] No QDC governor cell establishes production battery/energy or sustained thermal behavior" (GOVERNOR-STATE:79); the engine-axis energy experiment on the Jelly is the queued next step (ENERGY-FRAMEWORK-STATUS.md:42-46).
5. **Vulkan-vs-OpenCL speed cell** — agreed next step in §7.33, "after their S4 lands" (HARNESS_FINDINGS.md:3113-3116); Vulkan ratio "not estimable" (moe/docs/ALIVE.md:397).
6. **Corrected-kernel prefill cost, cooled measurement** — 0.659× figure failed its own validity gate (5.71 °C spread; harness cools between steps but not before the first) — moe/docs/ALIVE.md:456 row 59; GOVERNOR-STATE:28-31.
7. **GPU prefill on the S23 through our own path + how CL buffers account against RAM** — owed since §7.16 (HARNESS_FINDINGS.md:4160-4164; KALSA.md:619-624).
8. **nseq>1 NPU** — "not executable at this pin (no -np in llama-bench); … multi-seq fallback expected from source, unmeasured" (moe/docs/ALIVE.md:408).
9. **Class-B v79 NaN cause** — three causes eliminated (scale-pad, descriptor reuse, cold first-touch); T2 angles (tile geometry, summation order, VTCM aliasing) unmeasured; parked with containment (moe/docs/ALIVE.md:432-434, 456).
10. **MXFP4-expert MoE correctness on a 740** — needs the GGUF built first (KALSA.md:625-627).
11. **S23 energy** — blocked from shell; needs app-side `BatteryManager` sampling (S23-ENERGY-BLOCKER.md; ENERGY-FRAMEWORK-STATUS.md:50-54).
12. **ADPF/Performance-Hint from inside the app** — platform lever, unmeasured (ENERGY-FRAMEWORK-STATUS.md:17, 47-49).
13. **Per-device crossover probe for prefill** — "la probe di primo avvio deve misurare anche il crossover prefill" (moe/docs/ALIVE.md:439); in-app mid-tier prefill ratios have n=1–2 pairs and a wrong prior (rows 49-54).
14. **8 Elite pp512 with the 750-gate candidate** and run 8b in-app — "NON stabilito" (moe/docs/ALIVE.md:452).
15. **HTP-vs-CPU ratio for q63 (IQ4_NL-M) on v79** — the v75 attempt was VOID (no CPU reference completed); "to be measured post-07/09 on v75 or on QDC v79" (moe/docs/ALIVE.md:417).
16. **3.6 GiB-vs-3.25 GiB HTP mapping-ceiling inconsistency** — open, unresolved (moe/docs/ALIVE.md:457).

## BLOCKED ON ENGINEERING, NOT MEASUREMENT

1. **Temporal per-phase split (GPU prefill / CPU decode) is not a flag** — llama.cpp does not switch backends mid-context; it required the two-context + KV-commit governor in the fork, which now exists (v0/v0.2) and still needs app hosting: "[OPEN] Host the two-context governor in llama.rn/LlamaService" (HARNESS_FINDINGS.md:3166-3168 for the distinction; GOVERNOR-STATE:121). Trunk-vs-expert placement, by contrast, IS a flag (`--n-cpu-moe` / `--override-tensor`) — HARNESS_FINDINGS.md:3102-3104.
2. **The high tier can never reach the governor until two code gates are fixed** — `kvBytesPerToken` absent from the `qwen3.5-4b` catalog entry (→ `gpuFit()` NoFit on every device) and the blanket mmproj exclusion; both are code, not board properties (moe/docs/ALIVE.md:454; moe/PLAN.md:219).
3. **Mixed-quant coverage** — Q4_K_M actually contains Q6_K/Q5_K/Q8_0 tensors, three of which still compute in half at the shipped pin; closing prefill coverage requires kernel work (float8 for `gemm_noshuffle_q5_k/q6_k/q8_0`), not measurement (moe/docs/ALIVE.md:455; moe/PLAN.md:233-237).
4. **v73 NPU experts** — firmware/stack-bound deaths (`dspqueue 0x2e`, VA fragmentation); the fix is fork engineering (revert/patch #26049, mapping budget policy), explicitly "mai issue upstream" (moe/docs/ALIVE.md:442-446; moe/PLAN.md:536).
5. **Silent-fallback and provenance instrumentation** — lmkd SIGKILL uncatchable, `GPUOpenCL` vacuous passes, `promptMs` timer artifacts (JSI reading the decode context) — each fixed by engineering in fork/app, each previously able to invalidate any future measurement (GOVERNOR-STATE:131, 135, 138).
6. **S23 high-rate energy sampling** — the path exists (`dumpsys battery` history: `current_avg`, charge counter) but needs an app-side sampler; the shell route is platform-denied (S23-ENERGY-BLOCKER.md:34-40; ENERGY-FRAMEWORK-STATUS.md:50-54).
7. **Mali G57 product path** — needs Mali-tuned Q4 kernels (a real project), parked by owner decision, not measurable into existence (moe/docs/ALIVE.md:407).
8. **NEON repack kernel for q2_K/q3_K (engine queue item #29)** — the named block for the KEXP eviction regime; measurement (§7.45/§7.48) produced the requirement, engineering closes it (HARNESS_FINDINGS.md:2139-2143; KALSA.md:647).

## Appendix — cross-document disagreements (both sides quoted)

1. **0.41–0.44×: MoE or dense?** HARNESS_FINDINGS §7.16 (:4123-4126) and KALSA.md:413 describe the figures as MoE decode (and retract them on the A7X-gate grounds); the source reports label the runs dense Qwen3.5-2B (moe-gdn-k22-fix.md:23, moe-gdn-750.md:196-202) and moe/docs/ALIVE.md:146 retains them as "Dense: GPU decode always loses". The retraction is sound for MoE claims; the dense rows were verified-correct GPU runs — but later QDC #57 re-measured decode at GPU 0.80–0.86× of a properly tuned CPU, so the old magnitude does not survive either way.
2. **Prefill 5.77× vs honest 1.43×/2.62×** — §7.33's change log (:5311) still carries "5.77 / 5.97 / 5.63 / 4.14×" as standing; moe/docs/ALIVE.md:369-371 supersedes the magnitude ("the historical 5.77× was a weak CPU baseline"). §7.33's "What still stands" (:3110-3112) predates that correction.
3. **"That split is not a flag"** — stated in §7.33 (:3166-3168), corrected as imprecise in the same day's retraction (:3102-3104). Both live in the same file; the change-log entry (:5310) carries the correction.
4. **KALSA.md:308 citation** — the A7X fact now lives at KALSA.md:413 (file rewritten 2026-09-09).
5. **KEXP artefact dropped vs kept** — KALSA.md:646 (2026-08-23 drop) reversed by KALSA.md:647 the same day (eviction, not size; entry STAYS; quality gate still keeps it off shipping tiers).

*End of map. All quotes verbatim from the named files; line numbers valid for the working trees as of 2026-09-16.*

