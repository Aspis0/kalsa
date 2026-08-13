# Mellum2 paper + BigMoeOnEdge tuning surface

**Status:** paper identified, stack enumerated, matrix written. No phone. No PC compute.
**Evidence labels:** **MEASURED** = our campaign / fork docs / on-device cells. **CLAIMED** = paper numbers as printed. **SPECULATIVE** = transfer guess, not measured on this stack.

---

## 0. What paper this is (do not skip)

| Field | Value |
|---|---|
| arXiv | [2605.31268](https://arxiv.org/abs/2605.31268) · PDF [2605.31268.pdf](https://arxiv.org/pdf/2605.31268) · HTML [v1](https://arxiv.org/html/2605.31268v1) |
| Title | **Mellum 2 Technical Report** |
| Authors | Marko Kojic, Ivan Bondyrev, Aral de Moor, Joseph Shtok, Petr Borovlev, Kseniia Lysaniuk, Madeeswaran Kannan, Ivan Dolgov, Nikita Pavlichenko (JetBrains; some also Constructor University, Bremen) |
| Submitted | 29 May 2026 (v1 only, 1,508 KB) |
| Venue class | cs.CL |
| License | CC BY 4.0 on the PDF; Apache 2.0 on the **checkpoints** |

The ID resolves. The PDF/HTML fetched. This is **not** a substitute paper.

### Loud flag (read this before treating §6 as a streaming paper)

**This is a model-architecture + training-recipe report, not an on-device / CPU / expert-streaming paper.**

It is *about* the exact SKU the campaign is measuring (Mellum2 12B-A2.5B, 64 experts, k=8). It is *not* about flash-streamed MoE, llama.cpp, cache-mb, O_DIRECT, or phones. Section 6 inference numbers are **one H100 80 GB + vLLM + dynamic FP8**, 192 GB host RAM, 48 CPU cores, mean ISL/OSL = 2304/256 ([HTML §6](https://arxiv.org/html/2605.31268v1#S6)). There is **zero** CPU decode table, **zero** mobile/UFS number, **zero** expert-cache design, **zero** speculative-decoding speedup (the MTP head is narrated as a draft model and then **removed at eval/inference**; released weights have no MTP tensors — see §1.5 below).

I did **not** swap in a different paper. I did **not** invent a streaming algorithm they did not write. Part 1 below extracts only what they actually swept, then states what transfers to S23.

Cross-check already in-tree: `reports/research-mellum2.md` (recon, 2026-08-12, pre-F1b). F1b on-device numbers **supersede** that recon's 92 MiB/tok band.

---

## Part 1 — the paper

### 1.1 What they built

Decoder-only Qwen3-MoE cousin ([§2](https://arxiv.org/html/2605.31268v1#S2), Table 2):

| Quantity | Value (CLAIMED) |
|---|---|
| Total / active | ~12B / ~2.5B per token |
| Layers / hidden | 28 / 2304 |
| Experts | 64 routed, **top-8**, intermediate 896, **no shared expert** |
| Attention | GQA 32Q / 4 KV, head_dim 128, QK-Norm, RoPE θ=500000 |
| SWA | **3:1**, window **1024** (21 sliding, 7 full) |
| MTP | 1 extra transformer layer, 1-token lookahead, aux loss α=0.1 |
| Vocab / ctx | 98,304 untied; trained 8192, YaRN-extended 131072 |
| Alignment | hidden 2304, head 128, expert 896 all ÷128 (CLAIMED: up to **2× GPU kernel slowdown** if violated; footnote under Table 2) |

Pre-train ~10.65T tokens, 3-phase curriculum (code 23% → 42% → 59%), Muon + FP8 hybrid, WHD LR. Long-context: **layer-selective YaRN on full-attn layers only**. Post-train: Instruct (no CoT) and Thinking, SFT then RLVR. Released under Apache 2.0.

### 1.2 Mechanisms that *touch* on-device / CPU / memory-bound MoE / streaming

None of these are streaming mechanisms. They are **architecture choices that change bytes and FLOPs of a forward pass**. Mapping to our regime:

| Mechanism | What it does at inference | Relevant to our streamer? |
|---|---|---|
| MoE 8-of-64, no shared expert | Per token: 28×8×3×2304×896 = **1.387B** routed expert params. Every expert is a flash-eligible slice. | **Yes.** This *is* the I/O tax. Geometry confirmed MEASURED by F1b: 28×8×3×2304×896×4.5/8 ≈ 780 MiB full expert traffic; 780×(1−0.76) ≈ 187 ≈ **185 MiB/tok** (`reports/moe-mellum2-f1-s23.md:165`). |
| GQA 4 KV heads | Tiny KV. Paper: KV-head count is “the most significant factor” under **high concurrency**; “negligible in synchronous (single-request) mode” (§2.1.3). | **Partially.** We are single-request decode. KV is cheap (research-mellum2.md:166–170: SWA body ~44 MiB + 7 full layers @4k ~56 MiB f16). Does **not** move flash I/O. |
| SWA 3:1 / 1024 | 21/28 layers attend only 1024 tokens. Paper Fig. 3: MoE+SWA matches Qwen2.5-7B latency **even at 2× context** (H100). Window 1024 beats 512 on **quality**, not a published latency delta. | **Yes for prefill/long ctx compute.** At campaign `-c 4096` most layers already cap at 1024. Does not shrink expert bytes. |
| MTP as draft | Narrated as built-in speculative-decoding draft ([§2.1.5](https://arxiv.org/html/2605.31268v1), Leviathan et al. [38]). **Removed at eval/inference.** §6 numbers are **without** MTP. Released Instruct/Thinking/Base weight maps have **no** `mtp*`/`nextn*` tensors (`reports/research-mellum2.md:53–54, 174–180`). | **No, not today.** Our `--mtp` needs a nextn block (Qwen3.5/3.6). Nothing to bind. |
| Dropless routing, aux-loss, z-loss, FP32 router | Training-time. | **No** as a runtime knob. Router already trained. |
| Layer-selective YaRN | RoPE remap only on 7 full-attn layers. RULER @64k: 0.64 vs 0.52 uniform-θ vs 0.33 unchanged-θ (§4.1). | **Baked in.** Affects long-ctx quality, not decode I/O at 4k. |
| Matrix alignment ÷128 | GPU kernel constraint (up to 2× if violated). | **Does not transfer** to llama.cpp CPU GEMV. |

There is **no** paper mechanism for expert cache, O_DIRECT, overlap, io-threads, drop-cold, or flash prefetch. Those are ours.

### 1.3 Every paper knob they introduce or sweep (with effect sizes)

Training knobs (Muon scale 0.2, WHD, FIM rate 50/10/50, aux-loss 1e-3→1e-4, YaRN data mix, GRPO/IcePop, …) are **not inference tunables**. Listed only where they constrain the checkpoint we run.

#### Inference-relevant architecture sweeps

| Knob | Values swept | CLAIMED effect | Section |
|---|---|---|---|
| Dense vs MoE | Qwen3 dense 24–40 layers, hidden 2304–4096; DeepSeek-style MLA | No dense config beat Qwen2.5-7B inside the H100 latency budget. MLA reached ~5.5B at equal speed; quality “insufficient”. MoE → ~12B total at ~2.5B-active compute. | §2.1.1 |
| Expert count | Fixed **64** (more exceeded H100 memory) | Constraint, not a quality sweep. | §2.1.2 |
| Active experts k | 2 vs 8 (and “higher sparsity better latency / lower sparsity better quality”) | **k=2 ≈ 1.5× lower latency than k=8.** Quality worse at high sparsity. Settled on **8-of-64**. Fig. 1: iso-latency maps at k=8. | §2.1.2 |
| KV heads | 2 / 4 / 8 | 8: “significant throughput degradation” (concurrent). 2: “insufficient quality”. 4 selected. Effect “negligible” in sync/single-request. | §2.1.3, Fig. 2 |
| SWA pattern / window | 3/4 layers SWA; window **512 vs 1024** | 1024 **outperforms 512 on quality**. Fig. 3: MoE+SWA latency ≈ Qwen2.5-7B at **2× context**. No numeric Δ ms published in HTML text. | §2.1.4 |
| MTP head (train) | on vs off, 14B MoE, 105B tokens, α=0.1 | **+7% train time.** Val loss ~identical. Table 1 (quality, **not speed**): HumanEval +10.37 (20.73→31.10), HumanEval+ +7.93, MMLU +3.57, MMLU-Pro +3.25, GSM8K +2.96, BBH +2.74, Code MMLU +1.74, HellaSwag +0.44, MBPP 0.00, some small negatives (ARC −1.20, Winogrande −1.50). **No acceptance rate, no spec-dec tok/s.** | §2.1.5 Table 1 |
| YaRN recipe | layer-selective vs uniform θ-bump vs unchanged θ | RULER @64k: **0.64 / 0.52 / 0.33**. Gap widens with length. Absolute RULER conservative (prompt-format bug, App. C.1). | §4.1 Fig. 7 |
| Long-ctx token budget | ~30B vs 117B | RULER already within ~1 pp of final at 30B; extra tokens mainly drop MoE load-balancing loss. | §4.3 Fig. 8–9 |
| §6 serving | sync vs throughput, vs Qwen2.5-7B / Qwen3-8B | **Sync: 192 vs 193 tok/s** (Qwen2.5-7B). **Throughput: 5179 tok/s, +21% vs Qwen2.5-7B, +79% vs Qwen3-8B.** Saturation 20.2 / 16.7 / 11.3 req/s. | §6 Fig. 13, §7 |

#### Table 1 (CLAIMED, 14B ablation — not the released 12B)

Source: [HTML Table 1](https://arxiv.org/html/2605.31268v1#S2.T1).

| Benchmark | Metric | Baseline | +MTP | Δ |
|---|---|---:|---:|---:|
| HumanEval | pass@1 | 20.73 | 31.10 | +10.37 |
| HumanEval+ | pass@1 | 18.29 | 26.22 | +7.93 |
| MMLU | acc | 37.49 | 41.06 | +3.57 |
| MMLU-Pro | EM | 19.07 | 22.32 | +3.25 |
| GSM8K | EM | 30.63 | 33.59 | +2.96 |
| BBH | EM | 35.00 | 37.74 | +2.74 |
| Code MMLU | acc | 32.64 | 34.38 | +1.74 |
| HellaSwag | norm acc | 58.85 | 59.29 | +0.44 |
| MBPP | pass@1 | 36.80 | 36.80 | 0.00 |
| Code MMLU (cont.) | norm acc | 41.17 | 40.94 | −0.23 |
| MMLU (cont.) | norm acc | 38.70 | 38.29 | −0.41 |
| MBPP+ | pass@1 | 56.61 | 56.08 | −0.53 |
| ARC-Challenge | norm acc | 41.30 | 40.10 | −1.20 |
| Winogrande | acc | 59.51 | 58.01 | −1.50 |

### 1.4 Hardware their numbers come from — what transfers to S23

**Their stack (CLAIMED, §6):** 1× H100 80 GB, vLLM, **dynamic FP8** quantization, host 192 GB RAM / 48 CPU, Docker-pinned deps. Workload = production **code completion** shape (mean 2304 in / 256 out). Two regimes: sequential single-request (**sync**) and saturated concurrent (**throughput**). Target was “match Qwen2.5-7B on one H100.”

**Our stack (MEASURED):** Galaxy S23, Snapdragon 8 Gen 2 (1×X3 + 2×A715 + 2×A710 + 3×A510), LPDDR5X, UFS 4.0, Termux, `bmoe-cli` llama.cpp CPU fork, **expert streaming from flash**, 2 GB LRU, O_DIRECT, overlap. F1b: **424 MiB/s** flash, compute 0.224 s/tok, wall 0.336 s/tok, **2.94 t/s**, 185 MiB/tok, hit 76% (`moe-mellum2-f1-s23.md:159`).

| Claim | Transfers to S23 + our fork? |
|---|---|
| 192 tok/s sync H100 FP8 vLLM | **No.** Different device class, precision, runtime, residency. Off by ~65× vs F1b 2.94. |
| +21% concurrent throughput | **No.** We do not saturate a GPU server. Single request, one phone. |
| Dynamic FP8 | **No.** We run k-quants (Q4_K official; KEXP Q2_K/Q3_K). No FP8 CPU path in campaign. |
| k=2 is ~1.5× faster than k=8 (H100 latency) | **Plausibly yes in direction, not in magnitude.** Cutting k cuts **both** GEMM and flash bytes. On **flash-bound** F1b, I/O scales closer to linear in k×expert-bytes. SPECULATIVE: k=6 ≈ 0.75× bytes → if hit% holds, ~3.7–4.2 t/s before hitting the 4.5 t/s compute wall; k=4 more. Quality unknown. Paper's 1.5× is GPU kernel latency, not UFS. |
| 4 KV heads help throughput | **Mostly no** at `-c 4096` single stream. Helps a bit if we ever go long-ctx / multi-session. Already baked. |
| SWA 1024 3:1 cuts attn at long ctx | **Yes, already on.** Helps prefill/TTFT at large `-c`, not the 185 MiB/tok expert tax. |
| MTP draft 1-token | **No.** Head not in GGUF. Even if it shipped: 1 extra MoE layer of flash per draft token — same class of sequential tax that killed 35B MTP (`research-mellum2.md:305–313`). |
| ÷128 alignment 2× GPU | **No** on CPU GEMV. |
| Layer-selective YaRN RULER | Quality-only; irrelevant to 4k decode I/O. |
| “2.5B active ⇒ 7B-dense speed” | **Marketing on H100.** On S23 the binding constraint is **flash misses of a wide shallow MoE** (896-wide × k=8), not active-param FLOPs. F1b killed the 4.5–6 t/s Q4 paper band. |

---

## Part 2 — OUR tunable surface (primary sources only)

Baseline F1b cell (MEASURED):

```
-t 4 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon --overlap
--io-threads 4 --ubatch 512 --n-expert-used 8 --temp 0 --chatml --no-think
```

S23, unplugged, cold fadvise, 2 reps, n_gen=166 (EOS). Median **2.944 t/s / 185.0 MiB/tok / hit 76.0%**. Compute 0.224 + cache 0.018 + flash 0.436 s/tok; wall 0.336 (overlap). Flash **424 MiB/s**. Compute ceiling ≈ **4.5 t/s**. **Flash-bound today.** (`moe-mellum2-f1-s23.md:147–159`)

Comparators (MEASURED, same device family unless noted):

| Model | decode | MiB/tok | hit% | source |
|---|---:|---:|---:|---|
| Mellum2 Q4 k=8 F1b S23 | 2.94 | 185.0 | 76.0 | moe-mellum2-f1-s23.md:156 |
| CalaQwen KEXP 35B k6 d0.65 S23 | 5.70 | 30.7 | 80.7 | same + research-mellum2.md:10 |
| Marco1c KEXP k6 d0.65 S23 | 8.82 | 51.5 | 53.5 | moe-mellum2-f1-s23.md:157; Marco-Q4KM A2 hit was **36.65** on same session (`:153`) |
| LFM2.5 Q4 **mmap-resident** Jelly G99 | 10.60 (k=4) / 12.28 (k=3) / **14.38 (k=2)** | DRAM ~10.6–11.0 GB/s | n/a (not streamed) | moe-g99-freetier.md:68–111 |

Marco hit **36.7 → 53.5** when the file shrank Q4KM → KEXP-1c (same session as 1c). That is **MEASURED file-size → hit%** on a 2 GB cache, not a paper claim.

### 2.1 Runtime flags (from `cli/main.cpp` print_usage + `config.h`)

I did not execute a PC `bmoe-cli --help` (no heavy compute; Android ELF in `build-android-*`). The usage text **is** the help string (`cli/main.cpp:352–499`). Engine knobs are the structs in `core/include/bmoe/config.h`.

#### Always-on decode / prefill

| Flag | Default | What it does | Source |
|---|---|---|---|
| `-m` | required | GGUF path | main.cpp:356 |
| `-p` / `-n` | prompt / 128 | prompt, gen length | :357–358 |
| `-t, --threads` | **4** | compute threads | config.h:346; main.cpp:359 |
| `-c, --ctx-size` | 2048; F1b **4096** | KV/context | :360 |
| `--ubatch N` | 0 = n_ctx | max graph width = prefill chunk. **Decode unaffected.** Reserves compute RAM: **320 MiB @2048 → 80 MiB @512** (CLAIMED in help, measured in-engine). Hands RAM to expert cache. | config.h:349–362; main.cpp:361–365 |
| `--chatml` / `--no-think` / `--think` (config default think=true) | F1b: chatml + no-think | template + suppress CoT | config.h:363–371 |
| `--temp / --top-k / --top-p / --seed` | 0 / 40 / 0.95 / random | sampling; temp≤0 = greedy | config.h:22–27 |
| `--n-expert-used N` | 0 = GGUF k | **lossy** top-k override | config.h:373–378 |
| `--progress` / `--csv` / traces | off | telemetry; traces cost speed | main.cpp:368–392 |
| `--session` | off | keep model+expert LRU warm; JSON stdin protocol | docs/session.md; main.cpp:369 |
| `--ppl-file` / `--ppl-decode` / `--ppl-csv` | off | quality meters; `--ppl-decode` sees drop/cache | main.cpp:370–378 |

Env (flag wins): `BMOE_CACHE_MB`, `BMOE_IO_THREADS`, `BMOE_PROGRESS`, `BMOE_OVERLAP`, `BMOE_PREFETCH`, `BMOE_N_EXPERT_USED`, `BMOE_PREDICT_LOG`, `BMOE_PREDICT_PREFETCH` (main.cpp:497–498, applied :761–770).

#### GPU / placement (campaign CPU path is `-ngl 0`)

| Flag | Default | Notes |
|---|---|---|
| `--ngl / --n-gpu-layers` | **0** | `<0` = all+output. Campaign split `--ngl 99` needs OpenCL binary. Adreno OpenCL tg **slower** than CPU on S23 Qwen3.5-2B (10.25 vs 18.19, moe-cpu-build-gap.md:56–62). |
| `--flash-attn off\|on` | **off** | Keep off on Adreno A7X (AUTO aborts). config.h:392–395 |
| `--moe-cpu-experts off\|on\|auto` | Off; **Auto if `--moe-stream`** | Pins `ffn_*_exps` to CPU so GPU MUL_MAT_ID cannot steal the expert-ready hook. config.h:46–50, 396–397; main.cpp:771–773 |
| `--override-tensor PAT[=BT]` | empty | llama.cpp `-ot`; bare regex = CPU. Repeatable. |

K4-split on S23 **failed** the speed gate: decode 2.90 → 2.03 (0.70×), TTFT 17.8 → 30.4 (moe-selfspec-f0.md:25–27 citing moe-k4-split.md). Do not reopen as a “free” Mellum lever.

#### Self-spec (`SpecConfig`, config.h:273–338)

| Flag | Default | Notes |
|---|---|---|
| `--mtp` | off | Needs nextn block. **Mellum GGUF has none.** |
| `--ngram` | off | Prompt-lookup; drafts nothing if no match → floor = baseline. Works on any model. |
| `--draft N` | 3 (max 8) | Verify width = 1+N. Widens per-layer expert set toward N·k. |
| `--mtp-p-min F` | 0 | Adaptive draft stop. |
| `--ngram-min-match N` | 3 | Confidence floor. |
| `ngram_max_match` | 12 in config.h:331 | **Not exposed on CLI.** Missing-in-CLI. |

Self-spec F0 acceptance grid: **never ran** (BLOCKED_PC, moe-selfspec-f0.md). No MEASURED α on this stack. Batched verify is **not** byte-identical (config.h:283–288: 1 token differed on Qwen3.6-35B over 128 greedy).

#### MoE streaming (`MoeStreamConfig`, config.h:85–268)

| Flag | Default | Notes |
|---|---|---|
| `--moe-stream` | off | Fail-fast if no recipe. Mellum recipe added on `kalsa/mellum-recipe` (`{"mellum", {ffn_gate,up,down_exps}}`). |
| `--cache-mb N\|auto` | 0; F1b **2000** | LRU. `cache_min_mb=1500`. Below one token-cycle hit rate goes to **0.0%**, not “low” (docs/cache-sizing.md:11–23: gpt-oss k=4 demand 1815 MiB, 1500 MiB cache = 0% hit + 0.233 s/tok management). auto = MemAvailable − floor, clamp [min, expert-set]. |
| `--cache-floor-mb` / `--cache-ceil-mb` | 1536 / 0 | Only with auto. |
| `--io-threads N` | **4**, max 8 | “4 is the measured sweet spot on UFS4 phones” (config.h:107). 8 lanes **hurt** flash BW (585 → 392 MiB/s, expert-prediction.md:32–33). |
| `--no-odirect` | o_direct **true** | Bypass page cache for expert reads. |
| `--dense-weights mmap\|warm\|anon\|ahwb\|anon-gpu` | **anon** | anon = O_DIRECT into anon buffers (reclaim → zram). ahwb = dma-buf, Android-only, help text CLAIMED **+17.9%** on a long generation (main.cpp:454–455). anon-gpu for `-ngl` so trunk is not doubled in DRAM. |
| `--load-all` / `--force-cache` | off | Debug. |
| `--overlap` | off; F1b **on** | Async expert I/O vs FFN; needs fork expert-ready hook. |
| `--io-two-wave` | **off** | Publish first-projection reads before rest. Needs overlap+cache. “Default off pending on-device A/B” (config.h:125, main.cpp:464–466). |
| `--prefetch K` | 0, max 8 | Temporal: previous-token bet on layers l+1..l+K. Needs cache. Offline: ~43% slot agreement vs ~89% stale-gate (config.h:201; expert-prediction.md:5–8). |
| `--prefetch-sync` | off | Debug; kills overlap. |
| `--drop-cold-experts F` | 0 | Lossy. Skip cache-MISS experts with weight < F×(1/k). Never drops a resident. Never empties a routing (top expert pinned). `drop_low_topk_warn=4`. |
| `--drop-no-renorm` | renorm **true** | A/B. |
| `--drop-in-prefill` | **false** | Cold cache discards ~4× the decode mass (config.h:177–180). Prefill is compute-bound. |
| `--route-ahead N` | 0, max 8 | EXPERIMENTAL LOSSY: routing **is** the N-layer-stale prediction. ~15–20% slots differ at N=1 (config.h:239). Excludes prefetch/predict. |
| `--predict-log` | off | Probe only; not a bench run (extra GEMV/layer). |
| `--predict-prefetch` | off | Act on stale-gate. `--predict-spec-max` default 2 (0 = retention only). **On-device: refuted for wall-clock** on flash-saturated Qwen — hit up, stall down, **tok/s down** because extra flash bytes (expert-prediction.md:9–44). |
| `--list-archs` | — | Must print `mellum` on the F1b binary. |

Drop-cold **MEASURED** on Qwen3.6-35B in-app, cache 3000, one variable (docs/expert-dropping.md:47–56):

| F | tok/s | flash read | routings dropped |
|---|---:|---:|---:|
| off | 2.549 | 248 GiB | 0 |
| 0.50 | 2.564 | 231 | 2.7% |
| 0.75 | **3.938** | 163 | 14.2% |
| 1.00 | **4.702** | 48 | 28.4% |

Quality: 15 GSM8K, 12/15 off vs **13/15 at every F including 1.0** — rules out collapse, not a subtle cost (expert-dropping.md:66–77). Replay: F=1.0 avoids **66%** reads for **9.5%** weight vs k-cut 5 avoiding 23% reads for 10.6% weight (`:25–32`).

`--dense-weights ahwb` +17.9% is **CLAIMED in CLI help**, not re-verified here.

### 2.2 Build-time

Canonical NDK path (`BigMoeOnEdge/scripts/build-android.ps1:63–68`, echoed in `scripts/build_bmoe_ndk.sh:14–32`):

```
-DANDROID_ABI=arm64-v8a
-DANDROID_PLATFORM=android-29          # not 31; covers S23 + older
-DCMAKE_BUILD_TYPE=Release
-DGGML_NATIVE=OFF
-DGGML_OPENCL=OFF
-DGGML_OPENMP=OFF
-DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16   # deliberately NO +i8mm
-DLLAMA_CURL=OFF
```

**Not set:** `GGML_CPU_REPACK`. Upstream default is **ON** (`third_party/llama.cpp/ggml/CMakeLists.txt:152`).

**F1b Mellum binary was not canonical** (`moe-mellum2-f1-s23.md:124`):

```
NDK r27.1 · API 29 · GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+i8mm+fp16
HAVE_DOTPROD=1 · HAVE_MATMUL_INT8=1
```

That combination is exactly the CPU-gap bug:

**MEASURED** on S23, same Qwen3.5-2B Q4_K_M, `-t 4`, llama-bench tg256, unplugged (`reports/moe-cpu-build-gap.md:1–57`):

| binary | pp128 | tg256 |
|---|---:|---:|
| Termux build-safe (no REPACK extra-buffer) | 44.13 | **18.10** |
| K2.2 NDK REPACK ON +i8mm, **unstripped 125 MB** | 63.62 | **12.37** |
| cpufix unstripped, REPACK OFF | 36.12 | 15.28 |
| **cpufix stripped, REPACK OFF, no i8mm** | 37.86 | **18.19** |

Decode **12.37 → 18.19 = +47%** (the “+46% decode” lesson). Two stacked bugs: (1) REPACK + `ggml_cpu_has_matmul_int8()` converts Q4_K (`ne[1]%8==0`) to `q4_K_8x8_q8_K` — GEMM win, **GEMV loss**; (2) NDK Release still links `-g`; `llvm-strip --strip-unneeded` 125 MB → 6.2 MB recovers ~3 t/s.

Other build knobs:

| Knob | Status in campaign |
|---|---|
| `+dotprod` | ON (required for Q4_K / Q2_K / Q3_K) |
| `+i8mm` | Canonical **OFF** (SIGILL on pre-2021; product binary is device-agnostic). F1b **ON**. |
| `+fp16` | ON |
| API 29 vs 31 | 29 |
| NDK r27.1 | F1b used this |
| LTO / `CMAKE_INTERPROCEDURAL_OPTIMIZATION` | **Not in canonical flags.** Missing unless someone adds it. |
| Strip | Required; F1b sha listed but strip not stated in F1b header |
| `GGML_OPENMP` | OFF |
| `GGML_CPU_ALL_VARIANTS` | Not used — would drop the statically linked expert-ready hook (build-android.ps1:16–19) |

**SPECULATIVE on F1b compute 0.224 s/tok:** if REPACK stole Q4_K GEMV the same way, true compute ceiling is closer to ~6.5 t/s than 4.5. That does **not** move 2.94 t/s while flash is 0.436 s/tok. Faster compute can even **uncover** I/O (less overlap hide). Rebuild is a **ceiling** fix, mandatory before interpreting a k-cut that approaches 4.5 t/s.

### 2.3 Quantization recipe (KEXP)

House recipe, experts-only k-quants + imatrix. **No IQ\*** (OpenCL-safe; also the requant-1c lesson).

**Marco 1c** (`results/marcokexp/tensor_types_1c.txt`, 28-layer Qwen-class):

| class | type |
|---|---|
| `ffn_gate_exps`, `ffn_up_exps` | **q2_k** |
| `ffn_down_exps` | **q3_k** |
| attn Q/K/V/O, `token_embd`, `^output\.weight$` | **q5_k** |
| norms, `ffn_gate_inp` (router) | **f32** |

Regex lesson: `output.weight` substring-matched expert names until anchored `^output\.weight$` (moe-requant-1c.md:16–17).

**CalaQwen 35B KEXP** (same class + shared-expert / GDN extras): experts Q2_K/Q3_K, dense Q5_K/Q6_K (mandates/k4-split-overnight.md:47; moe-requant-1c.md:16 “experts 120/0 Q2_K/Q3_K, dense 613/0”).

**LFM2.5 recipe** (`reports/moe-lfm25-kexp.md:58–68`): same expert split; dense FFN down **q6_k**; `shortconv.out_proj` q6_k; `shortconv.in_proj` q5_k; conv/norms/router f32. Tied embed → `^output\.weight$` will not match.

**imatrix corpora (MEASURED provenance, not a sweep):**

| SKU | imatrix |
|---|---|
| CalaQwen 1c | Unsloth precomputed (moe-lfm25-kexp.md:92) |
| Marco 1c | `Marco-Mini-Instruct.imatrix.gguf` (mradermacher i1) |
| LFM2.5 | `imatrix_unsloth.gguf_file` sha `09cf3e3f…` |
| Campaign-owned | multi5 + Dante are **meters**, not calib (`moe-lfm25-kexp.md:90`) |

**MEASURED 1c vs IQ2_M** (CalaQwen, `--ppl-decode`, drop 0 and 0.65): PPL **1.5249 vs 2.0955 (−27%)**; speed **−3.1%** pooled (5.116 vs 4.958). Hit slightly worse (file bigger: ~12.5 vs ~11 GB). Adopted for quality, not speed (`moe-requant-1c.md:22–70`).

Mellum2 KEXP: **not built**. Geometry (`research-mellum2.md:237–247`, F1b recalibration `:167–180`): file **~4.1–4.8 GB**; k=8 mid 2.75 bpw → ~113 MiB/tok if hit stays 76%, or ~70 if miss scales with expert bytes. Decode **~3.5–4.5 t/s** — still under the compute wall. **Does not clear 10 t/s.**

Official Mellum GGUF ladder (CLAIMED on HF Q4 card, copied in research-mellum2.md:199–204): Q4_K_M 8.1 GB KLD 0.106; MXFP4_MOE 7.0 GB KLD 0.166. bartowski IQ2_XS 4.81 GB is **whole-model** crush, not KEXP.

### 2.4 OS / scheduler

Live example: **F1b nproc=6 anomaly** (`moe-mellum2-f1-s23.md:135,149`).

| moment | nproc |
|---|---|
| Smoke | **8** (72% batt, 25.2 °C) |
| Regime start | **6** |

PLAN.md campaign memory (cpuset is a first-class confounder):

- Termux demoted from `top-app` → `background`: `nproc=3`, mask `0x07` (CPU 0–2, **A510 only**) (PLAN.md:2296, 4927–4928).
- `top-app`: `nproc=6`, mask `0x3f` (CPU 0–5) (`:4928`).
- Fresh shell after restore: `nproc=6` (`:2363`) or `nproc=8` when fully online.
- `taskset` **cannot** override cgroup cpuset (`:4922`).
- `taskset 3-7` (A715/A710/X3) includes CPUs 6–7 that `top-app` mask `0x3f` may not grant (`:4909–4910`).
- Preflight: record `nproc` + `affinity_mask` every row; abort if `nproc < 6` (`:4951–4954, 4602`).

Other OS knobs (used in campaign, not bmoe flags):

| Knob | Role |
|---|---|
| Unplugged | House rule. Charging changes clocks/cpuset. |
| `~/bin/cold_model.sh` / `posix_fadvise(DONTNEED)` | Cold without reboot; mincore must be 0 or script fails (PLAN.md:995–1000). |
| Screen on / Termux foreground | Stays in top-app. |
| Wakelock | App-side; CLI-on-Termux does not take one unless something else holds it. |
| Governor / schedutil | Not directly set from Termux; thermal caps mid-cores silently (expert-prediction.md:19–20, −40% tok/s with identical I/O). |
| Batt floor | PLAN 40%; F1b used 45%. |
| Thermal | Guardrails: pause 88 °C / 60 s; combined mem+die abort (lib_guardrails.sh:29–35). Battery ≤30 °C + ≥3 min idle between reps (PLAN.md:1011–1014). |
| MemAvailable (not MemFree) | F1b guard. MemFree ~190 MiB with 4 GiB Available is page cache, not crisis (`moe-mellum2-f1-s23.md:41`). |

`-t 4` on nproc=6 (mix of little+mid, possibly no X3) is **not** the same compute as `-t 4` on nproc=8. F1b 0.224 s/tok compute is **contaminated** by this. Still flash-bound, so it did not set the 2.94 headline — it sets the 4.5 ceiling.

### 2.5 Model-side runtime

| Knob | Mellum2 | Notes |
|---|---|---|
| k (`--n-expert-used`) | native **8** | Paper CLAIMED 1.5× latency k=2 vs 8. Our F1b at 8. Cala ships k=6. LFM Jelly **MEASURED** 10.60 / 12.28 / 14.38 at k=4/3/2 (mmap, not stream). |
| drop threshold | F1b **off** | Campaign Cala/Marco **0.65**. |
| cache-mb vs file size | 2000 / Q4 expert store ~6240 MiB (32% of pool) | Hit **76%** already high (fewer tensors than Cala: 1792 vs 10240). KEXP shrinks expert store → hit should rise (Marco 36.7→53.5 is the live analog). F1b: 2000 vs 780 MiB token-demand — **above the cliff**. |
| Instruct vs Thinking | F1b Instruct `--no-think` | Thinking emits CoT tokens = wall-clock. Wrong interactive SKU. |
| `--no-think` | on | Suppresses reasoning at template, not a speed hack on Instruct. |

---

## Part 3 — tuning matrix

Regime key: F1b is **I/O-bound decode** (flash 424 MiB/s, 185 MiB/tok). Compute-bound would start near ≤~70 MiB/tok or after a big k/drop. Prefill/TTFT is the dense+attn graph (ubatch, threads, SWA). LFM on Jelly is **DRAM/compute**, not this matrix's default.

| parameter | ours already / paper-new / missing | paper CLAIMED effect | expected ON OUR REGIME | cost | proposed cell |
|---|---|---|---|---|---|
| `--n-expert-used` (k) | **ours** (paper also swept 2 vs 8 at train/arch time) | k=2 ≈ **1.5×** lower H100 latency than k=8; quality down | **I/O-bound decode: helps.** Bytes ≈ linear in k. SPECULATIVE k=6 ≈ 3.7–4.2 t/s; k=4 more, then hits compute wall. Prefill: smaller expert set per token, mild. TTFT: mild. Quality lossy. | runtime = free | **S23** k=8 (ctrl) vs **k=6** then k=4. One var. |
| `--drop-cold-experts` | **ours** (not in paper) | — | **I/O-bound decode: helps** if F high enough to fire. On Qwen 0.75/1.0 was +55%/+84% tok/s. At F1b hit 76% there is less tail to cut than Cala's cold-cache days — SPECULATIVE smaller win than Qwen table. Prefill: leave off. | free | **S23** F=0 vs **0.65** at k=8 (campaign default). Then 0.75 if 0.65 moves I/O. |
| `--cache-mb` | **ours** | — | Hit already 76% @2000 with 780 MiB cycle. Raising 2000→3000: small hit gain, **LMK risk** on 8 GB (RSS ~3 GB). Lowering toward 1500: **cliff risk** if k stays 8 (cycle 780, floor ok) but k-up would not apply. Helps I/O via hit%; not compute. | free | Only after k/drop; optional **auto** vs 2000. |
| `--io-threads` | **ours** | — | 4 = UFS4 sweet spot. 8 **hurt** BW. Unlikely to help I/O-bound already at 424 MiB/s. | free | Do **not** sweep unless 4 is broken. |
| `--overlap` | **ours** (F1b on) | — | Already hiding flash under 0.224 s compute (wall 0.336 < 0.436). Off would regress I/O-bound. | free | Keep on. A/B only as sanity. |
| `--io-two-wave` | **ours, never A/B'd on device** | — | SPECULATIVE: shorter time-to-first-slice; might shave stall, not MiB/tok. I/O-bound decode maybe small TTFT/decode win. | free | **S23** on vs off, overlap+cache held. |
| `--prefetch K` | **ours** | — | Previous-token ~35–43% useful. Extra flash on a saturated UFS often **loses** (same mechanism as predict-prefetch). | free | **Not next** on Mellum F1b. |
| `--predict-prefetch` / `--predict-spec-max` | **ours** | — | MEASURED **refuted** on flash-sat Qwen (−21% tok/s, +37% flash). Same regime as F1b. | free | **Do not run** until I/O is no longer binding. |
| `--route-ahead` | **ours** | — | Perfect prefetch, **lossy** 15–20% slot error. Engine-week to trust quality. | free to flip; week to validate quality | Later, after k/drop. |
| `--dense-weights anon` | **ours** (F1b) | — | Correct for >RAM. mmap would 4k-fault. ahwb CLAIMED +17.9% long-gen (reclaim immunity) — more a **sustained** / TTFT-stability lever than peak decode. | free (ahwb Android) | Low priority vs k/drop. |
| `--ubatch` | **ours** (F1b 512) | — | **Prefill/TTFT + RAM**, not decode. 512 already small. Going 256 frees RAM for cache. | free | Only if cache-auto needs headroom. |
| `-t` threads | **ours** (4) | — | Compute-bound / prefill. On I/O-bound, extra threads steal from I/O or little cores. nproc=6 makes `-t 4` ambiguous. | free | After cpuset hygiene; do not sweep until nproc stable. |
| `--mtp` | **ours, missing on this model** | Paper: draft narrative; **0 speed numbers**; head stripped | Cannot run. If a future MTP ckpt: SPECULATIVE **hurt** (extra 8-expert I/O per draft). | n/a / week if they ship | Skip. |
| `--ngram` + `--draft` | **ours** | — | Helps **only** on copy-heavy text; p_fact may match some n-grams. Widens expert set on accepted drafts → can **hurt I/O-bound**. | free | Optional later on a copy prompt; not F1c. |
| `--ngl` / OpenCL split | **ours** | — | MEASURED lose on S23 (CPU 18.19 vs GPU 10.25 dense; K4-split 0.70×). | free + OpenCL bin | Skip. |
| `--flash-attn` | **ours** | — | Off. On A7X aborts. | free | Keep off. |
| `--moe-cpu-experts` | **ours** | — | Auto under stream. Irrelevant at `-ngl 0`. | free | Leave auto. |
| `--override-tensor` | **ours** | — | Placement; not a Mellum CPU-stream lever. | free | Skip. |
| `--session` / KV reuse | **ours** | — | **TTFT** on turn 2+, not cold decode. | free | Product path; not F1c speed. |
| SWA 1024 3:1 | **paper-new, baked** | long-ctx latency ≈ 7B @ 2× ctx | Already on. Cannot sweep without a different ckpt. | requant/retrain = never | Accept. |
| GQA 4 KV | **paper-new, baked** | concurrent throughput | Already on. Sync-mode paper says negligible. | never | Accept. |
| Expert count 64 | **paper-new, baked** | H100 mem cap | Cannot tune. | never | Accept. |
| k=8 trained | **paper-new; we can override** | quality/latency trade | Runtime k-cut is the transfer. | free | See k row. |
| MTP α=0.1 | **paper-new, missing in weights** | Table 1 quality only | Missing-in-our-stack **and** missing-in-checkpoint. | week+ if they ship | Skip. |
| YaRN selective | **paper-new, baked** | RULER +0.12–0.31 vs alts | Quality long-ctx only. | never | Accept. |
| ÷128 align | **paper-new, baked** | ≤2× GPU | No CPU transfer. | never | Ignore. |
| `GGML_CPU_REPACK=OFF` | **ours build; F1b likely ON** | — | **Compute-bound decode / ceiling.** MEASURED +47% tg on Q4_K GEMV. On F1b I/O-bound: little tok/s now; **required before k-cut interpretation**. Prefill: REPACK ON helped pp (63 vs 38). | rebuild ~1 h | **S23** labeled `bmoe-cli-mellum-norepack` vs F1b pin. |
| strip | **ours** | — | +~3 t/s on dense llama-bench. F1b binary 402 KB CLI + .so — check .so strip. | rebuild minutes | Bundle with REPACK cell. |
| `+i8mm` vs `+dotprod` only | **ours** | — | i8mm enables the REPACK GEMV steal. Canonical is **no i8mm**. F1b has i8mm. | rebuild 1 h | Same cell as REPACK. |
| LTO | **missing** | — | SPECULATIVE small compute win. Not worth a solo rebuild. | rebuild 1 h | Piggyback only. |
| API 29 / NDK r27 | **ours** | — | Hold. Not a speed lever. | rebuild | Hold. |
| KEXP experts Q2_K/Q3_K + dense Q5 | **ours recipe; Mellum file missing** | — | **I/O-bound decode: helps bytes.** F1b math: 185→~70–113 MiB/tok → **3.5–4.5 t/s**, then compute-bound. Hit% should rise (Marco 36.7→53.5 analog). File 4.1–4.8 GB. | requant = **day** | After k/drop grid, if 10 t/s still required. |
| imatrix corpus | **ours** | — | Quality of KEXP, not tok/s. | day | With KEXP. |
| Official MXFP4_MOE | **paper-adjacent (JetBrains GGUF)** | KLD 0.166 vs Q4 0.106 | Unknown CPU kernel quality. Not KEXP. | download + run | Only if we want a no-requant smaller file A/B. |
| cpuset / nproc / foreground | **ours OS** | — | Contaminates **compute** (F1b nproc=6). Does not create flash BW. Must be a **preflight**, not a “speed idea.” | free | **S23** every cell: nproc≥8 or documented 6 + mask. |
| taskset big cores | **ours OS** | — | Cannot beat cgroup. Useful only inside top-app. | free | After nproc hygiene. |
| wakelock / governor | **ours OS** | — | Stability, not a 2.94→10 lever. | free | Housekeeping. |
| `--drop-in-prefill` | **ours** | — | Hurts prefill quality, little speed (compute-bound). | free | Keep off. |
| Thinking ckpt | **paper variant** | better benches, CoT tokens | **TTFT/decode worse** (more tokens). | download | Not interactive SKU. |

### Prioritized top-5 “test next” (cheapest first)

House rules for every cell: **unplugged**, `~/bin/cold_model.sh` fadvise (mincore 0), **2 reps**, **one variable**, greedy `--temp 0`, same `p_fact` sha `b5301c32…`, same flags as F1b except the one delta, log `nproc` + `affinity_mask` + batt% + batt °C + MemAvailable. Abort if nproc < 6. Do not overwrite `bmoe-cli.CAMPAIGN`.

**Phone: S23 for all five.** Jelly is the LFM mmap/G99 lane (10.6–14.4 by k). Mellum Q4 is 8.07 GB streamed; do not put this grid on Jelly unless that file and the mellum-recipe binary are already there.

#### 1. Cpuset / nproc hygiene (cost: free; not a speed claim)

**Why first:** F1b regime ran **nproc=6** after smoke at 8. Until this is clean, every compute number (0.224 s/tok, 4.5 t/s ceiling, REPACK A/B) is confounded.

**Delta:** no bmoe flag. Before each rep:

```
nproc; cat /proc/self/status | grep Cpus_allowed
# require nproc>=8 (or nproc=6 AND mask=3f documented as top-app), Termux foreground, screen on
```

Re-run **exact F1b cmdline** as a sentinel if nproc≠6. If tok/s stays ~2.94 with nproc=8, cpuset was **not** the headline; if compute s/tok drops, the ceiling moves.

**Phone:** S23.

#### 2. k=6 vs k=8 (cost: runtime flag)

**Why:** only paper knob that is also a first-class I/O lever; F1b is flash-bound; research + F1b both say k=8 cannot make 10 t/s.

**Delta** vs F1b:

```
# control: --n-expert-used 8
# cell:    --n-expert-used 6
```

Full:

```
bmoe-cli-mellum -m Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf \
  -t 4 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon --overlap \
  --io-threads 4 --ubatch 512 --n-expert-used 6 --temp 0 --chatml --no-think \
  -n 200 -p "$(cat p_fact.txt)"
```

Expect: MiB/tok down, hit% maybe up, decode up toward ~3.5–4.2. **Do not** also change drop.

**Phone:** S23.

#### 3. drop-cold 0.65 at native k=8 (cost: runtime flag)

**Why:** campaign default on the models that actually move; orthogonal to (2); spends quality only on cold tail.

**Delta:**

```
# add: --drop-cold-experts 0.65
# keep: --n-expert-used 8
```

If MiB/tok barely moves, F=0.65 is the Qwen “0.50 dead zone” analog (expert-dropping.md:58–60) — then a **second** cell at 0.75, still alone.

**Phone:** S23.

#### 4. `--io-two-wave` (cost: runtime flag)

**Why:** the only shipping overlap tweak never A/B'd; does not add flash bytes (unlike prefetch). Cheap negative is still information.

**Delta:**

```
# add: --io-two-wave
# keep: --overlap --cache-mb 2000 --n-expert-used 8, no drop
```

Expect: small stall/TTFT change or null. If null, close the flag for Mellum.

**Phone:** S23.

#### 5. Rebuild REPACK OFF + no i8mm + strip (cost: ~1 h rebuild; then 2-rep sentinel)

**Why:** F1b binary matches the stolen-GEMV signature (`+i8mm`, `HAVE_MATMUL_INT8=1`, REPACK default ON). This is the user's suspicion. It will **not** turn 2.94 into 8 t/s. It **will** raise the ceiling so cells 2–3 are readable when I/O falls.

**Delta (build, not argv):**

```
-DGGML_CPU_REPACK=OFF
-DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16
# same API 29, NDK r27, OPENCL=OFF, OPENMP=OFF
llvm-strip --strip-unneeded
# label: bmoe-cli-mellum-norepack  — do not overwrite bmoe-cli-mellum or CAMPAIGN
```

Then **identical F1b argv**. Compare compute s/tok and decode. If decode ≈2.94 and compute s/tok drops, suspicion CONFIRMED and you have budget for k/drop. If both flat, F1b was not in the REPACK GEMV path (possible if Q4_K expert layouts skip the `ne[1]%8==0` convert).

**Phone:** S23.

**Not in the top-5, on purpose**

- `--predict-prefetch` / `--prefetch` / `--io-threads 8`: MEASURED losses on flash-sat devices.
- KEXP requant: right **next day** if k=6+drop still <5 t/s and 10 t/s remains a gate; not cheap-first.
- `--ngram` / `--mtp`: MTP absent; ngram widens reads.
- Jelly LFM k-sweep: already MEASURED; different SKU/regime.
- `-ngl` OpenCL: MEASURED lose.

---

## Sources

### Paper

- https://arxiv.org/abs/2605.31268
- https://arxiv.org/pdf/2605.31268
- https://arxiv.org/html/2605.31268v1 (§2, Table 1–2, §4, §6, §7)
- https://huggingface.co/collections/JetBrains/mellum-2
- https://blog.jetbrains.com/ai/2026/05/mellum2-goes-open-source-a-fast-model-for-ai-workflows (abs page); launch blog also 2026-06-01

### Our tree (file:line)

- `BigMoeOnEdge/core/include/bmoe/config.h:22–401`
- `BigMoeOnEdge/cli/main.cpp:352–499` (help), `:586–773` (parse + env)
- `BigMoeOnEdge/scripts/build-android.ps1:10–68`
- `BigMoeOnEdge/third_party/llama.cpp/ggml/CMakeLists.txt:152` (`GGML_CPU_REPACK` default ON)
- `BigMoeOnEdge/docs/cache-sizing.md:11–23,46–80`
- `BigMoeOnEdge/docs/expert-dropping.md:25–77`
- `BigMoeOnEdge/docs/expert-prediction.md:1–44`
- `BigMoeOnEdge/docs/session.md:1–79`
- `moe-experiments/scripts/build_bmoe_ndk.sh:14–32`
- `moe-experiments/scripts/lib_guardrails.sh:29–35`
- `moe-experiments/results/marcokexp/tensor_types_1c.txt` (Q2_K/Q3_K/Q5_K/F32)
- `reports/moe-cpu-build-gap.md:1–57`
- `reports/moe-mellum2-f1-s23.md:1–184` (F1 fail + F1b 2.94 / 185 / 76 / nproc=6 / REPACK-ish build)
- `reports/research-mellum2.md` (paper recon; §6 math superseded by F1b)
- `reports/moe-requant-1c.md:16–70`
- `reports/moe-lfm25-kexp.md:58–120`
- `reports/moe-g99-freetier.md:16,68–145`
- `reports/moe-selfspec-f0.md:19–27`
- `PLAN.md:991–1018, 4927–4954`

---

DONE
