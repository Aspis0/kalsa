# PREREG — does the f32-multiply kernel fix remove the in-app GPU-prefill divergence?

Cell `gemm-f32-ship`. Written 2026-09-07, **before any APK-B exists and before any
device run**. Extends the instrument and the rules of cell `logit-oracle`; it does not
re-derive them.

## Hypothesis

The in-app GPU-prefill divergence measured on the Adreno 750 (ALIVE 55) is caused by
the half-precision **product** in `gemm_noshuffle_q4_0_f32.cl` (cause **A**), and is
therefore removed by computing that product in f32.

The competing cause (**B**) is the 750-only driver/compiler defect that fails 20
`test-backend-ops` MUL_MAT cases in the family `f16|bf16 x f32, m=128 n=1 k=1056
k_v=2112` batched (ALIVE 38), absent on the 735 (ALIVE 39) and untouched by this work.

Both can contribute. The experiment measures how much of the divergence A accounted for.

## Arms — one variable

- **A (control)**: APK `kalsa-apk-arm64-v8a-debuggable-8269aa24…`, app commit
  `8269aa2`, fork pin `3bec271fd`. Already built (CI run 34070458734, 7/09 01:11 UTC)
  and **already measured**: it is the exact APK that produced the ALIVE 55 numbers.
- **B (treatment)**: same app commit `8269aa2`, fork pin bumped to `513bf4cea`
  (= `3bec271fd` + the one-file f32-multiply commit). Nothing else differs.

Registered before the run: the two APKs differ by exactly one source file,
`ggml/src/ggml-opencl/kernels/gemm_noshuffle_q4_0_f32.cl`, 22 insertions / 17 deletions.
If the vendored diff on the app side turns out to contain anything else, the cell is
VOID and must be re-cut.

## Board and protocol

QRD8650 (SM8650, Adreno 750, V75) on QDC — the same board family as ALIVE 55.
Protocol: cell `logit-oracle`, mode TF (teacher-forced, primary), 32 forced steps,
driver `qdc-governor-s5/d_run.sh` with the governor forced onto arm B via
`kalsa.bench.governor_force`.

## TWO readings, and they are not the same thing

This is the part that must be fixed before data, because reading only the first would
bank a false headline.

### Reading 1 — the promotion gate (R1-R6 of `logit-oracle`), strict by design

R1-R6 are the owner's "never let a wrong thing through" gate. R2 in particular demands
`|pB(top1) - pA(top1)| <= 0.02` at **every** one of the 32 steps.

**Pre-registered expectation: this gate will probably still FAIL, even if the fix works
exactly as measured.** The bench-level fix takes same-top-token from 62.8% to 94.8%, not
to 100%; over 32 steps that is ~1.7 expected top-1 flips. A FAIL here is therefore NOT
evidence that the fix failed, and must not be reported as such. R6 already forbids
automatic promotion; nothing here changes that.

### Reading 2 — the effect size, which is what actually answers the hypothesis

Compare against the pre-fix values measured on the same board with the same protocol
(ALIVE 55, session 807970). Registered thresholds, chosen now:

| quantity | pre-fix (A) | fix works (A dominated) | fix irrelevant (B dominates) |
|---|---|---|---|
| median \|dp1\| | 0.0861 | <= 0.02 | >= 0.06 |
| median max\|dlogp\| | 3.444 nats | <= 0.5 | >= 2.5 |
| steps with \|dp1\| > 0.02 | 21/32 | <= 8/32 | >= 16/32 |
| top-1 flips where CPU is confident | 8/32 | <= 2/32 | >= 6/32 |

An outcome between the two columns is reported as partial: A contributed, B remains.
No column is a promotion.

### The instrument check, which is free

Re-run the CPU-vs-CPU control. Pre-fix it read 936/936 steps identical bit for bit,
`max_dlogp = 0.0000`. If it does not read 0.0000 this time, the run is VOID before any
GPU number is looked at.

## Speed, secondary and conditional

Only if the run yields at least one valid pair, record prefill wall time in both arms.
Pre-fix, the same pair read GPU 4.105 s vs CPU 7.294 s = **1.78x**. The bench-level cost
of the fix is 0.659x, so the registered point prediction is **1.17x** (1.78 x 0.659).
Registered interval for "the bench cost transfers": 1.05x-1.30x. Outside it, the cost
does not transfer in-app and that is itself a finding. n=1 pair is descriptive only.

## Thermal and validity constraints, from prior runs

- On the 750 only the FIRST pair of a session fits under the 900 s cooldown ceiling
  (ALIVE 55). Budget one pair per session, or plan the cooldown explicitly.
- Every turn's route facts must be read from the log. Two different mechanisms can hand
  a GPU arm a CPU number: `KALSA_GPU_FALLBACK` in `LlamaService.ts:1438` after an init
  failure, and the governor's own thermal degradation (`admit_prefill … waiting for a
  safe tabled chunk` -> CPU prefill, seen live in run 5). A turn whose route facts say
  CPU is not a B turn; it is discarded, not averaged in.
- Tools must be OFF in the bench cells (`kalsa.web.enabled`, `kalsa.tools.*`): a tool
  call adds a round and voids the turn.

## What is NOT claimed here

- Nothing about 732 / 735 / 8 Elite: not measured with the fixed kernel.
- Nothing about Q4_K_M models: `gemm_noshuffle_q4_k_f32.cl` is a separate kernel and a
  separate arm (see PLAN.md, coverage gap).
- Nothing about energy per token, which no one has measured on any backend.

## Amendment 1 — the q4_K arm, pre-registered 2026-09-07 before any device run

Added because the audit established a fact I had wrong: the app's DEFAULT model is
`qwen3.5-4b`, quant `Q4_K_M` (`ModelRegistry.ts`, `default: true`), so the default prefill
path is `gemm_noshuffle_q4_k_f32.cl`, not the q4_0 kernel. That kernel is now fixed the
same way — and **nothing about it is measured**. Shipping an unmeasured cost on the
default path is acceptable only if it is measured next, not indefinitely.

Instrument: identical to cell `adreno-acc-type` — `llama-perplexity --kl-divergence-base`
(CPU) + `--kl-divergence` (GPU), one shared CPU base, ~35 s per arm, on QRD8650 /
Adreno 750, with the per-variant provenance probe (`llama-bench -v`, header must contain
`selected platform: 'QUALCOMM`).

Model: a Q4_K_M GGUF, not the Q4_0 shipping model — the point is to exercise the q4_K
kernel. The catalogue's `qwen3.5-4b` Q4_K_M file is the right one; its sha goes in the
REPORT before any reading is taken.

Registered readings, in this order:
1. **Fidelity, unfixed q4_K**: CPU vs GPU at the pre-fix kernel. No prediction is
   registered for the magnitude — q4_0's 0.4538 is NOT a prediction for q4_K, whose
   dequantisation carries a min/offset term and super-block scales.
2. **Fidelity, fixed q4_K**: same, at 67c73d26c.
3. **Cost**: `pp512` in both arms, cooled and in randomised order, with the cooldown
   applied **before the first bench step too** — the defect that failed the validity
   reading of cell `adreno-operand-b` (5.71 °C spread against 2 allowed).

Decision rule, fixed now: the q4_K fix is kept if reading 2's median KLD is below reading
1's by at least the factor the same instrument showed for q4_0 divided by ten (i.e. a
≥9.6x reduction), AND the cost in reading 3 is ≥0.55x. Below either, the q4_K fix goes
back on the bench and the default model's GPU prefill stays off — it does not ship on
argument-by-analogy from q4_0.

This arm is NOT a blocker for the in-app A/B above: that one runs the Q4_0 shipping model
and does not touch the q4_K kernel.
