# Hostile audit — `dc48ec8cc` (`--dump-nodes` per-node statistics, arms A and L)

Read-only session, repo `/Users/marco/Projects/kalsallama-gov-loadstep`, detached HEAD = `dc48ec8cc`,
parent `29707db07`. `git status --short` empty: the reviewed tree is exactly the target commit.
No edit, no commit, no Android build, no device, no test suite. Purpose of the artefact under audit
(per the task): localise the wrong-logits defect of the one-copy GPU decode leg
(`--arm L --legs gpu`, KL 0.04–0.09 vs reference, KL varying run to run) by dumping per-node
statistics for the first N decode tokens of (a) two runs of the failing config and (b) a passing
config, and finding the first node that differs.

**Headline: the tool cannot answer that question, for four independent reasons, and it can report
"no divergence" for a config that fails its own KLD gate.** (1) Installing the callback changes the
execution of *every* graph of rep 0 (an unconditional `ggml_backend_synchronize` per split in the
callback branch), and in-window it computes one node per backend call — the class of defect that
varies run to run is exactly the class that this removes, so a clean dump is not evidence. (2) The
comparison key `(tok, node, occurrence)` is not stable across legs: the HTP backend *permutes the
split graph's nodes* during `graph_optimize` while OpenCL/CPU do not, and node names collide
(unnamed nodes are all `-`, every view is `"<src> (view)"`), so identical names map to different
occurrence indices between `--legs npu` and `--legs gpu`. (3) The compared statistics
(`sumabs`, `sumsq`) are permutation- and sign-blind aggregates, and the two fields that are not
(`sum=`, `first=`) are written but never read by the compare script. (4) The dump records the token
*index*, never the token *id* or position, so two runs whose inputs differ cannot be told apart from
two runs whose outputs differ — which is guaranteed for the plan's "passing config" candidate
`arm A --dev GPUOpenCL` (its prefill runs on OpenCL, arm L's prefill runs on the accelerator leg).
A wrong-logits node may also be *invisible*: the KV cache write node is `SET_ROWS` over the whole
cache, so its aggregate is diluted by ~`kv_size` untouched cells, and a quantized (q8_0) KV cache
is skipped by type entirely.

## 0. What I ran

```
git log --oneline -3; git status --short; git show --stat dc48ec8cc     # target = HEAD, clean
git show dc48ec8cc > /tmp/dc48.diff                                     # full delta read in full
clang++ -std=c++17 -fsyntax-only -Iinclude -Iggml/include -Isrc -Iggml/src \
        -Itools/governor-bench tools/governor-bench/governor-bench-dump.cpp > log 2>&1; echo $?
# -> 0 (no diagnostic); the new TU is syntactically sound in isolation
python3 tools/governor-bench/compare-node-dumps.py A B ...              # 13 synthetic probes (table below)
```

Read in full: `governor-bench-dump.{h,cpp}`, `compare-node-dumps.py`, `governor-bench.cpp`,
`governor-bench-run.cpp`, `governor-bench.h`, and the surrounding machinery:
`ggml/src/ggml-backend.cpp` (split/alloc/compute-splits), `src/llama-context.cpp` (cb_eval
plumbing, graph reuse), `src/llama-governor*.cpp`, `src/llama-kv-cache.cpp`,
`src/llama-kv-commit.cpp`, `src/llama-kv-staged.cpp`, `ggml/src/ggml-hexagon/ggml-hexagon.cpp`,
`ggml/src/ggml-opencl/ggml-opencl.cpp`, `ggml/src/ggml.c`.

Line citations are against the reviewed tree (`dc48ec8cc` unchanged, `git status --short` empty).
The new translation unit passes an isolated `-fsyntax-only` check with no diagnostic.

Synthetic compare-script probes (each `cmd > log 2>&1; echo $?`), all reproducible:

| probe | exit | reading |
|---|---|---|
| a node present only in A | 0 | structurally different dumps pass |
| a whole token present only in A | 0 | a truncated dump passes |
| same node set, two same-named nodes reordered | 1 | file order decides occurrence → spurious divergence |
| only `first=` differs (order/permutation inside a tensor) | 0 | the writer's only order-sensitive field is never compared |
| `sum=+100` vs `sum=-100` (sign flip), same `sumabs`/`sumsq` | 0 | sign errors are invisible |
| `leg=npu` vs `leg=cpu` on a matched node | 0 | the routing nondeterminism is invisible |
| a line with `sumabs` but no `nan=` | 1 + traceback | a malformed dump is reported as "divergence found" |
| one side `skip=noncontiguous`, other measured | 2 | "no comparable node matched" hides a key-matched-but-skipped node |
| skip-only dumps on both sides | 2 | same message, no summary line |
| `sumabs=1e-300` vs `0` | 1 | denormal-vs-zero reports rel = 1.0 |
| one element of 1000 off by +50 % (sumabs 1000 → 1000.5) | 1 (only via `sumsq` 2.2e-3) | detection depends on the outlier dominating `sumsq`, not on the defect |

## 1. Verdict table

| # | Claim | Verdict | Sev. | Origin |
|---|---|---|---|---|
| F1 | `tok=0` is the first decode token in both arms and every leg | **CONFIRMED** | — | new |
| F2 | The dump records no token id / position / batch size, so "same input" is unverifiable | **CONFIRMED** | **P1** | new |
| F3 | Every in-window node is read back; a KV-write node is `SET_ROWS` over the whole cache | **CONFIRMED** | **P1** | new |
| F4 | `sumabs`/`sumsq` are permutation- and sign-blind; `sum=` and `first=` are written and never compared | **CONFIRMED** | **P1** | new |
| F5 | Views / in-place nodes: the data-phase read is not aliasing-corrupt, but the in-place nodes are the least diagnostic ones | **CONFIRMED** (mechanism) | P2 | new |
| F6 | `!t->buffer` is the wrong null test for views; asymmetric skips are silently unmatched | **CONFIRMED** | P3 | new |
| F7 | Prefill, warmup and KV commits do **not** inject lines tagged with a decode token | **REFUTED** (good) | — | — |
| F8 | Other graph evals on a leg context (K-shift, graph rebuild) *would* inject lines if they ran | **PLAUSIBLE** (not triggered by this bench's sizing) | P3 | pre-existing |
| F9 | `(tok, name, occ)` is not stable across backends: HTP reorders its split graph, names collide | **CONFIRMED** (mechanism) | **P1** | new |
| F10 | A leg mismatch on a matched node is invisible in the exit code | **CONFIRMED** | P2 | new |
| F11 | `--legs` absent (free-running) can move legs mid-window; the dump is not schedule-stable | **CONFIRMED** (by design) | P3 | new |
| F12 | `cb_eval` changes the scheduler path for **every** graph eval of rep 0, not only the window; the code comment says otherwise | **CONFIRMED** | **P1** | new |
| F13 | In-window execution is one node per backend call plus a sync before each read → race-class defects are removed | **CONFIRMED** (code) / **PLAUSIBLE** (masking the observed KL variance) | **P1** | new |
| F14 | On the HTP leg the per-node split disables the backend's own fusions and its plan cache → the "passing reference" is a different NPU execution | **CONFIRMED** | **P1** | new |
| F15 | No control mode exists (callback installed, nothing read); `--dump-nodes-tokens 0` is rejected | **CONFIRMED** | P2 | new |
| F16 | Readback safety on HTP relies on the very sync that perturbs the run | **CONFIRMED** | P3 (framing) | new |
| F17 | OpenCL readback syncs other OpenCL devices | **REFUTED** here (returns early with a single device) | P3 | pre-existing |
| F18 | Null deref of `t->name` | **REFUTED** (`char name[GGML_MAX_NAME]`) | — | — |
| F19 | Null `tap->dump` / null `out` deref in the callback | **PLAUSIBLE**, unreachable at both call sites | P3 | new |
| F20 | f16 conversion wrong, or device F16 readback converted behind our back | **REFUTED** (raw bytes on all three backends) | — | — |
| F21 | `ggml_nbytes` vs `nelements*type_size` mismatch for the admitted types | **REFUTED** (equal for contiguous F32/F16) | — | — |
| F22 | `int` types / format specifiers | **REFUTED** (clean) | — | — |
| F23 | No flush / no error check on the dump FILE: kill or full disk silently truncates, and the compare then says "match" | **CONFIRMED** | P2 | new |
| F24 | rep/turn gating matches the doc, but a rep ≥ 1 run silently dumps nothing | **CONFIRMED** | P3 | new |
| F25 | `--dump-nodes-tokens` without `--dump-nodes` is silently inert | **CONFIRMED** | P3 | new |
| F26 | `--dump-nodes` and `--logits-out` may name the same path; the logits dump (`"wb"`) destroys the node dump after the run | **CONFIRMED** | P3 | new |
| F27 | Latent NULL-data read / `GGML_ASSERT` abort if the model is loaded with `no_alloc` (dummy KV buffer) | **PLAUSIBLE** (not reachable with the bench's load params) | P3 | new |
| F28 | Uncaught exception in the compare phase exits 1 = "divergence found" | **CONFIRMED** | P2 | new |
| F29 | `relative_diff` near zero: denormal noise reports rel = 1.0; no absolute floor, no element count | **CONFIRMED** | P2 | new |
| F30 | Unmatched nodes / missing tokens never fail; exit 0 for structurally different dumps | **CONFIRMED** | P2 | new |
| F31 | Skip handling: either-side skip drops the pair; the summary is not printed in the case that needs it | **CONFIRMED** | P2 | new |
| F32 | `op` is not part of the match/compare; `ne`/`type` compared as strings | **CONFIRMED** | P3 | new |
| F33 | "first divergence" means first in *file A's* order, not first in graph order | **CONFIRMED** | P3 | new |
| F34 | Only relative differences are printed; absolute magnitudes are not | **CONFIRMED** | P3 | new |
| F35 | Default path (flag absent): no fopen, no callback, no scheduler change | **CONFIRMED** (structural reading) | — | — |
| F36 | Dead weight: `sum=`/`first=` payload, no test of the new code, 3-tap array indexed by a 4-value enum | **CONFIRMED** | P3 | new |

## 2. Angle 1 — does it measure what we need?

### 2.1 `tok=0` is the first decode token (F1) — CONFIRMED, with a caveat

Arm A, `tools/governor-bench/governor-bench-run.cpp:349-352`:

```
349:    for (uint32_t i = 1; i < opts.generate_tokens; ++i) {
350:        batch = make_batch({ next }, n_past);
351:        // dump token T is the T-th decode after the prefill, so the first is 0
352:        node_dump_set_token(state.dump, turn == 0 ? static_cast<int32_t>(i) - 1 : -1);
```

`i == 1` → 0 (the first 1-token decode after the prompt decode), and the final
`make_batch({ next }, n_past, false)` at `:371-372` sets `-1` before the last decode, so the
extra logits-only decode is outside the window. Arm L, `:498`:
`node_dump_set_token(state.dump, static_cast<int32_t>(i));` inside
`for (uint32_t i = 0; i + 1 < opts.generate_tokens; ++i)` — also 0 for the first decode after the
prefill. The prefill itself runs before the loop in both arms (arm A `run.cpp:328`,
arm L `run.cpp:463`), so it is at `token == -1` from `node_dump{ int32_t token = -1; }`
(`governor-bench-dump.h:21`). The lines are labelled by the *context that computed them* — each leg
context gets its own tap (`run.cpp:210-213`), `tap->leg` is a string literal, and each engine
appears at most once in the leg list (`llama-governor-legs.cpp:93-98` throws on duplicates), so a
line cannot be mislabelled by leg.

Caveat (F2, below): arm L's `tok` index is the loop counter, not the *token*: with a hop every 32
tokens (`hop_tokens = 32` default, `governor-bench.h:28`) the first 4 dumped tokens are all inside
window 0, so they are all computed by the forced sequence's first engine — that much is
convenient. It is not, however, verified by the dump: nothing in the file lets you check that the
two runs fed the same token.

### 2.2 The dump cannot prove the compared tokens are the same (F2) — CONFIRMED, P1

The line format (`governor-bench-dump.cpp:52-56`) carries `tok=` (index), `leg=`, `node=`, `op=`,
`type=`, `ne=` and statistics. There is **no token id, no position, no batch size, no
`n_past`**:

```
52:    std::fprintf(out, "tok=%d leg=%s node=%s op=%s type=%s ne=%lld,%lld,%lld,%lld",
53:                 tap.dump->token, tap.leg, t->name[0] ? t->name : "-", ggml_op_name(t->op),
```

Consequences for the stated plan, in order of severity:

* `arm L --legs gpu` and `arm L --legs npu` both prefill on the accelerator leg
  (`llama-governor-legs.cpp:333-343 prefill_ctx(cpu_route=false)` → NPU, else GPU, else CPU), so
  token 0 is probably the same token in both dumps. "Probably" is all the artefact supports.
* The plan's alternative passing config, `arm A --dev GPUOpenCL`, prefills on OpenCL
  (`run.cpp:271-276`: single context on `devs[0]`), i.e. its post-prefill argmax — and therefore
  its token-0 input — may differ from arm L's. If it differs, the embedding `GET_ROWS` node, the
  first computed node, *legitimately* differs and the tool will report "first divergence: <first
  node>" with `rel_sumabs≈1`. The output is then indistinguishable from a real one-node-localised
  defect. This is not a hypothesis about the script: it is a missing field in the writer.

### 2.3 What gets dumped, and at what cost (F3) — CONFIRMED, P1

* The callback is reached for every split of every graph of the context that has the tap, including
  CPU-side splits (every sched ends in a CPU backend, `ggml-backend.cpp:1935`), HTP splits and
  OpenCL splits, and it fires for every node of each split (see 2.6 for the walk).
* Inside the window, **every** node is asked for and read: `governor-bench-dump.cpp:79-80` returns
  `true` for the ask phase before it even knows which node it is, so there is no filter of any kind
  (name, op, size, backend). The task's question "is a node-name filter cheap to add" — it is: the
  ask/data two-phase protocol hands the callback the tensor, and the ask phase is where a filter
  would prune; the shipped code simply has none.
* The worst nodes are the KV writes. `src/llama-kv-cache.cpp:1513`:

  ```
  1513:    return ggml_set_rows(ctx, k, k_cur, k_idxs);
  ```

  and `ggml_set_rows` is a view of the *whole* cache (`ggml/src/ggml.c:4027`:
  `struct ggml_tensor * result = ggml_view_tensor(ctx, a);`), whose shape is the whole cache
  (`llama-kv-cache.cpp:352`: `ggml_new_tensor_3d(ctx, type_k, n_embd_k_gqa, kv_size, n_stream)`).
  `write_node` then reads `ggml_nbytes(t)` bytes of the whole cache
  (`governor-bench-dump.cpp:65-68`) and prints `ne=` of the whole cache. Two effects:
  1. The aggregate is dominated by cells this token never wrote: with the bench's leg sizing
     `n_ctx = k_prompt_tokens + generate_tokens + 8` (`run.cpp:39`) and the defaults
     (512/256/32, `governor-bench.h:16-29`) that is `kv_size = 776` cells against one fresh row —
     a ~1/777 dilution of exactly the bytes the decoder was supposed to verify, and a real
     readback of `n_embd_k_gqa × 776 × 2 B` per layer per token in F16 (the bench never overrides
     `type_k`; `llama-context.cpp:3886-3887` defaults both to `GGML_TYPE_F16`). For a GQA model with
     `n_embd_k_gqa=1024` that is ~1.6 MB per layer per token, twice (K and V), times the layer
     count — hundreds of MB of device readback for a 4-token window, with a synchronize per node
     (F12).
  2. If a campaign runs the shipped HTP-lane configuration with a **quantized KV cache** (the
     governor comment at `src/llama-governor.cpp:413-415` describes "matching q8_0 KV on both
     contexts"), then `governor-bench-dump.cpp:61` (`t->type != GGML_TYPE_F32 && t->type !=
     GGML_TYPE_F16` → `skip=type`) makes every KV node a skip line, and the compare then never
     examines the KV at all (F31). The exact class of node a hop/tile-indexing defect would corrupt
     is the one the tool is structurally blind to in that configuration.

### 2.4 The compared statistics cannot see the likely defect (F4) — CONFIRMED, P1

`write_stats` prints five statistics plus 4 raw values (`governor-bench-dump.cpp:30-48`), the
compare reads exactly three of them (`compare-node-dumps.py:70-71`):

```
70:    return (relative_diff(float(fa["sumabs"]), float(fb["sumabs"])),
71:            relative_diff(float(fa["sumsq"]), float(fb["sumsq"])), "")
```

* `sumabs` and `sumsq` are invariant under any permutation of the values in the tensor, and identical
  under a sign flip (`sum=` is the only sign-sensitive field, and it is not read — probe: `sum=+100`
  vs `sum=-100` with identical `sumabs`/`sumsq` exits 0).
* A tiled-weight GEMV defect — the family the parent commit
  (`29707db07` "TILE32 v4 GEMV") is about — plausibly permutes or misindexes *rows*, which leaves the
  multiset of values, and therefore both compared statistics, essentially unchanged. The signal that
  would catch it (`first=`, 4 values) is written and never read (probe: two files differing only in
  `first=` exit 0). Ten largest relative differences are also computed from the same blind
  statistics.
* "10 largest" is likewise blind to *localised* damage: one element of 1000 off by +50 % gives
  `rel_sumabs = 5e-4` (below the default 1e-3) and is only caught because `worst()` also looks at
  `rel_sumsq = 2.2e-3`. Whether a real defect is caught depends on whether the error happens to
  dominate `sumsq`, not on the error being real.
* `nan`/`inf` counts and `ne`/`type` are compared, so a *shape* change is caught — but only when both
  sides have statistics (F31), and `op` is not compared at all, so a node whose op was rewritten
  (there is a real example, F14) passes.

### 2.5 Views, in-place nodes and aliasing (F5, F6) — mixed

* The data-phase read happens after the node's own compute and after
  `ggml_backend_synchronize(split_backend)` (`ggml-backend.cpp:1888`), so what is read is the node's
  value *at that moment*; a later in-place op into the same buffer cannot retroactively change the
  line. The concern "does `ggml_backend_tensor_get` read the final value" is therefore
  **REFUTED** as a corruption mechanism — with the caveat that the same physical bytes can
  legitimately be dumped twice under two names (e.g. a cached `Kcur` and its alias) at two different
  times, which the compare treats as two independent nodes.
* `skip=noncontiguous` (`governor-bench-dump.cpp:59-60`) skips every non-contiguous view, and
  `skip=type` skips every quantized one. Both `skip` markers are dropped from the comparison when
  *either* side has one (`compare-node-dumps.py:64-65` returns `None`), so the very asymmetry the
  task asks about (one graph materialises a contiguous copy, the other keeps a strided view) is
  silently counted in `not_compared_skip` and never reported per node. With a single such node in
  both dumps the run exits 2 with "no comparable node matched between the two dumps"
  (`compare-node-dumps.py:110-112`) — probe confirmed — a message that describes a different
  situation than the one that occurred.
* `!t->buffer` (`:57`) is **not** the right test for "cannot be read": for a view,
  `ggml_backend_tensor_get` resolves `tensor->view_src->buffer`
  (`ggml-backend.cpp:374`) and would work even when `t->buffer` is NULL. The marker
  `skip=unallocated` therefore silently covers a readable tensor (P3).
* Naming: the nodes the audit cares about most are the worst-labelled. `ggml_view_tensor` names its
  result `"%s (view)"` (`ggml/src/ggml.c:1976`), so the KV write and the attention read view of the
  same layer both appear as `cache_k_l13 (view)` (cache names at `llama-kv-cache.cpp:355-356`), and
  every unnamed intermediate appears as `-` (`governor-bench-dump.cpp:53`). Everything that
  distinguishes these lines for the compare is the occurrence index — see F9.

### 2.6 Which graph does the callback walk, and in what order (F9) — CONFIRMED, P1

The callback walks `split->graph.nodes` (`ggml-backend.cpp:1866-1867`), and
`split->graph` is a **view into the model's graph**:

```
1521:        split->graph = ggml_graph_view(graph, split->i_start, split->i_end);
1523:        ggml_backend_graph_optimize(sched->backends[split->backend_id], &split->graph, &opt_params);
```

Good news for one earlier worry: the scheduler's synthetic `input_cpy` / `input_dep` / alloc-dep nodes
are added to the *copy* graph (`ggml-backend.cpp:1582-1604`), not to `split->graph`, so they do **not**
appear in the dump and cannot shift occurrence counts. (Claim REFUTED.)

Bad news: `ggml_backend_graph_optimize` may **permute the node order in place**. The HTP backend
does exactly that, `ggml/src/ggml-hexagon/ggml-hexagon.cpp:7400-7413`:

```
7400:    const auto order = ggml_hexagon_graph_optimize_reorder(nodes);
...
7405:        for (const auto i : order) {
7406:            const auto & node = nodes[i];
7408:            gf->nodes[j++] = node.node;
7410:            for (auto * fused : node.fused) {
7411:                gf->nodes[j++] = fused;
7412:            }
```

The reorder groups `MUL_MAT` nodes sharing `src1` (`ggml-hexagon.cpp:7297-7299`, `N_FORWARD = 16`
at `:7311-7312`), i.e. it is a global permutation of
that split's nodes, and OpenCL/CPU have no `graph_optimize` at all (`ggml-backend.cpp` interfaces
`NULL`; only hexagon and metal register one). Therefore:

* For the *same* token, the file order of lines produced by the NPU/HTP leg differs from the order
  produced by the GPU/OpenCL leg.
* The comparison key is `(token, name, occurrence)` with occurrence counted **in file order**
  (`compare-node-dumps.py:45-48`). Two same-named nodes in a different order in A and B get swapped
  occurrence indices → the compare reports divergence for both (probe confirmed: identical node set,
  order swapped, exit 1) or, symmetrically, aligns two *different* physical nodes and then reports
  "no divergence". With a reordered HTP graph and duplicated names (`-`, `... (view)`) this is not a
  corner case, it is the default situation for the `--legs npu` reference the plan proposes.
* `print_unmatched`'s `op=` grouping and the `describe()` line's `op` come from side A, and `op` is
  not part of the key or the compared fields, so a fused node in one dump and its unfused parts in
  the other are only visible as "only in A/B" counts.

### 2.7 Things that do *not* contaminate the window (F7, F8) — REFUTED (mostly good)

* Prefill: at `token == -1` in both arms (2.1). The governor's chunked prefill
  (`llama-governor-runtime.cpp:179`) is prefill only.
* KV commits at a hop: `llama-governor.cpp:240` calls `llama_kv_commit_with_stats`, whose naive path
  is `ggml_backend_tensor_get`/`set` copies (`llama-hybrid-commit.cpp:39-51`) and whose staged path
  runs its own graph on its own backend
  (`llama-kv-staged.cpp:143`:
  `if (!staged || ggml_backend_graph_compute(staged->backend, staged->graph) != GGML_STATUS_SUCCESS)`),
  **not** through the context's sched. `cb_eval` therefore cannot fire for a commit. Claim REFUTED.
* Warmup: there is no prewarm implementation in this tree (`grep -rn prewarm src/` yields only two
  comments in `llama-governor.cpp:208,433`). REFUTED.
* Residual (PLAUSIBLE, P3): any *other* graph run on a leg context while the token is in-window would
  be dumped as if it were decode. One exists in-tree: the K-shift in
  `llama-kv-cache.cpp:1017-1035` (`ggml_backend_sched_reset(sched); ... lctx->graph_compute(gf, false)`),
  which runs on the context's own sched and would inherit the callback. The bench sizes `n_ctx` so
  that no shift is needed, so this should not fire — but it is not excluded by any check, and the
  shift graph's nodes are named from the same namespace (views named `... (view)`), so they would
  interleave into the window's key space.

## 3. Angle 2 — the sync trap

### 3.1 The callback branch changes every graph eval, in and out of the window (F12) — CONFIRMED, P1

`ggml/src/ggml-backend.cpp:1859-1890`:

```
1859:        if (!sched->callback_eval) {
1860:            enum ggml_status ec = ggml_backend_graph_compute_async(split_backend, &split->graph);
...
1864:        } else {
1865:            // similar to ggml_backend_compare_graph_backend
1866:            for (int j0 = 0; j0 < split->graph.n_nodes; j0++) {
1867:                struct ggml_tensor * t = split->graph.nodes[j0];
1870:                bool need = sched->callback_eval(t, true, sched->callback_eval_user_data);
...
1875:                while (!need && j1 < split->graph.n_nodes - 1) {
1876:                    t = split->graph.nodes[++j1];
1877:                    need = sched->callback_eval(t, true, sched->callback_eval_user_data);
1878:                }
1880:                struct ggml_cgraph gv = ggml_graph_view(&split->graph, j0, j1 + 1);
1882:                enum ggml_status ec = ggml_backend_graph_compute_async(split_backend, &gv);
...
1887:                // TODO: pass backend to the callback, then the user can decide if they want to synchronize
1888:                ggml_backend_synchronize(split_backend);
1890:                if (need && !sched->callback_eval(t, false, sched->callback_eval_user_data)) {
```

Outside the window, `node_callback` returns `false` for every ask
(`governor-bench-dump.cpp:78`: `if (dump.token < 0 || dump.token >= dump.tokens) { return false; }`),
so `need` stays false, the `while` walks to the last node and the whole split is computed in one
`gv` — the split itself is indeed computed "as before". But the code path is the `else` branch, and
that branch **unconditionally synchronises the backend after every split** (`:1888`), which the
`if` branch does not do. The comment in the new file claims the opposite:

```
governor-bench-dump.cpp:72-74
72:// Asks for node data only inside the window, so outside it the scheduler
73:// computes the split as before. Returning true on the data phase keeps the
74:// graph running; false would abort the split.
```

"Computes the split as before" is true for the *partition* and false for the *execution*: for rep 0
the callback is installed for the entire run (all turns, all 512-token prefills, `run.cpp:211`), so
every graph eval of rep 0 gets a per-split synchronize. That is a real change on both devices (it
drains the OCL queue and waits on the HTP fence per split) and it also perturbs *timing*, which the
governor itself consumes (thermal/headroom sampling feeds the hop decisions,
`llama-governor-policy-hop.cpp`). So a dumped run's `decode_tps` and even its leg schedule are not
the un-instrumented run's.

### 3.2 In-window, every node is its own graph plus a readback (F13) — CONFIRMED code, PLAUSIBLE masking

In-window `node_callback` returns `true` for the ask phase of every node, so `j1 == j0` always, and
each node is submitted as a one-node `ggml_graph_view` (`:1880`), followed by a synchronize (`:1888`)
and a readback in the data phase. Any defect that depends on queue asynchrony, cross-kernel overlap
or command-buffer batching is therefore removed by construction. The observed symptom — KL 0.04–0.09
and *different every run* — is exactly the signature of that class. Marked PLAUSIBLE only because
verifying it needs the device (out of scope here); the mechanism is confirmed in code. The practical
conclusion is the uncomfortable one: **if the dump is clean, it does not exonerate the GPU leg, and
if the two dumps of the failing config agree while the two un-instrumented runs disagree, the tool
has measured a different execution**.

### 3.3 The HTP reference dump is a different NPU execution (F14) — CONFIRMED, P1

The HTP `graph_compute` plans and tags per node with a *lookahead into the graph* it is given:

```
7055:    bool cache_hit = (graph->uid != 0 && sess->cached_uid == graph->uid);
...
7066:            if (graph->nodes[i]->op == GGML_OP_RMS_NORM && ggml_can_fuse(graph, i, { GGML_OP_RMS_NORM, GGML_OP_MUL })) {
7069:                if ((i + 1 < graph->n_nodes && graph->nodes[i + 1]->op == GGML_OP_ADD && ggml_can_fuse(graph, i, { graph->nodes[i]->op, GGML_OP_ADD })) ||
7070:                    ggml_node_has_n_uses(graph, i, 1)) {
```

With the callback's one-node graph views, `graph->n_nodes == 1`, so `i + 1 < graph->n_nodes` is never
true: the `MUL_MAT + ADD` fusion (and the `RMS_NORM + MUL` fusion above it) can only still fire via
the `n_uses == 1` fallback, and the HTP's node-plan cache (`:7055`) can never hit because each
`ggml_graph_view` gets a fresh uid (`ggml_graph_view` assigns `ggml_graph_next_uid()`, cf.
`ggml-backend.cpp:1648`). The `--legs npu` dump the plan proposes as the *passing reference* is
therefore not the production NPU path: it is an unfused, per-node-resubmitted NPU path whose kernel
selection and numerics are not guaranteed to be the ones the reference KL was measured with. If a
comparison against that reference says "no divergence", that statement is about the instrumented
path.

### 3.4 No control mode exists (F15) — CONFIRMED, P2

There is no way to run with `cb_eval` installed and nothing read back:
`node_dump_install` installs the callback exactly when the dump pointer is non-null
(`governor-bench-dump.cpp:93`), the pointer is non-null exactly when `--dump-nodes` was given
(`governor-bench.cpp:365-370, 383`), and in-window reads are unconditional once installed
(`:79-80`). `--dump-nodes-tokens 0` is rejected (`parse_int` requires `>= 1`,
`governor-bench.cpp:68-75`, used at `:205`). Consequently the two effects of the instrument (changed
scheduler path; per-node readback) cannot be separated by any flag combination, and the "passing
config" and "failing config" dumps are both produced by the perturbed path — the comparison is
self-consistent but its result does not transfer to the unperturbed runs the KL gate judges.

### 3.5 Readback ordering (F16, F17) — fine, but only because of the perturbation

HTP readback is a plain host memcpy out of the mapped buffer
(`ggml-hexagon.cpp:1950-1952`), which is only safe because
`ggml_backend_hexagon_synchronize` → `sess->flush_sync()` (`:7174-7181`) runs at
`ggml-backend.cpp:1888` before every read. In other words, the safety of the measurement is bought
with exactly the property (F12/F13) that invalidates it. The OpenCL path's
`sync_with_other_backends` (`ggml-opencl.cpp:13684`) is a no-op here: it returns immediately unless
two or more OpenCL devices are registered (`:8418-8421`), which is not the case on the target
device.

Also for completeness: `ggml_backend_sched_new` asserts that the last backend is the CPU
(`ggml-backend.cpp:1918`), so every schedule ends on a CPU split; the dump always contains those
CPU-side lines too (read through the host branch, `governor-bench-dump.cpp:63-64`). The walk itself
does cover every backend of the schedule, which is what the task asks; the problem is what it does
with what it finds (2.3, 2.4).

## 4. Angle 3 — bugs

### 4.1 Null derefs (F18, F19) — REFUTED / unreachable

* `t->name` is not a pointer: `ggml/include/ggml.h:712` — `char name[GGML_MAX_NAME];`. `t->name[0]`
  and `%s` are safe. REFUTED.
* `node_callback` dereferences the user data without a check
  (`governor-bench-dump.cpp:76-77`: `const auto * tap = ...; const node_dump & dump = *tap->dump;`),
  and `write_node(dump.out.get(), ...)` (`:80`) would pass NULL to `fprintf`. Both are unreachable:
  `node_dump_install` returns early on a null dump (`:93`) and the only caller passes `&dump` only
  when `dump.out` is non-null (`governor-bench.cpp:383`). PLAUSIBLE, P3, defensive-gap only.
* Tap lifetime is correct: taps live in `run_state` (`governor-bench.h:120-124`), which outlives the
  contexts in the same block (`governor-bench.cpp:381-384`), and the leg label is a string literal
  (`run.cpp:12-20`). REFUTED as a dangling-pointer worry.

### 4.2 Type/format issues (F20, F21, F22) — REFUTED

* F16: `element_value` copies 2 bytes and converts (`governor-bench-dump.cpp:17-23`); the admitted
  types are only F32/F16 (`:61`). The device path returns *raw* bytes for both: OpenCL ends in
  `clEnqueueReadBuffer(... extra->offset + tensor->view_offs + offset, size, data, ...)`
  (`ggml-opencl.cpp:14948-14950`), hexagon memcpys unless the tensor is a repacked quantized weight
  (`ggml-hexagon.cpp:1950-1952`), and `GGML_TYPE_BF16` conversion is not reachable because BF16 is
  filtered out by `:61`. No conversion mismatch.
* `ggml_nbytes(t)` and `ggml_nelements(t) * ggml_type_size(t->type)` agree for contiguous F32/F16 —
  the only combination that reaches `write_stats`. REFUTED.
* Format specifiers are correct: `%d` with `int32_t` (`:53`), `%lld` with explicit `long long` casts
  (`:53-56`, `:42-43`), `%.9g` with `double` (`:42`, `:45`). REFUTED.

### 4.3 FILE lifetime, flush, error handling (F23, F24) — CONFIRMED, P2

* The file is owned by a `unique_ptr` with `fclose` (`governor-bench-dump.h:12-13`) and is never
  flushed before close: no `setvbuf`, no per-token `fflush`, no `ferror` check, no `fprintf` return
  check. On SIGKILL/SIGABRT/SIGSEGV (a plausible outcome when a GPU leg is miscomputing) or Ctrl-C
  the buffered tail is lost silently, and — as the probes show — **a truncated dump exits 0 against a
  complete one** as long as the surviving prefix matches. The defect-hunting artefact can therefore
  lose exactly the lines that contain the defect and report success.
* A full disk has the same signature: `fprintf` failures are invisible (`:42-47`), and the summary is
  never printed with a byte count of what was written.
* Gating (F24): the rep gate is `state.dump = rep == 0 && dump.out ? &dump : nullptr;`
  (`governor-bench.cpp:383`) and the turn gate is `turn == 0 ? ... : -1` (`run.cpp:352`). Both match
  the commit message and the usage text; but with the default `repetitions = 3`
  (`governor-bench.h:25`) reps 1–2 run with no callback and print `run_start` lines that look
  identical, so a dump from an `-r 3` run contains one rep's window and nothing tells the reader
  which. P3.

### 4.4 Options parsing (F25, F26) — CONFIRMED, P3

* `--dump-nodes-tokens` is accepted on its own and silently does nothing (`governor-bench.cpp:204-205`
  has no dependency on `!out.dump_nodes.empty()`; `parse_int` is `governor-bench.cpp:47-55`), and a value larger than the generated tokens is
  accepted and silently truncates the window — which, per F30, then compares clean.
* The arm gate exists (`:219-222`) and the analogous same-path guard exists for logits
  (`:223-226`), but the pair `--logits-out PATH` / `--dump-nodes PATH` is not checked:
  `logits_dump` opens `"wb"` (`governor-bench-logits.cpp:68`) at the end of the run
  (`governor-bench.cpp:418-419`) and truncates the node dump that is still open in main. The
  operator loses the dump and the compare then fails with "not a node dump line" (exit 2) or, worse,
  on the header bytes, is unreadable.
* No check that `--dump-nodes` is combined with something that makes its output interpretable
  (e.g. a reference), which is the gap F2 describes.

### 4.5 Latent read of NULL `data` (F27) — PLAUSIBLE, P3

`write_node`'s first test is `!t->buffer` (`governor-bench-dump.cpp:57`). A KV cache built with the
model's `no_alloc` gets a *dummy* buffer of size 0 with `t->data == NULL`
(`llama-kv-cache.cpp:398-401`: `buf = ggml_backend_buft_alloc_buffer(buft, /*size =*/ 0); ... t->buffer = buf;`),
so the skip marker would not fire: the host branch (`:64`) would read from `t->data == NULL`, and the
device branch's `ggml_backend_tensor_get` starts with
`GGML_ASSERT(tensor->data != NULL && "tensor not allocated")`
(`ggml-backend.cpp:381`), which is always fatal (`ggml.h:288` defines `GGML_ASSERT` as
`GGML_ABORT`). Not reachable with the bench's load parameters (`llama_model_default_params()` sets
`.no_alloc = false`, `llama-model.cpp:3201`, copied into `hparams` at `llama.cpp:345`), so this
is a latent trap rather than a live crash — but the guard as written does not cover the case it
claims to cover.

## 5. Angle 4 — `compare-node-dumps.py`

### 5.1 Parsing (F28, F32) — CONFIRMED

`parse_fields` splits on whitespace and keeps anything containing `=`; `load_dump` validates
`tok`/`node` and requires either `skip` or `sumabs` (`:41-44`). Reasonable. The failures are in what
happens *after* validation:

* Only `load_dump`'s `OSError`/`ValueError` are caught (`:143-148`). Everything the compare phase
  needs (`fa["nan"]`, `fa["inf"]`, `float(fa["sumabs"])`) is accessed unguarded inside
  `compare_nodes` at `:68-71`, and an exception there escapes `main` → traceback → **Python exits 1,
  the "divergence found" code** (probe confirmed with a line missing `nan=`). A corrupted dump can
  therefore be read as "the GPU leg diverges".
* `op=` is never compared (F14's fusion differences are invisible), `ne` is compared as a raw string
  (fine today, brittle), and `tok` is required to be `isdigit()` — no negative tokens are possible
  from this writer, but a file from another producer (e.g. a future `tok=-1` header for prefill)
  would be rejected with an exception path, not a message.

### 5.2 `relative_diff` and threshold semantics (F29) — CONFIRMED, P2

```
58:    scale = max(abs(a), abs(b))
59:    return 0.0 if scale == 0.0 else abs(a - b) / scale
```

* Near zero there is no floor: `sumabs = 1e-300` vs `0.0` gives `rel = 1.0` → "divergence" (probe
  confirmed). Any node that is *supposed* to be (near-)zero — a masked attention row, a zeroed
  padding region — is a coin flip between "divergence" and "match" depending on denormal noise.
* Conversely, a large-magnitude node hides absolute errors: the metric is scale-free, so a 1e-3
  relative change of a 1e6-magnitude node is the same number as a 1e-3 change of a 1-magnitude node,
  and the report prints no magnitudes (F34).
* A *localised* error is only caught if it moves `sumsq` enough (2.4) — the metric has no notion of
  element count, so the same absolute damage is ~1000× easier to see in a 10-element tensor than in
  a 10000-element one. That is backwards from what a defect hunt wants.
* `worst() = max(rel_abs, rel_sq)` mixes an L1 and an L2 sensitivity with one threshold, so the
  effective sensitivity depends on the tensor's magnitude distribution rather than on a stated rule.

### 5.3 Exit codes and unmatched/skip handling (F30, F31, F33) — CONFIRMED, P2

* Nodes present in only one dump are listed but never fail (`:100-102`, `:108`); probes confirm that
  a missing node — even a whole missing token — exits 0. For this task (comparing a one-copy against
  a two-copy graph, or a truncated dump against a complete one) that is the wrong default: the
  interesting failure mode is "the graphs are not the same shape of work", and the tool calls it a
  pass.
* `not_compared_skip` counts only skip-vs-skip pairs (`:103-106`) and the summary is only printed after
  the early return (`:110-112` returns 2 before the summary). So "both dumps contain 1500 skip lines
  and nothing else" and "the two dumps share no node names" produce the same exit 2 and the same
  message — the operator cannot tell a KV-type mismatch from a graph mismatch.
* "First divergence" is `next(d for d in rows if worst(d) > threshold)` over `compared` in
  file-A order (`:115-121`), not in graph order and not in `--dump-nodes` token order beyond the
  `tok=` grouping. Given F9 (HTP reorder) "first" is "earliest surviving line of A", which is not
  the same statement as "earliest node in the graph".
* Exit code 2 is documented as "unreadable input or nothing matched"; the malformed-dump case lands on
  1 (F28), so the documented contract does not hold for the case it most needs.

## 6. Angle 5 — is the default path unchanged with the flag absent? (F35)

Read structurally, yes — with the caveat that "default path" here means "flag absent", and the
instrumented run is by construction not that path (F12/F13/F14).

* `governor-bench-dump.cpp:92-96` — `if (!dump) { return; }` before touching `params`, so with
  `state.dump == nullptr` (`governor-bench.cpp:383`, which is also the `rep > 0` case) neither
  `params.cb_eval` nor `params.cb_eval_user_data` is written and the sched's callback stays whatever
  `llama_context_default_params()` had (`nullptr`, `llama-context.cpp:3884-3885`).
* `governor-bench.cpp:365-370` — the file is opened only `if (!opts.dump_nodes.empty())`; with the
  flag absent no `fopen` happens at all.
* `governor-bench-dump.cpp:99-101` — `node_dump_set_token` is a no-op on a null dump, so the new
  call sites at `run.cpp:352`, `:372`, `:498` are inert in the default path.
* `src/llama-context.cpp:154-155, 1519` — the callback only reaches the scheduler through
  `cparams.cb_eval`; with it null, `ggml_backend_sched_set_eval_callback` is never called with a
  non-null function, and `ggml-backend.cpp:1859` takes the original branch.
* The one edit that touches the default path is `run.cpp:142`
  (`- const auto params = context_params(opts);` → `+ auto params = context_params(opts);`): the
  object is still a copy and `node_dump_install` cannot mutate it when the dump is null, so the
  change is inert. The arm-G path is untouched (`run.cpp:264-267` passes `params` unchanged to
  `llama_governor_init`).

What is *not* proven: nothing in this session compiled and ran the tool (host build/run not requested
and not needed for the findings above; the commit message's own host verification of the default path
is the only executed evidence for it). The reading is exact — every write to `params` and every
`fopen` is behind the `dump != nullptr` gate — but it is a reading.

## 7. Angle 6 — simplification, dead weight, size

* **The payload the compare does not read is a third of the writer.** `sum=` is printed
  (`governor-bench-dump.cpp:42`) and never consulted; `first=` is printed
  (`:44-46`) and never consulted. Both are precisely the fields that would carry sign and order
  information (F4). As shipped they are cost (a second pass over the first 4 elements, extra
  `fprintf` width, and a second `element_value` call per printed element) with no consumer.
* **The comparison key is the artefact's central design decision and it is the wrong one** for a
  multi-backend graph: name+occurrence is neither a node identity (names collide by construction:
  `-`, `"%s (view)"`) nor backend-stable (HTP reorder, F9). Everything else in the 153-line script is
  competent plumbing around that decision.
* `node_dump_tap`'s `const char * leg` is always a string literal and the three taps are indexed by a
  four-value enum (`llama-ext.h:245-250`, `governor-bench.h:122-125`); the array size 3 is a magic
  number that the enum does not carry (`GPU_COOLMODE` would index out of range if a leg could ever be
  one — the governor rejects it, `llama-governor-legs.cpp:89-92`, so this is latent).
* `node_dump{ int32_t tokens; int32_t token; }` conflates "window size" and "in flight" in one struct
  shared by all legs; today it works only because every decode is serialised on one thread. Nothing
  documents that invariant where the struct is declared (`governor-bench-dump.h:15-22` explains the
  tokens but not the threading assumption).
* No test accompanies the new code (`tests/` has no dump test; the commit message says host-only
  manual verification), and the compare script has no test either — for a tool whose failure mode is
  a *wrong* "first divergent node", that is the highest-leverage missing piece.
* Size: 103 + 36 + 153 = 292 lines of new code, plus 14 lines of call sites, to produce a file format
  that stores four aggregate statistics per node, one of which (`sum`) is unused, one of which
  (`first=`) is unused, and none of which record the token being decoded, the leg's graph order, or
  the element count needed to interpret a relative difference.

## 8. What the plan (a)/(b) actually yields

* (a) two runs of the failing config: the tool can show "no divergence" *because* the two runs were
  made deterministic by the instrument (F12/F13), and when it does show divergence it cannot tell an
  alignment artefact (F9) from a denormal artefact (F29) from a real one, nor whether both runs even
  decoded the same token (F2).
* (b) `--legs npu` reference: the reference execution is an unfused per-node HTP path (F14), and the
  in-token line order differs from the GPU leg's (F9), so "the first node that differs" is a
  statement about two instrumented runs whose node sequences are not aligned.
* `arm A --dev GPUOpenCL` reference: same backend ordering as the GPU leg, but a different prefill
  backend, so token 0's input may differ (F2) — the tool will faithfully report a divergence at the
  first node, which is the embedding lookup, and that will be an artefact of a different input token.
* The KLD gate is the only part of the harness that observes the defect as it occurs; the dump run
  must be paired with `--logits-ref` for its own KL to be known, and even then the run whose KL is
  printed is the instrumented one (F12/F13), not the one whose KL varies run to run.

## 9. Claims I could not settle here (and why)

* Whether the instrumented runs reproduce the KL variance at all: needs the device (out of scope, no
  Android build, no device work in this session). F13 is therefore CONFIRMED for the mechanism and
  PLAUSIBLE for the masking.
* Whether the real graph contains same-named node collisions *in the dumped window* (count of `-`
  and `(view)` lines per token): needs a dump. The mechanisms that create collisions
  (`ggml_view_tensor` naming, unnamed intermediates) are confirmed in code; the ordering that turns
  collisions into misalignment is confirmed in the HTP optimiser.
* Whether `n_embd_k_gqa × kv_size` reaches the hundreds-of-MB estimate: the code path and the formula
  are confirmed; the constant depends on the model actually used.
