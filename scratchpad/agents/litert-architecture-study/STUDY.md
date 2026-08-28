# LiteRT / LiteRT-LM: architecture study for the llama.cpp governor

Snapshot read locally, without modifying either checkout:

- LiteRT: `/Users/marco/Projects/litert-study/LiteRT`, commit `fa3db6be54aa536d73668346c620c557e49a7160`.
- LiteRT-LM: `/Users/marco/Projects/litert-study/LiteRT-LM`, commit `c73ae8a67fe3ddc2ddbfc377417558b2093eaa8d`.
- The two checkouts were clean at read time. Source URLs below are pinned to these commits.

The direct translation is: compile a stable execution plan once, bind stable memory handles once, run phase-specific plans, and keep KV ownership above the backend. LiteRT's default partitioner is execution-order segmentation; its connected-component algorithm is an alternative, not the default.

## 1. Partizionamento

### Contract and data structures

The compiler-plugin API returns a flat `std::vector<LiteRtOpWithPartitionIndex>`. Each selected op carries a partition index; unselected ops are absent. The core then chooses a grouping algorithm and outlines each resulting island as a new subgraph plus one dispatch custom op. This is the key contract, not a graph rewrite performed by the vendor plugin. See [`compiler_plugin.cc:510-549`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/compiler/plugin/compiler_plugin.cc#L510-L549) and [`algo.h:24-47`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/compiler/plugin/algo.h#L24-L47).

There are two strategies:

1. `GroupPartitions`: weakly connected components restricted to one partition index.
2. `GroupPartitionsV2`: consecutive selected runs in execution order, with unselected ops as barriers.

`PartitionSubgraph` selects V2 when the strategy option is the default; otherwise it calls the supplied strategy. It enforces the maximum number of partitions, creates a subgraph for every island, calls `OutlinePartition`, and records the dispatch op. [`compiler_plugin.cc:516-547`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/compiler/plugin/compiler_plugin.cc#L516-L547)

### Exact V2 algorithm (the default)

The implementation first maps each selected op pointer to its partition index. It computes `max_partition_index`; every unselected op receives the sentinel `max+1`. It then walks `subgraph->Ops()` in actual execution order, not by main-graph op index. This matters because composite/inlined operations may not have a main-subgraph index. A run starts when the selected partition index changes, is emitted when it changes again, and the sentinel is simply omitted. [`algo.cc:400-460`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/compiler/plugin/algo.cc#L400-L460)

Consequences:

- `A(selected, id=0) -> B(unselected) -> C(selected, id=0)` becomes two islands, despite the same vendor index.
- `A(id=0) -> B(id=1)` becomes two islands even if both are supported.
- The boundary is an execution-order boundary; tensor edges crossing it become dispatch inputs/outputs.
- The plugin does not get to assume that one partition index means one final subgraph.

This is a useful default for llama.cpp because it preserves the graph's order and makes a backend boundary explicit. It is not sufficient alone when an async backend needs a connected component or when a view/alias edge must be kept on one side.

### Exact connected-component algorithm (alternative)

`GroupPartitions` builds one union-find set per partition index. The implementation is `DisjointSets`, backed by `InsertOrderMap<LiteRtOp, LiteRtOp>`; union is by parent assignment, without rank/size. It first buckets selected ops by partition index, inserts every op as its own parent, then follows every output tensor's users. A def-use edge is unioned only when the user is present in the same partition-index bucket. [`algo.cc:42-52`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/compiler/plugin/algo.cc#L42-L52), [`algo.cc:98-147`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/compiler/plugin/algo.cc#L98-L147), [`algo.cc:150-181`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/compiler/plugin/algo.cc#L150-L181)

The result buckets are inverted from roots through an `unordered_map`; island order is therefore not the execution order. The source has a separate Kahn topological sort that restores an order inside a sliced subgraph and rejects a cycle. [`algo.cc:196-248`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/compiler/plugin/algo.cc#L196-L248)

### Boundary materialization

`GraphSlicer` keeps a tensor map and a dispatch op. For each island it:

- collects root input tensors;
- clones root inputs and the island ops into a new subgraph;
- reroutes non-constant tensors with an outside producer to dispatch inputs;
- reroutes tensors with outside users, or root outputs, to dispatch outputs;
- reuses the last original op's storage for the dispatch op;
- runs dead-code elimination and topological sort.

See [`algo.cc:255-325`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/compiler/plugin/algo.cc#L255-L325), especially the reroute rules in [`algo.cc:327-347`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/compiler/plugin/algo.cc#L327-L347). Constants are deliberately not turned into external ports when they have no defining op; they stay in the sliced graph.

The source-level outline operation is short and literal:

```cpp
return GraphSlicer(subgraph, partition).SlicePartitionFromGraph(new_subgraph);
```

[`algo.cc:474-477`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/compiler/plugin/algo.cc#L474-L477)

### Mapping to ggml

The llama.cpp equivalent of a compiler plugin should be a prepare-time backend planner, not a runtime callback. Given a `ggml_cgraph`, it should return, for each node:

```text
node_id -> {backend, supported, compiled_variant, partition_id,
            input tensor IDs, output tensor IDs, alias/view facts,
            memory kind, scratch bytes, completion/fence policy}
```

Recommended algorithm:

1. Walk the fixed execution order once.
2. For each op, query CPU/OpenCL/QNN support, including q2_K/q3_K shape, block layout, scale placement, alignment, and device capability.
3. Assign a phase-specific backend and a contiguous partition ID. Split on unsupported nodes, explicit synchronization requirements, alias hazards, or a governor policy boundary.
4. Build boundary records from tensor identity, not only shape. A view must carry base allocation, byte offset, strides, and lifetime.
5. Compile OpenCL programs/kernel variants and QNN/Hexagon graphs while preparing the plan. Store immutable dispatch records.

The “compiler plugin” in our fork is therefore the combination of a `ggml` capability/partition pass and backend-specific lowering. It should produce `cpu_segment`, `opencl_segment`, and `npu_segment` plan nodes with explicit input/output handles. It should not create a new QNN graph, run shape inference, or decide q2/q3 workgroup geometry on every token.

Use V2-style ordered runs as the default. Add a connected-component mode only when it materially reduces synchronization or when a backend requires a connected sub-DAG. If component grouping is used, sort the resulting islands back into graph order and preserve aliases explicitly; LiteRT's component result itself is not an execution-order contract.

## 2. Ciclo di vita del dispatch

### Creation and preparation

`CompiledModel::Create` initializes the model/runtime, registers dispatch allocation metadata and JIT handles, restores external CPU weights when CPU fallback is requested, then iterates accelerators in registration order. Each delegate modifies the graph once; the model errors if undelegated ops remain and CPU was not requested. [`compiled_model.cc:882-906`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/runtime/compiled_model.cc#L882-L906), [`compiled_model.cc:912-956`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/runtime/compiled_model.cc#L912-L956), [`compiled_model.cc:976-1094`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/runtime/compiled_model.cc#L976-L1094)

Plugin transform, partition, compile, and model-cache serialization are also initialization work. The cache path loads plugins before applying them and avoids model caching when JIT handles make the result non-reproducible. This belongs in plan construction, not in `decode()`. See [`compiled_model.cc:1281-1360`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/runtime/compiled_model.cc#L1281-L1360).

The dispatch delegate initializes the dispatch API, checks version/compatibility/capabilities, creates a device context, and only then creates per-node invocation contexts. `DispatchKernelFacade` intentionally defers concrete kernel selection until the context, parameters, and bytecode are known. [`dispatch_delegate.cc:67-151`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/runtime/dispatch/dispatch_delegate.cc#L67-L151), [`dispatch_kernel_facade.h:27-42`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/runtime/dispatch/dispatch_kernel_facade.h#L27-L42)

`DispatchDelegateKernel::Init` creates invocation contexts, assigns stable tensor IDs, identifies internal tensors, computes port connections, and obtains buffer requirements. `Prepare` is currently empty; the meaningful preparation is `Init` plus first-use allocation/registration. [`dispatch_delegate_kernel.cc:256-280`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/runtime/dispatch/dispatch_delegate_kernel.cc#L256-L280), [`dispatch_delegate_kernel.cc:323-429`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/runtime/dispatch/dispatch_delegate_kernel.cc#L323-L429)

### Attach, invoke, detach

At evaluation, the kernel first processes deferred unregistrations, allocates/registers missing I/O and intermediate buffers, and attaches only buffers whose `attached` flag is false. The attach operation is keyed by stable tensor ID and can attach one underlying handle to all node ports connected to that tensor. [`dispatch_delegate_kernel.cc:437-463`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/runtime/dispatch/dispatch_delegate_kernel.cc#L437-L463), [`dispatch_delegate_kernel.cc:976-1051`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/runtime/dispatch/dispatch_delegate_kernel.cc#L976-L1051), [`dispatch_delegate_kernel.cc:1095-1166`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/runtime/dispatch/dispatch_delegate_kernel.cc#L1095-L1166)

The important fast path is explicit in the source:

```cpp
if (tensor_info.attached) {
  continue;
}
...
tensor_info.attached = true;
```

[`dispatch_delegate_kernel.cc:1113-1163`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/runtime/dispatch/dispatch_delegate_kernel.cc#L1113-L1163)

On replacement, LiteRT duplicates the old output fence, defers the old buffer, registers the new one, and later waits non-blockingly for the fence before detaching/unregistering it. This protects asynchronous users and also handles runtimes that clear a port on detach. [`dispatch_delegate_kernel.cc:835-884`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/runtime/dispatch/dispatch_delegate_kernel.cc#L835-L884), [`dispatch_delegate_kernel.cc:886-974`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/runtime/dispatch/dispatch_delegate_kernel.cc#L886-L974)

Async execution propagates input events and retains output events; synchronous execution either passes an input event to an async-capable dispatch runtime or waits on CPU before invoking nodes in topological order. [`dispatch_delegate_kernel.cc:1168-1277`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/runtime/dispatch/dispatch_delegate_kernel.cc#L1168-L1277)

The public `CompiledModel::Run` wrapper still loops over input/output buffers, performs registration checks, calls `AllocateTensors`, sets scheduling options, invokes, and synchronizes outputs. It can be cheap when handles and shapes are unchanged, but its API contract is per-call management rather than a zero-overhead token loop. [`compiled_model.cc:1912-2114`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/runtime/compiled_model.cc#L1912-L2114), [`compiled_model.cc:2185-2200`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/runtime/compiled_model.cc#L2185-L2200)

### Cost model and rule for our token loop

Fixed or amortizable costs:

- graph transform/partition/lowering;
- QNN context creation, graph composition, context-binary generation/loading;
- OpenCL program/kernel-variant compilation;
- invocation-context creation and port/requirement discovery;
- first-use device memory registration and intermediate allocation;
- model-cache serialization and warmup.

Per-run overhead that remains in LiteRT's generic wrapper:

- input/output registration lookup and lock bookkeeping;
- `AllocateTensors`/shape checks;
- scheduling option and event handling;
- attach checks, although unchanged buffers skip the actual attach.

For the fork: create one prepared plan per `(model, device, phase, shape/layout)`, then run an `InvokePreparedPlan` that receives already-bound handles. Do not partition, compile, create QNN contexts, register memory, resize tensors, or allocate intermediates in the decode loop. Do not copy full KV as part of a backend dispatch. A governor decision may select among already-warm plans; it must not construct the selected plan synchronously on the critical token.

Detachment is destruction/replacement work. It should be fence-aware and deferred, but never part of the normal unchanged-buffer path.

## 3. Pipeline NPU di LiteRT-LM

### Ownership and buffer topology

`LlmLiteRtNpuCompiledModelExecutor` makes the ownership split explicit. Its comments identify three classes:

- phase input buffers for embeddings, masks, RoPE, positions, and other non-KV inputs;
- persistent full KV buffers, shared by prefill/decode/verify;
- phase output KV slices, written by the decoder and consumed by a separate cache-update step.

[`llm_litert_npu_compiled_model_executor.cc:125-132`](https://github.com/google-ai-edge/LiteRT-LM/blob/c73ae8a67fe3ddc2ddbfc377417558b2093eaa8d/runtime/executor/llm_litert_npu_compiled_model_executor.cc#L125-L132)

Allocation creates/fills the persistent KV inputs, creates non-KV phase inputs, and creates output slices for each phase. The maps are copied into `InferenceContext`s; the underlying persistent buffers are duplicated as references, not copied data. The executor also handles models where a KV input is not present in every signature and a specific Gemma type/shape mismatch requires a separate decode buffer. [`llm_litert_npu_compiled_model_executor.cc:133-258`](https://github.com/google-ai-edge/LiteRT-LM/blob/c73ae8a67fe3ddc2ddbfc377417558b2093eaa8d/runtime/executor/llm_litert_npu_compiled_model_executor.cc#L133-L258), [`llm_litert_npu_compiled_model_executor.cc:262-421`](https://github.com/google-ai-edge/LiteRT-LM/blob/c73ae8a67fe3ddc2ddbfc377417558b2093eaa8d/runtime/executor/llm_litert_npu_compiled_model_executor.cc#L262-L421)

The executor warms prefill/decode and auxiliary signatures, then clears the persistent cache. This establishes compiled shapes, buffer bindings, and backend state before user-visible inference. The decoder warmup calls the prefill and decode signatures directly; the rest of the method warms the auxiliary/cache-update signatures. [`llm_litert_npu_compiled_model_executor.cc:423-470`](https://github.com/google-ai-edge/LiteRT-LM/blob/c73ae8a67fe3ddc2ddbfc377417558b2093eaa8d/runtime/executor/llm_litert_npu_compiled_model_executor.cc#L423-L470)

### Prefill/decode/commit flow

Current NPU prefill validates batch 1, obtains optimized workgroups/chunks, and checks that all input IDs are covered. The helper supports cautious greedy selection of compiled prefill sizes; the current executor registers one prefill size/signature in its runner set. [`llm_litert_npu_compiled_model_executor.cc:644-684`](https://github.com/google-ai-edge/LiteRT-LM/blob/c73ae8a67fe3ddc2ddbfc377417558b2093eaa8d/runtime/executor/llm_litert_npu_compiled_model_executor.cc#L644-L684), [`litert_compiled_model_executor_utils.cc:444-590`](https://github.com/google-ai-edge/LiteRT-LM/blob/c73ae8a67fe3ddc2ddbfc377417558b2093eaa8d/runtime/executor/litert_compiled_model_executor_utils.cc#L444-L590), [`llm_litert_npu_compiled_model_executor.cc:2177-2179`](https://github.com/google-ai-edge/LiteRT-LM/blob/c73ae8a67fe3ddc2ddbfc377417558b2093eaa8d/runtime/executor/llm_litert_npu_compiled_model_executor.cc#L2177-L2179)

The common prefill pipeline is: RoPE, mask, decoder signature, then cache update. Decode sets position/mask/cache position, runs the auxiliary models, runs the `decode` signature, and then updates KV. [`llm_litert_npu_compiled_model_executor.cc:1246-1282`](https://github.com/google-ai-edge/LiteRT-LM/blob/c73ae8a67fe3ddc2ddbfc377417558b2093eaa8d/runtime/executor/llm_litert_npu_compiled_model_executor.cc#L1246-L1282), [`llm_litert_npu_compiled_model_executor.cc:1285-1363`](https://github.com/google-ai-edge/LiteRT-LM/blob/c73ae8a67fe3ddc2ddbfc377417558b2093eaa8d/runtime/executor/llm_litert_npu_compiled_model_executor.cc#L1285-L1363)

Faithful pseudocode, omitting model-specific tensor names:

```text
init:
  decoder = Create/load compiled text-decoder
  full_kv[layer] = persistent input buffer; fill(init_value)
  slice[phase][layer] = decoder output buffer for phase
  inputs[phase] = non_kv[phase] + full_kv used by that signature
  outputs[phase] = logits/activations + slice[phase]
  warmup(prefill, decode, auxiliary, cache_update)
  clear(full_kv)

prefill(ids):
  for (signature, chunk) in cautious_prefill_chunks(ids):
    set positions; run rope; run mask
    run decoder[signature](inputs[prefill], outputs[prefill])
    run cache_update[prefill](full_kv, slice[prefill], positions, valid_mask)

decode(token, position):
  set position/mask/cache position; run embedder/rope/mask
  run decoder[decode](inputs[decode], outputs[decode])
  run cache_update[decode](full_kv, slice[decode], position)

verify(positions):
  run verify decoder; commit_verified_kv_cache(positions)
```

The cache-update object supports two methods. `kModel` invokes a compiled update signature. `kWH` performs the update in host code. `RunPrefill`, `RunDecode`, and `CommitVerifiedKVCache` choose between those methods; positions and valid masks are filled separately. [`llm_litert_npu_kv_cache.cc:762-881`](https://github.com/google-ai-edge/LiteRT-LM/blob/c73ae8a67fe3ddc2ddbfc377417558b2093eaa8d/runtime/executor/npu/llm_litert_npu_kv_cache.cc#L762-L881)

The host update is not a trivial memcpy: it detects the sequence axis, validates rank/size, handles sliding-window modulo positions, assumes valid tokens are contiguous, handles wrap-around, and can dequantize int16/uint16 slices into a float32 cache before copying. [`llm_litert_npu_kv_cache.cc:102-309`](https://github.com/google-ai-edge/LiteRT-LM/blob/c73ae8a67fe3ddc2ddbfc377417558b2093eaa8d/runtime/executor/npu/llm_litert_npu_kv_cache.cc#L102-L309), [`llm_litert_npu_kv_cache.cc:311-518`](https://github.com/google-ai-edge/LiteRT-LM/blob/c73ae8a67fe3ddc2ddbfc377417558b2093eaa8d/runtime/executor/npu/llm_litert_npu_kv_cache.cc#L311-L518)

The literal dispatch choice is small:

```cpp
if (update_method_ == KVCacheUpdateMethod::kWH) {
  return HWKVCacheUpdate(...);
}
return compiled_model_->Run(signature, input_buffers, output_buffers);
```

[`llm_litert_npu_kv_cache.cc:823-849`](https://github.com/google-ai-edge/LiteRT-LM/blob/c73ae8a67fe3ddc2ddbfc377417558b2093eaa8d/runtime/executor/npu/llm_litert_npu_kv_cache.cc#L823-L849)

### Mapping to llama.cpp: who owns KV when the governor moves a phase

The owner must be a governor-level `KVState`, independent of the active executor:

```text
KVState:
  logical capacity / current position / sliding-window policy
  per-layer K/V base allocation and layout descriptor
  dtype/quant metadata and dirty range
  generation + completion fence
  backend views: CPU, OpenCL, QNN/Hexagon
```

The active CPU/GPU/NPU plan gets a view or registered handle. It does not own the only mutable copy. After a phase produces a slice, it commits `[pos, pos+n)` into the canonical KV state, records the generation/fence, and only then exposes the state to the next backend. A backend switch is:

1. Rebind handles if the canonical allocation and layout are shareable.
2. Otherwise perform one explicit dirty-range materialization/conversion into the target view.
3. Wait only on the producer fence needed by the target phase.

Never copy the whole cache per token. If QNN cannot consume the same allocation as OpenCL/CPU, maintain a mirror with dirty ranges and make the cost visible to the governor. The decision to switch should include that conversion cost.

For our q2_K/q3_K decoder, keep model-weight quantization and KV representation separate. The LiteRT-LM int16/float32 KV conversion path is a useful pattern, but it does not imply that QNN KV is GGUF q2_K/q3_K. The OpenCL kernels should consume the prepacked q2/q3 weight layout; the KV manager should carry its own explicit layout/scale metadata.

The practical llama mapping is therefore:

```text
llama_context / governor owns KVState
  -> CPU plan: host/ggml view
  -> OpenCL plan: cl_mem view or dirty-range mirror
  -> Hexagon/QNN plan: registered FastRPC/DmaBuf/HTP handle or mirror
decoder output slice
  -> fence
  -> KVState.commit(slice, range, generation)
  -> next phase may bind its view
```

Use LiteRT's separate decoder-output-slice plus cache-update step when the NPU graph cannot write the canonical layout directly. It gives a clean commit point and prevents a partial NPU write from becoming visible during a governor handoff.

## 4. Negoziazione dei buffer: il caveat Qualcomm

### What the Qualcomm dispatch code actually accepts

The Qualcomm dispatch invocation context rejects strided tensor layouts. For ordinary tensors it advertises FastRPC and DmaBuf; for raw graph-I/O mode it advertises HostMemory. The source comment is explicit that QnnGpu imports DMA-BUF as OpenCL and rejects QNN ION/FastRPC, so GPU must advertise DmaBuf only. [`litert_dispatch_invocation_context.cc:296-348`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/vendors/qualcomm/dispatch/litert_dispatch_invocation_context.cc#L296-L348)

Device-context capability checking is stricter: it accepts only LiteRT FastRpc or DmaBuf buffer types and rejects AHWB/default before backend registration. [`litert_dispatch_device_context.cc:85-151`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/vendors/qualcomm/dispatch/litert_dispatch_device_context.cc#L85-L151)

The actual backend mapping is:

| LiteRT / QNN path | Registered representation | Source-backed consequence |
|---|---|---|
| raw graph I/O | `HostMemory` / QNN raw client buffer | CPU-accessible path; no device memhandle |
| HTP | FastRpc or DmaBuf input, QNN custom shared buffer (`fd + offset`) | uses `QnnHtpMem_SharedBufferConfig_t` |
| DSP | FastRpc or DmaBuf input, `QNN_MEM_TYPE_ION` | ION is an internal QNN registration type |
| QNN GPU | DmaBuf only, `QNN_MEM_TYPE_DMA_BUF` (`fd`, host address) | imported as OpenCL; FastRPC/ION rejected |
| AHWB | generic LiteRT buffer exists, but Qualcomm device context rejects it | not a QNN zero-copy promise |

See the backend matrix in [`litert_dispatch_device_context.cc:163-228`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/vendors/qualcomm/dispatch/litert_dispatch_device_context.cc#L163-L228). The device context calls QNN `memRegister` lazily for non-host memory and caches the resulting handle; invocation attachment then writes either a raw pointer or a QNN memhandle into the tensor. [`litert_dispatch_invocation_context.cc:405-492`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/vendors/qualcomm/dispatch/litert_dispatch_invocation_context.cc#L405-L492)

This is the critical correction for an Android design: “AHWB-supported by LiteRT” and “AHWB accepted by the Qualcomm QNN dispatch path” are different statements. Generic LiteRT can wrap an `AHardwareBuffer`, lock it with a fence, and lazily make OpenCL/GL views. [`ahwb_buffer.cc:23-104`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/runtime/ahwb_buffer.cc#L23-L104), [`tensor_buffer.cc:959-1027`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/runtime/tensor_buffer.cc#L959-L1027). Qualcomm's current `DeviceContext` rejects that type at its capability gate.

### Rejection and fallback structure

`CompiledModel::RegisterBuffer` first checks whether the supplied buffer type satisfies the backend's requirements. If not, it recognizes several host-compatible types—including host/custom/OpenCL, Android AHWB, FastRpc, and DmaBuf—then installs a CPU-visible custom allocation and lets the dispatch kernel synchronize/copy into its allocated dispatch buffer. Otherwise it returns an unsupported-buffer error. [`compiled_model.cc:1596-1723`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/runtime/compiled_model.cc#L1596-L1723), [`dispatch_delegate_kernel.cc:437-463`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/runtime/dispatch/dispatch_delegate_kernel.cc#L437-L463)

So the fallback matrix is not “any backend can import any Android buffer”:

```text
backend requirements satisfied      -> register/import and attach
requirements not satisfied but CPU-compatible
                                    -> CPU-visible allocation + sync/copy
neither                              -> reject buffer / model invocation
```

For our governor, represent this as a typed capability query before selecting a plan:

```text
can_import(backend, memory_kind, layout, fd/offset, dtype, shape)
  -> Direct | MirrorAndCopy | Reject
```

`MirrorAndCopy` must be explicit in the cost model. It must not silently turn a supposed zero-copy GPU/NPU path into a per-token host copy.

## 5. Cosa copiare letteralmente vs reimplementare

All inspected LiteRT and LiteRT-LM source files below carry an Apache License 2.0 header. The repository `LICENSE` files are Apache License 2.0. Operationally, Apache-2.0 code can be included in our MIT fork if its copyright/license/NOTICE obligations are preserved; copied files do not become MIT-only. The file header is the authority used here, not merely the repository license.

### Safe to copy, retaining headers and attribution

| Checkout path | Verified header | What is worth copying |
|---|---|---|
| `LiteRT/litert/compiler/plugin/algo.{h,cc}` | Google, Apache-2.0 | Union-find and graph-slicing control flow as a reference or literal utility after replacing LiteRt types. Preserve the header. |
| `LiteRT/litert/compiler/plugin/compiler_plugin.cc` | Google, Apache-2.0 | Lifecycle shape: transform → partition → compile → cache/serialize; not the TFLite API plumbing. |
| `LiteRT/litert/runtime/compiled_model.cc` | Google, Apache-2.0 | Accelerator ordering, explicit CPU fallback, cache/no-JIT decisions, and registration validation. |
| `LiteRT/litert/runtime/dispatch/dispatch_delegate.{cc,h}` | Google, Apache-2.0 | Dispatch-runtime initialization and capability gate. |
| `LiteRT/litert/runtime/dispatch/dispatch_delegate_kernel.{cc,h}` | Google, Apache-2.0 | Stable tensor IDs, port-connection fanout, attach-once state, fence-aware deferred unregister. |
| `LiteRT/litert/runtime/dispatch/dispatch_kernel_facade.{cc,h}` | Google, Apache-2.0 | Delayed concrete-kernel selection once executable/context data is available. |
| `LiteRT/litert/runtime/tensor_buffer.{cc,h}` | Google, Apache-2.0 | Reference-counted buffer abstraction, lock/unlock and event ownership concepts. |
| `LiteRT/litert/runtime/ahwb_buffer.{cc,h}` | Google, Apache-2.0 | Generic AHWB allocation/lock/fence wrapper, only for a backend that really imports AHWB. |
| `LiteRT/vendors/qualcomm/dispatch/dispatch_api.cc` | Google, Apache-2.0 | Thin C API/error-boundary shape. |
| `LiteRT/vendors/qualcomm/dispatch/litert_dispatch_device_context.cc` | Google, Apache-2.0 | Capability matrix and lazy device-memory registration pattern; not the QNN types as if they were ours. |
| `LiteRT/vendors/qualcomm/dispatch/litert_dispatch_invocation_context.{cc,h}` | Google + Qualcomm Innovation Center, SPDX Apache-2.0 | Most valuable literal reference for requirements → attach → execute → detach. Keep both attributions. |
| `LiteRT/vendors/qualcomm/compiler/qnn_compiler_plugin.cc` | Google + Qualcomm Innovation Center, SPDX Apache-2.0 | Partition validation and AOT/JIT result shape, only if the QNN SDK integration is separately licensed. |
| `LiteRT-LM/runtime/executor/llm_litert_npu_compiled_model_executor.cc` | ODML Authors, Apache-2.0 | Phase-specific input/output maps, persistent KV references, warmup, and slice/update orchestration. |
| `LiteRT-LM/runtime/executor/npu/llm_litert_npu_kv_cache.{cc,h}` | Google, Apache-2.0 | Separate full-cache owner from decoder slice, explicit commit/update method, position/mask validation. |
| `LiteRT-LM/runtime/executor/npu/llm_litert_npu_compiled_model_executor_utils.{cc,h}` | ODML Authors / Google, Apache-2.0 | Prefill chunk selection and phase/signature resolution patterns. |

Header examples are visible in [`LiteRT/algo.cc:1-15`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/compiler/plugin/algo.cc#L1-L15), [`LiteRT/qnn compiler:1-18`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/vendors/qualcomm/compiler/qnn_compiler_plugin.cc#L1-L18), [`LiteRT/QNN invocation:1-18`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/litert/vendors/qualcomm/dispatch/litert_dispatch_invocation_context.cc#L1-L18), and [`LiteRT-LM executor:1-15`](https://github.com/google-ai-edge/LiteRT-LM/blob/c73ae8a67fe3ddc2ddbfc377417558b2093eaa8d/runtime/executor/llm_litert_npu_compiled_model_executor.cc#L1-L15). The KV-cache header begins with the same Apache-2.0 notice: [`llm_litert_npu_kv_cache.h:1-15`](https://github.com/google-ai-edge/LiteRT-LM/blob/c73ae8a67fe3ddc2ddbfc377417558b2093eaa8d/runtime/executor/npu/llm_litert_npu_kv_cache.h#L1-L15).

### Reimplement around ggml and our backends

- `algo.{h,cc}`: reimplement the graph walk around `ggml_tensor` identity, views, aliases, and backend storage. Keep the ordered-run semantics; do not assume `LiteRtOp` or TFLite tensor IDs.
- `compiler_plugin.cc`: reimplement as a `ggml` planner/lowering pass. Its output must include OpenCL kernel variant, q2/q3 packing, QNN graph handle, scratch, and synchronization metadata.
- `compiled_model.cc` plus dispatch delegate/kernel: reimplement as `PreparedPlan` plus `InvokePreparedPlan`. The llama token loop needs a no-registration hot path and an explicit slow path for shape/plan changes.
- `tensor_buffer`/AHWB: reimplement a tagged buffer handle for host, `cl_mem`, dma-buf fd/offset, FastRPC, QNN custom handle, and optional AHWB. Keep importability and synchronization separate from allocation.
- Qualcomm invocation/device context: reuse the decision table, but query the exact phone/driver capability at initialization. Do not generalize the current HTP/DSP/GPU mapping to all Qualcomm stacks.
- LiteRT-LM executor: reimplement phase maps for llama prefill/decode and any speculative verify path. The code assumes TFLite signatures, model-specific tensor names, and current NPU constraints such as batch-one prefill.
- `HWKVCacheUpdate`: reimplement only after defining our KV layout. Precompute strides and layer offsets, update dirty ranges, and use NEON where host conversion is unavoidable. Do not infer sequence axes from shape heuristics in the core governor.

### Do not copy/vendor as Apache

`LiteRT/third_party/qairt/qairt.BUILD` has no source Apache header and declares `licenses(["reciprocal"])`; it imports external `libQnn*.so`, HTP stub/skel libraries, and headers. [`qairt.BUILD:1-45`](https://github.com/google-ai-edge/LiteRT/blob/fa3db6be54aa536d73668346c620c557e49a7160/third_party/qairt/qairt.BUILD#L1-L45) The checkout does not contain the Qualcomm AI Runtime SDK license or binaries. Treat QAIRT/QNN headers, libraries, generated context binaries, and vendor plugins as separately licensed dependencies. Do not copy them into the MIT tree or describe them as Apache-2.0.

The generic AHWB code is Apache-2.0, but the Qualcomm QNN path's capability gate rejects AHWB. Therefore copy the generic wrapper only if our selected backend can prove AHWB import; otherwise use the explicit FastRPC/DmaBuf/host paths and a controlled mirror.

## Decision summary for the governor

```text
prepare:
  ggml graph -> ordered backend partitions -> compile/load all variants
  -> allocate/import stable buffers -> bind tensor IDs and fences
  -> warm prefill/decode -> publish PreparedPlan

token loop:
  choose already-prepared phase plan
  -> attach only if generation/handle changed
  -> invoke
  -> commit KV slice + fence to governor-owned KVState

phase switch:
  direct rebind if layout/memory is shareable
  else dirty-range materialize/convert once, then invoke target plan
```

The highest-value borrowed design is not a specific QNN call: it is the separation between a persistent full KV allocation, phase-local output slices, and an explicit cache-update/commit boundary. The highest-value reimplementation is LiteRT's attach-once/fence-aware buffer state, expressed in `ggml` tensor identity and our OpenCL/QNN memory capabilities.
