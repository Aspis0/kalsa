# AUDIT-2 — hostile re-audit of the v79 defect desk FINAL state

Independent check of REPORT rev-2, AUDIT, ARBITRATION+erratum, FIXNOTES, fix commit 736ddd206,
raw `qdc-8elite-npu-v79-judge/raw/ops_mm_ph1.txt` (2576 lines), and the #43 raw where the
erratum reaches into it. Code pin `kalsallama` `kalsa/npu-judge-v79` @ `736ddd206` (HEAD, on-disk
verified). No builds run. Every claim quotes the line as read.

Method note: individual stderr-line→test attribution in the pty log is NOT decidable from line
positions in the failing sweeps (identical type+blocks). All findings below rest only on
interleave-immune anchors: the end-of-run `Failing tests:` list, per-test verdicts (stdout
order), and the `blocks = m·k/32` ref-buf invariant.

---

## A — The code fix (git show 736ddd206)

A1 **DSP contract mirrored by the fix: CONFIRMED (verified, no defect).** Exactly three `n % 32` sites
in the DSP tree, and the dispatcher passes logical N:
- `ggml/src/ggml-hexagon/htp/matmul-ops.c:2327` (inside `hmx_mm_2d_f32`, declared `:2306`):
  `if (k % 32 != 0 || n % 32 != 0) { return -1; }`
- `htp/matmul-ops.c:2596` (`hmx_mm_f16_f32_batched`):
  `if (params->k % 32 != 0 || params->n % 32 != 0) { return -1; }`
- `htp/matmul-ops.c:2841` (`hmx_mm_id`):
  `if (k % 32 != 0 || n % 32 != 0) { return -1; }`
- Logical n: `htp/matmul-ops.c:2978`: `int n = (int) src0->ne[1];` (`k` at `:2977`, `m_total` at `:2979`),
  fed to `hmx_mm_2d_f32(...)` at `:3032-3034` (`m_total, k, n, ...`). Padded 32 never enters the DSP check.

A2 **k side already refused: CONFIRMED.** Eligibility gates K itself — `ggml-hexagon.cpp:2182`:
`if (ne00 % 32 != 0) {` → `return false;` (comment `:2181`: `// HMX paths require K aligned to 32.`).
And `supports_op` refuses it earlier for repack types — `ggml-hexagon.cpp:2830-2831`:
`if (src0->ne[0] % 32) {` / `return false;`. The fix correctly adds only the N side; `grep -n "src0->ne\[1\] % 32"`
hits only the fixed gate `:2172`.

A3 **All callers safe on false: CONFIRMED, with one undocumented surface (finding).**
Exactly two callers (grep): `ggml-hexagon.cpp:2589` and `:3482`.
- `:2589` (`ggml_hexagon_precompute_matmul_params`): false → HVX precompute at `:2596`
  (`ggml_hexagon_precompute_hvx_mm_params`), which handles every non-f16/f32 type with
  QUANT_BLOCK/ROW kernels plus a flat fallback (`HTP_MM_KERNEL_HVX_QUANT_ROW_FLAT`, `:2469`ff);
  `supports_op` additionally VTCM-checks at `:2875-2879` → "not supported" → CPU. No assert path.
  Empirical proof for all five repack quants: n=1..4 pass via exactly this false-eligibility path
  (host m = src1->ne[1] = 1..4 ≤ `HTP_MM_HMX_MIN_NROWS` = 4, `matmul-ops.h:20`).
- `:3482` (`mm_is_hmx_eligible`) feeds only `is_mergeable_mul_mat` — `ggml-hexagon.cpp:3488`:
  `return ggml_is_quantized(t->src[0]->type) && !mm_is_hmx_eligible(t);`

A-F1 **MINOR, CONFIRMED — the fix has an undocumented second behavioral surface (op merging).**
Because `:3488` keys merging on `!mm_is_hmx_eligible`, the fix flips quantized MUL_MAT pairs with
unaligned logical ne01 from "HMX-eligible, not merged" to "mergeable" (merged ops run the non-HMX
HVX path — harmless, arguably better, but it is a behavior change). FIXNOTES.md:27 claims
`Only \`ggml_hexagon_matmul_is_hmx_eligible\`` and FIXNOTES.md:52 states the logic as
`if \`src0->ne[1] % 32 != 0\`, return false → existing HVX path.` — true only for the dispatch
caller; the merge caller's consequence is not mentioned anywhere.

A4 **No behavior change for any src0->ne[1] % 32 == 0 shape: CONFIRMED.** The gate is an OR
(`ggml-hexagon.cpp:2172`: `if (ne01_padded % 32 != 0 || src0->ne[1] % 32 != 0) {`); the added clause is
false exactly when the old gate alone decided, and both callers compute `ne01_padded` identically
(`:2579` and `:3480`, both `is_repack ? hex_round_up(...) : ...`). Merge decisions for aligned
shapes are therefore bit-identical.

A-F2 **MINOR, CONFIRMED — dead sub-condition post-fix.** For the five repack types,
`ne01_padded = hex_round_up(ne01, 32)` (ggml-hexagon.cpp:2579, :3480) is always a multiple of 32, so
`ne01_padded % 32 != 0` is always false; for F16/F32, `ne01_padded = ne01` (:2579/:3480), so the first
clause is implied by the new second clause. Post-fix the first clause is dead in every case. Kept
deliberately (FIXNOTES.md:52: "kept in the condition so the parameter stays used") — the parameter
is still genuinely used by `ggml_hexagon_precompute_hmx_mm_params` (`:2256`/:2314 via `:2590`), so the
cleaner alternative would be dropping the clause from the gate or GGML_UNUSED-ing it.

No-regression proof: verified. Any currently-passing HMX shape satisfies the DSP's
`n % 32 == 0` (else `hmx_mm_*` returns −1 → `matmul-ops.c:3044` `return HTP_STATUS_INTERNAL_ERR;` →
host `error_count++` (`:1560`-ish) → `:3685` `return sess->error_count == 0 ? GGML_STATUS_SUCCESS : GGML_STATUS_FAILED;`),
so tightening the host gate to the same condition cannot newly reject a passing HMX shape.

Residual risks (PLAUSIBLE, not defects): (i) the 36 re-routed shapes now exercise the HVX repack
path at n ∈ {5..16, 64, 2048, 4096} — HVX repack correctness at those n is not exercised anywhere in
this evidence (only n ≤ 4 per quant); the A2 cell arm covers it. (ii) The fix also gates MUL_MAT_ID,
which this evidence never touches (`ops_mm_ph1.txt` contains zero `MUL_MAT_ID` lines).

---

## B — Arithmetic audit (all numbers re-derived; zero numeric defects found)

- Failing list: `ops_mm_ph1.txt:2533` `Failing tests:` through `:2570` = **37 entries, counted**:
  25× (m=16, n=5..9, five quants) + 4× (m=16, n=16: q8_0 :2560, q4_0 :2561, q4_1 :2562, mxfp4 :2563;
  **iq4_nl absent**) + 5× (m=1, n=64, five quants, :2565-2569) + q4_0 m=1 n=2048 k=8192 (:2564) +
  q8_0 m=6 n=4096 k=5120 (:2570) + q4_0 m=2880 n=32 k=2880 (:2559, the NaN) = 36 INTERNAL-ERROR + 1 NaN. ✓
- test-m % 32: 29×16→16, 6×1→1, 1×6→6 (all ≠0); 2880→0 (the 37th, numeric FAIL). ✓
- blocks invariants: :111/:1813 `blocks=128` = 16·256/32; :1790 `blocks=10368` = 576·576/32;
  :1798 `blocks=256` = 1·8192/32; :1813 `blocks=8` = 1·256/32; :1880 `blocks=960` = 6·5120/32;
  :632/:638/:646/:654 `blocks=259200` = 2880·2880/32. All ✓ (ARBITRATION's attribution arithmetic correct).
- Tiles/offsets: `matmul-ops.h:23` `#define HTP_MM_WEIGHT_TILE_SIZE_Q4_0   576`, `:30` `..._ALIGNED... 640`;
  `:25` `..._Q8_0   1088`, `:32` `... 1152`; `hmx-mm-kernels-tiled.h:49` q4_0
  `HVX_Vector v_sc = hvx_vmem(tile_src + 512);` reads 512–639 = 64 B valid + 64 B pad;
  `:442` q8_0 `HVX_Vector v_sc = hvx_vmem(tile_src + 1024);` reads 1024–1151 = 64 B valid + 64 B pad;
  1024+128 = 1152 > 1088. AUDIT F8's "all within the 1088-byte tile" is arithmetically false and the
  arbitration's correction is right. ✓
- mxfp4 clamp real: `hmx-mm-kernels-tiled.h:342-345` (`vh = Q6_Vh_vmax_VhVh(vh, Q6_V_vzero());` / `vh = Q6_Vh_vmin_VhVh(vh, Q6_Vh_vsplat_R(30));`). ✓
- Pipeline: `matmul-ops.h:269-270` `return m > 32;`; HMX m = 32 for the Class-B shape → off. ✓
- k blocking: n_dot_tiles = 2880/32 = 90; long path `core_dot_chunk_fp16` (`hmx-mm-kernels-tiled.h:631-676`):
  `if (n_dot_tiles <= 32)` → short variant `:603-630` uses exactly one `HMX_LOAD_MPY_DEEP_F16`; else
  `n_loops = n_dot_tiles / 32` + one `rem` load = 2+1 = 3 deep loads into one `.hf` acc. ✓
- Index 305 = col-tile 9, local col 17; not a tile start (288). ✓
- F12 sets independently re-extracted from `qdc-8elite-npu-v79-ppl-v/raw/`: ship
  {512, 2048, 6144, 10752}, olmoe {64, 1024, 2048}, zero unaligned HMX src0 ne1. Exactly as REPORT/FIXNOTES state. ✓

---

## C — F1 adjudication (independent): q4_0 m=576,n=512,k=576 PASSED — CONFIRMED

Three interleave-immune anchors, derived independently:
1. The `Failing tests:` list (`:2533-2570`, 37 entries, counted above) contains **no** m=576 entry. A
   passing-test verdict cannot be FAIL, and every list entry is accounted for, so m=576 is not among the failures.
2. The m=576 test's own ref-buf group is `ops_mm_ph1.txt:1790`: `[ref-buf] cpu-src0 name=a type=q4_0 ... blocks=10368`
   (= 576·576/32) with no INTERNAL-ERROR attached; the error at `:1801` immediately follows the
   `blocks=256` group at `:1798` (= 1·8192/32), i.e. the next test's (header `:1804`, FAIL `:1805`).
3. Verdict elimination: `:1803` `OK` sits before the m=1-n=2048 header (`:1804`) and its FAIL (`:1805`),
   and after q4_K's "not supported" verdict (`:1793`); m=576 is the only run-and-unverdicted header in that span.
   Also m=576 is the only un-verdicted device test in the span. The OK is m=576's.

Therefore: REPORT rev-2's F1 position (36/36, m=576 OK at `:1803`) **CONFIRMED**; AUDIT.md:8 F1
(**"All 36 sit on shapes with test-m % 32 ≠ 0" is factually false**) **REFUTED**; the arbitration
erratum's retraction (ARBITRATION.md:20-22: `the report's universal "36/36 on test-m % 32 ≠ 0" STANDS` /
`A4 (m=576) is a no-regression control, not a diagnostic`) **CONFIRMED**. The desk's per-test
invariant discipline (blocks = m·k/32) is exactly the right tool and was applied correctly here.

Clarification, not a defect: iq4_nl m=16 n=16 is not merely absent from the failing list — the test
was never run at all (iq4_nl m=16 sweeps in this log cover only n=1..9). REPORT.md:14's parenthetical
`(iq4_nl is **not** in the list)` is literally true and claims nothing more.

---

## D — Class B

Internally consistent: two theories, explicitly neither established (`OPEN — two candidate theories,
neither established. Do not promote either to primary.`), the fp16-acc bound argument and the q8_0
same-path control are quoted correctly, the `V_lo_W(vshuff −2)` question is correctly left open,
and the mxfp4 clamp is real (`:340-345`, verified above). No leftover overstatement of either theory.

D-F1 **MINOR, CONFIRMED — the "Not:" exclusion list has a hole.** REPORT.md, Class B, excludes
VTCM overrun on the grounds it would surface as INTERNAL-ERROR (via `:2369-2372` → `:3044`). That
covers only the `vtcm_used > vtcm_budget` case. A VTCM **layout undercount** (layout builder
underestimates; check passes; actual DMA/write corrupts VTCM) would produce a numeric NaN with no
INTERNAL-ERROR and would not be excluded by the argument as written. Should be listed as a third
open possibility (or explicitly excluded with a reason), since the section claims to enumerate what it is NOT.

D-note (PLAUSIBLE, unverified): `Judge reports the first nonfinite` is a judge-behavior assumption,
not verifiable from the log line alone. Does not affect any conclusion.

---

## E — Cross-document consistency findings

E-F1 **MINOR, CONFIRMED — ARBITRATION contradicts its own erratum in an unretracted paragraph.**
ARBITRATION.md:86-93 (`## Consequence for Class A`) still reads:
`:89` `back to HVX) is sound for 35/36 per F11's no-regression argument, which I accept:` and
`:92-93` `m=576 stays open as its own item (A4 / diagnostic shape in the cell).`
Both contradict the erratum directly above it (ARBITRATION.md:20-22: `36/36 ... STANDS`;
`:22` `A4 (m=576) is a no-regression control, not a diagnostic.`). The erratum (line 23) retracts the
"F1 upheld"/"F13 upheld" sections only; this paragraph was left standing.

E-F2 **MINOR, CONFIRMED — the Next-QDC cell plan pins the pre-fix commit.** REPORT.md:102:
`Kit \`93e9592fa\`, QRD8750/v79, \`-o MUL_MAT\` shape filter, \`PLAIN_HOST=1\`. No prereg here.`
while REPORT.md:61-62 (rev-2 log) and the same section's A2/A4 arms say `after host fix expect OK via HVX`
and `after host fix must stay HMX and stay OK`. The fix is commit `736ddd206` (FIXNOTES.md;
verified: `git diff 93e9592fa..736ddd206` = exactly the 2-line gate change). A cell built at
`93e9592fa` cannot satisfy the A2 expectation — the two instructions in the same section are
mutually unsatisfiable. Pin should read `736ddd206`.

E-F3 **MINOR, CONFIRMED — the erratum's #43 retraction demand is unsubstantiated as stated.**
ARBITRATION.md:24-25: `REPORT's "one LARGE shape m=576 INTERNAL-ERROR" was the same interleave /
misread and needs the same erratum.` But the #43 raw (`qdc-8elite-npu-v79/raw/backend_ops_MUL_MAT_HTP0.txt`)
has m=576 **in its own interleave-immune failing list** — `:4233`:
`MUL_MAT(type_a=q4_0,type_b=f32,m=576,n=512,k=576,bs=[1,1],...): [ref-buf] PLAIN_HOST=1 ...` — and the
m=576 test's own line carries the failure inline: `:1365`
`[MUL_MAT] NaN at index 1 (HTP0=-1.300781 CPU=nan)   MUL_MAT(type_a=q4_0,...,m=576,n=512,k=576,...): ggml-hex: HTP0 dspcall : dsp-rsp: INTERNAL-ERROR`
followed by `:1366` `FAIL`. #43 ran the pre-`214ae986e` binary where dspcall errors were swallowed →
garbage compares (its failing list has 70 entries, including all m=16 n=1..4 and q8_0/mxfp4 m=2880 — a
different phenomenon from #46's 37). So the erratum's instinct (the #43 INTERNAL-ERROR *proximity
taxonomy* is unreliable) is right, but the flat assertion "was the same interleave misread and needs
the same erratum" is asserted without examining the #43 log and conflates the INTERNAL-ERROR label
with the (real, in that run) failure. As written it would erase a genuine observation of another
document.

E-F4 **MINOR, CONFIRMED — q4_0/q4_1 m=1 n=64 error lines swapped.** REPORT.md:38 attributes to
q4_0 m=1 n=64: `(q4_0 header \`:1819\`, INTERNAL-ERROR \`:1826\`, \`graph_compute failed\` \`:1827\`)`;
FIXNOTES.md:15 repeats it: `raw \`:1819/:1826-1827\``. By the type+blocks invariant (the desk's own
method): `:1810-1815` is the q4_0 group (`:1812` `[ref-buf] dev-src0 name=a type=q4_0 ...`;
`:1813` `blocks=8` = 1·256/32) → its error is `:1816`; `:1820-1825` is the q4_1 group (`:1822`
type=q4_1, `:1823` blocks=8) → its error is `:1826`, its header+FAIL at `:1829`. Forced: bf16 (the
preceding test) never ran (`:1818` `not supported [HTP0]`), so none of the five errors in the window
can be its; and an error cannot precede its own test's ref-buf setup group (graph_compute runs after
setup), so `:1816` cannot be q4_1's. Substantive claim unaffected — both q4_0 and q4_1 m=1 n=64 are
in the failing list (`:2565-2566`). Note the desk applied this same blocks-invariant method correctly
for the m=576/m=1-n=2048 boundary; here it was not applied.

E-F5 **MINOR, CONFIRMED — F12 ppl citations have no directory, and the files in the cited evidence
directory are stubs.** REPORT/FIXNOTES cite `ppl_ship_htp.dev.txt:26872` and `ppl_olmoe_htp.dev.txt:20398`
by bare filename. In the header's cited evidence directory (`qdc-8elite-npu-v79-judge/raw/`) these
files are 12-line stubs (1128 bytes); the full logs containing the cited lines live in
`qdc-8elite-npu-v79-ppl-v/raw/` (verified: both cited lines contain exactly the quoted dims and
`hmx-tiled`). The F12 claims are TRUE in those logs — but the cite is ambiguous and the F12 evidence
comes from a different run than the header's evidence pin.

Cosmetic (CONFIRMED, no action required): REPORT.md:4 labels the evidence `(ANSI stripped)` but
`ops_mm_ph1.txt` still contains ANSI sequences (e.g. the `[1;32mOK[0m` verdicts). All cited line
numbers are valid against the file as-is (spot-verified at `:73/:104/:1803/:2533-2570`), so nothing
hinges on this.

Consistency that DOES hold: REPORT rev-2 ↔ FIXNOTES ↔ ARBITRATION+erratum agree on 36/36, m=576=OK,
Class B open, the F8 arithmetic, n=16 = 4/5 quants, and the fix contents; the on-disk fix
(`ggml-hexagon.cpp:2171-2174`) matches the FIXNOTES diff byte-for-byte; the commit is the only delta
between evidence pin and HEAD; `remote -v` shows only `origin = https://github.com/Aspis0/kalsallama.git`,
matching the honest Upstream section; history cites `8be759e6f`/`c9872a257`/`81ff7abe5`/`214ae986e`
all verified to exist.

---

## Summary

| # | Finding | Severity | Verdict |
|---|---------|----------|---------|
| A1 | DSP contract = 3 sites, logical n = src0->ne[1] | — | CONFIRMED (verified) |
| A2 | k side already gated (eligibility :2182, supports_op :2830) | — | CONFIRMED |
| A3 | Both callers safe on false; HVX handles all five repack quants | — | CONFIRMED |
| A-F1 | Fix also flips op-merge eligibility via :3488; undocumented | MINOR | CONFIRMED |
| A4 | No behavior change for ne[1]%32==0 shapes | — | CONFIRMED |
| A-F2 | Dead sub-condition `ne01_padded % 32` post-fix | MINOR | CONFIRMED |
| B | All arithmetic in REPORT/ARBITRATION re-derived | — | CONFIRMED (0 defects) |
| C | m=576 passed; 36/36 on test-m %32≠0; AUDIT F1/F13 refuted | — | CONFIRMED |
| D | Class B internally consistent; mxfp4 clamp real | — | CONFIRMED |
| D-F1 | "Not:" list omits VTCM-undercount corruption case | MINOR | CONFIRMED |
| E-F1 | ARBITRATION "Consequence for Class A" contradicts its own erratum (35/36, A4-diagnostic) | MINOR | CONFIRMED |
| E-F2 | Next-QDC kit pin 93e9592fa contradicts the "after host fix" arms (fix is 736ddd206) | MINOR | CONFIRMED |
| E-F3 | Erratum's #43 retraction demand unsubstantiated (#43's own failing list has m=576; error text on the m=576 line) | MINOR | CONFIRMED |
| E-F4 | REPORT/FIXNOTES cite :1826 for q4_0 m=1 n=64; it is q4_1's error (q4_0's is :1816) | MINOR | CONFIRMED |
| E-F5 | F12 ppl cites directory-less; cited-directory copies are 12-line stubs; full logs live in -ppl-v | MINOR | CONFIRMED |
| — | "(ANSI stripped)" label inaccurate (cosmetic) | — | CONFIRMED (no action) |

## Overall verdict: **FIX**

The substantive desk state survives independent re-derivation — the F1 adjudication (m=576 passed,
36/36 on test-m %32≠0), every arithmetic claim, the name mapping, the supports_op/DSP status-path
facts, the Class B openness discipline, and the code fix itself are all sound, and the fix's
no-regression proof holds. Required corrections before the desk state is used as a defect reference:

1. REPORT.md:102 — Next-QDC kit pin `93e9592fa` → `736ddd206` (otherwise the A2/A4 "after host fix"
   arms are unsatisfiable and the preregistered cell is wasted).
2. ARBITRATION.md:86-93 — retract or rewrite the "Consequence for Class A" paragraph
   (`sound for 35/36` → `sound for 36/36`; `m=576 stays open as its own item (A4 diagnostic shape)`
   → `A4 is a no-regression control`), which its own erratum already contradicts.
3. ARBITRATION.md:24-25 — drop or rewrite the #43 retraction demand; #43's own raw supports a real
   m=576 failure in that run (pre-214ae986e, swallowed-error garbage compare); only the
   INTERNAL-ERROR *label* there is ambiguous. State that, or strike the demand.
4. REPORT.md:38 and FIXNOTES.md:15 — `INTERNAL-ERROR :1826` → `:1816` for q4_0 m=1 n=64 (by the
   type+blocks invariant `:1826` is q4_1's error).
5. REPORT/FIXNOTES F12 — name the source directory (`qdc-8elite-npu-v79-ppl-v/raw/`); the copies in
   the cited judge directory are stubs.
6. FIXNOTES — note the second caller (`mm_is_hmx_eligible` → `is_mergeable_mul_mat`, :3482/:3488) as a
   behavioral surface of the fix, and the deliberate dead `ne01_padded % 32` clause.
7. REPORT Class B "Not:" list — add the VTCM-layout-undercount (corruption without INTERNAL-ERROR)
   residual case.
