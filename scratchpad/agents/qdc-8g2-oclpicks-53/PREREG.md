# PREREG — Cell #53: OpenCL picks device gate on HDK8550 (Snapdragon 8 Gen 2, S23 class)

Date: 2026-09-03. The three upstream OpenCL cherry-picks
(branch `kalsa/opencl-picks-2026-09` = a0cabca6b + b7a5e926b + 8fe4bf8d3 +
12f6d9b6d) were integration-audited APPLY on 2/09 but never ran on a device.
The gate was parked waiting for the physical S23 (~7/09) or Samsung RTL; the
QDC HDK8550 unlocked today is the same SoC class (8 Gen 2 / Adreno 740) and
frees the gate NOW. Same-session A/B against the pinned baseline build.

## Questions

- Q1 correctness: with the PICKS build, does `test-backend-ops -b GPUOpenCL`
  pass MUL_MAT + MUL_MAT_ID + FLASH_ATTN_EXT on Adreno 740? (8fe4bf8d3 fixes
  OOB reads in Adreno image kernels; 12f6d9b6d fixes an FA WAR race — both
  claim correctness, they must not BREAK anything either.)
- Q2 perf: does b7a5e926b (q4_K/q5_K flat-mv uint loads, an A7x optimization)
  move llama-bench GPU decode on a q4_K model vs the baseline build,
  same device, same session?

## Binding interpretation grid

- G1: Q1 all-PASS on picks AND baseline all-PASS → picks are safe on 740;
  Q2 decides: tg128 gain ≥ +3% (mean of 3) → TAKE with perf claim;
  within ±3% → TAKE as correctness/hygiene only (no perf claim); worse
  than −3% → HOLD, escalate to owner.
- G2: picks FAIL any test that baseline PASSES → REGRESSION, the offending
  pick is quarantined; branch does not merge.
- G3: BOTH builds fail the same test → pre-existing 740 issue, recorded, not
  attributable to picks; picks judged on the remaining tests + Q2.
- G4: q4_K model fails to load → Q2 unanswerable; cell banks Q1 only.

## Fixed materials

- Picks kit: `~/kalsa-qdc/opencl-picks-cell/picks-kit-53.tgz`, sha256 head
  `5f8c6552724facc1` (build note inside; source 12f6d9b6d).
- Baseline kit: `~/kalsa-qdc/opencl-picks-cell/base-kit-53.tgz`, sha256 head
  `385c80a507de9a56` (source a0cabca6b, same recipe; llama-bench `757820b8…`,
  test-backend-ops `2b227f5f…`).
- Q2 model: a q4_K quant is REQUIRED (the pick targets q4_K/q5_K mv; the ship
  QAD-Q4_0 would not exercise it). Use `LFM2.5-2.6B-Q4_K_M.gguf` from the
  SAME HF repo/revision the app pins (LiquidAI/LFM2.5-2.6B-GGUF @ f4a289c8) —
  ship-model family, 1.6 GB, downloads to ~/kalsa-qdc/models/. Its sha256 is
  pinned in MODEL_SHA.txt in this folder before launch; the driver refuses to
  run without it. (Marco-Mini Q4_K_M was considered and rejected: 10.5 GB.)
- Thermal gate: same as #52 (cell #38 AMENDMENT-1 semantics).

## Procedure

1. One QDC Interactive Session on HDK8550, SSH+mirror, kalsa-mac key, 90 min,
   tunnel on 6037. One QDC job at a time (only after #52 is closed).
2. Recon as #52 (soc/cores/opencl-lib/mem) + CPU_MASK top-4.
3. Push BOTH kits into separate dirs (`$D/picks`, `$D/base`) + the q4_K model
   once; sha-verify everything on device.
4. Arms, each gated, caps in ():
   - A: correctness per-op, base/picks interleaved per op —
     tbo_{base,picks}_mm (20 min each), tbo_{base,picks}_mmid (20 min each),
     tbo_{base,picks}_fa = FLASH_ATTN_EXT (25 min each). On the 740 the FA
     arms also answer whether the 732's sub_group_shuffle_xor failure
     (cell #52) is tier-specific.
   - B: llama-bench -ngl 99 -fa 0 -p 512 -n 128 -r 3 on the q4_K_M model in
     ABBA order: bench_base_1, bench_picks_1, bench_picks_2, bench_base_2
     (25 min each). Q2 compares the mean of the two runs per build; the ABBA
     order cancels first-order thermal drift.
5. Pull, End Session.

Driver: `d_run.sh` in this folder, derived from #52 rev5 (T4 launch pattern,
adbT perl-alarm wrapper, re-entrant arms, no llama-cli probe). Same hostile
pre-run audit required before launch.

## Cost estimate

Push 2 kits (~12+7 MB) + the 1.67 GB Q4_K_M model. Ten arms: 6 correctness
(the FA pair may be slow) + 4 bench. Expected 50–80 min of the 1000 free
8 Gen 2 minutes; session booked at 120 min for headroom.

## Non-goals

- No NPU arm. No CPU-lane A/B (picks are GPU-only). No ship-model bench (that
  is #52's job on 7xx; the 740 ship numbers exist from the S23 campaigns).

## Amendment 1 (pre-launch, from AUDIT-PRERUN L1)

If a driver re-run fragments the B block (a bench arm fails and is re-run
while earlier arms are skip-banked), the ABBA drift-cancellation claim is
DROPPED for that session: the REPORT must reconstruct the actual execution
order from timestamps + thermal snapshots and either (a) present per-arm
means with the order disclosed and no drift-cancellation language, or
(b) re-run the full B block fresh if minutes allow. Positive-verdict G1
(perf gain ≥ +3%) may NOT be claimed from a fragmented B block unless the
gain also holds in the worst single pairing (coolest picks run vs warmest
base run).
