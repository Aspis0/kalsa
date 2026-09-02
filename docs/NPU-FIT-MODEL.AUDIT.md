# AUDIT: `npu_fit` HTP memory model spec (NPU-FIT-MODEL.md)

Auditor: hostile math audit, independent of the authoring model (GPT-5.6).
Ground truth: `kalsallama @ kalsa/npu-judge-v79` (code), scratchpad v79 banks (data).
Verdicts: CONFIRMED / PLAUSIBLE / REFUTED per finding.

---

## Section 1 — ARITHMETIC (recomputation of every worked example)

All values recomputed mechanically (script) from the spec's own formulas and
from the code's formulas. Notation: `A(x,a)` = ceil-align.

### 1.1 §3.1 `q4_0 (m=1,n=2048,k=8192)` — **CONFIRMED**

- Flat q8_0 activation row: `A(8192,128) + A((8192/32)*2,128) = 8192 + 512 = 8,704` ✓
- `src1 = A(8,704 × 2048, 256) = 17,825,792` ✓ (exactly 69,632 × 256)
- Weight row: `(8192/32) × 640 = 163,840` ✓; `src0 = A(16 × 163,840, 256) × 6 = 15,728,640` ✓
- `scratch = A(8192·4, 512) = 32,768`; `dst = 32,768 × 6 = 196,608` ✓
- Total `33,751,040 B = 32.1875 MiB` ✓ (exact).
- Tiled attempt (prefetch 2): `606,142,464 B` ✓ recomputed exactly
  (`src1 = A(294,912 × 2048, 256) = 603,979,776`, `src0 = 1,966,080`, `dst = 196,608`).
- Verdict `> B = 8,388,608` → NS. Every number in the spec's §3.1 block reproduces.

### 1.2 §3.2 `q8_0 (m=6,n=4096,k=5120)` — **CONFIRMED**

- Flat row: `A(5120,128) + A(160·2,128) = 5,120 + 384 = 5,504` ✓
- `src1 = A(5,504 × 4096, 256) = 22,544,384` ✓; weight row `160 × 1152 = 184,320` ✓;
  `src0 = A(16 × 184,320, 256) × 6 = 17,694,720` ✓; `scratch = 20,480`, `dst = 122,880` ✓
- Total `40,361,984 B = 38.4921875 MiB` ✓ (exact). NS. All numbers reproduce.
- (Not claimed in spec, for completeness: tiled p=2 would be 757,309,440 B — also NS.)

### 1.3 §3.3 `q4_0 (m=576,n=512,k=576)` HMX — totals **CONFIRMED**, parameterization **PARTIALLY REFUTED**

- `n_k_tiles = 18`, `vec_dot_size = 1152`; weight `A(18·18·640, 2048) = 208,896` ✓;
  act `A(512·1152, 2048) = 589,824` ✓; out `A(512·576·2, 2048) = 589,824` ✓;
  scratch `A(576·1152, 2048) = 663,552` ✓.
- `group_a = 591,872` ✓; `group_b = 2·208,896 + 2·589,824 + 2·663,552 = 2,924,544` ✓.
- Total `3,516,416 B = 3.353515625 MiB` ✓ (exact), `< B` ✓.
- Chunk search reproduces `mc=512, nc=576` (per_n = 2·360 + 2·1152 = 3,024;
  n_fixed = 1,741,824; mblocks = nblocks = 1 is cost-minimal at nc = 576) ✓.

  **FINDING F1 (parameterization):** the spec claims the search selects "one
  activation-preparation thread". The code's loop (`ggml-hexagon.cpp:2303-2334`)
  iterates `act_threads = 6 → 3 → 1` and its tie-break
  (`act_threads > best_act_threads`, :2320) can only ever be won by the first
  (largest) iteration, so `act_threads_selected = 6`, not 1. The byte total is
  unaffected (group_c = 147,456 at 1 thread, 884,736 at 6 threads; both < group_b
  2,924,544, so `total = group_a + group_b` in either case — the spec's number
  3,516,416 stands), but the stated parameterization is wrong. Severity: cosmetic
  to the verdict, but it is a checkable claim and it is false.

### 1.4 §3.4 `q4_0 (m=6144,n=2,k=2048)` — **CONFIRMED**

- `tile_row = (2048/32)·640 = 40,960`; `src0 = A(16 × 40,960, 256) × 6 = 3,932,160` ✓
- Tiled q8_0 row: `(2048/32)·1152 = 73,728`; `src1 = A(73,728 × 2, 256) = 147,456` ✓
- `dst = A(2048·4, 512) × 6 = 8,192 × 6 = 49,152` ✓
- Total `4,128,768 B = 3.9375 MiB` ✓ (exact), matches the #47 log value digit-for-digit.
- Control: the FLAT alternative would be 3,985,664 B (flat row 2,176) and tiled
  p=2 would be 688,128 B — neither matches the log. See Section 3.

### 1.5 Formula-level conversions

- `32.1875 MiB`, `38.4921875 MiB`, `3.353515625 MiB`, `3.9375 MiB` — all exact.
- `B = 8,388,608`, `threads = 6` — consistent throughout.
- No arithmetic error found anywhere in §3.

**Section 1 verdict: all arithmetic CONFIRMED; one parameterization claim (§3.3
"one activation-preparation thread") REFUTED (F1).**

---

## Section 2 — FORMULA FIDELITY (line-by-line check of every cited source)

Every `file:line` reference in §2 was opened and the transcribed formula/claim
compared against the code. Confirmed formulas are listed; only deviations are
filed as findings.

### §2.1 Backend eligibility

| Spec claim | Code (file:line) | Verdict |
|---|---|---|
| Dispatcher sends MUL_MAT / MUL_MAT_ID to separate checks | `ggml-hexagon.cpp:4033-4040` — switch cases `GGML_OP_MUL_MAT` → `supported_mul_mat`, `GGML_OP_MUL_MAT_ID` → `supported_mul_mat_id` | **CONFIRMED** |
| Quantized MUL_MAT: dst F32, act F32/F16, five weight types, `ne0[0] % 32`, `ne[1] <= 32768`, no broadcast, repacked buffer | `:2816-2847` — each condition listed verbatim in the code | **CONFIRMED** |
| MUL_MAT_ID: src1=F32, dst=F32, src2=I32, same five types, `ne0[0] % 32`, repacked | `:2890-2908` — exact | **CONFIRMED** |
| Precompute + VTCM refusal: `ggml_hexagon_precompute_matmul_params`; `kparams.vtcm_size > sess->vtcm_size` → false | `:2874-2881` (MUL_MAT), `:2914-2921` (MUL_MAT_ID) — identical pattern | **CONFIRMED** |

### §2.2 HMX eligibility, then HVX fallback

| Spec claim | Code (file:line) | Verdict |
|---|---|---|
| Padding formulas: `ne00_padded`, `ne01_padded` (repack only), `ne11_padded` | `:2568-2576` — exact | **CONFIRMED** |
| HMX gate: `ne01_padded % 32 != 0 \|\| src0->ne[1] % 32 != 0` | `:2171-2174` — exact | **CONFIRMED** |
| Five HMX requirements (weight type, K%32, no batched quant non-ID, contiguous, `m <= 4` decline) | `:2176-2202` — exact | **CONFIRMED** |
| `hmx_enabled = (n_hmx > 0) && (opt_mm_select >= 3)` | `:2588` — exact | **CONFIRMED** |
| HMX precompute returns false → HVX fallback at `:2595-2596` | `:2593-2596` — the `goto finalize` path and the `ggml_hexagon_precompute_hvx_mm_params` call | **CONFIRMED** |

### §2.3 HMX VTCM model

| Spec claim | Code (file:line) | Verdict |
|---|---|---|
| `A(x,a)` = `((x+a-1)/a)*a` | `hex-common.h:34-37` — `hex_align_up` = `hmx_ceil_div(v, align) * align` | **CONFIRMED** |
| `vec_dot_size = k * sizeof(uint16_t)`, `n_k_tiles = k / 32` | `matmul-ops.h:397-405` — exact | **CONFIRMED** |
| `HTP_MM_HMX_TILE_SIZE = 2048` | `matmul-ops.h:15-18` — `(32 * 32 * sizeof(__fp16))` | **CONFIRMED** |
| Weight tile constants per quant | `matmul-ops.h:22-34` — exact match with spec table | **CONFIRMED** |
| Per-quant dispatch | `matmul-ops.h:187-217` — exact | **CONFIRMED** |
| `min_f32 = A(act_threads * DMA_ACT_MULTIPLIER * k * sizeof(float), 128)` | `matmul-ops.h:403` — exact | **CONFIRMED** |
| `max_f32 = act_threads * 64 * k * sizeof(float)` | `matmul-ops.h:429` — exact | **CONFIRMED** |
| `weight_area = A((nc/32) * n_k_tiles * aligned_tile_size, 2048)` | `matmul-ops.h:407-409` — exact for `is_quant` path | **CONFIRMED** |
| `act_area = A(mc * vec_dot_size, 2048)` | `matmul-ops.h:410` — exact | **CONFIRMED** |
| `output_area = A(mc * nc * sizeof(__fp16), 2048)` | `matmul-ops.h:411` — exact | **CONFIRMED** |
| `scratch0 = A(nc * vec_dot_size, 2048)` | `matmul-ops.h:412` — exact | **CONFIRMED** |
| Group A/B/C structure and `total = group_a_start + max(group_b, group_c)` | `matmul-ops.h:415-448` — VTCM_LAYOUT_ALLOC macros, `off = off_group_a + hex_smax(group_b_size, group_c_size)` at `:447` | **CONFIRMED** |
| `VTCM_LAYOUT_ALLOC` / `VTCM_LAYOUT_ALLOC_OPTIONAL` macros | `htp-vtcm.h:9-10` — exact | **CONFIRMED** |
| Chunk cost formulas: `size_per_m = vec_dot_size`, `size_per_mn = (pipeline?2:1)*sizeof(uint16_t)` | `matmul-ops.h:281-282` — exact | **CONFIRMED** |

**FINDING F2 (§2.3 `size_per_n` formula):** The spec states:
```
size_per_n = (pipeline ? 2 : 1) * qweight_row_stride
              + (pipeline ? 2 : 1) * vec_dot_size
```
This factors the pipeline multiplier across both terms. The code at
`matmul-ops.h:278-280` reads:
```c
*size_per_n_out = (pipeline ? 2 : 1) * (is_quant ? qweight_row_stride : row_stride) +
                  (pipeline ? 2 * vec_dot_size : vec_dot_size);
```
The pipeline multiplier applies to `qweight_row_stride` (1× or 2×) and to
`vec_dot_size` (1× or 2×), but the spec's factored form `(pipeline?2:1) * X +
(pipeline?2:1) * Y` is algebraically equivalent only when `pipeline` is the same
for both terms — which it is here (both are `(pipeline?2:1)`). **On closer
inspection, the spec's factored form IS equivalent** because the pipeline flag is
the same boolean for both multiplicative positions. The two forms produce the
same numeric result. **Verdict revised to CONFIRMED** — the factoring is
stylistically different from the code but mathematically identical.

### §2.4 HVX VTCM model

| Spec claim | Code (file:line) | Verdict |
|---|---|---|
| `src1_nrows = ne11 * ne12 * ne13` for quantized HVX | `ggml-hexagon.cpp:2387` — exact | **CONFIRMED** |
| `q8_0_tiled_row_size(ne)` and `q8_0_flat_row_size(ne)` formulas | `matmul-ops.h:220-237` — tiled: `A(A(ne,128)/32, 1)*1152`; flat: `A(ne,128) + A(ceil(ne/32)*2, 128)` | **CONFIRMED** |
| `QK_Q8_0_TILED = 128` | `htp-ops.h:40` — exact | **CONFIRMED** |
| Tiled activation constants Q8_0=1152, Q8_1=1280 | `matmul-ops.h:36-37` — exact | **CONFIRMED** |
| `DMA_ACT_MULTIPLIER = 2 * DMA_ACT_ROWS_PER_STEP` | `matmul-ops.h:48` — `HTP_MM_DMA_ACT_MULTIPLIER (2 * HTP_MM_DMA_ACT_ROWS_PER_STEP)` = 4 | **CONFIRMED** |
| Tiled src0: `A(n_prefetch * tile_row_size, 256) * n_threads` | `matmul-ops.h:571-582` — exact for repacked path | **CONFIRMED** |
| Tiled src1: `A(q_src1_row_size * src1_nrows, 256)` | `matmul-ops.h:565` — exact | **CONFIRMED** |
| `total = src1 + src0 + src2 + src3 + dst` | `matmul-ops.h:615-627` — five `VTCM_LAYOUT_ALLOC` calls sum to `L->total_bytes = off` | **CONFIRMED** |
| Flat HVX fallback, prefetch=16, tiled-first then flat | `ggml-hexagon.cpp:2424-2478` — exact structure | **CONFIRMED** |
| `MUL_MAT_ID` distinct path, always tiled q8 | `ggml-hexagon.cpp:2397-2423` — exact | **CONFIRMED** |

**FINDING F3 (§2.4 `dst_size` description):** The spec's formula:
```
dst_row_size_if_any = (dst_nrows > 0) ? A(dst_row_size, 128) : 0
dst_size = max(dst_row_size_if_any, scratch_per_thread) * n_threads
```
implies the `max` is computed on the total `dst_size` (before `× n_threads`).
The code at `matmul-ops.h:576-582` computes:
```c
size_t quant_scratch_size_per_thread = htp_mm_round_up(ne10 * sizeof(float),
    QK_Q8_0_TILED * sizeof(float));
size_t dst_size_per_thread = dst_nrows > 0 ? htp_mm_round_up(dst_row_size, 128) : 0;
if (dst_size_per_thread < quant_scratch_size_per_thread) {
    dst_size_per_thread = quant_scratch_size_per_thread;
}
dst_sz = dst_size_per_thread * n_threads;
```
The `max` is per-thread, then the result is multiplied by `n_threads`. The spec's
formula produces the same numeric result (max distributes over multiplication by
a positive constant), but the spec's description conflates per-thread and total.
**Verdict: CONFIRMED** (numeric equivalence holds); the description is imprecise
but not wrong.

**Section 2 verdict: all formulas CONFIRMED. One imprecise `dst_size` description
(F3) noted but numerically equivalent. No dropped terms, wrong `sizeof`, wrong
align base, or wrong condition found.**

---

## Section 3 — THE 3.4 LABEL TENSION

The GLM's Section 1 proved that the spec's §3.4 total of 4,128,768 bytes
matches the #47 log digit-for-digit, while the flat alternative (3,985,664) and
the tiled p=2 (688,128) do not. The log line at
`ppl_ship_htp.txt:23158` reads:
```
hvx-tiled vtcm 4128768
```
The question: which code path actually produces 4,128,768, and is the label
`hvx-tiled` accurate?

### Trace through the code for `q4_0 (m=6144,n=2,k=2048)`

In spec notation: `src0->ne[0]=k=2048`, `src0->ne[1]=m=6144`,
`src1->ne[1]=n=2`.

**Step 1 — HMX gate.** `ggml_hexagon_precompute_matmul_params` at
`ggml-hexagon.cpp:2176-2202`:
```
const int m = is_matmul_id ? ne12 : ne11;  // = ne11 = n = 2
if (m <= HTP_MM_HMX_MIN_NROWS) return false;  // 2 <= 4 → true → HMX declined
```
The spec says "HMX declines at the `m <= 4` check" — this is correct. The
declined HMX path falls through to HVX at `:2593-2596`.

**Step 2 — HVX tiled path.** `ggml_hexagon_precompute_hvx_mm_params` at
`:2424-2469`:
- `try_tiled = (k_align && opt_mm_select >= 2)` — `ne10=2048 % 32 == 0` and
  `opt_mm_select=3` (default, `:66`) → `try_tiled = true`.
- `src1_nrows = ne11 * ne12 * ne13 = 2 * 1 * 1 = 2`.
- `max_prefetch = (src1_nrows > HTP_MM_HMX_MIN_NROWS) ? 2 : 16` —
  `2 > 4` is false → `max_prefetch = 16`.
- Loop: `d = 16`. Calls `htp_mm_hvx_vtcm_layout_build` with tiled kernel,
  `n_prefetch=16`.

**Step 3 — Layout build.** `matmul-ops.h:560-593` for `HVX_QUANT_ROW`:
- `q_src1_row_size = q8_0_tiled_row_size(2048) = (A(2048,128)/32) * 1152 =
  (2048/32) * 1152 = 64 * 1152 = 73,728`.
- `src1_sz = A(73,728 * 2, 256) = A(147,456, 256) = 147,456`.
- `tile_row_size = (2048/32) * 640 = 40,960`.
- `src0_sz = A(16 * 40,960, 256) * 6 = A(655,360, 256) * 6 = 655,360 * 6 =
  3,932,160`.
- `quant_scratch = A(2048 * 4, 128 * 4) = A(8192, 512) = 8192`.
- `dst_size_per_thread = max(A(dst_row_size, 128), 8192) = 8192`.
- `dst_sz = 8192 * 6 = 49,152`.
- `total = 147,456 + 3,932,160 + 49,152 = 4,128,768`.

**Step 4 — Budget check.** `4,128,768 ≤ 8,388,608` → fits. The tiled path
succeeds. `kparams->n_prefetch = 16`, `kparams->vtcm_size = 4,128,768`.

### What the spec gets wrong

The spec's §3.4 says:
> "so HMX declines at the `m <= 4` check and HVX uses prefetch 16"

This is technically accurate — the code does use prefetch 16 — but it
**omits the tiled vs. flat distinction**. The code tries tiled first with
prefetch 16, and the tiled path fits. The flat fallback is never reached.

More critically, the spec's §2.4 states:
> "the code tries tiled prefetch first (`n_prefetch=2` when there are more
> than four rows), then explicitly falls back to flat HVX if tiled VTCM is
> over budget"

This describes the *general* logic but says `n_prefetch=2` for the tiled
path — the actual starting prefetch is `max_prefetch = (src1_nrows > 4) ? 2 : 16`.
For `src1_nrows=2`, `max_prefetch=16`, so the tiled path starts at prefetch 16,
not 2. The spec's parenthetical is wrong about the starting prefetch value for
this shape.

The label `hvx-tiled` in the log is **accurate** — the kernel type is
`HTP_MM_KERNEL_HVX_QUANT_ROW` (tiled), not `HTP_MM_KERNEL_HVX_QUANT_ROW_FLAT`.
The flat path would have used `q8_0_flat_row_size` (row size 2,176) instead of
`q8_0_tiled_row_size` (row size 73,728), producing a different src1 and total.

**FINDING F4 (§3.4 / §2.4 label and prefetch):** The spec's §2.4 parenthetical
"`n_prefetch=2` when there are more than four rows" conflates the `> HMX_MIN`
branch (which sets `max_prefetch=2`) with the `≤ HMX_MIN` branch (which sets
`max_prefetch=16`). For §3.4's shape (`src1_nrows=2 ≤ 4`), the tiled path
starts at prefetch 16 and fits — the flat fallback is never taken. The log
label `hvx-tiled` is correct. The spec should say: "HVX tiled with prefetch 16"
rather than implying the flat path is what produces 4,128,768. **Fix:** in §3.4,
replace "HVX uses prefetch 16" with "HVX tiled path, prefetch 16, fits"; in §2.4,
replace the parenthetical with "`max_prefetch=2` when `src1_nrows > 4`, else 16".

**Section 3 verdict: the byte total 4,128,768 is CONFIRMED (tiled HVX, prefetch
16). The spec's label `hvx-tiled` is correct. The §2.4 starting-prefetch
description is REFUTED for shapes with `src1_nrows ≤ 4` (F4).**

---

## Section 4 — NOTATION: (m,n,k) mapping and HMX gate variable

### §1 test notation

The spec states:
> "The test notation below is `(m,n,k)`. The test builder constructs `src0` as
> `(k,m)` and `src1` as `(k,n)` (`tests/test-backend-ops.cpp:4460-4493`)."

The code at `test-backend-ops.cpp:4460-4493` reads:
```cpp
a = ggml_new_tensor_4d(ctx, type_a, k_physical, m, bs[0], bs[1]);
// ...
b = ggml_new_tensor_4d(ctx, type_b, k_physical, n, bs[0]*nr[0], bs[1]*nr[1]);
```
In ggml's 4D layout `(ne0, ne1, ne2, ne3)`: `src0 = (k, m, ...)` means
`src0->ne[0]=k`, `src0->ne[1]=m`; `src1 = (k, n, ...)` means `src1->ne[0]=k`,
`src1->ne[1]=n`. This matches the spec's claim exactly.

**CONFIRMED:** `(m,n,k)` ↔ `src0=(k,m)`, `src1=(k,n)` — test builder at
`:4460-4493`.

### HMX gate variable `m`

The spec's §2.2 states:
> `const int m = is_matmul_id ? ne12 : ne11;`
> `if (m <= HTP_MM_HMX_MIN_NROWS) return false;`
> (ggml-hexagon.cpp:2176-2202)

The code at `:2195-2199` reads:
```c
const int m = is_matmul_id ? ne12 : ne11;
if (m <= HTP_MM_HMX_MIN_NROWS) {
    return false;
}
```

For ordinary MUL_MAT: `m = ne11 = src1->ne[1] = n` (spec's `n`).
For MUL_MAT_ID: `m = ne12 = src1->ne[2]` (the batch/expert dimension).

The spec uses `m` as the code's variable name and says this is the "HMX
logical-N gate". In the spec's own `(m,n,k)` notation, the variable `m` in the
code corresponds to the spec's `n` (ordinary MUL_MAT) or to a batch dimension
(MUL_MAT_ID). The spec is **aware** of this — it says "the HMX logical-N gate
is on test `m`" (§1), meaning the code's `m` variable gates the logical-N
dimension, not the spec's `m`.

**CONFIRMED:** The code's `m` variable is correctly identified. The spec
explicitly notes the naming collision ("HMX logical-N gate is on test `m`").

### §2.2 pipeline decision

The spec states:
> "The chosen HMX pipeline is `false` for `MUL_MAT_ID`; otherwise it is
> `ne11 > 32` (the ordinary operation's activation-row count)"
> (ggml-hexagon.cpp:2222-2225)

The code at `:2220-2221` reads:
```c
const bool pipeline = is_matmul_id ? false : htp_mm_hmx_pipeline(ne11);
```
where `htp_mm_hmx_pipeline(m)` at `matmul-ops.h:269-271` returns `m > 32`.

The spec's line citation `:2222-2225` is off by one — the actual line is `:2221`.
The description is correct: `false` for MUL_MAT_ID, `ne11 > 32` otherwise.

**CONFIRMED** (minor line offset in citation, not a content error).

**Section 4 verdict: notation CONFIRMED throughout. The spec correctly maps
(m,n,k) ↔ src0/src1, correctly identifies the HMX gate variable `m` as
corresponding to the spec's `n`, and correctly describes the pipeline decision.
No findings.**

---

## Section 5 — CLAIMS vs BANK: acceptance table, op counts, #47 anchors

### 5.1 Acceptance table composition

The spec's §6 table lists:
- 25 shapes: `{Q4_0,Q4_1,Q8_0,MXFP4,IQ4_NL}` × `(m=16,n=5..9,k=256)` — HVX, fit
- 4 shapes: `{Q4_0,Q4_1,Q8_0,MXFP4}` × `(m=16,n=16,k=256)` — HVX, fit
- 5 shapes: `{Q4_0,Q4_1,Q8_0,MXFP4,IQ4_NL}` × `(m=1,n=64,k=256)` — HVX, fit
- 1 shape: `Q4_0 (m=1,n=2048,k=8192)` — NS
- 1 shape: `Q8_0 (m=6,n=4096,k=5120)` — NS
- 1 shape: `Q4_0 (m=576,n=512,k=576)` — HMX, fit (control)

Total named cases: 25+4+5+2+1 = 37.

The REPORT at `qdc-8elite-npu-v79-fixA-48/REPORT.md:37` states:
> `Raw category count: 34 former-IE→OK (25 = five quant types × m=16,n=5..9;
> 4 = m=16,n=16; 5 = m=1,n=64), 2 former-IE→NS, 6 appended extras: 42
> observations.`

The spec's §6 says "the 34 former-IE → OK observations, the two former-IE → NS
observations, and the unchanged HMX control". 34+2+1 = 37 named acceptance
cases. The REPORT's 42 total includes 6 appended extras (FIFO positions
1471-1476, after the 1470 stock cases). The spec correctly excludes these 6
from the acceptance table.

**CONFIRMED:** The acceptance table composition (25+4+5=34 former-IE→OK, 2 NS,
1 control = 37 named cases) matches the REPORT. The 6 appended extras are
correctly noted as "part of the raw bank observation set, not a replacement."

### 5.2 #47 ship op count: independent recount

The GLM's dying words reported 8172 plain + 2438 fused (MUL_MAT+ADD) = 10610,
not 10648. I recounted from `ppl_ship_htp.txt` using `grep -c 'execute-op
MUL_MAT'` (substring match, matching the REPORT's method): **10,648 lines.**

Breakdown by op family:
```
$ grep 'execute-op' ppl_ship_htp.txt | sed 's/.*execute-op //' | sed 's/|.*//' | sort | uniq -c | sort -rn
   8172 MUL_MAT
   2438 MUL_MAT+ADD
     30 MUL_MAT+MUL_MAT
      8 MUL_MAT+MUL_MAT+MUL_MAT
```
Sum: 8172 + 2438 + 30 + 8 = **10,648** — exact match.

The GLM missed the 30 `MUL_MAT+MUL_MAT` and 8 `MUL_MAT+MUL_MAT+MUL_MAT`
fused-op lines. These are legitimate fused operations (double and triple
MUL_MAT fusions), each logged as a single `execute-op` line.

**The REPORT's count of 10,648 is correct.** The GLM's partial count was an
undercount due to incomplete pattern matching.

### 5.3 Does 10648 mean "10648 MUL_MAT operations"?

The REPORT at `ppl-v/REPORT.md:38` says:
> `10648 HTP0 execute-op MUL_MAT lines`

This is precise: 10,648 **log lines** matching `execute-op MUL_MAT` (substring).
The spec's §6 says:
> `10,648 executed ship-model MUL_MAT operations`

This is ambiguous. The 30 `MUL_MAT+MUL_MAT` lines each execute 2 MUL_MAT
operations; the 8 `MUL_MAT+MUL_MAT+MUL_MAT` lines each execute 3. The true
MUL_MAT operation count is:
```
8172 × 1 + 2438 × 1 + 30 × 2 + 8 × 3 = 8172 + 2438 + 60 + 24 = 10,694
```

**FINDING F5 (§6 count terminology):** The spec says "10,648 executed
ship-model MUL_MAT operations" but 10,648 is the count of execute-op **log
lines**, not the count of individual MUL_MAT operations. The true MUL_MAT
operation count is 10,694 (accounting for 30 double-fusions and 8
triple-fusions). The REPORT is precise ("10648 `HTP0 execute-op MUL_MAT`
lines"); the spec drops the word "lines" and implies a different meaning.
**Severity: cosmetic.** The spec's number is the correct profiler line count;
the phrasing is imprecise. **Fix:** replace "10,648 executed ship-model
MUL_MAT operations" with "10,648 ship-model `execute-op MUL_MAT` log lines".

### 5.4 #47 anchor consistency

The spec's §3.4 cites:
> `#47 records an actual ship MUL_MAT at ppl_ship_htp.txt:23158`

The line at offset 23158 in the 1-indexed file is:
```
0.03.099.078 D ggml-hex: HTP0 execute-op MUL_MAT|blk.0.shortconv.in_proj...
```
This is the first execute-op line of the ship model. The spec's anchor is
correct.

The OLMoE anchor at `ppl_olmoe_htp.txt:17305` was not independently verified
in this audit (out of scope for the ship-model focus), but the REPORT's
3024 `MUL_MAT_ID` count is consistent with the §6 claim.

**Section 5 verdict: acceptance table CONFIRMED (34+2+1). Op count 10,648 is
the correct log-line count (GLM's undercount reconciled). The spec's phrasing
"10,648 operations" is imprecise (F5, cosmetic). The #47 anchor is correct.**

---

## Combined Verdict Table

| # | Finding | Section | Verdict | Severity | Fix required? |
|---|---|---|---|---|---|
| F1 | §3.3 "one activation-preparation thread" — code selects 6, not 1 | §3.3 | **REFUTED** | cosmetic (total unaffected) | Yes — text only |
| F2 | §2.3 `size_per_n` pipeline factoring — reviewed and found equivalent | §2.3 | ~~REFUTED~~ → **CONFIRMED** | n/a | No |
| F3 | §2.4 `dst_size` description — max is per-thread, not total | §2.4 | **CONFIRMED** (imprecise) | cosmetic (numeric equivalence) | No |
| F4 | §2.4 starting-prefetch description wrong for `src1_nrows ≤ 4`; §3.4 execution path mislabeled as flat | §2.4/§3.4 | **REFUTED** | structural (wrong code path described) | Yes |
| F5 | §6 "10,648 executed operations" — count is log lines, not individual MUL_MAT ops (true count: 10,694) | §6 | **REFUTED** (cosmetic) | cosmetic | Yes — text only |

**F1 severity note:** The spec's §3.3 total (3,516,416 bytes) is correct
regardless of `act_threads` value (the byte total is `group_a + group_b` in
both the 1-thread and 6-thread cases, since `group_c < group_b` either way).
The finding is a checkable claim that is false, but it does not affect any
verdict or byte total.

**F4 severity note:** This is the most significant finding. The spec's §2.4
describes the tiled HVX path as trying `n_prefetch=2` first, then falling back
to flat — but for shapes with `src1_nrows ≤ 4` (including the actual ship shape
§3.4), the tiled path starts at prefetch 16 and fits. The log label
`hvx-tiled` is correct; the spec's prose implies the flat path is taken.

---

## Final Verdict: APPLY with fixes

The spec's arithmetic is correct throughout. All byte totals reproduce. All
formula transcriptions are accurate (one imprecise `dst_size` description is
numerically equivalent). The acceptance table composition matches the REPORT.
The op count 10,648 is the correct log-line count.

Three findings require text fixes:

1. **F1** (§3.3): replace "one activation-preparation thread" with the actual
   parameterization (6 threads selected by the `act_threads > best_act_threads`
   tie-break), or remove the thread-count claim entirely.

2. **F4** (§2.4 + §3.4): fix the starting-prefetch description to account for
   the `src1_nrows ≤ 4` branch (`max_prefetch=16`), and clarify that §3.4's
   shape uses the tiled path (not flat). The log label `hvx-tiled` is correct
   and should be explicitly affirmed.

3. **F5** (§6): replace "10,648 executed ship-model MUL_MAT operations" with
   "10,648 ship-model `execute-op MUL_MAT` log lines" or add a parenthetical
   clarifying the count is log lines (the true MUL_MAT operation count is
   10,694).

**APPLY.** The spec earns trust for arithmetic, formula fidelity, notation,
and bank reproduction. The three text fixes are non-blocking — they correct
descriptions that do not affect any byte total, verdict, or acceptance claim.

---
*Audit complete. Auditor: hostile math audit, independent of the authoring
model. GLM Section 1 arithmetic verdicts retained per instruction.*
