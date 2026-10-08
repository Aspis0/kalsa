# What in this code path depends on n_ctx and changes at KV ~2016-2048

S23 (SM8550, v73), arm L (`--legs npu` / `--legs gpu`, `--gen 8193`, n_ctx 8960) hard-resets twice.
Read-only session, 2026-10-08. Engine read `~/Projects/kalsallama-gov-onecopy` @ `dbdeb628e`;
bench binary tree = `5cb7e14a0`. `git merge-base --is-ancestor` = YES for `e199c140d`, `34fca920f`,
`4d46cb61c` in `5cb7e14a0`, so the binary carries all three gallocr commits. No phone, no build,
no source edit; the only writes are the host experiment outputs listed here (piped, no files).

## 0. Bottom line

1. **Measured**: the *reserve* graph is built with `n_kv = n_ctx`, so n_ctx sizes the compute
   buffers; at `n_ubatch = 512` the CPU/HTP compute plan grows from **265.51 MiB (n_ctx 768) to
   599.51 MiB (n_ctx 8960)** — +334 MiB, ~40 KB per KV cell. That, plus KV (140 vs 44 MiB/leg),
   is the whole n_ctx footprint difference between the resetting run and `--gen 2049`.
2. **Refuted**: no gallocr compute-buffer realloc happens mid-decode, at any n_kv step, at any
   n_ctx. The plan is the `n_kv = n_ctx` worst case, so the growing decode graph always fits.
   Hypothesis (1) of the brief is dead as a *position*-driven trigger.
3. **Refuted**: there is no `2048` cliff in the executed path. Every `2048` here is in FA-only
   code (flash-decoding thresholds, adreno-xmem LWS) or in HMX tile *byte* sizes; with
   `flash_attn_type = DISABLED` (bench) those kernels never run.
4. **Still open, and now the leading family**: the only n_ctx-sized object that the run *touches
   progressively* is the KV cache and the per-token device buffers around it. A fault there is
   the mechanism that fits "needs n_ctx 8960, dies at cell ~2048, on both legs".
5. The app has never exercised this path: app n_ctx **8192**, KV **q8_0/q4_0** (6,656 B/KV-token vs
   the bench's 16,384), FA **auto** (not disabled) and **hops every window** (`decode_hops:8` over
   989 tokens, npu 702 / cpu 288) instead of decoding one leg for ~1,500 tokens. FA-off + f16 KV +
   a single sustained leg is bench-only.

## 1. The app's n_ctx (asked in the brief)

- `~/Projects/kalsa/src/engine/ModelRegistry.ts:286` `    engineCtx: 8192,` for id `lfm2.5-2.6b`
  (`:272`), `:287` `    kvCache: { k: "q8_0", v: "q4_0" },` and `:293` `    kvBytesPerToken: 6656,`
  (`:292` "Governor-measured 6656 bytes/kv-token ... measured: #63 QRD8650 ... 104.00 MiB @ n_ctx 16384").
- 270 lab lines `llama_context: n_ctx                 = 8192` from S23 app sessions (vs 39 × 2048).
- The 2026-10-07 in-app turn (positions to 2749): `"tokensCached":2750,"tokensPredicted":989`
  with `"decode_tokens_cpu":288,"decode_tokens_npu":702,"decode_hops":8` — it crossed 2048, but
  never ran one leg for more than a window.
- Bench, same model: `tools/governor-bench/governor-bench-run.cpp:31`
  `    params.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_DISABLED;` and `:38`
  `    params.n_ctx = k_prompt_tokens + opts.generate_tokens + 8;` → 8960, f16 K/V = 16,384 B/KV-token.

## 2. The n_ctx couplings, measured

Host-only, no phone, existing `build-host/bin/governor-bench` (post-`e199c140d`: its
`libggml-base` carries `tensor %s has no buffer for chunk %d - refusing the allocation`):

| command | n_ctx | KV/leg | compute plan |
|---|---|---|---|
| `GGML_SCHED_DEBUG=2 ./governor-bench --arm L -m .../LFM2.5-2.6B-QAD-Q4_0.gguf --legs cpu --gen 64 -t 4 -v` | 768 | 12.00 MiB | **265.51 MiB** |
| same, `--gen 8193 -r 1 -t 6` (8192 tokens decoded) | 8960 | 140.00 MiB | **599.51 MiB** |

Why n_ctx enters a *compute* buffer: `src/llama-kv-cache.cpp:884-885 llama_memory_context_ptr
llama_kv_cache::init_full() { return std::make_unique<llama_kv_cache_context>(this); }` sets
`:2978     n_kv = kv->get_size();` — the *reserve* graph (llama-context.cpp:726/752/774) is built
with the **whole** cache as n_kv. `src/llama-graph.cpp:34-41` then creates, with FA off, an F32
mask of `ne = {n_kv, n_tokens}` (`const auto type = cparams.flash_attn ? GGML_TYPE_F16 :
GGML_TYPE_F32;`), and the FA-off attention adds `:2688 kq = ggml_mul_mat(ctx0, k, q);` +
`:2722 kq = ggml_soft_max_ext(...)` — all n_kv × n_tokens × heads. With FA *on* those tensors do
not exist (the 768-cell row and the 8650 app's `n_ctx = 16384`/129.00 MiB are pure logits term).

- **KV cache**: 8 layers × n_ctx cells × (K f16 512 + V f16 512), `src/llama-kv-cache.cpp:352-353
  ggml_new_tensor_3d(ctx, type_k, n_embd_k_gqa, kv_size, n_stream)`. FA-off also sets
  `src/llama-model.cpp:2703 /* attn_v_trans */ !cparams.flash_attn,`, so V is stored transposed at
  `n_embd_v_gqa_max()` (`src/llama-kv-cache.cpp:324`).
- **n_kv is a 256-step staircase, not a 2048 cliff**: `src/llama-kv-cache.cpp:1418 const uint32_t
  n_pad_cur = std::max(n_pad, 256u);` with `src/llama-kv-cache.h:292 const uint32_t n_pad = 1;`
  and `:1423 result = std::max(std::min(cells.size(), std::max(n_pad_cur,
  GGML_PAD(cells.used_max_p1(), n_pad_cur))), result);`. n_kv has been **2048 since window 41**
  (used ∈ (1792, 2048]), so the crash is *inside* that plateau, not at a shape transition; ten
  earlier transitions (256…1792) were survived. The next crossings — n_kv 2048→2304 and the first
  KV write at cell 2048 — occur at generated 1536-1537 ≈ window 48, and the log only proves window
  46 flushed (§6): crash position 1984-2111.

- **Admission**: `src/llama-governor-legs.cpp:206 (void) llama_set_backend_admission(npu, 1,
  GGML_HEXAGON_ADMIT_OPS_ALL, 0);` bumps a device-global generation and `src/llama-context.cpp:660-666`
  then forces `sched_need_reserve = true` for *every* context on that device at its next decode
  (`// another context changed the admission of a shared Hexagon device: ... it re-reserves too`).
  One-shot, at the first decode, not at 2048.
- **HTP buffers**: `ggml/src/ggml-hexagon/ggml-hexagon.cpp:744-750` `// Size adjustment inside the
  buffer class: 4K aligned data size + 4K guard page`; the HOST buft is `is_host = true` (`:2366`)
  and the device buft `return false;` (`:2362`), so the NPU leg's CPU-side tensors live in
  **HTP0-HOST rpcmem** (`src/llama-context.cpp:442-457`: the CPU backend's buft becomes the first
  offload device's host buft) while the DSP reads the same bytes. vmem accounting: `:2585 b_vmem +=
  b.size;` and `:2723 if ((extra_vmem + b_vmem) > b_vmem_max) return false;` with `HTP_OP_MAX_BUFS
  16` / `HTP_OP_MAX_VMEM_DEFAULT 3355443200u` (`htp/htp-ops.h:126,132`) — an n_ctx-larger plan
  changes *which* batches fit vmem (< one flush): a scheduling change only.
- **Mapping policy**: `:682 fastrpc_map_flags flags = this->pinned ? FASTRPC_MAP_FD : (extended ?
  FASTRPC_MAP_FD_DELAYED_EXTENDED : FASTRPC_MAP_FD_DELAYED);` with `:4164-4165 const bool extended
  = opt_dma64 && is_weight;` — on v73 `opt_dma64` is false (`:8720 opt_arch > 79`), so **every**
  buffer, including the 140 MiB KV, is mapped lazy/`DELAYED`: the DSP faults pages in as the KV
  writes walk forward.

## 3. Refuted (hostile to my own candidates)

- **(1) mid-decode gallocr realloc — REFUTED.** 8192 decode tokens at n_ctx 8960 with
  `GGML_SCHED_DEBUG=2` produced **no** `graph has different number of nodes` /
  `node %s is not valid` / `cannot reallocate multi buffer graph automatically` /
  `reallocating %s buffer from size` line (`ggml/src/ggml-alloc.c:1052-1097` are those
  diagnostics; `ggml-alloc.c:1084-1090` is the multi-buffer refusal; and `GGML_SCHED_DEBUG=2`
  would have aborted on an unexpected realloc at `ggml-backend.cpp:1682`). Reason:
  `needs_realloc` compares sizes against the `n_kv = n_ctx` plan, and the decode graph is
  strictly smaller. The only door left open is `ggml-backend.cpp:1672 if (backend_ids_changed ||
  !ggml_gallocr_alloc_graph(...))` → `:1694 ggml_gallocr_reserve_n(...)` (a real mid-decode
  realloc exists; nothing in the FA-off graph changes backend assignment with n_kv, only with
  n_tokens at the pp→tg transition, which happens once at the start).
- **(5) "2048 as a constant" — REFUTED.** `grep -n "\b2048\b"` over `src/llama-kv*, llama-graph*,
  llama-context*, ggml-alloc.c, ggml-backend.cpp` gives two hits, neither in the decode path:
  `src/llama-governor-policy.cpp:20 constexpr uint32_t k_table_tokens[] = { 128, 512, 1024, 2048 };`
  (prefill admission, prompt-sized) and `src/llama-context.cpp:3863 /*.n_batch =*/ 2048,` (default
  param). Every OpenCL 2048 is FA-only: `ggml-opencl.cpp:19186-19189 static constexpr int
  FD_MIN_N_KV = 2048; static constexpr int FD_KV_PER_SPLIT = 2048;` (flash decoding),
  `:19297 if (n_kv >= 2048) { sched.softmax_reduce_lws0 = 1024; }` (adreno-xmem attention).
  ggml-hexagon's are HMX tile byte counts (`htp/matmul-ops.h:18 HTP_MM_HMX_TILE_SIZE =`
  `(32 * 32 * sizeof(__fp16))`). FA is off in both reset runs, so none of these run.
- **KV defrag/shift — REFUTED for this tree**: no `defrag` code exists (only
  `src/llama-kv-cells.h:105` comment and a removed `defrag_thold` default at
  `src/llama-context.cpp:3883`); `memory_update` is not called per decode.
- **mask OOB from a stale n_kv — REFUTED as a mechanism**: `src/llama-graph.cpp:48-64
  can_reuse_kq_mask` requires `res &= (kq_mask->ne[0] == n_kv);`, and the writer asserts host
  memory (`src/llama-kv-cache.cpp:1912 GGML_ASSERT(ggml_backend_buffer_is_host(dst->buffer));`),
  so a reused graph cannot be written with a different n_kv row width.

## 4. Ranked hypotheses

**H1 — PLAUSIBLE (leading): FA-off + f16 KV is bench-only, and its n_ctx-sized buffers are what
make the run fragile.** The app runs FA auto with q8_0/q4_0 KV; the bench disables FA
(`governor-bench-run.cpp:31`) which builds an F32 mask and F32 KQ per token, forces `v_trans`, and
doubles the KV bytes. §2's +334 MiB plan is entirely attributable to this path.
*Cheapest test (no recompile; an arm64 `llama-bench` + v73 skel already exist locally as
`build-gateg/bin/llama-bench`, `build-gateg/ggml/src/ggml-hexagon/libggml-htp-v73.so`):*
`llama-bench -m <lfm2.5> -ngl 99 -dev HTP0,GPUOpenCL -ts 1,0 -t 5 -p 512 -n 1024 -r 1 -fa 0
-ctk f16 -ctv f16` (safe probe), then `-fa 1`, then `-ctk q8_0 -ctv q4_0` (the app's pair), then
`-n 1600` on the FA-off arm — the same one-copy J(1) load the bench mirrors.
*Hostile:* `--gen 2049` was also FA-off + f16 and survived 2048 tokens; and the app crossed 2048
with n_ctx 8192. So H1 alone is not sufficient — it needs H2/H3's size term to matter.

**H2 — PLAUSIBLE: position-dependent device access inside an n_ctx-sized lazily mapped KV
allocation.** The KV write walks cells 0..position inside a 140 MiB rpcmem/cl_mem sized by n_ctx;
at cell 2048 each layer's touched K plane is exactly 2 MiB (`n_embd_k_gqa` 512 × f16 × 2048) and
the FA-off transposed V plane 2 MiB more; v73 maps everything `FASTRPC_MAP_FD_DELAYED`
(`ggml-hexagon.cpp:682,4164`) behind a single 4 KiB guard (`:744-750`), and the OpenCL KV is a
plain exact-size `cl_mem` with no guard at all.
*Cheapest test:* the **GPU-alone** case, `llama-bench ... -dev GPUOpenCL -ngl 99 -n 1600 -fa 0
-ctk f16 -ctv f16` (no HTP0 in the device list → no rpcmem import, no lazy map). A reset there
kills H2 and leaves the shared OpenCL/KV path. Then `GGML_HEXAGON_HOSTBUF_UNCACHED=1` on arm L
isolates a cache-policy/coherency variant.
*Hostile:* the GPU leg's cl_mem pages are mapped eagerly at creation; a lazy-map fault story
does not obviously apply to it, so "common to both legs" is this hypothesis' weak point.

**H3 — PLAUSIBLE: total n_ctx-driven footprint is a precondition, and the trigger is a resource
exhaustion inside the driver (rpcmem/dma-heap/SMMU table) rather than a position.** Evidence:
the measured +334 MiB plan, 140 vs 44 MiB KV per leg, 3 leg contexts, and the harness's own
`HR_STOP` arriving at the same window (46) as the resets in a *cooler* run
(`session16: "ARM STOP: leg headroom 37.5 9.8 32.4 < 10"` at `windows_tokens=1472`).
*Cheapest test:* sample `/proc/meminfo`, `dumpsys meminfo`, `ls /sys/kernel/debug/dma-buf/` and
the rpcmem counters every 10 s during a *survivable* run (`--gen 8193` with the harness stop
lowered to headroom < 20 C, i.e. ~window 30-35) and compare the last samples against the
`--gen 2049` run's. No reset needed.

**H4 — WEAK: an SMMU fault from an OpenCL kernel writing into an imported HTP dma-buf (question 2).**
The imports are live in both legs (the GPU runs the lm_head inside the NPU decode in run A and
reads the same HTP0-TILE32/HOST-W bytes in run B), and an unmapped/foreign write is what Samsung
escalates to `SYSTEM_LAST_KMSG_*_KP`. But nothing in those kernels scales with n_kv or position
(lm_head shape fixed, KV/QK tensors OpenCL-owned): an *index* bug would have to fire at ~2048.
*Cheapest test:* `-dev GPUOpenCL` alone (no imported HTP weights, no rpcmem): returns ⇒ H4 is on.
The import path was audited read-only (`audit-unmeasured-override-n2.md` F2); no size defect found.

**H5 — PLAUSIBLE: thermal/power escalation with no software fault.** Both resets sit at 46-47
windows ≈ 81 s (npu, ~18 tok/s) and ≈ 94 s (gpu, ~16 tok/s): token index matches to ±1 window,
elapsed time differs 15%. `session13` (legheat) sustained **2048** tokens on the *same* legs and
survived, but it was cooler (`npu_hr` 22-25 C steady vs 5.0 C in the reset run).
*Cheapest test:* same arm with `HR_STOP` at 20 C (stops ~window 30). A reset at window 46-48 with
a cooler NSP ⇒ position wins; a clean early stop ⇒ next run `--hop 128`, which puts the same KV
position at 11 windows: a reset at ~82-94 s proves time over position.

**H6 — REFUTED: gallocr realloc (1), 2048 constants (5), defrag, mask OOB, HTP VTCM.** No
per-decode `memory_update`/defrag exists in this tree (only `src/llama-kv-cells.h:105` mentions
it; `defrag_thold` survives as a removed default at `src/llama-context.cpp:3883`).
`ggml_hexagon_supported_mul_mat` (line 5957) never sizes VTCM from the KV length: the F16 branch
(`:5998-6008`) checks only `src0->nb[1] >= src0->nb[0]` and `src1->ne[2] % src0->ne[2] == 0`, and
with `k_p = [head_dim, n_kv, n_head_kv]`, `q_p = [head_dim, n_head, n_tokens]` decode
(`n_tokens = 1`) fails that divisibility — the FA-off decode attention runs on the CPU (in
HTP0-HOST rpcmem), so its HTP support cannot flip at n_kv 2048.

## 5. Cheapest discriminating experiment set (in order, all need no recompile)

1. **Host, free, no phone**: the two `governor-bench --legs cpu` runs of §2 — they pin the n_ctx
   plan cost (265.51 → 599.51 MiB) and prove no mid-decode realloc. Keep these numbers honest.
2. **Phone, ~30 s of decode**: `llama-bench -m <lfm2.5> -ngl 99 -dev HTP0,GPUOpenCL -ts 1,0 -t 5
   -p 512 -n 1024 -r 1 -fa 0 -ctk f16 -ctv f16 -v` — if this resets before 1024 the governor is
   exonerated and the crash is in the J(1) load itself.
3. **Phone, the separator matrix** (one at a time, ~1-3 min each): `-n 1600 -fa 0` (does it die at
   ~1472-1536 outside the governor?), `-fa 1` (is FA the separator?), `-ctk q8_0 -ctv q4_0` (KV
   type?), `-dev GPUOpenCL` (GPU alone?).
4. **Position vs time, one command**: `llama-bench ... -c 8960 -p 1900 -n 200 -fa 0 -ctk f16
   -ctv f16` — n_ctx 8960, but positions 1984-2079 occur after ~200 steps (~12 s): a reset kills
   every duration/heat hypothesis; a clean pass kills every position hypothesis at this n_ctx.
5. **Env switches on arm L** (one variable each, no rebuild): `GGML_HEXAGON_HOSTBUF_UNCACHED=1`
   (cache policy of the CPU-side rpcmem tensors), `GGML_HEXAGON_OPQUEUE=0` (synchronous dispatch:
   rules out a fence/async-realloc race), `GGML_HEXAGON_MBUF=256` (forces multi-chunk plans —
   informative, but it changes the geometry, so not a clean attribution).
6. **Logging**: `GGML_SCHED_DEBUG=2 -v` on the crashing arm, then read the tail of
   `/data/local/tmp/govhtp/step5-s23/vsleg_*.log` for `reserving|reallocating|cannot reallocate|`
   `splits|HTP0 compute buffer size` (level 2 aborts on an unexpected realloc — itself the signal).

## 6. What I could not settle (hostile to the whole story)

- **The log tail is one window ambiguous.** Both logs end mid-line at window 46 (`leg_window
  arm=L rep=0 window=45 ...` then `leg_window arm=L rep=0`), which only proves window 46 was
  *flushed*; 47-48 may sit in a stdio block buffer that never reached the file. The crash
  position is therefore 1984-2111, and the two clean "2048 crossings" (n_kv 2048→2304, first
  write at cell 2048) sit just outside it. Read §4 with that ±1 window.
- **Position beats timing, but not by much**: npu 46 windows = 81 s, gpu 46 = 94 s (15% apart,
  inside the model-load jitter of the arm-start stamps), so "46 windows" is not a clean
  token-vs-time discriminator; experiment 4 is.
- **The host numbers are CPU-only**; on the device the graph splits across HTP0/OpenCL/CPU, so
  per-backend sums differ (8650 app: 129 MiB CPU at n_ctx 16384 FA-on; S23 one-copy: 254 MiB HTP0
  at n_ctx 512 FA-off). The *shapes*, hence the n_kv-linear terms, are backend-independent.
- **I did not read**: the OpenCL FA-off softmax/repack paths (`ggml-opencl.cpp:19795+`), the
  DSP-side `set-rows-ops.c`/`cpy-ops.c` index arithmetic, and Samsung's `SYSTEM_LAST_KMSG` (phone
  off-limits by instruction; the kernel backtrace, not the process log, names the faulting device).
