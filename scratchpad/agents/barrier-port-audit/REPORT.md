# Barrier-port audit: commit `9a4112106`

Status: audit in progress. Code is read-only; this file is the only artifact being written.

Target: `BigMoeOnEdge/third_party/llama.cpp`, branch `kalsa/kernel-s3-repack`, commit `9a4112106` (`opencl: make q4/q5/q6 MoE K kernels barrier-safe`).

Scope: all six q4_K/q5_K/q6_K MoE GEMV/GEMM kernels, their host dispatch geometry and argument plumbing, the new `m=96,k=256` MUL_MAT_ID discriminators, and `supports_op` behavior. Reference pattern: the existing q2_K/q3_K barrier-safe kernels and `scratchpad/agents/qk23-kernels/DESIGN.md`.

Preliminary inventory:

- Changed files are exactly the six target kernels and `tests/test-backend-ops.cpp`.
- Each GEMV has one work-group `barrier(CLK_LOCAL_MEM_FENCE)` in its reduction.
- Each GEMM has two full-work-group barriers around `out_idx`/stores and two `sub_group_barrier` calls per K-loop iteration.
- Each target kernel still has an early return for `block_id_n >= total_tiles[0]` (GEMM) or no early return (GEMV after the patch). Uniformity of that GEMM guard depends on the real 3-D enqueue geometry and remains to be proven.

Findings will be added below with verdicts `CONFIRMED`, `PLAUSIBLE`, or `REFUTED`, each tied to file and line.

## Dispatch geometry (the guard proof depends on this)

The host does not launch these kernels with an arbitrary shape. In
`ggml/src/ggml-opencl/ggml-opencl.cpp`:

- GEMV for q4_K/q5_K/q6_K uses local `{64,4,1}` and global
  `{ceil(ne01/64)*64,4,ne20}` (`:23032-23051`, `:23234-23253`, and
  `:23430-23449`). Thus each work-group is 64 x-lanes by four reduction
  lanes; x is exactly one 64-row tile.
- GEMM uses local `{64,1,1}`, global x `64`, global y `ceil(ne01/64)`, and
  global z `max_post_router_tile` (`q4_K:23208-23212`, q5_K:23404-23408,
  q6_K:23581-23585`). Therefore `get_global_id(1)` and
  `get_global_id(2)` are work-group-uniform: local y/z are both one, and
  `get_global_id(0)==get_local_id(0)` because the x launch is one 64-wide
  work-group. The enqueue wrapper passes a null global offset
  (`ggml-opencl.cpp:1004-1016`), so there is no hidden coordinate shift.
- The Adreno gate remains `ne01 % 32 == 0` plus `tensor->ne[3] == 1`
  (`ggml-opencl.cpp:7203-7210`). The audit below assumes the non-empty tensor
  shapes that the dispatch can meaningfully execute (`ne01 > 0`); the
  zero-row edge is called out separately at the end.

## 1. Barrier audit

### GEMV: q4_K, q5_K, q6_K

The old kernels had a lane-local early return before the reduction barrier:
q4_K parent `gemv_moe_q4_k_f32_ns.cl:68-70`, q5_K parent
`gemv_moe_q5_k_f32_ns.cl:69-71`, and q6_K parent
`gemv_moe_q6_k_f32_ns.cl:41-43`. On `ne01=96`, the second x work-group had
valid lanes 64..95 and padded lanes 96..127. The latter returned while the
former reached the barrier. That is a real hang/undefined-behavior defect in
the parent for the exact `%32 && !%64` shape.

In `9a4112106`, none of the six GEMV bodies has an early return. The only
work-group barriers are q4_K `gemv_moe_q4_k_f32_ns.cl:157`, q5_K
`gemv_moe_q5_k_f32_ns.cl:162`, and q6_K `gemv_moe_q6_k_f32_ns.cl:132`.
`valid` only selects the row used by loads and is not used to skip control
flow before those barriers. All four `sgid` values execute the same K-loop
trip count and then reach the reduction barrier. The reduction writes are
also unconditional for `sgid` 1..3, so padded lanes do not change barrier
participation.

For `ne01=1`, 32, 64, and 96, the x launch is respectively 64, 64, 64, and
128. In every work-group all lanes reach the barrier; only the load row and
final store differ. This covers both `ne01 < 64` and the requested
`ne01=96` case.

VERDICT: `CONFIRMED` for the parent GEMV divergent barrier; `REFUTED` for
the same defect in the post-change q4_K/q5_K/q6_K GEMV kernels
(`gemv_moe_q4_k_f32_ns.cl:68-71,157`,
`gemv_moe_q5_k_f32_ns.cl:69-72,162`,
`gemv_moe_q6_k_f32_ns.cl:41-44,132`).

### GEMM: q4_K, q5_K, q6_K

Each GEMM has two unconditional `sub_group_barrier` calls per K iteration:

- q4_K: `gemm_moe_q4_k_f32_ns.cl:275,299`;
- q5_K: `gemm_moe_q5_k_f32_ns.cl:283,307`;
- q6_K: `gemm_moe_q6_k_f32_ns.cl:251,275`.

The K-loop bounds and `step` are work-group-uniform. `skip_g1/2/3` only gate
the dot operations after the first subgroup barrier; they do not gate a
barrier. Thus every subgroup reaches both barriers on every iteration,
including padded x-lanes.

The first full-work-group barrier is q4_K `:318`, q5_K `:326`, q6_K `:294`;
the second is q4_K `:358`, q5_K `:366`, q6_K `:334`. The only remaining
early return is the `block_id_n >= total_tiles[0]` guard at q4_K `:189-191`,
q5_K `:190-192`, and q6_K `:162-164`. It is safe under the actual launch:
`block_id_n=get_global_id(2)` is identical for all 64 work-items because
local z is one. An entire z work-group either returns or continues. There
is no row-dependent return after the K-loop anymore.

The post-change row predicates are evaluated at q4_K `:231-234`, q5_K
`:235-238`, and q6_K `:207-210`. They do not surround either full barrier.
For the requested cases, the last partial row tile has valid and invalid
lanes but all lanes still execute both full barriers. For `ne01=1`, every
row tile has one valid lane and 63 padded lanes, with the same result.

The parent had a second, worse defect: its invalid GEMM lanes performed
row-indexed loads and then returned before the first full barrier (q4_K
parent `:304-306`, q5_K parent `:312-314`, q6_K parent `:280-282`). That
historical path is confirmed broken; the post-change path has no such
divergence.

VERDICT: `CONFIRMED` for the parent GEMM row-return/barrier defect;
`REFUTED` for a divergent barrier in the post-change source. The
`block_id_n` return is work-group-uniform under the host geometry
(`gemm_moe_q4_k_f32_ns.cl:185-191`,
`gemm_moe_q5_k_f32_ns.cl:186-192`,
`gemm_moe_q6_k_f32_ns.cl:159-164`).

### Barrier ledger

This is the complete barrier inventory, including the parent commit:

| kernel | parent barriers | parent result on a partial row tile | post-change barriers |
|---|---|---|---|
| q4_K GEMV | `:156` | invalid lanes return at parent `:68-70` before it | `:157`, all lanes reach |
| q5_K GEMV | `:161` | invalid lanes return at parent `:69-71` before it | `:162`, all lanes reach |
| q6_K GEMV | `:131` | invalid lanes return at parent `:41-43` before it | `:132`, all lanes reach |
| q4_K GEMM | subgroups `:272,296`; full WG `:319,357` | all lanes reach subgroup barriers, then invalid rows return at `:304-306` before either full barrier | subgroup `:275,299`; full WG `:318,358` |
| q5_K GEMM | subgroups `:280,304`; full WG `:327,365` | all lanes reach subgroup barriers, then invalid rows return at `:312-314` before either full barrier | subgroup `:283,307`; full WG `:326,366` |
| q6_K GEMM | subgroups `:248,272`; full WG `:295,333` | all lanes reach subgroup barriers, then invalid rows return at `:280-282` before either full barrier | subgroup `:251,275`; full WG `:294,334` |

For `ne01 % 64 == 0`, every row predicate is true in both generations and
the parent row returns are inactive. For `ne01 % 32 == 0 && ne01 % 64 != 0`,
including `ne01=32`, `96`, and every positive `ne01<64`, exactly the padded
x-lanes take the parent return. For `ne01=1`, that is 63 lanes per tile.
This is why the parent GEMV/full-GEMM barriers are confirmed divergent while
the post-change barrier ledger is uniform.

## 2. Clamp arithmetic

The post-change clamp is:

```
valid    = row_idx < ne01
row_load = valid ? row_idx : ne01 - 1
row_offset = row_load - row
```

For GEMV the equivalent is `i01_load = valid ? i01 : ne01 - 1`. For any
positive `ne01`, the host's tile start is
`row=floor((ne01-1)/64)*64`, so `row <= ne01-1 <= row+63`. Consequently,
the invalid-lane replacement is always the last real row in the current
tensor, and `row_offset` is in `[0,63]`; it cannot underflow or wrap.

### Boundary table

| `ne01` | GEMV x launch | GEMM row tiles | valid x-lanes in last tile | invalid-lane load / offset |
|---:|---:|---:|---|---|
| 1 | 64 | 1 | `{0}` | row 0 / offset 0 |
| 32 | 64 | 1 | `{0..31}` | row 31 / offset 31 |
| 64 | 64 | 1 | `{0..63}` | none |
| 96 | 128 | 2 | tile 0 `{0..63}`; tile 1 `{0..31}` | row 95 / offset 31 in tile 1 |
| 128 | 128 | 2 | all lanes valid | none |

At `ne01=96`, GEMV lanes 96..127 load row 95 and store nowhere. GEMM's
second tile has `row=64`; lanes 32..63 have `row_load=95` and
`row_offset=31`. Valid lanes 0..31 have `row_load=64..95` and
`row_offset=0..31`. This is the exact last full/partial-tile boundary, not
just an arbitrary in-bounds pointer.

The six kernels use the clamp consistently:

- GEMV q4_K: d/dm, scales, and q words use `i01_load`
  (`gemv_moe_q4_k_f32_ns.cl:93-111`); q5_K does the same for d/dm, qh,
  scales, and q (`gemv_moe_q5_k_f32_ns.cl:94-110`); q6_K does so for d,
  scales, ql, and qh (`gemv_moe_q6_k_f32_ns.cl:67-83`).
- GEMM q4_K uses `row_load` for row-major d/scales and `row_offset` for
  both transposed q-image planes (`gemm_moe_q4_k_f32_ns.cl:243-262,288-289`).
  q5_K does the corresponding d/scales/qh/q-image accesses at
  `:247-270,296-297`; q6_K at `:219-238,264-265`.
- The transposed image addresses are valid logical rows, not merely valid
  byte addresses. The q4/q5/q6 converters build their q planes with the
  row as the final/strided `ne01` coordinate (`cvt.cl:q4_K 1154-1161`,
  `q5_K 1701-1708`, `q6_K 1832-1840,1857-1860`). Replacing the row-local
  offset with the last row of the same plane preserves the quant block,
  expert plane, and sub-block stride.

No last-tile off-by-one appears: at `ne01=64`, every predicate is true and
the clamp is a no-op; at `ne01=96`, the replacement is exactly row 95; at
`ne01=1`, it is row 0.

VERDICT: `REFUTED` for an invalid-row or wrapped-index defect in the
post-change positive-row paths. The parent GEMM loads were genuinely
unclamped before its row return, so the historical OOB/wrong-row risk is
`CONFIRMED` in the parent (`gemm_moe_q4_k_f32_ns.cl` parent `:242-262,304-306`,
with analogous q5/q6 ranges).

## 3. Predicated stores and local memory

### GEMV

The only GEMV output store is in `sgid == 0` and is nested under `valid`:
q4_K `gemv_moe_q4_k_f32_ns.cl:163-168`, q5_K `:168-173`, q6_K `:138-143`.
Therefore invalid x-lanes execute no output store. At `ne01=64`, all 64
lanes are valid, so no real row is accidentally suppressed.

The accumulator starts at zero (`q4_K:85`, q5_K:86, q6_K:55). Padded lanes
still compute a deterministic sum from the last valid row. Lanes in sgids
1..3 write that sum to their own `reduceLM` slots before the barrier
(`q4_K:153-160`, with corresponding q5/q6 reductions). sgid 0 reads only
slots written by sgids 1..3; no invalid lane is responsible for an
uninitialized slot, and no local-memory reduction reads an invalid lane's
unwritten slot.

### GEMM

`reg_c` is initialized to zero for every lane (`q4_K:213`, q5_K:217,
q6_K:189`). Padded lanes still participate in `shared_b` writes and both
subgroup barriers, so the shared activation tile is complete; there is no
row-wise local reduction that consumes an invalid lane's accumulator.

All 32 `out_idx` entries are initialized by local x-lanes 0..31 before the
first full barrier (q4_K `:310-318`, q5_K `:318-326`, q6_K `:286-294`). The
row-valid predicate is applied only to the scatter stores after that
barrier: q4_K `:321-361`, q5_K `:329-368`, q6_K `:297-336`. Thus padded
lanes write no destination pixel, while valid rows write all required
indices 1..31 before the second barrier and index 0 after it. The barrier
itself is outside the predicate.

The store address is `m_offset = row + get_local_id(0)` and, under the
host's one-64-wide x-work-group, this is the same row tested by `valid`.
There is no mismatch where a valid row could be suppressed or an invalid
row could pass the predicate.

VERDICT: `REFUTED` for lost valid stores, invalid-row stores, or garbage
local-memory reduction input in the post-change kernels.

## 4. `%64` bit-identity review

For every `%64 == 0` shape, the host makes each x tile exactly full. In GEMV,
`i01 < ne01` is true for every lane, so `i01_load == i01` and the nested
store predicate is true for every sgid-0 output lane. In GEMM, every row tile
is full, so `row_load == row_idx` and
`row_offset == row_idx-row == get_global_id(0)`. The d/dm, scale, ql/qh, and
q-image addresses therefore reduce to the pre-change addresses. `m_offset`
also names a valid row for every x lane.

Kernel-by-kernel:

- q4_K GEMV: clamp/store additions at `gemv_moe_q4_k_f32_ns.cl:68-71,165-167`
  are no-ops/predicate-true on `%64` shapes.
- q5_K GEMV: `gemv_moe_q5_k_f32_ns.cl:69-72,170-172` are the same.
- q6_K GEMV: `gemv_moe_q6_k_f32_ns.cl:41-44,140-142` are the same.
- q4_K GEMM: `gemm_moe_q4_k_f32_ns.cl:231-234,323-361` preserves all
  addresses and stores.
- q5_K GEMM: `gemm_moe_q5_k_f32_ns.cl:235-238,331-368` preserves all
  addresses and stores.
- q6_K GEMM: `gemm_moe_q6_k_f32_ns.cl:207-210,299-336` preserves all
  addresses and stores.

That is source-level arithmetic identity, not a guarantee of identical
Adreno instructions. The patch moves row validity/clamp computation ahead of
the K-loop, introduces a runtime `bool`/ternary, replaces some direct row
expressions with `row_load`/`row_offset`, and adds runtime store predicates.
The compiler is not given `ne01 % 64 == 0` as a specialization constant.
Given the E031/trans4 history, the device compiler could preserve the extra
predication or re-vectorize/reorder around it, changing instruction-level
behavior or numerical bit identity even though every predicate is true at
runtime.

VERDICT: `REFUTED` for a source-level `%64` address/store mismatch;
`PLAUSIBLE` for an E031 code-generation/bit-identity regression. This is a
device-session check, not something PC-side source inspection can discharge.

## 5. K2/trans4 medicine and argument preservation

The commit diff is exactly seven files: the six q4_K/q5_K/q6_K kernels and
`tests/test-backend-ops.cpp`. `git diff --check` is clean. There is no diff
in `ggml-opencl.cpp`, no q2_K/q3_K file is touched, and no `cvt.cl`/trans4
file is touched.

The q4_K/q5_K kernel signatures still carry `mask_d6`, `mask_d4`, and
`mask_hi2` as kernel arguments. The calls to `get_scale_min_k4` still pass
those arguments (`gemv_moe_q4_k_f32_ns.cl:99`, q5_K `:102`, GEMM q4_K
`:250`, q5_K `:252`). No new literal mask, mask-then-shift sequence, private
register alias, or pointer reinterpretation was introduced. The host's q4/q5
`clSetKernelArg` mask sites are unchanged (`ggml-opencl.cpp:23078-23085`,
`:23196-23202`, `:23395-23402`). q6_K correctly has no mask plumbing.

The pre-existing q4/q5 trans4 conversion aliasing/packing code is outside
this diff and remains untouched. The new index dataflow is scalar `uint`.

VERDICT: `REFUTED` for K2 mask-argument regression, trans4-medicine
regression, host argument-list drift, or accidental q2/q3 modification.

## 6. Test discriminators

The new registrations are exactly the intended matrix (`tests/test-backend-ops.cpp:8899-8910`):

- q4_K/q5_K/q6_K, `type_b=F32`;
- `n_mats=4`, `n_used=2`, `b=false`;
- `m=96`, `k=256`;
- one case with `n=1` and one with `n=4` for each type.

The test graph constructs `as` as `[k,m,n_mats]` and `b` as
`[k,n_used,n]` (`tests/test-backend-ops.cpp:4301-4319`). Thus `n=1` gives
`src1->ne[2]==1` and takes the host GEMV branch; `n=4` gives
`src1->ne[2]==4` and takes GEMM. `m=96` satisfies the unchanged Adreno
`%32` gate but not `%64`, and `k=256` is a complete K-quant block. The
registrations mirror commit `2217d61a0`'s q2/q3 discriminators, including
the same `n_mats/n_used` structure.

These cases would have failed the parent kernels in principle, not merely
exercise a cosmetic branch. GEMV launches two x work-groups; in the second,
lanes 32..63 returned before the reduction barrier while lanes 0..31 waited.
GEMM launches two row tiles; in the second tile lanes 32..63 returned after
the K-loop and before the full `out_idx` barrier, after already using
unclamped row addresses. The q4/q5/q6 n=1 and n=4 cases therefore cover both
historical failure modes.

VERDICT: `REFUTED` for inadequate type/op/shape coverage in the new source
tests. The tests are real `GGML_OP_MUL_MAT_ID` discriminators and would have
exposed the pre-fix defect if the built-in source kernels were selected.

## 7. supports_op and dispatch caveats

`supports_op` still lists Q4_K, Q5_K, and Q6_K in the Adreno-only
`MUL_MAT_ID` set and still delegates to the `%32`/`ne[3]==1` gate
(`ggml-opencl.cpp:7685-7710`). It neither narrowed the admission to `%64`
nor widened it to an unrelated shape. This is the intended contract: the
commit makes the already-admitted `%32`/non-`%64` shapes safe.

There is one conditional path the source diff does not fix. If the optional
Adreno binary-kernel facility is enabled and supplies
`gemm_moe_q4_k_f32_ns_ila`, host dispatch selects
`kernel_gemm_moe_q4_k_f32_ns_bin` instead of the patched built-in q4 GEMM
source (`ggml-opencl.cpp:23095-23099`). The host explicitly documents that
the ILA binary has the old 13-argument/literal-mask signature and remains
unfixed by this commit (`:23196-23206`). The binary is only loaded under
`GGML_OPENCL_USE_ADRENO_BIN_KERNELS` and a present runtime library
(`ggml-opencl.cpp:1548-1556,4347-4361,6106-6125`); the claimed source build
compiles that path out and falls back to the built-in kernel.

VERDICT: `REFUTED` for a supports_op regression in the target source;
`PLAUSIBLE` residual runtime/coverage defect if an optional q4 ILA binary is
enabled. The m=96 q4 GEMM test cannot prove the built-in fix in that
configuration because host dispatch bypasses it.

## 8. Zero-row precondition

The clamp uses `ne01 - 1u` in all six kernels. For `ne01==0`, that wraps to
`UINT_MAX`; the host's GEMV x size also evaluates to zero
(`ggml-opencl.cpp:23048`, q5_K `:23250`, q6_K `:23446`), so an attempted
launch is invalid before normal kernel execution. `supports_op` only checks
`ne01 % 32` and therefore does not itself reject zero (`:7205-7210`). GGML
does have an explicit empty-tensor concept (`ggml.c:1533-1540`), so whether
an empty MUL_MAT_ID can reach this dispatch is an integration precondition
worth testing. The q2/q3 reference clamp has the same positive-row
precondition.

VERDICT: `PLAUSIBLE` edge-case underflow if an empty `ne01==0` operation is
allowed to reach these kernels; not a defect in the requested positive-row
`ne01=1/32/64/96` paths, and not shown to be reachable through the normal
empty-tensor scheduling path in this PC-only audit.

## Final disposition

No confirmed defect remains in the post-change built-in q4_K/q5_K/q6_K
source for positive, `%32`-admitted shapes under the actual host geometry.
The pre-change fifth defect is real and the new tests target it. Device work
is still required for E031 code generation, instruction-level `%64` identity,
and any enabled q4 ILA binary path.

BANK (safe pending device verification)
