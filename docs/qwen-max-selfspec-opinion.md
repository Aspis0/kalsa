# Qwen 3.8 Max — opinion on the selfspec alpha collapse (2026-08-14, chat.qwen.ai)

Verbatim answer to our F1 question (0.70 teacher-forced -> 0.08 live).
Session: chat.qwen.ai "MoE Inference Anomalies". Key structure preserved;
UI chrome removed.

## Prior distribution over mechanisms

| hypothesis | prior |
|---|---|
| A++: recurrent state / rollback / context-sync CORRUPTION (rejected-token contamination, bad snapshot restore) | ~45% |
| B: batched GDN/DeltaNet verify infidelity | ~30-35% |
| distribution shift: gold teacher-forcing != live self-prefix | ~10-15% |
| pure "k=2 draft too weak" | <10% |

Reasoning: if F0 was a faithful stateful teacher-forced walk, ordinary k=2
state drift is ALREADY PRICED INTO 0.699 — a 9x collapse needs something
pathological. The most common: the draft context is conditioned on a
PHANTOM PREFIX (rejected speculative tokens polluting state, or recurrent
state not restored correctly). With GDN you cannot subtract rejected
tokens from a fixed-size state: you must snapshot-restore or recompute
from the accepted boundary — non-negotiable.

"same-k 16/16 is a smoke test, not evidence of correctness" — it may only
prove self-consistency of a buggy batched path, and says nothing about
the first rejection's rollback. Need same-k over 1000+ tokens plus
forced-rejection rollback tests.

## Third mechanisms we were missing

1. **Rollback/snapshot-restore corruption** (the big one; see above).
   Invariant: state(ctx, accepted_prefix) == state(fresh_ctx,
   accepted_prefix), also AFTER a forced rejection+restore.
2. **Batched causality leaks** in chunked GDN kernels: perturb only t4 in
   [prefix,t1..t4]; logits for t1..t3 must not change. If they do, the
   batched path is non-causal — functional bug, not noise.
3. **Context desync**: position ids, chat template, logits processors,
   cache types, and — pointed — `n_expert_used` accidentally GLOBAL or
   sticky (a batched verify silently running E=2 via graph reuse).
   Log per forward pass: ctx id, n_tokens, positions, E_used, state hash.
4. **Gold vs self-generated distribution shift**: E1 must teacher-force
   BOTH gold text AND the serial k=6 greedy self-continuation.
5. **Temp-0 argmax brittleness amplified by MoE routing** (tiny logit
   perturbation -> router near-tie flip -> expert set changes -> cascade).
   Log top1 margins + expert-set overlap; flips at margin <1e-3 =
   numerics, flips at large margin = functional bug.

## Q3 economics (draft-prefix-at-verify-k)

With u ~= 1 (real k=6 catch-up per accepted token): S>1 requires
V + gamma*d < 1 — the acceptance term CANCELS. Economically dead by
construction. Only viable shape: FORK the verifier's already-computed k=6
state nearly for free (C_copy budget ~7% of a serial token at alpha=0.7 —
tight, GDN states are big; measure C_copy).

**The separate arithmetic bomb**: our 0.22x at alpha=0.08 implies
iteration cost ~4.94 serial-token equivalents. If the verify batch is not
SUBLINEAR in token count (on-device: flash-I/O amortization is the only
plausible source of sublinearity), gamma=4 self-spec is economically dead
REGARDLESS of alpha. Measure T_serial / T_draft4 / T_verify5 /
T_state_copy directly (Test D).

## Operational order (verbatim)

> Stop tuning alpha. Fix two invariants first:
> 1. serial E=6 == batched E=6 on FIXED token sequences, tight tolerance;
> 2. forced rejection + restore returns both contexts to identical
>    accepted-prefix state.
> If either invariant fails, the current self-spec loop is not measuring
> reality.

## E1/E2/E3 interpretation table (for when F1b lands)

- E1 reproduces 0.70 → forward path OK; live collapse is free-run
  state/rollback/distribution. E1 collapses → the F1 machinery itself is
  not measuring what F0 measured (batched infidelity / desync / E leak).
- E2 jumps to 0.6-0.7 → problem is multi-step k=2 evolution or rollback
  contamination (production economics then hinge on free state forking).
  E2 stays 0.08 → something fundamental (batched verify, ctx mismatch).
- E3 gamma=1 disagrees → basic batched decode not serial-equivalent: fix
  runtime before anything. gamma=1 OK but gamma=4 not → chunked multi-
  token GDN path (causality/chunk boundaries). Tiny-margin flips only →
  numerics (possibly acceptable if the batched path is redefined as the
  oracle); large-margin flips → do not build on it.

## Additional required tests (beyond F1b's E1-E3)

A. long same-k identity (1000+ tokens). B. forced-rejection rollback
(inject bad draft at pos 2-3, verify both states match fresh). C. prefix
audit + per-layer state hashes (find FIRST diverging layer). D. wall-
clock cost audit (T_serial_one_token, T_draft_4_E2, T_verify_batch5_E6,
T_state_copy).
