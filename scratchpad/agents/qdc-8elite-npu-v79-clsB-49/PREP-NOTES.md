# PREP NOTES

Repo: `/Users/marco/Projects/kalsallama`  
Branch: `kalsa/npu-judge-v79`  
Base verified: `153fdbafd`  
Commit: `ca82efa8bb94b98967f34434139da81fd4682f1e`

## DMA verification

`matmul-ops.c` sets quantized HMX DMA parameters as follows:

```c
// matmul-ops.c:2370-2372
const uint32_t dma_dst_stride  = is_quant ? aligned_tile_size : row_stride;
const uint32_t dma_src_stride  = is_quant ? tile_size : weight_stride;
const uint32_t dma_width_bytes = is_quant ? tile_size : row_stride;
```

The weight transfer passes those values to the 2D DMA:

```c
// matmul-ops.c:2425-2427
const uint32_t height_A0 = is_quant ? (n_cols_A0 / 32) * n_k_tiles : n_cols_A0;
dma_queue_push(ctx->dma[0], dma_make_ptr(vtcm_weight_raw[0], weight),
               dma_dst_stride, dma_src_stride, dma_width_bytes, height_A0);
```

`hex-dma.h` writes the strides and copy width directly into the descriptor:

```c
// hex-dma.h:167,185-189
static inline bool dma_queue_push_single_2d(dma_queue * q, dma_ptr dptr, size_t dst_stride, size_t src_stride, size_t row_size, size_t nrows) {
    ...
    desc->src_stride = src_stride;
    desc->dst_stride = dst_stride;
    desc->src        = (void *) dptr.src;
    desc->dst        = (void *) dptr.dst;
    desc->row_size   = row_size;
```

Therefore the pad is really never written: VTCM advances by `aligned_tile_size`, while each row copies only `tile_size`. `matmul-ops.h` sizes are q4_0/iq4_nl 576 -> 640, q8_0 1088 -> 1152, mxfp4 544 -> 640; q4_1 is 640 -> 640 and is skipped.

## Diffs

```diff
diff --git a/ggml/src/ggml-hexagon/htp/matmul-ops.c b/ggml/src/ggml-hexagon/htp/matmul-ops.c
index 1683131a8..58762cbb6 100644
--- a/ggml/src/ggml-hexagon/htp/matmul-ops.c
+++ b/ggml/src/ggml-hexagon/htp/matmul-ops.c
@@ -2136,6 +2136,15 @@ static void transfer_output_chunk_scattered_worker_fn(unsigned int n, unsigned i
 
 // --- HMX Dispatchers & Entry Points ---
 
+#ifdef HTP_ZERO_TILE_PAD
+static inline void htp_zero_weight_tile_pad(void * weights, size_t n_tiles, size_t tile_size, size_t aligned_tile_size) {
+    uint8_t * weight_bytes = (uint8_t *) weights;
+    for (size_t i = 0; i < n_tiles; ++i) {
+        memset(weight_bytes + i * aligned_tile_size + tile_size, 0, aligned_tile_size - tile_size);
+    }
+}
+#endif
+
 static void dequantize_tiled_weight_chunk_to_fp16_tiles(
         struct htp_context *ctx, __fp16 *vtcm_dst,
         const void *weight_src_ddr,
@@ -2352,6 +2361,12 @@ static int hmx_mm_2d_f32(struct htp_context *ctx,
     const size_t vec_dot_size = k * sizeof(__fp16);
     const size_t vtcm_budget  = ctx->vtcm_size;
 
+#ifdef HTP_ZERO_TILE_PAD
+    if (is_quant && tile_size < aligned_tile_size) {
+        FARF(HIGH, "hmx-mm: zero-pad active");
+    }
+#endif
+
     const uint32_t dma_dst_stride  = is_quant ? aligned_tile_size : row_stride;
     const uint32_t dma_src_stride  = is_quant ? tile_size : weight_stride;
     const uint32_t dma_width_bytes = is_quant ? tile_size : row_stride;
@@ -2429,6 +2444,12 @@ static int hmx_mm_2d_f32(struct htp_context *ctx,
                 // 1. pop A_i
                 void * curr_raw = dma_queue_pop(ctx->dma[0]).dst;
 
+#ifdef HTP_ZERO_TILE_PAD
+                if (is_quant && tile_size < aligned_tile_size) {
+                    htp_zero_weight_tile_pad(curr_raw, (size_t) (n_cols / 32) * n_k_tiles, tile_size, aligned_tile_size);
+                }
+#endif
+
                 // 2. dequantize A_i
                 dequantize_tiled_weight_chunk_to_fp16_tiles(
                     ctx, vtcm_weight_bufs[i % 2], curr_raw,
@@ -2497,6 +2518,12 @@ static int hmx_mm_2d_f32(struct htp_context *ctx,
                 // A: Wait for weight DMA
                 void * curr_raw = dma_queue_pop(ctx->dma[0]).dst;
 
+#ifdef HTP_ZERO_TILE_PAD
+                if (is_quant && tile_size < aligned_tile_size) {
+                    htp_zero_weight_tile_pad(curr_raw, (size_t) (n_cols / 32) * n_k_tiles, tile_size, aligned_tile_size);
+                }
+#endif
+
                 // B: Weight Dequantize (Threaded)
                 dequantize_tiled_weight_chunk_to_fp16_tiles(
                     ctx, vtcm_scratch0, curr_raw,
@@ -2876,6 +2903,12 @@ static int hmx_mm_id_2d_f32(struct htp_context *ctx,
     const uint32_t dma_src_stride  = is_quant ? tile_size : weight_stride;
     const uint32_t dma_width_bytes = is_quant ? tile_size : row_stride;
 
+#ifdef HTP_ZERO_TILE_PAD
+    if (is_quant && tile_size < aligned_tile_size) {
+        FARF(HIGH, "hmx-mm: zero-pad active");
+    }
+#endif
+
     const size_t qweight_row_stride = is_quant ? (size_t)(n_k_tiles * aligned_tile_size) / 32 : 0;
     const size_t weight_row_stride = is_quant ? qweight_row_stride : row_stride;
 
@@ -2938,6 +2971,12 @@ static int hmx_mm_id_2d_f32(struct htp_context *ctx,
             // A: Wait for weight DMA
             void * curr_raw = dma_queue_pop(ctx->dma[0]).dst;
 
+#ifdef HTP_ZERO_TILE_PAD
+            if (is_quant && tile_size < aligned_tile_size) {
+                htp_zero_weight_tile_pad(curr_raw, (size_t) (n_cols / 32) * n_k_tiles, tile_size, aligned_tile_size);
+            }
+#endif
+
             // B: Weight Dequantize (Threaded)
             dequantize_tiled_weight_chunk_to_fp16_tiles(
                 ctx, vtcm_scratch0, curr_raw,
diff --git a/tests/test-backend-ops.cpp b/tests/test-backend-ops.cpp
index 068df605a..74d7de55d 100644
--- a/tests/test-backend-ops.cpp
+++ b/tests/test-backend-ops.cpp
@@ -9920,6 +9920,8 @@ static std::vector<std::unique_ptr<test_case>> make_test_cases_eval() {
     test_cases.emplace_back(new test_falcon(2));
 #endif
 
+    const bool extra_mm_first = ggml_test_env_on("GGML_TEST_EXTRA_MM_FIRST");
+    std::vector<std::unique_ptr<test_case>> extra_mm_cases;
     const char * extra_mm_env = getenv("GGML_TEST_EXTRA_MM");
     if (extra_mm_env && extra_mm_env[0] != '\0') {
         const size_t extra_mm_len = strlen(extra_mm_env);
@@ -9952,7 +9954,17 @@ static std::vector<std::unique_ptr<test_case>> make_test_cases_eval() {
                 exit(1);
             }
 
-            test_cases.emplace_back(new test_mul_mat(type, GGML_TYPE_F32, m, n, k, {1, 1}, {1, 1}));
+            extra_mm_cases.emplace_back(new test_mul_mat(type, GGML_TYPE_F32, m, n, k, {1, 1}, {1, 1}));
+        }
+    }
+
+    if (extra_mm_first) {
+        for (auto it = extra_mm_cases.rbegin(); it != extra_mm_cases.rend(); ++it) {
+            test_cases.insert(test_cases.begin(), std::move(*it));
+        }
+    } else {
+        for (auto & extra_case : extra_mm_cases) {
+            test_cases.emplace_back(std::move(extra_case));
         }
     }
 
```

## Smoke

CPU-only scratch build: `/tmp/kalsa-npu-v79-cpu.Dwh09U`.

- Corrected CPU-only configure: exit 0.
- `cmake --build ... --target test-backend-ops -j2`: exit 0.
- Support smoke, no extra: exit 0, 1 matching `MUL_MAT` header.
- Support smoke, `GGML_TEST_EXTRA_MM` set and FIRST unset: exit 0, 2 headers; built-in `m=2880,n=32,k=2880` first.
- Support smoke, `GGML_TEST_EXTRA_MM_FIRST=1`: exit 0, 2 headers; extra `m=1232,n=32,k=2888` first.
- Direct test-mode smoke: exit 134 from the pre-existing `ggml-backend.cpp:334` tensor-write assertion while initializing `test_cumsum`, before operation filtering. Support mode avoids initialization and verifies the requested eval-list order.

The default path is guarded off: all DSP additions, including the helper, calls, and FARF line, are inside `#ifdef HTP_ZERO_TILE_PAD`; no default CMake define was added. Careful diff review confirms no default executable code change.

## HTP v79 skels

Stock final artifact:

`build-snapdragon/ggml/src/ggml-hexagon/libggml-htp-v79.so`  
SHA-256: `afa7ef81355eb309b533033d4fc5d16a5e49daa98215945051ad0a0720f938d1`

Diagnostic artifact:

`build-snapdragon/npu-v3-stage/libggml-htp-v79-zeropad.so`  
SHA-256: `398879cc6c7e02b5b9d943d0f64c453a446150b4c0c2000edc41d8c2b830ca5b`

Builds, all in `ghcr.io/snapdragon-toolchain/arm64-android:v0.7`:

1. Stock, exit 0:

   ```sh
   docker run --rm -v /Users/marco/Projects/kalsallama:/workspace -w /workspace ghcr.io/snapdragon-toolchain/arm64-android:v0.7 bash -c "cmake --build build-snapdragon --target htp-v79"
   ```

2. Zeropad, exit 0: fresh inner build at `/tmp/htp-v79-zeropad-build`; `grep` confirmed the define in generated `build.ninja`; then the artifact was copied to the requested name.

   ```sh
   docker run --rm -v /Users/marco/Projects/kalsallama:/workspace -w /workspace ghcr.io/snapdragon-toolchain/arm64-android:v0.7 bash -c "cmake -DCMAKE_BUILD_TYPE=Release -DCMAKE_TOOLCHAIN_FILE=/workspace/ggml/src/ggml-hexagon/htp/cmake-toolchain.cmake -DCMAKE_INSTALL_LIBDIR=/tmp/htp-v79-zeropad-build -DHEXAGON_SDK_ROOT=/opt/hexagon/6.6.0.0 -DHEXAGON_TOOLS_ROOT=/opt/hexagon/6.6.0.0/tools/HEXAGON_Tools/19.0.07 -DHEXAGON_HTP_DEBUG=OFF -DDSP_VERSION=v79 -DPREBUILT_LIB_DIR=toolv19_v79 -DCMAKE_C_FLAGS=-DHTP_ZERO_TILE_PAD -GNinja -S /workspace/ggml/src/ggml-hexagon/htp -B /tmp/htp-v79-zeropad-build && grep -F HTP_ZERO_TILE_PAD /tmp/htp-v79-zeropad-build/build.ninja >/dev/null && cmake --build /tmp/htp-v79-zeropad-build --target ggml-htp-v79 && test ! -e /workspace/build-snapdragon/npu-v3-stage/libggml-htp-v79-zeropad.so && cp /tmp/htp-v79-zeropad-build/libggml-htp-v79.so /workspace/build-snapdragon/npu-v3-stage/libggml-htp-v79-zeropad.so"
   ```

3. Stock restore, exit 0: reran the exact stock command above after the copy; output was up-to-date.

The configured checkout places the HTP skel at `build-snapdragon/ggml/src/ggml-hexagon/`, not `build-snapdragon/bin`; `build-snapdragon/bin` had no `libggml-htp-v79.so` to restore.

Surprises: the first CPU configure failed (exit 1) because `GGML_BUILD_TESTS=ON` activates the absent nested `ggml/tests`; the corrected root setting is `GGML_BUILD_TESTS=OFF -DLLAMA_BUILD_TESTS=ON`. Also, the direct test-mode smoke hits the unrelated cumsum assertion before filters run.
