# `npu_fit`: HTP memory model

Status: paper specification only. No implementation, build, or device run is
part of this document. The source is `kalsallama`, branch
`kalsa/npu-judge-v79`, as read for the v79 calibration.

`npu_fit` has two answers for a fixed model, quantization, and shape set:

1. For every `MUL_MAT` and `MUL_MAT_ID`, does the HTP path select HMX, select
   HVX, or decline the operation (`NS`)?
2. Does the complete model fit the NPU lane?

This is an admission model, not a performance or correctness certificate.
`npu_fit` is necessary; the per-model PPL certificate remains sufficient. That
distinction is required by the governor: R2 is OFF until both the app-side
spike cell and `npu_fit` exist, and unknown fit resolves to CPU
(`docs/GOVERNOR-TRI-ENGINE-DESIGN.md:59-63,136-146`).

## 1. Inputs and outputs

This is a calculation contract, not a new API.

Inputs are:

- The pinned HTP build/generation and runtime facts: `n_hmx`, `n_threads`,
  `vtcm_size`, and the `opt_mm_select` level. The session obtains these from
  HTP hardware info and uses an 8 MiB VTCM default only when that query fails
  (`ggml/src/ggml-hexagon/ggml-hexagon.cpp:1729-1747`). The v79 bank used
  `threads=6`, `hmx=1`, and `vtcm=8 MB`
  (`scratchpad/agents/qdc-8elite-npu-v79-fixA-48/raw/list_devices.txt:7-10`).
- The model's actual shape set: operation kind, quantization, tensor
  dimensions, batch dimensions, strides/permutation, and whether each weight
  is in the HTP repacked buffer. These are needed because the backend checks
  all of them (`ggml/src/ggml-hexagon/ggml-hexagon.cpp:2812-2847,2884-2912`).
- The app-side memory admission facts: model-weight residency, available
  memory, context/KV configuration, and the host-KV reservation. The governor
  records that the NPU path materializes weights as anonymous memory and that
  host KV is mandatory; a 256 MB KV cache at context 2048 failed
  `fastrpc_mmap` (`docs/GOVERNOR-TRI-ENGINE-DESIGN.md:141-144`). This document
  does not invent a replacement formula for the app's RAM/residency policy.

Outputs are:

- One verdict per emitted matmul shape: `HMX`, `HVX`, or `NS`; the selected
  HTP kernel family; the computed VTCM requirement; and the VTCM budget used.
- One model verdict: `fit` only when every emitted matmul is `HMX` or `HVX`,
  no basic backend gate is unknown or false, the app-side weight/KV admission
  passes, and the shape set is complete for the requested execution mode.
  Otherwise the result is `not fit` or `unknown`, both of which route to CPU.

The test notation below is `(m,n,k)`. The test builder constructs `src0` as
`(k,m)` and `src1` as `(k,n)` (`tests/test-backend-ops.cpp:4460-4493`). Thus,
for ordinary `MUL_MAT`, `src0->ne[1]` is test `m`, while `src1->ne[1]` is test
`n`. This matters: the HMX logical-N gate is on test `m`, while the HVX
activation-row count is test `n`.

## 2. Decision chain: eligibility, parameters, budget

### 2.1 Backend eligibility

The device dispatcher sends the two operations to separate support checks:

```cpp
case GGML_OP_MUL_MAT:
    supp = ggml_hexagon_supported_mul_mat(sess, op);
case GGML_OP_MUL_MAT_ID:
    supp = ggml_hexagon_supported_mul_mat_id(sess, op);
```

(`ggml/src/ggml-hexagon/ggml-hexagon.cpp:4019-4056`). A false result is
`NS`, regardless of why it is false. For quantized `MUL_MAT`, the actual basic
checks are destination `F32`, activation `F32` or `F16`, one of
`Q4_0,Q4_1,Q8_0,IQ4_NL,MXFP4`, `src0->ne[0] % 32 == 0`, the `ne[1] <= 32768`
limit, no higher-dimensional activation broadcast, and, when a weight buffer is
present, an HTP repacked weight buffer
(`ggml/src/ggml-hexagon/ggml-hexagon.cpp:2816-2847`). `MUL_MAT_ID`
requires `src1=F32`, `dst=F32`, `src2=I32`, the same five quantized weight
types, `src0->ne[0] % 32 == 0`, and, when a weight buffer is present, a
repacked weight buffer (`ggml/src/ggml-hexagon/ggml-hexagon.cpp:2890-2908`).

These checks do not yet decide HMX versus HVX. For a passing operation,
`supports_op` calls precomputation and then applies the VTCM check:

```cpp
ggml_hexagon_precompute_matmul_params(sess, src0, src1, dst, &kparams);
if ((size_t) kparams.vtcm_size > sess->vtcm_size) return false;
```

The `MUL_MAT` lines are `ggml/src/ggml-hexagon/ggml-hexagon.cpp:2874-2881`;
the identical `MUL_MAT_ID` refusal is at `:2914-2921`.

### 2.2 HMX eligibility, then HVX fallback

Precomputation reads the dimensions and pads only repacked dimensions:

```cpp
const int ne00_padded = is_repack ? hex_round_up(ne00, 32) : ne00;
const int ne01_padded = is_repack ? hex_round_up(ne01, 32) : ne01;
const int ne11_padded = hex_round_up(ne11, 32);
```

(`ggml/src/ggml-hexagon/ggml-hexagon.cpp:2566-2585`). The HMX gate then
requires both the padded and logical dimensions to be aligned:

```cpp
if (ne01_padded % 32 != 0 || src0->ne[1] % 32 != 0) return false;
```

(`ggml/src/ggml-hexagon/ggml-hexagon.cpp:2171-2174`). That second term is the
`736ddd206` contract fix: padding must not hide an unaligned logical
`src0->ne[1]`. The remaining HMX requirements are HMX weight type, `K % 32`,
no batched quantized non-ID matmul, contiguous row-major strides, and

```cpp
const int m = is_matmul_id ? ne12 : ne11;
if (m <= HTP_MM_HMX_MIN_NROWS) return false;
```

(`ggml/src/ggml-hexagon/ggml-hexagon.cpp:2176-2202`; the threshold is `4` at
`ggml/src/ggml-hexagon/htp/matmul-ops.h:15-20`). HMX is attempted only when

```cpp
bool hmx_enabled = (sess->n_hmx > 0) && (opt_mm_select >= 3);
```

and an eligible operation reaches the HMX precompute; otherwise the code calls
the HVX precompute (`ggml/src/ggml-hexagon/ggml-hexagon.cpp:2587-2596`). If
HMX precompute cannot find a fitting candidate, it returns false and the same
HVX fallback is taken (`ggml/src/ggml-hexagon/ggml-hexagon.cpp:2303-2343`).

Therefore the per-shape result is:

- `HMX`: the basic check passes, HMX is enabled, eligibility passes, and HMX
  precompute returns a fitting parameterization.
- `HVX`: the basic check passes, but HMX is disabled, ineligible, or has no
  fitting parameterization; HVX precompute fits.
- `NS`: a basic check fails, or the final HVX/HMX `kparams.vtcm_size` exceeds
  the session budget.

### 2.3 HMX VTCM model

Use `A(x,a)` for the code's align-up operation
`((x+a-1)/a)*a` (`ggml/src/ggml-hexagon/htp/hex-common.h:28-38`). For HMX
2D, the code reads `vec_dot_size = k * sizeof(uint16_t)` and
`n_k_tiles = k / 32` (`ggml/src/ggml-hexagon/htp/matmul-ops.h:397-405`). For a
quantized weight:

```text
weight_area = A((nc / 32) * n_k_tiles * aligned_tile_size, 2048)
act_area    = A(mc * vec_dot_size, 2048)
output_area = A(mc * nc * sizeof(__fp16), 2048)
scratch0    = A(nc * vec_dot_size, 2048)
scratch1    = pipeline ? scratch0 : 0
min_f32     = A(act_threads * HTP_MM_DMA_ACT_MULTIPLIER * k * sizeof(float), 128)
max_f32     = act_threads * 64 * k * sizeof(float)
```

These are the code's formulas at `ggml/src/ggml-hexagon/htp/matmul-ops.h:404-411`;
`min_f32` and `max_f32` are at `:403` and `:429-431`; `2048` is
`HTP_MM_HMX_TILE_SIZE` at `:15-19`. In the code's allocation order:

```text
group_a_start = 2048 + act_area
group_b_size  = weight_area + (pipeline ? weight_area : 0)
                + output_area + scratch0 + (pipeline ? scratch0 : 0)
                + (pipeline ? output_area : 0)
group_c_size  = act_f32
```

Group A allocates the scales tile and activation area; Group B allocates the
optional double-buffered weight/output/scratch areas; Group C is the
activation-conversion temporary. These group sizes are at
`ggml/src/ggml-hexagon/htp/matmul-ops.h:413-435`. The exact overlap rule is
the code's

```text
act_f32 = A(min(max_f32, max(min_f32, group_b_size)), 128)
total   = group_a_start + max(group_b_size, group_c_size)
```

with `max_f32`, `min_f32`, the three groups, and the final total defined at
`ggml/src/ggml-hexagon/htp/matmul-ops.h:413-448`. Allocation is sequential
within a group and optional regions are present only when their condition is
true (`ggml/src/ggml-hexagon/htp/htp-vtcm.h:7-14`).

The HMX chunk search must be retained, not replaced by a single guessed tile:
the implementation tries activation-thread counts and accepts a candidate
only when the exact layout also fits (`ggml/src/ggml-hexagon/ggml-hexagon.cpp:2303-2334`).
Its cost terms are also code-defined:

```text
qweight_row_stride = (n_k_tiles * aligned_tile_size) / 32
size_per_n = (pipeline ? 2 : 1) * qweight_row_stride
              + (pipeline ? 2 : 1) * vec_dot_size
size_per_m = vec_dot_size
size_per_mn = (pipeline ? 2 : 1) * sizeof(uint16_t)
```

(`ggml/src/ggml-hexagon/htp/matmul-ops.h:273-287`). The chosen HMX pipeline
is `false` for `MUL_MAT_ID`; otherwise it is `ne11 > 32` (the ordinary
operation's activation-row count)
(`ggml/src/ggml-hexagon/ggml-hexagon.cpp:2222-2225`; helper at
`ggml/src/ggml-hexagon/htp/matmul-ops.h:269-271`).

The weight tile constants are not interchangeable:

| quant | `tile_size` | `aligned_tile_size` |
|---|---:|---:|
| `Q4_0` | 576 | 640 |
| `IQ4_NL` | 576 | 640 |
| `Q8_0` | 1088 | 1152 |
| `MXFP4` | 544 | 640 |
| `Q4_1` | 640 | 640 |

The constants are `ggml/src/ggml-hexagon/htp/matmul-ops.h:22-34`, and the
per-quant dispatch is `:187-217`.

### 2.4 HVX VTCM model

For quantized HVX, the code sets `n_hmx=0` and counts activation rows as
`src1_nrows = ne11 * ne12 * ne13`
(`ggml/src/ggml-hexagon/ggml-hexagon.cpp:2368-2388`). For `MUL_MAT_ID`, the
HMX chunk upper bound is instead `m_id_rows = dst->ne[1] * dst->ne[2]`
(`ggml/src/ggml-hexagon/ggml-hexagon.cpp:2295-2301`).

For the ordinary quantized HVX tiled/blocked path, the relevant code formulas
are:

```text
q_src1_row_size = q8_1_tiled_row_size(k) if Q4_1 else q8_0_tiled_row_size(k)
src1_size = A(q_src1_row_size * src1_nrows, 256)
n_k_tiles = k / 32
tile_row_size = n_k_tiles * aligned_tile_size
src0_size = A(n_prefetch * tile_row_size, 256) * n_threads
scratch_per_thread = A(k * sizeof(float), QK_Q8_0_TILED * sizeof(float))
dst_row_size_if_any = (dst_nrows > 0) ? A(dst_row_size, 128) : 0
dst_size = max(dst_row_size_if_any, scratch_per_thread) * n_threads
```

The weight replacement and tiled formulas are at
`ggml/src/ggml-hexagon/htp/matmul-ops.h:561-584`; the flat fallback uses the
same weight/scratch structure but `q8_0_flat_row_size` or `q8_1_flat_row_size`
at `:586-608`. The activation row helpers and flat-row formulas are at
`:220-245`; `QK_Q8_0_TILED` is `128` at
`ggml/src/ggml-hexagon/htp/htp-ops.h:39-42`. The tiled activation constants
(`Q8_0=1152`, `Q8_1=1280`) and DMA multiplier are at
`ggml/src/ggml-hexagon/htp/matmul-ops.h:36-48`.

The total is the sum in allocation order:

```text
total = src1_size + src0_size + src2_size + src3_size + dst_size
```

(`ggml/src/ggml-hexagon/htp/matmul-ops.h:615-627`). For ordinary quantized
`MUL_MAT`, the code tries tiled prefetch first (`max_prefetch=2` when
`src1_nrows > 4`, else 16 — audit F4), then explicitly falls back to flat HVX
if tiled VTCM is over budget (`ggml/src/ggml-hexagon/ggml-hexagon.cpp:2424-2469`). The flat
result is still subject to the final `> sess->vtcm_size` refusal. `npu_fit`
must report that final refusal as `NS`, not as a runtime error.

`MUL_MAT_ID` uses the same layout allocator but a distinct path: it selects
the block or row kernel from `src1_nrows < sess->n_threads`, always sizes the
activation as tiled q8, searches its permitted prefetch values, and has no
ordinary-MUL-MAT flat fallback (`ggml/src/ggml-hexagon/ggml-hexagon.cpp:2397-2423`).
Its resulting layout is still refused when `kparams.vtcm_size` exceeds the
session budget (`ggml/src/ggml-hexagon/ggml-hexagon.cpp:2914-2921`).

## 3. Worked examples

Use the v79 bank's `B = 8 * 1024 * 1024 = 8,388,608` byte budget and six HTP
threads. The two facts are recorded by the device (`scratchpad/agents/qdc-8elite-npu-v79-fixA-48/raw/list_devices.txt:7-10`). All byte totals below
are rounded exactly where the source rounds them.

### 3.1 Banked NS: `q4_0 (m=1,n=2048,k=8192)`

Here `src0->ne[1] = m = 1`, so `ne01_padded = 32` but the logical term
`src0->ne[1] % 32` fails. The operation therefore falls to HVX. Its 2048
activation rows make the first tiled attempt use prefetch 2; that attempt is
over budget, so the code uses flat HVX with prefetch 16
(`ggml/src/ggml-hexagon/ggml-hexagon.cpp:2424-2478`).

The final flat candidate is:

```text
q8_0 flat activation row = A(8192,128) + A((8192/32)*2,128)
                         = 8192 + 512 = 8704
src1 = A(8704 * 2048, 256) = 17,825,792

q4_0 weight row = (8192/32) * 640 = 163,840
src0 = A(16 * 163,840, 256) * 6 = 15,728,640

scratch = A(8192 * 4, 128 * 4) = 32,768 per thread
dst    = 32,768 * 6 = 196,608

total = 17,825,792 + 15,728,640 + 196,608
      = 33,751,040 bytes = 32.1875 MiB > B
```

The row formula is `ggml/src/ggml-hexagon/htp/matmul-ops.h:233-237`; the
repacked weight and scratch formulas are `:586-607`; and the five-region sum
is `:615-627`. The tiled attempt is also over budget (`606,142,464` bytes),
so the final flat result remains `NS`. The bank records exactly this shape as
`not supported [HTP0]` (`scratchpad/agents/qdc-8elite-npu-v79-fixA-48/raw/ops_mm_r1.txt:1737-1738`).

### 3.2 Banked NS: `q8_0 (m=6,n=4096,k=5120)`

The padded logical value is 32, but `src0->ne[1] = m = 6` fails the same
logical-N test. HVX again tries tiled prefetch 2 and then flat prefetch 16.
For the final flat candidate:

```text
q8_0 flat activation row = A(5120,128) + A((5120/32)*2,128)
                         = 5120 + 384 = 5504
src1 = A(5504 * 4096, 256) = 22,544,384

q8_0 weight row = (5120/32) * 1152 = 184,320
src0 = A(16 * 184,320, 256) * 6 = 17,694,720

scratch = A(5120 * 4, 128 * 4) = 20,480 per thread
dst    = 20,480 * 6 = 122,880

total = 22,544,384 + 17,694,720 + 122,880
      = 40,361,984 bytes = 38.4921875 MiB > B
```

The bank records `not supported [HTP0]` for this shape
(`scratchpad/agents/qdc-8elite-npu-v79-fixA-48/raw/ops_mm_r1.txt:1800-1801`).
The calibration report records both NS transitions as former-IE shapes whose
post-fix path is HMX-ineligible → HVX parameterization → VTCM over 8 MiB →
clean `NS` (`scratchpad/agents/qdc-8elite-npu-v79-fixA-48/REPORT.md:23-31`).

### 3.3 Banked OK HMX control: `q4_0 (m=576,n=512,k=576)`

Now `src0->ne[1] = 576` and `src1->ne[1] = 512`; both HMX alignment tests and
the HMX row-count test pass. The exact HMX search selects
`mc=512`, `nc=576`, and six activation-preparation threads (the tie-break
selects the full thread count; audit F1 — the byte total is unaffected). With
`pipeline=true`, `n_k_tiles=576/32=18`, `vec_dot_size=576*2=1152`, and the
aligned `q4_0` tile size 640:

```text
weight = A((576/32) * 18 * 640, 2048) = 208,896
act    = A(512 * 1152, 2048) = 589,824
out    = A(512 * 576 * 2, 2048) = 589,824
scratch= A(576 * 1152, 2048) = 663,552

group_a = 2048 + act = 591,872
group_b = 2*weight + out + 2*scratch + out = 2,924,544
group_c = 147,456
total   = group_a + max(group_b, group_c)
        = 3,516,416 bytes = 3.353515625 MiB < B
```

The area formulas and overlap are `ggml/src/ggml-hexagon/htp/matmul-ops.h:403-448`;
the exact-candidate check is `ggml/src/ggml-hexagon/ggml-hexagon.cpp:2314-2343`.
The device verdict is `OK` (`scratchpad/agents/qdc-8elite-npu-v79-fixA-48/raw/ops_mm_r1.txt:1736`), and the audit identifies it as the unchanged control
(`scratchpad/agents/qdc-8elite-npu-v79-fixA-48/AUDIT-REPORT.md:94-103`).

### 3.4 Ship-model shape: `q4_0 (m=6144,n=2,k=2048)`

The #47 ship log contains this ordinary matmul as
`2048:6144 x 2048:2`, and records `hvx-tiled vtcm 4128768`
(`scratchpad/agents/qdc-8elite-npu-v79-ppl-v/raw/ppl_ship_htp.txt:23158`). In
test notation, `n=2` is the HTP row count, so HMX declines at the `m <= 4`
check and the HVX **tiled** path with prefetch 16 fits (the log's `hvx-tiled`
label is correct; audit F4):

```text
q4_0 weight = A(16 * ((2048/32) * 640), 256) * 6 = 3,932,160
q8_0 tiled activation row = (2048/32) * 1152 = 73,728
src1 = A(73,728 * 2, 256) = 147,456
dst  = A(2048 * 4, 128 * 4) * 6 = 49,152

total = 3,932,160 + 147,456 + 49,152
      = 4,128,768 bytes = 3.9375 MiB < B
```

This is an actual ship shape, not a synthetic HMX assumption. The full #47
anchor is 10,648 ship-model `MUL_MAT`-family execute-op log lines (10,694
individual `MUL_MAT` ops once the 2,438 `MUL_MAT+ADD`, 30 double and 8 triple
fusions are unrolled — audit F5) and 3,024 executed OLMoE `MUL_MAT_ID`
operations, with PPL deltas of −0.029% and +0.064%
respectively (`scratchpad/agents/qdc-8elite-npu-v79-ppl-v/REPORT.md:23-26,38-48`).

## 4. What `npu_fit` cannot see

`npu_fit` is static arithmetic plus a shape census. It cannot explain Class B
state dependence: the bank has the same `q4_0 2880,32,2880` shape failing first
with NaN and then passing three times, while the nearby `k=1024`, wider, and
`q8_0` probes pass (`scratchpad/agents/qdc-8elite-npu-v79-fixA-48/REPORT.md:45-60`).
The ALIVE entry calls this the Class B NaN defect and records the clean/dirty
process contrast and the fact that padding did not cure it
(`docs/ALIVE.md:429-431`). Containment is the per-model #47-style PPL
certificate gate; the Class B defect is parked. `npu_fit` is necessary; PPL
certification stays sufficient.

It also cannot see thermal headroom or live thermal drift; the v79 record
contains different pre/post thermal readings (`docs/ALIVE.md:423`). Finally,
the v79 numbers do not transfer across HTP generations: ALIVE records fragile
740 behavior, a surviving 750 path, no HTP on G99, and a generational jump
requiring remeasurement (`docs/ALIVE.md:475-486`). Those generation facts are
inputs, not assumptions hidden inside this model.

An incomplete shape set is another unknown. A fit result covers only the
operations the app actually enumerates, in the execution modes it claims.

## 5. Open inputs from the app side

The app must provide, for each model and quantization:

- the complete emitted `MUL_MAT` and `MUL_MAT_ID` shape census, including prompt,
  microbatch, decode, and routed-expert cases;
- operation kind, logical dimensions, batch dimensions, strides/permutation,
  destination shape, and the repacked-weight fact needed by the backend gates;
- the weight-residency and host-KV admission facts required by the governor.

For `MUL_MAT_ID`, retain the routed destination-row bound used by the HMX
search (`ggml/src/ggml-hexagon/ggml-hexagon.cpp:2295-2301`), rather than
collapsing the operation to one dense shape. The source of truth can be the
app's built graph plus the existing verbose HTP operation logs: #47 records an
actual ship `MUL_MAT` at
`scratchpad/agents/qdc-8elite-npu-v79-ppl-v/raw/ppl_ship_htp.txt:23158` and an
actual OLMoE `MUL_MAT_ID` at
`scratchpad/agents/qdc-8elite-npu-v79-ppl-v/raw/ppl_olmoe_htp.txt:17305`.
The paper does not define a new collection API.

## 6. Acceptance: reproduce the bank, then trust the model

`npu_fit` earns trust only by reproducing the device verdicts below on the
pinned v79 facts (`threads=6`, `hmx=1`, `vtcm=8 MiB`). The calibration report
defines the 34 former-IE → OK observations, the two former-IE → NS observations,
and the unchanged HMX control (`scratchpad/agents/qdc-8elite-npu-v79-fixA-48/REPORT.md:33-39`).

| Test set | Expected per-shape result |
|---|---|
| `{Q4_0,Q4_1,Q8_0,MXFP4,IQ4_NL}` × `(m=16,n=5..9,k=256)` — 25 shapes | `HVX`, fit; former IE → OK |
| `{Q4_0,Q4_1,Q8_0,MXFP4}` × `(m=16,n=16,k=256)` — 4 shapes | `HVX`, fit; former IE → OK |
| `{Q4_0,Q4_1,Q8_0,MXFP4,IQ4_NL}` × `(m=1,n=64,k=256)` — 5 shapes | `HVX`, fit; former IE → OK |
| `Q4_0 (m=1,n=2048,k=8192)` | `NS`; HVX VTCM exceeds 8 MiB |
| `Q8_0 (m=6,n=4096,k=5120)` | `NS`; HVX VTCM exceeds 8 MiB |
| `Q4_0 (m=576,n=512,k=576)` | `HMX`, fit; device `OK` |

The two negative shapes are the exact `NS` transitions, with the refusal path
and HMX → HVX → over-budget trace recorded in the audit
(`scratchpad/agents/qdc-8elite-npu-v79-fixA-48/AUDIT-REPORT.md:76-90,107-126`).
The six appended extras remain part of the raw bank observation set, not a
replacement for these named acceptance cases.

The real-model anchors are replay/count checks, not a substitute for the app's
complete census: #47 shipped LFM2.5-2.6B QAD-Q4_0 with 10,648 `MUL_MAT`-family
execute-op log lines (10,694 ops with fusions unrolled — audit F5), and OLMoE
all-Q4_0 with 3,024 executed `MUL_MAT_ID`
operations; both passed their PPL comparisons (`scratchpad/agents/qdc-8elite-npu-v79-ppl-v/REPORT.md:21-26,38-48`).
Only after the shape census, memory admission, bank reproduction, and the
per-model PPL certificate pass may the governor treat the NPU lane as fit.
