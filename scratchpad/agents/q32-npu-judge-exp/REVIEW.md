# Review: judge-exp1-plain-host (test-backend-ops.cpp)

Hostile audit of local commit `d5f4166da36f1834c83c011c6e76d8f7c1f791ae` vs `3f545beccee69d9975f466ec7e45fd9aacd8ba90`.
File touched: `upstream-hexagon/llama.cpp/tests/test-backend-ops.cpp` only. llama.cpp tree not modified by this review.

**Bottom line:** the recopy direction, env-off stock path, fail-path logging, and raw-host scale scan are correct for the planned HOSTBUF=1 / serial MUL_MAT run. No crash BLOCKER on that path. Several diagnostic holes can make the on-device log *lie* about *why* NaNs vanished or remained. Whole-graph compute does **not** invalidate the NaN signal for the 70 quant MUL_MAT cases.

---

## Findings (CONFIRMED / PLAUSIBLE only)

### 1. WARNING / CONFIRMED — Q4_1 (and Q5_1) scale scan misses the second fp16

`tests/test-backend-ops.cpp:507-538` (`scan_quant_fp16_scales`) + `:493-504` (`type_has_leading_fp16_scale`)

`block_q4_1` is `{ggml_half d; ggml_half m; uint8_t qs[16]}` (`ggml-common.h:202-211`). CPU dequant is `x = d * q + m`. The scanner copies **only the first 2 bytes** of each `ggml_type_size` stride and never looks at `m` (offset 2). Same hole for Q5_1 (`d`+`m`).

**Failure:** a stock-path (PLAIN_HOST=0) q4_1 MUL_MAT with CPU=NaN can print `nan_scales=0 inf_scales=0` because every `d` happened to be finite while some `m` bits are Inf/NaN in the HOSTBUF tiled prefix. Reader concludes "not layout poison" and escalates to exp 2/3. q4_1 is in the device filter `type_a=(q4_0|q4_1|q8_0|mxfp4|iq4_nl)`.

**Fix:** for Q4_1/Q5_1 also `memcpy` the second half at `p + i*bsize + 2`. Keep q4_0/q8_0/iq4_nl as a single leading half.

---

### 2. WARNING / CONFIRMED — same canonical-block scanner is applied to HTP *tiled* host bytes

`tests/test-backend-ops.cpp:521-528`, `:541-563`, `:565-579`

Intent (comment at 521) is right for the **CPU reference after HOSTBUF memcpy**: `graph_copy` copies `ggml_nbytes` of tiled payload (`ggml-backend.cpp:484-485` `is_host(src)` -> `set(dst, src->data)`), and CPU dequant then reads those bytes as `block_q4_0.d`. Scanning that buffer as `type_size` strides *is* "what the CPU judge will treat as scales".

The same function is also run on **dev-src / dev-out**. Default HTP buft is `is_host=true` when `GGML_HEXAGON_HOSTBUF=1` (`ggml-hexagon.cpp:1114-1117`) but `set_tensor` has already rewritten the buffer as 32x32 tiles (quants at tile+0, real scales at tile+512 for q4_0; +1024 for q8_0). A linear 18-byte stride through that is **not** `block_q4_0.d`. Random nibble bytes hit the fp16 NaN encoding often.

**Failure:**
- Stock fail dump: both `dev-src0 nan_scales=M` and `cpu-src0 nan_scales=M` look equally "poisoned". Only cpu-src is meaningful.
- PLAIN_HOST=1 pre-compute dump (`:693-696`) and fail dump: `cpu-src0 nan_scales` drops to 0 (recopy unpacked) while `dev-src0 nan_scales` stays huge. Reader thinks HTP weights themselves have NaN scales. They do not; the scanner is looking at tile quants.

**Fix:** scan only the CPU-side tensor (`t2` / `cpu-*`), or only when `buft` is `ggml_backend_cpu_buffer_type()`. Do not report `nan_scales` for hexagon host/repack buffers unless you parse the tiled scale plane.

---

### 3. WARNING / CONFIRMED — MXFP4 is in the 70-case filter and is not scanned at all

`tests/test-backend-ops.cpp:493-504` (no `GGML_TYPE_MXFP4`) + `ggml-common.h:214-218` (`uint8_t e` E8M0, not fp16)

HTP *does* tile mxfp4 (`ggml-hexagon.cpp:968-972`, `1015-1018`). Recopy `get` still unpacks it, so experiment **(b)** still discriminates mxfp4 NaNs. Experiment **(a)** will print `buf`/`buft`/`host=` with **no** `nan_scales` line (`:559` requires `type_has_leading_fp16_scale`).

**Failure:** stock mxfp4 CPU=NaN + `buft="CPU"` and no scale counters. REPORT table row "`nan_scales>0` => packed HTP tiled bytes" cannot fire. Easy to mark mxfp4 as "not this class" even when it is.

**Fix:** either drop mxfp4 from the device filter for exp1, or scan E8M0 (`e==0xFF` is the NaN exponent) the same way — still as raw host bytes, still canonical-block interpretation of the CPU copy.

---

### 4. WARNING / CONFIRMED — usage/comment claim a buft force that the code does not do; extra-buft theory cannot show up in these logs

`tests/test-backend-ops.cpp:672-674`, `:11169-11170`, and `ggml-alloc.c:1246-1247`

`ggml_backend_alloc_ctx_tensors` = default buft only. `eval` allocates the HTP graph that way (`:1670`). `ggml_backend_graph_copy` allocates the CPU clone the same way (`ggml-backend.cpp:2177`). CPU extra buft (`CPU_REPACK`) and HTP extra buft (`HTP0-REPACK`, `is_host=false` at `ggml-hexagon.cpp:1120-1123`) are **never** the reference buffer in this harness.

PLAIN_HOST=1 does **not** "force `ggml_backend_cpu_buffer_type()`". It recopies through get/set into whatever `graph_copy(backend2)` already allocated. Today that *is* `"CPU"`, so the recopy still unpacks HOSTBUF tiled bytes into a canonical CPU buffer — the HOSTBUF theory is tested. The Qwen extra-buft theory is **not**.

**Failure:** REPORT.md table `| cpu-src0 buft contains REPACK | extra-buffer theory CONFIRMED |` cannot happen. Seeing `buft="CPU"` is the expected result either way; it **rejects** extra-buft, it does not weakly confirm it. If someone later changes CPU default buft, recopy would write into that buft and the banner `copy-buffer=... cpu_buft=CPU` would disagree with no `GGML_ASSERT`.

**Fix:** keep the log (it is the right negative test for extra-buft). Strike the usage line about forcing `cpu_buffer_type`. Optionally `GGML_ASSERT` that `ggml_backend_buffer_get_type(copy.buffer) == ggml_backend_cpu_buffer_type()`. Do not read REPACK into a stock `CPU` line.

---

### 5. NITPICK / CONFIRMED — inf *sign* mismatch does not log cpu_buf / [ref-buf]

`tests/test-backend-ops.cpp:1741-1748` vs `:1749-1756`

NaN, inf-mismatch, and ERR all dump `cpu_buf`/`cpu_buft` + `log_op_ref_buffers`. Inf **sign** mismatch (both inf, opposite signbit) does not. Known HTP failure is CPU=NaN, so this is not the exp1 path. If a PLAIN_HOST=1 run converts NaN into signed-inf disagreement, the diagnostic dump disappears.

**Fix:** use the same log block as the inf-mismatch branch.

---

### 6. NITPICK / CONFIRMED — fail printf is outside `g_ref_buf_mutex` (and outside `g_test_output_mutex`)

`tests/test-backend-ops.cpp:1731-1737`

The NaN/ERR line goes to **stdout** unlocked; `[ref-buf]` goes to **stderr** under `g_ref_buf_mutex`. `-j` workers can interleave the stdout line with another worker's dump. Device recipe is serial (`-j` omitted) — no crash, just a trap if someone adds `-j` later.

`g_ref_buf_mutex` around `log_graph_ref_buffers` also covers `ggml_backend_tensor_get` on the non-host fallback (`:525-527`). Harmless with HOSTBUF=1 (raw path, no get). With HOSTBUF=0 it serializes workers behind a device get.

---

### 7. NITPICK / PLAUSIBLE — recopy indexes `g2` with `g1->n_nodes` before the equality assert

`tests/test-backend-ops.cpp:629-633`, assert only later at `:691`

`ggml_graph_node` GGML_ASSERTs `i < n_nodes` (`ggml.c:7546`). `graph_copy` sets `n_nodes` equal (`ggml-backend.cpp:2208`). If copy were ever truncated, recopy aborts instead of skipping. Not reachable with current `ggml_backend_graph_copy`. Pairing itself (`get(p.s=HTP), set(p.d=CPU)`) is the right unpack direction.

`p.s->src[i]` is pushed even when `p.d->src[i]` is NULL (`:649-651`); the null dest is skipped on pop (`:637`). Silent skip, not a crash. Not constructible from `graph_copy_dup_tensor` (it copies `src[]`).

---

## Direct answers (the questions you asked)

### Env off vs 0 vs 1

`ggml_test_env_on` (`:457-459`): NULL, empty string, and `"0"` are off; anything else (`"1"`, `"true"`, `"off"`) is on.

| value | path |
|---|---|
| unset | stock `ggml_backend_compare_graph_backend` |
| `=0` (device run A) | stock |
| `=1` (device run B) | recopy + whole-graph wrapper |

### Env-off path is actually stock?

**Yes, for compare semantics.** `:666-669` returns the upstream function unchanged. The only env-off delta is the callback (`:1730-1771`): extra printf fields + `log_op_ref_buffers` on NaN / inf-mismatch / ERR. Callback still `return true` on fail (same as before). Pass/fail is unchanged. Node-by-node vs whole-graph is unchanged.

### Log on fail for PLAIN_HOST=0 (callback)?

**Yes.** Call site always goes through `compare_graph_backend_judge` (`:1788`), which uses the same `callback`. Env off -> stock compare still invokes that callback per node. `cpu_buf`/`cpu_buft` are `t2` (CPU clone). `log_op_ref_buffers` dumps `dev-*` and `cpu-*` srcs.

PLAIN_HOST=1 *also* dumps `log_graph_ref_buffers` **before** compute (`:693-696`), including on passes, and dumps again on fail via the callback.

### Scale scan reads RAW host bytes, not `get_tensor`?

**Yes when `t->data && t->buffer && is_host`.** `:522-523`. Under the device env (`GGML_HEXAGON_HOSTBUF=1`) both HTP default and CPU buffers take that branch. The non-host else (`:525-527`) **does** `ggml_backend_tensor_get` (unpacks; would hide tiled poison). Not used on the planned run. HTP extra-repack is `is_host=false` but this harness never allocates it.

### Recopy pairing / skip-unpack / views / sentinels / zero-size

- Pairing: `recopy_via_get_set(graph, copy.graph)` (`:679`) = get HTP, set CPU. Hexagon `get_tensor` unpacks q4_0/q4_1/q8_0/iq4_nl/mxfp4 (`ggml-hexagon.cpp:980-1024`). CPU `set` is memcpy. HTP `t->data` is **not** rewritten by get. This is the right hammer for HOSTBUF `tensor_copy` skipping unpack.
- Does **not** skip unpack on host HTP: `ggml_backend_tensor_get` always calls `iface.get_tensor`, no `is_host` fast path (`ggml-backend.cpp:339-351`). Contrast `tensor_copy` (`:484-485`), which is the poison path.
- Views: skips `p.d->view_src` and stacks `{p.s->view_src, p.d->view_src}` (`:640-641`), same shape as `graph_copy_init_tensor` (`ggml-backend.cpp:2121-2128`). Avoids calling hexagon unpack on a view (that path uses `t->ne`/`t->data` as if the view were a full tiled tensor — would be wrong). Leaves (`a` not a graph node) are reached via `src[]` / `view_src`.
- Sentinels: F32, recopied redundantly, then OP_NONE is skipped by HTP `op_is_compute` (`ggml-hexagon.cpp:3499-3501`). Harmless.
- Zero-size: `ggml_backend_tensor_get/set` return on `size==0`. `nbytes<2` bails the scanner.
- `seen` is on `p.s` only. `graph_copy` is 1:1 via hash, so one dest per src.

### Whole-graph PLAIN_HOST vs stock node-by-node — does it invalidate exp1?

**No, not for the planned filter.**

`test_mul_mat::run_whole_graph` is `o > 1` (`:4886`). Default `o=1`. Every quant `type_a` instantiation in `make_test_cases_eval` uses default `o`. The only `o=3` case is F32 (`:9585`). So stock path is `num_test_nodes==0` -> node-by-node `ggml_graph_view`. PLAIN_HOST always whole-graph (`:698-700`) to avoid `ggml-impl.h`.

For those graphs the compute nodes are one MUL_MAT plus OP_NONE sentinels:

- HTP `graph_compute` skips `!op_is_compute` (OP_NONE / no `FLAG_COMPUTE`). Fusion looks at `nodes[i+1]`; next is a sentinel, not ADD / sibling MUL_MAT (`try_fuse_node` `:3563-3650`). Same MUL_MAT kernel as a 1-node view.
- CPU whole-graph vs 1-node MUL_MAT is the same op on the same recopied weights.
- The NaN is produced by **CPU dequant of weight layout**, not by graph scheduling. Recopy changes layout; whole-graph does not.

If PLAIN_HOST=1 NaNs vanish, that is the HOSTBUF memcpy theory, not "we stopped doing node-by-node". If they remain, do not blame whole-graph for these MUL_MAT cases.

Caveat (out of filter): running `GGML_TEST_PLAIN_HOST=1` on the full suite *would* change fused tests (`o>1`, RMS_NORM+MUL, etc.) relative to stock. Do not use this wrapper as a general judge.

`ggml_backend_graph_compute` status is ignored (stock node-by-node also ignores it). Not new.

### `-j` races

Workers get disjoint `test_cases` chunks (`:10936-10962`) and each `-j` worker constructs its own HTP+CPU backends (`:10973-10988`). No shared tensors. `g_ref_buf_mutex` only serializes stderr dumps. Recopy is per-call local stack/`std::set`. No recopy race. `getenv` is read-only.

### mxfp4 has no fp16 scale

Correctly excluded from `type_has_leading_fp16_scale`. See finding 3.

---

## Ruled out (brief)

- **Null deref in name helpers:** `tensor_buf_name` / `tensor_buft_name` guard `!t || !t->buffer`. `log_tensor_ref_buf` guards `!t`. `t->name[0]` is a `char[]`.
- **Callback `t2` is not the CPU tensor:** `eval` is `(backend=HTP, backend_cpu=CPU)` (`:10950`). Stock compare: `t1=g1` (original HTP), `t2=g2` (CPU clone). `cpu_buf` on `t2` is correct.
- **Recopy of outputs poisons the judge:** outputs are F32 garbage copied then overwritten by both computes, same as `graph_copy`.
- **`nbytes` vs HTP padded alloc:** `ggml_nbytes` is canonical; hexagon unpack writes `ne1*(ne0/32)*sizeof(block)*...` which matches for `ne0 % 32 == 0` (all q4_0/q8_0/iq4_nl/mxfp4 tests; `init_tensor_uniform` asserts `nels % blck_size == 0`). CPU buffer is canonical-sized. get(n)+set(n) fits.
- **Scan accidentally uses `get_tensor` on the planned run:** HOSTBUF=1 => host branch.
- **Includes:** `<mutex>` and `<set>` already present (`:37`, `:40`).
- **k_v / src_overlap views of quant:** k_v and src_overlap cases in eval are F32 (`:9585`, `:9587`). Quant permute keeps `per[0]==0` so dim-0 blocks stay contiguous; recopy follows `view_src` to the parent.

---

## Altitude

The right fix for HOSTBUF poison is in `ggml_backend_tensor_copy`: `is_host(src)` must not skip `get_tensor` when `get` is not a raw memcpy (hexagon). This patch is a reversible test probe, which is the assigned experiment. Acceptable **if** the logs are read as:

1. Stock `cpu-src0 buft` will be `"CPU"`. That **rejects** extra-buft, it does not confirm it.
2. Stock `cpu-src0 nan_scales` is the poison heuristic — and only for types with a leading fp16, and only the first half (q4_1 `m` hole).
3. `dev-src0 nan_scales` is not a scale count on HOSTBUF=1. Ignore it.
4. PLAIN_HOST=1 NaNs gone => reference was tiled-as-canonical. HTP math is not the bug.
5. PLAIN_HOST=1 NaNs remain on q4_0/q8_0/iq4_nl with `cpu-src0 nan_scales=0` => not this class. On q4_1, check `m` before believing that. On mxfp4, the scan never ran.

Do not ship this wrapper as the default judge. Do not treat whole-graph as a confounder for this MUL_MAT filter.
