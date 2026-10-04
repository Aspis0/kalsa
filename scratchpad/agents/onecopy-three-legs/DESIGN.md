# One weight copy read by CPU, NPU and GPU (2026-10-04)

Owner, 2026-10-04: one copy that all three legs read is fundamental; the GPU decode leg must not cost a third
copy. Today the shipped binding loads two copies (accelerator + CPU, `cpp/rn-llama.cpp` two
`common_init_from_params`); one-copy exists only on unpushed spikes.

## Where each leg stands on the shared RAW Q4_0 copy (lab evidence)

| leg | decode on raw one-copy vs its own layout | source |
|---|---|---|
| NPU | 15.58 vs 22.10 tok/s (70 %); cause = raw dot on 18-byte strides, not DMA | `s23-onecopy-abba-df538c50c` |
| CPU | 0.60-0.64 of repacked q4_0_4x8; cause = instruction count, not bandwidth | `onecopy-hmx-numerics/REPORT.md` ~405 |
| GPU | ubatch-1 GEMV 77.21 vs 44.14 s/pass (~1.75x slower), plugged = direction only | `onecopy-gpu/REPORT.md` 640-644 |

VTCM relayout of raw rows for the NPU dot: refuted in the simulator (`REPORT-vtcm-relayout.md`).
Raw layout costs every leg.

## Web research (luna 7703fab6, 2026-10-04)

- No published Q4 layout measured near-native on NEON, HVX and Adreno together.
- Closest precedent: HeteroLLM (SOSP 2025, https://www.preprints.org/manuscript/202501.0901) maps NPU shared
  memory into OpenCL ("map the NPU's shared memory to the GPU"), W4A16; it reports engine speed, not
  shared-vs-packed layout speed. It also measures 8 Gen 3 decode bandwidth: one processor 40-45 GB/s, GPU+NPU
  together ~60 GB/s.
- Zero-copy on Adreno: `cl_qcom_dmabuf_host_ptr` / `cl_qcom_ext_host_ptr` (Qualcomm OpenCL guide 80-NB295-11
  §7.4.2: "map into the GPU-accessible memory without incurring extra copy"; plain CL_MEM_USE_HOST_PTR may copy).
  Padding per `CL_DEVICE_EXT_MEM_PADDING_IN_BYTES_QCOM`; our spike already imports one dma-buf (S23 max alloc
  884 MB per cl_mem, so the weights are split over several imports).
- llama.cpp docs: "all DDR buffers are accessible by CPU, GPU, and NPU"; 128-byte aligned strides for HVX.
- Other engines (PowerInfer-2, mllm/llm.npu, MNN, ExecuTorch/QNN, MLC, Genie) share graphs or IO buffers, or
  keep per-backend layouts; none shares one weight buffer across all three.

## Design: the shared copy is the NPU's own tiled layout

The NPU is the primary decode leg (lowest heat per token) and the prefill engine (HMX), so the shared copy is the
layout the NPU already runs at full speed: `repack_q4_0_tiled` (`ggml-hexagon.cpp` ~883): 32 rows x 32 K per
tile, 512 quant bytes stored K-pair-major with the 32 rows contiguous, then 32 fp16 row scales. Same 18 bytes per
32 weights as Q4_0. NPU prefill and decode then run at two-copy speed by construction; CPU and GPU (the relief
legs) each get a batch-1 mat-vec that reads the tiles in place. The tile is row-interleaved, the same principle
as the Adreno SoA path (rows coalesced) and the CPU 4x8 repack (several rows per activation load), so neither is
asked to read a hostile layout.

## Steps (each gated by a number, cheapest first)

1. CPU: NEON dotprod mat-vec on the tiled layout vs repacked 4x8 vs raw, Mac then S23 (coder afef390d,
   branch `spike/onecopy-cpu-gemv`). Gate: tiled within ~10 % of repack.
2. GPU: OpenCL mat-vec on the tiled layout read through the existing dma-buf import (`spike/onecopy-gpu-rawq4`)
   vs the Adreno SoA path, S23 unplugged. Gate: within ~15 % of SoA.
3. Wire: the HTP rpcmem buffer is the single copy; CPU and GPU backends dispatch their tiled readers for it;
   no-mmap loading (owner decision already implied by one-copy); governor drops the second model load.
