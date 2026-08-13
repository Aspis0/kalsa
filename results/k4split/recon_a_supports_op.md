# N0 recon A — `ggml_opencl_supports_op` for MUL_MAT / MUL_MAT_ID (Q2_K/Q3_K vs Q4_K+)

Date: 2026-08-12
Scope: Mechanism A only (natural CPU leave-behind of KEXP routed experts via OpenCL
`supports_op`). Not a kernel note. No ggml-opencl / FLASH_ATTN / GEMV rewrite.
Every claim is from the tree at the paths below.

Sibling notes: `recon_b_session.md` (parent `-ngl`/`-ot` wiring), `recon_build.md`.

## Verdict (one paragraph)

Mechanism A **works in the fork** for KEXP. Routed `ffn_*_exps` are Q2_K (gate/up)
and Q3_K (down). OpenCL `ggml_opencl_supports_op` returns **false** for both
`MUL_MAT` and `MUL_MAT_ID` on those types. At load, `select_weight_buft` walks the
layer's GPU-first list, the dummy `MUL_MAT_ID` probe fails on OpenCL, and the
tensor is created in a CPU buffer. `-ngl 99` therefore offloads the trunk (Q5_K /
Q6_K `MUL_MAT` is supported; K2.2 dispatch fix is on the intended branch) while
experts stay host/mmap so `mul_mat_id` stays on CPU and the expert-ready hook
fires. A non-CPU `-ot …=OpenCL` **can force the Q2_K buffer onto OpenCL** (override
skips `supports_op`) but **cannot make OpenCL compute Q2_K** — the scheduler will
not assign `MUL_MAT_ID` Q2_K to GPU. Do not do that: it would upload the expert
bank into CL buffers and break the streamer's `tensor->data` rebind. No OpenCL
kernel change is required for A.

## Call chain

```
llama_model_load_from_file
  llama_model_base::load_tensors                          llama-model.cpp:1230
    n_gpu_layers = this->n_gpu_layers()                   :1236  (99 if -ngl 99)
    cpu_buft_list = make_cpu_buft_list(...)               :1246
    gpu_buft_list = GPU bufts + CPU fallback              :1248-1251
    i_gpu_start = max(n_layer_all+1-ngl, 0)               :1292
    get_layer_buft_list(il): GPU if il >= i_gpu_start     :1294-1304
    dev_input ALWAYS CPU                                  :1307-1308
    dev_layer[0..n_layer_all)                             :1311-1314
    dev_output = get_layer_buft_list(n_layer_all)         :1317
  qwen35moe::load_arch_tensors
    load_block_trunk(il, flags=0)                         qwen35moe.cpp:144-146
      ffn_gate_inp          MUL_MAT                       :98
      ffn_down_exps         MUL_MAT_ID {n_ff_exp, n_embd, n_expert}  :99
      create_tensor_gate_up_exps                          llama-model.cpp:2736-2741
        try fused ffn_gate_up_exps; else
        ffn_gate_exps / ffn_up_exps  {n_embd, n_ff, n_expert}
      shexp / attn / ssm / router                         qwen35moe.cpp:102-106
  llama_model_loader::create_tensor
    t_meta = get_tensor_meta(tn)  name = GGUF name        llama-model-loader.cpp:1260
    buft_for_tensor:
      info = llm_tensor_info_for(FFN_*_EXPS)
        LAYER_REPEATING + GGML_OP_MUL_MAT_ID              llama-arch.cpp:778-780
      if tensor_buft_overrides match:
        CPU  → select_weight_buft(..., buft_list_cpu)     :1170-1172
        else → buft = overrides->buft   **NO supports_op** :1179-1180
      else:
        buft = select_weight_buft(hparams, t_meta, op, buft_list)  :1193
  select_weight_buft                                      :1041-1051
    for each (dev, buft) in list (GPU first, then CPU):
      weight_buft_supported(...)
  weight_buft_supported  op==MUL_MAT_ID                   :933-940
    dummy b  = F32 [w->ne[0], n_expert_used, 512]
    dummy ids = I32 [n_expert_used, 512]
    op_tensor = ggml_mul_mat_id(ctx, w, b, ids)           src0 = t_meta (named)
    w->buffer = dummy alloc of this buft                  :1032
    ggml_backend_dev_supports_op(dev, op_tensor)          :1033
      → ggml_backend_opencl_device_supports_op            ggml-opencl.cpp:10250
        → ggml_opencl_supports_op                         :6584
  ggml_opencl_supports_op
    MUL_MAT     :6768-6791
    MUL_MAT_ID  :6792-6817
  load_all_data
    mmap + already-allocated GPU tensor:
      ggml_backend_tensor_set (copy into CL)              llama-model-loader.cpp:1571
    mmap leftover unmap only outside [first,last] used    :1679-1686
  graph decode
    build_moe_ffn → build_lora_mm_id → ggml_mul_mat_id    llama-graph.cpp:1418
    sched: ggml_backend_sched_backend_from_buffer
      requires supports_buft AND supports_op              ggml-backend.cpp:851-854
    CPU mul_mat_id expert loop:
      g_expert_ready_hook(src0, cur_a, ...)               ggml-cpu.c:1667-1668
      registered by ExpertStreamSource::enable_overlap_hook
                                                          expert_stream_source.cpp:1373-1376
```

KEXP facts used by this chain (file, not guessed):

| fact | source |
|---|---|
| arch `qwen35moe`, 40 layers, 256 experts, top-8 | `results/gguf_ud-iq2m_dump.txt:18-22`; campaign logs `n_layer_all=40` (`results/calaqwen_s23/b1/sos_short_r2/stderr.txt:107`) |
| `n_embd=2048`, `n_ff_exp=512` | dump `:20`, `:23`; `expert_feed_forward_length u32 = 512` |
| experts Q2_K gate/up, Q3_K down (120/0) | `reports/moe-requant-1c.md:16`; mandate 1c `:23-24` |
| dense same as IQ2_M: Q5_K=13 / Q6_K=14 | dump `token_embd` type 13; `ssm_out` type 14; `ggml.h:403-404` |
| KEXP sha `ac44e20c…` size 13416430592 | `reports/moe-requant-1c.md:4` |

`ne[1]` for the dummy/real expert weights: gate/up `512`, down `2048`. Both `% 32 == 0`.
If these tensors were Q4_K/Q5_K/Q6_K, `use_adreno_moe_kernels` would be **true**
(name contains `"ffn"` and `"exps"`). Type is what shuts them out, not the name/shape
heuristic.

## What already works

| piece | where | why it is enough for Mechanism A |
|---|---|---|
| Expert tensors classified `MUL_MAT_ID` | `llama-arch.cpp:778-780` | dummy probe is `_ID`, not `MUL_MAT` |
| Dummy `_ID` uses the **real** GGUF tensor as `src0` | `llama-model-loader.cpp:933-939` | name `blk.N.ffn_*_exps.weight` reaches the Adreno-MoE name check |
| GPU list falls back to CPU | `llama-model.cpp:1248-1251` | first failing GPU buft does not abort; CPU is next |
| `select_weight_buft` first match wins | `llama-model-loader.cpp:1041-1051` | OpenCL false → CPU true → CPU buft |
| Log when preferred buft is rejected | `llama-model-loader.cpp:1335-1338` | expect `n_tensors_moved` = all Q2_K/Q3_K experts under `-ngl 99` |
| `MUL_MAT` Q4_K/Q5_K/Q6_K supported (contig, F32 rhs) | `ggml-opencl.cpp:6780-6787` | trunk dense/attn/shexp/router/ssm_out can live on GPU |
| Q6_K large even-M no longer stolen from noshuffle | `ggml-opencl.cpp:6555-6581` (K2.2 @ `04c5d362a`) | 2B lm_head was Q6_K; 35B `token_embd` is **Q5_K** (type 13) and input stays CPU anyway |
| `MUL_MAT_ID` Q4_K/Q5_K/Q6_K Adreno-only + name/shape | `ggml-opencl.cpp:6802-6815` + `use_adreno_moe_kernels` `:6505-6508` | this is why a *Q4_K expert* model would **not** get A for free |
| `-cmoe` / `-ot` already exist | `common/arg.cpp:2466-2476`; regex `common.h:1054` | belt for A; see recon B |
| Streamer rebind assumes host `tensor->data` | `expert_stream_source.cpp:139, 163` | true iff experts were created in a CPU buft |
| Hook only on CPU `mul_mat_id` | `ggml-cpu.c:1667-1668`; K0 Q7 | A keeps that true |
| Parent today forces CPU-only load | `session.cpp:409-410` | `use_extra_bufts=false`, `n_gpu_layers=0` — A is vacuously true in campaign `bmoe-cli` because **nothing** is on GPU |

## What is hardcoded shut

### OpenCL `MUL_MAT` — no Q2_K / Q3_K

```6768:6791:BigMoeOnEdge/third_party/llama.cpp/ggml/src/ggml-opencl/ggml-opencl.cpp
        case GGML_OP_MUL_MAT:
            if (op->src[0]->type == GGML_TYPE_F16) { ... }
            else if (... Q1_0, Q4_0 ...) { ... }
            else if (op->src[0]->type == GGML_TYPE_Q4_1 ||
                     ... Q5_0/Q5_1/MXFP4/IQ4_NL ||
                     op->src[0]->type == GGML_TYPE_Q4_K  ||
                     op->src[0]->type == GGML_TYPE_Q5_K  ||
                     op->src[0]->type == GGML_TYPE_Q6_K) {
                return op->src[1]->type == GGML_TYPE_F32 && contig(src0) && contig(src1);
            } else if (Q8_0) { ... }
            return false;   // ← Q2_K and Q3_K land here
```

There is **no** `GGML_TYPE_Q2_K` / `Q3_K` arm. `return false`.

### OpenCL `MUL_MAT_ID` — no Q2_K / Q3_K

```6792:6817:BigMoeOnEdge/third_party/llama.cpp/ggml/src/ggml-opencl/ggml-opencl.cpp
        case GGML_OP_MUL_MAT_ID:
            // Q4_0 / Q8_0 / MXFP4: general (contig F32 rhs)
            // Q4_1 / Q5_0 / Q5_1 / Q4_K / Q5_K / Q6_K:
            //   only if GGML_OPENCL_USE_ADRENO_KERNELS
            //   && use_adreno_moe_kernels(src0)
            //   && contig
            return false;   // ← Q2_K and Q3_K, and Adreno-gate miss
```

`use_adreno_moe_kernels` (`ggml-opencl.cpp:6505-6508`):

```
((strstr(name,"ffn") && strstr(name,"exps")) || strstr(name,"as"))
&& (ne[1] % 32 == 0)
```

Never reached for Q2_K/Q3_K. Reached for Q4_K+ expert names on this model
(`ne[1]` 512 or 2048). **A Q4_K/Q5_K/Q6_K expert GGUF would be assigned to
OpenCL under `-ngl 99`.** That is G2 in K0, and it would skip the CPU hook.

### Dead compute residue (do not treat as support)

`ggml-opencl.cpp:19174-19178` groups `Q2_K`/`Q3_K`/`Q4_K` into
`kernel_mul_mv_q4_K_f32_flat`. Launch: Q2_K is lumped with Q4_0-style grid
(`:19477`); Q3_K hits `GGML_ASSERT(false && "not implemented")` (`:19493`).
This is unreachable while `supports_op` is false. It is **not** a Q2_K kernel.

### Parent engine shut (not OpenCL, but A never fires in campaign `bmoe-cli`)

`session.cpp:410` `mparams.n_gpu_layers = 0`. `bmoe-cli` has no `-ngl`.
See `recon_b_session.md`. The fork (`llama-cli -ngl 99 -fa off`) **can**
express A; the campaign engine cannot until parent wiring.

## Can a non-CPU `-ot` force Q2_K onto OpenCL?

**Buffer: YES. Compute: NO. Do not.**

`-ot pattern=OpenCL` (`common/arg.cpp:249-280`) stores
`{pattern, ggml_backend_dev_buffer_type(OpenCL)}`. Buffer type name is
`"OpenCL"` (`ggml-opencl.cpp:10088-10089`).

On match, `buft_for_tensor` does **not** call `select_weight_buft` /
`weight_buft_supported` (`llama-model-loader.cpp:1179-1180`). The expert
tensor is created in an OpenCL context. `load_all_data` then
`ggml_backend_tensor_set` (`:1571`). `set_tensor` has no Q2_K convert;
the default path is a raw `clEnqueueWriteBuffer` (`ggml-opencl.cpp:8926-8931`).
Upload of the **entire** expert bank into CL buffers would succeed as bytes
(until RAM dies).

Compute still fails:

1. `ggml_opencl_supports_op` `MUL_MAT_ID` Q2_K → false.
2. Scheduler `ggml_backend_sched_backend_from_buffer` requires
   `supports_buft && supports_op` (`ggml-backend.cpp:851-854`). OpenCL fails
   the op. CPU does not `supports_buft` an OpenCL buffer. Returns `-1`
   ("weight will need to be copied", `:860-861`).
3. The `MUL_MAT_ID` node is not pre-allocated in the OpenCL buffer, so the
   `GGML_ABORT` at `:898` does not fire. The op is assigned to CPU; a
   synchronous host copy of `src0` is inserted (OpenCL has
   `.cpy_tensor_async = NULL`; K0 Q5).

Streamer then writes `tensor->data = slot/cache` (`expert_stream_source.cpp:139,163`)
while `tensor->extra` still names a CL buffer. Overlap hook keys on the
`ggml_tensor *` (`:274`). That is an untested, hostile combination: GPU-sized
expert residency + broken host rebind + CPU `mul_mat_id` after a copy.

**Answer:** `-ot ffn_.*_exps.*=OpenCL` can force Q2_K **storage** onto OpenCL.
It cannot force Q2_K **math** onto OpenCL. It would destroy the RAM budget and
the streamer invariant. Mechanism A does not need `-ot` for KEXP.

`-ot ffn_.*_exps.*=CPU` / `-cmoe` is the inverse (Mechanism B): belt if someone
later ships Q4_K+ experts or a backend that starts accepting Q2_K.

## RAM / double-residency risk (Mechanism A path)

A does **not** put experts on GPU. Expert RAM is the streamer cache
(`--cache-mb 2000`) + I/O bounce, same as CPU-only.

Trunk under `-ngl 99` **does** copy dense/attn/shexp/router/GDN weights into
OpenCL CL buffers (`load_all_data` `:1571`). Those bytes are still in the
process DRAM (Adreno SVM/CL on this phone). Mandate estimate ~1.75 GiB dense.

After GPU `tensor_set`, `mmaps_used` is **only** updated on the
`ggml_backend_tensor_alloc` mmap path (`:1567-1569`), **not** on `tensor_set`.
Unmap (`:1679-1686`) drops only `[0, first_cpu_mmap)` and
`(last_cpu_mmap, eof]`. Expert tensors stay CPU/mmap, so `[first,last]` spans
almost the whole GGUF. Dense pages **between** expert tensors stay mapped
**and** exist as CL copies → first double residency.

Then `--dense-weights anon` (`dense_weights.cpp:47-67`, rebind `:234`) walks
every captured non-expert GGUF tensor, allocates a new host buffer, fills it
(memcpy from leftover mmap or O_DIRECT), rebinds `tensor->data`. It does
**not** skip GPU-backed tensors. If `tensor->data` is the OpenCL dummy base
(`ggml-opencl.cpp:7398-7400` alignment cookie), `mmap_src_of` falls back to
file-offset VMA (`dense_weights.cpp:140-147`) and still copies. GPU `extra`
keeps the CL buffer; compute uses `extra`, not `tensor->data`. Anon copy is
dead RAM: **second** dense copy. `drop_mmap_copies` only drops the file map
(`:67`).

Net if someone turns on `-ngl 99` with campaign `--dense-weights anon` and no
skip: `dense_GPU + dense_anon + cache 2000 + KV` — RescueParty territory on 8 GB.
This is not a `supports_op` bug; it is the first placement/free patch (recon B
already names "dense-anon skip of GPU tensors").

Mechanism A itself does not add expert-GPU RAM.

## Smallest surface to change

For **A on KEXP, llama.cpp fork: nothing.** Do not touch
`ggml_opencl_supports_op`. Do not add Q2_K/Q3_K. Do not write GEMV/MoE kernels.

Required around A (parent / flags, not this file's kernel surface):

1. Parent: stop hardcoding `n_gpu_layers = 0`; plumb `-ngl` / `-fa off`
   (recon B). Without this, A is untestable in `bmoe-cli`.
2. Keep `use_extra_bufts = false` (streamer invariant).
3. Do **not** `--dense-weights anon` the tensors that `select_weight_buft`
   placed on OpenCL. Either skip those leaves in `set_dense_tensors` /
   `read_anonymous`, or add a `--dense-weights anon-gpu` that madvise's the
   mmap after `tensor_set` and does not allocate a host twin.
4. Optional belt (zero fork code): `-cmoe` or
   `-ot "\\.ffn_(up|down|gate)_exps=CPU"` so a future Q4_K expert file or a
   `supports_op` relaxation cannot steal experts.

If a later GGUF has Q4_K+ experts, A is **gone** and B is mandatory.

## Open questions

1. Confirm on a real `-ngl 99` load log (N1, `GGML_SCHED_DEBUG=2`) that
   `n_tensors_moved` equals the expert count (120 KEXP expert tensors) and
   that first moved type is Q2_K/Q3_K from `OpenCL` → `CPU`. Not measured
   tonight (no device).
2. KEXP has `n_layer_all=40` in campaign logs — no MTP block in this GGUF.
   Mandate text still says "40 trunk + output". Output is `il == n_layer_all`
   (`llama-model.cpp:1317`). Tied `token_embd` duplicate for lm_head is Q5_K;
   input embeddings stay CPU. Is the duplicated output head on GPU under
   `-ngl 99`? Yes, `TENSOR_DUPLICATED` remaps to `LLM_TENSOR_OUTPUT`
   (`llama-model-loader.cpp:1098-1100`) and uses `buft_list_output`.
3. After streamer rebind, `tensor->buffer` is still the original CPU backend
   buffer object while `tensor->data` points at slot/cache. That is the
   CPU-only status quo. Need N1 to prove the same after GPU trunk (experts
   must still be that CPU buffer type, not OpenCL).
4. `MUL_MAT_ID` Q4_K is independently broken on Adreno (K2.1/K2.2 residual).
   Irrelevant to KEXP A; fatal if someone requants experts to Q4_K and relies
   on GPU `mul_mat_id`.
5. Parent `bmoe-cli` Android campaign builds are `GGML_OPENCL=OFF`
   (`recon_build.md`). A GPU trunk needs an OpenCL `bmoe-cli`, not just A.

## BLOCKERS

**None for Mechanism A in the fork.** Q2_K/Q3_K `supports_op` is already false;
`select_weight_buft` already leaves those tensors on CPU under `-ngl 99`.

Not an A blocker, but N0/N1 cannot demonstrate the split with campaign
`bmoe-cli` until parent `-ngl` wiring exists (`session.cpp:410`). That is
**parent wiring**, not `BLOCKED_ARCH`. The fork can already express A via
`llama-cli -ngl 99 -fa off` (streaming/hook would be absent in that binary).

Do not mark `BLOCKED_ARCH` for "OpenCL cannot run Q2_K" — that refusal **is**
the design.
