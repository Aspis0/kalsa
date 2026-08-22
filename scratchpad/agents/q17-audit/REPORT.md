# Audit: q17 follow-up fixes — d5e7ce8c4 + 0d3f2fa66 + 0ea21aead

STATUS: COMPLETE
Repo: `BigMoeOnEdge/third_party/llama.cpp`, branch `kalsa/kernel-s3-repack` @ `0ea21aead`
Context: `scratchpad/agents/q17-fixes/REPORT.md`
Range audited: `c77fe1354..0ea21aead`

## Commits under audit
- `d5e7ce8c4` opencl: guard q6_K flat workaround by GPU family (+1 code)
- `0d3f2fa66` opencl: make unknown compiler versions explicit (+7/-2 code)
- `0ea21aead` opencl: skip empty MoE matmul dispatch (+6 code)

---

## Commit 1: d5e7ce8c4 — q6_K flat gate by GPU family

### A1. Pattern parity with q4_0 gates — REFUTED as defect (parity holds in substance)
Gate now reads (`ggml-opencl.cpp:6027-6030`):
```
gpu_family == ADRENO && adreno_cl_compiler_version.type == E031 &&
!adreno_cl_compiler_version.newer_than_or_same(E031, 45, 0, 0)
```
The q4_0 flat gates (`:2009-2012`, `:2029-2032`) are skip-gates of the form
`gpu_family != ADRENO || newer_than_or_same(...) || type == DX`. Complementary
polarity (enable-gate vs skip-gate), same unscoped enum members (`E031`, `DX`,
`:146-150`). Substantively identical contract: workaround-class kernels require
Adreno. Parity claim holds.

### A2. Adreno E031.41.03.62 (S23) unchanged — CONFIRMED unchanged
`newer_than_or_same(E031,45,0,0)` for 41.3.62: `same` false;
`newer_than`: 41*10000 + 3*100 + 62 = 410362 > 450000 is false (`:170-174`) →
false → negated true. On S23 `gpu_family == ADRENO` was already true, so the
gate evaluates TRUE→TRUE across the commit. No behavior change on the target
device.

### A3. Non-Adreno flip — CONFIRMED fixed, and it was perf-only pre-fix
Pre-fix (at `c77fe1354`): parser fallback `return {}` value-initialized
`type` to `E031` (=0) with major/minor/patch = −1, so on Intel/unknown devices
the gate was `E031==E031 && !newer_than_or_same(−1…)` = **true** — workaround
opts compiled in on non-Adreno. Post-fix: conjunct fails → false → FAST path,
as required. Note: even pre-fix this could not crash, because both consumers
read the same flag (A4); the exposure was the measured 13–20% codegen loss.

### A4. Build-opt / dispatch consistency — REFUTED as mismatch risk (single source of truth)
All uses of `q6_k_flat_old_compiler` (exhaustive grep):
- `:586` declaration
- `:2243-2246` build opts (`-DADRENO_OLD_COMPILER=1` ↔ 18-arg program)
- `:20961-20964` runtime arg 17 (optimizer-barrier mask, only when flag set)
- `:6027` assignment
Both operational sites read the identical bool, assigned exactly once at init.
No third consumer. A build/dispatch signature mismatch is structurally
impossible.

### A5. Ordering proof (gate before build, build before dispatch) — CONFIRMED safe
- `backend_ctx->gpu_family = dev_ctx->gpu_family;` at `:5984`, strictly before
  the gate assignment at `:6027`. No UNKNOWN-family read.
- `load_cl_kernels` (contains the `:2243` build site) is *defined* at `:1564`
  but *called* at `:11793`, inside
  `ggml_backend_opencl_buffer_type_alloc_buffer` (`:11790`), whose first
  statement is `ggml_cl_init(buffer_type->device)` (`:11791`). So the sequence
  is: gate set (init, `:6027`) → programs built (`:2243`) → dispatch args
  (`:20961`, at graph-compute time). Strictly ordered; no stale-flag window.

## Commit 2: 0d3f2fa66 — unknown compiler explicit

### B1. E031/DX classification untouched — REFUTED as regression
Diff touches only: enum member added (`:154`), struct default (`:164`),
comment block (`:301-305`), and the npos-fallback return (`:313`). The E031
find path (`:303-308`), offsets (`compiler_ver_len/major/minor/patch`), DX path
(`:309-315`) and the atoi parse (`:317-319`) are byte-identical. Every string
that classified as E031/DX before classifies identically now; e.g.
"E031.41.03.62" still yields `{E031, 41, 3, 62}`.

### B2. UNKNOWN→UNKNOWN_COMPILER rename completeness — REFUTED as silent-miss risk; rename was mandatory
- `GPU_FAMILY` is an UNSCOPED enum (`:137-141`) whose enumerator list includes
  bare `UNKNOWN` (`:140`); the codebase accesses it both scoped and bare
  (`gpu_family == INTEL`, `GPU_FAMILY::UNKNOWN`). Adding plain `UNKNOWN` to the
  equally unscoped `ADRENO_CL_COMPILER_TYPE` (`:146`) would be a redefinition
  compile error — the rename was necessary, not cosmetic. Context report's text
  "`ADRENO_CL_COMPILER_TYPE::UNKNOWN`" is stale naming (also wrong inside the
  0d3f2fa66 report snapshot) — cosmetic, code is consistent.
- Exhaustive grep: `UNKNOWN_COMPILER` appears only at `:154`, `:164`, `:313`.
  Bare `UNKNOWN` references remaining are exclusively `ADRENO_UNKNOWN`,
  `GPU_FAMILY::UNKNOWN`, and one comment word. No missed identifier that could
  silently bind to another symbol. No `switch` over `ADRENO_CL_COMPILER_TYPE`
  exists anywhere — all consumption is `==` comparison, so no unhandled-case
  hazard.

### B3. All consumers handle UNKNOWN_COMPILER equivalently — CONFIRMED, with one deliberate divergence
Old default for unrecognized strings was `{E031, −1, −1, −1}`; new is
`{UNKNOWN_COMPILER, −1, −1, −1}`. Consumer-by-consumer:
- q4_0 1D skip gates `:2010-2011`, `:2030-2031`: old `type==DX`=false → skip
  decided by `!newer_than_or_same(E031,38,11,0)` = true; new identical outcome.
- `has_vector_subgroup_broadcast` `:6018-6019`: old `(E031 && −1>=47)`=false;
  new false. Identical.
- `use_adreno_kernels` threshold bump `:7194-7195`:
  `!newer_than_or_same(...) && type != DX` — old true&&true, new true&&true.
  Identical.
- q6 gate `:6029`: **behavior change** for the hypothetical case "Adreno device
  whose driver string matches neither E031 nor DX": old → workaround ON;
  new → OFF. This is the declared intent (explicit honesty over guessing), and
  every documented Adreno driver string parses as E031/DX. Accepted design
  choice; logged here so nobody rediscovers it as a surprise. Verdict:
  PLAUSIBLE residual risk on undocumented future compilers, deliberately taken.

## Commit 3: 0ea21aead — empty MoE dispatch skip

### C1. Coverage of the 10 MoE kernels — CONFIRMED (single choke point)
Guard at `ggml-opencl.cpp:22091-22094` (`src0->ne[1] == 0` early return) sits
at the top of `ggml_cl_mul_mat_id` (`:22077`), which extends past `:24200` with
no intervening function definition — every MoE dispatch flows through it. All
ten q2..q6 GEMV/GEMM selection sites enumerated inside it:
- Q4_K gemv/gemm `:23055` / `:23115`
- Q5_K gemv/gemm `:23257` / `:23318`
- Q6_K gemv/gemm `:23453` / `:23505`
- Q2_K gemv/gemm `:23629` / `:23677`
- Q3_K gemv/gemm `:23777` / `:23827`
Bonus: the mxfp4/q4_0/q4_1/q5_0/q5_1 MoE variants take the same path, so the
guard covers more than the claimed ten.

### C2. Crash class is real — CONFIRMED
Kernel-side clamps use unsigned `ne01 - 1u` (e.g.
`gemv_moe_q4_k_f32_ns.cl:71-72`, `gemm_moe_q6_k_f32_ns.cl:210-211`; q2/q3
equivalents per context report). With `ne01==0` that underflows to 0xFFFFFFFF →
out-of-bounds padded-row load. Independently, host grids degenerate:
gemv `global_size[0] = ((ne01+63)/64)*64` = 0 (`:23070-23071`) →
CL_INVALID_GLOBAL_WORK_SIZE → CL_CHECK abort; gemm `global_size[1] =
(ne01+63)/64` likewise (`~:23228`). `supports_op` MUL_MAT_ID has no dimension
gate (types + `use_adreno_moe_kernels` + contiguity only), so empty shapes do
reach dispatch. Guard is necessary and correctly placed.

### C3. Side effects skipped by the early return — REFUTED as loss
- Placement: after GGML_ASSERTs only (`:22078-22088`); nothing side-effecting
  precedes the return.
- dst: for `ggml_mul_mat_id`, `dst->ne[0] = src0->ne[1]`, so `ne01==0` ⇒ dst has
  zero elements — nothing to write, no zeroing obligation.
- `enqueue_ndrange_kernel` (`:1009-1024`) does enqueue + optional profiling +
  one-time kernel logging only; no per-tensor event bookkeeping a caller depends
  on.
- Router-reorder state (`moe_router_reoerder`, `toggle_reorder`) lives inside
  the gemm branches, unreachable when the guard fires; no state skew.

### C4. Sibling emptiness dims — PLAUSIBLE (noted, out of scope)
Same crash class exists for other empty dims NOT covered by this guard:
- `src1->ne[1] == 0` (ne11): sub-buffer/image regions sized
  `ne10*ne11*ne12*sizeof(float)` → `clCreateSubBuffer` with size 0 →
  CL_INVALID_VALUE abort.
- `src2` expert-id count `ne20 == 0`: gemv grid `global_size[2] = ne20`
  (`:23073-23074`) → global size 0 enqueue abort.
Both require upstream slicing ops producing empty tensors, same likelihood
class as ne01==0. Recommend a follow-up item, not a blocker for this commit
(its stated scope was ne01).

---

## History hygiene — CONFIRMED VIOLATION (the one finding that matters)

Requirement: the accidentally-committed report must be gone from ALL three
commits' trees.

- `git ls-tree d5e7ce8c4` contains `scratchpad/agents/q17-fixes/REPORT.md` ✗
- `git ls-tree 0d3f2fa66` contains it ✗
- `git ls-tree 0ea21aead` (head): absent ✓ (deleted in 0ea21aead, `+6/−26`)
- Exactly 3 commits over `c77fe1354` ✓; working tree clean ✓.
- Code hunks: `d5` +1 line; `0d` +7/−2 (enum/default/comment/fallback only);
  `0e` +6 (guard only). Range diffstat (+14/−2, one file) reconciles exactly —
  no unrelated hunks in any commit ✓.

So: two of three commits carry a stray scratchpad file. Worse, the snapshots
are internally inconsistent — d5e7ce8c4's copy says "Not yet applied" for Fixes
B/C and "build pending"; 0d3f2fa66's copy names `ADRENO_CL_COMPILER_TYPE::UNKNOWN`
while its own code defines `UNKNOWN_COMPILER`. Sloppy staging, fossilized in
history.

Exact fix (branch is local-only by design, rewrite is safe):
```
git rebase -i c77fe1354
# mark all three `edit`; in each:
git rm --cached scratchpad/agents/q17-fixes/REPORT.md   # d5, 0d only
git commit --amend --no-edit && git rebase --continue
```
Or simpler: `git rebase -i c77fe1354` with drops/rewords so the file never
exists before the final commit — net tree at head is unchanged either way
(head already lacks the file).

## Verdict summary

| # | Finding | Verdict |
|---|---------|---------|
| A1 | Gate pattern parity | REFUTED as defect (parity holds) |
| A2 | S23/E031.41.03.62 changed | REFUTED (TRUE→TRUE) |
| A3 | Non-Adreno now false/fast path | CONFIRMED fixed (was perf-only) |
| A4 | Build/dispatch mismatch on flag flip | REFUTED (single flag, both sites) |
| A5 | Init ordering (family→gate→build→dispatch) | CONFIRMED safe (:5984→:6027→:2243@:11793→:20961) |
| B1 | Existing E031/DX classifications changed | REFUTED (paths byte-identical) |
| B2 | Missed UNKNOWN rename / shadowing | REFUTED (rename mandatory; grep clean) |
| B3 | Consumer equivalence incl. UNKNOWN_COMPILER | CONFIRMED (one deliberate q6-gate divergence on hypothetical unknown-string Adreno) |
| C1 | ne01==0 covers all 10 dispatch paths | CONFIRMED (one choke point, sites enumerated) |
| C2 | Underflow/OOB crash class real | CONFIRMED (kernel clamp + zero grid) |
| C3 | Required side effects skipped | REFUTED (none exist) |
| C4 | ne11==0 / ne20==0 same crash class | PLAUSIBLE residual (out of scope, follow-up) |
| H1 | Stray report gone from ALL trees | **CONFIRMED FAILED** (present in d5e7ce8c4, 0d3f2fa66) |
| H2 | Exactly 3 commits, no unrelated hunks | REFUTED as violation (clean) |

Code: all three fixes are correct, minimal, and provably ordered. History: the
stray-file criterion is explicitly and verifiably failed in two of three trees.
Since the branch is local-only, the remedy is a two-minute interactive rebase;
do it before this lands anywhere permanent.

## Final: **BLOCK**
Sole blocker: H1 — `scratchpad/agents/q17-fixes/REPORT.md` exists in the
d5e7ce8c4 and 0d3f2fa66 trees. Apply the rebase above (drop the file from those
two commits; head tree already clean), re-run `git log --stat c77fe1354..HEAD`
to confirm zero non-code files, then BANK. No code changes required.
