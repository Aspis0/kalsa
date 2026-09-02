# PREREG — cell #50 `npu-v79-clsB-50`: T1 discriminator against a LIVE NaN

Status: rev-1. **Owner approved queueing 2/09 in chat ("Ok approvo cella 50").**
Gate before queueing: one hostile audit (different model from the author) of this
PREREG + d_run.sh must be APPLY; any FIX applied and re-verified first. Locked
before any measurement.

## Why this cell exists (what #49 could not answer)

#49 (job 797032, banked pending) showed the Class B NaN does NOT fire at cold
process head: 4 prepended probes of `q4_0 2880/32/2880` all passed on the
certified stock skel, and the census occurrence — warmed by those probes — was
masked. Net: the trigger needs DIRTY VTCM/process state from prior ops, but the
zeropad discriminator (T1 scale-pad vs T2 other-VTCM-state) got NO signal
because stock never NaN'd. #49's design flaw: `GGML_TEST_EXTRA_MM_FIRST=1` on
every run destroyed the reproduction condition. Confound: #49 also changed the
host test binary (NaN index is binary-dependent: #46→305, #48→354).

This cell removes both problems: it replays #48's EXACT reproduction config —
same host binary (the 153fdbafd build that produced index 354 twice), same
EXTRA string APPENDED (no FIRST), same certified skel — and adds the zeropad
skel as the only varied factor.

## Session

QDC interactive, QRD8750 / 8 Elite / Android 16 ONLY, name `npu-v79-clsB-50`,
SSH + mirror, key `kalsa-mac`, cap **20 min**, launch-stop 16 min (over 960 s).
Tunnel `ANDROID_ADB_SERVER_PORT=6037` (NEVER 5037). No models. QDC ~635 min.

## Kit v5 (dual lib dir + dual binary)

Kit v4 layout plus ONE added file:

- `bin/test-backend-ops-153f` = the kit-v3 binary byte-identical (the #48
  reproduction binary, sha `5cf3565b…` — matches kit-v3 SHA256SUMS and #48's
  on-device `bin/test-backend-ops: OK`). ALL runs in this cell use THIS binary.
- `bin/test-backend-ops` (ca82efa8b) stays in the kit but is NOT used.
- `lib/` = certified stock skel `37131e07…` (same as banks #43-#49).
- `lib-zeropad/` = `HTP_ZERO_TILE_PAD` skel `398879cc…`.
- SHA256SUMS over bin/ lib/ lib-zeropad/; on-device verify binding.

## Runs (all HTP0, judge ON `GGML_TEST_PLAIN_HOST=1`, thermal pre-gate per run)

EXTRA (binding, byte-identical to #48 d_run.sh line 12):
`q4_0:2880,32,2880;q4_0:2880,32,2880;q4_0:2880,32,2880;q4_0:2880,32,1024;q8_0:2880,32,2880;q4_0:2880,64,2880`
All runs: `-o MUL_MAT`, `GGML_TEST_EXTRA_MM=$EXTRA`, **FIRST unset** (append),
binary `test-backend-ops-153f`.

- **R1** `lib/` (stock certified) — #48 replica; expect 545/546 with
  `NaN at index 354` on the census occurrence (first in-process execution).
- **R2** `lib-zeropad/` — THE discriminator, same config, only the skel varies.
- **R3** `lib/` repeat — repro stability.
- **R4** `lib-zeropad/` repeat — discriminator stability.

Order R1→R2→R3→R4 interleaves the arms so a mid-cell crash still leaves one
stock/zeropad pair. Each run: full log pulled raw; binding counts = grep pair +
`Failing tests:` list + `tests passed` line; NaN indices grepped per run.
Crash ⇒ NPU_DEAD, skip remaining. `over()` ⇒ skip.

## Pre-declared interpretation grid (binding)

1. R1/R3 NaN present AND R2/R4 clean → **T1 CONFIRMED** (uninit VTCM
   scale-pad is the poison source); the pad zeroing is the candidate fix
   (product-fix decision — default-on memset vs 640-wide DMA — is a separate
   audited step, NOT this cell).
2. R1/R3 NaN present AND R2/R4 NaN persists → **T1 REFUTED as sole cause**;
   T2 promoted; deeper DSP instrumentation post-window.
3. R1/R3 clean (no NaN even in the #48-exact replica) → repro LOST on this
   rack/day; cell banked as METHOD-LIMIT (repro non-determinism across
   sessions becomes a first-class finding); zeropad arms non-binding.
4. Zeropad arm shows ANY failure beyond the (possibly absent) NaN → zeroing
   unsafe in the append config; T1 readout VOID; banked as a finding.
5. Mixed (exactly one stock run NaNs) → repro is flaky; verdict on T1 only if
   the paired zeropad run in the same half is clean AND grid-4 holds; else
   METHOD-LIMIT.

Expected stock NaN index: 354 (same binary + skel as #48). A different index
with the same binary = new fact, banked. Gate letter (per #48 F-8): every
former-passing shape must end OK or NS; any FAIL beyond the expected NaN =
defect finding.

## Non-goals

No speed, no PPL, no MUL_MAT_ID, no v73/v75, no product-fix decision, no
cold-head probes (that was #49), default DSP build untouched.

## Ops

Skeleton as #49: connect.sh → tunnel 6037 → d_run.sh; kit push + on-device
sha verify; per-run LD_LIBRARY_PATH/ADSP_LIBRARY_PATH at the run's lib dir;
`Hexagon Arch version v79` required from list-devices (stock dir) before R1
else METHOD-VOID; EXIT= binding; events log; End Session right after DONE.
