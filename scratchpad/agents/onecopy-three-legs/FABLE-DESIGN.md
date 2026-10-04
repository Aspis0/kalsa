# One copy, three legs: integration design (Fable, independent view, 2026-10-04)

Ground truth read: `DESIGN.md`, `REPORT.md`, ALIVE "Governor one-copy is gated on speed" (~865-905), engine
`feat/governor-onecopy` b39a45be7 (`htp-admit.h`, `ggml-backend.cpp` 966-984, `llama-ext.h` 163-175),
`spike/onecopy-gpu-rawq4` 0285aae40..e3d3c32f4 (probe only, 23 files under `tests/opencl-q4_0-raw/`, no backend
change), `spike/onecopy-cpu-gemv` 3ae7a8ea3..4e6c75252 (`ggml-cpu/arch/arm/gemv-tiled-q4_0.{h,cpp}`, "no ggml
dispatch reaches it"), engine main bc5f0207c (`ggml-backend.cpp:888-908`, `ggml-cpu.cpp:489-491`,
`ggml-opencl.cpp:9103,14912-14928`, `ggml-hexagon.cpp:646,697,8018-8025`, `llama-governor.cpp:300-345`),
binding `cpp/rn-llama.cpp:140-300`, `RNLlama.java:25-45,217-230,374-400`, app `src/engine/governorInputs.ts:117-128`.

## 0. What the evidence supports and what it does not

- GPU: v4 reads the tiles zero-copy at per-layer parity (gate+up+down+in_proj: 0.938 ms tiled vs 0.945 SoA; the
  aggregate parity is not an artefact of equal-weighting attn_k). Proved: alias, cache-cold order, nonzero offset.
- CPU: 0.71-0.87 of repack 4x8, bit-identical. **The shipped S23 baseline is not repack**: with the NPU lane on the
  binding sets `decode_params.no_extra_bufts = true` (`rn-llama.cpp:245-247`, "~1.4x CPU decode cost"), i.e. the
  generic `ggml_vec_dot_q4_0_q8_0` path at ~0.71 of repack. The spike's `raw` arm is its own 2-row kernel, not that
  path, so the honest baseline is missing. Expectation: tiled >= today's S23 CPU decode. Verify in step 1.
- NPU "two-copy speed by construction" is **unmeasured**: the tiled-HOST arm (`GGML_HEXAGON_HOSTBUF_REPACK`,
  `ggml-hexagon.cpp:2017-2025` on b39a45be7) never executed (`-lm none` skipped `set_tensor`, memory note). HOST and
  device buffers come from the same rpcmem heap with the same flags (ctor at :557-562 vs :697), and the ABBA run showed
  the raw gap was the dot, not the memory, so it is plausible, not proven. Step 2 measures it first.
- Nothing is measured end to end: every number is one mat-vec in isolation. The GPU leg will also run norms, SSM_CONV,
  GET_ROWS and the Q6_K lm_head (`token_embd` 2048x128000, 4.8 ms/token on the DSP census) somewhere.

## (a) Engine mechanism

**A1. The layout becomes a ggml contract, not a Hexagon secret.** New private header `ggml/src/ggml-q4_0-tile32.h`:
tile geometry (32 rows x 32 K, 512 quant bytes K-pair-major rows-contiguous, 32 fp16 scales, 576 B; rows and K padded
to 32), `ggml_q4_0_tile32_nbytes(ne0, ne1)`, the packer (moved from `repack_q4_0_tiled`, `ggml-hexagon.cpp:827`,
Hexagon calls the shared one) and a scalar reference dot. Host test: pack random Q4_0, compare byte-for-byte with the
old packer kept in the test, reference dot vs `ggml_vec_dot_q4_0_q8_0` within fp32 fold error.

**A2. One generic marker so no backend can misread tiles as Q4_0.** `ggml-backend-impl.h`: optional buft hook
`enum ggml_weight_layout (*get_weight_layout)(buft)` (NULL = native) and accessor `ggml_backend_buft_weight_layout`.
Only the Hexagon HOST buft returns `GGML_WEIGHT_LAYOUT_Q4_0_TILE32`. Rule enforced in all three `supports_op`: an op
whose weight source sits in a TILE32 buffer is supported only by that backend's tile reader (MUL_MAT, src0 Q4_0,
ne0 % 32 == 0); every other op/type in that buffer is native layout (f32 norms, conv weights) and is read as today.
This is the fix for the trap the HOSTBUF_REPACK comment names ("CPU reads are invalid"). Alternative rejected: buft
name matching, or ggml-cpu looking up a Hexagon proc address (cross-backend dependency; untestable without a DSP).

**A3. Placement at load (Hexagon side, mostly exists).** One-copy mode = the HOST buft is the first buft of the list
(`llama-model.cpp:1081-1088` already adds the first device's host buft) and Q4_0 MUL_MAT weights are diverted to it
(`ggml_hexagon_raw_onecopy_diverts_weight`, b39a45be7 :2211). `host_buffer_set_tensor` packs tiles (the
`opt_hostbuf_repack` branch, made the only branch) and flags `WEIGHT|REPACK` so the DSP runs its tiled kernels
unchanged. R1 placement is the default, not an `-ot` string: `token_embd` (Q6_K, tied, 205 MiB) in the CPU buffer,
norms and shortconv weights in HOST native layout (CPU and HTP both read them; HTP via admission `MUL_WEIGHT`/`SSM_CONV`).
`get_alloc_size` already pads (:2100-2110). Loader passes `use_mmap = false` (loader :1264 would otherwise move the
weights to plain CPU memory). The env knobs `GGML_HEXAGON_HOSTBUF`/`HOSTBUF_REPACK`/`RAW_HMX` become one setter reached
by proc address, `ggml_backend_hexagon_set_shared_weights(bool)`, called by the binding before the model load; env
stays as a seed for the CLI tools only. Reason: env is parsed once at registry creation (`ggml_hexagon_init`), a
process that already loaded a model cannot flip it.

**A4. A leg is a context's backend set, not a device-global admission.** Fork field
`llama_context_params.leg_devices` (NULL-terminated `ggml_backend_dev_t *`; NULL = `model.devices`, today's
behaviour). `llama_context::llama_context` builds its backends from it (today: from `model.devices`), the graph
callback's norm pin (`graph_get_cb`) iterates the context's backends so it needs no change, and the KV buft follows
the context's first leg device instead of `model.dev_layer(il)` (one rule in `llama-kv-cache.cpp`, same place the
binding comment at `rn-llama.cpp:176-178` describes). Legs on the S23:
- NPU leg `{HTP0, CPU}`: KV on HTP (rpcmem, host-addressable as today); HTP takes every tiled MUL_MAT, HMX/flat as now.
- GPU leg `{OpenCL, CPU}`: OpenCL takes tiled MUL_MATs with ne11 == 1 (v4 kernel) and nothing else from the shared
  buffer; CPU takes norms, SSM_CONV, GET_ROWS, lm_head and attention; KV on the CPU buffer in v1 (keeps the commit a host
  memcpy, see b). Measured cost of the CPU share: unknown (e3).
- CPU leg `{CPU}`: the CPU tile reader for every Q4_0 MUL_MAT (decode and, slowly, prefill), everything else as today.
Why not the S1/S2 admission generation: it is per device, forces every context on the device to re-reserve (0.1 s on
the S23 per `llama-ext.h:170`), and cannot express "GPU takes this op" at all. Keep S1's predicates (`htp-admit.h`)
only for the NPU leg's own batch gates (offload_min for host weights); drop the generation counter and the
`1.host` scheduler branch unless step 5 shows a need.

**A5. Routing is the stock scheduler; copies are forbidden, not avoided by luck.** With leg backends `{X, CPU}`,
`ggml_backend_sched_backend_from_buffer` (:888-908) gives a weight op to the first backend with
`supports_buft(HOST) && supports_op`. OpenCL must answer `supports_buft(HTP0-HOST) = true` when it holds an import for
that buffer (today :14912-14928 refuses every foreign buft) and `supports_op` per A2; CPU already accepts host bufts
(:489-491). If no backend supports an op the scheduler silently copies the weight into a split input (`:903` debug
only). Fork guard: in `ggml_backend_sched_split_graph`, a split input whose buffer usage is WEIGHTS is a hard failure
(`GGML_ABORT` behind a fork define on by default in Kalsa builds, message names the tensor and op). The binding turns
that reserve failure into "one-copy unavailable, fall back".

**A6. OpenCL import (the only new backend plumbing).** Per shared *buffer* (not per tensor) one dma-buf import, the
mechanism the spike proved (`tests/opencl-q4_0-raw/dmabuf.c`, S23 884 MB per `cl_mem`: assert Hexagon
`max_bufsize` <= `CL_DEVICE_MAX_MEM_ALLOC_SIZE`, else the GPU leg is off). The import is created lazily at
`supports_buft` time? No: at the first `set_tensor`-free event the backend sees, i.e. a reg proc-address call from the
binding after load, `ggml_backend_opencl_import_shared(buffer)`, which also publishes the CPU writes once
(`DMA_BUF_IOCTL_SYNC` end-write, `dmabuf_publish`) and runs the spike's alias check; failure = import released, GPU leg
off, one log line. Per tensor, two image1d views (uint4 quants, half scales) at the tensor's offset, built at import
time into a side table `buffer -> {cl_mem, base, views by tensor}`; `tensor->extra` stays Hexagon's (every OpenCL op
casts `src0->extra` to `ggml_tensor_extra_cl`, :9103 and 4 more, hence A2's refusal of all other ops). Kernel file
`mul_mv_q4_0_f32_tiled_v4.cl` moves from the probe into `kernels/` unchanged; its op count comment is the model.

## (b) Binding and governor

- `load_governor_models` (`rn-llama.cpp:140-300`): when the table says one-copy, ONE `common_init_from_params`
  (devices `{HTP0}`, `n_gpu_layers 99`, `use_mmap false`, `no_extra_bufts true`, shared weights on), no second load; the
  `decode_repack` knob is meaningless here and is logged as such. The two-model branch stays as the fallback path for
  untested phones, byte for byte.
- `llama_governor_init_with_params_internal(prefill_model, decode_model, ...)` gains the one-model form: one model,
  N leg context params (each with `leg_devices`), legs named by `llama_governor_engine` (CPU/GPU/NPU already exist).
  `ctx_prefill` = NPU leg, `ctx_decode` = CPU leg, new `ctx_gpu`; `side_state` per leg.
- The ONE hop place stays `llama-governor.cpp:300-345`: `target = leg_ctx(decode_engine_)`; the direction label gains
  the GPU names; `commit_side(last_ctx, target)` is the unchanged KV mirror. KV types forced equal on all legs as today
  (`decide_governor_lane_kv`); the GPU leg's KV on the CPU buffer keeps the commit a memcpy. The decision WHY (heat per
  token, NSP relief, short GPU bursts) lives in `llama-governor-policy.cpp` next to the v1 headroom rule; the WHEN is
  the window counter already there. No second decision site.
- Prefill routes unchanged: NPU on the NPU leg; the LOWBAT CPU route now runs the CPU tile reader at ubatch size
  (correctness path, speed unknown: e4). GPU prefill stays off on one-copy devices (owner 03/10).

## (c) Capability table

One file, `cpp/rn-legs-table.cpp`, pure function `legs_for(const hw_facts &) -> leg_set`, host-tested. Facts read
in-process at load, never from Java regex hints (`RNLlama.java:33-40` decide which .so loads, nothing more):
- SoC: `__system_property_get("ro.soc.model")` ("SM8550") and `ro.board.platform` ("kalama").
- Hexagon: arch from the HTP device description (`"Hexagon v73"`, `ggml-hexagon.cpp:7651-7652`), only if the device
  registered (skel present: :8444-8446).
- GPU: OpenCL device description (`Adreno(TM) 740`) and driver string (`OpenCL 3.0 QUALCOMM build: 0676.73 Compiler
  E031.41.03.62`, lab oracle_consumer_s23) via `ggml_backend_dev_description`/a reg proc address for the driver string.
- CPU: `getauxval(AT_HWCAP) & HWCAP_ASIMDDP` (the tile reader is sdot); i8mm not required.
Rows today: exactly one. `SM8550 + v73 + Adreno 740 + E031.41.* + dotprod -> {NPU, GPU, CPU-tiled}, one-copy`.
Match rules: SoC and Hexagon arch exact; Adreno model exact; driver compiler major.minor exact (a firmware update
switches the GPU leg off, NPU+CPU one-copy stays on); no dotprod = no one-copy at all. Any other phone, or any fact
unreadable: `one_copy = false`, today's loads (Jelly: CPU-only; untested Snapdragons: two-copy as now).
Runtime demotions at load, logged once each: GPU alias check fails or import refused -> GPU leg off; per-leg numeric
self-check on one real `ffn_down` row (CPU tile reader must equal the reference bit-for-bit, GPU within 1e-5 of output
RMS) fails -> that leg off. Future rows (Xiaomi 14 SM8650/v75/Adreno 750, QDC SM8750/v79/Adreno 830) are added only
with a report in the lab; the table never infers from a family.

## (d) Steps and validation (each: host test green -> one S23 check -> audit -> next)

| step | change | host test | S23 check (unplugged, >= 30 %, screen on) |
|---|---|---|---|
| 0 | A1 header, Hexagon packer calls it | pack bit-equal to old packer; ref dot | build only; NPU pp512/tg128 unchanged vs two-copy (876 / 22.1) |
| 1 | A2 marker + CPU tile reader (`ggml-cpu/q4_0-tile32.cpp`, kernel from the spike) + generic refusal | test-only TILE32 buft on CPU: 2-layer graph logits == native Q4_0 within fold error; a non-MUL_MAT op on the buft is refused | CLI CPU-only, tiled HOST: tg128 vs today's no-repack CPU decode and vs repack; 1 and 5 threads; KLD equal |
| 2 | A3 placement default, no-mmap, env -> setter, R1 default | loader test: every Q4_0 MUL_MAT weight in HOST, `token_embd` on CPU, no CPU_REPACK buffer, alloc sizes padded | NPU leg: pp512, tg128, KLD vs two-copy; RSS; load time cold/warm (owed since 09/30) |
| 3 | A5 weight-copy guard | graph with an unsupported op on TILE32 fails reserve with the tensor name | none |
| 4 | A6 OpenCL import + v4 kernel behind A2 | Mac Apple CL: v4 through the host-upload fallback vs reference (the probe already does); import code compiled, not run | alias PASS on the real buffers; GPU-leg mat-vecs vs two-copy OpenCL per layer; tg128 GPU leg vs two-copy GPU decode (7.8 sustained, cold unknown); CPU zone temps with `-t 1` |
| 5 | A4 leg contexts + third leg + hop labels | one model, three CPU-only leg contexts with distinct `leg_devices` lists: hop commits KV, logits continue; `test-governor-v0-commit` extended | governor-bench: 32-token hops CPU->NPU->GPU->CPU, tok/s per leg, commit bytes/us, KLD vs two-copy over 256 tokens |
| 6 | (b) one-model load + (c) table + fallback | `legs_for` rows and negatives; load plan log | APK: one load line, 3 legs, RSS; Jelly: identical log to today's APK (negative control for requirement 2) |

QDC 8 Elite (v79, Adreno 830) adds after step 2: HMX prefill from the tiled HOST (e2), the v79 flat KLD question, and
whether the GPU v4 kernel compiles and aliases on that driver; it does not add a table row until that report exists.
Xiaomi 14 adds the v75 point and HyperOS memory pressure under one model; same rule.

## (e) Unknowns, cheapest experiment each

- e1 NPU speed from the tiled HOST buffer (never executed). Step 2's first number; if < 0.95 of two-copy, try
  `RPCMEM_FLAG_UNCACHED` on the HOST alloc (one env, one run) before any kernel work.
- e2 HMX on v75/v79 from the tiled HOST: does the HMX path consume the same 32x32 tiles? Read `htp/matmul-ops.c` HMX
  entry on main (not done here), then one QDC pp512 arm. If HMX needs its own layout, one-copy on HMX SoCs is NPU-flat
  only and those rows stay out of the table.
- e3 GPU leg end to end: how much of a token runs on the CPU (attention, lm_head 205 MiB read, norms, conv) and does the
  CPU actually rest (03/10: GPU arm kept CPU zones ~90 C). Step 4 tg128 with per-op timing (`profile-op`) and zone
  temps. If the CPU share dominates: KV to OpenCL memory and commit via `ggml_backend_tensor_get/set` (step 5b), then
  Q6_K lm_head through the import with the stock `mul_mv_q6_K` kernel (plain layout, needs only an offset arg).
- e4 CPU prefill over tiles (LOWBAT route): pp512 CPU tiled vs today's CPU prefill (97 tok/s). If it collapses, the
  LOWBAT route needs an owner decision (NPU with a token cap, or route off on one-copy devices).
- e5 Multi-thread CPU decode on tiles: only 1-thread numbers are valid (`t5` included spawn/join). Step 1, 5 threads.
- e6 Hexagon `max_bufsize` default vs the 884 MB CL import cap and the number of HOST buffers the loader splits into;
  read `opt_mbuf` default, one log line at load.
- e7 Load time and peak RSS without mmap (1.5 GB read + pack); step 2.
- e8 Q6_K read-back anomaly from an HTP buffer (hmx-numerics REPORT 236-244): avoided by R1 (token_embd on CPU); keep
  it there, do not "optimise" it onto HTP.

## (f) What I would not do

- No new `GGML_TYPE`: the layout is a buffer property, type stays Q4_0 (upstream removed the Q4_0_4_x types for this).
- No device-global admission generation as the hop mechanism; no per-hop `sched` re-reserve.
- No per-tensor dma-buf imports, no `CL_MEM_USE_HOST_PTR` (driver copies, `ggml-opencl.cpp:11197`), no mmap hybrid.
- No OpenCL reading of norms/Q6_K/conv weights from the import in v1; the CPU does them until e3 says otherwise.
- No CPU GEMM over tiles for prefill speed; no fourth layout; no kernel work before e1 is measured.
- No table rows from family patterns (`SM8\d{3}`), no Java-side hints as evidence, no Xiaomi/8 Elite rows before a report.
- No two code paths for the hop: the third leg enters the existing (phase, route, engine) switch or the design is wrong.

Not verified by me: the HMX weight path on main, `opt_mbuf`, `graph_get_cb` and `llama-kv-cache.cpp` buft selection on
bc5f0207c (quoted from memory of upstream, must be read before step 4), the exact import extension the spike used
(`dmabuf.c` not opened), and whether the KV commit copies through host pointers or `ggml_backend_tensor_*`.
