# OpenCL weight-upload path: abort -> existing throw channel

Engine checkout: `/Users/marco/Projects/kalsallama` (shared, dirty - untouched).
Worktree (evidence, left in place): `/Users/marco/Projects/kalsallama-wt-opencl-degrade`
Ref: detached at `1068eb03d301a1dcb657f4e6923fe77678e651ee`
(`kalsa-gpu-opencl-v73`, verified: `git rev-parse kalsa-gpu-opencl-v73` == that SHA).

App repos read (not modified): `/Users/marco/Projects/llama.rn-kalsa` (native binding),
`/Users/marco/Projects/kalsa` (JS).

Note on the line numbers in the order: 10620 / 10816 / 11126 / ... do not exist at ref
`1068eb03d` - they match an older checkout (same numbers as the prior
`gpufit-drop-memory-gate` report). Re-verified counts do match: 10 staging asserts, 1 helper.

---

## 1. Call chain as it exists BEFORE the change (all lines at ref 1068eb03d)

Downward (who reaches the abort):

1. `common/common.cpp:1438` `common_init_from_params` -> ctor
   `common_init_result::common_init_result` at `common/common.cpp:1292`
   -> `llama_model_load_from_file` call at `common/common.cpp:1331`
   (no try/catch in either; re-grepped: the only catches in `common.cpp` are filesystem
   errors and one scoped `std::stoi`).
2. `src/llama.cpp:465` `llama_model_load_from_file` -> `:380`
   `llama_model_load_from_file_impl` -> `llama_model_load(...)`
   -> `model->load_tensors(ml)` at `src/llama.cpp:369`.
3. `src/llama-model.cpp:1432` `load_tensors` -> `:1871`
   `ml.load_all_data(ctx, buf_map, ...)`.
4. `src/llama-model-loader.cpp:1486` `llama_model_loader::load_all_data` ->
   sync upload calls `ggml_backend_tensor_set(cur, ...)` at `:1663` (mmap path)
   and `:1735` (non-mmap path).
   Threading check: the async-upload worker path is gated on `props.caps.async`
   (`llama-model-loader.cpp:1547`); OpenCL reports `.async = false`
   (`ggml/src/ggml-opencl/ggml-opencl.cpp:14382`) and `.set_tensor_async = NULL` (`:9974`),
   so the call runs on the loading thread - no worker-thread/std::terminate hazard.
5. `ggml/src/ggml-backend.cpp:335` `ggml_backend_tensor_set` -> `:348`
   `buf->iface.set_tensor(buf, tensor, data, offset, size)`.
6. Interface table `ggml/src/ggml-opencl/ggml-opencl.cpp:14202`
   `.set_tensor = ggml_backend_opencl_buffer_set_tensor`, defined at `:10939`.
7. Inside a quant branch (example Q4_0): `:11060`
   `cl_mem data_device = ggml_cl_create_temp_upload_buffer(...)`. Helper defined at `:10865`;
   after its 3 strategies (alloc+write, clFinish+retry, host-pinned map/memcpy) all fail it
   returns NULL at `:10887`, `:10893`, `:10899`.
8. `:11061` `GGML_ASSERT(data_device != NULL && "set_tensor: temp upload buffer alloc failed")`.
   10 such asserts (Q4_0, Q4_1, Q5_0, Q5_1, MXFP4, Q8_0, IQ4_NL, Q4_K, Q5_K, Q6_K) - exact
   lines in section 3.
9. `GGML_ASSERT` is NOT NDEBUG-gated: `ggml/include/ggml.h:288` ->
   `GGML_ABORT` `ggml.h:287` -> `ggml_abort` `ggml/src/ggml.c:253` -> `abort()` at `ggml.c:272`.

Upward (the channel the abort bypasses):

10. App native: `llama.rn-kalsa/cpp/rn-llama.cpp:97-101`
    `try { owner.governor_prefill_init = common_init_from_params(prefill_params, true); }`
    `catch (const std::exception & error)` -> `fail("accelerator_model_load", 0, error.what())`
    (lambda at `:89-94`) -> `log_governor_fallback` (`:63-69`) prints
    `KALSA_GOVERNOR_FALLBACK {stage:...}`.
11. App JS: `kalsa/src/engine/governorRuntime.ts:35-45` `isGovernorFallback` matches
    `KALSA_GOVERNOR_FALLBACK` in error message + native-log delta; `:60-78`
    `initWithGovernorFallback` catches and retries `args.cpuParams`, logging
    `KALSA_GOVERNOR_FALLBACK_RETRY {ok:true}`. Wired at
    `kalsa/src/engine/LlamaService.ts:2533` with `cpuParams.n_gpu_layers = 0` (`:2529`).

No `catch` sits between step 4 and step 10 (`grep catch` in
`llama-model-loader.cpp`/`llama-model.cpp`: only `llama-model-loader.cpp:1166`
`std::out_of_range` in key parsing, unrelated; `common.cpp` catches as noted in step 1).

Adjacent fact (verified, not changed): the weight-pool allocation already degrades.
`ggml_backend_opencl_buffer_type_alloc_buffer` (`ggml-opencl.cpp:14221`) retries 4 ways and
`return nullptr` on final failure (`:14267-14273`), which reaches the existing
`throw std::runtime_error("unable to allocate %s buffer")` in `src/llama-model.cpp`.
The hard abort is specific to the per-tensor staging/upload path in `set_tensor`.

---

## 2. THE CHANGE (worktree `/Users/marco/Projects/kalsallama-wt-opencl-degrade`) + THE COMPILE

### 2.1 What the change is

One file, `ggml/src/ggml-opencl/ggml-opencl.cpp` (+113 / -32, 145 diff lines - includes the 5-line leak fix of section 3; full diff at
`opencl-upload-degrade.diff` next to this report, and inlined below):

1. `#include <stdexcept>` (the only include added).
2. One helper, placed between `ggml_cl_create_temp_upload_buffer` and
   `ggml_cl_create_temp_download_buffer`:

```cpp
// A failed weight upload must fail the model load (the app retries on CPU)
// instead of aborting the process.
[[noreturn]] static void throw_set_tensor_upload_error(const char * what, const char * tensor_name) {
    throw std::runtime_error(
        std::string("ggml_opencl: set_tensor: ") + what + " failed for tensor '" +
        (tensor_name ? tensor_name : "?") + "'");
}
```

3. 30 abort sites inside `ggml_backend_opencl_buffer_set_tensor` (only that function) now call
   this helper instead of `GGML_ASSERT`/`CL_CHECK`. The throw is a `std::runtime_error` on the
   loading thread; it unwinds through the exact chain in section 1 to the existing
   `catch (const std::exception &)` at `rn-llama.cpp:97-101` -> `KALSA_GOVERNOR_FALLBACK` ->
   JS CPU retry. No new channel, no governor change, no other engine file touched.

Each pattern replacement was applied with expected-count assertions (script exits on any
count mismatch), then the full `git diff` was read hunk by hunk.

### 2.2 Compile - exact commands and results

No Android NDK exists on this machine (`ls ~/Library/Android` -> empty, no `ANDROID*`/`NDK*`
env vars), so a full Android build is NOT feasible in this task. What I actually ran, on this
macOS host:

1. Configure (host, OpenCL backend on; build dir is a sibling, outside the worktree):

```
cmake -S . -B ../kalsallama-wt-opencl-degrade-build -G Ninja \
      -DGGML_OPENCL=ON -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF \
      -DLLAMA_BUILD_SERVER=OFF -DLLAMA_CURL=OFF
```

Result: OK. Log shows `-- Including OpenCL backend`, `ggml commit: 1068eb03d-dirty`
(dirty = this change), `GGML_OPENCL_SOA_Q` and `GGML_OPENCL_USE_ADRENO_KERNELS` defined
(same flags as the Android build; Adreno kernels embedded by the Python step at configure).

2. First build attempt FAILED before my code: `fatal error: 'CL/cl.h' file not found` - Apple's
   framework ships headers as `OpenCL/cl.h` with OpenCL 1.2 only. Fix (host-only, no source
   change): `brew install opencl-headers`, then reconfigure with

```
cmake -B ../kalsallama-wt-opencl-degrade-build \
      -DCMAKE_CXX_FLAGS="-I/opt/homebrew/opt/opencl-headers/include"
```

3. Compile the three TUs of the backend - THIS IS THE COMPILE THAT PASSED:

```
ninja ggml/src/ggml-opencl/CMakeFiles/ggml-opencl.dir/ggml-opencl.cpp.o \
      ggml/src/ggml-opencl/CMakeFiles/ggml-opencl.dir/ggml-opencl-kalsa-diag.cpp.o \
      ggml/src/ggml-opencl/CMakeFiles/ggml-opencl.dir/cl-program-cache.cpp.o
echo OBJ_EXIT=$?
```

Result: `OBJ_EXIT=0`. 7 warnings, none in the edited regions (lines 1535, 8316, 8460, 9535,
13078, 13279, 13383 - the `unused variable 'err'` ones are in `get_tensor`, untouched by this
change, and present before it). The modified `ggml-opencl.cpp` compiles with `-Wall -Wextra
-Wpedantic -Wcast-qual -Wmissing-noreturn` etc.

4. `ninja ggml-opencl` (full shared library): all objects compile, LINK FAILS on this host:
   `ld: symbol(s) not found ... "_clCreateBufferWithProperties", "_clGetKernelSubGroupInfo"`.
   Both are referenced from UNMODIFIED code (`ggml_backend_opencl_buffer_type_alloc_buffer`,
   `load_cl_kernels`); Apple's macOS OpenCL is 1.2 and does not export these CL2.0/3.0
   functions. Real Android drivers export them. So on this machine: compile-verified,
   link NOT verified, Android build NOT run.

### 2.3 The diff (also saved as `opencl-upload-degrade.diff`)

```
git diff --stat   ->  ggml/src/ggml-opencl/ggml-opencl.cpp | 145 ++++++++++++++------, 1 file changed, 113 insertions(+), 32 deletions(-)
```

Full diff:

```diff
diff --git a/ggml/src/ggml-opencl/ggml-opencl.cpp b/ggml/src/ggml-opencl/ggml-opencl.cpp
index 97ebf0d18..d84d6081a 100644
--- a/ggml/src/ggml-opencl/ggml-opencl.cpp
+++ b/ggml/src/ggml-opencl/ggml-opencl.cpp
@@ -51,6 +51,7 @@ typedef const void * (*get_adreno_bin_kernel_func_t)(
 #include <mutex>
 #include <regex>
 #include <set>
+#include <stdexcept>
 #include <unordered_set>
 
 #undef MIN
@@ -10905,6 +10906,14 @@ static cl_mem ggml_cl_create_temp_upload_buffer(
     return buf;
 }
 
+// A failed weight upload must fail the model load (the app retries on CPU)
+// instead of aborting the process.
+[[noreturn]] static void throw_set_tensor_upload_error(const char * what, const char * tensor_name) {
+    throw std::runtime_error(
+        std::string("ggml_opencl: set_tensor: ") + what + " failed for tensor '" +
+        (tensor_name ? tensor_name : "?") + "'");
+}
+
 // Allocate a temporary download buffer of `nbytes`. The caller runs a kernel
 // that writes into it, then reads it back to host via clEnqueueReadBuffer (or
 // equivalent). Mirrors ggml_cl_create_temp_upload_buffer; the host-pinned
@@ -10972,10 +10981,14 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
         cl_int err;
         cl_mem data_device = clCreateBuffer(context, CL_MEM_READ_WRITE,
             ggml_nbytes(tensor), NULL, &err);
-        CL_CHECK(err);
-        CL_CHECK(clEnqueueWriteBuffer(
+        if (err != CL_SUCCESS) {
+            throw_set_tensor_upload_error("staging clCreateBuffer", tensor->name);
+        }
+        if (clEnqueueWriteBuffer(
             queue, data_device, CL_TRUE, 0,
-            ggml_nbytes(tensor), data, 0, NULL, NULL));
+            ggml_nbytes(tensor), data, 0, NULL, NULL) != CL_SUCCESS) {
+            throw_set_tensor_upload_error("staging clEnqueueWriteBuffer", tensor->name);
+        }
 
         // The original tensor memory is divided into scales and quants, i.e.,
         // we first store scales, then quants.
@@ -11058,7 +11071,9 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
 
         cl_int err;
         cl_mem data_device = ggml_cl_create_temp_upload_buffer(context, queue, ggml_nbytes(tensor), data, tensor->name);
-        GGML_ASSERT(data_device != NULL && "set_tensor: temp upload buffer alloc failed");
+        if (!data_device) {
+            throw_set_tensor_upload_error("temp upload buffer alloc", tensor->name);
+        }
 
         // We consider the specified offset arg as always, although For weights
         // the offset arg should be 0 (we do not assert this).
@@ -11174,8 +11189,12 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
                         }
                     }
                 }
-                CL_CHECK(clEnqueueWriteBuffer(queue, extra->d, CL_TRUE, 0, hd.size()*sizeof(uint16_t), hd.data(), 0, NULL, NULL));
-                CL_CHECK(clEnqueueWriteBuffer(queue, extra->q, CL_TRUE, 0, hq.size()*sizeof(uint32_t), hq.data(), 0, NULL, NULL));
+                if (clEnqueueWriteBuffer(queue, extra->d, CL_TRUE, 0, hd.size()*sizeof(uint16_t), hd.data(), 0, NULL, NULL) != CL_SUCCESS) {
+                    throw_set_tensor_upload_error("clEnqueueWriteBuffer d", tensor->name);
+                }
+                if (clEnqueueWriteBuffer(queue, extra->q, CL_TRUE, 0, hq.size()*sizeof(uint32_t), hq.data(), 0, NULL, NULL) != CL_SUCCESS) {
+                    throw_set_tensor_upload_error("clEnqueueWriteBuffer q", tensor->name);
+                }
                 GGML_LOG_INFO("ggml_opencl: KALSA host repack for q4_0 MoE tensor %dx%dx%d\n", ne00, ne01, ne02);
                 CL_CHECK(clReleaseMemObject(data_device));
             } else {
@@ -11336,14 +11355,20 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
                 wimg_desc.image_type  = CL_MEM_OBJECT_IMAGE1D_BUFFER;
                 wimg_desc.image_width = (size_t)M * K / 8;
                 wimg_desc.buffer      = extra->q;
-                CL_CHECK((extra->q_img = clCreateImage(context, CL_MEM_READ_ONLY, &wimg_fmt, &wimg_desc, NULL, &err), err));
+                extra->q_img = clCreateImage(context, CL_MEM_READ_ONLY, &wimg_fmt, &wimg_desc, NULL, &err);
+                if (err != CL_SUCCESS) {
+                    throw_set_tensor_upload_error("weight clCreateImage", tensor->name);
+                }
 
                 wimg_fmt = { CL_R, CL_HALF_FLOAT };
                 memset(&wimg_desc, 0, sizeof(wimg_desc));
                 wimg_desc.image_type  = CL_MEM_OBJECT_IMAGE1D_BUFFER;
                 wimg_desc.image_width = (size_t)M * K / 32;
                 wimg_desc.buffer      = extra->d;
-                CL_CHECK((extra->d_img = clCreateImage(context, CL_MEM_READ_ONLY, &wimg_fmt, &wimg_desc, NULL, &err), err));
+                extra->d_img = clCreateImage(context, CL_MEM_READ_ONLY, &wimg_fmt, &wimg_desc, NULL, &err);
+                if (err != CL_SUCCESS) {
+                    throw_set_tensor_upload_error("weight clCreateImage", tensor->name);
+                }
             } else {
                 // Transpose q and d as ushort
                 transpose_2d_as_16b(backend_ctx, extra->q, extra->q, size_q, K/4, M);
@@ -11368,7 +11393,9 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
 
         cl_int err;
         cl_mem data_device = ggml_cl_create_temp_upload_buffer(context, queue, ggml_nbytes(tensor), data, tensor->name);
-        GGML_ASSERT(data_device != NULL && "set_tensor: temp upload buffer alloc failed");
+        if (!data_device) {
+            throw_set_tensor_upload_error("temp upload buffer alloc", tensor->name);
+        }
 
         cl_buffer_region region;
 
@@ -11498,7 +11525,9 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
 
         cl_int err;
         cl_mem data_device = ggml_cl_create_temp_upload_buffer(context, queue, ggml_nbytes(tensor), data, tensor->name);
-        GGML_ASSERT(data_device != NULL && "set_tensor: temp upload buffer alloc failed");
+        if (!data_device) {
+            throw_set_tensor_upload_error("temp upload buffer alloc", tensor->name);
+        }
 
         cl_buffer_region region;
 
@@ -11573,8 +11602,14 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
                     size_t nb32 = (size_t)ne00 / 32;
                     size_t sc_elems = (size_t)ne02 * ne01 * nb32 * 2;
                     size_t mn_elems = (size_t)ne02 * ne01 * nb32;
-                    extra->scale = clCreateBuffer(context, CL_MEM_READ_WRITE, sc_elems * sizeof(cl_half), NULL, &err); CL_CHECK(err);
-                    extra->min   = clCreateBuffer(context, CL_MEM_READ_WRITE, mn_elems * sizeof(cl_half), NULL, &err); CL_CHECK(err);
+                    extra->scale = clCreateBuffer(context, CL_MEM_READ_WRITE, sc_elems * sizeof(cl_half), NULL, &err);
+                    if (err != CL_SUCCESS) {
+                        throw_set_tensor_upload_error("scale clCreateBuffer", tensor->name);
+                    }
+                    extra->min   = clCreateBuffer(context, CL_MEM_READ_WRITE, mn_elems * sizeof(cl_half), NULL, &err);
+                    if (err != CL_SUCCESS) {
+                        throw_set_tensor_upload_error("min clCreateBuffer", tensor->name);
+                    }
                     cl_kernel ek = backend_ctx->kernel_moe_expand_scale_q5_0;
                     CL_CHECK(clSetKernelArg(ek, 0, sizeof(cl_mem), &extra->d));
                     CL_CHECK(clSetKernelArg(ek, 1, sizeof(cl_mem), &extra->scale));
@@ -11660,7 +11695,9 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
 
         cl_int err;
         cl_mem data_device = ggml_cl_create_temp_upload_buffer(context, queue, ggml_nbytes(tensor), data, tensor->name);
-        GGML_ASSERT(data_device != NULL && "set_tensor: temp upload buffer alloc failed");
+        if (!data_device) {
+            throw_set_tensor_upload_error("temp upload buffer alloc", tensor->name);
+        }
 
         cl_buffer_region region;
 
@@ -11811,7 +11848,9 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
 
         cl_int err;
         cl_mem data_device = ggml_cl_create_temp_upload_buffer(context, queue, ggml_nbytes(tensor), data, tensor->name);
-        GGML_ASSERT(data_device != NULL && "set_tensor: temp upload buffer alloc failed");
+        if (!data_device) {
+            throw_set_tensor_upload_error("temp upload buffer alloc", tensor->name);
+        }
 
         // The original tensor memory is divided into scales and quants, i.e.,
         // we first store scales, then quants.
@@ -11920,7 +11959,9 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
 
         cl_int err;
         cl_mem data_device = ggml_cl_create_temp_upload_buffer(context, queue, ggml_nbytes(tensor), data, tensor->name);
-        GGML_ASSERT(data_device != NULL && "set_tensor: temp upload buffer alloc failed");
+        if (!data_device) {
+            throw_set_tensor_upload_error("temp upload buffer alloc", tensor->name);
+        }
 
         // The original tensor memory is divided into scales and quants, i.e.,
         // we first store scales, then quants.
@@ -11973,7 +12014,9 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
                 size_t nb32 = (size_t)ne00 / 32;
                 size_t scale_elems = (size_t)ne02 * ne01 * nb32 * 2;   // 2 per-16-seg scales / 32-block
                 extra->scale = clCreateBuffer(context, CL_MEM_READ_WRITE, scale_elems * sizeof(cl_half), NULL, &err);
-                CL_CHECK(err);
+                if (err != CL_SUCCESS) {
+                    throw_set_tensor_upload_error("scale clCreateBuffer", tensor->name);
+                }
                 cl_kernel ek = backend_ctx->kernel_moe_expand_scale_q8_0;
                 CL_CHECK(clSetKernelArg(ek, 0, sizeof(cl_mem), &extra->d));
                 CL_CHECK(clSetKernelArg(ek, 1, sizeof(cl_mem), &extra->scale));
@@ -12020,7 +12063,9 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
 
         cl_int err;
         cl_mem data_device = ggml_cl_create_temp_upload_buffer(context, queue, ggml_nbytes(tensor), data, tensor->name);
-        GGML_ASSERT(data_device != NULL && "set_tensor: temp upload buffer alloc failed");
+        if (!data_device) {
+            throw_set_tensor_upload_error("temp upload buffer alloc", tensor->name);
+        }
 
         cl_buffer_region region;
 
@@ -12101,7 +12146,9 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
         cl_int err;
         ggml_opencl_log_alloc("try.q4_k.staging", ggml_nbytes(tensor), 0);
         cl_mem data_device = ggml_cl_create_temp_upload_buffer(context, queue, ggml_nbytes(tensor), data, tensor->name);
-        GGML_ASSERT(data_device != NULL && "q4_K set_tensor: temp upload buffer alloc failed");
+        if (!data_device) {
+            throw_set_tensor_upload_error("q4_K temp upload buffer alloc", tensor->name);
+        }
         ggml_opencl_log_alloc("q4_k.staging", ggml_nbytes(tensor), CL_SUCCESS);
         ggml_opencl_log_alloc_note("q4_k.write_done");
 
@@ -12181,7 +12228,9 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
             const size_t q4k_img_px = (size_t) ggml_nelements(tensor) / 8;
             ggml_opencl_log_alloc("try.q4_k.q_img", q4k_img_px * 4, 0);
             extra->q_img = clCreateImage(context, CL_MEM_READ_ONLY, &img_format_q, &img_desc_q, NULL, &err);
-            CL_CHECK(err);
+            if (err != CL_SUCCESS) {
+                throw_set_tensor_upload_error("weight clCreateImage", tensor->name);
+            }
             ggml_opencl_log_alloc("q4_k.q_img", q4k_img_px * 4, err);
             tensor->extra = extra;
 
@@ -12273,7 +12322,10 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
                 wimg_desc.image_type  = CL_MEM_OBJECT_IMAGE1D_BUFFER;
                 wimg_desc.image_width = (size_t)M * K / 8;
                 wimg_desc.buffer      = extra->q;
-                CL_CHECK((extra->q_img = clCreateImage(context, CL_MEM_READ_ONLY, &wimg_fmt, &wimg_desc, NULL, &err), err));
+                extra->q_img = clCreateImage(context, CL_MEM_READ_ONLY, &wimg_fmt, &wimg_desc, NULL, &err);
+                if (err != CL_SUCCESS) {
+                    throw_set_tensor_upload_error("weight clCreateImage", tensor->name);
+                }
             } else {
                 // Transpose q as ushort
                 transpose_2d_as_16b(backend_ctx, extra->q, extra->q, size_q, K/4, M);
@@ -12305,7 +12357,9 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
 
         cl_int err;
         cl_mem data_device = ggml_cl_create_temp_upload_buffer(context, queue, ggml_nbytes(tensor), data, tensor->name);
-        GGML_ASSERT(data_device != NULL && "q5_K set_tensor: temp upload buffer alloc failed");
+        if (!data_device) {
+            throw_set_tensor_upload_error("q5_K temp upload buffer alloc", tensor->name);
+        }
 
         cl_buffer_region region;
 
@@ -12389,7 +12443,9 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
                 { extra->q }
             };
             extra->q_img = clCreateImage(context, CL_MEM_READ_ONLY, &img_format_q, &img_desc_q, NULL, &err);
-            CL_CHECK(err);
+            if (err != CL_SUCCESS) {
+                throw_set_tensor_upload_error("weight clCreateImage", tensor->name);
+            }
             tensor->extra = extra;
 
             // Generic dp4a MoE path
@@ -12401,8 +12457,14 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
                     size_t nb32     = (size_t)ne00 / 32;
                     size_t sc_elems = (size_t)ne02 * ne01 * nb32 * 2;
                     size_t mn_elems = (size_t)ne02 * ne01 * nb32;
-                    extra->scale = clCreateBuffer(context, CL_MEM_READ_WRITE, sc_elems * sizeof(cl_half), NULL, &err); CL_CHECK(err);
-                    extra->min   = clCreateBuffer(context, CL_MEM_READ_WRITE, mn_elems * sizeof(cl_half), NULL, &err); CL_CHECK(err);
+                    extra->scale = clCreateBuffer(context, CL_MEM_READ_WRITE, sc_elems * sizeof(cl_half), NULL, &err);
+                    if (err != CL_SUCCESS) {
+                        throw_set_tensor_upload_error("scale clCreateBuffer", tensor->name);
+                    }
+                    extra->min   = clCreateBuffer(context, CL_MEM_READ_WRITE, mn_elems * sizeof(cl_half), NULL, &err);
+                    if (err != CL_SUCCESS) {
+                        throw_set_tensor_upload_error("min clCreateBuffer", tensor->name);
+                    }
                     cl_kernel ek = backend_ctx->kernel_moe_expand_scale_q5_K;
                     CL_CHECK(clSetKernelArg(ek, 0, sizeof(cl_mem), &extra->s));
                     CL_CHECK(clSetKernelArg(ek, 1, sizeof(cl_mem), &extra->d));
@@ -12493,7 +12555,9 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
 
         cl_int err;
         cl_mem data_device = ggml_cl_create_temp_upload_buffer(context, queue, ggml_nbytes(tensor), data, tensor->name);
-        GGML_ASSERT(data_device != NULL && "q6_K set_tensor: temp upload buffer alloc failed");
+        if (!data_device) {
+            throw_set_tensor_upload_error("q6_K temp upload buffer alloc", tensor->name);
+        }
 
         cl_buffer_region region;
 
@@ -12718,9 +12782,13 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
             cl_int err;
             ggml_opencl_log_alloc("try.q2_k.staging", ggml_nbytes(tensor), 0);
             cl_mem data_device = clCreateBuffer(context, CL_MEM_READ_WRITE, ggml_nbytes(tensor), NULL, &err);
-            CL_CHECK(err);
+            if (err != CL_SUCCESS) {
+                throw_set_tensor_upload_error("staging clCreateBuffer", tensor->name);
+            }
             ggml_opencl_log_alloc("q2_k.staging", ggml_nbytes(tensor), err);
-            CL_CHECK(clEnqueueWriteBuffer(queue, data_device, CL_TRUE, 0, ggml_nbytes(tensor), data, 0, NULL, NULL));
+            if (clEnqueueWriteBuffer(queue, data_device, CL_TRUE, 0, ggml_nbytes(tensor), data, 0, NULL, NULL) != CL_SUCCESS) {
+                throw_set_tensor_upload_error("staging clEnqueueWriteBuffer", tensor->name);
+            }
 
             ggml_opencl_log_weight_storage_path(backend_ctx, tensor, "trans4-moe");
 
@@ -12796,9 +12864,13 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
             cl_int err;
             ggml_opencl_log_alloc("try.q3_k.staging", ggml_nbytes(tensor), 0);
             cl_mem data_device = clCreateBuffer(context, CL_MEM_READ_WRITE, ggml_nbytes(tensor), NULL, &err);
-            CL_CHECK(err);
+            if (err != CL_SUCCESS) {
+                throw_set_tensor_upload_error("staging clCreateBuffer", tensor->name);
+            }
             ggml_opencl_log_alloc("q3_k.staging", ggml_nbytes(tensor), err);
-            CL_CHECK(clEnqueueWriteBuffer(queue, data_device, CL_TRUE, 0, ggml_nbytes(tensor), data, 0, NULL, NULL));
+            if (clEnqueueWriteBuffer(queue, data_device, CL_TRUE, 0, ggml_nbytes(tensor), data, 0, NULL, NULL) != CL_SUCCESS) {
+                throw_set_tensor_upload_error("staging clEnqueueWriteBuffer", tensor->name);
+            }
 
             ggml_opencl_log_weight_storage_path(backend_ctx, tensor, "trans4-moe");
             ggml_opencl_log_alloc_note("q3_k.parent_planes SoA=114B/sb (subbuffers of existing parent, not a new clCreateBuffer)");
@@ -12875,7 +12947,9 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
         cl_int err;
         cl_mem data_device = clCreateBuffer(context, CL_MEM_READ_ONLY | CL_MEM_COPY_HOST_PTR,
             size, const_cast<void *>(data), &err);
-        CL_CHECK(err);
+        if (err != CL_SUCCESS) {
+            throw_set_tensor_upload_error("staging clCreateBuffer", tensor->name);
+        }
 
         cl_kernel kernel = backend_ctx->kernel_convert_bf16_to_f16;
         CL_CHECK(clSetKernelArg(kernel, 0, sizeof(cl_mem), &data_device));
@@ -12898,9 +12972,11 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
     ggml_tensor_extra_cl * extra = (ggml_tensor_extra_cl *) tensor->extra;
     GGML_ASSERT(extra);
 
-    CL_CHECK(clEnqueueWriteBuffer(
+    if (clEnqueueWriteBuffer(
         queue, extra->data_device, CL_TRUE, extra->offset + offset,
-        size, data, 0, NULL, NULL));
+        size, data, 0, NULL, NULL) != CL_SUCCESS) {
+        throw_set_tensor_upload_error("clEnqueueWriteBuffer", tensor->name);
+    }
 
     ggml_opencl_gemv_audit_stash_generic(extra, tensor, data, offset, size);
 
diff --git a/ggml/src/ggml-opencl/ggml-opencl.cpp b/ggml/src/ggml-opencl/ggml-opencl.cpp
index 97ebf0d18..1debeec10 100644
--- a/ggml/src/ggml-opencl/ggml-opencl.cpp
+++ b/ggml/src/ggml-opencl/ggml-opencl.cpp
@@ -51,6 +51,7 @@ typedef const void * (*get_adreno_bin_kernel_func_t)(
 #include <mutex>
 #include <regex>
 #include <set>
+#include <stdexcept>
 #include <unordered_set>
 
 #undef MIN
@@ -10905,6 +10906,14 @@ static cl_mem ggml_cl_create_temp_upload_buffer(
     return buf;
 }
 
+// A failed weight upload must fail the model load (the app retries on CPU)
+// instead of aborting the process.
+[[noreturn]] static void throw_set_tensor_upload_error(const char * what, const char * tensor_name) {
+    throw std::runtime_error(
+        std::string("ggml_opencl: set_tensor: ") + what + " failed for tensor '" +
+        (tensor_name ? tensor_name : "?") + "'");
+}
+
 // Allocate a temporary download buffer of `nbytes`. The caller runs a kernel
 // that writes into it, then reads it back to host via clEnqueueReadBuffer (or
 // equivalent). Mirrors ggml_cl_create_temp_upload_buffer; the host-pinned
@@ -10972,10 +10981,15 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
         cl_int err;
         cl_mem data_device = clCreateBuffer(context, CL_MEM_READ_WRITE,
             ggml_nbytes(tensor), NULL, &err);
-        CL_CHECK(err);
-        CL_CHECK(clEnqueueWriteBuffer(
+        if (err != CL_SUCCESS) {
+            throw_set_tensor_upload_error("staging clCreateBuffer", tensor->name);
+        }
+        if (clEnqueueWriteBuffer(
             queue, data_device, CL_TRUE, 0,
-            ggml_nbytes(tensor), data, 0, NULL, NULL));
+            ggml_nbytes(tensor), data, 0, NULL, NULL) != CL_SUCCESS) {
+            clReleaseMemObject(data_device);
+            throw_set_tensor_upload_error("staging clEnqueueWriteBuffer", tensor->name);
+        }
 
         // The original tensor memory is divided into scales and quants, i.e.,
         // we first store scales, then quants.
@@ -11058,7 +11072,9 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
 
         cl_int err;
         cl_mem data_device = ggml_cl_create_temp_upload_buffer(context, queue, ggml_nbytes(tensor), data, tensor->name);
-        GGML_ASSERT(data_device != NULL && "set_tensor: temp upload buffer alloc failed");
+        if (!data_device) {
+            throw_set_tensor_upload_error("temp upload buffer alloc", tensor->name);
+        }
 
         // We consider the specified offset arg as always, although For weights
         // the offset arg should be 0 (we do not assert this).
@@ -11174,8 +11190,14 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
                         }
                     }
                 }
-                CL_CHECK(clEnqueueWriteBuffer(queue, extra->d, CL_TRUE, 0, hd.size()*sizeof(uint16_t), hd.data(), 0, NULL, NULL));
-                CL_CHECK(clEnqueueWriteBuffer(queue, extra->q, CL_TRUE, 0, hq.size()*sizeof(uint32_t), hq.data(), 0, NULL, NULL));
+                if (clEnqueueWriteBuffer(queue, extra->d, CL_TRUE, 0, hd.size()*sizeof(uint16_t), hd.data(), 0, NULL, NULL) != CL_SUCCESS) {
+                    clReleaseMemObject(data_device);
+                    throw_set_tensor_upload_error("clEnqueueWriteBuffer d", tensor->name);
+                }
+                if (clEnqueueWriteBuffer(queue, extra->q, CL_TRUE, 0, hq.size()*sizeof(uint32_t), hq.data(), 0, NULL, NULL) != CL_SUCCESS) {
+                    clReleaseMemObject(data_device);
+                    throw_set_tensor_upload_error("clEnqueueWriteBuffer q", tensor->name);
+                }
                 GGML_LOG_INFO("ggml_opencl: KALSA host repack for q4_0 MoE tensor %dx%dx%d\n", ne00, ne01, ne02);
                 CL_CHECK(clReleaseMemObject(data_device));
             } else {
@@ -11336,14 +11358,20 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
                 wimg_desc.image_type  = CL_MEM_OBJECT_IMAGE1D_BUFFER;
                 wimg_desc.image_width = (size_t)M * K / 8;
                 wimg_desc.buffer      = extra->q;
-                CL_CHECK((extra->q_img = clCreateImage(context, CL_MEM_READ_ONLY, &wimg_fmt, &wimg_desc, NULL, &err), err));
+                extra->q_img = clCreateImage(context, CL_MEM_READ_ONLY, &wimg_fmt, &wimg_desc, NULL, &err);
+                if (err != CL_SUCCESS) {
+                    throw_set_tensor_upload_error("weight clCreateImage", tensor->name);
+                }
 
                 wimg_fmt = { CL_R, CL_HALF_FLOAT };
                 memset(&wimg_desc, 0, sizeof(wimg_desc));
                 wimg_desc.image_type  = CL_MEM_OBJECT_IMAGE1D_BUFFER;
                 wimg_desc.image_width = (size_t)M * K / 32;
                 wimg_desc.buffer      = extra->d;
-                CL_CHECK((extra->d_img = clCreateImage(context, CL_MEM_READ_ONLY, &wimg_fmt, &wimg_desc, NULL, &err), err));
+                extra->d_img = clCreateImage(context, CL_MEM_READ_ONLY, &wimg_fmt, &wimg_desc, NULL, &err);
+                if (err != CL_SUCCESS) {
+                    throw_set_tensor_upload_error("weight clCreateImage", tensor->name);
+                }
             } else {
                 // Transpose q and d as ushort
                 transpose_2d_as_16b(backend_ctx, extra->q, extra->q, size_q, K/4, M);
@@ -11368,7 +11396,9 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
 
         cl_int err;
         cl_mem data_device = ggml_cl_create_temp_upload_buffer(context, queue, ggml_nbytes(tensor), data, tensor->name);
-        GGML_ASSERT(data_device != NULL && "set_tensor: temp upload buffer alloc failed");
+        if (!data_device) {
+            throw_set_tensor_upload_error("temp upload buffer alloc", tensor->name);
+        }
 
         cl_buffer_region region;
 
@@ -11498,7 +11528,9 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
 
         cl_int err;
         cl_mem data_device = ggml_cl_create_temp_upload_buffer(context, queue, ggml_nbytes(tensor), data, tensor->name);
-        GGML_ASSERT(data_device != NULL && "set_tensor: temp upload buffer alloc failed");
+        if (!data_device) {
+            throw_set_tensor_upload_error("temp upload buffer alloc", tensor->name);
+        }
 
         cl_buffer_region region;
 
@@ -11573,8 +11605,14 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
                     size_t nb32 = (size_t)ne00 / 32;
                     size_t sc_elems = (size_t)ne02 * ne01 * nb32 * 2;
                     size_t mn_elems = (size_t)ne02 * ne01 * nb32;
-                    extra->scale = clCreateBuffer(context, CL_MEM_READ_WRITE, sc_elems * sizeof(cl_half), NULL, &err); CL_CHECK(err);
-                    extra->min   = clCreateBuffer(context, CL_MEM_READ_WRITE, mn_elems * sizeof(cl_half), NULL, &err); CL_CHECK(err);
+                    extra->scale = clCreateBuffer(context, CL_MEM_READ_WRITE, sc_elems * sizeof(cl_half), NULL, &err);
+                    if (err != CL_SUCCESS) {
+                        throw_set_tensor_upload_error("scale clCreateBuffer", tensor->name);
+                    }
+                    extra->min   = clCreateBuffer(context, CL_MEM_READ_WRITE, mn_elems * sizeof(cl_half), NULL, &err);
+                    if (err != CL_SUCCESS) {
+                        throw_set_tensor_upload_error("min clCreateBuffer", tensor->name);
+                    }
                     cl_kernel ek = backend_ctx->kernel_moe_expand_scale_q5_0;
                     CL_CHECK(clSetKernelArg(ek, 0, sizeof(cl_mem), &extra->d));
                     CL_CHECK(clSetKernelArg(ek, 1, sizeof(cl_mem), &extra->scale));
@@ -11660,7 +11698,9 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
 
         cl_int err;
         cl_mem data_device = ggml_cl_create_temp_upload_buffer(context, queue, ggml_nbytes(tensor), data, tensor->name);
-        GGML_ASSERT(data_device != NULL && "set_tensor: temp upload buffer alloc failed");
+        if (!data_device) {
+            throw_set_tensor_upload_error("temp upload buffer alloc", tensor->name);
+        }
 
         cl_buffer_region region;
 
@@ -11811,7 +11851,9 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
 
         cl_int err;
         cl_mem data_device = ggml_cl_create_temp_upload_buffer(context, queue, ggml_nbytes(tensor), data, tensor->name);
-        GGML_ASSERT(data_device != NULL && "set_tensor: temp upload buffer alloc failed");
+        if (!data_device) {
+            throw_set_tensor_upload_error("temp upload buffer alloc", tensor->name);
+        }
 
         // The original tensor memory is divided into scales and quants, i.e.,
         // we first store scales, then quants.
@@ -11920,7 +11962,9 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
 
         cl_int err;
         cl_mem data_device = ggml_cl_create_temp_upload_buffer(context, queue, ggml_nbytes(tensor), data, tensor->name);
-        GGML_ASSERT(data_device != NULL && "set_tensor: temp upload buffer alloc failed");
+        if (!data_device) {
+            throw_set_tensor_upload_error("temp upload buffer alloc", tensor->name);
+        }
 
         // The original tensor memory is divided into scales and quants, i.e.,
         // we first store scales, then quants.
@@ -11973,7 +12017,9 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
                 size_t nb32 = (size_t)ne00 / 32;
                 size_t scale_elems = (size_t)ne02 * ne01 * nb32 * 2;   // 2 per-16-seg scales / 32-block
                 extra->scale = clCreateBuffer(context, CL_MEM_READ_WRITE, scale_elems * sizeof(cl_half), NULL, &err);
-                CL_CHECK(err);
+                if (err != CL_SUCCESS) {
+                    throw_set_tensor_upload_error("scale clCreateBuffer", tensor->name);
+                }
                 cl_kernel ek = backend_ctx->kernel_moe_expand_scale_q8_0;
                 CL_CHECK(clSetKernelArg(ek, 0, sizeof(cl_mem), &extra->d));
                 CL_CHECK(clSetKernelArg(ek, 1, sizeof(cl_mem), &extra->scale));
@@ -12020,7 +12066,9 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
 
         cl_int err;
         cl_mem data_device = ggml_cl_create_temp_upload_buffer(context, queue, ggml_nbytes(tensor), data, tensor->name);
-        GGML_ASSERT(data_device != NULL && "set_tensor: temp upload buffer alloc failed");
+        if (!data_device) {
+            throw_set_tensor_upload_error("temp upload buffer alloc", tensor->name);
+        }
 
         cl_buffer_region region;
 
@@ -12101,7 +12149,9 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
         cl_int err;
         ggml_opencl_log_alloc("try.q4_k.staging", ggml_nbytes(tensor), 0);
         cl_mem data_device = ggml_cl_create_temp_upload_buffer(context, queue, ggml_nbytes(tensor), data, tensor->name);
-        GGML_ASSERT(data_device != NULL && "q4_K set_tensor: temp upload buffer alloc failed");
+        if (!data_device) {
+            throw_set_tensor_upload_error("q4_K temp upload buffer alloc", tensor->name);
+        }
         ggml_opencl_log_alloc("q4_k.staging", ggml_nbytes(tensor), CL_SUCCESS);
         ggml_opencl_log_alloc_note("q4_k.write_done");
 
@@ -12181,7 +12231,9 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
             const size_t q4k_img_px = (size_t) ggml_nelements(tensor) / 8;
             ggml_opencl_log_alloc("try.q4_k.q_img", q4k_img_px * 4, 0);
             extra->q_img = clCreateImage(context, CL_MEM_READ_ONLY, &img_format_q, &img_desc_q, NULL, &err);
-            CL_CHECK(err);
+            if (err != CL_SUCCESS) {
+                throw_set_tensor_upload_error("weight clCreateImage", tensor->name);
+            }
             ggml_opencl_log_alloc("q4_k.q_img", q4k_img_px * 4, err);
             tensor->extra = extra;
 
@@ -12273,7 +12325,10 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
                 wimg_desc.image_type  = CL_MEM_OBJECT_IMAGE1D_BUFFER;
                 wimg_desc.image_width = (size_t)M * K / 8;
                 wimg_desc.buffer      = extra->q;
-                CL_CHECK((extra->q_img = clCreateImage(context, CL_MEM_READ_ONLY, &wimg_fmt, &wimg_desc, NULL, &err), err));
+                extra->q_img = clCreateImage(context, CL_MEM_READ_ONLY, &wimg_fmt, &wimg_desc, NULL, &err);
+                if (err != CL_SUCCESS) {
+                    throw_set_tensor_upload_error("weight clCreateImage", tensor->name);
+                }
             } else {
                 // Transpose q as ushort
                 transpose_2d_as_16b(backend_ctx, extra->q, extra->q, size_q, K/4, M);
@@ -12305,7 +12360,9 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
 
         cl_int err;
         cl_mem data_device = ggml_cl_create_temp_upload_buffer(context, queue, ggml_nbytes(tensor), data, tensor->name);
-        GGML_ASSERT(data_device != NULL && "q5_K set_tensor: temp upload buffer alloc failed");
+        if (!data_device) {
+            throw_set_tensor_upload_error("q5_K temp upload buffer alloc", tensor->name);
+        }
 
         cl_buffer_region region;
 
@@ -12389,7 +12446,9 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
                 { extra->q }
             };
             extra->q_img = clCreateImage(context, CL_MEM_READ_ONLY, &img_format_q, &img_desc_q, NULL, &err);
-            CL_CHECK(err);
+            if (err != CL_SUCCESS) {
+                throw_set_tensor_upload_error("weight clCreateImage", tensor->name);
+            }
             tensor->extra = extra;
 
             // Generic dp4a MoE path
@@ -12401,8 +12460,14 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
                     size_t nb32     = (size_t)ne00 / 32;
                     size_t sc_elems = (size_t)ne02 * ne01 * nb32 * 2;
                     size_t mn_elems = (size_t)ne02 * ne01 * nb32;
-                    extra->scale = clCreateBuffer(context, CL_MEM_READ_WRITE, sc_elems * sizeof(cl_half), NULL, &err); CL_CHECK(err);
-                    extra->min   = clCreateBuffer(context, CL_MEM_READ_WRITE, mn_elems * sizeof(cl_half), NULL, &err); CL_CHECK(err);
+                    extra->scale = clCreateBuffer(context, CL_MEM_READ_WRITE, sc_elems * sizeof(cl_half), NULL, &err);
+                    if (err != CL_SUCCESS) {
+                        throw_set_tensor_upload_error("scale clCreateBuffer", tensor->name);
+                    }
+                    extra->min   = clCreateBuffer(context, CL_MEM_READ_WRITE, mn_elems * sizeof(cl_half), NULL, &err);
+                    if (err != CL_SUCCESS) {
+                        throw_set_tensor_upload_error("min clCreateBuffer", tensor->name);
+                    }
                     cl_kernel ek = backend_ctx->kernel_moe_expand_scale_q5_K;
                     CL_CHECK(clSetKernelArg(ek, 0, sizeof(cl_mem), &extra->s));
                     CL_CHECK(clSetKernelArg(ek, 1, sizeof(cl_mem), &extra->d));
@@ -12493,7 +12558,9 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
 
         cl_int err;
         cl_mem data_device = ggml_cl_create_temp_upload_buffer(context, queue, ggml_nbytes(tensor), data, tensor->name);
-        GGML_ASSERT(data_device != NULL && "q6_K set_tensor: temp upload buffer alloc failed");
+        if (!data_device) {
+            throw_set_tensor_upload_error("q6_K temp upload buffer alloc", tensor->name);
+        }
 
         cl_buffer_region region;
 
@@ -12718,9 +12785,14 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
             cl_int err;
             ggml_opencl_log_alloc("try.q2_k.staging", ggml_nbytes(tensor), 0);
             cl_mem data_device = clCreateBuffer(context, CL_MEM_READ_WRITE, ggml_nbytes(tensor), NULL, &err);
-            CL_CHECK(err);
+            if (err != CL_SUCCESS) {
+                throw_set_tensor_upload_error("staging clCreateBuffer", tensor->name);
+            }
             ggml_opencl_log_alloc("q2_k.staging", ggml_nbytes(tensor), err);
-            CL_CHECK(clEnqueueWriteBuffer(queue, data_device, CL_TRUE, 0, ggml_nbytes(tensor), data, 0, NULL, NULL));
+            if (clEnqueueWriteBuffer(queue, data_device, CL_TRUE, 0, ggml_nbytes(tensor), data, 0, NULL, NULL) != CL_SUCCESS) {
+                clReleaseMemObject(data_device);
+                throw_set_tensor_upload_error("staging clEnqueueWriteBuffer", tensor->name);
+            }
 
             ggml_opencl_log_weight_storage_path(backend_ctx, tensor, "trans4-moe");
 
@@ -12796,9 +12868,14 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
             cl_int err;
             ggml_opencl_log_alloc("try.q3_k.staging", ggml_nbytes(tensor), 0);
             cl_mem data_device = clCreateBuffer(context, CL_MEM_READ_WRITE, ggml_nbytes(tensor), NULL, &err);
-            CL_CHECK(err);
+            if (err != CL_SUCCESS) {
+                throw_set_tensor_upload_error("staging clCreateBuffer", tensor->name);
+            }
             ggml_opencl_log_alloc("q3_k.staging", ggml_nbytes(tensor), err);
-            CL_CHECK(clEnqueueWriteBuffer(queue, data_device, CL_TRUE, 0, ggml_nbytes(tensor), data, 0, NULL, NULL));
+            if (clEnqueueWriteBuffer(queue, data_device, CL_TRUE, 0, ggml_nbytes(tensor), data, 0, NULL, NULL) != CL_SUCCESS) {
+                clReleaseMemObject(data_device);
+                throw_set_tensor_upload_error("staging clEnqueueWriteBuffer", tensor->name);
+            }
 
             ggml_opencl_log_weight_storage_path(backend_ctx, tensor, "trans4-moe");
             ggml_opencl_log_alloc_note("q3_k.parent_planes SoA=114B/sb (subbuffers of existing parent, not a new clCreateBuffer)");
@@ -12875,7 +12952,9 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
         cl_int err;
         cl_mem data_device = clCreateBuffer(context, CL_MEM_READ_ONLY | CL_MEM_COPY_HOST_PTR,
             size, const_cast<void *>(data), &err);
-        CL_CHECK(err);
+        if (err != CL_SUCCESS) {
+            throw_set_tensor_upload_error("staging clCreateBuffer", tensor->name);
+        }
 
         cl_kernel kernel = backend_ctx->kernel_convert_bf16_to_f16;
         CL_CHECK(clSetKernelArg(kernel, 0, sizeof(cl_mem), &data_device));
@@ -12898,9 +12977,11 @@ static void ggml_backend_opencl_buffer_set_tensor(ggml_backend_buffer_t buffer,
     ggml_tensor_extra_cl * extra = (ggml_tensor_extra_cl *) tensor->extra;
     GGML_ASSERT(extra);
 
-    CL_CHECK(clEnqueueWriteBuffer(
+    if (clEnqueueWriteBuffer(
         queue, extra->data_device, CL_TRUE, extra->offset + offset,
-        size, data, 0, NULL, NULL));
+        size, data, 0, NULL, NULL) != CL_SUCCESS) {
+        throw_set_tensor_upload_error("clEnqueueWriteBuffer", tensor->name);
+    }
 
     ggml_opencl_gemv_audit_stash_generic(extra, tensor, data, offset, size);
 
```

---

## 3. Converted sites, left sites, and the leak question

### 3.0 Addendum to section 1 (found while doing this analysis)

`src/llama.cpp:316` `llama_model_load` wraps the whole load in `try { ... std::unique_ptr<llama_model> model_ptr ... } catch (const std::exception & err)`
(`:374-376`, logs `error loading model: <what>`). So a load-time throw from `set_tensor` is caught THERE and returned as `{-1, nullptr}`; it becomes
`model == NULL` -> `rn-llama.cpp:102-104  if (owner.governor_prefill_init == nullptr || ...model() == nullptr) return fail("accelerator_model_load", 0, "accelerator model load failed")`
-> the same `KALSA_GOVERNOR_FALLBACK` marker (`rn-llama.cpp:63-69`) -> the same JS CPU retry. The `catch` at `rn-llama.cpp:97-101` handles throws raised outside
`llama_model_load` (context init, params). Both routes end in the same existing channel; section 1's step-10 wording ("reaches the rn-llama catch") was imprecise for
this hop - the throw reaches the `llama.cpp:374` catch first. Nothing else in section 1 changes.

### 3.1 The ten sites from the order - all converted, none fall outside the upload path

Old line numbers in the order map 1:1 to the prior `gpufit` report's checkout; at ref `1068eb03d` they are the ten helper-assert sites, all inside
`ggml_backend_opencl_buffer_set_tensor`, all under `#ifdef GGML_OPENCL_SOA_Q` which this fork defines unconditionally (`ggml/src/ggml-opencl/CMakeLists.txt:20`),
none nested under `GGML_OPENCL_USE_ADRENO_KERNELS` (checked per-site with an ifdef-stack walk). Runtime reachability: each fires iff the model contains that
quant type (the installed S23 model's tensor types were not inspected in this task - no model file here).

| order line | line at 1068eb03d | branch | converted at (final) |
|---|---|---|---|
| 10816 | 11061 | Q4_0   | 11076 |
| 11126 | 11371 | Q4_1   | 11400 |
| 11256 | 11501 | Q5_0   | 11532 |
| 11418 | 11663 | Q5_1   | 11702 |
| 11569 | 11814 | MXFP4  | 11855 |
| 11678 | 11923 | Q8_0   | 11966 |
| 11778 | 12023 | IQ4_NL | 12070 |
| 11859 | 12104 | Q4_K   | 12153 |
| 12063 | 12308 | Q5_K   | 12364 |
| 12251 | 12496 | Q6_K   | 12562 |

Plainly: **zero of the ten fall outside the upload path.** What falls outside it (and is therefore left, section 3.4) is the `get_tensor` download side and the
init/compute paths - none of those were in the order's list of ten.

### 3.2 All 30 converted sites (final line numbers)

| # | lines | what fails | was |
|---|---|---|---|
| 10 | 11076, 11400, 11532, 11702, 11855, 11966, 12070, 12153, 12364, 12562 | `ggml_cl_create_temp_upload_buffer` returned NULL (Q4_0/Q4_1/Q5_0/Q5_1/MXFP4/Q8_0/IQ4_NL/Q4_K/Q5_K/Q6_K) | `GGML_ASSERT` |
| 4 | 10985 (Q1_0), 12789 (Q2_K), 12872 (Q3_K), 12956 (BF16) | raw staging `clCreateBuffer` failed | `CL_CHECK(err)` |
| 6 | 10991 (Q1_0, +release), 11195/11199 (Q4_0 hd/hq, +release), 12794/12877 (Q2_K/Q3_K, +release), 12983 (generic f16/f32 write) | `clEnqueueWriteBuffer` of weight data failed | `CL_CHECK(...)` |
| 5 | 11610, 11614 (Q5_0), 12021 (Q8_0), 12465, 12469 (Q5_K) | derived scale/min `clCreateBuffer` failed | `CL_CHECK(err)` |
| 5 | 11363, 11373 (Q4_0), 12235 (Q4_K), 12330, 12450 (Q4_K/Q5_K) | weight `clCreateImage` (1D-buffer views) failed | `CL_CHECK(...)` |

("+release" = the one-line leak fix of section 3.3 included.)

### 3.3 The leak question - honest answer

**Before the leak fix: yes, five sites leaked.** At the write-fail sites (Q1_0, Q4_0 d, Q4_0 q, Q2_K, Q3_K; the generic write at 12983 has no allocation of its
own), the staging buffer `data_device` had been created successfully and nothing owned it at throw time: it leaked `ggml_nbytes(failing tensor)` of device memory
plus the handle. The OpenCL context is process-lifetime ("The devices live as long as the process, so do the contexts", `ggml-opencl.cpp:1333`), so the leak WOULD
have been inherited by the same-process CPU retry. Bounded: the first throw ends the load, so at most ONE tensor's staging buffer per failed load (the failing
tensor's size - for a large expert/lm_head tensor that is tens of MB; exact size not measured, no model file in this task).

**Fix (one line per site, same function, as permitted):** `clReleaseMemObject(data_device);` before the throw at those 5 sites - deliberately a plain call, not
`CL_CHECK`, because a failing release must not abort on the failure path. Applied and recompiled (section 5, exit 0).

**Everything else allocated before a throw is released - by existing owners, not by new code:**
- Helper-NULL throws (the ten): the helper releases each partial attempt before its `return NULL` paths (write-fail release at `:10882`, NULLs at
  `:10888/10894/10900`, map/unmap failures release their buffer at `:10893/10899`) - zero leak.
- Scale/min created before a later failure (min fails after scale): stored in the tensor extra, which enters the buffer context's in-use pool at allocation;
  `~ggml_backend_opencl_buffer_context` (`:10024`) deletes every extra and each extra's `reset()` releases its handles (verified `scale`/`min` in
  `~ggml_tensor_extra_cl_q5_0::reset`, `q_img` in `~ggml_tensor_extra_cl_q4_K::reset`).
- Pool and extras are actually destroyed on the throw path because `llama_model_load` (`src/llama.cpp:316-336`) holds the model in a `unique_ptr` inside its
  `try`; the throw is caught at `:374`, after the try-block locals (and thus the weight buffer, buffer context, extras) are destroyed. Net: **post-fix, no
  converted throw site leaks a locally owned allocation**; the failed load's weight pool is freed before the governor retries.
- Residual honesty: if the driver is so broken that even `clReleaseMemObject` fails, that is a device-level failure beyond this change's scope (and the call is
  plain, so it cannot itself abort).

### 3.4 Every remaining abort site in the file, by class (accounting closes: file total 5222 CL_CHECK + 667 GGML_ASSERT)

**Inside `set_tensor` (reachable from a load) - left on purpose:**

| class | count | one-line reason |
|---|---|---|
| sub-buffer carve checks (9 comma-form + 37 two-line `CL_CHECK(err)`) | 46 | sub-buffers alias the already-allocated pool; failure = region/alignment invariant violation, not memory pressure; nothing to reclaim |
| `clSetKernelArg` | 173 | convert-kernel argument setup - execution path, not a staging/upload buffer failure |
| `clEnqueueNDRangeKernel` | 29 | convert-kernel launch - driver execution error, not an allocation |
| `clWaitForEvents` | 29 | convert-kernel completion - a failed kernel leaves inconsistent tensor state, needs its own design, not this fix |
| `clReleaseMemObject` / `clReleaseEvent` | 27 + 3 | success-path releases; aborting on a release error is a pre-existing decision outside this objective |
| `clEnqueueReadBuffer` | 1 | oracle audit readback, debug path |
| image create, oracle-gated (`:11286`, only under `GGML_OPENCL_ORACLE`) | 1 | already non-fatal in the normal path by design (F6 comment); only debug mode aborts |
| `GGML_ASSERT` invariants (extra allocated 13, size math 14, shape/alignment 16, q2_K/q3_K contract 4, bf16 offset 1, `extra` non-null 2, ...) | 51 | programming/API-contract errors, not resource failures; abort is the right response |

**Not reachable from weight upload - left (outside the single objective):**

| class | count | one-line reason |
|---|---|---|
| `get_tensor` download-buffer asserts (`"get_tensor: temp download buffer alloc failed"`) | 15 | readback path, never called during model load (load only writes) |
| `get_tensor` raw staging creates + its kernel CL_CHECKs | remainder of `:12986-14179` | same: readback, not load; converting would change inference-time behavior beyond the order |
| `CL_CHECK` in backend init / program build / `clCreateKernel` / platform probe etc. | file total minus set_tensor's 309 = 4913 | init and compute paths; kernel-BUILD failure already degrades via `kernel_build_failed` -> `alloc_buffer` returns nullptr (`:14224-14227`); a null-program `clCreateKernel` CL_CHECK remains a known pre-existing init abort (documented in the prior governor-audit), not weight upload |
| `ggml_cl_buffer::allocate` CL_CHECK (`:388`) | 1 definition, used in get/compute | temporary work buffers outside the upload path |
| other `GGML_ASSERT` (file total minus set_tensor's 51 = 616) | 616 | init/alignment/arch invariants across the file |

The `CL_CHECK` macro itself (`:67-74`, `GGML_LOG_ERROR` + `GGML_ASSERT(0)`) is unchanged - it is the primitive used by everything left above.

---

## 4. Can any existing test exercise this failure path?

**No. NOT VERIFIED on device.** (No phone is available in this task and I did not touch one; no device behavior is claimed anywhere in this report.)

- `tests/test-opencl-moe-roundtrip.cpp` (the only OpenCL test, `tests/CMakeLists.txt:332`) round-trips `set_tensor`/`get_tensor` on the happy path. It has no way
  to force `clCreateBuffer`/`clEnqueueWriteBuffer` failure, and on this macOS host it cannot even link (section 2). No test in `tests/` mocks or injects
  allocation failure anywhere in the OpenCL backend (grep: no fault-injection hook exists).
- The app-side half IS unit-tested: `kalsa/src/engine/governorRuntime.test.ts:32,54` drives `initWithGovernorFallback` with a failing `init` and asserts the CPU
  retry. That covers "a load error becomes a CPU retry"; it does not cover "OpenCL staging failure becomes a load error".
- What a real test of THIS path needs: (1) a fault-injection point - an env-gated flag inside `ggml_cl_create_temp_upload_buffer` / the staging `clCreateBuffer`
  to fail on the Nth call, or a mock OpenCL ICD; (2) an OpenCL device + driver to run the backend (Adreno, or any GPU/POCL); (3) a small model whose tensors hit
  a SoA branch; (4) assertions that the process survives (no SIGABRT), that `error loading model:` / `KALSA_GOVERNOR_FALLBACK` appears, and that the subsequent
  `n_gpu_layers = 0` load succeeds. I did not add that hook: it would be new machinery the order did not request.

---

## 5. Closeout

- Worktree (left in place as evidence): `/Users/marco/Projects/kalsallama-wt-opencl-degrade`
- Ref/commit: detached worktree created with `git worktree add --detach ... 1068eb03d301a1dcb657f4e6923fe77678e651ee` - the protected ref
  `kalsa-gpu-opencl-v73` resolves to exactly this SHA (verified with `git rev-parse`). **Update (final step):** the change is committed on a new LOCAL branch
  `kalsa-opencl-upload-degrade` = `909243206a6cda520bb4c7b4cfd54bb15075c773`, parent `1068eb03d301a1dcb657f4e6923fe77678e651ee`
  (`git rev-parse kalsa-opencl-upload-degrade^` == `git rev-parse 1068eb03d`). Single-file commit (`ggml/src/ggml-opencl/ggml-opencl.cpp`, +113/-32), message
  states compile-verified only. No push, no tag; the shared dirty tree `/Users/marco/Projects/kalsallama` was not touched.
- Build dir (outside the worktree): `/Users/marco/Projects/kalsallama-wt-opencl-degrade-build`
- Exact object-level compile (run after the final edit, including the leak fix):

```
cd /Users/marco/Projects/kalsallama-wt-opencl-degrade-build
ninja ggml/src/ggml-opencl/CMakeFiles/ggml-opencl.dir/ggml-opencl.cpp.o \
      ggml/src/ggml-opencl/CMakeFiles/ggml-opencl.dir/ggml-opencl-kalsa-diag.cpp.o \
      ggml/src/ggml-opencl/CMakeFiles/ggml-opencl.dir/cl-program-cache.cpp.o
echo $?
```

Result: **0** (7 warnings, all pre-existing, none in the edited regions).
- Apple-host limitation, stated once: linking the full `ggml-opencl` shared library fails on this Mac because Apple's OpenCL 1.2 framework does not export
  `clCreateBufferWithProperties` / `clGetKernelSubGroupInfo`, referenced by UNMODIFIED code; a full Android (NDK) build was not possible here - no NDK on this
  machine. So: compile-verified on host, link and device behavior NOT verified.
