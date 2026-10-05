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

## Amendment D (2026-10-05): the tied output

Correction first: C1 predicted the duplicate on HTP0; it lands in HOST because the HTP probe for the OUTPUT role
(MUL_MAT on a host Q6_K weight) is refused by `ggml_hexagon_raw_weights_supported` (only flat Q4_0 raw,
`ggml-hexagon.cpp:2169-2171`) and HOST comes before HTP0 in the list; the lm_head then runs on the CPU: 0.766 decode.
Also: the report's "65536 x 2048" is wrong; 205.08 MiB / (8 superblocks x 210 B per row) = 128000 rows (ALIVE's
2048x128000). Step 3 as merged (fe3170e7e) keeps the reuse-host rule, so it fixes the bytes and keeps the 0.77.

Facts for the options. Today's two-copy NPU model already carries the duplicate on the device buft (A: HTP0
1525.87 = 1306.12 tiles + ~14.7 norms/conv + 205 output). The HTP cannot GET_ROWS a repacked tensor
(`:5381-5382`) and the device buft is not host-readable (`:2046-2047`), so a device-only embedding needs a DSP
gather. The raw-row template exists for Q4_0 only (`matmul-ops.c:351` converts rows to tiles in VTCM; `:825`
`hvx_mv_2d_raw_q4_0_flat`; `:1613` the `is_raw` switch), not for Q6_K (`:1617` repacked only; tile 896 B,
`matmul-ops.h:36`). Whole-model raw Q4_0 decode measured 0.70 of tiled (ALIVE: 15.51 vs 22.1). The lm_head costs
4.8 ms/token on the DSP (hmx-numerics census) and ~14 ms on the CPU at -t 5 (22.5 -> 17.2 tok/s). Q4_0 output
would be 128000 x 1152 B = 140.6 MiB; today 205.08 MiB.

| rank | option | weights (MiB) | NPU decode | CPU leg | GPU leg | engine work | risk |
|---|---|---:|---:|---|---|---|---|
| 1 | **(4) requantize token_embd to Q4_0, one TILE32 copy for both roles** | 1306 + 15 + 141 = 1462 | ~1.03 (fewer bytes than Q6_K) | lm_head on the tile32 gemv: faster than today's Q6_K CPU dot | lm_head on the v4 kernel: fully GPU | CPU tile32 GET_ROWS (gather 16 B per K-tile per row + dequant, ~60 lines in `tile32.cpp`, `:23-73` admits MUL_MAT only today); placement rule so the input role also lands in TILE32 (today the input list is the CPU list, `llama-model.cpp:1539`, and the HTP declines GET_ROWS at the probe) | KLD unknown: measure on the host first (`llama-quantize --token-embedding-type q4_0`, KLD vs today's 0.005313 on the owner's fixture); a model release through the chain (R2/HF digests, app pin) |
| 2 | **(1) accept the 205 MiB duplicate on HTP0** | 1306 + 15 + 205 + 205 = 1731 | 1.00 (today's graph) | lm_head native Q6_K from the CPU buffer, as today's CPU model | lm_head on the CPU, 14 ms of the token (e3) | ~20 lines: the dup may take the device buft; audit accepts an HTP0 buffer only for a `TENSOR_DUPLICATED` tensor and prints it by name and size | none technical; 1.98 GB vs 3.70 today; it is not hidden because it is the one tensor read by two different ops (GET_ROWS native, MUL_MAT repacked), named in the audit line and in the RAM table |
| 3 | **(3) HTP reads flat Q6_K from HOST** | 1526 | ~0.95 (lm_head 4.8 -> ~7 ms if the raw dot is 0.70 like Q4_0) | as (1) | as (1) | DSP: a `q6_k_raw_rows_to_tiles` into the 896 B tile and the `is_raw` switch for Q6_K (`:1617`); host: `raw_weights_supported` for Q6_K with ne0 % 256; a spike like `974a31e79` | medium: speed is an estimate, the Q6_K superblock conversion in VTCM is new DSP code; numerics = repacked |
| 4 | (2) embedding only on HTP0, repacked | 1526 | 1.00 | the leg must keep an HTP backend for GET_ROWS and lm_head (admission `htp_only`), so the DSP wakes every token: NSP relief gone | same | DSP GET_ROWS over Q6_K tiles + leg plumbing | high, and it defeats the CPU/GPU legs' purpose |

Recommendation: measure (4)'s KLD on the host today (one requantize, one perplexity run, no phone); if it passes the
owner's gate, (4) is the only option that satisfies both rules and makes every leg native; if it fails, (1) now and (3)
as the later spike. (2) no.

**Step 3 before merge:** the C1 rule must not hard-code "reuse host, else throw". Put the shared-mode duplicate
policy behind one loader field (`reuse_host` | `allow_device`), default `reuse_host`, and let the audit accept a device
buffer only for a `TENSOR_DUPLICATED` tensor, naming it. Then (1) is a flag flip, (3) needs no loader change, and (4)
needs the placement rule only. Merge with that field; nothing else in step 3 depends on the choice.

## Amendment E (2026-10-05): step-4 spec, the GPU leg

Read at 79f72bb16 (engine) and e3d3c32f4 (spike `tests/opencl-q4_0-raw/`, kernel
`ggml/src/ggml-opencl/kernels/mul_mv_q4_0_f32_tiled_v4.cl`). OpenCL refuses every foreign buft
(`ggml-opencl.cpp:14594-14606`), has no `offload_op` (`:14621`), answers yes to any Q4_0 MUL_MAT (`:9805-9807`) and
then casts `src0->extra` to its own extra (`:23973`): a TILE32 weight reaching it today would crash. `ggml_cl_mul_mat`
starts at `:23935`; its first branch is the non-contiguous dequant path (`:23952-23970`). The backend context holds
`device`, `context`, `driver_version`, `gpu_family`, `max_alloc_size`, `kernel_build_failed` (`:641-664`); programs
are built from embedded source (`:1431`, `:1502`); activations already go through an image1d view (`:8820-8838`).
Hexagon exposes the rpcmem block as `base()/size()/fd()` (`ggml-hexagon.cpp:589-611`), proc table at `:7265-7274`.
Spike import route that ran on the S23: `clCreateBuffer(CL_MEM_READ_ONLY | CL_MEM_USE_HOST_PTR |
CL_MEM_EXT_HOST_PTR_QCOM, {0x411D dmabuf, 0x40A9 io-coherent, fd, base})`, write-back fallback (`shapes.c:127-129`,
`dmabuf.c:121-133`); views: sub-buffer at `CL_DEVICE_MEM_BASE_ADDR_ALIGN`, pixel offset `poff`, RGBA/UINT32 quants and
RGBA/HALF_FLOAT scales (`tiledimg.c:37-45, 90-113`); kernel args `(wq, poff, ximg, ws, dst, K, M)` (`.cl:55-62`),
launch gws `ceil(M/32)*64`, lws 64 (`tiledimg.c:184`). Isolation report: GPU two-copy decode at `-t 1` 8.6-9.7 tok/s
with CPU zones 61-67 C, at `-t 5` 12.6-14.0 with 90-91 C; NPU `-t 1` 22.9.

**E1. Claiming a TILE32 weight.** New file `ggml-opencl/ggml-opencl-tile32.cpp` (< 250 lines, 3-function header):
`supports_buft(buft)` adds `|| (weight_layout(buft) == TILE32 && tile32_ready(backend_ctx))`, where `tile32_ready` is
the E4 gate evaluated once. The fd is per buffer, not per buft, so the import is lazy: at the first compute on a tensor
of a buffer, OpenCL asks the buffer's device registry for a generic proc address `ggml_backend_buffer_dmabuf(buffer,
&fd, &base, &size)` (Hexagon implements it from `fd()/base()/size()`), imports with the spike route, and keeps
`std::map<ggml_backend_buffer_t, import>` with the cl_mem plus per-tensor `{sub, wq, ws, poff}` built from
`tensor->data - base` (two images per tensor, ~112 tensors; `CL_DEVICE_IMAGE_MAX_BUFFER_SIZE` 134217728 px is far
above any tensor). `tensor->extra` stays Hexagon's. Two TILE32 buffers from the 832 MiB cap mean two imports; a tensor
never straddles (B3). Lifetime: Hexagon owns the fd; an import holds a dma-buf reference, so a model unload with
imports alive leaks 1.3 GB until they are released. The owner of both backends is the binding: it calls a proc address
`ggml_backend_opencl_release_imports()` before `llama_model_free`; in debug a WARN if an import's buffer is gone.
`supports_op`: before `:9796`, if any src buffer layout is TILE32, return true only for MUL_MAT, 2-D Q4_0 src0 with
`view_src == NULL`, f32 src1, `ne11 == 1`, and `tile32_ready`; everything else on a TILE32 src is false (mirrors
`tile32.cpp:23-73`). `ne11 == 1` because v4 is a mat-vec and the owner excludes GPU prefill; a wider batch in the GPU
leg falls to the CPU tile reader, which is the LOWBAT/prefill route's concern, not step 4's.

**E2. Kernel.** `mul_mv_q4_0_f32_tiled_v4.cl` verbatim from e3d3c32f4 (sha 7a15b2a0..., no fp16 types), one program
built lazily on first TILE32 use with the engine's general opts, so non-Adreno builds never compile it. One early
branch at the top of `ggml_cl_mul_mat` (`:23935`, before `:23952`): `if (layout(src0) == TILE32) {
ggml_cl_mul_mat_tile32(...); return; }`. Activations: src1 lives in the GPU leg's OpenCL compute buffer; build the
RGBA/FLOAT image view like `:8820-8838`. Covers the seven Q4_0 families per layer (gate/up/down, conv in/out proj,
attn q/k/v/o) at decode. Nothing else moves to the GPU in step 4.

**E3. What stays on the CPU, and the measurement that decides the leg.** In the GPU leg `{OpenCL, CPU}`: GET_ROWS
(CPU buffer), the Q6_K lm_head (option 2 or 3: the output is in CPU/HOST, OpenCL refuses those bufts), norm MULs and
SSM_CONV (f32 in HOST), attention with the KV on the CPU buffer (v1), RMS_NORM/SWIGLU wherever the scheduler expands
them. Every layer therefore alternates GPU and CPU several times; each boundary is a split with a sync (HeteroInfer:
>= 400 us per GPU<->other sync). At 60-100 splits per token that is 25-40 ms on a ~70 ms token: this, not kernel
parity, decides the leg. Measure on the S23, GPU-leg decode at `-t 1` and `-t 5`: tok/s, splits per token
(`ggml_backend_sched_get_n_splits`), per-op OpenCL time (the tiled mat-vec vs the SoA kernel on the two-copy OpenCL
arm, same session ABBA), CPU zone peaks and host-thread CPU time (`/proc/self/stat` utime delta per 128 tokens).
Decision rule for the owner: the leg is worth building further only if tok/s >= 0.9x the two-copy OpenCL arm at the
same `-t` and the CPU zone peak at `-t 1` stays in the 61-67 C band; otherwise step 5b (HOST-native f32 through the
same import so norms/conv run on the GPU, KV on the GPU) is tried once before any verdict. The GPU-leg context runs
one host thread, as the binding already does for the HTP context (`rn-llama.cpp:168-170`): the isolation report
showed the 90 C came from five host threads, not from the GPU.

**E4. R2 gate, device side, one function `tile32_ready`:** `gpu_family == ADRENO` (`:6925`) and `CL_DEVICE_NAME`
(`:6682`) contains "740", `driver_version` (`:7037-7039`) contains "E031.41.", extensions contain
`cl_qcom_dmabuf_host_ptr` and `cl_qcom_ext_host_ptr`, `max_alloc_size` (`:7106`) >= every TILE32 buffer, the image
views exist; then a read-only self-check after the first import: one real tensor's mat-vec on a unit vector against
the CPU tile32 reader, |diff| <= 1e-5 of output RMS (the spike measured 6-9e-7). Any miss: `tile32_ready = false`,
`supports_buft` false, tiled ops in the GPU leg fall to the CPU, one INFO line with the reason. The binding's table
(step 6) reads the same facts and simply never creates a GPU leg elsewhere. No writes into the weights: the spike's
alias check (pattern writes) is a probe tool, not production.

**E5. Proof.** Host: the OpenCL backend is not in the host CI build and macOS has no dma-buf, so host tests are the
gate function on fake facts (740/E031.41/extensions -> true; 750, E031.45, missing extension, undersized
`max_alloc_size` -> false) and the unchanged `test-tile32-*` suite. S23, CLI before leg contexts exist: `-dev
HTP0,GPUOpenCL -ts 1,0` (layers placed through HTP0's list, backends in that order, `llama-context.cpp:335-338`,
`ggml-backend.h:328`) with `GGML_HEXAGON_OPFILTER='.*'` so the HTP declines everything and `backend_from_buffer`
lands tiled mat-vecs on OpenCL and the rest on the CPU, which is the GPU leg minus an idle HTP backend. Gates: all
~112 tensors print the self-check PASS once; KLD equals the CPU tile32 arm to four digits; E3's numbers; two-copy
OpenCL arm (`-dev GPUOpenCL -ngl 99`) in the same ABBA.

**E6. Fence and plan errors.** No prefill kernel, no GEMM over tiles, no KV on the GPU, no f32 or Q6_K through the
import, no binding, no table row beyond the 740, no change to the SoA path. Wrong in the plan: (a) "v4 parity" is a
mat-vec number; the leg is decided by whole-token tok/s, splits and CPU heat, which nobody has measured; (b) the plan
has no release path for imports: a reload leaks the tiles' dma-buf reference; (c) `supports_buft` sees a buft, not a
buffer, so "zero-copy at import time" cannot be a `supports_buft` decision: capability gate plus lazy import; (d) the
GPU-leg context must be a one-host-thread context or e3 repeats the 90 C measurement.

## Amendment F (2026-10-05): step-5 spec, leg contexts and hop v2

Where things are. Hop v1 lives in the ENGINE on main bc5f0207c, not on the one-copy branch: the decision is
`select_decode` rule 4 (`llama-governor-policy.cpp:430-500`: window = tokens / `decode_hop_tokens`, NPU first, move
when the other leg's headroom leads by `k_hop_hysteresis_c` 4 C `:25`, fixed alternation without zones, one INFO per
leg change `:479-487`); the execution is the one switch at `llama-governor.cpp:300-345` (target context, commit,
decode). The binding feeds it: `feed_decode_headroom` (`rn-governor.cpp:117-122`) samples `rn_thermal_legs`
(headroom = min over a leg's zones of first passive trip minus temp, `rn-thermal-legs.h:18-20, 32-34`) every
`decode_hop_tokens` (`:111-112`) into `llama_governor_set_decode_headroom(cpu, npu)` (`llama-governor-runtime.cpp:384-386`).
Contexts: the governor ctor builds `ctx_prefill` from `model_prefill` and `ctx_decode` from `model_decode`
(`llama-governor.cpp:57-71`), the dtor frees them (`:86-87`); state is `ctx_prefill/ctx_decode/last_ctx` and one
`side_state` with a `watermark` per side (`llama-governor.h:77-78, 97-99, 106-107`). KV commit: hybrid memory always
takes MirrorAndCopy (`llama-kv-commit.cpp:302-303`), Direct needs aliasing caches (`:304-310`), rows move through
`ggml_backend_tensor_get`/`set` and a scratch (`:105, :114`), so the KV may live in any backend's memory. The branch
8ac5522d0 forked at 45f097b74: main has 373 commits since, the branch 50, and the branch's governor has no hop v1 at
all. Admission is per device with a generation counter and a re-reserve on change (`llama-context.cpp:584-586, 729`;
contract `llama-ext.h:163-175`).

**F1. Leg contexts.** Created and destroyed where the two are today (`llama-governor.cpp:57-71, 86-87`),
generalised to `leg { engine, llama_context *, side_state, params }[3]` over ONE `llama_model *`: NPU leg
`leg_devices {HTP0}`, GPU leg `{GPUOpenCL}`, CPU leg `{}` (A4; backends from the list instead of `model.devices`,
`llama-context.cpp:335-338`; KV buft follows the first leg device, `llama-kv-cache.cpp:313-317`). KV: NPU leg on the
HTP buft (today's prefill KV), CPU leg on the CPU buft, GPU leg on the CPU buft in v1 (attention on the CPU, E3);
moving it to OpenCL later is a buft choice, not a redesign, because the commit is `tensor_get/set`. The norm pin
(`llama-context.cpp:2637-2638`) keys on `dev_layer(il)` = HTP0 and finds no backend in the CPU and GPU legs: no pin,
as required. Admission: the NPU leg is the only context with an HTP backend, so the device-global word is in practice
per leg; set once after that context exists (`offload_min 1, offload_ops ALL, gate 0`, B2), never rewritten, so the
generation re-reserve fires once. Host threads: NPU and GPU legs one, CPU leg the caller's. Memory per extra context
= its KV + compute buffer; the step-2 table counted one context; read the two `buffer size` log lines per leg at
load and add them to the RAM table (B4) before quoting 1.75 GB for three legs.

**F2. KV on a hop.** Unchanged mechanism: the active leg holds the whole sequence; a switch commits
`[target.watermark, source end)` from the last active context to the target (`commit_side`, `llama-governor.cpp:300-345`),
MirrorAndCopy for this hybrid model, which also copies the recurrent conv state whole. Three legs need no new
bookkeeping: each context's watermark already means "what this context holds", and the last active context is always
complete, so A->B->C->A stays correct pairwise. Cost per hop = attention rows since the target last held the sequence
plus the conv state; the first GPU hop after a prefill receives the entire turn. All legs keep identical KV types
(`decide_governor_lane_kv`, `rn-llama.cpp:178-195`; `compatible` refuses mismatches). Stats already count
`decode_hop_commit_bytes/us` (`llama-governor.cpp:352-354`): log them per hop in v2. A shared single KV is not reachable
for hybrid memory (`:302-303`), so hops never become free in step 5.

**F3. The hop site.** One decision, `select_decode` rule 4, and one execution, `llama-governor.cpp:300-345`; both stay.
v2 changes the decision's inputs and the leg set, nothing else. Inputs: per-leg headroom (CPU, NSP, GPU zones:
`rn_thermal_legs` learns the GPU zone type on the S23 sysfs; NaN = no zones or leg absent), per-leg availability (table
plus runtime demotion), per-leg tok/s floor (NPU 22, CPU the shipped number, GPU from step 4), per-leg heat per token
as constants from the lab (battery C.s/token: NPU 0.15-0.17, CPU 0.30, GPU 0.35-0.42 at tg1024), the window counter.
Output: `engine in {NPU, GPU, CPU}`, `hop_rule` label, one INFO line per leg change naming all three headrooms and the
reason; the execution site maps engine to leg context and commits as today. Rule, structured so the owner's pending
choice is a constant and not a code path: open every decode on the NPU (lowest heat per token, measured); stay while
the NSP headroom is above the relief margin; when it is not, take ONE window on the relief leg: the available leg with
the lowest heat-per-token among those whose own block headroom exceeds the margin and whose floor holds (GPU for a
burst when available, else CPU); re-evaluate every window, NPU returns under the existing 4 C hysteresis. With the GPU
leg absent and the weighting at zero this reproduces v1 exactly, which is the regression test. v1's lesson stands: the
block trips never bound, skin did, so the margin is a parameter the owner sets, not a trip distance. Prefill is
untouched: the hop is decode-only (`!is_prefill` at `:310-312`), and the GPU prefill rule (`policy.cpp:205-232`,
`gpu_fit`) is a different decision that WARM never opens (owner 03/10).

**F4. Split and order.** Engine first. (0) Merge main into the branch: hop v1, the headroom API and 373 commits are
only there; doing step 5 on the branch as is would reimplement v1. (1) `leg_devices` + KV buft rule, host-tested
with CPU-only lists. (2) One-model governor: `llama_governor_init_with_params_internal(model, legs[])`,
`leg_ctx(engine)`, N-way `side_state`, admission set once; the two-model form stays for the R2 fallback and shares the
decode function. (3) `set_decode_headroom(cpu, npu, gpu)` and rule v2 with per-leg stats. Binding after: (a)
`rn_thermal_legs` GPU zone, (b) three-value feed, (c) the one-model load path behind the step-6 table with the step-2
setter called before anything reads the Hexagon buffer types. `governor-bench` gains the one-model arm first so the
S23 check does not wait for the binding.

**F5. Proof.** Host: `leg_devices {}` vs default on the ship GGUF, identical logits; three CPU-only legs over one
model with forced hops every N tokens A->B->C->A, logits identical to one context (extends `test-governor-v0-commit`
and `-turns`, `tests/CMakeLists.txt:359-365`, conv state included); policy v2 unit test on synthetic headroom
sequences: NPU first, relief picks GPU when available else CPU, hysteresis, and the two-leg case byte-identical to v1's
decisions; the existing two-model tests unchanged. S23, `governor-bench` one-model: forced NPU->GPU->CPU->NPU every 32
tokens, KLD vs two-copy over 256 tokens, tok/s per leg, commit bytes and us per hop (the first GPU hop is the
expensive one), RAM with three contexts by B4; then v2 free-running on a warm phone against hop v1's 9.0 tok/s and 908
of 1163 tokens on the CPU: per-leg share, block peaks, skin.

**F6. Fence and plan errors.** No shared KV, no GPU prefill, no change to prefill routes or COOLMODE, no new heat model
beyond lab constants, no table (step 6). Wrong in the plan: (a) step 5 "on the same branch" has no hop v1 to extend;
the merge is commit zero; (b) "admission per NPU-leg context" is per device (`llama-ext.h:170-172`) and only works
because the NPU leg is the sole HTP context: write that down, add no per-context plumbing; (c) the 1.75 GB is one
context; three contexts add two KV plus compute sets; (d) the v2 weighting is the owner's call: land the three-leg
plumbing with v1's rule generalised, the heat weight as a parameter defaulting to v1 behaviour.

## Amendment G (2026-10-05): making the GPU leg a real decode leg

Read at 0e7109fdf. The leg claims only TILE32 (`ggml-opencl.cpp:14668-14677`); its import map is keyed by buffer with
per-tensor views (`ggml-opencl-tile32-internal.h:8-10, 29-33`). Every OpenCL op reads a source through
`ggml_tensor_extra_cl { data_device, offset }` (`:7565-7569`). What OpenCL already supports: MUL f32 (`:9746+`),
RMS_NORM (`:9813`), SSM_CONV f32 (`:9835-9836`), ROPE (`:9964`), GLU (`:9791`), SET_ROWS into Q8_0 (`:9938+`),
flash attention (`:10009+` region, `flash_attn_f32_q8_0.cl` present), GET_ROWS for F32/F16 only (`:9923-9935`), and a
PLAIN-layout Q6_K mat-vec: `kernel_mul_mv_q6_K_f32(global void * src0, ulong offset0, ...)`
(`kernels/mul_mv_q6_k_f32.cl:80-88`), dispatched with `extra0->data_device` + `offset0` (`:26112+14..19`); the ql/qh
plane split happens only for tensors uploaded into OpenCL's own buffers (`:12977`). LFM2 per layer: norm MUL, shortconv
in_proj / MUL / concat with the recurrent state / SSM_CONV / MUL / out_proj (`lfm2.cpp:176-227`), attention layers with
q/k norms, ROPE, SET_ROWS, FA, ffn gate/up/down, GET_ROWS at the top (`:236`), tied lm_head at the bottom. Step-4 log:
`graph splits = 1 (bs=32), 197 (bs=1)`; G 3.50 tok/s vs two-copy OpenCL 11.51 at `-t 1`.

**G1. What must move, and what each needs.** The 197 splits are every boundary where an op touches a tensor OpenCL
cannot claim: the f32 weights in HOST (norms, q/k norms, conv kernels, output norm), the KV and recurrent state in
CPU memory (`-nkvo`), and the Q6_K lm_head in the CPU buffer. Three moves, no new kernel:
- HOST through the same import. `supports_buft(HOST)` true once the HOST dma-buf is imported (same route and map as
  TILE32, one more buffer), and a fake `ggml_tensor_extra_cl {cl_mem, data - base}` per native-layout tensor served
  from the map, so `ggml_cl_mul`, `ggml_cl_ssm_conv` and the Q6_K mat-vec read the HOST bytes in place. Not a copy: the
  alternative, uploading 1 MiB of f32 into OpenCL memory, is a third copy of 0.07 % of the weights and buys nothing
  measurable; the import is the mechanism the owner already accepted for the 1.3 GB, so there is nothing to argue.
- KV and recurrent state on OpenCL for the GPU-leg context: a per-context buft choice (`llama-kv-cache.cpp:313-317`
  follows the leg's first device, F1), not a weight. Then SET_ROWS, FA, concat and SSM_CONV run where their inputs are.
- lm_head on the GPU: the plain Q6_K kernel reads an imported buffer, so `token_embd` must live in HOST (rpcmem),
  not the CPU buffer where step 3 put it: a placement rule for the input-role tensor in shared mode. GET_ROWS stays on
  the CPU (OpenCL has no quantized GET_ROWS, `:9925-9935`): one input boundary, the same one two-copy OpenCL has.

**G2. The tied output, re-ranked.** Option 2 (205 MiB duplicate on HTP0) serves the NPU only; the GPU leg still needs
`token_embd` in HOST for its lm_head, so option 2 costs 205 MiB and leaves the GPU reading the HOST copy anyway. Option
3 (HTP reads flat Q6_K from HOST) makes the ONE HOST copy serve all three legs: CPU native dot, HTP flat reader (the
new DSP code of D), GPU plain kernel through the import. Ranking of D becomes 3 > 2; option 1 is refuted by KLD.

**G3. Placement without OPFILTER.** With F's `leg_devices = {GPUOpenCL}` the GPU-leg context has backends
`[OpenCL, CPU]`, its KV on OpenCL, and `backend_from_buffer` hands every weight op to OpenCL because it is first and
now supports TILE32 and HOST; non-weight ops follow their inputs; the HTP0 placement probe is a load-time matter of
the model's own list and never sees this context. Before step 5 there is no way to put the KV on OpenCL from the CLI:
`-dev GPUOpenCL,HTP0 -ts 0,1` gives OpenCL priority without OPFILTER or `-ot` (weights placed by HTP0's list, OpenCL
first in the backend order), but `dev_layer` is HTP0, so the KV lands on the HTP buft unless `-nkvo` keeps it on the
CPU. That arm measures G1's first and third moves with attention and conv still on the CPU.

**G4. Expected splits and the measurement.** Today ~12 per layer. HOST import + lm_head on GPU, KV on CPU: about two
per layer (state and attention boundaries) plus the input boundary. KV on OpenCL as well: 1-2 like two-copy OpenCL.
Measure the `graph splits` line at bs=1, tg64 at `-t 1` against the two-copy OpenCL 11.51, per-op OpenCL times, and
the CPU zone peak; the leg is real when splits <= 2 and tok/s >= 0.9 x 11.51.

**G5. Step 4b now, the rest in step 5.** HOST import, the fake extras, `token_embd` in HOST and the Q6_K plain path are
OpenCL and placement work on the current branch, measurable with the `-ts 0,1 -nkvo` arm: step 4b, gate "two splits
per layer and lm_head on the GPU". KV on OpenCL needs `leg_devices`, which needs the merge of main (F4 commit zero):
step 5. Wrong in the plan: the GPU leg was declared "ON and correct" on mat-vec parity; a leg is a token, and the
token was 70 % CPU.

## Amendment H (2026-10-05): option 3, the HTP reads the flat Q6_K tied output from HOST

Read at ee3dfde49 (main merged). The raw path today: a raw weight is a quantized tensor without `HTP_TENSOR_REPACK`
(`htp/matmul-ops.c:268-278`); for Q4_0 the job DMAs one 32-row group of raw rows into a prefetch slot
(`hvx_mm_push_raw_q4_0`, `:255-259`), converts it in VTCM into the tiled layout (`q4_0_raw_rows_to_tiles`,
`:261-263`, scalar C: `q4_0-raw-tile.h` has no HVX intrinsic) and runs the ordinary tiled dot (`hvx_mv_2d_raw_q4_0`,
`:796`; the slot holds raw rows or tiles alike, `:246-249`). Slots are `n_k_tiles * aligned_tile_size` per prefetch
(`:300-320`), `n_prefetch` 2..16 (`matmul-ops.h:54`, chosen at `ggml-hexagon.cpp:5026-5041`). Host side the gate
admits only 2-D Q4_0 MUL_MAT and only with `opt_mm_select == 1` (`:2478-2485`; default 2, `:120`). Q6_K tile: 896 B
(`matmul-ops.h:39,48`), laid out by `repack_q6_K_tiled` (`ggml-hexagon.cpp:1302-1352`): per 32x32 K-tile a 512 B
low-nibble plane, a 256 B high-2-bit plane and 64 fp16 sub-block scales `d * scales[kt_local*2+sub]`, one superblock
spanning 8 K-tiles; read by `tiled_vec_dot_q6_k_32x1` via `unpack_q6_k_group` (`hvx-mm-kernels-tiled.h:472, 885`).
After 4b, `token_embd` (Q6_K) sits in HOST in shared mode (6d623b76b) and the GPU reads it with the plain kernel.

**H1. DSP work.** One new header `htp/q6_K-raw-tile.h`, `q6_K_raw_rows_to_tiles(tiles, stride, rows, n_k, n_rows)`,
byte-identical to the host packer's loop (`:1334-1352`, same `d * scale` fp16 rounding), plus the Q6_K twins of the
Q4_0 helpers (`hvx_mm_push_raw_q6_K`, `hvx_mm_raw_q6_K_to_tiles`) and the two job instantiations
`hvx_mv_2d_raw_q6_k` / `hvx_mm_2d_raw_q6_k` through the existing `MATVEC/MATMUL_2D_TILES_IMPL` raw argument
(`:622, :796` pattern). Dispatcher `:1730`: `is_raw` already covers Q6_K in `htp_mm_has_raw_weight`; the HVX switch
gains the Q6_K raw cases next to Q4_0's; the HMX path never sees a raw Q6_K (host gate below). Slot fit: raw rows
`n_rows * (K/256) * 210 B` vs tiles `(K/32) * 896 B`: LFM2 K=2048, 53760 vs 57344 B; Qwen K=2560, 67200 vs 71680 B;
raw < tiles, so the Q4_0 argument (`:246-249`) holds and the slot sizing is unchanged. VTCM: per thread
`n_prefetch * slot`; at 16 x 57 KiB x 6 threads ~5.4 MiB worst case, inside the v73 budget the chooser already
respects. DMA: raw Q6_K rows are 1680 B (LFM2) / 2100 B (Qwen), NOT 128-aligned, unlike Q4_0's 1152 B; the 2-D DMA
stride must be checked on the S23 with a one-row probe before any timing (the 09/30 audit's stride hypothesis).
Host side: `raw_weights_supported` admits `MUL_MAT, src0 Q6_K, ne0 % 256 == 0` at any `opt_mm_select` (the raw Q6_K
path is HVX-only, so the clause must be "not HMX for this op", not "HMX off globally"), and `ne11 <= 32` so a
perplexity run's 512-wide lm_head stays on the CPU rather than needing a raw HMX path. Admission at batch 1 is the B2
word (`offload_min 1, ops ALL`): the lm_head is a MUL_MAT on a host weight, "1.off" hands it to the HTP once
`supports_op` says yes. Expected decode: two-copy had the lm_head on the DSP at 4.8 ms of a ~44 ms token; the raw path
adds the conversion (Q4_0 raw whole-model ran 0.70 of tiled with scalar conversion, and Q6_K's per-element scatter is
heavier): 0.9-0.95 of two-copy, i.e. ~20-21 tok/s vs 17 today, if the conversion stays scalar; vectorise only if the
measured number is below 0.95. Qwen's lm_head is 248320 x 2560 = 521 MB raw, ~35-40 % of its token's bytes: there
the scalar conversion is not acceptable and the HVX version is the plan, not the fallback.

**H2. Loader.** No change: `token_embd` already lands in HOST through the input-role list (6d623b76b), and the
step-3 duplicate scan reuses a host original. Audit: no code change; the HOST byte count on the INFO line grows by
205 MiB, and the REPORT table should say so, so nobody reads it as a regression.

**H3. Proof.** Host: `tests/test-hexagon-q6_K-raw-tile.c`, the twin of `test-hexagon-q4_0-raw-tile.c` (built by hand
against ggml-base, `:3-8`): random `block_q6_K` rows, full and partial last group, tiles byte-identical to
`repack_q6_K_tiled` on the same rows, plus the `hexagon-sim` raw-reader harness run on the Q6_K job for one tile. S23:
one-row DMA probe for the unaligned stride; then NPU ABBA shared vs two-copy at `-t 5 -ub 512`: pp512 >= 0.98, tg128
>= 0.95 (today 0.766), KLD identical to 0.005313 (same tiles, same dot), `graph splits = 2`, `profile-op` shows the
lm_head MUL_MAT on the HTP with the q6_k tag; the GPU-leg 4b arm re-run once to prove the plain kernel still reads the
same HOST bytes.

**H4. Qwen3.5-4B.** Generic in steps 1-4b and H: TILE32 placement (248 Q4_0 matrices, every ne0 % 32 == 0), HOST
for F32, `token_embd` Q6_K in HOST (K = 2560, %256 ok), the CPU and GPU plain readers, the loader rules, the guards.
LFM2-specific: only the measured numbers and the S23 gates. What breaks on Qwen: GATED_DELTA_NET exists in ggml-cpu
only (`ggml-cpu.c:2424, 2623`; no case in `ggml-hexagon.cpp` or `ggml-opencl.cpp`), so on 24 of 32 layers the
recurrent core runs on the CPU in every leg and the "real leg" criterion (splits <= 2) is unreachable until an HTP or
OpenCL GDN kernel exists; the hop's commit copies the GDN state whole each hop (16 heads x 128 x 128 f32 per layer,
~24 MiB per hop vs LFM2's tiny conv state); the 521 MB lm_head per token on any leg; and the owner's rule keeps the
governor off while an mmproj loads. Must be checked, in this order: the Q4_0 requant's KLD against its Q4_K_M (a
requant from Q4_K_M is a double quantisation; LFM2's embedding requant cost 7x KLD, Amendment D), the GDN placement
and split count on one layer, the hop commit bytes, the lm_head time on the DSP with H1's conversion, memory
(2.3 GB tiles + 0.5 GB embedding + KV on the 8 GB S23).

**H4 correction (orchestrator, verified on disk at ee3dfde49, 2026-10-05).** The GDN claim above is wrong: GATED_DELTA_NET has an HTP kernel (`htp/gated-delta-net-ops.c:2272` `op_gated_delta_net`, HMX chunked and HVX pp/tg paths; host admission `ggml_hexagon_supported_gated_delta_net`, `ggml-hexagon.cpp:4780`, dispatched at `:8095`, default `opt_gdn_select = 2` at `:122`) and an OpenCL kernel (`kernels/gated_delta_net.cl:82`, `ggml-opencl.cpp:1029, 3827`, supports_op case `:10175`). So the recurrent core of Qwen3.5 is not CPU-only by construction; whether it lands on the HTP/GPU at the S23 shapes (S_v <= 128, contiguity, state size) is an on-device placement check, not a known gap. The rest of H4 (requant KLD first, hop commit bytes, 521 MB lm_head, mmproj rule) stands.

**H5. Fence and plan errors.** No HVX dot changes, no HMX raw path, no OpenCL change, no Qwen work in H. Wrong or
missing in the plan: (a) the raw gate's `opt_mm_select == 1` clause would keep HMX off for the whole model; it must
become per-op; (b) the DSP conversion is scalar C today, fine for a 1 MiB-per-group Q4_0 experiment, unmeasured for a
205 MiB-per-token lm_head: measure, then vectorise; (c) the Q6_K raw DMA stride is unaligned, a probe comes before the
ABBA; (d) Qwen is not "the same steps on another model": the GDN kernel gap decides whether a GPU or NPU leg exists at
all on it.

## Amendment I (2026-10-05): step-4b failure, the HOST buft has two roles

Read at 8ccc5ffae. **(a) The diagnosis is right, and it is a buffer-type problem, not an op problem.** llama gives
the CPU backend the first device's host buffer type for its compute buffers ("use the host buffer of the first
device", `llama-context.cpp:413-418`) and the output buffer the same (`:2249-2251`); with `GGML_HEXAGON_HOSTBUF=1`
that is `HTP0-HOST` (log: `HTP0-HOST output buffer size = 0.49 MiB`, `HTP0-HOST compute buffer size = 8.20 MiB`).
4b made OpenCL claim that buft by predicate, not by role: `supports_buft` says yes to any host buft whose registry
serves the dma-buf accessor (`ggml-opencl.cpp:15080-15089`), and `ggml_opencl_in_host_leg_buffer` keys on the same
two facts (`:9876-9882`). The scheduler decides copies per buft (`ggml_backend_sched_buffer_supported` ->
`supports_buft`), so a CPU-split activation allocated in the HTP0-HOST compute buffer is no longer copied into an
OpenCL buffer; the TILE32 call site then casts `src1->extra` and `dst->extra` as OpenCL extras (`:25558` region) on a
tensor whose extra is Hexagon's, and `clCreateSubBuffer` fails with -38 (`-matvec.cpp:105`). The `supports_op` loop
cannot catch it: at reserve time graph-local srcs have no buffer yet (`:9973`, "graph-local srcs are allocated into
this split's own buffers"), and that assumption is exactly what 4b broke. The same hazard sits in the MUL and
SSM_CONV substitutions, whose activation srcs can also live in HTP0-HOST.

**(b) Fix: option (i), one buffer type per role.** Hexagon exposes a second buft object `HTP0-HOST-W` (same rpcmem
allocation, same interface, same dma-buf accessor, `is_host` true) and serves it through `get_extra_bufts`
(`{TILE32, HOST-W}`) and the 4b input-role list; `get_host_buffer_type` keeps returning `HTP0-HOST`, which llama uses
for CPU compute and output. OpenCL claims a host buft only if `buft != ggml_backend_dev_host_buffer_type(buft->device)`;
with one object today that test would always fail, which is why the split is needed. Fails closed: the compute and
output bufts are never claimed, so the scheduler copies activations exactly as before 4b, and the leg's cast sites
additionally assert `ggml_backend_buffer_get_usage(src->buffer) == WEIGHTS` for every src they address through the
import map, by name. Blast radius: Hexagon one buft object and two list entries; OpenCL one identity test and the
asserts; llama nothing; the loader's audit accepts HOST-W where it accepts HOST. NPU leg: unchanged, its compute and
output stay in `HTP0-HOST`, host-addressable rpcmem the HTP reads without a copy (`:414`), and HOST-W is mapped per
buffer like HOST (`fastrpc_mmap` in the shared-buffer ctor), so option 3's flat Q6_K reader sees `token_embd` as
before. Rejected: (ii) `no_host` is a model parameter consulted only by the model's buffer lists (`include/llama.h:353`;
no use in `llama-context.cpp`), so it leaves the compute and output buffers in HTP0-HOST, and declining non-WEIGHTS
srcs at `supports_op` cannot see unallocated graph tensors; (iii) addressing any tensor of an imported buffer through
the map (zero-copy activations) is a real option for later, but it imports compute buffers at compute time, cannot
fail closed (`supports_buft` is per buft), and adds a CPU-write/GPU-read coherence question per split. Step 5: in the
GPU-leg context the CPU backend's compute buft should follow the leg's first device, not `model.devices[0]` (`:415`),
one line in F1; the NPU leg keeps HTP0-HOST.

**(c) The silent self-check.** The HOST self-check never ran its numbers: `host_checked_locked` ANDs the kernel
handle without logging (`-tile32.cpp:294`, `kernel && ...`), and `kernel_mul_mv_q6_K_f32` is created inside
`load_cl_kernels` (`ggml-opencl.cpp:2366`), which runs only from the OpenCL buffer-type allocator (`:14851`; the init
call is commented out, `:7415`). The imports and the check ran at log lines 1169-1338, the first OpenCL compute buffer
appears at 1627: the handle was null. Fix: the leg calls `load_cl_kernels(backend_ctx)` before the first HOST
self-check (from `env_fill` or the gate), logs `Q6_K kernel not loaded` if the handle is still null, and the check's
own silent exits (`-gate.cpp:222-228`: `to_float`, `K % bs`, `ne2/ne3`, `nb[1] != row_bytes`) each log which
precondition failed with the values. The decline was not the cause of the abort: the -38 came from the TILE32 path.

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
- 2026-10-05 v6: Amendment D appended (tied output: options ranked, requantize-to-Q4_0 first pending KLD, duplicate on
  HTP0 second, flat Q6_K third; C1 rule made policy-selectable before the step-3 merge; vocab 128000 correction).
- 2026-10-05 v7: Amendment E appended (step-4 GPU leg: lazy dma-buf import per buffer via a generic proc address, v4
  kernel behind an early mul_mat branch, splits-per-token as the deciding metric, 740/E031.41 gate with read-only
  self-check, CLI arm with OPFILTER, import release on unload).
- 2026-10-05 v8: Amendment F appended (step-5: legs as contexts over one model, pairwise commit unchanged for N legs,
  hop v2 in the existing select_decode rule 4 + one execution site, merge main first, owner's weighting as a parameter).
- 2026-10-05 v9: Amendment G appended (GPU leg: HOST through the same import, KV on OpenCL per leg, lm_head via the plain
  Q6_K kernel with token_embd in HOST; D re-ranked 3 > 2; step 4b now, KV in step 5).
- 2026-10-05 v10: Amendment H appended (option 3: Q6_K raw-to-tile on the DSP via the Q4_0 pattern, per-op host gate,
  unaligned DMA stride probe, twin host test, NPU ABBA gates; Qwen: generic placement, GDN has no HTP/OpenCL kernel).
- 2026-10-05 v11: Amendment I appended (4b failure: HOST buft serves weights and CPU compute; split into HOST-W for
  weights, OpenCL claims by identity, asserts usage; self-check declined on a null kernel handle, kernels load lazily).
