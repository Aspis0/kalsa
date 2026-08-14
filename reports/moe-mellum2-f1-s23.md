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

## F1d — ceiling forensics

**CEILING_REAL(mul_mat_id). Corrected compute 0.228 s/tok → ceiling 4.39 t/s. KEXP k=8 band 3.5–4.4 t/s (85% hit hits the wall).**

**Date:** 2026-08-13  
**Waited for F1c:** yes (STATUS=DONE, no bmoe left, then launched). Jelly/Xiaomi untouched. Campaign pin untouched.  
**Binary:** `~/bin/bmoe-cli-mellum2` → `~/bin/mellum2/bmoe-cli` sha `0ac612def6b82586d695bfb11acf42cce23bd99fc4ccd3aeddb51a0cd15cf93c`  
**Campaign pin:** still `1ca51420476d4a…`  
**F1b pin:** still `69a35f5ef85e28…` (not reused)

### Suspect 1 — build flags. Rebuilt. Did not move the ceiling.

F1b was **not** campaign-identical.

| | F1b `bmoe-cli-mellum` | Campaign script (`build-android.ps1` / `build_bmoe_ndk.sh`) | F1d rebuild |
|---|---|---|---|
| `GGML_CPU_ARM_ARCH` | `armv8.2-a+dotprod+i8mm+fp16` | `armv8.2-a+dotprod+fp16` | `armv8.2-a+dotprod+fp16` |
| `HAVE_MATMUL_INT8` | **1** | (no i8mm → fail) | **Failed** |
| `GGML_CPU_REPACK` | ON | ON (unset, cmake default) | ON |
| `libggml-cpu.so` | 5 119 344 B | — | 5 006 968 B |

The `+i8mm` bit is exactly the `moe-cpu-build-gap.md` thief (REPACK ON converts Q4_K → `q4_K_8x8_q8_K` only when `ggml_cpu_has_matmul_int8()` is 1). Rebuild used campaign-identical flags, mellum recipe row only extra, `-j 4`, new tree `build-android-mellum2`. No strip (campaign PS1 does not strip; `bmoe-cli` is a 6.3 MB dynamic binary, not the 125 MB llama-bench case). Installed as `~/bin/bmoe-cli-mellum2`. Campaign pin never written.

### Suspect 2 — cores / cpuset. Documented, not the 2× hole.

`cpu/online` was **0-7 the entire window**. `nproc=6` (F1b regime, F1c, F1d start) is `sched_getaffinity` of the **shell** (mask `0x5f` = cpus 0,1,2,3,4,6). `nproc --all` and `getconf _NPROCESSORS_ONLN` both return 8. `/proc/self/status Cpus_allowed_list=0-7`. Not two CPUs offline, not a Termux cpuset cgroup.

Workaround used: `termux-wake-lock` + `screen_off_timeout=7200000` (same as F1c). It does **not** restore `nproc=8`. The CLI's own mask flaps (`3f`/`5f`/`ff`); `Cpus_allowed_list` of the CLI stays `0-7`.

1 Hz placement (`results/mellum2_f1_s23/f1d/forensics/cpu_1hz.csv`, 290 samples):

| cell | little 0-2 | X3 (cpu7) | CLI mask |
|---|---:|---:|---|
| A dense 2B | **2.9%** | **58.8%** | mostly `ff` |
| B mellum k=8 unpinned | **73.9%** | **0.8%** | flaps `5f`/`3f`/`ff` |
| C mellum pin 3-7 | **0%** | 10.0% | `f8` as requested |

WALT parks the 64-tiny-expert `mul_mat_id` kernels on A510s. Dense GEMV sits on the X3. That is the geometry talking to the scheduler, not a background-restriction bug.

### Suspect 3 — calibration cell. Build is healthy.

Same binary, same session, UNPLUGGED, `-t 4`, n=200, no `--moe-stream` (dense `qwen35` has no recipe; that flag would fail-fast).

| cell | decode tok/s | n_gen | RSS MiB | batt | temp °C |
|---|---:|---:|---:|---|---|
| **A dense 2B r1** | **15.938** | 189 | 1536 | 67→66 | 28.7→29.1 |
| **A dense 2B r2** | **15.495** | 189 | 1536 | 66→66 | 29.1→29.9 |
| **A median** | **15.72** | 189 | 1536 | 67→66 | peak 29.9 |

Known band is well above 10; llama-bench cpufix was 18.19. 15.7 on `bmoe-cli` is in-band. **If the rebuild had tanked Q4_K GEMV, A would be ~12.** It is not. The 4.4 t/s mellum number is not "this binary cannot compute".

### Cells B / C (UNPLUGGED, floor 45%, cold fadvise, campaign flags as F1b)

| cell | decode | MiB/tok | hit% | compute s/tok | flash s/tok | flash MiB/s | nproc | CLI cpus | batt | temp |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| **B k=8 r1** | 2.905 | 183.14 | 76.8 | **0.227** | 0.436 | 420 | 7 | 0-7 | 66→65 | 29.9→32.1 |
| **B k=8 r2** | 2.922 | 183.14 | 76.8 | **0.228** | 0.433 | 423 | 7 | 0-7 | 65→65 | 32.1→33.3 |
| **B median** | **2.914** | **183.1** | **76.8** | **0.228** | 0.434 | 422 | 7 | 0-7 | 66→65 | peak 33.3 |
| F1b k=8 median | 2.944 | 185.0 | 76.0 | 0.224 | 0.436 | 424 | 6 | — | 72→71 | 30.4 |
| **C t=5 pin 3-7 r1** | 2.059 | 183.14 | 76.8 | **0.362** | 0.467 | 392 | 6 | 3-7 | 65→63 | 33.3→36.1 |
| **C t=5 pin 3-7 r2** | 2.232 | 183.14 | 76.8 | **0.332** | 0.450 | 407 | 6 | 3-7 | 63→62 | 36.1→37.1 |

Only five performance cores exist (3-7). C used `-t 5` on `taskset -c 3-7` rather than `-t 6` (that would require a little). Pin landed. Compute **got worse** (0.228 → 0.35): 5 compute threads + 4 I/O threads on 5 cores. More / better-placed compute does not raise tok/s. Flash 0.43 s/tok still dominates; the cell is I/O-bound at k=8. The interesting number — recomputed compute s/tok — moved the **wrong** way.

Exact B r1 split:

```
generation: 200 tokens, 0.344 s/token (2.905 tok/s)
moe-stream: read 36627.2 MiB (183.14 MiB/token), decode 0.344 s/token (compute 0.227 + cache mgmt 0.018 + flash I/O 0.436 s/token, 420 MiB/s)
moe-cache: 76.8% hit, resident 1997.4 MiB
```

### Verdict

**CEILING_REAL(mul_mat_id)**

| suspect | result |
|---|---|
| CEILING_WAS_BUILD | **REFUTED.** Dropping `+i8mm` (HAVE_MATMUL_INT8 Failed) left compute at 0.228 vs F1b 0.224. Dense 2B 15.7 t/s. |
| CEILING_WAS_CPUSET | **NOT the 2× hole.** `nproc=6` is a 6-bit affinity mask, not offline cores. 74% of unpinned mellum threads sit on littles — real, and it is how this 64-expert workload is scheduled. Forcing bigs did not raise the ceiling. |
| CEILING_REAL(mul_mat_id) | **CONFIRMED.** 64 experts × (3 × 2304 × 896) Q4_K `mul_mat_id` on this stack computes at **0.228 s/tok (4.39 t/s)** even on a campaign-flag binary that runs dense 2B at 15.7. Marco1c 8.8 t/s all-in is fewer, larger experts, not a 2.5B-active GEMV. F1c on the *old* binary already showed the shape: k=8 compute 0.224 → k=4 0.149 → k=2 0.118 (ceiling 8.5). Cutting k is what moves compute. |

F1b's 4.5 t/s was not a measurement error. The anomaly was the comparison (2.5B-active ≠ dense 2.5B).

### Corrected compute + KEXP band

Compute s/tok at native k=8 Q4, campaign flags, clean counters: **0.228** (median of 2). Ceiling **1/0.228 = 4.39 t/s**. Flash 422 MiB/s. Full expert traffic 183.14 / (1−0.768) ≈ **789 MiB/tok** (same geometry check as F1b).

Assumptions unchanged: KEXP cuts routed experts only to mid 2.75 bpw; dense stays ~4.5 / anon-resident; Q2/Q3 GEMM not assumed faster; flash stays ~422 MiB/s.

Hit **should rise** as the k=8 working set shrinks (789 → ~482 MiB vs 2000 MiB cache), same direction as Marco 36.7 → 53.5.

| variant | MiB/tok | decode | note |
|---|---:|---:|---|
| **Q4 k=8 measured (F1d B)** | **183** | **2.91 t/s** | compute 0.228, flash-bound |
| KEXP k=8, hit held 76.8% | 183×(2.75/4.5) ≈ **112** | **~3.5 t/s** | flash 112/422 = 0.265 > compute |
| **KEXP k=8, 85% hit** | 482×0.15 ≈ **72** | **~4.4 t/s** | flash 0.172 < compute 0.228; **hits the Q4 compute wall** |
| KEXP file size | — | — | **4.1–4.8 GB** (unchanged) |

**KEXP k=8 still does not clear 10 tok/s.** Paying down flash (hit 76.8 → 85, or Q4 → 2.75 bpw) lands on the **4.4 t/s `mul_mat_id` wall**. The lever is k/drop (F1c: k=2 already 5.7 t/s all-in, compute ceiling 8.5), not a rebuild.

Artifacts: `results/mellum2_f1_s23/f1d/` (CSV, 1 Hz forensics, topology, shas, per-rep logs, `build.txt`, `build_pc.log`). Campaign pin verified after install and after the run.

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

---

## F1e — drop live-zone + two-wave

**Best cell: k=6 d1.0 = 4.638 t/s LIVE (+23% vs F1c k=6). drop 0.75 LIVE weak@k6 / LIVE@k8. two-wave NULL. Still no 10 t/s.**

**Date:** 2026-08-13  
**Waited for F1d:** yes (ceiling is `mul_mat_id`, campaign-flag binary already on device). Jelly/Xiaomi untouched. Campaign pin untouched. No PC compute.  
**Binary:** `~/bin/bmoe-cli-mellum2` → `~/bin/mellum2/bmoe-cli` sha `0ac612def6b82586d695bfb11acf42cce23bd99fc4ccd3aeddb51a0cd15cf93c` (verified on device before and after).  
**Campaign pin:** still `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f`.  
**Model:** `b04281c2…` size `8071293600`. Prompt `p_fact` sha `b5301c32…`.  
**Flags:** F1b family (`-t 4 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --temp 0 --chatml --no-think`) + the single delta. Cold `fadvise` every rep. n=200. 2 reps.  
**Regime:** UNPLUGGED entire window, floor 45%, temp abort 45 °C. Start **62% / 30.4 °C**, end **58% / 34.4 °C**. nproc=6, `Cpus_allowed=ff`, CLI `Cpus_allowed_list=0-7`, `cpu/online=0-7` every rep (top-app / wake-lock; `settings` is permission-denied from this uid). Never tripped batt/thermal/RAM. Cell 4 gate was batt≥50 after cell 3 (had 59%) — ran.

SPEED RECON ONLY. Drop is I/O-only (never skips matmul). Quality at drop 0.75 / 1.0 is **UNGATED** — same rule as F1c k-cut.

### Why these two levers

F1c drop 0.65 at k=2 **lost** tok/s (5.679 → 5.353) with only 1.2% routings dropped. Qwen table (`docs/expert-dropping.md:47–56`) says F=0.65–0.50 can be the dead zone and **0.75 / 1.0 the live zone**. `--io-two-wave` was the only shipping overlap tweak never A/B'd (tuning matrix §3). Both are free flags.

### Full table (controls included)

Medians are the mean of the two cold reps (same house rule as F1b/F1c). Split times are s/token from `moe-stream`.

| cell | decode tok/s | MiB/tok | hit% | drop % | TTFT s | load s | prefill s | RSS MiB | n | compute | flash I/O | flash MiB/s | stall | batt | temp °C |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| **Q4 k=8 median** (F1b ctrl) | **2.944** | **185.0** | **76.0** | 0 | 11.66 | 5.90 | 5.76 | 2964 | 166 | 0.224 | 0.436 | 424 | — | 72→71 | peak 30.4 |
| **Q4 k=8 median** (F1d B, same bin) | **2.914** | **183.1** | **76.8** | 0 | — | — | — | — | 200 | 0.228 | 0.434 | 422 | — | 66→65 | peak 33.3 |
| **Q4 k=6 median** (F1c ctrl) | **3.758** | **112.1** | **79.4** | 0 | 11.20 | 5.57 | 5.63 | 2939 | 178 | 0.184 | 0.277 | 405 | — | 70→69 | peak 30.8 |
| **k=6 d0.75 r1** | 3.895 | 84.40 | 81.0 | 4.5 | 11.741 | 6.125 | 5.616 | 2950.2 | 124 | 0.188 | 0.216 | 391 | 0.059 | 62→62 | 30.4→30.8 |
| **k=6 d0.75 r2** | 3.798 | 84.40 | 81.0 | 4.5 | 11.739 | 6.295 | 5.443 | 2932.5 | 124 | 0.192 | 0.221 | 382 | 0.061 | 62→61 | 30.8→32.2 |
| **k=6 d0.75 median** | **3.847** | **84.4** | **81.0** | **4.5** | 11.74 | 6.21 | 5.53 | 2941 | 124 | 0.190 | 0.219 | 387 | 0.060 | 62→61 | peak 32.2 |
| **k=8 d0.75 r1** | 3.381 | 108.20 | 83.1 | 7.5 | 11.807 | 6.051 | 5.757 | 2949.2 | 167 | 0.216 | 0.272 | 398 | 0.068 | 61→61 | 32.2→32.2 |
| **k=8 d0.75 r2** | 3.310 | 108.20 | 83.1 | 7.5 | 11.674 | 5.998 | 5.676 | 2973.5 | 167 | 0.222 | 0.274 | 394 | 0.068 | 61→60 | 32.2→32.8 |
| **k=8 d0.75 median** | **3.346** | **108.2** | **83.1** | **7.5** | 11.74 | 6.02 | 5.72 | 2961 | 167 | 0.219 | 0.273 | 396 | 0.068 | 61→60 | peak 32.8 |
| **k=6 two-wave r1** | 3.760 | 109.92 | 79.0 | 0 | 10.937 | 5.456 | 5.481 | 2932.5 | 148 | 0.183 | 0.272 | 404 | 0.071 | 60→60 | 32.8→33.9 |
| **k=6 two-wave r2** | 3.770 | 109.92 | 79.0 | 0 | 11.365 | 5.891 | 5.474 | 2942.2 | 148 | 0.183 | 0.271 | 406 | 0.070 | 60→59 | 33.9→33.6 |
| **k=6 two-wave median** | **3.765** | **109.9** | **79.0** | 0 | 11.15 | 5.67 | 5.48 | 2937 | 148 | 0.183 | 0.272 | 405 | 0.071 | 60→59 | peak 33.9 |
| **k=6 d1.0 r1** | 4.638 | 39.20 | 87.6 | 12.1 | 11.311 | 5.647 | 5.663 | 2957.4 | 144 | 0.175 | 0.115 | 341 | 0.036 | 59→59 | 33.6→33.6 |
| **k=6 d1.0 r2** | 4.637 | 39.20 | 87.6 | 12.1 | 10.844 | 5.395 | 5.449 | 2931.0 | 144 | 0.175 | 0.114 | 343 | 0.036 | 59→58 | 33.6→34.4 |
| **k=6 d1.0 median** | **4.638** | **39.2** | **87.6** | **12.1** | 11.08 | 5.52 | 5.56 | 2944 | 144 | 0.175 | 0.115 | 342 | 0.036 | 59→58 | peak 34.4 |

CSV: `results/mellum2_f1_s23/f1e/runs_regime.csv`. All eight F1e reps rc=0, cold=1, UNPLUGGED. Drop logs:

- k=6 d0.75: `moe-drop: 930/20832 routed experts dropped (4.5%), threshold 0.75 x uniform`
- k=8 d0.75: `moe-drop: 2814/37408 routed experts dropped (7.5%), threshold 0.75 x uniform`
- k=6 d1.0: `moe-drop: 2935/24192 routed experts dropped (12.1%), threshold 1.00 x uniform`

n_gen is EOS (124 / 167 / 148 / 144), not the 200 cap. tok/s is per-token; do not over-read length.

### Verdict per lever

| lever | vs control | Δ tok/s | Δ MiB/tok | drop % | verdict |
|---|---|---:|---:|---:|---|
| **k=6 + drop 0.75** | F1c k=6 = 3.758 | **+2.4%** (3.847) | 112.1 → 84.4 (**−25%**) | 4.5 | **LIVE (weak).** I/O did what the lever says. tok/s barely moved — still flash-bound (0.219 vs compute 0.190) and 4.5% dropped is a thin tail, not the Qwen 14% fire at F=0.75. |
| **k=8 + drop 0.75** | F1b 2.944 / F1d B 2.914 | **+13.7% / +14.8%** (3.346) | 185 → 108 (**−42%**) | 7.5 | **LIVE.** Native-k has more tail to cut (threshold 0.75/8 = 0.094). Still flash-bound (0.273 vs 0.219). Not Qwen +55%. |
| **k=6 + `--io-two-wave`** | F1c k=6 = 3.758 | **+0.2%** (3.765) | 112.1 → 109.9 (noise) | 0 | **NULL.** Stall 0.071, TTFT 11.15 vs 11.20. Close the flag for Mellum. |
| **k=6 + drop 1.0** (optional) | F1c k=6 = 3.758 | **+23.4%** (4.638) | 112.1 → 39.2 (**−65%**) | 12.1 | **LIVE.** This is the Mellum live zone, not 0.75. Now **compute-bound** (flash 0.115 < compute 0.175). Ceiling 1/0.175 = **5.71 t/s**; measured 4.638 is 81% of that. Qwen analog was +84% / 28.4% dropped — we got +23% / 12.1%. |

F=0.75 at k=6 is closer to the Qwen **0.50 dead-zone analog** (machinery fires, almost no tok/s) than to Qwen 0.75. F=1.0 is the first threshold that actually flips the bind from flash to compute on this SKU at k=6.

### Where it goes compute-bound

| cell | compute s/tok | flash s/tok | flash/compute | 1/compute ceiling | bound |
|---|---:|---:|---:|---:|---|
| k=8 F1b | 0.224 | 0.436 | 1.95× | 4.46 t/s | flash |
| k=8 d0.75 | 0.219 | 0.273 | 1.25× | 4.57 t/s | flash |
| k=6 F1c | 0.184 | 0.277 | 1.51× | 5.43 t/s | flash |
| k=6 d0.75 | 0.190 | 0.219 | 1.15× | 5.26 t/s | flash (closing) |
| k=6 two-wave | 0.183 | 0.272 | 1.49× | 5.46 t/s | flash |
| **k=6 d1.0** | 0.175 | 0.115 | **0.66×** | **5.71 t/s** | **compute** |

Drop 1.0 is the first Mellum cell on S23 that is compute-bound. Further I/O tricks (two-wave, prefetch, more cache) will not move it. KEXP at this k/drop mostly pays residual stall (0.036 s/tok).

### KEXP band (refreshed, not rewritten)

Same house method: KEXP cuts routed experts only to mid **2.75** bpw; dense stays ~4.5 / anon-resident; Q2/Q3 GEMM **not** assumed faster; flash ~340–400 MiB/s.

| variant | MiB/tok | decode | note |
|---|---:|---:|---|
| **Q4 k=8 measured** | **185** | **2.94 t/s** | F1b |
| **Q4 k=8 d0.75 measured** | **108** | **3.35 t/s** | this grid |
| **Q4 k=6 measured** | **112** | **3.76 t/s** | F1c |
| **Q4 k=6 d0.75 measured** | **84** | **3.85 t/s** | this grid; weak |
| **Q4 k=6 d1.0 measured** | **39.2** | **4.64 t/s** | this grid; compute-bound |
| **Q4 k=2 measured** | **55.5** | **5.68 t/s** | F1c; best raw speed; quality UNGATED |
| KEXP k=8, 85% hit | ~72 | **~4.4 t/s** | F1d; hits k=8 `mul_mat_id` wall |
| KEXP k=8 d0.75 | 108×(2.75/4.5) ≈ **66** | **~4.6 t/s** | flash 66/396 < compute 0.219 |
| KEXP k=6 | ~68 | **~5.4 t/s** | F1c; hits k=6 wall |
| **KEXP k=6 d1.0** | 39.2×(2.75/4.5) ≈ **24** | **~5.2–5.7 t/s** | already compute-bound; KEXP pays stall, not a new ceiling |
| KEXP k=2 | ~34 | **~8.4 t/s** | F1c; hits k=2 wall |
| KEXP file size | — | — | **4.1–4.8 GB** (unchanged) |

**Band after F1e: 3.5 (k=8 conservative KEXP) to ~8.4 t/s (k=2 KEXP, compute-limited).** Drop 1.0 + KEXP at k=6 does **not** clear 6 t/s on this calibration. Nothing in the measured or projected set clears 10 tok/s.

### Quality — UNGATED (read this twice)

- **No PPL, no Fase-1 gate, no product claim.** Speed only. PC is running KEXP PPL; this cell did not touch it.
- Informal decode on this one `p_fact` prompt: k=6 d0.75 / k=8 d0.75 / k=6 two-wave / k=6 d1.0 all still emitted a coherent MoE paragraph (d1.0 r1 is a clean two-sentence answer). That is an anecdote. It is **not** a PPL number and it does **not** license drop 1.0 as a product flag. Qwen survived F=1.0 on 15 GSM8K; Mellum has not been gated.

---

## FINAL — Mellum2 on S23 (honest)

**Best achievable today (measured)**

| what | tok/s | note |
|---|---:|---|
| Native k=8 Q4 | **2.94** | F1b; 185 MiB/tok, flash-bound |
| k=8 + drop 0.75 | **3.35** | F1e LIVE +14% |
| k=6 Q4 | **3.76** | F1c |
| k=6 + drop 0.75 | **3.85** | F1e LIVE weak |
| **k=6 + drop 1.0** | **4.64** | F1e LIVE; first compute-bound cell; quality UNGATED |
| k=4 Q4 | **4.72** | F1c; quality UNGATED |
| k=2 Q4 | **5.68** | F1c best raw speed; informal decode collapsed |

`--io-two-wave` is **NULL**. Rebuild (F1d) did **not** move the ceiling. Pinning big cores (F1d C) made it worse.

**Best projected with KEXP (calibrated, not hoped)**

3.5–4.6 t/s at native k=8 (flash paid down onto the 4.4 t/s `mul_mat_id` wall). ~5.2–5.7 t/s at k=6 + drop 1.0 (already on that wall). ~8.4 t/s only if k=2 survives a PPL gate — it has not. File 4.1–4.8 GB. **None of these clear 10 tok/s.**

**Product recommendation:** Mellum2 on S23-class is a stream-existence / demo SKU (measured 2.9–4.6 t/s at usable k, ceiling 4.4–5.7 with KEXP). Ship flagship / Mac first. Do not sell this as a 10 t/s phone model.

Artifacts: `results/mellum2_f1_s23/f1e/` (CSV, master log, 8× logs + mem samples + preflight/cpus, `bin.sha256`, `STATUS.txt=DONE`). Script: `results/mellum2_f1_s23/run_f1e_s23.sh`. F1 / F1b / F1c / F1d files left in place.

## PPL quality gate (PC, 2026-08-14)

PC only. Same multi5 corpus + `scripts/run_multi5_ppl_host.py --ppl-decode` as Marco phase-1 / LFM KEXP. Stock kernel (`--no-moe-fused-gemv --no-moe-fused-ffn`), same streaming recipe as the campaign PPL runs (`--moe-stream --cache-mb 2000 --dense-weights anon --io-threads 4 --overlap -c 4096 --ubatch 512 -t 16`).

This is the quality gate that F1c/F1e left open. The 5.151 tok/s S23 number (kernel-s2-gate, k6d1.0 fused-OFF t=2) is **config only**; this run decides whether that cell is adoptable.

### Identity

- GGUF `models/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf` sha256 `b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7` (8071293600 B) — MATCH F0/F1 pin `b04281c27de5d968d577f310d982273b1b13bdbd8117b3ecffffeebfe222f0a7`.
- Binary `build-pc-mellum-ppl/cli/bmoe-cli.exe` sha256 `7722cb23729d367a274fb682cadd28ef5d456f50fc9b5c064e4923ed04d75d52` (Ninja Release, GGML_NATIVE=ON / AVX2; mellum recipe + fused flags forced OFF). Campaign `build-pc/cli/bmoe-cli.exe` (2026-08-09) was **not** overwritten — it predates the mellum recipe row.
- Corpus: `corpus/multi5/{en,es,fr,it,zh}.txt`. **No code-heavy PPL slice** exists under `corpus/` or `quality/`; multi5 only (not invented).
- Artifacts: `results/mellum2_ppl_gate/`.

### Results vs k8d0 (native k, no drop)

Gates = Marco phase-1 protocol: per-lang ΔBPB ≤ +0.10, macro ΔBPB ≤ +0.04 → GATE_PASS. Soft band +0.06 / +0.15 → GATE_MARGINAL. Precedent: Marco A2 k6d065 **+0.0182** in-gate (worst lang zh +0.033).

| arm | k | drop | macro BPB | Δmacro | worst lang | Δworst | verdict |
|---|---:|---:|---:|---:|---|---:|---|
| **k8d0** | 8 | 0 | **1.0208** | 0.0000 | — | 0.0000 | ANCHOR |
| **k6d10** | 6 | 1.0 | 1.0586 | +0.0378 | fr | +0.0877 | **GATE_PASS** |
| **k6d065** | 6 | 0.65 | 1.0122 | -0.0086 | zh | +0.0303 | **GATE_PASS** |
| **k4d0** | 4 | 0.0 | 1.1200 | +0.0991 | fr | +0.1660 | **GATE_FAIL** |

Per-language BPB (and Δ vs k8d0):

| arm | en | es | fr | it | zh |
|---|---:|---:|---:|---:|---:|
| k8d0 | 0.7783 | 0.9485 | 0.9540 | 1.0666 | 1.3566 |
| k6d10 | 0.7484 (-0.0299) | 0.9635 (+0.0150) | 1.0418 (+0.0877) | 1.1300 (+0.0634) | 1.4095 (+0.0530) |
| k6d065 | 0.7201 (-0.0583) | 0.9302 (-0.0183) | 0.9661 (+0.0121) | 1.0578 (-0.0088) | 1.3868 (+0.0303) |
| k4d0 | 0.7734 (-0.0050) | 1.0319 (+0.0834) | 1.1201 (+0.1660) | 1.1888 (+0.1221) | 1.4856 (+0.1290) |

### Product call on 5.151

**YES — k6d1.0 is adoptable as the product config** on quality. The 5.151 t/s S23 cell (stock kernel, t=2) clears the same Marco-phase-1 tolerances that licensed A2. Tight, not free: dMacro +0.0378 spends 95% of the +0.04 budget (Marco A2 was +0.0182); worst language is FR +0.0877 vs +0.10. EN BPB actually *fell* (−0.0299) — coding tokenizer on prose, not a reason to distrust the gate.

The other two arms, now that they exist:

- **k6d065 GATE_PASS and cheaper than native k8 on macro** (dMacro **−0.0086**, worst zh +0.0303). Quality-safer than d1.0; the S23 speed cell for this config is the older ~3.76–3.85 t/s, not 5.151.
- **k4d0 GATE_FAIL** (dMacro +0.0991, FR +0.1660, IT +0.122, ZH +0.129). The F1c 4.72 t/s k=4 point is a speed anecdote. Do not ship a k=4 Mellum2 cell.

Written 2026-08-14T19:37:12-0400.
