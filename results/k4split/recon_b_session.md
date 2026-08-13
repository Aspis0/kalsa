# N0 recon B — parent engine Session::open × GPU split knobs

Date: 2026-08-12
Scope: Mechanism B only (`--override-tensor` / `--cpu-moe` keep `ffn_*_exps` on CPU).
This is **not** a kernel note. No ggml-opencl / FLASH_ATTN / GEMV work.
Every claim is from the tree at the paths below.

## Verdict (one paragraph)

The fork already expresses the split: `llama_model_params.tensor_buft_overrides` exists,
`-ngl` / `-ot` / `-cmoe` / `-fa off` already flow through `common/` into
`llama_model_load_from_file` / `llama_init_from_model`. The **parent engine does not
expose any of that**. `bmoe-cli` has no `--ngl`, no `--override-tensor`, no
`--moe-cpu-experts`, no `--fa`. `Session::open` hardcodes `n_gpu_layers = 0` and never
touches `tensor_buft_overrides` or `flash_attn_type`. Campaign Android `bmoe-cli` is
built with `GGML_OPENCL=OFF`. The split is **not BLOCKED_ARCH** — the fork can do it —
but **parent wiring + OpenCL-on rebuild + dense-anon skip of GPU tensors** are required
before N1. Default `n_gpu_layers=-1` in llama.cpp is “all layers”; the parent
deliberately shuts that off.

## Call chain as-built (CPU-only today)

```
cli/main.cpp:542  main()
  └─ parses flags into RunConfig (no GPU fields exist)
  └─ session_mode? run_session_loop : run() / Session::open
       runtime.cpp:9   session_config_from(RunConfig → SessionConfig)
                       copies model/threads/ctx/ubatch/chat/n_expert_used/
                       compute_trace/sampling/moe/spec ONLY
       session.cpp:366 Session::open(SessionConfig)
         llama_backend_init()                         :382
         llama_model_default_params()                 :407
           n_gpu_layers forced = 0                    :410   ← HARD SHUT
           use_extra_bufts = false                    :409   (streamer invariant)
           use_mmap = true                            :408
           mmap_prefetch = -1 if moe.enabled          :416-418
           tensor_buft_overrides left nullptr         (default :2304)
           kv_overrides only for n_expert_used        :426-441
         llama_model_load_from_file(...)              :444
         llama_context_default_params()               :500
           flash_attn_type left AUTO                  (default :3432)
           never set n_gpu / fa / ot
           cb_eval = RouterHook if moe or compute_trace :510-512
         llama_init_from_model                        :519
         moe capture warm-up decode                   :602-622
         dense-weights anon/ahwb rebind               :663-679
         ExpertStreamSource::init rebind experts      :682
         enable_overlap_hook → ggml_cpu_set_expert_ready_hook :715-717
```

`run()` (`runtime.cpp:29`) and the CLI session loop (`cli/main.cpp:227`, `:814`) both
open via `session_config_from`. Adding a field to `RunConfig` without mapping it in
`session_config_from` silently drops it.

## What already works

| piece | where | why it is enough for Mechanism B |
|---|---|---|
| `llama_model_tensor_buft_override` | `include/llama.h:290-293` | `{pattern, buft}` pair |
| `llama_model_params.tensor_buft_overrides` | `llama.h:300` | NULL-terminated list on the **model** params (not context) |
| Default overrides = nullptr | `llama-model.cpp:2304` | no-op today |
| Apply at tensor create | `llama-model-loader.cpp:1164-1188` | `std::regex_search(tensor_name, pattern)`; CPU override goes through `select_weight_buft(..., buft_list_cpu)` |
| `--override-tensor` / `-ot` | `common/arg.cpp:2466-2469` | parses `pattern=BufferType` via `parse_tensor_buffer_overrides` (`arg.cpp:249-280`) |
| `--cpu-moe` / `-cmoe` | `arg.cpp:2471-2476` | pushes `llm_ffn_exps_cpu_override()` |
| `--n-cpu-moe` / `-ncmoe` | `arg.cpp:2478-2491` | per-block `blk.<i>\\.ffn_(up\|down\|gate\|gate_up)_(ch\|)exps` |
| Expert regex | `common/common.h:1054-1066` | `LLM_FFN_EXPS_REGEX = "\\.ffn_(up\|down\|gate\|gate_up)_(ch\|)exps"` — matches `blk.N.ffn_{gate,up,down}_exps.weight`, **not** `*_shexp`, **not** `ffn_gate_inp` |
| `-ngl` / `--gpu-layers` | `arg.cpp:2493-2504` | sets `common_params.n_gpu_layers`; `common.cpp:1558` copies to `mparams` |
| `-fa on\|off\|auto` | `arg.cpp:1518-1527` | `common.cpp:1613` → `cparams.flash_attn_type` |
| Layer placement | `llama-model.cpp:1292-1317` | `i_gpu_start = max(n_layer_all+1-ngl, 0)`; input embeddings always CPU (`:1307-1308`); output is layer index `n_layer_all` |
| ngl semantics | `llama-model.cpp:1683-1685` | `ngl >= 0` is exact; **negative = all layers + output** |
| mmap + GPU copy | `llama-model-loader.cpp:1545-1572` | host-mmap tensors: `ggml_backend_tensor_alloc` into mmap; already-allocated (GPU) tensors: **`ggml_backend_tensor_set` copy** |
| Unused mmap unmap | `llama-model-loader.cpp:1677-1687` | only fragments **outside** `[first mmap-used, last mmap-used]` |
| Streamer rebind of experts | `expert_stream_source.cpp:124-164` | writes `tensor->data` to slot/cache host buffers — **requires host CPU tensors** |
| Capture harvest | `router_hook.cpp:25-39`, `:1214-1236` | names `blk.<il>.<ffn_*_exps>.weight` via recipe (`arch_registry.cpp:20` `qwen35moe`) |
| Expert-ready hook | `expert_stream_source.cpp:1373-1377` | `ggml_cpu_set_expert_ready_hook` — **CPU `mul_mat_id` only** (K0 Q7) |
| `use_extra_bufts=false` | `session.cpp:409` | load-bearing: streamer reads file-native bytes (`docs/moe-streaming.md` “Why repack must stay off”) |
| `--n-expert-used` | `cli/main.cpp:579-580` → `session.cpp:426-441` | already a kv_override precedent for “keep an array alive across `llama_model_load_from_file`” |
| Parent already `#include "common.h"` | `session.cpp:20` | can call `llm_ffn_exps_cpu_override()` **without a fork patch** |

K2.1 already used `-ot token_embd.weight=CPU` on `llama-cli` (`reports/moe-gdn-k21-parity.md`). Buffer type names on that binary: `CPU`, `OpenCL`.

## What is hardcoded shut

### Parent config / CLI — no GPU surface at all

`RunConfig` (`core/include/bmoe/config.h:294-342`) and `SessionConfig`
(`core/include/bmoe/session.h:34-56`) have **zero** of:

- `n_gpu_layers`
- `flash_attn_type` / `flash_attn`
- `tensor_buft_overrides` / `cpu_moe` / override-tensor strings

`session_config_from` (`runtime.cpp:9-22`) therefore cannot carry them.

`cli/main.cpp:557-708` flag loop: no `--ngl`, `-ngl`, `--gpu-layers`, `--fa`,
`--flash-attn`, `--override-tensor`, `-ot`, `--cpu-moe`, `--moe-cpu-experts`.
Unknown args die (`:704-707`). `print_usage` (`:352-440`) documents none of them.

There is **no** flag named `--moe-cpu-experts` anywhere in the repo. The fork name
is `--cpu-moe` / `-cmoe` (`arg.cpp:2472`).

### Session::open — three hard zeros

```
session.cpp:405-410
  // Load with the layout the streamer requires: file-backed mmap, no repack
  // (a repacked q4_K buffer would break the rebind), experts on CPU.
  mparams.use_mmap = true;
  mparams.use_extra_bufts = false;
  mparams.n_gpu_layers = 0;     // ← kills trunk GPU regardless of compile flags
```

`tensor_buft_overrides` is never assigned (stays `nullptr` from
`llama_model_default_params`, `llama-model.cpp:2304`).

`cparams` (`session.cpp:500-517`) sets `n_ctx`, `n_batch`, `n_ubatch`, `cb_eval`,
`n_rs_seq`. It does **not** set `flash_attn_type`. Default is
`LLAMA_FLASH_ATTN_TYPE_AUTO` (`llama-context.cpp:3432`). AUTO is treated as
“FA not disabled” (`llama-context.cpp:222-223`: `flash_attn = type != DISABLED`).
On A7X, FA-on aborts (`reports/moe-gdn-750.md` §3.1, `reports/moe-gdn-k22-fix.md` §6).
Today this is latent: `ngl=0` never builds a GPU FA node. **The moment ngl>0 without
an explicit DISABLE, capture warm-up (`session.cpp:619-620`) will compile FA and die.**

`op_offload` default is `true` (`llama-context.cpp:3450`). Parent does not touch it.

### llama.cpp defaults the parent overwrites

| field | `llama_model_default_params` | Session::open |
|---|---|---|
| `n_gpu_layers` | **-1 = all layers + output** (`llama-model.cpp:2305`, `:1683-1685`) | **0** |
| `use_extra_bufts` | true (`:2317`) | false |
| `use_mmap` | true | true |
| `tensor_buft_overrides` | nullptr | nullptr (unchanged) |
| `mmap_prefetch` | 0 = auto on (`:2320`) | -1 if `--moe-stream` |

If a future change deleted the `= 0` line and OpenCL were linked, the parent would
offload **everything**, including experts, and the hook would go dead.

### Campaign `bmoe-cli` is CPU-only

`BigMoeOnEdge/scripts/build-android.ps1:65` **forces `-DGGML_OPENCL=OFF`**.
Comment at `:73-77` says leftover `libggml-opencl.so` once shipped by accident.
K2 GPU binaries were **out-of-tree `llama-cli`**, not `bmoe-cli`
(`results/gdn_gpu_k2/BUILD_MANIFEST.md`: `-S .../third_party/llama.cpp`,
`-DGGML_OPENCL=ON`, targets `llama-cli llama-bench test-backend-ops`).

`llama-cli` has the GPU flags but **does not have** `--moe-stream` / `--cache-mb` /
`--overlap` / `--dense-weights` / `--drop-cold-experts`. Campaign k6d065 cannot
run on `llama-cli`. Split product path is **parent engine + OpenCL-on rebuild**.

## How the four knobs *would* flow (not implemented)

All four are parent-only wiring. No fork commit required for Mechanism B.

```
bmoe-cli
  --ngl 99
  --fa off                          # mandate: always off on A7X
  --cpu-moe                         # or --moe-cpu-experts (alias)
  [--override-tensor PAT=CPU]       # optional extra, e.g. debug
       │
       ▼
RunConfig  { n_gpu_layers, flash_attn_type, cpu_moe, override_tensor[] }
       │  session_config_from
       ▼
SessionConfig  (same fields)
       │  Session::open
       ▼
mparams = llama_model_default_params()
mparams.n_gpu_layers           = cfg.n_gpu_layers          // 99
mparams.use_extra_bufts        = false                     // keep
mparams.use_mmap               = true                      // keep
// overrides MUST outlive llama_model_load_from_file (same as kv_overrides:426-441)
overrides[] = llm_ffn_exps_cpu_override()                  // common.h:1064
           + parsed --override-tensor entries
           + {nullptr, nullptr} terminator                 // common.cpp:1579
mparams.tensor_buft_overrides  = overrides

cparams.flash_attn_type        = LLAMA_FLASH_ATTN_TYPE_DISABLED   // --fa off
```

`--override-tensor` value format (fork): `pattern=BufferType`, comma-separated
(`arg.cpp:261-279`). Buffer type names come from live backends after
`ggml_backend_load_all()` (`:250-258`). On an OpenCL `llama-cli` they were `CPU`
and `OpenCL` (K2.1). Mechanism B only needs `CPU`.

`--cpu-moe` is strictly stronger / simpler than a hand-written
`ffn_.*_exps.*=CPU`: the stock regex already excludes shared-expert `*_shexp`
and the router `ffn_gate_inp`, so those stay on the layer device (GPU under
`-ngl 99`). That is the design: trunk + shared expert + router + dense on GPU,
routed experts on CPU.

`llama_max_tensor_buft_overrides()` = 4096 (`llama.cpp:61-63`). A single
`--cpu-moe` entry plus terminator is enough.

## RAM / double-residency risk (the killer)

Adreno GPU buffers are **the same DRAM**. Mandate: dense trunk ~1.75 GiB GPU +
`--dense-weights anon` host copy + `--cache-mb 2000` + KV + runtime ≈ RescueParty
if both copies live.

### What llama.cpp does on mmap + ngl>0

1. GPU tensors are allocated in a device buffer, then filled with
   `ggml_backend_tensor_set` from the mmap (`llama-model-loader.cpp:1570-1571`).
2. Those copies are **not** recorded in `mmaps_used` (only the mmap-alloc path
   at `:1560-1569` is).
3. After load, unused mmap fragments outside the used range are unmapped
   (`:1679-1687`). `mmaps_used` is initialized to `(size, 0)` (`:1359`).
   Expert tensors left on CPU **are** mmap-allocated, so the used window is
   roughly “first expert … last expert” — i.e. almost the whole KEXP file.
   GPU-copied dense pages that sit **inside** that window stay mapped.

Net after a split load, before parent post-processing:

| resident | who owns it |
|---|---|
| GPU CL buffers ≈ dense trunk 1.75 GiB | llama.cpp OpenCL |
| mmap pages of routed-expert tensors | llama.cpp mmap |
| mmap pages of dense tensors still inside the expert byte window | leftover host copy of the same 1.75 GiB |

### What the parent then does (today, assuming ngl were 99)

`Session::open:663-679` builds `DenseTensorRef` for **every captured non-expert
weight leaf** (attn, GDN, shared expert, router, norms, lm_head). Capture
records the same `ggml_tensor *` the model owns (`router_hook.cpp:1235`).

`DenseWeights::read_anonymous` (`dense_weights.cpp:93-244`) then:

1. Allocates a **new host anon buffer per tensor** (`:115-135`).
2. Copies from mmap or O_DIRECT (`:212-233`).
3. **`d.tensor->data = it.buf`** (`:234`) — **rebinding a GPU tensor onto a
   host pointer**. That undoes ngl for the trunk (compute reads host; CL
   buffers stay allocated). Triple residency: GPU + anon + leftover mmap.
4. `drop_mmap_copies` (`:271-289`) MADV_DONTNEEDs the file pages. Helps mmap,
   does **not** free the GPU buffers, does **not** know about GPU.

`ExpertStreamSource::init` cache-auto (`:90-105`) deducts `dense_pending` from
available RAM *before* that conversion. If we skip GPU tensors in dense-anon,
this deduct **must** stop counting them as a *second* host copy — they are
already in GPU DRAM.

### Required RAM patch (parent, small)

When `tensor->buffer` is not a host buffer (`ggml_backend_buffer_is_host`):

- do **not** include it in `set_dense_tensors`
- do **not** rebind `tensor->data`
- optionally still `MADV_DONTNEED` the corresponding mmap range (same
  `drop_mmap_copies` logic) so the leftover host pages die

`--dense-weights anon` can stay the campaign default; it becomes “anon for
whatever is still host (experts are streamed; trunk is GPU)”. A new
`--dense-weights anon-gpu` flag is **not** required if the skip is automatic.

Expect after the skip: dense-GPU 1.75 + cache 2000 + KV(c=4096) + runtime.
Monitor `/proc/meminfo` MemFree at N1; abort <300 MiB sustained.

## Smallest surface to change

Parent-only. Do **not** branch the fork until this is proven insufficient.

| file | change |
|---|---|
| `core/include/bmoe/config.h` | `int n_gpu_layers = 0;` `bool flash_attn = false;` (or enum; **default off**) `bool cpu_moe = false;` optional `std::vector<std::string> override_tensor;` |
| `core/include/bmoe/session.h` | same fields on `SessionConfig` |
| `core/src/engine/runtime.cpp` | map them in `session_config_from` |
| `core/src/engine/session.cpp` | apply to `mparams` / `cparams`; keep override array alive across load (mirror `kv_overrides[2]`) |
| `cli/main.cpp` | `--ngl`/`-ngl`, `--fa off` (accept `on\|off\|auto`, default off or force off when ngl>0), `--cpu-moe` and/or `--moe-cpu-experts`, optional `--override-tensor`; `print_usage` |
| `core/src/moe/dense_weights.cpp` + `session.cpp:663` | skip non-host tensors; still drop their mmap pages |
| `core/src/moe/expert_stream_source.cpp:96-105` | cache-auto: do not deduct GPU-resident dense as a second host copy |
| `scripts/build-android.ps1` **or a new k4split script** | `GGML_OPENCL=ON`, Adreno kernels, same OpenCL ICD/headers as K2 `BUILD_MANIFEST.md`; **do not silently flip the campaign CPU script** |

Keep `use_extra_bufts=false`. Keep `--overlap` on the CPU `mul_mat_id` hook.

Tests: `tests/config_test.cpp` if `validate()` grows “ngl>0 requires cpu_moe when moe-stream” — optional belt-and-suspenders, not required if dense skip + `--cpu-moe` are always set together by the CLI when `--moe-stream --ngl` are both on.

## Open questions

1. **Does OpenCL keep a convert workspace** (noshuffle SOA) in addition to the
   GGUF-sized CL buffer? If yes, dense GPU > 1.75 GiB. Measure at N1 from
   `llama_model` memory breakdown + `/proc/meminfo`, do not guess.
2. **Tied lm_head / `token_embd.weight` Q6_K** on 35B KEXP: K2.2 dispatch fix
   is on `04c5d362a`. Confirm the 35B vocab shape is even-`ne1` so it stays on
   noshuffle. If not, Mechanism B can also `-ot token_embd.weight=CPU` (K2.1
   workaround) without a kernel change.
3. **MTP / `n_layer_all`**: `--ngl 99` offloads output + all repeating layers
   including nextn if `n_layer_all` includes it. `--cpu-moe` still pins MTP
   `ffn_*_exps`. Confirm MTP shared/dense tensors are in the GPU budget.
4. **`llama_supports_gpu_offload()`** (`llama.cpp:73-79`): if OpenCL fails to
   register, ngl is silently a no-op on `llama-cli` (warning only,
   `arg.cpp:2505-2508`). Parent should **fail open()** if ngl>0 and no GPU,
   not pretend the split loaded.
5. **Mechanism A** (Q2_K/Q3_K `supports_op` false) is a separate recon. B is
   the explicit pin and should be the product default under `--moe-stream`
   even if A would have worked — so a future OpenCL Q2_K `MUL_MAT_ID` cannot
   silently steal experts and kill the hook.
6. **Who builds the night binary**: `bmoe-cli` with OpenCL vs `llama-cli` +
   no streaming. Decision: **bmoe-cli**. `llama-cli` cannot run k6d065.

## BLOCKERS

None that are `BLOCKED_ARCH`. The fork can express the split today.

Must-fix before N1 (implementation, not architecture):

- Parent has no path from CLI → `open()` for ngl / fa / cpu-moe / `-ot`.
- Campaign Android `bmoe-cli` is `GGML_OPENCL=OFF`.
- `--dense-weights anon` will **rebind GPU trunk tensors to host** and
  double-reside ~1.75 GiB if ngl is turned on without a host-buffer skip.
- `flash_attn_type` left AUTO will abort on A7X the first time ngl>0.

No device work in this note. No PLAN.md update. No push.
