# Hostile audit — step 4b (`git diff 6a937f6db..ee3dfde49`, 4 commits)

Repo `~/Projects/kalsallama-gov-onecopy`, branch `feat/governor-onecopy`, HEAD = `ee3dfde49` (audited tree).
Read-only audit. Nothing built, nothing run except `git`/`grep`/`sed`/`nl`.

Severity key: **P0** breaks R1/R2 on the tested phone · **P1** will produce wrong results or a crash on
the S23 with a plausible trigger · **P2** latent/conditional defect or undeclared behaviour change ·
**P3** hygiene, cost, or a claim that is wrong-but-inert.

---

## Findings, ranked

### F1 · P1 · CONFIRMED (code) / PLAUSIBLE (memory consequence) — the lm_head launch has no `r1 < ne11` guard: OOB read of the activation and a ~512 KB out-of-bounds write past the logits, every decode step

`ggml-opencl.cpp:25596-25601` (new branch):
```c
        const int ne0  = (int) dst->ne[0],  ne1  = (int) dst->ne[1];
        const int r2 = ne12/ne02, r3 = ne13;   // admitted shape: ne03 == ne13 == 1
        ...
        size_t global_work_size[] = {(size_t)((ne01 + ndst*nth1 - 1)/(ndst*nth1))*nth0, (size_t)(ne11*nth1), (size_t)(ne12*ne13)};
        size_t local_work_size[]  = {(size_t)nth0, (size_t)nth1, 1};
```
with `nth1 = 2`, and the only admitted shape has `ne11 == 1` (`ggml-opencl-tile32-host.cpp:21`,
`x->ne[1] == 1`). So `global_work_size[1] = 2`, i.e. `get_group_id(1) ∈ {0,1}`.

`kernels/mul_mv_q6_k_f32.cl:109,124,192`:
```c
    int r1 = get_group_id(1);
    ...
    global float      * yy = (global float     *) src1 + r1*ne10 + im*ne00*ne1;
    ...
    if (get_sub_group_local_id() == 0) {
        dst[r1*ne0 + im*ne0*ne1 + row] = tot;
    }
```
The only range guard is `if (row >= ne01) return;` (line 114). `r1` is used **both** as the
subgroup id (via `get_sub_group_id()`, line 112) and as the token/row-block index. With `ne11 == 1`
the launch has two work-group rows; the `r1 == 1` half:
* reads `src1 + ne10 .. src1 + 2*ne10-1` — 8 KB past the 8 KB activation;
* writes `dst[ne0 + row]` for every `row ∈ [0, ne01)` — for a tied lm_head `[2048, 128000]`,
  `ne0 == dst->ne[0] == 128000`, so indices `128000 … 256000`, i.e. **512 KB past a 512 KB logits
  tensor**, into whatever follows it in the graph compute buffer (or past its end).

This is inherited text — the generic non-SoA dispatch has the identical config
(`ggml-opencl.cpp:27668-27671` + `27804`) — but that branch is **dead in this build**:
`ggml-opencl.cpp:27622-27624` `#ifdef GGML_OPENCL_SOA_Q kernel = backend_ctx->kernel_mul_mv_q6_K_f32_flat;`
and `CMakeLists.txt:26 add_compile_definitions(GGML_OPENCL_SOA_Q)`. This commit is the first and
only caller of `kernel_mul_mv_q6_K_f32` in the whole tree
(`grep -rn kernel_mul_mv_q6_K_f32` → only line 25573 + the `#else` at 27662). It is also 2× the
necessary work. Cross-check that the convention really is `nth1 == N_SIMDGROUP == 1` everywhere
else: `mul_mv_q4_0_f32.cl` N_SIMDGROUP 1, `mul_mv_q5_K_f32.cl` 1, `mul_mv_q4_K_f32.cl` 1,
`mul_mv_q6_K_f32.cl` **2**, `mul_mv_q6_K_f32_flat.cl` **2** — the two Q6_K GEMVs are the only kernels
with `N_SIMDGROUP == 2`, and they are the only ones whose Adreno `nth1` is 2.

Failure scenario: `llama-perplexity` / `llama-bench` decode on the S23 with shared weights on →
lm_head MUL_MAT taken by OpenCL → second y-row writes 512 KB past `logits` each token; either silent
corruption of the next graph tensors or an out-of-range access at `clFinish` (which `CL_CHECK`
turns into an abort). Cannot be decided without a device; the code fact is not in doubt.
Fix direction (not my call, but for the record): launch `global_work_size[1] = ne11` when
`nth1 == N_SIMDGROUP` is folded into the row id, or add `if (r1 >= ne11) return;` to the kernel.

---

### F2 · P1 · CONFIRMED — the E031.41 a7x lm-head guard is bypassed for HOST Q6_K, and so is its env override; the plain kernel has zero coverage on Adreno 740

The guard and the commit's reading of it:
```
ggml-opencl.cpp:10215  // The E031.41 compiler (usually with A7x) miscompiles the flat K-quant
ggml-opencl.cpp:10216  // GEMV kernels (kernel_mul_mv_q*_K_f32_flat) and makes lm_head run much
ggml-opencl.cpp:10217  // slower than it should. So, make it fallback to CPU to preserve performance
ggml-opencl.cpp:10219          static const char * a7x_lmhead_env = getenv("GGML_OPENCL_A7X_LMHEAD_CPU");
ggml-opencl.cpp:10220          static const bool   a7x_lmhead_cpu = (a7x_lmhead_env == nullptr || a7x_lmhead_env[0] != '0');
ggml-opencl.cpp:10221          if (a7x_lmhead_cpu &&
ggml-opencl.cpp:10222              backend_ctx->adreno_gen == ADRENO_GPU_GEN::A7X &&
ggml-opencl.cpp:10225                  op->src[0]->ne[1] >= 32768) {   // vocab-scale weight; ...
ggml-opencl.cpp:10226              return false;
```

*Answer to the audit question "does the plain `kernel_mul_mv_q6_K_f32` have the vocab-size issue
the guard exists for?"* — **the claim as literally stated is CONFIRMED, the inference drawn from it
is not.** The guard is textually and structurally about the SoA flat kernels
(`kernel_mul_mv_q*_K_f32_flat`), and the generic Q6_K dispatch in this build only ever selects the
flat kernel (27624), so on the A7X the flat sibling is the only Q6_K GEMV the guard ever protected.
There is **no integer-overflow or vocab-size arithmetic defect** in the plain kernel: `nb = ne00/256 = 8`
(106), `row*nb` max 1 024 000 blocks (123), `(i13/r3)*(nb*ne01*ne02)` = 0 for the admitted shape
(121) — 128000×2048 is fine. The problem is that the guard's `ne[1] >= 32768` clause is a *compiler
class* + *perf* clause, and this commit moves exactly that shape onto the **other** kernel of the
same compiler class:

* `ggml-opencl.cpp:9781`: "sent to kernel_mul_mv_q6_K_f32_flat, which is broken on Adreno 740 driver
  0676.73 (NMSE ~12)" — the S23 is the device where the sibling kernel is *measured* wrong.
* `ggml-opencl.cpp:9797-9799`: "The size escape is not taken on the A7X since its compiler
  miscompiles the flat K-quant GEMV".
* The flat kernel needed a runtime `q6k_mask` arg, an int-not-ulong block index and three guarded
  `printf`s to survive this compiler (`kernels/mul_mv_q6_k_f32_flat.cl:177-191, 251-261`,
  "FRAGILE: … load-bearing on E031.41"). The plain kernel has none of that
  (`kernels/mul_mv_q6_k_f32.cl:89,121,123` use the same `ulong`/pointer-offset shapes).
* The new branch is above the `switch`, so the guard is not merely bypassed for the *flat* case:
  `GGML_OPENCL_A7X_LMHEAD_CPU=0` (the documented opt-in to a GPU lm_head) is silently ignored on
  this route, and there is no way to turn the route off short of killing the whole HOST leg.
* `ggml-opencl-tile32-host.cpp:3-6` asserts the guard "does not apply here on purpose" — that is an
  assertion about a kernel with no measurement, no self-check (F3) and no test on this device.

R1 impact: the single most numerically exposed op in the model (vocab-scale Q6_K over 128000 rows)
now runs, on the S23, on the untested sibling of a kernel known-broken there. Perf impact: the
branch also bypasses `use_adreno_kernels` / `use_q6k_tiled` / the noshuffle GEMV (all of which are
below it), i.e. it uses a 1-row-per-subgroup scalar kernel where the device has a tiled dp4a path —
the guard exists precisely because that class of GEMV lost to the CPU on A7X. No benchmark in this
commit.

---

### F3 · P1 · CONFIRMED — the HOST route has no self-check, and dma-buf write coherency for it defaults to off

`ggml-opencl-tile32.cpp:281-297`: the TILE32 admission runs a per-tensor read-only self-check
(`ggml_opencl_tile32_self_check_locked`, gate file lines 108-176) that compares the GPU result with
the CPU tile reader on the *same bytes*. `ggml_opencl_host_view` (`ggml-opencl-tile32.cpp:305-323`)
checks only the gate and the map; `ggml-opencl-tile32-host.cpp:3-6` states the omission as
intentional. So on the HOST leg the first thing that would notice "the import mapped the wrong
bytes / the wrong policy / stale data" is a user-visible wrong number.

That matters here because the allocation is **cached** by default and the coherency flush is off:
```
ggml-hexagon.cpp:2319   const uint32_t flags = opt_hostbuf_uncached ? RPCMEM_FLAG_UNCACHED : RPCMEM_DEFAULT_FLAGS;
ggml-hexagon.cpp:2179   if (opt_hostbuf_flush) {          // GGML_HEXAGON_HOSTBUF_FLUSH, default false (8725)
ggml-hexagon.cpp:2182       ioctl(sbuf->fd(), DMA_BUF_IOCTL_SYNC, &sync)   // START sync for WRITE
ggml-opencl-tile32.cpp:127  const cl_uint policies[2] = { uncached ? POLICY_UNCACHED : POLICY_IOCOHERENT, POLICY_WRITEBACK };
```
With `uncached == false` (the default: `opt_hostbuf_uncached = false`, 8724) the importer tries
io-coherent, and **falls back to write-back**. A write-back GPU mapping of CPU-cached rpcmem, with
no `DMA_BUF_IOCTL_SYNC` on the loader's writes, is exactly the configuration where the GPU may read
stale bytes. (Not introduced by this diff — but before this diff nothing on the Adreno read HOST
rpcmem, so it becomes load-bearing here, and F3's missing self-check is what removes the detector.)
Failure scenario: `GGML_HEXAGON_HOSTBUF_FLUSH` unset + io-coherent import refused on some driver →
norm weights and the tied Q6_K embedding are read from the GPU's stale copy → wrong logits, no
error anywhere.

---

### F4 · P2 · CONFIRMED (asymmetry), latent — `supports_op` can admit an op whose compute path then dereferences a Hexagon extra as an OpenCL extra

The admission inner loop treats *any* HOST-buffer src as "addressable":
```
ggml-opencl.cpp:9974            if (obuft->device == dev || ggml_opencl_in_host_leg_buffer(other)) {
ggml-opencl.cpp:9975                continue;
```
but the MUL_MAT compute path substitutes **only src0**:
```
ggml-opencl.cpp:25568        ggml_tensor_extra_cl extra0h = {};
ggml-opencl.cpp:25569        ggml_opencl_host_extra(backend_ctx, src0, &extra0h);
ggml-opencl.cpp:25570        ggml_tensor_extra_cl * extra1 = (ggml_tensor_extra_cl *)src1->extra;
ggml-opencl.cpp:25576        CL_CHECK(clSetKernelArg(kernel,  2, sizeof(cl_mem),   &extra1->data_device));
```
`src1->extra` for a HOST tensor is a `ggml_hexagon_tensor_extra *` (set in
`ggml-hexagon.cpp:845 tensor->extra = extra;`). The cast at 25570 is exactly the thing this whole
amendment forbids; if `src1` is ever in a HOST buffer the kernel is handed a fabricated
`cl_mem`/offset read out of the wrong struct. `ggml_cl_mul`/`ggml_cl_ssm_conv` do substitute both
slots (16009-16014, 16665-16670) — the mul_mat branch does not.
Not reachable today (only weights live in the HOST buft, activations are graph-local), but it is
the exact hole the audit asked about, and the fix is one line.

---

### F5 · P2 · CONFIRMED — MUL/SSM_CONV admission ignores views and contiguity; the compute path then double-counts `view_offs` and asserts contiguity

```
ggml-opencl-tile32-host.cpp:24  case GGML_OP_MUL:
ggml-opencl-tile32-host.cpp:25  case GGML_OP_SSM_CONV:
ggml-opencl-tile32-host.cpp:26      return op->src[0]->type == op->src[1]->type &&
ggml-opencl-tile32-host.cpp:27             op->src[0]->type == op->type &&
ggml-opencl-tile32-host.cpp:28             op->src[0]->type == GGML_TYPE_F32;
```
`w` is not even looked at (contrast the MUL_MAT case, which checks `w->view_src`, line 12). The
compute path then does:
```
ggml-opencl.cpp:16016  cl_ulong offset0 = extra0->offset + src0->view_offs;
```
and `toff` in `ggml-opencl-tile32.cpp:240` is `w->data - base`, which for a view **already
includes** `view_offs` (a view's `data` is `view_src->data + view_offs`). A HOST view weight would
therefore be read at `toff + view_offs`. Additionally the bcast_row fast path asserts
`GGML_ASSERT(ggml_is_contiguous(src0))` (`ggml-opencl.cpp:16024`) and loads `src0`/`src1` as
`global float4 *` (`kernels/mul.cl:62-72`), neither of which the predicate checks.
Latent: llama's norm/conv weights are 1-D/3-D `ggml_new_tensor` (no views, contiguous). Still, the
predicate and the compute path disagree about what is legal, and nothing tests it (see F13).

---

### F6 · P2 · CONFIRMED — the SSM_CONV half of the commit does not do what it claims, in both directions

The commit justifies the "every buffered src addressable" rule with "a src in plain CPU memory
(the -nkvo KV and **recurrent state**) would need a copy, so the op is declined". In this tree
`ggml_ssm_conv` has **two** sources and src1 is the *weight*:
```
ggml.c:  ggml_ssm_conv(ctx, sx, c):  result->src[0] = sx;  result->src[1] = c;   // c = [d_conv, d_inner] conv weight
ggml-opencl.cpp:10162  case GGML_OP_SSM_CONV:
ggml-opencl.cpp:10163      return (op->src[0]->type == GGML_TYPE_F32 && op->src[1]->type == GGML_TYPE_F32 && op->type == GGML_TYPE_F32);
```
Consequences: (a) the recurrent state is not a src of this op at all, so nothing declines conv —
**conv now goes onto the GPU** whenever `src1` is an importable HOST weight and `src0` is
graph-local, directly contradicting "attention and conv stay off the GPU in this step"; (b) the
"state src must sit in an OpenCL or HOST buffer for the op to have been admitted" comment at
`ggml-opencl.cpp:16662` describes a tensor that does not exist in this op.
And the kernel this newly enables has a pre-existing multi-sequence indexing bug that the route
now exposes: `kernels/ssm_conv.cl:24`
`global float * s = (global float *) (src0 + ir*nb01 + i2*nb00 + i3*nb02);` where `i2 =
get_global_id(1)` runs over `dst->ne[1] = n_t` (tokens) for `src0`, but the CPU reference strides
dim0 by `n_t` per sequence — so for `n_s > 1` the GPU reads the wrong row. Not this commit's
fault, but this commit is what makes the node reachable with a HOST weight.

---

### F7 · P2 · CONFIRMED — the placement change relocates **every** input-role tensor, not `token_embd`, and re-pairs them with `cpu_dev`

```
src/llama-model.cpp:1157 static buft_list_t make_shared_input_buft_list(...)
src/llama-model.cpp:1169     list.emplace_back(cpu_dev, buft);
src/llama-model.cpp:1175     list.insert(list.end(), cpu_list.begin(), cpu_list.end());
src/llama-model.cpp:1699     if (ml.shared_weights) {
src/llama-model.cpp:1701         pimpl->dev_input = { cpu_dev, &pimpl->input_buft_list };
```
`buft_list_input` is used for every tensor with `info.layer == LLM_TENSOR_LAYER_INPUT`
(`llama-model-loader.cpp:1219-1221`), which is not just `TOKEN_EMBD`:
```
llama-arch.cpp:729  {LLM_TENSOR_POS_EMBD,     {LLM_TENSOR_LAYER_INPUT, GGML_OP_GET_ROWS}},
llama-arch.cpp:730  {LLM_TENSOR_TOKEN_TYPES,  {LLM_TENSOR_LAYER_INPUT, GGML_OP_GET_ROWS}},
llama-arch.cpp:921  {LLM_TENSOR_PER_LAYER_TOKEN_EMBD, {LLM_TENSOR_LAYER_INPUT, GGML_OP_GET_ROWS}},
llama-arch.cpp:992  {LLM_TENSOR_MASKED_EMBD_CENTROIDS, {LLM_TENSOR_LAYER_INPUT, GGML_OP_NONE}},
```
so `pos_embd` (can be 100+ MB), `token_types`, per-layer embeddings and the masked-emb tables all
(a) move to the front candidate = the Hexagon HOST rpcmem buft, and (b) get their ops assigned to the
**CPU** instead of the Hexagon device, because the entry is re-paired with `cpu_dev`. `GGML_OP_NONE`
tensors take the first list entry unconditionally (`llama-model-loader.cpp:930 if (op ==
GGML_OP_NONE) return true;`), so the relocation there is unconditional. None of this is in the
commit message, and none of it is on the GPU leg (only `token_embd` is). With `GGML_HEXAGON_HOSTBUF_UNCACHED=1`
this moves the per-token `pos_embd` lookup onto uncached memory for no GPU benefit.
Neutralised under mmap: `llama-model-loader.cpp:1272 if (use_mmap && buft_dev && buft ==
ggml_backend_dev_host_buffer_type(buft_dev))` → CPU buft. So the whole feature is a no-op under the
default `--load-mode` (auto→mmap); it only takes effect with `--load-mode none`. That is worth
stating in the commit message, because "lm_head on the GPU" will silently not happen otherwise.

---

### F8 · P2 · CONFIRMED — nothing in the tree calls `ggml_backend_opencl_release_imports`; the leak is now ~200 MB and the stale-import warning is release-silent

`grep -rn release_imports` over the whole repo (excluding `build/`) returns only the OpenCL backend
itself: the proc export at `ggml-opencl.cpp:15149` and the definition at
`ggml-opencl-tile32.cpp:326`. No caller in `src/`, `common/`, `examples/`, `tools/` or `tests/`.
The header states the contract:
```
ggml-opencl-tile32.h:17  // call it before llama_model_free ... skipping the call leaks every TILE32 and HOST buffer for the
ggml-opencl-tile32.h:18  // rest of the process.
```
Two consequences specific to HOST: (a) the HOST buft is **one** rpcmem block holding token_embd
plus every f32 norm/conv weight, so the leaked import is the biggest object in the model (a
2048×128000 Q6_K embedding alone is 210 MB) — `clReleaseMemObject` never runs;
(b) the staleness detector is compiled out of release builds:
```
ggml-opencl-tile32.cpp:100  #ifndef NDEBUG
ggml-opencl-tile32.cpp:101      GGML_LOG_WARN("ggml-opencl-tile32: import for buffer %p is stale (fd %d -> %d) - "
```
and the acceptance test is `fd == && base == && size ==` (105) — three values that a recycled
rpcmem VA + recycled fd number + same size can satisfy. In an NDEBUG Android build that serves the
**previous model's** mapping silently.
(I cannot see the out-of-tree binding the comments refer to; from this repo the contract is
unwired, and step 4b widened its cost.)

---

### F9 · P2 · CONFIRMED — the lm_head only lands in the HOST buft when it is *tied*; the untied case and the CPU-output-layer case are unaddressed, and the stated premise is only half true

`dev_output` is untouched:
```
src/llama-model.cpp:1713    pimpl->dev_output = get_layer_buft_list(n_layer_all);
```
and `llama-model-loader.cpp:1226-1228` routes a `TENSOR_DUPLICATED` `TOKEN_EMBD` to
`buft_list_output` (the role is remapped at 1126-1128). The step-3 reuse scan then usually finds
`token_embd` again (`llama-model-loader.cpp:1372-1400`), so the tied case works. For an **untied**
lm_head (or whenever the reuse scan misses), the output layer's list is the CPU list or the GPU list,
and the GPU list's HOST entry appears only under `opt_hostbuf` (`ggml-hexagon.cpp:8458`) and only if
the output layer is a GPU layer (`get_layer_buft_list`, 1680-1690). So "step 4b = lm_head on the
GPU" holds for tied weights on GPU-assigned output layers, and silently does not hold otherwise.
The commit's premise "the plain CPU buffer would leave the lm_head on a second copy" is only true
when the output layer is CPU-assigned; when it is GPU-assigned, `make_gpu_buft_list` already offered
the HOST buft (1216-1220) and the input-list change is redundant for the lm_head.

---

### F10 · P2 · PLAUSIBLE — stale `{cl_mem, base}` after buffer free, widened blast radius

`ggml-opencl-tile32.cpp:96-116`: `g_imports` is keyed by `ggml_backend_buffer_t` and only pruned by
`import_locked`'s identity probe or by `release_imports` (never called, F8). Because the HOST block
is ~200 MB of the *only* copy of the tied embedding, a reload that reuses the same `ggml_backend_buffer_t`
address with a recycled fd/base/size serves the old mapping; the `NDEBUG` warning is gone (F8) and
the TILE32 self-check that would have caught it does not run on HOST tensors (F3).

---

### F11 · P3 · CONFIRMED — `host_views_locked` drops the alignment clause that `views_locked` has

```
ggml-opencl-tile32.cpp:161  if (toff % 16 != 0 || toff > imp->size || tbytes > imp->size - toff) {   // views_locked
ggml-opencl-tile32.cpp:242  if (toff > imp->size || tbytes > imp->size - toff) {                      // host_views_locked
```
The norm-MUL fast path loads the weight as `global float4 *` (`kernels/mul.cl:62-72`), so a 16-byte
misaligned `offset1` is a fault. Safe today only because the Hexagon buft alignment is 128
(`ggml-hexagon.cpp:2334 return 128;`) and every tensor offset is aligned to it. The clause the
TILE32 leg relies on should not be optional on the sibling path.

---

### F12 · P3 · CONFIRMED — cost and API smells on the compute path

* `ggml_opencl_host_extra` is called twice per MUL and twice per SSM_CONV
  (`ggml-opencl.cpp:16009,16012,16665,16668`), each rebuilding a `ggml_opencl_tile32_env`
  (9853-9870) and taking the process-wide leg mutex plus a `std::map` lookup. Two norms × 40 layers
  = ~160 mutex acquisitions per token, on top of the compute.
* `ggml-opencl.cpp:25569` **discards** the bool return of `ggml_opencl_host_extra`. It cannot be
  false there (the enclosing `if` used the same predicate), but a `false` would silently enqueue
  `data_device == nullptr` → `CL_INVALID_MEM_OBJECT` at run time instead of an assert.
* `ggml_opencl_in_host_leg_buffer` runs `reg->iface.get_proc_address(reg, "ggml_backend_buffer_dmabuf")`
  — a `strcmp` chain — for **every src of every op** at graph build (9960-9964, and again at 9974).
* `ggml_opencl_tile32_host_view` stores `off` and `toff` (identical values) plus `ne`/`nb` copies
  that are only used as the recycle key (`ggml-opencl-tile32-internal.h:48-56`).

---

### F13 · P3 · CONFIRMED — the test links the real TU and mutates no env, but covers none of the decision surface that actually decides at run time

Good: `tests/CMakeLists.txt:487-489` compiles `ggml-opencl-tile32-host.cpp` itself (not a copy), and
the test touches no environment (`getenv`/`setenv` absent) so nothing leaks into
`test-tile32-opencl-gate` / `test-backend-ops`. The 18 `check()` calls match the claimed 18.
Gaps, in order of how much they hide:
1. **No view/strided MUL or SSM_CONV negative case** — the test proves views are refused for
   MUL_MAT (line 71) and stays silent for the two ops where the predicate admits them (F5). The
   test is green *and* the hole is open.
2. **No case where a non-weight src is in a HOST buffer** (F4).
3. **No `ne01 >= 32768` / A7X case**, i.e. nothing pins down that the guard is bypassed (F2) or that
   it is meant to be.
4. **No `ggml_is_contiguous(src1)` case**, though the predicate checks `ggml_is_contiguous(op)`
   (the *dst*) and the generic path checks src1's contiguity (`ggml-opencl.cpp:10244`).
5. Nothing tests the two runtime predicates the admission actually depends on
   (`ggml_opencl_in_host_leg_buffer`, and the "every other buffered src is addressable" loop at
   9968-9978) — both are the parts that decide, and both are unexercised and untestable in the host
   build.

---

### F14 · P3 · CONFIRMED (inert) — the stated gate for the placement change is factually wrong; the real gate is `opt_hostbuf`

```
src/llama-model.cpp:1696      // The gate is the same fact that made the loader flag
src/llama-model.cpp:1697      // shared_weights: a TILE32 buft in some list, which only shared mode produces, so two-copy
src/llama-model.cpp:1698      // placement is byte-identical.
```
`ml.shared_weights` is `buft_list_has_tile32(...)` (1635-1638), and
`ggml_backend_hexagon_dev_get_extra_bufts` offers TILE32 **unconditionally**
(`ggml-hexagon.cpp:8458 dev_ctx->extra_bufts[0] = &dev_ctx->tile32_buffer_type;`; HOST is the
conditional one, 8458-8460). So `shared_weights` is true for any process with a Hexagon device in
`devices`, two-copy included. The *outcome* is still correct — `make_shared_input_buft_list` gets
`nullptr` from `ggml_backend_dev_host_buffer_type` when `!opt_hostbuf`
(`ggml-hexagon.cpp:7752-7755`) and returns `cpu_list` verbatim (1172-1174), so two-copy placement is
byte-identical — but the stated mechanism is wrong, and one `extra_bufts` edit away from moving
input weights into rpcmem in two-copy mode with no gate at all.

---

## Refuted / verified-good (checked, no finding)

* **Kernel arg order and types match** `kernel_mul_mv_q6_K_f32` exactly — 15 args,
  `(cl_mem, cl_ulong)×3, int ne00, ne01, ne02, ne10, ne12, ne0, ne1, r2, r3`
  (`kernels/mul_mv_q6_k_f32.cl:80-97`) vs `ggml-opencl.cpp:25583-25596`. All 15 `clSetKernelArg`
  calls match in position and size. The claim in the commit is correct.
* `offset0 = extra0h.offset + src0->view_offs` is correct **for the admitted shape** because the
  predicate refuses `w->view_src` (`ggml-opencl-tile32-host.cpp:12`); `ggml_is_contiguous(op)`
  (line 22) covers the dst. The `toff = data - base` arithmetic is right: `tensor->data` is
  `get_base(buffer) + aligned_offset` and `imp->base == sbuf->base()` — the same identity the
  TILE32 leg already proved on the phone.
* `ggml-opencl-tile32.cpp:242` bounds check is overflow-safe (`toff > size || tbytes > size - toff`),
  and the 4 KB guard page added in the shared-buffer ctor (`ggml-hexagon.cpp:737-739`) makes
  `mem->size` larger than the ggml buffer, which the import sizes itself from (`imp.size = sbuf->size()`).
* `release_import` does cover HOST: `imp.hosts.clear()` then a single `clReleaseMemObject(imp.buf)`
  (`ggml-opencl-tile32.cpp:66-74`); host views hold no `cl_mem` of their own. No leak, no
  double-release.
* `supports_buft` cannot claim the plain CPU buft: `ggml_backend_cpu_get_proc_address`
  (`ggml-cpu.cpp:667`) returns NULL for unknown names, and the OpenCL buft has `is_host = NULL`
  (`ggml-opencl.cpp:14964`) so `ggml_backend_buft_is_host` is false (`ggml-backend.cpp:81-87`).
  TILE32 is not double-claimed (its `is_host` returns false).
* `release_imports` `clFinish`es the leg queue before dropping any `cl_mem`
  (`ggml-opencl-tile32.cpp:326-330`), and the whole import map is behind one mutex — no data race.
* The dmabuf accessor identifies HOST by `is_host` function-pointer identity
  (`ggml-hexagon.cpp:8473-8477`), which excludes the fence and split bufts (both reuse
  `ggml_backend_hexagon_buffer_type_interface`, `is_host → false`) and the null-context dummy buffers
  are safe (`llama-model-loader.cpp:1058` → `ggml-backend.cpp:41-45` returns a context-less dummy;
  the accessor's `if (!sbuf || …)` catches it).
* Two-copy behaviour is otherwise unchanged: no non-HOST tensor can enter any new branch —
  `in_host_leg_buffer` is false for OpenCL buffers (`is_host == NULL`), for the CPU buft (no proc)
  and for the Hexagon default/split bufts.
* CPU-writes-after-import hazard: the only CPU writer of HOST memory is the loader
  (`ggml-hexagon.cpp:2188 memcpy`), which runs before graph build, and lazy-loaded tensors are
  forced to the CPU buft (`llama-model-loader.cpp:1080-1085`) — so no post-import CPU write exists
  except through the coherency question in F3.

---

## Overall verdict

The plumbing (accessor identity, import map reuse, kernel argument marshalling, gate reuse, release
coverage) is careful and mostly right, but the one op this step exists to enable — the vocab-scale
Q6_K lm_head — is dispatched through a dead-in-this-build kernel with an unguarded `r1` that reads
and writes out of bounds on every token, with the A7X guard and its env override bypassed, with no
self-check, and with no device run behind any of it: **not shippable as-is; F1 and F2 must be closed
on the phone before step 4b counts toward R1.**
