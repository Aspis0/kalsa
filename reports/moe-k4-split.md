# K4-SPLIT — CalaQwen trunk on GPU, routed experts on CPU

Date: 2026-08-13 (N0–N2 measured; N3/N4 waiter ARMED, UNPLUGGED only)
Device: Galaxy S23 only, `u0_a344@192.168.1.152:8022`
Workspace: `~/gdn_k2/k4split/`
Artifacts: `results/k4split/`
Mandate: `mandates/k4-split-overnight.md`

Parent: `BigMoeOnEdge` `main` @ `8958cdf914a7a5e71ffe7c29889bda4e0ae8fc56`
Fork: `kalsa/split-trunk-gpu` @ `04c5d362afb4ae3cf7762a81e204f6cba15c5480`
(= `kalsa/opencl-q6k-dispatch-fix`; **no extra fork commit**)

This is a **residency / placement** report. No ggml-opencl kernel, FLASH_ATTN,
or `kernel_gemv_*` work. M1 already proved GEMV rewrites fail (NMSE + DRAM
roof; `reports/moe-mld-m1.md`).

## TL;DR

**N0 DONE. N1 PASS. N2 PASS with router pin. N3/N4 waiter ARMED
(UNPLUGGED, batt ≥45 %, temp ≤35 °C, 6 h window).** The parent engine
expresses the split. Android OpenCL `bmoe-cli` sha `b8b1c732…` is on the
phone. Unpinned GPU router fails token-identity; pinning
`ffn_gate_inp.weight=CPU` restores byte-identity. Speed is not measured
on AC. Human card: `results/k4split/MORNING.md`.

Invariant: routed `ffn_*_exps` stay CPU/mmap so CPU `mul_mat_id` fires the
expert-ready hook (K0 Q7, `ggml-cpu.c:1666`). Trunk (GDN, attention, shared
expert, router, dense) may go GPU via `-ngl`. Always `--flash-attn off` on A7X.

---

## 1. Design as-built

### 1.1 Mechanism choice

| id | idea | verdict |
|---|---|---|
| **A** | KEXP experts are Q2_K (gate/up) / Q3_K (down). OpenCL `supports_op` is false for `MUL_MAT` and `MUL_MAT_ID` on those types → scheduler leaves them on CPU. | **Works in the fork** for this file (`results/k4split/recon_a_supports_op.md`). Fragile: a future Q4_K expert pack or a `supports_op` relaxation steals the bank and kills the hook. Morning **ARM_A** measures this. |
| **B** | `--moe-cpu-experts on\|auto` pushes `LLM_FFN_EXPS_REGEX` (`common.h:1058` = `\\.ffn_(up\|down\|gate\|gate_up)_(ch\|)exps`) onto `llama_model_params.tensor_buft_overrides` with the CPU buffer type. Does **not** match `*_shexp` or `ffn_gate_inp`. | **Product default.** Parent-only. No fork patch. Morning **ARM_B** / **ARM_AUTO**. |

Chosen default: **B via Auto** when `--moe-stream` is set and `--ngl != 0`.
Off is still available for the A/B. `--override-tensor` is extra, applied
after the Auto/On pin.

`--cpu-moe` in the fork CLI is the same regex; `bmoe-cli` names the flag
`--moe-cpu-experts`.

### 1.2 Call chain (parent, after `8958cdf`)

```
cli/main.cpp:600-625, 701, 773
  --ngl / --flash-attn / --moe-cpu-experts / --override-tensor / anon-gpu
  omitted --moe-cpu-experts + --moe-stream → Auto
runtime.cpp  session_config_from  copies the new fields
session.cpp:527-532
  mparams.use_mmap = true
  mparams.use_extra_bufts = false          // streamer invariant (no repack)
  mparams.n_gpu_layers = cfg.n_gpu_layers  // default 0; llama default is -1
session.cpp:542-545
  ngl!=0 && !llama_supports_gpu_offload() → fail open() (no silent CPU lie)
session.cpp:550-555
  ram_guard_allows_gpu (300 MiB slack)
session.cpp:560-596
  pin_ffn_exps = On || (Auto && ngl!=0)
  patterns live on Session::Impl std::list<string>  // not a function-local vector
  mparams.tensor_buft_overrides = Impl.buft_overrides
session.cpp:686-689
  cparams.flash_attn_type = DISABLED unless --flash-attn on
session.cpp:858-869
  dense list skips is_routed_expert_name
dense_weights.cpp:17-29, 71-85, 202, 314-318
  skip non-host tensors; refuse to copy/DONTNEED routed ffn_*_exps
expert_stream_source.cpp:97-111
  cache-auto deducts host-pending dense only
expert_stream_source.cpp:1386-1388 + session.cpp:905-907
  ggml_cpu_set_expert_ready_hook  (CPU mul_mat_id only)
router_hook.cpp:154-189
  HostAlias: ggml_backend_tensor_get/set around GPU topk/weights
```

Fork side that we **rely on** and did not edit:

```
llama-model-loader.cpp:1164-1193   -ot / select_weight_buft
ggml-opencl.cpp:6768-6817          supports_op MUL_MAT / MUL_MAT_ID
ggml-cpu.c:1666                    expert-ready hook
llama-model.cpp:1292-1317          ngl layer split; token_embd always CPU
llama-model-loader.cpp:1570-1571   GPU fill = tensor_set from mmap
llama-model-loader.cpp:1677-1687   mmap unmap only outside [first,last] used
```

### 1.3 Parent files touched (no ggml-opencl)

| path | what |
|---|---|
| `core/include/bmoe/config.h` | `DenseWeightsMode::AnonGpu`, `MoeCpuExperts`, `n_gpu_layers` / `flash_attn` / `override_tensor` |
| `core/include/bmoe/session.h` | same on `SessionConfig` |
| `core/include/bmoe/metrics.h` | `RunInfo` placement keys |
| `core/src/config.cpp` | reject empty `-ot` entries |
| `core/src/engine/runtime.cpp` | copy fields |
| `core/src/engine/session.cpp` | ngl, pin, FA off, RAM guard, placement log |
| `core/src/moe/dense_weights.{h,cpp}` | skip GPU + skip experts |
| `core/src/moe/expert_stream_source.cpp` | cache-auto host-only deduct |
| `core/src/moe/router_hook.cpp` | `HostAlias` |
| `core/src/metrics/csv_metrics_sink.cpp` | preamble keys |
| `cli/main.cpp` | flags |
| `tests/config_test.cpp` | placement defaults |
| `docs/architecture.md`, `docs/telemetry.md`, `CHANGELOG.md` | docs |

Not touched: `ggml-opencl` kernels, FLASH_ATTN sources, `kernel_gemv_*`,
`scripts/build-android.ps1` (stays `GGML_OPENCL=OFF`).

### 1.4 Commits

| repo | sha | subject |
|---|---|---|
| parent | `e926a54` | `feat(engine): GPU trunk / CPU expert residency knobs` |
| parent | `342df14` | `fix(engine): keep tensor overrides alive and leave expert mmap alone` |
| parent | `8958cdf` | `fix(engine): copy GPU routing tensors before the streamer reads them` |
| fork | `04c5d362a` | Q6_K dispatch fix (pre-existing). Branch `kalsa/split-trunk-gpu` has no extra commit. |

### 1.5 Binaries

| artifact | sha256 | notes |
|---|---|---|
| PC `results/k4split/bin/bmoe-cli-pc.exe` | `d2672584ddd8ac6453101850c19fde3eedf15df5390e18dad5efb16f2fa477a0` | OpenCL OFF; flag check only |
| Android `bmoe-cli` | `b8b1c732064f5f1d8e0d6ba3f5257af51bfe3d40ccb71ecaad49911677c815ab` | on device `~/gdn_k2/k4split/bin/`; `LD_LIBRARY_PATH=$WS/bin:/vendor/lib64` |
| `libc++_shared.so` (staged) | `e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6` | NDK r27b, matches K2 |
| Campaign CPU `bmoe-cli` (device) | `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f` | N2 uses **our** binary both sides |
| KEXP | `ac44e20c1783b9105b83246fd8ce59892b47a265b84e1323a8a501929877721a` | size 13416430592 |

Recipe: `results/k4split/BUILD_MANIFEST.md`.

### 1.6 RAM story (paper)

KEXP CPU-campaign measurement (`fixed.combo.txt`): dense **1664 MiB**,
KV@4096 **80**, RS **63**, compute@ubatch512 **501**. Cache 2000. Slack 300.
Steady-state with one DRAM copy of the trunk ≈ **4.6 GiB**. A second host
twin of the 1664 MiB trunk is the RescueParty path.

`anon` / `ahwb` / `anon-gpu` all skip non-host tensors. `anon-gpu` is the
self-documenting campaign name for the split. llama.cpp does **not** unmap
dense mmap pages that sit between CPU expert tensors; AnonGpu still
`MADV_DONTNEED`s those ranges.

N1 abort: MemFree < 300 MiB sustained. Retry `--cache-mb 1500`, then
`--cache-mb 1000 --force-cache` (`cache_min_mb = 1500`).

---

## 2. N0 — source recon + build

| item | result |
|---|---|
| Can the fork express the split? | **YES** — A by type, B by `-ot` / `--moe-cpu-experts` |
| Parent wiring | **YES** — `8958cdf` |
| Fork patch required? | **NO** (product pin is a 5-line parent patch, **uncommitted**) |
| BLOCKED_ARCH? | **NO** |
| PC `bmoe-cli` | **YES** — sha `d2672584…`, OpenCL OFF |
| Android OpenCL `bmoe-cli` | **YES** — sha `b8b1c732…` |
| Device | S23; N1/N2/N2b done plugged; N3 waiter ARMED |

Recon notes: `results/k4split/recon_*.md`, `IMPL_NOTES.md`.
`N0_DESIGN_NOTES.md` was not written; those files stand in.

---

## 3. N1 — load + RAM smoke

Kill-gate: RescueParty / MemFree <300 MiB **sustained 60 s** (15 s is a
false kill during the OpenCL convert spike). PLUGGED OK.

| cache-mb | result |
|---|---|
| 2000 | ram-guard **refuse** (need 4538 / avail 3856) |
| 1500 | ram-guard **refuse** (need 4038 / avail 3844) |
| **1000 + `--force-cache`** | **allow** (need 3538 / avail 3830) — config of record |

| cell | ctx | n | load_s | MemFree min (MiB) | sched splits | trunk backend | `ffn_*_exps` backend | hit% | MiB/tok | note |
|---|---:|---:|---:|---:|---:|---|---|---:|---:|---|
| ARM_B c512 (15 s abort) | 512 | 8 | — | 70.3 | — | — | — | — | — | false kill; rc 143 |
| ARM_B c512 retry 60 s | 512 | 8 | 23.076 | 13.7 | 82 | GPUOpenCL | CPU (pin) | 38.5 | 81.76 | PASS; recovered |
| ARM_B sched-debug | 512 | 8 | 24.456 | 68.2 | **82** | GPUOpenCL | CPU (pin) | — | — | `GGML_SCHED_DEBUG=2` |
| ARM_B c4096 | 4096 | 8 | 22.718 | 52.8 | 82 | GPUOpenCL | CPU (pin) | — | — | text `OK` |

`dense-weights=anon` skipped 1330 MiB already on GPU (no host twin) + 333
MiB host `token_embd`. Mechanism B pin visible on every `ffn_*_exps`.
MemAvailable never < ~1 GiB. Device recovered to 2–4 GiB MemFree after
every run. **PASS** — not BLOCKED_RAM.

Verdict: **PASS** at `--cache-mb 1000 --force-cache`.

---

## 4. N2 — correctness

Greedy, temp 0, seed 42, n=32, c=4096, prompt `p_fact.txt`, same binary.
PLUGGED OK. Token-identical required. Hook alive required (stats present;
hit% ±10 pt of ARM_CPU; MiB/tok same ballpark).

| arm | flags (plus k6d065 + cache-1000 `--force-cache`) | text == CPU? | first diverge | hit% | MiB/tok | hook |
|---|---|---|---|---:|---:|---|
| ARM_CPU | `--ngl 0 --fa off --moe-cpu-experts off --dense-weights anon` | (ref) `distinct…` | — | 44.0 | 72.04 | alive |
| ARM_A | `--ngl 99 --fa off --moe-cpu-experts off --dense-weights anon` | **NO** | `distinct` vs `smaller` | 45.0 | 68.89 | alive |
| ARM_B | `--ngl 99 --fa off --moe-cpu-experts on --dense-weights anon` | **NO** (A==B==AUTO) | same | 45.0 | 68.89 | alive |
| ARM_AUTO | `--ngl 99 --fa off --moe-cpu-experts auto --dense-weights anon-gpu` | **NO** | same | 45.0 | 68.89 | alive |
| **ARM_B + pin** | ARM_B + `--override-tensor ffn_gate_inp.weight=CPU` | **YES** (byte-identical) | none | 43.7 | 72.76 | alive |

Unpinned fail is **ROUTER_SELECTION**: GPU `MUL_MAT(ffn_gate_inp)` →
`SOFT_MAX` → `ARGSORT` flips near-tie top-k (256 F32 logits). Pinning the
router weight restores identity; HostAlias goes silent (topk host-backed).
`--route-trace` perturbs tokens — not an identity observer.

Verdict: **FAIL_CORRECTNESS unpinned. PASS with pin.** Config of record
now includes `-ot ffn_gate_inp.weight=CPU` on every `-ngl 99` arm.
Product patch (not applied, not committed):
`results/k4split/n2b/pin_router_gate_inp.patch`.

---

## 5. N3 — speed burst

UNPLUGGED only, batt ≥45 %, start temp ≤35 °C, abort temp 45 °C.
ABBA × `p_fact` / `p_creative`, n=200, cold fadvise per run.
`--cache-mb 1000 --force-cache` (handicaps **both** arms equally vs the
campaign's cache-2000 card: campaign KEXP hit ~79–82 %, N2 at cache-1000
was ~44 %). Split arm carries the router pin.

Gate: split decode median ≥ **1.10×** CPU **or** TTFT ≥ **1.5×** (CPU/split).
CSV: `results/k4split/n3/runs_speed.csv` (pulled to
`results/k4split/runs_speed.csv`).

**Waiter ARMED** 2026-08-13T06:46:19-04:00, pid 21569. First poll:
PLUGGED_AC 100 % 29.5 °C. 6 h window → `ARMED_EXPIRED` if still plugged.

| run | arm | prompt | decode t/s | prefill/TTFT | MiB/tok | hit% | batt% | temp °C |
|---|---|---|---:|---:|---:|---:|---:|---:|
| | | | | | | | | |

Verdict: **ARMED — not yet measured.** Never measure plugged.

---

## 6. N4 — sustained

Only if N3 decode ≥1.10× **or** TTFT ≥1.5×. 15 min ARM_CPU vs 15 min
ARM_SPLIT, UNPLUGGED, cooldown to T0+1 °C between. First segment of each
arm is cold fadvise; later segments stay warm. If N3 fails both gates:
skip, report honestly.

| arm | window | decode t/s | batt / 1k tok | temp °C |
|---|---|---:|---:|---:|
| ARM_CPU first third | | | | |
| ARM_CPU final third | | | | |
| ARM_SPLIT first third | | | | |
| ARM_SPLIT final third | | | | |

Verdict: **armed behind the N3 gate — not yet measured.**

---

## 7. Caveats

- **N3/N4 numbers are not in this file yet.** Waiter is armed; do not
  cite an empty table as a speed result.
- **Never measure plugged.** N1/N2/N2b were load/correctness on AC.
- **`--cache-mb 1000 --force-cache` handicaps both arms** vs the
  campaign cache-2000 card (hit ~79–82 %, decode ~5.3–6.2 t/s). N2 at
  cache-1000 saw ~44 % hit. Same cache on both arms; do not compare
  N3 decode to the campaign card as a split win.
- **Unpinned GPU router is not a product config.** Pin
  `ffn_gate_inp.weight=CPU` is required for token identity.
- **Do not use K2.2b `llama-cli`** (`0b6be132…`) for these arms.
- **FLASH_ATTN is dead on A7X.** Keep `--flash-attn off`.
- **Hook lives only in CPU `mul_mat_id`.** If ARM_A ever places
  `MUL_MAT_ID` on OpenCL, streaming is a lie even when the text looks fine.
- **Adreno buffers are the same DRAM.** Double residency of the 1664 MiB
  trunk is a reboot, not a slowdown. `anon` skipped the GPU twin (N1).
- `--cache-mb 1000` needs `--force-cache` (`cache_min_mb=1500`).
- `token_embd` stays CPU at `-ngl 99` (333 MiB host).
- `HostAlias` copies topk/weights on an unpinned GPU router. With the
  pin, topk is host-backed and HostAlias is silent.
- `predict` / `route-ahead` are off on k6d065.
- Product `build-android.ps1` stays CPU (`GGML_OPENCL=OFF`). The split
  binary is out-of-tree `build-android-opencl-k4split/`.
- Fork branch is local. Campaign policy: **no push**. The 5-line
  `pin_router_gate_inp.patch` stays uncommitted.
- Do not touch Xiaomi or Jelly. Do not kill PC jobs.

## 8. What remains for product

1. N3 unplugged speed (waiter armed). Honest 0.95× is a result; 1.10×
   decode or 1.5× TTFT is the gate.
2. N4 thermal dividend only if the N3 gate passes.
3. Apply (or reject) `n2b/pin_router_gate_inp.patch` as a product
   default so a human does not have to remember `-ot`.
4. Keep Mechanism B as the product default so a future GPU `MUL_MAT_ID`
   cannot silently kill streaming.
5. A cache-2000 split cell is still blocked by ram-guard on this 8 GB
   phone. Product either lives at cache-1000 or needs a denser RAM
   story (drop `token_embd` twin, smaller ubatch, etc.).

---

## N3 — Speed verdict (2026-08-13 morning, S23 unplugged 100%, MemAvailable guard)

ABBA 2 prompts × 4, n=200, cold fadvise, cache-1000 both arms, router pin on split.

| median | ARM_CPU | ARM_SPLIT | ratio |
|---|---:|---:|---:|
| decode t/s | **2.901** | 2.025 | **0.698×** |
| TTFT s | **17.8** | 30.4 | 0.59× (worse) |
| load s | 10.6-11.5 | 22.5-23.7 | ~2× worse |
| prefill t/s | 9.0-10.0 | 8.4-9.6 | ~parity |
| hit% / MiB/tok | 63-68 / 66-74 | 64-67 / 70-73 | ~equal |

Gate (decode ≥1.10× OR TTFT ≥1.5×): **FAIL**. N4 skipped by design.

## Final K4 verdict

- The split is **correct** (byte-identical with router pin) and **mechanically
  proven** — first known 35B flash-streamed MoE with GPU trunk on a phone — but
  on the 740 it is **slower on every axis**: decode 0.70× (A7X GEMV wall), TTFT
  0.59× (dense re-upload doubles cold load; MoE prefill is dominated by CPU
  expert GEMM, so the dense-GPU prefill advantage measured on 2B/4B does NOT
  transfer to the streamed MoE), plus the cache-1000 RAM handicap.
- Assets banked: correctness stack (GDN+split+pin), parent residency kernel,
  `--moe-cpu-experts` product pin, the honest measurement. Speed lane on A7X:
  CLOSED. Plausible revival only on 830+/silicon with real subgroups, or with a
  fused-executor rebuild (months) — both parked pending product need.
