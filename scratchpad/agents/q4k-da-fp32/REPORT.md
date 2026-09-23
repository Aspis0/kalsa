# REPORT - q4k-da-fp32: KALSA_Q8A_SCALE carries the dense q4_K activation block scale in f32

Status: COMPLETE - change built and gated, committed, Android + native builds done (rc=0),
seven standing targets run, reported. Nothing pushed, nothing tagged, no upstream, no
phone contact, no PR (the push block in section 12 is UNRUN).

Boundaries held: no push, no tag, no upstream, no PR, no phone/adb contact. Shared
checkout `/Users/marco/Projects/kalsallama` read only - `git status --porcelain=v1`
snapshotted before the session and re-checked after (`/tmp/q4k-da-fp32/
shared-status-{before,after}.txt`, 12 lines both, diff rc=0). Own worktree
`/Users/marco/Projects/kalsallama-wt-phone-engine-v2`, detached, worked on top of
`f0811bd315eee844bfac10206b50480668d231a7` as instructed.

Why this build exists: probe **Z2** (`GGML_OPENCL_Q4K_DENSE_DP4A=1`, stock env) returned
KLD 5.103422 and was pre-registered as ambiguous because the forced q4_K path brings the
fp16 activation scales alive. The subscale commit `f0811bd31` put `sa` behind
`KALSA_Q8A_SUBSCALE`, but its section 1.4 found that on the q4_K path **`da` is still
fp16**: `KALSA_Q8A_SCALE` selects the f32 quantiser only at the q6_K site, the q4_K site
takes the unflagged build, and the q4_K consumer hardwires `__global const half
*src1_da`. This commit wires `da` to f32 on the q4_K site through that same selector, so
the phone's attribution arm (`KALSA_Q8A_SCALE=fp32 KALSA_Q8A_SUBSCALE=fp32`) removes
both fp16 activation scales on the path under test.

## 1. Inventory (written BEFORE any code changed, line numbers at `f0811bd31`)

- Selector `kalsa_q8a_scale_f32()` `:1576-1589`, returns **true (fp32) for unset and
  empty**, false only for exact `fp16`, error + `exit(1)` otherwise. Introduced that way
  by `e1cfb60f7` (verified via `git log -L`: no later edit). Sibling
  `kalsa_q8a_subscale_f32()` `:1594`, defaults false (fp16).
- Writer `kernels/quant_a_q8_1.cl` already carries `q8a_t` under
  `-DKALSA_Q8A_SCALE_F32` (the e1cfb60f7 promotion) - **untouched by this task**.
- Consumer `kernels/gemm_noshuffle_q4_k_q8_1_dp4a.cl` at `f0811bd31`: `src1_da` typed
  `half` at `:62`/`:178` (plain + `_wimg`), staged through `__local half sh_d` at
  `:96`/`:216`, `(half)0` fallback at `:142`/`:256`. The `q8s_t` typedef block (from
  `f0811bd31`) sat alone at `:13-19`.
- Host build blocks: q4_K consumer section `:4516-4540` (base + subscale-gated build),
  quantiser section `:4610-4633` (base + scale-gated `_f32` + subscale-gated `_subf32` +
  the two WARN lines). Handles `:1265-1268` (q4_K consumer pair + `subf32` pair),
  `:1273-1275` (`kernel_quant_a_q8_1`, `_f32`, `_subf32`).
- q4_K dispatch site `:22899-22941`: `q8s_f32` bool `:22901`, `prealloc_moe_da` hardcoded
  `n_blocks * sizeof(cl_half)` `:22902`, writer pick (subscale-only ternary) `:22906`,
  consumer pick `:22937-22941`.
- q6_K site (the existing SCALE shape, the contract) `:23301-23317`: `q8a_f32` bool,
  `da` alloc sized by arm, writer pick, consumer pick.
- Every other dense site (q4_0 `:20966`, q5_0 `:21411`, iq4_nl `:21858`, q8_0 `:22174`,
  q5_K `:23640`) and all 7 MoE sites: read `da`, keep base writer + base consumer +
  half alloc - deliberately out of scope.

Structural finding that decided the shape of the change: the writer writes **both** `da`
and `sa`, and the consumer reads **both**. This is the first site where both selectors
are consulted, and the task's treatment arm sets both envs, so four env states exist at
this site: {} (SCALE=fp16), {SCALE} (SCALE unset/empty/fp32, subscale off - **the
default state**), {SUBSCALE} (the predecessor's twin), {SCALE+SUBSCALE} (this task's
treatment). Each state needs a writer build and a consumer build whose typedefs agree
with it; only {} and {SUBSCALE} existed. See section 4 for the stop-clause adjudication.

## 2. The change as built - commit `e64352ac17abc1bc4c012e77e9a8b92ae4dfd374`

Stack: `1577495b9` (ship) -> `f0811bd31` (subscale, predecessor) -> `e64352ac1` (this),
detached, worktree clean after (`git status --porcelain` = 0 lines).
`git rev-list --count HEAD` = **11203** (was 11202). ASCII check on the diff: 0
non-ASCII lines.

`git show --stat`:

```
 ggml/src/ggml-opencl/ggml-opencl.cpp               | 41 ++++++++++++++++++++--
 .../kernels/gemm_noshuffle_q4_k_q8_1_dp4a.cl       | 20 +++++++----
 2 files changed, 52 insertions(+), 9 deletions(-)
```

Diff scope = the q4_K consumer kernel + its host wiring, nothing else:

| file | what changed |
|---|---|
| `kernels/gemm_noshuffle_q4_k_q8_1_dp4a.cl` | `q8a_t` typedef block under `-DKALSA_Q8A_SCALE_F32` (same shape as the q6_K consumer's), `src1_da` signature x2, `__local sh_d` staging x2, `(q8a_t)0` fallback x2 - exactly the 3-token-per-entry-point pattern the predecessor used for `sa` |
| `ggml/src/ggml-opencl/ggml-opencl.cpp` | 5 new `cl_kernel` handles (all `= nullptr`, next to their base handles): q4_K consumer `_f32`/`_wimg_f32`, q4_K consumer `_f32_subf32`/`_wimg_f32_subf32`, writer `_f32_subf32`; 3 new gated program builds in `load_cl_kernels` (q4_K GEMM with `KALSA_Q8A_SCALE_F32`, q4_K GEMM with both flags, quantiser with both flags - same block shape as the existing subscale/scale blocks, programs released after `clCreateKernel`); at the q4_K dispatch site: `q8a_f32` bool, `prealloc_moe_da` element size by arm, 4-way writer pick, 4-way consumer pick (plain/wimg inside each arm) |

Deliberately untouched: `kalsa_q8a_scale_f32()` and `kalsa_q8a_subscale_f32()`
(zero hunks inside either function); `quant_a_q8_1.cl` (already has `q8a_t`; the writer's
`{SCALE}` build already exists as `kernel_quant_a_q8_1_f32` and is reused at this site);
the WARN lines (both arms already printed); every other dispatch site; all MoE code.

Writer picks at the q4_K site by state (writer must emit `da`/`sa` in the types the
consumer will read):

| state | writer kernel | how |
|---|---|---|
| {} | `kernel_quant_a_q8_1` | existing |
| {SCALE} | `kernel_quant_a_q8_1_f32` | existing handle (same source, same `compile_opts` + one flag; built once, shared with q6_K) |
| {SUBSCALE} | `kernel_quant_a_q8_1_subf32` | existing |
| {SCALE+SUBSCALE} | `kernel_quant_a_q8_1_f32_subf32` | new build (both flags) |

Buffer-safety note for `prealloc_moe_da` (the predecessor's §2.2 / opencl-q8 §2.2
argument, applied to the same grow-only buffer `ggml_cl_buffer::allocate`): each dispatch
site allocates, then its own writer overwrites the whole `n_blocks` region it will read,
then its own consumer reads exactly that region, all on one in-order queue before any
other site runs, and the da buffer is never read back to the host. fp32-then-fp16 reuses
the oversized buffer and rewrites it as halves; fp16-then-fp32 sees `4n > 2n` and
reallocs. Both orderings safe; the other 6 dense sites and all MoE sites keep
writer/consumer/alloc all-half, bit-identical to the base.

## 3. Selector truth tables (harness: both functions awk-extracted from the file bytes,
compiled with `c++ -std=c++17`, fresh process per env value; logs
`/tmp/q4k-da-fp32/sel/`)

Byte-compare of the extracted functions, working tree vs committed bases:

| extraction | cmp rc | lines |
|---|---|---|
| `kalsa_q8a_scale_f32` WT vs `f0811bd31` | **0** | 14 |
| `kalsa_q8a_scale_f32` WT vs `1577495b9` | **0** | 14 |
| `kalsa_q8a_subscale_f32` WT vs `f0811bd31` | **0** | 14 |

(the subscale selector was born in `f0811bd31`, so its base is that commit; it does not
exist at `1577495b9`.)

### `KALSA_Q8A_SCALE` (the `da` selector) - UNTOUCHED, returns its old behaviour

| `KALSA_Q8A_SCALE` (subscale held unset) | returns | arm |
|---|---|---|
| unset | 1 | **fp32 - the selector's shipped default since `e1cfb60f7`, unchanged** |
| `""` (empty) | 1 | fp32 (unchanged) |
| `fp16` | 0 | fp16 (unchanged) = the stock half arm |
| `fp32` | 1 | fp32 |
| `bogus` | rc=1 | `ggml_opencl: unrecognized KALSA_Q8A_SCALE='bogus' (use fp32\|fp16)`, `exit(1)` (unchanged) |
| `FP32` (wrong case) | rc=1 | same rejection (unchanged) |

### `KALSA_Q8A_SUBSCALE` (the `sa` selector) - UNTOUCHED

| `KALSA_Q8A_SUBSCALE` (scale held unset) | returns | arm |
|---|---|---|
| unset | 0 | **fp16 = the shipped default (unchanged)** |
| `""` | 0 | fp16 (unchanged) |
| `fp16` | 0 | fp16 (unchanged) |
| `fp32` | 1 | fp32 |
| `bogus` | rc=1 | `unrecognized KALSA_Q8A_SUBSCALE='bogus' (use fp16\|fp32)`, `exit(1)` |
| `FP32` | rc=1 | same rejection |

### Cross combinations - the two selectors do not interfere

| SCALE x SUBSCALE | scale | subscale | q4_K site program state |
|---|---|---|---|
| unset x unset (default) | 1 | 0 | {SCALE} - see section 6 |
| empty x empty | 1 | 0 | {SCALE} |
| fp16 x unset | 0 | 0 | {} = exactly the base kernel pair |
| fp16 x fp16 | 0 | 0 | {} |
| fp32 x fp16 | 1 | 0 | {SCALE} |
| unset x fp32 | 1 | 1 | {SCALE+SUBSCALE} |
| fp32 x fp32 (treatment arm) | 1 | 1 | {SCALE+SUBSCALE} |
| fp16 x fp32 | 0 | 1 | {SUBSCALE} = the predecessor's twin, bit-exact |

Non-interference proven two ways: (1) source - each function getenv's only its own name
(`scale-wt.inc`: `getenv("KALSA_Q8A_SCALE")`; `subscale-wt.inc`:
`getenv("KALSA_Q8A_SUBSCALE")`, grep output in the session); (2) table - each column
changes only when its own env changes, across all rows. Each function caches its own
`static const bool`, no cross-read.

Log note: `/tmp/q4k-da-fp32/sel/truth-table.txt` contains 4 superseded rows with rc=127
from a harness invocation bug (macOS `env` requires `-u` before assignments); the
corrected rows are appended and marked `FIX:`. All values in the tables above are from
rc=0/rc=1 harness runs, not assertions.

## 4. Size vs the "~3-line" estimate - stop-clause adjudication, stated not hidden

The task carried the predecessor's estimate ("~3-line change of the same shape") with a
stop condition ("if structurally larger, stop and report why rather than improvising - the
shape of the existing selector is the contract"). What was built: **52 insertions, 9
deletions, 2 files**. Adjudication, so the owner can overrule:

- The change stayed inside the selector's shape: typedef-behind-`-DKALSA_Q8A_SCALE_F32`
  in the `.cl`, gated extra program builds in `load_cl_kernels`, arm-picked
  alloc/writer/consumer at the dispatch site, selector function byte-identical. No new
  gating, no new env, no third selector, no change to any existing selector's returns.
- The line count overran the estimate for three reasons the estimate did not count:
  (1) the consumer hardwires `src1_da`, so a flagged program build + handles are
  mandatory (the q6_K precedent needed these too); (2) **both selectors act at this site
  for the first time**, so 4 env states x {writer, consumer} need programs that agree
  with their types - 2 new consumer programs, 1 new combined writer program, 5 new
  handles, and the picks become 4-way instead of 2-way; (3) `prealloc_moe_da` must be
  sized by arm (the q6_K site does the same line).
- The combination builds are not improvisation: the task's own treatment arm
  (`KALSA_Q8A_SCALE=fp32 KALSA_Q8A_SUBSCALE=fp32`) requires a writer and consumer built
  with both flags; no existing build carries both, and the alternative (changing a
  selector's default to avoid the combination) would have violated the contract outright.
- If the owner rules the 4-state matrix "structurally larger" after all: the commit is
  `e64352ac1`, unpushed, one `git reset --hard f0811bd31` reverts the worktree; nothing
  was published anywhere.

## 5. The default arm reproduces the committed configuration - machine proof

House standard form: touched `.cl` compiled to LLVM IR at `-O2` for `spirv64` (NDK r29
clang 21, `-x cl -cl-std=CL3.0 -Xclang -finclude-default-header -target spirv64
-O2 -S -emit-llvm`), define OFF, filename normalised (each side compiled from its own
directory under the identical basename), diffed whole-file against the blob committed at
`1577495b9`. Logs `/tmp/q4k-da-fp32/ir/`.

**5.1 Whole-file diff, define OFF vs `1577495b9` (2616 diff lines), classified machine
line-by-line.** After stripping every trailing metadata reference from instruction lines,
the diff shrinks to 44 lines: **0 instruction-assignment lines**, 4 `define` lines, 34
metadata-node-definition lines, 3 diff markers. Stated explicitly, because this is the
property that makes a selector trustworthy:

- **No instruction, no IR type, no function parameter differs.** The two `define`
  lines have byte-identical parameter lists and differ only in metadata-ID references
  (`!kernel_arg_base_type !6` -> `!7`), i.e. OpenCL arg metadata.
- The node-definition lines are: the **OpenCL kernel-argument type-name metadata**
  (`!"half*"` -> `!"q8a_t*"` for `src1_da` from this task, `!"half*"` -> `!"q8s_t*"`
  for `src1_sa` from the already-committed `f0811bd31`, once per entry point); the
  knock-on of that rename: `!kernel_arg_type` (`q8a_t*`) and `!kernel_arg_base_type`
  (`half*`, the typedef unwound) no longer deduplicate to one node, so one extra node per
  entry point appears (+2 nodes); and the consequent **pure ID renumbering** of the
  following metadata nodes (TBAA `!8`->`!9` etc.). The renumbered node contents are
  identical on both sides (verified: `!"half"`, `!"omnipotent char"`,
  `!"Simple C/C++ TBAA"` present in both), and every instruction line that "differs"
  differs only in which now-identical node it points at.
- So the difference IS OpenCL arg-type name metadata plus its metadata-ID renumbering -
  a typedef spelling in a metadata string is the entire delta; the compiled kernel is
  the same kernel. The renumbering is called out explicitly because it makes the raw
  diff large even though the code delta is zero.

**5.2 My delta alone, define OFF vs `f0811bd31` (my immediate base): 8 diff lines = 2
changed lines, whole file.** Both are the arg-type name list of one entry point:

```
!6  = !{... !"uint*", !"half*",    !"q8s_t*", ...}   ->   !"q8a_t*", !"q8s_t*"
!21 = !{... !"uint*", !"half*",    !"q8s_t*", ...}   ->   !"q8a_t*", !"q8s_t*"
```

Zero other lines. This is the "only difference is OpenCL arg-type name metadata" result
in its exact form for this task.

**5.3 Host side: the selector returns the old behaviour for unset/empty/fp16.** Proven
two ways: (1) byte-compare of the extracted function, working tree vs `f0811bd31` and vs
`1577495b9`: **rc=0, 14 lines, byte-identical** (section 3); (2) truth table: unset -> 1,
empty -> 1, fp16 -> 0 - exactly the values it returned before this commit. Zero hunks
inside `kalsa_q8a_scale_f32()` and `kalsa_q8a_subscale_f32()` in `git show e64352ac1`.

**5.4 Site-level effect of the (unchanged) host default - read this before benching
(section 6 gives the full matrix).** `KALSA_Q8A_SCALE` unset returns fp32; before this
commit the q4_K site ignored that return, now it honours it. Consequences, all
deliberate consequences of the contract (reuse the selector, change nothing in it):

- The ship-default run on the bench phone (Adreno 740, not X2E) never enters the q4_K
  dp4a site (`q4k_dense_dp4a_on` defaults to `adreno_gen == X2E` only - that is why Z2
  had to force it), so **no ship-default digit can move**: every line changed by this
  commit is unreachable in that run, and all other sites' picks are untouched.
- The fp16 arm of the touched kernel still exists, bit-exact, selectable with
  `KALSA_Q8A_SCALE=fp16` (5.1/5.2 prove the arm is the committed kernel).
- **The one behaviour change under unset env: a run that forces the q4_K dp4a path with
  stock KALSA env now runs `da` fp32 (selector default), `sa` fp16.** Z2's historical
  control was taken with `da` fp16. To reproduce Z2's exact fp16/fp16 arm on THIS
  binary, set `KALSA_Q8A_SCALE=fp16` explicitly (truth-table row `fp16 x fp16` ->
  state {} -> base kernels, bit-exact old path). The two WARN lines at load record which
  arm ran.

**5.5 Treatment arm sanity (define ON vs OFF, same file):** the IR shows the intended
change and nothing else - `load half, align 2` -> `load float, align 4` at `src1_da`,
`store half, align 2` -> `store float, align 4` at the staging fallback (4 such stores,
and the `(half)0` -> `(q8a_t)0` sites), the `sh_d` `fpext <4 x half>` conversions
disappear (float already), while the `sh_s` half chain keeps its `fpext` - `sa` stays
half in the SCALE-only arm, as designed. Arg metadata shows `!"float*"` at the `src1_da`
position.

## 6. Site-level arm matrix (both selectors at the q4_K dispatch site)

| env state | da arm | sa arm | writer/consumer builds picked |
|---|---|---|---|
| `KALSA_Q8A_SCALE=fp16`, subscale off | fp16 | fp16 | base pair (bit-exact pre-change path = Z2's control) |
| subscale off, SCALE unset/empty/`fp32` (default) | **fp32** | fp16 | `{SCALE}` pair (new consumer build; existing `_f32` writer) |
| `KALSA_Q8A_SUBSCALE=fp32`, `KALSA_Q8A_SCALE=fp16` | fp16 | fp32 | `{SUBSCALE}` pair = predecessor's twin, bit-exact |
| both `fp32` (the phone's attribution arm) | **fp32** | **fp32** | `{SCALE+SUBSCALE}` pair (new) |

Sites where `da` stays fp16 under ALL envs (unchanged, out of scope): q4_0, q5_0,
iq4_nl, q8_0, q5_K dense, all 7 MoE. `KALSA_Q8A_SCALE` now acts at exactly two sites:
q6_K (as shipped) and q4_K (this commit).

## 7. Syntax gate (NDK clang `-fsyntax-only`, spirv64, both arms + both blobs)

Log `/tmp/q4k-da-fp32/syntax-gate.txt`; only warnings are the stock `qcom_wave_pair_mode`
/ ignored-pragma notes, present in the untouched blob too.

| file / variant | rc |
|---|---|
| q4_K GEMM, blob `1577495b9` | 0 |
| q4_K GEMM, blob `f0811bd31` | 0 |
| q4_K GEMM, new, no defines | 0 |
| q4_K GEMM, new, `-DKALSA_Q8A_SCALE_F32` | 0 |
| q4_K GEMM, new, `-DKALSA_Q8A_SUBSCALE_F32` | 0 |
| q4_K GEMM, new, both flags (treatment) | 0 |
| quantiser, no defines / SCALE / SUBSCALE / both | 0 / 0 / 0 / 0 |

10/10 rc=0.

## 8. Load discipline (owner rule adopted tonight)

Rule as ordered: `ninja -j 3` cap, configure single-threaded, and before every heavy
phase check `pgrep -fl 'ninja|ld.lld|clang++|gradle'` and `uptime`; if another build runs
or load > ~30, wait and record what was waited for. What happened:

- macOS `pgrep` quirks found and worked around: the literal alternation form is rejected
  (`Cannot compile regular expression ... rc=2`), `-E` does not exist, and `clang++` is
  rejected as a pattern (`repetition-operator operand invalid`). Working form used for
  every check: a loop of `pgrep -fl ninja`, `pgrep -fl 'ld.lld'`, `pgrep -fl gradle`,
  `pgrep -fl clang`.
- Check 1, 23:17 (before editing/gates): no matches, load **3.42 / 5.69 / 10.55**.
- Check 2, 23:26:03 (before Android configure+build): no matches, load **5.11 / 9.00 /
  10.52**.
- Check 3, 23:27:51 (before native configure+build): no matches, load **5.09 / 7.77 /
  9.84**.
- **Waited for: nothing** - no other build was running and load never approached 30 at
  any check. All three heavy phases started immediately after their check; both builds
  and both configures ran at the capped/single-threaded settings.

## 9. Native build (standing config) + the seven standing targets

- Configure (standing config re-run AFTER the commit: Release, `GGML_METAL=OFF`,
  `GGML_OPENCL=OFF`, `GGML_BLAS=ON`, Ninja, in-tree `build/`): **rc=0**
  (`/tmp/q4k-da-fp32/native-configure.log`), stamp **`-- ggml commit: e64352ac1`**.
- `ninja -C build -j 3`: **rc=0, 139/139 steps** (`/tmp/q4k-da-fp32/native-build.log`).
  The single line matching `error` is the known configure-time UI message
  (`-- UI: download dist.tar.gz.sha256 from b11203 failed: "HTTP response code said
  error"`), not a compile error.
- Fixture: symlink intact -> shared checkout, 19,077,344 bytes, sha256
  `66967fbece6dbe97886593fdbb73589584927e29119ec31f08090732d1861739` (same bytes as the
  predecessor's session), so the standing invocation `-m
  build/tinyllamas/stories15M-q4_0.gguf` ran verbatim. Runs from the worktree root, real
  `$?`, logs `/tmp/q4k-da-fp32/targets/`:

| # | target | invocation | exit |
|---|---|---|---|
| 1 | test-governor-v0 | `-m` fixture | **0** |
| 2 | test-governor-v0-commit | `-m` fixture | **0** |
| 3 | test-governor-v0-devices | `-m` fixture | **77** |
| 4 | test-governor-v0-hybrid | no `-m` (takes none) | **77** |
| 5 | test-governor-v0-shared-cells | `-m` fixture | **0** |
| 6 | test-governor-v0-turns | `-m` fixture | **0** |
| 7 | test-governor-v02-router | no `-m` (takes none) | **0** |

Seven counts: **0 0 77 77 0 0 0** - the standing sequence, identical to
`../phone-engine-v2/REPORT.md`, `../phone-line-prep/REPORT.md`, `../release-prep/REPORT.md`,
`../q8a-subscale/REPORT.md`. `grep -c FAIL` = 0 in all seven logs. The 77s print their
registered skip reasons (`governor-devices: SKIP no GPU backend available (exit 77)` -
METAL=OFF/OPENCL=OFF build; `governor-hybrid: SKIP KALSA_HYBRID_GGUF is unset (exit
77)`). Pass markers present (`governor_v0_token_check=PASS (8 tokens)`,
`governor_v0_turns=PASS turns=3 generated=18 ...`, `governor_chunked_prefill=PASS`, ...).

## 10. Android arm64 build (llama-perplexity) - configured AFTER the commit

Recipe = `../phone-engine-v2/REPORT.md` §5 line by line (`BUILD_SHARED_LIBS=OFF` or the
link dies on `AHardwareBuffer_*`; the two explicit OpenCL paths the NDK re-roots), own
build dir `build-android-ocl-q4k-da-fp32`, configure single-threaded after the load
check (section 8), `ninja -j 3`.

- **Configure rc=0** (23:26:13 -> 23:26:16, `/tmp/q4k-da-fp32/android-configure.log`).
  Summary: `-- Including CPU backend`, `-- Including OpenCL backend`, **`-- ggml commit:
  e64352ac1`** (after the commit). Cache verified: `BUILD_SHARED_LIBS:BOOL=OFF`,
  `GGML_OPENCL:BOOL=ON`, `GGML_OPENCL_EMBED_KERNELS:BOOL=ON`,
  `OpenCL_INCLUDE_DIR:PATH=.../android-prefix/include`,
  `OpenCL_LIBRARY:FILEPATH=.../android-prefix/lib/libOpenCL.so`.
- **ninja rc=0, 329/329 steps** (23:26:27 -> 23:27:41,
  `/tmp/q4k-da-fp32/android-build.log`), **0 lines matching `error`**. Final lines:
  `[328/329] Linking CXX static library tools/perplexity/libllama-perplexity-impl.a`,
  `[329/329] Linking CXX executable bin/llama-perplexity`. This build compiled
  `ggml-opencl.cpp` (OPENCL=ON), so it is also the host-side compile gate for the edit.
- **Embedded commit string / build number**
  (`build-android-ocl-q4k-da-fp32/common/build-info.cpp`, re-checked against git):

```
int LLAMA_BUILD_NUMBER = 11203;        (== git rev-list --count HEAD)
char const * LLAMA_COMMIT = "e64352ac1";
char const * LLAMA_COMPILER = "Clang 21.0.0";
char const * LLAMA_BUILD_TARGET = "Android aarch64";
-> runtime: version: <llama_version()> (build 11203, commit e64352ac1)
```

  `strings` exact-match counts inside the ELF: `e64352ac1` = **1**,
  `f0811bd31` = 0, `1577495b9` = 0, `d75422944` = 0. Selector strings present:
  `unrecognized KALSA_Q8A_SCALE` = 1, `unrecognized KALSA_Q8A_SUBSCALE` = 1,
  `q8_1 activation scale` = 1 (the WARN format string).
- **sha256 of the binary (for the phone's attribution arm):**

```
11a63af4463f2233c3178cf0c4f4e6423cfdc235e6773f8be097de6b6801b250  build-android-ocl-q4k-da-fp32/bin/llama-perplexity
```

  size 119,923,112 bytes; `file`: `ELF 64-bit LSB pie executable, ARM aarch64 ...
interpreter /system/bin/linker64`, BuildID `13dc77d08aa33549865e6b52aab7e6dc73646bff`
(not runnable on this Mac - all evidence read from the artifacts).
- Which arm ran is recorded in stderr at load, two WARN lines (unchanged from
  `f0811bd31`, survive the bench stderr filter):
  `ggml_opencl: q8_1 activation scale: fp16|fp32 (KALSA_Q8A_SCALE)` and
  `ggml_opencl: q8_1 activation subscale: fp16|fp32 (KALSA_Q8A_SUBSCALE)`.

Suggested arms on the phone (same binary):

```sh
# treatment (the tasked attribution arm): both activation scales fp32 on the forced path
GGML_OPENCL_Q4K_DENSE_DP4A=1 KALSA_Q8A_SCALE=fp32 KALSA_Q8A_SUBSCALE=fp32 ./llama-perplexity ...

# control reproducing Z2's fp16/fp16 arm bit-exactly on THIS binary
# (required: with both selectors unset, the forced path now runs da fp32 per the
#  selector's shipped default - see section 5.4)
GGML_OPENCL_Q4K_DENSE_DP4A=1 KALSA_Q8A_SCALE=fp16 KALSA_Q8A_SUBSCALE=fp16 ./llama-perplexity ...
```

Baseline: `../s23-kld-740-q4-0/REPORT.md` §27.1 (Z2 = KLD 5.103422 / PPL 2556.19 /
same-top 12.373 %) with its pre-registered thresholds; §23 ship-default 0.005412.

## 11. What this build settles, and what it does not

Settles:
1. The `da` leg of the section 1.4 finding is removed: on the q4_K path `KALSA_Q8A_SCALE`
   now selects the writer, the consumer, and the buffer element size, so the treatment
   arm removes both fp16 activation scales in one binary, one env pair, both arms logged
   at load.
2. The default does not move a digit where a digit could move: define-off IR is the
   committed kernel (arg-type name metadata + its ID renumbering only, zero
   instructions), both selectors return their old behaviour for unset/empty/fp16
   (byte-identical functions), every non-q4_K site is untouched, and the bench device's
   ship-default run cannot enter the changed site. The seven standing targets reproduce
   `0 0 77 77 0 0 0`.
3. The two selectors do not interfere (source + cross table), and all four env states at
   the site map to a type-consistent writer/consumer pair, each gated build syntax-checked.

Does NOT settle (owner's to decide, stated not hidden):
1. **The forced-path default under unset env changed from fp16 to fp32 `da`** (section
   5.4): an unavoidable consequence of reusing a selector whose shipped default is fp32;
   the Z2-exact control on this binary needs explicit `KALSA_Q8A_SCALE=fp16`. If the
   owner wants the q4_K site's unset default to stay fp16, that needs either a selector
   semantic change (which would move the shipped q6_K default back to the fp16 defect -
   not done, not proposed) or a site-level env distinction (a second gate, outside the
   contract) - a decision, not a coding gap.
2. The estimate I was handed was ~3 lines; the delivered change is 52+/9- for the
   reasons in section 4. If that reads as "structurally larger", the revert path is one
   command and nothing was pushed.
3. No on-device number was taken by this cell (no `adb`, no device contact).
4. `da` on q4_0/q5_0/q5_K/iq4/q8_0/MoE stays fp16 under all envs (out of scope), and
   the 32-vs-256 activation grid (`../opencl-q8-activation-scale/REPORT.md` §3.1) is
   untouched - a treatment-arm recovery would name the two scale FTZ legs, not the grid;
   a non-recovery leaves the grid and the scheme mismatch standing.

## 12. Boundaries: tip sha, refs, and the push command - UNRUN

Tip: **`e64352ac17abc1bc4c012e77e9a8b92ae4dfd374`** (detached HEAD of
`/Users/marco/Projects/kalsallama-wt-phone-engine-v2`, two commits above the shipped tip):

```
e64352ac17  this: KALSA_Q8A_SCALE ... dense q4_K path   <- tip (new, unpushed)
f0811bd315  subscale (predecessor, unpushed by them too)
1577495b92  ship tip (unchanged, still the remote phone ref)
e1cfb60f71  KALSA_Q8A_SCALE ... f32 (the original da pick)
```

- `git merge-base --is-ancestor 1577495b92096... HEAD` holds (linear stack, log shows
  the three commits in order), so the push below would be a fast-forward - no force, no
  lease.
- Worktree clean after everything: `git status --porcelain` = **0 lines**.
- `git rev-parse @{upstream}` = `fatal: HEAD does not point to a branch` (rc=128) - no
  branch, no upstream. `git tag --points-at HEAD` = empty; no `git tag` was ever run.
- Shared checkout untouched: status before vs after, **diff rc=0, 12 lines both**.
- Read-only `git ls-remote origin` this session: `refs/heads/kalsa-phone-v1-1-1` =
  `1577495b92096fca572f57a35b71607bacac85d5` (unchanged),
  `refs/heads/kalsa-release-v1-1-1` = `a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b5`,
  `refs/tags/kalsa-server-v1.1.1` = `0f1b3bec7342ddd5624dc474c760a0b38bc80b5b` -
  all three exactly the values the predecessor recorded; nothing moved. No `git fetch`
  was run.

**NONE of the block below was executed:**

```sh
# push the new line onto the phone branch (fast-forward 1577495b9 -> e64352ac1)
cd /Users/marco/Projects/kalsallama-wt-phone-engine-v2
git push origin e64352ac17abc1bc4c012e77e9a8b92ae4dfd374:refs/heads/kalsa-phone-v1-1-1
```

```sh
# verify after running (expect the phone ref moved, release refs + tag unchanged)
git ls-remote origin refs/heads/kalsa-phone-v1-1-1 refs/heads/kalsa-release-v1-1-1 refs/tags/kalsa-server-v1.1.1
# expect:
# e64352ac17abc1bc4c012e77e9a8b92ae4dfd374  refs/heads/kalsa-phone-v1-1-1
# a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b5  refs/heads/kalsa-release-v1-1-1
# 0f1b3bec7342ddd5624dc474c760a0b38bc80b5b  refs/tags/kalsa-server-v1.1.1
```

Ref naming and the push itself are the owner's call; no local branch was created or
moved (HEAD detached throughout), and `kalsa-phone-v1-1-1` locally still points at
`d754229443`.
