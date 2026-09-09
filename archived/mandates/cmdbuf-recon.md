# CMDBUF RECON — can cl_khr_command_buffer kill the split's dispatch overhead? (web + source, no device)

Measured enemy (K4 N3 + M1 diagnosis): ~60-150ms/token of dispatch/glue overhead —
~1000 kernel launches + 82 synchronous graph splits per token. ML Drift solves this
with a fused executor (months to rebuild). The bounded alternative: OpenCL
cl_khr_command_buffer — record the per-token command sequence ONCE, replay with one
enqueue per token.

## Questions (web + fork source; every claim with URL or file:line)

1. Do Adreno drivers expose cl_khr_command_buffer (or cl_qcom equivalents:
   recordable queues)? Which driver/compiler versions — specifically our 740
   (0676.73/E031.41) and 750 (0762.36/E031.45)? Evidence: clinfo dumps online,
   Qualcomm OpenCL SDK docs, Adreno GPU developer guides.
2. Upstream llama.cpp: any work/PRs/issues on command buffers or dispatch-overhead
   reduction in ggml-opencl? (search: command_buffer, recordable, enqueue overhead,
   graph replay OpenCL.)
3. Feasibility map in OUR fork: in ggml-opencl.cpp, is the per-token command stream
   stable across tokens (same kernels/args except buffer offsets/KV positions)?
   Which args change per token (file:line: the set_arg sites for positions/masks)?
   cl_khr_command_buffer supports mutable dispatch (cl_khr_command_buffer_mutable_dispatch) —
   is THAT exposed on Adreno?
4. Fallback if no driver support: estimate of win from (a) fusing elementwise chains
   (count ops per layer from K0 report — how many launches can realistically merge),
   (b) reducing graph splits by pinning small glue ops CPU-side vs GPU-side.
5. VERDICT: FEASIBLE(driver+scope) / FEASIBLE_PARTIAL(fusion only) / DEAD, with the
   single best entry point and an honest week-estimate.

PC/web only. Deliverables: reports/research-cmdbuf.md + task report ending DONE.
