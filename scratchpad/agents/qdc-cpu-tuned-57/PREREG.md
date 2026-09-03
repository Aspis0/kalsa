# PREREG — Cell #57: honest CPU lane on the three new tiers (tuned build)

Date: 2026-09-03, owner-approved follow-up ("Bravo fai il follow up"). Cells
#52/#55/#56 measured the CPU lane with a kit lacking arch flags; every
report bound a "CPU build-suspect, no crossover constants" caveat. This cell
replaces those CPU numbers with a tuned build and settles the caveat.

## Question

With a CPU-tuned llama-bench (`GGML_CPU_ARM_ARCH=armv8.7-a+dotprod+i8mm+fp16`,
**no GPU backend compiled in** — pure CPU by construction), what are pp512 /
tg128 for the ship model (LFM2.5-2.6B QAD-Q4_0, sha `a247afd6…`) on:
S1 = QRD7675 (7+ Gen 3), S2 = QRD8635 (8s Gen 3), S3 = QRD8650 (8 Gen 3)?

## Binding interpretation grid

- G1 per tier: tuned-CPU pp512 vs the same tier's GPU pp512 (#52/#56/#55)
  decides the honest prefill crossover: GPU ≥ 2× tuned-CPU → GPU prefill
  lane confirmed; within 2× → crossover is contested, router needs the
  per-device probe to decide at runtime; tuned-CPU ≥ GPU → the tier joins
  the 740 regime (CPU prefill wins).
- G2 decode: tuned-CPU tg128 vs GPU tg128 same rule with threshold 1.25×
  (decode differences are smaller; below 1.25× = contested).
- G3: any tier where tuned ≤ 1.15× untuned CPU (i.e. tuning changed
  nothing) → the "build-suspect" caveat was WRONG for that tier and gets
  retracted with that evidence; the old CPU numbers stand.
- ⚠️ The 750 GPU comparators inherit the #55 Amendment (post-hoc split,
  owner sign-off pending): G1/G2 verdicts for the 8650 are PROVISIONAL
  until that sign-off.

## Fixed materials

- Kit: `~/kalsa-qdc/cpu-tuned-kit-57.tgz` sha `573f1440229f4751`
  (llama-bench `e818d3fe…`, source kalsa/governor-v0.2 @ 1a33da0f6,
  BUILD_NOTE inside).
- Model: same pinned LFM2.5-2.6B-QAD-Q4_0 (`a247afd6…`).
- Thermal gate #38, taskset top-4 bare-hex mask from recon, -t 4 -p 512
  -n 128 -r 3, all #52 ops lessons (T4 launch, adbT caps, re-entrant arms,
  ref-clicks + verified End).

## Procedure

Three sequential sessions (one QDC job at a time), 30 min booked each,
driver `d_run.sh <job_tag>` in this folder (single gated arm per session:
`bench_cpu_tuned`). Expected ~6-8 min billed per session.

## Non-goals

No GPU/NPU arms; no 8 Elite (its CPU lane was measured in-campaign with
proper builds); no plateau study (3-rep means, same as the comparators).
