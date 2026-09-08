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

Added because which kernel runs is decided by the **phone**, not by one default model
(owner correction, verified in `contextProfile.ts:89-99` + `ModelRegistry.ts:212,244`):
low/mid-RAM phones are recommended `lfm2.5-2.6b` QAD-Q4_0 and run
`gemm_noshuffle_q4_0_f32.cl`, which is what the banked numbers describe; high-RAM phones
(>= 6.9 GB) are recommended `qwen3.5-4b` Q4_K_M and run `gemm_noshuffle_q4_k_f32.cl`,
about which **nothing is measured**. So this arm is not a footnote: it covers the entire
high-RAM half of the fleet, and the QDC boards themselves (12+ GB) are high-tier.

Instrument: identical to cell `adreno-acc-type` — `llama-perplexity --kl-divergence-base`
(CPU) + `--kl-divergence` (GPU), one shared CPU base, ~35 s per arm, on QRD8650 /
Adreno 750, with the per-variant provenance probe (`llama-bench -v`, header must contain
`selected platform: 'QUALCOMM`).

Model: **`LFM2.5-2.6B-Q4_K_M.gguf`**, already on the Mac
(`~/kalsa-qdc/models/`, 1 674 455 040 bytes), not the catalogue's Qwen 4B. Same weights as
the Q4_0 arm, different quantisation — so the q4_K fidelity number is directly comparable
to the q4_0 one measured on this board, with the kernel as the only structural difference.
It also needs no download. Its sha goes in the REPORT before any reading is taken.
(The Qwen 4B stays the model the *app* defaults to; nothing here depends on measuring that
particular file, only on measuring the kernel it uses.)

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

## Amendment 2 — the cooldown WAIT ceiling, pre-registered 2026-09-07 before the run that uses it

Three consecutive attempts on QRD8650 (session 808521, jobs `sa812590`, `sa812590b`,
`sa812590c`) failed to produce a single arm-B turn. All three died at the same gate, and
the measured numbers say why:

| job | A1 skin start -> end | B1 cooldown | outcome |
|---|---|---|---|
| sa812590 | 29.601 -> 42.573 | reached 36.93 in 390 s | killed by my 40-min deadline mid-typing |
| sa812590b | 38.473 -> 47.123 | 900 s ceiling at 37.934 | B1 VOID hot, turn skipped, no data |
| sa812590c | 34.071 -> 45.549 | 900 s ceiling at **37.224** | B1 VOID hot, missed by **0.22 °C** |

One A turn raises the skin by 9-13 °C. Idle cooling is fast at high delta and decays to
~0.2 °C/min near 37; from ~45.5 °C the device needs roughly **1000-1100 s** to cross 37.0,
and `d_run.sh` allows `COOL_MAX_S=900`.

**What is NOT changed, and why.** The obvious "fix" — raising `COOL_TARGET_C` above 37.0 —
would invalidate the experiment. The governor's own policy degrades a turn to CPU prefill
at WARM (skin ≈ 38 °C, measured live in S5 run 5, ALIVE 48). A B turn started above that
would run on the CPU and could return a meaningless PASS. The target therefore stays
**37.0**, exactly as in ALIVE 55.

**What is changed:** `COOL_MAX_S` 900 -> **1500**. This changes only how long the harness
is willing to wait, never the thermal state in which arm B runs. The B turn still begins
at <= 37.0 °C, so every reading stays comparable to ALIVE 55.

Registered consequence: the extra wait costs ~5 min per pair, so one pair per session
remains the budget.

No other parameter, threshold or code path is touched. `DEADLINE_MINUTES` stays at the
value passed on the command line (60), which Amendment-2 runs must respect: a pair now
needs ~20 min (A) + ~18 min (cooldown) + ~15 min (B).

## Amendment 3 — the q4_K arm moves to Qwen3.5-4B on the Adreno 735, registered 2026-09-08 before the run

Owner decision, taken on a hard constraint. Amendment 1 registered the q4_K arm as
`LFM2.5-2.6B-Q4_K_M.gguf` on the QRD8650 / Adreno 750. Two things changed:

1. **The owner asked for the real high-tier model**, `qwen3.5-4b` Q4_K_M — the one a
   high-RAM phone is actually recommended (`ModelRegistry.ts`, `recommendForTiers: ["high"]`).
   That is what ships on that tier, so that is what gets measured.
2. **The QRD8650 has 35 minutes left of 249.** A pair needs ~55. The budget was spent by a
   mistake of mine, recorded in full below, so the 750 is out for now.

Registered design:

- **Board**: QRD8635 / SM8635 / **Adreno 735** (889 min). Chosen deliberately, and the
  trade-off is stated up front: ALIVE 39 measured the 735 clean on `test-backend-ops`
  (MUL_MAT 925/925), i.e. it does **not** carry the 750-only f16/bf16-batched driver
  defect. So this arm answers *"is the q4_K kernel fidelity-fixed?"* without that
  confound — and it does **not** answer anything about V75, which is a different
  generation. Nothing measured here may be quoted as evidence about the Adreno 750.
- **Model**: `Qwen3.5-4B-Q4_K_M.gguf`, `unsloth/Qwen3.5-4B-MTP-GGUF` @
  `86835bf9949e4d14d6860f7910b1340ad4f271a9`, 2 834 975 040 bytes (matches the registry's
  `sizeBytes`), sha256 **`3874209241c9a397e2f62cd3f70f80fd2dfbf0dfccb6838416bdb48a714e8630`**.
  Recorded here before the run so a substituted file cannot pass unnoticed.
- **Route**: V73 has `GPU_PREFILL_CORRECT.V73 = false`, so arm B must be enabled through the
  pre-existing bench lever `kalsa.bench.governor_force`, exactly as ALIVE 39/52/54 did. That
  lever is not part of production policy and this run does not change it.
- **Instrument and rules**: unchanged — logit oracle, 32 teacher-forced steps, thresholds
  R1-R6 as registered in cell `logit-oracle`. Amendment 2's `COOL_MAX_S=1500` stands.
- **Driver parameterisation**: `d_run.sh` hardcodes `MODEL`, `MODEL_SIZE`, `MODEL_SHA`,
  `MODEL_DIR`, `MODEL_FILE` for the LFM model. Only those five constants change, to the
  Qwen values above with `MODEL_DIR` matching the registry id `qwen3.5-4b`. No threshold,
  no gate, no code path is touched. The diff must be exactly those five lines.

Registered reading, same shape as the q4_0 arm: the binary verdict is expected to be
uninformative (R2 is a promotion gate); the answer is the continuous metrics. **No pre-fix
baseline exists for q4_K on this board**, so unlike the q4_0 arm there is no before/after
pair — this arm measures the *absolute* CPU-vs-GPU agreement with the fixed kernel. The
registered success condition is therefore: **R1 satisfied (zero confident top-1 flips)** and
median |Δp₁| of the same order as the fixed q4_0 arm (0.0014), i.e. **≤ 0.01**. A median
above 0.05 means the q4_K fix does not deliver what the q4_0 fix delivered, and the high
tier goes back on the bench.

### Recorded error — how the 750's budget was spent

QDC bills **wall-clock session duration**, not active device use. I asserted the opposite
earlier in the session and extended session 808521 by three hours, then kept it open across
two device cool-downs and the analysis: 214 minutes consumed for ~50 minutes of measurement.
Standing rule from now on: open the session only when driver, APK and model are ready on
the Mac, and end it the moment the driver exits — never hold it open to cool a device or to
read results.
