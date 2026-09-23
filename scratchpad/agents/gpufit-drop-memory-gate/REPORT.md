# gpufit-drop-memory-gate — report

## 1. ORDER AND SCOPE

The order: delete the available-memory refusal from `gpuFit` (`src/engine/governorInputs.ts`, app repo
`/Users/marco/Projects/kalsa`), so the governor attempts the GPU path and never refuses it on a memory
estimate; report exactly what was removed and what stayed; and investigate whether a **real** OpenCL
allocation failure degrades to CPU at the vendored engine commit, because the order's justification
("a failed allocation routes the weights to CPU") was only proven for the size-0 dummy allocation
inside `weight_buft_supported`. §2 is the investigation; §3 is the change; §4 is the tests; §5 is the
verdict.

Session scope actually touched:
`src/engine/governorInputs.ts`, `src/engine/governorInputs.test.ts`, `src/engine/LlamaService.ts`
(one call site, forced by the signature change in §3). No device work, no build, no push, no commit.

Starting point: the working tree already carried an uncommitted earlier slice (the `EIGHT_GIB`
total-RAM gate removed, V73 enabled in `GPU_PREFILL_CORRECT`). The change in §3 sits on top of that
slice; no commit was made and nothing was reverted.

Engine revision traced (read-only):
`Aspis0/kalsallama` @ `4ccef2f85dbc27e095e11ffcbad4628be9961790`, vendored in
`Aspis0/kalsa.rn` @ `0288dc2786911d9b7dda6b2961cb3f0afa1e0ee2`
(`package.json:49`); local tree `/Users/marco/Projects/llama.rn-kalsa/vendor/llama.cpp`.
Android build flags for the OpenCL backend — `GGML_OPENCL_USE_ADRENO_KERNELS`,
`GGML_OPENCL_EMBED_KERNELS`, `GGML_OPENCL_SOA_Q`, `GGML_OPENCL_TARGET_VERSION=300` —
`llama.rn-kalsa/android/src/main/rnllama/CMakeLists.txt:205-208`. All code cited below is compiled in.

---

## 2. INVESTIGATION — does a mid-load OpenCL allocation failure abort?

**Short answer: there is an `abort()` on this path — but not in the three allocations people usually
name.**

No abort for the model weights pool, the KV cache or the compute buffer: those return `nullptr`/`false`
and reach a C++ `throw`, which the binding catches and the app answers with a CPU-only retry. Yes for
the weight *upload*: the per-tensor staging buffer that `set_tensor` allocates to SoA-convert each
quantized weight ends in `GGML_ASSERT(0)`/`GGML_ABORT` → `abort()`. That path is taken for
Q4_0/Q4_1/Q5_0/Q5_1/Q8_0/IQ4_NL/MXFP4/Q2_K/Q3_K/Q4_K/Q5_K/Q6_K — i.e. for the app's own Q4_K_M and
Q4_0 models — and it is reached from `llama-model-loader.cpp:1663` (mmap on) and `:1735` (mmap off).
`abort()` cannot be caught by `try/catch` in `rn-llama.cpp` or by the JS fallback, so on that path the
order trades a refusal for a dead process. Everything below is the step-by-step evidence; the abort
sites are listed at the end of this section.

Step-by-step trace (all paths in the vendored tree above):

| # | step | site | on failure |
|---|---|---|---|
| 1 | per-tensor buft choice, op-support only (`weight_buft_supported` uses a size-0 dummy: `w->buffer = ggml_backend_buft_alloc_buffer(buft, 0)` at `src/llama-model-loader.cpp:1051`) | `src/llama-model-loader.cpp:1060-1071`, caller `:1256-1259` | `nullptr` from `weight_buft_supported` → the loop tries the next buft; the CPU bufts are the last entries in that list, so a kernel-compile failure lands on CPU |
| 2 | per-layer buft list = GPU bufts + CPU bufts | `src/llama-model.cpp:1480-1481` | — |
| 3 | real weight buffer for a buft context | `src/llama-model.cpp:1807` | — |
| 4 | allocator | `ggml/src/ggml-alloc.c:1239` → `alloc_tensor_range` at `:1126-1139` → `ggml_backend_buft_alloc_buffer` at `:1132` | `:1133-1137` logs "failed to allocate … buffer of size …" and `return false` — **no abort** |
| 5 | OpenCL buffer type | `ggml/src/ggml-backend.cpp:39-45` → `ggml/src/ggml-opencl/ggml-opencl.cpp:13976-14039`; three retries (clFinish+retry `:14003`, `cl_qcom_large_buffer` `:14013`, `CL_MEM_ALLOC_HOST_PTR` `:14020`) | `:14033` `return nullptr` — **no abort** |
| 6 | weight buffer NULL | `src/llama-model.cpp:1808-1810` | `throw std::runtime_error("unable to allocate %s buffer")` |
| 7 | KV cache real buffer | `src/llama-kv-cache.cpp:308` (`:304` is the `no_alloc` dummy) | `:310-311` `throw std::runtime_error("failed to allocate buffer for kv cache")` |
| 8 | compute buffer reserve, context init | `src/llama-context.cpp:2504` → `ggml_backend_sched_reserve` `:1972-1985` → `ggml_gallocr_reserve_n` `ggml/src/ggml-alloc.c:946` → `:939` `ggml_vbuffer_alloc` `:421-437` | `:940-942` logs and `return false` — **no abort**; caller `src/llama-context.cpp:2505-2508` logs + `return nullptr`; the reserve callers at `:648`, `:660`, `:685` then `throw std::runtime_error("failed to allocate compute pp/tg buffers")` |
| 9 | compute buffer at decode | `src/llama-context.cpp:1388-1391` | `GGML_STATUS_ALLOC_FAILED`, decode returns `-2` (`:1883`) — **no abort** |
| 10 | weight **upload** into the device buffer | `src/llama-model-loader.cpp:1663` (mmap on) and `:1735` (mmap off, no async upload backend — OpenCL reports `async=false`) → `ggml_backend_tensor_set` → OpenCL `set_tensor` `ggml/src/ggml-opencl/ggml-opencl.cpp:10694` | **ABORT** (below) |

Step 10 is the one the order asked about. For every quantized weight type the SoA path allocates a
staging buffer the size of the tensor via `ggml_cl_create_temp_upload_buffer`
(`ggml/src/ggml-opencl/ggml-opencl.cpp:10620-10660`): normal alloc, `clFinish`+retry, then a
host-pinned `CL_MEM_ALLOC_HOST_PTR` map/memcpy fallback; when all of that fails it `return NULL`
(`:10655`). The callers assert that pointer — `GGML_ASSERT(data_device != NULL && …)` — and
`GGML_ASSERT` is not NDEBUG-gated (`ggml/include/ggml.h:288`), so it expands to `GGML_ABORT`
(`:287`) → `ggml_abort` → `abort()` (`ggml/src/ggml.c:253-273`, `abort()` at `:272`). Other
`set_tensor` branches allocate with raw `clCreateBuffer`/`clCreateSubBuffer`/`clCreateImage` and
check with `CL_CHECK` (`:67-74`), whose failure branch is `GGML_ASSERT(0)` — i.e. also `abort()`.

Abort sites on the weight-upload path (fix these first if the gate is to be dropped):

- staging-buffer asserts: `ggml/src/ggml-opencl/ggml-opencl.cpp:10816` (Q4_0), `:11126` (Q4_1),
  `:11256` (Q5_0), `:11418` (Q5_1), `:11569` (MXFP4), `:11678` (Q8_0), `:11778` (IQ4_NL),
  `:11859` (Q4_K), `:12063` (Q5_K), `:12251` (Q6_K) — each preceded by
  `ggml_cl_create_temp_upload_buffer(...)` at the line above.
- `CL_CHECK` on a real allocation in `set_tensor`: `:10700-10703` (Q1_0), `:12475-12476` (Q2_K),
  `:12553-12554` (Q3_K), `:12631-12633` (MXFP4→f16), `:12717-12718`, `:13034-13035`,
  `:13144-13145`, `:13810-13812` (Q2_K MoE restore), `:13846-13848` (Q3_K MoE restore),
  `:13896-13897` (f16→bf16).

Why the app's CPU fallback does not cover this: the governor's model load is wrapped in a C++
`try/catch` at `kalsa.rn/cpp/rn-llama.cpp:97-103` (`common_init_from_params(prefill_params)` with
`n_gpu_layers = 99`, set at `:76`); a thrown `std::runtime_error` becomes
`KALSA_GOVERNOR_FALLBACK` (`cpp/rn-llama.cpp:64-70`), which
`src/engine/governorRuntime.ts:35-38` matches and `initWithGovernorFallback` (`:64-84`) answers by
retrying `cpuParams` (`n_gpu_layers = 0`, `src/engine/LlamaService.ts:2529`). An `abort()` never
reaches that `catch`, so the process dies with the model half-loaded.

Fresh remark, not the order's question, and **NOT VERIFIED**: `ggml/src/ggml-backend.cpp:1633` calls
`ggml_gallocr_reserve_n(...)` without checking the return value and then calls
`ggml_gallocr_alloc_graph(...)` at `:1634`; after a failed reserve the allocator state has
`buffers[i] == NULL` while `size_max` is already recorded, so `ggml_gallocr_needs_realloc` is false
and `ggml_gallocr_init_tensor` (`ggml/src/ggml-alloc.c:970-991`) can dereference the NULL vbuffer.
Reachable only when a *late* graph needs a bigger compute buffer than the reserved worst case and that
reallocation fails; not the mid-load case the order asked about. No device run was made, so I do not
claim it fires.

---

## 3. THE CHANGE — what left `gpuFit`, and what stayed

`src/engine/governorInputs.ts` went from 217 to 177 lines.

Removed:

1. `import { estimateMemory, fitMemoryEstimate } from "./memoryEstimate";` — the import line, gone.
   `memoryEstimate.ts` itself is untouched and still used by `deviceProfile.ts`, `deviceTuning.ts`,
   `modelGateRAM.ts`, `loadGate.test.ts`.
2. `const MIB = 1024 * 1024;` — had no other reader.
3. `type MemorySnapshot` (7 fields: `availableMemoryBytes`, `totalMemoryBytes`, `contextTokens`,
   `ubatch`, `mmap`, `repack`, `offloadedBytes`) — the estimator was its only reader.
4. The `memory: MemorySnapshot` parameter of `gpuFit` **and** of `buildGovernorParams`. With the
   estimate gone, nothing in the file read the snapshot; leaving the parameter would have been a dead
   argument, so the signature is now
   `buildGovernorParams(modelEntry, deviceProfile, force = false)`.
5. The `fitMemoryEstimate` refusal:
   `if (verdict.status === "unknown" || verdict.status === "does_not_fit") return "NoFit"`.
6. The whole final estimate comparison, including the `Plan §4 bounds ... 3.46-3.94 GiB` comment:
   `offloadedBytes`, `gpuReserveMiB = 800 + 1.05*offloadedBytes/MIB`, `requiredMiB = nonEvictableMiB +
   gpuReserveMiB + computeMiB + kvMiB`, `availableMiB = (memory.availableMemoryBytes ?? 0)/MIB`, and
   `return requiredMiB <= availableMiB ? "Fit" : "NoFit"`.

`gpuFit` is now three statements — the two guards and `return "Fit"`.

Stayed, explicitly:

- `kvBytesPerToken` validity (`typeof kv !== "number" || !Number.isFinite(kv) || kv <= 0`) — a data
  requirement, not a RAM threshold.
- `generationFor(profile) === "Unknown"` — the GPU-identity guard. Nothing else in the function keeps
  a Mali/non-Adreno device out. The second wall is the OpenCL backend's own admission test,
  `ggml_opencl_is_device_supported` (`ggml/src/ggml-opencl/ggml-opencl.cpp:3610-3632`), which accepts
  only an Adreno/Qualcomm or Intel device name and returns false otherwise.
- Everything else in the file (thermo parsing, `GPU_PREFILL_CORRECT`, `modelKind`, the bench force key).

One call-site consequence, not a refactor: `src/engine/LlamaService.ts:2316` no longer builds the
snapshot object it used to pass (the literal with `availableMemoryBytes`/`contextTokens`/`ubatch`/
`mmap`/`repack`/`offloadedBytes` was deleted and the call is now
`buildGovernorParams(pricedModel, deviceProfile, benchGovernorForce)`). That literal had no other
reader. Reported rather than done silently: `sizeBytes` on `GovernorModel` is now unread by the
governor; it stays in the type because it is part of the model-entry contract the caller passes and it
keeps the missing-KV test case expressible.

### Every remaining `NoFit` return in `src/engine/governorInputs.ts` after the change

| file:line | condition | kind |
|---|---|---|
| `src/engine/governorInputs.ts:76` | `kvBytesPerToken` missing / not finite / ≤ 0 | data requirement |
| `src/engine/governorInputs.ts:77` | `generationFor(profile) === "Unknown"` | GPU-identity guard (non-Adreno SoC) |

That is the complete list — two returns, both inside `gpuFit`.

Refusals of the GPU path that are **not** `NoFit` returns and are unchanged by this order, listed so
the owner can see them (`src/engine/LlamaService.ts:2318-2325`): `governorBase.enabled` false (an
Unknown generation), `governorThermo.sensor_valid` false, `options.mmprojPath` set, `streamExperts`
set. When any of those holds, or when `gpu_fit === "NoFit"`, `params.n_gpu_layers` is forced to 0 at
`src/engine/LlamaService.ts:2413` (and again at `:2434`, after the bench override); the governor's own
CPU retry sets `cpuParams.n_gpu_layers = 0` at `src/engine/LlamaService.ts:2529`.

---

## 4. TESTS

Old → new. The pre-session baseline (`git show HEAD:src/engine/governorInputs.test.ts`) asserted the
memory refusal twice, so the quotes below give both the HEAD value and the working-tree-at-session-start
value, because an earlier slice had already flipped one of them when it removed the `EIGHT_GIB` gate:

1. `test("prices two contexts with the measured LFM KV")` → renamed
   `test("keeps the measured LFM KV on the GPU path at both RAM sizes")`. The 8 GiB assertion:
   - HEAD: `buildGovernorParams(lfm!, device("QRD8650", 8 * 1024 ** 3), memory).gpu_fit` → `"NoFit"`
     (the memory estimate refused it; the 12 GiB case was `"Fit"`)
   - session start: the earlier slice had already made it `"Fit"`
   - now: `buildGovernorParams(lfm!, device("QRD8650", 8 * 1024 ** 3)).gpu_fit` → `"Fit"`
   The 16k-context case (`{ ...memory, contextTokens: 16384 }`) disappeared with the snapshot argument;
   its 12 GiB assertion stays `"Fit"`. The registry check `lfm?.kvBytesPerToken` → `6656` stays: it is
   the input the surviving KV gate depends on.
2. `test("refuses unknown KV and 8 GiB devices")` (HEAD) / `... and no longer gates on total RAM`
   (session start) → `test("refuses unknown KV and never prices the load")`. The unknown-KV assertion is
   unchanged (`"NoFit"`); the 8 GiB `SM8650` assertion was `"NoFit"` at HEAD (that was the total-RAM
   gate) and `"Fit"` from the earlier slice on. The comment
   `// Total RAM is not a gate; the memory estimate against availableMemoryBytes decides.` is replaced by
   `// RAM is not an input: the 8 GiB phone gets the same answer as the 12 GiB one.` — the old comment
   still deferred to a memory estimate that no longer exists.
3. `const memory = {...}` deleted; the argument was dropped from all 20 `buildGovernorParams` calls in
   the file (19 passed `memory` directly, one passed `{ ...memory, contextTokens: 16384 }`).

The net effect: no test in the file asserts a memory-driven `NoFit` any more, and none can, because
`buildGovernorParams` has no memory input.

Commands run (app repo, working tree):

- `npx tsc --noEmit` → exit 0, no output.
- `npx jest --silent` → `Test Suites: 94 passed, 94 total`; `Tests: 1213 passed, 1213 total`
  (baseline 94 / 1213 — unchanged: no test was added or removed, two were retitled, one rewritten).
- `npx jest src/engine/governorInputs.test.ts` → 1 suite, 10 tests, all passing.

NOT VERIFIED: anything on a device. No build, no install, no logcat, no measurement.

---

## 5. VERDICT

1. The order is implemented as written: `gpuFit` no longer refuses on a memory estimate, the estimator
   machinery is gone rather than dead, and 94/1213 still pass.
2. The order's safety net does **not** hold for the whole load path. The premise is proven for the
   size-0 dummy allocation and (freshly) for the three real allocations named in §2 steps 3-9 — all of
   those reach a `throw` that `kalsa.rn/cpp/rn-llama.cpp:97-103` turns into `KALSA_GOVERNOR_FALLBACK` and
   the app answers with a CPU-only retry. It is **false** for the per-tensor weight staging buffer in
   `set_tensor`: `ggml_cl_create_temp_upload_buffer` returning NULL hits
   `GGML_ASSERT(data_device != NULL && ...)` → `GGML_ABORT` → `abort()` (sites at the end of §2), for
   Q4_K/Q6_K/Q4_0 and the other quantized types the app actually ships. On the S23 numbers in the
   order (2396 MiB reserve for a 1520 MiB model, 2229-3009 MiB available) the attempt is exactly the
   kind that lands there, and `abort()` is immune to both the C++ `catch` and the JS retry: the app
   dies mid-load instead of falling back.
3. Recommendation for the owner's decision, not taken unilaterally here: either (a) fix the staging
   path first so a NULL staging buffer reaches the same `throw`/CPU-retry channel as the pool failure
   (the fork could `throw` from `ggml_cl_create_temp_upload_buffer`'s caller; that function and
   `ggml_backend_tensor_set` are C++, and the callers on this path — `llama-model-loader.cpp`, the
   binding — are C++ too, so the exception would reach the existing `catch`), or (b) keep a deliberate
   refusal while the abort sites remain. Proposal (a) is analysis, NOT VERIFIED on a device.
4. Secondary, **NOT VERIFIED**: the unchecked `ggml_gallocr_reserve_n` at `ggml/src/ggml-backend.cpp:1633`
   plus the re-call at `:1634` can turn a failed *late* compute-buffer reallocation into a NULL-buffer
   dereference instead of a clean `false`.
