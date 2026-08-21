# OOMWALL — GPU-MoE load reboot on Adreno 740 (S23, 8 GB)

**Mission:** root-cause the kernel reboot on Mellum2-12B-A2.5B Q4_K_M GPU offload. Not a speed cell.
**Date:** 2026-08-20 (night)
**Executor:** grok
**Device:** S23 Adreno 740 `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` (NOT Jelly). Plugged is fine for crash probes.
**Tree:** llama.cpp `c1bb48d32` `kalsa/kernel-s3-repack` (kalsakernel-v3).
**Logs:** `results/oomwall_s23/`
**BANKED:** 2026-08-21. Chapter closed.

### Verdict (banked)

The S23 power-off wall is **llama-bench's default ARM `CPU_REPACK`** (`use_extra_bufts=true`) at Q4_K_M scale. CPU-only is enough. GPU is innocent. Production is structurally immune (`session.cpp` `use_extra_bufts=false`).

| cell | config | extra_bufts | outcome |
|---|---|---|---|
| **W1** | Mellum2 `-ngl 2 -ncmoe 99` | **true** (stock) | **POWER OFF** (button). MemAvailable cliff **5.01 → 0.45 GB** / 13 s. `weights_pool` 189.46 MiB OK, **zero SET_TENSOR**. |
| **W2** | LFM2.5-KEXP `-ngl 99` | true | **LOAD OK.** Experts Q2_K/Q3_K, no ARM pack → mmap. No cliff. Decode abort 134 FA `map::at`. |
| **W4** | Mellum2 `-ngl 0` | **true** (stock) | **POWER OFF**, then **auto-reboot**. GPU not required. **Caveat:** died at **~9 s, pre-crater** (MemAvailable still ~5.1 GB). logcat `Read_top` **3.1 GB** + `lmkd` min2x watermark / swap-low. Not a W1-shaped 4.4 GB copy crater. |
| **W4c** | Mellum2 `-ngl 2 -ncmoe 99` (W1 config) | **false** (impl `d2030f23`) | **LOAD LIVES.** SET_TENSOR of `output.weight` + `blk.27.attn_*`. mem_poll W2-shaped, floor 3895 MiB, **no 4 GB cliff**. Decode abort 134 FA `map::at` (not the wall). Device stayed up. |

**Proof is the W4↔W4c single-variable pair:** same model; W4c uses W1's ngl/ncmoe; **only `use_extra_bufts` flips**; populate stays on in both W4c and stock. W4 dies + W4c load-lives ⇒ extra_bufts / CPU_REPACK. Populate-as-killer dies (W4c still MAP_POPULATEs). GPU-required dies (W4 is `-ngl 0`). W1's cliff is the anonymous-copy signature of the same path under ngl=2 (OpenCL init delay lets the crater be sampled).

**Queued — own reviewed commit later, not this chapter.** Do **not** land the one-liner as the shippable fix. Proper fix: add `--no-extra-bufts` to llama-bench, mirroring llama-cli (`common/arg.cpp:2174`). Proven dodge (reverted): `results/oomwall_s23/llama-bench-noextra.diff` (`mparams.use_extra_bufts = false` in `to_llama_mparams()`). Upstream-worthy.

Night crash-budget (historical): W1 was a full POWER OFF (owner button), not a self-reboot. Aftermath of the same panic class varies (button vs auto-reboot; W4 did both stories until owner confirmed auto-reboot this morning).

## OPERATIONAL UPDATE (owner, 2026-08-20 ~23:42)

W1 did **not** self-reboot. The S23 **powered off completely**; owner pressed the power button. Treat every prior "reboot" tonight as possibly the same (hard power-off). Kernel `bootreason=reboot` is what Android stores after a dirty power-cycle too — do not read it as "it came back by itself."

### Transports verified NOW (phone reachable, owner present)

| transport | serial | status |
|---|---|---|
| USB | `R3CW406P8CV` (transport_id 119) | **device**, authorized (no popup) |
| Wireless TLS | `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` → `192.168.1.152:38987` (id 120) | **device** |
| Jelly | `192.168.1.82:39591` | present, **do not use** |

- `settings get global adb_wifi_enabled` = **1** (wireless debugging **survived** the power-off).
- Battery: USB powered, status 2 charging, level 96, temp 33.3 °C. `mWakefulness=Awake`. uptime 2 min. MemAvailable 4123 MB.
- `.so` still `2ed2e48a…`. Mellum2 GGUF size still 8071293600. LFM2.5 push was **interrupted** at 2776104957 / 3326160384 — will delete and re-push for W2.
- USB is the preferred transport (survives wireless debug quirks; already authorized).

### Ladder reorder

| run | expected | status |
|---|---|---|
| Exploratory ngl=8 / ngl=2 experts-GPU | crash | already spent (possibly power-off, not self-reboot) |
| **W1** Mellum2 `-ngl 2 -ncmoe 99` dense-only | we thought no-crash | **DONE — POWER OFF.** Mellum2 at any ngl is now crash-risk. Do **not** run Mellum2 `-ngl 1` experts-CPU. |
| **W2** LFM2.5-KEXP `-ngl 99` + alloc log | no-crash (bmoe smoke lived) | **NEXT** |
| W3 Mellum2 experts-GPU + log | intentional crash | **CANCELLED tonight** — W1 already required manual power-on. |

Resume if owner returns the phone later: W3 is the money run (Mellum2 `-ngl 1` experts-GPU, logger already on device, stream stderr to PC, arm logcat/pstore). Not tonight unless unattended comeback is proven.

## Why this wall matters (owner framing)

Expert placement CPU↔GPU is a **thermal relief valve**: GPU experts are the better perf/W path, so the phone runs cooler and more consistent even when GPU does not win raw tok/s. A driver-level wall that reboots the device on load makes that valve unusable on 8 GB A740. Correctness (K2 391/391) is not loadability.

**Production is structurally immune.** `session.cpp` hard-sets `use_extra_bufts=false` (never CPU_REPACK), `mmap_prefetch=-1` when MoE streaming is on, experts are cache-sized O_DIRECT, dense-anon is trunk-only, `ram_guard` refuses overcommit. The wall is a llama-bench / llama.cpp-default artifact at Mellum2 scale, not the product. Evidence: PRODUCTION EXPOSURE below.

## MORNING 2026-08-21 — W4/W4c VERDICT

**Idle-off rumor: REFUTED (owner correction).** Phone found **ON**. Pre-W4 uptime **8h34**. Never powered off except under load. That **strengthens** `crash ⇒ our run`.

**Aftermath is not unique:** W1 and the first W4 report needed the power button. This W4 **auto-rebooted** (`uptime 2 min`, `sys.boot.reason=reboot`). Same class of crash (kernel panic); userspace sees hard power-off *or* auto-reboot. Do not treat `bootreason=reboot` as "it recovered by itself" without checking whether the owner pressed the button.

### Health (pre-W4)

USB `R3CW406P8CV` + TLS. Jelly absent. USB powered, level **100**, temp **27.8 °C**, Awake. MemAvailable 3959 MB. Pins MATCH: opencl `2ed2e48a`, stock impl `bad17952`, llama `f8b11fc3`, stub `b2ae0fa6`, Mellum2 GGUF `b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7`.

### W4 — Mellum2 `-ngl 0`, stock extra_bufts=true — **POWER OFF / auto-reboot**

- `run_w4.ps1`, no binary push. Stream: `W4_START` → OpenCL banner → adb 255. USB+TLS gone.
- **S0-malloc-only-if-GPU: KILLED.** CPU-only. GPU not required.
- mem_poll recovered after comeback (**9 samples, ~9 s**). **No 4.4 GB cliff:**

```
t=0–3  3990→3989
t=4–8  reclaim → 5077 MiB peak
DEATH  (MemAvailable still ~5.1 GB)
```

- logcat (08:15:46–52): `llama-bench` pid 18029 **Read_top 3037 MB then 3129 MB**; `lmkd` `min2x watermark is breached and swap is low`; cached apps SIGKILL. Binary garbage at end of logcat (dirty power-cycle). Died during **heavy GGUF read + LMK**, *before* a W1-shaped anonymous crater. Populate/reclaim storm is in the picture for ngl=0; W4c is the lock.

### W4c — Mellum2 `-ngl 2 -ncmoe 99`, extra_bufts=false (impl `d2030f23`) — **LOAD LIVES**

- Pushed **only** `libllama-bench-impl.so` + identical stub. sha-verify on device MATCH `d2030f23`. opencl still `2ed2e48a`.
- Stream: Adreno prealloc 377 MiB OK → `load_cl_kernels.done` → **weights_pool 189.46 MiB OK** → **SET_TENSOR** (`output.weight` q6_K 177 MiB, `blk.27.attn_*`, q4_K staging, graph tensors). This is the hole W1 never reached.
- Decode aborted **software**: `std::out_of_range: map::at: key not found` in `ggml_cl_compute_forward` / `llama_decode`. rc=**134**. Same FA `.at()` as W2. **Not a power-off.**
- Device stayed up. mem_poll **24 samples**, W2-shaped: ION dip −373 MiB (4268→3895), recover 4780, flat ~4700, small −305 around SET_TENSOR, **floor 3895 MiB**. **No 4 GB cliff.**
- After abort: uptime continuous 5 min, MemAvailable **5224 MB**, noextra impl still on device.

### Verdict vs pre-registered table

| cell | predicted S0-repack | predicted populate-as-killer | predicted malloc-only-if-GPU | **observed** |
|---|---|---|---|---|
| **W4** ngl=0 stock | POWER OFF | POWER OFF | LIVES | **POWER OFF** (auto-reboot). GPU-only-malloc **killed**. |
| **W4c** ngl=2 extra_bufts=false, populate **still on** | **LIVES** | POWER OFF | LIVES | **LOAD LIVES.** Decode abort 134 FA `map::at` (not the wall). |

**S0-repack CONFIRMED.** extra_bufts=false is sufficient for Mellum2 to finish the load that killed W1/W4. **S0-populate-as-the-wall KILLED** (W4c still MAP_POPULATEs). **S0-malloc-only-if-GPU KILLED** (W4 ngl=0 died). W4b (prefetch=-1) is **not needed**. Production already `use_extra_bufts=false`. **Do not commit the fork-side llama-bench one-liner in this chapter** — queue `--no-extra-bufts` (see BANKED header).

The W4 mem_poll missing-cliff is a footnote, not a veto: ngl=0 + extra_bufts=true started a 7.5 GB GGUF read / LMK storm and panicked before a 13 s copy crater could be sampled. W1 still has that crater; W4c shows turning extra_bufts off removes the wall with populate left on.

**W5 (OLMoE speed/thermal) RAN 2026-08-21 unplugged:** `results/olmoe_gpu_moe_s23/RESULT.md`. ngl=16 stable. GPU experts **2.17× burst tg** / **~1.5× sustained** vs CPU experts, equal-or-lower temp. Both arms noextra `d2030f23`. Exploratory.

## Prior evidence (exploratory cell, already spent)

| attempt | ngl | experts | death | MemAvailable | stderr |
|---|---:|---|---|---|---|
| probe | 8 | GPU | ~15 s reboot | stayed 3.5–4.8 GB | 209 B OpenCL banner (unflushed) |
| retry | 2 | GPU | ~28 s reboot | cliff 4.7 GB → **450 MB** | identical 209 B |

Lead: ngl=2 expert tensors ~380 MB, yet host RAM fell at **model scale**. Something in the load path allocates from the file/model, not from ngl. Known-good: bmoe smoke LFM2.5 3.1 GB `--ngl 99` GPU trunk, no reboot.

---

## PHASE 1 — code recon (c1bb48d32, no device)

`ggml-opencl.cpp`. OpenCL `buffer_from_host_ptr = false` (`:11157`). GPU weights always go through a real `clCreateBuffer` + `set_tensor` copies. CPU weights can stay mmap (`llama-model.cpp:1543`).

`n_gpu_layers=2` offloads the **last** repeating layer + output (`i_gpu_start = n_layer_all+1-ngl`, `:1292`). Input stays CPU. Matches ~380 MB experts for one MoE layer.

### Ranked model-scale allocation suspects

| rank | suspect | file:line | ngl-scaled? | why it can eat GBs |
|---|---|---|---|---|
| **S1** | **ONE `clCreateBuffer` for the whole OpenCL weights pool** | `ggml_backend_opencl_buffer_type_alloc_buffer` `:11045-11066` | should be sum of GPU tensors; **capped per buffer at `max_alloc_size`** (`:11074-11080`, device 884 MB on A740) | If layer assignment is wrong or ctx contains more tensors than ngl implies, this is one giant GPU buffer. `get_alloc_size` (`:11089`) is `nbytes + 4*alignment` for quantized — not a 4 GB multiplier. First `clCreateBuffer`; on fail, `CL_LARGE_BUFFER_QCOM` retry (`:11054-11056`). **Must log size BEFORE the create** (driver can die inside). |
| **S2** | **Adreno dense-GEMM prealloc at backend init** | `ggml_cl_init` `:6011-6036` via `ggml_cl_buffer::allocate` `:334-342` | **NO — hardcoded** `A_q=311164928` (297 MB) + `A_s=37 MB` + `B=43 MB` ≈ **377 MB**, clamped to `max_alloc_size` | Fired on first OpenCL buffer, independent of ngl. ~380 MB GPU ION. Necessary cost, not the 4.2 GB cliff alone. Coincides numerically with "380 MB experts". |
| **S3** | **Per-tensor staging `clCreateBuffer(ggml_nbytes)` + blocking `clEnqueueWriteBuffer` in `set_tensor`** | Q4_K `:9376-9381` (same pattern Q4_0 `:8383`, Q5_K `:9527`, Q6_K `:9688`) | per GPU tensor; released after convert (`:9447`) | Peak should be the largest single tensor. **If Adreno does not actually free ION until process death, this accumulates across every GPU tensor.** Write from mmap faults those pages; Qualcomm DMA often **anonymous-copies** host src (not reclaimable). |
| **S4** | **`clCreateImage` IMAGE1D_BUFFER on the q subbuffer** | Q4_K trans4-moe `:9449-9456` width=`nelements/8`, format `CL_R UNSIGNED_INT32` | per MoE weight tensor | Spec: image-from-buffer is a view. **A740 may allocate a padded linear image store.** Device `IMAGE_MAX_BUFFER_SIZE` = 134217728 **pixels** (`:5933`, logged `:5713`). Width > that → driver crash candidate (not a clean `-61`). Image base-addr align is logged separately from buffer align (`:5919-5927`) — subbuffers only align to `MEM_BASE_ADDR_ALIGN`. |
| **S5** | **`load_cl_kernels` / `program_cvt` compile** | `:1519`, invoked from `alloc_buffer` `:11047` | ngl-independent | Compiles every convert kernel. test-backend-ops survived this **without** a 7.5 GB mmap in the same process. Combined with mmap+ION it can spike. Prior 209 B stderr is **file-buffering**, not proof we died in device-select. |
| **S6** | **Host mmap vs anonymous CPU copies at file scale** | `llama-model.cpp:1543-1572` | CPU side ≈ (model − ngl slice) | OpenCL cannot host_ptr. CPU can. If mmap is false on this Android path, CPU tensors `malloc(7 GB)`. **W1 discriminates:** experts-CPU + ngl=2 still has ~7 GB on CPU; if W1 also reboots with a similar cliff, S6/S3-host dominates and S4 (MoE image) is not required. |
| **S7** | **`ggml_backend_opencl_device_get_memory` lies** | `:11131-11141` | reports `global_mem_size - 1 GiB` always (~2.5 GB "free") | Does not allocate. Can fool `--fit` / split heuristics into over-committing GPU. ngl is explicit in our runs so secondary. |
| **S8** | **`static ggml_cl_buffer buf` in `transpose_2d`** | `:6058-6063` | grows to max transposed tensor, never shrinks | Q4_K **trans4-moe path does not call transpose_2d** (convert kernel writes SoA directly). Not the ngl=2 MoE load. |

`clSVMAlloc`: none in this file.

### Discriminators (Phase 3)

- **W1** Mellum2 `-ngl 2 -ncmoe 99`: GPU gets attn/norms/output of last layer, **no** trans4-moe images, **no** expert staging. Reboot → wall is not expert-specific (S1/S2/S5/S6). Survive → S3/S4 on the MoE path.
- **W2** LFM2.5-KEXP 3.3 GB `-ngl 99`: known-good size class, llama-bench not bmoe. Survive → wall is Mellum2-scale. Reboot → llama-bench/OpenCL load is generally toxic (S2/S5).
- **W3** Mellum2 `-ngl 1` + `GGML_OPENCL_LOG_ALLOC=1` streamed to PC: money run. Last `OPENCL_ALLOC` / `OPENCL_SET_TENSOR` line is the giant.

---

## PHASE 2 — alloc logger

Committed `c8f4fc05e` on `kalsa/kernel-s3-repack` (NO submodule push). Env `GGML_OPENCL_LOG_ALLOC=1` value-parsed, stderr+fflush. Logs TRY+OK for weights pool, Adreno prealloc (`ggml_cl_buffer`), load_cl_kernels begin/end, every `set_tensor` (name/type/nbytes/ne), Q4_K staging+image.

.so sha `2ed2e48a98e50f324c2aaed0c8fa7ed5b1c0fb09bff8f9a153f79420a7d69a87` (8044464 B) PC==device. **Note:** TRY+OK both add to `sum_mib` (double-count); read the `kind=` line not the raw sum. Real GPU creates ≈ half the TRY/OK pairs.

Logger **works**: W1 PC stream captured prealloc + kernels.done + weights_pool before the reboot. Prior 209 B banner was **on-device file buffering**, not an early death in device-select.

---

## PHASE 3 — W1 Mellum2 `-ngl 2 -ncmoe 99` (experts CPU)

**REBOOT.** Wall is **not expert-specific**.

- Unplugged at start, temp 28.5 °C. Logger .so sha-verified. GGUF sha still `b04281c2…`.
- Alloc trace (PC `w1.adb.log`): Adreno prealloc 297+37+43 MB **OK**; `load_cl_kernels.done`; **weights_pool 189.46 MB OK**. **Zero `OPENCL_SET_TENSOR` lines received.**
- Then MemAvailable 5.01 GB → **450 MB** over ~12 s (same cliff as ngl=2 experts-GPU) → `bootreason=reboot`, uptime 0 min.
- USB appeared as `R3CW406P8CV` after reboot (AC charging, plugged — allowed). .so survived `2ed2e48a`.
- **S4 (MoE IMAGE1D) and Q4_K expert staging are not required to kill the device.**
- The cliff is host-anonymous at **file scale** while only 189 MB of weights live on GPU. Points at **S6** (CPU tensors malloc-copied, mmap not holding them) **plus GPU ION 377+189 MB**, hitting the kernel at ~450 MB MemAvailable.
- Reboot budget used: 1/4 this mission (3 total tonight including the two exploratory).

Next: W2 LFM2.5-KEXP 3.3 GB `-ngl 99` — if it lives, the wall is Mellum2's 7.5 GB host copy; if it dies, llama-bench+OpenCL init is generally toxic.

---

## PHASE 3 — W2 LFM2.5-KEXP `-ngl 99` + alloc log (no-crash-expected)

**Phone stayed up.** Logger validated end-to-end.

- USB, charging, temp 33.1 °C, level 96. GGUF sha PC==device `b07c80870f8a864549f4a419ccbfb4d4282ba2d55a2e8d808b7c377d3fc6c3f4`.
- Alloc: same Adreno prealloc 377 MB; `load_cl_kernels.done`; **weights_pool 488.50 MB OK**; then **196 `OPENCL_SET_TENSOR` lines** (token_embd q5_K 180 MB, dense FFN, shortconv, attn, `ffn_gate_inp` — **zero `*_exps` names**, experts stayed CPU). Extra `ggml_cl_buffer` 125 MB during token_embd convert/transpose.
- MemAvailable: 4.11 → 3.72 → recover 4.47 → 3.85 GB at abort. **No 4.7→0.45 cliff.**
- Decode aborted **software**: `std::out_of_range: map::at: key not found` in `ggml_cl_compute_forward` (rc=134 SIGABRT). Unrelated to the wall; LFM2.5 shortconv/MoE graph hit a missing map key. **Not a power-off.**
- Device still reachable USB+TLS after W2. uptime continuous. temp 33.6 °C. MemAvailable 4901 MB.

**W2 proves:** OpenCL init + 377 MB Adreno scratch + ~500 MB GPU weights + llama-bench **do not** kill the A740. The wall is **Mellum2 7.5 GB host-scale**, not "any GPU offload."

---

## PARK — no more crash-risk runs tonight

W3 (Mellum2 experts-GPU + log) is the money run and is **cancelled**: W1 already required a **manual power button**. Rule: that was the last crash-risk access.

Mellum2 `-ngl 1` experts-CPU would be a repeat of W1's class (7.5 GB host copy) — not "shouldn't crash." Not run.

### What we can say without W3

1. Wall is **not** MoE IMAGE1D / Q4_K expert staging (W1, experts on CPU, still died).
2. Wall is **not** Adreno prealloc + kernel compile (W2 survived those).
3. Wall **is** coincident with loading Mellum2's **7.5 GB** file into anonymous RAM (MemAvailable cliff ~4.5 GB in ~12 s) plus ~0.5 GB GPU ION, then a **hard power-off** (not LMK process kill; not a self-reboot).
4. Leading suspect refined overnight: **S0-repack** (`use_extra_bufts=true` → `CPU_REPACK` anonymous ~6.3 GiB). S6/mmap-off and S0-populate cannot explain MemAvailable. See discriminator below.
5. Logger is proven. Next crash-risk run will have SET_TENSOR names on the PC stream if the owner authorizes it. Look for `CPU_REPACK model buffer size`.

### Resume instructions (owner / next session)

- Device: USB `R3CW406P8CV` already authorized; TLS wireless debugging persists. Serials above.
- `.so` on device is the logger build `2ed2e48a` / commit `c8f4fc05e`. Mellum2 + LFM GGUFs present, sha-verified. OLMoE Q4_K_M banked on PC (3.92 GiB).
- **Morning ladder (owner at the power button):** **W4** Mellum2 `-ngl 0` current binary, then rebuild `llama-bench`+`libllama.so` with `use_extra_bufts=false` for **W4c** (W1 config). USB, `LOG_ALLOC=1` streamed to PC, line-buffered stderr. Do **not** start with W3 (Mellum2 experts-GPU).
- Do **not** treat `bootreason=reboot` as unattended recovery.
- LFM2.5 decode `map::at` abort is a separate llama.cpp OpenCL FA bug; out of scope unless it blocks a later control.

---

## LOG ANALYSIS (PC-side, no device)

### W2 healthy baseline (196 SET_TENSOR, 488.50 MiB pool)

Logger E2E: prealloc → kernels.done → **one** `weights_pool` 512228608 B = **488.50 MiB** → 196 unique SET_TENSOR → 3 tiny extra pools (3+0.28+8 MiB, graph/KV) → FA decode abort.

SET_TENSOR bytes **sum to ~488 MiB** (q5_K 400.12 + q6_K 82.03 + f32 6.32). The OpenCL weights pool is exactly the GPU-assigned tensors, not a global file-sized reservation.

| family | n | MiB |
|---|---:|---:|
| token_embd | 2 | 171.88 (q5_K 2048×128000) |
| shortconv | 54 | 207.98 |
| ffn dense/gate_inp | 52 | 67.16 |
| attn | 61 | 41.44 |
| runtime graph | 5 | 0.01 |
| **`*_exps`** | **0** | experts stayed CPU |

Per-tensor: one giant (embd 172 MiB), then 8–11 MiB FFN/shortconv. Extra `ggml_cl_buffer` 125 MiB during `token_embd` q5_K convert/transpose (`static ggml_cl_buffer` in `transpose_2d`, `:6058`) — ngl-independent grow-only scratch, still ≪ file size.

MemAvailable stayed 3.7–4.5 GB. No cliff.

### W1 last line before power-off

PC stream (`w1.adb.log`) **ends at**:

```
OPENCL_ALLOC{kind=weights_pool,bytes=198663680,mib=189.46,sum_mib=1132.61,err=0}
```

**Zero `OPENCL_SET_TENSOR`.** OpenCL never started copying weights. Sequence that DID complete: device select → Adreno prealloc 377 MiB → `load_cl_kernels.done` → `clCreateBuffer(189.46 MiB)` for the dense-only GPU pool **returned success**.

Mem poll (1 Hz, 30 samples). Second-by-second (MiB):

```
t=0   4183
t=1   3775  (−408)   ← ION-sized dip (Adreno prealloc 377 MiB)
t=2–6 3872→4895      reclaim / compile
t=6–16 4895±15 FLAT  ← load_cl_kernels; NOT the cliff
t=17  4210  (−669)
t=18  3646  (−565)
…
t=29   461  (−203)   cumulative drop from peak = 4434 MiB in 13 s ≈ 340 MiB/s
```

The cliff is **after** the 189 MiB GPU pool exists, **before** any OpenCL `set_tensor`. Rate ~340 MiB/s is memcpy/repack-from-UFS, not a single `malloc` (virtual alloc is instant).

### Timeline reconstruction

| t | stage | evidence |
|---|---|---|
| 0 | process start | mem 4.28 GB |
| ~0–5 s | OpenCL device + Adreno prealloc 377 MiB | ALLOC log; mem recovers (reclaim) |
| ~5–15 s | `load_cl_kernels` | kernels.done logged; mem ~5.0 GB **flat** — compile is **not** the cliff |
| ~15 s | GPU weights `clCreateBuffer(189 MiB)` | last ALLOC line, err=0 |
| ~15–28 s | **cliff 4.5 GB host RAM** | mem_poll only; **no SET_TENSOR** |
| ~28 s | power-off | owner button |

### MemAvailable semantics — the discriminator (re-read, 2026-08-21)

Linux/Android `MemAvailable` **includes reclaimable file-backed page cache** (`MemFree + (Cached − Shmem) + SReclaimable − watermarks`). A `MAP_POPULATE` of a **file-backed** mapping fills `Cached` and must **not** take MemAvailable from 5 GB to 450 MB. An **anonymous** allocation (`posix_memalign` / `CPU_REPACK` dest / ION/dmabuf) is unreclaimable and craters it exactly like W1.

W1 1 Hz curve (kB → MiB), 30 samples, process-lifetime:

| t (s) | MemAvailable | Δ | stage |
|---|---:|---:|---|
| 0 | 4183 | — | start |
| 1 | 3775 | **−408** | Adreno ION prealloc 377 MiB (unreclaimable). Recovers. |
| 2–6 | → 4895 | reclaim | compile / other |
| 6–16 | 4895 ± 15 **FLAT** | ~0 | `load_cl_kernels`; **not** the cliff. A blocking 7.5 GB populate, *if* it ran here, is invisible to MemAvailable (reclaimable). |
| 17–29 | 4895 → **461** | **−4434 MiB / 13 s ≈ 340 MiB/s** | after `weights_pool` 189 MiB OK, **zero** `OPENCL_SET_TENSOR` |

Per-second cliff (MiB): −669, −565, −632, −481, −319, −428, −248, −108, −244, −162, −188, −172, −203. Starts ~600 MiB/s, slows under reclaim. **Not** a single `mmap` returning (virtual, instant) and **not** DRAM memcpy (would be multi-GB/s). Consistent with first-touch of an anonymous dest at UFS **or** Q4_K/Q8_0 **repack** CPU throughput. Do **not** use the rate to prove UFS vs pack; use it to prove "bytes being committed unreclaimably", not "MAP_POPULATE as the MemAvailable event".

Android ION/dmabuf pinning of the **whole file mmap** is empirically weak: W2 would have shown a ~3 GB unreclaimable drop. It did not. The t=1 −408 MiB is the known Adreno scratch, not a 7.5 GB pin.

`w1.adb.log` / `w2.adb.log` contain **no** mmap/populate/malloc llama lines. llama-bench does not log the path. W1's missing `load_tensors: CPU_REPACK model buffer size = XXXX MiB` (`llama-model.cpp:1619`, after all ctx allocs, before `load_all_data`) is almost certainly **unflushed stderr** at power-off (`OPENCL_ALLOC` fflush-es; `LLAMA_LOG_INFO` does not). Tomorrow: line-buffer + look for that line. It is the smoking gun if W4/W4c live long enough to print it.

### Which load path W1 / W2 actually took

`llama_mmap` (`llama-mmap.cpp:445-467`): `init_mappings(params.mmap_prefetch >= 0)` with default `mmap_prefetch=0` → `llama_mmap(file, prefetch ? -1 : 0)` → `size_t(-1)` is truthy → **`MAP_POPULATE` + `MADV_WILLNEED` of the whole file**. Same default for W1 and W2. **Not** per-model, **not** per-backend, **not** gated on `mmap_prefetch` value other than `-1`. llama-bench has **no** `--mmap-prefetch` flag (`common/arg.cpp` has none either). `use_mmap` default true (`llama-bench.cpp:393`). `use_mmap_buffer` hardcoded true (`llama-model.cpp:1238`). mmap ctor **throws** on `MAP_FAILED` — no silent malloc+read fallback.

Host-ptr vs anonymous (`llama-model.cpp:1543-1572`):

```
if (use_mmap && use_mmap_buffer && buffer_from_host_ptr_supported && is_default_buft)
    → ggml_backend_dev_buffer_from_host_ptr   // file-backed, reclaimable
else
    → ggml_backend_alloc_ctx_tensors_from_buft // posix_memalign, anonymous
```

Then `load_all_data` (`llama-model-loader.cpp:1545-1572`): mmap + `cur->data == nullptr` → point into the mapping (no copy). mmap + `cur->data` already set → `ggml_backend_tensor_set` (copy/repack into the anonymous dest). `use_mmap=false` → `file->read_raw` into that dest.

OpenCL `buffer_from_host_ptr = false` (`ggml-opencl.cpp:11215`), `get_host_buffer_type = NULL` (`:11287`). GPU tensors **always** take the anonymous GPU pool. Size = GPU slice only (W1 189 MiB, W2 488 MiB) — cannot be the 4.4 GB cliff. CPU default buft **does** support host_ptr (`ggml-cpu.cpp:416-420`).

`is_default_buft` is false for **`CPU_REPACK`**. That is the file-scale anonymous path, and it does **not** require a GPU backend.

`ctx_map` is ordered by buft **name** (`llama-model-loader.h:108-110`): `"CPU"` < `"CPU_REPACK"` < `"OpenCL"`. Alloc then `load_all_data` run in that order. Sequence that matches W1:

1. `init_mappings` — MAP_POPULATE (reclaimable / possibly a no-op on this Android; either way MemAvailable stays).
2. Alloc CPU host_ptr (mmap bind, cheap) → alloc CPU_REPACK `posix_memalign(~6.3 GiB)` (virtual, MemAvailable unchanged) → alloc OpenCL `weights_pool` 189 MiB (**last ALLOC line**).
3. `load_all_data(CPU)` — mmap bind, no copy.
4. `load_all_data(CPU_REPACK)` — `repack_buffer_set_tensor` first-touches the anonymous dest. **Cliff. Zero OPENCL_SET_TENSOR.** Power-off before OpenCL ctx is loaded.

### GGUF numbers (header-only dumps in `results/oomwall_s23/_*_tensors.txt`)

This Android build: `GGML_CPU_REPACK:BOOL=ON`, `GGML_CPU_KLEIDIAI:BOOL=OFF`, `GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+i8mm+fp16` (`build-android-opencl-s3oracle/CMakeCache.txt`). `__ARM_FEATURE_MATMUL_INT8` ⇒ `ggml_cpu_has_matmul_int8()=1`. ARM pack (`repack.cpp:4574-4723`): **Q4_K / Q5_K / Q6_K** if `ne[1]%8==0`; **Q4_0 / Q8_0** if `ne[1]%4==0`. **No** neon pack for Q2_K (avx512/riscv only), Q3_K, Q5_0.

| | Mellum2 Q4_K_M (W1) | LFM2.5-KEXP (W2) |
|---|---|---|
| file | 8071293600 B (7.52 GiB) | 3326160384 B (3.10 GiB) |
| experts | 7059 MiB (Q4_K 56 + Q8_0 14 + Q5_0 14) | 2676 MiB (**Q2_K 44 + Q3_K 22** — filename says KEXP, types are Q2_K/Q3_K) |
| dense | 638 MiB | 496 MiB (Q5_K+Q6_K+F32) |
| **ARM-REPACK eligible** | **6468 MiB** (Q4_K 4404 + Q8_0 1874 + Q6_K 190) | dense 490 MiB (GPU took them) + Q2_K experts **0 on ARM** |
| stays mmap (no pack) | Q5_0 experts 1213 MiB + F32 16 | Q2_K+Q3_K experts 2676 MiB + F32 |

W1 `-ngl 2 -ncmoe 99`: GPU pool 189.46 MiB ≈ `output.weight` Q6_K (+ last-layer dense attn, experts forced CPU). CPU_REPACK dest ≈ **6468 − 189 ≈ 6279 MiB** (token_embd is GET_ROWS, likely *not* claimed by REPACK — ~0.1 GiB stays mmap; ignore). Cliff ate 4434 MiB then died at 461 MiB MemAvailable — ~70% through the copy. Fits.

W2 `-ngl 99`: GPU pool 488.50 MiB = **all** Q5_K 400 + Q6_K 90 + F32 6 (SET_TENSOR sum). CPU leftover = Q2_K/Q3_K experts, **not packed**, default CPU buft → **mmap host_ptr**. `load_all_data(CPU)` completes with no anonymous GB-scale dest **before** 196 OpenCL SET_TENSOR. MemAvailable 4.11 → 3.72 (ION) → 4.47 → 3.85. **No ~3 GB drop.**

### Verdict on the two S0 variants the owner named

| variant | meaning | W1 cliff | W2 ~3 GB | status |
|---|---|---|---|---|
| **S0-populate** | `MAP_POPULATE` of the GGUF is the killer | **No.** Flag **is** set in llama-bench, but a file-backed populate cannot crater MemAvailable. W1's crater is after `weights_pool`, not at `init_mappings`. | Absent drop is **exactly** what reclaimable populate (or a no-op populate) looks like. | **Demoted.** Still on; not the wall. |
| **S0-malloc, mmap/host_ptr never engages** (whole-file `read_raw` into malloc; `use_mmap=false` or CPU host_ptr broken) | backend-independent anonymous full file | Would look like W1 | Would have dropped ~2.7 GB **before** SET_TENSOR. **Did not.** | **REFUTED by W2.** `use_mmap=true` and CPU host_ptr **work** on this device. |
| **S0-malloc only if GPU present** | OpenCL no-host_ptr copies the whole file | GPU pool is 189 MiB, not 7 GB | GPU pool 488 MiB, lived | **REFUTED by code.** GPU malloc is ngl-scaled. File-scale malloc is the CPU extra buft. |
| **S0-repack** (the malloc that actually exists) | `use_extra_bufts=true` → `CPU_REPACK` malloc of every CPU tensor with an ARM pack | **Yes.** 6.3 GiB anonymous, ngl-tiny, GPU-independent, 0 SET_TENSOR hole, 340 MiB/s first-touch. | CPU leftover has **no ARM pack** → mmap. No cliff. | **LEAD.** |

llama-bench `to_llama_mparams()` (`llama-bench.cpp:1181-1193`) copies `llama_model_default_params()` (`use_extra_bufts=true` at `llama-model.cpp:2317`) and never clears it. llama-cli *can* pass `--no-extra-bufts` (`common/arg.cpp:2174`, `common.cpp:1566`). llama-bench **cannot**.

---

## CODE RECON (ranked, post-discriminator)

| rank | suspect | file:line | status |
|---|---|---|---|
| **S0-repack** | llama-bench `use_extra_bufts=true` → `CPU_REPACK` `posix_memalign` + `repack()` of all CPU Q4_K/Q8_0/Q6_K | `llama-model.cpp:2317`, `llama-bench.cpp:1181`, `repack.cpp:4751-4763`, `:4733` | **LEAD.** |
| **S0-populate** | `MAP_POPULATE` whole GGUF | `llama-mmap.cpp:455`, `mmap_prefetch=0`, `init_mappings(prefetch>=0)` | Still on in llama-bench. **Cannot be the MemAvailable cliff.** |
| **S0-malloc mmap-off** | `use_mmap=false` `read_raw` into malloc | `llama-model-loader.cpp:1573-1578` | Default mmap on; W2 refutes full-file anonymous. |
| **S1** | CPU `alloc_ctx_tensors` because host_ptr skipped for another reason | `llama-model.cpp:1572` | Only if `is_default_buft` lies. W2 says the default CPU buft host_ptr path works. |
| **S3** | Adreno 377 MiB + GPU pool | `ggml-opencl.cpp:6011`, `:11045` | t=1 −408 MiB. Not the 4.4 GB. |
| **S5** | MoE IMAGE1D | `:9449` | Refuted (W1). |

---

## PRODUCTION EXPOSURE — the wall threatens benches, not the product

**State this first in the morning briefing.**

`BigMoeOnEdge/core/src/engine/session.cpp:531-547` hard-sets, on every load:

```
mparams.use_mmap = true;
mparams.use_extra_bufts = false;          // NEVER CPU_REPACK — this is the S0-repack immunity
if (cfg.moe.enabled) mparams.mmap_prefetch = -1;  // NEVER MAP_POPULATE on the MoE/stream path
```

That is the **only** model-load path in the engine (`Session::open`). It does not inherit llama-bench / llama-cli defaults.

| product mechanism | file | why it cannot take the W1 path |
|---|---|---|
| `use_extra_bufts=false` | `session.cpp:536` | `make_cpu_buft_list` never inserts `CPU_REPACK`. CPU tensors stay default buft → mmap host_ptr. |
| `mmap_prefetch=-1` when `moe.enabled` | `session.cpp:545-547` | `init_mappings(false)` → no `MAP_POPULATE`. |
| Expert streaming | `expert_stream_source.cpp` | Routed `*_exps` rebound to a **cache-sized** O_DIRECT pool (`cache_mb` / auto), not a full-set malloc. `load_all` is opt-in. |
| `dense_weights` Anonymous (CLI/app default) | `dense_weights.h:5-15`, `config.h:175-178` | Copies the **trunk** (attn/embed/norms/lm_head) only — complement of expert byte ranges. Mellum2 trunk ≈ 638 MiB, not 7.5 GiB. GPU-resident tensors are not host-copied (`AnonGpu`). |
| `ram_guard_allows_gpu` | `session.cpp:264-334` | Refuses `--ngl` if `MemAvailable` cannot cover `gpu_dense + host_anon + leftover_mmap + cache + KV + compute + 300 MiB`. Comment: *"Refusing rather than risking RescueParty."* |

Caveats (not the wall):

- Without `--moe-stream`, `mmap_prefetch` stays 0 (populate on) **but extra_bufts is still false**. Populate of a 7.5 GB MoE is reclaimable; experts stay mmap, not REPACK-copied. Still not W1.
- `dense_weights=Anonymous` on a **dense** (non-MoE) model *would* anonymous-copy the whole trunk (= the file). ram_guard covers the GPU case; CPU-only dense+anon of a 7.5 GB file is a different, smaller product risk and is not how we ship MoE.

**The 8 GB power-off is a llama.cpp-default / llama-bench artifact at big Q4_K_M scale. The product is structurally immune.** llama-cli without `--no-extra-bufts` is in the same blast radius as llama-bench; bmoe is not.

---

## PRE-REGISTER tomorrow — exact expected outcomes per variant

Device **untouched until the owner is at the power button.** USB `R3CW406P8CV`. `GGML_OPENCL_LOG_ALLOC=1` streamed to PC (never an on-device file). Line-buffer stderr. Arm logcat/pstore. Do not treat `bootreason=reboot` as unattended recovery. Do **not** commit the dodge until the decisive cell lands.

W4c needs a **local one-line rebuild** of `llama-bench` + `libllama.so` (extra_bufts lives in libllama, not in `libggml-opencl.so`). Do that **after** W4, not tonight.

| id | config | **S0-repack (LEAD)** | S0-populate-as-the-wall (already demoted) | S0-malloc-only-if-GPU (code-refuted) |
|---|---|---|---|---|
| **W4** | Mellum2 **`-ngl 0`**, current binary, llama-bench defaults (`extra_bufts=true`, `mmap_prefetch=0`) | **POWER OFF.** CPU_REPACK dest ≈ **6468 MiB**, GPU not required, no OpenCL pool needed. Look for `CPU_REPACK model buffer size ≈ 6300 MiB` if the line flushes. | Would also predict POWER OFF (populate still on) — **but** if populate were reclaimable-only, this column actually predicts LIVE. A W4 death therefore **kills** "needs GPU" and **does not** distinguish populate-as-killer from REPACK. | **LIVES** (no GPU → no malloc). A W4 death **kills this column**. |
| **W4b** | Mellum2 `-ngl 0` + `mmap_prefetch=-1` (one-line; llama-bench has no flag). **Skip unless W4c dies.** | **POWER OFF** (prefetch is not the malloc). | **LIVES** (the populate-as-killer prediction). | LIVES |
| **W4c** | Mellum2 `-ngl 2 -ncmoe 99` (W1 config) + **`use_extra_bufts=false`**. Populate **still on**. | **LIVES.** CPU tensors take mmap host_ptr. MemAvailable stays high (populate reclaimable). Maybe a UFS hitch, not a power-off. **This is the REPACK lock.** | still POPULATE; if populate were the wall, **POWER OFF** even with extra_bufts off | LIVES if GPU+mmap doesn't pin (W2 already says it doesn't at 3 GB) |
| **W5** | OLMoE Q4_K_M 3.92 GiB, experts GPU, modest `-ngl`, logger | leftover Q4_K still REPACK'd (~4 GB − gpu). **May live** (4 vs 7.5). If it dies, the threshold is "anonymous Q4_K ≳ 4 GB", not the path. **Run with extra_bufts OFF if W4c was green** so this actually tests `use_adreno_moe_kernels`. | populate 4 GB invisible; should live | lives |
| **W6** | OLMoE, growing `-ngl`, extra_bufts still on only if W4c was not done | GPU slice ↑ ⇒ REPACK malloc ↓. Envelope = leftover pack bytes vs ~4 GB MemAvailable | ngl-independent populate (so ngl would not save us — another populate-as-killer tell) | ngl-independent if GPU present |

**Single-shot decisive pair: W4 then W4c.**

| W4 | W4c | interpretation | morning fix |
|---|---|---|---|
| dies | lives | **S0-repack confirmed.** GPU irrelevant. Populate innocent (W4c still populates). | fill in `use_extra_bufts=false` in llama-bench |
| dies | dies | extra_bufts is not sufficient; populate or another anonymous path still in play → run **W4b** | possibly also `mmap_prefetch=-1` |
| lives | (skip / optional) | wall **needs GPU** (the weak column). Do **not** re-run Mellum2 experts-GPU until a GPU + extra_bufts=false cell is designed. | not the extra_bufts one-liner |

W4b only if that middle row happens. Do not spend a rebuild on prefetch until extra_bufts has been tested.

### Sketch (do **not** commit) — fill-in-the-blank after the decisive cell

**S0-repack dodge (the one W4c is for):** in `tools/llama-bench/llama-bench.cpp` `to_llama_mparams()`, after `llama_model_params mparams = llama_model_default_params();`:

```
mparams.use_extra_bufts = false;
```

Or expose `--extra-bufts 0` the way llama-cli already exposes `--no-extra-bufts` (`common/arg.cpp:2174`). Production already hard-false. Minimal, bench-only, does not touch ggml.

**S0-populate dodge (only if W4c dies):** same function, `mparams.mmap_prefetch = -1;`. Production already −1 when `moe.enabled`. llama-bench has no flag today.

**Do not** gate `posix_memalign` / `MAP_POPULATE` on `MemAvailable` inside ggml — too late, too global, would surprise every backend. The flag is the fix.

Rebuild scope for W4c: the payload is **`libllama-bench-impl.so`** (llama-bench.cpp). `libllama.so` does not change (the flag is passed in, not compiled in). `libggml-opencl.so` `2ed2e48a` stays.

### W4c instrument — STAGED 2026-08-21 (no device, no commit)

Applied `mparams.use_extra_bufts = false;` in `to_llama_mparams()`, built Android `llama-bench` in `build-android-opencl-s3oracle`, copied artifacts out, **reverted the working tree** (`kalsa/kernel-s3-repack` clean at `c8f4fc05e`). Diff: `results/oomwall_s23/llama-bench-noextra.diff`.

| variant | artifact | sha256 | bytes |
|---|---|---|---:|
| W4 stock | `staging/stock/libllama-bench-impl.so` | `bad179520546f8d5316cd98124e948d025e8acb2999bf92b94977879ce72c171` | 4240544 |
| **W4c noextra** | `staging/noextra/libllama-bench-impl.so` | **`d2030f23db3b4f62f6934c9de831050e71e87c7cfda6e5059d53099ec8b60346`** | 4240160 |
| both | `llama-bench` stub | `b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c` | 7600 |
| both | `libllama.so` | `f8b11fc34be81291c01cc77a657d267eaf7f102ed6cb6ef708bbaab7730a667d` | 39807624 |
| both | `libggml-opencl.so` | `2ed2e48a98e50f324c2aaed0c8fa7ed5b1c0fb09bff8f9a153f79420a7d69a87` | 8044464 |

A cmake re-run during ninja rebuilt `libggml-base.so` and `libllama-common.so` in the build dir (hashes drifted). **Do not push those.** Morning W4c pushes **only** `staging/noextra/libllama-bench-impl.so` (and the identical stub). Stock impl was restored into `bin/` so an accidental whole-bin push of llama-bench-impl is still W4.

**Morning, owner at the button, USB `R3CW406P8CV`:**

```
pwsh results/oomwall_s23/run_w4.ps1     # no binary push; Mellum2 -ngl 0; expect POWER OFF
# owner powers on
pwsh results/oomwall_s23/run_w4c.ps1    # push noextra impl; Mellum2 -ngl 2 -ncmoe 99; S0-repack predicts LIVE
```

On-device: `w4.sh` / `w4c.sh` (LOG_ALLOC, mem_poll, logcat, sha in `*.pre`, llama-bench stderr unredirected). Host streams to `w4.adb.log` / `w4c.adb.log`.

---

STOP. Device untouched. Morning green light from the owner, then W4 → W4c.

---

## map::at TRIAGE (W2 abort, not the wall)

**Symptom:** after full GPU load, first decode: `std::out_of_range: map::at: key not found`, `ggml_cl_compute_forward` (`:24522`), then `llama_decode`. rc=134. Last SET_TENSOR: `OpenCL#attn_inp_kq_mask#0` f16 256 — **flash-attn mask**.

**Where:** unguarded `std::map::at` on FA kernel tables in the FA dispatch (`:14885` `fa.bm.at`, `:15006` `fa.f32_f16_q1.at`, `:15010-15012`, pad maps `:15344`). LFM2.5 attn is d_head=64 (q 2048×2048, k 2048×512). `{64,64}` **is** in `g_fa_dims_adreno_default` (`fa_tune.h:17`). Config exists; the **kernel object** for that variant was likely never inserted (compile skip / wg-size reject `:4692-4716`) and dispatch still `.at()`s it.

**Op:** `GGML_OP_FLASH_ATTN_EXT` (llama-bench `-fa` default auto). Not shortconv — those SET_TENSOR'd fine; death is at FA.

**Production exposure:** bmoe `--ngl 99` trunk **may** hit the same if it uses GPU FA with d_head=64. The LFM2.5 smoke that lived may have used CPU attn / FA off / a different graph. **Severity: Medium for llama-bench LFM2.5 GPU; unknown for bmoe; abort not power-off; not the wall.** No fix tonight.

---

## TOMORROW'S INSTRUMENT (small q4_K MoE) — BANKED

`models/OLMoE-1B-7B-0924-Instruct-Q4_K_M.gguf`

| | |
|---|---|
| source | `bartowski/OLMoE-1B-7B-0924-Instruct-GGUF` (HF curl `-L`) |
| bytes | **4213513024** (3.92 GiB) |
| sha256 | **`3bd9ec48045f526508956ef663c5c11dbb3ef791a06f4e10a6be88379c40e1fe`** |
| arch | `olmoe` — 16 layers, 64 experts, 8 used |
| dump | `results/oomwall_s23/olmoe_q4km_tensors.txt` |

Type histogram: Q4_K **97**, F32 81, Q6_K 17. **`ffn_*_exps` = 48 tensors: 40× Q4_K + 8× Q6_K** (Q4_K_M pattern: gate/up Q4_K every layer; some down Q6_K). Shapes `[2048,1024,64]` / `[1024,2048,64]` — `ne00=2048 % 32 == 0` so `use_adreno_moe_kernels` **will fire** on the Q4_K (and Q6_K) expert names. Not KEXP. In 2–5 GB window.

Ladder (W4 → W4c → W5/W6) is in **PRE-REGISTER tomorrow** above. Do not re-run Mellum2 experts-GPU until W4 says GPU is implicated or W5 is green with extra_bufts off.
