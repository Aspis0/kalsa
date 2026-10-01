# Hostile audit r3 — the NET diff, after the simplification

Date: 2026-10-01. Subject: `~/Projects/kalsallama` `main`, `git diff e775fb2bf 9f3c2e069 --
ggml/src/ggml-hexagon` (205+/29-, `ggml-hexagon.cpp` only). Head `9f3c2e069` ("simplify the Hexagon
dspqueue fix"). Read: `AUDIT-fix-engine.md`, `AUDIT-fix-engine-r2.md`, `FIX-engine.md`.
Read-only; scratch worktree `/tmp/htp-audit-wt` (detached at `9f3c2e069`), removed after.
No device. Line numbers are `9f3c2e069:ggml/src/ggml-hexagon/ggml-hexagon.cpp` unless prefixed `OLD:`
(= `e775fb2bf`). DSP-side line numbers are `9f3c2e069:ggml/src/ggml-hexagon/htp/...`.

## Verdict: SHIP

To the S23 measurement, unchanged. Nothing I found can corrupt a result, deadlock, or hang the
**matched** path: I verified the exact-shape check against the DSP echo and against the cap
arithmetic, I verified the `-3` path end to end, and I verified the fence poll costs zero on the
healthy path. The r2 blockers (N1-N7: probe session, global recursive mutex on eleven sites, 2 ms
fence sleep under that lock) are genuinely gone, not deferred.

Three things must be written down before the run, and none of them is a code blocker for it:

- **F1** (CONFIRMED) — `set_error`'s peer marking is **dead code on the only path that calls it**,
  and peer errors never propagate *upward*. `FIX-engine.md` and the commit message both claim
  "symmetric to virt/phys peers" and r2's N9 "closed". That claim is false. 3 lines.
- **F8** (PLAUSIBLE) — the stale skel has **no fence/mdev protocol at all** (0 hits for `mdev`,
  `fence`, `sync-wait` in `libggml-htp-v73.so` `f81f95e9…`), so the recipe's predicted stale
  signature is a guess, and the `timeout 40` guard sits on top of an unbounded DSP teardown join
  (F2). Amend the recipe: 90 s outer for S1/S2 and record 124 as its own outcome.
- **F7** (CONFIRMED, cosmetic) — `buffer_clear` logs a benign skip at `GGML_LOG_ERROR`, once per
  call, into the same stream the recipe greps for "one clear ERROR line".

F1 should be fixed in-tree before any multi-device (`HTP0,HTP1` / mdev) measurement, because that
is the only configuration where it is observable.

---

## 1. Every changed function, old → new

Diff is confined to one file. Grouped by what the change actually does; each line is quoted from the
side named.

### 1.1 Globals and init
| | OLD | NEW |
|---|---|---|
| `:118` | — | `static uint32_t opt_rsp_timeout_ms = 30000;` |
| `:120` | — | `static constexpr uint32_t HTP_STATUS_TIMEOUT_HOST = 0x7fffffff;` |
| `:152` | — | `case HTP_STATUS_TIMEOUT_HOST: return "TIMEOUT";` |
| `:8009` | — | `GGML_LOG_INFO("ggml-hex: batch response timeout %u ms\n", opt_rsp_timeout_ms);` (moved from `ggml_hexagon_init` into the registry ctor) |
| `:8432-8447` | — | strict decimal parse, `1..600000`, `GGML_LOG_WARN` + default on reject |

`HTP_STATUS_OK == 1` (`htp/htp-ops.h:9`), not 0. Every `> HTP_STATUS_OK` guard and the
`compare_exchange_strong(expected = HTP_STATUS_OK, …)` sentinel are therefore consistent, and
`0x7fffffff > 1` so the timeout sentinel trips every guard. `status_to_str` is only ever handed
host-generated values or DSP values in `2..5`. Correct.

### 1.2 `struct ggml_hexagon_session`
OLD `:483 bool valid_session;` — deleted, with its two assignments (`:4208`, `:4236`). No reader
remains (the file compiles, and `grep valid_session` at head returns nothing). Dead. Good.
NEW `:504 std::atomic<bool> sync_error_reported{false};`

### 1.3 `ggml_hexagon_opqueue`
NEW `:3386-3387`
```cpp
    struct op_shape { uint32_t n_bufs, n_tensors, n_ops; };
    std::vector<op_shape>       req_shape;
```
NEW `:3443` `req_shape[slot]  = { req.n_bufs, req.n_tensors, req.n_ops };` — written in `push`,
after the `if (seq - shm_buf->sess->batch_rsp_seq > depth) { return false; }` early-out at
`:3427`, so a rejected push does not dirty the slot. `req_shape.resize(depth)` at `:3409` next to
`op_cache.resize(depth)`. Correct bookkeeping.

### 1.4 `flush_peers` — **unchanged, and that is the F1 bug**
```cpp
3550:    auto vpeers = std::move(virt_peers);
3551:    virt_peers.clear();
3556:    auto ppeers = std::move(phys_peers);
3557:    phys_peers.clear();
```
Identical to OLD `:3536-3543`. The peer sets are **moved out and cleared before the peers are
flushed**, so for the whole duration of the peer flush both member sets are empty.

### 1.5 `set_error` (new, `:3573-3590`)
```cpp
3573: bool ggml_hexagon_session::set_error(uint32_t status) {
3574:     uint32_t expected = HTP_STATUS_OK;
3575:     const bool first = this->last_error.compare_exchange_strong(expected, status);
3576:     for (auto & sub : this->mdev.sessions) { … sub->last_error.compare_exchange_strong(…); }
3580:     // Peers share this session's fate on the same queue/dspqueue path, so they fail fast too.
3581:     for (auto * peer : this->virt_peers) { … }
3585:     for (auto * peer : this->phys_peers) { … }
```
Replaces OLD `:3590-3594`, which propagated only a DSP-reported status to `mdev.sessions`:
```cpp
            this->last_error = rsp.status;
            for (auto & sub : this->mdev.sessions) { sub->last_error = rsp.status; }
```
So: subs now get every status (r2 N8, accepted), peers are added — see F1 for why that addition
does not fire.

### 1.6 `flush_pending` — the substantive rewrite
| OLD | NEW |
|---|---|
| no entry guard | `:3593 if (this->last_error > HTP_STATUS_OK) { return; }` |
| `this->last_error = sub->last_error.load();` (`:3559`) | `this->set_error(sub->last_error.load());` (`:3600`) |
| none | `:3607-3608` `const auto wait_start = …; const auto deadline = wait_start + std::chrono::milliseconds(opt_rsp_timeout_ms);` |
| `while (batch_rsp_seq < batch_req_seq) {` (`:3562`) | `:3609` same loop, `:3610-3618` deadline check → `set_error(HTP_STATUS_TIMEOUT_HOST)` + log + `return` |
| `const uint32_t timeo = opt_oppoll ? 0 : DSPQUEUE_TIMEOUT;` (`:3573`) | `:3627-3628` `opt_oppoll ? 0 : (uint32_t) std::min<int64_t>(duration_cast<microseconds>(deadline - now).count(), DSPQUEUE_TIMEOUT)` |
| `if (err == AEE_EEXPIRED \|\| err == AEE_EWOULDBLOCK) { continue; }` | `:3631-3633` same, plus `if (opt_oppoll) std::this_thread::sleep_for(std::chrono::milliseconds(2));` |
| `GGML_ABORT("…dspqueue_read failed…")` (`:3580`) | `:3636-3640` `set_error(HTP_STATUS_INTERNAL_ERR)` + log + `return` |
| `GGML_ABORT("…bad response : size %u dspbufs %u…")` (`:3585`) | `:3645-3650` log + `set_error` + `return` |
| none | `:3653-3660` `if (rsp.seq != expected_seq) → set_error` + log + `return` (replaces the assert) |
| none | `:3662-3673` exact `n_bufs`/`n_tensors`/`n_ops` equality vs `req_shape[slot]` + `> HTP_OP_MAX_BUFS` / `> HTP_OP_MAX_TENSORS` |
| none | `:3675-3694` payload-size check `rsp_payload > shm_blk_size \|\| dbuf.size < rsp_payload \|\| bad_trace_shape` |
| `GGML_LOG_ERROR` + plain stores (`:3589-3594`) | `:3696-3700` `if (this->set_error(rsp.status)) { GGML_LOG_ERROR(…) }` |
| `GGML_ASSERT(rsp.seq == this->batch_rsp_seq + 1);` (`:3598`) | deleted — the seq is now a checked early-out at `:3653` |

`DSPQUEUE_TIMEOUT` is `1000000` **microseconds** (`htp-drv.h:88`, and the driver signature is
`uint32_t timeout_us` at `htp-drv.cpp:56-60`), so the `min()` is unit-correct, `deadline - now > 0`
is guaranteed by the `:3611` check, and a sub-µs remainder collapses to `timeo == 0` →
`EWOULDBLOCK` → next iteration trips the deadline. No overflow (`opt_rsp_timeout_ms` ≤ 6e5 ms =
6e11 µs, but it is `min`-ed against 1e6 before the `uint32_t` cast).

### 1.7 `flush_batch`
`:3720` entry guard; `:3733-3740` the `push`-failed retry now checks `last_error` and, if the
second push also fails, `set_error` + log + `return` instead of a silent second `push`
(OLD `:3629-3632`). `:3751-3756` the sub-session retry likewise, and it propagates via
`this->set_error(sub->last_error > HTP_STATUS_OK ? sub->last_error.load() : HTP_STATUS_INTERNAL_ERR)`.
Both `dspqueue_write` aborts (OLD `:3649`, `:3657`) → `set_error` + log + `return`
(`:3758-3765`, `:3769-3776`).

### 1.8 Enqueue entry points
`enqueue_op` `:3781`, `enqueue_mdev_group` `:3826` — both `if (this->last_error > HTP_STATUS_OK) return;`.
The `fit_op` abort (OLD `:3695`) → `set_error` + log + `return` (`:3816-3820`).

### 1.9 Buffer / teardown
`buffer_clear` `:2249-2253` skips the `memset` on an errored session.
`release_buffer` `:4104-4123`: OLD `GGML_ASSERT(sbuf && sbuf->mem);` / `GGML_ASSERT(fd >= 0);`
→ `GGML_LOG_ERROR` + `return`. `release()` `:4391` and `:4429`: OLD `GGML_ABORT` on
`htp_iface_stop` / `dspqueue_close` failure → `GGML_LOG_WARN` (see F2).

### 1.10 Backend interface
`synchronize` `:7033-7039` abort → log-once. `cpy_tensor_async` `:7361` error guard.
`event_record` `:7470`, `event_wait` `:7486`, `set_tensor_async` `:7510`,
`set_tensor_2d_async` `:7537` error guards. `get_tensor_async` `:7516-7525` and
`get_tensor_2d_async` `:7550-7559` aborts → log + `return`. `event_synchronize` `:7407-7452`:
`flush_pending()` added at `:7419`, the `GGML_ABORT` at OLD `:7293` → `set_error` + log, and
`std::this_thread::yield();` (OLD `:7298`) → 200 µs sleep `:7450` plus a 30 s deadline `:7426`.

---

## 2. Concurrency without locks

**Verdict: no new race class, but one new cross-session read that the previous round had locked.**

- `req_shape` is a plain `std::vector<op_shape>`, written in `push` and read in `flush_pending`.
  It has exactly the same thread discipline as the pre-existing `op_cache` (written in `push`,
  read in `pop`) and `start_usec`. Since neither `b11304 81ff93ea1` nor `e775fb2bf` had any op
  mutex, the new field is no less safe than the state it sits next to. **REFUTED** as a new race.
- `last_error`, `sync_error_reported`, `batch_req_seq`, `batch_rsp_seq` are all
  `std::atomic` (`:499-504`). The deadlines are function locals. `opt_rsp_timeout_ms` is a plain
  static written once under the registry mutex (`:8674-8675`) before any session exists.
- Ordering is safe: `push` refuses when `seq - batch_rsp_seq > depth` (`:3427`), so a slot is
  reused only after its response was consumed; and the new `:3653` seq check means `pop` is never
  called with a slot that was not written for that `rsp.seq`.
- **F6 (PLAUSIBLE, low).** `event_synchronize` now calls `hex_event->sess->flush_pending()`
  (`:7419`) — a **queue read on the recorded session**, which `e775fb2bf` never did (it only
  called `flush_async()`). The superseded round knew this was a cross-session touch: `643332f8f`
  took the lock on exactly that object —
  `std::lock_guard<std::recursive_mutex> lock(hex_event->sess->op_mutex);` — and the final commit
  deletes it. Two threads (one computing on the recorded session, one calling
  `event_synchronize` for its event) would now both read that queue and race on
  `batch_rsp_seq` / `req_shape` / `op_cache`. Failure scenario: a torn `req_shape` read produces a
  bogus shape-mismatch error and a spurious `llama_decode -3` on a healthy device.
  Mitigating: `ggml_backend_sched_compute_splits` is single-threaded (`ggml-backend.cpp:1662`,
  `parallel` only sets `n_copies` at `:1888`), and both call sites synchronize the *current
  split's own* event (`:1681`, `:1700`), so in llama the caller and `hex_event->sess` are the same
  session on the same thread. No live race in-tree; documented assumption only.

---

## 3. Wait loops, deadlines, poll cost

`grep -n "while (true)\|while (1)\|while(1)\|for (;;)"` at head: exactly two hits, `:4155`
(`ggml_hexagon_measure_max_vmem`, pre-existing, self-terminating on allocation failure) and
`:7427` (the fence loop, bounded). `flush_pending`'s loop is bounded by `:3611`. **Every wait loop
introduced or modified is bounded. CONFIRMED.**

- `flush_pending` deadline: per call, `:3607-3608`, 30 s default. **F3 (CONFIRMED, small):** it is
  per *session*, not global, and the sub loop does not break on the first poisoned sub:
  ```cpp
  3597:    for (auto & sub : this->mdev.sessions) {
  3598:        sub->flush_pending(all);
  3599:        if (sub->last_error > HTP_STATUS_OK) { this->set_error(sub->last_error.load()); }
  3601:    }
  3602:    if (this->last_error > HTP_STATUS_OK) { return; }
  ```
  Each `sub->flush_pending` takes its own fresh 30 s, so the wall clock bound is
  `30 s × (1 + mdev.sessions.size())`, not 30 s. Failure scenario: `GGML_HEXAGON_DEVICES` with a
  3-DSP mdev group, all DSPs wedged → the parent stalls 120 s before it errors, and the recipe's
  `timeout 40` would return 124. Inert on the S23 (`mdev.count == 1` ⇒ `mdev.sessions` empty,
  `:4452-4453` is gated on `!config.mdev_group.empty()`), but it is a one-line `break` and the
  report should not claim a 30 s bound.
- Fence poll `:7450`, 200 µs. **REFUTED as a cost**: on the healthy path the loop exits on
  iteration 1, so it never sleeps. `op_fence` writes the fence *before* `process_opbatch` writes
  the response (`htp/main.c:769` inside the op, `:1284` `dspqueue_write` after `:1260`), and
  `event_synchronize` drains the response first (`:7419`), which is strictly after the fence write.
  So the fence is already satisfied when the loop is entered. Upstream's `yield()` was the
  *expensive* one (a full-rate spin on a live core); this is cheaper and bounded. Note `:7450` is
  10× tighter than the superseded round's 2 ms, which is an improvement, not a regression.
- Fence pair read `fence[0]` then `fence[1]`: sound. `htp_fence_write` stores status then seq,
  then `syncht` + `Q6_dccleaninva_A` (`htp/htp-fence.h:18-24`); `htp_fence_read` invalidates the
  line before loading (`htp/htp-fence.h:26-32`). Status is therefore visible whenever seq is.
  **REFUTED** as a torn-read hazard.
- `GGML_HEXAGON_OPPOLL=1` now sleeps 2 ms per empty poll (`:3632`) where it used to spin. Latent
  healthy-path regression **only if that knob is set**; it is plumbed as an empty `$OP` in
  `BigMoeOnEdge/third_party/llama.cpp/scripts/snapdragon/adb/run-tool.sh:52` and
  `run-completion.sh:55` and is set nowhere in the campaign. Flagging so nobody turns it on for a
  throughput arm without knowing.

---

## 4. Healthy path vs upstream

Measurable added work per op/batch: **three 32-bit stores per batch** (`:3443`) and **two
`clock_gettime` calls per `flush_pending` iteration** (`:3607`, `:3610`) — a few hundred ns per
batch against a 500 tok/s decode. The per-response validation is a handful of comparisons plus
four multiplies; the `n_traces` loop (`:3684-3688`) only runs under `opt_profile == 3`, which the
campaign does not set. No default changed: `opt_opbatch 1280`, `opt_opqueue 32`, `opt_oppoll 0`,
`DSPQUEUE_TIMEOUT 1000000` are all untouched.

One real deviation, and it is the only one: **`event_synchronize` now drains the recorded
session's response queue** (`:7419`) where upstream only spun the fence (OLD `:7286`). This is new
work on the healthy path, but it is work upstream deferred to the next `flush_sync`, and it
replaces a busy spin, so the net is a CPU/latency *win*. The recipe's M1b pp512 arm is the right
empirical gate and I have no reason to expect a regression there. It is also **not** a deadlock
source (**REFUTED**): the same call already did `flush_async()` → `flush_peers()` (peers flushed
before self) and `flush_batch()` (which writes every mdev sub's group node) *before* the wait, so
every group member's node is in flight by the time anything blocks.

Everything else in the diff is error-path-only: every new `if (last_error > …) return;` is
unreachable on a healthy device.

---

## 5. `GGML_ABORT` / `GGML_ASSERT` classification

Count at head: **1 `GGML_ABORT`, 47 `GGML_ASSERT`** (OLD: 12 and 50). The single remaining abort is
`:6781 GGML_ABORT("\nggml-hex: graph-compute %s is not supported\n", ggml_op_desc(t));` — an
unsupported-op guard decided entirely host-side before anything is queued. Not DSP-reachable.

Reachable **from a skewed or dead DSP**: **zero. CONFIRMED.** Every DSP-fed field is validated
before use, in this order: `rsp_size`/`n_dbufs` (`:3645`) → `rsp.seq` (`:3653`) → `n_bufs`,
`n_tensors`, `n_ops` exact-equality plus caps (`:3662`) → payload size and `dbuf.size` and trace
counts (`:3690`) → only then `op_queue->pop(rsp, dbuf)` (`:3702`). The two asserts inside `pop`
are therefore unreachable from the wire:

- `:3513 GGML_ASSERT(m_size <= shm_blk_size);` — `m_size` is computed from the same four counts
  that `:3689` just proved `≤ shm_blk_size`, with the identical expression. Structurally
  unreachable now; upstream reached it with an OOB read.
- `:3524 GGML_ASSERT(rsp.n_ops <= ops.size());` — `op_cache[slot] = op_batch->ops` and
  `ops.resize(n_ops_max)` (`:2455`), so `ops.size() == n_ops_max` (1280) and `rsp.n_ops` is
  exact-equal to the pushed `n_ops` which is itself `≤ n_ops_max`. Unreachable.

The other 45 asserts are host-side: tensor offset/shape validation (`:1405-2199`), opbatch
accounting (`:2481`, `:2538`, `:2654`), `push`'s own `dbuf.size` (`:3465`, computed by the host
from `req.*` which is `≤ n_tens_max`), mmap/clone fd bookkeeping (`:4076`, `:4082`, `:4086`),
`unclone_buffer` (`:4127`), precompute params (`:5284`, `:5708`, `:6948`).

### The exact-shape check cannot false-trip on a matched skel — REFUTED as a hazard
This was the one thing that could have bricked the matched arms, so it is verified three ways:

1. **The DSP echoes the request's counts.** `htp/main.c:1162-1164` reads `req->n_bufs`,
   `req->n_tensors`, `req->n_ops` into locals; `:1268-1270` `rsp.n_bufs = n_bufs; rsp.n_tensors =
   n_tens; rsp.n_ops = n_ops;`. Unmodified on the wire. Round-trips exactly.
2. **The caps cannot be exceeded by a legitimate batch.** `opt_opbatch = 1280` (`:113`), and
   `n_tens_max = std::min<size_t>(n_ops_max + n_ops_max * HTP_OP_MAX_INPUTS, HTP_OP_MAX_TENSORS)`
   (`:2459`) = `min(14080, 8192)` = **8192** = `HTP_OP_MAX_TENSORS` (`htp/htp-ops.h:127`). So
   `rsp.n_tensors > HTP_OP_MAX_TENSORS` is unsatisfiable; `n_bufs ≤ HTP_OP_MAX_BUFS` = 16 by
   `GGML_ASSERT(n_bufs < HTP_OP_MAX_BUFS)` at `:2481`. Both cap tests are vacuous-but-harmless.
3. **The shipped "matched" skel really is built from this source.** `build-hex-attempt-1.log`
   step `[7/32] Building C object CMakeFiles/ggml-htp-v73.dir/main.c.obj` — compiled in-tree, not
   pulled from a prebuilt dir. I re-verified the artifact hashes against `FIX-engine.md`:
   `libggml-htp-v73.so 4b822b58…`, `libggml-hexagon.so 5a663b0e…`, `llama-bench ede63f22…` — all
   match, and the banner string is in the `.so` with no `healthcheck`/`probe` strings.

And `dbuf.size` (the queue-carried buffer size the check at `:3690` trusts) is the host's own
value round-tripped: the DSP writes the response with `struct dspqueue_buffer write_dbuf = *dbuf;`
(`htp/main.c:1281`), so `dbuf.size == rsp_payload` exactly and the strict `<` passes.

---

## 6. N8-N11 closures, and release/buffer_clear on an errored session

| | status |
|---|---|
| **N8** over-propagation to mdev subs | still open by design, as r2 said. Accepted; still not in `FIX-engine.md`. Multi-DSP only. |
| **N9** peer propagation | **REFUTED as closed — see F1.** |
| **N10** `enqueue_mdev_group` unguarded | **CONFIRMED closed.** `:3826 if (this->last_error > HTP_STATUS_OK) return;` runs before `op_batch->add_op(group_node)` at `:3866`, and `enqueue_op`'s own `:3781` guard now means the `start_batch()` at `:3809` is unreachable on an errored session. |
| **N11** `buffer_clear` / `release_buffer` | closed, with F4/F7 below. |

**F1 (CONFIRMED, medium) — `set_error` cannot mark peers, and peers cannot poison the parent.**
`:3581` and `:3585` iterate `this->virt_peers` / `this->phys_peers`, but `flush_peers()` moves
both sets into locals and clears the members (`:3550-3551`, `:3556-3557`) *before* flushing
anything. `flush_sync` is `flush_async()` then `flush_pending()` (`:3708-3711`), and `flush_async`
is what calls `flush_peers`. So by the time any `set_error` in the `flush_pending`/`flush_batch`
body runs, both member sets are empty and the two peer loops are no-ops. The only surviving
non-empty case is a `set_error` from the fence loop (`:7433`, `:7445`), which does not go through
`flush_peers` first.

Failure scenario (`GGML_HEXAGON_DEVICES=2`, the exact r2 N9 scenario): HTP0's session dies and
sets its own `last_error` inside `peer->flush_sync()`; HTP1's session is never told. HTP1 keeps
enqueueing into a queue no one drains, its `flush_pending` burns its own fresh 30 s, and because
`flush_batch` only checks `this->last_error` (`:3720`) and `flush_pending` only re-checks
`mdev.sessions` (`:3597`), the parent never learns. The user sees a 30 s stall per turn on the half
of the device that "should" have failed fast — the r2 N9 symptom, unfixed. In the mdev topology
it is worse: the parent's DSP blocks in `htp_mdev_group_barrier` because the poisoned sub stopped
writing its group node (`htp/htp-fence.h:51-77`), so the parent burns 30 s *after* the peer's 30 s.
Fix: check `peer->last_error` after each `peer->flush_sync()`/`flush_async()` in `flush_peers` and
call `this->set_error(...)`, and drop the two dead loops in `set_error`. Inert on the S23.

**F2 (CONFIRMED, medium) — teardown is still unbounded, and the abort it replaced was a
fail-stop.** `:4388-4392`:
```cpp
        err = htp_iface_stop(this->handle);
        if (err != 0) {
            GGML_LOG_WARN("ggml-hex: %s htp_iface_stop failed during release: 0x%08x\n", …);
        }
```
`htp_iface_stop` is `atomic_store(&ctx->killed, true); qurt_thread_join(ctx->main_thread, &status);`
(`htp/main.c:632-636`) — an **untimed** join. The DSP observes `killed` only between batches
(`:1302`, `:1352`), so a DSP that is mid-op or mid-spin keeps the host blocked in teardown for as
long as that op takes. On a healthy or dead device that is short. On a *wedged* device it is not,
and the old `GGML_ABORT` would at least have produced exit 134 instead of a hang. The second
warn (`:4427-4431`, `dspqueue_close`) then continues into `htp_iface_close` and the buffer
destructors, which `fastrpc_munmap` mappings a still-running DSP may be reading. The commit
message's "no aborts reachable from a skewed/dead DSP" is true for the data path and false for
teardown, where a warn-and-continue is the *less* safe choice. Not a blocker for M1/M1b; it is the
mechanism by which a stale arm could produce 124 instead of 1 (see F8).

**F3 (CONFIRMED, small)** — see §3: 30 s × (1 + mdev subs), not 30 s.

**F4 (PLAUSIBLE, small) — `release_buffer`'s log-and-return can make `release()` loop forever.**
`:4104-4117` returns *before* the `cloned_buffers.find(fd)` / `erase`, and `release()` drives it
with (`:4407-4409`):
```cpp
    while (!this->cloned_buffers.empty()) {
        release_buffer(this->cloned_buffers.begin()->second.get());
    }
```
If either early return ever fires, the entry is never erased and this loop never terminates. Today
it cannot fire: `ggml_hexagon_rpcmem_block` throws when `rpcmem_to_fd` fails (`:604-608`), so a
live block always has `fd ≥ 0`, and `free_buffer` un-clones before `delete sbuf` (`:784-788`) so
`sbuf->mem` is non-null at that point. But the change replaced a *terminating* failure (abort)
with a *potentially non-terminating* one, in the exact failure class this fix exists to remove. One
line: erase the entry before the checks, or `GGML_ABORT` here specifically.

**F5 (PLAUSIBLE, small) — the `cpy_tensor_async` guard redirects work instead of skipping it.**
`:7361 if (sess_src->last_error > HTP_STATUS_OK || sess_dst->last_error > HTP_STATUS_OK) return false;`
`false` means "cannot do this async" to both callers. `ggml-backend.cpp:1800-1807` then does
`ggml_backend_synchronize(...)` and `ggml_backend_tensor_copy(input, input_cpy)`, which for an
HTP destination is a **host `memcpy` into the rpcmem mapping** — the precise thing
`buffer_clear`'s new guard (`:2250-2251`, "The DSP may still be reading the mapping") refuses to
do. `ggml_backend_tensor_copy_async` (`:519-528`) does the same. Failure scenario: after a fence
timeout, the next split's input copy is performed synchronously by the host into a buffer a
wedged DSP may still be reading, instead of being dropped. `ggml_backend_hexagon_cpy_tensor` (the
`.cpy_tensor` device op) has no error guard at all. Post-error only, and the decode has already
failed, so this is a robustness nit — but the guard reads as protection and is not.

**F6 (PLAUSIBLE, low)** — see §2.

**F7 (CONFIRMED, cosmetic/report) — the `buffer_clear` skip logs at ERROR, every call.**
`:2250-2253`:
```cpp
        // The DSP may still be reading the mapping, and every later compute on this
        // session fails anyway, so zeroing it now is both unsafe and pointless.
        GGML_LOG_ERROR("ggml-hex: %s clear-buff skipped : dsp-error %s\n", sess->c_name(), status_to_str(sess->last_error));
```
`llama_kv_cache::clear()` and the recurrent/DSV4 equivalents call `ggml_backend_buffer_clear` on
every context shift (`src/llama-kv-cache.cpp:418`, `llama-memory-recurrent.cpp:154`), so a
long-lived process prints one ERROR per clear *after* the first failure, and a second context
created later prints it at init — indistinguishable from a new failure to a log grep. It is a
benign, expected skip: `GGML_LOG_WARN`, or gate it on the same one-shot idiom as
`sync_error_reported` (`:7036`).

**F8 (PLAUSIBLE, recipe) — the stale skel is not "one field" skewed, and the S-arm outer timeout
is the acceptance criterion's weakest link.** `strings` comparison of
`~/Projects/llama.rn-kalsa-gov-platform/bin/arm64-v8a/libggml-htp-v73.so` (`f81f95e9…`, built
from `/home/runner/work/llama.rn/…`, i.e. CI, not this tree) against the matched skel:

| pattern | matched | stale |
|---|---|---|
| `mdev` / `MDEV` | 15 | **0** |
| `fence` | 7 | **0** |
| `sync-wait` | 2 | **0** |
| `sync-wait TIMEOUT` | present | **absent** |
| `mdev %u peer %u failed` | present | **absent** |
| `ggml-hex:` | 13 | 2 (`error powering on HMX.`, `failed to acquire VTCM`) |

The stale skel predates the fence and mdev-group protocol entirely (its kernel set is also much
older: `hvx_mm_qkv_2d…` vs `hvx_mm_4d…`, `hvx_argsort_f32_fallback` vs `htp_argsort_merge_l1_job`).
So the recipe's predicted line — `"batch response sequence mismatch : expected <n>, got <n>"` — is
a guess. Plausible outcomes instead: `htp_iface_open`/`start` succeeds and the DSP rejects the
request (`if (r_size < sizeof(req) || n_dbufs != 1) { FARF(ERROR, "invalid request…"); continue; }`,
`htp/main.c:1319-1322`) ⇒ silent drop ⇒ the host hits the 30 s batch timeout (the recipe's stated
alternative, fine); or the DSP faults ⇒ `dspqueue_read` returns a non-EWOULDBLOCK error ⇒
`set_error(INTERNAL_ERR)` in milliseconds; or the old skel spins somewhere with no
`HTP_FENCE_TIMEOUT` bail-out ⇒ the host times out at 30 s, then `release()` blocks in
`qurt_thread_join` (F2) ⇒ **the process does not exit and `timeout 40` yields 124**, which the
recipe says must never happen. Amend: `timeout 90` for S1/S2, treat 124 as a separate recorded
outcome rather than a failure of the fix, and pull logcat before concluding anything.

---

## 7. `-3` reaches the user — CONFIRMED, verified end to end

`graph_compute` returns `GGML_STATUS_FAILED` when `sess->last_error > HTP_STATUS_OK` after
`flush_sync` (`:7021-7026`); `llama_context::graph_compute` propagates the status
(`src/llama-context.cpp:2614-2617`); `llama-context.cpp:1549` and `:1935` map
`GGML_STATUS_FAILED` → `-3`, which is what `llama-bench` prints as
`"failed to decode prompt batch, res = -3"` (`tools/llama-bench/llama-bench.cpp:2186-2188`).
Critically, `ggml_backend_sched_compute_splits` returns on the first failing split
(`ggml-backend.cpp:1813-1816`) **before** recording the event and before any output copy, so no
partially-computed tensor is ever read back. **There is no path to silently wrong logits.** The
`-3` claim in `FIX-engine.md` is real.

## 8. Two claims in the report that do not hold, and two that do

- **Holds:** the `-3` contract (§7); the timeout knob's range/parse; the banner printing the
  *effective* value (`reg->context = new ggml_hexagon_registry(reg);` is the last statement of
  `ggml_hexagon_init` (`:8656`), after the parse at `:8432-8447`); no missing `<chrono>`
  (`:12`); `sync_error_reported` never needing a reset (`allocate()` is called once, `:4449`).
- **Does not hold:** "set_error symmetric to virt/phys peers" / r2 N9 closed (F1); "no aborts
  reachable from a skewed/dead DSP" — true for the data path, not for `release()` (F2).
- **r2 N16 is wrong for this tree:** `GGML_LOG_INFO` is unconditional
  (`ggml/src/ggml-impl.h:119 GGML_LOG_INFO(...) ggml_log_internal(GGML_LOG_LEVEL_INFO, …)`), not
  compiled out at trace level 4, so the "batch response timeout 30000 ms" evidence line does
  appear — provided the caller keeps a log callback (`llama-bench` installs a null one without
  `-v`, which `FIX-engine.md` already handles).

## 9. Not verified

No device, no build of my own: the Hexagon SDK is not on this host, so I could not reproduce the
Android compile. I verified the changed lines by inspection for warning-cleanliness and confirmed
the recorded build produced no `ggml-hexagon.cpp` warnings
(`build-attempt-2.log`, `build-hex-attempt-1.log` — the only hexagon warnings are
`-Wgnu-zero-variadic-macro-arguments` in `htp_iface.h`, pre-existing and in a different file).
Nothing is measured on silicon: M1/M1b/M2/S1/S2 all remain unrun, and the pp512 comparison against
the 878-882 band is still the only real throughput gate.
