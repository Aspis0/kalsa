# REPORT - opencl-upload-oom: weight-upload OOM must reach the throw/CPU-fallback channel

Base **`319b539377605f6c572e234b28678b74bd78deb5`**, branch
**`kalsa-opencl-upload-oom-throw`** (declared exception), worktree
`/Users/marco/Projects/kalsallama-wt-oom`, one commit
**`bb8d0323798e5d44cec11d58f226c2cc05247ddd`**, NOT pushed, no tag, no Android
binary built. Source report: `../gpufit-drop-memory-gate/REPORT.md` sections 2
and 5.

## 1. Item 1 (set_tensor aborts) — ALREADY FIXED at the base; audited, nothing to convert

The abort sites the report listed existed at `4ccef2f85` (its traced commit),
which IS an ancestor of this base. Between the two, commit
**`86f602f8ab4709d8b45a18f955f5275f00c6a27a`** (2026-09-21 21:22 EDT, "ggml-opencl
: degrade weight-upload failures to a load error instead of abort") converted
them: it added `throw_set_tensor_upload_error`
(`ggml-opencl/ggml-opencl.cpp:10988-10994`) and guarded the 30 alloc/write sites.
Audit at this base, every real allocation inside
`ggml_backend_opencl_buffer_set_tensor` (`:11027-13068`):

- All 14 `clCreateBuffer`/`clCreateImage` device allocations throw on failure:
  staging `:11061-11064` (F16-class direct), `:12866-12868` (q2_K MoE restore),
  `:12949-12951` (q3_K MoE restore), `:13032-13035` (f16->bf16, COPY_HOST_PTR);
  weight images `:11440-11452,12312-12314,12407-12409,12527-12529`; scale/min
  scratch `:11687-11693,12098-12100,12542-12548`. The ten
  `ggml_cl_create_temp_upload_buffer` callers (Q4_0/Q4_1/Q5_0/Q5_1/MXFP4/Q8_0/
  IQ4_NL/Q4_K/Q5_K/Q6_K) all do `if (!data_device) throw_...` (`:11153-11156` and
  the nine siblings).
- The remaining unguarded `clCreateImage` wrappers (`:11361,11545,11675,11857,
  11991,12020,12713`) are the deliberate F6 soft-fail (`:11362-11365` comment):
  image views over already-allocated subbuffers; on failure the global-memory
  path still works. Not aborts, not in the report's list.
- Every remaining bare `CL_CHECK(err)` in set_tensor guards a
  `clCreateSubBuffer` (`:11083,11092,...,12984` - views into the existing weight
  buffer, no fresh device memory). The `clSetKernelArg`/`clEnqueueNDRangeKernel`/
  `clWaitForEvents` `CL_CHECK`s are not allocation sites and are outside the
  report's list - declared boundary: a device-side OOM during the conversion
  kernel enqueue/execution still aborts there, unchanged. Shape `GGML_ASSERT`s
  (`K % 32 == 0` etc.) are logic invariants, kept.

Compile gate (the channel compiles at this base):
`clang++ -std=c++17 -fsyntax-only -target aarch64-unknown-linux-android28
-DGGML_OPENCL_USE_ADRENO_KERNELS -DGGML_OPENCL_SOA_Q -DGGML_OPENCL_TARGET_VERSION=300
[includes] ggml-opencl.cpp` -> **EXIT=0**, 0 errors
(`/tmp/wq-fp16/syntax-opencl.log`; without the build defines the same file does
not compile, so the defines are load-bearing, not decoration).

## 2. Item 2 (ggml_gallocr_reserve_n) - REAL, fixed

`ggml-backend.cpp:1633` (at this base) ignored `ggml_gallocr_reserve_n`'s return
and called `ggml_gallocr_alloc_graph` at `:1634`. Verified mechanics in
`ggml-alloc.c`: a failed reserve (`ggml_vbuffer_alloc` NULL, `:939-943`) frees
the old buffer FIRST (`:935`) and leaves `galloc->buffers[i] = NULL`, while the
node metadata was already rewritten for the new graph (`:851-902`) - so
`needs_realloc` (`:1009-1049`) compares fresh-against-fresh, returns false, and
`alloc_graph` walks into `ggml_gallocr_init_tensor` -> `ggml_vbuffer_tensor_alloc`
(`:988`) with the NULL vbuffer. Reachable exactly as the report said: a late
graph needing a bigger compute buffer whose realloc fails.

Fix (commit `bb8d03237`, +8/−1, `ggml-backend.cpp:1633-1641`): check the return,
`GGML_LOG_ERROR("failed to reserve buffers")` + `return false`. The false lands
in the existing channel: `ggml_backend_sched_alloc_graph` `:1999-2001` ->
`ggml_backend_sched_graph_compute_async` returns **GGML_STATUS_ALLOC_FAILED**
(`:2022`) -> decode returns -2 (gpufit report step 9), no abort, no new API.
Success path unchanged: same call, same order, one branch more.

## 3. Item 3 (tests)

**No fault-injection hook exists** in the engine or `tests/` (grep for
FAIL_ALLOC/ALLOC_FAIL/OOM-injection across `ggml/src/` and `tests/*.cpp`: only
the status enum usages). The standing native build compiles OPENCL=OFF, so no
native harness even reaches `set_tensor`; `tests/test-opencl-moe-roundtrip.cpp`
needs a real OpenCL device (none on this Mac). Per the order, no test API was
invented: **the throw-instead-of-abort behaviour is UNTESTED on a device** -
same status as `86f602f8a`'s own honest note. What WAS run (all local):

| command | exit |
|---|---|
| `bash` gates above (syntax-only, OpenCL TU) | **0** |
| `cmake -B build` (native standing config: Release, METAL=OFF, OPENCL=OFF, BLAS=ON) | **0** (`-- ggml commit: 319b53937-dirty`, 0 errors) |
| `ninja -C build -j 3` (load 1.69/3.29/3.77 first, no foreign build) | **0, 479/479**, 0 FAILED |
| seven standing governor targets (fixture stories15M-q4_0) | **0 0 77 77 0 0 0**, 0 FAIL greps - the standing sequence (`../cok-residual/REPORT.md` section 7) |
| `test-alloc` (includes `test_realallocation`, the realloc path the fix touches) | **0**, all PASSED |

## 4. Boundaries and NOT verified

- No device run, no Android binary (no test needed one); the commit is
  host-verified only: native build + standing tests + syntax gate.
- The throw path's runtime behaviour (NULL staging buffer -> `std::runtime_error`
  -> binding catch -> `KALSA_GOVERNOR_FALLBACK` -> CPU retry) is code-read at
  this base plus 86f602f8a's prior work; never observed firing.
- The enqueue-time `CL_CHECK`s inside set_tensor still abort on device-side OOM
  during the conversion kernels - outside the report's listed sites, left as
  declared boundary.
- `ggml_gallocr_reserve_n_size`'s internal `GGML_ASSERT(reserve_n_impl(...))`
  (`ggml-alloc.c:953`) cannot fire from device OOM (no_alloc=true skips the only
  failure return) - left alone.
- Shared checkout `/Users/marco/Projects/kalsallama` untouched (worktree-based
  work); `git rev-parse @{upstream}` for the branch: fatal, no upstream.

## Round 2 (2026-09-23, SHIP-WITH-FIXES follow-up)

Branch unchanged (`kalsa-opencl-upload-oom-throw`, worktree `/Users/marco/Projects/kalsallama-wt-oom`).
New history on top of bb8d03237 (nothing rewritten):

```
32d0726b9  test : a failed sched reserve must fail cleanly on every retry      <- tip
4d46cb61c  ggml : poison the gallocr plan when a reserve fails, so retries re-reserve
0c4d75fa5  ggml : handle graph buffer reservation failure (#26070)             [cherry-pick -x of upstream]
fc0a2f900  Revert "ggml : a failed sched reserve returns ALLOC_FAILED ..."     [revert of my re-derivation]
bb8d03237  (round 1, now empty of effect after fc0a2f900+0c4d75fa5)
319b53937  base
```

### 1. Re-derivation replaced by upstream

`git revert --no-edit bb8d03237` -> EXIT=0 (commit `fc0a2f900`); `git cherry-pick -x 911f6cdc8`
-> **EXIT=0, applied cleanly, no conflict** (commit `0c4d75fa5`, upstream authorship and
"(cherry picked from commit 911f6cdc8...)" trailer preserved). The picked hunk is upstream's
wording ("failed to reserve graph buffers"), the explanatory fork comment from round 1 is gone
with the revert.

### 2. Retry hole closed - commit 4d46cb61c

`ggml/src/ggml-alloc.c:940-948`: on the failure return of `ggml_gallocr_reserve_n_impl` the
plan is now invalidated (`galloc->n_nodes = -1`, comment states the trap). Readers of
`n_nodes`: `reserve_n_impl:851` (rewrites it; -1 just takes the grow path) and
`needs_realloc:1010` (first check - the poison target); no other reader. Effect per the audit's
§2.2 scenario: the retry's `alloc_graph` sees `needs_realloc == true`, so a single-buffer sched
re-reserves (fails again -> false) and a multi-buffer sched refuses -> false. No NULL walk, no
dangling-data reuse. This also covers the audit's §2.3 sites (`clip.cpp:4439`+`5749`,
`ggml-opt.cpp:776`+`:824`): even though they discard the first result, their second call now
cannot skip the reserve. `ggml_vbuffer_free(NULL)` is safe (`:403-405`).

### 3. ggml_cl_buffer::allocate - STOPPED after reading, plan only (per the order's stop rule)

Read first, as ordered. The three audit-named sites fan out far beyond "those call sites plus
one status path":

- `allocate` itself has **~120 call sites** in `ggml-opencl.cpp` (grep of `.allocate(`/`->allocate(`).
- `:7283` sits in `transpose_2d` (:7270, void) -> `transpose_2d_as_8b`/`_16b`/`_32b` (:7315/:7326/:7337,
  void) with **8 / 49 / 8** call sites respectively, and those helpers are called from
  `ggml_backend_opencl_buffer_set_tensor` (:11027) and `get_tensor` (:13070) - **void
  backend-interface callbacks that cannot carry a compute status** - and from
  `ggml_cl_mul_mat_dequant_quant_to_f16` (:23681, returns `cl_mem`).
- `:8508`/`:8567` sit in `ggml_cl_moe_bias_combine_fused` (:8476, void) and
  `ggml_cl_moe_combine_fused` (:8543, void), each with 2 call sites inside the
  `ggml_backend_opencl_graph_compute` dispatch (:9029/:9038) - that part IS one status path.

**Plan (not coded):** phase 1 - `allocate` returns bool; unconverted callers ignore it, which
removes the abort at the method itself but leaves ~117 sites silently using a NULL buffer (the
next `CL_CHECK` then aborts anyway) - so phase 1 alone is cosmetic. Phase 2 - convert the
MoE pair to bool up to the graph_compute dispatch (small), and the transpose family to THROW
from the set/get_tensor side (the 86f602f8a channel) + bool on the compute side; ~6 signature
changes, ~69 call sites, two different contracts. That exceeds the order's limit by an order of
magnitude; stopped after reading, as ordered. `ggml-opencl.cpp:389` therefore still aborts on
scratch OOM - unchanged this round, now with the exact fan-out on record.

### 4. Test - commit 32d0726b9 (task-2 fix; task 3 has no host vehicle)

`tests/test-alloc.cpp` +31 lines, one topic: `dummy_backend_context::fail_alloc` (the buffer
type returns nullptr, like a real backend at device OOM) and `test_sched_reserve_failure` -
a one-backend sched whose buft always fails must return false from
`ggml_backend_sched_alloc_graph` on the first call AND on the same-graph retry. Task 3's
`allocate` is in the OpenCL TU, which the CPU-native build does not compile - no host test is
possible without inventing a vehicle; declared untested.

Sabotage evidence (build `ninja -C build -j 3 test-alloc`, run `./build/bin/test-alloc`,
exit codes as printed):

| configuration | run exit | where it dies |
|---|---|---|
| bare base 319b53937 (both fixes locally reverted) | **139** | first `alloc_graph`: NULL-vbuffer walk, crash before any assert |
| 319b53937 + cherry-pick 0c4d75fa5 only (poison stashed) | **139** | the RETRY: segfault in `test_sched_reserve_failure` after both reserves log failures |
| base + poison only (accidental datapoint: upstream check locally reverted, poison in) | **0**, PASSED | - the poison alone closes both doors at the allocator level |
| cherry-pick + poison (branch tip state) | **0**, **15/15 PASSED** | `test_sched_reserve_failure PASSED`, both calls log "failed to reserve graph buffers" |

Full-run at the end: `ninja -C build -j 3` -> **EXIT=0** (full tree); seven standing governor
targets -> **0 0 77 77 0 0 0** (0 FAIL greps, the standing sequence); `test-alloc` -> EXIT=0,
15/15. Restore discipline: every sabotage was undone with `git checkout`/`git stash pop`
(EXIT=0 each); worktree clean at `32d0726b9` (`git status --porcelain` = 0 lines).

### 5. Binding question (READ ONLY - no binding file touched)

**Why -2 is excluded.** Both filters arrived wholesale in `987799a1` (2026-09-17, "kalsa:
native patch set (governor, slot manager, JSI, MoE streaming params)" - the app's
patches/llama.rn+0.12.8.patch imported as content; `git log -S'result != -2' -- cpp/rn-llama.cpp
cpp/rn-governor.cpp` -> only that commit). The reason is in the engine's governor: **the
governor mints its own -2s as flow control**, none of which may mark the governor failed:
`admit_prefill` `src/llama-governor-runtime.cpp:57` (thermal Wait - pause the turn), `:72`
(prefill needs a caller chunk), `:83`/`:91` (prompt cannot be partitioned), `select_decode`
`:127` (waiting for a valid thermal profile), `:131` (decode engine change requires a full
context reload - the app is EXPECTED to reload). The chunked sentinel is -1001, not -2
(`src/llama-governor.h:48`). So the binding's exclusion is correct for those.

**The collision.** `decode_impl` (`src/llama-governor.cpp:214-218`) on `llama_decode` rc != 0
sets `failed = true` and returns rc raw - and `llama_decode` returns -2 for
`GGML_STATUS_ALLOC_FAILED` (`src/llama-context.cpp:1883`; also -2 at `:1781`/`:1824` for
memory-context/output-reserve). That -2 arrives at `rn-governor.cpp:52`, is excluded by the
filter, so the binding shadow `failed_` stays false, `rn-llama.cpp:668` suppresses the
KALSA_GOVERNOR_FALLBACK log, and `governorFailed()` (which reads the binding shadow) reports
healthy: the engine governor is failed but the app never learns. The audit's §2.5 is confirmed
and sharpened: the engine ALREADY marks the failure; only the rc-based transport loses it.

**Proposal (no code).** Key the binding's decode-failure handling on the ENGINE governor's
failed-state, not on the rc: the discriminator already exists - every flow-control -2 returns
without setting failed, every engine -2 sets failed first. In `rn-governor::decode`:
`failed_ = true` when `(result != 0 && result != -2) || <engine governor failed>`, and in
`llama_rn_context::decode` emit the KALSA_GOVERNOR_FALLBACK line under the same condition
(stage "decode", reason from `failure_reason()`). Then the existing app machinery finishes the
job: `governorRuntime.ts`'s `isGovernorFallback` matches the log line and
`initWithGovernorFallback` retries with `cpuParams` (`n_gpu_layers = 0`,
`LlamaService.ts:2529`) - the same CPU-only reload that load-time OOM already gets. Two
additions worth considering with the owner: (a) have `decode_impl` call `fail()` with a
distinct reason ("decode ALLOC_FAILED") so the -2-from-OOM is distinguishable from the other
-2 sources in logs; (b) mirror the existing `select_decode` reload protocol (engine=CPU +
`decode_requires_reload`) so the app's reload-on--2 path is reused verbatim instead of a new
signal. Not verified: the JS layer above `governorFailed()`/the completion API (same gap the
audit declared); no code was written for any of this.

## Round 3 (2026-09-23, audit round-2 follow-up: three fixes)

Same branch/worktree. New commits on top of `32d0726b9` (worktree clean after each; branch
printed before every commit; no push, no tag, no new branch):

```
722c07078  ggml : skip the node_allocs calloc for a node-less reserve
34fca920f  ggml : clear aliased gallocr buffers when a realloc frees the shared vbuffer
a6f3324be  test : cover the fail-then-succeed retry after a failed sched reserve
```

### 1. Fail-then-succeed coverage (audit R4b) - commit a6f3324be

`test_sched_reserve_failure` now continues: after the two failing calls, `fail_alloc = false`
and the SAME sched/graph is retried - `GGML_ASSERT(ggml_backend_sched_alloc_graph(...))` and
`x[0]->data != nullptr && x[1]->data != nullptr` (the dummy backend has no compute; data being
set is the proof the retry re-reserved and really allocated). Sabotage: poison locally reverted
(`git checkout 0c4d75fa5 -- ggml/src/ggml-alloc.c`; a first attempt that stashed the
already-committed file sabotaged nothing - noted, not counted as evidence) -> run **exit 139**,
crash at the second call (two `failed to allocate` lines then SIGSEGV); restored
(`git checkout HEAD -- ...`, grep `n_nodes = -1` = 1). Honest limit: the red dies at call 2,
so the new third assertion is exercised green only (exit 0, 15/15 then, 17/17 after round-3.3).

### 2. Aliased-buft double free (audit R3) - REPRODUCED, fixed - commit 34fca920f

Reproduction, `test_sched_reserve_failure_alias_double_free`: the dummy buft passed TWICE
(`ggml_backend_sched_new(backend_ptrs, bufts, 2, ...)`; `ggml_gallocr_new_n` dedups the tallocr
by buft pointer, `ggml-alloc.c:516-521`); graph1 allocs fine (one shared vbuffer, slot 1
aliased); `ggml_backend_sched_reset` (sched bookkeeping only - the galloc vbuffer survives;
also required because `alloc_graph` asserts `!sched->is_alloc`, `ggml-backend.cpp:1995`, which
is where the first red draft of the test died - exit 134, wrong reason, fixed by adding the
reset); then a LARGER graph2 with `fail_alloc = true` forces the grow re-reserve to free the
shared vbuffer and fail. ASan build (`build-asan`, Debug + `-fsanitize=address`, target
`test-alloc` only, `ninja -j 3`): **exit 134,
`ERROR: AddressSanitizer: heap-use-after-free ... ggml_vbuffer_free ggml-alloc.c:407` from
`ggml_gallocr_free:554` via `ggml_backend_sched_free` at the test's scope end** - exactly the
audit's teardown double-free.

Fix (`ggml-alloc.c:935-946`): capture the vbuffer before the free, NULL every slot still
pointing at it (covers slot i itself and the aliases, in BOTH the `no_alloc` and the failed
real-allocation path - the free is unconditional there, so `no_alloc` dangles aliases too),
then attempt the new allocation. Success path unchanged (the slot is reassigned immediately).
Green: ASan and plain builds **17/17 PASSED, exit 0**.

### 3. Zero-node retry (audit R2.4) - reachable, guarded - commit 722c07078

Reachability: YES - the poison's `n_nodes = -1` makes the grow check at `ggml-alloc.c:851`
(`galloc->n_nodes < graph->n_nodes`) true for a 0-node graph (`-1 < 0`), reaching
`calloc(0, ...)` + `GGML_ASSERT(!= NULL)` at :853-854. Guard: the branch now sets
`node_allocs = NULL` and only allocates+asserts when `graph->n_nodes > 0`. The leaf side
cannot take its branch with a 0-leaf graph (`n_leafs` is never poisoned, so `n_leafs < 0` is
false). Test `test_sched_zero_node_retry_after_failure`: poison via a failing real graph, then
retry with an empty graph - first draft asserted `!alloc_graph(egraph)` and the assert FAILED
(exit 134): the empty plan has no chunks, `ggml_vbuffer_alloc` never calls the buft, so the
0-node retry succeeds cleanly; the test now asserts TRUE. Honest limit: **no red is producible
on this host** - macOS libc returns non-NULL for `calloc(0)`, so the un-guarded code also
passes here; the guard is C-portability hardening (calloc(0) may return NULL), pinned green:
17/17 in both builds.

### Final full run

`ninja -C build -j 3` (whole tree) EXIT=0; seven standing governor targets **0 0 77 77 0 0 0**
(the standing sequence, 0 FAIL greps); `test-alloc` plain **EXIT=0, 17/17**; `test-alloc` ASan
**EXIT=0, 17/17**, no sanitizer report. Worktree clean at `722c07078`.

### Not verified

- No device, no Android build (none needed). The aliasing fix's real-world trigger (native
  CPU+BLAS scheds) is not exercised by any app config we ship; the phone's OpenCL+CPU pair has
  distinct buft pointers and cannot alias.
- Task-1 red dies at call 2 (the crash), so the recovery assertion has no red of its own; its
  teeth are construction-argued (a wrongly-NULLed kept buffer or a failed re-reserve would
  make call 3 false/crash).
- The zero-node guard cannot be made red on macOS (calloc(0) is non-NULL here); an allocator
  returning NULL for size 0 is the only red world.

## Round 4 (2026-09-23, comments only)

Audit round-3 verdict SHIP-WITH-FIXES, fixes documentation-only (R6.4, R6.1c). One commit on
the same branch rewords the two comments in `ggml-alloc.c`; no code change (diff is
comment-only lines). Correction of record for the `34fca920f` commit message (history NOT
rewritten): "success path unchanged (the slot is reassigned immediately)" is true as an end
state but wrong as the mechanism - the alias slots are safe on the success path because the
talloc dedup makes the lowest index canonical and every later alias slot re-reads the
canonical's fresh pointer at the alias assignment, which runs before the realloc decision;
the alias-clearing comment now states exactly that. The poison comment now states that only
`n_nodes` is invalidated and that this suffices only because `needs_realloc` compares
`n_nodes` before everything else - a reorder of those checks re-arms the trap.
