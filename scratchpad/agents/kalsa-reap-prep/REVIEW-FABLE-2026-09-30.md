# Independent review of the REAP prep (Fable 5.1, 2026-09-30)

Reviewer: Paseo agent `fa589e55-b409-460f-8ec4-b9e50ca44beb` (claude-fable-5-1, high, read-only,
web search allowed), requested by the owner. Subject: this cell at `68107ca6`.

## Coordinator verification (on disk, 2026-09-30)

| Claim | Verdict | Line read |
|---|---|---|
| Stage 10 always dies: `json` not imported | CONFIRMED | `pod/10_fetch_model.sh:40` `import struct, sys, pathlib`; `:45` `keys = list(json.loads(...))` |
| Load check uses interactive `llama-cli` without `--single-turn` | CONFIRMED | `pod/40_convert.sh:61` `llama-cli -m "$gguf" -p "ping" -n 8 --no-warmup` |
| Terminate call uses `api.runpod.ai/v2/pods` + `x-api-key` | CONFIRMED (endpoint validity per Runpod docs not re-checked by me) | `pod/terminate_pod.sh:24-25` |
| "65 % prune carries 264M routed params/token" is wrong: per-token routed params do not shrink with the pool | CONFIRMED | `docs/PARAM-BUDGET.md:99-102` |
| Tool-call scorer only matches the Qwen `<tool_call>{json}</tool_call>` form | CONFIRMED | `eval/run_gen_eval.py:24` |

Not re-checked by me: HF private quota (100 GB) vs ~156 GB upload, disk peak ~391 GB, token in argv,
calibration/near-dup findings, external literature numbers.

## Review text (verbatim)

### 1. GENERAL VERDICT

The prep is careful on the wrong things. Pins, hashes, privacy checks and the `--no-mtp` proof are real, but the pod job as committed cannot complete: stage 10 always dies on a missing `import json`, the terminate call hits a non-existent endpoint, the load-verify step uses the interactive `llama-cli` form the report itself flagged, and stage 50 pushes about 156 GB into a private HF repo whose free quota is 100 GB, then the EXIT trap terminates the pod and deletes the volume with every artifact on it. Above the scripts, the plan's product arithmetic is wrong where it matters: expert pruning shrinks total parameters, not active ones, and the lab already measured streamed Qwen3.6 on the S23 as compute-bound at 5.70 tok/s, so no prune ratio can pass the gate's own 0.5×LFM speed floor on the 8 GB class. The eval gate would also let Kalsa "win" tool calls by construction because LFM never emits `<tool_call>`. **Verdict: NO-GO on the pod job as written; GO WITH CHANGES on the idea, restricted to PC and 16 GB phones, after a $0 probe with the published REAP20 checkpoint.**

### 2. General questions

**G1.** Pruning cannot deliver the speed half of "clearly beats". Biggest failure reason: active compute is unchanged by expert pruning (k=8 routed + 1 shared, https://huggingface.co/Qwen/Qwen3.6-35B-A3B); the lab measured CalaQwen compute-bound at 5.70 tok/s streamed (`reports/research-newmoe-candidates.md:12,14,168`). PARAM-BUDGET.md:99-102 REFUTED. Second: the scripted job self-destructs (T5).

**G2.** 75 % prune = 10.49B, of which 2.43B non-expert. 8B needs ~83 % expert pruning; 5B impossible by expert pruning alone. Deepest generalist evidence is 50 % with visible loss (REAP, Qwen3-30B-A3B creative writing 0.811 -> 0.718, https://arxiv.org/html/2510.13999). A 3B-active MoE moves about the same bytes/token as a 2.6B dense model: at best equal speed, 2-4x the RAM. Acceptable only if quality wins by a wide margin at equal speed - untested.

**G3.** REAP tests 25/50 % only, uniform, no multilingual eval. HOPE (https://arxiv.org/abs/2609.18916) beats REAP at 50 %, no multilingual. moep paper (https://arxiv.org/abs/2607.16721): damage lands outside coding; EVIDENCE.md:106-108 general-chat ppl 5.20 -> 12.00 -> 30.9 at 50 %/25 % keep. Deep prune works only for narrow specialists (https://arxiv.org/abs/2605.28042). Free checkpoints to test now: `cerebras/Qwen3-Coder-REAP-25B-A3B`, and on our base `0xSero/Qwen3.6-28B` REAP20 with GGUFs (metrics table placeholders - measure it).

**G4.** Few 8-15B MoEs: in that range dense 4-9B is simpler; MoE pays when total scales at fixed compute. Recent: Gemma 4 26B-A4B (Apache-2.0), LFM2-8B-A1B / LFM2.5-8B-A1B (excluded by owner), Granite-4.0-H-Tiny, Trinity Nano, Phi-mini-MoE, Ling-mini-2.0, Moonlight (PLAN.md:844-849). moep has a Gemma-4 adapter (`adapters.py:161-176`): Gemma-4-26B-A4B pruned 50-65 % is the one alternative base worth a look.

**G5.** bpb across tokenizers is fair in principle (`run_bpb_eval.py:71`), but multi5 is ~50 KB/language (IT = one Wikipedia article on coffee), `-c 4096` scores ~2 chunks; the ±0.02 "jitter" is determinism, not sampling variance -> REFUTED as a "wins clearly" instrument. Tools-100 unfair to LFM (format) - CONFIRMED. GSM8K-200 thinking off + greedy is a weak probe. Add Qwen3.5-4B dense control, >= 500 KB/language non-Wikipedia held-out text, paired bootstrap CIs, IT instruction-following, tool-format normaliser. Drop Q8_0 arms.

**G6.** Cheapest = $0: run the fixed gate on the Mac with `0xSero/Qwen3.6-28B-GGUF` Q4_K_M, unpruned Qwen3.6 Q4, LFM. Then one ratio (50 %) only. Reorder: pod does profile + score only, uploads ~1 MB of stats/keep-sets; surgery, conversion, imatrix, quantisation on the Mac (`surgery.py:57-75` streams shards on CPU).

**G7.** SFT needed at 65/75 %, not sufficient for a generalist at 75 %. Fused experts cannot take LoRA; moep heal targets attention/shared expert (`heal.py:26`). PLAN.md:868 replay 10-20 % is too low: use >= 50 % multilingual replay, thinking on and off. Order: prune -> SFT BF16 -> imatrix -> quantise.

**G8.** Engine support CONFIRMED: `LLM_ARCH_QWEN35MOE` (`src/llama-arch.h:47`), OpenCL GATED_DELTA_NET + MUL_MAT_ID Q4_0 (`ggml-opencl.cpp:9453-9460, 9532-9541`), Hexagon maps GATED_DELTA_NET/SSM_CONV/MUL_MAT_ID/CUMSUM (`ggml-hexagon.cpp:5673,5696-5700`). 75 % Q4_0 = 5.90 GB > 4.5 GB 8 GB-phone budget -> 8 GB always streams (5.7 vs LFM 16 tok/s, fails 0.5x floor). 16 GB phones fit 65/75 %, parity at best on speed. Realistic: PC + 16 GB phones.

**G9.** Qwen3.6 Apache-2.0: renaming OK with LICENSE/NOTICE. Aya `translated_dolly` derives from Dolly-15k CC-BY-SA-3.0 (SOURCES.md:11 says Apache) - not blocking while calibration stays private. Nothing blocks shipping.

**G10.** NO-GO for `run_all.sh` as committed. GO WITH CHANGES on PC + 16 GB phones after the $0 probe. If REAP20 is already below LFM on IT bpb/GSM8K: stop, try Gemma-4-26B-A4B pruned, or accept a dense 4B for the 8 GB class.

### 3. Technical questions

**T1.** ~409k tokens -> ~12.8k (token, expert) events per expert per layer on average; ZH experts a few hundred. REAP used ~2.1M tokens (5x more). Uniform per layer (`scoring.py:114`, `surgery.py:41-43`), consistent with REAP.

**T2.** Router/top-k/shared expert handling correct (`surgery.py:78-80`, `adapters.py:61-73,80-86`). CONFIRMED.

**T3.** `--no-mtp` proof convincing on the code path; PLAUSIBLE at scale. Vision exclusion PLAUSIBLE (line not re-read).

**T4.** Q4_0 right for OpenCL/Hexagon MUL_MAT_ID; costs more on pruned experts (no published number). Keep attention/GDN/shared at Q6_K/Q8_0 via `--tensor-type`, experts Q4_0. Drop Q8_0 arms.

**T5.** CONFIRMED: (a) missing `json` import `10_fetch_model.sh:40-45`; (b) wrong terminate endpoint/header `terminate_pod.sh:24-25` (documented: `DELETE https://rest.runpod.io/v1/pods/{podId}`, Bearer; pod-scoped key may not terminate; `poweroff` leaves a stopped pod billing storage); (c) `40_convert.sh:61` no `--single-turn` -> hang to 1.7 h timeout; (d) `50_upload.sh:51-53` ~156 GB into 100 GB private quota, then the trap (`run_all.sh:55-57`) terminates and the volume is deleted; (e) disk peak ~391 GB on 400 GB; (f) HF token in argv (`50_upload.sh:21,56`). PLAUSIBLE: profiling OOM at batch 2 x 4096 on 80 GB. $6-9 credible only with zero failures.

**T6.** gsm8k rows have only the final number (`build_calib.py:164`); every row has an empty think block (non-thinking only); Aya first-N unshuffled (`build_calib.py:142-153`); EN chat 36 rows; no multi-turn, no non-EN tools/code. `near_dup_check.py:70` Jaccard vs a 50 KB corpus is structurally ~0 - use containment. `make_imatrix_text.py:26` unused `sep`.

**T7.** Tools scorer unfair; thinking off for Qwen only (`run_gen_eval.py:93`); no `--no-display-prompt` (echoed prompt can supply digits); tools holdout same generator as calibration (`build_holdouts.py:66-96`) favours Kalsa.

**T8.** 12 GGUFs over-engineered; README.md:20 budget ($40/$120/$150) contradicts the owner's ~$15; `50_upload.sh:64-65` verifies stats only, not GGUFs.

### 4. Top 5 changes, ranked

1. Do not launch the pod as committed; fix json import, terminate URL/header, `--single-turn`, never terminate on a failed upload. Better: pod = profile + score only, ~1 MB upload, rest on the Mac.
2. Spend $0 first: fixed gate on `0xSero/Qwen3.6-28B` REAP20 GGUF, unpruned Qwen3.6 Q4, LFM2.5-2.6B, Qwen3.5-4B dense on the Mac.
3. Fix the gate: tool-format normaliser, >= 500 KB/language held-out non-Wikipedia text, paired CIs, drop Q8_0 and 25 % arms.
4. Fix calibration: thinking rows with reasoning, full GSM8K solutions, shuffled Aya, multi-turn, >= 2M tokens; containment instead of Jaccard.
5. Re-target: PC + 16 GB phones resident (65-75 %, experts Q4_0, dense Q6_K/Q8_0); LFM stays for 8 GB; LoRA heal with >= 50 % multilingual replay before identity tuning.

### 5. Sources

https://arxiv.org/abs/2510.13999 · https://arxiv.org/abs/2609.18916 · https://arxiv.org/abs/2607.16721 ·
https://arxiv.org/abs/2605.28042 · https://arxiv.org/html/2603.18492v2 · https://github.com/CerebrasResearch/reap ·
https://huggingface.co/cerebras/Qwen3-Coder-REAP-25B-A3B · https://huggingface.co/0xSero/Qwen3.6-28B ·
https://huggingface.co/Qwen/Qwen3.6-35B-A3B · https://huggingface.co/google/gemma-4-26B-A4B ·
https://huggingface.co/LiquidAI/LFM2-8B-A1B · https://huggingface.co/docs/hub/storage-limits ·
https://docs.runpod.io/api-reference/pods/DELETE/pods/podId · https://docs.runpod.io/pods/references/environment-variables ·
https://huggingface.co/datasets/CohereLabs/aya_collection · https://huggingface.co/datasets/databricks/databricks-dolly-15k
