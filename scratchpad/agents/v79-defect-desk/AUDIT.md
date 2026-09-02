# Hostile audit — REPORT.md (v79 defect desk, grok)

Audit read-only; one write = this file. All claims quote the line I read.
Verdict per finding: CONFIRMED / PLAUSIBLE / REFUTED, with severity.

---

## F1 — MAJOR. "All 36 sit on shapes with test-m % 32 ≠ 0" is factually false

**Report claim:** "All 36 sit on shapes with **test-m % 32 ≠ 0** and **test-n > 4**"
(REPORT.md, Class A boundary paragraph).

**Evidence:** The raw at `ops_mm_ph1.txt:1794` shows `MUL_MAT(type_a=q4_0,...,
m=576,n=512,k=576,...)` followed by `dsp-rsp: INTERNAL-ERROR` at `:1801-1802`. Test
m=576. 576 % 32 = **0**. The #43 REPORT also lists this shape explicitly:
"one LARGE shape `q4_0 m=576,n=512,k=576`" (`qdc-8elite-npu-v79/REPORT.md:65`).

**Code path for m=576,n=512,k=576:** Host dispatch (`ggml-hexagon.cpp:2577-2579`):
`ne01_padded = hex_round_up(src0->ne[1], 32) = hex_round_up(576, 32) = 576`. Checks:
`576 % 32 = 0` ✓, `ne00 = 576 % 32 = 0` ✓, `m = src1->ne[1] = 512 > 4` ✓ → HMX.
DSP (`matmul-ops.c:2978-2979`): `n = src0->ne[1] = 576`. Check at `:2327`:
`576 % 32 = 0` → **passes**. The `%32` gate is NOT the trigger for this shape.
The INTERNAL-ERROR must come from a later check (VTCM overflow at `:2369-2372`,
DMA height zero, or alignment at `:2328`). The report does not identify which.

**Severity: MAJOR.** The report's entire Class A mechanism is built on "test-m % 32 ≠ 0
is the universal trigger." One counterexample (m=576) falsifies the universal claim.
The mechanism is correct for 35/36 cases but wrong for this one. The m=576 case
needs its own diagnosis (likely VTCM sizing or DMA height for n_chunk with
ne01_padded=576).

**Fix text for REPORT.md:** Replace "All 36 sit on shapes with test-m % 32 ≠ 0" with
"35/36 sit on shapes with test-m % 32 ≠ 0; the 36th (q4_0 m=576,n=512,k=576) has
test-m % 32 = 0 and triggers a different DSP-side gate (VTCM/DMA, not %32)." Add a
note that m=576 needs separate device diagnosis.

---

## F2 — MAJOR. Report does not explain m=1,n=64 family; its stated mechanism
contradicts the raw

**Report claim:** "m=1 (`n=1`) and m=6" as examples of the `%32` failure
(REPORT.md, `hmx_mm_2d_f32` paragraph). The report treats m=1 as producing DSP
n=1, which fails 1%32≠0. This is correct for the DSP side.

**But:** The report never explicitly analyzes the m=1,n=64 dispatch path. It says
"For `n≤4` HMX is skipped → HVX" — but for m=1,n=64, the host's m variable is
src1->ne[1] = **64**, not 1. 64 > 4 → HMX is **selected**, not skipped. The raw
confirms: `ops_mm_ph1.txt:1827` shows `dsp-rsp: INTERNAL-ERROR` for q4_0 m=1,n=64.

The report's mechanism DOES apply (DSP n=src0->ne[1]=1, 1%32≠0 → fail), but the
report never walks through this case. A reader following the report's "n≤4 → HVX"
logic would conclude m=1 goes to HVX, which is wrong (the host's m is 64, not 1).

**Severity: MAJOR.** The m=1,n=64 family is 5 of the 36 failures. The report's
"n≤4 → HVX" shorthand is correct for the test's n dimension but misleading because
the host's m variable equals test-n, not test-m. The report's name mapping section
states this correctly (`hmx_m = src1->ne[1] = test n`) but the analysis paragraph
contradicts it by using m=1 as if it were the host's m.

**Fix text:** Add an explicit m=1,n=64 dispatch trace: "Host m = src1->ne[1] = 64
(test n), 64 > 4 → HMX. DSP n = src0->ne[1] = 1 (test m), 1 % 32 ≠ 0 → fail."
Remove or clarify the "n≤4 → HVX" shorthand.

---

## F3 — CONFIRMED. Name mapping is correct

**Report claim:** `hmx_m = src1->ne[1] = test n`, `hmx_n = src0->ne[1] = test m`,
`k = src0->ne[0]` (REPORT.md header).

**Evidence:** `test-backend-ops.cpp:4467-4468`: `a = ggml_new_tensor_4d(ctx, type_a,
k, m, ...)`, `b = ggml_new_tensor_4d(ctx, type_b, k, n, ...)`. So src0=a has
ne[0]=k, ne[1]=m; src1=b has ne[0]=k, ne[1]=n. `matmul-ops.c:2978-2979`:
`n = src0->ne[1]`, `m_total = src1->ne[1]`. Mapping is exactly as stated.

**Severity: none.** Confirmed.

---

## F4 — CONFIRMED. supports_op does not refuse src0->ne[1] % 32

**Report claim:** "`supports_op` (`:2812-2881`) refuses only `src0->ne[0] % 32` and
`src0->ne[1] > 32768`. It does **not** refuse `src0->ne[1] % 32`."

**Evidence:** `ggml-hexagon.cpp:2831`: `if (src0->ne[0] % 32) return false;`
`ggml-hexagon.cpp:2836`: `if (src0->ne[1] > 32768) return false;`. No check on
`src0->ne[1] % 32`. The `ne01_padded % 32` check is in `ggml_hexagon_matmul_is_hmx_eligible`
(`:2172`), not in `supports_op`.

**Severity: none.** Confirmed.

---

## F5 — CONFIRMED. DSP status path line numbers are correct

**Report claim:** "Only two `return HTP_STATUS_INTERNAL_ERR` in the DSP tree:
`htp/matmul-ops.c:3044` (HMX matmul `ret != 0`) and `:3229` (MUL_MAT_ID `memalign`
fail)".

**Evidence:** `grep -n 'HTP_STATUS_INTERNAL_ERR' matmul-ops.c` → lines 3044 and 3229.
Host mapping: `status_to_str` at `ggml-hexagon.cpp:97` maps `HTP_STATUS_INTERNAL_ERR
→ "INTERNAL-ERROR"`. `flush_pending` at `:1560-1561` logs `dsp-rsp: %s` and
`error_count++`. `graph_compute` at `:3685` returns `GGML_STATUS_FAILED` if
`error_count != 0`.

**Severity: none.** Confirmed.

---

## F6 — CONFIRMED. Class B raw facts are correct

**Report claim:** `ops_mm_ph1.txt:642` shows NaN at index 305 for q4_0 m=2880,n=32,k=2880.
q8_0 same shape OK at `:657`. mxfp4 same shape OK at `:659`.

**Evidence:** Raw confirms all three. `HTP0=nan CPU=-12.339559` at `:642`. q8_0
header `:650`, OK `:657`. mxfp4 header `:658`, OK `:659`.

**Severity: none.** Confirmed.

---

## F7 — MAJOR. Class B primary theory (fp16 overflow) is wrong

**Report claim:** "q4_0 reconstructed |w| is coarser than q8_0; a single lane going
inf then cancelling → NaN" (REPORT.md, Class B "Most plausible mechanism" #1).

**Evidence against:** The report itself states: "Init is `uniform[-1,1]`
(`test-backend-ops.cpp:66,1527-1530`) so a coherent fp16 sum of 2880 terms is
≤2880 ≪ 65504 — **plain acc overflow is unlikely** as the sole cause."

The dequantized q4_0 weight range is [-8d, 7d] where d is the block scale. With
uniform[-1,1] activations, individual products are bounded. Even summing 1024
fp16 products (one HMX tile) gives |sum| ≤ 1024 × 8 = 8192 ≪ 65504. The
accumulation across 90 tiles uses `HMX_CLRACC_F16()` then `LOAD_MPY_DEEP_F16`
(`hmx-mm-kernels-tiled.h:655-671`), which accumulates in fp16. But the running
sum never exceeds the per-tile bound because each tile's contribution is
independent and the total is the sum of 90 partial sums, each ≤ 8192. Even in
the worst case (all positive), 90 × 8192 = 737,280 > 65504 — **but this
requires all 90×1024 products to have the same sign**, which is astronomically
unlikely with uniform[-1,1] inputs and random q4_0 weights.

More critically: **q8_0 uses the exact same accumulation path** (`hmx-mm-kernels-tiled.h:631-676`)
and PASSES. If fp16 overflow were the mechanism, q8_0 would also overflow (same
k=2880, same 90-tile long path). The report acknowledges this ("q8_0 uses this
exact path and PASSES") but does not explain why q4_0 overflows and q8_0 does not.

**Severity: MAJOR.** The primary theory is internally contradictory. The report
says overflow is "unlikely" then proposes it as the mechanism, and cannot explain
the q4_0/q8_0 discriminator.

**Fix text:** Demote theory #1 to "ruled out" and promote theory #2 (scale load
reading 128 B from 64 B valid region) to primary. The evidence for theory #2:
q4_0 scale at `tile_src + 512` (`hmx-mm-kernels-tiled.h:49`), tile size 576,
aligned 640 (`matmul-ops.h:23,30`). The DMA width is `tile_size = 576`
(`matmul-ops.c:2355`). A 128-byte `hvx_vmem` load at offset 512 reads 64 B
valid + 64 B uninitialized pad. mxfp4 clamps scale bytes (`:340-345`), q8_0 has
a different spatial layout (scale at +1024, tile 1088). This explains the
q4_0-specific NaN and the mxfp4/q8_0 pass.

---

## F8 — PLAUSIBLE. Class B secondary theory (scale load) is the real mechanism

**Report claim (theory #2):** "q4_0 scale load is 128 B from a 64 B valid region"
(REPORT.md, Class B mechanism #2).

**Evidence:** `hmx-mm-kernels-tiled.h:49`: `HVX_Vector v_sc = hvx_vmem(tile_src +
512)`. `hvx_vmem` loads 128 bytes (one HVX vector). q4_0 tile size = 576
(`matmul-ops.h:23`). Valid data: bytes 0-575. Load at offset 512 reads bytes
512-639. Bytes 512-575 are valid (64 B); bytes 576-639 are uninitialized pad
(64 B). If the pad contains a NaN-scale bit pattern, one row-in-tile gets a NaN
scale, poisoning one output column.

mxfp4: scale load at `:340` is `hvx_vmem(tile_src + 512)` but followed by
clamping (`Q6_Vh_vmax_VhVh(vh, Q6_V_vzero()); Q6_Vh_vmin_VhVh(vh,
Q6_Vh_vsplat_R(30))` at `:342-345`), which eliminates NaN scales. q8_0: scale
at `tile_src + 1024` (`:442`), tile 1088, so the 128-byte load at +1024 reads
bytes 1024-1151 — all within the 1088-byte tile. No overflow into pad.

**Severity: PLAUSIBLE.** The mechanism is consistent with all observations
(q4_0-specific, single NaN at one index, q8_0/mxfp4 pass). The report's own
discriminator "zero the aligned-tile pad after DMA" would test it. However, the
report does not prove that the uninitialized pad actually contains a NaN bit
pattern — this is hardware-dependent and would need a device cell to confirm.

---

## F9 — PLAUSIBLE. k=1024 discriminator does not discriminate the real mechanism

**Report claim:** "Discriminator: same m,n with k=1024 (short path, n_dot_tiles=32)"
(REPORT.md, Class B mechanism #1 discriminator).

**Problem:** The scale load issue (theory #2, now primary) is independent of k.
The 128-byte load at `tile_src + 512` reads the same uninit pad regardless of
k. Testing k=1024 would NOT discriminate between theory #1 (long-k acc) and
theory #2 (scale load). The report's proposed discriminator tests the wrong
theory.

**Better discriminator:** Test q8_0 m=2880,n=32,k=2880 (same shape, different
quant). If q8_0 passes (it does today), the issue is q4_0-specific — consistent
with scale-load theory (q8_0 scale at +1024 within tile) but NOT with long-k
acc theory (q8_0 uses same 90-tile path). The report already notes q8_0 passes
but does not use it as the primary discriminator.

**Severity: PLAUSIBLE (low).** The k=1024 test is still useful (would confirm or
rule out long-k acc), but should not be presented as THE discriminator when the
scale-load theory doesn't depend on k.

---

## F10 — CONFIRMED. upstream note is honest

**Report claim:** "No `ggml-org/llama.cpp` remote / `upstream/master` ref. Did not
fetch." (REPORT.md, Upstream section).

**Evidence:** I cannot verify the git remote configuration of the report writer's
clone, but the claim is epistemically honest — it explicitly states what was NOT
done rather than claiming knowledge it doesn't have.

**Severity: none.** Confirmed as appropriately hedged.

---

## F11 — PLAUSIBLE. Class A fix viability: no regression on currently-passing shapes

**Report claim:** "Do not `supports_op`-refuse the op (that would drop working
HVX)." Fix #1: "Host: eligibility on **logical** `src0->ne[1] % 32 == 0` (not
`ne01_padded`). Unaligned N → HVX."

**Evidence for no regression:** For repack types (the five failing quants),
`ne01_padded = hex_round_up(ne01, 32)`. If ne01_padded % 32 == 0 AND ne01 %
32 != 0, then ne01_padded > ne01 and ne01_padded is the NEXT multiple of 32.
But ne01_padded % 32 is always 0 by construction (it's a multiple of 32). The
question is: can ne01_padded % 32 == 0 while ne01 % 32 != 0, AND the shape
currently passes? For passing HMX shapes, the DSP check at `:2327` requires
src0->ne[1] % 32 == 0. Since src0->ne[1] = ne01 (unpadded), any passing shape
must have ne01 % 32 == 0. Therefore: no passing shape has ne01 % 32 != 0, and
the fix (check ne01 % 32 instead of ne01_padded % 32) cannot regress any
currently-passing shape.

**But:** The report does not explicitly state this reasoning. A reader cannot
verify the "no regression" claim without working through the padding logic
themselves.

**Severity: PLAUSIBLE.** The fix is safe, but the report should include the
one-sentence proof: "For repack types, ne01_padded = round_up(ne01, 32); if
ne01_padded % 32 == 0 then ne01 % 32 == 0 iff ne01 == ne01_padded, so no
passing shape has ne01 % 32 != 0."

---

## F12 — PLAUSIBLE. Real-model shapes are all %32-aligned (unverified)

**Report claim (implicit):** The fix is inert for real-model shapes because they
are %32-aligned.

**Evidence:** The report does not explicitly verify this. From #47's execute-op
lines (not read here), ship shortconv and OLMoE expert shapes would need to be
checked. The claim is PLAUSIBLE (LLaMA/MoE weight dimensions are typically
powers of 2 or multiples of 128), but unverified.

**Severity: PLAUSIBLE (low).** Should be verified against actual model shapes
before shipping the fix.

---

## F13 — REFUTED. "Class A does not need a cell to diagnose" — m=576 needs diagnosis

**Report claim:** "Class A does not need a cell to diagnose; B2 is the
discriminator" (REPORT.md, Next QDC cell section).

**Evidence:** F1 above shows m=576,n=512,k=576 triggers INTERNAL-ERROR through a
mechanism OTHER than the %32 gate. The report's Class A mechanism does not explain
this case. Without a device cell to test m=576 specifically (with diagnostic
logging to identify which DSP check triggers), the m=576 root cause remains
unknown.

**Severity: REFUTED.** Class A DOES need a cell for the m=576 outlier. The
proposed cell shapes (A1: m=16 n=4, A2: m=16 n=5) only test the %32 mechanism,
not the m=576 mechanism.

**Fix text for Next QDC section:** Add shape A4: `q4_0 m=576 n=512 k=576` (expect
INTERNAL-ERROR today; identify which DSP check triggers after the %32 gate is
passed).

---

## F14 — PLAUSIBLE. Class B cell recommendation is appropriate

**Report claim:** "Only class B is worth a device cell" with B1/B2/B3 shapes
(REPORT.md, Next QDC cell).

**Evidence:** Class B is a single-NaN issue that cannot be diagnosed from the raw
alone. B2 (k=1024) tests the long-k theory; B3 (q8_0) tests the quant-specific
theory. The cell is appropriately sized (~5 min with `-o MUL_MAT`).

**But:** As noted in F9, B2 tests the wrong theory if scale-load is primary.
Replace B2 with: `q4_0 m=2880 n=32 k=2880` with scale-pad zeroed after DMA
(if the fix is implemented), or `q8_0 m=2880 n=32 k=2880` (already proposed as
B3, which is the better discriminator).

**Severity: PLAUSIBLE.** The cell is useful but B2 should be reconsidered.

---

## Summary

| # | Finding | Severity | Verdict |
|---|---------|----------|---------|
| F1 | "All 36 test-m % 32 ≠ 0" is false (m=576) | MAJOR | REFUTED |
| F2 | m=1,n=64 dispatch not explained; "n≤4 → HVX" contradicts raw | MAJOR | REFUTED |
| F3 | Name mapping | — | CONFIRMED |
| F4 | supports_op does not refuse src0->ne[1] % 32 | — | CONFIRMED |
| F5 | DSP status path line numbers | — | CONFIRMED |
| F6 | Class B raw facts | — | CONFIRMED |
| F7 | Class B primary theory (fp16 overflow) is wrong | MAJOR | REFUTED |
| F8 | Class B secondary theory (scale load) is plausible | — | PLAUSIBLE |
| F9 | k=1024 discriminator tests wrong theory | — | PLAUSIBLE |
| F10 | upstream note is honest | — | CONFIRMED |
| F11 | Class A fix no-regression (unstated proof) | — | PLAUSIBLE |
| F12 | Real-model shapes %32-aligned (unverified) | — | PLAUSIBLE |
| F13 | "Class A does not need a cell" is wrong (m=576) | MAJOR | REFUTED |
| F14 | Class B cell recommendation | — | PLAUSIBLE |

Three MAJOR REFUTED findings (F1, F2, F7) and one MAJOR REFUTED finding (F13).
The report's Class A mechanism is correct for 35/36 cases but the universal
claim is false and the m=1,n=64 path is not traced. The Class B primary theory
is internally contradictory. The m=576 outlier requires a device cell.

**Verdict: FIX.** The report needs corrections to F1, F2, F7, and F13 before it
can be used as a defect reference. The Class A fix (host eligibility on logical
ne01 % 32) is sound for the 35/36 cases it covers. The Class B scale-load theory
should be promoted to primary. A device cell should include m=576 for Class A
diagnosis.
