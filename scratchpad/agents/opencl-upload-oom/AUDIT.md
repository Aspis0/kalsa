# AUDIT — `bb8d03237` "a failed sched reserve returns ALLOC_FAILED instead of a NULL-vbuffer walk"

**Verdict: SHIP-WITH-FIXES.**

The bug is real and the edit is the correct minimal fix at that site — it is, byte for byte
in structure, the upstream fix that has existed since `911f6cdc8` (PR #26070). It is a strict
improvement over the base: the first failed reserve now returns `false` instead of
dereferencing a NULL vbuffer. It is **not** a complete answer to "a failed reserve must not
walk a NULL buffer": the poisoned `galloc` state survives the `return false`, and any
*second* `ggml_backend_sched_alloc_graph` on the same scheduler with the same graph walks the
same NULL vbuffer through a different door (§2.2). The commit also inherits the upstream hole;
it does not introduce it. Additionally, the failure channel it chooses (`-2`) is deliberately
ignored by the app's governor/binding fallback (§2.5), so the intended CPU fallback does not
happen for this failure, and a live allocation abort remains in the OpenCL compute path
(§2.6). Ship it, but do not ship the claim around it as complete.

Read-only audit. No file other than this one was created, nothing was edited, no build was run.

Subject verified:
- `git -C ~/Projects/kalsallama-wt-oom branch --show-current` → `kalsa-opencl-upload-oom-throw`, EXIT=0
- `git show bb8d0323798e5d44cec11d58f226c2cc05247ddd --stat` → 1 file, +8/−1, EXIT=0
- `git diff 319b53937 --stat` → `ggml/src/ggml-backend.cpp | 9 ++++++++-`, EXIT=0
- `git status --porcelain` → empty, EXIT=0

---

## 1. Is the bug real? CONFIRMED — but not from `ggml_backend_sched_reserve`

### 1.1 The entry-point nuance (worth stating first, because the brief names it)

`ggml_backend_sched_reserve` **already checked** the reserve result at the base:

    ggml-backend.cpp:1980  if (!ggml_gallocr_reserve_n(sched->galloc, &sched->graph, sched->node_backend_ids, sched->leaf_backend_ids)) {

(`git show 319b53937:ggml/src/ggml-backend.cpp | grep -n ggml_gallocr_reserve_n` → 1633, 1958,
1969, 1972, 1980 — the check is at 1980 in the base blob.)

So for the `ggml_backend_sched_reserve` entry point the NULL walk is **REFUTED**: that path
returns `false` before touching `ggml_gallocr_alloc_graph`. The real entry point is
`ggml_backend_sched_alloc_graph` → `ggml_backend_sched_alloc_splits`, reached from
`ggml_backend_sched_graph_compute_async` and from direct `alloc_graph` callers.

### 1.2 The pre-fix path (base `319b53937`)

    ggml-backend.cpp:1611  if (backend_ids_changed || !ggml_gallocr_alloc_graph(sched->galloc, &sched->graph)) {
    ggml-backend.cpp:1633      ggml_gallocr_reserve_n(sched->galloc, &sched->graph, sched->node_backend_ids, sched->leaf_backend_ids);
    ggml-backend.cpp:1634      if (!ggml_gallocr_alloc_graph(sched->galloc, &sched->graph)) {

Line 1633 is a bare expression statement; the `bool` is discarded. On failure the second
`alloc_graph` runs unconditionally.

Inside the allocator, a failed reserve frees the old device buffer first and leaves the slot
NULL (the failing index only):

    ggml-alloc.c:935      ggml_vbuffer_free(galloc->buffers[i]);
    ggml-alloc.c:939          galloc->buffers[i] = ggml_vbuffer_alloc(galloc->bufts[i], galloc->buf_tallocs[i], GGML_BACKEND_BUFFER_USAGE_COMPUTE);
    ggml-alloc.c:940          if (galloc->buffers[i] == NULL) {
    ggml-alloc.c:941              GGML_LOG_ERROR("%s: failed to allocate %s buffer of size %zu\n", ...);
    ggml-alloc.c:942              return false;

`ggml_vbuffer_free` is `ggml-alloc.c:402` and calls `ggml_backend_buffer_free(buf->chunks[i])`
for every chunk, so the device memory is gone before the replacement is attempted.

Crucially, the metadata is rewritten **before** that loop, so a failed reserve leaves a
self-consistent plan:

    ggml-alloc.c:856   galloc->n_nodes = graph->n_nodes;   (and n_leafs, node_allocs, leaf_allocs from the new plan)

`ggml_gallocr_alloc_graph` therefore takes the fast path:

    ggml-alloc.c:1052  bool ggml_gallocr_alloc_graph(ggml_gallocr_t galloc, struct ggml_cgraph * graph) {
    ggml-alloc.c:1053      if (ggml_gallocr_needs_realloc(galloc, graph)) {
    ggml-alloc.c:1061          } else {
    ggml-alloc.c:1065              return false;   // multi-buffer: cannot reallocate here

`needs_realloc` compares the fresh plan against the fresh plan (`ggml-alloc.c:1009-1051`,
`ggml_gallocr_node_needs_realloc` returns `talloc->size_max >= node_size`) and returns false
for every tensor because `node_alloc->dst.size_max` was just set from the same
`ggml_backend_buft_get_alloc_size`. It then resets only non-NULL buffers and walks into:

    ggml-alloc.c:984           if (tensor->data == NULL) {
    ggml-alloc.c:987               ggml_vbuffer_tensor_alloc(galloc->buffers[buffer_id], tensor, tensor_alloc->addr);
    ggml-alloc.c:442   static void ggml_vbuffer_tensor_alloc(struct vbuffer * buf, struct ggml_tensor * tensor, struct buffer_address buf_addr) {
    ggml-alloc.c:443       void * base = ggml_backend_buffer_get_base(buf->chunks[buf_addr.chunk]);

`galloc->buffers[buffer_id]` is NULL and the very first thing done with it is
`buf->chunks[...]` on a NULL `struct vbuffer { ggml_backend_buffer_t chunks[...]; }`
(`ggml-alloc.c:398-400`). Release and debug both die here: in debug the two `assert`s at
`ggml-alloc.c:985-986` can pass (the addr and size_max are valid), and the assert path itself
is not a graceful failure anyway.

Reachability of the `reserve_n` failure is real on the OpenCL side: the buffer type returns
NULL rather than aborting on device OOM after four fallbacks —

    ggml-opencl.cpp:14434/14437  if (err != CL_SUCCESS) { GGML_LOG_ERROR("%s: failed to allocate %.2f MiB (err=%d)..."); return nullptr; }

**Verdict: CONFIRMED** (bug real, at `ggml-backend.cpp:1633-1634` base, via
`ggml_gallocr_needs_realloc` → `ggml_gallocr_init_tensor` → `ggml_vbuffer_tensor_alloc(NULL,..)`).
The report's mechanics are accurate. Its line numbers are base-relative (`:1633`, `:1634`)
and correct for the base blob. The framing in the audit brief, "from
`ggml_backend_sched_reserve`", is what does not hold: that entry point already returned false.

---

## 2. Is the fix correct and complete?

### 2.1 The first failure, which the diff handles — CONFIRMED correct

    ggml-backend.cpp:1637  if (!ggml_gallocr_reserve_n(sched->galloc, &sched->graph, sched->node_backend_ids, sched->leaf_backend_ids)) {
    ggml-backend.cpp:1638      GGML_LOG_ERROR("%s: failed to reserve buffers\n", __func__);
    ggml-backend.cpp:1639      return false;

`false` propagates through a channel the callers already check:

    ggml-backend.cpp:2006  if (!ggml_backend_sched_alloc_splits(sched)) { return false; }   (is_alloc stays false)
    ggml-backend.cpp:2028      if (!ggml_backend_sched_alloc_graph(sched, graph)) {
    ggml-backend.cpp:2029          return GGML_STATUS_ALLOC_FAILED;

`GGML_STATUS_ALLOC_FAILED = -2` (`ggml/include/ggml.h:359`), and the callers handle it rather
than asserting:

    src/llama-context.cpp:1388  if (!ggml_backend_sched_alloc_graph(sched.get(), gf)) {
    src/llama-context.cpp:1390      ret = GGML_STATUS_ALLOC_FAILED;
    src/llama-context.cpp:1391      return nullptr;
    src/llama-context.cpp:1883              case GGML_STATUS_ALLOC_FAILED: return -2;
    src/llama-kv-cache.cpp:942  if (!ggml_backend_sched_alloc_graph(sched, gf)) {  // logs and returns
    src/llama-context.cpp:2556  auto status = ggml_backend_sched_graph_compute_async(sched.get(), gf);  // checked at 2557

No `GGML_ABORT`/`abort()` on this path in `src/` (one conditional debug abort, §2.4). The
success path is untouched: same call, same order, one branch more. The `+8/−1` loses no call.

### 2.2 The hole the fix does not close — a retry on the same sched still walks NULL — CONFIRMED

After the new `return false`, `galloc` is left with `buffers[k] == NULL` and metadata that
matches the graph. `sched->is_alloc` is false and `sched->is_reset` is false
(`ggml_backend_sched_split_graph` sets `sched->is_reset = false;` at `ggml-backend.cpp:1070`).
A second compute on the same scheduler:

    ggml-backend.cpp:2023  if (!sched->is_reset && !sched->is_alloc) {
    ggml-backend.cpp:2024      ggml_backend_sched_reset(sched);
    ggml-backend.cpp:2027  if (!sched->is_alloc) {
    ggml-backend.cpp:2028      if (!ggml_backend_sched_alloc_graph(sched, graph)) {

`alloc_splits` then finds `backend_ids_changed == false` (the ids are identical) and calls
`ggml_gallocr_alloc_graph` **first**. `needs_realloc` is false (the metadata is the failed
plan), so `reserve_n` is *never called* on the retry — the fix does not run — and the walk
goes to `ggml-alloc.c:987` → `:443` with `galloc->buffers[k] == NULL` as in §1.2. If the
retried graph's tensors carry stale non-NULL `data` from an earlier successful allocation,
the same branch silently keeps dangling pointers into the freed device buffer instead
(`ggml-alloc.c:988-990`).

This is reachable in-repo without any retry policy: `tools/mtmd/clip.cpp` calls
`ggml_backend_sched_alloc_graph` and discards the result, then calls it again from compute:

    tools/mtmd/clip.cpp:4439      ggml_backend_sched_alloc_graph(ctx->sched.get(), gf);
    tools/mtmd/clip.cpp:5749      auto status = ggml_backend_sched_graph_compute(ctx->sched.get(), gf);

The same double-call pattern exists in `ggml/src/ggml-opt.cpp:776` and `:824` (result
discarded). So on the identical-size-graph retry the commit's stated goal ("must not walk a
NULL buffer") is not achieved; the crash is merely moved from the first failure to the next
call.

**Verdict: CONFIRMED (incompleteness).** A complete fix has to make the post-failure state
self-healing — e.g. force `ggml_gallocr_needs_realloc()` true after a failed reserve (an
explicit "poisoned" marker), or make `ggml_gallocr_alloc_graph` refuse when a buffer a tensor
needs is NULL. This is also an upstream hole: `git diff 319b53937 upstream/master --
ggml/src/ggml-alloc.c` is empty (EXIT=0, 0 bytes) and there are no commits after `911f6cdc8`
touching `ggml-alloc.c` (EXIT=0, 0 lines), so upstream has the same retry hole.

### 2.3 Callers of the changed function and whether they check the new failure

`ggml_backend_sched_alloc_splits` is `static`; the only caller is `ggml_backend_sched_alloc_graph:2006`,
which checks. The user-visible entry points and their callers:

| caller | checks? | quoted line |
|---|---|---|
| `src/llama-context.cpp:1388` | yes, maps to `ALLOC_FAILED` | `if (!ggml_backend_sched_alloc_graph(sched.get(), gf)) {` |
| `src/llama-kv-cache.cpp:942` | yes, logs and returns | `if (!ggml_backend_sched_alloc_graph(sched, gf)) {` |
| `ggml/src/ggml-opt.cpp:776` | **no**, discards | `ggml_backend_sched_alloc_graph(opt_ctx->backend_sched, opt_ctx->allocated_graph_copy);` |
| `tools/mtmd/clip.cpp:4439` | **no**, discards | `ggml_backend_sched_alloc_graph(ctx->sched.get(), gf);` |
| `tools/mtmd/clip.cpp:3765` (public reserve, pre-existing) | **no** | `ggml_backend_sched_reserve(ctx_clip.sched.get(), gf);` |

The discarded return in clip is not benign: the next thing clip does with those tensors
aborts:

    tools/mtmd/clip.cpp:4470      ggml_backend_tensor_set(cur, values.data(), 0, ggml_nbytes(cur));
    ggml-backend.cpp:338          GGML_ASSERT(buf != NULL && "tensor buffer not set");

`GGML_ASSERT` is unconditional (`ggml/include/ggml.h:288`) and `ggml_abort` ends in `abort()`
(`ggml/src/ggml.c:272`), so in the vision path a failed reserve still terminates the process,
just one call later. These are pre-existing ignored returns, but they sit on the exact failure
channel this commit creates; the commit message's audit covers only `set_tensor` aborts.

**Verdict: CONFIRMED** (at least one in-tree caller/consumer turns the new failure into
`GGML_ABORT` at `ggml-backend.cpp:338`).

### 2.4 A conditional abort that pre-empts the new return — PLAUSIBLE, non-default

    ggml-backend.cpp:1616      if (sched->debug_realloc > 0) {
    ggml-backend.cpp:1619          const bool unexpected = !backend_ids_changed && sched->debug_prev_graph_size == sched->debug_graph_size;
    ggml-backend.cpp:1622              GGML_ABORT("%s: unexpected graph reallocation ...");

`debug_realloc` is `0` by default (`ggml-backend.cpp:1868`) and set by
`GGML_SCHED_DEBUG_REALLOC`/`GGML_SCHED_NO_REALLOC` (`:1869-1873`). The Android binding does not
define it (`grep GGML_SCHED_NO_REALLOC` in the binding's `android/` → EXIT=1, no match; the
option defaults OFF at `ggml/CMakeLists.txt:190`). But upstream CI builds with
`-DGGML_SCHED_NO_REALLOC=ON` (`llama.rn-kalsa/tmp/kalsallama-src/ci/run.sh:68`). In such a
build, a reserve failure caused by a same-size realloc aborts at `:1622` before the new check.
Not the app's configuration; flagging it so nobody claims "no abort" unconditionally.

### 2.5 The chosen error value is one the app's fallback deliberately ignores — CONFIRMED

The commit says "decode returns -2, no abort". True. But the binding excludes `-2` from both
the governor-failure state and the fallback log:

    llama.rn-kalsa/cpp/rn-llama.cpp:668      if (result != 0 && result != -2 && !was_failed) {
    llama.rn-kalsa/cpp/rn-governor.cpp:52    if (result != 0 && result != -2) {

and the app's CPU fallback fires only on a **load-time exception**:

    kalsa/src/engine/governorRuntime.ts:67    try {
    kalsa/src/engine/governorRuntime.ts:68      return { value: await args.init(args.governorParams), retried: false };
    kalsa/src/engine/governorRuntime.ts:69    } catch (error) {
    kalsa/src/engine/governorRuntime.ts:70      if (!isGovernorFallback(error, args.nativeLog(), nativeLogAtLoadStart)) throw error;

So a decode-time reserve OOM returns `-2` to a governor that does not mark itself failed, to
a fallback that only watches load-time logs. `-2` is also overloaded (e.g.
`src/llama-context.cpp:1781` and `:1824` return `-2` for memory-context and output-reserve
failures), so the caller cannot distinguish "retry with a smaller batch" from "the context is
now poisoned". The commit prevents the immediate crash but does not deliver the recovery its
rationale assumes. **Verdict: CONFIRMED.** Either the failure needs its own surfacing, or the
binding's `-2` filter and the retry hole (§2.2) have to be fixed together.

### 2.6 Remaining allocation abort in the OpenCL compute path — CONFIRMED

`86f602f8a` converted the `set_tensor` upload sites. One device-allocation abort remains
outside that scope, on the memory-pressure path, and it is not the enqueue-time `CL_CHECK` the
report declared as boundary:

    ggml-opencl.cpp:389               CL_CHECK((buffer = clCreateBuffer(context, CL_MEM_READ_WRITE, size, NULL, &err), err));
    ggml-opencl.cpp:68-76   #define CL_CHECK(err) ... GGML_ASSERT(0); ...
    ggml-opencl.cpp:7283              buf.allocate(backend_ctx->context, size);      // transpose_2d
    ggml-opencl.cpp:8508              buf.allocate(backend_ctx->context, w_bytes);   // ggml_cl_moe_bias_combine_fused
    ggml-opencl.cpp:8567              buf.allocate(backend_ctx->context, w_bytes);   // ggml_cl_moe_combine_fused
    ggml-opencl.cpp:7227-7229         backend_ctx->prealloc_{quant,scales,act}_trans.allocate(context, ...);  // in ggml_cl_init

`transpose_2d`/MoE combine are compute-time scratch allocations: a device OOM there calls
`ggml_abort`, and the binding's abort handler only logs before the process dies
(`llama.rn-kalsa/cpp/rn-llama.cpp:225-236` — no throw, `ggml/src/ggml.c:272 abort();`). So
"memory pressure on the GPU prefill path no longer aborts" is not true after this commit; it
is true only for the reserve path and the already-converted `set_tensor` sites.

### 2.7 State reuse: what is and is not broken

- `sched->n_splits`, `sched->splits[]`, `hv_tensor_copies`: rebuilt by
  `ggml_backend_sched_split_graph` on the next call (`ggml-backend.cpp:1068-1070` sets
  `n_splits = 0`, `is_reset = false`), so no stale-split reuse. **REFUTED.**
- `galloc` after failure: poisoned (§2.2). `Galloc` memory for indices before the failing one
  is still owned by `galloc` and freed on sched teardown. **CONFIRMED, see §3.**
- `sched->is_alloc == false` is what makes the next call take `ggml_backend_sched_reset`, so
  the sched does *not* think it is allocated. That is the only reason the next call does not
  immediately compute with freed buffers.

---

## 3. Memory on the failure path: no leak; one conditional double-free — CONFIRMED-conditional

The failed allocation cleans up after itself:

    ggml-alloc.c:432      buf->chunks[n] = ggml_backend_buft_alloc_buffer(buft, chunk_size);
    ggml-alloc.c:433      if (buf->chunks[n] == NULL) {
    ggml-alloc.c:434          ggml_vbuffer_free(buf);
    ggml-alloc.c:435          return NULL;

Buffers successfully allocated for earlier indices stay attached to `galloc` and are released
when the scheduler is destroyed (`ggml-backend.cpp:1933 ggml_gallocr_free(sched->galloc);`,
`ggml-alloc.c:553-555`). **No leak: REFUTED.**

But a mid-loop failure with a duplicated buffer type leaves a dangling alias:

    ggml-alloc.c:908-911   if (galloc->buf_tallocs[j] == galloc->buf_tallocs[i]) { galloc->buffers[i] = galloc->buffers[j]; break; }
    ggml-alloc.c:935       ggml_vbuffer_free(galloc->buffers[i]);        // frees the shared vbuffer
    ggml-alloc.c:942       return false;                                // buffers[j] (j<i) still points at it

`ggml_gallocr_free` dedups by pointer identity only (`ggml-alloc.c:547-555`), so the dangling
`buffers[j] != buffers[i](NULL)` compares unequal and is freed again. The pre-fix code never
got here (it crashed first), so this commit makes the latent double-free reachable. It needs
two identical `buft` pointers in one sched — true for a native CPU+BLAS sched, since BLAS
returns the CPU buffer type (`ggml/src/ggml-blas/ggml-blas.cpp:381-382
return ggml_backend_cpu_buffer_type();`) — and false for the phone's OpenCL+CPU pair as far as
I could verify. **PLAUSIBLE** for the app, CONFIRMED-conditional for CPU+BLAS builds.

---

## 4. Removed behaviour: nothing else was lost — REFUTED

The deleted line was a bare call with the `bool` discarded; the replacement calls the same
function with the same arguments in the same position. No log, counter, reset or ordering
change is lost. The only behavioural difference is the early `return false`
`ggml-backend.cpp:1639`; the inner failure log from `ggml_gallocr_reserve_n_impl`
(`ggml-alloc.c:941`, buffer name and MiB) is still emitted before the new one. The new message
duplicates part of that line but adds no data.

---

## 5. Upstream prior art: upstream fixed it first, identically — CONFIRMED

    git log --all --oneline -- ggml/src/ggml-backend.cpp  →  911f6cdc8 ggml : handle graph buffer reservation failure (#26070)

`911f6cdc8` (z, 2026-09-18) is the same hunk on the **same pre-image blob**: the fork's diff
says `index 6faa68047..41a006846`, upstream's says `index 6faa68047..20bf96501`. Upstream:

    if (!ggml_gallocr_reserve_n(sched->galloc, &sched->graph, sched->node_backend_ids, sched->leaf_backend_ids)) {
        GGML_LOG_ERROR("%s: failed to reserve graph buffers\n", __func__);
        return false;
    }

Differences: upstream's log string is "failed to reserve graph buffers"; this commit adds a
4-line explanatory comment and no follow-up hardening. `911f6cdc8` is an ancestor of
`upstream/master` (`git merge-base --is-ancestor 911f6cdc8 upstream/master` → EXIT=0) and
**not** of the base (`... 911f6cdc8 319b53937` → EXIT=1). So the base branch simply never
picked up the upstream fix; this commit re-derives it. The commit message presents the
verification as if novel and never names #26070 — for a fork whose rule is "never upstream",
the missing prior-art reference is a reporting defect, not a code defect. Upstream has the
same §2.2 hole, so the incompleteness is shared, not invented.

---

## 6. Test: nothing goes red, and no fault-injection hook exists — CONFIRMED

    grep -rn "alloc_buffer|ALLOC_FAIL|FAIL_ALLOC" tests/*.cpp  → no injection hook
    tests/test-alloc.cpp:547-548, 574-575   → reserve_n/alloc_graph called directly, never forced to fail
    tests/test-alloc.cpp:643               → GGML_ASSERT(ggml_backend_sched_alloc_graph(sched.get(), graph));

`tests/test-alloc.cpp` never drives `alloc_splits` into a failed reserve. `test-backend-ops`
exercises backends, not the scheduler's failure path. So: **no test goes red without this
change**; the report's "UNTESTED on a device" is accurate and understated (it is untested
everywhere).

Smallest test that would go red on the base and pass here (do not write it into the tree
without the owner's word, per instructions): extend the existing `dummy_backend` in
`tests/test-alloc.cpp` — its buft allocator is one line away from failing on demand:

    tests/test-alloc.cpp:41  static ggml_backend_buffer_t dummy_backend_buffer_type_alloc_buffer(ggml_backend_buffer_type_t buft, size_t size) {
    tests/test-alloc.cpp:43      ggml_backend_buffer_t & buffer = ctx->buffers.emplace_back();

Add `bool fail_alloc = false;` to `dummy_backend_context`, return `nullptr` from :41 when set,
build a 1-backend sched (`ggml_backend_sched_new`, as at :642) with that buft, call
`ggml_backend_sched_alloc_graph(sched.get(), graph)` once and assert it returns `false`. On the
base this test segfaults in `ggml_vbuffer_tensor_alloc` (`ggml-alloc.c:443`) because the
single-buffer path fails its internal auto-reserve (`ggml-alloc.c:1054-1059`), falls into
`alloc_splits`, fails the explicit reserve and then re-enters `alloc_graph` with
`needs_realloc == false`. For §2.2, the stronger variant calls `alloc_graph` twice on the
same sched; that one still fails (crashes) after this commit and is the test that would force
the real fix.

---

## 7. Remaining angles

- **Races — REFUTED (no new race).** The diff only adds a branch. The pre-reserve
  synchronization loop (`ggml-backend.cpp:1629-1630 ggml_backend_synchronize(sched->backends[i]);`)
  still runs before any buffer is freed, so no in-flight kernel of this scheduler reads a
  freed buffer. The new log line has no locking, same as every other `GGML_LOG_*` here.
- **Edge cases.**
  - zero-size graph: `ggml_gallocr_reserve_n_impl` allocates an empty vbuffer (non-NULL) or
    skips realloc; the new branch is not reachable from a zero-size graph. **REFUTED as a new path.**
  - CPU-only / single backend: **CONFIRMED reachable.** The auto-reserve inside
    `ggml_gallocr_alloc_graph` (`ggml-alloc.c:1053-1059`) fails first, then the pre-fix
    `alloc_splits` re-enters `alloc_graph` and hits the same NULL walk. Not OpenCL-specific.
  - multiple backends: a failure at index `k` leaves indices `<k` with new (valid) buffers and
    `>k` with the previous state; the aliasing trap of §3 lives here. **CONFIRMED mixed state,
    benign except for §3.**
  - `ggml_gallocr_reserve_n_size`'s internal `GGML_ASSERT(reserve_n_impl(..., no_alloc=true))`
    (`ggml-alloc.c:953`) cannot fire from device OOM: the only `return false` in
    `reserve_n_impl` is in the `else` (non-`no_alloc`) branch at `:942`. The report's claim is
    correct.
- **Secrets/model text in the new log line — REFUTED.** `"%s: failed to reserve buffers\n",
  __func__` carries no tensor name, no path, no model text. Clean.
- **Clean code — PASS with a pre-existing smell declared.** One responsibility per function,
  no new file, comment explains WHY (a trap), the comment's invariant is true (checked
  above). `ggml-backend.cpp` is 2517 lines — long past the ~350 guidance, pre-existing and
  explicitly not to be refactored here. Commit message names repo/branch/HEAD, no push/tag,
  `git add`-by-name is not applicable (commit already made, worktree clean).
- **Report citations** (self-check): the report's `ggml-backend.cpp:1633`, `:1999-2001` and
  `:2022` are base-blob line numbers and all three are exact (`git show
  319b53937:ggml/src/ggml-backend.cpp | grep -n` → 1633, 1999, 2022). They differ from the HEAD
  numbers used here (1637, 2006, 2029) only because the base did not have the fix. No drift.
- **Delivery chain.** `llama.rn-kalsa/vendor/VERSIONS` still says
  `LLAMA_CPP_COMMIT=319b539377605f6c572e234b28678b74bd78deb5` (the base) and the app pins
  `github:Aspis0/kalsa.rn#0288dc2786911d9b7dda6b2961cb3f0afa1e0ee2`. Until the engine commit is
  pushed (needs Marco's approval + DeepSeek audit), `vendor/VERSIONS` bumps and the lockfile
  re-pins, this change has zero effect on any device. Expected at this stage, recorded so the
  verdict is not read as "the phone is fixed".

---

## 8. What I could not verify

- No build and no device run (instructed). All of §1-§7 is code read; the native CI story in
  the report (`ninja`, `test-alloc`, governor targets) was not re-run and is taken as a claim.
- The app's JS decision after `llama_decode` returns `-2`: I traced the native binding
  (`rn-llama.cpp:668`, `rn-governor.cpp:52`) and the load-time fallback wrapper
  (`governorRuntime.ts:67-79`); I did not follow every JS caller of the completion API, so
  there could be an upper layer that reacts to `-2` and destroys the context. If there is, the
  §2.2 retry hole shrinks to "only if a caller reuses the sched"; if there is not, the next
  same-size decode crashes.
- Whether the Android `llama.rn` build links BLAS (which is what makes the §3 aliasing
  double-free reachable) — `grep GGML_SCHED_NO_REALLOC android/` found nothing; the BLAS
  question was not answered.
- `86f602f8a`'s set_tensor audit was spot-checked only (`throw_set_tensor_upload_error`
  exists at `ggml-opencl.cpp:10990` and guards the cited sites), not re-derived line by line
  for all 30 sites.
- Whether the phone's OpenCL buffer type actually returns NULL at the sizes involved in the
  reported failure (the Adreno 740 + heap-fragmentation scenario). The code path to the NULL
  is verified; the field occurrence is not.

---

## Findings summary

| # | finding | verdict |
|---|---|---|
| 1 | Pre-fix NULL-vbuffer walk at `ggml-backend.cpp:1633-1634` base → `ggml-alloc.c:987` → `:443` | CONFIRMED |
| 1b | The `ggml_backend_sched_reserve` entry point already checked the result | REFUTED (as an entry point) |
| 2 | Fix correct for the first failure; return channel already checked | CONFIRMED |
| 3 | Fix incomplete: same-sched retry never re-reserves, walks the same NULL | CONFIRMED |
| 4 | `clip.cpp:4439` / `ggml-opt.cpp:776` ignore the result; clip then aborts at `ggml-backend.cpp:338` | CONFIRMED |
| 5 | `debug_realloc` abort can pre-empt the new return in `GGML_SCHED_NO_REALLOC` builds | PLAUSIBLE (non-default) |
| 6 | `-2` is excluded from the binding's governor fallback; app fallback is load-time only | CONFIRMED |
| 7 | Compute-time scratch OOM still aborts at `ggml-opencl.cpp:389` (via `:7283`, `:8508`, `:8567`) | CONFIRMED |
| 8 | No leak on the failure path | REFUTED |
| 9 | Aliased buft (`buffers[i] == buffers[j]`) can double-free after a failed reserve | PLAUSIBLE→CONFIRMED-conditional |
| 10 | Removed line carried no other behaviour | REFUTED (nothing lost) |
| 11 | Upstream `911f6cdc8` fixed this identically, same pre-image blob, same open hole | CONFIRMED |
| 12 | No test goes red; smallest test described (dummy buft, two `alloc_graph` calls) | CONFIRMED |
| 13 | New log line leaks nothing | REFUTED (clean) |

---

# Round 2 — `fc0a2f900` revert, `0c4d75fa5` cherry-pick, `4d46cb61c` poison, `32d0726b9` test

**Verdict: SHIP-WITH-FIXES.**

The engine change is now correct end to end for the failure paths I can read: the retry hole from
Round 1 §2.2 is closed by the poison, the cherry-pick is byte-identical to upstream, the revert
restores the base tree exactly, and the test exercises the retry that used to walk NULL. The
remaining items are not engine blockers: one history-hygiene hazard (the round-1 revert pair),
two hardening/coverage gaps on the poison (asymmetric invalidation, only the always-fails path is
tested), and a **REFUTED** step in the Round-2 report's binding proposal that must not be used to
justify the claim "no app change needed". Findings below carry Round-1 numbers where unchanged.

Branch state verified: `git branch --show-current` → `kalsa-opencl-upload-oom-throw`, EXIT=0;
`git status --porcelain` → empty, EXIT=0; `git log --oneline -6` → tip `32d0726b9`, then
`4d46cb61c`, `0c4d75fa5`, `fc0a2f900`, `bb8d03237`, base `319b53937`;
`git diff 319b53937 --stat` → `ggml/src/ggml-alloc.c | 6 ++`, `ggml/src/ggml-backend.cpp | 5 +-`,
`tests/test-alloc.cpp | 32 ++-`, 3 files, +41/−2, EXIT=0.

---

## R1. Cherry-pick identity and the revert

### R1.1 `0c4d75fa5` is byte-identical to upstream `911f6cdc8` — CONFIRMED

    git diff 911f6cdc8^ 911f6cdc8 > /tmp/r2-upstream.diff ; EXIT=0
    git diff fc0a2f900 0c4d75fa5 > /tmp/r2-pick.diff     ; EXIT=0
    diff <(strip index/---/+++ headers)                     ; EXIT=0

Both patches print the same pre-image and post-image blob numbers, which is the strongest form of
"identical":

    upstream:  index 6faa68047..20bf96501
    picked:    index 6faa68047..20bf96501

Both carry the identical hunk (`-` the bare call, `+ if (!...) { GGML_LOG_ERROR("%s: failed to
reserve graph buffers\n", __func__); return false; }`), and the resulting file blob at HEAD is the
upstream blob:

    git rev-parse HEAD:ggml/src/ggml-backend.cpp        -> 20bf965017e31338f579c1d8d1a64b0ab56c78ee
    git rev-parse 911f6cdc8:ggml/src/ggml-backend.cpp   -> 20bf965017e31338f579c1d8d1a64b0ab56c78ee
    git rev-parse upstream/master:...                    -> 20bf965017e31338f579c1d8d1a64b0ab56c78ee

The commit header preserves the original author/date/message plus the trailer:

    0c4d75fa5  z <faichou.zh@gmail.com>  Fri Sep 18 17:31:19 2026 +0800
    ggml : handle graph buffer reservation failure (#26070)
    (cherry picked from commit 911f6cdc8ab8a530b2bee09ee61471a6f3178eeb)

**Verdict: CONFIRMED.** The re-derivation from Round 1 is gone and replaced by the exact upstream
blob; the Round-1 log-string difference and the fork's 4-line comment are gone with it.

### R1.2 The revert is a clean inverse — CONFIRMED

    git diff --quiet 319b53937 fc0a2f900 > /tmp/r2-tree.log 2>&1 ; EXIT=0

Zero output, whole tree: `fc0a2f900`'s tree equals the base tree. The revert diff and the reversed
`bb8d03237` diff differ only in the `a/`/`b/` path labels on the `diff --git`/`---`/`+++` headers
(`diff -R` swaps them), no content difference.

### R1.3 History-hygiene hazard — PLAUSIBLE (process, not code)

The branch now contains a commit (`bb8d03237`) and its revert (`fc0a2f900`) followed by a
functional equivalent (`0c4d75fa5`). Keeping the pair is safe; dropping or editing one is not:
if this branch is rebased/cherry-picked onto a base that already contains `bb8d03237`'s hunk,
`fc0a2f900` applies cleanly and silently inverts it (only `0c4d75fa5` puts the fix back); onto a
base with upstream's hunk it conflicts. Nothing is pushed, so the cheap fix is to squash the three
engine commits into one before the pre-push audit. Not a reason to hold the code.

---

## R2. The poison `n_nodes = -1` — CONFIRMED correct and sufficient; two fragilities

### R2.1 Every reader of `galloc->n_nodes`, and the `-1` behaviour

    ggml-alloc.c:851   if (galloc->n_nodes < graph->n_nodes) {
    ggml-alloc.c:852       free(galloc->node_allocs);
    ggml-alloc.c:853       galloc->node_allocs = calloc(graph->n_nodes, sizeof(struct node_alloc));
    ggml-alloc.c:854       GGML_ASSERT(galloc->node_allocs != NULL);
    ggml-alloc.c:856   galloc->n_nodes = graph->n_nodes;
    ggml-alloc.c:1016  if (galloc->n_nodes != graph->n_nodes) {
    ggml-alloc.c:947                   galloc->n_nodes = -1;

The complete reader set in the file is {851, 856, 947, 1016}: no loop binds on `galloc->n_nodes`
(the loops at 857/1030/1090 use `graph->n_nodes`), no other translation unit can name the field
(the struct at 482-496 is private to `ggml-alloc.c`; `ggrep` over `ggml/src`, `tests/` for
`galloc->n_nodes`/`node_allocs` outside the file returns nothing), and `ggml_gallocr_get_buffer_size`
reads `galloc->buffers`, not the plan. So the writer's "no other reader" is correct. **CONFIRMED.**

With `n_nodes == -1`: line 851 takes the free+calloc path on the next reserve (correct array, no
double free because 852 frees before 853 allocates); line 1016 returns true, so `needs_realloc`
short-circuits **before** the `n_leafs` check at 1023. That ordering is why the asymmetric poison
is enough: a stale `leaf_allocs`/`n_leafs` cannot be consulted while `n_nodes == -1`, and any
successful re-reserve rewrites both (856, 889). No negative-size loop, no stale `node_allocs`
read, no leak (teardown `free(galloc->node_allocs)` at 577 is unconditional; `ggml_vbuffer_free(NULL)`
is a no-op at 402-405). The poison sits inside the `else` (`no_alloc == false`) branch at 936-949,
so `ggml_gallocr_reserve_n_size` (`no_alloc = true`, 957-966) cannot poison — the size-only path is
untouched. The only `return false` in `reserve_n_impl` (825-955) is the poisoned one at 948.
**CONFIRMED on all counts.**

### R2.2 The refusal the writer cites — CONFIRMED, and the sched re-reserves anyway

    ggml-alloc.c:1059  if (ggml_gallocr_needs_realloc(galloc, graph)) {
    ggml-alloc.c:1060      if (galloc->n_buffers == 1) {
    ggml-alloc.c:1064          if (!ggml_gallocr_reserve(galloc, graph)) {
    ggml-alloc.c:1065              return false;
    ggml-alloc.c:1067      } else {
    ggml-alloc.c:1069          GGML_LOG_DEBUG("%s: cannot reallocate multi buffer graph automatically, call reserve\n", __func__);
    ggml-alloc.c:1071          return false;

For a multi-buffer sched the second `alloc_graph` now returns false instead of walking NULL, and
`ggml_backend_sched_alloc_splits` then calls the explicit, checked `ggml_gallocr_reserve_n`
(`ggml-backend.cpp:1637` in the cherry-picked hunk), so the retry still ends in a clean false. The
refusal line is 1071. **CONFIRMED.**

### R2.3 Fragility A — the comment overstates what is invalidated — PLAUSIBLE (documentation)

The comment at 942-946 says "Invalidate the plan", but only `n_nodes` is invalidated. The leaf
plan (`n_leafs` at 889, `leaf_allocs` at 884-902) and every `node_alloc->dst.src[]` entry recorded
for the failed graph remain live. Today that is unreachable because 1016 is checked first; if
someone reorders the checks in `needs_realloc` or drops the `n_nodes` comparison, the stale plan
and the NULL buffer go live again. One line (`galloc->n_leafs = -1;`) or a comment naming the
ordering dependency would make the invariant local instead of implicit.

### R2.4 Fragility B — `calloc(0)` corner for a zero-node graph — PLAUSIBLE (edge, low)

`-1 < graph->n_nodes` at 851 is true even when `graph->n_nodes == 0`, so a poisoned galloc retried
with a node-less graph (a leaf-only graph whose buffer allocation failed) now reaches
`calloc(0, sizeof(struct node_alloc))` and `GGML_ASSERT(galloc->node_allocs != NULL)` at 854.
glibc/bionic return a non-NULL pointer for `calloc(0, n)`, so this is theoretical, and the pattern
pre-exists for the grow path; the poison makes it reachable. Not blocking.

### R2.5 Boundary the poison does not cover — PLAUSIBLE (untested, upstream-wide)

When a poisoned retry *succeeds* in re-reserving, buffers that are already big enough are kept
(`realloc = galloc->buffers[i] == NULL` at 915 is false; chunk-size compare at 918-933), while
`ggml_gallocr_init_tensor` still skips any tensor with `data != NULL` (984-990). A caller that
reuses the same tensor objects across the failure therefore keeps addresses from the old plan. In
tree, `llama_context::process_ubatch` rebuilds the graph after the failure (`gf_res_prev_active`
is set null before the failing `alloc_graph`), and clip rebuilds its graph per encode, so fresh
tensors have `data == NULL`. The new test cannot reach it (its reserve never succeeds). Declared,
not closed; it is upstream-wide, not introduced here.

---

## R3. Buffers allocated before the failing index — CONFIRMED no leak

For `j < i` the loop has already either kept the old buffer (`realloc` false) or freed it and
stored a replacement; the failing `i` frees nothing beyond itself (`ggml_vbuffer_free` at 935 runs
before the failed `ggml_vbuffer_alloc` at 939, and the failed vbuffer frees its own partial chunks
at 432-435). On the retry those buffers are reused only if the new chunk fits (917-924), otherwise
freed and replaced; on teardown `ggml-alloc.c:553-555` frees every distinct pointer via
`ggml_gallocr_free` (`ggml-backend.cpp:1933`). **No leak: CONFIRMED** (Round 1 §3 stands).

The Round-1 aliasing double-free is **unchanged** by this work: with a duplicated buft
(`buf_tallocs[j] == buf_tallocs[i]`, 908-911), the failure at `i` leaves `buffers[j]` pointing at
the vbuffer freed at 935, and `ggml_gallocr_free` dedups by pointer identity only (547-555, "skip if
already freed"), so it frees the dangling alias again. The poison does not touch `buffers`. Still
**CONFIRMED-conditional** (native CPU+BLAS scheds; not the phone's OpenCL+CPU pair). Round-2 did not
address it, and did not claim to.

---

## R4. The test — CONFIRMED red for the right reason; one coverage gap

    tests/test-alloc.cpp:20-22  // Return nullptr from alloc_buffer, like a real backend at device OOM
                                 // (set by test_sched_reserve_failure).
                                 bool fail_alloc = false;
    tests/test-alloc.cpp:46-48  if (ctx->fail_alloc) { return nullptr; }
    tests/test-alloc.cpp:678-679 GGML_ASSERT(!ggml_backend_sched_alloc_graph(sched.get(), graph));
                                 GGML_ASSERT(!ggml_backend_sched_alloc_graph(sched.get(), graph));
    tests/test-alloc.cpp:704    run("test_sched_reserve_failure", test_sched_reserve_failure);

**Can it go red for the right reason? Yes (code read, no build).** Without the poison
(`319b53937` + `0c4d75fa5` only): call 1, `alloc_splits` finds `backend_ids_changed == false` (the
sched's id arrays are `calloc`'d, `ggml-backend.cpp:1882-1885`, and every id is 0 for a one-backend
sched), so `ggml_gallocr_alloc_graph` runs, `needs_realloc` is true (n_nodes 0 != 1), the single
buffer auto-reserve at 1064 fails, then `alloc_splits` calls the checked explicit reserve which
fails; call 1 returns false and the first assert passes. Call 2: the failed reserve already set
`n_nodes == 1` (856), `n_leafs` matches, every `size_max` matches, so `needs_realloc` is false and
`alloc_graph` runs its reset loop (1075-1079 skips the NULL buffer) and calls
`ggml_vbuffer_tensor_alloc(NULL, ...)` at 987 -> `buf->chunks[...]` at 443 -> SIGSEGV, exit 139.
That is the Round-1 NULL walk, one call later. Even in a debug build the two `assert`s at 985-986
pass (addr and size_max come from the plan), so the signal is the deref, not an assert.

**With the poison**: call 2 takes `needs_realloc` true -> re-reserve -> fails -> poison -> false,
assert passes. Green for the right reason.

**Global state**: the test mutates only its own `dummy_backend_context` (`fail_alloc`) and creates
its own sched/context; `alloc_base` is a const global never written; no restore is needed.
**REFUTED as a concern.**

**Coverage gap — CONFIRMED.** `fail_alloc` is never cleared, so the test covers only the
always-fails path. The behaviour the poison actually adds — a retry whose reserve *succeeds* after
a failure, with the kept partial buffers and a rebuilt plan — is not exercised, and that is exactly
where §3's aliasing and §R2.5's stale-address boundary live. A third call after
`backend.context->fail_alloc = false;` asserting `true` would cover it (the second call is
deterministically false per the trace above). The crash-based red signal cannot distinguish the
intended NULL walk from any other segfault, but the walk is the only code on that path, so that is
acceptable.

---

## R5. The binding question — engine analysis CONFIRMED, the "app machinery" step REFUTED

### R5.1 The collision site and the flow-control -2 set — CONFIRMED, exactly as reported

    src/llama-governor.cpp:214-218   const int32_t rc = llama_decode(target, batch);
                                     if (rc != 0) {
                                         LLAMA_LOG_ERROR("%s: llama_decode failed with rc=%d\n", __func__, rc);
                                         failed = true;
                                         return rc;
                                     }

So an ALLOC_FAILED `-2` from `src/llama-context.cpp:1883` marks the ENGINE governor failed and is
returned raw. The six flow-control `-2`s are exactly the cited lines, all bare returns:
`src/llama-governor-runtime.cpp:57` (thermal Wait), `:72` (caller chunk), `:83` (cannot partition),
`:91` (count <= 1), `:127` (waiting for a valid thermal profile), `:131` (`requires_reload`). None
sets `failed`. Every `fail()` call (`:51`, `:124`, and `llama-governor.cpp:164/167/172/209`) goes
through `fail()` at `llama-governor.cpp:151-156`, which sets `failed = true` and **returns -1**, not
-2. Therefore: no flow-control path sets `failed`, and `decode_impl`'s short-circuit
(`llama-governor.cpp:163-164 "if (failed) return fail(\"governor is failed\");")` means an
engine-failed state cannot coexist with a newly returned flow-control `-2`. The proposal cannot
manufacture a false fallback from those sites. The `k_prefill_chunked = -1001` sentinel
(`src/llama-governor.h:48`) is converted to 0 inside `decode_impl` (186), so it never reaches the
filter. **CONFIRMED.**

### R5.2 Accessor gap — PLAUSIBLE (proposal implementable, but the report's phrasing is wrong)

    src/llama-governor.h:33   private:
    src/llama-governor.h:84   bool failed = false;
    src/llama-governor.h:31   const char * failure_reason() const { return failure_reason_; }
    src/llama-governor.cpp:153    failure_reason_ = message;   (only writer)

`failed` is private; the binding cannot read `governor_->failed`. The public equivalent today is
`failure_reason() != nullptr`, which is exactly equivalent because `fail()` is the only writer of
`failure_reason_` (grep over `src/` -> only `:153`). The binding already uses that proxy
(`rn-llama-kalsa/cpp/rn-governor.cpp:54`). So the proposal needs either that proxy or a new public
accessor; "the discriminator already exists" is true of the engine's internal state, not of its
API. One line, but load-bearing for whoever codes it.

### R5.3 "The app never learns" — REFUTED as stated; the real damage is a silent truncated turn

    llama.rn-kalsa/cpp/rn-completion.cpp:1680-1693
        if (parent_ctx->decode(llama_batch_get_one(&embd[n_past], n_eval))) {
            LOG_ERROR("failed to eval, ...");
            embd.resize(n_past);
            has_next_token = false;
            return result;                     // no throw, no fallback
    llama.rn-kalsa/cpp/jsi/RNLlamaJSI.cpp:1309-1313
        if (ctx->governorFailed()) {
            ctx->completion->endCompletion();
            throw std::runtime_error("Governor decode failed: " + ctx->governorFailureReason());
    llama.rn-kalsa/cpp/rn-governor.h:26    bool failed() const { return failed_; }

The first ALLOC_FAILED turn ends as a *returned partial result*: the completion loop swallows the
rc, the JSI's only surfacing check reads the binding shadow `failed_`, and the `-2` filter
(`rn-llama.cpp:668`, `rn-governor.cpp:52`) leaves that shadow false. The app cannot distinguish this
from an early stop. On the NEXT decode the engine short-circuits to `fail("governor is failed")`
= **-1** (`llama-governor.cpp:163-164`), which the existing filter does catch, so `failed_` becomes
true and the JSI throws with the generic reason. So the app does learn, one call later, with the
wrong reason; the report's "the app never learns" is too strong, and the practical harm is the
silent truncation plus the lost diagnosis. The proposal (key on the engine state) fixes both on the
first failing turn.

### R5.4 "Then the existing app machinery finishes the job" — REFUTED

    kalsa/src/engine/LlamaService.ts:2533   const result = await initWithGovernorFallback({
    kalsa/src/engine/LlamaService.ts:2524   try {                       (inside the load path)
    kalsa/src/engine/governorRuntime.ts:70  if (!isGovernorFallback(error, args.nativeLog(), nativeLogAtLoadStart)) throw error;

The only caller of `initWithGovernorFallback` is the model-load path (`LlamaService.ts:2533`),
inside its `try` at `:2524`. `isGovernorFallback` has no decode-time caller (grep: only
governorRuntime.ts and its test). And the report's item (b) — "mirror the existing select_decode
reload protocol so the app's reload-on--2 path is reused verbatim" — rests on a path that does not
exist: `requires_reload` is produced in `src/llama-governor-policy.cpp:258-259` and converted to
`-2` at `src/llama-governor-runtime.cpp:129-131`, but grep finds no consumer in the binding
(`cpp/**`) and none in the app (`src/**`), and the stats field `decode_requires_reload`
(`src/llama-ext.h:341`, set at runtime `:118`) is exposed but not read (the app reads only
`stats.engine_decode`, `LlamaService.ts:1766`). So the binding-side proposal is sound and useful as
an *early, correctly-reasoned error*, but it does not by itself produce a CPU reload; that needs
app-side work, which this branch does not do and the report implies it gets for free.

### R5.5 `ggml_cl_buffer::allocate`

Unchanged this round; the Round-1 §2.6 finding stands and the Round-2 report correctly declares it
out of scope after reading the fan-out. No new claim to audit. The `allocate` method still aborts
at `ggml-opencl.cpp:389` via `CL_CHECK` -> `GGML_ASSERT(0)` (`:68-76`) -> `ggml_abort` -> `abort()`
(`ggml/src/ggml.c:272`), reached from `transpose_2d` (`:7283`) and the MoE combine helpers
(`:8508`, `:8567`).

---

## Round 2 findings summary

| # | finding | verdict |
|---|---|---|
| R1.1 | `0c4d75fa5` byte-identical to `911f6cdc8` (same pre/post blob hashes, same hunk, trailer intact) | CONFIRMED |
| R1.2 | `fc0a2f900` restores the base tree exactly (`git diff --quiet` EXIT=0) | CONFIRMED |
| R1.3 | Revert pair is a rebase/merge hazard; squash before push | PLAUSIBLE (process) |
| R2.1 | `n_nodes = -1` forces re-reserve/refuse; no other reader, no negative loop, no leak, no double free | CONFIRMED |
| R2.2 | Multi-buffer refusal line `ggml-alloc.c:1071`; sched then re-reserves via the checked call | CONFIRMED |
| R2.3 | Comment says "invalidate the plan" but only `n_nodes` is poisoned; correctness depends on check order | PLAUSIBLE (doc) |
| R2.4 | Zero-node retry hits `calloc(0, ...)` + `GGML_ASSERT` at 854 | PLAUSIBLE (edge) |
| R2.5 | Success-after-poison retry keeps old addresses for tensors with `data != NULL`; untested, upstream-wide | PLAUSIBLE (boundary) |
| R3 | Buffers before the failing index kept/reused/freed correctly; no leak. Aliasing double-free unchanged | CONFIRMED / CONFIRMED-conditional |
| R4 | The test can go red for the right reason (retry NULL walk -> 139) and mutates no global state | CONFIRMED |
| R4b | Only the always-fails path is tested; fail-then-succeed (the poison's new behaviour) is untested | CONFIRMED (coverage) |
| R5.1 | `llama-governor.cpp:214-218` sets `failed` on any rc != 0; the six flow-control `-2`s never set it (fail() returns -1) | CONFIRMED |
| R5.2 | `bool failed` is private; the public proxy is `failure_reason() != nullptr` | PLAUSIBLE (API note) |
| R5.3 | "The app never learns" is too strong: first turn silently truncates, the next decode surfaces -1 | REFUTED (as stated) |
| R5.4 | "Existing app machinery finishes the job" / reload-on--2 path does not exist; needs app-side work | REFUTED |

---

# Round 3 — `a6f3324be` recovery test, `34fca920f` alias clearing, `722c07078` node-less calloc

**Verdict: SHIP-WITH-FIXES.**

The central concern — that the alias-clearing loop NULLs slots on the **success** path and can
leave a NULL behind, turning a rare double free into a common crash — is **REFUTED**. Every slot
the loop NULLs is re-pointed before any read, in the same call, and the end state after a
successful reserve is bit-identical to the pre-fix state. The commits are correct. The fixes I
would still make are documentation-level: the `34fca920f` message states a mechanism ("the slot is
reassigned immediately") that is not what makes the loop safe, and the load-bearing invariant
("only the first index of a duplicated-buft group reallocates; aliases are reassigned before they
are read") is nowhere in the code. `722c07078` is safe; the three tests mutate only locals.

Worktree verified: `722c07078` tip, `34fca920f`, `a6f3324be`, `32d0726b9` in history,
`git status --porcelain` empty EXIT=0. Line numbers below are HEAD.

---

## R6.1 The aliasing loop on the success path — no NULL is left behind — concern REFUTED

The whole decision block, quoted:

    ggml-alloc.c:910   for (int i = 0; i < galloc->n_buffers; i++) {
    ggml-alloc.c:911       // if the buffer type is used multiple times, we reuse the same buffer
    ggml-alloc.c:912       for (int j = 0; j < i; j++) {
    ggml-alloc.c:913           if (galloc->buf_tallocs[j] == galloc->buf_tallocs[i]) {
    ggml-alloc.c:914               galloc->buffers[i] = galloc->buffers[j];
    ggml-alloc.c:915               break;
    ggml-alloc.c:916           }
    ggml-alloc.c:917       }
    ggml-alloc.c:920       bool realloc = galloc->buffers[i] == NULL;
    ggml-alloc.c:922       for (int c = 0; c < galloc->buf_tallocs[i]->n_chunks; c++) {
    ggml-alloc.c:923           size_t cur_chunk_size = galloc->buffers[i] ? ggml_vbuffer_chunk_size(galloc->buffers[i], c) : 0;
    ggml-alloc.c:924           size_t new_chunk_size = ggml_dyn_tallocr_max_size(galloc->buf_tallocs[i], c);
    ggml-alloc.c:926           if (new_chunk_size > cur_chunk_size) {
    ggml-alloc.c:927               realloc = true;
    ggml-alloc.c:943           struct vbuffer * buffer_old = galloc->buffers[i];
    ggml-alloc.c:944           ggml_vbuffer_free(buffer_old);
    ggml-alloc.c:945           for (int j = 0; j < galloc->n_buffers; j++) {
    ggml-alloc.c:946               if (galloc->buffers[j] == buffer_old) {
    ggml-alloc.c:947                   galloc->buffers[j] = NULL;
    ggml-alloc.c:950           if (!no_alloc) {
    ggml-alloc.c:951               galloc->buffers[i] = ggml_vbuffer_alloc(...);
    ggml-alloc.c:959                   galloc->n_nodes = -1;
    ggml-alloc.c:960                   return false;
    ggml-alloc.c:966   return true;

**The alias assignment is not inside the size-check branch, so it cannot be skipped.** Line 914
runs unconditionally at the top of every iteration for any `i` that has a same-buft predecessor,
before `realloc` is even computed at 920. The question's premise ("slot j's size check says no
realloc is needed, so it may skip the alias assignment") is **REFUTED**: the no-realloc branch is
safe precisely *because* 914 already installed the canonical's new pointer before 920/923 read it.

**Canonical-first, so only one slot per group can reallocate.** The talloc dedup at creation
(`ggml-alloc.c:516-521 if (bufts[i] == bufts[j]) { galloc->buf_tallocs[i] = galloc->buf_tallocs[j]; break; }`)
makes the smallest index of a buft group the owner; every later member borrows an earlier talloc.
Hence for any `i` after the canonical:

- line 914 sets `buffers[i] = buffers[canonical]` before anything reads `buffers[i]`;
- `buf_tallocs[i]` **is the same object** as the canonical's talloc, so the 922-928 comparison
  reproduces exactly the decision already made for the canonical. If the canonical reallocated,
  `buffers[i]` is already the new vbuffer -> no growth; if the canonical kept its buffer, there is
  no growth either. So `realloc` at 920 is false for every non-canonical member and only the
  canonical can enter the clearing block with a layout change.
- Therefore the set of slots the loop NULLs is exactly the canonical's alias group (`buffers[j] ==
  buffer_old`), and only for `j >= i`: `j == i` is re-pointed at 951 on success, every `j > i` is
  re-pointed at 914 in its own iteration, which precedes its own 920/923 read. The loop has exactly
  two exits, `return false` at 960 (failure, n_nodes poisoned, group all-NULL, a retry re-reserves)
  and `return true` at 966; nothing reads a cleared slot in between.

**j < i and the cross-group question.** A `j < i` in the same group cannot exist (the canonical is
its minimum), and a `j < i` of a *different* group cannot hold `buffer_old`: a vbuffer is allocated
against exactly one talloc at 951, and two live vbuffers cannot occupy the same address — so a
later group's `buffer_old` can never compare equal to an earlier group's live buffer. The clearing
loop therefore never NULLs a slot that will not be visited later in the same call. Address reuse
cannot defeat this either: for the clearing loop to hit a *live* slot, two live vbuffers would have
to share an address, which the allocator cannot produce.

**no_alloc.** The clearing loop is before `if (!no_alloc)` at 950, so in measurement mode the whole
group ends NULL. That is the documented contract (`ggml_gallocr_reserve_n_size` calls
`reserve_n_impl(..., /*no_alloc =*/ true)` only to fill `sizes`), no reader runs inside the call,
`ggml_gallocr_get_buffer_size` is NULL-guarded (1121-1123), and `ggml_gallocr_free` frees NULL
harmlessly. This is strictly better than before: the old code NULLed only `buffers[i]` and left the
aliases pointing at the **freed** vbuffer, a real dangling pointer in the measurement path.

**Readers after a successful `no_alloc == false` reserve.** The invariant "`buffers[k] != NULL` for
all k" still holds: `realloc == false` at 920 requires non-NULL, and `realloc == true` ends in a
non-NULL assignment at 951 or `return false` at 960. So:

- `ggml_gallocr_init_tensor` (`ggml-alloc.c:1005 ggml_vbuffer_tensor_alloc(galloc->buffers[buffer_id], ...)`)
  cannot see NULL — and every group slot points at the same new vbuffer, so the plan's buffer_ids
  (which may name the alias index) resolve correctly.
- `ggml_gallocr_get_buffer_size` (1118-1134) NULL-checks and pointer-dedups (1125-1131), safe.
- `ggml_gallocr_free` (543-556) dedups by identity at 547-551; with the clearing loop no slot points
  at a freed vbuffer any more, so the ASan heap-use-after-free at `ggml_vbuffer_free` (406-407) from
  line 554 is fixed, not relocated.
- `ggml_gallocr_alloc_graph`'s reset loop (1088-1092) is NULL-guarded anyway.

**Verdict on the main question: concern REFUTED, fix safe.** One wording correction: the commit
message's "success path unchanged (the slot is reassigned immediately)" is true as an end state
(net state identical to pre-fix) but false as a mechanism — the clearing loop *does* run on the
success path, and what makes it safe is the canonical-first ordering plus the unconditional alias
assignment at 914. That invariant should be a comment on 911-917 or the loop; it is the thing a
future edit could break by moving either block.

---

## R6.2 `722c07078` — `node_allocs = NULL` with `n_nodes = 0` — CONFIRMED safe

    ggml-alloc.c:851   if (galloc->n_nodes < graph->n_nodes) {
    ggml-alloc.c:852       free(galloc->node_allocs);
    ggml-alloc.c:853       galloc->node_allocs = NULL;
    ggml-alloc.c:856       if (graph->n_nodes > 0) {
    ggml-alloc.c:857           galloc->node_allocs = calloc(graph->n_nodes, sizeof(struct node_alloc));
    ggml-alloc.c:858           GGML_ASSERT(galloc->node_allocs != NULL);
    ggml-alloc.c:861   galloc->n_nodes = graph->n_nodes;

Every `node_allocs` dereference is inside a loop bounded by `graph->n_nodes`:

    ggml-alloc.c:862-864   for (int i = 0; i < graph->n_nodes; i++) { ... &galloc->node_allocs[i];
    ggml-alloc.c:1042-1044 for (int i = 0; i < graph->n_nodes; i++) { ... &galloc->node_allocs[i];
    ggml-alloc.c:1102-1104 for (int i = 0; i < graph->n_nodes; i++) { ... &galloc->node_allocs[i];

and the only other reference is `free(galloc->node_allocs)` at 577. There is no loop anywhere that
iterates `galloc->n_nodes` over `node_allocs`. With `node_allocs == NULL` and `n_nodes == 0`:
`ggml_gallocr_needs_realloc` (1027) checks `n_nodes` (1032) and `n_leafs` (1035) first and reaches
the node loop at 1042 with zero iterations, returning false without a dereference;
`ggml_gallocr_alloc_graph` reaches 1102 with zero iterations. `free(NULL)` at 577 is well-defined.
The invariant "`n_nodes > 0` implies `node_allocs != NULL`" also holds: the array is NULLed only in
the `graph->n_nodes == 0` branch and calloc'd whenever `graph->n_nodes > 0`, so a later non-empty
reserve re-allocates it. **CONFIRMED.**

The report's claim that the leaf side cannot hit `calloc(0)` is also correct: `n_leafs` is only ever
assigned from `graph->n_leafs` (894) and is never poisoned, so `galloc->n_leafs < graph->n_leafs`
(889) with `graph->n_leafs == 0` is false — a positive count is the only way into that branch.

---

## R6.3 The three tests

**State restoration: nothing to restore — REFUTED as a concern.** `tests/test-alloc.cpp`'s only
mutable global is `uint8_t * const alloc_base` at line 15, which is never assigned; `fail_alloc`
lives in each test's own `dummy_backend_context`; all scheds/contexts are RAII pointers destroyed at
scope end. The three tests write only their own locals. `a6f3324be` restores `fail_alloc = false`
as part of its scenario (not as cleanup); the other two leave it true in a context that dies with
the test. No cross-test statics, no order dependence (the new tests run last, lines 780-783).

**`a6f3324be` recovery assertion — correct mechanism, weak teeth — CONFIRMED (limited).**

    tests/test-alloc.cpp:682-685 /* recovery comment */ backend.context->fail_alloc = false;
                             GGML_ASSERT(ggml_backend_sched_alloc_graph(sched.get(), graph));
                             GGML_ASSERT(x[0]->data != nullptr && x[1]->data != nullptr);

The third call takes `needs_realloc == true` from the poison (`n_nodes = -1`), the single-buffer
auto-reserve succeeds, and `ggml_gallocr_init_tensor` (1005) sets `data` via
`ggml_backend_tensor_alloc` — so "data set" does prove an allocation ran. It does **not** prove the
buffer is fresh: a stale-but-live vbuffer would set the same pointers, and only an ASan/plain
allocator would notice. The red for this test still dies at call 2 without the poison, so the new
assertion has no red of its own — declared by the writer, and the reason the third call's real
teeth are the ASan run, not the assertion.

**`34fca920f` alias test red for the right reason — CONFIRMED by code path (ASan log is the writer's).**
The mechanism is exactly as reported: `ggml_backend_sched_new` keeps `n_backends = 2` and passes the
duplicated `bufts` to `ggml_gallocr_new_n` (`ggml-backend.cpp:1900-1912`), so the galloc has two
slots sharing one talloc (510-521); graph1 allocates the shared vbuffer and aliases slot 1 at 914;
`ggml_backend_sched_reset` clears only sched bookkeeping, not the galloc; graph2 is larger (two
32-byte leaves both live at the add, so a peak of at least 64 bytes, versus graph1's one 20-byte
leaf plus one 20-byte node, at most 48), so line 926 sets `realloc = true`, line 944 frees the
shared vbuffer, `fail_alloc` makes 951 return NULL and the function return false at 960 — leaving
slot 1 dangling without the fix; the sched destructor then reaches `ggml_gallocr_free:554 -> ggml_vbuffer_free:406-407` and
frees it again. That is the audit's Round-1 §3 double free, now reproducible. Caveat: without ASan
the same double free can be silent, so the plain-build 17/17 is not evidence of the fix; the writer
declares the ASan build, and I did not build.

**`722c07078` zero-node test — path correct, no red possible — CONFIRMED (declared).**
`GGML_ASSERT(!ggml_backend_sched_alloc_graph(sched.get(), graph))` poisons `n_nodes = -1`; the retry
with the empty graph enters 851 as `-1 < 0`, hits the guarded branch (853-859), sets `n_nodes = 0`,
and the buffer loop allocates an empty (zero-chunk) vbuffer, so the second `alloc_graph` returns
true. On macOS `calloc(0)` returns non-NULL, so the test cannot distinguish guarded from unguarded
code here — it pins the path, not the guard. Declared by the writer.

Test count: 17 `run(` calls, last four at `tests/test-alloc.cpp:780-783`; the reported 17/17 is
internally consistent.

---

## R6.4 Carried over, unchanged by these commits

- The poison comment at `ggml-alloc.c:954-959` still says "Invalidate the plan" while only
  `n_nodes` is invalidated; `galloc->n_leafs` and the recorded `leaf_allocs`/`node_allocs[i].src[]`
  stay stale, and correctness still rests on the `n_nodes` check (1032) preceding the `n_leafs`
  check (1035) in `needs_realloc` (Round-2 R2.3, still open as documentation).
- `ggml_cl_buffer::allocate`'s compute-time abort (`ggml-opencl.cpp:389` via `CL_CHECK` ->
  `GGML_ASSERT(0)` at `ggml-opencl.cpp:68-76` -> `abort()` at `ggml/src/ggml.c:272`) unchanged
  (Rounds 1-2 §2.6 / R5.5).
- No device or Android run, per the standing instructions; the ASan red/green and the 17/17 runs are
  the writer's evidence, not re-derived here.

---

## Round 3 findings summary

| # | finding | verdict |
|---|---|---|
| R6.1 | Alias clearing on the success path leaves no NULL: canonical-first ordering + unconditional alias assignment at 914 before any read | CONFIRMED (concern REFUTED) |
| R6.1b | "The alias assignment may be skipped when no realloc is needed" | REFUTED (it is at 912-917, before the 920 decision) |
| R6.1c | `34fca920f` message "success path unchanged ... reassigned immediately": true as end state, wrong as mechanism | CONFIRMED (end state) / REFUTED (mechanism) |
| R6.2 | `node_allocs = NULL` with `n_nodes = 0`; all derefs are inside `graph->n_nodes` loops | CONFIRMED safe |
| R6.3a | Tests mutate only locals; nothing global to restore | CONFIRMED (no restore needed) |
| R6.3b | Alias test is red for the right reason (UAF at `ggml_vbuffer_free:406-407` from `gallocr_free:554`) | CONFIRMED by code path; ASan log not re-run |
| R6.3c | Recovery assertion is green-only and proves allocation, not freshness | CONFIRMED (limited, declared) |
| R6.3d | Zero-node test pins the path but cannot go red for the guard on this libc | CONFIRMED (declared) |
| R6.4 | Poison still only invalidates `n_nodes`; comment says "the plan" | PLAUSIBLE (documentation, carried over) |
