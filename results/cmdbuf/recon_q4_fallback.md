# CMDBUF Q4 — fallback if no `cl_khr_command_buffer`

Date: 2026-08-13. PC/source only. No device. No GEMV work.

Mandate: `mandates/cmdbuf-recon.md` question 4 only.
Inputs: `reports/moe-gdn-k0-op-inventory.md`, `reports/moe-k4-split.md`,
`reports/moe-mld-m1.md`, K4 `GGML_SCHED_DEBUG=2` dump
`results/k4split/n1/n1_sched_B_c1000.err`, fork
`BigMoeOnEdge/third_party/llama.cpp`.

This is a launch/split estimate, not a speed claim. Every count below is
from those files. µs/launch on Adreno is **not measured** in K4/M1; this
note does not invent one.

---

## 0. What the brief called “~1000 launches + 82 splits”

| claim in `mandates/cmdbuf-recon.md:3-4` | what is actually on disk |
|---|---|
| 82 synchronous graph splits / token | **Measured.** `sched_reserve: graph splits = 82` (`n1_sched_B_c1000.err:13561`). Same 82 on N1 ARM_B c512/c4096 (`reports/moe-k4-split.md:182-184`). |
| ~1000 kernel launches / token | **Not a counted dump.** Reserve graph is `graph nodes = 3617` (`n1_sched_B_c1000.err:13560`). §1 counts **listed compute nodes** on the decode graph. After view/empty skips and the RMS_NORM+MUL fusion that already exists, that is **~2100 enqueues/token**, not 1000. Treat “~1000” as a brief approximation, not a measurement. |
| ~60–150 ms/token dispatch/glue | **Not isolated.** K4 N3 median decode is 2.901 t/s CPU vs 2.025 t/s split (`reports/moe-k4-split.md:311`; raw `results/k4split/n3_final/runs_speed.csv`). That is **149 ms/token extra for the whole split vs CPU** (1/2.025 − 1/2.901). K4’s own verdict names the A7X GEMV wall, not glue (`moe-k4-split.md:323`). M1 only microbenched Q4_K GEMV (`reports/moe-mld-m1.md:136-158`). There is no N3 profile that splits GEMV / enqueue / `clWait`. Do not spend 149 ms as a glue budget. |

82 splits are structural, not glue. Pattern in the decode dump
(`n1_sched_B_c1000.err:13566-13680`, repeated through `#81`):

```
SPLIT 0     CPU   GET_ROWS token_embd
SPLIT 2k+1  OpenCL  GDN/FA + router + (after layer 0) shexp/residual of previous
SPLIT 2k+2  CPU     3× MUL_MAT_ID + SWIGLU   (routed experts)
… 40 layers …
SPLIT 81    OpenCL  last shexp + output
```

= 1 + 40×2 = 81, plus the last OpenCL island → **82**. Full-attn layers do
**not** add extra splits (layer 3 is still one OpenCL island,
`n1_sched_B_c1000.err:1388-1436`).

Each split with inputs does a **blocking** copy: OpenCL
`.cpy_tensor_async = NULL` (`ggml-opencl.cpp:6875`); scheduler then
`synchronize(input)` + `synchronize(split)` + `tensor_copy`
(`ggml-backend.cpp:1664-1671`). OpenCL sync is
`clEnqueueBarrierWithWaitList` + `clWaitForEvents`
(`ggml-opencl.cpp:6258-6264`). That is 81 full-device waits/token on the
GPU↔CPU expert boundary, independent of elementwise fusion.

Copy sizes at decode are tiny: `attn_post_norm` 8K and `ffn_moe_down` 48K
per layer (`n1_sched_B_c1000.err:13612,13618`). The tax is the wait, not
the memcpy.

---

## 1. Ops per GDN hybrid layer (K0 + live graph + decode dump)

KEXP this dump: `n_layer=40`, `n_expert=256`, **`n_expert_used=6`**
(`results/k4split/n3/runs/n3_ARM_CPU_fact_o1/combo.txt:141-142`).
Campaign prose that says “top-8” is the stock Qwen card; this pack is 6.
Matches the dump: 6 views of `ffn_moe_weighted` + **5 ADD**
(`n1_sched_B_c1000.err:13619-13624`; builder `llama-graph.cpp:2122-2138`).

Layer mix: `hparams.is_recr(il)` (`qwen35moe.cpp:192-198`). Dump: layers
0–2 GDN (`GATED_DELT` at `:13593`), layer 3 full-attn (`Qcur_full` at
`:1407`). 30 GDN + 10 FA.

K0 tables (`reports/moe-gdn-k0-op-inventory.md:19-73`) still match the
emit set. Line numbers in K0 for `qwen35moe.cpp` are stale; current
emit is `qwen35moe.cpp:254-353` (QKVZ / gated norm / FA) and
`:362-478` (linear attn).

### 1.1 Decode GDN layer 0 — listed compute (views omitted by scheduler)

Source: `n1_sched_B_c1000.err:13570-13633`. Gaps in node ids are
`RESHAPE`/`VIEW`/`PERMUTE` (no enqueue: `ggml-opencl.cpp:6383-6385`).

| class | ops (count) | dump nodes (layer 0) |
|---|---|---|
| **Heavy** | `MUL_MAT` ×10 (qkv, α, β, z, ssm_out, router, shexp gate/up/down, shexp-gate) | 13, 34, 40, 51, 56, 61, 89–93 |
| | `SSM_CONV` ×1, `GATED_DELTA_NET` ×1 | 27, 44 |
| | CPU `MUL_MAT_ID` ×3 + `SWIGLU` ×1 | 73–76 |
| **Elementwise / unary** | `RMS_NORM`×3 + `MUL`(γ)×3 | 1–2, 49–50, 59–60 |
| | `SCALE`×2 (zero `cache_r`/`cache_s` slots) | 5, 22 |
| | `SILU`×2, `L2_NORM`×2 | 28, 53, 30, 32 |
| | `ADD`+`SOFTPLUS`+`MUL` (α chain) | 36–38 |
| | `SIGMOID` (β) | 42 |
| | `MUL` (gated norm) | 54 |
| | `ADD` residual attn | 58 |
| | `SOFT_MAX` | 62 |
| | `SUM_ROWS`+`CLAMP`+`DIV` (router w-norm) | 68–70 |
| | `MUL` (expert weights) | 77 |
| | `ADD`×5 (6-expert reduce) | 84–88 |
| | shexp `SWIGLU`, `SIGMOID`, `MUL`, `ADD`, `ADD` | 91, 94–97 |
| **Glue launches** | `GET_ROWS` conv/ssm (2 live + 2 empty) | 7, 9, 23, 24 |
| | `CPY` conv/ssm writeback (1 live + 2 empty) | 11, 19, 26, 47 |
| | `CONCAT` conv window | 16 |
| | `ARGSORT` + `GET_ROWS` top-k weights | 64, 66 |
| **No launch** | ~30 `VIEW`/`RESHAPE`/`PERMUTE` | skipped ids |

Empty 0K `GET_ROWS`/`CPY` (`:13574-13575`, `:13581-13582`) hit
`ggml_is_empty` → `continue` (`ggml-opencl.cpp:6383`). Net **~56
launches/GDN layer** before fusion, **~53** after the existing
`RMS_NORM+MUL` fuse (§1.3).

Elementwise+glue (the Q4(a) pool), GDN layer, **after** dropping empty
and views:

- **22 elementwise** that still enqueue after RMS fuse (3 RMS+MUL pairs
  already 1 launch each).
- **7 glue launches** (2 GET_ROWS state, 2 CPY writeback, CONCAT,
  ARGSORT, GET_ROWS weights).

### 1.2 Full-attn layer (every 4th)

Dump layer 3 (`n1_sched_B_c1000.err:1405-1440`) + same FFN tail.
Extra vs GDN: `MUL_MAT` Q/K/V/O, `ROPE`×2, `SET_ROWS` K/V, `MUL_MAT`
KQ, `SOFT_MAX`, `MUL_MAT` KQV, `CONT`×2, `SIGMOID`+`MUL` gate
(`qwen35moe.cpp:350-353`). No GDN α/β/SSM_CONV/L2/state CPY.
**~53 listed / ~49 after RMS fuse** (4 RMS+MUL pairs: attn, Q, K, post).

### 1.3 Fusion that already exists (do not recount as a win)

`ggml_backend_opencl_graph_compute` already fuses
`RMS_NORM+MUL`, `NORM+MUL+ADD`, `GROUP_NORM+MUL+ADD` unless
`GGML_OPENCL_DISABLE_FUSION` is set (`ggml-opencl.cpp:5607, 6391-6405`).
`ggml_can_fuse` requires consecutive nodes, `use==1` on intermediates,
**same shape** (`ggml-impl.h:669-695`).

On this graph those pairs **are** consecutive (`norm-0` then `attn_norm-0`
at `:13570-13571`). **~130 launches/token already removed**
(30×3 + 10×4). GDN graphs do not emit `NORM`/`GROUP_NORM`, so those
fusers are idle here.

### 1.4 Whole-token launch budget (decode, product-like graph)

| | count |
|---|---:|
| 30 × ~53 GDN | ~1590 |
| 10 × ~49 FA | ~490 |
| embd `GET_ROWS` + final RMS+MUL + `GET_ROWS` + `MUL_MAT` | ~4 |
| **≈ enqueues / token** | **~2080** |

~160 of those are CPU (`40 × (3 MUL_MAT_ID + SWIGLU)`). GPU ≈ **~1920**.

---

## 2. (a) Fuse elementwise chains — how many launches can actually die

Constraint: fuse only **inside one OpenCL split**, consecutive,
`use==1`, and (for the existing helper) **same shape**. Broadcast
(`SIGMOID` scalar-ish shexp-gate × 8K hidden) does **not** pass
`ggml_are_same_shape` (`ggml-impl.h:690-692`).

### Realistic (same-shape, one new kernel each, no state machinery)

| chain | where | saved / layer | layers | saved / token |
|---|---|---:|---:|---:|
| `ADD+SOFTPLUS+MUL` (α) | `qwen35moe.cpp:396-401`; dump 36–38 | 2 | 30 GDN | 60 |
| `SILU+MUL` (gated norm) | `qwen35moe.cpp:270-278`; dump 53–54 | 1 | 30 GDN | 30 |
| `SUM_ROWS+CLAMP` (not `DIV`: shape change) | `llama-graph.cpp:1943-1951`; dump 68–69 | 1 | 40 | 40 |
| 6-way expert `ADD` reduce → 1 kernel | `llama-graph.cpp:2132-2138`; dump 84–88 | 4 | 40 | 160 |
| FA `SIGMOID+MUL` attn gate | `qwen35moe.cpp:350-353`; dump 321–322 | 1 | 10 FA | 10 |
| `ADD+ADD` (moe+shexp, then residual) | dump 96–97 | 1 | 40 | 40 |
| **Subtotal** | | | | **340** |

`DIV` after clamp cannot ride `ggml_can_fuse` (output is
`[n_expert_used]` vs `[1]`). Leave it.

### Stretch (new op pairing, still same island)

| chain | saved / token | why stretch |
|---|---:|---|
| `SSM_CONV+SILU` (`qwen35moe.cpp:418-422`; dump 27–28) | 30 | new kernel pairing, not in `can_fuse` table |
| `SIGMOID+MUL` shexp-gate (broadcast) | 40 | fails same-shape; custom kernel |
| **+ stretch** | **+70 → ~410** | |

### Do **not** count

- `RMS_NORM+MUL` — already fused.
- `SCALE`+`GET_ROWS`+`CPY` recurrent state — correctness-critical
  (`moe-gdn-k0-op-inventory.md:92-97`). A wrong fuse corrupts `cache_r` /
  `cache_s`. Not a week-1 fuse.
- `SOFT_MAX`+`ARGSORT` — not elementwise; `ARGSORT` is the top-k.
- `CONCAT`+`CPY` — two consumers (conv input vs cache writeback).
- Anything across the CPU expert split — fusion is per
  `graph_compute` on one backend (`ggml-opencl.cpp:6372-6405`).
- `MUL_MAT` epilogues (β+`SIGMOID`, shexp+`SWIGLU`) — that is a GEMV
  change. Mandate: do not reopen GEMV.

### Honest (a) range

**200–450 launches/token** if every realistic/stretch fuse lands.
**~340** is the number I would bet a week of kernels on.
That is **~10–22 %** of ~2080, **~11–23 %** of ~1920 GPU launches.

It does **not** touch the 82 splits. It does **not** move the N3 0.698×
decode (GEMV-bound, `moe-k4-split.md:323`, `moe-mld-m1.md:184-187`).
If a small F32 kernel is launch-dominated, 340 fewer enqueues is the
whole win. Without a device profile that is an upper bound on *count*,
not on milliseconds.

---

## 3. (b) Pin small glue CPU-side to cut graph splits

### Ceiling on splits: **0**

The 82 splits are `GPU trunk ↔ CPU routed experts` × 40 layers, plus
embd and the last OpenCL island (§0). Pinning more glue cannot merge
those two backends. Minimum with this residency is still **2 islands /
layer**.

| pin | islands / layer | splits / token |
|---|---|---|
| N1 (router weight on GPU) | GPU(GDN+router) \| CPU(experts) \| GPU(FFN tail) | 82 |
| N2 product (`ffn_gate_inp.weight=CPU`, `moe-k4-split.md:207,214`) | GPU(GDN) \| CPU(router+experts) \| GPU(FFN tail) | **82** |
| Also pin FFN tail + shexp CPU | GPU(GDN/FA) \| CPU(whole FFN) \| GPU(next attn) | **82** |
| GPU `MUL_MAT_ID` (forbidden: kills expert-ready hook, K0 Q7 / `ggml-cpu.c:1666`) | ~1–few | would drop 80; **out of scope** |
| Entire model CPU | 1 | 1; abandons the split |

N1 already has **no extra glue-caused splits**. Layer 3 FA does not add
one. There is no 83rd island sitting on a 256-float `SOFT_MAX`.

`GET_ROWS` on `token_embd` is CPU because quantized `GET_ROWS` other
than Q4_0 is unsupported (K0 G4, `moe-gdn-k0-op-inventory.md:167`).
Fixing that removes **split 0 only** → 81. Needs a `GET_ROWS` kernel,
not a pin.

### What CPU-side glue *does* buy

Absorbing the router chain into the existing CPU expert island (N2 pin
already starts this: weight on CPU → P2/P3 keep `SOFT_MAX` /
`ARGSORT` / `GET_ROWS` / `SUM` / `CLAMP` / `DIV` on CPU,
`ggml-backend.cpp` P2–P5 as summarized in K0 Q5 `:199-206`):

- **~7 GPU launches/layer × 40 = ~280 GPU launches** become CPU.
- Tensors are 256-F32 logits / 6 weights (`moe-k4-split.md:209-211`).
  CPU is the right place. This is a correctness pin first.
- **0 splits saved.**

Pinning the **post-expert** tail (weight `MUL`, 5 `ADD`, shexp GEMVs,
`SIGMOID`+`MUL`, residuals) onto that same CPU island:

- **~15 GPU launches/layer × 40 = ~600** leave the GPU.
- Copy across the boundary shrinks 48K → 8K (`ffn_moe_down` vs `l_out`).
- Shexp GEMVs (`704K`/`840K` weights in the dump, `:13625-13628`) move
  to CPU. Maybe slower. Identity should hold (CPU path).
- **Still 82 splits.**

### Honest (b) ceiling

**0 of 82 splits.** The lever is real only as “stop paying GPU launch
tax on 256-float glue by sitting it on the island you already wait for.”
Call it **0–280 GPU launches** (router, already the N2 pin) or
**0–600** (whole FFN tail, speed-ambiguous). It is not a command-buffer
substitute and it will not pass the N3 1.10× gate by itself.

---

## 4. Table — lever / launches saved / weeks / risk

Ranges are **decode launches/token** vs the N1 dump graph (~2080, GPU
router). Product N2 pin already takes the “router → CPU” row; do not
add it on top of SUM+CLAMP GPU fusion (that chain is then CPU).

| lever | launches saved (range) | week-estimate | risk |
|---|---|---|---|
| **Existing `RMS_NORM+MUL`** (already on) | ~130 (already in the ~2080) | 0 | none — do not rebuild |
| Fuse `ADD+SOFTPLUS+MUL` (α, 30 GDN) | **50–60** | 0.5–1 | **low** — same-shape F32, `use=1` |
| Fuse `SILU+MUL` gated-norm (30 GDN) | **25–30** | 0.5 | **low** — clone RMS-fuse path |
| Fuse `SUM_ROWS+CLAMP` (40; skip `DIV`) | **0–40** | 0.5 | **low** if router still GPU; **n/a** after N2 pin |
| Fuse 6-expert `ADD` reduce → 1 kernel | **120–160** | 1 | **med** — must match `n_expert_used` (6 here, not 8); warmup uses `hparams.n_expert_used` (`llama-graph.cpp:2128-2131`) |
| Fuse FA `SIGMOID+MUL` gate | **8–10** | 0.5 | **low** |
| Fuse residual `ADD+ADD` | **30–40** | 0.5 | **low** |
| Fuse `SSM_CONV+SILU` | **0–30** | 1–1.5 | **med** — new pairing, decode-shaped only |
| Fuse shexp `SIGMOID+MUL` (broadcast) | **0–40** | 1 | **med** — `can_fuse` same-shape fails; easy to get the broadcast wrong |
| **(a) all realistic same-shape fuses** | **200–340** | **2–3** sequential | **low–med** |
| **(a) + stretch** | **200–450** | **3–4** | **med** |
| Pin router island CPU (N2 `-ot ffn_gate_inp.weight=CPU`) | **~280 GPU** (0 splits) | **0** (flag exists) | **low** — required for token identity (`moe-k4-split.md:214`) |
| Pin FFN tail + shexp CPU | **~400–600 GPU** (0 splits) | 0.5–1 | **med** — shexp GEMV may regress; identity OK |
| **(b) cut the 82 splits by CPU glue** | **0 splits** | — | **dead** as a split lever |
| GPU `GET_ROWS` quantized embd (K0 G4) | **1 split** (82→81) + 1 launch move | 1–2 | **med** — new kernel; `token_embd` is 333 MiB host (`moe-k4-split.md:280`) |
| Wire OpenCL `cpy_tensor_async` + events | 0 launches, 82 splits **cheaper** | 2–3 | **high** — Adreno events unproven here; still not a cmdbuf |

**Combined honest ceiling (no driver cmdbuf, no GEMV, no GPU experts):**
**~200–450 fewer launches/token, still 82 splits.**

Week cost for that ceiling: **~3 weeks** of OpenCL fuse kernels + tests
against `test-backend-ops`, then one unplugged greedy A/B. Not a
decode-gate program.

---

## 5. What this does *not* recover

- K4 N3 gate (decode ≥1.10× or TTFT ≥1.5×) **failed at 0.698× / 0.59×**
  (`moe-k4-split.md:317`). Fusion of 8K–48K F32 chains cannot outrun
  the A7X GEMV roof M1 already hit (`moe-mld-m1.md:119-121, 184-187`).
- ML-Drift’s fused executor (months) is the thing that collapses
  launch + split together. Q4(a)+(b) are not a substitute.
- `cl_khr_command_buffer` (Q1–Q3) is the only bounded way to keep 82
  islands and still pay one enqueue/token. This file assumes that path
  is absent.

DONE
