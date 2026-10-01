# Hostile re-audit — five commits answering AUDIT-fix-engine.md

Date: 2026-10-01. Subject: `~/Projects/kalsallama` `main`, `git diff f4bdd0f29 643332f8f`
(246+/66-, `ggml-hexagon.cpp` + 1 deletion in `htp/htp-ops.h`). Commits `7d953dab0`, `b00d48a06`,
`3d159e864`, `220263119`, `643332f8f`. Report under audit: `FIX-engine.md` (same dir).
Read-only. Scratch worktree `/tmp/kalsa-audit-wt-r2` at `643332f8f` (detached), removed.
No device. All line numbers below are HEAD = `643332f8f` unless prefixed `OLD:` (= `a48cc3e08`).

## Verdict: FIX FIRST

Every CONFIRMED item from the previous audit is now genuinely closed — A1, A2, A3, A4, A6, B2,
C2, F1, F2, F5, G1, and the `htp-ops.h` half of E1 are real fixes, and F1 is the real thing this
time (exact equality against the pushed request, verified against the DSP echo at
`htp/main.c:1268-1270`). The writer did the work.

The problem is the other half. The diff bought that by adding a **process-wide recursive mutex to
eleven call sites**, by turning the fence spin into a **2 ms sleep taken while holding that
mutex**, and by rebuilding the health probe as **a second full fastRPC/HTP session constructed and
destroyed on every `device_init`**. Those are not hang fixes, they are architecture changes to the
hot path of a repo whose only product is throughput numbers, and the report's "Not verified"
section admits matched-skel pp64 was never re-measured. Three of the new items (N1, N2, N4) are
resource and unbounded-wait problems the fix was written to eliminate.

Blocking: **N7** (hot path globally serialized + 2 ms fence sleep under the global lock, unmeasured),
**N4** (probe's unbounded part is the skel load it just added, under the global lock),
**N1/N2** (second fastRPC session + ~41.6 MiB pinned per health check, `valid_session` dead),
**N3** (new exported API lazily constructs a whole session, unguarded),
**N6** (`GGML_HEXAGON_HEALTHCHECK=1` does not actually shorten the failure).

---

## 1. Re-verification of every previous item

### 1.1 Closed

**A1 — `event_synchronize` unbounded spin. FIXED.**
OLD `:7388` `std::this_thread::yield();` → NEW `:7507` `std::this_thread::sleep_for(std::chrono::milliseconds(2));`
plus NEW `:7500-7505`:
```cpp
        if (std::chrono::steady_clock::now() >= deadline) {
            const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::steady_clock::now() - wait_start).count();
            if (hex_event->sess->set_error(HTP_STATUS_TIMEOUT_HOST)) {
```
Bounded, sticky, logged once. See N7 for what the sleep costs.

**A2 — `dspqueue_write` aborts. FIXED**, both sites.
OLD `:3714`/`:3721` `GGML_ABORT("ggml-hex: %s dspqueue_write failed: 0x%08x\n", ...)` →
NEW `:3768-3775` `int err = dspqueue_write(this->queue, 0, 1, &dbuf, sizeof(req), (const uint8_t*) &req, DSPQUEUE_TIMEOUT);`
/ `if (this->set_error(HTP_STATUS_INTERNAL_ERR)) { GGML_LOG_ERROR(... "failed for batch seq %" PRIu64 ...) } return;`
Sub-site NEW `:3757-3763` likewise. See N12 for the residual.

**A3 — `UINT32_MAX` accepted as a timeout. FIXED.** NEW `:8558` `... || timeout_ms == 0 || timeout_ms > 600000)`,
and NEW `:8572` the same for the probe knob. 49.7 days no longer reachable.

**A4 — one knob for probe and batch. FIXED.** NEW `:127` `static uint32_t opt_probe_timeout_ms = 2000;`,
NEW `:515` `uint32_t rsp_timeout_override_ms = 0;`, NEW `:3604`
`const uint32_t timeout_ms = this->rsp_timeout_override_ms ? this->rsp_timeout_override_ms : opt_rsp_timeout_ms;`,
NEW `:7028` `sess->rsp_timeout_override_ms = opt_probe_timeout_ms;`. The 1-op probe now costs 2 s,
not 30 s. Arithmetic checked: override applies only to `flush_pending`; see N13 for the gap.

**A6 — `GGML_HEXAGON_OPPOLL` full-core spin. FIXED.** NEW `:3632`
`if (opt_oppoll) std::this_thread::sleep_for(std::chrono::milliseconds(2));`
Also NEW `:3624-3625` clamps the blocking read to the remaining deadline:
```cpp
        const uint32_t timeo = opt_oppoll ? 0 : (uint32_t) std::min<int64_t>(
            std::chrono::duration_cast<std::chrono::microseconds>(deadline - now).count(), DSPQUEUE_TIMEOUT);
```
Correct: `now >= deadline` was already checked at `:3608`, so `deadline - now > 0`; sub-µs remainder
collapses to `timeo == 0` → `EWOULDBLOCK` → next iteration hits the deadline. No overflow
(3.0e7 µs max, uint32).

**B2 — timeout not propagated to mdev subs. FIXED.** NEW `:3578-3586`:
```cpp
bool ggml_hexagon_session::set_error(uint32_t status) {
    uint32_t expected = HTP_STATUS_OK;
    const bool first = this->last_error.compare_exchange_strong(expected, status);
    for (auto & sub : this->mdev.sessions) {
        uint32_t sub_expected = HTP_STATUS_OK;
        sub->last_error.compare_exchange_strong(sub_expected, status);
    }
    return first;
}
```
Used by every new error exit. `HTP_STATUS_OK == 1` (`htp/htp-ops.h:10`), so the CAS sentinel is right.
See N8/N9 for what this over-propagates and under-propagates.

**C2 — `get_tensor_async` / `get_tensor_2d_async` aborts. FIXED.** OLD `:7456`/`:7488`
`GGML_ABORT("ggml-hex: %s get-tensor-async failed : dsp-error %s\n", ...)` →
NEW `:7584` `GGML_LOG_ERROR("ggml-hex: %s get-tensor-async stopped after dsp-error %s\n", ...)` then `return;`
(and `:7622` for the 2d variant). The MoE `ggml-backend.cpp:1743` path no longer aborts.
Residual: `data` is left untouched, so the caller reads whatever was in it. The abort became a
log-only quiet wrong answer at that one site — strictly better than aborting, but the caller has
no way to know. `ggml_backend_hexagon_device_status` (`:7713`) is the only escape hatch and it is
itself broken (N3).

**C3 — post-error `enqueue_*` reaches `GGML_ABORT`. FIXED for the main path.**
OLD `:3759-3761`
```cpp
    if (!op_batch->fit_op(node)) {
        GGML_ABORT("ggml-hex: %s op does not fit into empty batch (vmem/tensor/buffer limit exceeded)\n", c_name());
    }
```
→ NEW `:3781` `if (this->last_error > HTP_STATUS_OK) return;` at the top of `enqueue_op`, and
NEW `:3813-3818` log + `set_error` + `return`. `enqueue_cpy` (`:3874`), `enqueue_fence` (`:3888`)
and `enqueue_allreduce` (`:4054`) all route through `enqueue_op`, so they are covered.
See N10 for the one that is not.

**F1/F2 — vacuous op-count check. FIXED, properly this time.**
OLD `:3622-3623`
```cpp
        const size_t expected_ops = op_queue->op_cache[slot].size();
        if (rsp.n_bufs > HTP_OP_MAX_BUFS || rsp.n_tensors > HTP_OP_MAX_TENSORS || rsp.n_ops > expected_ops) {
```
→ NEW `:3655-3660`:
```cpp
        const uint32_t slot = (uint32_t) ((rsp.seq - 1) % op_queue->depth);
        const auto expected = op_queue->req_shape[slot];
        if (rsp.n_bufs != expected.n_bufs || rsp.n_tensors != expected.n_tensors || rsp.n_ops != expected.n_ops ||
            rsp.n_bufs > HTP_OP_MAX_BUFS || rsp.n_tensors > HTP_OP_MAX_TENSORS) {
```
`req_shape[slot]` is written in `push` at NEW `:3448`
`req_shape[slot]  = { req.n_bufs, req.n_tensors, req.n_ops };`, i.e. from the request the host
actually queued, for parent and subs alike (subs go through the same `push`, `:3747`). `req_shape.resize(depth)`
at `:3414` value-initialises, so an unpushed slot reads `{0,0,0}` — harmless, since
`push` refuses when `seq - batch_rsp_seq > depth` (`:3437`) and therefore cannot overwrite a slot
whose response is still outstanding.
**Independent verification of the DSP contract** — `htp/main.c:1162-1164` reads the counts from the
request and `:1268-1270` writes them back verbatim:
```c
    rsp.n_bufs       = n_bufs;
    rsp.n_tensors    = n_tens;
    rsp.n_ops        = n_ops;
```
So exact equality is the definitive skew test in both directions, with no false positive for a
matched skel. It also closes F2 (`rsp.n_ops < req.n_ops` now fails).
Two asserts that were previously DSP-reachable are now provably unreachable:
`pop()` `GGML_ASSERT(m_size <= shm_blk_size)` (`:3518`) recomputes from the same `rsp.n_*` the
guard at `:3682` already bounded by `shm_blk_size`; `GGML_ASSERT(rsp.n_ops <= ops.size())` (`:3529`)
sees `ops.size() == opt_opbatch == 1280` and `rsp.n_ops == expected.n_ops <= 1280`.

**F5 — tautological diagnostic. FIXED.** OLD `:3646-3647` passed `rsp_payload` for both the
"expected" and the "got" slot → NEW `:3684` splits them:
```cpp
                GGML_LOG_ERROR("ggml-hex: %s batch response payload invalid : max %zu, payload %zu, buffer %u, trace counts invalid %d\n",
                               this->c_name(), op_queue->shm_blk_size, rsp_payload, dbuf.size, bad_trace_shape);
```

**E1 (wire enum) — host-only value in the shared header. FIXED.** `htp/htp-ops.h` loses one line;
`enum htp_status` is now `{1,2,3,4,5}`. NEW `:127`
`static constexpr uint32_t HTP_STATUS_TIMEOUT_HOST = 0x7fffffff;` is TU-local, and NEW `:160`
`case HTP_STATUS_TIMEOUT_HOST:` keeps the user-visible string `"TIMEOUT"`. Whole-tree grep for
`HTP_STATUS_TIMEOUT` returns only the four `.cpp` uses. No DSP wire value can collide.

**G1/G2 — broken device recipe. FIXED.** `FIX-engine.md` now uses `llama-bench` for the exit-code
arms (the only tool that actually exits non-zero on `res = -3`), captures full
stdout+stderr and unfiltered `logcat` as the source of truth and treats greps as inspection, and
drops the `rc` assertions that cli made vacuous. Required-evidence list is explicit about the three
diagnostic strings.

**D1 — improved beyond the audit's ask.** NEW `:7046-7049`:
```cpp
    if (ok) {
        float value = 0.0f;
        ggml_backend_tensor_get(output, &value, 0, sizeof(value));
        ok = value == 1.0f;
    }
```
The probe is now a genuine data round trip, not liveness. `GGML_OP_FILL` is remapped
(`:6732 case GGML_OP_FILL: return HTP_OP_FILL;`) and supported (`:7859-7867`, F32/F16 accepted),
so it will not abort on the `GGML_ABORT` at `:6772`. The audit's (b) caveat stands — 1 op cannot
see a skew whose symptom needs a large batch — but the recipe's stale arm exercises the reported
case.

### 1.2 Partially closed

**C4 — `synchronize` silently succeeding. PARTIAL.** NEW `:7080-7083`:
```cpp
    sess->flush_sync();
    bool expected = false;
    if (sess->last_error > HTP_STATUS_OK && sess->sync_error_reported.compare_exchange_strong(expected, true)) {
        GGML_LOG_ERROR("ggml-hex: %s synchronize failed: dsp-error %s\n", sess->c_name(), status_to_str(sess->last_error));
    }
```
Log-once, as asked. Still `void`, still no propagation to `ggml_backend_sched`, so a caller that
synchronises and reads still reads stale memory — now with one log line as the only difference
from a successful run. Acceptable only because `graph_compute` gates on the same flag.

**B1 — aborts in `release()`. PARTIAL.** OLD `:4326`/`:4364` `GGML_ABORT(...)` →
NEW `:4382` `GGML_LOG_WARN("ggml-hex: %s htp_iface_stop failed during release: 0x%08x\n", ...)`
and NEW `:4420` the `dspqueue_close` equivalent. Teardown no longer aborts. **What was not done**:
no `htp_iface_stop` + drain on the *error* path, no quiesce, and the residual the audit named is
untouched — `htp_iface_stop` still runs at `:4381` while the DSP may be mid-batch, `op_queue`'s
`shm_buf` is deleted at `:4389` immediately after, and `buffer_free_buffer` (`:795-799`) still
unclones/munmaps with no wait. See N11.

**D2 — health check side effects / thread safety / leak. MOSTLY.** `make_unique` (`:7666`),
`GGML_UNUSED(params)` moved above the return (`:7677`), `try`/`catch(...)` (`:7690`/`:7705`), and the
probe no longer runs on the shared session — so a false negative no longer bricks the process
(that was D2a/B3's worst half). Still open: the probe has its own side effects (N1, N2, N5), and
`buffer_clear` / `buffer_set_tensor` / `buffer_free_buffer` remain unguarded (N11).

**E1 (export contract) — PARTIAL.** NEW `:77-80`:
```cpp
extern "C" {
GGML_BACKEND_API ggml_status ggml_backend_hexagon_device_healthcheck(ggml_backend_dev_t dev);
GGML_BACKEND_API ggml_backend_hexagon_device_status(ggml_backend_dev_t dev);
}
```
Typed, `extern "C"`, `ggml_status` instead of `bool`, second symbol added (`:8338`). Still no
header, no typedef, no doc comment, no test — a binding must re-declare the prototype it cannot
see. See N14.

### 1.3 Still open from the previous audit

**B3 — no recovery. UNCHANGED.** `allocate()` (`:4159` region) is still the only place that resets
`last_error`; `ggml_backend_hexagon_device_context::session()` still hands one session to every
backend. After a timeout HTP is dead for the process. Sticky-and-doomed is defensible; it just has
to be a documented choice, and it is not.

**D4 — log level. UNCHANGED.** See N16.

---

## 2. What the fixes broke

### N7. The default path is not behaviour-preserving: it is now globally serialized, and its fence poll sleeps 2 ms under the global lock — CONFIRMED, blocking

NEW `:128` `static std::recursive_mutex opt_dspqueue_mutex;` is taken in **eleven** functions:
`:6891` (`graph_compute`), `:7078` (`synchronize`), `:7330` (`cpy_tensor_async_phys`), `:7399`
(`cpy_tensor_async`), `:7471` (`event_synchronize`), `:7527` (`event_record`), `:7545` (`event_wait`),
`:7571` (`set_tensor_async`), `:7581` (`get_tensor_async`), `:7602` (`set_tensor_2d_async`),
`:7619` (`get_tensor_2d_async`).

`graph_compute` holds it across the **whole graph including `flush_sync()`'s DSP wait**, up to the
30 s deadline (`:7011` `sess->flush_sync();`, then `:7013` `if (sess->last_error > HTP_STATUS_OK) return GGML_STATUS_FAILED;`).
Before this diff two hexagon sessions, two HTP devices, or two llama contexts on HTP ran their
dspqueues concurrently; now they are strictly serialized process-wide. A `ggml_backend_synchronize`
issued from another thread while a batch is in flight now blocks for the batch, not just its own
work.

Worse, and this is the one that will show up on the S23:
OLD `:7388` `std::this_thread::yield();` → NEW `:7507`
`std::this_thread::sleep_for(std::chrono::milliseconds(2));`
Every fence wait that is not already satisfied when `event_synchronize` is entered now costs a flat
~2 ms of wall clock — and it is slept **while holding `opt_dspqueue_mutex`**, so those 2 ms also
block every other hexagon operation in the process. `ggml_backend_sched` reaches
`ggml_backend_synchronize` / `event_synchronize` from `ggml-backend.cpp:1682, 1693, 1717, 1808`,
several times per compute. At `-ub 64` a prefill was 0.125 s total (previous audit A5); a handful
of 2 ms sleeps is a low-single-digit percentage, at `-ub 512`/decode with more events it is not.
**None of this is measured** — `FIX-engine.md`'s "Not verified" section says so explicitly, and
the matched arm's "pp64 near 511 tok/s" is labelled "historical, not re-measured here".

Failure scenario: single HTP, `-ngl 99`, `GGML_HEXAGON_DEVICES` unset, healthy matched skel. The app
is functionally correct and measurably slower than `f4bdd0f29`, and the only evidence in the repo
says the regression was never looked for. In a throughput lab, shipping an unmeasured change to
hot-path locking *and* poll granularity on the strength of a hang fix is the wrong trade.
Cheapest fix: `sleep_for(200us)`-class granularity, or drop the sleep and keep `yield()` now that
the loop is deadline-bounded anyway (the burn was always bounded — the previous audit's A6 only
ever complained about the spin, and it is still a spin).

### N4. The probe's deadline does not cover the part that can actually hang — CONFIRMED, blocking

`rsp_timeout_override_ms` is set at `:7028`, **after** `device_healthcheck` has already constructed
the probe session at `:7697`:
```cpp
        ggml_hexagon_session probe_session(probe_config, dev, 0, 1);
```
whose constructor (`:4425`) calls `allocate(config)` → `remote_session_control(FASTRPC_RESERVE_NEW_SESSION)`
(`:4191`), `remote_session_control(DSPRPC_CONTROL_UNSIGNED_MODULE)` (`:4222`), `fastrpc_mmap` of a
~41.6 MiB pinned block, and `htp_iface_start` (`:4352`). None of that is under the 2 s knob, and
none of it is under a host-side deadline. `catch (...)` at `:7705` catches throws, not a hang.

Failure scenario: the DSP is wedged in the state this whole campaign exists for — not answering,
not faulting, just not servicing. `device_init` is the *first* code that touches it. If
`htp_iface_start` blocks (or takes 60 s), the whole process stalls inside
`ggml_backend_hexagon_device_init` **holding `opt_dspqueue_mutex`**, which is now the lock every
hexagon entry point takes. That converts the reported symptom (one hung turn) into a
process-wide hang at model load, on the code path that was added to *avoid* hanging.
The pre-diff probe ran on the already-constructed session and had exactly one skel load; this diff
adds a second one, on the same physical core, before the probe.
The S23 recipe cannot see this: `timeout 40` in the shell would kill it and the arm would be
indistinguishable from "probe timed out as designed".

### N1. The probe reserves a fastRPC session and never releases it — CONFIRMED, blocking

`valid_session` is set once and read nowhere in the tree:
```
$ grep -n "valid_session" ggml-hexagon.cpp
491:    bool             valid_session;
4159:    this->valid_session = false;
4201:        this->valid_session = true;
```
`release()` (`:4371`) does `htp_iface_stop`, `dspqueue_close`, `htp_iface_close` — and no
session-release RPC. So every `GGML_HEXAGON_HEALTHCHECK=1` `device_init` performs one
`FASTRPC_RESERVE_NEW_SESSION` on a live physical CDSP core (NEW `:7694` `probe_config.virtual_idx = probe_idx;`,
`:7695` `probe_config.name += "-probe";`) and gives it back only if `htp_iface_close` happens to
return the reservation implicitly. Nothing in this tree settles which.

Failure scenario: an in-app binding that probes on every context creation (or retries a FAIL) opens
N sessions on the same core in the process lifetime. If the reservation is not implicit, the DSP
session pool drains and every later probe — and possibly the real session — fails with an
indistinguishable `ggml-hex: HTP data-plane healthcheck FAIL`. If it is implicit, `valid_session`
is dead code and should be deleted or used. Either way this needs to be *known*, not assumed.

### N2. Every health check builds a second full-size pinned op queue — CONFIRMED, blocking

`:4336` `this->op_queue = new ggml_hexagon_opqueue(this, opt_opbatch, opt_opqueue);` runs for the
probe too. From the constants (`htp-ops.h:121-127, 123-124, 230`; `ggml-hexagon.cpp:120-121`):
`n_bufs=16`, `n_ops=1280`, `n_tensors = 1280*(10+4) = 17920`, depth 32,
`sizeof(htp_buf_desc)=24`, `sizeof(htp_tensor)=56`, `sizeof(htp_op_desc)=232`,
`sizeof(htp_prof_desc)=48`:

    shm_blk_size = 16*24 + 17920*56 + 1280*232 + 1280*48 = 1 362 304 B  (~1.30 MiB)
    shm_size     = shm_blk_size * 32                     = 43 593 728 B  (~41.6 MiB)

That is `new ggml_hexagon_shared_buffer(sess, shm_size, true /* pinned */)` at `:3411` — page-locked
and `fastrpc_mmap`'d, on top of the real session's identical 41.6 MiB, inside the `try_to_lock`
region at `:7685`, plus a skel load, on every `device_init`.
Failure scenario: `GGML_HEXAGON_HEALTHCHECK=1` plus a monitor thread probing on a schedule
→ repeated 42 MiB pinned alloc/free and skel reloads, contending with the live session's DMA
budget. A 1-op probe does not need `opt_opbatch`/`opt_opqueue` slots; the probe session should be
constructed with a small batch size and depth (e.g. 4/2), which is a one-line change at `:7697`.

### N3. The new exported `device_status` lazily constructs an entire session — CONFIRMED, blocking

NEW `:7713-7716`:
```cpp
ggml_status ggml_backend_hexagon_device_status(ggml_backend_dev_t dev) {
    auto dev_ctx = static_cast<ggml_backend_hexagon_device_context *>(dev->context);
    return dev_ctx->session()->last_error > HTP_STATUS_OK ? GGML_STATUS_FAILED : GGML_STATUS_SUCCESS;
}
```
and `:589-594`:
```cpp
    ggml_hexagon_session * session() {
        if (!sess) {
            sess = std::make_unique<ggml_hexagon_session>(config, dev);
        }
        return sess.get();
    }
```
No mutex, no "already initialised?" test. `device_healthcheck` avoids this by reading
`dev_ctx->config` (`:7691`); `device_status` does not.

Failure scenario: a binding polls `ggml_backend_hexagon_device_status` from a monitor thread before
calling `device_init`, because it wants to know whether HTP is usable. Asking the question costs a
full session construction — fastRPC reserve, skel load, 41.6 MiB pinned, and it can `throw`
(`allocate` is `noexcept(false)`) straight out of a function that has no handler. Two threads
polling concurrently race on `std::unique_ptr sess` — data race, double construction, UB.
Fix: return `dev_ctx->sess ? … : GGML_STATUS_FAILED` (or add a `has_session()` accessor).

### N6. `GGML_HEXAGON_HEALTHCHECK=1` does not shorten the failure — CONFIRMED, blocking

NEW `:7674-7676`:
```cpp
    const char * healthcheck = getenv("GGML_HEXAGON_HEALTHCHECK");
    if (healthcheck && strcmp(healthcheck, "1") == 0) {
        ggml_backend_hexagon_device_healthcheck(dev);
    }
```
The return value is discarded, so a FAIL is a log line and HTP is handed back anyway. On the stale
skel the sequence is: real session constructed, probe FAILs at 2 s, `device_init` returns a working-
looking backend, first `graph_compute` blocks 30 s and returns `FAILED`. Total ≈ 32 s — exactly the
recipe's "within 35 seconds" budget, i.e. the 30 s the fix was meant to remove is still there and
the 2 s probe is an *addition*.
The user-visible promise in DIAGNOSIS §2.3 ("the current turn fails with a visible error instead of
hanging") is still met only by the 30 s batch deadline. The probe is diagnostic, and the writer
report does not claim otherwise — but the diff's headline is a fast-fail, and it does not deliver one.
Either `device_init` should return `nullptr` on probe FAIL, or the report should say the probe is
purely diagnostic and the fast-fail comes from the batch deadline.

### N8. `set_error` over-propagates: one dead sub-session now kills the whole mdev group — CONFIRMED

OLD (`a48cc3e08:3653-3657`) propagated **only** a DSP-reported `rsp.status`:
```cpp
            this->last_error = rsp.status;
            for (auto & sub : this->mdev.sessions) {
                sub->last_error = rsp.status;
            }
```
NEW `:3578-3586` propagates **every** status, including timeouts and shape errors. Combined with B3
(no recovery), a single slow peer in an `HTP0,HTP1` group now permanently bricks both devices for
the process, where before only that peer was poisoned. Defensible — but it is a new failure mode,
it is not in `FIX-engine.md`, and the S23 (single NPU, `mdev.count == 1`) cannot exercise it.

### N9. …and under-propagates: peers get nothing — CONFIRMED

`set_error` walks `mdev.sessions` only. `add_peer` (`:562-568`) inserts into `virt_peers` /
`phys_peers`; `flush_peers` (`:3556`) drives them. Nothing copies a session's `last_error` to its
peers or from them.
Failure scenario: `GGML_HEXAGON_DEVICES=2` (two hexagon devices on the same physical NPU). HTP0's
session times out and dies; HTP1's session is untouched, keeps enqueueing batches into a dspqueue
whose DSP is not consuming, and each `flush_pending` burns its own full 30 s. The user sees a
30-second stall per turn on the half of the device that "should" have failed fast.

### N10. `enqueue_mdev_group` bypasses the new guard — CONFIRMED (small)

`:3855` `op_batch->add_op(group_node);` — direct, no `enqueue_op`, no `last_error` check, no
`fit_op`. Reachable inside the very `enqueue_op` call that poisons the session: `:3805-3807`
`if (!op_batch->fit_op(node)) { flush_async(); }` can set the error, and `:3809-3811`
`if (op_batch->empty()) { start_batch(); }` then calls it anyway, and `:3820 op_batch->add_op(node);`
adds a second op. The commit message for `643332f8f` ("fail errored sessions immediately") overstates:
an errored session still writes into `op_batch` on the mdev path. Multi-device only; inert on the S23.

### N11. `buffer_clear` and the buffer free/teardown path are still unguarded — CONFIRMED (open from B1 / C5)

`:2257-2262`:
```cpp
static void ggml_backend_hexagon_buffer_clear(ggml_backend_buffer_t buffer, uint8_t value) {
    auto sbuf = (ggml_hexagon_shared_buffer *) buffer->context;
    auto sess = sbuf->sess;
    HEX_VERBOSE("ggml-hex: %s clear-buff base %p size %zu\n", sess->c_name(), (void *) sbuf->base(), sbuf->size());
    memset(sbuf->base(), value, sbuf->size());
}
```
No `last_error` check, no mutex, no wait. This is audit C5's `buffer_clear ❌`, unchanged.
`:795-799` `buffer_free_buffer` → `unclone_buffer` (`:4114`) → `release_buffer` (`:4099`), which
still aborts the process:
```cpp
4100|    GGML_ASSERT(sbuf && sbuf->mem);
4105|    GGML_ASSERT(fd >= 0);
```
Failure scenario: a session is poisoned by a timeout while the DSP is still executing the batch
(b1's live case, not the reported early-`return` skew). llama.cpp then reuses the slot
(`llama_memory_clear` → `buffer_clear`) or tears the context down (`buffer_free_buffer`): the host
zeroes or unmaps a mapping the DSP is reading. The asserts are reachable if the fd path is stressed;
the memset is a straight DSP-side fault with no host-side diagnosis. Not in the previous audit's
"minimum to flip" list, so not a regression — but it is the remaining part of B1 and it should be
closed in the same series.

### N12. The write side is still a hard-coded 1 s and the batch is still not reset on error — CONFIRMED (small)

`:3757` and `:3768` both pass `DSPQUEUE_TIMEOUT` literally while the read side at `:3624-3625` is
now clamped to the remaining deadline. Asymmetric, and a reviewer will ask why.
All four new error exits (`:3736`, `:3751`, `:3762`, `:3774`) `return` **before** `:3777`
`op_batch->reset();`, so the batch keeps its ops and its `cloned_buffers` until `release()` drains
them at `:4398-4400`. Not a hang (the session is poisoned and `enqueue_op` now early-returns, so
`cloned_buffers` cannot grow without bound — C3's growth claim is genuinely dead), but the batch is
left in a state that only teardown cleans.

### N13. `rsp_timeout_override_ms` is not honoured by the fence wait — CONFIRMED (small)

`:7483` `const auto deadline = wait_start + std::chrono::milliseconds(opt_rsp_timeout_ms);`
vs `:3604`, which honours the override. `FIX-engine.md` describes the knobs as covering the
"batch/fence deadline" and the "probe deadline"; a fence wait inside a probe would get 30 s, not
2 s. Currently unreachable (the probe records no events), which is exactly why it will survive to
the day someone makes the probe exercise a multi-op graph.

### N14. The export's return type changed under the binding's feet — PLAUSIBLE

`bool` → `ggml_status`, and `GGML_STATUS_SUCCESS == 0`. A binding written against the *previous*
`FIX-engine.md` ("cast it to `bool (*)(ggml_backend_dev_t)`") now reads PASS as `false` and FAIL as
`true` — silently inverted. Nothing downstream is committed and the report is updated, so no live
harm; but `get_proc_address` (`ggml-backend.cpp`) has no versioning, so the same hazard recurs on
the next signature change. A `ggml_backend_hexagon_device_api_v1` name, or a `sizeof`/version
query, is the cheap durable fix. Also: the declarations at `:77-80` are in the `.cpp`, so a binding
is still re-declaring a prototype it cannot see — E1's core complaint stands.

### N15. `ggml_hexagon_probe_virtual_idx` can return 16 — CONFIRMED (cosmetic)

`:7070` `for (int idx = 1; idx <= GGML_HEXAGON_MAX_SESSIONS; ++idx)` returns up to 16, but
`opt_device_configs` is `ggml_hexagon_device_config opt_device_configs[GGML_HEXAGON_MAX_SESSIONS]`
(`:96`, indices 0-15, and the parser caps `opt_ndev < GGML_HEXAGON_MAX_SESSIONS` at `:8707`/`:8743`)
and `ggml_backend_hexagon_comm_context::fence_slots[GGML_HEXAGON_MAX_SESSIONS]` (`:470`).
`mark_used` accepts `<= GGML_HEXAGON_MAX_SESSIONS`, so the intent is deliberate. Only reachable when
1-15 are all occupied. Should be `GGML_HEXAGON_MAX_SESSIONS - 1`.

### N16. D4 not fixed — CONFIRMED

`:7708` `if (status == GGML_STATUS_SUCCESS) GGML_LOG_INFO("ggml-hex: HTP data-plane healthcheck PASS\n");`
and `:8120` `GGML_LOG_INFO("ggml-hex: batch response timeout %u ms, probe timeout %u ms\n", opt_rsp_timeout_ms, opt_probe_timeout_ms);`
Per the previous audit's D4, in a **statically linked** build both map to trace level 4 and are
dropped. `FIX-engine.md`'s recipe pushes a static `llama-bench` plus a dlopened
`libggml-hexagon.so` and lists *both* the init line and `healthcheck PASS` as required evidence;
whether the logging copy is the dlopened one is not established anywhere in the report, and both
acceptance greps hang on the answer. `GGML_LOG_ERROR` for both, or state the link-mode dependency
in the recipe, is one line.

### N17. "Busy" is reported as "broken" — CONFIRMED (small)

`:7685-7689`:
```cpp
    std::unique_lock<std::recursive_mutex> lock(opt_dspqueue_mutex, std::try_to_lock);
    if (!lock.owns_lock()) {
        GGML_LOG_ERROR("ggml-hex: HTP data-plane healthcheck FAIL (device busy)\n");
        return GGML_STATUS_FAILED;
    }
```
A binding that probes from a monitor thread against a live in-process server gets `GGML_STATUS_FAILED`
every single time, with the same return value as a genuine DSP fault and no way to retry
distinguishably. Combined with N7's global lock, this is the normal outcome under concurrency, not
an edge case.

---

## 3. Remaining aborts and asserts, classified

Full grep of `GGML_ABORT|GGML_ASSERT` in `ggml-hexagon.cpp` at `643332f8f`: 50 hits. Reachable
*from a skewed or dead DSP*: **zero**. The diff removed the last four (two `dspqueue_write`, two
`get_tensor_async`), and the two remaining DSP-adjacent asserts are now provably unreachable because
F1's exact-equality guard runs before `pop()` (see 1.1). The rest, and why they are not reachable
from a dead DSP:

| line | construct | reachable from a skewed/dead DSP? |
|---|---|---|
| `:6772` | `GGML_ABORT("... graph-compute %s is not supported")` in `op_remap_to_htp` default | No — host-side op table. Reachable if a graph contains an un-remapped op. Pre-existing; the probe's `FILL` is remapped (`:6732`). |
| `:6942` | `GGML_ASSERT(ggml_hexagon_precompute_binary_params(...))` | No — host-side param precompute. Reachable if `supports_op` accepted a binary op the precompute rejects. Pre-existing. |
| `:3529` | `GGML_ASSERT(rsp.n_ops <= ops.size())` | **Unreachable** — `rsp.n_ops == expected.n_ops ≤ opt_opbatch == ops.size()` after the `:3657` guard. |
| `:3518` | `GGML_ASSERT(m_size <= shm_blk_size)` | **Unreachable** — `m_size` is recomputed from the `rsp.n_*` the `:3682` guard already bounded. |
| `:3470` | `GGML_ASSERT(dbuf.size <= shm_blk_size)` | No — host-computed from `fit_op`-bounded counts. |
| `:4071`, `:4077`, `:4100`, `:4105`, `:4116` | `GGML_ASSERT(sbuf && sbuf->mem)` / `GGML_ASSERT(fd >= 0)` / `GGML_ASSERT(sbuf->mapped)` | No — mmap/clone/unmap fd bookkeeping. But see N11: reachable from *resource* pressure, which the probe at N2 makes more likely. |
| `:785`, `:651` | `GGML_ASSERT(ptr)` / `GGML_ASSERT(!pinned \|\| !extended)` | No — fence slot exhaustion / flag misuse. |
| `:2499`, `:2556`, `:2659` | `GGML_ASSERT` in `opbatch::add_*` | No — host-side batch accounting. `:2659` is reachable from N10's unguarded `add_op` in principle; `op_batch->empty()` makes it not so. |
| rest (`1423`…`2210`, `5275`, `5699`) | `GGML_ASSERT(offset == 0)`, alignment asserts, `src1 != nullptr` | No — pre-existing host-side preconditions, untouched by this diff. |

Remaining unbounded waits: `flush_pending` (`:3606`) and `event_synchronize` (`:7484`) are both
deadline-bounded. `dspqueue_write` at `:3757`/`:3768` is bounded by the SDK's `DSPQUEUE_TIMEOUT`
(1 s) — not a deadline-derived bound, see N12. `:4144 while (1)` is `ggml_hexagon_measure_max_vmem`,
bounded by allocation failure, and runs only when `GGML_HEXAGON_VMEM=0`. **The one unbounded wait
the diff introduces is N4**: the probe's session construction, at `:7697`, under
`opt_dspqueue_mutex`.

---

## 4. Locality — 246+/66- in an upstream-owned file

Still local in the mechanical sense: every hunk sits inside the function it has to touch, and only
the two files named in the brief are touched. `CODEOWNERS:64` assigns
`ggml/src/ggml-hexagon/` to `@lhez, @max-krasnyansky`, and this is still the fork's first local
patch series to `ggml-hexagon.cpp` (plus `htp/htp-ops.h`).

But the *character* changed. The previous patch was 139 lines of "add a deadline, replace an abort".
This one adds a process-wide mutex to eleven call sites spanning every backend interface entry
point, rewrites the probe as a new session factory, adds a second exported symbol, adds a session
field (`:513-515`) and an opqueue field (`:3391`), and adds a global `std::recursive_mutex` to the
option block. Those are the shapes upstream rewrites, not the shapes upstream merges.
Conflict surface on `git merge upstream/tag/bXXXXX` is now `flush_pending`, `flush_batch`,
`enqueue_op`, `graph_compute`, `synchronize`, `cpy_tensor_async`, `cpy_tensor_async_phys`, all four
tensor-async entry points, all three event entry points, `device_init`, `device_healthcheck`,
the env block and `htp/htp-ops.h` — roughly 12 functions versus 5. Judgement: **fine for the fork,
not for an upstream PR**, and the fork is where it is going. Worth stating plainly in the commit
body rather than leaving to the next person.

---

## 5. Minimum to flip the verdict

1. **N7** — measure it. Re-run the matched arm and report pp64 against the 511 tok/s baseline; if
   the fence sleep is the cost, drop it back to `yield()` (the loop is deadline-bounded now) or use
   ~200 µs. Consider narrowing `opt_dspqueue_mutex` to per-physical-NPU rather than process-wide.
2. **N4** — put the probe's `htp_iface_start` / `allocate()` inside a bounded window, or construct
   the probe session *before* taking the try-lock so a hang there cannot hold the queue mutex.
   At minimum, document that `htp_iface_start` is the one unbounded call.
3. **N1 + N2** — settle whether `htp_iface_close` returns the `FASTRPC_RESERVE_NEW_SESSION`
   reservation; use or delete `valid_session`. Construct the probe session with a small
   `opbatch`/`opqueue` (e.g. 4/2) instead of 1280/32 — one argument at `:7697` if the constructor
   takes it, otherwise a constructor parameter.
4. **N3** — `device_status` must not construct a session. Return FAILED when `dev_ctx->sess == nullptr`.
5. **N6** — either make `device_init` honour a probe FAIL, or state plainly in `FIX-engine.md` that
   the probe is diagnostic and the fast-fail is the 30 s batch deadline.
6. **N11** — guard `buffer_clear` with `last_error`, and make `release_buffer`'s two `GGML_ASSERT`s
   into `GGML_LOG_ERROR` + return, for the same reason `release()`'s aborts were converted.
7. **N16** — `GGML_LOG_ERROR` for the init banner and the PASS/FAIL line, or state the link-mode
   dependency in the recipe. One line; unblocks the acceptance greps.
8. **N13, N15, N10, N17** — one-liners: honour `rsp_timeout_override_ms` at `:7483`, cap the probe
   index at `MAX_SESSIONS - 1`, route `enqueue_mdev_group` through the guard, return a distinguishable
   code (or a third proc symbol) for "busy".
