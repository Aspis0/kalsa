STREAMS_BROKEN — campaign pin loads `mellum` (not an unknown-arch gate) then dies in 0 s on `error: no MoE recipe for architecture 'mellum'`. Decode tok/s = N/A. Expert-ready hook never registered. Regime cell not run.

# Mellum2 F1 — S23 on-device: does the arch STREAM with our fork?

**Date:** 2026-08-13
**Device:** Galaxy S23 (Adreno 740, 8 GB) · Termux ssh `u0_a344@192.168.1.152:8022`
**Question:** does vanilla official Q4_K_M stream on the campaign `bmoe-cli` pin, and at what decode/regime?
**Status:** COMPLETE · smoke FAIL (structural) · 0/2 regime reps · UNPLUGGED entire timed window
**SKU context:** F0 on PC was STRONG 15/20 (`reports/moe-mellum2-f0.md`). This F1 is the streaming existence check, not a quality rerun.

This is a **fork wiring gate**, not a model-shape failure and not "mellum unknown to llama.cpp". The campaign binary's llama.cpp already has `LLM_ARCH_MELLUM`. BigMoeOnEdge's recipe table does not. Do not hide that as a generic load crash.

---

## File identity (not guessed)

| id | path | size B | sha256 |
|---|---|---:|---|
| **Mellum2 Q4_K_M** | `~/models/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf` (official JetBrains Instruct) | 8 071 293 600 | `b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7` |
| **Binary** | `~/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN` | 402 416 | `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f` |
| Fact prompt | `results/mellum2_f1_s23/p_fact.txt` | — | `b5301c32c0bd8aae4cf5c25d667a52eef05b940a459a2e9c82b1b6134cf0dcbd` |

Local PC GGUF size = device size. Device `sha256sum` after scp matches the F0 pin. Campaign binary sha matches `results/marcokexp/speed_s23_1c/bin.sha256`. Binary was **not** rebuilt and **not** overwritten.

`/data` before push: 13 G free. After: 5.3 G. Nothing else deleted.

---

## Protocol (what actually ran)

Intended campaign-family flags (smoke + planned regime):

`-t 4 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 8 --temp 0 --chatml --no-think`

- Native k=8 (model `mellum.expert_used_count=8`). **No k-cut, no `--drop-cold-experts`.**
- Smoke: prompt `Say OK.`, `-n 8`.
- Regime (not reached): 2 cold reps, `p_fact` (same bytes as Marco 1c), `-n 200`, `~/bin/cold_model.sh` fadvise.
- UNPLUGGED, batt floor 45%, battery-temp abort 45 °C.
- MemAvailable guard (NOT MemFree): abort `< 300 MiB` sustained 60 s. Never reached a timed cell.

Battery at smoke: **UNPLUGGED 75%, 27.4 °C**. MemAvailable start: **4 139 196 KiB** (~3.95 GiB). MemFree at that moment was 190 MiB — page cache, not a RAM crisis. Guard would have used MemAvailable.

---

## Step 1 — arch smoke

| question | result | evidence |
|---|---|---|
| **a. Does `mellum` load on the campaign binary?** | **YES** | `print_info: arch = mellum`; `general.architecture = mellum`; 339 tensors created through `blk.27.ffn_*_exps`; `n_expert=64` `n_expert_used=8`; `n_swa=1024` `is_swa_any=1`. **Not** `unknown model architecture`. |
| **b. Does the expert-ready hook fire?** | **NO** | No `bmoe: expert streaming ON`. No `bmoe: expert-mmap: dropped`. No `bmoe: dense-weights=anon`. Process exits **before** `ExpertStreamSource::init`. |
| **c. RSS / MemAvailable sane?** | **YES, but uninformative** | Peak sampled RSS **19.4 MiB**, wall **0 s**, rc=1. Died at recipe lookup after tensor metadata, before mmap of the 7 693.96 MiB CPU_Mapped buffer could become a working set. MemAvailable stayed ~4.1 GiB. |

Exact fatal line (`smoke/combo.txt` last line, also `smoke/tail.txt:120`):

```
error: no MoE recipe for architecture 'mellum' — add one in core/src/moe/arch_registry.cpp (see docs/adding-a-model.md)
```

On-device `~/src/BigMoeOnEdge/core/src/moe/arch_registry.cpp` has **no** `mellum` row. Registered arches on this tree:

`qwen3moe`, `qwen2moe`, `qwen35moe`, `gemma4`, `gpt-oss`, `lfm2moe`, `deepseek4`.

Loaded expert tensor names on this GGUF are the **standard split trio** the registry already knows how to stream:

`blk.*.ffn_gate_exps.weight` / `ffn_up_exps.weight` / `ffn_down_exps.weight` (28 layers × 64 experts).

So the missing piece is a one-row recipe, same shape as `qwen3moe`:

```cpp
{"mellum", {"ffn_gate_exps", "ffn_up_exps", "ffn_down_exps"}},
```

That is a **new binary**, not a patch of `bmoe-cli.CAMPAIGN`. This F1 does not ship that binary.

### What this is not

- Not "llama.cpp does not know mellum" — it does; F0 already loaded it on PC `llama-cli`, and this pin prints `arch = mellum`.
- Not a silent full-mmap fallback. `--moe-stream` **fails fast** when `find_moe_recipe()` returns null. Good: no fake tok/s from a 7.5 GiB mmap on 8 GB.
- Not an OOM. RSS 19 MiB, MemAvailable 4 GiB.
- Not a reason to run the regime cell on this pin. There is no streaming path to measure.

---

## Step 2 — regime cell (the number)

**Not run.** Smoke is a hard stop. Inventing tok/s from PC F0 (24.2 idle / ~10 contended) or from the house pre-F1 model would contaminate the KEXP GO/NO-GO calibration.

| cell | decode tok/s | MiB/tok | hit% | TTFT s | load s | prefill s | RSS MiB | n |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **Mellum2 Q4 k=8 stream (this pin)** | — | — | — | — | — | — | 19.4 (smoke abort) | 0 |
| MarcoKEXP-1c (same device, same flag family, k=6 d0.65) | **8.819** | **51.50** | **53.45** | 9.15 | 4.56 | — | — | 4 |
| CalaQwen KEXP 35B (same device, context) | **5.696** | **30.7** | **80.7** | 18.98 | — | — | — | — |
| Marco-Q4KM A2 (same session as 1c) | 5.442 | 126.21 | 36.65 | 12.88 | 6.47 | — | — | 4 |

CSV: `results/mellum2_f1_s23/runs_regime.csv` (header only). Per-rep battery/temp: smoke only, 75% / 27.4 °C, no decode.

---

## Step 3 — one honest KEXP projection

No on-device MiB/tok or hit% was measured, so this is **still the pre-F1 house geometry**, not a recalibration. Assumptions (same as `reports/research-mellum2.md` §6): expert FFN is SwiGLU 3-mat, no shared expert, no dense FFN layers; KEXP cuts **experts only** to 2.5–3.0 bpw (mid 2.75) while dense stays ~4.5 bpw; scale CalaQwen's measured 30.7 MiB/tok by the routed-expert-param ratio (Mellum2 k=8 / Cala k=6 ≈ 1.84×); S23 streaming bandwidth ~454 MiB/s (Marco), not DRAM. That still says KEXP k=8 ≈ **56 MiB/tok → ~7.5–8.8 tok/s**, vanilla Q4 k=8 ≈ **92 MiB/tok → ~4.5–6 tok/s**, KEXP file **~4.1–4.8 GB**. None of those numbers were observed today. The one new on-device fact is that the **tensor names match the existing split recipe**, so once a `mellum` row exists the streamer *should* bind; SWA (1024, 3:1) is llama.cpp-side and already printed (`n_swa=1024`). Residual risk: the mellum graph might not hit `ffn_moe_topk` / the expert-ready hook the same way as qwen3moe — that is the first thing a post-recipe smoke has to prove, not something this paragraph can promise.

---

## Next-gate recommendation

1. **Add the one-row recipe** in `core/src/moe/arch_registry.cpp`. Rebuild a **new labeled binary** (e.g. `bmoe-cli.MELLUM`). Do **not** overwrite `bmoe-cli.CAMPAIGN`.
2. Re-run this exact F1 on S23: smoke first (`expert streaming ON` + `expert-mmap: dropped` + `moe-cache:` after `-n 8`), then 2 cold reps n=200 on `p_fact`. Those two reps are the missing calibration cells.
3. Only after a real MiB/tok + hit% : refresh the KEXP band. k/drop grid is still a later phase.
4. **Do not** treat F1 as a KEXP GO. F0 quality is still STRONG. F1 says "this pin cannot stream mellum". That is a one-commit fork gap, not a SKU kill — but until the recipe binary exists, S23 decode is unknown and the house 4.5–8.8 tok/s band remains a paper number.

Artifacts: `results/mellum2_f1_s23/` (smoke logs + cmdline + shas + header CSV + `run_f1_s23.sh` + `F1.master.log`).

---

## F1b — recipe row + labeled binary

**STREAMS_OK decode 2.94 t/s** (median of 2 unplugged cold reps; 185.0 MiB/tok, 76.0% hit).

**Date:** 2026-08-13  
**Branch / commit:** `kalsa/mellum-recipe` `d98702747593e169f5b05fade8af661894fe86f3`  
**Binary:** `~/bin/bmoe-cli-mellum` → `~/bin/mellum/bmoe-cli` sha `69a35f5ef85e286a1d05069872a3ae75b9a8c66d4098695936a5baf4b4d61b8a`  
**Campaign pin:** `bmoe-cli.CAMPAIGN` still `1ca51420…` (not overwritten; `~/bin/bmoe-cli` still absent).  
**Build:** NDK r27.1 (`27.1.12297006`) · API 29 · `GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+i8mm+fp16` · `HAVE_DOTPROD=1` · `HAVE_MATMUL_INT8=1` · `-j 4`  
**GGUF dump (PC):** `general.architecture=mellum` · 28 layers · 64 experts · k=8 · `ffn_{gate,up,down}_exps` ×28 · router `ffn_gate_inp` ×28 · **no** `expert_shared_count` · **0** `shexp` tensors.

Recipe row (qwen3moe class, no shared-expert wiring):

```cpp
{"mellum", {"ffn_gate_exps", "ffn_up_exps", "ffn_down_exps"}},
```

`--list-archs` on the labeled binary prints `mellum` last.

### Smoke (may be plugged; was UNPLUGGED 72% / 25.2 °C, nproc=8)

| gate | result | evidence |
|---|---|---|
| loads `mellum` | **YES** | `print_info: arch = mellum` |
| expert-ready / streaming | **YES** | `bmoe: expert streaming ON  n_expert=64 … cache=2000` · `expert-mmap: dropped 7055 MiB` · `dense-weights=anon — 637 MiB` |
| silent mmap fallback | **NO** | hook fired; expert mmap dropped |
| RSS / MemAvailable | **sane** | smoke peak RSS **2779 MiB**; MemAvailable 4052→5059 MiB (mmap drop, not a leak). Guard is MemAvailable 300 MiB / 60 s — never tripped |
| output sanity (~32 tok, coding) | **PASS** | greedy `factorial` loop: `def factorial(n): result=1; for i in range(1,n+1): result*=i` — coherent, matches PC F0 class |

Smoke `-n 8`: 2.635 tok/s, 222.8 MiB/tok, 51.4% hit. Sanity `-n 32`: 2.613 tok/s, 232.7 MiB/tok, 62.7% hit.

### Regime cell (UNPLUGGED, floor 45%, abort 45 °C)

Ran. Not plugged. Cold `fadvise` both reps. `p_fact` sha `b5301c32…`. `-t 4 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 8`. nproc=6 at regime start (smoke had 8). n_gen=**166** both (EOS, not a hang).

| cell | decode tok/s | MiB/tok | hit% | TTFT s | load s | prefill s | RSS MiB | n | batt | temp °C |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| **Mellum2 Q4 k=8 r1** | 2.975 | 185.04 | 76.0 | 11.634 | 5.936 | 5.699 | 2952.9 | 166 | 72→71 UNPLUGGED | 27.7→28.3 |
| **Mellum2 Q4 k=8 r2** | 2.912 | 185.04 | 76.0 | 11.682 | 5.856 | 5.826 | 2974.9 | 166 | 71→71 UNPLUGGED | 28.3→30.4 |
| **Mellum2 Q4 k=8 median** | **2.944** | **185.0** | **76.0** | 11.66 | 5.90 | 5.76 | 2964 | 166 | 72→71 | peak 30.4 |
| Marco1c (k6d065) | **8.819** | **51.5** | **53.5** | 9.15 | 4.56 | — | — | — | — | — |
| CalaQwen KEXP 35B | **5.696** | **30.7** | **80.7** | 18.98 | — | — | — | — | — | — |

Instrumented decode split (r1): compute 0.224 + cache 0.018 + flash I/O 0.436 s/tok, **424 MiB/s** flash. Wall 0.336 s/tok because lanes overlap. Compute ceiling at this k/quant ≈ **4.5 tok/s**. Flash-bound today.

### KEXP projection (anchored on the measured cell)

Replace the F1 paper band (92 MiB/tok → 4.5–6 t/s Q4; 56 → 7.5–8.8 KEXP).

**Measured Q4 k=8 is 185 MiB/tok, not 92.** Cross-check: 28×8×(3×2304×896)×4.5/8 B ≈ 780 MiB full expert traffic; 780×(1−0.76) ≈ 187 ≈ **185**. So MiB/tok is **flash misses**, hit 76% is real, and the Cala-scaled 92 was ~2× too optimistic.

Assumptions (house method, experts-only bpw cut):

1. KEXP cuts **routed experts only** to 2.5–3.0 bpw (mid **2.75**); dense stays ~4.5 bpw (already anon-resident, 637 MiB, not in MiB/tok).
2. No shared expert, no dense FFN layers (GGUF + research-mellum2.md).
3. Flash rate stays the measured **~424 MiB/s** (this cell), not 20 GB/s DRAM. Overlap stays.
4. Q2/Q3 GEMM is **not** assumed faster than Q4_K; the 0.224 s/tok compute is a ceiling, not a floor.
5. Hit may rise because the k=8 working set shrinks (780 → ~477 MiB vs 2000 MiB cache). Conservative case holds hit at 76%.

| variant | MiB/tok | decode | note |
|---|---:|---:|---|
| **Q4 k=8 measured** | **185** | **2.94 t/s** | this cell |
| KEXP k=8, hit held 76% | 185×(2.75/4.5) ≈ **113** | **~3.5 t/s** | still flash-ish: 113/424 |
| KEXP k=8, miss scales with expert bytes | ~70 | **~4.5 t/s** | flash drops below compute 0.224 s; hits the Q4 compute ceiling |
| KEXP file size (geometry, unchanged) | — | — | **4.1–4.8 GB** |

**KEXP k=8 does not clear 10 tok/s on this measurement.** It mostly pays down flash until the **4.5 t/s compute wall** at native k=8. A later k/drop grid (k=6 / drop-cold) is what would move the compute term; that is not this cell.

Artifacts: `results/mellum2_f1_s23/f1b/` (CSV, master log, smoke/sanity/regime logs, mem samples, `build.txt`). F1 files left in place.

---

## F1c — runtime k/drop grid

**SPEED RECON ONLY. Quality at cut k is UNGATED.** These cells are not product cells. The PPL gate (PC, Fase-1 protocol) is required before any of k=6 / k=4 / k=2 / k=2+d0.65 becomes a product cell. **PC is busy today; that gate queues behind selfspec.** Do not read coherent k=6/k=4 English on `p_fact` as a pass, and do not read k=2 garbage as a kill. Neither is a PPL number.

**Date:** 2026-08-13  
**Binary:** `~/bin/bmoe-cli-mellum` → `~/bin/mellum/bmoe-cli` sha `69a35f5ef85e286a1d05069872a3ae75b9a8c66d4098695936a5baf4b4d61b8a` (verified on device, same pin as F1b). Campaign pin not touched.  
**Model:** `Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf` size `8071293600` sha `b04281c2…` (size + F1b sha file).  
**Prompt:** `p_fact` sha `b5301c32…` (byte match F1b).  
**Flags:** `-t 4 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --temp 0 --chatml --no-think` + `--n-expert-used {k}` (+ `--drop-cold-experts 0.65` on the last cell). Cold `fadvise` every rep. n=200.  
**Regime:** UNPLUGGED entire window, floor 45%, temp abort 45 °C. Start **70% / 27.3 °C**, end **67% / 32.4 °C**. nproc=6. Never tripped batt/thermal/RAM. Jelly and Xiaomi not touched. No PC compute.

Drop is an **I/O-only** lever (house rule: never skips matmul). Best-k by mean decode tok/s of cells 1–3 was **k=2**, so the drop cell is k=2 + 0.65.

### Full table (k=8 F1b included)

Medians are the mean of the two cold reps (same house rule as F1b). Split times are s/token from `moe-stream`.

| cell | decode tok/s | MiB/tok | hit% | TTFT s | load s | prefill s | RSS MiB | n | compute | flash I/O | flash MiB/s | batt | temp °C |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| **Q4 k=8 r1** (F1b) | 2.975 | 185.04 | 76.0 | 11.634 | 5.936 | 5.699 | 2952.9 | 166 | 0.224 | 0.436 | 424 | 72→71 | 27.7→28.3 |
| **Q4 k=8 r2** (F1b) | 2.912 | 185.04 | 76.0 | 11.682 | 5.856 | 5.826 | 2974.9 | 166 | — | — | — | 71→71 | 28.3→30.4 |
| **Q4 k=8 median** | **2.944** | **185.0** | **76.0** | 11.66 | 5.90 | 5.76 | 2964 | 166 | 0.224 | 0.436 | 424 | 72→71 | peak 30.4 |
| **Q4 k=6 r1** | 3.794 | 112.07 | 79.4 | 11.124 | 5.571 | 5.553 | 2935.9 | 178 | 0.183 | 0.276 | 406 | 70→70 | 27.3→28.5 |
| **Q4 k=6 r2** | 3.722 | 112.07 | 79.4 | 11.273 | 5.560 | 5.713 | 2943.0 | 178 | 0.185 | 0.278 | 404 | 70→69 | 28.5→30.8 |
| **Q4 k=6 median** | **3.758** | **112.1** | **79.4** | 11.20 | 5.57 | 5.63 | 2939 | 178 | 0.184 | 0.277 | 405 | 70→69 | peak 30.8 |
| **Q4 k=4 r1** | 4.692 | 71.94 | 79.0 | 10.375 | 5.076 | 5.299 | 2932.0 | 183 | 0.150 | 0.186 | 387 | 69→69 | 30.8→31.0 |
| **Q4 k=4 r2** | 4.741 | 71.94 | 79.0 | 10.492 | 5.321 | 5.171 | 2951.3 | 183 | 0.148 | 0.185 | 389 | 69→69 | 31.0→30.7 |
| **Q4 k=4 median** | **4.717** | **71.9** | **79.0** | 10.43 | 5.20 | 5.24 | 2942 | 183 | 0.149 | 0.186 | 388 | 69→69 | peak 31.0 |
| **Q4 k=2 r1** | 5.750 | 55.51 | 68.5 | 9.226 | 4.413 | 4.813 | 2927.4 | 200 | 0.118 | 0.143 | 389 | 69→68 | 30.7→31.4 |
| **Q4 k=2 r2** | 5.608 | 55.51 | 68.5 | 8.940 | 4.071 | 4.869 | 2959.4 | 200 | 0.119 | 0.152 | 366 | 68→68 | 31.4→31.4 |
| **Q4 k=2 median** | **5.679** | **55.5** | **68.5** | 9.08 | 4.24 | 4.84 | 2943 | 200 | 0.119 | 0.148 | 378 | 69→68 | peak 31.4 |
| **Q4 k=2 d0.65 r1** | 5.356 | 47.92 | 71.3 | 9.191 | 4.311 | 4.880 | 2958.7 | 200 | 0.133 | 0.134 | 357 | 68→68 | 31.4→31.4 |
| **Q4 k=2 d0.65 r2** | 5.350 | 47.92 | 71.3 | 9.400 | 4.615 | 4.784 | 2959.1 | 200 | 0.133 | 0.135 | 355 | 68→67 | 31.4→32.4 |
| **Q4 k=2 d0.65 median** | **5.353** | **47.9** | **71.3** | 9.30 | 4.46 | 4.83 | 2959 | 200 | 0.133 | 0.135 | 356 | 68→67 | peak 32.4 |

CSV: `results/mellum2_f1_s23/f1c/runs_regime.csv`. All eight F1c reps rc=0, cold=1, UNPLUGGED. Drop log on r1: `moe-drop: 133/11200 routed experts dropped (1.2%), threshold 0.65 x uniform`.

**Best speed cell: k=2, 5.679 t/s, 55.5 MiB/tok, 68.5% hit.** Drop on that k did **not** buy tok/s.

### Honest curve

| k | tok/s | vs k=8 | MiB/tok | vs k=8 | hit% | n_gen |
|---:|---:|---:|---:|---:|---:|---:|
| 8 | 2.944 | 1.00× | 185.0 | 1.00× | 76.0 | 166 (EOS) |
| 6 | 3.758 | 1.28× | 112.1 | 0.61× | 79.4 | 178 (EOS) |
| 4 | 4.717 | 1.60× | 71.9 | 0.39× | 79.0 | 183 (EOS) |
| 2 | 5.679 | 1.93× | 55.5 | 0.30× | 68.5 | 200 (n limit) |
| 2+d0.65 | 5.353 | 1.82× | 47.9 | 0.26× | 71.3 | 200 (n limit) |

tok/s vs k is **monotonic and roughly 1/√k-ish, not 8/k**. Cutting k from 8→2 almost doubles decode (2.94 → 5.68) but does not quadruple it. MiB/tok falls faster than k at 8→6→4 (hit rises 76 → 79) then **slows** at k=2 because hit drops to 68.5% — the working-set win is eaten by worse reuse. Linear 2/8 × 185 would be 46 MiB/tok; we measured 55.5.

Cross-check (same geometry as F1b: 28 × k × 3 × 2304 × 896 × 4.5/8 B full expert traffic, times miss):

- k=6: 585 × (1−0.794) ≈ 121 vs measured **112**
- k=4: 390 × (1−0.790) ≈ 82 vs measured **72**
- k=2: 195 × (1−0.685) ≈ 61 vs measured **55.5**

Directionally right; measured is ~10% below the back-of-envelope (same bias as F1b 187 vs 185). Not a new mystery.

n_gen is not constant (166 / 178 / 183 / 200). tok/s is still per-token so the curve is comparable; do not over-read the extra tokens at k=2 as “more work” in the decode rate.

### Where it goes compute-bound

It **does not**, on this grid, except the drop cell which **ties**.

| cell | compute s/tok | flash s/tok | flash/compute | 1/compute ceiling | bound |
|---|---:|---:|---:|---:|---|
| k=8 | 0.224 | 0.436 | 1.95× | **4.46 t/s** | flash |
| k=6 | 0.184 | 0.277 | 1.51× | **5.43 t/s** | flash |
| k=4 | 0.149 | 0.186 | 1.25× | **6.71 t/s** | flash (closing) |
| k=2 | 0.119 | 0.148 | 1.24× | **8.44 t/s** | flash (closing) |
| k=2 d0.65 | 0.133 | 0.135 | 1.02× | **7.52 t/s** | **tied** |

k-cut moves the compute term almost linearly (0.224 → 0.184 → 0.149 → 0.119 ≈ ×k/8). Flash falls faster at first, then tracks compute. Overlap stall 0.094 → 0.050 s/tok. Flash bandwidth this session **356–406 MiB/s** (F1b k=8 was 424).

`--drop-cold-experts 0.65` at k=2: I/O did what the lever says (55.5 → 47.9 MiB/tok, hit 68.5 → 71.3, flash 0.148 → 0.135) but **compute rose** 0.119 → 0.133. Wall got worse (5.68 → 5.35 t/s). Drop rate was only **1.2%** of routed experts (uniform at k=2 is 0.50; threshold 0.65×uniform = 0.325 — few experts are that cold). The I/O-only rule held in the log (`moe-drop` + flash bytes down); it did not pay tok/s because the cell was already near the compute wall and the drop-aware path added 0.014 s/tok of compute. Do not adopt drop on this SKU from this cell.

### KEXP + k projection (updated)

Same house method as F1b: KEXP cuts **routed experts only** to 2.5–3.0 bpw (mid **2.75**); dense stays ~4.5 bpw and is already anon-resident (not in MiB/tok); no shared expert; flash stays the measured ~360–400 MiB/s, not DRAM; **Q2/Q3 GEMM is not assumed faster than the Q4_K compute column**. Conservative case holds hit%. Optimistic case: miss scales with expert bytes and flash falls under compute.

| variant | MiB/tok | decode | note |
|---|---:|---:|---|
| **Q4 k=8 measured** | **185** | **2.94 t/s** | F1b |
| **Q4 k=6 measured** | **112** | **3.76 t/s** | this grid |
| **Q4 k=4 measured** | **72** | **4.72 t/s** | this grid |
| **Q4 k=2 measured** | **55.5** | **5.68 t/s** | this grid; best speed |
| KEXP k=8, hit held 76% | 185×(2.75/4.5) ≈ **113** | **~3.5 t/s** | F1b; still flash-ish |
| KEXP k=8, miss scales | ~70 | **~4.5 t/s** | F1b Q4 compute wall at k=8 |
| KEXP k=6, hit held 79% | 112×(2.75/4.5) ≈ **68** | **~5.4 t/s** | flash 68/400 < compute 0.184; hits k=6 ceiling |
| KEXP k=4, hit held 79% | 72×(2.75/4.5) ≈ **44** | **~6.7 t/s** | hits k=4 ceiling |
| KEXP k=2, hit held 68.5% | 55.5×(2.75/4.5) ≈ **34** | **~8.4 t/s** | hits k=2 ceiling |
| KEXP file size (geometry) | — | — | **4.1–4.8 GB** (unchanged) |

**Band after F1c: KEXP+k ≈ 3.5 (k=8 conservative) to ~8.4 t/s (k=2, compute-limited).** Nothing in this measurement clears 10 tok/s. k-cut on vanilla Q4 already buys more than KEXP at native k=8 (5.68 vs 3.5–4.5). Combining them mostly pays the remaining flash at that k until the Q4 compute wall; if Q2/Q3 GEMM is *slower*, the wall is lower.

### Quality — UNGATED (read this twice)

- **No PPL, no Fase-1 gate, no product claim.** Speed only.
- Informal decode text on this one `p_fact` prompt (not a metric): k=8 (F1b) and k=6 / k=4 still emitted a coherent MoE paragraph; k=2 and k=2+d0.65 collapsed to garbage and hit the 200-token cap. That is an anecdote. It is **not** a PPL number and it does **not** license k=4 as a product k.
- The PPL gate lives on **PC**, Fase-1 protocol. **PC is busy today. The gate queues behind selfspec.** Until that gate runs, every cut-k cell in this section is a speed recon cell.

Artifacts: `results/mellum2_f1_s23/f1c/` (CSV, master log, 8× logs + mem samples, `bin.sha256`, `best_k.txt`, `STATUS.txt=DONE`). Script: `results/mellum2_f1_s23/run_f1c_s23.sh`. F1 / F1b files left in place.
