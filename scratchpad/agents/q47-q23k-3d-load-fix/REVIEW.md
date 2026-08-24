# Q47 — HOSTILE REVIEW: `kalsa/fix-q23k-3d-load` (3 commits vs `main`)

Reviewer disposition: adversarial. All file:line refs are against the branch HEAD
(`a4b1d5b23`) tree, unless stated. Read-only on the fork; the repo working tree
was on an unrelated branch (`kalsa/kernel-s3-repack`, HEAD `1882bf8cd`), so this
review was done on a tree exported with `git archive` to `/tmp/q47-tree`
(branch-identical; no checkout, no push). Base verified: `git merge-base main
branch` = `main` HEAD `9890d1054` (matches DIAGNOSIS/REPORT "based on main @
9890d1054"). Diff is exactly 4 files: `ggml-cpu.c`, `repack.cpp`,
`tests/CMakeLists.txt`, `tests/test-repack-q23k-load.cpp`.

Verdict: **BANK-with-fixes**. The size-contract fix, the packer-writes-nb[2]
invariant, the loud fence and the two q23k fusion gates are all correct for the
shipped (ARM q23k) configuration and reproduce/close the abort and the
silent-wrong. Required fixes are hardening, not regressions: the fusion gate
generalizes badly (dense K-quant 8x4/8x8 experts still escape for the same
reason), and the new test is vacuous on any non-Neon host and has no
padded-size-negative case.

---

## Item 1 — Arithmetic of the mechanism

**CONFIRMED-OK.** Independently recomputed every value (Python, `/tmp`); all
match the logged output and `NBYTES_MATH.json` exactly.

Geometry oracles:
- `block_q2_K` = 84 B, `block_q3_K` = 110 B (`ggml-common.h:308-309,320-321`).
- Tiles: `block_q2_K_8x4` 672 B, `block_q3_K_8x4` 912 B (`repack.h:83-84` (Q2) and `:92-93` (Q3) static_asserts).
- Packed slice stride: `(payload+63)&~63`, payload = `(ne1/8)*(ne0/256)*tile`
  (`repack.cpp:36-40`). `ggml_nbytes` quantized branch (bbck≠1):
  `ne0*nb0/blck + (ne1-1)nb1 + (ne2-1)nb2 + (ne3-1)nb3` (`ggml.c:1289-1311`).

| case | type | shape | native | hybrid(after init) | stride | packed | pre-fix abort? |
|---|---:|---:|---:|---:|---:|---|
| 2d_q2 | Q2 | [256,8,1] | 672 | 672 | 704 | 704 | no (2-D collapse: `(ne2-1)nb2=0`) |
| pad_q2_3d | Q2 | [256,8,3] | 2016 | 2080 | 704 | 2112 | **yes** |
| q3_3d | Q3 | [256,8,3] | 2640 | 2800 | 960 | 2880 | **yes** |
| lfm_gate_q2 | Q2 | [2048,1792,32] | 38535168 | 38535168 | 1204224 | 38535168 | no (payload%64==0 ⇒ stride==native slice) |
| lfm_down_q3 | Q3 | [1792,2048,32] | 50462720 | 52240384 | 1634304 | 52297728 | **yes** (Δ1 777 664) |
| marco_gate_q2 | Q2 | [1024,768,256] | 66060288 | 66060288 | 258048 | 66060288 | no |
| marco_down_q3 | Q3 | [768,1024,256] | 86507520 | 89640960 | 350208 | 89653248 | **yes** (Δ3 133 440) |

- `Q3 [*,*,≥2]` always produces hybrid ≠ native whenever the packed slice is not
  byte-identical to the native slice (Q3 is +32 B/tile, 912 vs 880; only a slice
  that is already 64-aligned and size-neutral could hide it — Q3 never is).
- Q2 misaligned 3-D (ne0=256,ne1=8 → stride 704 vs native 672) also mismatches
  → the "pad_q2_3d" m2-pin case is a genuine second killer, and NBYTES_MATH.json
  records `marco` Q2 as aligned (258048 % 64 == 0) while `pad` Q2 is not.
- 2-D collapse, LFM Q2 alignment, and the DIAGNOSIS statement "LFM Q2 packs,
  LFM Q3 (next in create order) aborts" are all confirmed by
  `pre-fix-native-set.err` (lfm_gate_q2 no FAIL line; lfm_down_q3 FAIL mismatch
  52240384 ≠ 50462720).

The pre-fix crash mechanism is exactly as described: loader `n_size=ggml_nbytes`
(`llama-model-loader.cpp:1543`) was hybrid, `set_tensor` required native
geometry (`repack.cpp:5337-5342`), GGML_ASSERT aborted at the old line 5339.

## Item 2 — Other consumers of nb[]/ggml_nbytes on CPU_REPACK tensors

**CONFIRMED-OK** for every loader/compute path that can touch a q23k tensor,
with two pre-existing caveats noted.

Path audit:
- **mmap branch** (`llama-model-loader.cpp:1545-1571`): q23k tensors are
  pre-allocated (`cur->data != nullptr` from `ggml_backend_alloc_ctx_tensors`,
  `llama-model.cpp:1572`), so the mmap-alias `ggml_backend_tensor_alloc` branch
  is skipped and every expert goes through `ggml_backend_tensor_set(cur, data,
  0, n_size)` (**:1571**). Even if it were taken, `ggml_backend_tensor_alloc`
  asserts `addr >= buffer base` (`ggml-backend.cpp:2000`) and the mmap pointer
  is not in the repack buffer, so it would trip loudly. Under the fix n_size is
  native ⇒ set+pack correct.
- **no-mmap host direct-read** (`:1558-1563` `file->read_raw(cur->data, n_size)`)
  is NOT taken for q23k: the repack buft has `.is_host = nullptr`
  (`repack.cpp:5492`), and `ggml_backend_buft_is_host` returns **false** when
  `iface.is_host` is unset (`ggml-backend.cpp:72-79`). So repack tensors always
  route through `read_buf` + `best_set` (**:1641-1642**) or the mmap else-branch
  — i.e. through `set_tensor` in both modes. This is exactly why the crash
  reproduced.
- **Bounds check** `offset+size <= ggml_nbytes(tensor)`
  (`ggml-backend.cpp:334`): at load time nb is native ⇒ ggml_nbytes == size ⇒
  passes; it is the tautology DIAGNOSIS says it is.
- **Between init_tensor and set_tensor**: `get_alloc_size` (`repack.cpp:5384-5397`)
  reads ne[]/type only; `size_data`/progress sums and `ggml_validate_row_data`
  now run against the correct native size (pre-fix they were fed hybrid).
  `ggml_backend_buft_get_alloc_size` assert `size >= ggml_nbytes`
  (`ggml-backend.cpp:64`) holds: packed ≥ hybrid ≥ native in every case above.
- **After pack (nb[2] packed)**: only the q23k kernels consume nb[2], and they
  want the packed stride (`forward_mul_mat_id_q23k` does `slice=src0->nb[2]`,
  `vx=base+expert_id*slice`, `repack.cpp:4748,4755`). No post-load reader
  expects native nb. `graph_copy`/sched never re-reads weight bytes.
- **KV/state-save paths**: operate on activation/KV tensors, never on repack
  weights. No interaction.

Pre-existing caveats (out of this diff, flag for the record):
- `get_tensor` and `cpy_tensor` are `nullptr` on the repack buffer
  (`repack.cpp:5372-5373`); `ggml_backend_tensor_get` calls
  `buf->iface.get_tensor(...)` unconditionally (`ggml-backend.cpp:347`) ⇒ any
  read-back/copy of a packed weight is a null-deref, and checkpoint/export of a
  repacked model is unsupported. Not reachable in MoE inference; preserved by
  this branch.

## Item 3 — Packer `data_size` assert vs callers

**CONFIRMED-OK.** The q23k packers assert
`data_size == src_slice * n_slices` (`repack.cpp:3281,3323`) with
`src_slice = n_row*nblocks*sizeof(block)` — identical to the native geometry
`set_tensor` now enforces (`ggml_row_size(type,ne0)*ne1*ne2*ne3`,
`:5341-5342`). Production call graph:
- CPU buffer `set_tensor` → `tensor_traits->repack(tensor,data,size)`
  (`:5351`). `size` was just checked equal to `src_nbytes` for q23k ⇒ the
  packer assert always holds. No code path passes the PADDED
  `get_alloc_size` value to a q23k packer:
  - `get_alloc_size` is consumed only by buffer allocation
    (`ggml-backend.cpp:62-66`), never by `repack()`.
  - The other `->repack()` callers (`kleidiai.cpp:1369`, `spacemit/ime.cpp:1453`)
    are KleidiAI/SpaceMIT buffer types with their own traits — not the q23k
    file-static traits.
  - The extern pack hooks (`test-repack-q23k-m0/m1/m2`) pass native wbytes.
- Both loader branches (mmap `:1571`, no-mmap `:1642`) pass `n_size` = native.

## Item 4 — Fusion-gate completeness

**CONFIRMED-OK for the q23k scope; RISK outside it** (see below).

Every path that can launch a native-layout kernel on a q23k_8x4 tensor:
1. **Fused MoE GEMV** — `ggml_cpu_mul_mat_id_should_fuse` new gate
   (`ggml-cpu.c:95-97`) returns false for q23k; the fused launch
   `ggml_compute_forward_mul_mat_id_fused` (`:1949`) is gated behind it.
   (Note: this gate is actually *defensive* — a q23k MUL_MAT_ID is intercepted
   by the extra path before the stock `mul_mat_id` is ever reached, so the stock
   function and its gate only see non-q23k tensors. Harmless, consistent.)
2. **Fused MoE FFN** — `ggml_cpu_try_fuse_moe_ffn` new gate checks the extras of
   `n0->src[0]`, `n1->src[0]`, `n3->src[0]` (`ggml-cpu.c:3661-3667`), i.e. all
   three expert tensors of the SwiGLU pattern (gate, up, down). This is the
   *live* gate: fusion runs before `ggml_compute_forward` and would bypass the
   extra path entirely (`:3863`, thread loop `:3929-3936`).
3. **Stock native `mul_mat_id` / 2-D `mul_mat` / any other op** — unreachable
   for q23k: `ggml_cpu_extra_compute_forward` (`traits.cpp:13-36`) handles
   MUL_MAT/MUL_MAT_ID via the q23k kernels and **GGML_ABORTs** on any declined
   q23k op (`traits.cpp:24-28`) and on any q23k `src[0]` reaching native compute
   (`traits.cpp:31-35`). So GET_ROWS, batched 2-D MUL_MAT with ne[2]>1, batched
   MUL_MAT_ID with non-F32 src1, views (abort at `repack.cpp:5304-5306`), etc.
   are all **loud**, never silent.
   - Exception checked: a q23k extra can only exist on a repack-buffer tensor
     (its init_tensor is the only writer), and `get_tensor_traits`
     (`repack.cpp:5473-5480`) matches by `buft == repack`, so the extra path
     always sees q23k MUL_MAT_IDs. The second (`src[0]->extra`) guard would even
     catch a tensor hand-packed into a non-repack buffer (test-only).
4. **`-nr` / GGML_CPU_REPACK off**: the repack buft is not registered
   (`ggml-cpu.cpp:64-70`), no q23k extra exists, the gates are no-ops, native
   fusion on native bytes (as before). Confirmed by `cli-norepack.out` coherent.

**RISK (item 4 breadth; pre-existing, not introduced here, but the patch is the
right place to fix it):** the two new gates compare against the two ARM 8x4 file
statics only. The same silent-wrong mechanism — native vec_dot launched on a
repacked, non-native layout — still applies to:
- dense K-quant experts repacked to `q4_K_8x4/q5_K_8x4/q6_K_8x4`
  (`repack.cpp:5165,5215,5226`) on Neon+dotprod (i.e. the exact Jelly/Mellum
  configuration), and `q2_K_8x8` on AVX512 (`:5183`);
- all of which are `ggml_cpu_type_is_k_quant` (`ggml-cpu.c:68-75`) so
  `should_fuse`/`try_fuse_moe_ffn` still fuse them and run native vec_dot on
  tiled bytes.
Target models today use only Q2/Q3 experts, so this is latent; but the patch's
own rationale ("native vec_dot on tiled storage is silent-wrong") generalizes to
"any tiled repack trait". Recommended fix: gate fusion on
`ggml_repack_get_optimal_repack_type(src0) != nullptr` for any K-quant (or
pointer-equality against every 8x4/8x8/8_bl trait family), or add the same
decline in the FFN/GEMV gates.

## Item 5 — `ggml_cpu_repack_extra_is_q23k_8x4` on foreign extras

**CONFIRMED-OK.** Definition is pointer-equality only, no dereference
(`repack.cpp:5291-5294`; public wrapper `:5296-5297`); targets are two
file-static trait objects (`:5075-5076`, stable addresses). Null `extra`,
KleidiAI/AMX/SpaceMIT/`8x8`/`16x1` traits all compare unequal. Both new call
sites (`ggml-cpu.c:96,3661-3667`) go through this helper; `n0->src[0]` is
null-guarded in the FFN gate, and `src0` is non-null by construction in
`should_fuse`. No UB, no alien-trait downcast. Matches the v1 max-recall fix
pattern.

## Item 6 — Reuse / buffer-lifecycle (the subtle one)

**CONFIRMED-OK** for every lifecycle llama actually performs, with the invariant
explicitly identified.

- New invariant: `init_tensor` for q23k leaves nb[] as `ggml_new_tensor` made
  them (`repack.cpp:5309-5323`); the packer is the **single writer** of packed
  `nb[2]`/`nb[3]`, after it has consumed native bytes (`:3301-3306,3343-3348`).
- Because data state only ever changes through `set_tensor` (loader) — whose size
  check is **shape-derived** (`src_nbytes` from ne[]), not nb-derived — a
  recycled packed tensor re-set with native size re-packs cleanly, and a re-set
  with nb-derived `ggml_nbytes` (=hybrid post-pack) aborts **loudly** rather
  than silently accepting. The stale-packed-nb[2] window that the removed
  restore-native branch used to guard for non-q23k simply cannot produce a
  silent wrong here.
- The old code's q23k branch wrote `nb[2]=stride` unconditionally on every
  init; the new code writes nothing. Both are "packed after a pack, native after
  a fresh init"; the new code is strictly safer because it does not pre-publish
  a packed stride before data exists (the actual bug) and because wiping packed
  nb[2] on a re-init (old restore-native, if it had applied to q23k) would have
  made MUL_MAT_ID walk experts with the native slice size — the exact
  silent-wrong class. The in-code comment (`:5313-5315`) states this correctly.
- Residual theoretical hazard (no llama-visible trigger): a tensor that was
  packed, then has its buffer freed and a *fresh* buffer assigned without a new
  set_tensor (e.g. hypothetical in-place model reload sharing a ctx) would carry
  packed nb[2] onto uninitialized bytes. In llama each `llama_model` owns a fresh
  ggml_context; init_tensor runs once per tensor. Not actionable, worth a
  comment.
- Non-q23k (`-nr`/dense 8x4/8x8) restore-native branch **unchanged** — diff only
  reshapes the condition to `if (!q23k) { restore }`.

## Item 7 — Test adequacy

**PARTIAL. Required cases are covered; two gaps.**

Covered (in `test-repack-q23k-load.cpp`):
- Q3 misaligned 3-D killer: `q3_3d` [256,8,3] (hybrid 2800 vs native 2640). ✓
- Q2 *mis*aligned 3-D (second killer): `pad_q2_3d` [256,8,3]. ✓
- Q2 *aligned* 3-D: `lfm_gate_q2` [2048,1792,32]. ✓
- 2-D collapse: `2d_q2`. ✓
- LFM down Q3 (real model geometry): `lfm_down_q3`. ✓
- mmap-style `ggml_nbytes` loader size: `loader_ok = nbytes==native` plus
  `--loader-set` exercises the exact `load_all_data:1543/1571` call. Pre-fix
  binary aborts; post-fix passes (on-device logs). ✓
- ctest: `llama_build_and_test` registers an `add_test` (`tests/CMakeLists.txt`,
  `:83-117`; new entry `:262-263`) ⇒ runs under ctest on default GGML_CPU_REPACK=ON.

Gaps:
- **No padded-size negative**: nothing feeds `alloc`/`stride*n` to
  `ggml_backend_tensor_set` and asserts it is rejected loudly. The `alloc`
  column is computed and printed but never used for a rejection assertion. The
  "wrong size is refused" contract (item 8) is only demonstrated by the pre-fix
  *accidental* abort, not by an intentional post-fix negative test. Add a
  subprocess/death-test style case (or fork/abort-capture) that passes
  `get_alloc_size` and requires the `GGML_ABORT` path.
- **Vacuous on non-Neon hosts**: on x86 the trait is never 8x4 (AVX512→8x8,
  AVX2→null), so every `got_8x4` guard is false, every case prints "skip set
  (8x4 not selected)" and the test returns PASS — including for the exact Q3
  killer. This is an effective no-op under any x86 CI/desktop ctest run
  (reproduced: `test-repack-q23k-load.exe` on this PC, `neon=0 dotprod=0`).
  Recommend: fail (or at minimum print WARN + nonzero skip code) when no 8x4
  trait was selected, so CI cannot silently lose coverage.

## Item 8 — Reworded set_tensor abort

**CONFIRMED-OK.**
- Specifiers/types: `"…%s…%zu…%zu…(ggml_nbytes=%zu)"` ↔ `__func__` (const char*),
  `size`/`src_nbytes`/`ggml_nbytes(tensor)` (size_t). No mismatch.
- Loudness: `GGML_ABORT` → `ggml_abort(__FILE__, __LINE__, …)` (`ggml.h:287`);
  both `GGML_ABORT` and `GGML_ASSERT` are always-on macros (no NDEBUG escape),
  so the q23k branch rejects a hybrid **or** padded source size with
  file:line and all three numbers, and the non-q23k branch retains its
  `GGML_ASSERT(size == ggml_nbytes)` unchanged (`repack.cpp:5347-5348`). No
  silent acceptance path exists. Message strictly more informative than the old
  `GGML_ASSERT(size == src_nbytes) failed`.

---

## Build / integration evidence (independent)

- PC test binary (built from `worktree-repack-q23k` = branch HEAD) compiles,
  links and runs; prints the fixed contract and PASS on x86. Compile integrity
  of the new `ggml-cpu.c` include (`#include "repack-q23k.h"`) is therefore
  proven on MSVC/x86; `repack.cpp` is in `GGML_CPU_SOURCES` unconditionally
  (`ggml-cpu/CMakeLists.txt:32`), so the new `ggml_cpu.c` calls link even when
  `GGML_USE_CPU_REPACK` is off (where the gates are no-ops).
- Android clang build: reported SHA256s verified exactly:
  `llama-completion C155BA16…`, `test-repack-q23k-load AEC93D26…`.
- On-device post-fix: `post-fix-loader-set.out` RESULT PASS with
  `ggml_nbytes==native` for all five cases incl. LFM Q2/Q3; `post-fix.rc`
  RC_NATIVE=0 RC_LOADER=0; full `llama-completion` mmap+repack run packs
  44×`q2_K_8x4` + 22×`q3_K_8x4` including `blk.2.*`, CPU_REPACK 3196 MiB,
  61 tokens, output names Paris; `-nr` run coherent.

## Audit of DIAGNOSIS.md / REPORT.md claims vs `results/q47_3dload_jelly/`

Supported by the captured logs (verified directly):
- Pre-fix abort string `repack.cpp:5339 GGML_ASSERT(size == src_nbytes) failed`,
  RC=134/SIGABRT — `pre-fix-loader-set.err`. ✓
- Hybrid-vs-native numbers for pad_q2_3d / q3_3d / lfm_gate_q2 / lfm_down_q3
  — `pre-fix-native-set.err` (2080≠2016, 2800≠2640, 38535168==38535168,
  52240384≠50462720) and `NBYTES_MATH.json`. ✓
- LFM Q2 aligned / LFM Q3 next => aborts — asymmetric FAIL pattern. ✓
- "44 q2_K_8x4 and 22 q3_K_8x4 including blk.2" — `cli-repack-final.err` counts
  (44/22), `blk.2.ffn_gate_exps`/`down`/`up` present; 22 layers × (2 Q2 + 1 Q3)
  is internally consistent. ✓
- "greedy chat output names Paris" — `cli-repack-final.out`. ✓
- "fused FFN on tiled q23k = slash-spam at temp 0" — `cli-interactive.out`
  contains the raw garbage (`+<…?92%;,'3804`); `cli-interactive.err` shows repack
  on (44+22), full load succeeded, 29 tokens, no abort — i.e. the load-fixed /
  pre-fusion-gate state, consistent with the stated discovery order. ✓
- Host x86 "PASS (8x4 not selected)" — reproduced here. ✓
- Middle-part numbers for Marco (gate Q2 aligned / down Q3 mismatch) —
  `NBYTES_MATH.json`; recomputed independently ✓.

Not supported by the files in `results/q47_3dload_jelly/` (external or inferred;
none contradict the logs, but they are not verifiable from this dir):
- ⚠ "First q2_K_8x4 = blk.2.ffn_gate_exps, abort **178 ms** later" and the app
  tombstone (`load_all_data+3708`) — the app log/tombstone is not archived here;
  the 178 ms figure is not reproducible from these logs (the Jelly cli shows
  ~111 ms for the blk.2 gate pack in `cli-repack-final.err`). Acceptable as
  derivation, flag as unproven-from-this-dir.
- ⚠ "M5 A/B GEMV/GEMM PASS" — no M5 log in this results dir (points at an
  external run).
- ⚠ "same with `-nr` coherent" — only `cli-norepack.out` is archived; no stderr
  and no RC to confirm run integrity / same seed+model. Qualitative only.
- ⚠ The slash-spam run's *binary fingerprint* is not pinned (only the final
  `llama-completion` sha is), so the exact commit-state of the garbage run is
  inference.
- MINOR doc-drift (outer repo, not this branch): `docs/design-repack-q23k.md`
  "supports_op guard" row still says a declined op "falls back to the original
  Q2_K/Q3_K CPU path", and the "Buffer sizing" row says `set_tensor`'s size check
  "uses the trait's repacked byte count" — both superseded by the loud-fence
  (traits.cpp) and by this branch's native-source contract. Update the design
  doc when landing.

## Final verdict

**BANK-with-fixes.** Root cause, mechanism, arithmetic, loader analysis and the
two follow-on bugs are all real and correctly fixed; on-device evidence matches.
Bank the merge for the ARM q23k configuration. Before/at landing, apply:
1. Generalize the two fusion gates from `is_q23k_8x4` to *any tiled repack
   trait* (or at least any 8x4/8x8 K-quant trait), or add a comment+test proving
   dense-K-quant/8x8 fused MoE is unselectable — current code leaves the same
   silent-wrong open for q4_K/q5_K/q6_K 8x4 (Jelly-class hosts) and q2_K_8x8
   (AVX512).
2. Add a padded-size negative test (feeds `get_alloc_size` into `set_tensor`
   and proves the loud abort) to lock the item-8 contract.
3. Make the test non-vacuous on non-Neon hosts (fail/warn when no 8x4 trait is
   selected) so x86 ctest cannot silently drop coverage.
4. Archive the M5 A/B log and the -nr stderr + seeds; pin the garbage-demo
   binary sha; record the app tombstone lines that back the "178 ms / first
   tensor" claim.

No BLOCK-level finding: nothing in the patch silently degrades any shipped
configuration, and every out-of-scope risk is loud or pre-existing.
