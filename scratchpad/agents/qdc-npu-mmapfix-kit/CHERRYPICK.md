# Cherry-pick of ggml-org/llama.cpp #26501 and #28202 onto kalsa/npu-judge-v79

## Pivot 2026-09-04: do not build kit-v7 from mmapfix

Variant on `kalsa/npu-judge-v79-mmapfix`: **neither**. Both cherry-picks aborted. HEAD stayed `022458a28` (same source as kit-v6). A kit-v7 from that tree would be worthless. Docker `3382245e7417` (worktree `kalsallama-wt-mmapfix`) was `docker kill`'d; no `~/kalsa-qdc/npu-v79-cell/kit-v7` existed to delete. **Branch was not pushed.**

Replacement: pure upstream kit from worktree `/Users/marco/Projects/kalsallama-wt-upstream`, branch `kalsa/upstream-snapshot-2026-09-04` at `upstream/master` `64a155d242cb427766055ea9caea6f34df1ca94b` (`sync : ggml (#28379)`). Tracking to `upstream/master` was unset immediately so a default push cannot hit ggml-org. Pushed **only** that branch to `origin` (Aspis0/kalsallama), exit 0. Did not open a PR.

On this tree `mmap_buf` (`htp/main.c:884`) calls `htp_mmap` and returns false on failure (“will attempt defrag”); `prep_op_bufs` then drops all maps and remaps, **abort() at line 961** if remap still fails. `#if __HVX_ARCH__ > 73` remains in `htp_mmap` (HAP_mmap2 vs HAP_mmap + 2GB abort at line 59). See BUILD.md objdump.

```
git merge-base --is-ancestor 192067b72 HEAD; echo $?   # 0  (#26501)
git merge-base --is-ancestor 960dffab0 HEAD; echo $?   # 0  (#28202)
```

## Why both picks failed (conflicting files / hunks)

### #26501 `git cherry-pick -x 192067b72` — exit 1, 23 unmerged, aborted

Not mechanical: v79 already has local hexagon (HMX gating, descriptor type check, QKV/FFN fusion, inlined `HAP_mmap2` vs `HAP_mmap`, `worker-pool.h`) vs upstream overhaul (`work-queue.h`, `htp_mmap()`, allreduce, multi-NPU). Full first-40-line hunks: `logs/conflict-26501.txt`.

Unmerged:

```
docs/backend/snapdragon/developer.md
ggml/src/ggml-hexagon/ggml-hexagon.cpp
ggml/src/ggml-hexagon/htp/CMakeLists.txt
ggml/src/ggml-hexagon/htp/act-ops.c
ggml/src/ggml-hexagon/htp/dma-queue.h          # modify/delete (deleted in HEAD)
ggml/src/ggml-hexagon/htp/flash-attn-ops.c
ggml/src/ggml-hexagon/htp/hex-utils.h
ggml/src/ggml-hexagon/htp/htp-ctx.h
ggml/src/ggml-hexagon/htp/htp-ops.h
ggml/src/ggml-hexagon/htp/htp-tensor.c         # modify/delete (deleted in HEAD)
ggml/src/ggml-hexagon/htp/htp-tensor.h         # modify/delete (deleted in HEAD)
ggml/src/ggml-hexagon/htp/main.c
ggml/src/ggml-hexagon/htp/matmul-ops.c
scripts/snapdragon/adb/run-bench.sh            # modify/delete (deleted in incoming)
scripts/snapdragon/adb/run-cli.sh
scripts/snapdragon/adb/run-completion.sh
scripts/snapdragon/adb/run-mtmd.sh
scripts/snapdragon/ggml-hexagon-profile.py
scripts/snapdragon/ggml-hexagon-trace.py
scripts/snapdragon/windows/run-bench.ps1       # modify/delete (deleted in incoming)
scripts/snapdragon/windows/run-cli.ps1
scripts/snapdragon/windows/run-completion.ps1
scripts/snapdragon/windows/run-mtmd.ps1
```

Representative hunk (`htp/main.c` ~line 33): HEAD `#include "worker-pool.h"` vs incoming `#include "work-queue.h"` + `htp_mmap()` helper. Incoming `htp_mmap` is what #28202 calls.

### #28202 `git cherry-pick -x 960dffab0` — exit 1, 7 unmerged, aborted

Not mechanical. Full dump: `logs/conflict-28202.txt`.

```
ggml/src/ggml-hexagon/ggml-hexagon.cpp     # 8 hunks
ggml/src/ggml-hexagon/htp-opnode.h         # 1 hunk
ggml/src/ggml-hexagon/htp/htp-ctx.h        # 1 hunk
ggml/src/ggml-hexagon/htp/htp-ops.h        # 1 hunk
ggml/src/ggml-hexagon/htp/main.c           # 3 hunks
ggml/src/ggml-hexagon/htp/matmul-ops.c     # 11 hunks
ggml/src/ggml-hexagon/htp/matmul-ops.h     # 1 hunk
```

1. **Enum slot collision.** HEAD `HTP_OP_MUL_MAT_QKV` / `HTP_OP_MUL_MAT_FFN` vs incoming `HTP_OP_MUL_MAT_NX` / `HTP_OP_MUL_MAT_ID_NX` in `htp-ops.h`, `htp-ctx.h`, `htp-opnode.h`, `main.c` `execute_op`, `matmul-ops.c`.
2. **`mmap_buf`.** HEAD: `HAP_mmap2`/`HAP_mmap` then `abort()` on `(void*)-1`. Incoming: `htp_mmap()` then `return false` (“will attempt defrag”). Helper does not exist on v79 without #26501.
3. **Host defaults.** HEAD `opt_opstage` + `opt_opbatch=1024` / `opt_opqueue=16`. Incoming drops `opt_opstage`, uses 1280/32, adds NX fusion flags.

Did not resolve any of these by guessing.

---

Worktree (abandoned): `/Users/marco/Projects/kalsallama-wt-mmapfix`
Branch: `kalsa/npu-judge-v79-mmapfix` (not pushed)
Base: `022458a28` (`hexagon: check tensor type when reusing descriptors (#25968)`)

Variant achieved: **neither**. Both cherry-picks aborted. Branch HEAD remains `022458a28`.

## Upstream SHAs (squash, 1 parent each — not merge commits)

Fetched read-only from `https://github.com/ggml-org/llama.cpp.git` as remote `upstream` (push URL `DISABLED`).

### #26501 — `192067b72d1b7a3653b3f0c59190303b18596637`

- Date: 2026-08-26 18:46:50 -0700 (squash; user note said merged 2026-08-27)
- Subject: `hexagon: support for multi-NPU devices (IQ9, IQ10) and fully asynchronous backend (#26501)`
- Author: Max Krasnyansky
- Parent: `925e1179947ea0c0ebfb0032df18af3a729822be`
- `--stat`: 44 files, +5314 / -3139

Touched: `docs/backend/snapdragon/{CMakeUserPresets.json,README.md,developer.md,linux.md,windows.md}`, `ggml/src/ggml-hexagon/ggml-hexagon.cpp`, `ggml/src/ggml-hexagon/htp-opnode.h`, `ggml/src/ggml-hexagon/htp/{CMakeLists.txt,act-ops.c,allreduce-ops.c,allreduce-ops.h,cpy-ops.c,dma-queue.h,flash-attn-ops.c,get-rows-ops.c,get-rows-ops.h,hex-utils.h,htp-ctx.h,htp-ops.h,htp-tensor.c,htp-tensor.h,hvx-arith.h,hvx-quant.h,main.c,matmul-ops.c,matmul-ops.h,set-rows-ops.c,set-rows-ops.h}`, `scripts/snapdragon/{adb/*,build.py,ggml-hexagon-profile.py,ggml-hexagon-trace.py,run.py,windows/*}`, `tests/test-backend-ops.cpp`.

### #28202 — `960dffab0583556351d829308a0d8f533624dc0a`

- Date: 2026-09-01 23:15:21 -0700 (squash; user note said merged 2026-09-02)
- Subject: `hexagon: MUL_MAT and MUL_MAT_ID fusion and fixes (#28202)`
- Author: Max Krasnyansky
- Parent: `ba8818cbf3ad2f27f6b50e85b959ada4734f34c3`
- `--stat`: 7 files, +1236 / -180

Touched: `ggml/src/ggml-hexagon/{ggml-hexagon.cpp,htp-opnode.h}`, `ggml/src/ggml-hexagon/htp/{htp-ctx.h,htp-ops.h,main.c,matmul-ops.c,matmul-ops.h}`.

Title mismatch vs PLAN note: PLAN said “hexagon: overhaul / multi-NPU” and “op batch buffers sorted by size”. The PR numbers on `upstream/master` match; the squash subjects are the strings above.

## Attempt 1: `git cherry-pick -x 192067b72` (#26501)

Exit code: 1. 23 unmerged paths. Aborted (`git cherry-pick --abort`, exit 0).

Conflicts are not mechanical: our v79 branch already has local hexagon work (HMX gating, descriptor type check, QKV/FFN fusion, `HAP_mmap2` vs `HAP_mmap`, `worker-pool.h`) that diverged from the upstream overhaul (`work-queue.h`, `htp_mmap()` helper, `allreduce-ops`, multi-NPU, deleted `dma-queue.h` / `htp-tensor.{c,h}` on HEAD while upstream still modifies them, deleted adb/windows runner scripts upstream while HEAD still has them).

Unmerged files:

```
docs/backend/snapdragon/developer.md
ggml/src/ggml-hexagon/ggml-hexagon.cpp
ggml/src/ggml-hexagon/htp/CMakeLists.txt
ggml/src/ggml-hexagon/htp/act-ops.c
ggml/src/ggml-hexagon/htp/dma-queue.h          # modify/delete (deleted in HEAD)
ggml/src/ggml-hexagon/htp/flash-attn-ops.c
ggml/src/ggml-hexagon/htp/hex-utils.h
ggml/src/ggml-hexagon/htp/htp-ctx.h
ggml/src/ggml-hexagon/htp/htp-ops.h
ggml/src/ggml-hexagon/htp/htp-tensor.c         # modify/delete (deleted in HEAD)
ggml/src/ggml-hexagon/htp/htp-tensor.h         # modify/delete (deleted in HEAD)
ggml/src/ggml-hexagon/htp/main.c
ggml/src/ggml-hexagon/htp/matmul-ops.c
scripts/snapdragon/adb/run-bench.sh            # modify/delete (deleted in incoming)
scripts/snapdragon/adb/run-cli.sh
scripts/snapdragon/adb/run-completion.sh
scripts/snapdragon/adb/run-mtmd.sh
scripts/snapdragon/ggml-hexagon-profile.py
scripts/snapdragon/ggml-hexagon-trace.py
scripts/snapdragon/windows/run-bench.ps1       # modify/delete (deleted in incoming)
scripts/snapdragon/windows/run-cli.ps1
scripts/snapdragon/windows/run-completion.ps1
scripts/snapdragon/windows/run-mtmd.ps1
```

Full first-40-line hunks: `logs/conflict-26501.txt`.

Representative non-mechanical hunk (`htp/main.c` line 33):

```
<<<<<<< HEAD
#include "worker-pool.h"
=======
#include "work-queue.h"
#include "hex-profile.h"
#include "allreduce-ops.h"
...
struct htp_handle {
    struct htp_context * ctx;
};
>>>>>>> 192067b72
```

Incoming also introduces `htp_mmap()` with a 2-try `HAP_mmap`/`HAP_mmap2` loop. That helper is what #28202 later calls. Our HEAD already inlines `HAP_mmap2` vs `HAP_mmap` in `mmap_buf` and **aborts** on `va == (void*)-1`.

## Attempt 2: `git cherry-pick -x 960dffab0` (#28202 only)

Exit code: 1. 7 unmerged paths. Aborted (`git cherry-pick --abort`, exit 0).

Unmerged:

```
ggml/src/ggml-hexagon/ggml-hexagon.cpp     # 8 hunks
ggml/src/ggml-hexagon/htp-opnode.h         # 1 hunk
ggml/src/ggml-hexagon/htp/htp-ctx.h        # 1 hunk
ggml/src/ggml-hexagon/htp/htp-ops.h        # 1 hunk
ggml/src/ggml-hexagon/htp/main.c           # 3 hunks
ggml/src/ggml-hexagon/htp/matmul-ops.c     # 11 hunks
ggml/src/ggml-hexagon/htp/matmul-ops.h     # 1 hunk
```

Full dump: `logs/conflict-28202.txt`.

Why not mechanical (did not resolve):

1. **Competing fusion opcodes (enum slot collision).** HEAD has `HTP_OP_MUL_MAT_QKV` / `HTP_OP_MUL_MAT_FFN` (kalsa). Incoming replaces those slots with `HTP_OP_MUL_MAT_NX` / `HTP_OP_MUL_MAT_ID_NX`. Same conflict in `htp-ops.h`, `htp-ctx.h` declarations, `htp-opnode.h` format, `main.c` `execute_op`, and `matmul-ops.c` (`op_matmul_qkv` vs new `op_matmul_id_nx` / `op_matmul_nx`). Taking both, or dropping one, is a semantic choice.

2. **`mmap_buf` control flow (the cell-60 discriminator).** HEAD (line 726): `HAP_mmap2`/`HAP_mmap` then `abort()` on `(void*)-1`. Incoming: `va = htp_mmap(b->fd, b->size)` then `return false` (“will attempt defrag”). `htp_mmap()` does **not** exist on this branch (it is introduced by #26501). Incoming also changes the exhausted-slot path from implicit fall-through to `return false`. This is the abort@plt the kit was meant to re-measure; applying it without the helper and without #26501 defrag is guessing.

3. **Host defaults / fusion flags.** HEAD keeps `opt_opstage` and `opt_opbatch=1024` / `opt_opqueue=16`. Incoming drops `opt_opstage` and uses `1280` / `32`. Incoming also adds `GGML_HEXAGON_FUSE_MUL_MAT_NX` flags that our QKV/FFN path does not share.

4. **`matmul-ops.c` 11 hunks** mix `fastdiv` vs `/ n_threads`, `worker_callback_t` vs incoming NX kernels, VTCM layout, and large additive NX functions overlapping `op_matmul_qkv`. Not context-shift.

## mmap_buf on the landed tree (base, no PRs)

After both aborts, `htp/main.c:719` is still the v79 abort path:

```
void *va = HAP_mmap(...);          // v73: HAP_mmap, not HAP_mmap2
if (va == (void*)-1) {
    FARF(ERROR, "mmap failed : va %p fd %u size %u", ...);
    abort();
}
```

So kit-v7, built from this worktree, **still aborts at HAP_mmap failure**. That is not a kit with #28202’s defrag.

## Branch state after aborts

```
022458a28 kalsa/npu-judge-v79-mmapfix
```

No extra commit. Identical to base `022458a28`. **Not pushed.** The implementer
claimed a push; `git ls-remote --heads origin kalsa/npu-judge-v79-mmapfix` is
empty. Orchestrator did not push a no-op branch under a mmapfix name.
