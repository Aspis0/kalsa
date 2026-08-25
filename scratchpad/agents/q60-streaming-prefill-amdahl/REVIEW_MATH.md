# q60 — Hostile method audit: REVIEW_MATH

Gate: "NPU for streaming MoE" decision. Review is read-only on the cell; output file only.
PREREG lock `14b23056`; REPORT.md, manifest.json, analysis_stdout.json, raw/ samplers all read.

**Reproducibility (audit scope step 1).** I recomputed every row directly from `raw/*.rep*.sampler.csv`
(first vs last sample) using the JSONL `samples_ns` walls, HZ=100, threads=8. All 9 rows reproduce the
published `compute_share` to 6 decimals (e.g. pp512 r2 0.7649, r3 0.7887; pp128 r1 0.1939). The
cell's arithmetic is faithful; raw files are intact and self-consistent. What follows attacks the
**interpretation**, not the bookkeeping.

`compute_share = (utime+stime)/(8·wall)` is an average core-utilization, not a fraction of
accelerable wall time. Every structural error below follows from treating it as the latter.

---

## 1. Recompute + decompose stime — CONFIRMED (arithmetic), NUMERIC CORRECTION APPLIES

Recomputed per rep (ticks→s):

| n | rep | class | wall_s | busy_s | stime/busy | share | majflt | read_MB | MB/s |
|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 128 | 1 | cold-d | 15.27 | 23.68 | 0.491 | 0.194 | 40 647 | 12 719 | 833 |
| 128 | 2 | warm | 14.88 | 71.54 | 0.272 | 0.601 | 178 482 | 9 437 | 634 |
| 512 | 1 | cold-d | 23.92 | 78.95 | 0.195 | 0.413 | 30 311 | 14 120 | 590 |
| 512 | 2 | warm | 23.19 | 141.93 | 0.109 | 0.765 | 59 777 | 8 373 | 361 |
| 512 | 3 | warm | 24.59 | 155.17 | 0.112 | 0.789 | 63 456 | 9 240 | 376 |
| 2048 | 3 | warm | 147.05 | 920.54 | 0.098 | 0.783 | 165 723 | 38 233 | 260 |

**stime is not matmul.** On pp512 warm, stime (kernel page-fault/page-map/memcg/TLB) is 10.9–11.2 %
of all busy ticks; on pp128 r1 (cold) it is 49 %. Range for corrected matmul share on the gate reps
(pp512 warm):

- strip 100 % of stime (all kernel work non-accelerable): share × (1−0.109/0.112) → **0.682 / 0.700**
- strip only majflt-bounded fault cost @150 µs/fault (59.8k/63.5k faults → 8.97/9.52 s): **0.717 / 0.740**
- @50 µs/fault: **0.749 / 0.773**
- ⇒ corrected "matmul compute share" ≈ **0.68–0.76** (midpoint ≈ 0.72).

**Upper bound on fault stall from majflt.** A major-fault stall can never exceed the sleep budget,
which is itself bounded by `(1−share)·wall` = 5.4 s on pp512 r2. majflt×150 µs = 8.97 s > 5.4 s, so
the data-consistent bound is **fault/I/O wait ≤ 5.5 s (~0.24 of wall)** — the entire idle share. Reads
are not fault-dominated anyway: warm reps read 2.25 M pages (8.4 GB/4 KB) with only ~60 k majflt
(2.7 %), i.e. ~97 % of data arrives via kernel readahead **outside the llama-bench task** (not charged
to its utime/stime at all). majflt is therefore the wrong instrument for I/O cost.

**read_bytes memcpy bound.** If every streamed byte were memcpy'd in-process at DRAM speed
(~3–8 GB/s on this platform), 8.4 GB costs 1–3 s — negligible versus the 22 s flash floor below.
mmap in-place (`-lm mmap -nr 1`) performs no bulk user copy. Memcpy is not the I/O cost; the flash
stream is — and it shows up as **sleep**, invisible to CPU ticks.

Net: stripping stime lowers the share to ~0.72, a cosmetic correction. The amplitude of the real
correction is in point 2 (the ceiling), not here.

---

## 2. Overlap / honest ceiling — REFUTED (the decisive one)

The frozen rule maps `share ≥ 0.50 → ceiling ≥ 1/(1−share) ≥ 2×`. That mapping holds **only in a
serialized model** (compute after I/O). Streaming mmap prefill is a pipelined load-store: throughout
every rep, `utime` and `read_bytes` grow **monotonically in parallel** (sampler columns), i.e. CPU
computes on resident pages while readahead fetches ahead. Correct ceiling:

    ceiling = wall / max( I/O_floor, compute_on_NPU ),   I/O_floor = read_bytes / sustained_bw,
    compute_on_NPU = busy_thread_s / k,  k ∈ {2,4,8}

pp512 warm, read 8.4–9.2 GB/rep, wall 23.19–24.59 s:

| pinned to | I/O floor | k=2 | k=4 | k=8 | k=∞ |
|---|--:|--:|--:|--:|--:|
| self-consistent BW 376 MB/s (= what pp512 itself achieved) | 22.3 s | 0.33× | 0.65× | **1.04×** | **1.04×** |
| best-in-cell sustained 634 MB/s (pp128 warm; UFS 2.2-class) | 13.2 s | 0.33× | 0.65× | **1.31×** | **1.76×** |

Representative walls: **the pp512 warm wall ≈ the I/O floor at its own delivered bandwidth** (r2:
23.19 vs 22.3 s → 1.04×; r3: 24.59 vs 24.59 s → 1.00×). The CPU busy time (141.9–155.2 thread-s
over 8 cores = 17.7–19.4 s/core) fits **inside** the flash stream; removing it entirely leaves the
flash stream. The claimed 4.25–4.73× never materializes under any assumption used above: even the
optimistic branch (flash magically held at 634 MB/s on the pp512 access pattern + ∞-NPU power) tops
at **1.76× — below the 2× bar**.

Full table (ceilings column "self" pins I/O floor to the rep's own observed MB/s; "634" to the
best-in-cell 634.6 MB/s, which pp512/2048 never themselves reached — the honest reading is the
"self" column):

| n | rep | wall_s | share | claimed 1/(1−s) | read_GB (×model) | ceil@k8 self | ceil@k8 634 | ceil@∞ self | ceil@∞ 634 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 128 | 1 | 15.27 | 0.194 | 1.24 | 12.7 (1.21) | 0.45 | 0.76 | 0.45 | 0.76 |
| 128 | 2 | 14.88 | 0.601 | 2.51 | 9.4 (0.90) | 0.59 | 1.00 | 0.59 | 1.00 |
| 512 | 1 | 23.92 | 0.413 | 1.70 | 14.1 (1.34) | 0.64 | 1.07 | 0.64 | 1.07 |
| 512 | 2 | 23.19 | 0.765 | 4.25 | 8.4 (0.80) | 1.04 | 1.31 | 1.04 | 1.76 |
| 512 | 3 | 24.59 | 0.789 | 4.73 | 9.2 (0.88) | 1.00 | 1.27 | 1.00 | 1.69 |
| 2048 | 1 | 103.3 | 0.693 | 3.26 | 41.1 (3.91) | 0.94 | 1.44 | 0.94 | 1.59 |
| 2048 | 2 | 116.7 | 0.762 | 4.19 | 38.2 (3.63) | 1.15 | 1.31 | 1.15 | 1.94 |
| 2048 | 3 | 147.0 | 0.783 | 4.60 | 38.2 (3.64) | 1.28 | 1.28 | 1.44 | 2.44 |

pp2048 row r3 (2.44×) requires flash at 634 MB/s while streaming 38 GB — the run itself sustained
260 MB/s there and was throttling (point 5); treat as a bound that was never achieved, not a result.

pp128 warm shows the same structure: within a single short prefill the ceiling is ~0.6–1.0×.

Bottom line: **on this device, in the streaming regime, an NPU offload of prefill math has a real
ceiling of ≈1.0–1.8×; at realistic k≤4 it is a net loss (0.33–0.65×).** The `≥ 0.50 → GO (≥2×)`
derivation is REFUTED by the cell's own bytes and walls.

---

## 3. Warm vs cold — CONFIRMED; first prompt is worse, and "warm" is a misnomer

Model 10.51 GB; MemAvailable 5.54 GB (0.53× model). No rep of this run ever had the model resident:
warm reps still read 0.80–0.88× the model per prefill; inter-rep page-cache retention is only
1.1–2.1 GB (10–20 %). "Warm" here means "second pass of an effectively streaming read," not residency.

- **Warm vs cold is a 3–10 % wall effect, not a regime change.** pp512 walls 23.9/23.2/24.6; the
  "cold" r1 read *more* (14.1 GB, 1.34× model) because on a cold-ish cache, demand + readahead
  overshoot exceed the model footprint (the cache was pre-warmed by the inventory sha256 and the t2
  pass-throughs). read_bytes is the honest cache barometer, and it says every rep streams the model.
- **Cold labels are contaminated** (acknowledged in PREREG/manifest): the required inventory
  `sha256sum` read the model before measurement; pp512/pp2048 got only a 30 s cooldown, no eviction
  (no file ≥ MemTotal existed). So "r1 cold" is not empty-cache; the *true* cold first prompt would
  read even more and be even more I/O-pinned. The product's first prompt (cold, long context) is
  strictly **worse** than the warm numbers the rule keys on.
- **pp128 r1 (0.19) is the only approach to a true cold start** and it says ~81 % of wall is not
  accelerable — the exact opposite of the warm-GO conclusion. The rule's own <0.30 branch, applied to
  the first-prompt regime, would say **drop**.
- An honest "cache fraction" conclusion: `warm` prefill caches ≈10–20 % of the model; every prefill
  pays ~a full model volume of flash traffic; pp2048 pays **3.6 model volumes** (38 GB) because at
  longer context the mid-prefill working set thrashes the 5.5 GB cache.

---

## 4. Thread accounting — PLAUSIBLE concern, second-order, data is insufficient to quantify

SoC is MT6789 (Helio G99): 2× Cortex-A76 @2.2 GHz + 6× Cortex-A55 @2.0 GHz (confirmed externally;
not recorded in the cell). `-t 8` spans heterogeneous cores. `/proc/pid/stat` is a per-process
aggregate — there is **no per-core attribution in this dataset** (no per-thread sampling), so a
big-core-only busy fraction cannot be computed from the cell. Qualitatively:

- Dividing by `8·wall` assumes 8 co-equal capacity cores. A55 executes ~2–3× slower per op; with a
  saturating A55 partition, wall is set by the slow side and the aggregate "share" is not a clean
  fraction of wall-gating capacity. The big-core-only busy fraction would be **lower** than the
  reported share, moving the gate *further* from GO — but the direction is moot because point 2 shows
  the wall is pinned by I/O regardless of core composition.
- HZ=100 assumption is indirectly validated: all shares land uncapped in [0,1] (HZ=1000 would clip
  them at 1.0).

Truth in this cell: thread accounting is a real-but-minor impurity; the ceiling error of point 2 is
the dominant term.

---

## 5. Variance / throttling — CONFIRMED (pp2048 r3 throttled); pp512 verdict unaffected by it

pp2048 fingerprint across reps: wall 103.3 → 116.7 → 147.0 s (+42 %); busy-rate climbs (5.55 → 6.09 →
6.26 thread-s/s, i.e. more CPU ticks per byte) while effective flash drops 0.40 → 0.33 → 0.26 GB/s;
battery 70 → 65 %; guard temp 30 → 36 °C. That pattern (rising ticks + falling MB/s + ballooning wall)
is the thermal/voltage-throttle signature; max 36 °C is 4 °C under the guard kill (limit 43), and the
guard sampled only every 10 s. pp2048 r3 is not a clean datum: its share 0.783 is partly an artifact
of a longer, throttled wall. Note this also means the "share rises with pp size" trend (128→512→2048)
is partly throttling contamination, not a scaling law.

pp512 is clean on the same instrument: max 30 °C, per-rep busy-rate 6.12/6.31 and MB/s 0.361/0.376
essentially stable, wall spread 23.19/24.59 (6 %). The pp512 verdict is **not** overturned by thermal
noise — it is overturned by the point-2 floor argument, which is independent of this anomaly. (Thermal
budget concern stands for the kernel project: any NPU offload adds heat on a device already at a knee
by 36 °C at only 8 CPU threads.)

---

## 6. Transferability to the v75 Xiaomi (UFS 4.0, faster CPU, 16 GB) — PARTIAL

**Transfers (structure):**
- Prefill I/O volume ≈ model volume per pass when model > RAM; "warm" reads the model anyway.
- The correct ceiling is `wall / max(I/O floor, compute/k)` with overlap, not `1/(1−share)`.
- Cache-fraction logic: usable cache must exceed model size before warm reads → 0.
- Method reproduces verbatim (`-lm mmap -nr 1 -ngl 0`, per-rep `read_bytes` + wall + majflt).

**Does not transfer (magnitudes):**
- Absolute flash: UFS 4.0 ≈ 2.4–3.5 GB/s vs the Jelly's observed 260–634 MB/s (UFS 2.2). If the model
  streams, I/O floor shrinks ~5–10× and compute may become the new binder — **the verdict flips
  regime**.
- Cache fraction: 16 GB RAM can hold the 10.5 GB Marco-Mini. If the product's model fits in usable
  RAM, warm reps read ≈0 GB, the prefill is compute-bound, and then — and only then — NPU offload has
  headroom. But a model that fits RAM is by definition **not** the streaming regime this cell was
  designed to characterize, so the Jelly measurement neither supports nor refutes that case.
- CPU cap: faster big-core cluster moves compute_on_NPU down, further favoring a regime where the
  Jelly's I/O-bound conclusion no longer applies.

**One measurement that settles it** (run on the v75 with `-lm mmap -nr 1 -ngl 0`, pp512×3, sampler as
here plus a readable `/proc/pressure/io`, which was NA on the Jelly): record per-rep `read_bytes`.
- `read_bytes(warm) ≈ 0` → model is RAM-resident, regime flipped to compute-bound → the Jelly's
  I/O verdict does **not** transfer; re-gate on CPU-time/NPU-accelerable fraction there.
- `read_bytes(warm) ≈ model size` → streaming regime persists → apply ceiling = wall/max(I/O floor
  at UFS 4.0, compute/k). Use a model sized ≥ ~1.2× (usable RAM) so the regime cannot hide.

That one column — whether a warm prefill still touches flash — is the entire transfer story.

---

## 7. Streaming-into-NPU tiling cost the cell does not capture — CONFIRMED MISSING; design-phase item

The cell measured CPU-only llama-bench (launcher confirms `-ngl 0`, `GGML_HEXAGON_NDEV=1`, `-nr 1`).
Nothing in it prices the per-expert tiling/repack and DMA that a real HTP path adds on *every*
prefill — and here "every prefill" means every expert tile is re-streamed (all weights, k=6-of-256).

Order of magnitude (bytes/s): the prefill already moves 8.4–9.2 GB (pp512) to ~38 GB (pp2048) through
the memory system for flash alone. A streaming-to-NPU path adds a **second pass of the same volume**
(write-side repack) into HTP/blit buffers. At 0.3–1.0 GB/s per A76 for Q4→HTP-tile repack, pp512 needs
~8–28 s of extra CPU-side tiling against a 23 s measured wall — **comparable to or larger than the
math being offloaded**, i.e. it can erase the (already ≤1.8×) headroom outright unless the tiling is
overlapped with flash read and done in-kernel/DMA. Bytes moved in/out of shared NPU memory ≥ the I/O
volume in all regimes; on pp2048 that is ~38 GB×2 ≈ 76 GB of memory traffic per prefill at DRAM rates.

**Design-phase requirement: measure expert-tile repack throughput (MB/s) on the target before any
kernel commitment, and require tiling+copy rate ≥ stream bandwidth; otherwise the NPU path is a
latency adder, not a speed-up.**

---

## Corrected ceiling (summary the gate should see)

pp512 warm, this Jelly, streaming regime (model 10.51 GB > 5.54 GB usable):

- claimed (frozen rule): `1/(1−0.777)` ≈ **4.3–4.7×** → GO
- corrected, self-consistent flash (361–376 MB/s, what the pattern actually delivered): **1.00–1.04×**
  at k≥8; 0.65× at k=4; 0.33× at k=2
- corrected, optimistic (flash at the cell's own best 634 MB/s): **1.27–1.31×** (k=8) to **1.69–1.76×**
  (k=∞)
- first-prompt (cold, long context) reference: pp128 r1 0.19 / pp2048 3.6-model-volume reads → more
  I/O-pinned, not less.

**No assumption branch reaches 2×.** The GO cannot be supported by this cell under any reading of its
own raw data.

---

## FINAL LINE: **BANK-BLOCKED**

Reasons:
1. The gate metric's mapping `share → 1/(1−share) → ceiling` presupposes serialized compute-after-I/O;
   the cell's own monotonic parallel utime+read_bytes columns show overlap, so the honest ceiling is
   `wall/max(I/O floor, compute/k)` = **≈1.0–1.8× on every assumption branch, below the 2× GO bar**.
2. "Warm" is not residency: warm prefilles re-stream 0.80–0.88× the model (page cache retains
   10–20 %); the rule keys on warm pp512 while the product's first prompt is cold and worse
   (pp128 r1 0.19; pp2048 at 3.6 model volumes).
3. Cold reps are contaminated (inventory sha256 pre-warmed the model; 30 s cooldown ≠ eviction),
   acknowledged in the cell itself.
4. 11 % of counted busy time is kernel stime (corrected matmul share ≈0.68–0.76), and the
   pp2048-rep3 datapoint is throttling-contaminated (36 °C, rising ticks with falling MB/s).
5. The streaming-into-NPU tiling pass (~0.3–1.0 GB/s per core) is entirely unrepresented and is
   in the same order as the math being offloaded.

The raw data is good, reproducible, and reusable — the **measurement** survives the audit; the
**decision mapping** does not. The multi-week kernel commitment must not be granted on this cell.

Re-gate (cheap): on the v75 Xiaomi, run pp512×3 (`-lm mmap -nr 1 -ngl 0`) on a model ≥ ~1.2× usable
RAM with a readable `/proc/pressure/io`; record per-rep `read_bytes`. If warm `read_bytes ≈ 0` →
RAM-resident, compute-bound regime, re-gate on the CPU-time fraction; if `≈ model size` → streaming
persists, use `ceiling = wall / max(read_bytes/ftash_bandwidth, compute/k)` and require ≥2× there
before GO.

---

Sources (device/SoC characteristics, not measured in the cell):
- Unihertz Jelly Star official: 8 GB RAM, UFS 2.2 (https://www.unihertz.com/products/jelly-star)
- MediaTek Helio G99 MT6789: 2× C-A76 @2.2 GHz + 6× C-A55 @2.0 GHz (https://www.mediatek.com/products/smartphones/mediatek-helio-g99)
