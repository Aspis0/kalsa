# Hostile Audit: 214ae986e (npu-v79-judge)

**Commit:** `214ae986e` (parent `204e78259`)
**Files:** `tests/test-backend-ops.cpp` (+349/-7), `ggml/src/ggml-hexagon/ggml-hexagon.cpp` (+7/-1)
**Original patch:** `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/q32-npu-judge-exp/patch.diff`

---

## 1. Correctness of A (test-backend-ops.cpp PLAIN_HOST judge)

### 1a. Recopy covers every tensor — CONFIRMED, MINOR

`recopy_via_get_set` (`test-backend-ops.cpp:621-665`) pushes all `n_nodes` graph nodes as seed pairs, then follows `src[0..GGML_MAX_SRC-1]` and `view_src` edges. This reaches:
- **Leafs** (weights, constants): via `src[]` traversal from compute nodes.
- **Internal nodes**: pushed as seeds from `n_nodes`.
- **Views**: `p.d->view_src` triggers `stack.push_back({p.s->view_src, p.d->view_src})` instead of get/set on the view itself. Correct — views share parent storage.

`seen` set on `p.s` prevents double-copy. `p.s->src[i]` is pushed even when `p.d->src[i]` is NULL; the null dest is skipped on pop (`if (!p.s || !p.d || !seen.insert(p.s).second) continue;`). Silent skip, not crash.

**What about tensors with no buffer?** `ggml_backend_tensor_get/set` on a tensor with `buffer==NULL` is UB in ggml. But `recopy_via_get_set` only reaches tensors reachable from the graph — all graph tensors are allocated. Leaf weights have buffers. No edge case here for the planned MUL_MAT filter.

**Does it respect `ggml_nbytes` vs allocated size?** Yes: `const size_t n = ggml_nbytes(p.s)` is canonical; HTP get_tensor unpacks into `n` bytes; CPU set_tensor copies `n` bytes. The CPU buffer allocated by `graph_copy` is `ggml_backend_graph_alloc_size()` which is ≥ `ggml_nbytes`. Safe.

**When backend1 buffers are NOT is_host?** The recopy still runs — `ggml_backend_tensor_get` always calls `iface.get_tensor` regardless of `is_host` (unlike `tensor_copy` which has the `is_host` shortcut). So the unpack always happens. The semantic effect is: even on non-host HTP buffers, get/set canonicalizes the layout. This is correct — it's a superset of the needed fix.

**view_src chains:** `recopy_via_get_set` follows `view_src` to the parent. If tensor A is a view of B, and B is a graph node, the seen set ensures B is only recopied once. If B is not a graph node (leaf), it's reached via src traversal. Correct.

**Verdict:** recopy is correct and complete for the graph structure. No parent corruption from view get/set because views are skipped and their parents are copied instead.

### 1b. Runs AFTER graph_copy and BEFORE compute — CONFIRMED, OK

Call chain:
```
test_mul_mat::eval()                         [test-backend-ops.cpp:~1660]
  → compare_graph_backend_judge()            [test-backend-ops.cpp:696]
    → ggml_backend_graph_copy(backend2, graph) [line ~720]
    → recopy_via_get_set(graph, copy.graph)   [line ~730]
    → ggml_backend_graph_compute(backend1, g1) [line ~752]
    → ggml_backend_graph_compute(backend2, g2) [line ~753]
```

Recopy is between graph_copy and compute. Correct.

### 1c. Stock path (env off) is byte-for-byte stock — CONFIRMED, OK

`test-backend-ops.cpp:707-710`:
```cpp
if (!plain_host) {
    return ggml_backend_compare_graph_backend(backend1, backend2, graph, callback, user_data,
                                                test_nodes, num_test_nodes);
}
```

When env is unset or `"0"`, the function delegates to the stock `ggml_backend_compare_graph_backend`. The only delta is the callback itself, which adds `cpu_buf`/`cpu_buft` printf fields and `log_op_ref_buffers` on NaN/inf/ERR. These are pure additions to diagnostic output — no change to pass/fail logic. Callback still returns `true` on fail (same as before). No BLOCKER.

**`ggml_test_env_on` semantics** (`test-backend-ops.cpp:469-471`): NULL, empty string, `"0"` → off. Anything else → on. Correct.

### 1d. eval_perf / eval_grad bypass — CONFIRMED, NOT A FINDING

- `eval_perf` (`:1848`): single-backend perf run. No `ggml_backend_compare_graph_backend` call. Not affected.
- `eval_grad` (`:2030`): computes gf + gb, compares gradients algebraically. No `ggml_backend_compare_graph_backend` call. Not affected.
- Only `eval` (`:1660`) calls `compare_graph_backend_judge`. The `-o MUL_MAT` test path goes through `eval`. Call chain is `main → test->eval(backend) → compare_graph_backend_judge`. **Confirmed.**

### 1e. Whole-graph vs stock node-by-node — PLAUSIBLE, MINOR

The stock path uses `ggml_graph_view` for node-by-node compute when `num_test_nodes==0`:
```
stock: ggml_backend_compare_graph_backend
  → for each node i: ggml_graph_view(g, i, i+1) → graph_compute(view)
```

The judge path does whole-graph compute:
```
judge: compare_graph_backend_judge
  → ggml_backend_graph_compute(backend1, g1)   // whole graph
  → ggml_backend_graph_compute(backend2, g2)   // whole graph
```

For MUL_MAT tests with default `o=1`, graphs are single-op + OP_NONE sentinels. No cross-node dependencies. Whole-graph vs node-by-node produces identical results. **For the planned filter, this is not a confounder.** However, this wrapper is NOT a drop-in replacement for the stock compare for fused/multi-op tests. Do not use `PLAIN_HOST=1` on the full suite without understanding this.

### 1f. view exclusion in callback loop — CONFIRMED, OK

`compare_graph_backend_judge` (`:763-771`):
```cpp
if (ggml_is_view_op(t1->op)) {
    continue;
}
```

Views are skipped in the comparison callback. This matches the stock path behavior. Correct.

---

## 2. Correctness of B (ggml-hexagon.cpp error_count)

### 2a. Reset before any op completes — CONFIRMED, OK

`ggml_backend_hexagon_graph_compute` (`:3617`):
```cpp
sess->error_count = 0;
```

This runs at the top of graph_compute, before any `enqueue_op` or `flush`. The first op's response can't be read until `flush_pending` is called, which happens after all `enqueue_op` calls. So `error_count` is zeroed before any response can increment it. Correct.

**Double reset:** `error_count = 0` also in `allocate` (`:1648`). This is initialization, not per-graph. Harmless.

### 2b. Responses only read in flush_pending — CONFIRMED, OK

`grep -c "dspqueue_read"` in ggml-hexagon.cpp: **2** occurrences, both in `flush_pending` (`:1545`). No other site reads DSP responses. Correct.

### 2c. Previous-graph response contamination — PLAUSIBLE, LOW RISK

`graph_compute` resets `error_count = 0` at entry (`:3617`). Any stale responses from a previous graph would be consumed by the previous graph's `flush()` call at `:3683`. If the previous graph didn't flush (e.g., it was abandoned), stale responses could theoretically be read by the next graph's flush and counted. But `graph_compute` always calls `sess->flush()` at the end (`:3683`), which drains all pending responses. So by the time the next `graph_compute` starts, the queue is empty. **No contamination in normal use.** Edge case: if a backend is shared across threads without synchronization — but ggml backends are not thread-safe by design.

### 2d. synchronize() errors — CONFIRMED, OK

`synchronize()` (`:3688-3693`) calls `sess->flush()` which calls `flush_pending`. Errors from synchronize are counted in `error_count`. But `error_count` is reset at the start of `graph_compute`, so errors from a pre-compute `synchronize()` would be lost. However, `synchronize()` is typically called between graph Computes, not within a graph. And if it's called during a graph, the errors would be counted by the graph's flush. **No practical issue.**

### 2e. Multi-session (NDEV > 1) — CONFIRMED, OK

Each session is a separate `ggml_hexagon_session` instance with its own `error_count`. `graph_compute` operates on a single session (`backend->context`). No cross-session contamination. Correct.

### 2f. FAILED status propagation — PLAUSIBLE, LOW RISK

`graph_compute` returns `GGML_STATUS_FAILED` when `error_count != 0` (`:3685`). The caller is `ggml_backend_graph_compute` (the backend vtable). In llama.cpp's sched (`ggml-backend.cpp`), `ggml_backend_sched_graph_compute` calls `ggml_backend_graph_compute` and **ignores the return value** (it's `void` in some paths). In `llamaDecodeInternal` (`llama.cpp`), the return is checked:
```cpp
enum ggml_status st = ggml_backend_graph_compute(...);
if (st != GGML_STATUS_SUCCESS) { ... return false; }
```

So FAILED **does** propagate to llama-bench / llama-perplexity as a hard abort. This is the desired behavior — silent HTP errors should not be masked.

**However:** `compare_graph_backend_judge` (`:752-753`) ignores the return values of `ggml_backend_graph_compute`. If HTP compute fails, the comparison still runs on potentially garbage outputs. The callback would catch NaN/inf mismatches, so the test still fails — but the error message would say "NaN" not "HTP compute failed". **Minor diagnostic gap, not a BLOCKER.**

---

## 3. Bugs, races, leaks, UB

### 3a. std::atomic race — CONFIRMED, OK (same thread)

`error_count` is `std::atomic<int>` (`:227`). It's incremented in `flush_pending` (`:1561`) and reset in `graph_compute` (`:3617`). Both run on the same thread: `graph_compute` → `enqueue_op` (writes queue) → `flush()` → `flush_pending` (reads queue). `dspqueue_write`/`dspqueue_read` are blocking; there's no separate reader thread. The atomic is defensive, not required for correctness. **No race.**

### 3b. g_ref_buf_mutex — static global — PLAUSIBLE, MINOR

`g_ref_buf_mutex` (`:479`) is a file-static `std::mutex`. It guards stderr diagnostic dumps. With `-j 1` (default), no contention. With `-j N`, workers would contend on this mutex during diagnostic output — harmless, just slower. No data race. The `printf` calls to stdout in the callback are unprotected — with `-j N`, stdout lines can interleave. **Device recipe is serial; not a problem in practice.**

### 3c. printf format mismatches — CONFIRMED, OK

- `blocks=%zu nan_scales=%zu inf_scales=%zu` — `%zu` for `size_t`. Correct.
- `host=%d` — `%d` for `(int) ggml_backend_buffer_is_host(...)`. Correct.
- `DUMP ne=[%lld,...] nb=[%zu,...] n=%zu` — `%lld` for `(long long)`, `%zu` for `(size_t)`, `%zu` for `size_t`. Correct.

### 3d. memcpy of uint16 from unaligned bytes — CONFIRMED, OK

`scan_quant_fp16_scales` (`:539-542`):
```cpp
uint16_t h;
memcpy(&h, blk + (size_t) s * sizeof(h), sizeof(h));
```

`memcpy` from arbitrary alignment is well-defined in C/C++. No UB. Correct.

### 3e. ggml_backend_buffer_is_host on null buffer — CONFIRMED, OK

`tensor_is_plain_cpu` (`:515-520`) checks `!t || !t->buffer` before calling `ggml_backend_buffer_get_type`. `scan_quant_fp16_scales` (`:522`) checks `!t || !tensor_is_plain_cpu(t)` before accessing `t->data` and `ggml_backend_buffer_is_host`. All null-safe. Correct.

### 3f. Integer overflow in tmp.resize(n) — PLAUSIBLE, NEGLIGIBLE

`recopy_via_get_set` (`:642`): `const size_t n = ggml_nbytes(p.s)`. For a MUL_MAT weight with ne=4096×4096×q4_0, `n ≈ 8MB`. `tmp.resize(n)` allocates 8MB on the stack... no, it's `std::vector<uint8_t>`, so heap. No overflow risk for any realistic tensor size. `n_nodes * 4` reserve is also safe (int * size_t, promoted to size_t). **Negligible.**

---

## 4. Scope — anything beyond A and B

### 4a. Diagnostic functions (log_tensor_ref_buf, log_op_ref_buffers, etc.) — CONFIRMED, MINOR

The following functions are added but are only called when PLAIN_HOST=1 or on failure diagnostics:
- `tensor_buf_name`, `tensor_buft_name`, `half_is_nan`, `half_is_inf`, `quant_fp16_scale_count`, `type_is_mxfp4`, `tensor_is_plain_cpu`, `scan_quant_fp16_scales`, `log_tensor_ref_buf`, `log_op_ref_buffers`, `graph_has_quantized_src`, `log_graph_ref_buffers`

These are all diagnostic infrastructure. They're dead code when PLAIN_HOST=0 and no test fails. **Not speculative APIs** — they're test infrastructure for a specific experiment. Acceptable scope.

### 4b. Usage line additions — CONFIRMED, OK

`test-backend-ops.cpp:10636-10637`:
```cpp
printf("    env GGML_TEST_PLAIN_HOST=1 recopies the CPU reference through get/set\n");
printf("        (unpacks host-tiled extra layouts into the plain CPU buffer)\n");
```

Documents the env var. Appropriate.

### 4c. Banner in main — CONFIRMED, OK

`test-backend-ops.cpp:10735-10740`: Prints `[ref-buf] exp1 GGML_TEST_PLAIN_HOST=%d cpu_buft="%s"` once in MODE_TEST. Appropriate.

---

## 5. Semantic drift from original patch

### 5a. DUMP lines uncommented — PLAUSIBLE, MINOR

The original patch (`patch.diff:372-375`) had the DUMP lines **commented out**:
```cpp
//for (int i = 0; i < (int) f1.size(); i++) {
//    printf("%5d %9.6f %9.6f, diff = %9.6f\n", i, f1[i], f2[i], f1[i] - f2[i]);
//}
```

The v79 port (`test-backend-ops.cpp:1818-1820`) has them **uncommented**:
```cpp
for (int i = 0; i < (int) f1.size(); i++) {
    printf("%5d %9.6f %9.6f, diff = %9.6f\n", i, f1[i], f2[i], f1[i] - f2[i]);
}
```

The parent commit (`204e78259`) also had them uncommented. The original patch explicitly commented them out. The v79 port reverted that change.

**Impact:** On ERR, prints `f1.size()` lines of individual values. For a 4096-element MUL_MAT, that's 4096 printf lines. Very noisy. Not a correctness issue but a diagnostic usability regression. **MINOR.**

**Fix:** Comment out the DUMP loop to match the original patch, or justify why the verbose dump is wanted.

### 5b. inf_sign mismatch diagnostic — CONFIRMED, FIXED vs original review NITPICK

The original review (REVIEW.md finding 5) flagged that inf_sign mismatch didn't log `cpu_buf`/`cpu_buft`. The v79 port fixes this (`:1779-1787`). **Good — this is a port improvement over the original patch's review finding.**

### 5c. mxfp4 scanner — CONFIRMED, FIXED vs original review WARNING

The original review (REVIEW.md finding 3) flagged that mxfp4 wasn't scanned. The v79 port adds mxfp4 scanning via `type_is_mxfp4` and `blk[0] == 0xFF` E8M0 NaN check (`:502-504`, `:536-540`). **Good — port improvement.**

### 5d. Q4_1/Q5_1 second scale scan — NOT ADDRESSED, MINOR

The original review (REVIEW.md finding 1) flagged that `scan_quant_fp16_scales` only scans the first fp16 (`d`) of Q4_1/Q5_1, missing the second (`m`). The v79 port does NOT fix this. The scanner has `n_scales = 2` for Q4_1/Q5_1 (`:500-501`) but the scan loop (`:539-550`) iterates `s = 0..n_scales-1` and reads `blk + s * sizeof(h)` — so it DOES scan both `d` and `m` offsets. **Wait — re-reading the code:**

```cpp
for (int s = 0; s < n_scales; s++) {
    uint16_t h;
    memcpy(&h, blk + (size_t) s * sizeof(h), sizeof(h));
```

For Q4_1 with `n_scales=2`: `s=0` reads offset 0 (`d`), `s=1` reads offset 2 (`m`). This IS correct. The original review's finding 1 was about a `type_has_leading_fp16_scale` function that returned only 1 for Q4_1. But the v79 port uses `quant_fp16_scale_count` which returns 2 for Q4_1/Q5_1. **The original review finding was already addressed in the v79 port's implementation.** No remaining issue.

---

## 6. Build/packaging verification

### 6a. kit-v2 payload count — CONFIRMED, OK

kit SHA256SUMS: **23 payload files** (excl SHA256SUMS self-hash entry `e3b0c44...`).
kit-v2 SHA256SUMS: **24 payload files** (no self-hash entry).

Difference: kit-v2 adds `bin/llama-perplexity` (new). All other file SHAs that changed (`libggml-base.so`, `libggml-hexagon.so`, `libllama-common.so`, `libllama-server-impl.so`, `bin/test-backend-ops`) are rebuilds from the v79 commit. **Net: 23→24 payload files.** Matches claim.

### 6b. test-backend-ops rebuilt from v79 — PLAUSIBLE, WEAK WITNESS

- `strings kit-v2/bin/test-backend-ops | grep 'GGML_TEST_PLAIN_HOST'` → **3 matches** (banner, usage, env check literal). Strong witness for literals.
- `strings kit-v2/bin/test-backend-ops | grep 'ref-buf.*exp1'` → **1 match** (banner). Strong witness for banner string.
- Kit SHA: `f4eb6b42...` vs kit SHA: `29dad0b4...`. Different binary. But SHA alone doesn't prove it was built from v79 — could be any intermediate build.

**Weak witness caveat:** `strings` on stripped ELF proves literals exist, not code logic. The `error_count++` and `sess->error_count = 0` paths in hexagon are not provable via strings. Disassembly would be needed for code-level proof.

### 6c. libggml-hexagon.so rebuilt — PLAUSIBLE, WEAK WITNESS

- kit SHA: `8fab49fc...`, kit-v2 SHA: `357ff0c8...`. Different binary. Size: 777384→777432 (+48 bytes). Plausibly includes the `error_count` addition.
- `strings kit-v2/lib/libggml-hexagon.so | grep 'dsp-rsp'` → 1 match. Present in both kit and kit-v2 (the string was already there pre-patch). Not a differentiator.
- `strings kit-v2/lib/libggml-hexagon.so | grep 'TODO'` → 0 matches. Pre-patch also 0 (it was a C++ comment, not a string literal). Not a differentiator.

**Weak witness caveat:** The only provable difference via strings is the file size change (+48 bytes). The actual code change (error_count atomic + reset + increment) requires disassembly.

### 6d. Tarball exists — CONFIRMED, OK

`npu-kit-214ae986e.tgz` exists at `/Users/marco/kalsa-qdc/npu-v79-cell/`, 11MB.

---

## Final verdicts

| # | Finding | Verdict | Severity | Fix |
|---|---------|---------|----------|-----|
| 1a | Recopy covers all tensors correctly | CONFIRMED | — | — |
| 1b | Recopy runs between graph_copy and compute | CONFIRMED | — | — |
| 1c | Stock path (env off) is no-op | CONFIRMED | — | — |
| 1d | Only eval path patched, perf/grad untouched | CONFIRMED | — | — |
| 1e | Whole-graph vs node-by-node semantic diff | PLAUSIBLE | MINOR | Document; do not use PLAIN_HOST=1 on fused tests |
| 2a | error_count reset before first op | CONFIRMED | — | — |
| 2b | Responses only read in flush_pending | CONFIRMED | — | — |
| 2c | No previous-graph contamination | PLAUSIBLE | — | — |
| 2d | synchronize errors handled | CONFIRMED | — | — |
| 2e | Multi-session isolation | CONFIRMED | — | — |
| 2f | FAILED propagates to llama | PLAUSIBLE | — | — |
| 3a | No atomic race (same thread) | CONFIRMED | — | — |
| 3b | g_ref_buf_mutex safe, stdout unprotected | PLAUSIBLE | MINOR | Add -j guard or protect stdout printf |
| 3c | printf formats correct | CONFIRMED | — | — |
| 3d | memcpy alignment safe | CONFIRMED | — | — |
| 3e | Null buffer checks correct | CONFIRMED | — | — |
| 4a | Diagnostic functions in scope | CONFIRMED | — | — |
| 5a | DUMP lines uncommented (drift from original patch) | PLAUSIBLE | MINOR | Comment out DUMP loop to match original patch |
| 5b | inf_sign mismatch diagnostic fixed | CONFIRMED | — | — |
| 5c | mxfp4 scanner added | CONFIRMED | — | — |
| 5d | Q4_1/Q5_1 second scale already scanned | CONFIRMED | — | — |
| 6a | kit-v2 has 24 payload files | CONFIRMED | — | — |
| 6b | test-backend-ops rebuilt (strings witness) | PLAUSIBLE | — | — |
| 6c | libggml-hexagon.so rebuilt (size witness) | PLAUSIBLE | — | — |

**No BLOCKERs.**

---

## APPLY

The commit achieves both A and B correctly. The recopy is sound, the stock path is untouched, the error_count lifecycle is correct. Two MINOR items to clean up:

1. **Comment out the DUMP loop** (`test-backend-ops.cpp:1818-1820`) to match the original patch's intent and reduce noise on ERR.
2. **Protect stdout printf in callback** with `g_ref_buf_mutex` if `-j > 1` is ever supported (currently `-j 1` default; low priority).

**APPLY**

---

# Re-audit: 93e9592fa (npu-v79-judge fixup)

**Commit:** `93e9592fa` (parent `214ae986e`)
**File:** `tests/test-backend-ops.cpp` (+18/-5)
**Purpose:** Fix §5a (DUMP loop), §1 line-133 (compare_graph_backend_judge ignored graph_compute status), §5d (Q4_1 comment).

---

## R1. Status checks on graph_compute — CONFIRMED, OK

### R1a. Two status checks, both after their respective compute

`test-backend-ops.cpp:741-742`:
```cpp
const ggml_status status1 = ggml_backend_graph_compute(backend1, g1);
const ggml_status status2 = ggml_backend_graph_compute(backend2, g2);
```

`status1` checked at `:743`, `status2` checked at `:750`. Both checks happen after BOTH computes complete. Correct.

### R1b. Free on early return — no leak — CONFIRMED, OK

Both early-return paths (`:747` and `:754`) call `ggml_backend_graph_copy_free(copy)` before returning false. `copy` is the only heap resource allocated between graph_copy and the checks. `recopy_via_get_set` allocates local `std::vector` (RAII, auto-cleaned). `test_nodes` is passed in, not allocated. `g_ref_buf_mutex` is a static, not a resource. **No leak.**

### R1c. Error message wording matches pre-existing site — CONFIRMED, OK

New code (`:744-745`, `:751-752`):
```cpp
fprintf(stderr, "%s: ggml_backend_graph_compute failed. status=%s \n",
        __func__, ggml_status_to_string(status1));
```

Pre-existing site (`:1926` in eval_perf):
```cpp
fprintf(stderr, "%s: ggml_backend_graph_compute failed. status=%s \n", __func__, ggml_status_to_string(status));
```

Format string is identical: `"%s: ggml_backend_graph_compute failed. status=%s \n"`. A grep for `'ggml_backend_graph_compute failed'` catches both. Correct.

### R1d. No other resource leaked on early return — CONFIRMED, OK

Between `graph_copy` and the status checks, only `recopy_via_get_set` runs (local vectors, RAII). No `test_nodes` allocation, no buffer allocation, no mutex held. The `g_ref_buf_mutex` lock at `:739` is released before the computes. **Clean early return.**

---

## R2. DUMP loop commented — CONFIRMED, OK

`test-backend-ops.cpp:1830-1832`:
```cpp
//for (int i = 0; i < (int) f1.size(); i++) {
//    printf("%5d %9.6f %9.6f, diff = %9.6f\n", i, f1[i], f2[i], f1[i] - f2[i]);
//}
```

Matches the original patch (`patch.diff:372-375`) exactly. §5a from first audit is RESOLVED.

---

## R3. §5d Q4_1/Q5_1 second scale — REFUTED

The original §5d finding stated the scanner "only scans the first fp16 (d) of Q4_1/Q5_1, missing the second (m)." This was wrong.

**Proof from code** (`test-backend-ops.cpp:569-576`):
```cpp
for (int s = 0; s < n_scales; s++) {
    // Q4_1/Q5_1: s=0 is d and s=1 is the adjacent m field.
    uint16_t h;
    memcpy(&h, blk + (size_t) s * sizeof(h), sizeof(h));
```

`quant_fp16_scale_count` returns 2 for Q4_1/Q5_1 (`:500-501`). The loop iterates `s=0,1`. `sizeof(h)=2`. So `s=0` reads `blk+0` (offset of `d`), `s=1` reads `blk+2` (offset of `m`).

**Proof from layout** (`ggml-common.h`):
```c
typedef struct {
    GGML_EXTENSION union {
        struct {
            ggml_half d; // delta    ← offset 0
            ggml_half m; // min      ← offset 2
        } GGML_COMMON_AGGR_S;
        ggml_half2 dm;
    } GGML_COMMON_AGGR_U;
    uint8_t qs[QK4_1 / 2];
} block_q4_1;
```

`d` at offset 0, `m` at offset 2. The loop reads both. The v79 implementation already had `n_scales=2` and the correct stride. The original review's concern was about a different function (`type_has_leading_fp16_scale`) that was never part of the v79 port.

93e9592fa adds the clarifying comment `"Q4_1/Q5_1: s=0 is d and s=1 is the adjacent m field."` at `:570`. Good documentation. §5d is **REFUTED** — the scanner was always correct for Q4_1/Q5_1.

---

## R4. Kit verification

### R4a. SHA256SUMS — 24 lines, no self-hash — CONFIRMED, OK

`/Users/marco/kalsa-qdc/npu-v79-cell/kit-v2/SHA256SUMS` has 24 lines of `sha256  path` entries. No self-hash line (`e3b0c44...`). Matches claim.

### R4b. Tarball test-backend-ops SHA matches SHA256SUMS — CONFIRMED, OK

SHA256SUMS line: `9de50525c7757a33bcc590fdbdc6a0da825967275ecb71ca55929f210ec2a4ba  bin/test-backend-ops`

`tar -xf npu-kit-93e9592fa.tgz -O bin/test-backend-ops | shasum -a 256` → `9de50525c7757a33bcc590fdbdc6a0da825967275ecb71ca55929f210ec2a4ba  -`

**Exact match.** ✓

### R4c. strings finds error message — CONFIRMED, OK

`strings kit-v2/bin/test-backend-ops | grep 'ggml_backend_graph_compute failed'` → `%s: ggml_backend_graph_compute failed. status=%s `

Strong witness for the format string literal. Proves the status-check code path exists in the binary. Cannot prove the logic around it (early return, copy_free) — that requires disassembly.

### R4d. Tarball exists — CONFIRMED, OK

`npu-kit-93e9592fa.tgz` exists at `/Users/marco/kalsa-qdc/npu-v79-cell/`, 11018937 bytes.

---

## Final verdicts (re-audit only)

| # | Finding | Verdict | Severity | Fix |
|---|---------|---------|----------|-----|
| R1a | Two status checks after both computes | CONFIRMED | — | — |
| R1b | copy_free on early return, no leak | CONFIRMED | — | — |
| R1c | Error message matches pre-existing wording | CONFIRMED | — | — |
| R1d | No other resource leaked | CONFIRMED | — | — |
| R2 | DUMP loop commented (matches original patch) | CONFIRMED | — | — |
| R3 | §5d Q4_1 scanner was always correct | REFUTED | — | — |
| R4a | kit-v2 SHA256SUMS 24 lines | CONFIRMED | — | — |
| R4b | Tarball SHA matches SHA256SUMS | CONFIRMED | — | — |
| R4c | strings finds error message in binary | CONFIRMED | — | — |

**No BLOCKERs. No MAJORs.**

---

**APPLY**
