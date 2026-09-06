# PREREG — logit-margin oracle for GPU-vs-CPU prefill correctness in the app (cell logit-oracle, 6/09)

Owner 6/09: "l'importante è che non facciamo passare una cosa che poi è sbagliata e generare cose sbagliate".
Design principle, binding: the new oracle must be at least as strict as the token oracle wherever the CPU is
confident, and stricter than it where the token oracle is blind (equal tokens with drifted probabilities).

## Why
The strict token oracle (32 greedy ids, CPU-prefill vs GPU-prefill) FAILs on Adreno 732/735/750 at index 7 with a
byte-identical GPU sequence on the three GPUs, while the 732 passes all kernel tests. A greedy near-tie flip cannot
be told from a real error by token equality. Evidence: S5b runs 8/9/10, ALIVE 52-54, PREREG post hoc run 9.

## What is measured
For each of the 32 continuation steps, in BOTH arms, the pre-sampling top-5 (token id, logprob) after the prompt
(A = CPU prefill, B = GPU prefill, decode on CPU in both). Two modes:
- **TF (teacher-forced, primary):** arm B is constrained (literal grammar) to emit exactly arm A's 32 tokens, so all
  32 steps are comparable; the logged probabilities must be the PRE-grammar distribution (otherwise the mode is
  invalid and only mode G counts).
- **G (free greedy, secondary):** as today; comparable steps = those before the first divergence.

## Rules (PASS requires ALL; any violation = FAIL)
R1 Confident disagreement = FAIL: at any comparable step where CPU margin p1−p2 ≥ 0.03, B's top-1 must equal A's top-1.
R2 Distribution agreement: at every comparable step, for every token in A's top-5 with pA ≥ 0.02, the token is in
   B's top-5 and |logpB − logpA| ≤ 0.10 nats; and |pB(top1) − pA(top1)| ≤ 0.02.
R3 Divergences (mode G only): a divergence is allowed only if CPU margin < 0.03 AND B's choice is A's #2; at most 1
   divergence per 32 steps.
R4 Coverage: mode TF must yield 32 comparable steps on ≥ 2 same-turn pairs per board; otherwise the result is
   descriptive only.
R5 Sanity (before any board is judged): the 8 Elite (known-good GPU) must PASS R1–R4 on ≥ 2 pairs; a deliberately
   broken kernel build (e.g., the baseline 750 kit's failing path exercised, or a fault-injected build) must FAIL.
   If either sanity check does not hold, the oracle is rejected and the token oracle stays.
R6 No automatic promotion: a PASS is reported; enabling GPU prefill on a generation in production is the owner's
   decision on the numbers.
Thresholds (0.03 / 0.02 / 0.10 nats) are fixed here before any data; they may be tightened after the sanity runs,
never loosened.

## Implementation (to be studied first, then built)
App (feat/governor-in-app): the bench path emits `KALSA_BENCH_PROBS {"turnId","step","top":[[id,logp]×5]}` per
step when `kalsa.bench.sampling=greedy` (existing) and a new bench key `kalsa.bench.probs=1`; teacher forcing via a
bench key `kalsa.bench.force_ids` (the 32 ids from arm A) applied as a literal grammar in arm B; both bench-only.
Feasibility questions (Luna): does llama.rn 0.12.8 expose per-step `n_probs`/`completion_probabilities` with
pre-sampling (pre-grammar) probabilities, or `post_sampling_probs` toggles; is a grammar per completion supported
through the patched API; cost per step. Driver: parse the probs from logcat, compute R1–R3 per pair, oracle column
becomes PASS/FAIL/DESCRIPTIVE with the failing rule named.
