# Hostile audit: c26288fdf — leg contexts

**Base:** 9eb7c54c7  
**Scope:** Static review against FABLE-DESIGN.md A4, Amendment F (F1, F4(1), F5), and G3. No build, tests, device work, or adb was run. The only write was this report.

## Findings

### 1. The specified one-copy load cannot construct its GPU leg

**Verdict: CONFIRMED · Severity: P1**  
**Locations:** src/llama-context.cpp:3921; design FABLE-DESIGN.md:96,530.

Validation requires every leg device to be in the model's load-time device list:

> for (const ggml_backend_dev_t * dev = leg_devices; dev && *dev; ++dev) {

and refuses a device absent from that list:

> LLAMA_LOG_ERROR("%s: leg device %s is not one of the model's devices - a leg device must be "

But the one-copy recipe says:

> (devices {HTP0}, n_gpu_layers 99, use_mmap false, no_extra_bufts true, shared weights on)

while F1 requires:

> leg_devices {HTP0}, GPU leg {GPUOpenCL}, CPU leg {}

With the specified model list {HTP0}, {GPUOpenCL} returns null before context construction. Adding OpenCL to the model list may change loader placement, so this is not resolved by the current test or buffer rule. Reconcile the load/list contract before the three-leg governor depends on this API.

### 2. G3 overstates scheduler placement for HOST weights

**Verdict: CONFIRMED · Severity: P2**  
**Locations:** ggml/src/ggml-backend.cpp:917,992; ggml/src/ggml-opencl/ggml-opencl.cpp:15190; design FABLE-DESIGN.md:626.

The design says:

> backend_from_buffer hands every weight op to OpenCL because it is first and now supports TILE32 and HOST

That is only true when the first backend supports both the buft and op. HOST weights take an additional route: with op_offload, the scheduler requires the backend to opt in via offload_op:

> if (ggml_backend_supports_op(sched->backends[b], tensor) && ggml_backend_offload_op(sched->backends[b], tensor)) {

The OpenCL predicate is selective too:

> return ggml_opencl_host_leg_offload(dev, op, &host_w) &&

HOST weight ops not admitted there can fall back to CPU. For non-host TILE32 weights, the scheduler does choose the first backend supporting both buft and op; if no backend supports it, the non-native-weight guard fails reserve instead of silently copying. Thus a GPU leg without HTP can work for imported/admitted cases, but “every weight op” is not guaranteed by backend order. The device check must inspect actual assignments and reserve failures.

### 3. Explicit legs still receive every registered ACCEL backend

**Verdict: CONFIRMED · Severity: P2**  
**Location:** src/llama-context.cpp:374.

The API contract says:

> The context's backends are these devices plus the always-present CPU backend

The constructor separately appends every registered ACCEL device, regardless of the selected leg:

> if (ggml_backend_dev_type(dev) == GGML_BACKEND_DEVICE_TYPE_ACCEL) {

So {NULL} is not guaranteed to mean an exclusively CPU backend set on a host with registered ACCEL devices, and {GPUOpenCL} is not a strict subset of the requested devices. This preserves old global behavior but violates the explicit-leg contract and lets an accelerator outside the leg affect placement.

### 4. Validation accepts duplicate devices and can duplicate CPU/ACCEL backends

**Verdict: CONFIRMED · Severity: P2**  
**Locations:** src/llama-context.cpp:3921,366,386.

Validation only checks membership:

> if (model_dev.dev == *dev) {

There is no duplicate or type check. Every entry is initialized, then CPU is appended unconditionally:

> backends.emplace_back(backend);

> backends.emplace_back(backend_cpu);

A repeated GPU therefore becomes multiple scheduler entries for the same device. If CPU is in model.devices, a leg containing that CPU is accepted and then the always-present CPU backend is added again. A listed ACCEL can also be initialized from the leg and again by the global ACCEL loop. The documented CPU spelling is {NULL}, so accepting a CPU handle is unnecessary and ambiguous.

### 5. Pipeline-parallel eligibility still uses model topology, not leg topology

**Verdict: CONFIRMED · Severity: P2**  
**Location:** src/llama-context.cpp:471.

> model.n_devices() > 1 &&

The scheduler is built from the leg's backend list, but pipeline-parallel eligibility uses the model's device count, load-time GPU-layer count, and split mode. A CPU-only leg over a multi-device fully-offloaded model can request pipeline parallelism despite having no selected GPU leg; that can add scheduler memory/copy overhead or change reserve behavior. Eligibility should use the context's effective backend set. This is a resource/scheduling defect, not proof of wrong logits.

### 6. The “model is not touched” promise is false

**Verdict: CONFIRMED · Severity: P1**  
**Locations:** src/llama-ext.h:165; src/llama-context.cpp:4037.

The API comment promises:

> The model is not touched, so several contexts (legs) can live over one llama_model

Context initialization writes into the shared model:

> model->hparams.n_ctx_train = cparams.n_ctx_orig_yarn / cparams.rope_freq_scale;

Two contexts with different custom YaRN parameters can overwrite the same field; simultaneous construction also races on it. Existing contexts retain references to that model. The common non-YaRN path does not trigger this, which is why the CPU-only fixture misses it. The shared-model promise must account for model fields mutated during initialization.

### 7. Hexagon admission remains device-global, not context-local

**Verdict: CONFIRMED · Severity: P2**  
**Locations:** src/llama-context.cpp:1325; ggml/src/ggml-hexagon/ggml-hexagon.cpp:584.

The context setter calls the backend's device-level setter:

> const int result = set_admission_fn(backend.get(), &admission);

Hexagon stores admission and generation in the shared device context:

> std::atomic<uint64_t>      admission_gen = 0;

The source comment says reads come from “any context's scheduler”; the generation makes contexts using that device re-reserve. This fits F1 only under its stated discipline: one HTP leg, set once before decode, with no concurrent split. It is not an independent per-context setting; a later governor changing admission on one HTP context changes scheduling for every context using that device. The setter must remain outside concurrent graph splits.

### 8. A remaining per-context caller reports model placement as the context device

**Verdict: CONFIRMED · Severity: P2**  
**Locations:** src/llama-governor.cpp:22,27,74.

The helper is context-oriented:

> // Resolved once per context at construction; decode_impl copies the cached name.

but reads each layer's load-time device:

> layer_devices.emplace_back(ggml_backend_dev_name(model.dev_layer(static_cast<int>(il))));

Once the governor constructs leg contexts, this reports the model's HTP placement for CPU/OpenCL legs too. F4 says governor changes come next, so it may be fixed there, but this is the remaining model.dev_layer use on a per-context path in src/ and must not feed leg labels or per-leg stats unchanged.

### 9. NULL uses the old compute/buffer path, but diagnostics differ

**Verdict: CONFIRMED · Severity: P3**  
**Locations:** src/llama-context.cpp:3904,3915,4043; src/llama-ext.h:169.

The default API delegates:

> return llama_init_from_model_with_legs(model, params, nullptr);

The new body formats diagnostics with __func__:

> LLAMA_LOG_ERROR("%s: model cannot be NULL\n", __func__);

Previously the same validation named llama_init_from_model; it now names llama_init_from_model_with_legs (as do initialization errors). The NULL path otherwise uses the model device list and legacy buffer choices, but “today's behaviour exactly” is not literally true for logs/stderr.

### 10. Constructor propagation is a real upstream merge surface; a default argument does not remove it

**Verdict: CONFIRMED · Severity: P2 (maintenance cost)**  
**Locations:** src/llama-memory.h:17,33; src/llama-kv-cache.h:123,126; src/llama-model.cpp (18 forwarding sites).

The per-context value is carried in:

> const ggml_backend_dev_t * leg_devices = nullptr;

A trailing default keeps old constructor callers source-compatible, but it does not remove forwarding edits in llama_model::create_memory(): those call sites must pass the per-context value or nested caches revert to model placement. No existing per-context struct is already received by all concrete memory constructors: llama_memory_params reaches create_memory(), but cache constructors receive model/hparams and individual scalar arguments. Putting the leg on llama_model or llama_hparams would be wrong for a shared model.

A smaller call-site surface requires a larger constructor refactor, for example a per-context llama_memory_placement bundled into a common memory-construction config and passed through the memory object graph. That touches src/llama-memory.h, the concrete memory/cache headers and implementations, and src/llama-model.cpp; it is not achieved by a defaulted pointer alone. This commit touches 25 files under src/, with 18 explicit params.leg_devices forwards in llama-model.cpp. The broad mechanical diff is real, though there is no “one existing struct” shortcut that avoids propagation.

### 11. “Bitwise exact” is observed and printed, but is not the pass condition

**Verdict: CONFIRMED · Severity: P2 (proof strength)**  
**Location:** tests/test-leg-contexts.cpp:117.

The test compares every vocabulary logit, but accepts:

> return *argmax_a == *argmax_b && *max_diff <= 1e-5;

It prints “bitwise exact” only if the observed maximum difference was zero; the assertion permits a nonzero difference up to 1e-5. The 32-token loop does compare both contexts' full logits after each decode; the weakness is the tolerance, not absence of a logits comparison.

### 12. Test (c) proves co-residence and sequential use, not parallel decode or F5's hop proof

**Verdict: CONFIRMED · Severity: P2**  
**Locations:** tests/test-leg-contexts.cpp:234,262; design FABLE-DESIGN.md:576-578.

The implementation decodes one context and then the other:

> if (!decode_one(ctx_def.get(), tok, pos) || !decode_one(ctx_leg.get(), tok, pos)) {

No worker threads overlap scheduler execution. Test (c) shows two contexts coexist over one model and can be alternated; it does not test concurrent calls. It checks only finite logits here, not equality, and uses two contexts rather than F5's three CPU legs, forced A→B→C→A KV commits, and logit equality against one context. The current test is meaningful for basic ownership, but is not F5's proof.

### 13. CPU-only coverage cannot validate the leg-specific branch

**Verdict: CONFIRMED · Severity: P1 (unverified primary path)**  
**Locations:** tests/test-leg-contexts.cpp:39-45,11-12; FABLE-DESIGN.md:568-569.

The fixture forces:

> params.n_gpu_layers = 0;

and states:

> The HTP/GPU legs and the "leg lacks the pin device" norm-pin path stay device-tested (unverified here).

On this fixture the default and CPU-leg paths both select CPU buffers, so it cannot distinguish first-leg-device placement from model.dev_layer placement. It also does not reserve a graph with HTP TILE32/HOST-W weights and no HTP backend. The S23 check should use the actual one-copy model, attempt {GPUOpenCL}, verify per-context KV/recurrent/output/host buffers, and inspect scheduler assignments and reserve results for imported HTP bufts; first resolve finding 1 so the specified load can create that leg. A matching NPU check should verify HTP bufts and the norm pin.

## Checks that survive the audit

### Norm pin behavior is as described for the single-device legs

**Verdict: REFUTED (suspected defect) · Severity: P3**  
**Location:** src/llama-context.cpp:2729-2733.

The callback compares the model layer device to each backend:

> if (ggml_backend_get_device(backend.get()) == dev_layer) {

For the planned {GPUOpenCL} context, model layer placement is HTP0 and that backend is absent, so it pins nothing. That is correct for the GPU leg. For {HTP0}, the HTP backend matches and supported norm nodes are pinned there. This assumes the one-copy model actually places those layer weights on HTP0; it does not prove the scheduler can consume every foreign weight buft.

### KV cell-share/alias check uses the cache context's device set

**Verdict: REFUTED (suspected defect) · Severity: P3**  
**Location:** src/llama-kv-cache.cpp:250-268.

> if (leg_devices) {

The check iterates the leg when present and falls back to model.devices otherwise, then calls ggml_backend_dev_supports_buft on that set. That matches the intended context-local alias gate: CPU legs reject non-host shared cells; device legs accept only a buft their selected device reports supporting. The separate backend-set issues remain.

### The leg pointer list is copied and its lifetime is sound

**Verdict: REFUTED (suspected defect) · Severity: P3**  
**Location:** src/llama-context.cpp:103-110.

> leg_devices.push_back(nullptr);

The constructor copies through the terminator into an owned vector before passing leg_devices.data() into memory creation. Memory constructors use the pointer while constructing their buffers and do not retain it; the device handles themselves are registry-owned. Caller-array lifetime is not the problem.

### Test implementation and skip handling

**Verdict: REFUTED (suspected defect) · Severity: P3**  
**Locations:** tests/test-leg-contexts.cpp:47-54,287-291; tests/CMakeLists.txt:347-348.

The test exercises the real exported initializer, llama_decode, and llama_get_memory_breakdown; it is not a reimplementation of the leg path. It only reads KALSA_HYBRID_GGUF and does not modify environment variables, so there is no env state to restore. Missing fixture exits 77 after llama_backend_free(), and CTest maps 77 to skip. A set-but-invalid model path correctly fails rather than skips.

## Per-context placement grep inventory

I searched all src/ references to model.dev_layer, model.dev_output, and model.devices.

- Adapted: llama-context.cpp fused-op probe, output/sampler buffers, backend set and CPU host buft; llama-kv-cache.cpp KV buffers and alias check; llama-memory-recurrent.cpp; llama-kv-cache-dsv4.cpp including DSV4 compressor state.
- Intentionally model-scoped/default-only: llama-context.cpp fallback branches for NULL legs and the membership validator; model-loading/device accessors in llama-model.cpp and llama.cpp; llama-governor.cpp:27 is the remaining context-oriented exception in Finding 8.
- graph_get_cb at llama-context.cpp:2729 remains model-placement based, but its explicit iteration over this context's backends yields the intended no-pin behavior for GPU/CPU legs and an HTP pin for the NPU leg.

## One-line summary per finding

1. **P1:** {GPUOpenCL} is refused under the design's {HTP0} model load list.
2. **P2:** G3's “every weight op goes to OpenCL” ignores HOST offload_op admission and foreign-buft failure paths.
3. **P2:** Explicit legs still include every globally registered ACCEL backend.
4. **P2:** Duplicate devices and CPU-in-list can create duplicate backend entries.
5. **P2:** Pipeline-parallel selection uses model topology instead of leg topology.
6. **P1:** YaRN context initialization mutates shared model hparams despite the API promise.
7. **P2:** Hexagon admission is device-global and generation changes affect every context using that device.
8. **P2:** Governor context labels still use model layer placement for leg contexts.
9. **P3:** NULL path changes initializer names in diagnostics.
10. **P2:** Constructor propagation is a broad merge surface; a default argument alone does not reduce it.
11. **P2:** The logits test allows 1e-5 differences despite reporting bitwise exactness when observed.
12. **P2:** Test (c) is sequential and does not implement F5's three-leg forced-hop proof.
13. **P1:** CPU-only test coverage cannot validate any distinct device-leg placement or scheduler behavior.
