# PREREG — Hexagon NPU day-0 on the 8 Elite (v79) — cell #43 candidate

Written BEFORE any measurement. The commit hash of this file is the lock id.
This is the FIRST v79 NPU cell of the campaign (prior NPU data: v73 fragile,
v75 full menu — never transferred across generations, and not to v79 now).

## Questions (in order; each answered even if the next fails)

1. **Does the HTP backend initialize on the QDC 8 Elite unit?** Expected
   signature (from the backend's own docs): `ggml-hex: Hexagon Arch version
   v79` + session allocation with uri `file:///libggml-htp-v79.so...`. An
   unsigned-PD failure or missing skel is a banked ANSWER, not a void.
2. **Correctness day-0**: test-backend-ops on the HTP device for MUL_MAT and
   MUL_MAT_ID. The #39 lesson is BINDING: first list the registered backend
   names on device (`test-backend-ops --list` or no-filter run header), use
   the EXACT name; a green run with 0 executed cases is vacuous and banks as
   such. Counts (executed OK / FAIL / skip) are the result. 0 FAIL required
   for a "correct" verdict; any FAIL banks as "v79 defect list started".
3. **Speed probe (exploratory)**: llama-bench on the SHIP model
   LFM2.5-2.6B-QAD-Q4_0 (Q4_0 = HTP-supported quant; sha recorded local and
   on-device), arms:
   - N (NPU): `--device HTP0 -ngl 99 --mmap 0 --poll 1000 -t 6 --cpu-mask 0xfc
     --cpu-strict 1 -ub 1024 -fa 1 -p 512 -n 128 -r 3`
   - C (CPU): identical line minus `--device HTP0` and with `-ngl 0`.
   Flags follow the backend's own documented bench recipe (NOT the #38/#41
   flag set): this pair is internally controlled N-vs-C, and is DECLARED
   non-comparable with #38/#41 numbers (different threads/flags/mmap).
   Order **N C C N**, one invocation each, exit codes preserved.
4. **REPORT-only**: offload split lines (CPU vs HTP0 vs HTP0-REPACK buffer
   sizes), which ops stay on CPU (hybrid arch: shortconv layers may not
   offload — that split IS a finding), and any crash signature (the v73
   catalog: dspqueue_read 0x2e / qurt_exit / dspqueue_write 0x1 — new v79
   signatures get quoted verbatim).

## Method (fixed)

- Kit: pkg-snapdragon built from kalsallama kalsa/governor-v0 @ 556118a08 via
  the official toolchain container (ghcr.io/snapdragon-toolchain/
  arm64-android:v0.7 — NDK r28b, Hexagon SDK 6.6.0.0), tools llama-bench /
  llama-cli / test-backend-ops + all shared libs, llvm-stripped. Run env:
  `LD_LIBRARY_PATH=<kit>/lib ADSP_LIBRARY_PATH=<kit>/lib` (the backend's
  documented layout). SHA256SUMS verified on device.
- Thermal gate per AMENDMENT-1 (#38), BINDING: live HAL max ≤60 °C and
  status ≤1 before EACH invocation, snapshot after; >15 min cooldown →
  remaining invocations NOT RUN.
- Upload ~1.6 GB model + ~22 MB kit → ~1.5 min at measured rates; live-probe
  rule: projected >45 min → VOID-before-start.

## Decision rule (pre-written)

- Q1 verdict: INIT-OK iff the v79 session line appears and a model load
  places ≥1 tensor on an HTP device; else the failure line is the verdict.
- Q2 verdict: per op class, "correct on v79 day-0" iff executed>0 and FAIL=0;
  skips are reported with reasons when printed.
- Q3 (probe, no winner-rule): report pp512/tg128 medians of r=3 per arm and
  the N/C ratios. Pre-declared: this is an EXPLORATORY probe (n=1 invocation
  per arm per block, new arch); it seeds the decision table's NPU column but
  does not bank a routing verdict by itself.
- Any invocation exiting non-zero banks that invocation FAILED with log tail;
  the cell banks whatever completed.

## What this cell cannot say (binding)

Nothing about v73/v75 (other generations, already banked); nothing about
K-quant models (HTP supports Q4_0/Q8_0/MXFP4/IQ4_NL only — KEXP excluded by
construction); nothing about sustained thermals; nothing about energy;
nothing about the app; no routing verdict for the governor table beyond
"seeded, needs a preregistered follow-up" if numbers land.
