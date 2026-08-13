# N0 recon — Dense weights and RAM (anon × GPU offload)

Date: 2026-08-12
Scope: `DenseWeightsMode`, `core/src/moe/dense_weights.{h,cpp}`, host copy after
llama GPU upload, double residency of the KEXP trunk on 8 GB S23, existing
`cache_auto` / `cache_floor_mb`, and what `--dense-weights anon-gpu` must do
(one DRAM copy). Read-only recon. Not a kernel note.

Companion: `results/k4split/recon_b_session.md` (ngl/ot wiring). This note is
the RAM half.

Every claim is from the tree or a campaign log. Mandate planning figure
“~1.75 GiB” is replaced below by the measured KEXP number.

## Verdict

**GPU upload of dense weights never happens today.** `Session::open` hardcodes
`mparams.n_gpu_layers = 0` (`BigMoeOnEdge/core/src/engine/session.cpp:410`).
`--dense-weights` has no `anon-gpu` value (`cli/main.cpp:646-659`;
`DenseWeightsMode` in `core/include/bmoe/config.h:30-37` is only
Mmap / Warmed / Anonymous / Pinned).

If ngl is wired without a host-skip, `--dense-weights anon` will allocate a
**second** 1664 MiB DRAM copy, rebind `tensor->data` off the OpenCL buffer,
and leave the CL buffers allocated. That is triple residency at the worst
moment (GPU + anon + leftover mmap), then double after `drop_mmap_copies`.
On 8 GB that is RescueParty.

The host mmap **is** already freed after the *anon* fill (`drop_mmap_copies`,
`dense_weights.cpp:271-289`). Nothing frees a host copy after a *GPU* upload,
because GPU upload does not exist on this path. llama.cpp’s own unmap after
`ngl>0` does **not** drop dense mmap pages that sit between CPU expert
tensors (`llama-model-loader.cpp:1677-1687` + `mmaps_used` init `:1359`).

`anon-gpu` (flag or automatic skip) must: **one DRAM copy = the OpenCL CL
buffer**; do not allocate `DenseWeights` anon/ahwb buffers for non-host
tensors; still `MADV_DONTNEED` their mmap pages; do not rebind `tensor->data`.

Not BLOCKED_ARCH. Smallest fix is parent-only.

---

## Call chain (as-built, CPU-only)

```
cli/main.cpp:646-659     --dense-weights mmap|warm|anon|ahwb
                         (aliases :663-666 --no-warm-dense / --dense-odirect)
                         default Anonymous  config.h:104
  session_config_from    copies MoeStreamConfig as a blob  runtime.cpp:9
  Session::open
    llama_backend_init()                                      session.cpp:382
    llama_model_default_params()
      use_mmap = true                                         :408
      use_extra_bufts = false                                 :409   streamer invariant
      n_gpu_layers = 0                                        :410   HARD SHUT
      mmap_prefetch = -1 if moe.enabled                       :416-418
      tensor_buft_overrides left nullptr
    llama_model_load_from_file                                :444
      load_tensors → CPU host-ptr mmap buffers
        llama-model.cpp:1543-1563  (CPU supports buffer_from_host_ptr)
        llama-model-loader.cpp:1560-1569  tensor_alloc into mmap
    llama_init_from_model                                     :519
    warmup 1-token decode (capture)                           ~602-622
      RouterHook harvests:
        ffn_*_exps → LayerExperts                             router_hook.cpp:1220-1230
        other GGML_OP_NONE named src → captured_weights_      :1232-1235
    if Anonymous|Pinned:
      build DenseTensorRef list from captured_weights_
        minus expert names, only if in GGUF offsets           session.cpp:663-679
      source.set_dense_tensors(...)
    ExpertStreamSource::init                                  :682
      cache_auto budget (deducts dense_pending)               expert_stream_source.cpp:82-121
      rebind experts onto slot/LRU host buffers               :124-164
      drop expert mmap pages                                  ~210-226
      dense_.init(mode, paths, align, ranges, tensors)        :296
        Anonymous|Pinned:
          read_anonymous()  copy mmap/O_DIRECT → new buffers
          rebind tensor->data = buf                           dense_weights.cpp:234
          drop_mmap_copies()                                  :67 then :271-289
        Warmed: sequential page-cache sweep                   :68-69, :293-325
        Mmap: no-op
      start I/O workers                                       :306-308
```

Shutdown: `DenseWeights::shutdown` frees `bufs_` / `pinned_` only
(`dense_weights.cpp:403-414`). Called from the streamer teardown
(`expert_stream_source.cpp:1455`). It never touches llama/OpenCL buffers.

---

## What already works

| piece | file:line | note |
|---|---|---|
| Four modes | `config.h:30-37` | Mmap, Warmed, Anonymous (default), Pinned (ahwb) |
| CLI parse + help | `cli/main.cpp:433-441`, `:646-666` | `anon-gpu` is **rejected** (`got '%s'` → exit 2) |
| Dense = complement of expert file ranges | `dense_weights.cpp:18-28`, `expert_stream_source.cpp:284-295` | header, embd, attn, GDN, shared expert, router, norms, lm_head |
| Capture of non-expert weight leaves | `router_hook.cpp:1232-1235`, `session.cpp:663-678` | filtered by GGUF `off_by_name` / `size_by_name` |
| Anon/ahwb fill | `dense_weights.cpp:93-244` | mincore plan → memcpy resident pages, O_DIRECT holes, then rebind |
| Drop unused **file** mmap after anon | `dense_weights.cpp:67`, `:265-289` | inward page align so adjacent expert pages survive; `pio::vm_drop_file_pages` |
| Measured KEXP trunk | `results/calaqwen_s23/fix/smoke/fixed.combo.txt:1204-1207` | **`1664 MiB` in 613 anon buffers; dropped 1662 MiB mmap; memcpy=896 odirect=768** |
| cache_auto | `config.h:49-58`, `expert_stream_source.cpp:82-121` | `avail − cache_floor_mb`, clamp `[cache_min_mb, hard_cap]` |
| cache_auto deducts pending anon | `expert_stream_source.cpp:96-105` | subtracts `sum(dense_tensors_.size)` from `MemAvailable` so auto does not plan the dense set twice |
| cache_floor_mb / ceil / min | `config.h:55-56`, `:217` | floor default **1536**; ceil 0 = no cap; `cache_min_mb = 1500` |
| cache_mb 1..1499 rejected | `config.cpp:134-139` | unless `--force-cache`. Mandate N1 retry `--cache-mb 1000` **needs `--force-cache`** |
| Exclusive auto vs explicit | `config.cpp:145-147` | `cache_auto && cache_mb > 0` fails validate |
| CLI `--cache-mb auto` / `--cache-floor-mb` / `--cache-ceil-mb` | `cli/main.cpp:428-430`, `:632-641` | |
| KEXP experts Q2_K/Q3_K | `fixed.combo.txt:191-192` | 80×q2_K + 40×q3_K = 120 = 40 layers × 3 projs |
| Dense quant Q4_K/Q5_K/Q6_K | `fixed.combo.txt:193-195` | 1 + 181 + 70; OpenCL `MUL_MAT` supports these (K0 Q3, K2.2 dispatch fix) |
| KEXP shape | `fixed.combo.txt:236-249`, `:283` | `n_embd=2048`, `n_vocab=248320`, `n_embd_k_gqa=512`, **separate `output.weight`** (`:344-346`) |
| KV @ c=4096 f16 | `fixed.combo.txt:1136` | **80.00 MiB** (4096 cells, 10 full-attn layers) |
| Recurrent @ 1 seq | `fixed.combo.txt:1180` | **62.81 MiB** F32 (does **not** scale with n_ctx) |
| Compute buffers @ `--ubatch 512` | `fixed.combo.txt:1197` | **501.02 MiB** CPU |
| OpenCL `buffer_from_host_ptr` | `ggml-opencl.cpp:10206`, `:10242-10248` | **false** / function returns `nullptr` |
| OpenCL weight buffer | `ggml-opencl.cpp:10094-10115` | `clCreateBuffer(CL_MEM_READ_WRITE)` — Adreno unified DRAM, not a host wrap |
| OpenCL `is_host` | `ggml-opencl.cpp:10162` | `NULL` → `ggml_backend_buft_is_host` is **false** (`ggml-backend.cpp:72-77`) |
| Detect GPU tensor | `ggml-backend.h:64`, `ggml-backend.cpp:174-176` | `!ggml_backend_buffer_is_host(t->buffer)` |
| GPU fill path | `llama-model-loader.cpp:1570-1571` | `ggml_backend_tensor_set` copy from mmap (because `cur->data` already set) |
| Input embeddings stay CPU | `llama-model.cpp:1307-1308` | even at `-ngl 99` |
| SOA convert temp | `ggml-opencl.cpp:7466-7506` (Q1_0 pattern; Q4_0/Q5_K/Q6_K same) | extra `clCreateBuffer` + convert + `clReleaseMemObject` — **not** a second permanent copy. Persistent size ≈ `ggml_nbytes` + 4×alignment slack (`:10138-10153`) |

`docs/cache-sizing.md:79-81` still says the anon footprint “is not subtracted”
from auto. That paragraph is **stale**. The deduct at
`expert_stream_source.cpp:96-105` was added later (DeepSeek V4 6.5 GiB
comment). Trust the code.

---

## What is hardcoded shut

| thing | where | effect |
|---|---|---|
| GPU offload | `session.cpp:410` `n_gpu_layers = 0` | llama never allocates OpenCL weight buffers; `tensor->data` stays host mmap |
| CLI `-ngl` / `-ot` / `-fa` | no parse in `cli/main.cpp` | even an OpenCL-on `bmoe-cli` cannot request a split |
| `tensor_buft_overrides` | never set (default nullptr, `llama-model.cpp:2304`) | cannot pin `ffn_*_exps` to CPU from the parent |
| `DenseWeightsMode` fifth value | `config.h:30-37` | no `AnonGpu` |
| `--dense-weights anon-gpu` | `cli/main.cpp:656-658` | parse error |
| Campaign Android `bmoe-cli` | `scripts/build_bmoe_ndk.sh:283`, `scripts/build_bmoe_termux.sh:286` | **`GGML_OPENCL=OFF`** |
| `use_extra_bufts` | `session.cpp:409` **must stay false** | streamer reads file-native bytes (`docs/moe-streaming.md` “Why repack must stay off”) |

So: **does GPU upload ever happen?** No, not through `bmoe-cli` / `Session`.
It does happen in standalone `llama-cli -ngl 99` (K2.x), which has no
streamer and no `DenseWeights`.

---

## After llama offload: is the host copy freed?

### llama.cpp (if `n_gpu_layers > 0`)

OpenCL cannot wrap mmap (`buffer_from_host_ptr = false`). Flow:

1. `ggml_backend_alloc_ctx_tensors_from_buft` allocates one OpenCL buffer
   (`llama-model.cpp:1572`). `tensor->data` becomes a **fake** host address
   (`ggml_backend_opencl_buffer_get_base` returns `(void*)alignment`,
   `ggml-opencl.cpp:7398-7400`).
2. `load_all_data` copies mmap → CL via `ggml_backend_tensor_set`
   (`llama-model-loader.cpp:1571`). This branch does **not** update
   `mmaps_used`.
3. End-of-load unmap (`:1677-1687`) only drops `[0, first_host_ptr)` and
   `(last_host_ptr, file_end)`. `mmaps_used` starts at `(mapping->size(), 0)`
   (`:1359`). CPU expert tensors **are** host-ptr allocated, so the kept
   window is roughly first-expert … last-expert ≈ the whole KEXP file.
   **Dense mmap pages between experts stay mapped** (file-backed, still
   resident if they were touched).

llama does **not** free that leftover host range for GPU-copied dense.

### parent `DenseWeights` (today, if ngl were 99)

`read_anonymous` does not look at `tensor->buffer`. `mmap_src_of`
(`dense_weights.cpp:138-147`):

- GPU `tensor->data` is the fake OpenCL base+offset, **not** inside a file VMA
  → first branch fails
- falls back to `addr_of(file_idx, file_off)` → still finds the mmap
- allocates a **new** anon/ahwb buffer (`:115-135`)
- memcpy/O_DIRECT into it (`:219-233`)
- **`d.tensor->data = it.buf`** (`:234`) — rebinds the **model** tensor off
  the GPU extra. CL buffer + `tensor->extra` stay. Scheduler still sees
  `tensor->buffer` as OpenCL (never cleared). Host `data` and device `extra`
  now disagree.
- `drop_mmap_copies` then DONTNEEDs the file pages (`:271-289`). Mmap dies.
  GPU + host-anon remain.

That is the double-residency the mandate warned about, plus a correctness
bug (rebind undoes ngl).

`drop_mmap_copies` **does** the right thing for leftover mmap. It is only
called after a successful anon/ahwb fill (`:67`). There is no “drop mmap
without allocating anon” entry point today, but the function itself does not
need the anon buffers — it walks `tensors_` + `addr_of`.

---

## RAM / double-residency on 8 GB S23

Measured on KEXP (campaign `fixed.combo.txt`, `-c 4096 --ubatch 512 --cache-mb 2000 --dense-weights anon`, CPU):

| resident | size | source |
|---|---:|---|
| Dense host anon | **1664 MiB** | `dense-weights=anon — 1664 MiB in 613 anon buffers` |
| Dropped mmap after fill | 1662 MiB | same log — today this **is** freed |
| Expert LRU | 2000 MiB | campaign `cache=2000` |
| KV f16 | **80.00 MiB** | 4096 cells × 10 full-attn layers |
| Recurrent F32 | **62.81 MiB** | 1 cell, 30 GDN layers; independent of c |
| CPU compute | **501.02 MiB** | ubatch 512 |
| **CPU-only sum (weights+cache+KV+RS+compute)** | **~4.21 GiB** | campaign already fits |

Mandate “KV (c=4096)” is **not** a multi-GiB term. 80 MiB. The 6–6.5 GiB
planning total is dense + cache + runtime, not a fat KV.

### If ngl=99 + current `anon` (no skip)

| resident | size |
|---|---:|
| OpenCL weight buffers (dense trunk + `output.weight`) | ~1664 MiB (plus SOA align slack, tiny) |
| Host anon (second copy of the same tensors) | +1664 MiB |
| Leftover dense mmap until `drop_mmap_copies` | +~1662 MiB **peak** |
| cache 2000 | 2000 |
| KV+RS | 143 |
| compute (CPU + possibly a second OpenCL pool after graph splits) | ≥501 |
| `token_embd.weight` stays CPU (`llama-model.cpp:1307`) | already inside the 1664 / the remaining host set |

Steady state after drop: **GPU 1664 + anon 1664 + cache 2000 + ~644 ≈ 5.8 GiB**
of engine-owned buffers, plus Android, plus binary (~180 MiB OpenCL
`llama-cli` from K2.2), plus I/O bounce, plus any OpenCL compute buffer.
That is the RescueParty zone (mandate: MemFree <100 MiB + die ~90 °C).

Load **peak** is worse: GPU alloc happens in `llama_model_load` *before*
streamer drop of expert mmap and *before* `drop_mmap_copies`. Peak ≈
GPU 1664 + still-mapped file pages + then cache commit + then a second 1664
anon alloc. Abort any N1 run if MemFree <300 MiB sustained.

### If ngl=99 + skip host copy (`anon-gpu` / auto-skip)

| resident | size |
|---|---:|
| OpenCL dense | ~1664 MiB (the one DRAM copy) |
| Host `token_embd` (always CPU) | part of 1664 that did **not** go GPU — keep mmap or a small anon |
| cache | 2000 (or 1500 if N1 forces it; 1000 needs `--force-cache`) |
| KV+RS | 143 |
| compute | ~501, possibly split CPU/OpenCL |
| **≈ campaign CPU footprint** | **~4.2 GiB** |

This is the only split that has a realistic chance on 8 GB without cutting
cache.

`token_embd` is a separate GGUF tensor from `output.weight` on KEXP (not
tied like the 2B). n_vocab=248320, n_embd=2048. If that matrix is Q6_K it
is ~398 MiB. It stays on CPU (input layer). The GPU still holds
`output.weight` (lm_head) as its own tensor. No extra `TENSOR_DUPLICATED`
copy of the same bytes — `qwen35moe.cpp:54` only fires when there is no
`output.weight`.

### cache_auto under a split

`cache_auto` reads `pio::mem_available_bytes()` then, if mode is
Anonymous/Pinned, subtracts **every** `dense_tensors_` byte
(`expert_stream_source.cpp:96-105`) *as if a second host alloc is about to
happen*. If GPU tensors are skipped:

- they must **not** be in that deduct (they are already in DRAM as CL
  buffers; `MemAvailable` on Android typically already counts them, or
  soon will)
- host-remaining dense (`token_embd`, any `-ot …=CPU` trunk) **must** stay
  in the deduct

`cache_floor_mb` default 1536 is the “leave free for the system” term.
Campaign k6d065 does **not** use auto; it pins `--cache-mb 2000`. Prefer
the pinned number for A/B fairness. If N1 is tight, drop cache (one
variable) and re-run the CPU arm at the same `--cache-mb`.

---

## What `anon-gpu` should do (one DRAM copy)

Goal: after load, each dense byte lives in **exactly one** anonymous DRAM
object.

| tensor class after `-ngl 99` | one copy is | action |
|---|---|---|
| Trunk weights on OpenCL (`attn_*`, GDN, shared expert, router, `output.weight`, norms if offloaded) | the CL buffer | do **not** alloc anon; do **not** rebind `data`; **do** `drop_mmap_copies` on the file range |
| `token_embd.weight` (always CPU) | mmap or existing anon policy | current Anonymous/Pinned is correct |
| Routed `ffn_*_exps` | streamer slot / LRU | never a `DenseTensorRef` (already filtered) |

Two implementation shapes, same bytes:

1. **Automatic skip (preferred, smaller CLI):** keep `--dense-weights anon`.
   In `session.cpp:663-678` and/or `read_anonymous`, skip tensors with
   `tensor->buffer && !ggml_backend_buffer_is_host(tensor->buffer)`. Still
   run `drop_mmap_copies` on the skipped set (split `tensors_` into
   `rebind` vs `drop_only`, or call drop on the full list *before* filtering
   alloc). Adjust cache-auto deduct to host-pending only.
2. **Explicit `--dense-weights anon-gpu`:** new enum value. Same skip.
   Useful only as a self-documenting campaign flag. Not required if (1) is
   correct when `n_gpu_layers==0` (skip never fires → today’s 1664 anon).

Do **not** implement “free anon after GPU upload”. Order is the other way:
llama uploads during `load_from_file`, parent anon runs **later**. There is
no host-anon to free unless we create it. Creating it is the bug.

Do **not** `aligned_free` a buffer that `tensor->data` still points at.
Do **not** touch `tensor->buffer` / `tensor->extra` on GPU tensors.

---

## Smallest surface to change

Parent only. No ggml-opencl / FLASH_ATTN / GEMV.

| file | change |
|---|---|
| `core/src/moe/dense_weights.cpp` | skip non-host tensors in `read_anonymous`; still `drop_mmap_copies` for them. Optional: public `drop_mmap_copies` usable without a fill |
| `core/src/engine/session.cpp:663` | alternatively filter `set_dense_tensors` the same way (must still drop mmap — so prefer doing skip+drop inside `DenseWeights`) |
| `core/src/moe/expert_stream_source.cpp:96-105` | cache-auto: deduct only host-pending dense |
| `cli/main.cpp` + `config.h` | only if a named `anon-gpu` is wanted; otherwise no CLI change for RAM |
| ngl/ot wiring | see `recon_b_session.md` — required *before* any of this can fire |

Keep `use_extra_bufts=false`. Keep experts on CPU so the hook lives
(`ggml-cpu.c` `mul_mat_id`, K0 Q7).

---

## Open questions

1. **OpenCL compute-buffer size** with a split graph (GPU trunk + CPU
   `mul_mat_id`). Campaign CPU is 501 MiB. A second OpenCL compute pool
   would add RAM. Measure at N1 from `sched_reserve` / `GGML_SCHED_DEBUG=2`.
   Do not guess.
2. **SOA / noshuffle extra images** beyond the GGUF-sized CL buffer. Convert
   scratch is released (`clReleaseMemObject`). Confirm N1 with
   `llama_model` “OpenCL model buffer size” lines vs 1664.
3. **`token_embd` type and bytes** on KEXP (Q5_K vs Q6_K). Stays CPU. If
   Q6_K and someone also `-ot output.weight=CPU`, both vocab matrices sit
   in host DRAM (~0.4 GiB each) *and* not on GPU — a different trade.
   35B vocab is 248320 (`248320 % 128 == 0`) so K2.2 noshuffle is legal
   if the lm_head stays on GPU.
4. **Load peak** before `drop_mmap_copies`: GPU alloc + still-mapped file.
   Sample `/proc/meminfo` every 5 s during load (N1). May need to drop mmap
   *immediately* after `llama_model_load_from_file` for GPU tensors, not
   wait for streamer init.
5. **Pinned/ahwb + GPU:** `Pinned` would also double-reside. Same skip.
   ahwb is not the campaign split default.
6. **`docs/cache-sizing.md`** still describes pre-deduct auto. Do not
   “fix” that doc in this milestone (PLAN.md / drive-by). Implementers
   must read `expert_stream_source.cpp:90-105`.

---

## BLOCKERS

None for this RAM slice. The architecture can express one DRAM copy.

Preconditions (not blockers of *this* module, but N1 cannot run without them):

- Parent must grow `n_gpu_layers` / `-fa off` / expert-CPU override
  (`recon_b_session.md`). Until then GPU upload is unreachable and
  `anon-gpu` is dead code.
- Split `bmoe-cli` must be built `GGML_OPENCL=ON` (campaign scripts force
  OFF). Do not flip the campaign CPU script in place.
- `--cache-mb 1000` is illegal without `--force-cache` (`config.cpp:134-139`).

No BLOCKED_ARCH.
