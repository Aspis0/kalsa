# New-MoE recon: Instella-MoE (AMD) + Nemotron 3.5 Lightning (NVIDIA)

**Question:** can either just-released MoE exceed **10 tok/s decode on Galaxy S23** under our stack (llama.cpp fork + expert streaming + k/drop + KEXP-style expert requant)?

**Short answer:** **No, not as a shippable 10 tok/s SKU.** Instella is the closer *geometry* (MLA, no SSM, 16B total, Q2 GGUF ~6.5 GB that might even fit RAM) but is a **hard commercial veto**. Lightning is the closer *product* (OpenMDW, official GGUF, upstream `nemotron_h_moe`) but is a **Mamba-2 hybrid** whose CPU decode tax is in the same family as CalaQwen’s GDN problem, with a larger always-on dense body. Neither is a drop-in that beats Marco1c’s 8.82 t/s enough to clear 10.

Reference points we treat as measured, not estimated:

| model (shipped) | S23 decode | MiB/tok | hit% | source |
|---|---:|---:|---:|---|
| Marco1c KEXP | 8.82 | 51.5 | 53.5 | lineup card / `reports` campaign |
| CalaQwen = Qwen3.6-35B-A3B KEXP `k6d065` | 5.70 | 30.7 | 80.7 | same; geometry [Qwen3.6-35B-A3B `config.json`](https://huggingface.co/Qwen/Qwen3.6-35B-A3B/raw/main/config.json) |

CalaQwen is **already compute-bound** (fewer bytes, higher hit, slower). Marco is **I/O/hit-bound** (more bytes, worse hit, faster). New models are scored against both regimes.

---

## Identity check (names are real)

Both names exist **exactly** as announced. No substitution needed.

| spoken name | exact HF identity | first public date | sizes offered (downloadable) |
|---|---|---|---|
| Instella MoE / AMD | `amd/Instella-MoE-16B-A3B-*` only | blog **2026-07-24**; HF Think card crawled ~**2026-07-28** | **one geometry**: 16B total / 2.8B active. Six training-stage checkpoints, not six sizes. |
| Nemotron 3.5 Lightning / NVIDIA | `nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-*` | **2026-08-11** | **one geometry**: 30B-class / 3B active (GGUF reports **33B** incl. MTP). Plus Base, NVFP4, DSpark, DFlash. |

Not the same as:

- Historical **Instella-3B** dense (`amd/Instella-3B-Instruct`, Nov 2025) — different arch, same ResearchRAIL family.
- **Nemotron 3 Nano 30B-A3B** (Dec 2025) — **same skeleton** as Lightning; Lightning is the 3.5 successor (more post-train, MTP, DSpark/DFlash, 1M ctx). Community take: “architecture identical, branding + training + spec-dec.” Confirmed layer-for-layer in [Classmethod’s `config.json` dump](https://dev.classmethod.jp/en/articles/dgx-spark-nemotron-3-5-lightning-first-touch/).

### Instella-MoE — official, downloadable

Collection: <https://huggingface.co/collections/amd/instella-moe>

| repo | stage | announced + downloadable |
|---|---|---|
| [amd/Instella-MoE-16B-A3B-Pretrain](https://huggingface.co/amd/Instella-MoE-16B-A3B-Pretrain) | pretrain | yes (BF16 safetensors) |
| [amd/Instella-MoE-16B-A3B-Midtrain](https://huggingface.co/amd/Instella-MoE-16B-A3B-Midtrain) | midtrain | yes |
| [amd/Instella-MoE-16B-A3B-Base](https://huggingface.co/amd/Instella-MoE-16B-A3B-Base) | long-ctx base (final base) | yes |
| [amd/Instella-MoE-16B-A3B-SFT](https://huggingface.co/amd/Instella-MoE-16B-A3B-SFT) | SFT | yes |
| [amd/Instella-MoE-16B-A3B-DPO](https://huggingface.co/amd/Instella-MoE-16B-A3B-DPO) | DPO | yes |
| [amd/Instella-MoE-16B-A3B-Think](https://huggingface.co/amd/Instella-MoE-16B-A3B-Think) | RL / thinking (flagship) | yes |

Vendor blog: <https://rocm.blogs.amd.com/artificial-intelligence/instella-moe/README.html> (2026-07-24).
Code: <https://github.com/AMD-AGI/Instella-MoE>.
No official GGUF from AMD. Community GGUF is **not** upstream-runnable (see §4).

### Nemotron 3.5 Lightning — official, downloadable

| repo | role | announced + downloadable |
|---|---|---|
| [nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16) | full-precision reference (post-train) | yes |
| [nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-Base-BF16](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-Base-BF16) | base / no SFT-RL | yes |
| [nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4) | production NVFP4 | yes |
| [nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4-DSpark](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4-DSpark) | spec-dec draft (not a standalone LLM) | yes |
| [nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4-DFlash](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4-DFlash) | spec-dec draft | yes |
| [ggml-org/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF](https://huggingface.co/ggml-org/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF) | **official** GGUF | yes (NVFP4 22.5 GB, Q4_K_M 25.4 GB, Q8_0 35 GB, BF16 65.9 GB) |
| [bartowski/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF](https://huggingface.co/bartowski/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF) | imatrix GGUF, llama.cpp **b10362** | yes (Q2_K 18.9 GB … Q4_K_M 25.5 GB) |

Vendor blogs:

- Developer: <https://developer.nvidia.com/blog/nvidia-nemotron-3-5-lightning-delivers-fast-accurate-specialized-task-execution-for-long-running-agents/> (2026-08-11)
- Product: <https://blogs.nvidia.com/blog/nemotron-lightning-switchyard-rtx-dgx/>

Card line: **“This model is ready for commercial use.”**

---

## 1. Instella-MoE (AMD)

### 1.1 Architecture geometry

Primary: [Think `config.json`](https://huggingface.co/amd/Instella-MoE-16B-A3B-Think/raw/main/config.json) + [Think card](https://huggingface.co/amd/Instella-MoE-16B-A3B-Think) + [ROCm blog](https://rocm.blogs.amd.com/artificial-intelligence/instella-moe/README.html).

| quantity | value | note |
|---|---|---|
| `architectures` | `InstellaMoEForCausalLM` | custom class + `auto_map` |
| `model_type` | `deepseek_v3` | **declared** DeepSeek-V3; **not** drop-in (FarSkip + gated MLA) |
| total params | **16B** | card / HF “16B params” |
| active params / token | **2.8B** | card; reconstructed below ≈ 2.4B *actually read* + embed table accounting |
| layers | **27** | `num_hidden_layers` |
| first dense FFN layers | **1** | `first_k_dense_replace: 1` → **26 MoE layers** |
| hidden | **2048** | |
| dense FFN dim (layer 0) | **10944** | `intermediate_size` |
| expert FFN dim | **1408** | `moe_intermediate_size` |
| routed experts | **64** | `n_routed_experts` |
| shared experts | **2** | `n_shared_experts` — **always on** |
| k (routed / token) | **6** | `num_experts_per_tok` |
| activation | SwiGLU (`silu`) | 3 matrices / expert |
| attention | **Gated MLA** (every layer) | `gated_attention: true`; `kv_lora_rank=512`; `q_lora_rank=null`; `qk_nope=96`, `qk_rope=32`, `v=128`; 16 heads |
| sliding / SSM / GDN | **none** | full Gated MLA, no hybrid linear attn |
| extra connectivity | **FarSkip-Collective** | `farskip: true` — dual residual streams at inference |
| context | **32 768** in config; blog trained **4K → 64K** with YaRN | `max_position_embeddings=32768`, `rope_scaling.type=yarn`, `original_max_position_embeddings=4096`, `factor=40` |
| vocab | **128 896** | untied (`tie_word_embeddings: false`) |
| router | sigmoid, `topk_method=noaux_tc`, `routed_scaling_factor=2.5` | DeepSeek-V3-style |

**Expert size (the number our math needs):**

```
params_per_routed_expert = 3 × 2048 × 1408 = 8,650,752
```

Shared experts are two always-on copies of that FFN (or one 2×-wide FFN — same bytes).

**Per-token routed expert params (k=6, 26 MoE layers):**

```
26 × 6 × 8,650,752 = 1,349,517,312   (~1.35B)
shared always-on:  26 × 2 × 8,650,752 = 449,839,104   (~0.45B)
layer-0 dense FFN: 3 × 2048 × 10944     = 67,256,320
```

MLA + LM-head reconstruction lands the card’s 2.8B “active” once you count embeddings the way vendors do. For **decode bandwidth** we do **not** charge a full embed table: input embed is one row; LM-head is `128896 × 2048 = 263,880,704` params every token.

FarSkip (from [PR #26467](https://github.com/ggml-org/llama.cpp/pull/26467) and the [FarSkip repo](https://github.com/AMD-AGI/FarSkip-Collective)): each layer keeps `res_full` (includes routed experts) and `res_nort` (excludes them). Next-layer attention reads the no-routed stream; FFN reads the full stream. A naive DeepSeek-V3 port **loads and emits fluent-but-wrong text** ([kingjones777 GGUF card](https://huggingface.co/kingjones777/Instella-MoE-16B-A3B-Think-Q4_0_ROCMFP4_STRIX-GGUF)). That is a real graph change for our k/drop + expert-stream path, not a flag.

### 1.2 LICENSE — veto

**Exact license:** “RESEARCH-ONLY RAIL Model License” (ResearchRAIL). Raw: <https://huggingface.co/amd/Instella-MoE-16B-A3B-Think/raw/main/LICENSE>

Load-bearing clauses (quoted/paraphrased from that file):

- **Permitted Purpose = “academic or research purposes only.”**
- Copyright + patent grants are **conditioned on** that purpose.
- Redistribution / SaaS is allowed **only if** downstream users also stay inside the Permitted Purpose.
- Card + blog repeat: *“licensed for academic and research purposes”* and *“released for research purposes only.”*

**Commercial app like ours (on-device shipped product): not allowed.** This is a **veto**, not a paperwork footnote.

**Historical correction:** Instella was **never Apache-class**. `amd/Instella-3B-Instruct` is the same ResearchRAIL ([card](https://huggingface.co/amd/Instella-3B-Instruct)). AMD’s “fully open” means weights+data+code are published, **not** that the grant is Apache-2.0. `NOTICES` files mention Apache only for third-party snippets.

### 1.3 llama.cpp support

| item | status |
|---|---|
| HF arch string | `InstellaMoEForCausalLM` / `model_type=deepseek_v3` |
| GGUF arch (community) | `instella` / `instella-moe` |
| **Upstream llama.cpp** | **Not merged.** [PR #26467](https://github.com/ggml-org/llama.cpp/pull/26467) (“Instella moe”, opened 2026-08-02) still open; new `LLM_ARCH_INSTELLA_MOE`, separate `instella-moe.cpp` because FarSkip + `attn_gate` would pollute `deepseek2.cpp`. |
| Runnable GGUF | [DevQuasar/amd.Instella-MoE-16B-A3B-Think-GGUF](https://huggingface.co/DevQuasar/amd.Instella-MoE-16B-A3B-Think-GGUF) — **requires** [csabakecskemeti/llama.cpp `instella-moe` branch](https://github.com/csabakecskemeti/llama.cpp/tree/instella-moe). Files: Q2_K **6.51 GB**, Q3_K_M 8.22, **Q4_K_M 10.5 GB**, Q5 12, Q6 14.2, Q8 16.9. |
| Other GGUF | [kingjones777 ROCmFP4](https://huggingface.co/kingjones777/Instella-MoE-16B-A3B-Think-Q4_0_ROCMFP4_STRIX-GGUF) — custom tensor types 100–106, **not** stock llama.cpp. Explicit: *“not in llama.cpp mainline (master 74ce157)”*. |

Distance from a supported arch: **DeepSeek-V3/MLA + MoE is upstream**, but the two deltas (gated MLA before `o_proj`; FarSkip dual residuals) are enough that treating it as `deepseek2` is a silent numerical bug. For our fork this is a **new graph**, not a convert-script afternoon.

### 1.4 Quality / languages

Vendor numbers (OLMES, max 32k gen) from the [ROCm blog Table 5](https://rocm.blogs.amd.com/artificial-intelligence/instella-moe/README.html) / Think card (tables are images; blog prose is the citable text):

- Instella-MoE-Think **average 73.22**, ahead of Olmo3-7B-Think (71.97), Gemma-4-E4B-think (70.47), **Qwen3.5-4B (69.73)**.
- Base avg 76.7 vs Qwen3.5-4B-Base 79.5, Moonlight-16B-A3B 76.2.
- AIME25 73.40, IFEval 83.70 (after IF-specialized RL), AGIEval 82.50.
- Class: **above Qwen3.5-4B / Gemma-E4B, below CalaQwen’s Qwen3.6-35B-A3B** on the NVIDIA Lightning table (that table is a different harness; do not average across vendors).

**Multilingual:** AMD is explicit — *“The multilingual abilities of the models have not been tested and thus may misunderstand and generate erroneous responses across different languages.”* IT/ES/FR/ZH are **unverified**. Pretrain mix is Nemotron-CC + code/math (mostly English-centric). **Not a multilingual SKU without our own eval.**

Heavy reasoner: community GGUF notes ~3.4k think tokens on `17×23`. Fine for a think model, bad for “10 t/s interactive” unless `enable_thinking` exists (it does **not** — no `<think>` marker in the template; PR #26467 + thinkfix patch required).

### 1.5 Our math (S23)

Assumptions, stated:

1. Expert FFN is SwiGLU, 3 mats, no latent compression.
2. Shared experts + layer-0 FFN + all MLA + LM-head are **dense per-token reads**.
3. KEXP = experts ~**2.5–3.0 bpw**, dense stays ~**4.5 bpw** (Q4_K-class), same recipe we used on CalaQwen.
4. Vanilla Q4 = ~**4.5 bpw** on experts *and* dense.
5. CalaQwen geometry for scaling: 40 MoE layers, k_runtime=6, expert 3×2048×512 = **3,145,728**, [config](https://huggingface.co/Qwen/Qwen3.6-35B-A3B/raw/main/config.json).
6. Measured CalaQwen 30.7 MiB/tok is **post-machinery** (cache + k6d065 + KEXP), not raw `k × expert × layers`. We scale that measured number by the **routed-expert-param ratio**, then talk about hit-rate and compute separately.
7. S23 “20–25 GB/s CPU DRAM” is the **silicon** ceiling. Realized streaming bandwidth on Marco is `8.82 × 51.5 ≈ 454 MiB/s`. CalaQwen realizes `5.70 × 30.7 ≈ 175 MiB/s` because it is **compute-bound** (GDN + denser body). We do not pretend a new model gets 20 GB/s through the streaming path.
8. If a quant **fits in 8 GB** with OS+KV, the regime flips from streaming (~0.2–0.5 GB/s realized) toward DRAM-resident GEMM.

**Raw expert-stream bytes (theory):**

| | CalaQwen k=6 | Instella k=6 routed | Instella + shared |
|---|---:|---:|---:|
| expert params / tok | 40×6×3.146M = **755M** | 26×6×8.651M = **1,350M** | +450M shared = **1,800M** |
| ratio vs Cala routed | 1.00× | **1.79×** | 2.38× if shared also streams |
| Q4 4.5 bpw | 425 MB | 759 MB | 1 012 MB |
| KEXP 2.75 bpw | 260 MB | 464 MB | 619 MB |

Shared experts should sit in the **dense resident** set (like CalaQwen’s 1×512 shared), not the stream. Charge them as compute+DRAM, not as UFS I/O.

**Scaled MiB/tok (streaming regime, shared resident):**

```
Instella ≈ 30.7 × 1.79 ≈ 55 MiB/tok   (KEXP, similar hit)
Instella vanilla Q4 ≈ 55 × (4.5/2.75) ≈ 90 MiB/tok
```

Hit-rate: Instella has **64×26 = 1 664** routed expert tensors vs CalaQwen **256×40 = 10 240**. Same 2 GB expert cache should **raise** hit well above 80.7%. That helps flash misses; it does **not** shrink MiB/tok if that counter is “bytes touched.”

**Dense / compute vs CalaQwen:**

- CalaQwen: 30 GDN + 10 full attn + 1 shared × 40 × 3.15M ≈ **126M** always-on FFN. Already 5.70 t/s.
- Instella: **27 Gated MLA** (no GDN) + **450M** always-on shared FFN (3.6× Cala shared) + 67M layer-0 FFN + 264M LM-head.
- MLA decode is matmul-shaped (our stack already does this). Shared-FFN 450M @ Q4 ≈ **253 MB extra DRAM traffic / tok** — this is the sleeper tax.

**Projected S23 decode:**

| variant | expected MiB/tok | bandwidth-scaled from Marco (454 MiB/s) | compute-adjusted | honest band |
|---|---:|---:|---|---|
| Vanilla Q4, streaming | ~90 | 454/90 ≈ **5.0 t/s** | MLA+450M shared pulls toward Cala | **4–6 t/s** |
| KEXP Q2/Q3, streaming | ~55 | 454/55 ≈ **8.3 t/s** | still heavier dense than Marco | **6–8.5 t/s** |
| KEXP + aggressive k-drop (k=4) | ~37 | ≈ **12 t/s** ceiling | compute floor remains | **7–10 t/s** (optimistic top) |
| Q2_K 6.51 GB **fits RAM** | n/a (DRAM) | 8–15 GB/s / ~0.7–0.9 GB active ≈ 10–20 theoretical | kernel+MLA+shared | **8–14 t/s** *if* it actually stays resident |

**Does it clear 10 t/s?** Only in the **optimistic** cells: RAM-resident Q2/KEXP, or brutal k-drop, and only if FarSkip is implemented correctly. Vanilla Q4 streaming: **no**. Our measured overhead says 10 t/s needs ≲45 MiB/tok *and* Marco-like compute. Instella is on the wrong side of both unless it fits RAM.

S23 8 GB reality: Q4_K_M **10.5 GB** must stream. Q2_K **6.51 GB** + KV + app is tight but is the only plausible 10 t/s path.

### 1.6 Verdict — Instella-MoE

**NOT_A_FIT**

**Single blocking issue:** ResearchRAIL — commercial use of a shipped app is outside the grant.

Secondary (would still matter if AMD relicensed tomorrow): no upstream llama.cpp; FarSkip is a new residual graph; multilingual untested; 10 t/s only in an optimistic RAM-resident/k-drop cell.

**Fail-fast (research-only, do not productize):** download [DevQuasar Q4_K_M](https://huggingface.co/DevQuasar/amd.Instella-MoE-16B-A3B-Think-GGUF) (10.5 GB) onto the **PR #26467 / `instella-moe` branch** — not master. PC `llama-cli` smoke + `gguf-dump` to confirm `n_routed=64`, `n_expert_used=6`, `n_shared=2`, `n_layer=27`, `expert_ffn=1408`. If dump matches config, stop. Do not spend S23 time until there is a license change.

---

## 2. Nemotron 3.5 Lightning (NVIDIA)

### 2.1 Architecture geometry

Primary: [BF16 `config.json`](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16/raw/main/config.json) + [BF16 card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16) + [NVFP4 card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4). Layer counts cross-checked against [Classmethod](https://dev.classmethod.jp/en/articles/dgx-spark-nemotron-3-5-lightning-first-touch/).

| quantity | value | note |
|---|---|---|
| `architectures` | `NemotronHForCausalLM` | |
| `model_type` | `nemotron_h` | GGUF arch **`nemotron_h_moe`** |
| total params | card **30B**; GGUF **33B** | 33B includes MTP head + rounding; AA cites 31.6B |
| active / token | card **3B**; AA **3.6B** | reconstruction below ≈ 3.2B |
| layers | **52** | `num_hidden_layers` |
| layer mix | **23 Mamba-2 + 23 MoE + 6 Attention** | from `layers_block_type` (counted) |
| hidden | **2688** | |
| expert FFN dim | **1856** | `moe_intermediate_size` |
| shared expert FFN dim | **3712** | `moe_shared_expert_intermediate_size` = 2× |
| routed experts | **128** | `n_routed_experts` |
| shared experts | **1** | always on |
| k | **6** | `num_experts_per_tok` |
| activation | **`relu2`** | `mlp_hidden_act` — **2 matrices / expert**, not SwiGLU |
| LatentMoE | **`moe_latent_size: null`** | DFlash blurb says “hybrid LatentMoE”; **this checkpoint is standard routed MoE**. Super-class LatentMoE is a different sibling. |
| attention | **GQA**, 32 heads / 2 KV, `head_dim=128` | only **6** layers; `sliding_window: null` |
| hybrid | **Mamba-2** 23 layers | `ssm_state_size=128`, `conv_kernel=4`, `mamba_num_heads=64`, `mamba_head_dim=64`, `expand=2`, `n_groups=8` |
| MTP | **1** next-n layer | `num_nextn_predict_layers=1`; `mtp_layers_block_type=["attention","moe"]` |
| context | config **262 144**; cards **1M** | Nano was 256K; Lightning advertises 1M (YaRN/rope not in this config — served ctx via engine) |
| vocab | **131 072** | untied |
| router | `routed_scaling_factor=2.5`, `norm_topk_prob=true` | |

**Expert size:**

```
params_per_routed_expert = 2 × 2688 × 1856 = 9,977,856   (relu2, 2-mat)
shared expert             = 2 × 2688 × 3712 = 19,955,712
```

Sanity: `23 × 128 × 9.98M ≈ 29.4B` routed + MTP MoE + Mamba/attn/embed ≈ **33B GGUF**. A 3-mat SwiGLU assumption would overshoot the file. **Use 2-mat.**

**Per-token routed expert params:**

```
23 × 6 × 9,977,856 = 1,376,944,128   (~1.38B)
shared always-on: 23 × 19,955,712     = 458,981,376   (~0.46B)
```

Mamba-2 always-on is ~0.9B (in_proj+out_proj+conv across 23 layers). Plus 6 GQA + 352M LM-head (`131072×2688`). That is why “3B active” and “3.6B active” both appear — depends whether you count Mamba/LM-head.

**This is CalaQwen’s problem with a bigger hammer:** hybrid recurrent layers on every other block, hidden 2688 vs Cala’s 2048, plus a 0.46B always-on shared FFN.

### 2.2 LICENSE — commercial OK

**Exact license:** [OpenMDW License Agreement v1.1](https://raw.githubusercontent.com/OpenMDW/OpenMDW/refs/heads/main/1.1/LICENSE.OpenMDW-1.1) (also <https://openmdw.ai/license/1-1/>).

This is **not** the older NVIDIA Open Model License. OpenMDW-1.1 grant:

- *“permission is hereby granted, free of charge, to deal in the Model Materials **without restriction**”* (copyright, patent, database, trade secret).
- Redistribution must **keep a copy of the agreement** and origin notices.
- Patent/copyright **lawsuit** against the materials terminates the grant.
- **No use restriction on outputs.**
- AS IS, you clear third-party rights.

Card: *“This model is ready for commercial use.”*

**For an app like ours: yes — redistribution of a quantized GGUF inside the APK is in-bounds if we ship the OpenMDW-1.1 text and notices.** Not a veto.

(Fastino’s finance/health fine-tunes of Lightning are separately Apache-2.0 — irrelevant to the base weights.)

### 2.3 llama.cpp support

| item | status |
|---|---|
| HF arch | `NemotronHForCausalLM` / `nemotron_h` |
| GGUF arch | **`nemotron_h_moe`** (official + bartowski) |
| Upstream | **Yes.** `nemotron_h` landed as [PR #15507](https://github.com/ggml-org/llama.cpp/pull/15507) (Nemotron-H family, 2025-08). MoE extension (`nemotron_h_moe`) has been running Nemotron 3 Nano 30B-A3B / Super 120B since late 2025–early 2026 ([issue #18064](https://github.com/ggml-org/llama.cpp/issues/18064), [discussion #20421](https://github.com/ggml-org/llama.cpp/discussions/20421)). Lightning is the same arch string. |
| Lightning-specific | NVIDIA card: run [`ggml-org` GGUF](https://huggingface.co/ggml-org/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF) on **llama.cpp latest**. Bartowski built with **[b10362](https://github.com/ggml-org/llama.cpp/releases/tag/b10362)**. DFlash draft: [PR #26905](https://github.com/ggml-org/llama.cpp/pull/26905). DSpark convert: [PR #26452](https://github.com/ggml-org/llama.cpp/pull/26452). MTP via `--spec-type draft-mtp`. |
| Official GGUF | **yes, downloadable today** |
| Distance from supported arch | **Zero.** Same `nemotron_h_moe` as Nano 30B-A3B. Our fork already has a path if we merged Nano/Super support; if not, it is a merge/port, not a new math graph. |

Caveat for *our* stack: expert streaming + k/drop + KEXP assume **standard routed expert tensors**. `relu2` 2-mat experts are a different kernel than SwiGLU 3-mat (Cala/Qwen/DeepSeek). llama.cpp already runs them; **KEXP requant recipes written for Qwen3.6 experts will need a 2-mat path.** Mamba-2 layers are **not** experts — they will not go through the streamer; they sit in the dense working set forever.

### 2.4 Quality / languages

NVIDIA harness (NeMo Gym), [BF16 card table](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16):

| task | Lightning | Qwen3.6 35B-A3B (Cala class) | Gemma4 26B-A4B | Nemotron 3 Nano |
|---|---:|---:|---:|---:|
| MMLU Pro | 81.94 | **85.63** | 85.20 | 78.46 |
| GPQA Diamond | 75.44 | **83.40** | 79.61 | 74.05 |
| SWE-bench Verified | 51.56 | **70.12** | 57.40 | 34.08 |
| IFBench (loose) | 71.88 | 63.71 | **77.25** | 72.17 |
| AA-LCR (long ctx) | 52.00 | **61.06** | 57.56 | 32.75 |
| PinchBench | 85.37 | **88.07** | 74.70 | 66.11 |

Recipes: <https://github.com/NVIDIA-NeMo/Gym/tree/main/nemotron_recipes/lightning-3.5/reproducibility.md>.

Reading: **slightly under CalaQwen-class** on knowledge/coding, **better IF than Qwen3.6**, large jump vs Nano on SWE/code. Vendor also claims Pareto wins on Artificial Analysis + 30% faster PinchBench completion vs Qwen3.6-35B ([developer blog](https://developer.nvidia.com/blog/nvidia-nemotron-3-5-lightning-delivers-fast-accurate-specialized-task-execution-for-long-running-agents/)) — that speed is **GPU + spec-dec**, not S23 CPU.

**Languages (card):** English + coding primary; **Spanish, French, German, Italian, Japanese** supported. Post-training text also lists **Chinese**. Pretrain includes 15-language Common Crawl (incl. Chinese). **IT/EN/ES/FR are first-class; ZH is present in data, not in the “supported languages” bullet.** Still better than Instella’s “untested.”

Thinking is template-gated (`enable_thinking=True/False`). Default ON thinks a lot (3–6× Nano tokens on the same prompt — [Classmethod](https://dev.classmethod.jp/en/articles/dgx-spark-nemotron-3-5-lightning-first-touch/)). For a 10 t/s *interactive* SKU we would ship thinking **off**.

### 2.5 Our math (S23)

Same assumptions as §1.5, plus:

- Expert is **2-mat relu2**.
- **23 Mamba-2 layers at h=2688 are always-on CPU work.** We do not have an Adreno Mamba kernel (GDN GPU work does not transfer).
- File will not fit S23 RAM: Q4_K_M **25.5 GB**, Q2_K **18.9 GB**. Must stream. No “fits in 8 GB” escape hatch.
- Q2–Q4 GGUF sizes barely move (18.8–25.5 GB) because Mamba/attn/embed stay fat. KEXP-on-experts only can shave the ~7 GB expert delta, not the 19 GB floor.

**Raw routed-expert params vs CalaQwen:**

```
Lightning / Cala = 1,377M / 755M = 1.82×
```

**Scaled MiB/tok (streaming, shared+Mamba resident):**

```
KEXP  ≈ 30.7 × 1.82 ≈ 56 MiB/tok
Q4    ≈ 56 × (4.5/2.75) ≈ 92 MiB/tok
```

Hit-rate: 128×23 = **2 944** expert tensors — better pool than Cala (10 240), worse than Instella (1 664). Expect hit between the two, maybe mid-70s to mid-80s.

**Compute vs CalaQwen (this is the verdict driver):**

CalaQwen is already **5.70 t/s** with 30 GDN layers at h=2048. Lightning has:

- 23× Mamba-2 at **h=2688** (SSM + conv1d + ~0.9B weights every token)
- 6× GQA (cheap — only 6 layers, and that is why KV is tiny)
- 0.46B shared FFN (≈ Instella shared)
- 0.35B LM-head (larger vocab×hidden than Instella)

Mamba-2 on Cortex-X3 is **not** cheaper than GDN. It is the same *class* of recurrence we have been trying to move off CPU. Projecting “CalaQwen 5.7 × (GDN cost / Mamba cost)” without a kernel is the honest move: **at or below Cala**, not above Marco.

Bandwidth-only (ignore compute): KEXP 454/56 ≈ **8.1 t/s**. We will **not** see that number on S23 CPU.

**Projected S23 decode:**

| variant | expected MiB/tok | BW-only (Marco 454 MiB/s) | compute-adjusted | honest band |
|---|---:|---:|---|---|
| Vanilla Q4 streaming | ~92 | ~4.9 t/s | Mamba-2 dominates | **2.5–4.5 t/s** |
| KEXP Q2/Q3 experts | ~56 | ~8.1 t/s | Mamba+shared still resident | **3–5.5 t/s** |
| KEXP + k-drop k=4 | ~37 | ~12 t/s ceiling | compute floor barely moves | **3.5–6 t/s** |
| + GPU Mamba (we do not have) | — | — | would reopen the case | out of scope |

**Does it clear 10 t/s on S23?** **No.** Not with CPU Mamba-2. Spec-dec (MTP/DSpark/DFlash) is a GPU/datacenter story; DSpark is a 967M extra model we will not run on 8 GB. Thinking-off helps tokens-to-answer, not tok/s of the decode loop.

### 2.6 Verdict — Nemotron 3.5 Lightning

**CANDIDATE_MAYBE**

Not `STRONG`: it will not beat 10 t/s on S23 with current machinery, and quality sits a notch under CalaQwen on the metrics we care about for a “big” SKU.

Not `NOT_A_FIT`: license is clean, llama.cpp is real, official GGUF exists today, expert geometry is streamable (128 experts / k=6 / 23 MoE layers), IT/ES/FR are listed, thinking can be turned off.

**Single blocking issue for the 10 t/s target:** hybrid **Mamba-2 × 23** on S23 CPU (plus a 19 GB non-expert floor that will not fit RAM). License/arch are not the block.

**Fail-fast:** download official [`ggml-org` Q4_K_M](https://huggingface.co/ggml-org/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF) (25.4 GB) — or bartowski Q4_K_S 23.2 GB if we want a slightly smaller smoke. PC: `llama-cli` / `llama-server` on **b10362+**, `gguf-dump` confirm `nemotron_h_moe`, `n_expert=128`, `n_expert_used=6`, `n_layer=52`, MoE/Mamba/Attn split. If dump matches, a **short S23 stream trial** (not a campaign) is enough to kill or keep: expect Cala-or-worse t/s. If S23 lands ≥6 t/s thinking-off we can talk; if it lands ~3 t/s, close the card.

---

## Comparison

Geometry vs our CalaQwen reference (all numbers from the cited `config.json` files):

| | **CalaQwen (shipped)** | **Instella-MoE** | **Lightning 3.5** |
|---|---|---|---|
| HF | Qwen3.6-35B-A3B | amd/Instella-MoE-16B-A3B-Think | nvidia/…Lightning-30B-A3B-BF16 |
| total / active | 35B / 3B | 16B / 2.8B | 30–33B / 3–3.6B |
| layers | 40 (30 GDN + 10 attn), MoE every layer | 27 MLA (1 dense FFN + 26 MoE) | 52 = 23 Mamba-2 + 23 MoE + 6 attn |
| hidden | 2048 | 2048 | **2688** |
| experts / k / shared | 256 / 8 (we run 6) / 1 | 64 / 6 / **2** | 128 / 6 / 1 |
| expert FFN dim | **512** | **1408** | **1856** |
| expert params | 3.15M (SwiGLU) | 8.65M (SwiGLU) | 9.98M (relu2 2-mat) |
| routed params / tok @k=6 | 0.76B | 1.35B | 1.38B |
| always-on extra FFN | 0.13B | **0.45B** | **0.46B** |
| attn / hybrid | GDN + gated attn | Gated MLA only | Mamba-2 + GQA |
| ctx / vocab | 256K / 248k | 32–64K / 129k | 256K–1M / 131k |
| license | (our Qwen path) | **ResearchRAIL — VETO** | **OpenMDW-1.1 — OK** |
| llama.cpp | yes (our fork) | **PR #26467 open** | **yes, official GGUF** |
| IT/EN/ES/FR/ZH | strong (Qwen) | **untested** | EN+IT/ES/FR listed; ZH in data |
| vs Qwen3.5-4B class | well above | above (vendor OLMES) | well above (MMLU-Pro 82) |
| vs CalaQwen class | = | below | slightly below knowledge/SWE |
| Q4 GGUF size | (our KEXP 35B) | 10.5 GB (fork) | **25.4 GB official** |
| Q2 GGUF size | — | **6.51 GB** (could fit 8 GB) | **18.9 GB** (cannot fit) |
| S23 vanilla Q4 | — | **4–6 t/s** | **2.5–4.5 t/s** |
| S23 KEXP | **5.70** measured | **6–8.5** (8–14 if RAM-fit) | **3–5.5** |
| **≥10 t/s S23?** | no (5.70) | only optimistic RAM-fit / k-drop | **no** |
| **verdict** | shipped | **NOT_A_FIT** | **CANDIDATE_MAYBE** |

### Target question

**Can either exceed 10 tok/s on S23 with our machinery?**

- **Instella-MoE:** geometrically the only one with a *path* (small file, no SSM, MLA). That path is blocked by **license**, and even then 10 t/s is an optimistic RAM-resident/k-drop number, not the vanilla-Q4 number.
- **Lightning:** **no.** Expert stream looks like 1.8× CalaQwen; the Mamba-2 body looks like CalaQwen’s compute tax or worse; the file cannot fit. Official GGUF + OpenMDW make it worth a **PC + one S23 smoke**, not a lineup slot.

Do not confuse NVIDIA’s 80–115 t/s DGX Spark numbers (NVFP4 + DSpark + Mamba GPU kernels) with S23 CPU.

---

## Sources (load-bearing)

**Instella**

- <https://huggingface.co/amd/Instella-MoE-16B-A3B-Think>
- <https://huggingface.co/amd/Instella-MoE-16B-A3B-Think/raw/main/config.json>
- <https://huggingface.co/amd/Instella-MoE-16B-A3B-Think/raw/main/LICENSE>
- <https://huggingface.co/collections/amd/instella-moe>
- <https://rocm.blogs.amd.com/artificial-intelligence/instella-moe/README.html>
- <https://github.com/AMD-AGI/Instella-MoE>
- <https://github.com/ggml-org/llama.cpp/pull/26467>
- <https://huggingface.co/DevQuasar/amd.Instella-MoE-16B-A3B-Think-GGUF>
- <https://huggingface.co/kingjones777/Instella-MoE-16B-A3B-Think-Q4_0_ROCMFP4_STRIX-GGUF>
- Historical license: <https://huggingface.co/amd/Instella-3B-Instruct>

**Lightning**

- <https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16>
- <https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16/raw/main/config.json>
- <https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4>
- <https://huggingface.co/ggml-org/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF>
- <https://huggingface.co/bartowski/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF>
- <https://raw.githubusercontent.com/OpenMDW/OpenMDW/refs/heads/main/1.1/LICENSE.OpenMDW-1.1>
- <https://developer.nvidia.com/blog/nvidia-nemotron-3-5-lightning-delivers-fast-accurate-specialized-task-execution-for-long-running-agents/>
- <https://blogs.nvidia.com/blog/nemotron-lightning-switchyard-rtx-dgx/>
- <https://github.com/ggml-org/llama.cpp/pull/15507>
- <https://github.com/ggml-org/llama.cpp/pull/26905>
- <https://github.com/ggml-org/llama.cpp/releases/tag/b10362>
- Nano vs Lightning geometry: <https://dev.classmethod.jp/en/articles/dgx-spark-nemotron-3-5-lightning-first-touch/>

**CalaQwen geometry (scaling baseline)**

- <https://huggingface.co/Qwen/Qwen3.6-35B-A3B/raw/main/config.json>
- <https://huggingface.co/Qwen/Qwen3.6-35B-A3B>

DONE
