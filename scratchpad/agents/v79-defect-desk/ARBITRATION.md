# Arbitration — orchestrator verification of AUDIT.md (mimo) vs REPORT.md (grok)

Date: 2026-09-02. Every claim below was verified by me on disk; file:line quoted.

## ⛔ ERRATUM (2/09, after the writer's dissent) — my "F1 upheld" below was WRONG

The writer (grok, FIXNOTES.md) disputed F1 and is right; I verified the decisive
evidence myself:

- The final `Failing tests:` list (`ops_mm_ph1.txt:2533-2570`, stdout, immune to
  pty interleave) contains **37 tests and `m=576,n=512,k=576` is NOT among them**.
  Every failing test-m ∈ {16, 1, 6, 2880}; the 36 INTERNAL-ERROR all have
  test-m % 32 ≠ 0 (16, 1, 6); the 37th is the Class B NaN (q4_0 m=2880, 2880%32=0,
  numeric FAIL not INTERNAL-ERROR).
- The block-count pins the attribution: the ref-buf group at `:1798` says
  `blocks=256` = 8192/32 → it belongs to `m=1,n=2048,k=8192` (header `:1804`),
  NOT to m=576 (whose group is `:1790`, `blocks=10368` = 576·576/32). The
  INTERNAL-ERROR at `:1801` is that next test's; the `OK` at `:1803` is m=576's
  verdict.
- Consequence: AUDIT F1 and F13 are themselves refuted; the report's universal
  "36/36 on test-m % 32 ≠ 0" STANDS; there is no unexplained Class A outlier;
  A4 (m=576) is a no-regression control, not a diagnostic. My "F1 upheld" and
  "F13 upheld" sections below are retracted (kept for the record). The #43
  REPORT's "one LARGE shape m=576 INTERNAL-ERROR" was the same interleave
  misread and needs the same erratum.
- The F8 arithmetic finding (q8_0 64-valid+64-pad, 1024+128=1152>1088) is
  unaffected and stands; Class B remains open, device-discriminated.

Lesson (again): never attribute a stderr line to the nearest stdout header in a
pty-interleaved log; use the end-of-run summary and per-test invariants
(blocks = m·k/32) as ground truth.

## Upheld audit findings (verified in raw / code)

- **F1 upheld.** `qdc-8elite-npu-v79-judge/raw/ops_mm_ph1.txt:1794` shows
  `MUL_MAT(type_a=q4_0,...,m=576,n=512,k=576,...)` with
  `ggml-hex: HTP0 dspcall : dsp-rsp: INTERNAL-ERROR` in its block (:1800-1801).
  576 % 32 = 0. Attribution corroborated by #43 REPORT which listed the same shape.
  The report's universal "all 36 have test-m % 32 ≠ 0" is false → 35/36.
- **F2 upheld.** Raw :1805+ shows q4_0 and q4_1 `m=1,n=64,k=256` both INTERNAL-ERROR.
  The report's "n≤4 → HVX" shorthand misleads: host m = src1->ne[1] = test-n = 64 > 4
  → HMX selected; DSP n = test-m = 1, 1%32≠0 → fail.
- **F7 upheld.** The fp16-overflow theory is internally contradictory as written
  (report itself bounds coherent sums ≪ 65504 and notes q8_0 shares the path and passes).
- **F13 upheld.** m=576 needs a device diagnosis; the proposed A1/A2 shapes only
  exercise the %32 mechanism.

## Audit error found (F8) — scale-load theory does NOT discriminate as claimed

AUDIT.md F8 states: "q8_0: scale at tile_src + 1024 (:442), tile 1088, so the
128-byte load at +1024 reads bytes 1024-1151 — **all within the 1088-byte tile**.
No overflow into pad." **That arithmetic is wrong: 1024 + 128 = 1152 > 1088.**

On disk (`kalsallama/ggml/src/ggml-hexagon/htp/`):

- `matmul-ops.h:23` `HTP_MM_WEIGHT_TILE_SIZE_Q4_0 576`, `:30` aligned 640.
- `matmul-ops.h:25` `HTP_MM_WEIGHT_TILE_SIZE_Q8_0 1088`, `:32` aligned 1152.
- `hmx-mm-kernels-tiled.h:48` q4_0: `hvx_vmem(tile_src + 512)` → reads 512-639 =
  64 B valid (512-575) + 64 B pad (576-639).
- `hmx-mm-kernels-tiled.h:442` q8_0: `hvx_vmem(tile_src + 1024)` → reads 1024-1151 =
  64 B valid (1024-1087) + 64 B pad (1088-1151).

**q8_0 and q4_0 have the byte-identical structure: 64 valid + 64 pad.** So "q4_0
reads pad, q8_0 doesn't" is false, and the scale-load theory as stated cannot be
the discriminating mechanism either. Open question (flagged, not asserted): both
kernels do `Q6_V_lo_W(Q6_W_vshuff_VVR(v_sc, v_sc, -2))` on the loaded vector —
if that consumes only the low 64 B (the valid scales), the pad never influences
the result for EITHER quant and the scale-load theory dies entirely. This is an
HVX-intrinsics semantics question; do not settle it by argument, settle it on device.

mxfp4 is genuinely protected regardless: `hmx-mm-kernels-tiled.h:340-345` clamps
the unpacked scale (`vmax` 0 / `vmin` 30) before shifting.

## Consequence for Class B

Neither theory is established:
- fp16 overflow: refuted as sole cause by the report's own bound + q8_0 passing.
- scale-load pad: its q8_0 discriminator was based on wrong arithmetic.

Class B goes to the device cell as an **empirical discrimination**, not a
confirmation of a chosen theory. Useful arms: q8_0 m=2880,n=32,k=2880 (quant
discriminator, expected PASS), q4_0 m=2880,n=32,k=2880 repeated N times
(determinism probe — uninit-pad theories predict flakiness), q4_0 same m,n with
k=1024 (long-k probe), optionally a pad-zeroing instrumented build.

## Consequence for Class A

**[RETRACTED IN PART by the ERRATUM above (flagged by AUDIT-2 finding 2):
"35/36" and "m=576 stays open" are wrong — the fix covers 36/36 and A4 is a
no-regression control, not a diagnostic. The no-regression argument stands.]**

Unaffected. The host-side fix (eligibility on logical `src0->ne[1] % 32`, fall
back to HVX) is sound per F11's no-regression argument, which I accept:
any currently-passing HMX shape already satisfies the DSP's `src0->ne[1] % 32 == 0`
check (`matmul-ops.c:2327/2596/2841`), so tightening the host gate to the same
condition cannot regress a passing shape.
