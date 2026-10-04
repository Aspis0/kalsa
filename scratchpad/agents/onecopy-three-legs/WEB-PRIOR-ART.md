# Prior art for one weight copy read by CPU+GPU+NPU (web research, luna 249cf9c4, 2026-10-04)

Every line below was quoted from its source by the researcher; URLs kept for re-checking.

## Key finding
Nobody we found shares ONE WEIGHT copy across CPU, GPU and NPU. HeteroLLM/HeteroInfer (SOSP 2025, SJTU IPADS,
https://ipads.se.sjtu.edu.cn/zh/publications/sosp25-chen.pdf, full text
https://www.preprints.org/frontend/manuscript/9467916cff347f1f274406f41e2e95b1/download_pub) shares a reusable pool
of operator INPUT/OUTPUT tensors ("a dedicated memory pool ... for allocating the input and output tensors") and maps
NPU shared memory into OpenCL with CL_MEM_USE_HOST_PTR. No public artifact (the "HeteroInfer" GitHub repo is an
unrelated virology tool).

## HeteroInfer numbers worth keeping (Snapdragon 8 Gen 3)
- clEnqueueWriteBuffer fixed latency ~400 us; GPU<->NPU sync >= 400 us; queue submission 50-100 us after a sync,
  10-20 us otherwise; usleep granularity 80-100 us. Fast sync: reuse mapped buffers, predict GPU kernel time,
  sleep, then poll a flag next to the output tensor for a few us.
- Bandwidth: one processor 40-45 GB/s, GPU+NPU together ~60 GB/s of a 68 GB/s peak (decode 43.3 -> 59.1 GB/s).
- NPU graphs are static; dynamic-shape pieces go to the GPU. GPU-heavy inference dropped a concurrent game to
  0 FPS; they leave GPU headroom for rendering.

## Related systems
- llm.npu/mllm (ASPLOS 2025): prefill chunks on NPU, outliers on CPU/GPU, shared buffers for intermediates;
  "does not consider resource detection and contention"; duplicated outlier weights cost memory.
- PowerInfer-2: dense clusters on NPU, sparse on CPU; needs predictable sparsity; not shared-weight.
- MNN-LLM: per-backend weight rearrangement; DRAM-Flash hybrid storage.
- ExecuTorch QNN: unsupported ops fall back to CPU; Qualcomm backend "verified with SM8550 and SM8450".
- Genie: Hexagon v73+ floor, per-model-card device lists.

## Pitfalls to design against
- Unified addressing is not coherence: Qualcomm OpenCL guide - "atomic or fence is required" for fine-grain
  sharing; the QCOM ext-host-ptr extension requires the cache policy to match the host allocation.
- CL_DEVICE_MAX_MEM_ALLOC_SIZE: 884 MB on our S23, 1024 MB on an Adreno 830 (llama.cpp #16217, where OpenCL decode
  was also slower than CPU) - split per runtime limit, benchmark per device/driver.
- FastRPC: llama.cpp maps rpcmem fds with fastrpc_mmap and throws on failure; ~3.5 GB session VA window.
  #26123: `dspqueue_read failed: 0x2e` on 8 Gen 2 v73 above a context threshold - test model/context thresholds.
- Android 12+ GKI: ION replaced by per-heap DMA-BUF devices, heap access sepolicy-controlled; libdmabufheap
  supports both.
- PSS/LMK accounting of imported dma-bufs is vendor-dependent: measure PSS/RSS and dma-buf sysfs stats per phone.

## Device gating practice
Results are tied to tested devices everywhere (HeteroInfer: 8 Gen 3; llm.npu: Redmi K60/K70 Pro). A v73+ floor is
not validation. Gate each leg on chipset/arch AND a runtime self-test of the exact path (import, coherency,
correctness, speed), with CPU fallback.

## COPY
reuse persistent mappings; predict-then-poll sync if two units ever run concurrently; split allocations by the
runtime limit; matching cache policy + explicit handoff sync; CPU fallback per op/device; support ION and
DMA-BUF heaps.
## DON'T
equate shared addressing with coherence; equate zero-copy I/O with one weight copy; assume concurrent GPU+NPU wins
without contention/sync cost; treat "v73+" or "accelerator detected" as validated; assume dma-buf memory
accounting is the same on every vendor.
