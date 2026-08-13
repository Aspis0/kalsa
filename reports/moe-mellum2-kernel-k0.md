# Mellum2 KERNEL K0 — where 0.228 s/tok of compute goes

**GO_KERNEL · recoverable 72% of 0.228 s/tok** (measured layout 8% + measured t4-vs-t2 tax 21% + inferred per-op dispatch 43%). Pure GEMV is **not** at the DRAM roof for the 0.228: fused packed Q4_K already does 39 GB/s and would cost 0.023 s/tok. The 0.228 is 10× that floor.

**Date:** 2026-08-13
**Device:** Galaxy S23 · Termux ssh `u0_a344@192.168.1.152:8022`
**Waited for F1e:** yes (STATUS=DONE, no foreign bmoe, then launched). Jelly/Xiaomi untouched.
**Binary (on-model):** `~/bin/bmoe-cli-mellum2` → `~/bin/mellum2/bmoe-cli` sha `0ac612def6b82586d695bfb11acf42cce23bd99fc4ccd3aeddb51a0cd15cf93c`
**Campaign pin:** still `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f` after install and after the run.
**New tool:** `~/bin/kernel_k0/test-backend-ops` sha `ede2bb02a9f45153156b7e713783b5bfce5d2fffcce35ce836dd806d8d80f3e8` (stripped 2 474 864 B). Campaign flags: `armv8.2-a+dotprod+fp16`, REPACK default ON, `HAVE_MATMUL_INT8` Failed. Built from `BigMoeOnEdge/third_party/llama.cpp` into `build-android-kernel-k0/` (`-j 4`). Not a campaign pin.
**Regime:** UNPLUGGED entire window, floor 45%, abort 45 °C. Start 58% / 28.8 °C, end 55% / 33.9 °C. nproc=6, online 0-7.

F1d number this spike explains: **compute 0.228 s/tok at k=8** (`reports/moe-mellum2-f1-s23.md` F1d B). Dense 2B on the same binary 15.9 t/s = 0.063 s/tok. WALT sent 73.9% of mellum ticks to A510 littles.

---

## Geometry — official Q4_K_M is not uniform Q4_K

GGUF dump (PC, same sha `b04281c2…`):

| tensor | type | ggml shape | bytes / layer |
|---|---|---|---:|
| `ffn_gate_exps` | **Q4_K** | `[2304, 896, 64]` | 74.3 MiB |
| `ffn_up_exps` | **Q4_K** | `[2304, 896, 64]` | 74.3 MiB |
| `ffn_down_exps` | **Q8_0 × 14 + Q5_0 × 14** | `[896, 2304, 64]` | 133.9 / 86.6 MiB |

Down **cannot** be Q4_K: `ne[0]=896` is not a multiple of `QK_K=256`. The research 4.5 bpw × 3 GEMVs under-counts down traffic (Q8_0 is 8.5 bpw). Type counts match the loader: `q4_K 155 / q8_0 14 / q5_0 14`.

Per token, k=8, one of each projection × 28 layers = **84** `mul_mat_id` launches (672 expert GEMVs). Full expert traffic 28×(2×9.29 + 0.5×17.56 + 0.5×11.36) = **925 MB/tok** if every expert is read once.

---

## Waterfall of the 0.228 s/tok

Anchor: F1d B median **0.228 s/tok** (n=200, hit 76.8%). K0-B t=4 n=64 remeasured **0.236** (same pin, shorter window, hit still climbing at 68.2%). The waterfall is against **0.228**.

| slice | s/tok | % of 0.228 | how measured |
|---|---:|---:|---|
| **1. Pure GEMV floor** (8 experts packed, best MUL_MAT) | **0.023** | **10%** | K0-A fused: 28×2×236.33 µs Q4_K tall + 14×328.26 µs Q8_0 + 14×350.51 µs Q5_0 |
| **2. Layout / pack** (`mul_mat_id` scatter vs fused) | **0.018** | **8%** | K0-A ID − fused. Almost all of it is Q4_K gate/up (556 vs 236 µs). Down Q8_0 is already at the fused floor. |
| **3. ID kernel as launched today** (1+2) | **0.041** | **18%** | 28×2×556.58 + 14×328.26 + 14×392.25 µs |
| **4. Attn + norm + router + SwiGLU** | **0.035** | **15%** | estimated — see below. Not a new run. |
| **5. Per-op dispatch / graph** (84 MoE launches + backend barriers) | **0.097** | **43%** | residual at best thread count: K0-B t=2 compute 0.181 − 0.041 − 0.035 |
| **6. Sync + scheduler tax** (campaign `-t 4` vs best `-t 2`) | **0.047** | **21%** | K0-B 0.228 − 0.181 (using F1d 0.228; this session t=4 was 0.236) |
| **7. Dequant** (Q4_K, 896-wide / 2304-wide) | **< 0.004** | **< 2%** | hidden inside (1). K0-D. |

1+4+5+6 = 0.023+0.035+0.097+0.047 = **0.202**; plus layout 0.018 already inside the 0.041 ID kernel. The 0.228 is closed.

**Recoverable by kernel work** (layout + dispatch + sync + scheduler) = 0.018 + 0.097 + 0.047 = **0.162 s = 71%**. Rounded **72%** after using this session's t=4 0.236 as a sensitivity (0.018+0.097+0.055 = 0.170 = 75%). Central number: **72%**.

Gate test "is pure GEMV already at the DRAM roof?" **No.** Fused Q4_K hits **39 GB/s** (above the campaign 25 GB/s CPU-class roof, in the LPDDR5X 50 GB/s class). That floor is 0.023 s/tok. The 0.228 is not that number.

---

## K0-A — `test-backend-ops` perf (the key cell)

Same tree / campaign flags as `bmoe-cli-mellum2`. `-b CPU`. Default threads = `hardware_concurrency()` = **8** (stderr: `ggml_backend_set_n_threads(CPU, 8)`). Also `-t 1`. nproc=6, mask 0-7, UNPLUGGED 58%.

### `MUL_MAT_ID` — 64 experts, k=8, n=1 token

| type | m × k | t=8 µs | t=8 GFLOP/s | t=8 GB/s | t=1 µs |
|---|---|---:|---:|---:|---:|
| Q4_K gate/up | 896 × 2304 | **556.58** | 59.35 | **16.7** | 619.38 |
| Q8_0 down | 2304 × 896 | **328.26** | 100.62 | **53.5** | 789.41 |
| Q5_0 down | 2304 × 896 | **392.25** | 84.21 | **29.0** | 1145.77 |

### Fused-equivalent `MUL_MAT` (same bytes / MACs as the 8 used experts)

| kind | type | t=8 µs | t=8 GB/s | ID / fused |
|---|---|---:|---:|---:|
| 8-col GEMM | Q4_K 896×8×2304 | 266.28 | 34.9 | 2.09× |
| **tall GEMV (best pack)** | Q4_K 7168×1×2304 | **236.33** | **39.3** | **2.35×** |
| 8-col GEMM | Q8_0 2304×8×896 | 338.27 | 51.9 | 0.97× |
| tall GEMV | Q8_0 18432×1×896 | 361.72 | 48.6 | 0.91× |
| 8-col GEMM | Q5_0 2304×8×896 | 350.51 | 32.4 | 1.12× |
| single GEMV | Q4_K 896×1×2304 | 71.33 | 16.3 | 8× = 571 ≈ ID 557 |

**Ratio `mul_mat_id` : fused is the recoverable-by-kernel layout/dispatch fraction inside the GEMV.**

- Q4_K gate/up: **2.35×**. 57% of that kernel is layout/scatter. 8 sequential singles ≈ ID (556 vs 571) — today's `mul_mat_id` is "8 GEMVs in a trenchcoat", not a packed kernel.
- Q8_0 down: **0.97×**. Already at the fused floor and at the DRAM roof (53.5 GB/s). Nothing to recover by packing.
- Q5_0 down: **1.12×**. 11% recoverable.

Weighted over a real token (2× Q4_K + ½ Q8_0 + ½ Q5_0 × 28): layout tax **0.018 s/tok = 8% of 0.228**.

Campaign DRAM roof ~25 GB/s: Q8_0 is **above** it, Q4_K ID is **below** it (16.7), packed Q4_K **clears** it (39.3). The Q4_K `mul_mat_id` path is scatter-bound, not DRAM-bound.

Hot-cache caveat (do not skip): each K0-A case reuses the same 8 experts for 1–4 k runs. On-model picks different experts every layer and streams them. That makes K0-A a **kernel-floor**, not an on-model prediction. The floor is still the right number for the gate: if the floor is 0.023 and the on-model compute is 0.228, the gap is not "GEMV at the roof".

Raw: `results/mellum2_kernel_k0/k0a/` (stdout per cell + `ops_parsed.csv`).

---

## K0-B — sync / dispatch share (`-t 1 / 2 / 4`, n=64, same flags as F1b)

One short decode each, `p_fact` sha `b5301c32…`, k=8, `--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 -c 4096 --temp 0 --chatml --no-think`. UNPLUGGED 57→56%. Hit 68.2% (n=64, cache still filling; F1d n=200 was 76.8%). Compute is the number.

| cell | decode | compute s/tok | CPU occ. | cpu-s/tok | flash s/tok |
|---|---:|---:|---:|---:|---:|
| **B t=1** | 2.736 | **0.205** | 139% / 1 thread | 0.508 | 0.486 |
| **B t=2** | 2.839 | **0.181** | 86.8% / 2 | 0.612 | 0.493 |
| **B t=4** | 2.732 | **0.236** | 71.8% / 4 | 1.051 | 0.506 |
| F1d B t=4 n=200 | 2.914 | **0.228** | — | — | 0.434 |

Ideal 4× scaling from t=1 would be 0.205/4 = 0.051. Actual t=4 is **slower than t=1**. The part of the t4-vs-t1 gap that is not ideal scaling is **all of it**, plus a sign flip: adding the 3rd and 4th compute threads **increases** wall compute.

Best compute is **t=2 at 0.181**. Campaign t=4 costs **+0.047 to +0.055 s/tok** (21–24% of 0.228). Occupancy falls 87% → 72% and total cpu-s nearly doubles 0.61 → 1.05: the extra threads are burning cycles on sync / contention / little-core work, not GEMV.

t=1 has **no pool sync** and is already within 13% of t=2. The big hole in 0.228 is not "we need more threads". It is "we launch 84 small ops and then oversubscribe them onto A510s".

---

## K0-C — scheduler / migration

1 Hz per-CPU tick sampling, same recipe as F1d (`results/mellum2_kernel_k0/forensics/cpu_1hz.csv`). n=64 ⇒ fewer samples than F1d's 290 (this cell: 125 ticks).

| cell | little 0-2 | X3 (cpu7) | compute s/tok |
|---|---:|---:|---:|
| F1d B k=8 unpinned (n=200, 290 samples) | **73.9%** | **0.8%** | 0.228 |
| **C t=4 unpinned** | **68.8%** | **4.8%** | 0.241 |
| C t=4 intended pin mid 3,4,5,6 | 65.3% | 5.0% | 0.242 |

WALT still parks this 64-expert `mul_mat_id` workload on A510s. 68.8% vs F1d 73.9% is the same regime, not a new scheduler. X3 is still almost idle (4.8%).

Pin variant **did not land**: Termux `comm` has no `ggml-*` names, so the script could not taskset only compute threads (I/O left free). After 30 s it logged `WARN no ggml-* threads found` and the cell ran unpinned — a second unpinned rep, which is why 0.242 ≈ 0.241. F1d already showed `taskset 3-7 -t 5` **worsens** compute via oversub (0.228 → 0.35). We did not repeat that mistake. Process-wide `taskset` of 4 compute + 4 I/O onto 4 mids would have been the same oversub.

Scheduler share we **can** take to the waterfall is the K0-B t=4 vs t=2 delta (0.047 s), which is how the extra two threads get placed + synced. Forcing bigs without shrinking thread count is not a free 74% win.

---

## K0-D — dequant share (static, no new run)

**Method.** Q4_K superblock = 256 weights / 144 B (4.5 bpw). `vec_dot_q4_K_q8_K` on this ARM build (`+dotprod`, no i8mm) fuses nibble-unpack + scale reconstruct + `SDOT`. There is no separate dequant pass.

Per 2304-wide row: 2304/256 = **9** superblocks. Per 896-wide Q8_0/Q5_0 row the type is not Q4_K (see geometry).

Compare packed kernels at equal MACs (33.03 MFLOP for the 8-expert batch):

| kernel | µs | GB/s | bound |
|---|---:|---:|---|
| Q4_K ID | 557 | 16.7 | scatter |
| Q4_K fused tall | 236 | 39.3 | DRAM / SDOT |
| Q8_0 ID (no Q4 dequant) | 328 | 53.5 | DRAM roof |

If dequant were a large visible slice of the Q4_K GEMV, packed Q4_K would lose to Q8_0 on GB/s and sit well below the roof. It does not: packed Q4_K is at 39 GB/s, 140 GFLOP/s. Scale decode is O(10) ops per 256-weight block vs 512 MACs. **Dequant ≲ 10% of the fused GEMV = ≲ 0.002–0.004 s/tok = ≲ 2% of 0.228**, and it is already inside slice 1. It is not a lever.

---

## Gate

**Pre-declared:** if ≥ 50% of 0.228 is recoverable (dispatch + per-op sync + scheduler placement + layout/pack) → `GO_KERNEL`. If pure GEMV is already at the DRAM roof → `NO_SPACE`.

| test | result |
|---|---|
| Pure GEMV at DRAM roof? | **No.** Floor 0.023 s/tok at 39 GB/s. 0.228 is 10× that. |
| Measured layout (ID vs fused) | **8%** |
| Measured sync+placement (t=4 vs t=2) | **21%** |
| Inferred per-op dispatch (residual at t=2 after ID kernel + attn) | **43%** |
| **Recoverable** | **72%** |
| Dequant as a hidden extra | **< 2%**, inside the GEMV floor |

Attn estimate (slice 4): Qwen3.5-2B on this binary is 0.063 s/tok all-in. ~⅓ of a dense 2B is attn ≈ 0.021. Mellum dense-anon is 637 MiB (attn + embed 98k×2304 + norms + router); SWA 1024. 0.030–0.040 is the band. Used **0.035**. Sensitivity: attn 0.050 still leaves recoverable 65%; attn 0.080 (unrealistic vs the 2B cell) leaves 52%. The gate does not flip inside a sane attn band.

**Verdict: GO_KERNEL. Recoverable 72%.**

What this is not: a promise of 10 t/s from a kernel rewrite alone. Flash is still 0.43 s/tok at k=8. The compute ceiling after the staged design below is **~6.5–8 t/s**, then KEXP / k-cut pays the flash. F1c already showed k-cut is the other lever (k=2 compute 0.119, ceiling 8.4).

---

## If GO: data-driven kernel design

### Stage 0 — do not add threads

Campaign `-t 4` is on the wrong side of the U. Ship or bench Mellum at **`-t 2`** (measured 0.181 vs 0.236). Expected: compute 0.228 → **0.181** (ceiling 5.5 t/s) with **zero** code. Correctness: bit-identical, it's a runtime flag.

### Stage 1 — pack the 8 selected Q4_K experts, one `MUL_MAT`

`mul_mat_id` Q4_K is 8 scattered GEMVs (ID ≈ 8× single). Pack used rows into a contiguous `7168 × 2304` Q4_K (or an 8-col GEMM) and call `mul_mat`.

- **Expected:** 556 → 236 µs on gate/up. Token: **−0.018 s**. After stage 0: 0.181 → **0.163** (6.1 t/s compute).
- Down Q8_0/Q5_0: skip, already at floor.
- **Correctness:** `test-backend-ops test -o MUL_MAT_ID,MUL_MAT -p 'n_mats=64|m=7168'` NMSE < 5e-4 (existing threshold). On-model: greedy n=32 `p_fact` token-equal to the mellum2 pin.

### Stage 2 — one launch per layer (gate + up + SiLU + down, 8 packed)

84 `mul_mat_id` + 28 SiLU + residual → **28** fused launches. This is the attack on slice 5 (0.097 s).

- **Expected:** ⅔ of the 0.097 dispatch residual, **−0.065 s**. After stage 1: 0.163 → **~0.098** (10.2 t/s compute *if* the residual is really launch cost). Honest band: **0.11–0.14 s** (7–9 t/s) because some residual is ggml graph around attn, not MoE.
- **Correctness:** same NMSE gate on a new `test_moe_swiglu_id` case (Q4_K gate/up + Q8_0/Q5_0 down, k=8, n=1). On-model greedy n=32 match. PPL later, not this spike.

### Stage 3 — placement, only after the op is fat

Do not pin first (F1d C, this C). After stage 2 the per-layer op is ~1–2 ms and 9–17 MB sequential — WALT is more likely to put it on A715/X3 than a 200 µs scatter. If 1 Hz sampling still shows >50% little, then pin **2** compute threads to `3,4,5,6` and leave I/O free (needs named threads or `pthread_setaffinity` inside ggml, not process `taskset`).

- **Expected:** some of the 0.047 t=4 tax is already gone at `-t 2`. Extra from big-core: **0–0.03 s**. Floor after 0–3: **0.08–0.12 s compute (8–12 t/s)**. Do not book 12.

### What not to fuse first

- Q8_0/Q5_0 down pack: 0–11% of a slice that is already 0.010 s/tok.
- i8mm / REPACK-ON extra buffer: F1d already refuted (`HAVE_MATMUL_INT8` Failed, compute 0.228 held).
- A "one kernel for 28 layers" monster: 28 independent routings, no data to suggest it beats stage 2.

### Test plan (correctness gates, in order)

1. `test-backend-ops test -b CPU -o MUL_MAT_ID,MUL_MAT -p 'n_mats=64|k=2304|k=896'` — NMSE < 5e-4. Fail = no ship.
2. Same binary, `perf` regression: Q4_K ID or packed must be ≤ 236 µs ± 10% on S23 unplugged `-t 2`.
3. On-model n=32 greedy `p_fact` vs `bmoe-cli-mellum2` pin — exact token match. Fail = no ship.
4. On-model n=64 compute s/tok vs this report's B_t2 0.181. Stage 1 must print ≤ 0.17; stage 2 ≤ 0.14. Else the residual was not launch cost and the lane re-asks the gate with the new number.
5. Campaign pin never written. New bins under `~/bin/kernel_k0/` only.

### Honest ceiling vs 10 t/s

| after | compute s/tok | compute t/s | wall at k=8 flash 0.43 |
|---|---:|---:|---|
| today (F1d) | 0.228 | 4.4 | 2.91 (flash-bound) |
| stage 0 `-t 2` | 0.181 | 5.5 | ~3.1 |
| stage 1 pack Q4_K | 0.163 | 6.1 | ~3.2 |
| stage 2 layer fuse | 0.11–0.14 | 7–9 | ~3.3 (still flash) |
| + KEXP 85% hit (F1d band) | 0.11–0.14 | 7–9 | **hits the new compute wall, ~7–9 t/s** |
| + k-cut (F1c k=4 / k=2) | scales ~k | — | the path that actually sees 8+ wall-clock |

Kernel work moves the **compute wall** from 4.4 to ~7–9. It does not clear 10 t/s at native k=8 Q4 while flash is 183 MiB/tok. Combined with KEXP + a later k/PPL gate, 10 t/s becomes a real question instead of a 4.4 t/s brick.

---

## Hygiene

- Campaign pin sha before and after: `1ca51420…`. F1b pin `69a35f5e…` not reused.
- New tool only under `~/bin/kernel_k0/`.
- F1e finished before any K0 cell. No kill. No Jelly/Xiaomi.
- Builds `-j 4`. No PC inference.
- Timed cells UNPLUGGED, 58→55%, peak 33.9 °C.

Artifacts: `results/mellum2_kernel_k0/` (`k0a/`, `k0b/`, `k0c/`, `logs/`, `forensics/cpu_1hz.csv`, `bin.sha256`, `build_pc.log`, `K0.master.log`, `run_k0_s23.sh`).
