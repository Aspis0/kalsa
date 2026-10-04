# Code recon for the one-copy three-leg integration (luna b737b01b, 2026-10-04)

Quoted lines in the agent's report; file:line below are its citations (engine = kalsallama-wt-ci bc5f0207c,
binding = llama.rn-kalsa-gov-platform, app = kalsa-wt-gov).

- `feat/governor-onecopy` (S1/S2, on hold) targeted shared RAW Q4_0 and the binding still loads two models
  (`cpp/rn-llama.cpp:277-301`); "one llama_model with two contexts" is not implemented anywhere.
- HTP: Q4_0 `set_tensor` -> `repack_q4_0_tiled` (`ggml-hexagon.cpp:1960-1964`); allocation `rpcmem_alloc2` + fd
  (`:597-609`); the device buffer type is NOT host (`:2377-2384`); HTP supports only its own bufts (`:8018-8024`).
- Scheduler: "highest prio backend that supports the buffer type and the op" (`ggml-backend.cpp:894-898`);
  op_offload from WEIGHTS buffers (`:967-978`). A per-context backend override for the same weight buffer: not
  found.
- CPU hook: `CPU_REPACK` extra buffer type (`ggml-cpu/repack.cpp:5780-5828`, `supports_op`, tensor traits) - the
  pattern for a "tiled HTP weights" CPU route.
- OpenCL hook: `ggml_backend_opencl_device_supports_buft` rejects foreign bufts and requires the same cl_context
  (`ggml-opencl.cpp:14912-14923`); the dma-buf importer exists only on the spike.
- Ship GGUF non-Q4_0 census: not found (tied Q6_K embedding/lm_head known from ALIVE ~916; F32 norms likely).
- Binding: no mmap setting today; lane forces equal K/V types on both contexts (`rn-llama.cpp:178-195`);
  `decode_repack=false` -> `no_extra_bufts` (`:257-259`).
- Device identification: app `governorInputs.ts:116-120` maps SM8550->V73, SM8650->V75, SM8750->V79 (no V81 in the
  type); engine skels 73/75/79/81; GPU-prefill allow-list V73/V75/V79 duplicated in app and engine
  (`governorInputs.ts:323-327`, `llama-governor-policy.cpp:301-307`); NPU lane default OFF, auto gate arch>=73.
  CPU feature (dotprod/i8mm) and Adreno-model detection: not found in the governor inputs.
- Evidence per leg on the tiled copy: S23 only (CPU, GPU; NPU native). Xiaomi 14, 8 Elite, SM8850, Jelly: none.
