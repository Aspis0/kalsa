# moe-selfspec-f1

**Host:** PC only (NOISY_ENV). No phones.
**Commit:** `be3c7fe` `feat(engine): MoE-k self-speculative decoding` on `kalsa/selfspec-f1`
**Model:** `models/Qwen3.6-35B-A3B-KEXP.gguf`
**Logs:** `results/selfspec_f1_pc/`
**STATUS:** loop shipped; PC identity is near-tie drift; PC speed loses.

## What it is

A third draft source for the existing speculative verify loop (`--mtp` / `--ngram`).
`--selfspec-draft-k N` drafts with the **same weights** at top-k `N` and verifies at the
campaign k (`--n-expert-used`, or the gguf default). Off by default.
`--selfspec-gamma G` sets the draft width (default 4 when `--draft` is not passed).

It is not a quality trade. A draft is accepted only where it equals the target's argmax.
It inherits the batched-verify near-tie caveat already documented for `--mtp`.

## k-switch

`n_expert_used` lives on `llama_model::hparams` and is copied into the top-k node at
**graph build**. `llm_graph_params::allow_reuse` does not compare it. Switching k on one
context silently reuses a leftover campaign-k graph (capture warm-up, `n_draft==0`) and
the loop is then wrong.

Shipped shape: **one model, two full-decoder contexts**.

- `ctx` (target): always verify k. Prefill + the `γ+1` verify batch.
- `ctx_dft` (draft): default `ctx_type`, not `LLAMA_CONTEXT_TYPE_MTP`. Always draft k.
  1-token draft steps + its own prefill.

Weights are shared. Streamer capture on the target is enough (both graphs reference the
same tensors). Extra RAM is one KV plus draft compute buffers (`n_ubatch = max(32, γ+1)`,
capped at the target's ubatch).

The only private reach is `core/src/engine/expert_k_switch.cpp`, the single TU that
includes `llama-model.h` and writes `hparams.n_expert_used`. No llama.cpp patch. The
draft context is created with hparams already at draft_k so its reserved graphs are
k-stable. The protocol never decodes a context while hparams.k is the other context's k.

Rejected: two `llama_model` loads (streamer would rebind one model's captured pointers;
the other would silently mmap). Rejected: drop-to-k on a k=6 graph (not a real top-k
reselect).

## KV and catch-up

Draft writes only into `ctx_dft`. Target KV is never polluted.

After a draft of `n_draft`, the last drafted token is predicted, not consumed. Verify on
the target is `[tok] + draft`, batch of `n_draft+1`, all logits. Accept is the existing
argmax prefix. Target `seq_rm` of the rejected tail is unchanged.

Catch-up on the draft context **rewinds the cycle** (`llama_memory_seq_rm` from `n_past`)
and **replays** `tok` plus the accepted prefix. That is the MTP catch-up shape.

An incremental tail-trim (keep `tok`+accepted, drop the rest) is enough for a pure
transformer KV. On this hybrid model it is not. `llama_memory_recurrent::seq_rm` can only
restore R/S from `n_rs_seq` snapshots; a partial rewind that does not hit the snapshot
path leaves attention trimmed and R/S at the rejected tokens. Measured: first cycle
accepted, then token-alpha collapsed to 5.6% (44/789) on longfact. After rewind+replay
the same prompt is 18.0% (102/567) with first-token agreement ~66%.

So the cheaper-k draft context asks for `n_rs_seq = draft_max`. MTP's draft context stays
at 0: the nextn graph is attention-only. The target still has `n_rs_seq = draft_max` for
any spec source.

## Drop

Every decode on `ctx_dft`, including its prefill, runs `set_drop_policy(0, ...)`.
Verify restores campaign `--drop-cold-experts`. A cheaper top-k is already a thinner
routing; a d0 draft arm and a d065 draft arm had essentially the same teacher-forced
alpha (~0.70), so the draft side stays at d0. Identity comparisons are run at d0
because drop-cold is state-dependent.

## Host gates

`ctest -R "config_validate|moe_gates|ngram"`: all passed.

- G13 unchanged.
- G15a (tiny-moe, `draft_k=1`, `draft_max=2`, streaming on): 8 steps drafted, 24 tokens
  in 8 decodes.
- G15b (same-k, both 2): alpha = 1.000 (16/16).

## CalaQwen correctness (d0, n=256, -t 4)

Common flags: `--temp 0 --moe-stream --cache-mb 2000 --dense-weights anon --overlap
--io-threads 4 --progress -c 2048 --ubatch 512 -n 256 -t 4`. Raw `-p` (no chat template).
Plain: `--n-expert-used 6`. Selfspec: that plus `--selfspec-draft-k 2 --selfspec-gamma 4`.

| prompt   | first text drift | window alpha | tokens/verify |
|----------|------------------|--------------|---------------|
| longfact | pos 225 (`.` dropped) | 102/567 = 0.180 | 1.66 |
| creative | pos 47 (`734` vs `7`) | 48/715 = 0.067 | 1.25 |
| code     | pos 203            | 75/644 = 0.116 | 1.41 |

Pooled window alpha **0.117** (225/1926).

All three drifts are one token, then a different continuation — the same class MTP already
documented (batched matmul vs serial near-tie). Not a duplicated-token rollback bug.

Window alpha is not F0's 0.6991. F0 is teacher-forced per gold position. The loop's drafts
2..γ are conditioned on the k=2 prefix, so they fail more. First-token accept rate on
longfact after the replay catch-up is ~0.66, next to F0. Treat 0.12 as the loop's
speculative alpha, not as a broken k=2.

## PC speed A/B (NOISY_ENV)

p_longfact, n=256, -t 4, `--drop-cold-experts 0.65`. A PPL `bmoe-cli` and other jobs
shared the machine.

| cell | decode tok/s | draft s/tok | effective tok/s |
|------|--------------|-------------|-----------------|
| plain k=6 d065 | 2.10 | — | 2.10 |
| selfspec k=6/k=2 γ=4 d065 | 1.29 | 0.524 | **0.77** |

Speedup **0.37x**. The draft is a full k=2 autoregressive pass; at 1.66 tokens per verify
it cannot pay for itself on a DRAM-bound host. The prize, if any, is on flash.

## What the S23 cell needs

Do not run it from this session. Same three prompts, n=256, greedy:

1. d0 identity: plain `--n-expert-used 6` vs `--n-expert-used 6 --selfspec-draft-k 2 --selfspec-gamma 4`.
2. d065 A/B: add `--drop-cold-experts 0.65` (renorm stays on). Report effective tok/s
   including draft, cycle JSON, RSS.

Campaign flags as on the phone (`--moe-stream --cache-mb 2000 --dense-weights anon
--overlap --io-threads 4 -c 2048 --ubatch 512`). Draft ctx adds one KV plus `n_rs_seq=γ`
R/S snapshots (314 MiB recurrent on this 35B hybrid at γ=4). The question is whether
verify-batch flash amortisation beats that draft cost. This PC cannot answer it.
