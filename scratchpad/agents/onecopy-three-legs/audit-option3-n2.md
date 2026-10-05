# Hostile audit — option 3 (Amendment H), `git diff ee3dfde49..2459a9d1d`

Repo `~/Projects/kalsallama-gov-q6raw`, branch `feat/governor-onecopy-q6raw`, HEAD = `2459a9d1d` (worktree clean
except an untracked `CMakeUserPresets.json`). 3 commits: `80177af6a` (converter + packer move + test),
`15c74f40b` (DSP jobs), `2459a9d1d` (host gate).

Spec: `~/Projects/kalsa-moe-experiments/scratchpad/agents/onecopy-three-legs/FABLE-DESIGN.md:644-711`
("Amendment H", plus the H4 orchestrator correction at `:703`).

Method: read-only (`git`, `grep`, `sed`, `nl`, `nm`, `cat compile_commands.json`). No builds, no test runs.
I did disassemble-adjacent evidence out of the **already-built** skel
`build-q6/ggml/src/ggml-hexagon/libggml-htp-v73.so` (dated Oct 5 10:02, i.e. built at `15c74f40b`) — `nm -S`
only, no code execution. That is the only build artifact I touched.

---

## 0. One-line verdict

**NOT PROVEN and NOT SHIP-READY as an ABBA arm.** The converter is correct and the two-copy claim holds, but
the feature rests on one unvalidated hardware invariant (a 1680-byte DMA row stride, the first non-128-aligned
2-D descriptor the skel has ever issued), on an unmeasured conversion cost whose arithmetic contradicts the
spec's own 0.9-0.95 target unless the compiler vectorised the inner loop, and on zero host-test coverage of the
new host gate.

---

## 1. Findings, ranked

| # | Sev | Verdict | Finding |
|---|-----|---------|---------|
| F1 | **P1** | CONFIRMED (gap, not a false claim) | First-ever non-128-aligned 2-D DMA row stride; nothing asserts, documents or tests it; the only evidence is a probe the commit says it has not run |
| F2 | **P1** | PLAUSIBLE | Scalar Q6_K conversion cost: the arithmetic only reaches the spec's 0.9-0.95 target if the inner loop is vectorised; the skel builds at `-O2 -flto -Wall -Werror` and nobody looked at the codegen |
| F3 | **P2** | CONFIRMED | The new Q6_K branch fires at `opt_mm_select == 1` too, so every pre-existing "Q4_0 raw whole-model" arm silently changes meaning. Only *two-copy* is claimed byte-identical |
| F4 | **P2** | CONFIRMED | `tests/test-hexagon-q6_K-raw-tile.c` is not registered with CTest and nothing runs it; the repo has an explicit precedent for making exactly this kind of header testable |
| F5 | **P2** | CONFIRMED | The three new/changed host predicates (raw Q6_K gate, `has_raw_q6_K_mm`, the is_hmx raw refusal) have no host test at all. "6/6 tile32 tests passed" proves nothing about them |
| F6 | **P2** | CONFIRMED | `n_k % 8 == 0` is a documented precondition with no `assert` and no test case; the only enforcement lives ~1500 lines away in `op_matmul` |
| F7 | **P2** | CONFIRMED | Converter tile stride is a *different constant* from the job's stride; they coincide today by accident |
| F8 | **P2** | CONFIRMED | The DMA `row_size` and the converter's `n_sb` are two independent derivations of the same quantity; the host test cannot see either, and a padded `nb[1]` (the whole point of the 2-D descriptor) is untested |
| F9 | **P3** | CONFIRMED (dead code) | `repack_q6_K_tiled_slice` (host packer, `GGML_ASSERT` and all) is compiled into every DSP TU that pulls `q6_K-raw-tile.h`, then discarded (verified absent from the `.so`) |
| F10 | **P3** | CONFIRMED (perf) | Per-tile `memset(…, 896)` is a libcall, 256 K times per token, and fully redundant for full 32-row groups |
| F11 | **P3** | CONFIRMED (robustness) | "Compile-time at every instantiation" rests on `static inline` being inlined; a hint, not a guarantee, under `-O2 -flto -Werror` |
| F12 | **P3** | CONFIRMED | The `n_prefetch >= 2` assert is compiled out (`NDEBUG=1`); for RAW, `n_prefetch == 1` turns into a NULL deref rather than a no-op |
| F13 | **P3** | CONFIRMED (inherited) | `dma_queue_push`'s return value is discarded; a full ring silently drops a group |
| F14 | **P3** | CONFIRMED | `has_raw_q6_K_mm` is a *type* gate wearing an *identity* name: it admits any raw Q6_K MUL_MAT, not "the lm_head" |
| F15 | **P3** | PLAUSIBLE | Byte-identity now depends on host and DSP sharing one fp16 rounding implementation; nothing pins it and no test can see a divergence |
| F16 | **P3** | CONFIRMED | `TILE_SIZE 896` duplicated in the test instead of taken from `matmul-ops.h:39` |
| F17 | **P3** | CONFIRMED | `n_col_tiles` / `matrix_size` / `sb_per_row` are now derived twice (wrapper + slice) and can drift |

---

## 2. Angle 1 — converter vs. host packer (line by line)

### 2.1 The move is verbatim and behaviour-preserving — CONFIRMED

`git show ee3dfde49:…/ggml-hexagon.cpp` lines 1284-1358 vs the new
`htp/q6_K-tiled-pack.h:1-78` and the wrapper `ggml-hexagon.cpp:1284-1315`. I compared the loop bodies
expression by expression; they are character-identical, including the trailing comment on the memset:

```
old ggml-hexagon.cpp:1327  memset(matrix_dst, 0, matrix_size);  // padding rows and the OR-ed nibbles below need zeroed tiles
new q6_K-tiled-pack.h:47  memset(matrix_dst, 0, matrix_size);  // padding rows and the OR-ed nibbles below need zeroed tiles
old :1345-1352 == new :65-72  (q6_K_get_quant, g, pos, both planes, both scales, same fp16 expression)
old :1301-1299 comment      == new :12-13 comment (moved with the code)
```

The wrapper keeps the shape arithmetic:
```
ggml-hexagon.cpp:1299-1304
    const int n_col_tiles = ne1_padded / 32;
    const int n_k_tiles   = ne0_padded / 32;
    const size_t tile_size   = HTP_MM_WEIGHT_TILE_SIZE_Q6_K;
    const size_t matrix_size = (size_t) n_col_tiles * n_k_tiles * tile_size;
    const int64_t sb_per_row = ne0 / QK_K;
```
and the slice recomputes it (`q6_K-tiled-pack.h:41-45`). These agree **only because**
`GGML_ASSERT(ne0 % QK_K == 0)` (`ggml-hexagon.cpp:1297`, `q6_K-tiled-pack.h:39`) forces
`ne0_padded == ne0`. That is F17: harmless today, a silent divergence the day the assert is relaxed. No
unused-variable fallout (`n_col_tiles`/`n_k_tiles` still feed `matrix_size`). No leftover copy anywhere:
`grep -rn "q6_K_get_quant\|repack_q6_K_tiled"` returns only the header, the wrapper and the test.

### 2.2 Plane offsets, nibble/high-bit packing, scale index, fp16 rounding — CONFIRMED correct

Converter `htp/q6_K-raw-tile.h:29-31` and packer `htp/q6_K-tiled-pack.h:60-62` place the planes identically
(lo = tile, hi = tile+512, scales = tile+768), and I cross-checked that against the *consumer*, not only
against the packer:

```
hvx-mm-kernels-tiled.h:894   const HVX_Vector * restrict vptr = (const HVX_Vector *) (tile_ptr + kt * 896);
hvx-mm-kernels-tiled.h:473-474  vptr[g >> 1]  (bytes 0..511 = lo plane)   4 + (g >> 2)  (bytes 512..767 = hi plane)
hvx-mm-kernels-tiled.h:898   scale_q6_k_32x1(v_sums, vptr[6], v_act[8])   vptr[6] = bytes 768..895 = fp16 scales
hvx-mm-kernels-tiled.h:533   Q6_V_vror_VR(v_scale_w, 64) → lanes 32..63 = the second 32 scales
```

so `sc_pl[sub * 32 + row]` with `sub = lk/16` is the lane the kernel reads. `unpack_q6_k_group` shifts by
`(g&1)*4` on the lo plane and `(g&3)*2` on the hi plane, matching `q6_K-raw-tile.h:47-48`. `kt_local*2+sub`
(`q6_K-raw-tile.h:51`) is the GGUF sub-block index for the 16-element scale groups. All correct.

Note the kernel **hardcodes 896** as the tile stride, so the converter's stride must be exactly the job's
`aligned_tile_size`. It is today (896 = 7·128, and `hex_align_up(896,128) = 896`), but see F7.

### 2.3 fp16 rounding is shared, not accidentally equal — CONFIRMED today, F15 latent

Both sides call the same macros from the same header:
```
q6_K-raw-tile.h:41   const float d = GGML_FP16_TO_FP32(b->d);
q6_K-raw-tile.h:51   sc_pl[sub*32 + row] = GGML_FP32_TO_FP16(d * (float) b->scales[kt_local*2 + sub]);
q6_K-tiled-pack.h:57,72  (identical expressions)
```
`ggml-impl.h:445-449` has **no arch override** (`GGML_COMPUTE_FP*` are the software
`ggml_compute_fp16_to_fp32` / `ggml_compute_fp32_to_fp16`, both pure integer ops plus one float multiply each,
`ggml-impl.h:396-443`), and the F16C/NEON overrides that do exist are `GGML_CPU_*`-scoped in
`ggml-cpu/simd-mappings.h:41-68` and are **not** used by `ggml-hexagon.cpp`. So the host packer and the DSP
converter execute the same rounding. That is the right answer today; the fragility is that the guarantee is
invisible to every test in the repo and would break silently if anyone added an arch override to
`ggml-impl.h`. (F15)

### 2.4 Padding rows for a partial last group — CONFIRMED, handled twice

```
q6_K-raw-tile.h:35   memset(tile, 0, 512 + 256 + 64 * sizeof(ggml_half));   // = 896, the whole stride
q6_K-raw-tile.h:37   const int n_in_group = (int) (n_rows < 32 ? n_rows : 32);
matmul-ops.c:253-255  hvx_mm_raw_group_rows(): ct*32 >= ne[1] ? 0 : MIN(32, ne[1] - ct*32)
matmul-ops.c:393-394  valid_rows = MIN(32, MAX(0, ne0 - ct*32))   (ne0 = dst->ne[0], preamble line 209)
hvx-mm-kernels-tiled.h:902  hvx_vec_store_u(s, valid_rows * sizeof(float), …)  // the dot writes past-n rows but never stores them
```
Quants zero ⇒ `(0-32)*0 = 0` for the padding rows, and the kernel's `valid_rows` bounds the store. 128000 % 32
== 0 so LFM2 never exercises it; 32000/151936/248320 also divide by 32. A vocab that does not (50257) takes
exactly this path and is fine. **128000 % 32 == 0 is not load-bearing** — the correctness argument does not
depend on it, only the coverage does (see 2.6).

### 2.5 `n_k % 8 == 0` — CONFIRMED unenforced (F6)

```
q6_K-raw-tile.h:10-11   n_k is the number of 32-wide k-tiles per row and must be a multiple of 8: one block_q6_K
                        super-block spans 8 k-tiles.
q6_K-raw-tile.h:25      const uint32_t n_sb = n_k / 8;  // super-blocks per row
```
A comment, not an assertion. The single enforcer is
`matmul-ops.c:3941  const bool raw_q6_k = w->type == HTP_TYPE_Q6_K && w->ne[0] % QK_K == 0;`
(plus `w->ne[0] == octx->src[1]->ne[0]` at `:3946`, so the job's `n_k = ne10/32` inherits the property). If
either check is ever weakened, `n_sb` truncates and `q6_K_get_quant(b, kt_local*32 + lk)` reads a *different
super-block* for kt ≥ 8·⌊n_k/8⌋ — silent garbage, no fault, no assert. A one-line
`GGML_ASSERT(n_k % 8 == 0)` at the top of the converter would cost nothing (the host packer has its own at
`q6_K-tiled-pack.h:39`).

### 2.6 Test coverage of the converter — CONFIRMED good where it counts, with real holes

Against the requirement "tests the **production** packer, not a copy": **yes**, and this is the strongest
part of the change.
```
tests/test-hexagon-q6_K-raw-tile.c:62   repack_q6_K_tiled_slice(want, rows, K, n_rows, TILE_SIZE);
tests/test-hexagon-q6_K-raw-tile.c:63   const int bytes_equal = memcmp(got, want, TILE_SIZE * n_k) == 0;
```
Compare the Q4_0 twin, which still uses a hand-copied reference (`tests/test-hexagon-q4_0-raw-tile.c:26-27`
"copied verbatim apart from the tensor plumbing"). The Q6_K test fixes a real defect in the older pattern.

It also has an *independent* semantic check that a byte-compare cannot give:
`tests/test-hexagon-q6_K-raw-tile.c:26-36` re-derives a weight element out of the tile
(`(lo | hi<<4) - 32) * fp16(scale)`) and compares against `dequantize_row_q6_K` (`:70`). That validates the
plane indexing against GGUF's own dequantiser, i.e. it would catch a *mutually consistent* packer+converter
pair that is both wrong. Good.

Partial groups: covered (`n_rows = {32, 13, 1}`, `:92`). Odd `n_rows`: covered. `K` not a multiple of 2048:
partially (`n_k = {8, 24, 64, 256}` → K 256/768/2048/8192, `:91`).

Holes I can name concretely:
* **`n_k % 8 != 0` is not tested** (all four cases are multiples of 8) — the one precondition the header
  documents (F6).
* **Qwen's K 2560 (`n_k = 80`) is not tested**, though H4 is in the same amendment and 80 is the value that
  will run on Qwen3.5-4B.
* **A padded source stride is never tested.** The converter always receives compacted rows; the *interesting*
  descriptor parameterisation (`src_stride = src0->nb[1] != row_size`) lives in
  `hvx_mm_push_raw_q6_K` (`matmul-ops.c:268-273`), which the test does not compile at all (F8).
* `tile_stride` is never varied from 896 (`#define TILE_SIZE 896`, `:21` — a duplicate of `matmul-ops.h:39`),
  so the stride parameter is untested and a constant change desynchronises the test silently (F16).
* `tile_weight` tolerance is a magic literal tied to the chosen data range:
  `const double w_tol = 1e-3 * 32 * 0.01 * 128 + 1e-4;` (`:78`) ≈ 0.041. Harmless while `memcmp` carries the
  test, but it is a second thing to keep in sync with the random-range code at `:48-57`.

### 2.7 Hand-build recipe — CONFIRMED workable, CONFIRMED not wired up (F4)

The recipe (`tests/test-hexagon-q6_K-raw-tile.c:3-8`) is correct as written: `q6_K-raw-tile.h:18` does
`#include "q6_K-tiled-pack.h"`, and a quoted include resolves relative to the including file's directory
(`ggml/src/ggml-hexagon/htp/`), so `-Iggml/src/ggml-hexagon/htp` is enough; `ggml-impl.h` comes from
`-Iggml/src`; `dequantize_row_q6_K` is `GGML_API` in `ggml-quants.h:62`; `block_q6_K` comes from
`ggml-common.h` via `ggml-quants.h` (note: **`ggml.h` does not include `ggml-common.h`** — the include list
in the test is load-bearing).

But the same comment says "Not registered with CTest (the header is HTP code)". Both new headers are pure C
needing only `ggml-common.h` + `ggml-impl.h` — no HAP, no DSP headers. And this very repo solved the exact
same problem twice already:
```
tests/CMakeLists.txt:471  llama_build_and_test(test-q4_0-tile32.cpp)          # non-public ggml/src header
tests/CMakeLists.txt:484  … ggml-opencl-tile32-facts.cpp                      # "the gate file is pure C++, so it
                                                                              #  compiles into the host build"
tests/CMakeLists.txt:489  … ggml-opencl-tile32-host.cpp                       # "the predicate TU is pure ggml"
```
So the converter/packer pair — the one thing the whole "byte-identical" claim rests on — is verified only by
a human remembering a four-line `cc` command. Nothing in CI fails if either header changes shape.

### 2.8 Mutation check — weak evidence, do not over-read it

The commit's "hi plane 512->640 in a shadowed header copy" was applied to the *converter*, so it proves only
that the memcmp is sensitive. A mutation in the *packer* would also fail the memcmp, so the check does cover
both sides — but it says nothing about the DMA row size, the stride, or `n_sb`, which is where the real bugs
would live (F8).

---

## 3. Angle 2 — DSP wiring in `htp/matmul-ops.c`

### 3.1 The RAW flag became a mode; Q4_0 raw and tiled are byte-identical — CONFIRMED

I compared the pre-diff bodies against the new dispatcher calls argument by argument.

Q4_0 raw push, old (`matmul-ops.c:255-259` pre-diff) vs new through `hvx_mm_push_slot`:
```
old: hvx_mm_push_raw_q4_0(dma_q, slot, src0, push_ct, n_k_tiles_a)
new: matmul-ops.c:291-292  if (raw == HTP_MM_RAW_Q4_0) hvx_mm_push_raw_q4_0(q, slot, src0, ct, n_k_tiles);
     with call site matmul-ops.c:379-381 / 432-434 / 500-502 / 522-524 passing (dma_q, slot, src0, src0_row,
     push_ct, n_k_tiles_a, tile_size, aligned_tile_size, tile_row_stride, RAW)
```
Identical. Tiled push, old `dma_queue_push(dma_q, dma_make_data(slot, src0_row + push_ct*tile_row_stride),
aligned_tile_size, tile_size, tile_size, n_k_tiles_a)` vs new `matmul-ops.c:296-297`
`dma_queue_push(q, dma_make_data(slot, src0_row + ct*tile_row_stride), aligned_tile_size, tile_size,
tile_size, n_k_tiles)` — identical. Conversion: old
`RAW_Q4_0 ? hvx_mm_raw_q4_0_to_tiles(vtcm_tiles_ptr, slot, src0, ct, n_k_tiles_a) : slot` vs new
`matmul-ops.c:391/512 hvx_mm_slot_to_tiles(vtcm_tiles_ptr, slot, src0, ct, n_k_tiles_a, RAW)` returning `slot`
for the non-raw mode (`:310`) — identical. All four call sites (prefill loop and post-pop repush, in both the
MATMUL and MATVEC macros) are converted consistently.

The RAW → mode rename is mechanical: `MATMUL_2D_REPACKED_IMPL` now passes `HTP_MM_RAW_TILES` (0) where it
used to pass literal `0` (`:332`), and `n_src0_slots = RAW ? n_prefetch - 1 : n_prefetch` (`:370`, `:481`)
is the same expression as before with a wider predicate.

### 3.2 Slot sizing — the inequality generalises, CONFIRMED

```
matmul-ops.c:363  const uint32_t aligned_tile_size = hex_align_up(tile_size, 128);      // 896 -> 896
matmul-ops.c:368  uint32_t tile_row_transfer_size_aligned = n_k_tiles_a * aligned_tile_size;
matmul-ops.c:249  // Q6_K: n_rows * n_k/8 * 210 B
matmul-ops.c:270  const size_t row_size = (n_k / 8) * sizeof(block_q6_K);              // 210 (ggml-common.h:362-368)
```
Group bytes `= 32 · (n_k/8) · 210 = 840·n_k`; slot bytes `= n_k · 896`. `840 < 896`, so the raw group fits
**for every `n_k` that is a multiple of 8** — the commit's `53760 ≤ 57344` at K 2048 is the `n_k = 64` case of a
general inequality, and Qwen's K 2560 (`n_k = 80`: 67200 ≤ 71680) is the same statement. Good. The `n_prefetch`
slot reserved for the converted tiles is the last one (`:371`, `:482`), and the raw mode uses only
`n_prefetch-1` slots (`:370`, `:481`), so the buffers cannot collide.

VTCM pressure is *unchanged* from the tiled Q6_K lm_head: `matmul-ops.h:588-594` sizes `src0` from
`n_prefetch * n_k_tiles * aligned_tile_size` regardless of raw/repacked, so no new budget requirement. The
`n_prefetch` chooser floors at 2 (`ggml-hexagon.cpp:5042-5053`), which is the minimum the raw mode needs
(`n_src0_slots = 1`). Sound.

### 3.3 Prefetch ordering — CONFIRMED

Pop → wait (`dma_queue_pop` spins on `desc->done`, `dma-queue.h:287-310`) → convert into the *separate*
last slot → compute → repush into the freed slot (`:389-436`, `:510-527`). `vtcm_tiles_ptr` is disjoint from
slots `0 … n_prefetch-2` because the slot size `n_k_tiles_a * 896` is a multiple of 256 and the base is
256-aligned (`htp_mm_round_up(..., 256)` at `matmul-ops.h:592`). The converted tiles are therefore not
clobbered by the next transfer, and 896·n_k being a multiple of 128 keeps every tile 128-aligned for
`HVX_Vector*` (`:894`). Pushes never exceed the pops, so a partial last group cannot under-fill the ring.

### 3.4 DMA descriptor — limits fine, **alignment unvalidated** (F1)

```
matmul-ops.c:268-273
    const size_t row_size = (n_k / 8) * sizeof(block_q6_K);
    dma_queue_push(q, dma_make_data(dst, (const uint8_t *) src0->data + ct * 32 * src0->nb[1]), row_size,
                   src0->nb[1], row_size, hvx_mm_raw_group_rows(src0, ct));
```
Fields: `row_size = 1680`, `src_stride = nb[1] = 1680`, `dst_stride = 1680`, `nrows ≤ 32`. Against the
16-bit descriptor (`__HVX_ARCH__ < 75`, i.e. the S23's v73) the fast path needs
`row_size/src_stride/dst_stride ≤ 0xFFFF` and `nrows ≤ 0xFFFF` (`dma-queue.h:103-107`, `:379-386`) — all
trivially true at K 2048 (1680) and K 2560 (2100). The general case degrades gracefully through the
existing fallbacks (`:390-404`): if `row_size == src_stride == dst_stride` the contiguous 1-D path takes over
(up to 16 MB), so even a hypothetical K ≥ 65536 works.

**The alignment question is the real one, and nothing in the tree answers it.**
* 1680 mod 128 = 16, so within a 32-row group only every 8th row (r·1680 ≡ 0 mod 128) is 128-aligned. The
  group base `src0->data + ct·32·nb[1]` is aligned (`53760·ct ≡ 0 mod 128`), and the dst slot is
  256-aligned — it is the per-row addresses that are not.
* Every other 2-D descriptor in this backend is deliberately 128-aligned. The *tiled* path rounds every tile
  up: `matmul-ops.h:41-48` defines `HTP_MM_WEIGHT_ALIGNED_TILE_SIZE_Q4_0 640` for a 576-byte tile,
  `…Q8_0 1152` for 1088, `…IQ4_NL 640` for 576 — i.e. the authors already know the DMA wants 128.
* The Q4_0 *raw* path only accidentally satisfies it: `n_k·18` is a multiple of 128 exactly when
  `n_k ≡ 0 mod 64`, i.e. K a multiple of 2048. At K 1536 the raw row is 864 B and at K 896 it is 504 B —
  both unaligned. So the invariant is *unproven in general*, and the new path makes it the common case
  (every lm_head, every K).
* There is **no assert, no comment and no check** in `dma-queue.c`/`dma-queue.h` for descriptor alignment
  (grep: `align` appears only in the ring-buffer layout code, `dma-queue.c:21-55`), and the H3 one-row probe
  is still listed as not done in the commit itself.

To be fair to the commit: it does **not** claim alignment is unneeded. The only comment is arithmetic
("a raw row is (n_k / 8) * 210 B, e.g. 1680 B at K 2048"). So this is a *missing gate*, not a false claim —
but it is the one thing that can turn the whole S23 arm into garbage logits with a green build and a green
host test.

### 3.5 `op_matmul` guard — CONFIRMED logically equivalent for Q4_0, correctly widened

```
matmul-ops.c:3939-3949
    const struct htp_tensor * w = octx->src[0];
    const bool raw_q4_0 = w->type == HTP_TYPE_Q4_0 && w->ne[0] % QK4_0 == 0;
    const bool raw_q6_k = w->type == HTP_TYPE_Q6_K && w->ne[0] % QK_K == 0;
    if (htp_mm_has_raw_weight(octx, 1) &&
        ((!raw_q4_0 && !raw_q6_k) || kparams->n_hmx ||
         (kparams->kernel_type != HTP_MM_KERNEL_HVX_QUANT_ROW && kparams->kernel_type != HTP_MM_KERNEL_HVX_QUANT_BLOCK) ||
         w->ne[0] != octx->src[1]->ne[0] ||
         w->ne[2] * w->ne[3] > 1 || octx->src[1]->ne[2] * octx->src[1]->ne[3] > 1)) {
        return HTP_STATUS_NO_SUPPORT;
    }
```
For Q4_0 the rewrite is a pure refactor of `w->type != Q4_0 || … || w->ne[0] % QK4_0`: a Q4_0 weight with
`ne[0] % 32 != 0` still lands in `!raw_q4_0` and is refused. No behaviour change. The dispatcher
(`:1805`, `:1809`, `:1821`, `:1826`) picks the raw job only in the 2-D and mat-vec branches, and the batched
branch is unreachable for a raw weight because `is_batched` (`:1785`) is exactly the negated `ne[2]*ne[3]`
condition in the guard. The other matmul entry points refuse raw weights outright
(`matmul-ops.c:4322`, `:4447`, `:4551`), so a raw Q6_K cannot slip into MUL_MAT_ID / `_NX`.

Two things I checked because they looked dangerous and are **not** bugs:
* the fused `HTP_OP_MUL_MAT_ADD` path (`htp/main.c:822-824`) calls the same `op_matmul`, so the guard covers
  it; and `MATVEC_2D_TILES_IMPL` really does handle `src2` (`matmul-ops.c:489-498`, `:532-536`), so a fused
  raw Q6_K matvec (decode + bias) would be correct. `ggml-hexagon.cpp:2978-3014` has no raw check of its own
  and does not need one.
* `n_prefetch` sanity: the raw mode cannot see `n_prefetch == 1` today (the host chooser floors at 2,
  `ggml-hexagon.cpp:5043`), but if it ever did, `n_src0_slots == 0` → no push → `dma_queue_pop` on an empty
  ring returns `{0}` (`dma-queue.h:288-290`) → `rows == NULL` in the converter. The `assert` that would have
  caught it is compiled out in Release (`NDEBUG=1` in the skel flags, see F12).

### 3.6 Thread partitioning — CONFIRMED safe

`matmul-ops.c:1768-1773` rounds `src0_nrows_per_thread` **up to 32** for every repacked type (raw included),
so `ct_start = src0_start_row / 32` is exact and adjacent threads never share a 32-row group; the mdev split
uses `htp_tensor_mdev_partition(…, 32, …)` (`:1748`). The last thread's `src0_end_row` may be unaligned,
which only re-derives the same `ct_end = (end+31)/32` and relies on the converter's zero-fill +
`valid_rows`, both verified above.

---

## 4. Angle 3 — the host gate

### 4.1 `raw_weights_supported` split — CONFIRMED correct, with one unintended reach (F3)

```
ggml-hexagon.cpp:2437-2455
    if (op->op != GGML_OP_MUL_MAT || i != 0 ||
        src->ne[2] * src->ne[3] > 1 || !act || act->ne[2] * act->ne[3] > 1) return false;
    if (src->type == GGML_TYPE_Q4_0) {
        if (src->ne[0] % QK4_0 || opt_mm_select != 1) return false;
    } else if (src->type == GGML_TYPE_Q6_K) {
        if (src->ne[0] % QK_K || act->ne[1] > 32) return false;
    } else { return false; }
```
vs the old single clause (`ee3dfde49`, `:2479-2487`) which required `src->type == Q4_0 && opt_mm_select == 1`.
For every non-Q6_K input the new code returns exactly what the old code returned (Q4_0 branch is
character-identical, the `else` branch reproduces the old type test). The 2-D and buffer checks are shared.
`act->ne[1] <= 32` is the right limit for the stated purpose: at decode ne11 = 1, `llama-bench -p` only
computes logits for the last token (1 row), and the 512-wide perplexity logits stay on the CPU — which is
what the comment at `:2443-2444` claims, and it checks out.

**F3 — the unintended reach.** The Q6_K branch has no `opt_mm_select` clause, so it fires at
`opt_mm_select == 1` as well. Before this commit, a shared-mode run at mm_select 1 (the "Q4_0 raw
whole-model" setting) had its Q6_K lm_head *refused* by the raw gate and ran on the CPU. After this commit
it is admitted and runs the new raw Q6_K job. Nothing in the diff or the commit message mentions this, and
the "byte-identical" argument is made only for two-copy mode (`:8424-8425` makes HOST placement conditional
on `opt_hostbuf_repack`, so two-copy genuinely has no raw weights — that part is CONFIRMED). Consequence: any
existing mm_select==1 shared arm that is re-run and compared against a pre-change baseline (0.70-of-tiled
numbers, KLD, split counts) is now a different configuration. Either gate the new branch to
`opt_mm_select >= 2`, or state loudly that mm_select==1 shared runs change.

### 4.2 `is_hmx_eligible` refusing raw weights — CONFIRMED, and it does *not* touch anything else

```
ggml-hexagon.cpp:4845-4849
    // HMX reads repacked tiles: a raw GGUF weight (e.g. the shared-weights lm_head in the -HOST
    // buffer) is not tiled, so this op must take the HVX raw path per op, not via opt_mm_select.
    if (ggml_hexagon_is_raw_weight(src0)) return false;
```
* **Non-raw weights: zero change.** `ggml_hexagon_is_raw_weight` (`:2417-2426`) returns false unless the
  tensor is a Hexagon WEIGHTS buffer tensor, of a repack type, without `GGML_HEXAGON_TENSOR_REPACK`. All
  the existing checks below (`:4851-4888`) are untouched and reached by exactly the same tensors as before.
* **Shared-mode Q4_0 TILE32 HMX matmuls: unchanged.** `ggml_backend_hexagon_tile32_buffer_set_tensor` sets
  `GGML_HEXAGON_TENSOR_REPACK` (`:2201`), so a TILE32 weight is not "raw" and the new early return does not
  fire. REFUTED as a concern.
* **HMX can never see a raw weight.** `kparams->n_hmx = 1` is set in exactly one place
  (`ggml-hexagon.cpp:4940`, inside `precompute_hmx_mm_params`), which is only called after
  `matmul_is_hmx_eligible` returns true (`:5157` for plain matmul, `:5838` for the fused-NN variant), and the
  DSP refuses `raw && n_hmx` independently (`matmul-ops.c:3944`).
* **The fusion predicates** that call the same function (`mm_is_hmx_eligible` `:6883`) are already guarded:
  `is_mergeable_mul_mat` returns false for raw at `:6917` and `is_mergeable_mul_mat_id` at `:6949`, both
  pre-existing. So no new fusion behaviour.

Net: the H5(a) plan error ("the raw gate's `opt_mm_select == 1` clause would keep HMX off for the whole
model; it must become per-op") is fixed exactly as specified. This part of the change is clean.

### 4.3 `has_raw_q6_K_mm` in `offload_op` — CONFIRMED bounded, but over-broad in identity (F14)

```
ggml-hexagon.cpp:8137-8139
    const bool mm_flat = opt_mm_select == 1 || ggml_hexagon_has_raw_q6_K_mm(op);
    return htp_admit_offload(admission, op, mm_flat, htp_admit_src1_is_weight(op)) &&
        ggml_backend_hexagon_device_supports_op(dev, op);
```
It cannot leak: the result is ANDed with `supports_op`, which runs the full raw gate at `:7915` first, and
`htp_admit_offload` still applies `offload_min` and the `offload_ops` mask
(`htp-admit.h:120-129`) — `mm_flat` only substitutes for the `opt_mm_select == 1` term. So "does it widen
offload for unrelated ops/graphs?" — **no, not beyond the intended raw Q6_K form**. It is a pure predicate
call added to the scheduler hot path (negligible: a few pointer loads).

But the name and comment overstate it:
```
ggml-hexagon.cpp:2460-2464
    // The raw Q6_K MUL_MAT (the shared-weights lm_head): the one raw form admitted without the
    // opt_mm_select == 1 clause, so offload_op must offer it regardless of the global HMX switch.
    static bool ggml_hexagon_has_raw_q6_K_mm(const struct ggml_tensor * op) {
        const struct ggml_tensor * src0 = op->src[0];
        return op->op == GGML_OP_MUL_MAT && src0 && src0->type == GGML_TYPE_Q6_K && ggml_hexagon_is_raw_weight(src0);
    }
```
It is a **type** test, not an identity test. Any raw Q6_K MUL_MAT anywhere in a shared-mode model — a
quantized attention projection, a Q6_K output head that is not the tied one — is now pulled onto the DSP at
any mm_select, through a path whose performance is unproven (F2). For LFM2 and Qwen3.5-4B (Q4_K_M bodies)
there is probably no such tensor, which is why this is P3 and not P1; but the code does not know that, and
the comment claims it does.

### 4.4 The specific cases asked about

* **Untied output.** Nothing special: a Q6_K `output.weight` sitting in HOST takes the identical path; one
  sitting in the HTP-only buffer is repacked (`ggml-hexagon.cpp:1854-1856`) and keeps HMX. Both fine.
* **Qwen (K 2560, vocab 248320).** Functionally admissible: `2560 % 256 == 0` → `n_k = 80`, `n_sb = 10`,
  row 2100 B, group 67200 ≤ slot 71680, `248320 % 32 == 0` so no partial group, `n_k_tiles_a = 80` keeps all
  VTCM 128-aligned. Nothing blocks it, and nothing measures it either: 521 MB of raw weight per token through
  the same scalar converter. H4's own text says the scalar conversion "is not acceptable" for Qwen and that
  the HVX version "is the plan, not the fallback" — the code ships the scalar path with no gate, no budget
  and no env to keep it off. That is a real gap against the spec's own fence (H5(b): "measure, then
  vectorise").
* **A Q6_K weight that is not in HOST.** `is_raw_weight` false → the whole new path is inert → tiled Q6_K +
  HMX, byte-identical to today. ✓
* **A raw Q6_K weight with `ne0 % 256 != 0`.** Refused host-side (`:2450`) and DSP-side (`:3941`). ✓
* **A raw Q6_K MUL_MAT with `act->ne[1] == 0`.** Admitted (0 ≤ 32); `supported_mul_mat` and ggml's shape rules
  make an empty activation unreachable. Not worth a check.
* **`act->ne[2]*ne[3] > 1` / `src->ne[2]*ne[3] > 1`.** Refused by the shared check. ✓

### 4.5 Two-copy byte-identity — CONFIRMED, by the right argument

```
ggml-hexagon.cpp:8436-8449
    static ggml_backend_buffer_type_t * ggml_backend_hexagon_dev_get_extra_bufts(...) {
        if (!opt_hostbuf_repack) { return none; }
        … dev_ctx->extra_bufts[0] = &dev_ctx->tile32_buffer_type;  if (opt_hostbuf) … host_buffer_type …
```
The HOST weight buft is only offered when `opt_hostbuf_repack` is set, which only
`ggml_backend_hexagon_set_shared_weights` (`:8424-8425`) or `GGML_HEXAGON_HOSTBUF_REPACK` (`:8712`) do. So
in two-copy mode every quantized weight carries `REPACK` (set at `:1855` for the device buffer, `:2201` for
TILE32), `is_raw_weight` is false for every tensor, and all three host deltas are inert. The claim is
correct. (The one caveat is F3: it is the *shared* mode that changed, not two-copy.)

---

## 5. Angle 4 — what the removed `opt_mm_select == 1` clause used to guarantee

The old clause was a global switch in disguise: with it satisfied, `hmx_enabled` was false for the whole run
(`ggml-hexagon.cpp:5156`, `:5837`), so no op anywhere could take an HMX kernel, and `mm_flat` was true for
every MUL_MAT weight (`:8137`). Dropping it for raw Q6_K loses exactly one guarantee — "HMX off globally" —
and that is precisely what H5(a) demanded. I traced every HMX consumer to confirm nothing else depended on
it: HMX kernels exist for matmul (`hmx_mm_2d_f32`, gated by the eligibility predicate), flash-attn
(`opt_fa_select`) and GDN (`opt_gdn_select`), and the latter two read activations, never weights. `n_hmx` is
written in exactly one place and is unreachable for a raw weight. Nothing else is lost.

What is *not* lost but was never there: a positive statement of *why* HMX must not see the raw bytes, other
than the comment at `:4845-4848`. Fine.

The one real behavioural loss is at mm_select == 1, already covered in F3.

---

## 6. Angle 5 — the test (summary; details in §2.6–2.8)

* Tests the **production** packer (`repack_q6_K_tiled_slice`, moved verbatim) — ✓ requirement met, and better
  than the Q4_0 twin.
* Plus an independent `dequantize_row_q6_K` cross-check that byte-compare alone would not give. ✓
* Partial groups (13, 1) ✓; odd `n_rows` ✓; K not a multiple of 2048 partially (256/768/2048/8192) ✓.
* Not registered with CTest ✗ (F4); no `n_k % 8 != 0` case ✗ (F6); no Qwen K 2560 ✗; no padded `nb[1]` and no
  coverage of `hvx_mm_push_raw_q6_K` at all ✗ (F8); `TILE_SIZE` duplicated ✗ (F16); the `hexagon-sim`
  raw-reader job required by H3 has **no harness in this tree** (`grep -rl hexagon-sim` → nothing), so that
  proof step is simply not addressed by any of the three commits.

---

## 7. Angle 6 — reuse / simplify (and dead code last)

* The `RAW → mode` refactor is a net **simplification** in intent (one dispatcher instead of three copies of
  a two-line if/else) but a net **complexity increase** in surface: `hvx_mm_push_slot` takes 10 parameters of
  which 4–5 are dead in each mode, and `hvx_mm_slot_to_tiles` takes 6 of which 3 are dead. With three modes a
  `_Generic`-style set of `static inline` per mode, or keeping the branch inside the macro (where `RAW` really
  is a compile-time constant), would be both shorter and immune to F11.
* The two host predicates now encode the Q6_K rule twice (`raw_weights_supported`'s Q6_K branch and
  `has_raw_q6_K_mm`). They agree today; a future change to one (say act rows ≤ 16) can silently diverge from
  the other. Deriving one from the other, or putting the Q6_K raw form in `htp-admit.h` next to
  `htp_admit_offload` (which *is* host-tested), would fix both the duplication and F5.
* Dead code, in the order the brief asks for it:
  1. `repack_q6_K_tiled_slice` — the **host** packer, complete with `GGML_ASSERT`, is compiled into every DSP
     TU that includes `q6_K-raw-tile.h` (`matmul-ops.c:244` today; `get-rows-ops.c`, `flash-attn-ops.c`,
     `set-rows-ops.c` already include `ggml-impl.h` through `hvx-quant.h`). It is then discarded: `nm` on the
     shipped `libggml-htp-v73.so` shows no such symbol (F9). It survives only because
     `matmul-ops.c:2` carries `#pragma clang diagnostic ignored "-Wunused-function"` — under the skel's real
     flags (`compile_commands.json`: `-Wall -Werror -O2 -flto`), any *other* HTP TU that includes this header
     without that pragma is a build break. Fix: split the bit-layout helper (`q6_K_get_quant`) into its own
     header and keep `repack_q6_K_tiled_slice` behind `#ifndef __hexagon__`.
  2. `ggml-hexagon.cpp:1299-1304` — `n_col_tiles`, `n_k_tiles`, `tile_size`, `matrix_size`, `sb_per_row` are now
     computed in the wrapper *and* recomputed inside the slice (F17). Only `tile_size` and `matrix_size` are
     still needed by the wrapper.
  3. Nothing else: `q6_K_get_quant` has exactly one definition (`q6_K-tiled-pack.h:12-31`) and two callers;
     the old inline loop is fully gone.

---

## 8. F2 in detail — the conversion cost, because it decides whether this is worth doing

Arithmetic at LFM2 lm_head size (vocab 128000, K 2048, `n_k = 64`):

* 4000 32-row groups/token × 64 k-tiles × 32 rows × 32 `lk` iterations = **2.62 × 10⁸ innermost iterations
  per token**.
* Each iteration is a call to `q6_K_get_quant` (a 4-way switch, 2 dependent loads, index arithmetic) plus two
  byte read-modify-writes with computed shifts: ~20 instructions if rolled scalar.
* On 6 HVX threads at ~1 GHz that is order **0.5 s/token** if scalar, ~0.15 s if 4-wide issue. The whole token
  today is ~44 ms and the tiled lm_head is 4.8 ms of it. For the spec's target (0.9–0.95 of two-copy,
  FABLE-DESIGN.md:673-675) the *entire* conversion would have to fit in ≈ 3 ms, i.e. ≲ 18 M cycles/token,
  i.e. ≲ 70 cycles per innermost iteration across 6 threads — only reachable if the loop is vectorised
  across ≥ 4 elements.

Codegen evidence from the shipped skel (`nm -S libggml-htp-v73.so`, built at `15c74f40b`):
```
hvx_mv_2d_repacked_q6_k   0x8a4 (2212)      hvx_mv_2d_raw_q6_k   0x954 (2388)   -> +176
hvx_mm_2d_repacked_q6_k   0x728 (1832)      hvx_mm_2d_raw_q6_k   0x818 (2072)   -> +240
hvx_mv_2d_repacked_q4_0   0x8c8 (2248)      hvx_mv_2d_raw_q4_0   0xa90 (2704)   -> +456
```
So the Q6_K converter contributes ~176–240 bytes of code, i.e. a compact rolled loop nest, and there is no
out-of-line `q6_K_raw_rows_to_tiles` symbol (it was inlined). That is *consistent with* a fully unrolled
vector form and *also consistent with* a ~20-instruction rolled scalar body plus an outlined `memset`
libcall — I cannot settle it read-only (no DSP6 disassembler on this machine; the SDK lives in the Android
container). Hence PLAUSIBLE, not CONFIRMED.

The spec's own inference ("Q4_0 raw whole-model ran 0.70 of tiled **with scalar conversion**, and Q6_K's
per-element scatter is heavier ⇒ 0.9-0.95", `:673-675`) is unsound as stated: the Q4_0 converter
(`htp/q4_0-raw-tile.h:31-40`) is a contiguous byte copy with constant indices — exactly the shape clang
vectorises — so "0.70 of tiled" is evidence about a *possibly vectorised* loop and says nothing about the
Q6_K gather/scatter. Recommended gate before the ABBA: disassemble `hvx_mv_2d_raw_q6_k` and count the
instructions in the innermost loop (≤ 3–4 vector ops ⇒ ship; ~20 scalar ops ⇒ the design misses its own
perf target by 10-30× and the vectoriser is H1's real work), then profile one lm_head op on the device.
Note the H3 gate list (`:683-689`) has no "conversion time" metric of its own; `tg128 ≥ 0.95` would catch
the failure only after a full ABBA cycle.

---

## 9. Recommended minimum before any S23 ABBA

1. **F1** — run the one-row DMA probe for the 1680-byte stride *first*; if DMX needs 128-byte rows, the fix is
   either a repacked-group staging (DMA 16-byte-aligned rows is not an option; the descriptor has
   `src_offset`/`dst_offset` fields that the code always sets to 0, `dma-queue.h:253-254`) or an
   `#if __HVX_ARCH__ < 75` 16-bit-descriptor alignment fallback. Whatever the answer, leave a comment in
   `hvx_mm_push_raw_q6_K` stating the verified requirement — right now there is no record either way.
2. **F2** — one op-profile of the raw Q6_K lm_head (`--profile-op`), plus the disassembly check above.
3. **F3** — decide and state whether mm_select == 1 shared runs are supposed to change; if not, add
   `opt_mm_select >= 2` to the Q6_K branch.
4. **F4/F5** — register `test-hexagon-q6_K-raw-tile` in `tests/CMakeLists.txt` (the headers are pure C, the
   precedent is at `tests/CMakeLists.txt:471/484/489`), add an `n_k = 80` case and an `n_k % 8 != 0` case, and
   move the raw Q6_K gate into `htp-admit.h` so `test-hexagon-admit.cpp` can cover it.
5. **F6/F7/F8** — `GGML_ASSERT(n_k % 8 == 0)` in the converter; pass the tile stride from the job instead of
   hardcoding `HTP_MM_WEIGHT_ALIGNED_TILE_SIZE_Q6_K`; add one host test that drives
   `hvx_mm_push_raw_q6_K`'s `row_size`/`src_stride` arithmetic (including `nb[1] > row_size`).
