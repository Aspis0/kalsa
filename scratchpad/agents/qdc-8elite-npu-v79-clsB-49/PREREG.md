# PREREG — cell #49 `npu-v79-clsB-49`: Class B root-cause discrimination (scale-pad vs VTCM state)

Status: rev-1 FINAL. Draft shown to the owner; **owner pre-approved queueing 2/09
in chat ("Si ti do già l'ok")**. Gate before queueing: hostile audit of prep
commit `ca82efa8b` must be APPLY (in flight at freeze); any audit FIX is applied
and re-verified before the kit is built. Locked before any measurement.

## What this cell decides

#48-banked facts: the `q4_0 2880/32/2880` NaN fires ONLY on the first
in-process execution of the shape (index 354 on the certified binary,
data-independent), identical re-executions pass, q8_0 same geometry passes.
Verified architecture: host repack packs tiles CONTIGUOUSLY at stride
`tile_size` (`repack_q4_0_tiled`, ggml-hexagon.cpp:457-505); the DSP DMAs
them onto `aligned_tile_size` slots in VTCM with copy width `tile_size`
(matmul-ops.c:2370-2372, :2425-2427) → the per-tile pad
[tile_size, aligned_tile_size) exists ONLY in VTCM and is NEVER written
(q4_0/iq4_nl 576→640, q8_0 1088→1152, mxfp4 544→640; q4_1 640→640 no pad).
Theories: **T1** scale-pad (`hvx_vmem(tile_src+512)` reads 64 valid + 64
uninit pad bytes); **T2** VTCM layout/state corruption elsewhere.

## Session

QDC interactive, QRD8750 / 8 Elite / Android 16 ONLY, name `npu-v79-clsB-49`,
SSH + mirror, key `kalsa-mac`, cap **20 min**, launch-stop 16 min (over 960 s).
Tunnel `ANDROID_ADB_SERVER_PORT=6037` (NEVER 5037). No models. QDC ~641 min.

## Kit v4 (dual lib dir — no on-device file swapping)

- `bin/` = kit v3 bins with `test-backend-ops` REPLACED by the `ca82efa8b`
  build (adds `GGML_TEST_EXTRA_MM_FIRST`); other bins byte-identical to v3.
- `lib/` = kit v3 libs byte-identical — **stock skel = certified
  `37131e07…`** (same binary as banks #43-#48; the fresh stock rebuild
  `afa7ef81…` is discarded, build-nondeterminism, not used).
- `lib-zeropad/` = same libs but `libggml-htp-v79.so` = the
  `HTP_ZERO_TILE_PAD` diagnostic skel (`398879cc…`).
- SHA256SUMS covers both dirs; on-device verify binding.

## Runs (all HTP0, judge ON `GGML_TEST_PLAIN_HOST=1`, thermal pre-gate per run)

EXTRA (binding): `q4_0:2880,32,2880;q4_0:2880,32,2880;q4_0:2880,32,2880;q4_0:2880,32,2880`
All runs: `-o MUL_MAT`, `GGML_TEST_EXTRA_MM=$EXTRA`,
`GGML_TEST_EXTRA_MM_FIRST=1` → 4 probe occurrences run FIRST in a cold
process, then the full stock census (which holds the shape once more → 5
occurrences/run).

- **R1** `lib/` (stock certified) — cold-head probe.
- **R2** `lib/` repeat — cross-run stability.
- **R3** `lib-zeropad/` — THE discriminator.
- **R4** `lib-zeropad/` repeat — + no-regression check for the zeroing
  (full census behind the probes; expect totals identical to stock modulo
  the NaN and modulo nothing else).

Each run: full log pulled raw; binding counts = grep pair + `Failing tests:`
list + `tests passed` line; NaN indices grepped per occurrence; census.awk
split reported-not-binding. Crash ⇒ NPU_DEAD, skip remaining. `over()` ⇒ skip.

## Pre-declared interpretation grid (binding)

1. R1/R2 NaN present AND R3/R4 clean → **T1 CONFIRMED** (uninit VTCM
   scale-pad); the zeroing is the candidate fix (product fix — default-on
   memset vs 640-wide DMA — is a separate audited step, NOT this cell).
2. R1/R2 NaN present AND R3/R4 NaN persists → **T1 REFUTED as sole cause**;
   T2 promoted; deeper DSP instrumentation post-window.
3. R1/R2 clean at cold-head BUT the stock-position occurrence (mid-census)
   still NaNs → trigger needs DIRTY VTCM from prior ops, not cold boot;
   uninit-memory family refined; the R3/R4 comparison still binds as 1/2.
4. Zeropad arm shows ANY new failure vs the #48 baseline (beyond the NaN) →
   zeroing probe unsafe; T1 readout VOID; banked as a finding.
NaN index recorded for every failing occurrence. Stock arms expect index 354
(same certified binary as #48); zeropad indices non-binding (different binary).
Gate letter (per #48 F-8 addendum): every former-passing shape must end OK or
NS; any FAIL = defect finding.

## Non-goals

No speed, no PPL, no MUL_MAT_ID runs, no v73/v75, no product-fix decision,
default DSP build untouched (guarded off).

## Ops

Skeleton as #48: connect.sh → tunnel 6037 → d_run.sh; kit push + on-device
sha verify; per-run `HTP_ENV` points LD_LIBRARY_PATH/ADSP_LIBRARY_PATH at the
run's lib dir (no file swapping); `Hexagon Arch version v79` required from
list-devices (stock dir) before R1 else METHOD-VOID; EXIT= binding; events log.
