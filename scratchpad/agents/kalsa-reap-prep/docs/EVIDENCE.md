# REAP code choice and what the moep paper changes

## 1. The REAP/Qwen3.6 code: what exists, what we pinned

**The 0xSero fork is not publicly reachable.** Checked on 2026-09-29: all 89
forks of the upstream repo enumerated (GitHub forks API, both pages — no
0xSero); all 140 public repos in the 0xSero account (two pages) scanned —
`reap-expert-swap` is runtime expert-swapping for vLLM, `reap-bench` forks an
unrelated benchmark, nothing is a REAP pruning fork; the HF card
(`0xSero/Qwen3.6-28B-REAP20-A3B`) says "this fork's Qwen3_5Moe-aware observer"
but its sidecar dataset `0xSero/qwen3.6-35b-a3b-reap-observations` answers
`{"error":"Invalid username or password."}` without auth. The card's "205
experts/layer kept, 51 pruned" at REAP20 confirms the rounding both candidate
implementations use.

**Upstream `CerebrasResearch/reap` @ `1970473` (Apache-2.0) still lacks
Qwen3.6.** `src/reap/model_util.py:7-118` keys MODEL_ATTRS on
Qwen3MoeForCausalLM / Llama4 / Mixtral / DeepseekV2 / Ernie4_5 / gpt-oss /
Glm4Moe only — no `Qwen3_5Moe*`. GitHub issue search `repo:CerebrasResearch/reap
qwen3_5` → 0 results; open feature requests #14 ("Save expert mapping") and
#15 ("Publish per-expert saliency scores") are unrelated asks.

**`hqta1110/reap` @ `7110332` is the only public fork with Qwen3_5Moe
support** (grep of the six active forks; the other five have no Qwen3_5
touch). It builds directly on upstream HEAD (1970473 is an ancestor). Verified
verbatim against transformers v5.16.0 `models/qwen3_5_moe/modeling_qwen3_5_moe.py`:

- `model_util.py:76-89`: `"Qwen3_5MoeForCausalLM": { "moe_block": "mlp",
  "gate_proj": "gate_up_proj", ..., "fused": True, "grouped": True,
  "router": "gate", "num_experts": "num_experts", ... }` — matches the real
  checkpoint's stacked `mlp.experts.gate_up_proj [256,1024,2048]` /
  `mlp.experts.down_proj [256,2048,512]` and `mlp.gate.weight [256,2048]`
  (read from the safetensors shard headers).
- `model_util.py:90-105`: `"Qwen3_5MoeForConditionalGeneration": {...,
  "num_experts_cfg_path": "text_config", "layers_path":
  "model.language_model.layers"}` — matches the real nested `text_config`
  config.json and the `model.language_model.layers.N.*` tensor names.
- `observer.py:647-654`: `Qwen3_5MoEObserverHookConfig` hooks
  `Qwen3_5MoeSparseMoeBlock`, reads `gate.num_experts` / `gate.top_k`,
  `grouped_fused_experts=True`; `observer.py:30-52` recomputes all-expert
  activations from the stacked weights, "faithful to Qwen3_5MoeExperts.forward"
  — matches the transformers class (router softmax→top-k→renorm).
- **Caveat found here:** the fork's *layerwise* observer does NOT implement
  the grouped path — `layerwise_observer.py` branches only on
  `hook_config.fused_experts` (Llama4-style). So FASE A's "layerwise
  obbligatorio on 1×A100 80GB" (taken from the 0xSero card's reproduce path)
  is not executable for Qwen3.6 with this fork; its observation is a
  full-model forward with per-GPU memory caps (`prune.py` sets
  `max_memory={i: "32GiB"}` per card for multi-GPU).

**Decision: the pod runs `anik-jha/moep` @ `fdc9a3fc` (MIT, the pipeline
behind arXiv:2607.16721).** Reasons, with code:

1. **Same REAP statistic, measured on our exact model.** moep's profiler
   accumulates `reap_sum` = "sum of g * ||f_e(x)||_2 (REAP numerator)"
   (profiler.py:12) with gates taken from the model's own renormalized top-k
   — the same quantity hqta1110 computes, and the paper's Table 3 criterion
   shootout on Qwen3.6-35B-A3B crowns exactly this signal.
2. **N ratios from one observation, without re-running the model.** One
   profile pass writes `profile.stats.pt` (profiler.py:42-45); each ratio is
   `moep score` (CPU, ranking only) + `moep prune` = checkpoint surgery that
   "streams shard by shard (peak memory ~= largest single tensor)" without
   loading the model, and "a verification pass re-opens both checkpoints and
   compares sampled kept-expert rows byte-for-byte" (surgery.py header). By
   contrast the REAP fork re-loads the full model on GPU and re-clusters for
   every ratio (`layerwise_prune.py:357-379`).
3. **Qwen3.6 verified end to end in-tree**: `Qwen3_5MoeAdapter`
   (adapters.py:27-87) was written "from downloaded artifacts or installed
   modeling source", handles both serialization layouts, and drops `mtp.*`
   from pruned exports (sets `mtp_num_hidden_layers = 0`).
4. **Export safety net**: `export.py` converts with an in-tree llama.cpp
   converter that registers `Qwen3_5MoeForConditionalGeneration` and
   load-verifies every GGUF with a one-shot completion. Our pod swaps in the
   kalsallama converter (fork main `e8065c7cf`, whose `conversion/qwen.py:643`
   registers the same class names; the `-hmx` spike predates this entry —
   that is why fork main, not hmx).
5. Invariants are tested: "pruning zero experts must reproduce base logits
   exactly, and a pruned model must produce logits identical to the base
   model with dropped experts masked out of its router" (paper §3.3; enforced
   by tests/test_pruning-style suites in the repo).

The hqta1110 fork stays pinned as the independent REAP-metric reference (its
observer is the second implementation of the same statistic; a one-layer
cross-read of keep-sets is a cheap future check, not part of the pod job).

## 2. Answer to "saliency once, many ratios?"

**Yes — in both candidates.** moep: one `profile` pass → `profile.stats.pt`
(six fp32 accumulators per layer×expert, ~250 KB); `score --keep-ratio X`
ranks from those stats; `prune` applies a keep-set to the untouched base
checkpoint. The REAP fork: `layerwise_prune.py:296-298` loads the cached
observation when present, `:312-314` exits after observation under
`--run_observer_only`, and `:323-326` derives `n_experts_to_prune =
int(total_experts * compression_ratio)` from the cached
`expert_frequency`. Nothing re-runs forward passes per ratio; what repeats is
only weight-copy (moep, CPU disk-speed) or weight-reload+cluster+save (fork,
GPU).

## 3. What the paper's numbers change for us

- **Criterion:** REAP wins on Qwen3.6 at both tested depths (Table 3:
  0.896 / 0.787 HumanEval+ at 50% / 25% keep, vs MAN 0.884/0.720, routing
  mass collapse at 25%, random 0.311/collapse). No criterion shootout needed
  for our family. §5.3 warns rankings do not transfer across families —
  irrelevant while Kalsa stays Qwen3.6; re-shoot if the base ever changes.
- **Calibration is the lever, and it is exactly our multilingual set.** With
  coding-heavy calibration the specialist trade is brutal off-domain:
  general-chat ppl 5.20 → 12.00 at 50% keep, → 30.9 at 25% keep (Table 2).
  Kalsa ships as a generalist, so the observation distribution (IT 30%, EN,
  ES, FR, ZH; chat/reasoning/code/tools) must be the serving distribution.
  Their domain-contrastive idea is the wrong shape for this: "removing
  uninformative-but-large ones is fatal" (§5.2, dose-response 0.787 → 0.470 →
  collapse) — magnitude-family signals are load-bearing.
- **Ratios:** published evidence covers keep 75→25% (prune 25→75%) with the
  flat region through 50% keep. Our 25/50/65/75% prune list brackets it:
  prune 25 and 50 are the evidence-backed zone; prune 65 (keep 90/256 ≈ 35%)
  sits between their 37.5%-keep point (HE+ 0.860) and the 25%-keep break;
  prune 75 replicates their deepest tested point. Per §5.6, better selection
  narrows the deep-prune gap but stays >6 points below the 2-bit base —
  expect 65/75 to be SFT-dependent.
- **The planned LoRA SFT has a measured recipe** (§5.7): routed experts are
  fused 3D params LoRA cannot wrap, so adapt attention + linear-attention +
  shared-expert projections with LoRA (they used r=64) and train the router
  matrices in full, experts frozen — that recovered 52% of the HumanEval+
  gap and took general ppl 30.9 → 9.4 at 25% keep.
- **Do not gate on perplexity alone** (§5.4): a random-50 prune "scores
  better held-out code perplexity than the base model (4.82 versus 5.38)
  while losing 57.9 points of pass@1". Our eval gate pairs multi5 bpb with
  functional checks and a degeneration counter.
