# Host-W layer placement audit

**Target:** `kalsallama-gov-onecopy`, `feat/governor-onecopy`, commit `b7bd8bb13` over `6106d4997`  
**Scope:** hostile, read-only source audit. No build, device action, or test execution was performed.

## Findings

### 1. Active Hexagon filters can move Q4_0 weights out of TILE32

**Verdict: CONFIRMED · Severity: P2**  
**Location:** `src/llama-model.cpp:1717`

> `buft_list.emplace_back(cpu_dev, weight_host_buft);`

This candidate is appended after the device candidates, which is correct only while the device accepts the intended placement. The Hexagon placement probe calls `supports_op`, and Hexagon deliberately rejects an op matching its configured filter:

**Location:** `ggml/src/ggml-hexagon/ggml-hexagon.cpp:7942`

> `// reject ops that match the filter`  
> `if (opt_opfilter && std::regex_match(ggml_op_desc(op), *opt_opfilter)) {`  
> `    return false;`

With `GGML_HEXAGON_OPFILTER=.*` (used by the GPU-leg S23 environment) and no tensor override, the probe rejects Q4_0 `MUL_MAT` for TILE32, the HTP HOST-W candidate, and the HTP default buffer. The script sets this filter explicitly:

**Location:** `step4-s23/env.sh:18`

> `GGML_OP_OFFLOAD_MIN_BATCH=1 GGML_HEXAGON_ADMIT_OPS=7 GGML_HEXAGON_OPFILTER='.*' "$@"`

The newly appended CPU-paired HOST-W candidate then wins because the CPU supports the op. The OpenCL HOST leg does not accept Q4_0 `MUL_MAT`; its HOST matrix route is restricted to Q6_K:

**Location:** `ggml/src/ggml-opencl/ggml-opencl-tile32-host.cpp:129`

> `if (w->type != GGML_TYPE_Q6_K || w->ne[2] != 1 || w->ne[3] != 1) {`  
> `    return false;`

Those Q4_0 weights consequently miss both the HTP TILE32 path and the OpenCL HOST path and fall to CPU execution. The S23 campaign environment avoids this with its explicit Q4_0 `-ot` override; the list invariant in the commit comment is not generally true without that override. Any equivalent filter/admission setup that makes the placement probe reject TILE32 has the same shape of failure.

### 2. HOST-W is an unrestricted CPU fallback ahead of CPU extras

**Verdict: PLAUSIBLE · Severity: P2**  
**Location:** `src/llama-model.cpp:1717`

> `buft_list.emplace_back(cpu_dev, weight_host_buft);`  
> `buft_list.insert(buft_list.end(), pimpl->cpu_buft_list.begin(), pimpl->cpu_buft_list.end());`

There is no type- or op-specific guard on this entry. The probe tries it for every weight op selected by `llama-model-loader.cpp` (including `MUL`, `SSM_CONV`, `GET_ROWS`, `ADD`/`ADD_ID` bias, and `MUL_MAT`; see `src/llama-model-loader.cpp:1193` for bias op mapping and `:1198` for the default op). The device's own candidates remain first, so a Q6_K/F16 matrix accepted by the HTP default or its own earlier buffer is unchanged. But if all HTP candidates refuse it and CPU accepts it, HOST-W wins before the old CPU fallback list.

That ordering also preempts the optional CPU extras. `make_cpu_buft_list` places those after the device host buffer:

**Locations:** `src/llama-model.cpp:1122`, `:1134`, and `:1144`

> `// add extra buffer types`  
> `if (use_extra_bufts) {`  
> `buft_list.emplace_back(cpu_dev, *extra_bufts);`  
> `buft_list.emplace_back(dev, ggml_backend_dev_buffer_type(dev));`

The CPU registry includes `CPU_REPACK` when built with `GGML_USE_CPU_REPACK` (`ggml/src/ggml-cpu/ggml-cpu.cpp:66`). Thus, for a CPU-repack-eligible mixed-quant matrix that HTP declines, the new CPU-paired HOST-W candidate can win before that repack candidate. This is conditional on `use_extra_bufts` and the CPU repack build. In shared mode CPU_REPACK is itself rejected by the post-load shared-buffer audit because it is not host-backed (`src/llama-model.cpp:1578`), so this is not a regression from a previously successful shared-mode CPU_REPACK placement; it is still a likely CPU-performance loss versus the raw CPU fallback and can make HOST-W much larger than the intended norms/conv set.

The scheduler behavior is otherwise safe from an automatic copy: it tries `supports_op` plus `offload_op` for host weights, then lets CPU consume a host buffer directly when possible:

**Location:** `ggml/src/ggml-backend.cpp:993`

> `// Host bufts can be read directly by CPU; let devices opt in per op and batch.`  
> `SET_CAUSE(tensor, "1.host");`

Hexagon recognizes its own HOST-W in `supports_buft`, but raw quantized weights are admitted only for the narrow 2-D Q4_0 matmul case. OpenCL's HOST leg is also selective: norms (`MUL`), some `SSM_CONV`, and flat single-token Q6_K matmul are admitted; `ADD` bias and F16 matmul are not. Therefore a weight newly placed in HOST-W may still be CPU-computed. RPCMEM is CPU-readable and cached by default, so this is not inherently a copy or correctness failure; `GGML_HEXAGON_HOSTBUF_UNCACHED=1` makes CPU fallback reads a real bandwidth/performance concern, especially if the unrestricted fallback moves large weights.

### 3. The test does not cover either fallback hazard

**Verdict: CONFIRMED · Severity: P2**  
**Locations:** `tests/test-tile32-shared-weight-placement.cpp:9`, `:195`, `:196`, and `:231`

> `// The fixture is a metadata-only qwen3 GGUF (llama_model_init_from_user): every weight is f32`  
> `// unless a gguf entry overrides its type, so layer 0's attn_q matrix is Q4_0 and its attn/ffn`  
> `return w && w->buffer && w->view_src == nullptr && w->type == GGML_TYPE_Q4_0 && w->ne[0] % 32 == 0 &&`  
> `ggml_backend_buft_weight_layout(w->buffer->buft) == GGML_WEIGHT_LAYOUT_Q4_0_TILE32;`  
> `// Metadata only: llama_model_init_from_user creates every weight as f32 and takes the type of a`

The mock always accepts Q4_0 on TILE32 and rejects all other ops. It therefore cannot reproduce the active `OPFILTER=.*` case in finding 1, where the real HTP declines even the TILE32 Q4_0 probe. The fixture contains no Q6_K/F16 matrix and does not test CPU extras or repack placement. In addition, `llama_model_init_from_user` forces `params.use_extra_bufts = false` (`src/llama.cpp:456`), so this test cannot observe HOST-W preempting CPU_REPACK even if the machine running it has CPU repack enabled.

The test's scope is still coherent: its shared-mode, two-copy, and CPU-override assertions all inspect loader weight placement. Its 377-line size is mostly the self-contained mock and fixture; exceeding the stated approximate 350-line guideline is not itself a correctness finding. It does not call `setenv`/`unsetenv`; its `mock_shared_mode` global is process-local and reset by each `load_model` call. The commit's “three norm assertions fail on the parent” mutation claim is consistent with the diff, but I did not execute that mutation check.

### 4. Default HTP buffer cap can exceed the OpenCL import limit

**Verdict: PLAUSIBLE · Severity: P2**  
**Locations:** `ggml/src/ggml-hexagon/ggml-hexagon.cpp:100, 2357`; `ggml/src/ggml-alloc.c:1249`; `ggml/src/ggml-opencl/ggml-opencl-tile32.cpp:117`; `ggml/src/ggml-opencl/ggml-opencl-tile32-facts.cpp:57`

> `static size_t opt_mbuf = 1ul * 1024 * 1024 * 1024; // max buffer size`

> `return opt_mbuf;`

> `if (cur_buf_size > 0 && (cur_buf_size + this_size) > max_size) {`

> `// the import asks for the dma-buf block, not the ggml allocation: that is the size`  
> `if (need_bytes > facts->max_alloc_size) {`

> `if (!ggml_opencl_tile32_facts_ok(&env->facts, size, &why)) {`  
> `    *reason = why;`  
> `    return nullptr;`

HOST-W can now collect every CPU-accepted layer weight that falls through the HTP candidates, rather than only the small F32 weights intended by the comment. The allocator splits a buffer at `opt_mbuf` boundaries, but a single tensor larger than that limit can still form an oversized chunk. OpenCL checks and imports the *whole backing buffer*, not just the current tensor. With the default 1 GiB cap, a HOST-W chunk between the S23's approximately 884 MiB OpenCL max allocation and 1 GiB will fail import and disable OpenCL admission for eligible tensors sharing that chunk.

The full HOST-W total does not need to fit one OpenCL allocation: the allocator splits at the buft max size and the import map handles each backing buffer separately. The current step-4 S23 script sets `GGML_HEXAGON_MBUF=832` MiB (`step4-s23/env.sh:17`), below the stated ~884 MiB limit; splitting plus per-buffer imports makes the intended small norms/conv additions fit, and multiple imports are supported. I found no evidence that the configured target model's HOST-W chunk exceeds that cap. The risk is the unconfigured/default path and any oversized individual tensor, not a demonstrated failure in the 832 MiB campaign configuration. The loader's `audit_shared_weight_buffers` only totals host bytes; it does not check OpenCL's per-buffer import limit (`src/llama-model.cpp:1619` and `src/llama-model.cpp:1643`).

## Requested cross-checks with no additional finding

- **Ordering and non-Q4 matrices:** `make_gpu_buft_list` puts device extras before the device default (`src/llama-model.cpp:1239`); the new CPU-paired HOST-W entry follows all of those. So it does not steal a tensor accepted by TILE32, HTP HOST-W, or the HTP default. The defect is the unconditional fallback after those candidates fail, especially when an op filter changes the probe result.
- **Shared-mode detection:** removing the CPU fallback tail before calculating `ml.shared_weights` is equivalent for this boolean: the new code scans the GPU list and `cpu_buft_list` separately (`src/llama-model.cpp:1694`), which is the same `has_tile32(gpu) || has_tile32(cpu)` predicate as the old concatenated list. The subsequent HOST-W insertion does not affect that detection.
- **Input, output, `-ot`, mmap, and CPU-assigned layers:** factoring `shared_weights_host_buft` preserves the old input-list lookup. GPU-assigned repeating layers and output receive the appended list; CPU-assigned layers still point to `cpu_buft_list` (`src/llama-model.cpp:1760`). A CPU `-ot` override selects from `buft_list_cpu`; the new HOST-W entry is not in that list. Non-CPU overrides are direct. The mmap rewrite is identity-based (`src/llama-model-loader.cpp:1272`): HOST-W is a distinct object from `ggml_backend_dev_host_buffer_type`, so it correctly survives while HTP0-HOST is rewritten to CPU. `no_host` only suppresses the device host entry in the CPU fallback list; it does not suppress this separate weights-only buffer. The API describes `no_host` as bypassing the host buffer (`include/llama.h:353`), but the helper only applies it while building the CPU list; that narrower behavior is consistent with Amendment I's split roles.
- **NPU, OpenCL, KV, and output devices:** Hexagon `supports_buft` accepts its own HOST-W, while its offload predicate still gates execution per op (`ggml/src/ggml-hexagon/ggml-hexagon.cpp:8155`). OpenCL claims a host buft only when it is distinct from the device's compute/output host buft and has the dma-buf accessor (`ggml/src/ggml-opencl/ggml-opencl.cpp:15187`). The new entry changes weight storage, not `dev_layer`/`dev_output` device identities. KV placement still chooses `ggml_backend_dev_buffer_type(model.dev_layer(il))` (`src/llama-kv-cache.cpp:316`), and output/sampler allocation still follows `dev_output`; no KV buft change is introduced.
- **Comments and dead code:** `shared_weights_host_buft` is used for both input and layer/output list construction. I found no dead code in the diff. The comment that Q4_0 “still stops at TILE32” needs the qualification from finding 1: it holds only if the HTP placement probe accepts that op (or an explicit override fixes placement).
