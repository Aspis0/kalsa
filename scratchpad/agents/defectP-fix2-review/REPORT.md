# Hostile review: f63746555

Target: `BigMoeOnEdge/third_party/llama.cpp`, branch `kalsa/kernel-s3-repack`.

Scope reviewed: commit `f63746555` (`ggml/src/ggml-opencl/kernels/cvt.cl`, +123/-77), plus the known restore fix `eaec5d884`, the supplied probe report, the kernel block definitions, and the read-only host launch/allocation sites.

## Executive verdict

The rewrite is contract-equivalent and type-safe on a conforming OpenCL compiler. It removes the narrow arithmetic and narrow output stores implicated by the Adreno 740 corruption. The remaining failure mode is the compiler itself: the source still performs repeated `uchar` global member loads followed by `(uint)` casts, so a broken backend could still combine/re-vectorize the loads incorrectly.

**Static review: GO. Production/device release: NO-GO until the new binary is run through raw SoA readback on Adreno 740 in both compiler arms.** This is a materially stronger candidate than attempt 1, but attempt 1 had zero device effect, so source-level plausibility is not device proof.

## Verdict matrix

| Attack | Verdict | Result |
|---|---|---|
| 1. Contract equivalence | **CONFIRMED** | New uint indexing and byte contents match the old producer for all five kernels; restores invert that layout. |
| 2. Source signedness/masking | **CONFIRMED** | All five `qs` members are unsigned; every helper result is bounded to one byte before word assembly. |
| 3. Adversarial compiler model | **PLAUSIBLE** | Narrow source loads remain the highest-risk construct; the old smear is no longer expressible in the intended uint dataflow, but a non-conforming compiler can still break a cast/load transformation. |
| 4. uint `bitselect` arm | **CONFIRMED** | Scalar uint `bitselect(a,b,0xF0u)` is bitwise select and equals the plain OR arm for the helper operands. |
| 5. Scope | **CONFIRMED** | Only the two helpers and five requested trans4 convert qs paths changed. qh/e copies and all restores/other kernels/host code are untouched. |

## 1. Contract equivalence

The old producer used a byte pointer at:

```text
base = i02*ne00_blk*ne01*4 + i00*ne01*4 + i01
q    = (uchar *)dst + base*4
byte stride = ne01*4
```

The new producer uses:

```text
dst_idx = i02*ne00_blk*ne01*4 + i00*ne01*4 + i01
uint stride = ne01
```

Since `dst_*` is now a `global uint *`, `dst_idx + w*stride` is exactly the old byte address `q + w*(ne01*4)` divided by four. The `(2+w)` high-word address is likewise exact. The four inner iterations use `i = 4*w+j`, so the output is:

```text
word w       bytes for i = 4*w + 0..3
word 2 + w   bytes for i = 4*w + 0..3, representing original byte i+8
```

The new `<< (j*8)` assembly therefore recreates the old four byte stores in little-endian order. The two helper formulas are the same old formulas, with the intermediate type widened.

Per-kernel check:

| Kernel | qs source member | q destination | new word mapping | restore inverse |
|---|---|---|---|---|
| `q4_0` | `b->qs`, `uint8_t` aliasing `uchar` | `dst_q` | `dst_q[dst_idx + w*ne01]`, `dst_q[dst_idx + (2+w)*ne01]` | `src_q_offset`, then q0/q1 low and q2/q3 high, byte `8*(i&3)` |
| `q4_1` | `b->qs`, `uchar` | `dst_q` | identical mapping | identical inverse; d/m use the matching row/block offset |
| `q5_0` | `b->qs`, `uchar` | `dst_qs` | identical mapping | identical inverse; qh is separately copied |
| `q5_1` | `b->qs`, `uchar` | `dst_qs` | identical mapping | identical inverse; qh is separately copied; d/m use the matching row/block offset |
| `mxfp4` | `b->qs`, `uchar` | `dst_q` | identical mapping | identical inverse; e is separately copied |

The fixed restores at `cvt.cl:415-433`, `616-632`, `837-853`, `1074-1090`, and `1671-1687` use the same `src_q_offset` expression:

```text
base = i02*ne00_blk*ne01*4 + i00*ne01*4 + i01
q0 = src[base]
q1 = src[base + ne01]
q2 = src[base + 2*ne01]
q3 = src[base + 3*ne01]
```

For `i=0..3`, they extract byte `i` from q0/q2; for `i=4..7`, byte `i-4` from q1/q3. They rebuild `qs[2*i]` from low/low nibbles and `qs[2*i+1]` from high/high nibbles. That is the exact inverse of the new producer’s `w=0/1`, `j=0..3` mapping.

The host q4_0 reference independently uses `src + sblk*18 + 2` and writes reference words at the same `base + w*ne01` locations, which corroborates the producer contract and catches the known high-word failure mode.

### Documentation defect found

The q4_0 comment at `cvt.cl:365` says `qs` is at offset 4. The actual kernel/host layout is offset **2**: `half d` is two bytes, and the host readback reference uses `+2` (`ggml-opencl.cpp:8514`). q4_1/q5_0/q5_1/mxfp4 are offset 4/6/8/1 respectively. This is a stale comment, not an addressing bug here, because the kernel uses `b->qs` rather than a hard-coded byte offset. It should still be corrected; hostile review should not leave an ABI fact false in the contract comments.

## 2. Signedness at the source

All five source definitions used by these kernels are unsigned:

- `q4_0`: `uint8_t qs[...]`, and this file defines `uint8_t` as `uchar` at `cvt.cl:36-41`.
- `q4_1`: `uchar qs[...]`.
- `q5_0`: `uchar qh[...]` and `uchar qs[...]`.
- `q5_1`: `uchar qh[...]` and `uchar qs[...]`.
- `mxfp4`: `uchar e` and `uchar qs[...]`.

The host `ggml-common.h` definitions also use `uint8_t` for the corresponding byte arrays. The signed `char qs` definition elsewhere in this file is q8_0, outside this change.

Each load is widened immediately:

```c
uint ux0 = (uint) b->qs[...];
uint ux1 = (uint) b->qs[...];
```

Thus a conforming compiler zero-extends. Even under the hypothetical signed-source concern, the helper terms are fully bounded:

- low helper: `(ux0 & 0x0Fu)` is 0..0x0f; `((ux1 & 0x0Fu) << 4)` is 0..0xf0;
- high helper: `((ux0 >> 4) & 0x0Fu)` is 0..0x0f; `(ux1 & 0xF0u)` is 0..0xf0.

No unmasked term can inject bits above bit 7. The final shifts are uint shifts of a one-byte value by 0, 8, 16, or 24, and the four byte fields do not overlap. There is no route for sign-filled high bits to reach the stored word through these helpers.

## 3. Adversarial compiler model

The rewrite removes the exact vulnerable shape from the arithmetic/output path:

- no `uchar`/`ushort` private pack result;
- no narrow right shift (`ux0 >> 4` is uint and therefore logical);
- no narrow mask/OR result later widened;
- no byte-lane output stores;
- one uint expression and one uint store per output word.

Therefore a conforming compiler cannot produce the observed `got=(want&0x0F)|0xF0` from the stated source semantics. A legal vectorizer may combine the four source loads, but it must preserve unsigned widening and uint logical shifts.

The remaining risk is **plausible**, not confirmed: `b->qs[...]` is still a global `uchar` load inside a fixed four-iteration loop, immediately cast to uint. The Adreno compiler could still form a byte/short load group and mishandle the zero-extension or feed a signed lane into an internal shift. That would be another compiler bug, not a valid optimization. The highest-risk constructs are the repeated member-load/cast pair at `cvt.cl:383-384` (and equivalents at 582-583, 796-797, 1031-1032, 1639-1640), followed by inlining of the helpers.

If the new device probe remains dirty, escalate structurally in this order:

1. hand-unroll the four `j` iterations and use separate `volatile global uchar` source reads, preserving the required misaligned AoS offsets;
2. if needed, read aligned uint chunks from the source with explicit unaligned byte extraction, handling q4_0 `+2`, q4_1 `+4`, q5_0 `+6`, q5_1 `+8`, and mxfp4 `+1` without out-of-bounds reads;
3. only then consider changing storage/layout around the producer.

Do not replace the source reads with naïve `uint *` loads: q5_0 and mxfp4 are deliberately misaligned, and the source block is an AoS byte layout.

## 4. Bitselect arm

OpenCL `bitselect(a,b,c)` on scalar `uint` selects each bit from `b` where `c` is 1 and from `a` where `c` is 0:

```text
bitselect(a,b,c) = (a & ~c) | (b & c)
```

With `c=0xF0u`, the low helper selects the low nibble from `ux0` and the high nibble from `(ux1 & 0x0F) << 4`. The high helper selects the low nibble from `(ux0 >> 4) & 0x0F` and the high nibble from `ux1 & 0xF0`. Both operands are already zero outside their intended nibble, so the result is byte-identical to the plain OR arm for every input.

I exhaustively checked all 65,536 `x0/x1` byte pairs: old formulas vs new plain uint formulas had zero mismatches, and the uint bitselect mask formula vs the OR formula had zero mismatches. The environment selector plumbing is unchanged.

## 5. Scope and untouched paths

`git diff` contains one file and 123/77 changes. The hunks are limited to:

- `trans4_pack_lo_u32` and `trans4_pack_hi_u32`;
- `kernel_convert_block_q4_0_trans4_ns`;
- `kernel_convert_block_q4_1_trans4_ns`;
- `kernel_convert_block_q5_0_trans4_ns`;
- `kernel_convert_block_q5_1_trans4_ns`;
- `kernel_convert_block_mxfp4_trans4_ns`.

The q5 qh copies remain four plain byte assignments (`cvt.cl:781-787` and `1016-1022`), with no shifts. The mxfp4 exponent remains the plain byte assignment at `cvt.cl:1608-1609`. No restore, K-quant, dense, noshuffle, or host source was changed by this commit. `git diff --check` is clean.

One top comment at `cvt.cl:43-46` still says both arms retain “byte-wise ... global stores,” which is now false because the qs stores are uint stores. This is documentation-only but should be fixed alongside the q4_0 offset comment.

## Required device gate

Run the rebuilt commit, independently in bytewise and `GGML_OPENCL_CVT_BITSELECT` modes, with the existing raw SoA dump. Acceptance must include:

- raw low-word mismatches = 0;
- raw high-word mismatches = 0, including `pair8040` (even partner `0x80`, odd partner `0x40`);
- round-trip mismatches = 0 for all five types;
- q5 qh and mxfp4 e byte copies unchanged;
- no regression in the consumer/e2e check.

Until that gate passes, the correct device verdict is **NO-GO**, despite the static contract verdict being **GO**.
