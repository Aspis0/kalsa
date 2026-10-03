# S23 prefill with 1 vs 5 host threads: HTP0 and OpenCL, pp1024 (2026-10-03)

Follow-up to `s23-gpu-host-isolation` (decode: one host thread rests the CPU block). Same kit/GGUF/sampler, S23
unplugged, Kalsa stopped once at start. `llama-bench -p 1024 -n 0 -r 1 -fa 1`, order npu-t5, npu-t1, npu-t5,
npu-t1, gpu-t5, gpu-t1, 60 s tails (`raw/analysis.txt`).

| arm | tok/s | peak CPU / GPU / NSP C |
|---|---:|---|
| NPU t5 | 887.0 / 890.9 | 66.4 / 52.3 / 80.0 ; 60.4 / 49.5 / 83.2 |
| NPU t1 | 891.7 / 892.7 | **56.7** / 49.5 / 89.6 ; **57.1** / 48.3 / 85.2 |
| GPU t5 | 132.9 | 77.8 / 72.5 / 54.1 |
| GPU t1 | 115.3 | **89.9** / 70.5 / 52.9 |

- **NPU prefill: one host thread costs nothing** (892 vs 889 tok/s) and the CPU zones peak ~5-10 C lower.
- **GPU prefill: one host thread is worse** (-13 % speed and a hotter single CPU core, 89.9 C), n=1 per arm. GPU
  prefill keeps its host threads; GPU decode goes to one (decode isolation run: CPU 61-67 C vs 90 C, -30 % speed).
- The heat areas are noise here (an NPU pp1024 takes ~1.1 s); the readout is speed and zone peaks.

Design consequence (step 1 of the owner's plan 2026-10-03): set host threads PER governor context - HTP-pinned
contexts (NPU prefill lane, and NPU decode once it exists) at 1, GPU prefill unchanged. Today both governor contexts
copy the same `owner.params` thread counts (binding `rn-llama.cpp:140-142`, recon luna 332ff775); the engine already
sets threads per context (`llama-context.cpp:1198 set_n_threads`).
