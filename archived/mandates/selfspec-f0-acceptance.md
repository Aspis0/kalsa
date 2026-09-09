# SELFSPEC F0 — acceptance fail-fast: is low-k KEXP a viable draft for full-k? (PC ONLY)

Reopening sanctioned by PLAN (MTP/spec closure clause: "riapertura solo NPU/GPU
verify + acceptance >=60%"). Since K4, we have two independent correct engines for
the 35B (CPU and GPU-split). The new idea: SELF-speculation — draft = same KEXP
model at k=2 (fast, quality irrelevant), verify = k=6 batched. Before ANY device or
engine work, measure the ONLY number that decides: the acceptance rate.

## Task (PC only — do NOT touch any phone; if MarcoKEXP/LFM2.5 PPL jobs are running,
WAIT for the PC to be idle: poll every 10 min like the LFM pipeline does)

1. Binary: PC `bmoe-cli` (campaign build or k4 PC build — record sha). Model: KEXP.
2. For 4+ diverse prompts (reuse campaign speed prompts + 2 longer ones): generate
   N=300 tokens GREEDY with the TARGET config (k=6 drop 0.65, campaign flags,
   -c 4096). Save the token stream.
3. Same prompts, DRAFT config (k=2, same drop or drop off — try both): for each
   position t in the target stream, teacher-force target[0..t-1] and record whether
   draft's greedy next-token == target[t]. (Practical method: generate draft greedy
   continuations restarted from the target prefix in windows — or if bmoe-cli
   supports per-token logits dump, use it; document the method honestly. Exact
   per-position teacher-forcing preferred; windowed approximation acceptable if
   costs explode — label which.)
4. Report: per-prompt and pooled acceptance rate; acceptance vs position curve;
   the same for k=3 if k=2 disappoints; and the speculative speedup MODEL:
   expected tokens/step = f(acceptance, draft_len gamma) for gamma 2-6, combined
   with measured engine speeds (CPU k6 2.90 @cache1000 & 5.86 @cache2000; GPU-split
   k6 2.02; CPU k2 speed — MEASURE it on PC as a ratio vs CPU k6, and note device
   ratios will differ).
5. Pre-declared gate: pooled acceptance >=60% at gamma<=4 for the lane to open.
   Below: SELFSPEC dead, write the epitaph with the curve.

Deliverables: `results/selfspec_f0/` (streams, acceptance CSV, method notes),
`reports/moe-selfspec-f0.md`, task report ending DONE.
