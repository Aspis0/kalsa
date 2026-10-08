# Diagnosis — one-copy GPU leg on Adreno 750 (SM8650, E031.45): which imported read is wrong, and how to split it in a day

- Reviewer: n2. Read-only: no source edited, nothing committed, no fix proposed as a change. One file written (this one).
- Engine read: `/Users/marco/Projects/kalsallama-gov-loadstep` (HEAD `9c11ebcbf`). Defect measured on `dbdeb628e`:
  `git diff dbdeb628e 9c11ebcbf -- ggml/src/ggml-opencl ggml/src/ggml-hexagon` touches **only**
  `ggml-opencl-tile32-facts.{cpp,h}` (the `GGML_OPENCL_TILE32_LAB` build gate around the unmeasured-device env read) and
  `ggml-hexagon`'s lab-only vcorner knob + CMake. No import, kernel, self-check or dispatch code differs, so the
  `dbdeb628e` measurements describe `9c11ebcbf` for this defect. **Verbatim from the diff I ran:** the only behavioural
  delta on the OpenCL side is `+#ifdef GGML_OPENCL_TILE32_LAB` / `+    const char * v = getenv("GGML_OPENCL_TILE32_UNMEASURED");`.
- Evidence read: `xiaomi-sm8650/raw/session1-correctness-dbdeb628e.grep`, `.../session2-gpuleg-kl-split-dbdeb628e.grep`,
  `.../session3-legs-endurance-unplugged-dbdeb628e.grep`, the five `run-xiaomi-*.sh`, the `PLAN.md` entry
  **"Xiaomi 14 (SM8650, v75, Adreno 750), plugged, correctness only"** (at lines 2100-2110 while I read it; PLAN.md is
  being edited by other sessions, so all PLAN citations below are by content, not by line),
  `audit-unmeasured-override-n2.md` (F1-F4), and the S23 one-copy greps under `step4-s23/`, `step4b-s23/`, `step5-s23/raw/`.

## 0. What the evidence actually contains — and what it cannot contain (read this before the verdicts)

The `.grep` files are `grep -E '<pattern>' | cut -c1-240 | sort | uniq -c | sort -rn | head -40`, written by `run()` in
`run-xiaomi-correctness.sh` (lines 30-37). Consequences that matter here:

1. **No count of self-checks can be read from them.** The PLAN entry states *"167 self-checks PASS"* (line 2102 while I
   read it); I accept the coordinator's number, but the grep file itself cannot show it (head-40 cuts the tie group, and ties print in
   descending line order, which is why only `blk.9, blk.8, blk.7` appear). Treat "all 167 passed" as reported, not verified here.
2. **`ggml-opencl: TILE32 leg disabled: <reason>` is not in the grep pattern.** A mid-run leg disable (the reason strings
   are `"per-tensor image views failed"` (`ggml-opencl-tile32.cpp:234`), `"v4 program build failed"` / `"self-check failed"`
   (`ggml-opencl-tile32.cpp:336-340`), logged via `ggml_opencl_tile32_disable_locked`, `ggml-opencl-tile32-gate.cpp:85`)
   would be invisible. If a leg had been disabled the affected ops would fall to the CPU, which would show as ~15 tok/s;
   the GPU leg ran 21.5-23.1 tok/s (`session1-...grep:116`), so I read this as *not* happened, but it is an inference.
3. **Allocation fallbacks are invisible.** `ggml-opencl.cpp:11544` `"ggml_opencl: %s (%.1f MiB) — device alloc failed,
   using CL_MEM_ALLOC_HOST_PTR fallback"` is not in the pattern. An OOM-driven fallback (or a `clCreateBuffer` retry,
   `ggml-opencl.cpp:11515` `clFinish(queue)`) would be silent in these files.
4. **The device facts are missing.** `ggml-opencl.cpp:7358` logs
   `"ggml_opencl: mem base addr align: %u bytes | IMAGE base addr align: %u bytes"` — the 750's two alignment figures are
   already in the on-device logs but not in these greps, so I cannot state them.
5. **The dispatched kernel list per leg is missing.** `GGML_OPENCL_LOG_KERNELS=1` exists (`ggml-opencl-kalsa-diag.cpp:36`)
   and was not used, so Q1 below is answered from the source, not from the run.
6. `session1`'s per-window rows are given twice (the `##` summary and the `## L windows/kld` block), so quote one.

GPU-leg outcome across **every** run I can see — 1 clean of 10, not 7 dirty of 8:

| run | source | GPU windows (kl_mean) |
|---|---|---|
| L rotation, 3 legs | `session1-...grep:186,189` | w2 0.000006, w5 0.000007 — **clean** |
| L-gpu alone | `session1-...grep:116-119` | 0.0913, 0.0663, 0.0449, 0.0760 → FAIL 0.069 |
| rep / gc / cg / nofuse | `session2-...grep:2-25` | 0.177 (diverged), 0.111/0.035, 0.133/0.023, 0.089/0.066/0.030/0.034 |
| ng / xmem0 / q6plain / ngng | `session2-...grep:28-51` | 0.087 (diverged), 0.0955…, 0.137…, 0.144/0.030 |

Three shapes in that table are load-bearing for the hypotheses:
- **First GPU window of a run is the worst**, the second is 3-5x smaller (`gc` 0.111→0.035, `cg` 0.133→0.023,
  `ngng` 0.144→0.030, `xmem0` 0.0955→0.0641→0.0392). A per-token weight-read error must be near-constant across windows
  of the same run (every token reads every weight), so this *decay* needs a run-state mechanism, not a constant one.
  Caveat: after an argmax divergence the later rows are not comparable (`kl_diverged`; `compared=24/36` in `rep`/`ng`),
  but the clean-divergence runs (`nofuse`, `xmem0`, `q6plain`) show the same decay with `diverged=0`.
- **The one clean run had the GPU windows after two other legs had run** (rotation order cpu,npu,gpu,...).
- Outcome is not a function of what precedes the window: `cg` (cpu window first, `kld` clean 0.000013) still fails in the
  GPU window (0.133), while session1's rotation (cpu and npu windows first) was clean.

## 1. Which imported-buffer reads the GPU leg performs, and which of them J(1) never exercises

Buffer placement for this model is in the load log (`session1-...grep:226`):
`shared weights: TILE32 1369571328 HOST 230420480 CPU 0 bytes` → *all* weights are in TILE32 or HOST-W, none on the CPU.
The model is LFM2.5-2.6B QAD-Q4_0 (`docs/ALIVE.md:140`), self-check names on device show
`attn_{q,k,v,output}`, `ffn_{gate,up,down}`, `shortconv.{in,out}_proj` in TILE32 and `token_embd.weight` (Q6_K) in HOST-W.

| # | op | weight source buffer | kernel | how the buffer is addressed |
|---|---|---|---|---|
| 1 | `MUL_MAT` Q4_0 decode mat-vec | HTP0-TILE32 (2 blocks: 867635200 B, 501944320 B; `session1-...grep:230-231`) | `kernel_mul_mat_q4_0_f32_tiled_v4` (`ggml-opencl-tile32-matvec.cpp:63`) | `{v->wq, v->ws}` = `CL_MEM_OBJECT_IMAGE1D_BUFFER` (RGBA/UINT32 and RGBA/HALF_FLOAT) over `v->sub`, a `clCreateSubBuffer` of the **imported** `imp->buf`, `poff` pixel offset; activation is the *OpenCL-owned* `src1` (`ggml-opencl.cpp:25764-25767`) |
| 2 | `MUL_MAT` Q6_K lm_head (tied `output`/`token_embd`) | HTP0-HOST-W | `kernel_mul_mv_q6_K_f32_aos` or plain `kernel_mul_mv_q6_K_f32` (`ggml-opencl-tile32-host-q6k.cpp:128-166` plan) | flat `{extra0h.data_device = imp->buf, extra0h.offset}` — no sub-buffer, no image (`ggml-opencl.cpp:25804`) |
| 3 | `MUL` f32 norm weight (unfused) | HTP0-HOST-W | `kernel_mul_row` (broadcast row) or `kernel_mul` (`ggml-opencl.cpp:16212-16226`) | `{imp->buf, off}` from `ggml_opencl_host_extra` (`ggml-opencl.cpp:16190-16199`) |
| 4 | fused norm family `MUL`/`MUL+ADD` | HTP0-HOST-W | `kernel_rms_norm_mul`, `kernel_rms_norm_mul_add`, `kernel_norm_mul_add`, `kernel_group_norm_mul_add` (`ggml-opencl.cpp:17462`, `:17546`, `:17627`, `:9242`) | `ggml_opencl_fused_src` → `{imp->buf, host->offset}` (`ggml-opencl.cpp:9070-9078`, used e.g. `:9218-9223`) |
| 5 | `SSM_CONV` (LFM2 shortconv) f32 weight | HTP0-HOST-W | `kernel_ssm_conv_f32_f32` / `_4` (`ggml-opencl.cpp:16884-16888`) | `{imp->buf, off}` for src1 (`ggml-opencl.cpp:16856-16872`) |
| 6 | everything else in the decode graph | **not imported** | attention/softmax/rope/GLU/etc. | OpenCL-owned pool buffers; the KV cache and the recurrent/conv state are the leg's own device buffers (`llama-governor-legs.cpp:160` `llama_context * ctx = llama_init_from_model_with_legs(model, spec.params, devices)`, and legs may not alias KV: `:105-108` `"governor legs must have independent KV caches"`) |
| 7 | input role `GET_ROWS` on `token_embd` | HOST-W read **by the CPU**, not by OpenCL | — | `src/llama-model.cpp:1194-1201`: the HOST buft is paired with the CPU device in the input-role list on purpose |

Admission for 2/3/4/5 is one predicate: `ggml_opencl_host_op_ok` — `MUL_MAT` only for `w->type == GGML_TYPE_Q6_K`
(`ggml-opencl-tile32-host.cpp:129`), `MUL` for an f32 broadcast row (`:137`), `SSM_CONV` weight in src1 (`:153`).

What the **NPU leg (J(1)) does not exercise**: J(1) is `{HTP0, GPUOpenCL}` with HTP0 first
(`tools/governor-bench/governor-bench-run.cpp:182-195`, `npu_list[] = {npu, gpu, nullptr}`), so the HTP takes every op it
supports and OpenCL serves only the op the HTP refuses. The codebase says exactly which one
(`src/llama-governor-legs.cpp:47-49`):

> `// The weight's own device is skipped on purpose: in the J(1) configuration the`
> `// HTP refuses exactly this op (the flat Q6_K host weight) and OpenCL serves it,`

So **J(1) exercises row 2 only** (and even there: one tensor, `token_embd`). Rows **1 (TILE32 v4), 3, 4, 5 are never
exercised on OpenCL by the NPU leg** — the HTP computes the TILE32 mat-vecs, the norms and the conv from the same bytes
with its own kernels. The task brief's reading ("its lm_head runs on the GPU via J(1) - so the imported Q6_K output
read by OpenCL is fine") is therefore correct as far as it goes, and it does not extend to rows 1/3/4/5.

**Verdict: CONFIRMED** (source-level; rows 1/3/4/5 are the GPU leg's unshared surface). Note the one soft spot: this is
read from `supports_op` semantics, not from a run — E0 below turns it into a measurement.

## 2. How the imports are created, what is device-dependent, and the ranked hypotheses

`import_locked` (`ggml-opencl-tile32.cpp:90-165`) is the whole import path. Exact text:

- `:137` `const bool host_route = ggml_backend_buffer_is_host(buffer);`
- `:138` `const cl_uint policies[2] = { uncached ? POLICY_UNCACHED : POLICY_IOCOHERENT, POLICY_WRITEBACK };`
- `:140` `const int n_policies  = (uncached || host_route) ? 1 : 2;`
- `:142` `const cl_mem_flags flags = CL_MEM_READ_ONLY | CL_MEM_USE_HOST_PTR | (cl_mem_flags) (1 << 29) /* CL_MEM_EXT_HOST_PTR_QCOM */;`
- `:145-148` `for (int p = 0; p < n_policies && !imp.buf; p++) {` / `qcom_ext_host_ptr hp = { 0x411D, policies[p], imp.fd, imp.base };` /
  `policy = names[p];` / `imp.buf = clCreateBuffer(env->context, flags, imp.size, &hp, &err);`
- `:161-162` `GGML_LOG_INFO("ggml-opencl-tile32: imported %s buffer of %zu bytes (fd %d, %s)\n", ... imp.fd, policy);`

Three facts fall out of those lines, and they drive the ranking:

1. **The "io-coherent" in the log is our own label, not the driver's answer.** `policy = names[p]` is assigned *before*
   the create and printed on success, whatever the driver did with `0x40A9`. Both phones print it
   (`session1-...grep:228-231`: HOST-W fd 25, TILE32 fd 26/27, all `io-coherent`; S23 `step4b-s23/raw/session5-9eb7c54c7.grep:9-11`, same).
   `POLICY_IOCOHERENT = 0x40A9` is the litigated constant (`:43-45`).
2. **Only TILE32 keeps a fallback.** `n_policies = 1` for HOST-W, so a refused io-coherent mapping is not silently
   downgraded — but a *granted* one that behaves like write-back is undetectable from here.
3. The policy is chosen from `sbuf->uncached()` (`ggml-hexagon.cpp:8536` `*uncached = sbuf->uncached();`), which is
   derived from the rpcmem flags at allocation (`ggml-hexagon.cpp:654`
   `this->uncached = (flags & RPCMEM_DEFAULT_FLAGS) == 0;`), which default to **cached**
   (`ggml-hexagon.cpp:2327` and `:2398`: `opt_hostbuf_uncached ? RPCMEM_FLAG_UNCACHED : RPCMEM_DEFAULT_FLAGS`).
   With the campaign env (`GGML_HEXAGON_HOSTBUF_UNCACHED` unset) both phones import **cached** memory as io-coherent.

Alignment/offsets are checked, not assumed, and the checks are the power-of-two assert quoted in F2 of the prior audit:
`:175` / `:254` `if (toff % 16 != 0 || toff > imp->size || tbytes > imp->size - toff)`, `:197`
`const size_t align = std::max(std::max(env->mem_base_align, env->image_base_align), (size_t) 16);`, `:199`
`const size_t base_off = toff & ~(align - 1);`. Image widths are bounded by `CL_DEVICE_IMAGE_MAX_BUFFER_SIZE` (`:202`).
A sub-buffer plus image is rebuilt per tensor and cached in the import map keyed by buffer pointer + fd + base + size
(`:98-104`), and per tensor keyed by `toff`/`ne`/`nb` (`:174-190`, `:256-266`).

**Ranked hypotheses.** Each with the reading that supports it and the observation that would kill it.

### H-A (PLAUSIBLE, and my leading alternative) — the v4 path's *unvalidated run-time objects*: the activation image and the dst sub-buffer
`ggml_cl_mul_mat_tile32` builds both of them per call, over *pool* memory whose offset varies with the allocation
pattern (`ggml-opencl-tile32-matvec.cpp:123-137`):
`const cl_buffer_region xregion = { (size_t) src1_off, (size_t) K * sizeof(float) };` … `cl_mem xsub = clCreateSubBuffer(src1_buf, 0, CL_BUFFER_CREATE_TYPE_REGION, &xregion, &err);` … `cl_mem dsub = xsub ? clCreateSubBuffer(dst_buf, 0, CL_BUFFER_CREATE_TYPE_REGION, &dregion, &err) : nullptr;` … `d.buffer = xsub;` `cl_mem ximg = clCreateImage(env->context, CL_MEM_READ_ONLY, &f, &d, nullptr, &err);`.
Neither object is exercised by any self-check:
- the TILE32 self-check builds its *own* activation buffer at offset 0 and an image over the **whole** buffer
  (`ggml-opencl-tile32-gate.cpp:153-165`: `cl_mem xb = clCreateBuffer(env->context, CL_MEM_READ_ONLY | CL_MEM_COPY_HOST_PTR,` … `d.buffer = xb;` … `cl_mem xi = clCreateImage(env->context, CL_MEM_READ_ONLY, &f, &d, nullptr, &err);`) and writes to a fresh `db`, never to the pool;
- the views canary uses `const cl_buffer_region region = { 0, 256 };` (`ggml-opencl-tile32-gate.cpp:41`) — also origin 0;
- the weight-side *sub-buffer with non-zero origin* **is** exercised (`views_locked` regions start at `base_off`, and the
  self-check reads through `v->wq`), so a blanket "images over sub-buffers are broken" is refuted; the hypothesis is
  specifically the *activation/dst* objects whose origin is a pool offset (and, for the dst, whose image is never checked).
Why it fits the data: a driver defect in that route would be layout-dependent (hence nondeterministic run to run and
absent in session1's rotation), would sit only in the v4 path (untouched by all three "off" switches that failed to help),
and would show the largest error in the first window (cold pool, buffers allocated/first-faulted in that window).
What would refute it: the same failure with the activation and dst objects built the way the self-check builds them
(offset-0 whole-buffer images), or a read-back showing the pool *parent* at `dst_off` holds exactly the v4 result
(the misplacement detector in E5), or HOSTBUF_UNCACHED changing the outcome while the layout does not.

### H-B (PLAUSIBLE, tied) — CPU/GPU coherence of the cached rpcmem block on the E031.45 driver
The one *device-dependent* variable in the read path. The prior audit already frames the risk
(`audit-unmeasured-override-n2.md` F3 quotes `ggml-opencl-tile32.cpp:293-295`
`if (w->type != GGML_TYPE_Q6_K) {` / `v->check_ok = true;` / `return true;` and `:282-283`
`// Only Q6_K is checked: the f32 MUL/SSM_CONV weights read straight through with no packing` /
`// step, so the coherent-only policy in import_locked is what guards those bytes.`),
and the fabric's own comment says the flush is opt-in and off
(`ggml-hexagon.cpp:2186` `if (opt_hostbuf_flush) {` … `DMA_BUF_SYNC_START | DMA_BUF_SYNC_WRITE` … `:2197` `DMA_BUF_SYNC_END`),
i.e. **the loader writes the shared blocks and never syncs the dma-buf** in this campaign.
Why it fits: nondeterminism from cache timing; device-specific because the policy is honoured by the driver, not by the API.
Why it is *not* my first choice: 167 TILE32 self-checks compare the GPU's read through the import against the CPU's read of
the *same pointer* at full M rows with a `1e-5 * rms` bound (`ggml-opencl-tile32-gate.cpp:196` `ok = rms > 0.0 ? maxd <= 1e-5 * rms : maxd == 0.0;`), and they pass
(the PLAN entry's `167 self-checks PASS`). Any systematic mapping/policy error should have failed at least one of them at
admission time; what
survives is a *time-varying* incoherence (right during admission, wrong later), which needs an extra mechanism
(post-load eviction, a DSP-triggered invalidate at the prefill's first `fastrpc_mmap`) — each of which the same experiment tests.
What would refute it: `GGML_HEXAGON_HOSTBUF_UNCACHED=1` (no CPU cache involved anywhere) leaving the KL dirty across 5 runs,
or a per-window GPU-vs-CPU read-back (E5) finding no divergence in a failing window.

### H-C (PLAUSIBLE, lower) — the HOST-W f32 families (F3) are read wrong in *content*
Rows 3/4/5 above. Kept alive because they are the only GPU-leg reads with no numeric evidence at all, and because a wrong
norm weight multiplies the whole residual stream, which matches the magnitude (KL 0.05-0.18, max 0.2-1.3) better than a
wrong Q4_0 tile would. The `nofuse` run cuts this down, and it is worth stating exactly how far: with fusion off the norm
weight is read by `kernel_mul_row` instead of `kernel_rms_norm_mul*`, and the run still fails — so either both kernels are
wrong on the 750 (unlikely as a compiler story: two unrelated kernels) or the *bytes/offset* are wrong, which collapses
H-C into H-B. Refuted by: OPFILTER `MUL` (E2b) leaving the KL dirty; or a per-tensor check of a norm weight that passes
while the leg still fails.

### H-D (REFUTED as sole causes) — the three switches that changed nothing
`raw/session2-...grep:34-45`: `xmem0` `kld ... mean=0.063510 status=FAIL` (`GGML_OPENCL_ADRENO_XMEM_GEMM=0`,
knob at `ggml-opencl.cpp:7389-7391`), `q6plain` `mean=0.069342 status=FAIL` (`GGML_OPENCL_HOST_Q6K_PLAIN=1`,
`ggml-opencl-tile32-host-q6k.cpp:102`), `nofuse` `mean=0.054559 status=FAIL` (`GGML_OPENCL_DISABLE_FUSION`,
`ggml-opencl.cpp:7491`). **Verdict: the xmem prepack, the AoS Q6_K arm, and the norm-family fusions are each refuted as
the *cause***; the plain Q6_K kernel failing too refutes "the AoS kernel miscompiles".

### H-E (REFUTED) — alignment, image width, padding past a tensor's end, OOB tile reads/writes
- `GGML_ASSERT((align & (align - 1)) == 0)` passed on the 750, and every tensor offset is 16-byte checked (`ggml-opencl-tile32.cpp:175`);
- the TILE32 packer *writes* the padding rows (`ggml-q4_0-tile32.h:88`: `memset(tile_quants[row], 8, GGML_Q4_0_TILE32_K);` and the scale loop `:98-103`) and the kernel's comment says so (`kernels/mul_mv_q4_0_f32_tiled_v4.cl:107` `// padding rows carry quant 8 (real value 0) and scale 0.`);
- the v4 store is guarded per element: `kernels/mul_mv_q4_0_f32_tiled_v4.cl:126-141` `if (rt * 32 + 16 * j + 0 < M) { out[0] = t0.x; }` …, so no write past the dst sub-buffer;
- the image bound is checked before creating anything (`ggml-opencl-tile32.cpp:202`).
**Verdict REFUTED** for all four; they cannot produce a 0.05-0.18 KL, only a fault or a hard failure.

### H-F (REFUTED) — "something writes the imported block after load"
See §3. There is no writer: no CPU write after the load path, no DSP write to weights (the weight families in one-copy mode
are TILE32/HOST-W only, and the model loader *reuses* the tied tensor instead of writing it twice,
`src/llama-model-loader.cpp:1407-1420` `// shared mode: the duplicate would be a second copy of the weight in flight; reuse the` …
`LLAMA_LOG_INFO("shared weights: %s reused for %s from %s\n", ...)`), and the OpenCL leg aborts on a host dst
(`ggml-opencl.cpp:10020-10026` `GGML_ABORT("ggml-opencl: %s is in host buffer %s (usage %d, size %zu), the leg addresses admitted HOST-W weights only",`).

### H-G (REFUTED) — the S23 as the explanation, or the MoE/SoA machinery
The S23 passes the same code with the same policy string and the same import fds class, so the defect is not in the
one-copy *design* — it is device- or driver-specific (SM8550/E031.41 vs SM8650/E031.45). Separately, LFM2.5-2.6B is dense:
the MoE repack/oracle knobs (`GGML_OPENCL_HOST_REPACK`, `GGML_OPENCL_ORACLE`, `GGML_OPENCL_GEMV_AUDIT`) have no snapshots to
fill here, so they are not usable as instruments without new code.

### H-H (REFUTED) — the prefill→decode KV commit injects the error
Session1's L rotation performed a commit at every one of 7 hops, including a
`prefill-to-decode` commit and a full-sequence commit into the first GPU leg, and every window stayed ≤ 4e-5
(`session1-...grep:196` `kld ... status=PASS`, and the two GPU rows `:186`/`:189`). The CPU-leg-alone run also receives
that commit and is clean (`session1-...grep:220` `mean=0.000012 ... status=PASS`). **Verdict REFUTED.**
(Two caveats worth recording: the `leg_total ... commit_bytes=0` line is *decode-hop* accounting only —
`tools/governor-bench/governor-bench-run.cpp:547-551` prints `hops`/`hop_bytes` from `decode_hop_commit_bytes`, so a
leg-alone run's `commit_bytes=0` says nothing about the prefill→decode commit; and `--legs` does not redirect the prefill,
which always targets the NPU leg when one exists — `src/llama-governor-legs.cpp:300-311`.)

## 3. Is any imported buffer written after load?

No, and the writers are enumerable:

- **Load (CPU)**: TILE32 via `ggml_backend_hexagon_tile32_buffer_set_tensor` → `ggml_q4_0_tile32_pack` (`ggml-hexagon.cpp:2233-2258`); HOST-W via `ggml_backend_hexagon_host_buffer_set_tensor` → `memcpy` (`:2186-2202`).
  HOST-W gets a dma-buf sync only when `opt_hostbuf_flush` (`:2187`, default false at `:8776`); **TILE32 gets no sync at all** — an asymmetry worth knowing for the experiment ladder (FLUSH tests HOST-W only).
- **No second weight write**: the tied `output` reuses `token_embd`'s tensor (`src/llama-model-loader.cpp:1417`), and `audit_shared_weight_buffers` would *throw* if a weight landed anywhere else (`src/llama-model.cpp:1629-1638`); the run prints `CPU 0 bytes`.
- **NPU**: only the generic `set_tensor` family writes weights (`ggml-hexagon.cpp:1896-1935`) at load; the compute path never writes a weight buffer, and the DSP-side repack (`needs_repack`, `:854-857`) belongs to the *device* buft, which holds no weight here.
- **GPU**: the imported cl_mems are created `CL_MEM_READ_ONLY` (`ggml-opencl-tile32.cpp:142`); the weight slot is never a dst on rows 1-5 (every compute path asserts or aborts on a host dst, `ggml-opencl-tile32-matvec.cpp:97-103` `GGML_ABORT("ggml-opencl-tile32: activation %s is in host buffer %s, the leg needs an OpenCL buffer",` and `ggml-opencl.cpp:25759` / `:25789` `ggml_opencl_reject_foreign_host(dst);`).
- **The one whole-buffer writer** is `ggml_backend_hexagon_buffer_clear`, which memsets the entire buffer
  (`ggml-hexagon.cpp:2162` `memset(sbuf->base(), value, sbuf->size());`, guarded by a skip on a DSP error at `:2151-2161`
  whose comment says `// clear() runs on every context shift`). It is registered in the HOST and TILE32 buft interfaces.
  If a context shift ever reached a *weights* buffer this would zero the model (a loud, total failure, not 0.09 KL) — so I
  read it as compute/state buffers only, but this is the one path that deserves a grep in the full log
  (`clear-buff` needs `GGML_HEXAGON_VERBOSE=1`, `ggml-hexagon.cpp:2161`).

**Verdict: CONFIRMED that the imported bytes are read-only after load in the current code.** A race therefore needs an
agent *outside* these buffers' writers — which is exactly what points at mapping/cache state (H-B) or at the unvalidated
per-call objects (H-A), not at a plain "someone overwrote the weights".

## 4. Experiments, cheapest first, existing knobs where possible

Run every arm **3-5×** (when 2 of 3 runs fail you have a signal, not a gate), plugged for correctness (as the earlier
Xiaomi sessions were; no speed claims while charging), skin watchdog at 43-44 °C, `input keyevent 224` before each run,
and **keep full logs** this time (the current `.grep` files are lossy, §0). Command shape, from
`run-xiaomi-correctness.sh:16-37`:

```
R=/data/local/tmp/govhtp-xiaomi; M=$R/model/ship.gguf; B=$R/bin/governor-bench
shared() { env GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_HOSTBUF_REPACK=1 GGML_HEXAGON_MBUF=832 \
    GGML_OP_OFFLOAD_MIN_BATCH=1 GGML_HEXAGON_ADMIT_OPS=7 GGML_OPENCL_TILE32_UNMEASURED=1 "$@"; }
# per arm, name=<tag>, extra env in front:
shared env <EXTRA> $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 128 --legs gpu \
  --logits-ref $R/twocopy.gbl --kld-max 0.01 -v > $R/n2_<tag>_<rep>.log 2>&1
# and grep afterwards: 'TILE32 leg disabled|device alloc failed|mem base addr align|self-check|^leg_window|^kld|GGML_OPENCL_LOG_KERNELS'
```

**E0 — free, non-perturbing, do it first.** `<EXTRA> = GGML_OPENCL_LOG_KERNELS=1 GGML_OPENCL_LOG_ALLOC=1 GGML_HEXAGON_VERBOSE=1`,
one run `--legs gpu`, one `--legs npu`. Reads out: (a) the exact kernel list per leg — this *measures* Q1 instead of
inferring it, and the critical question is whether the NPU leg ever dispatches `kernel_mul_mat_q4_0_f32_tiled_v4` or the
norm kernels; (b) `clCreateBuffer` failures/fallbacks (`ggml-opencl.cpp:11544`); (c) `"TILE32 leg disabled: ..."`;
(d) the 750's two alignment figures (`ggml-opencl.cpp:7358`); (e) `clear-buff` lines if any buffer type is being cleared.
Also run one `--legs gpu` with **all** the current env exactly as the failing campaigns had it, to confirm the failure
reproduces on the day (a negative control: if this is clean, every later negative result is uninterpretable).

**E1 — coherence vs content, the two Hexagon knobs (each 5× vs the 5 control runs of E0):**
- `E1a <EXTRA> = GGML_HEXAGON_HOSTBUF_FLUSH=1` — writes back the loader's HOST-W lines at load (`ggml-hexagon.cpp:2187-2202`),
  TILE32 untouched.
  *Clean* → dirty HOST-W lines are the mechanism, and it is the *HOST-W* families (rows 2/3/4/5) that suffer.
  *Dirty* → HOST-W coherence at load is not it; TILE32 coherence is still open (FLUSH does not cover TILE32).
- `E1b <EXTRA> = GGML_HEXAGON_HOSTBUF_UNCACHED=1` — all three shared blocks uncached, import forced to `POLICY_UNCACHED`
  (`ggml-opencl-tile32.cpp:138-140`, `ggml-hexagon.cpp:2327` and `:2398`). Slower on the CPU side, which is fine.
  *Clean* → H-B confirmed for the whole one-copy surface; *dirty across 5 runs* → **H-B refuted**, everything moves to H-A
  and to content/driver-object hypotheses. This is the single most informative existing-knob experiment.
- Do **not** set both: with UNCACHED the sync ioctls are no-ops.

**E2 — which family, using the existing op filter** (`ggml-opencl.cpp:7235-7238`, full-match, case-insensitive, per device):
- `E2ctr <EXTRA> = GGML_OPENCL_OPFILTER=ZZZ_NOMATCH` — mandatory control: it proves the filter machinery itself does not
  change the outcome. If this arm is clean while E0's control is dirty, the filter mechanism perturbs placement and every
  E2 result below is void.
- `E2a <EXTRA> = GGML_OPENCL_OPFILTER=MUL` — every f32 norm-weight `MUL` leaves OpenCL (matches `MUL_MAT` not at all).
  *Clean* → rows 3/4 (the F3 families) carry the defect. *Dirty* → H-C is dead as stated; note the norm may also be read
  by the fused kernels, so pair with `DISABLE_FUSION` in one extra arm for completeness.
- `E2b <EXTRA> = GGML_OPENCL_OPFILTER=MUL_MAT` — both mat-vecs leave OpenCL (the CPU/HTP read the same TILE32/HOST-W bytes
  natively; the CPU leg proves they can). *Clean* → the defect is inside the two imported mat-vec dispatch paths (v4 or
  Q6_K); *dirty* → the defect is in the norm/conv/attention surface or outside the weights entirely, and the v4 path loses
  its position (which is the cheapest way to kill H-A).
- `E2c <EXTRA> = GGML_OPENCL_OPFILTER=SSM_CONV` only if E2b was dirty.

**E3 — first-window vs steady state (no knobs):** `--legs cpu,cpu,gpu` vs `--legs gpu` with `--gen 128` vs `--gen 256`
(the decay pattern in §0 predicts the *first* GPU window is worst in both). Outcome that would matter: if the error is
*absent* when the GPU window is not the first window after the prefill, H-B and H-A both need a prefill-adjacent
mechanism; if it is present regardless, both need a run-time mechanism. Cheap; mostly serves to pin the "first window is
worst" reading with more runs, which is the only quantitative shape we have.

**E4 — ordering/async (one-line lab knob, do not write it yet):** in `ggml_backend_opencl_graph_compute`
(`ggml-opencl.cpp:9294-9300`, right after `sync_with_other_backends(backend);`) gate a `CL_CHECK(clFinish(backend_ctx->queue));`
behind a new env. Outcome: *clean with per-op clFinish* → an ordering/async defect on the 750 (in-order queue not honoured,
or a missing dependency); *still dirty* → a memory-content or driver-object defect, which is H-A/H-B territory.
This is the cheapest knob that separates "the read is wrong" from "the read is late".

**E5 — the one measurement that settles H-A vs H-B (2 small lab additions, name them, do not write them):**
1. **GPU-vs-CPU view of the imported bytes.** In `ggml_opencl_tile32_views_locked` / `ggml_opencl_host_view`
   (`ggml-opencl-tile32.cpp:244`, `:364`) add an env-gated
   `clEnqueueReadBuffer(queue, imp->buf, CL_TRUE, toff, N, tmp, 0, NULL, NULL)` + `memcmp(tmp, w->data + toff, N)` for a
   sample (say 4 KiB) signalled **once per decode window** (e.g. from `ggml_cl_mul_mat_tile32` for the first tensor of each
   window). This is the *in-vivo* version of the existing self-check. It settles H-B directly: any mismatch means the GPU
   is reading bytes the CPU does not have. Caveat to accept: the read-back itself is an observer (it can pull lines), so a
   *negative* result is weaker than a positive one — which is why E1b stays the primary H-B test.
2. **Misplaced sub-buffer write in the v4 path (H-A).** After the `v4 enqueue` in
   `ggml_cl_mul_mat_tile32` (`ggml-opencl-tile32-matvec.cpp:162-164`), read back **the parent buffer** at `dst_off` and the
   **sub-buffer** at 0 and compare. If the driver wrote the sub-buffer's contents at parent-relative offset 0 (a
   sub-buffer-origin defect), the two reads differ and the whole H-A family is confirmed in one run. Same probe for the
   activation image is harder (no host-side image read) — compare the parent at `src1_off` against the host copy the
   scheduler wrote, if one exists in that split.
Any H-A confirmation should then be reproduced on the 740 (S23) — a *clean* S23 with a dirty 750 on the same probe is the
device-specificity proof the whole report needs.

**If exactly one lab line is allowed, make it E5.1** — the GPU-vs-CPU read-back of the imported bytes
(`ggml-opencl-tile32.cpp:244` for HOST-W views, `:364` for the public entry point). It is the only instrument that turns
H-B into a measurement *inside* a failing run, and the same probe run with `N = 4 KiB` at a *norm* weight's offset gives
F3's families the self-check they never had — with no change to any kernel, dispatch or policy.

## Bottom line

- **CONFIRMED**: the GPU leg's imported reads are rows 1-5 of §1; J(1) exercises only row 2, so the passing NPU leg is
  evidence for the Q6_K read and for nothing else. The f32 norm/conv families and the TILE32 v4 path (images over
  pool-offset sub-buffers, dst sub-buffer) have no numeric guard at all.
- **CONFIRMED**: the imported bytes are not written after load by CPU, DSP or GPU in this code.
- **PLAUSIBLE (two candidates, not one)**: (H-A) an unvalidated run-time object in the v4 dispatch — the activation image
  and dst sub-buffer over pool offsets, unchecked by any self-check and layout-dependent, which matches both the
  nondeterminism and the "first GPU window worst, later windows better" decay; (H-B) CPU/GPU coherence of the cached
  rpcmem block on the E031.45 driver line, whose only guarantee today is our own log label `"io-coherent"`.
- **REFUTED**: xmem prepack, the AoS-vs-plain Q6_K arm, fusion, alignment/image-width/padding/OOB, a writer racing the
  reads, and the prefill→decode commit as the error source.
- Next action if only one thing is run: **E1b** (`GGML_HEXAGON_HOSTBUF_UNCACHED=1`, 5 runs vs 5 controls) plus **E0** for
  the kernel list and the alignment figures. If E1b stays dirty, H-B is dead and H-A becomes the working hypothesis, to be
  pinned by E5.2 on the failing run.
