# Novelty web-sweep round 4 — F (stateless draft) and G (phase-asymmetric expert drop)

**Date:** 2026-08-15  
**Bar:** "nobody has even TRIED it". False NOVEL wastes days.  
**Neither candidate clears the bar.** F sits inside a 2024–2026 literature that already exists *because* hybrid/SSM state cannot rewind. G's question ("different expert-drop policy per phase?") is already **yes** — and the published direction is the *opposite* of G.

Companion to `report.md` (A–C), `report2.md` (D–E), `report3.md` (K–M).

---

## Candidate F — "Stateless drafting": freeze recurrent path in the DRAFT on hybrid (attn+GDN/SSM) models

### Verdict: **NEAR-DUPLICATE (Component-Aware SSD + LayerSkip + SSM spec-dec family)**

The rewind problem is **known and solved several ways**. Self-speculation that **isolates one hybrid subgraph as the draft** is published (May 2026). F is the **complementary subgraph** (attention on, recurrent frozen) of that paper. Not "nobody thought to change what the draft does to the recurrent state."

### What the candidate is

On hybrids, `llama_memory_seq_rm` rewinds attention KV; GDN/Mamba-class state **cannot** rewind to arbitrary positions. Self-spec draft/rollback produces "phantom prefix" (reproduced).

**Draft:** attention layers run normally; **recurrent layers' state is frozen** at the last *verified* position (output from frozen state, or skip/approximate).  
**Verify:** full model.  
**On reject:** nothing recurrent to rewind, by construction. Draft also cheaper.

Must distinguish from LayerSkip / Draft&Verify (speed skip on uniform transformers), Jakiro/Medusa, and find exactly how 2024–2026 Mamba spec-dec handles rewind.

### How the field actually handles SSM rewind (2024–2026)

Everyone agrees: *SSM state is irreversible; speculative reject needs a rollback story.* Nobody in this list **freezes the recurrent path in the draft**. They still **run** the recurrence and then undo it:

| System | What they do on reject | URL |
|---|---|---|
| **vLLM (current hybrid spec)** | Snapshot a **full SSM state per draft token**; restore last accepted | documented in ReplaySSM §2.2 and SGLang blog |
| **SGLang hybrid** | **One independent Mamba cache slot per draft token**; promote last accepted slot | https://pytorch.org/blog/hybrid-models-meet-sglang-more-than-full-attention/ |
| **Mamba-in-the-Llama** (Wang, Paliotta, May, Rush, Dao; NeurIPS 2024) | Hardware-aware **multi-step** linear-RNN spec; keep **one** RNN state for verify, advance lazily. They state the problem: rewind would need all \(h_{1:t}\) | https://www.together.ai/blog/the-mamba-in-the-llama-distilling-and-accelerating-hybrid-models · arXiv:2408.15237 |
| **STree** (Wu, Qin, Wong, Soatto; NeurIPS 2025 / arXiv:2505.14969) | Tree spec for SSM/hybrids via accumulated **tree transition matrices** \(A_{tree}\); still computes SSM on the tree | https://arxiv.org/abs/2505.14969 |
| **ReplaySSM** (Li, Dao et al.; Jun 2026) | Cache **recent SSM inputs**, not state. Rollback = **pointer move** on the input buffer. Draft/verify still **use** the recurrence (output-only form). vLLM, GDN + Mamba-2 | https://tridao.me/blog/2026/replayssm/ |
| **Wu et al. 2024 "Activation Replay" / JAA** | Two SSM spec methods: Joint Attainment and Advancement, Activation Replay | https://raw.githubusercontent.com/mlresearch/v262/main/assets/wu24a/wu24a.pdf |
| **Mamba Drafters** (Choi et al., EMNLP 2025 Findings) | **External** Mamba as drafter for a Transformer target — different model, not freeze-internal-SSM | https://aclanthology.org/2025.findings-emnlp.1167.pdf · arXiv:2506.01206 |

Alibaba/SGLang write-up: "Using **state snapshotting**, it addresses Mamba's non-reversible limitation."  
https://www.alibabacloud.com/blog/hybrid-model-support-%7C-sglangs-support-scheme-for-hybrid-architecture-models-like-mamba-transformer_602857

**None of the above skip or freeze the recurrent path in the draft.** They pay for correctness by snapshot / extra slots / input replay / tree algebra.

### The paper that isolates a hybrid *component* as the draft

**Component-Aware Self-Speculative Decoding in Hybrid Language Models** (Borobia, Seguí-Mas, Tormo-Carbó; arXiv:2605.01106, 1 May 2026).  
https://arxiv.org/abs/2605.01106 · HTML: https://arxiv.org/html/2605.01106v1 · code: https://github.com/hecboar/hybrid-speculative-decoding

This is the closest *self-spec-on-hybrids* work. It is **not** F; it is F's **mirror**.

- Draft = **SSM / linear-attention subgraph only**. Attention is **zeroed (parallel Falcon-H1)** or **identity-skipped (sequential Qwen3.5 GDN)**.  
- Verify = full hybrid.  
- Zero extra params, no training.  
- Sequential hybrids (Qwen3.5 — the same GDN+attn interleave as the llama.cpp bug): SSM-only draft **fails** (\(\alpha=0.038\) at \(k=2\)). LayerSkip is 12× better. Parallel Falcon-H1 works (\(\alpha=0.68\)).  
- They explicitly say prior SSM spec-dec (Mamba Drafters, STree, RAD) uses **external** drafters or distillation; they are first to isolate an **internal** hybrid component as draft.

**F is the complementary isolation:** attention on, recurrent **frozen** (or skipped). They studied "SSM-only"; they did **not** study "attention-only + frozen GDN." Their own ablation says Qwen3.5 **depends on attention** (PPL ×82 if attention is removed), so an *attention-on* draft might accept better than SSM-only — that is the experiment they left on the table, motivated here by rewind, not by PPL.

**LayerSkip / CLaSp / SWIFT** — skip layers for speed on **homogeneous** transformers. On a sequential hybrid, skipping *all* GDN layers in the draft would *accidentally* look like F for those layers; they do not freeze residual GDN state at the last verified token as a rollback contract. LayerSkip's goal is FLOPs, not "make `llama_memory_seq_rm` correct."

**Jakiro / Medusa / MTP** — extra heads; Nemotron-3 MTP still needs an SSM rollback story (ReplaySSM §1).

### Three closest works (one line each)

| Work | How it differs from F |
|---|---|
| **Component-Aware SSD** https://arxiv.org/abs/2605.01106 | Same *move* (self-spec by isolating one hybrid subgraph). They **run SSM, suppress attention**. F **runs attention, freezes SSM**. Sequential-hybrid result: their polarity fails; yours is the untried polarity. |
| **ReplaySSM / SGLang / vLLM snapshots** https://tridao.me/blog/2026/replayssm/ | Same *problem* (cannot rewind GDN/Mamba). Solution is **still run recurrence in draft**, then undo via input-buffer / per-token slots / full-state copies. |
| **LayerSkip** https://arxiv.org/abs/2404.16710 | Skip layers in draft for speed on uniform stacks. Not a freeze-at-last-verified-state contract for recurrent layers. |

### Remaining sliver (do not treat as NOVEL)

**Attention-normal + recurrent-frozen-at-last-commit draft**, so reject is a KV `seq_rm` only. That polarity is unpublished. The *problem* and the *family* (change the draft's hybrid subgraph; or keep a rewindable SSM representation) are crowded. A reviewer will write "Component-Aware §3 with the other branch gated, motivated by ReplaySSM §2.2." If you still build it, the first plot is acceptance on Qwen3.5 vs their SSM-only numbers — they already predicted attention-only should be the *better* draft on sequential hybrids.

### Search queries run (F)

- `speculative decoding Mamba SSM hybrid attention state rollback rewind`
- `"speculative" draft skip OR freeze OR frozen Mamba OR SSM OR GDN OR "recurrent" hybrid LayerSkip`
- `STree speculative tree decoding hybrid state space Mamba-in-the-Llama state rewind checkpoint`
- Plus fetches: ReplaySSM blog, Component-Aware HTML 2605.01106

---

## Candidate G — Phase-asymmetric expert pruning: heavy drop in PREFILL, certified drop in decode

### Verdict: **KNOWN** (phase-asymmetric expert policy exists) / **NEAR-DUPLICATE (XShare + SERE + DyMoE)**

**Novelty question, answered literally:** yes. Multiple 2025–2026 systems use **different expert-count / drop rules in prefill vs decode**.

**G's polarity is the opposite of the published finding.** XShare/vLLM: prune **decode only**; **do not prune prefill** because it **corrupts KV** (MMLU-Pro 51.3% → 26.9%). SERE: a decode-only skip **underperformed** applying skip in both phases (distribution shift). G wants *more* aggressive drop in prefill. That is a disputed empirical claim, not an untried idea.

### What the candidate is

Prefill on streamed MoE is near-dense (batch touches most experts) → TTFT bandwidth-bound. Decode already has a quality-gated weight-threshold drop.

**Prefill:** much more aggressive drop (e.g. top-2-by-weight only) to cut TTFT ~proportionally.  
**Decode:** keep the certified threshold.  
KV from pruned-FFN prefill is slightly noisy; quality gated E2E.

Distinguish from AdapMoE (uniform adaptive skip), HOBBIT (precision, not phase), KV compression.

### What prior art actually does

**XShare + vLLM RFC — explicit phase gate, decode-only prune.**  
Paper: https://arxiv.org/abs/2602.07265 · HTML: https://arxiv.org/html/2602.07265v1  
vLLM issue: https://github.com/vllm-project/vllm/issues/35550 (27 Feb 2026; closed stale)

- Batch-aware expert mask **before** top-k; fused kernel never loads masked experts.  
- Paper § "Decoding Phase Focus": methods **target decode**; prefill already has high expert activation from token diversity.  
- vLLM implementation, **quoted**:

  > **Critical constraint: decode-only.** Pruning during prefill corrupts the KV cache. Every prompt token is routed through an incomplete expert set, producing corrupted representations that cascade through the sequence. In our tests, **prefill pruning dropped MMLU-Pro from 51.3% to 26.9%**. Restricting pruning to decode preserves quality completely.

- Gating: `max_batch` heuristic or `max_query_len` so prefill (long query) skips pruning, decode fires.  
They **proposed, implemented, quality-gated, and rejected G's polarity.**

**SERE** (Wu et al., arXiv:2602.07616) — similarity re-route / skip.  
https://arxiv.org/pdf/2602.07616  

Appendix C.2 + Table 13: **decode-only** variant (all experts in prefill, re-route only in decode) **consistently underperforms** applying SERE in **both** phases. They attribute it to **prefill/decode expert inconsistency → KV / representation shift**. Same object as G (phase-split expert policy), opposite lesson (don't leave the phases inconsistent in the "safe" direction either — or at least their safe direction lost).

**DyMoE** (arXiv:2603.19172, report.md / A).  
**Different importance estimators per phase:** prefill = token-guided (heavy-hitter load); decode = gate score. Precision / skip then follow those scores. That is already **phase-asymmetric expert policy**, even if not "top-2 in prefill / certified-k in decode."

**AdapMoE** (arXiv:2408.10284) — adaptive \(k\) (usually 2→1) from top-1 mass × layer Fisher. **Same rule both phases.** Contrast as requested.

**HOBBIT** — mixed-precision load on miss from router weight. Not phase-split.

**NAEE / "Not All Experts are Equal"** (Lu et al., 2024) — skip the secondary Mixtral expert when its gate is small. Uniform across phases unless the implementation happens to differ (not advertised).

**Targeted Pruning for Prefill-Decode Disaggregation** (arXiv:2509.04467) — **different blocks / KV pruned for prefill vs decode**, but on **dense** LLaMA, not MoE experts. Same *phase-asymmetric compression* idea, different object.

**Layered prefill** (MLSys 2026 session notes) — chunked prefill **reloads** MoE experts (up to +39% traffic); they change **scheduling**, not drop-k.

**Read-ME** (NeurIPS 2024) — notes prefill activates more experts per batch than decode. Observation, not a dual-threshold policy.

### Three closest works (one line each)

| Work | How it differs from G |
|---|---|
| **XShare / vLLM #35550** https://arxiv.org/abs/2602.07265 · https://github.com/vllm-project/vllm/issues/35550 | **Same question** (different expert budget per phase). They **forbid** prefill prune (KV poison, −24 pt MMLU) and prune **decode**. G inverts the polarity. |
| **SERE decode-only ablation** https://arxiv.org/pdf/2602.07616 | Tested phase-split skip; **decode-only lost** to skip-in-both because of prefill/decode mismatch. Again: the experiment exists. |
| **DyMoE** https://arxiv.org/abs/2603.19172 | Prefill vs decode **already use different expert-importance rules** (token-load vs gate). Not "top-2 prefill / certified decode," but phase-asymmetric MoE policy is shipped. |

### Remaining sliver (do not treat as NOVEL)

**Aggressive prefill-only top-2** on a *streamed on-device* MoE where TTFT is flash I/O, with an E2E quality gate that *accepts* noisy KV. XShare's 51→27 result is the prior that must be beaten, not ignored. A reviewer will say "XShare already phase-gated expert drop; you flipped the bit and need to show their KV-corruption result is false on your engine." That is an empirical fight, not a novelty claim.

### Search queries run (G)

- `prefill decode different top-k OR "prefill" expert pruning OR "phase-aware" MoE inference skip`
- `DyMoE OR AdapMoE prefill decode different experts OR "prefill" "decode" "top-2" MoE skip`
- `XShare Batch-Aware Expert Selection 2602.07265 prefill decode`
- Plus fetch: vLLM #35550

---

## Cross-check

| System | F (freeze recurrent in draft) | G (prefill vs decode expert drop) |
|---|---|---|
| LayerSkip / CLaSp / SWIFT | skip layers, not freeze GDN at last commit | n/a |
| Component-Aware SSD 2026 | **SSM-only draft** (mirror of F) | n/a |
| ReplaySSM / SGLang / vLLM hybrid spec | run SSM, rewind via buffer/slots/snapshots | n/a |
| STree / Mamba-in-the-Llama / Mamba Drafters | run SSM (tree / multi-step / external) | n/a |
| AdapMoE | n/a | **same** adaptive \(k\) both phases |
| HOBBIT / DyMoE | n/a | DyMoE: **phase-different scoring** |
| XShare / vLLM #35550 | n/a | **YES — decode prune, prefill full** |
| SERE | n/a | tested decode-only vs both |
| Medusa / Jakiro / MTP | extra heads; still need SSM rewind | n/a |

---

## Bottom line

| Candidate | Verdict | One-sentence reason |
|---|---|---|
| **F Stateless drafting** | **NEAR-DUPLICATE (Component-Aware SSD + ReplaySSM/SGLang family)** | Hybrid spec-dec exists *because* SSM cannot rewind. Self-spec by isolating a hybrid branch is published (they froze **attention**). F freezes the **other** branch. |
| **G Phase-asymmetric expert drop** | **KNOWN / NEAR-DUPLICATE (XShare)** | Different prefill vs decode expert budgets are proposed, implemented, and quality-gated. Published polarity: **do not** drop in prefill. |

**Do not schedule either as "nobody tried it."**  
If something still ships: F is a one-week ablation on Qwen3.5 against arXiv:2605.01106 (attention-only draft acceptance + does `seq_rm` stay clean). G is a quality fight with XShare's −24 pt MMLU — run that table on-device before writing a kernel.

DONE
