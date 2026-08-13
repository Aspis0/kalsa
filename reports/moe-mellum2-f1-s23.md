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
