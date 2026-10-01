# AUDIT — Kalsa MoE prune plan + coordinator amendments a–d (2026-10-01)

Auditor: Fable 5.1, hostile, critique only. One file written (this one); no git command run.

Read in the lab: `DESIGN.md`; `moe-expert-usage-v3/{REPORT,AUDIT}.md`; `moe-keepset-128/{REPORT,AUDIT}.md`;
`kalsa-reap-prep/{PHASE0-CALIB,PHASE0-EVALS,AUDIT-PHASE0-EVALS,REPORT}.md`, `docs/{PARAM-BUDGET,EVAL-GATE,EVIDENCE}.md`,
`podprobe/env.sh`, `eval/run_*.py`, `patches/moep-domain-normmax.patch`; `razor-italian-loss/REPORT.md`;
`results/gate_probe_a40_2026-10-01/REPORT.md`; `PLAN.md` Kalsa-MoE entry; `docs/ALIVE.md`.
Verified online today (abstract and, where cited, HTML): arXiv 2510.13999, 2607.16721, 2605.28042, 2507.23279,
2609.30465, 2609.04575, 2410.12013, 2605.28207, 2608.21693, 2603.06003, 2609.18916, 2408.11796; HF
`unsloth/Qwen3.6-35B-A3B-GGUF` and `-MTP-GGUF` trees, `crucible-labs/Qwen3.6-35B-A3B-REAP-48-v2-GGUF`,
`anik-jha/Qwen3.6-35B-A3B-coding-reap50-GGUF`, `anik-jha/…-reap25-healed-GGUF`, `cerebras/cerebras-reap` collection,
`Qwen/Qwen3.6-35B-A3B` config, `CohereLabs/Global-MMLU-Lite`; BFCL README + v3 blog; Unsloth faster-moe doc;
Runpod live price list (MCP). **The r/LocalLLaMA thread could not be located** (two searches): its four claims are
treated as unverified anecdotes and checked against published numbers instead. Every id and repo above exists.

Evidence labels: **CONFIRMED** (quoted source), **PLAUSIBLE** (consistent, unmeasured), **REFUTED**.
Prices used: Runpod secure A100 80 GB $1.59/h (community $1.39), A40 $0.49/h, H100 SXM $3.49/h (read 2026-10-01).

---

## 0. Ranked findings

| # | sev | finding | verdict |
|---|---|---|---|
| F1 | **blocker** | The gate cannot see the failure the thread describes. No knowledge/MC eval (REAP: MC −21.8 pt at 50 % on Qwen3-30B-A3B), no multi-turn, no loop count. S1 as written passes an arm that lost 15 HE+ points and +29 % IT bpb. | CONFIRMED |
| F2 | **blocker** | Amendment (b) "healing MANDATORY ≤ $20": full FT is $50–60; LoRA-KD with cached logits is $20–34 incl. re-gate. "Mandatory" contradicts S3; no data, loss, token budget or re-gate is specified. | CONFIRMED (cost) / PLAUSIBLE (recovery) |
| F3 | high | The plan drops the MTP head (`--no-mtp`). llama.cpp has native MTP for Qwen3.6-35B-A3B (PR #22673, May 2026; 1.5–2× decode). The MTP head carries its own 256 experts and is prunable with the same keep-set at +0.20–0.25 GB. The speed-floor gate the probe failed (0.39–0.45× LFM) is exactly what this moves. | CONFIRMED (support) / PLAUSIBLE (prunable) |
| F4 | high | calib-v2 is raw text: zero chat-template tokens, zero `<think>` traces, tool dialogues only as code top-up. A thinking model is being pruned on a distribution that never contains its reasoning tokens. crucible-labs v2: chat-template rendering cut KL to f16 by 42.5 %. | CONFIRMED |
| F5 | high | Same-GB rival: at ≤ 11 GB it is UD-IQ2_XXS (10.8 GB, experts ≈ 2.27 bpw); at ≤ 8.7 GB **no unpruned artifact exists** (UD-IQ1_M is 10.0 GB; 8.7 GB needs 1.74-bpw experts). The thread's "q3 > reap q4" is a 15–17 GB comparison Kalsa cannot make. S3 stays for PC; the phone arm has no quant rival. | CONFIRMED |
| F6 | medium | Criterion: "REAP beats mass at both depths" is HE+ 0.896 vs 0.872 at 50 % (no CI; paper calls mass "competitive"); on translation mass+dynamic beat REAP+uniform 0.844 vs 0.801 (Qwen3-30B-A3B). For a language product the criterion is open. | CONFIRMED |
| F7 | medium | Super-Expert guard: an accumulator exists (`norm_max`), a rule does not (no threshold, no layer set). SE paper covers softmax-attention MoEs only; nothing on hybrid GDN. | CONFIRMED |
| F8 | medium | Budget: phase 1 + a–d realistically $80–95, not $35–45. Per-arm wall depends on `PROBE_SLOTS`; space-bunny B1–B4 fixes are uncommitted (`check_stop_rule.py` +90/−33 in the working tree). | CONFIRMED |
| F9 | medium | 2605.28042 is cited for the LoRA heal; its recovery is full fine-tuning and it says PEFT is insufficient. | CONFIRMED (misattribution) |
| F10 | low | Per-layer allocation: our proxy says +0.3–1.1 pp; EvoESAP reports up to +19.6 % MATH-500 at 50 % with a searched allocation; HOPE +6.1 % agentic coding over REAP. The mass proxy cannot see either. | PLAUSIBLE |
| F11 | low | Amendment (d): cerebras has **no** Qwen3.6 REAP. The real public references are crucible-labs REAP-48-v2, anik-jha coding-reap50 and reap25-healed — all code-calibrated, so they will fail IT like RAZOR did. They prove the calibration thesis, not the plan. | CONFIRMED |

---

## 1. Is 128/256 defensible? (Q1)

**What is published at 50 % for this family — all quoted today:**

- Same base, code calibration (2607.16721 Table 2, Qwen3.6-35B-A3B, 70/30 code/general): 50 % keep → HE+ 0.890→0.896,
  MBPP+ 0.772→0.728, code ppl 5.38→5.49, **general ppl 5.20→12.00 ("increase of 131%")**; 25 % keep → general ppl 30.92.
  §5.4: a random-50 prune "scores *better* held-out code perplexity than the base model (4.82 versus 5.38) while losing
  57.9 points of pass@1".
- Qwen3-30B-A3B (128 experts, coarser), REAP 50 %, C4+evol calibration (2510.13999 Table 2): code avg 0.558→0.541,
  math avg 0.887→0.857, **creative writing 0.811→0.718, MC average 0.721→0.503**. Large models: Kimi-K2 tool-use
  0.666→0.564; Qwen3-Coder-480B tool-use 0.690→0.674, SWE-bench 0.540→0.522. "All models are evaluated in the one-shot
  setting, with no additional fine-tuning after compression." No multilingual evaluation anywhere in the paper.
- Translation (2605.28042, GPT-OSS-20B primary, Qwen3-30B-A3B secondary): 50 % no-retrain FLORES xCOMET .942→.930,
  62.5 % → .896; Qwen3-30B-A3B at 50 %: "Routing-mass + Dynamic .844 … REAP + Uniform .801".
- Public artifact on this base, 48 % pruned, code/chat calibration (crucible-labs v2): HE+ 90.9 %, MBPP+ 75.7 %,
  BFCL-simple 93.2 %, mean KL 0.0196 vs f16 (text unspecified), 8.78 GiB.
- The only multilingual number on this exact base is ours: RAZOR-19B (50 %, EN-heavy calibration) IT bpb 1.462 vs
  0.580 (`gate_probe_a40_2026-10-01/REPORT.md`), with a keep-set that is a random half for IT/FR/ES (v3, p = 0.28/1.00/0.71).

**Reading.** The thread's "much dumber than a smaller quant" is the MC-average and general-ppl rows, not the code rows:
every published 50 % result holds code and loses 10–22 points of knowledge/open-ended quality. Nothing published
measures a 50 % prune on five languages with a balanced calibration; our proxy (85–90 % of language mass, 70 % code,
content-disjoint) is the only evidence and it is a routing proxy whose dynamic range starts at 50 % (`v3/AUDIT.md` F10).
Qwen3.6's 256-way granularity cuts both ways: more redundancy per layer, and a hybrid GDN trunk no pruning paper has
characterised (2608.21693 does cover hybrid linear-attention MoEs and finds "expert pruning is the dominant degradation
source" and that composition "cannot be predicted from standalone techniques").

**Verdict: 128 is defensible as the hypothesis of a $30 experiment, not as a build target.** 160 remains the stronger prior
for the PC (k128: "128 never dominates 160"; 160@IQ3_S fits 10.5 GB); 128 is forced only by the 8.7 GB phone arm.
Keep 128 primary *because the phone needs it*, keep 160@IQ3_S as the PC favourite, and make the gate able to see
"dumber" (F1). Cost of the change: $0 — the arms are already nested.

---

## 2. Same-GB rival arithmetic (Q2)

`bytes(K, b_e) = 40·K·3,145,728·b_e/8 + 2,448,355,968·5.5/8`, trunk fixed at 1.68 GB (DESIGN §2.1, re-computed):

| target | pruned arm | GB | unpruned at the same GB | experts bpw of the unpruned |
|---|---|---:|---|---:|
| PC ≤ 11 GB | 128 @ Q4_0 (4.5) | 10.74 | UD-IQ2_XXS **10.8 GB** (tree read today) | (10.8−1.68)·8/32.21 = **2.27** |
| PC ≤ 10.5 GB | 160 @ IQ3_S (3.5) | 10.49 | UD-IQ1_M **10.0 GB** only | 2.07 |
| phone ≤ 8.7 GB | 128 @ IQ3_S (3.5) | 8.73 | **none exists**; would need | (8.7−1.68)·8/32.21 = **1.74** (IQ1_S class) |
| with pruned MTP | +441,987,584 params | +0.20–0.25 | UD-IQ2_XXS-MTP is **11.8 GB** (over budget) | — |

Same-base published equal-memory rows (2607.16721 Table 5): pruned-50 Q4 11.4 GB HE+ 0.902 / MBPP+ 0.720;
pruned-50 Q5 13.3 GB 0.915 / 0.749; base IQ2_M 13.0 GB 0.896 / 0.730; base Q2_K 13.5 GB 0.848 / 0.754;
base Q3_K_M 17.1 GB 0.890 / 0.775. The paper's own rule: pruning wins "only when quantization would drop below 3 bits
per weight". The Kalsa rival sits at 2.27 bpw experts (below IQ2_M, which already only ties), so **on code the prune should
win at 10.8 GB**. On the languages it is a coin flip: the rival keeps 100 % of the experts at ~2.2 bpw (dense Qwen3.8-27B
IQ2_XXS KLD 0.283 ≈ +0.09 bpb by DESIGN's own conversion) versus the prune keeping 85–90 % of mass at 4.5 bpw
(DESIGN band +0.04–0.10 bpb). **The thread's "q3 > reap q4" is true and irrelevant**: Q3_K_M of the full model is 17.1 GB.

**What the prune must add to win when it is close:** (1) MTP kept (F3) — the 11.8 GB MTP rival does not fit, so a pruned
model with MTP is the only ≤ 11 GB artifact with 1.5–2× decode; (2) calibration/imatrix on the serving distribution (F4);
(3) the heal (b) — only if (1)+(2) still leave a measured gap; (4) trunk at Q6 not Q5 costs 0.15 GB and is free quality.
S3 needs a definition of "beats": **paired-CI wins on IT bpb and HE+ both, plus a majority of the remaining metrics**; today
it is a word.

---

## 3. KD healing: feasibility and evidence (Q3)

**Memory.** Student 18.56 B params = 37.1 GB BF16. Teacher 34.66 B text params = 69.3 GB BF16: **an online teacher does not
fit beside the student on one 80 GB GPU** (FP8 teacher 35 GB + student 37 GB + activations > 80 GB). So either a second
GPU (+$1.59/h) or **cached top-k logits** (top-64 × (bf16 + int32) = 384 B/token; 45 M tokens → 17 GB on the volume). Cached
is the only version that fits "one A100".

**Trainable sets.** (i) Router full + LoRA r64 on attention/GDN/shared (2607.16721 recipe: "0.86 % of the model",
"routed experts stay exactly frozen"): fits with room. (ii) + LoRA on the fused 3-D expert tensors: Unsloth's grouped-GEMM
kernels do target `gate_up_proj`/`down_proj` (faster-moe doc, Qwen3-30B-A3B bf16 LoRA 4 K ctx = 80.9 GB on H100 for the
*full* 30B; our 18.6 B student ≈ 50 GB). Qwen3.5/3.6-MoE support in Unsloth is claimed in their Qwen3.5 guide
("bf16 LoRA works on 74GB VRAM" for 35B-A3B), not in the faster-moe list — verify on the pod before relying on it.
(iii) Full FT: 37 + 37 + 148 GB (fp32 Adam) → 4 × 80 GB with ZeRO-3, $6.4/h; 2605.28042 used exactly this
("we do full fine-tuning as parameter-efficient methods are insufficient to recover entire pruned parameter blocks",
10 k synthetic examples, 3 epochs, 4 × A6000, lr 1e-5).

**Throughput and tokens (A100, estimate).** Training ≈ 6 × 3.3 B active ≈ 20 GFLOP/token; at 20–30 % MFU → 2–4 k tok/s
with grouped GEMM. 2607.16721's heal (1,863 sequences, ≈ 4–7 M tokens, "under three hours" on a DGX Spark) is the only
same-base datum: it recovered **52 % of the HE+ gap, 23 % of MBPP+, general ppl 30.9 → 9.4 at 25 % keep** — with sequence-
level SFT on teacher answers, not logit KD. Logit-KD evidence for expert pruning: MoE-Pruner (weight sparsity on Mixtral,
"99 % of the performance … after the expert-wise knowledge distillation", tokens unstated); MoE→dense (2605.28207) needs
≈ 4 B tokens — 100× our budget and a different problem. **Verdict on "KD heals 50 % expert pruning": PLAUSIBLE, nothing
published at our shape; budget it as an experiment with a measured fallback (the 2607 SFT recipe).**

**Cost, one attempt (A100 secure):**

| step | tokens | wall | $ |
|---|---|---|---|
| teacher traces (vLLM FP8 teacher; 5 k prompts IT/FR/ES/EN/ZH + code + tools, thinking on) | 15 M | 1.5–3 h | 3–5 |
| teacher top-64 logits over traces + 30 M raw 7-domain tokens | 45 M | 1–1.5 h | 2 |
| student LoRA-KD, 1–2 epochs | 45–90 M | 4–10 h | 7–16 |
| re-gate (full gate + §4 agentic) | — | 2–3 h | 4–5 |
| setup/debug (Unsloth MoE path, loss, loader) | — | 2–3 h | 3–4 |
| **total** | | **11–20 h** | **$20–34** |

Full FT: ≈ $50–60. H100 halves the wall, doubles the rate. **"≤ $20" is the floor, not the cap: set $30 cap / $40 stop.**

**Risks and the cheap guards.** *Forgetting*: experts frozen cannot forget; a fully-trained router can re-route languages
if the KD mix drifts — equal-token 7 domains, and a 5-language bpb probe every 1 k steps (20 docs/lang, minutes).
*Template/thinking drift*: raw-text-only KD leaves `<think>` unanchored — ≥ 30 % of KD tokens must be templated teacher
traces with thinking; KD on the full sequence incl. reasoning tokens. *MTP*: if the head is kept (F3), the heal moves the
trunk under it — measure acceptance rate after the heal; do not heal the head. *Contamination*: the KD corpus must pass
the same ban sets as calib-v2 (`eval_overlap_check.py`, 49 cells) — the amendment says nothing about it. *Thread claim 4*
("Opus-distilled finetunes are placebo, only summarized CoT"): irrelevant here — our teacher is the unpruned base with full
logits and its own traces.

---

## 4. Agentic loop eval — concrete design (Q4)

**Harness: BFCL v3 multi-turn** (Apache-2.0; repo now v4). Verified today: 200 entries each in `multi_turn_base`,
`miss_func`, `miss_param`, `long_context`; "If the model takes more than 20 steps within a turn, the turn is force-
terminated, and this test entry is marked as incorrect"; state-based + response-based ("subset-matched") checking;
the blog itself documents the loop: "you might see a model loop over and over—listing a directory, trying to write to a
file that isn't there, and then listing again". Runs against any OpenAI-compatible server: `bfcl generate --model <handler>
--test-category multi_turn_base … --skip-server-setup` with `REMOTE_OPENAI_BASE_URL=http://127.0.0.1:<port>/v1`
(llama-server `--jinja`, thinking on, `-np $PROBE_SLOTS`). τ²-bench needs a second LLM as user simulator (double cost);
SWE-bench/Terminal-Bench need Docker on the pod — both out.

**Episodes per arm:** 150 = 50 `base` + 50 `miss_param` + 50 `long_context` (fixed seed-42 slice, same ids every arm,
paired). ≈ 1.4 M tokens/arm with thinking → 25–40 min at `-np 8` → **≈ $1/arm on A100**, ≈ $10 for 9 arms. One-time:
handler + scorer + Mac smoke on LFM, ≈ 3 h, $0.

**What counts as a loop (per entry, any ⇒ loop = 1):** L1 a turn force-terminated at 20 steps; L2 ≥ 3 consecutive
identical (name, args) calls; L3 8-gram repetition ratio > 0.25 in any assistant message > 200 tokens (incl. the
reasoning text); L4 `finish_reason = length` at the 8192 cap. Report loop-rate and multi-turn accuracy with the existing
paired bootstrap (`bootstrap_ci.py`, per-entry 0/1 units — no new tooling).

**Stop rule S5 (new):** loop-rate ≤ base + 5 pp (CI upper bound) **and** multi-turn accuracy ≥ base − 10 pp. Add the
5-language degeneration smoke: 40 prompts × 5 languages × 2 k tokens, same L3 detector (≈ 10 min/arm, replaces the
8-prompt "0 tolerated" smoke that cannot produce a rate).

---

## 5. Everything else (Q5)

**5.1 MTP (F3, high).** PR #22673 merged 2026-05-16; "Currently MTP-native: … Qwen3.6 (27B and larger including the A3B
MoE variants)"; measured 7 → 16–21 tok/s on a 27B Q8 (82 %/72 % acceptance). unsloth ships `Qwen3.6-35B-A3B-MTP-GGUF`
separately — "standard Qwen3.6 GGUFs don't include the prediction heads". 2607.16721 on the MTP head: it is "carrying its
own expert copies (ignored at load … we drop it from pruned exports)"; RAZOR published a separate `mtp_0` keep-set, so
pruning it is established practice. Keeping a pruned MTP head is the one lever that attacks the speed floor
(`EVAL-GATE.md` rule 7, probe 0.39–0.45× LFM) and nobody else has it in a ≤ 11 GB artifact. **Change:** profile the MTP
layer in the same moep pass (its router is `mtp.*.gate`), prune it with its own 128-set, convert *with* MTP, measure
acceptance on the pod. Verify the engine pin carries #22673 (fork main merges upstream b11304). Cost: ≈ 4 h engineering
(moep + converter path), $2 pod, +0.25 GB. If moep cannot see the MTP router in the budget, prune MTP with layer-39's set
and *measure* acceptance — a bad set shows as a low acceptance rate, not as wrong tokens.

**5.2 Calibration shape (F4, high).** `PHASE0-CALIB.md`: 7 × 450 k tokens of raw web text, source code, GSM8K solutions.
Zero tokens pass through the chat template; zero `<think>…</think>`; tool-call dialogues only as code "top-up". The
model Kalsa ships *always* thinks (memory: thinking never off) and calls tools. Published practice on this base is
chat-formatted calibration (2607.16721: "2,047 chat samples … 358 tool-calling samples, 358 SWE-agent trajectories";
crucible v2: "rendered through the model's own chat template"). **Change:** add an 8th domain `chat` of ≈ 450 k tokens:
teacher-generated thinking answers to IT/FR/ES/EN/ZH prompts + tool-call dialogues, rendered through the template,
screened with the same ban sets; use the same text for the imatrix. Cost: Mac overnight (base Q4_K_M, ≈ 6 tok/s per slot)
or 1 pod-hour ($1.6) + 2 h build. Amendment (a) "keep calib-v2" → approve **with this addition**.

**5.3 Criterion (F6, medium).** DESIGN §1: "REAP beats mass and random at both tested depths". Table 3 at 50 %: REAP
0.896, MAN 0.884, routing mass 0.872, random 0.311; mass only *collapses* at 25 %. The translation paper is the only
multilingual criterion test and mass wins it (.844 vs .801). **Change:** export a second 128-set from the same profile
(prob-mass or MSAN, `scoring.py` has both) and build it as arm A′: $0 profile, ≈ 1 h surgery+quant, ≈ $3 eval. Adopt
whichever wins IT bpb at equal HE+.

**5.4 Super-Expert guard (F7, medium).** The patch adds `norm_max`; no rule anywhere (`DESIGN.md:19,290,304`,
`PHASE0-CALIB.md` §3). SE paper rule: "maximum output magnitude exceeds 99.5th percentile AND exceeds one-tenth of the
maximum activation AND resides in" massive-activation layers; found 3/6,144 in Qwen3-30B-A3B layers 1–3, 1/256 in Mixtral
layer 1; pruning the 3 → GSM8K −52.71 %. No hybrid-GDN model studied. **Change (0.5 h, $0):** write the rule before the
pod: keep every expert whose `norm_max` ≥ 10 × its layer's median `norm_max`, cap 4/layer, log the list; and run the
SE check on the base once (where are the massive activations in a GDN trunk?) — that is itself a publishable datum.

**5.5 Shared expert, router renorm.** Shared expert kept at Q6 — correct (QuantMoE-Bench). Post-prune renormalisation
is the standard g_k/(1−g_j) (REAP Eq. 2) and Qwen's top-k renorm makes it automatic; the only interaction is the k₂
spike (DESIGN §2.6) — re-tune k₂ on the pruned model, as DESIGN says. No finding.

**5.6 Quant interaction.** imatrix on the pruned f16, from the (extended) calibration — right order, DESIGN step 4.
Two gaps: (i) `use_mmap=false`/NEON repack for IQ3 on ARM is a *ship* blocker not a plan blocker — fine; (ii) the phone
arm has no rival (F5), so its gate is absolute (vs LFM), not relative — say so in S3.

**5.7 Eval contamination.** calib-v2 screening is good (49 cells, 0 hits). Open: the KD corpus (b) and the new `chat`
domain (5.2) must go through `eval_overlap_check.py`; the BFCL multi-turn slice must be absent from any tool-call
calibration (glaive ≠ BFCL, fine today; keep it so). FLORES devtest first-100 is the eval; v3 used dev+devtest for
the *proxy* only — the artifact never sees it. OK.

**5.8 Stop rules S1–S4.** S1 `IT bpb > 0.75` is +29 % over base (DESIGN expects +7–17 %); `HE+ < base − 15` is below the
paper's own 25 %-keep collapse (−10.3). Both bands are "stop only on catastrophe". S3 "beats" undefined (§2). Missing: S0
(harness sanity — the unpruned Q4_K_M arm must reproduce HE+ 0.89 ± 0.03 and IT bpb 0.58 ± 0.02, else STOP: a broken
harness passes the thread's model); S5 (loops, §4); S6 (knowledge: Global-MMLU-Lite it/fr/es/zh/en, 100 Q/lang,
culturally-agnostic split, Apache-2.0 — ≈ $0.5/arm with a 2 k thinking cap; STOP if mean −10 pp vs base). Tighten S1 to
IT bpb > 0.68, HE+ < base − 10, wrong-language > 3 %.

**5.9 Budget/time realism (F8).** Runners do support `--concurrency` matched to `-np` (`run_gen_eval.py:146`,
`run_humaneval.py:158`, `run_flores.py:105`) — so the $15–25 phase-1 figure holds **only** with `PROBE_SLOTS ≥ 8` and the
new `env.sh` (24/26/8 h guards, working tree, uncommitted). Space-bunny's B1 (fail-open stop rule), B2 (gameable HE+
scorer), B4 (FLORES cap ⇒ wrong-language) are each individually enough to make the whole pod a lie; **no pod before
the fix round is committed and re-audited.** Programme total with a–d: phase 1 $25–35 (9 arms incl. A′, 160, UD-IQ2_XXS,
crucible, anik-reap50) + agentic $10 + knowledge $5 + heal $20–34 + re-gate $5 ≈ **$65–90**. Cap the programme at $100,
with S3 as the early exit.

**5.10 Thread claims vs evidence.** (1) "dumber than a smaller quant": CONFIRMED in kind by MC −21.8 and general ppl
+131 % — at 13–17 GB; REFUTED as a rule at ≤ 11 GB by Table 5 and by the absence of any quant at 8.7 GB. (2) "Qwen3.6
much worse than Qwen3.5 REAP": unverifiable (no 14 B Qwen3.5 REAP found on HF); nothing published separates the two bases.
(3) "loops in agentic coding": PLAUSIBLE — SE paper: pruning 3 experts gives "repetitive and uninformative outputs";
BFCL documents the loop pattern; the gate has no instrument for it → §4. (4) "Opus-distilled placebo": irrelevant (§3).

---

## 6. What would make it genuinely ours (Q6) — within pruning

1. **Calibrate on the serving distribution, in five languages, through the template, thinking on** (5.2). Every public
   Qwen3.6 REAP is English code/chat; RAZOR lost Italian 2.5×. This is the one thing no one has built.
2. **Keep a pruned MTP head** (5.1): the only ≤ 11 GB artifact with native 1.5–2× decode.
3. **Measure the criterion instead of inheriting it**: REAP vs mass/MSAN sets from one profile, nested 128 ⊂ 160, every
   keep-set JSON and per-domain saliency published with the gate — auditable, reproducible (5.3).
4. **A gate that can see "dumber" and "loops"**: knowledge MC in five languages, BFCL multi-turn with loop rates,
   paired CIs, S0 harness sanity (§4, 5.8).
5. **Heal with our own teacher's logits on our domains, conditional and measured** (§3), not "mandatory".
6. Write the Super-Expert rule down and measure where the massive activations live in a GDN trunk (5.4).
7. The k₂-renorm and streaming levers already in the engine (DESIGN §2.6) — nobody else ships those with a prune.

---

## 7. Amendments a–d

- **(a) keep calib-v2** — approve **with change**: add the templated `chat` domain (thinking traces + tool dialogues,
  5 languages), reuse it for the imatrix. ≈ 2 h + $0–2.
- **(b) healing mandatory, ≤ $20** — **reject as written**; approve as *conditional* phase 2: GO only if the training-free
  best arm passes S0/S1/S5/S6 and S3 did not fire; LoRA (attention/GDN/shared + expert LoRA if Unsloth's MoE path loads)
  + full router, **cached top-64 teacher logits**, ≥ 30 % templated thinking traces, equal-token 7(+1) domains,
  1 k-step language probe, full re-gate incl. §4. Budget **$30 cap / $40 stop**, 1 pod-day. Fallback: the 2607
  sequence-level recipe. ≈ $20–34, 11–20 h.
- **(c) multi-turn/long-context agentic eval with loop counts** — **approve** with the §4 design (BFCL v3 slice of 150,
  L1–L4, S5), ≈ $1/arm + 3 h setup; plus the knowledge MC (S6) the amendment does not mention but the thread's
  claim actually requires.
- **(d) public REAPs as reference arms** — **approve with correction**: cerebras has none for this base; use
  crucible-labs REAP-48-v2 (8.78 GiB — phone-budget reference, over 9 GB) and anik-jha coding-reap50 Q4_K_M (11.4 GB —
  PC reference) and, if budget allows, reap25-healed as the "healed public" datum. ≈ $3/arm. State up front that they are
  code-calibrated and expected to fail IT — they are controls for the calibration thesis, not competitors.

**Verdict — approve with changes.** The prune is worth exactly one well-instrumented pod: the published record says
code survives 50 % and knowledge/open-ended quality does not, and nothing published covers our five languages — our
proxy is the only evidence and it cannot predict bpb. Before any spend: commit and re-audit the B1–B4 fixes, extend the
calibration through the chat template with thinking and tools (a), write the Super-Expert rule, add S0/S5/S6 and the
definition of "beats" for S3, add the mass/MSAN arm and the pruned-MTP export. Run (d) as controls. Make (b)
conditional at $30, not mandatory at $20. If after that the unpruned UD-IQ2_XXS still wins the PC gate, the honest
outcome is "quant-only on PC, prune only for the phone" — and the phone arm then has no rival and must clear the
absolute LFM gate alone.
