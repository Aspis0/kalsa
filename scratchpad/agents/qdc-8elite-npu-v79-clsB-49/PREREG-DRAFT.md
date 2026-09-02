# PREREG rev-0 — DRAFT, NOT QUEUED — cell #49: Class B root-cause discrimination (scale-pad vs VTCM state)

Status: DRAFT for owner review. Kit sha TBD (waits on the probe commit + dual-skel
build, both audited). Estimated device time ~12 min, cap 20 min. QDC ~641 min.

## What this cell decides

The #48-banked facts: the q4_0 2880/32/2880 NaN fires ONLY on the first
in-process execution of the shape (index 354 on this binary, data-independent),
identical re-executions pass, q8_0 same geometry passes. Host-side reading
(verified): repack tiles are packed contiguously at stride 576 — the 64-byte
scale-pad exists ONLY in VTCM, where the DMA copies 576-byte tiles onto
640-aligned slots. Two live theories:
- **T1 scale-pad**: `hvx_vmem(tile_src+512)` reads 64 valid + 64 never-written
  VTCM bytes; garbage there → NaN scale for some row.
- **T2 VTCM layout/state**: silent corruption elsewhere (undercount class).

## Kit v4 (dual skel)

Branch tip after the probe commit: `GGML_TEST_EXTRA_MM_FIRST` (prepend probes →
cold-process execution) + `HTP_ZERO_TILE_PAD` diagnostic skel variant (memset
of [tile_size, aligned_tile_size) per weight tile in VTCM after DMA, compile-
time guarded, default build untouched). Kit ships BOTH skels:
`libggml-htp-v79.so` (stock) and `libggml-htp-v79-zeropad.so`; the driver
selects by copying the chosen one into the live lib dir per run (sha-verified
each time). Everything else byte-identical to kit v3 lineage.

## Runs (all HTP0, judge ON, thermal pre-gate per run)

EXTRA (binding): `q4_0:2880,32,2880;q4_0:2880,32,2880;q4_0:2880,32,2880;q4_0:2880,32,2880`
All runs: `-o MUL_MAT`, `GGML_TEST_EXTRA_MM=$EXTRA`, `GGML_TEST_EXTRA_MM_FIRST=1`
→ the 4 probe occurrences execute FIRST in a cold process, then the full stock
census (stock also contains the shape once more → 5 occurrences total).

- **R1** stock skel — cold-head probe. Key readout: does occurrence #1 fail
  with a NaN when it is the first op the backend ever runs? Which occurrences
  fail, at which index?
- **R2** stock skel, identical repeat — cross-run stability of the R1 pattern.
- **R3** zeropad skel — THE discriminator. Same probe.
- **R4** zeropad skel, identical repeat — and doubles as the no-regression
  check for the zeroing (full census behind the probes: expect 549/550-class
  totals identical to stock modulo the NaN).

## Pre-declared interpretation grid (binding)

1. R1 NaN present (any occurrence) AND R3/R4 clean → **T1 CONFIRMED**
   (uninitialized VTCM scale-pad); the zeroing is the candidate fix (product
   fix then chosen between default-on memset and 640-wide DMA, separate step).
2. R1 NaN present AND R3/R4 NaN persists → **T1 REFUTED as sole cause**; T2
   (VTCM layout/state) promoted; next probe would need deeper DSP
   instrumentation (post-window).
3. R1 clean at cold-head but stock-position occurrence still NaN later in the
   same run → the trigger needs a DIRTY VTCM state from prior ops, not cold
   boot — uninit-memory family refined (garbage = prior kernels' leftovers);
   R3 comparison still binds as in 1/2.
4. Zeropad build introduces ANY new failure vs #48's baseline → zeroing probe
   itself unsafe; results VOID for T1, banked as a finding.
NaN indices recorded for every failing occurrence (binary-fixed-slot check:
354 expected on stock skel if layout unchanged; a moved index on the zeropad
skel is expected and non-binding — different binary).

## Non-goals

No speed, no PPL, no MUL_MAT_ID, no v73/v75, no product-fix decision (that is
a separate audited change after the verdict), DSP default build untouched.

## Ops

Skeleton as #48 (tunnel 6037, kit sha-verify on device per skel swap, full logs
pulled, grep-pair + Failing-tests binding, EXIT= binding, crash → NPU_DEAD,
launch-stop 16 min). Gate letter per the #48 F-8 addendum: every former-passing
shape must end OK or NS; any FAIL = defect finding.
