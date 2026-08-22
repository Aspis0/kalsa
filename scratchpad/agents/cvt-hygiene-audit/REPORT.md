# Hostile audit: K trans4 nibble-extraction hygiene port

Status: audit in progress. Engine source is read-only; this report is the
only artifact being written.

Target: commits `1882bf8cd` (comment fixes) and `99ed2cb92` (six q4_K/q5_K/q6_K
trans4 consumer rewrites), branch `kalsa/kernel-s3-repack`, head
`99ed2cb92`. Old reference: `7686ca6fc:ggml/src/ggml-opencl/kernels/cvt.cl`.

Constraint: the old code is device-proven. Any semantic delta in this hygiene
port is a defect, even if it looks numerically harmless.

Per-consumer verdicts and perimeter findings will be appended below.

## Checkpoint 1 — scope and mask contract

The two commits are confined to `ggml/src/ggml-opencl/kernels/cvt.cl`.
`1882bf8cd` is the two comment-line fix (`2 insertions, 2 deletions`), and
`99ed2cb92` is the six-consumer rewrite (`44 insertions, 32 deletions`, the
reported 76-line body delta).  `git diff --check` is clean.  No changed line
contains a kernel declaration, so the six argument lists are unchanged.  The
tracked tree has one `cvt.cl`; `cvt.cl.h` is a generated embedding included by
`ggml-opencl.cpp`, not a second tracked source copy.

All six in-tree trans4 K call sites pass the paired values
`mask_0F = 0x0F` and `mask_F0 = 0xF0`: q4-K convert at
`ggml-opencl.cpp:9928-9938`, q5-K convert at `:10085-10096`, q6-K convert at
`:10230-10245`, and the corresponding restores at `:11277-11300`,
`:11387-11410`, and `:11507-11521`.  The rewrite therefore has a valid
engine-level mask invariant, but the OpenCL kernel arguments themselves are
legal arbitrary `uchar` values.  That distinction matters below.

## Checkpoint 2 — nibble algebra

For every source byte `x` (all loads are `uchar`, hence 0..255 after the
explicit cast), and for the actual mask pair `M0=0x0F`, `MF=0xF0`, the changed
identities are exact:

```text
(x & M0) << 4       == (x << 4) & MF
(x & MF) >> 4       == (x >> 4) & M0
```

The first identity is safe despite the new high-nibble contamination before
the mask: `x << 4` is a `uint` shift, has maximum 0xFFF, and `& 0xF0` removes
bits 8..11.  The second identity simply discards the low four bits before or
after the right shift.  Every surviving term is at most 0xFF; moving the
single `convert_uchar` outward across the OR cannot change the result.  The
old `uchar` expressions also have nonnegative operands, so no signed right
shift or sign-extension counterexample exists for the actual byte inputs.

The exhaustive byte check over all 65,536 `(x0,x1)` pairs found no mismatch for
the fixed pair.  The q6-K four-byte layout is the same proof applied separately
to `(x0,x1)` and `(x2,x3)`; its source and destination indices are unchanged.
The q6 `qh` two-bit-plane code (the part carrying the upper q6 bits) is not in
the port hunk at `cvt.cl:1857-1863` and `:1943-1947`, so this commit introduces
no qh/6-bit recombination shift change.

### Finding F1 — the claimed full kernel-domain equivalence is false

Verdict: **CONFIRMED** (domain defect; engine-fixed-mask execution is
equivalent).

The new low-nibble expression uses `mF0` after the shift, while the old one
uses `mask_0F` before the shift (`cvt.cl:1151`, `:1224`, `:1702`, `:1791`,
`:1835-1836`, and `:1926-1929`; the old blob expressions are at
`7686ca6fc:cvt.cl:1146-1150`, `:1218-1221`, `:1693-1697`, `:1781-1784`,
`:1821-1828`, and `:1910-1917`).  Those are equivalent only when
`mask_F0 == ((mask_0F << 4) & 0xFF)`; the high-nibble identity likewise needs
`mask_0F == (mask_F0 >> 4)`.

Counterexample valid at the kernel ABI: `mask_0F=0x00`, `mask_F0=0x10`,
`x0=0x00`, `x1=0x01`.  Old low output is
`(0 & 0) | ((1 & 0) << 4) = 0x00`; new low output is
`(0 & 0) | ((1 << 4) & 0x10) = 0x10`.  The same counterexample applies to
each convert and restore pair (replace `x0,x1` by the corresponding `lo,hi`
or q6 pair).  The host never supplies this pair, so this is not a reachable
engine regression under the verified call-site contract; it does invalidate
an unqualified “full input domain” equivalence claim.

## Checkpoint 3 — Adreno medicine

### Finding F2 — none of the six consumers is scalar-uint end-to-end

Verdict: **CONFIRMED** (medicine nonconformance; the aliasing is pre-existing,
but the port still claims the canonical pattern while retaining it).

Every ported consumer still packs through a private byte alias:

| consumer | surviving private-register alias |
|---|---|
| q4-K convert / restore | `uchar * qv_bytes = (uchar *)qv` at `cvt.cl:1145` / `:1219` |
| q5-K convert / restore | `uchar * qv_bytes = (uchar *)qv` at `cvt.cl:1696` / `:1786` |
| q6-K convert / restore | `uchar * qlv_bytes = (uchar *)qlv` at `cvt.cl:1828` / `:1919` |

The new `uint x0/x1/...` temporaries only surround the nibble expression; the
result is immediately converted back to `uchar` and written through that
private alias.  That is not the canonical q3/q5_1 pattern (`cvt.cl:1388-1426`
and `:1045-1058`), which assembles scalar `uint` words and writes the global
`uint` destinations without a private byte view.  q5-K also retains uchar
qh temporaries at `cvt.cl:1683-1692` and `:1756-1767`; q6-K retains uchar qh
lanes at `:1857-1863` and `:1943-1947`.  Those qh lines are unchanged and do
not create a new nibble result, but they make the blanket “no uchar lanes in
the consumer dataflow” claim untrue.  The six new hunks are therefore a
third, mixed style, not an end-to-end scalar-uint/no-alias port.

## Checkpoint 4 — comments and duplicate copies

### Finding F3 — the two comment fixes are accurate

Verdict: **REFUTED** as a comment defect.

The q4_0 comment now says `qs` is at offset 2 (`cvt.cl:386-387`).  The OpenCL
struct has a two-byte `half d` followed by `uchar qs` (`cvt.cl:89-93`), and
the host-side `block_q4_0` has a size assertion for exactly that layout at
`ggml-common.h:195-199`.  The old offset-4 wording was the lie; the new
wording is correct.

The top trans4 comment now says both selector arms have byte-granularity source
reads and scalar-uint global stores (`cvt.cl:43-59`).  The two arms are the
`uint` `bitselect` and plain-OR implementations of
`trans4_pack_{lo,hi}_u32`; their callers widen byte fields and store complete
`uint` words (`cvt.cl:400-410`).  No comment added by either commit claims the
six K consumers have lost their private aliases, so there is no new factual
lie in these two edits.

### Finding F4 — stale generated copies exist outside the target Git tree

Verdict: **PLAUSIBLE** (build/deployment hazard, not a changed source file).

The target Git tree contains only the source `cvt.cl`; the six kernel names
occur in that source and in their host declarations/launches, not in another
tracked kernel copy.  CMake explicitly generates `autogenerated/cvt.cl.h` from
the source (`ggml/src/ggml-opencl/CMakeLists.txt:39-50`), and embedded builds
include that header at `ggml-opencl.cpp:1697-1703`.  The workspace nevertheless
contains several ignored generated headers.  The `s3oracle` header contains
the new `m0F/mF0` code, while `s3base`, `s3fix`, `s3judge`, `s3printf`,
`smoke`, `k2`, and `k4split` headers still contain the old `uchar`/mask-first
six-consumer text.  There is also a separate dirty detached
`llama.cpp-judge-swap` checkout with the old bodies.  None is part of
`kalsa/kernel-s3-repack`, so this does not violate the two-commit source
perimeter; using one of those build trees without regeneration would silently
test the pre-port kernels.

The other old mask-first q4_K/q5_K copies in the target `cvt.cl` are distinct
non-trans4/noshuffle kernels (for example `cvt.cl:2453-2454` and
`:2588-2589`), not duplicate definitions of the six edited kernels.  No
inconsistent duplicate of `trans4_pack_lo_u32` or `trans4_pack_hi_u32` was
found; those helpers have one definition at `cvt.cl:60-76`.

## Checkpoint 5 — six-consumer verdict table

The table uses the user-requested *full kernel input domain*, which includes
the legal `uchar` mask arguments.  The engine-contract result is shown
separately so the fixed-mask algebra is not confused with the stronger claim.

| consumer | changed nibble sites | full-domain verdict | engine-fixed-mask result | medicine result |
|---|---:|---|---|---|
| q4_K convert | `cvt.cl:1148-1152` | **NOT EQUIVALENT** — F1 counterexample | EQUIVALENT | **FAIL** — `qv_bytes` alias at `:1145` |
| q4_K restore | `cvt.cl:1222-1225` | **NOT EQUIVALENT** — F1 counterexample | EQUIVALENT | **FAIL** — `qv_bytes` alias at `:1219` |
| q5_K convert | `cvt.cl:1699-1703` | **NOT EQUIVALENT** — F1 counterexample | EQUIVALENT | **FAIL** — `qv_bytes` alias at `:1696`; uchar qh path remains |
| q5_K restore | `cvt.cl:1789-1792` | **NOT EQUIVALENT** — F1 counterexample | EQUIVALENT | **FAIL** — `qv_bytes` alias at `:1786`; uchar qh path remains |
| q6_K convert | `cvt.cl:1831-1838` | **NOT EQUIVALENT** — F1 counterexample | EQUIVALENT | **FAIL** — `qlv_bytes` alias at `:1828`; uchar qh path remains |
| q6_K restore | `cvt.cl:1922-1929` | **NOT EQUIVALENT** — F1 counterexample | EQUIVALENT | **FAIL** — `qlv_bytes` alias at `:1919`; uchar qh path remains |

There is no byte-address counterexample: in all six rows the old and new
loads read the same q/qs/ql offsets, and all stores write the same destinations
with the same loop bounds.  The q6 ql mapping is specifically
`(0,1)->j`, `(2,3)->j+16`, then the high-nibble planes at `j+32` and `j+48`
(`cvt.cl:1831-1838`), reversed by exactly the four corresponding stores at
`:1922-1929`.  The failure is the unqualified mask-domain claim and the
explicit medicine requirement, not a hidden q6 shift or address change.

## Required disposition

To make this eligible for a hygiene-only landing, either enforce/document the
paired-mask invariant at the kernel boundary (or derive the shifted mask from
`mask_0F` rather than accepting an independent `mask_F0`), and rewrite the six
pack/unpack paths as direct scalar-uint word assembly with no private byte
alias.  Regenerate every embedded header used for device testing.  Until then,
the device-proven old code must not be replaced by a port whose strongest
equivalence and medicine claims are false.

BLOCK
