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
weights to plain CPU memory) AND must call `ggml_backend_tensor_set` for a host buft with a non-native layout: today
the no-mmap path writes host buffers with `file->read_raw(cur->data, n_size)` (`llama-model-loader.cpp:1668-1670`),
bypassing `set_tensor`, so the pack never runs and the HOST buffer holds raw bytes flagged as nothing. The env knobs `GGML_HEXAGON_HOSTBUF`/`HOSTBUF_REPACK`/`RAW_HMX` become one setter reached
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
mechanism the spike proved (`tests/opencl-q4_0-raw/dmabuf.c`, S23 884 MB per `cl_mem`). Hexagon `opt_mbuf` defaults
to 1 GiB (`ggml-hexagon.cpp:96`), above that cap: the binding sets the HOST buffer max to `CL_DEVICE_MAX_MEM_ALLOC_SIZE`
(or the GPU leg is off) before load; the loader then splits the weights into several HOST buffers, one import each. The import is created lazily at
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
- e2 HMX from the tiled HOST buffer (the S23 v73 has HMX: raw one-copy pp512 851.5 vs 876.4, ALIVE ~885). Layout is
  not the risk: the HMX path DMAs weights at `dma_src_stride = tile_size` (576) and
  `dequantize_tiled_weight_to_fp16_task_q4_0` reads the scales at `tile_src + 512` (`hmx-mm-kernels-tiled.h:48`), the
  same tile `repack_q4_0_tiled` writes. The risk is the memory path (host-cacheable rpcmem) and is e1's measurement.
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

## Amendment A (2026-10-04, after gate G): step-1 spec, A2/A3 revised

Facts this rests on (read on `feat/governor-onecopy` cc777fd12 and main bc5f0207c):
- Scheduler: a WEIGHTS src that `ggml_backend_buffer_is_host` enters the opt-in loop ("1.off": first backend with
  `supports_op && offload_op`, no `supports_buft` check) then "1.host" (CPU); a NON-host src goes straight to
  `src_backend_id` = first backend in priority order with `supports_buft && supports_op` (`ggml-backend.cpp:894-898`,
  `:970-985`). So "host" is what drags tiled ops to the CPU; the stopgap fights that with `offload_op` (`:6920-6925`).
- Hexagon tiled-ness is per tensor today (`ggml_hexagon_tensor_is_tiled`: HOST buffer + `extra->flags & REPACK`).
- ggml-cpu learns about a foreign layout only through `op->src[i]->buffer->buft` (`ggml-cpu.cpp:434-439`,
  `traits.cpp:13-19`, `supports_buft :489-491`); it has no per-tensor channel that is not its own `extra`.
- Loader: non-host buffers are written with `ggml_backend_tensor_set` (`llama-model-loader.cpp:1663`); the async
  chunk path applies only to the device's default buft (`:1540`); host bufts under mmap are moved to CPU (`:1264`).
- `ggml_backend_tensor_copy` treats a host src as native bytes (`ggml-backend.cpp:495-496`); the unpacker
  `repack_tiled_q4_0` already exists (`ggml-hexagon.cpp:889`).

**(1) Marker = a dedicated buffer type, not a per-tensor flag.** Hexagon gets a third buft `HTP0-TILE32`: rpcmem
like HOST, `is_host = false`, `get_weight_layout = TILE32` (the optional hook from A2, in `ggml-backend-impl.h`,
accessor `ggml_backend_buft_weight_layout`), `get_alloc_size = ggml_q4_0_tile32_nbytes`, `set_tensor` packs via
`ggml_q4_0_tile32_pack` (full tensor or whole slices only, else abort with the tensor name), `get_tensor` unpacks via
the existing inverse so every reader of native bytes stays correct, `set_tensor_2d = NULL`, `cpy_tensor = NULL`.
Every WEIGHTS tensor in it is tiled Q4_0 by construction, so `ggml_hexagon_tensor_is_tiled` collapses to
"buffer->buft is TILE32" and the REPACK flag is no longer a cross-backend fact. The CPU learns it with one call,
`ggml_backend_buft_weight_layout(src0->buffer->buft) == GGML_WEIGHT_LAYOUT_Q4_0_TILE32`, zero Hexagon symbols.
HOST keeps native layout and `is_host = true` (norms, conv). Placement by the stock probe, no `-ot`: llama's buft
list gains a device's extra bufts before its default buft, via the same `ggml_backend_dev_get_extra_bufts`
proc-address lookup it already does for the CPU (`llama-model.cpp:1095-1100`); Hexagon returns `{TILE32}` only in
shared-weights mode; `select_weight_buft` asks Hexagon `supports_op`, which says yes for a 2-D Q4_0 MUL_MAT weight
with ne0 % 32 == 0 and no for anything else, so f32 norms and Q6_K `token_embd` fall through to the next buft.

**(2) What replaces b9543b6e4/16b2a093d.** Revert both (the `offload_op` tiled bypass, the abort in `supports_op`,
`op_htp_only`'s tiled clause). With TILE32 non-host, tiled ops never enter "1.off"/"1.host"; `backend_from_buffer`
gives them to the first leg backend that supports the buft and the op: NPU leg `{HTP0, CPU}` -> HTP (its own buft,
`:8018-8021` extended to TILE32), CPU leg `{CPU}` -> CPU (`supports_buft` gains `|| layout == TILE32 &&
ggml_cpu_has_dotprod()`), GPU leg later -> OpenCL for ne11 == 1, else CPU. The one generic guard is A5 (a WEIGHTS
split input aborts naming tensor and op); add `supports_buft` to the "1.off" loop (luna's CUDA-style item). The
native CPU mul_mat asserts `layout == NATIVE` on src0 (mirrors `traits.cpp:21-25`). `requires_set_tensor`
(7460d6210) becomes unused once TILE32 is non-host: delete it, the ABI item goes with it.

**(3) Norms and conv weights.** HOST native (not the device buft: the CPU leg has no HTP backend and
`supports_buft(HTP0)` is false, so a device-buft norm aborts the CPU leg's reserve). The 198 splits were admission,
not placement: the default `offload_min` is the 32-token batch threshold, so at batch 1 the HTP declined them. The
NPU leg sets S1's admission once at context creation (`offload_min 1`, `offload_ops OPS_ALL`,
`llama_set_backend_admission`, `llama-ext.h:163-175`); "1.off" then hands norm MUL and SSM_CONV to the HTP at any
batch, zero extra splits. The CPU and GPU legs have no HTP backend and read HOST natively. Untested: the DSP reading
~1 MiB of f32 from HOST; re-run the gate-G ABBA script once after this lands (same gates: 2 splits, 0 flat, HOST-TILE32
bytes = 1369571328). If it costs > 2 %, duplicating the 1 MiB into the device buft is the fallback, logged.

**(4) Luna items.** Close in step 1: get_tensor (unpack), tensor_copy (non-host path + unpack), set_tensor_2d/partial
(NULL/abort with name), offload loop `supports_buft`, the is_host mismatch (gone), the ABI member (deleted). Defer with a
comment: `extra->flags` unsynchronised (written at load before any graph; no runtime writer remains).

**(5) Kernel port.** From `spike/onecopy-cpu-gemv` 4e6c75252 take only `ggml_gemv_tiled_q4_0_q8_0`
(`arch/arm/gemv-tiled-q4_0.cpp`: `tiled_dot_block`, `tiled_scale_block`, asserts `nrows % 32 == 0`), renamed
`ggml_gemv_tile32_q4_0_q8_0`, same file path, not mac8/mac16. Dispatch in new `ggml-cpu/tile32.cpp` (< 200 lines):
`supports_op` = MUL_MAT, 2-D Q4_0 src0 in a TILE32 buft, f32 src1 in a host buft, dotprod at runtime; `work_size` =
`ggml_row_size(Q8_0, ne10) * ne11`; `compute_forward` = quantize src1 rows to q8_0 across threads as
`repack.cpp` `forward_mul_mat` does (`from_float` per row), barrier, then 32-row tiles split across threads, the
last partial tile computed into a 32-float scratch and only `ne01 % 32` rows stored (the buffer holds the padded
rows, dst does not). Batch > 1: loop over the ne11 columns calling the gemv - correctness only; each column re-reads
the weights, so pp512 will be far below today's CPU prefill. That is e4 and it is measured, not fixed, in step 1;
no GEMM over tiles until the owner decides the LOWBAT route. Hooks: `ggml-cpu.cpp:434-439` and `traits.cpp:13,37`
each gain one layout-keyed branch to `tile32.cpp`; no new entry in `ggml_backend_cpu_get_extra_buffer_types`
(TILE32 is not a CPU-allocated buft).

**(6) Proof.** Host `tests/test-tile32-cpu.cpp`: a test-only buft (malloc, layout TILE32, pack on set, unpack on
get, non-host, alignment 128) vs the native CPU buffer, same random Q4_0 weights and f32 input; graphs: two layers of
MUL_MAT + ADD at 10752x2048 / 2048x10752 and one ne1 % 32 != 0 shape, ubatch 1 and 7; gates: max |tiled - native|
<= 1e-4 * rms(native); on a dotprod ARM host additionally bit-identical to the CPU_REPACK result (the spike's claim);
`supports_op` false for GET_ROWS on the tiled tensor; `tensor_get` and `tensor_copy` round-trip to native bytes; x86
host returns 77 (SKIP, no dotprod). S23 (release build, unplugged, >= 30 %): same model load as gate G arm B but with
`GGML_HEXAGON_OPFILTER` refusing MUL_MAT, so `backend_from_buffer` lands tiled MUL_MATs on the CPU; gates: log shows
the `HTP0-TILE32` buffer line and no `profile-op` MUL_MAT; tg128 at 1 and 5 threads vs two-copy CPU no-repack
(the shipped S23 path) and vs repack; pp128 (e4 number); KLD equal to gate G's CPU arm.

**Wrong or risky in PLAN-INTEGRATION Revision 2:** "decide in step 2 (device buft is rpcmem too)" for norms - rpcmem is
not the question, `supports_buft` is; the CPU leg cannot read the device buft at all. Step 2's placement, no-mmap and
setter now shrink to R1 default + setter, because the probe places tiles and non-host weights are `tensor_set` under
mmap too (`:1663`), so no-mmap is a memory-accounting choice to measure, not a correctness requirement. Gate G's
measured graph (norms on the device buft) differs from the shipped one (norms in HOST, HTP by admission): re-measure.

## Amendment B (2026-10-04, after step 1): step-2 spec

Read on `feat/governor-onecopy` e9d7a9f45: TILE32 is exposed only when `opt_hostbuf_repack` (`ggml-hexagon.cpp:7196`),
HOST only when `opt_hostbuf` (`:6584`), both parsed once from env (`:7395+29,32`); admission seeds
`GGML_OP_OFFLOAD_MIN_BATCH` / `GGML_HEXAGON_ADMIT_OPS` (`:7395+33..37`) into the device ctor snapshot; every Hexagon buft
reports `dev_ctx->max_bufsize` (`:2026-2029`, from `opt_mbuf` = 1 GiB, `:96`). Placement: `make_gpu_buft_list` puts a
device's extra bufts before its default buft (`llama-model.cpp:1150-1168`), CPU list appended after (`:1481`); the
input layer always takes the CPU list (`:1539`), the output layer the last GPU layer's list (`:1548`); the probe
allocates a 0-byte buffer in the candidate buft and asks that buft's device `supports_op` (`llama-model-loader.cpp:1050-1052`),
first yes wins (`:1060-1070`). Step-1 arm T ran without `GGML_HEXAGON_HOSTBUF`, so HOST was not in any list and the
f32 norms went to the device buft: that arm is not the shipped placement.

**B1. Setter.** One proc-address function on the Hexagon reg (table at `:7205-7227`):
`int ggml_backend_hexagon_set_shared_weights(const struct ggml_hexagon_shared_weights *)` with
`{ bool enabled; size_t max_buffer_bytes; }` (0 = keep). It writes `opt_hostbuf_repack`, `opt_hostbuf` and every
device's `max_bufsize`; valid before any model load of the process, ignored with a WARN after the first TILE32 or HOST
buffer exists. Env stays the CLI seed (same statics, parsed first). It does not touch admission: that is per leg
context in step 5; the CLI equivalent is env (B2). Nothing else: no new flags, no change when `enabled = false`
(gate: the placement log of a two-copy load is byte-identical before and after this commit).

**B2. Default placement in shared mode, by the probe, no `-ot`.** Hexagon's extra bufts become `{TILE32, HOST}` when
shared (`:7194-7203`), so each layer's list reads `[TILE32, HOST, HTP0, CPU...]`: a 2-D Q4_0 matmul weight stops at
TILE32 (step-1 `supports_op` branch), everything TILE32 refuses (f32 norms, conv weights, output norm) stops at HOST
because the HTP supports MUL and SSM_CONV on a host f32 weight and `htp_admit_gate` is open at `gate_min 0`. The
device buft is never reached by a weight. `token_embd` (Q6_K, input layer) takes the CPU list `[HOST, CPU]`
(`:1082-1088`): it lands in HOST if `ggml_hexagon_supported_get_rows` (`:5357`) accepts the probe, else CPU; both
compute on the CPU (GET_ROWS is not an admitted offload op, the raw Q6_K MUL_MAT fails `raw_weights_supported`), so no
knob: record where it landed. Two-copy mode is untouched (extra bufts `none`, host getter NULL).
The 198-split trap: at batch 1 `htp_admit_offload` returns false below `offload_min` (default 32), the op takes
"1.host" to the CPU. For the S23 check set `GGML_OP_OFFLOAD_MIN_BATCH=1 GGML_HEXAGON_ADMIT_OPS=7`: it writes the same
packed word (`htp_admit_pack`) the app will write with `llama_set_backend_admission(ctx_npu, 1, 7, 0)` once per NPU-leg
context in step 5, so the measurement equals the app path. Proof gates, reused from `gate-g/run-gate-g.sh`: 2 graph
splits at decode and prefill, `profile-op` lines for MUL and SSM_CONV on the HTP, TILE32 bytes 1369571328, a HOST
buffer line of ~1 MiB, then pp512/tg128 vs step-1 arm T (886-888 / 22.5-22.6) and KLD identical. If the DSP reading
f32 from HOST costs > 1 %, the fallback is the 1 MiB duplicated in the device buft, logged as such; nothing bigger.

**B3. The 884 MB cap.** Where: `max_buffer_bytes` in B1, applied to `dev_ctx->max_bufsize`, which `get_max_size`
returns for TILE32, HOST and the device buft alike. Value: the binding passes `CL_DEVICE_MAX_MEM_ALLOC_SIZE` rounded
down to 64 MiB (S23: 832 MiB) when the table has a GPU leg, else 0. Splitting is already clean:
`ggml-alloc.c:1197-1221` pads each tensor to the buft alignment (128, `:2020-2023`) and opens a new buffer when
`cur_buf_size > 0 && cur_buf_size + this_size > max_size`, so a tensor never straddles; 1306 MiB of tiles become two
TILE32 buffers (two imports in step 4). A single tensor above the cap would get its own oversized buffer; the largest
tile tensor here is 12.4 MiB. CLI equivalent: `GGML_HEXAGON_MBUF=832`.

**B4. RAM on the S23, no root (CLI processes run as shell, their /proc is readable).** Sampler started before the bench,
every 2 s until the pid exits, max of each column reported:
```
P=$(pidof llama-bench)
grep -E '^(Rss|Pss|Pss_Anon|Pss_File|Pss_Shmem):' /proc/$P/smaps_rollup
for f in /proc/$P/fdinfo/*; do grep -q '^exp_name:' $f && awk '/^size:/{s+=$2} END{print "dmabuf_bytes", s}' $f; done | awk '{s+=$2} END{print "dmabuf_total", s}'
dmabuf_dump $P 2>/dev/null | tail -3        # cross-check, Android 11+
toybox time -v ... | grep 'Maximum resident'  # continuity with gate G
```
dma-buf pages are not in Pss (gate G: RSS 287 vs 294 MB for two copies vs one), so the comparable number is
`Pss_Anon + Pss_File + dmabuf_total`, and the three terms are reported separately because they differ for the LMK:
file-backed mmap pages are evictable, anon and dma-buf are not. Fair arms, same prompt and `-ub 512 -t 5`, sampled during
decode of rep 1: A = `governor-bench --arm G` (two models: prefill `n_gpu_layers 99` on the accelerator, decode `0` on
CPU, `governor-bench-run.cpp:86-87`), with mmap and repack set as the binding does on the S23 (mmap on, `no_extra_bufts`
on; verify both in `load_model`, `:24-28`, before trusting the arm); B = one model shared mode (B2 env), one context, plus
the second leg's KV and compute buffer sizes from the load log as an upper bound until step 5 runs `governor-bench`
one-model. Report A and B with mmap on and off for B (B's weights are `tensor_set` either way, `llama-model-loader.cpp:1663`;
mmap only changes whether the file pages stay cached). The app number comes in step 6 from the same `/proc/self`
reads inside the process.

**B5. Scope fence.** Step 2 does not touch the binding, leg contexts, OpenCL, KV, the GEMM over tiles, the capability
table, or two-copy placement; adds no env var; flips no default. Deliverables: the setter, `{TILE32, HOST}` exposure,
the ABBA re-run with the shipped placement, the RAM table.
Wrong or missing in the plan: (a) Revision 3 carries the NPU result forward as if it covered the shipped placement; it
does not (norms on the device buft); (b) "no-mmap" is listed as a requirement, it is a memory choice to be read off
B4; (c) the plan has no proof that two-copy placement is unchanged after exposing HOST: add the placement-log diff.

## Amendment C (2026-10-05, after step 2): step-3 spec

Read at 93fb3c097. Placement probe allocates 0-byte buffers that never reach the backend (`ggml-backend.cpp:43-46`).
Scheduler: a weight whose (buft, op) no backend supports gets -1 (`:903-912`) and is then COPIED into the split's
backend: `ggml_dup_tensor_layout` + `split->inputs[n] = src` (`:1414-1433`); `split_graph` is void (`:1081`),
`reserve`/`alloc_graph` return bool (`:1990-2003`, `:2007-2018`). CPU `supports_op` already returns
`ggml_cpu_tile32_supports_op` for any TILE32 src in `src[0..3]` (`ggml-cpu.cpp:437-447`; only 2-D Q4_0 MUL_MAT passes,
`tile32.cpp:23-73`); the compute dispatch tries the extra path then the native switch (`ggml-cpu.c:2064-2070`); the
only native guard is inside mul_mat (`:1457-1460`). Native readers of a quantized src0: MUL_MAT, MUL_MAT_ID
(`ggml-cpu.c:1851`, `type_traits_cpu[type]` at `:1868`), GET_ROWS (`ops.cpp:5146`), DUP/CPY/CONT (`ops.cpp:526`).

**C1. Where a second copy appears in shared mode, and the load-time check.**
- The tied output. `lfm2.cpp:40-44`: no `output.weight`, so `output = create_tensor(TOKEN_EMBD, TENSOR_DUPLICATED)`;
  the loader probes it as an OUTPUT op (`llama-model-loader.cpp:1159-1161`), reuses the original only if it sits in the
  SAME buft context (`:1364-1368`), else `ggml_dup_tensor` and `size_data += nbytes`: loaded twice (`:1371-1378`).
  Shared mode: `dev_output` is the last layer's list `[TILE32, HOST, HTP0, CPU]`; TILE32 refuses Q6_K, HOST is refused
  (`raw_weights_supported` admits only flat Q4_0 raw), HTP0 accepts: a 205 MiB repacked copy on the device buft and the
  lm_head on the HTP, the measured 458 pp512 case. This is the second copy nobody listed.
- The scheduler copy (`:1414-1433`), live today: P0's `CPU#token_embd.weight#0`. For a TILE32 weight it goes through
  `get_tensor` (unpack) so the bytes are right and the copy is invisible: a native tensor per graph in the compute buffer.
- CPU_REPACK claiming the duplicate output when `use_extra_bufts` (repack has Q6_K gemv, `repack.cpp:4752-4756`);
  the probe op for the dup is MUL_MAT, which repack accepts (`:5821`).
- NOT a copy: mmap. `mmaps_used` starts `{size, 0}` (`:1426`) and only mmap-backed tensors shrink it (`:1659-1661`),
  so `:1776 unmap_fragment(0, mmap_used.first)` unmaps the whole file after load; `pimpl->mappings` keeps unmapped objects
  (`llama-model.cpp:1878-1882`). Nor are HOST-placed f32/Q6_K tensors: they are the only copy.
Check, in the loader, gated on one bool `shared_weights` that `llama_model::load_tensors` sets when any list entry reports
`GGML_WEIGHT_LAYOUT_Q4_0_TILE32` (two-copy mode never sets it, so nothing below runs there):
(a) `create_tensor` `:1364-1368`: for `TENSOR_DUPLICATED` in shared mode, search every ctx for the name; if found in a
host buft, return it and log once `shared weights: %s reused for %s from %s`; else throw
`shared weights: %s would be loaded twice (%s and %s)`. (b) after `load_all_data`, every WEIGHTS buffer must be
TILE32, HOST or the CPU buft, else throw `shared weights: %s landed in %s, not a shared buffer` naming the first tensor;
on success one INFO line `shared weights: TILE32 %zu HOST %zu CPU %zu bytes` (B4 reads it). A throw fails the load; the
binding falls back. The duplicate rule is a placement decision only in shared mode, so two-copy placement logs stay
byte-identical (gate).

**C2. Native-read guards: two generic ones, no per-op list.**
- Scheduler, `:1414` before `ggml_dup_tensor_layout`: if `src->buffer` and `ggml_backend_buft_weight_layout` is not
  NATIVE, `GGML_LOG_ERROR("%s: weight %s (%s) has no backend for %s in this scheduler and cannot be copied", ...)`,
  set `sched->split_failed`, and `reserve`/`alloc_graph` return false when it is set (`llama_context` already turns a
  false reserve into a thrown error). Native weights keep today's behaviour: P0-style copies stay legal and silent.
- CPU compute, `ggml-cpu.c:2064-2070` after the extra path declines: any src with a non-NATIVE layout aborts,
  `ggml-cpu: %s cannot read %s (TILE32) as native bytes`. It subsumes `:1457-1460` (delete that one) and covers
  MUL_MAT_ID, GET_ROWS, DUP/CPY/CONT and every future op, plus direct `ggml_graph_compute` callers that bypass the
  scheduler. `supports_op` refusal alone is not enough: the scheduler answers a refusal with a copy, and graph compute
  without a scheduler never asks. Other backends need nothing: Hexagon's TILE32 branch admits 2-D Q4_0 MUL_MAT only
  (step 1), OpenCL refuses foreign bufts (`ggml-opencl.cpp:14912-14923`) so `backend_from_buffer` never names it,
  CPU_REPACK answers only for its own buft (`repack.cpp:5824`).

**C3. Proof.** Host, with `test_tile32_buft()` (`tests/test-tile32-buft.h:9`): extend `test-tile32-support` with
GET_ROWS, MUL_MAT_ID, CPY, DUP, CONT on a TILE32 src0 and a TILE32 src1 of MUL, all `supports_op` false; new
`test-tile32-sched`: a `{CPU}` scheduler over `GET_ROWS(w_tile32)` has `reserve` return false and the log names `w`, the
same graph with a native `w` returns true; the compute abort in a forked child (`SIGABRT` expected) on the same graph
through `ggml_graph_compute_with_ctx`, MUL_MAT as the passing control. The loader rule has no host test (shared mode
needs a Hexagon device): S23, one shared-mode load of the ship GGUF, no timing: log shows `reused for output`, the
buffer summary lists TILE32 + HOST + CPU only (no HTP0 device buffer), `token_embd.weight` loaded once, weight bytes =
file size + tile padding; control: the two-copy arm A placement log byte-identical to step 2's. Ten minutes on the
phone, owner's call whether it rides the step-2 session.

**C4. Fence and what is wrong.** Step 3 is host-only plus that one log check; no kernels, binding, OpenCL, KV, or
behaviour change for native weights. Wrong: (a) the pin. `shared_weights_pinned` latches on the first buffer-type read
and never clears (93fb3c097), so after a refused shared load the same process cannot fall back to a two-copy load,
and no later model can load two-copy: R2's fallback story breaks. Make the pin a count of live TILE32/HOST buffers
(inc in `alloc_buffer`, dec in `free_buffer`; the probe dummies never reach the backend, `:43-46`), setter legal at
zero, the "before any load" contract unchanged. (b) Revision 3 lists the native guard per op and misses the duplicated
tied output, the largest real copy. (c) The scheduler guard must stay silent for native weights, or two-copy configs
that copy today start failing.

## Changelog
- 2026-10-04 v2 (after RECON-CODE, WEB-PRIOR-ART, PLAN-INTEGRATION): A3 names the loader `read_raw` bypass that makes
  `set_tensor` (and so the pack) never run for host buffers; A6 names the `opt_mbuf` 1 GiB default above the S23
  884 MB import cap; e2 corrected: the S23 has HMX and the HMX dequantizer consumes the same 576 B tiles.
- 2026-10-04 v3: Amendment A appended (step-1 spec: TILE32 as its own non-host buft, stopgap revert, norms in HOST
  with admission, kernel port, host test and S23 check; plan corrections).
- 2026-10-04 v4: Amendment B appended (step-2 spec: setter with buffer cap, {TILE32, HOST} exposure and probe
  placement, admission env for the S23 check, split proof, RAM method and fair arms, scope fence).
- 2026-10-05 v5: Amendment C appended (step-3 spec: second-copy sources incl. the duplicated tied output, loader
  check gated on shared mode, two generic native-read guards, host tests, pin must become a live-buffer count).
