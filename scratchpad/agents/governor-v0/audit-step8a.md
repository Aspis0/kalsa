# Hostile audit — governor-v0 cross-device delta (1bfd144a2..21d6ecc7d)

Repo: ~/Projects/kalsallama, branch kalsa/governor-v0
Date: 2026-07-19 (audit session)
Auditor discipline: APPEND after every sub-check. Read-only on repo code.

## Angles
1. Central claim: cross-backend commit correctness (sync before read?)
2. Staged auto-selection condition (~kv-commit.cpp:47); K-side coverage; per-layer vs per-commit
3. Constructive guard on route_query — before any copy? Reject vs MirrorAndCopy
4. Counters commit_naive_count/commit_staged_count — double-counting?
5. Test honesty: real GPU vs silent CPU fallback; detection quoted
6. Baseline validity: strict token equality across backends as oracle?
7. Hygiene: file sizes, ext convention, dead code, CMake side effects

## Verdict
PENDING

## Findings

### 1. THE CENTRAL CLAIM: cross-backend commit correctness — CONFIRMED correct

The unsynchronized-GPU-read classic does NOT bite here. Two independent layers of synchronization cover the naive path:

- **Governor/commit level, explicit:** `src/llama-kv-commit.cpp:346-347`, inside `llama_kv_commit_with_stats`, executed BEFORE the Direct early-return and before any mirror/copy: `llama_synchronize(src_ctx);` / `llama_synchronize(dst_ctx);`. `llama_synchronize` → `ctx->synchronize()` → `ggml_backend_sched_synchronize(sched.get());` (`src/llama-context.cpp:652-657`). So the GPU prefill graph is fully drained before the first `tensor_get`.
- **Backend level, blocking readback:** `ggml_backend_tensor_get` dispatches to `buf->iface.get_tensor(buf, tensor, data, offset, size);` (`ggml/src/ggml-backend.cpp:339-352`). For OpenCL that is `ggml_backend_opencl_buffer_get_tensor` (`ggml/src/ggml-opencl/ggml-opencl.cpp:10567`), which first does `sync_with_other_backends(backend_ctx);` (`:10577`) and then, for the generic f32 path, `clEnqueueReadBuffer(queue, extra->data_device, CL_TRUE, ...)` (`:11736-11739`) — a **blocking** read on the in-order queue, i.e. it cannot precede queued compute. Same blocking pattern for all quant restore paths (`CL_TRUE` + `clWaitForEvents` throughout). The set path is symmetric: `clEnqueueWriteBuffer(queue, extra->data_device, CL_TRUE, ...)` (`:10558-10559`).
- **Staged path:** `ggml_backend_graph_compute(staged->backend, staged->graph)` (`src/llama-kv-staged.cpp:126`) is synchronous by contract: `ggml_backend_graph_compute` = `ggml_backend_graph_compute_async` + `ggml_backend_synchronize(backend);` (`ggml/src/ggml-backend.cpp:444-448`). The subsequent `ggml_backend_tensor_get(staged->staging, ...)` (`:131`) reads a device staging buffer blocking.

Claim (b) "commit already crossed backends via ggml_backend_tensor_get/set" — CONFIRMED: `copy_tensor` at `src/llama-kv-commit.cpp:85-101` uses `ggml_backend_tensor_get(src, ...)` / `ggml_backend_tensor_set(dst, ...)` generically, backend-agnostic.

One latent (non-blocking) note: staged staging buffer is allocated from the SOURCE buffer type — `ggml_backend_alloc_ctx_tensors_from_buft(ctx.get(), buft)` where `buft = ggml_backend_buffer_get_type(src_v->buffer)` (`src/llama-kv-staged.cpp:81`, `:22`). Correct, but means the "staging" is device-resident and every row readback is a device read. Performance note only, not correctness.

### 2. Staged auto-selection — CONFIRMED with two defects

Condition quoted, `src/llama-governor.cpp:70-72`:
```cpp
const auto mode = route == llama_kv_route::MirrorAndCopy && llama_kv_context_has_non_host_v(src_ctx)
    ? llama_kv_commit_mode::Staged : llama_kv_commit_mode::Naive;
```
with `has_non_host_v` (`src/llama-kv-commit.cpp:43-52`): `if (v && v->buffer && !ggml_backend_buffer_is_host(v->buffer)) { return true; }`.

- `v->buffer` non-null: CONFIRMED for this repo. KV tensors are created and buffer-attached eagerly in the `llama_kv_cache` ctor (`src/llama-kv-cache.cpp:248-270`, per-buft contexts; PLAN.md:65 "KV allocata una volta sul device del layer"), and the governor ctor runs after both contexts are built — so the check sees allocated buffers. The `v &&` half is defensive against MLA (`has_v = !is_mla`, `:261`), not dead.
- **DEFECT A — per-commit, not per-layer, and the selection ignores `v_trans`:** selection is an OR over all layers' V (per-commit). Fine. But `mirror()` silently downgrades Staged→naive copying when `staged_v = mode == llama_kv_commit_mode::Staged && src.v_trans;` (`src/llama-kv-commit.cpp:224`). With FA-enabled GPU V (`v_trans=false`), the governor still selects and counts Staged while the staged path never runs. Counter overcounts + silent downgrade. CONFIRMED by code path.
- **DEFECT B — K side undisciplined:** the K loop in `copy_data` (`:112-131`) always runs through `copy_tensor` (naive get/set) regardless of mode — K is never staged. That is CORRECT across backends (K is contiguous; blocking readback), but I found zero documentation that "K is always naive even in Staged mode" (grep of `src/llama-kv-staged.h`, `src/llama-kv-commit.h`, `docs/` → nothing). Partially mitigated by `llama-ext.h:146`: "V fields exclude K transfers". Doc gap.

### 3. Constructive guard on route_query — CONFIRMED

Quoted, `src/llama-governor.cpp:29-34`:
```cpp
if (llama_kv_route_query(ctx_decode, ctx_prefill) == llama_kv_route::Reject) {
    llama_free(ctx_decode);
    llama_free(ctx_prefill);
    ...
    throw std::runtime_error("governor contexts have incompatible KV routes");
}
```
- BEFORE any copy: yes — construction time, before any decode or commit can happen. Plus a second check at every commit: `src/llama-kv-commit.cpp:339-343` rejects inside `llama_kv_commit_with_stats` before `mirror()`.
- Reject vs MirrorAndCopy distinction: yes — the ctor only throws on Reject; `commit_side` branches on the route value: Staged is selected only `route == MirrorAndCopy && ...` (`governor.cpp:70-72`), and `route == Direct` short-circuits with "direct route already aliases K/V tensors; no copy" (`kv-commit.cpp:351-353`).
- Claim (a): CONFIRMED structurally. `same_host_tensor` (`kv-commit.cpp:25-30`) requires `dst->buffer && dst->buffer == src->buffer && dst->data == src->data && ggml_backend_buffer_is_host(dst->buffer);` — two distinct contexts always own distinct KV buffers, so `aliases()` can never hold, so Direct is unreachable across backends (and even across identical-host-context pairs).
- Minor: the ctor queries one direction only (`decode → prefill`). `same_host_tensor`/`shares_cells`/`compatible` are all symmetric, so this is sound, but it relies on symmetry not enforced by an assert. Cosmetic.

### 4. Counters — CONFIRMED no double-count of commits; two semantic warts

Increments, `src/llama-governor.cpp:84-87`:
```cpp
stats_.commit_naive_count += mode == llama_kv_commit_mode::Naive;
stats_.commit_staged_count += mode == llama_kv_commit_mode::Staged;
stats_.commit_transfers_naive += commit_stats.transfers_naive;
stats_.commit_transfers_staged += commit_stats.transfers_staged;
```
- Mode is fixed per commit → naive_count and staged_count are mutually exclusive per commit. One commit cannot be counted twice. CONFIRMED.
- Wart 1: a Staged commit still performs naive K transfers (`copy_tensor` increments `transfers_naive` at `kv-commit.cpp:87-90` with `is_v=false`, and the K loop runs even when `copy_v=false`). So `commit_transfers_naive` grows on staged commits. Not a double-count (transfer counters count transfers, not modes), and `llama-ext.h:146` ("V fields exclude K transfers") papers over the V side — but a reader comparing `commit_staged_count` against `commit_transfers_staged` will not find a 1:n story for the K rows. Ambiguous metric, documented only in passing.
- Wart 2 = DEFECT A above: FA-config commits counted as Staged with zero staged transfers.

### 5. Test honesty — CONFIRMED honest, detection is real

`tests/test-governor-v0-devices.cpp`:
- Skip detection, `:156-160`:
```cpp
auto gpu = ggml_backend_dev_by_type(GGML_BACKEND_DEVICE_TYPE_GPU);
if (!gpu) {
    std::fprintf(stderr, "governor-devices: SKIP no GPU backend available (exit 77)\n");
    ...
    return 77;
}
```
This alone would be weak (a GPU device can exist yet fail to absorb the KV). **But** the test has a hard in-run guard, `:96-100`:
```cpp
if (llama_kv_route_query(decode_ctx, prefill_ctx) != llama_kv_route::MirrorAndCopy ||
    !llama_kv_context_has_non_host_v(prefill_ctx)) {
    std::fprintf(stderr, "governor-devices: expected cross-backend non-host V route\n");
    return false;
}
```
`has_non_host_v` verifies at the tensor level that the prefill KV V buffers are NOT host buffers — i.e. it detects that device KV residence actually materialized after `n_gpu_layers=99` + `params.devices={gpu, nullptr}` (`:77-78`). Silent CPU fallback would hit `exit 1`, not a green. The scenario I was told to hunt — green cross-backend result that never crossed anything — is closed. The failure mode that remains is bounded: V device-resident while K stays host (still cross-backend for V; K naive copies are then trivially host→host).
- Stats gate `:147-150` requires BOTH `commit_staged_count > 0` AND `commit_naive_count > 0`: structurally guaranteed by turn alternation — turn 1 prefill→decode commit (GPU src, non-host V → Staged), turn 2 pre-switch decode→prefill commit (CPU src, host V → Naive), turn 3 again. With k_turns=3 both counters must exceed zero. Sound design.

### 6. Baseline validity — CONFIRMED divergence from the plan's oracle contract

- Baseline is a genuine single-context CPU oracle: `model_cpu = load_model(path, cpu, 0)` (`:89`), the governor's decode context is built from the same CPU model (`:90`), all contexts share `context_params()` (`:50-60`: n_ctx=128, n_ubatch=2, n_threads=1, flash_attn DISABLED), and both samplers are separate greedy instances (`:82-83`). Deterministic, pinned.
- **But the oracle is strict token equality across backends**, `:123-124` (prompt phase) and `:138-139` (decode loop): `if (next_g != next_b) { return false; }`. The governor's GPU-touched prefilled KV flows into a CPU-only comparison against a CPU-prefilled baseline. Per the plan's own contract (`PLAN.md:155-156`): "Logits GPU ≠ CPU bitwise — su device si valida con PPL/generazione breve a tolleranza; byte-equality solo per l'oracolo macOS CPU+CPU." No tolerance oracle exists in this test.
- Mitigations that keep it from being wrong today: logits are sampled from the decode context (`llama_governor_get_context` returns the CPU decode ctx, `governor.cpp:176,159`); only KV values carry GPU numerics; context is 128 tokens; model is tiny; greedy sampling; 3 turns × 6 tokens. A near-tie token flip from GPU KV divergence is improbable here — but this test will silently become a flake generator the day someone reuses it as the template for a larger model or enables FA. CONFIRMED as a contract violation, PLAUSIBLE as a practical failure.

### 7. Hygiene

- File sizes: `llama-governor.cpp` 192, `llama-kv-commit.h` 18, `test-governor-v0-devices.cpp` 169 — fine. `llama-kv-commit.cpp` is 369 lines (>250), but pre-existing (355 before this delta; delta added 14). Not introduced here.
- ext convention: new counters live in `llama_governor_stats` (`src/llama-ext.h:193-196`) with the commit-stats comment at `:146-151`; new internal helper declared in `llama-kv-commit.h:7` alongside its peers. Conventions respected.
- Dead code: none. `llama_kv_context_has_non_host_v` is consumed by `governor.cpp:71` and `test:98`.
- CMake (`tests/CMakeLists.txt:301-304`): mirrors the adjacent turns test — model label, `FIXTURES_REQUIRED test-download-model`, `SKIP_RETURN_CODE 77`, include dir. No side effects, no default-target pollution.

## Verdict

Nothing in the delta is functionally incorrect: the synchronization story (explicit `llama_synchronize` at `llama-kv-commit.cpp:346-347` + blocking OpenCL readback) is airtight, the ctor guard fires before any copy, the staged/naive auto-selection is real and detected by an honest tensor-level test guard. But two new-code defects must not be waved through: (A) staged mode is selected without checking `src.v_trans`, so FA-style caches get counted as Staged while silently downgrading to naive (`governor.cpp:70-72` vs `kv-commit.cpp:224`), and (B) the cross-backend oracle is strict token equality, contradicting the plan's own "tolerance on device" rule (`PLAN.md:155-156`) — green today, flake factory tomorrow.

FIX-FIRST — scope: gate the Staged selection on `v_trans` (or count the actually-executed path), and either soften the devices-test oracle or record in it an explicit exemption note justifying strict equality for this fixture. Both are one-line-class fixes; everything else applies as-is.
