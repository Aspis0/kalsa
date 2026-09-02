# PREREG — cell #51 `npu-v79-clsB-51`: does upstream 71102a73f (descriptor type check) cure the Class B NaN?

Status: rev-1. **Owner approved 2/09 in chat ("Perfetto, fai cella 51").**
Gate before queueing: one hostile audit (different model from the author) of
this PREREG + d_run.sh must be APPLY; any FIX applied and re-verified first.
Locked before any measurement.

## What this cell decides

Upstream llama.cpp fixed on 22 Jul (commit `71102a73f`, PR #25968) a missing
tensor-TYPE check in the hexagon host's descriptor-reuse test
(`same_shape()`): a cached descriptor from a PRIOR op with identical
shape/strides but different type could be reused. Our branch carries the buggy
version (verified: `ggml-hexagon.cpp:1186` had no type term). Mechanism match
with the banked Class B fingerprint (ALIVE rows 32-34): cold process = no
prior descriptors → no NaN (#49); dirty state = stale-descriptor hit on the
shape's FIRST execution → NaN (#48/#50); which descriptor is hit depends on
session history → index moves (#50); the corruption is HOST-side metadata →
DSP pad zeroing is inert (T1 refuted, consistent). Cherry-picked as
`022458a28` on `kalsa/npu-judge-v79` (clean, 2 lines).

This cell replays the #50 configuration (which reproduced the NaN 2/2) with
ONE file varied between arms: `libggml-hexagon.so` buggy vs fixed.

## Session

QDC interactive, QRD8750 / 8 Elite / Android 16 ONLY, name `npu-v79-clsB-51`,
SSH + mirror, key `kalsa-mac`, cap **20 min**, launch-stop 16 min (over 960 s).
Tunnel `ANDROID_ADB_SERVER_PORT=6037` (NEVER 5037). No models. QDC ~631 min.

## Kit v6 (dual lib dir, single-file delta)

- `bin/` = kit v5 bin dir byte-identical; ALL runs use
  `bin/test-backend-ops-153f` (`5cf3565b…`, the #48/#50 reproduction binary).
- `lib/` = kit v3 libs byte-identical (CONTROL arm): buggy
  `libggml-hexagon.so` `e91fbcef…`, certified skel `37131e07…`.
- `lib-fix/` = same libs but `libggml-hexagon.so` REPLACED by the `022458a28`
  build, stripped: sha `e95fa35e…` (777,464 B vs 777,416 B stock — the only
  source delta between the two libs is the 2-line type check; ca82efa8b in
  between touches no host-lib source). Skel byte-identical certified
  `37131e07…` in BOTH dirs.
- SHA256SUMS over bin/ lib/ lib-fix/; on-device verify binding.

## Runs (all HTP0, judge ON `GGML_TEST_PLAIN_HOST=1`, thermal pre-gate per run)

EXTRA (binding, byte-identical to #48/#50):
`q4_0:2880,32,2880;q4_0:2880,32,2880;q4_0:2880,32,2880;q4_0:2880,32,1024;q8_0:2880,32,2880;q4_0:2880,64,2880`
All runs: `-o MUL_MAT`, EXTRA appended, FIRST unset, binary
`test-backend-ops-153f`. Per-run log of active `libggml-hexagon.so`, skel and
tbo shas (binding).

- **R1** `lib/` (control, buggy) — re-reproduce the live NaN.
- **R2** `lib-fix/` — THE test: only the host lib differs.
- **R3** `lib/` repeat — control stability.
- **R4** `lib-fix/` repeat — fix stability.

Crash ⇒ NPU_DEAD, skip remaining. `over()` ⇒ skip. Full logs pulled raw.

## Pre-declared interpretation grid (binding)

1. R1/R3 NaN present AND R2/R4 clean (expected `546/546`) → **root cause
   CONFIRMED: stale-descriptor reuse (missing type check); Class B CLOSED**
   with the upstream 2-line fix as the cure. Merge decision (main/branch) is
   a separate step; the per-model PPL cert containment gate STAYS regardless.
2. R1/R3 NaN present AND R2/R4 NaN persists → fix **REFUTED** as the cause;
   Class B returns to parked-with-containment; no further cells without a new
   design.
3. R1/R3 clean → repro lost on this rack/session; METHOD-LIMIT banked; fix
   arm non-binding (a clean fix arm proves nothing without a live control).
4. Fix arm shows ANY failure beyond the (possibly absent) census NaN → fix
   unsafe/regression; readout VOID; banked as a finding. Gate letter (#48
   F-8): every former-passing shape must end OK or NS.
5. Mixed control (exactly one of R1/R3 NaNs) → per-pair readout: the verdict
   binds only if the SAME-half fix run is clean AND grid-4 holds; else
   METHOD-LIMIT.

NaN indices recorded per run (non-binding on value — #50 proved instability —
but presence/absence IS binding).

## Non-goals

No speed, no PPL, no MUL_MAT_ID, no zeropad arms, no merge-to-main decision,
no v73/v75.

## Ops

Skeleton as #50: connect.sh → tunnel 6037 → d_run.sh; kit push + on-device
sha verify; per-run LD_LIBRARY_PATH/ADSP_LIBRARY_PATH at the run's lib dir;
`Hexagon Arch version v79` required (control dir) before R1 else METHOD-VOID;
EXIT= binding; events log; End Session right after DONE.
