# N0 recon — expert-ready hook

Date: 2026-08-12
Scope: how `ggml_cpu_set_expert_ready_hook` is registered, fired, and how it dies
  under `--moe-stream --overlap` × `-ngl`. Read-only source audit. No device.

Checkout (paths relative to `BigMoeOnEdge/` unless noted):
- Parent engine: `core/src/moe/expert_stream_source.cpp`, `core/src/engine/session.cpp`
- Fork: `third_party/llama.cpp` (hook in `ggml/src/ggml-cpu/ggml-cpu.c`)
- KEXP types: `../results/requant1c/verify_kexp.out`

This is **not** an OpenCL kernel problem. The hook is a CPU `mul_mat_id` wait
point. OpenCL `MUL_MAT_ID` never sees it.

---

## 1. Call chain (file:line)

### 1.1 Fork API (process-global)

```
ggml/include/ggml-cpu.h:147-151
  typedef ggml_cpu_expert_ready_hook_t(src0, expert, user_data)
  ggml_cpu_set_expert_ready_hook(hook, user_data)   // NULL unregisters
  "Not thread-safe w.r.t. concurrent graph computation"

ggml/src/ggml-cpu/ggml-cpu.c:60-66
  static g_expert_ready_hook / g_expert_ready_hook_data
  setter just stores the two pointers
```

CMake in the parent probes the **header text**, not the git remote:

```
core/CMakeLists.txt:52-63
  if ggml-cpu.h matches "ggml_cpu_set_expert_ready_hook"
    → PUBLIC BMOE_HAVE_EXPERT_READY_HOOK=1
```

The symbol is present in this tree (`ggml-cpu.h:151`). Overlap is therefore
compile-time available.

### 1.2 Parent registration (only `--overlap`)

```
cli/main.cpp:671, 718
  --overlap / BMOE_OVERLAP → cfg.moe.overlap

session.cpp:405-410
  load: use_mmap=true, use_extra_bufts=false, **n_gpu_layers = 0** (hardcoded)

session.cpp:603-622
  one-token capture warm-up (BOS decode) so the eval-callback can harvest
  persistent ggml_tensor* for blk.<il>.ffn_{gate,up,down}_exps

router_hook.cpp:1214-1238
  capture: match_expert(src->name) → LayerExperts.proj[p].tensor = src
  (the model weight leaf, op NONE, ne[2] = n_expert)

session.cpp:682-684
  ExpertStreamSource::init(...) rebinds those tensors off the file mmap
  onto slot/cache buffers (expert_stream_source.cpp:139 / :163)

session.cpp:715-720
  if cfg.moe.overlap:
#ifdef BMOE_HAVE_EXPERT_READY_HOOK
      im.source.enable_overlap_hook();
#else
      fail("--overlap requires the bmoe llama.cpp fork ...")
#endif

expert_stream_source.cpp:1373-1377
  enable_overlap_hook():
      ggml_cpu_set_expert_ready_hook(&ExpertStreamSource::c_expert_ready, this)
      hook_registered_ = true

expert_stream_source.cpp:1412-1420
  shutdown() unregisters FIRST (nullptr, nullptr) then tears down
```

`llama-cli` never calls the setter. Campaign streaming exists only in `bmoe-cli`.

### 1.3 Per-token: eval-callback stages, hook waits

Serial (`--overlap` off) does **not** need the hook. Overlap does.

```
llama_decode
  → ggml_backend_sched
  → RouterHook::c_eval  (session.cpp:511-512)

ask=true, name "ffn_moe_topk-<il>" → isolate that node
  (router_hook.cpp:1245-1246, return at :1303)

backend computes topk alone + synchronize
ask=false:
  gather ids with view strides  (router_hook.cpp:1353-1357)
  source_->load_layer(...)      (router_hook.cpp:1399)

load_layer (expert_stream_source.cpp:968-970)
  overlap_ ? load_layer_async : serial drain

load_layer_async (:1082-1296)
  drain previous I/O batch
  stage routed (layer, expert) slices into jobs_
  publish batch, notify I/O pool
  **return without waiting**   (:1272-1273)

then the same graph continues into expert FFN:
  llama-graph.cpp build_moe_ffn emits GGML_OP_MUL_MAT_ID
    (gate+up fused, then down) — K0 Q1c, llama-graph.cpp:1977 / :2098

CPU path:
  ggml_compute_forward_mul_mat_id  (ggml-cpu.c:1545)
    group rows by expert id        (:1638-1647)
    barrier                        (:1656)
    for cur_a in 0..n_expert:      (:1658)
      skip if unused               (:1661-1663)
      if (g_expert_ready_hook)     (:1667-1668)
          g_expert_ready_hook(src0, cur_a, ud)
      then read src0->data + cur_a*nb02   (:1671)

c_expert_ready (:1300-1301) → on_expert_ready (:1322)
  texp_ lookup by src0 pointer → (il, projection)
  not ours → return immediately   (:1326)   // silent no-wait
  il != cur_il_ → fatal_          (:1332)
  spin 256 then condvar until ready_[p,e].gen == async_gen_
  stall_ns_ += wait               (:1351-1370)
```

There is **no barrier inside the expert loop** (seam.md:71-72). One thread
blocked on expert A does not stall threads that already have expert B.

OpenCL path (if the node is assigned there):

```
ggml-opencl.cpp:23037-23041  GGML_OP_MUL_MAT_ID → ggml_cl_mul_mat_id
ggml-opencl.cpp:19665+       uses src0->extra (CL buffer), never g_expert_ready_*
```

`rg expert_ready` over `ggml/src/ggml-opencl/` is empty. Confirmed: GPU
`MUL_MAT_ID` cannot keep overlap correct.

### 1.4 Why KEXP experts stay off that GPU path today (mechanism a)

KEXP dump (`results/requant1c/verify_kexp.out:6`):

```
experts ok/bad 120 0 types {'Q3_K': 40, 'Q2_K': 80}
```

120 = 40 layers × `{ffn_gate,up,down}_exps` (`arch_registry.cpp:20`).

Load-time placement (`llama-model-loader.cpp`):

```
llm_tensor_info: FFN_{GATE,UP,DOWN}_EXPS → GGML_OP_MUL_MAT_ID
  (llama-arch.cpp:777-779)

select_weight_buft (:1041) walks the layer's buft list (GPU first if ngl)
weight_buft_supported (:902, :933-940) builds a dummy mul_mat_id and asks
  ggml_backend_dev_supports_op

ggml_opencl_supports_op MUL_MAT_ID (ggml-opencl.cpp:6792-6817):
  Q4_0 / Q8_0 / MXFP4 — yes if contiguous F32 rhs
  Q4_1 / Q5_0 / Q5_1 / Q4_K / Q5_K / Q6_K — Adreno only, and
      use_adreno_moe_kernels (:6505-6508):
        name contains ("ffn" AND "exps") OR "as", and ne[1] % 32 == 0
  **Q2_K / Q3_K → fall through to return false**
```

So even if the parent someday sets `n_gpu_layers=99`, KEXP routed experts
fail `supports_op` and `select_weight_buft` lands them on CPU. The scheduler
then keeps `MUL_MAT_ID` on CPU (K0 Q5: CPU is last backend; P3 prefers the
backend that can run the op on the weights' buft). Hook can fire.

Mechanism (a) is **real for this file**. It is not a contract: a Q4_K expert
requant, or a future OpenCL Q2_K `MUL_MAT_ID`, flips it without a compile error.

Shared expert (`ffn_*_shexp`) is `MUL_MAT`, not `_ID`. It is not streamed
(`arch_registry.cpp:16-20`) and **should** go GPU with the trunk.

---

## 2. What already works

- Fork hook is compiled in and wired. Campaign `bmoe-cli --moe-stream --overlap`
  registers it (`session.cpp:715-717` → `expert_stream_source.cpp:1375`).
- Today's parent **forces** `n_gpu_layers = 0` (`session.cpp:410`), so every
  `MUL_MAT_ID` is CPU. The hook is alive on the campaign CPU path.
- Serial streaming (`--overlap` off) is independent of the hook: `load_layer`
  drains I/O before returning (`expert_stream_source.cpp:1046-1069`). Stats
  still print. Correctness does not need the hook.
- Overlap correctness **does** need the hook. That is why `--overlap` is a
  hard fail when the symbol is missing (`session.cpp:719`).
- Capture + rebind identity is stable: `texp_` is keyed on the persistent
  model `ggml_tensor*` (`expert_stream_source.cpp:256-276`), the same pointer
  `mul_mat_id` receives as `src0` on the CPU path.
- `use_extra_bufts = false` (`session.cpp:409`) is load-bearing: streamer
  fills native GGUF layout (docs/moe-streaming.md:67-71).
- K0 Q7 still holds: cache-mb / drop-cold / overlap live in the parent. They
  do not patch graph build or OpenCL.

---

## 3. What is hardcoded shut

| lock | where | effect on hook / split |
|---|---|---|
| `mparams.n_gpu_layers = 0` | `session.cpp:410` | Entire model stays CPU. Hook safe. **Split cannot be expressed by `bmoe-cli`.** Comment says "experts on CPU" — conservative; type fallback would already keep KEXP experts on CPU. |
| No `-ngl` / no `n_gpu_layers` in config | `cli/main.cpp`, `core/include/bmoe/config.h` | Flag does not exist. |
| No `-ot` / `tensor_buft_overrides` | parent never sets `mparams.tensor_buft_overrides` | Mechanism (b) unavailable until wired. llama-cli has `-ot` (`common/arg.cpp`) but no streamer. |
| `flash_attn_type` default AUTO | `llama-context.cpp:3432`; parent never sets it | A7X FA compile-aborts (`reports/moe-gdn-750.md` §3.1). Turning on ngl without `LLAMA_FLASH_ATTN_TYPE_DISABLED` is a crash, not a hook bug. |
| OpenCL `MUL_MAT_ID` has no hook | `ggml-opencl.cpp:19665`, `:23037` | If that backend ever owns the node, overlap is silently racy. |
| `llama-cli` has no streamer | no `ggml_cpu_set_expert_ready_hook` call | Fork binary alone cannot run the campaign config. |

None of these is a missing kernel. The split is **parent wiring**, plus a
placement belt.

---

## 4. How to prove the hook is alive at runtime

Two different machines print overlapping numbers. Do not confuse them.

### 4.1 Eval-callback / streamer alive (necessary, **not** sufficient)

Always printed when `cfg.moe.enabled` (`cli/main.cpp:921-946`):

```
moe-stream: read X MiB (Y MiB/token), decode … (compute + cache mgmt + flash I/O …)
moe-cache:  H% hit, resident R MiB
```

These increment in `load_layer` / cache bookkeeping, **before** `mul_mat_id`.
A dead hook with a live eval-callback still shows plausible hit% and MiB/tok
(N2's ±10 pt check). Mandate N2 uses those as a proxy; they prove **staging**,
not the wait point.

### 4.2 Hook-specific meter

`stall_ns_` is added **only** inside `on_expert_ready`
(`expert_stream_source.cpp:1351-1370`, exported at `:1399`).

```
cli/main.cpp:944-946
  if (cfg.moe.overlap)
      printf("moe-overlap: stall %.3f s/token ...")

session.cpp:166-167
  stall_ms = Δstall_seconds * 1000 / n_threads
  (summed per-thread wait / n_threads; telemetry.md:35-38)

BMOE_PROGRESS.stall_ms   (telemetry.md:21-22) — 0 in serial
```

Interpretation:

| observation | meaning |
|---|---|
| `--overlap` line missing | hook never registered, or not bmoe-cli |
| stall = 0.000 **and** MiB/tok > 0 (cold / misses) | hook did not wait: dead, texp_ miss, or compute never entered CPU `mul_mat_id` |
| stall > 0 on early tokens, then falls as hit% rises | hook firing; expected (telemetry.md:44-52: structural floor, never quite 0) |
| stall ≈ 0 after ~100 % hit | hook still called, immediate return (`:1342`). Not a death signal. |
| hit% / MiB/tok match CPU arm, text identical, stall in the same ballpark | N2 "hook alive" as the mandate meant it |
| hit% looks fine, stall = 0, text diverges | GPU `MUL_MAT_ID` (or texp_ miss): streamer staged CPU buffers, compute did not wait on them |

Do **not** treat `moe-stream:` presence alone as hook-alive.

GGML_SCHED_DEBUG=2 (N1) is the placement proof: `MUL_MAT_ID` / `ffn_*_exps`
must list the CPU backend. If they list `GPUOpenCL`, the hook is dead even
if stats look pretty.

---

## 5. What would kill the hook

1. **GPU owns `MUL_MAT_ID`.** Experts in a type OpenCL accepts (Q4_K/Q5_K/Q6_K
   + name heuristic `ffn`+`exps`, `ne01%32==0` — `ggml-opencl.cpp:6505-6508`,
   `:6802-6813`) **and** `n_gpu_layers > 0`. Load puts weights in CL buffers
   (`llama-model-loader.cpp:1192-1193`). `ggml_cl_mul_mat_id` never calls the
   hook. Streamer still rebinds `tensor->data` (`expert_stream_source.cpp:163`)
   — that pointer is irrelevant to OpenCL `extra` (`:19679`).
2. **`--overlap` off.** Setter never called. Serial path still correct.
3. **Build without the fork header.** `--overlap` fails closed (`session.cpp:719`).
4. **`texp_` miss** (`on_expert_ready:1326`). `src0` is not the captured model
   tensor (scheduler dup / unexpected view). Hook returns; overlap races;
   stall stays 0; output is garbage or SIGBUS on uncommitted cache pages.
5. **`il != cur_il_`** (`:1332`). Staging/compute layer mismatch → `fatal_`.
6. **`use_extra_bufts=true`.** Repack. File offsets ≠ what the kernel reads
   (docs/moe-streaming.md:67-71). Hook can wait "successfully" on the wrong
   bytes.
7. **Eval-callback skipped** (graph reuse; docs/moe-streaming.md:77-78).
   `load_layer` never runs; hook waits forever or reads last token's slices.
8. **`llama-cli -ngl 99`** with no parent streamer. No hook, no staging. 35B
   does not fit; if it did, Q2_K experts would still be CPU but unstreamed.
9. **Shutdown while compute runs.** Unregister then free (`:1415-1420`) is
   ordered; a concurrent graph is already documented as unsupported
   (`ggml-cpu.h:149-150`).

Mechanism (a) dying is silent. There is no runtime assert that `MUL_MAT_ID`
ran on CPU.

---

## 6. RAM / double-residency risk (hook-adjacent)

The hook wants expert **bytes** on CPU. The trunk wants dense **weights** on
GPU. Those two copies are different tensors. The killer is the dense set
being resident twice.

Load with `n_gpu_layers=99` (once the parent allows it):

- Dense Q5_K/Q6_K `MUL_MAT` **is** supported (`ggml-opencl.cpp:6784-6787`;
  K2.2 dispatch fix on `kalsa/opencl-q6k-dispatch-fix @ 04c5d362a`).
  `select_weight_buft` places them in OpenCL buffers (~1.75 GiB; PLAN.md /
  mandate). On Adreno those CL buffers are host DRAM.
- Then `--dense-weights anon` (`DenseWeights::init`,
  `dense_weights.cpp:47-67`, rebind at `:234`) allocates **another** CPU
  anon copy of every captured non-expert leaf and points `tensor->data` at
  it. OpenCL compute still uses `extra`. mmap pages are `MADV_DONTNEED`'d
  (`drop_mmap_copies`, `:271`) — that frees the **file** mapping, not the
  GPU buffer and not the new anon.

Result if both run as-is:

```
dense GPU CL   ~1.75 GiB
dense CPU anon ~1.75 GiB   ← waste; hook does not need it
expert cache   2000 MiB    (--cache-mb 2000)
KV c=4096 + GDN states on GPU + runtime
≈ 6–7+ GiB on an 8 GiB phone → RescueParty (mandate: MemFree <100 MiB)
```

Expert side: after rebind, file mmap of `ffn_*_exps` is dropped
(`expert_stream_source.cpp:181-225`, `expert-mmap: dropped … MiB`). Cache
pages are lazy-commit (`:142-146`). Q2_K/Q3_K never entered a CL buffer, so
experts are **not** double-resident under mechanism (a). If (a) fails and
experts also land on GPU, add a third copy (full expert bank) and the
device dies at load.

Abort rule (mandate): MemFree <300 MiB sustained → stop.

---

## 7. Smallest surface to change

**Do not touch** `ggml-opencl` kernels, `FLASH_ATTN`, or `kernel_gemv_*`.
M1 already showed GEMV rewrites fail (NMSE + DRAM roof). The hook needs
**placement**, not a GPU wait point.

Parent-only (preferred; mandate: llama.cpp only if parent is not enough):

1. **Express the split**
   - `config.h` + `cli/main.cpp`: `-ngl` / `--gpu-layers`, and force
     `-fa off` (`cparams.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_DISABLED`).
   - `session.cpp:410`: stop hardcoding `n_gpu_layers = 0`; pass the flag.
   - Keep `use_extra_bufts = false` and `mmap_prefetch = -1` under stream.
2. **Belt (mechanism b), small**
   - `mparams.tensor_buft_overrides` with `ffn_.*_exps.*=CPU`
     (loader already implements this: `llama-model-loader.cpp:1164-1189`).
   - Optional: under `--moe-stream`, refuse a GPU buft for any captured
     expert tensor even without `-ot`. Still parent-side if done after
     capture; cleaner as a load-time override before `llama_model_load`.
3. **RAM**
   - `--dense-weights anon`: do **not** alloc/rebind a CPU copy of a tensor
     whose `buffer` is already a non-host / OpenCL buffer. GPU trunk uses
     `extra`; the anon clone is the double-residency. mmap drop can stay.
   - Experts remain CPU/mmap+cache. Do not upload them.

No llama.cpp hook change. No OpenCL `MUL_MAT_ID` hook. If a later model has
GPU-legal expert types, (2) is what keeps the hook alive — not a kernel.

Mechanism choice for KEXP: **(a) is sufficient** (Q2_K/Q3_K `supports_op`
false). Ship **(b) anyway** as a one-regex override: cheap, and it is the
only thing that stays true if the file or the OpenCL table moves.

---

## 8. Open questions

1. After `n_gpu_layers>0`, does capture warm-up (`session.cpp:603-622`) still
   see CPU expert `ggml_tensor*` with host `->data`? For KEXP, yes (a).
   Confirm with one `GGML_SCHED_DEBUG=2` load (N1), not by assumption.
2. Does `dense-weights anon` currently skip tensors whose `->data` is no
   longer a file VMA (GPU-allocated)? `dense_weights.cpp:139-143` prefers
   `tensor->data` only when it sits in a mapped shard VMA; otherwise it
   O_DIRECT-reads a **new** buffer. Need to confirm it does not also
   *break* GPU `extra` by overwriting something the backend still uses.
   Likely: `->data` overwrite is ignored by OpenCL; RAM is the only damage.
   Verify before N1 ctx=4096.
3. Boundary copies: OpenCL `.cpy_tensor_async = NULL` (K0 Q5). Each
   CPU `MUL_MAT_ID` will sync activations at the split. Hook still fires
   (CPU node). Cost is speed, not correctness — measure in N3, do not
   "fix" with GPU experts.
4. Shared expert + router + GDN states follow layer device
   (`llama-memory-recurrent.cpp:84-96`). No hook involvement. Confirm
   S_v ∈ {16,32,64,128} on KEXP GGUF (K0 G1) before claiming GDN stays GPU.
5. Does `bmoe-cli` Android build already link OpenCL? Campaign `bmoe-cli`
   sha `1ca51420` is the CPU baseline. Split binary is a **new** build of
   parent + fork with OpenCL. `results/gdn_gpu_k2/BUILD_MANIFEST.md` is the
   precedent (N0 later, not this note).
6. Warm-cache A/B: stall → 0 is expected. N2 must use **cold-or-first-N**
   stall, or accept hit%+identity as the mandate wrote it, and treat
   stall=0 + misses as a red flag.

---

## 9. BLOCKERS

**None for the hook itself.** The fork can fire it. The parent already
does, on the CPU campaign path.

**Not BLOCKED_ARCH.** The fork can express the split: `-ngl 99` + Q2_K/Q3_K
`supports_op` false keeps `MUL_MAT_ID` on CPU. The thing that cannot
express the split **today** is `bmoe-cli` (`session.cpp:410` + no `-ngl`).
That is a parent-engine patch, in scope for the rest of N0, not a fork
architecture hole.

Do not mark BLOCKED_ARCH because OpenCL `MUL_MAT_ID` lacks the hook — that
is the invariant we are preserving, not a missing feature.

Device work is out of this note (no SSH tonight).
