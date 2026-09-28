# DESIGN — one weight copy (CPU + Hexagon NPU) inside the per-phase governor

Design only, 2026-09-28. No product code, no build of a product branch, no adb. No partial files from
earlier agents existed in this directory. Everything below is read from source or from a lab report;
each claim carries its citation, and **derived** marks my own arithmetic.

Trees read (all read-only):

| tag | tree | commit |
|---|---|---|
| `SPIKE` | `/Users/marco/Projects/kalsallama-onecopy` (`spike/hexagon-onecopy-rawq4`) | `c939a135d` (raw path `9a2fb2376`, `fe2daf5d6`, `6fd40579d`) |
| `GOV` | `feat/governor-npu-prefill` (worktree `/private/tmp/kalsallama-npu`) | `45f097b74` |
| `BIND` | `/Users/marco/Projects/llama.rn-kalsa` | `88b2b57e` |
| `OC` | lab `scratchpad/agents/hexagon-onecopy-rawq4/REPORT.md` (P0–P5) | — |
| `NPUD` | lab `scratchpad/agents/governor-npu-prefill/DESIGN.md` | — |
| `HEAT-S23` / `HEAT-8E` | `s23-heat-arms-engine/REPORT.md` / `qdc-8elite-hopping-heat/REPORT.md` | — |

## 0. What this design says, in eight lines

1. One model / one context / one KV is **buildable from mechanisms that already exist**, plus one new
   backend surface: a runtime, shape-gated admission in the Hexagon backend (today the offload threshold
   is a process-wide env static).
2. **KV lives in ordinary CPU memory (`offload_kqv=false`)**, not in an HTP buffer. It is the only option
   with measured evidence (S23 heat arms ran `-nkvo`) and with no CPU↔DSP coherence risk (§1.3).
3. **P5 (norm and conv weights in the HTP normal buffer) is the KLD evidence, not the product placement.**
   Those buffers are not CPU-readable, so CPU decode would round-trip to the DSP ~100× per token. The
   product placement is "everything in `-HOST`, admit `SSM_CONV` and weighted `MUL` in the offload rule"
   and it needs its own KLD run (P6) (§2).
4. **The one-copy raw path cannot run `ffn_down` on the NPU.** Three VTCM numbers, by path — do not mix
   them: *tiled* kernel (two-copy, repacked weights) needs 7 827 456 B and fits (`npu-proof.log`,
   `hvx-tiled vtcm 7827456`); the *configured budget* is 8 388 608 B (8.39 MB, `hwinfo … vtcm 8 MB`);
   the *raw flat* path needs 13.9–15.4 MB and is declined (P5 log). So "`ffn_down` fits in 7.8 MB" is
   true only for the tiled two-copy path. ~27 % of the matmul MACs (derived) stay on the CPU during "NPU prefill". The 6.45 °C·s/1k and
   1.47 s numbers were measured on the two-copy default kernels and **do not transfer** (§2, §7).
5. Decode on the NPU under one-copy means a raw→tile conversion per matvec, with no ubatch to amortise it
   (`OC:65-68`). Not planned until the conversion timing exists.
6. The GPU cannot share the copy. "GPU when the NPU is hot" is implementable only as an optional second
   model+context (today's architecture, `commit_side` kept for that lane). The data say GPU is **never**
   cooler than the NPU, so this is an owner decision, not a default (§5.1).
7. A sustainable-rate mode does not exist anywhere today (no native pacing lever, only a 10-min pause
   cap). It is new engine code plus a periodic thermal push from the app (§5.3).
8. Nothing is ever truncated silently: pacing changes wall-clock only, and every pace or pause is
   counted in stats (§5.4).

---

## 1. Target architecture

```
  app/binding: ONE common_init_from_params  (tensor override .*=HTP0:0-HOST, use_mmap=false,
               offload_kqv=false, env HOSTBUF=1 MM_SELECT=1)
                         │
                 llama_model  ── weights: 1 × HTP0:0-HOST (rpcmem, CPU-readable, DSP-mapped)
                         │
                 llama_context ── backends [HTP0, CPU], CPU compute buffer also in -HOST
                         │        memory: hybrid = attn KV (8 layers) + recurrent (RS)  → CPU buffer
                 ggml_backend_sched  per graph:  n_tokens ≥ admit_min → HTP ops
                                                 n_tokens <  admit_min → all CPU
   llama_governor (one-copy mode): policy → set admission → llama_decode(ctx)   [no commit_side]
   optional GPU lane: second model+context (OpenCL SoA copy) + commit_side, load-time decision (§5.2)
```

### 1.1 Weights: one buffer, both backends read it

| mechanism | source |
|---|---|
| a per-tensor buffer override resolves a name to a buft, host bufts included | `SPIKE common/arg.cpp:250-275`; carried in `common_params.tensor_buft_overrides` (`common/common.h:349`, applied `common/common.cpp:1716`) |
| `-HOST` exists only if the env is set: `get_host_buffer_type` returns NULL unless `GGML_HEXAGON_HOSTBUF` | `SPIKE ggml-hexagon.cpp:6613-6619`, parsed `:7340` |
| `-HOST` is rpcmem, `is_host = true`, `set_tensor` is a plain `memcpy` | `:2070-2083`, `:2113-2116`, `:2017` |
| the device advertises no mmap: the loader `read_raw`s straight into a host buffer, so the app must load with `use_mmap=false` (the P5 runs used `-lm none`) | `:6599-6605`; `SPIKE src/llama-model-loader.cpp:1666-1670` |
| CPU may compute on any host buft | `SPIKE ggml/src/ggml-cpu/ggml-cpu.cpp:482-485` |
| HTP reads raw Q4_0 only through the flat kernel and only for `MUL_MAT` (`MM_SELECT=1`); every other op with a raw weight source is declined | `:2163-2188`, `:6717-6720`, offload rule `:6897-6900`; DSP guards `OC:54-63` |
| model buffers carry `USAGE_WEIGHTS` (the scheduler keys weight-affinity on it) | `SPIKE src/llama-model.cpp:1822-1826` |

The binding change is local: `load_governor_models` loads twice today (`BIND cpp/rn-llama.cpp:111-127`,
prefill `n_gpu_layers=99` at `:77`, decode `0` at `:78`); one-copy mode is one load. No CPU repack copy
can exist for a `-HOST` weight (`OC:248-250`: "the CPU repack *is* a second copy"). The decode-repack
knob (`:91-93`) therefore has no meaning in this mode.

### 1.2 One context: the pair already runs on a shared model

`llama_governor` takes two model pointers and builds two contexts (`GOV src/llama-governor.cpp:27-63`).
The host tests already pass the **same** model twice (`GOV tests/test-governor-v0-hybrid.cpp:163`,
`test-governor-v0-route-switch.cpp:189`), so "one model, two contexts" is a working stepping stone
(weights once, KV twice, `commit_side` still there). Step S3 goes the rest of the way.

### 1.3 Where the KV lives — verified in source, three options

The question: can the HTP read or write the KV in `-HOST`, and what does the scheduler do?

Facts:

- KV and recurrent state pick their buft in exactly one place each: the layer device's default buffer
  type when `offload` is true, the CPU buffer type otherwise (`SPIKE src/llama-kv-cache.cpp:235-244`,
  `src/llama-memory-recurrent.cpp:83-92`). The hybrid memory forwards `cparams.offload_kqv`
  (`src/llama-model.cpp:2684`). **There is no override to put the KV in `-HOST`** — the buft is
  `ggml_backend_dev_buffer_type(dev)`, the non-host HTP buffer (`ggml-hexagon.cpp:6608-6611`, `is_host`
  false `:2108-2111`).
- The HTP accepts only its own two bufts (`:6888-6895`); the CPU accepts only host bufts
  (`ggml-cpu.cpp:482-485`). So a KV in `HTP0:0` (default) is unreachable by the CPU, and a KV in a plain
  CPU buffer is unreachable by the HTP.
- The scheduler pins a pre-allocated destination to the first backend that supports **both** its buft and
  the op (`SPIKE ggml/src/ggml-backend.cpp:888-908`, `:921-936`). Cross-backend inputs are copied
  synchronously after a synchronize of the producer (`:1775-1800`); the copy is of the *tensor*, not of
  the cache it came from.
- `-nkvo` also pins the non-flash attention tail to the CPU (`SPIKE src/llama-graph.cpp:2718-2721`); the
  flash-attention branch has no such pin.

| option | how | evidence | verdict |
|---|---|---|---|
| **KV-A** CPU buffer (`offload_kqv=false`) | KV + RS in `ggml_backend_cpu_buffer_type()` | S23 heat arms: `-nkvo` (`s23 sess.sh:79`). Op census of the `-nkvo` NPU proof run (`s23-heat-arms-engine/raw/final-device-out/npu-proof.log`, my `awk` over `execute-op`): 484 MUL_MAT, 308 RMS_NORM, 176 MUL, 120 SWIGLU, 88 SSM_CONV, 88 CONCAT, 64 ROPE, 62 ADD, 8 GET_ROWS, **no FLASH_ATTN_EXT, no SET_ROWS, no cache CPY on the HTP**. The spike's HTP-prefill governor also used a host KV (`governor-htp-prefill-spike/REPORT.md:7`) | **chosen** |
| **KV-B** HTP normal buffer (today's default in P0–P5) | default | decode dump D0 (raw weights, KV in `HTP0:0`), ubatch 1, my census of `raw/discriminators-2026-09-28-v73d/d0-v.log.gz`: on the HTP anyway SET_ROWS ×16, FLASH_ATTN_EXT ×8, cache CPY ×22, cache SCALE ×22, RMS_NORM ×17, ROPE ×16, GET_ROWS ×24 while the matmuls run on the CPU → per-layer ping-pong. Memory note `npu-decode-stays-on-cpu` (v75): KV on HTP0 made decode 13.37 vs 17.68 tok/s CPU | rejected |
| **KV-C** KV in `-HOST` (rpcmem) | needs a new buft override for KV | zero-copy for both sides, but (1) the HTP is first in the backend order and `supports_op` for FLASH_ATTN_EXT/SET_ROWS has no buffer check (`:4204-4249`, `:5361-5383`), so it would claim the KV ops at decode too unless the §1.4 gate exists; (2) CPU writes at decode then DSP reads at the next prefill: the DSP flush+invalidates at batch start/end (`SPIKE htp/main.c:1134-1137`, `:1190-1193`) but nothing on the host side flushes a CPU write. **The weights runs never exercised a CPU-written / DSP-read region** (weights are written once before any DSP work) | later optimisation, only after a coherence test |

What KV-A costs and what it does not:

- Attention (8 layers) runs on the CPU at prefill. Its share is small at short context (derived:
  ~34 GFLOP for a 1k prompt against ~5 TFLOP of matmul) and grows with context (~5 % at 8k, derived).
  This is the same configuration the 654 tok/s NPU number was measured in.
- No KV byte ever crosses a device: the conv state and the KV are CPU-resident, the HTP only sees
  activations copied by the scheduler. There is nothing to commit and nothing to keep coherent.
- Size: 16 KiB/token (log: 8.00 MiB for 512 cells, 8 layers, K f16 4.00 + V f16 4.00,
  `raw/p5-2026-09-28/p5-small-htp-kld-v.log.gz` line 18988) + a fixed recurrent state of 0.34 MiB
  (line 19070). One context instead of two halves this (§3).

### 1.4 Per-phase backend selection: three scheduler mechanisms and the one thing missing

Prefill and decode are already distinguished by the batch dimension. What picks the backend, in order:

1. **Weight affinity + offload rule.** A weight in a host buffer sends its op to the first backend whose
   `offload_op` says yes; otherwise to the CPU (`SPIKE ggml-backend.cpp:961-987`). The Hexagon rule is
   `opt_mm_select == 1 && op == MUL_MAT && ne[1] >= opt_op_offload_min_batch && supports_op`
   (`ggml-hexagon.cpp:6897-6900`), threshold default 32 (`:100`). With `op_offload` true this already
   gives "prefill matmuls → HTP, decode matmuls → CPU". (`op_offload=false` would send *everything* to
   the HTP: the weight branch is skipped and `src_backend_id` — the HTP — is returned, `:970-985`.)
2. **The graph callback pins layer boundaries when the batch is small.** For `n_tokens < 32` (decode) the
   `norm` and `l_last` tensors of every layer are assigned to `model.dev_layer(il)` — the HTP — whenever
   the HTP `supports_op` them (`SPIKE src/llama-context.cpp:2565-2590`). D0's 17 decode RMS_NORM above
   are this mechanism.
3. **Expansion.** HTP-assigned nodes expand into adjacent unassigned nodes that the HTP `supports_op`
   (`ggml-backend.cpp:1130-1176`, `ggml_backend_sched_set_if_supported :1064-1069`), CPU nodes never expand.

Mechanisms 2 and 3 consult only `supports_op`. So **the offload threshold alone does not keep decode on
the CPU**; the HTP `supports_op` must itself say "no" for a decode-shaped graph. That is the new surface:

```
ggml_backend_hexagon_set_admission(min_tokens, op_mask)   // via ggml_backend_reg_get_proc_address
    supports_op(op):  if op.n_tokens < min_tokens and no source/dst is HTP-only  -> false
    offload_op(op):   op ∈ op_mask (MUL_MAT | SSM_CONV | MUL-with-weight-src) and n_tokens >= min_tokens
```

- The registry already has a `get_proc_address` hook (`ggml-hexagon.cpp:7132-7145`, no admission entry
  today) and the context already consumes backend setters by proc-address (`llama-context.cpp:360-367`).
- State moves from statics (`opt_op_offload_min_batch :100`, env parse `:7293-7353`) into the device
  context; env only seeds the default. Pure predicate in a header so the Mac can unit-test it (§6 S1).
- A context setter `llama_set_backend_admission()` follows the existing pattern
  (`llama-context.cpp:1203-1213`: change, then `sched_need_reserve = true`, which resets the sched and the
  previous graph results, `:583-609`).
- **Cost of a change:** a full re-reserve. In the device logs the interval from KV allocation to the end
  of `sched_reserve` is 82.9 ms (two-copy Q0), 124 ms (raw run 1), 97 ms (P5), ubatch 128
  (`twocopy-kld.log.gz` lines 16435→29901, `rawq4-kld.log.gz` 19565→36506,
  `p5-small-htp-kld-v.log.gz` 18986→35187; includes KV/RS allocation). Acceptable at a hop (dwell 10 min,
  `GOV policy.cpp:8`), **not** per phase — so per-phase selection is shape-driven and the knob is the
  rare ladder step.
- Shape edge: `is_prefill = n_tokens > 1` (`GOV governor.cpp:254`) but admission is ≥ 32: prompts/tails of
  2–31 tokens run on the CPU under one-copy (they ran on the accelerator context before). Small, but it
  is the second exception to "CPU is out of prefill".

### 1.5 What the governor becomes

`decode_impl` (`GOV governor.cpp:239-357`) in one-copy mode reduces to: latch checks → policy (`admit_prefill`
chunking, `select_decode`) → apply lane (only when it changed) → `llama_decode(ctx)` → stats. Removed:
phase handoff (`:281-293`), CPU catch-up (`:303-312`), per-side watermarks. The new constructor is
explicit (`llama_governor_init_one_copy`), never inferred from `model == model`, because the existing
tests rely on that call meaning "two contexts" (`test-governor-v0-hybrid.cpp:163`, `:276-277`).

---

## 2. Where SSM_CONV and the norm ops run, per phase

### 2.1 The two candidate placements

| | **P5** (evidence) | **H** (product) |
|---|---|---|
| matmul weights | raw, `-HOST` | raw, `-HOST` |
| 77 norm weights + 22 `shortconv.conv` weights | HTP normal buffer `HTP0:0` (~1.0 MiB: log `HTP0:0 model buffer size = 1.00 MiB`, `p5 …-v.log.gz` line 18793; `OC:722-725`) | `-HOST` (0 extra MiB) |
| how their ops reach the HTP at prefill | weights are only reachable by the HTP, so the scheduler must send `MUL`/`SSM_CONV` there | new: `SSM_CONV` and weighted `MUL` added to the offload rule at `n_tokens ≥ min` (§1.4) |
| decode on CPU | **broken**: a pre-allocated weight in a buft only the HTP supports pins its op to the HTP (`ggml-backend.cpp:888-908`, `:923-936`); CPU cannot read it (`ggml-cpu.cpp:482-485`). 99 tensors ⇒ ≥ 99 CPU↔HTP syncs per token (`:1775-1800`). `OC:726-731` flags the same caveat | CPU reads `-HOST` directly, 0 syncs |
| KLD | **0.002750 ± 0.000165**, max 0.031080, same-top 97.059 % (`OC:766-768`); Q0 two-copy 0.002788 (`OC:631`) | **not measured** |

Why P5 is not the product placement: it was built to answer "does moving these ~1 MiB close the KLD gap"
(P2 −0.000508, P3 −0.001690, `OC:632-643`), and it did. `OC:726-731` already names H as "the cleaner
equivalent" and says it "needs code and a KLD check of its own".

### 2.2 KLD evidence each choice needs

- **H needs P6**: all tensors in `-HOST`, offload mask = `MUL_MAT|SSM_CONV|MUL`, `OPFUSION=0`,
  `--no-warmup`, same fixture/base/flags as P5 (`OC:466-478`, command `OC:737`). Pass: mean KLD within
  the P5 band 0.0025–0.0031 (`OC:740-741`), same-top ≥ 95 %, `opset.sh` table equal to P5 apart from
  nothing (`OC:774-778`).
- **Stronger and cheaper: bit identity P5 vs P6.** Only the buffer flags differ; both feed the same DSP
  kernels the same f32 data. Use the FNV per-tensor dump (`OC:455-459`, engine `c939a135d`) on the
  **prompt graph only** — the earlier D0/D1 dump differed first at tensor 1007 because the ubatch-1 graph
  is confounded by decode placement (`OC:646-652`); compare tensors 1–1006. Identical hashes ⇒ P6 ≡ P5,
  no KLD run needed beyond a smoke.
- **If P6 ≠ P5**: fall back to the KLD band; if that fails, the fallback is P5 for the prefill graph plus
  a second CPU copy of the 99 tensors is impossible (one tensor lives in one buffer), so the fallback
  becomes "norm/conv ops stay on the CPU" (= P1, KLD 0.004706, still passes the registered gate
  ≤ 0.005, `OC:197-201`).
- `lm_head` (Q6_K) stays on the CPU: raw is declined for anything but Q4_0 (`ggml-hexagon.cpp:2182`);
  P4 shows no KLD effect (`OC:634`, `:640-641`).

### 2.3 Placement table (KV-A, H, `MM_SELECT=1`)

| op group | prefill (n ≥ 32) | decode, CPU lane | decode, NPU lane (future) |
|---|---|---|---|
| Q4_0 matmuls: attn q/k/v/o, ffn_gate/up, conv in/out proj (`OC:236-237` shapes) | HTP raw-flat (converted per 32-row group in VTCM, `OC:34-52`) | CPU generic Q4_0 on `-HOST` | HTP raw matvec `hvx_mv_2d_raw_q4_0_flat` (`OC:51-52`) — **conversion per token, unmeasured** |
| **`ffn_down`** (30 × 2048×10752) | **CPU**: `supported MUL_MAT VTCM size needed (13946112 / 15409152 / 13934592) > budget (8388608)`, 1200 declined queries in `p5-small-htp-kld-v.log.gz`; host rule `ggml-hexagon.cpp:5067-5072`. 0 `ffn_down` execute-op lines | CPU | CPU |
| `token_embd` GET_ROWS, `lm_head` Q6_K | CPU | CPU | CPU |
| SSM_CONV, weighted MUL (norm) | HTP (admit mask) | CPU | HTP (if lane chosen) |
| RMS_NORM, ADD, SWIGLU, ROPE, CONCAT | HTP by expansion (`OC:551-591`) | CPU | HTP |
| FLASH_ATTN_EXT, SET_ROWS, cache CPY/SCALE | CPU (KV-A) | CPU | CPU |

`ffn_down` share, derived from the logged shapes (ffn 2048↔10752, in_proj 2048→6144, out_proj 2048→2048,
attn q/o 2048², k/v 2048→512): ffn_down 660.6 M MACs of 2 434.8 M ⇒ **27.1 %**; in bytes 354.38 MiB
(`twocopy-kld.log.gz` line 16079 `CPU_REPACK`) of the 1 320 MiB Q4_0 trunk. This is why the flat-only raw
path is a real regression against the tiled two-copy path, where `ffn_down` ran on the HTP at 7.8 MB VTCM
(`npu-proof.log`: `hvx-tiled vtcm 7827456` for `ffn_down`).

---

## 3. Memory before / after (from load logs)

All buffer lines are second-pass (real load) lines; the first pass of each log is the fit probe and prints
0 MiB. Ship GGUF `LFM2.5-2.6B-QAD-Q4_0`, S23, `-c 512 -ub 128`.

| | weights | KV | RS | compute | source |
|---|---|---|---|---|---|
| **Before, HTP prefill lane** (governor pair) | prefill: CPU 205.08 + HTP0 1 525.87; decode: CPU_Mapped 1 503.20 + CPU_REPACK 1 511.20 | 2× (one per context) | 2× | 2× | `governor-htp-prefill-spike/REPORT.md:35,37` |
| **Before, OpenCL lane** | prefill: CPU 205.08 + CPU_REPACK 205.08 + OpenCL 1 307.20; decode as above | 2× | 2× | 2× | `…REPORT.md:36-37` |
| **After, one copy (P5-shaped)** | `HTP0:0-HOST` 1 524.88 + `HTP0:0` 1.00 = **1 525.88** | 8.00 MiB (512 cells) | 0.34 MiB | HTP 17.75 + HOST 64.50 | `p5-small-htp-kld-v.log.gz` lines 18793-18794, 18986-19070, 35187-35188 |
| After, product placement H | 1 525.88 in one buffer | same | same | to be measured | — |
| Reference: two-copy Q0 single model | CPU 205.08 + CPU_REPACK 354.38 + HTP0 1 171.50 = 1 730.96 | 8.00 | 0.34 | HTP 64.50 + CPU 7.38 | `twocopy-kld.log.gz` lines 16078-16080, 16435-16519, 29901-29902 |

Arithmetic (derived):

- Weights, HTP lane: 205.08 + 1 525.87 + 1 511.20 = **3 242.15 MiB** before vs 1 525.88 after →
  **saves 1 716.27 MiB ≈ 1.68 GiB**. Counting `CPU_Mapped` (a file-backed page cache, reclaimable) the
  "before" sum is 4 745.35 MiB.
- The OpenCL lane: 1 307.20 + 205.08 + 205.08 + 1 511.20 = 3 228.56 MiB before; the same one-copy figure
  after applies only if the GPU lane is dropped (§5.2).
- **Conflict to resolve:** memory note `hexagon-one-copy-works` says "~1.2 GB saved". I cannot derive
  1.2 GB from these logs; my figure assumes decode keeps its CPU repack copy. On the S23 8 GB shape the
  app already runs `decode_repack=false` (`BIND rn-llama.cpp:86-93`, `OC:269-271`), where the saving is
  about the OpenCL/HTP prefill copy (~1.3–1.5 GiB) instead. I flag the note, not overwrite it.
- KV: today two caches, after one. 16 KiB/token (derived above) ⇒ saves 16 KiB·N: 64 MiB at 4 096
  tokens, 256 MiB at 16 384. The recurrent state is 0.34 MiB, negligible. Measured governor pair RSS
  2.47 GiB (`…REPORT.md:30`, tiny context), not comparable to a one-copy run yet.
- **Where the memory sits changes.** rpcmem is dma-buf, DSP-mapped: it counts against the session vmem
  (`opt_vmem = 3000 MiB` on v73 `ggml-hexagon.cpp:7320`, `max_vmem = opt_vmem - shm_size` `:3933`; 1.53 GiB
  weights + KV + compute fits), and it is accounted by Android as dma-buf, not anon RSS. The app's fit
  maths (`NPUD:28-33`, `lanePrice`) must price it accordingly. Unknown effect on lmkd (§7).

---

## 4. What is removed, and every invariant that must survive

### 4.1 Removed in one-copy mode (kept, unchanged, for the optional GPU lane)

| item | where |
|---|---|
| second model + second context, the `ctx_other` refusal | `GOV governor.cpp:27-63`, `governor.h:93-95` |
| `commit_side` (route query, stale-destination trim, `llama_kv_commit_with_stats`, catch-up) | `governor.cpp:83-152`, `:281-293`, `:303-312` |
| two-sided `trim_sequence`, per-side watermarks, "untrimmable side" clear | `governor.cpp:180-226`, `governor.h:73-80` |
| CPU/GPU route latch (`prefill_route`) | `governor.h:65-68`, `runtime.cpp:89-108` |
| commit stats | `llama-ext.h:350-358`; reset in `runtime.cpp:219-226` |

`llama-kv-commit*`, `llama-hybrid-commit*` and their tests stay: the GPU lane needs them. `ctx_other`
sharing is **not** a substitute: a shared cache refuses decode, clear and `seq_rm`, and the recurrent
state is owner-only (`GOV src/llama-kv-cache.cpp:394-414`, `:757`, `src/llama-memory-hybrid.cpp:88-99`).

### 4.2 Invariants protected by the current tests (must keep passing, on one context unless noted)

| # | invariant | test (`GOV tests/…`) |
|---|---|---|
| I1 | tokens equal a single-context baseline over turns, prompt and decode | `test-governor-v0-hybrid.cpp:190-228`; `test-governor-v0-route-switch.cpp:101-138`; devices tolerance `test-governor-v0-devices.cpp:200-237` |
| I2 | after a rewind the logits equal a fresh context (≤ 1e-3) — the "silent stale recurrent state" trap | `hybrid.cpp:268-380` (`:375`); `turns.cpp:862-932` |
| I3 | `trim_sequence` refuses on a failed governor and mutates nothing | `turns.cpp:938-980` |
| I4 | a raw `seq_rm` on the active context is the known bypass; with one context it stops being a bug, but the **hybrid recurrent partial rollback is still refused**, so "restore checkpoint, then trim" stays the only legal rewind | `turns.cpp:794-852` (`:826-831` comment), `:886-905` |
| I5 | sticky failure keeps the raw engine rc and a reason; the next call short-circuits | `turns.cpp:734-792`; binding predicate `BIND rn-governor.h:19-21` |
| I6 | flow-control `-2` never sets `failed` and sets no reason (the fallback keys on it) | `test-governor-v02-router.cpp:661-678`; `turns.cpp:692-731` |
| I7 | chunking: 512+512+305 → `"512+512+128+128+49"`, 5 ubatches, `prefill_n`, `prefill_us` | `turns.cpp:140-227` (`:189-199`) |
| I8 | row+1 prompts (129, 513, 1025, 2049) prefill without `-2`; n_batch cap `cpu:2+127+2` | `turns.cpp:284-353`, `:450-512`; `router.cpp:548-591`, `:597-627` |
| I9 | hot prefill pauses with **nothing executed**, then the cooled prompt chunks on the same engine | `turns.cpp:514-621` (`:578-590`); floor `router.cpp:375-413`; lines `:420-524`; ceiling `:531-543` |
| I10 | LOWBAT: prefill and decode on CPU, `commit_bytes == 0`; plugged clears it | `turns.cpp:623-690`; `router.cpp:64-96` |
| I11 | engine choice: NPU only with lane + Fit + readable + FAST; safety states keep CPU; bench force outranks the lane | `router.cpp:702-786` |
| I12 | decode gates, GPU_COOLMODE `requires_reload` flow control | `router.cpp:98-150`; `turns.cpp:692-731` |
| I13 | `clear_cache` empties every KV and resets counters | `turns.cpp:214-222` |
| I14 | per-chunk route facts, truncation flag rather than silent overflow | `GOV governor.cpp:335-350` |
| I15 | device resolve degrades to GPU, never throws; bench-force cases | `devices.cpp:259-280`, `:119-158` |
| I16 | the 77-proof: every `77` is proven by its stderr line and one run with `KALSA_HYBRID_GGUF` = ship GGUF must exit 0 | `hybrid.cpp:384-388`; `NPUD:69-76`; memory `governor-host-tests-skip-hybrid` |
| I17 | shared-cells fences (MTP/spec) untouched | `test-governor-v0-shared-cells.cpp:141-161` |
| I18 | **LOAD gate: the governor is never eligible when an mmproj/vision model is loaded.** App, cited against app `origin/main` `335f9c8d` (read with `git show`, working tree untouched; the local checkout `524aa0e0` is stale): `governorLoad` requires `… && !options.mmprojPath && !streamExperts` (`src/engine/LlamaService.ts:2387-2394`, gate line `:2393`); the same source of truth feeds the lane predicate as `hasMmproj: Boolean(options.mmprojPath)` (`:2382`), consumed as `visionOk = !npu?.hasMmproj` (`src/engine/governorInputs.ts:31,254`) with tests using `hasMmproj: true/false` (`governorInputs.test.ts:378,410`). `NPUD:102-107` cites the gate as `:2375-2386` on an older checkout. The engine has no mmproj guard of its own (`NPUD:104-105`). With one context this matters more: a vision model on the one-copy path would put the projector and its compute in the same context and the same HTP session; the one-copy eligibility predicate must keep `visionOk`, and the `governorInputs` test with `hasMmproj: true` must keep failing the lane. Companion: `governor_ineligible_when_mmproj_loaded` policy (owner 25/09: stays so until a governor vision lane) |

**Inverted invariant.** The hybrid test asserts `commit_count == 2*turns-1` and exact `commit_bytes`
(`hybrid.cpp:237-248`). For the one-copy lane the new assertion is `commit_count == 0 && commit_bytes == 0`
— the proof that no KV moved. The GPU-lane tests keep the old numbers.

**Legacy-path invariance.** Every test above that names two contexts (`route-switch`, `devices`,
`commit`, `hybrid` staged/rewind sections) must pass **unmodified** on the two-context constructor. That
is the regression net for the GPU lane.

### 4.3 New invariants

- N1 KV single owner: no code path reads KV from a device other than the CPU (KV-A).
- N2 admission is applied only by re-reserve, never mid-graph (§1.4).
- N3 the op census per phase equals the table in §2.3 (device test, `opset.sh`).
- N4 nothing is silently truncated (§5.4).
- N5 one weight copy: a load reports one weight buffer (`memory_breakdown`), asserted on device.
- Session save/load stays banned until an owner decision: the ban's stated reason was the two diverging
  KVs (memory `governor-keeps-two-kv-caches`); one context removes that reason, but this design does not
  lift it.

---

## 5. The GPU case and the heat ladder

### 5.1 Why the GPU cannot share, and what "wants GPU" means

`OC:164-174`: Adreno OpenCL rewrites Q4_0 to SoA in `set_tensor` (`ggml-opencl.cpp:11133,11175,11388-11392`,
large weights also get an image `:11360-11369`), has no host path (`is_host = NULL :14500`,
`get_host_buffer_type = NULL :14617`, `buffer_from_host_ptr → nullptr :14581-14587`,
`supports_buft` OpenCL only `:14594-14598`). On a one-copy model the OpenCL backend cannot claim a single
op. A GPU that reads the shared copy needs an AoS raw-Q4_0 kernel and would give up the SoA/image speed:
out of scope.

Options when the policy wants the GPU:

| | G1 second copy, load-time | G2 no GPU with one-copy |
|---|---|---|
| shape | today's pair (OpenCL model as `ctx_prefill`, the one-copy context as `ctx_decode`), `commit_side` retained; the KV of the one-copy context is a CPU buffer, so the commit reads/writes host memory | policy never returns GPU in one-copy mode |
| memory | + OpenCL 1 307.20 + CPU 205.08 + CPU_REPACK 205.08 (`…REPORT.md:36`) + a second KV/RS/compute | none |
| code | keep everything in §4.1 | none |

**Recommendation: G1, built at load only if the fit gate passes, otherwise the lane is absent and the
policy is told so (`gpu_lane_loaded`)**, because the alternative — building a 1.3 GiB GPU copy lazily at
the moment the phone is hot — allocates memory at the worst time.

**But the data do not support the GPU as a heat lever.** Never cooler than the NPU in any measurement:

- S23 prefill per 1k tokens: NPU 6.45, GPU 24.17, CPU 44.59 °C·s battery area (`HEAT-S23:84-88`); GPU is
  4.7× slower (6 948.76 vs 1 470.99 ms, `HEAT-S23` per `NPUD:8-11`).
- 8 Elite sustained prefill: NPU 23.1, GPU 79.0, CPU 75.1 °C·s per prefill; the GPU block reached skin
  44.0 °C from 35.7 °C (`HEAT-8E:32-36`, `:54-55`); the NPU's advantage widened over 12 prefills and its
  prefill did not slow (907 → 924 ms, `:46-51`).
- 8 Elite decode: NPU 0.229, CPU 0.315, GPU 0.326 °C·s/token (`HEAT-8E:77-81`, `:97-98`).

So hopping NPU→GPU *raises* heat per prompt by 3.4–3.7×. The GPU's only defensible role is availability:
the HTP is unusable or throttled *specifically* (session lost, FastRPC failure `error 0x14` fallback,
`NPUD:113-116`) while the rest of the phone is fine. **Owner decision taken, §7b** (the direction in the
brief is "GPU when the NPU is hot"): implement the hop but keep it OFF by default, and define "NPU hot" as
a measured HTP slowdown, not a battery temperature: chunk throughput ratio against the first chunk of the
session, from the per-chunk facts the engine already records (`GOV governor.cpp:335-350`). No S23 arm
exists that shows the NPU slowing under sustained load (8 Elite: +2 % over 12 prefills), so the trigger is
unproven.

### 5.2 Ladder inputs the engine has

The engine sees battery temperature, level, plugged, `t_idle`, trend (`GOV llama-ext.h:270-278`); states
FAST/WARM/COOLMODE/CRITICAL/LOWBAT/Invalid from `classify`/`update_thermal` (`policy.cpp:83-95`,
`:105-172`), lines pause 43 / kill 44, admission ceiling 42.5 (`:15-17`), 10-min dwell (`:8`).
It does **not** see Android thermal status/skin, and it learns the temperature only when the app pushes a
profile — before every completion (`LEVERS §2` cites `LlamaService.ts:1735`; on app `origin/main` `335f9c8d` the function is `src/engine/LlamaService.ts:1727`, called at `:1168`), not during generation.

Two additions are required for any mid-generation ladder: (a) `platform_status` (0–4) in
`llama_governor_thermo_profile`, and (b) the app pushes the profile every ≤ 10 s during a completion
(`GOVERNOR_COOLING_POLL_MS = 10_000`, `src/engine/thermalResume.ts:69` on app `origin/main` `335f9c8d`, already polls at 10 s).

### 5.3 The ladder under one-copy

| rung | trigger | prefill | decode | note |
|---|---|---|---|---|
| R0 FAST | battery below warm line | NPU, `min=32` | CPU, full speed | the default |
| R1 WARM | `warm_enter` (38 °C unplugged) | NPU, chunk cap 512 (`policy.cpp:372-374`, currently a stat only: no consumer) | CPU | **never CPU prefill**: 44.59 vs 6.45 °C·s/1k |
| R2 COOLMODE | `cool_enter` 39.5 | NPU | NPU **only if** the raw matvec timing (S0) says it is cooler per token *and* viable; else stays CPU + R3 pacing | 8 Elite NPU decode: −27 % heat/token, −25 % tok/s; heating *rate* 6.7 vs 12.3 °C·s/s (derived from `HEAT-8E:77-81`). S23 NPU decode: **never measured** (`HEAT-S23:95-99` are CPU-only) |
| R3 sustainable rate | state ≥ COOLMODE for > N minutes, or platform SEVERE persisting (hot climate) | NPU, one 128-row chunk at a time with a gap | paced: `pace_us` per token, bounded, never zero throughput | the mode the owner asked for; no such lever exists today (`LEVERS §1`: no native duty cycle, JS token delivery is `invokeAsync`) |
| R4 CRITICAL | 44 °C battery (`policy.cpp:17`) | `Abort` | `wait` → `fail("decode admission aborted")` (`runtime.cpp:180-183`), sticky | owner-set kill line, unchanged |
| LOWBAT | < 25 % unplugged | CPU (existing rule, I10) | CPU | unchanged |

R3 controller (design; constants to be calibrated by arm S9):

- Target `T_hold = k_limit_c − 0.5 = 42.0 °C` battery (below the 42.5 admission ceiling).
- Every thermal push: if `T ≥ T_hold` or trend > 0.5 °C/min: `pace_us = clamp(max(pace_us·1.5, p0), ≤ p_max)`;
  else `pace_us -= step` (floor 0). AIMD, so it converges and does not oscillate around the pause.
- Applied in the decode branch before `llama_decode` (`governor.cpp:315`) and between prefill chunks;
  `p_max` is chosen so throughput never reaches 0 (the "pause alone is wrong" rule). Injectable clock for
  tests.
- Pause (`-2`) remains only where it already is (admission `Wait` at ≥ 43 with nothing executed, I9):
  R3 is *before* that line, so a hot climate rides at a reduced rate instead of cycling pause/unload
  (memory `thermal-pause-unloads-the-model`: a 300 s cooling pause exceeds the 180 s idle dispose and pays
  a reload + prewarm).
- Hop hysteresis reuses the 10-min dwell (`can_leave`, `policy.cpp:101-103`). A lane change is one
  re-reserve (§1.4) and **moves no KV**.

### 5.4 "Never truncate reasoning silently"

- Pacing and pauses change wall-clock only; `n_predict`, the thinking budget and the context are never
  reduced by the ladder.
- Every pace/pause is counted in stats (`pace_us_total`, `pace_tokens`, existing `route_chunks_truncated`
  flag at `governor.cpp:348-349`), and `-2` keeps reaching JS as a labelled pause
  (`BIND rn-llama.cpp:682-706`).
- Test (S9): generated token count equals the requested count with pacing on, and the stats show the pace.

---

## 6. Implementation plan

Rules for every step: one commit, one test, one hostile audit (per the plan cadence); one phone check per
fix; every device run keeps screen on, Kalsa foreground, Awake per turn, unplugged for heat/timing
(plugged for correctness only, as in `OC`). Mac = host build + host tests only.

| # | class · step | files | test | device check | where | needs conversion timing |
|---|---|---|---|---|---|---|
| **S0** | **LANE** (measurement that decides the lanes) ·  **Measure, no code.** P5 prefill wall time and heat per 1k tokens vs the two-copy baseline; CPU decode tok/s with raw `-HOST` weights (no repack); op census at ubatch 128 under `-nkvo` + P5; VTCM need of `ffn_down` at ubatch 32/64/128 (`HEX_VERBOSE` prints it, `ggml-hexagon.cpp:5070`) | existing binaries `onecopy-d/` | — | S23 unplugged and/or the QDC 8 Elite run in preparation | S23 / QDC | **produces it** |
| S1 | **SAFETY** ·  Hexagon admission state + gate: statics → device context; pure predicate header; `supports_op` shape gate; offload mask incl. `SSM_CONV`, weighted `MUL`; proc-address setter | `ggml-hexagon.cpp`, new `htp-admit.h` | host predicate test compiled on the Mac (pattern `tests/test-hexagon-q4_0-raw-tile.c`, `OC:70-83`): table of (op, n_tokens, host/HTP-only buffers, mask) → expected | decode census at `min=32` must show **0** HTP ops at ubatch 1 (D0 showed 16 SET_ROWS + 8 FA + 44 cache + 17 RMS_NORM + …) | Mac (predicate), S23 (census) | no |
| S2 | **SAFETY** ·  `llama_set_backend_admission()`: proc-address lookup, `sched_need_reserve`, counters | `src/llama-context.cpp`, `include/llama.h` | Mac: setter returns false without a capable backend; reserve counter unchanged | S23: hop changes the census, re-reserve ≈ 0.1 s | Mac + S23 | no |
| S3 | **SAFETY** ·  One-copy governor: `llama_governor_init_one_copy`, single context, admission via S2; legacy constructor untouched | `src/llama-governor*.cpp/.h`, `llama-ext.h` | new `test-governor-v0-onecopy.cpp` on the Mac (CPU model, hybrid ship GGUF via `KALSA_HYBRID_GGUF`): I1, I2, I3, I5–I10 on one context, **`commit_count == 0`**, the 77-proof; **all legacy governor tests pass unmodified** | none | Mac | no |
| S4 | **SAFETY** ·  Policy: `decode_engine` NPU/CPU vocabulary, R3 `pace_us`, `platform_status`; `gpu_lane_loaded` input | `policy.cpp`, `llama-ext.h` | `router` golden tables (pure policy, Mac): AIMD bounds, never-zero rate, pause line unchanged, stats counters | none | Mac | no |
| S5 | **LANE** ·  Binding one-copy load: single `common_init_from_params` with the override, `use_mmap=false`, `offload_kqv=false`, env `GGML_HEXAGON_HOSTBUF=1` + `MM_SELECT=1` set where `ADSP_LIBRARY_PATH` is (`NPUD:25`); **degrade rule**: HTP0 or the host buft missing → today's two-context path, plan fields `one_copy`, `weights_buft`, `kv_buft`, `npu_fallback` (`NPUD:77-91`) | `cpp/rn-llama.cpp`, `rn-governor-params.cpp` | extend `tests/governor_params_test.cpp`; one-copy path is device-only | — | Mac (params), S23 | no |
| S6 | **LANE** ·  Device soak: debuggable APK, one-copy load; **P6** (all `-HOST` + admit mask) bit-identity vs P5 on tensors 1–1006 (`OC:646-652`), else KLD band; op census per phase (§2.3); memory breakdown; load time + `MemAvailable`; FastRPC/`0x14`, perfmond spin watch (`NPUD:128-132`) | none | KLD ≤ 0.0031, same-top ≥ 95 %, `commit_bytes == 0`, one weight buffer | S23 debuggable APK (`s23-debuggable-apks-policy`) | S23 | **yes: go/no-go** — proceed as default only if one-copy prefill beats today's GPU lane on both time and heat (6.95 s and 24.17 °C·s/1k, `HEAT-S23:87`); owner may move the bar |
| S7 | **LANE** ·  `ffn_down` on the NPU under raw weights: K-split or a lower-VTCM raw job (needs ≤ 8.39 MB from 13.9–15.4 MB) | `htp/matmul-ops.c/.h`, host rule `:5067` | Mac host test extending the raw-tile test: split accumulation vs `dequantize_row_q4_0` reference (max abs error small, documented); S23 KLD ≤ 0.005 | S23 census: `ffn_down` execute-op > 0; timing/heat re-run | Mac + S23 | **yes** (S0 ranks its value) |
| S8 | **LANE** ·  GPU lane everywhere (G1, owner decision §7b): existing pair, one-copy context as decode side; flag default per device class (OFF with a usable NPU, ON without); second weight copy decided at load, only when the flag is ON and the fit gate passes | `governor.cpp` (legacy path), binding load | legacy tests unmodified (§4.2); new: one-copy ctx as `ctx_decode` with an OpenCL prefill, token oracle as `devices.cpp` | S23 OpenCL + one-copy load fits memory | Mac (CPU-only pair) + S23 | no |
| S9 | **SAFETY** ·  Sustainable-rate mode: engine pace + app periodic push + `platform_status` wiring | `governor.cpp`, app thermal loop | policy tables (S4) + injected-clock engine test: tokens generated == requested | hot soak arm, S23 unplugged, **no cool-start gate** (memory `heat-arms-no-cold-start-gate`), stats show pace and zero truncation | Mac + S23 | no |
| S10 | **LANE** ·  NPU decode lane — only if S0/S6 timing says a raw matvec is viable | admission mask at `min=1` for the decode lane | census + tok/s + heat arm (S23 NPU decode has never been run) | S23 | S23 | **yes** |
| S11 | **LANE** ·  Flip defaults; update `PLAN.md`/`ALIVE.md` (lab-only) | lab | — | — | — | after S6/S7 |

**SAFETY** = built regardless of the timing, validated by the op census (thermal ladder, admission gate,
single-context correctness, pacing, so the phone can never ping-pong or overheat silently). **LANE** =
conditional on S0/S6 timing (one-copy prefill as default, `ffn_down` on the NPU, GPU lane, NPU decode,
default flip). S5 is LANE because the one-copy load is only worth shipping if S6 passes; its degrade rule
is SAFETY-grade and must land first inside it.

**S1 status (2026-09-28):** implemented in the engine worktree `/Users/marco/Projects/kalsallama-gov-onecopy`,
branch `feat/governor-onecopy` (base: spike head `c939a135d` merged with `feat/governor-npu-prefill`
`45f097b74`, merge `f92413edf`; no existing branch rewritten), commit `1d39fd0dd`, not pushed. Deviations
from the plan: the proc-address setter is left to S2 (its only caller), so S1 seeds the device-context state
from env (`GGML_HEXAGON_ADMIT_OPS`, `GGML_HEXAGON_ADMIT_GATE`, default = old behaviour); the token dimension
rule is per op (`htp-admit.h`), with the per-head-norm imprecision at decode pinned in the host test.
Device census (decode = 0 HTP ops at ubatch 1) is still owed.

Pins and provenance after each engine step follow the chain in `REPOS.md` (engine → binding
`vendor/VERSIONS` → app `package.json` + lock → `assert-engine-provenance.sh`). Push only with the
owner's approval or per the standing pipeline rule.

---

## 7. Open risks and unknowns

1. **Conversion timing is unmeasured** (`OC:65-68`): scalar byte shuffle per 32×32 tile, paid per matmul,
   amortised only over the ubatch. Prefill may be slower than the repacked flat path; decode on the NPU
   has no amortisation at all. Blocks S6's verdict, S7's priority, S10, and every default.
2. **`ffn_down` stays on the CPU** at prefill (27.1 %, §2.3). Back-of-envelope, *unmeasured*: 27 % of the
   9.9 s P-CPU prefill is ~2.7 s before the NPU part, i.e. ≥ ~2× the two-copy 1.47 s, and ~12 °C·s/1k from
   the CPU share alone (`HEAT-S23:86`). One-copy would then sit between the GPU lane (24.17) and the
   two-copy NPU (6.45): better than the GPU on both axes, far from the number in the owner's brief. The
   CPU kernel is the generic (non-repacked) Q4_0 one.
3. **Flat-only (`MM_SELECT=1`) forgoes tiled/HMX.** The S23 reports HMX present (`hmx 1` in
   `npu-proof.log`: "HTP0 hwinfo: threads 4, hvx 4, hmx 1, vtcm 8 MB") and the heat arms ran the default
   selection (`s23 sess.sh:11` sets only `NDEV`; proof line `hvx-tiled`). Every NPU speed/heat number in
   the brief is a two-copy tiled/HMX number. 8 Elite v79 not checked; likely a larger loss. Also lost:
   gate/up and q/k/v NX fusion (`OC:67-68`, `:223-235`).
4. **Decode speed regression where repack is on today** (see the memory-figure reconciliation at §3,
   "Conflict to resolve": my 1.68 GiB saving assumes decode keeps its repack copy today). One-copy has no CPU repack; the binding comment
   prices that at ~1.4× decode cost (`BIND rn-llama.cpp:88-90`). The S23 8 GB shape already pays it.
   Product trade-off for ≥ 12 GB devices: owner decision.
5. **KV-A attention placement is inferred from one census** at ubatch 16, tiny prompt, two-copy
   (`npu-proof.log`), not from a ubatch-128 dump with raw weights. S1/S6 must produce it. If the HTP
   claims FLASH_ATTN by expansion (`ggml-backend.cpp:1130-1176`, no buffer check in `supports_op`), the
   whole KV is copied per layer per ubatch (order 128 MiB per ubatch at 8k context, derived).
6. **Coherence (KV-C only).** Evidence for the chosen design: P0–P5 pass through CPU-written HOST compute
   buffers (`ffn_down` on the CPU feeds the next HTP op through a `-HOST` buffer, `llama-context.cpp:405-421`)
   with KLD 0.00275. That is a working cross-device path, not a proof for KV in place.
7. **HTP session coupling.** The weights live in rpcmem allocated through the HTP session
   (`ggml-hexagon.cpp:2070-2083`). Today CPU decode is isolated from HTP faults; under one-copy a lost
   DSP session or subsystem restart could take the weights the CPU is reading with it. Untested and
   destructive to test; needs a read-only analysis of rpcmem/dma-buf lifetime first.
8. **Loader behaviour.** No mmap: 1.5 GB `read()` into rpcmem at every load; load time, peak RSS and
   `MemAvailable` unmeasured; lmkd sees dma-buf, not anon.
9. **Re-reserve at a hop** ~0.1 s (measured intervals, §1.4) and graph reuse resets at every prefill↔decode
   shape change (`n_reused`); expected ms, unmeasured on device.
10. **Prompts of 2–31 tokens** run on the CPU (threshold 32) and `prefill_token_cap` is only a stat
    (`policy.cpp:372-374`, no consumer).
11. **KLD sample size.** P5 is two chunks of the registered fixture (±0.000165); P6 and S7 inherit it. A
    longer fixture and a governor-level handoff-style run (`governor-htp-prefill-spike/REPORT.md:101-121`)
    are missing for one-copy.
12. **Thermal signal path.** Mid-generation ladder needs the app to push every ≤ 10 s and a new
    `platform_status` field; the engine has no sensor. The R3 constants (`T_hold`, `p0`, `p_max`, step) are
    guesses until S9.
13. **The owner's GPU rule contradicts the measurements** (§5.1) and needs an explicit decision before S8.
14. **Session ban** stays; lifting it is a separate contract change.

## 7b. Owner decision: the GPU lane (2026-09-28)

Owner, verbatim: "lasciala dappertutto, non si sa mai, magari con un flag spento dove la npu e' migliore".

Decision: **the GPU lane stays on every device, behind a flag that is OFF by default where the NPU is
better (devices with a usable NPU) and ON by default where there is no usable NPU.** The data behind the
default (never cooler than the NPU: S23 24.17 vs 6.45 °C·s/1k; 8 Elite 79.0 vs 23.1 per prefill; cannot
share the one copy, §5.1) are unchanged; they justify the default, the owner's decision keeps the lane
available. Consequences:

- The GPU lane is **not** removed from the ladder code and the legacy two-context path stays (§4.1);
  what the flag decides is whether the policy may return GPU and whether the second weight copy is loaded.
- Default per device class: usable NPU (`npu_fit == Fit`, HTP readable, generation ∈ {V73, V75, V79}) →
  flag OFF; no usable NPU (NoHTP, `npu_fit` not Fit, mmproj loaded, MoE without readable experts) → flag ON,
  i.e. today's GPU plan unchanged. A bench/JS override may still switch it either way.
- The GPU lane still needs its **own second weight copy, decided at load** (§5.1 G1): flag ON on a device
  with a usable NPU means the load builds the OpenCL model beside the one-copy model, subject to the fit
  gate. Flag OFF means no second copy is ever built and the policy is told `gpu_lane_loaded = false`.
- Heat ladder: with the flag OFF the ladder never hops to the GPU (NPU hot → sustainable rate, R3); with it
  ON the hop is the existing GPU plan.

## 8. Sources not read in full

`test-governor-v0-turns.cpp` lines 232-283, 290-449 and the bodies of the router boundary tests
(`:152-370`, `:420-543`) were read for their headers and assertions cited above, not line by line. The
Adreno lines in §5.1 are quoted from `OC`, not re-read in `ggml-opencl.cpp`. `HEAT-*` numbers are quoted
from the reports, not recomputed. No adb, no build, nothing run.
