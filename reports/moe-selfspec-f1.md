# MoE-k self-speculative decoding (F1)

**Verdict:** `F1_CORRECT(drift@pos) alpha=0.08 PC speedup 0.22 (NOISY_ENV)`

Engine commit: `be3c7fe` on `kalsa/selfspec-f1` (not pushed). llama.cpp submodule
untouched. Host gates (config, G13, G15) green. CalaQwen PC identity drifts at the
first token that batched verify orders differently from serial k=6; free-running
alpha is 0.08 against F0's teacher-forced 0.6991; effective tok/s is a 0.22×
slowdown in a noisy shared-PC environment.

## Mechanism

`n_expert_used` is a load-time hparam. Graph build copies it into the top-k node.
`llm_graph_params::allow_reuse` does not compare it. Switching k on one context
silently reuses a leftover campaign-k graph (capture warm-up, n_draft==0, a 1-token
graph still in the cache) and the loop is then wrong.

F1 therefore uses **one `llama_model`, two full-decoder contexts**:

| context | role | k | notes |
|---|---|---|---|
| `ctx` | target | campaign / verify | prefill + verify batch of γ+1 |
| `ctx_dft` | draft | `draft_k` | 1-token draft steps + its own prefill. Default `ctx_type`, not MTP |

Weights are shared. Streamer capture on the target is enough: both graphs reference
the same tensors. Extra RAM is one KV plus draft compute buffers sized like MTP
(`n_ubatch = max(32, γ+1)`, capped at the target).

Public `llama.h` has no setter. The write is isolated in
`core/src/engine/expert_k_switch.cpp`, the only translation unit that includes
`llama-model.h`. `session.cpp` never sees that header. No in-tree llama.cpp patch,
no second model load (a second model would silently mmap: the streamer rebinds
pointers captured from the first).

Protocol: never decode a context while `hparams.k` is the other context's k. The
draft context is also *created* at draft k so the graphs reserved at init are
already the cheap top-k.

Drop: draft pass (every decode on `ctx_dft`, including prefill) is d0. Verify
restores campaign `--drop-cold-experts`. F0 measured d0 and d065 draft arms at
the same alpha; d0 is simpler and keeps the identity gate well-defined.

## KV and catch-up

Draft writes only into `ctx_dft`. Target KV is never polluted. After a draft of
`n_draft` tokens the last drafted token has been predicted, not consumed.

On a **pure transformer** a tail `seq_rm` to `n_past+1+n_acc` is enough. This
model is **hybrid** (qwen35moe + SSM). Two consequences:

1. `n_rs_seq` on the draft context is `draft_max`, not 0. Recurrent `seq_rm` of a
   tail returns false when `n_rs_seq == 0`. The first CalaQwen run died with
   `the cheaper-k draft context does not support rewinding its KV cache`. MTP
   can keep 0: its nextn graph is attention-only.
2. Incremental tail erase returns true via those snapshots and still leaves the
   SSM state unaligned with attention. Catch-up therefore rewinds the whole cycle
   (`seq_rm` from `n_past`) and replays `tok` plus the accepted drafts.

`n_past += 1 + n_acc` stays on the target. End-of-turn trim keys off `ctx_dft`,
so chat prefix-reuse keeps working.

## Host gates

`ctest` `config_validate`, `ngram_draft`, `moe_gates_qwen3moe` passed.

- G13 (ngram abstain / live) not weakened.
- G15a: tiny-moe, `draft_k=1`, `draft_max=2`, streaming on. 8 steps drafted, 24
  tokens in 8 decodes.
- G15b: same-k (`draft_k = n_expert_used = 2`) alpha = 1.000 (16/16).

## CalaQwen PC (NOISY_ENV)

Model `Qwen3.6-35B-A3B-KEXP.gguf`. Flags match F0 except `-t 4`, `-n 256`, and
`--chatml --no-think` (raw `--session` made longfact emit one newline token and
stop). A PPL `bmoe-cli` was left running on the same machine.

### Identity, d0, k=6 vs `--selfspec-draft-k 2 --selfspec-gamma 4`

| prompt   | n     | first differing text |
|----------|-------|----------------------|
| longfact | 256   | pos 12: `35 billion` vs `35-billion` |
| creative | 216   | pos 29: `polished chrome` vs `chrome` |
| code     | 256   | pos 22: extra `import sys` |

One early token flip, then the cascade. That is the batched-verify caveat,
happening immediately on hybrid GDN rather than at a late near-tie. Cycles 1–2
on longfact accepted 4/4, so the loop is matching the *batched* target, not
inventing tokens.

### Alpha

Pooled over the three d0 selfspec runs: **131 / 1670 = 0.078**. Longfact after
the replay catch-up: 51 / 594 = 0.086. F0 teacher-forced pooled alpha was
0.6991. Free-running here cannot stay there: the first batch-vs-serial flip
takes the prefix off the F0 gold trajectory, and later k=2 drafts stop matching.

### Speed A/B, p_longfact, d065, `-t 4`

| arm | decode tok/s | draft s/tok | effective tok/s |
|-----|-------------:|------------:|----------------:|
| plain k=6 d065 | 2.91 | 0 | **2.91** |
| selfspec k=6 / k=2 γ=4 d065 | 1.00 | 0.59 | **0.63** |

Speedup **0.22×** (slowdown). At 8% accept the k=2 autoregressive draft is paid
for almost nothing, and the verify batch also streams more (correctness
selfspec longfact: 52 GiB).

Artifacts: `results/selfspec_f1_pc/` (`METHOD.txt`, `v3_*`, `v4_*`).

## What the S23 cell needs

Do not run it from this worktree. The phone cell has to answer three questions
the PC cannot:

1. **Identity.** Same three prompts, d0, `--chatml --no-think`, n=256. If the
   device's batched GDN matches serial, expect identity. If it matches the PC,
   expect the same early token flip. Dump the first differing token either way.
2. **Alpha.** Pooled γ=4 d0. ~0.08 means the lane does not pay on this model.
   Something near F0 0.70 means the PC number was the hybrid-batch confound.
3. **Speed.** Thermally gated, `--drop-cold-experts 0.65`, p_longfact, n=256,
   `-t 4`. Effective tok/s must include the k=2 draft pass. Budget one extra
   full-decoder KV, compute at `n_ubatch=max(32,γ+1)`, and `n_rs_seq=γ`
   snapshots on **both** contexts.

Do not use `--session` without `--chatml` on this gguf.
