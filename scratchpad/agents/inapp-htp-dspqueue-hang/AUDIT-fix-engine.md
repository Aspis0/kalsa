# Hostile audit — engine fix a493a436b + a48cc3e08 (bounded Hexagon dspqueue failures)

Date: 2026-10-01. Subject: `~/Projects/kalsallama` `main`, `git diff e775fb2bf a48cc3e08`
(139 insertions, 8 deletions, 2 files; all line numbers below are HEAD = `a48cc3e08`).
Read-only: no edit, no commit, no device. One scratch worktree (`/tmp/kalsa-audit-wt`, removed).
Report under audit: `FIX-engine.md`. Root cause docs: `DIAGNOSIS.md`, `DEVICE-skel-swap.md`.

## Verdict: FIX FIRST

The deadline is the one thing that matters and it is correct. The other 130 lines either do not do
what their log message claims, or are unreachable in the failure mode they were written for, and
three hard aborts plus one unbounded spin survive inside the "no more aborts / bounded wait" claim.
Nothing here is dangerous to run — the worst case is still bounded — but the fix does not yet meet
its own stated goals, and it lands as the fork's first local patch to a pristine upstream file.

Blocking items: **A1** (unbounded spin left), **A2** (two aborts left), **A4** (wrong knob for the
probe), **A3** (the new shape check does not check what it says). Everything else is follow-up.

---

## 1. Wait paths, deadline arithmetic, env parsing, default value

### A1. `ggml_hexagon_event_synchronize` still spins forever — CONFIRMED
`ggml/src/ggml-hexagon/ggml-hexagon.cpp:7375-7388`
```cpp
    while (true) {
        if (hex_event->sess->last_error > HTP_STATUS_OK) {
            return;
        }
        if ((int32_t)(fence[0].load(std::memory_order_acquire) - hex_event->seq) >= 0) {
            ...
            break;
        }
        std::this_thread::yield();
    }
```
No deadline, no `dspqueue_read`, nothing. The new `flush_pending()` at `:7369` only covers the case
where the fence op is still inside an undrained batch. Once every batch response has been popped
with `status == OK`, this loop waits for a **fence slot the DSP writes itself**, forever, at 100%
of one core.

Failure scenario: any skel whose fence protocol differs (the old fence was a single
`atomic_uint`; the new one is `htp/htp-fence.h` 128-byte slots with seq+status records — see
DIAGNOSIS §1.1) and that acknowledges the batch without writing the host's expected `seq` word.
`flush_pending` returns SUCCESS, the loop spins, `last_error` stays `HTP_STATUS_OK`, so the new
error checks never fire. That is the *reported* hang, unchanged. `event_record`/`event_synchronize`
are on the sched hot path (`ggml-backend.cpp:1682,1693,1717,1808`), so this is not a cold path.
Fix: same deadline (or a fraction of it) around the spin, then set `last_error` and return.

### A2. Response-read is bounded; request-write is not, and it aborts — CONFIRMED
`:3587-3603` bounds the wait; `:3712-3722` does not:
```cpp
    int err = dspqueue_write(this->queue, 0, 1, &dbuf, sizeof(req), (const uint8_t*) &req, DSPQUEUE_TIMEOUT);
    if (err != 0) {
        GGML_ABORT("ggml-hex: %s dspqueue_write failed: 0x%08x\n", this->c_name(), (unsigned) err);
    }
```
`DSPQUEUE_TIMEOUT` is `1000000` µs (`htp-drv.h:88`). A DSP that stopped consuming requests (dead
skel, DSP fault while chewing the garbage counts of DIAGNOSIS §1.3) fills the queue; the next
`flush_batch` reaches `GGML_ABORT` — a mid-run abort in exactly the scenario the fix targets.
The fix also makes this *more* reachable than before: after a timeout the host stops draining the
response queue, so the queue it stopped servicing is the same one it would write to.

### A3. Env parse and deadline arithmetic are correct — REFUTED (no finding)
`:8386-8401`. I compiled the parse block standalone and ran 15 inputs:
`"4294967296"`, `"0"`, `"-1"`, `"+5"`, `" 5"`, `"5 "`, `"0x10"`, `"1e3"`,
`"99999999999999999999999"`, `""`, `"abc"`, `"30\n"` are all rejected with the default kept;
`"1"`, `"30"`, `"30000"`, `"4294967295"` accepted. Deadline math checked at the extreme:
`steady_clock::now() + milliseconds(4294967295)` = exactly 4 294 967 295 ms = 4.2949e15 ns, no
`int64` overflow (`duration_cast<milliseconds>` round-trips exactly). `errno` is zeroed before
`strtoul`. Strict and correct; only cosmetic wart: the warn line prints `opt_rsp_timeout_ms` as
"default", which is wrong if the registry init runs twice and the first parse already set a value.

Accepted ceiling: `UINT32_MAX` ms ≈ **49.7 days**, i.e. `GGML_HEXAGON_RSP_TIMEOUT_MS=4294967295`
silently restores the original unbounded hang. A max of, say, 10 minutes costs nothing.

### A4. 30 s is the wrong value for the probe and the wrong *shape* of knob — CONFIRMED (design)
One knob now serves two opposite requirements: "do not kill a legitimate batch" (wants ≥ 10 s) and
"notice a dead DSP fast" (wants ≤ 2 s). The health check is a **1-op FILL** (`:6964-6981`) whose
whole point is to fail fast; with the fix it costs the **full 30 s**, and `FIX-engine.md` budgets it
as such (`elapsed <= 35`, "before the 30-second batch deadline"). Per DIAGNOSIS §2.3 the promised
in-app behaviour is "the current turn fails with a visible error instead of hanging" — with this
default it is "fails after 30 s", on every model load, for the whole life of the bad APK.
A healthy 1-op round trip is sub-millisecond on this hardware (`raw/fixtest-M1-run.txt`: pp64 =
532 tok/s, i.e. 0.12 s for 64 tokens).
Fix: separate `GGML_HEXAGON_HEALTHCHECK_TIMEOUT_MS` (default 2000) or clamp the probe to
`min(opt_rsp_timeout_ms, 2000)`. One line.

### A5. 30 s cannot falsely kill a real S23 batch — REFUTED (quantified, with a cliff)
`flush_pending` waits for *all* outstanding batches (`while (batch_rsp_seq < batch_req_seq)`), and
`flush_sync` runs once per `graph_compute`, so the exposure is "one ubatch's total HTP time".
At the measured `pp64 = 511.18 tok/s` (`DEVICE-skel-swap.md:66`) with the campaign's `-ub 64`
(`FIX-engine.md:59`): 64/511 = **0.125 s**, a 240x margin. At llama's default `n_ubatch = 512`:
1.0 s, 30x margin. Even with `-ub 2048` (4.0 s) plus a 3x cold-start/thermal penalty: 12 s, still
2.5x under. The cliff is at **~15 300 tokens in one ubatch** (30 s × 511 tok/s), i.e. 30x any
ubatch this campaign uses. Depth 32 outstanding batches (`opt_opqueue = 32`, `:116`) is never
approached because `opt_opbatch = 1280` ops/batch (`:115`) fits a whole prefill graph in 1–2
batches. Default is safe.
One residual: each mdev sub-session gets its **own** deadline (`:3566` recurses before `:3576`
computes `wait_start`), so worst-case stall is `N × 30 s` for an `N`-way `HTP0,HTP1` group. The S23
is single-NPU so `mdev.count == 1`; latent for the multi-NPU lane.

### A6. With `GGML_HEXAGON_OPPOLL`, the 30 s is a full-core spin — CONFIRMED (minor)
`:3587` `const uint32_t timeo = opt_oppoll ? 0 : DSPQUEUE_TIMEOUT;` → `dspqueue_read` returns
`AEE_EWOULDBLOCK` instantly, `continue`, deadline checked, repeat. Bounded, but it burns one core
at 100% for the whole 30 s. Pre-existing shape; now bounded. Worth 2 ms of `usleep`.

---

## 2. After a timeout: late DSP work, reuse, teardown

### B1. No quiesce, no teardown, sequence counters left dangling — CONFIRMED
The timeout branch (`:3590-3598`) sets `last_error` and returns. Nothing stops the DSP
(`htp_iface_stop` is only in `release()`, `:4324`), nothing drains the queue, `batch_rsp_seq` stays
`< batch_req_seq` forever, and `op_queue->shm_buf` stays mapped. `ggml_backend_hexagon_free` is
`delete backend;` (`:6635-6639`) — the session belongs to the registry and outlives every backend.
Failure scenario (genuine mid-batch hang, not the early-`return` skew): the DSP is still executing
the batch when the host gives up. Host-side damage is limited **because** `last_error` is sticky and
`graph_compute` returns at `:6835` before touching anything, so the scheduler cannot hand those
buffers to a retry — that is the one thing this fix gets right. The residual damage is at
teardown: `buffer_free_buffer` (`:783-786`) munmaps dma-bufs with no wait, `release()` (`:4315`)
does not drain, and then:
```cpp
        err = htp_iface_stop(this->handle);
        if (err != 0) {
            GGML_ABORT("ggml-hex: htp_iface_stop failed: 0x%08x\n", (unsigned) err);   // :4326
```
```cpp
        err = dspqueue_close(queue);
        if (err != 0) {
            GGML_ABORT("ggml-hex: dspqueue_close failed: 0x%08x\n", (unsigned) err);   // :4364
```
both inside a `noexcept(true)` function. So a wedged DSP converts the mid-run abort the fix set out
to remove into an **abort at process teardown**. `release()` also `mdev.sessions.clear()`s first,
so every sub-session gets its own chance to abort.
Note the counterfactual: for the *reported* skew the DSP returns before doing any work
(`htp/main.c:1172-1174`), so nothing is in flight and B1 is inert. It becomes live for the hang
class the fix also claims to cover.

### B2. Timeout does not propagate to mdev sub-sessions, the DSP-status path does — CONFIRMED
`:3590-3598` sets `this->last_error` only. `:3653-3657` sets it on every sub as well:
```cpp
            this->last_error = rsp.status;
            for (auto & sub : this->mdev.sessions) {
                sub->last_error = rsp.status;
            }
```
Four of the five new error exits (timeout + the three shape/seq exits) skip that loop. Inconsistent,
and the sub that keeps `last_error == OK` is the one that can still be pushed to and can reach
A2's `dspqueue_write` abort.

### B3. No recovery: one timeout bricks the device for the process — CONFIRMED (design)
`allocate()` is called once, from the constructor (`:4384`), and it is the only place that resets
`last_error` (`:4115`). `ggml_backend_hexagon_device_context::session()` hands the same session to
every backend of the device, and the health check itself runs on it. So after one timeout — or one
failed health check — **HTP is dead for the rest of the process and cannot be re-probed**, and a
second `device_init` returns a backend whose first `graph_compute` is a guaranteed `FAILED`
(`:6836`). If the binding's fallback path ever re-inits HTP in the same process, it gets a corpse.
Sticky-and-doomed is a defensible choice for a wedge, but it must be a choice, and `release()` must
then own the recovery.

---

## 3. Fail-fast coverage

### C1. Error reaches `llama_decode` as an error, not an abort — REFUTED (confirmed working)
Traced: `:6958 return GGML_STATUS_FAILED` → `ggml-backend.cpp:463` → `compute_splits` returns `ec`
(`ggml-backend.cpp:1817-1820`) → `ggml-backend.cpp:2045` → `llama-context.cpp:2615` → `:1462-1467`
returns `nullptr` → `llama-context.cpp:1933-1935` maps `GGML_STATUS_FAILED` to `-3`.
`llama-bench` turns that into `test_prompt: failed to decode prompt batch, res = -3` +
`llama_bench: error: failed to run prompt warmup` and exits non-zero — visible in
`raw/fixtest-S1-run.txt`. The error path works.

### C2. Two aborts remain on the session-error path — CONFIRMED (blocking)
`:7455-7457` and `:7487-7489`, unchanged by the diff:
```cpp
    sess->flush_sync();
    if (sess->last_error > HTP_STATUS_OK) {
        GGML_ABORT("ggml-hex: %s get-tensor-async failed : dsp-error %s\n", sess->c_name(), status_to_str(sess->last_error));
    }
```
```cpp
        GGML_ABORT("ggml-hex: %s get-tensor-2d-async failed : dsp-error %s\n", sess->c_name(), status_to_str(sess->last_error));
```
Reachable, not theoretical: `ggml-backend.cpp:1743` calls `ggml_backend_tensor_get_async` on the
split backend inside the MoE "which experts were used" path, and kalsallama is an MoE lab. One
session error + one MoE split = `GGML_ABORT` inside `GGML_STATUS_FAILED` propagation. This is the
exact line pair the fix was supposed to delete; it deleted the one in `synchronize` and left these.
Same treatment needed (`GGML_LOG_ERROR`, no abort).

### C3. Post-error `enqueue_*` can still abort — CONFIRMED
`enqueue_op` has no `last_error` guard, and `flush_batch` returns early **before**
`op_batch->reset()` (`:3680` vs `:3725`), so the failed batch's ops stay in `op_batch`. Callers that
do not check the error state and keep enqueueing: `ggml_backend_hexagon_cpy_tensor_async` → 
`enqueue_cpy` (`:7296-7318`, no guard) and `event_record` → `enqueue_fence` (`:7416-7428`, no guard).
```cpp
    if (!op_batch->fit_op(node)) {
        GGML_ABORT("ggml-hex: %s op does not fit into empty batch (vmem/tensor/buffer limit exceeded)\n",
                   c_name());                                              // :3760
    }
```
Failure scenario: session error → op_batch holds a near-full 1280-op batch → the next split-input
copy or event record cannot fit → `flush_async()` is a no-op → `op_batch->empty()` is false →
`GGML_ABORT`. Plus an unbounded `op_batch` / `cloned_buffers` growth in the meantime
(`enqueue_op` still clones every tensor buffer at `:3729-3746`).

### C4. `synchronize` is now a silent lie — CONFIRMED (regression in detectability)
`:6984-6991`
```cpp
    // Wait until all pending ops complete
    sess->flush_sync();
```
The abort is gone (correct) but `iface.synchronize` returns `void`, so nothing is reported
anywhere. Every caller of `ggml_backend_synchronize()` after a session error now believes it
succeeded and reads stale/never-written memory. Concrete site: `ggml-backend.cpp:1743-1745`
(get ids, then `ggml_backend_synchronize(ids_backend)`) feeds expert selection. Before this change
that was a loud abort; now it is a quiet wrong answer. At minimum, log once and expose
`last_error` through the new proc-address so the binding can ask.

### C5. Entry points that honour the error state — inventory
`graph_compute` `:6835` ✅ · `flush_batch` `:3680` ✅ · `flush_pending` `:3562` ✅ ·
`push` retry `:3694` ✅ (and it now skips the second push, which previously could fire with a
zero-initialised `dbuf`) · `event_synchronize` `:7370,7376` ✅ but unbounded (A1) ·
`event_record` ❌ (C3) · `event_wait` ❌ (no guard, enqueues) · `cpy_tensor_async` ❌ (C3) ·
`set_tensor_async` ❌ (harmless memcpy, but writes into shm a wedged DSP may still be using) ·
`get_tensor_async` ❌ aborts (C2) · `synchronize` ❌ silent (C4) · `buffer_clear` ❌ (memset over
possibly-live shm) · `release` ❌ aborts (B1).

---

## 4. Health check

### D1. It is a real data-plane round trip — REFUTED (claim holds)
`ggml_backend_hexagon_healthcheck` (`:6964-6981`) allocates on the HTP buffer type and calls
`graph_compute`, i.e. `enqueue_op` → `op_batch` → `dspqueue_write` → skel → `dspqueue_read`. Not
control plane. `GGML_OP_FILL` is genuinely supported host-side (`:6676`, `supported_fill` `:7699`,
DSP `htp/fill-ops.c`), so it will not false-FAIL for lack of op support.
Two honest limits: (a) it checks **liveness, not data** — the filled tensor is never read back, so a
skel that acknowledges with `status = OK` and computes nothing passes; (b) 1 op cannot detect a skew
whose symptom needs a large batch. For *this* skew (b) is fine — with 1 op the old skel's garbage
counts give a total that exceeds `dbuf->size`, so it either early-`return`s (→ timeout) or answers
in the old layout (→ the new seq check fires). But the probe's sensitivity is strictly lower than the
real prefill's, and `FIX-engine.md` should say so instead of calling it "data-plane healthcheck".

### D2. It is not side-effect-free and not thread-safe — CONFIRMED
* A **failed** check poisons the session (B3), so a false negative — including one caused by a
  failed `ggml_backend_alloc_ctx_tensors` under load-time resource pressure — permanently disables
  HTP for the process with no retry and no re-probe.
* A **successful** check mutates the shared session: allocates a buffer, bumps `batch_req_seq` 0→1,
  pushes and pops a batch. There is **no mutex** anywhere in the session (the only `std::mutex` is
  the registry's device enumeration, `:8628`). Calling the exported proc address while another
  thread is in `graph_compute` on the same device races on `op_batch` and lets the probe's
  `flush_sync()` consume the other thread's responses. Intended call site (resolver time, before
  load) is safe; the exported symbol has no contract saying so.
* `:7529-7544`: `auto backend = new ggml_backend{...}` then a throwing statement, then
  `return backend;` then dead `GGML_UNUSED(params);`. On a throw from the probe the backend leaks
  (and `device_init` has no handler). Wrap in `std::unique_ptr` and move the `GGML_UNUSED` above.

### D3. Lane-off behaviour and cost — REFUTED (claim holds)
`device_init` gates on `GGML_HEXAGON_HEALTHCHECK=1` (`:7537-7541`); with the lane off nothing is
submitted. Healthy cost: one 1-op round trip + one small dma-buf alloc/free per `device_init` —
negligible. `ggml_backend_hexagon_device_healthcheck` itself is ungated (by design, the caller
gates), so "must not run when the lane is off" now depends entirely on binding discipline.

### D4. Log level of the result line — CONFIRMED (small, but it breaks the acceptance test's grep)
```cpp
        GGML_LOG_INFO("ggml-hex: HTP data-plane healthcheck %s\n", ok ? "PASS" : "FAIL");   // :7540
```
For the *statically linked* build, `common_log_default_callback` (`common/log.cpp:542`) maps
`GGML_LOG_LEVEL_INFO` → `LOG_LEVEL_TRACE (4)` and drops it unless `common_log_verbosity_thold`
(never raised outside tests) is ≥ 4, so `llama-cli` would never print it. Empirically the
*dynamically loaded* build does print INFO (`raw/fixtest-*-run.txt` shows
`ggml-hex: batch response timeout 30000 ms` from `:7960`), because the dlopened `.so` has its own
copy of `g_logger_state` and never sees `llama_log_set`. Two consequences: the result line's
visibility depends on the link mode, and `--verbosity` cannot control the hexagon backend's logs in
the DL build at all. Use `GGML_LOG_ERROR` for a PASS/FAIL verdict; keep the `:7960` banner but note
that an operator cannot silence or raise it.

---

## 5. Upstream friendliness

### E1. This is the fork's first local patch to a pristine upstream file — CONFIRMED (blocking for upstreaming, not for shipping)
`git log e3c43a9db..HEAD --name-only -- ggml/src` returns exactly three files:
`ggml-cpu.c`, `ggml-hexagon.cpp`, `htp/htp-ops.h`. Before this diff, `ggml-hexagon.cpp` had **zero**
local commits since the `b11304` merge (`e3c43a9db`) — every prior commit in
`git log -- ggml/src/ggml-hexagon/ggml-hexagon.cpp` is upstream's. `CODEOWNERS` assigns
`ggml/src/ggml-hexagon` to `@lhez, @max-krasnyansky`. So 139 local lines now sit in a hot
upstream function (`flush_pending`, the multi-device protocol code that upstream rewrote in
`eafe15a5e` and broke once), plus:
* a new fork env var in the upstream env block (`:8333`, `:8386-8401`);
* a new value in `enum htp_status` (`:14` `htp/htp-ops.h`) — a **shared** header compiled into both
  the host and the DSP skel, whose members are DSP wire values. `HTP_STATUS_TIMEOUT = 6` is a
  host-invented sentinel that flows through `last_error` → `status_to_str` → user-visible "TIMEOUT".
  If upstream ever gives the DSP a status 6, the host silently relabels it. Use a host-only
  sentinel outside the DSP enum (or at least a `/* host-only */` comment).
* an exported `static` symbol reachable only through `ggml_backend_reg_get_proc_address`
  (`:8175-8177`), with **no declaration in any header, no typedef, no doc, no test** — so nothing
  upstream can see, review or break. The binding must hand-cast `void*` to
  `bool (*)(ggml_backend_dev_t)`, which is exactly the kind of contract that rots silently.
Nothing is marked as a local patch (there is no marker convention in the tree, so this is not a
convention violation — but there should be one).
Realistic conflict surface on the next `git merge upstream/tag/bXXXXX`: `flush_pending` (whole
function body), `ggml_backend_hexagon_init` (env block), `htp-ops.h` (enum tail),
`ggml_backend_hexagon_device_init`. Locality is otherwise good — the changes sit inside the
functions they must touch. If upstreaming is the goal (and it should be: this is a real upstream bug
in a backend upstream maintains), the minimum is a typedef + declaration in `ggml-hexagon.h`,
a `ggml_status`-returning healthcheck, and an upstream PR against `lhez`.

---

## 6. Response validation (a48cc3e08): off-by-one, trusted lengths, overflow

### F1. `expected_ops` is vacuous — CONFIRMED (blocking; the check does not check what it says)
`:3623-3625`
```cpp
        const uint32_t slot = (uint32_t) ((rsp.seq - 1) % op_queue->depth);
        const size_t expected_ops = op_queue->op_cache[slot].size();
        if (rsp.n_bufs > HTP_OP_MAX_BUFS || rsp.n_tensors > HTP_OP_MAX_TENSORS || rsp.n_ops > expected_ops) {
```
`op_cache[slot]` is filled by `op_cache[slot] = op_batch->ops;` (`:3432`) and `op_batch->ops` is
**never sized down**: `reset()` does `ops.resize(n_ops_max)` (`:2450`). So
`expected_ops == opt_opbatch == 1280` on every call, for every slot, forever. The log prints
`"expected ... ops <= 1280"` — a capacity, not the batch's op count. `pop()`'s
`GGML_ASSERT(rsp.n_ops <= ops.size())` (`:3513`) has the same vacuous bound.
The check the DSP actually guarantees is stronger and is available: the skel echoes the request
verbatim — `rsp.n_bufs = n_bufs; rsp.n_tensors = n_tens; rsp.n_ops = n_ops;`
(`htp/main.c:1268-1270`, all read from `req` at `:1162-1164`). Exact equality against the pushed
request is the definitive skew test, and it catches *both* directions. `op_cache` currently stores
only `ops`, so this needs three `uint32_t` per slot next to it (one line in `push`, one in the
check) — and then the payload/trace heuristics below become redundant.

### F2. The check is one-sided where it matters — CONFIRMED
Nothing rejects `rsp.n_ops < req.n_ops`. A skel that processes 0 of 1280 ops and returns
`status = OK, n_ops = 0` passes every new check, `pop()` does nothing, `batch_rsp_seq` advances,
`graph_compute` returns SUCCESS, and the host reports a batch that was never computed. That is the
"distinguishable but equally broken outcome" DIAGNOSIS §1.3 warns about, and the new validation is
blind to it. F1's equality check closes it.

### F3. `dbuf.size < rsp_payload` is near-tautological — CONFIRMED (do not advertise it)
The skel echoes the host's own descriptor: `struct dspqueue_buffer write_dbuf = *dbuf;`
(`htp/main.c:1281`). So `dbuf.size` is the value `push` computed (`:3449`), compared against the
same formula's `rsp_payload`. It only fires when the DSP reports *fewer* counts than the block
holds. It is not "trusting a DSP-provided length" — good — but it is not the length validation the
commit message implies, and the `dbuf.ptr`/offset it accompanies are likewise host-provided, so the
DSP cannot steer the host's reads. The genuinely load-bearing bound is
`rsp_payload > op_queue->shm_blk_size`, and it is correct: `pop()` derives every pointer offset from
`rsp.n_*` (`:3494-3518`), so the whole read is clamped to one slot of the host's own mapping.

### F4. Integer overflow / off-by-one — REFUTED
* All three counts are bounded by constants before any arithmetic (`:3625`), so
  `sizeof(x) * (size_t) count` cannot overflow `size_t` (worst case ≈ 1280 × ~400 B).
* `dbuf.size` is `uint32_t` (`SDK dspqueue.h:127`), so `dbuf.size < rsp_payload` promotes cleanly;
  no signedness trap.
* No legitimate response is rejected. `n_tens_max = std::min(n_ops_max + n_ops_max*10, 8192)`
  (`:2458`) ⇒ a real batch has `n_tensors ≤ 8192 = HTP_OP_MAX_TENSORS`, and
  `shm_blk_size` is sized with `n_ops*14 = 17 920` tensors (`:3386-3390`), i.e. over-allocated, so
  `rsp_payload > shm_blk_size` cannot fire for a matched skel.
* Trace counts: the DSP bounds them by the **request's** `n_traces`
  (`ctx->trace[t].max_events = req->n_traces`, `htp/main.c:1195`), which the host sets to
  `opt_optrace` (`:3442`) — the same value the check compares against, so no false positive.
  The loop `for (i = 0; i <= HTP_MAX_NTHREADS; i++)` reads `rsp.n_traces[0..10]` and
  `n_traces` is declared `uint32_t n_traces[HTP_MAX_NTHREADS + 1]` (`htp-ops.h:262`) — in bounds.
* The size check runs **before** any field of `rsp` is read, and `rsp` is an uninitialised stack
  struct, so a short reply never exposes the garbage tail. Ordering is correct.

### F5. The one diagnostic for the payload branch is wrong — CONFIRMED (minor)
`:3646-3649`
```cpp
            GGML_LOG_ERROR("ggml-hex: %s batch response shape mismatch : expected payload <= %zu and buffer size >= %zu, got payload %zu buffer size %u trace counts invalid %d\n",
                           this->c_name(), op_queue->shm_blk_size, rsp_payload, rsp_payload, dbuf.size, bad_trace_shape);
```
`rsp_payload` is passed for both the "expected" and the "got" slot, so the two numbers are
identical by construction and the message reads as a tautology. (Not truncated, for the record:
`ggml.c:293-302` re-formats into a larger buffer when the 128-byte fast path overflows.) Also
`opt_profile == 3` is tested twice in a row (`:3636`, `:3640`). Split the message.

### F6. Compiles clean — REFUTED
I syntax-checked the whole translation unit with the real Hexagon SDK 6.4.0.2 headers plus the
generated `htp_iface.h`, `-Wall -Wextra`: **0 errors, 0 warnings in any changed line range**
(3561-3725, 6964-7000, 7357-7390, 7526-7555, 7960, 8175, 8333, 8386-8401). Pre-existing warnings
elsewhere only. `<chrono>` was already included (`:12`), so the new `std::chrono` use is fine;
`<errno.h>`/`<limits.h>`/`<cstdint>` additions are all used.

---

## 7. The report's verification recipe is broken — CONFIRMED

### G1. `test "$rc" -ne 0` will fail on `llama-cli` for reasons unrelated to the fix — CONFIRMED
`FIX-engine.md:59` asserts a non-zero exit for the stale arm. In this fork `llama-cli` is an HTTP
client of an **in-process server thread** (`tools/cli/cli-server.h:34-52`), and
`cli_context::run()` ends with `return 0;` unconditionally (`tools/cli/cli-context.cpp:747`);
`generate_completion`'s bool is discarded at `:695` and a stream error only calls
`ui::show_error` (`:386-390`). The server turns `ret < -1` into "Compute error." +
`abort_all_slots` and keeps running (`tools/server/server-context.cpp:3937-3966`, caught at
`:3119-3122`). So the stale arm exits **0** and the assertion fails for a reason that has nothing to
do with the engine. The matched arm's `test "$rc" -eq 0` is worse: it is satisfied by a run in
which nothing worked at all. (`llama-bench` *does* exit non-zero — see `raw/fixtest-S1-run.txt` —
so use bench, not cli, for the exit-code arm; keep the greps as the real assertions.)

### G2. The on-device evidence captured so far is partial and unexplained — CONFIRMED/PLAUSIBLE
`raw/fixtest-S1-run.txt` and `-M1-run.txt` prove the fixed binary ran (both contain the new
`ggml-hex: batch response timeout 30000 ms` banner) but **contain none of the session-construction
INFO lines** (`op batching: n-bufs ... ` from `:2472`, and the opqueue line at `:3400`) that must
appear between `load_backend: loaded HTP backend` and the first data-plane batch — even though
`raw/fixtest-S1-logcat.txt` proves the fastRPC handles were opened and the dspqueue created at
03:01:19.88. The capture is therefore incomplete, which means the absence of
`healthcheck FAIL` / `batch response timeout : seq …` in those files is **not** evidence that the new
diagnostics did not fire. Two loose ends must be closed before anyone calls this verified:
1. no run captured so far shows `HTP data-plane healthcheck PASS/FAIL`, i.e. **no evidence the probe
   ever executed** (was `GGML_HEXAGON_HEALTHCHECK=1` actually exported in those runs?);
2. S1 ends `res = -3` about **3 s** after session open — not 30 s, and with no hexagon error line.
   Both new `GGML_STATUS_FAILED` exits (`:6836`, `:6958`) require `last_error > HTP_STATUS_OK`, and
   every setter logs. So either the capture dropped the line, or that run failed on a path the new
   code does not log. Unresolved from the artefacts in this directory.
`FIX-engine.md`'s own "Not verified" section is honest about this; the point is that the follow-up
capture must be complete before the coordinator treats the fix as measured.

---

## Minimum to flip the verdict

1. **A1** — put a deadline around the `event_synchronize` fence spin (A1).
2. **C2** — delete both `GGML_ABORT`s in `get_tensor_async` / `get_tensor_2d_async` (C2).
3. **A4** — give the probe its own ~2 s deadline (A4).
4. **F1/F2** — store the pushed `n_bufs/n_tensors/n_ops` per slot and require exact equality (F1, F2);
   then drop or demote the payload/trace heuristics.
5. **C3** — one `last_error` guard in `enqueue_op` so a poisoned session cannot reach `:3760` (C3).
6. **G1** — switch the S23 exit-code arms to `llama-bench`, or delete the `rc` assertions (G1).
7. **C4/B1** — at minimum log once in `synchronize` and stop aborting in `release()`; ideally a
   `htp_iface_stop` + drain on the error path so the DSP is quiesced before buffers go away.
8. **E1** — move the healthcheck contract into a header (typedef + declaration) before this goes
   anywhere near an upstream PR.

Cosmetic, same commit: the duplicated `rsp_payload` argument (F5), the dead
`GGML_UNUSED(params)` after `return backend;` (D2), `UINT32_MAX` as an accepted timeout (A3), and
the timeout not propagating to mdev subs (B2).