# q61 hostile method audit — REVIEW_MATH (Xiaomi UFS 4.0 streaming prefill floor)

Audited read-only: `scratchpad/agents/q61-xiaomi-ufs4-streaming-floor/` (PREREG lock `e51542ed`).
Method: every published number recomputed from `raw/*.sampler.csv` (first→last row deltas at
HZ=100, threads=8), `raw/*.stdout.jsonl` (`samples_ns` → eval wall), `run_records.json`,
`raw/*.launcher.stdout.log` (guard/rc/reconnect/htp0), cooldown logs, battery logs. Headroom
recomputed under corrected wall-equivalent compute units, at four rate conventions
(self-consistent, cell-best [both the cell's 738.6 and the corrected 426 MB/s], io_gate
seq 2046/rand 1543 `results/io_gate/xiaomi_ufs4/summary.txt`). Cross-checked against the q60
(Jelly/UFS 2.2) and q60b (S23/UFS 3.1) audits.

**Reproducibility.** My independent `derive()` reproduces REPORT.md table 1 bit-for-bit (all five
runs: wall, utime, stime, read, prefetch/eval read, eval MB/s, re-read, majflt — e.g. n512 r1
wall 13.767405, ut 38.41, st 17.16, total read 12494.9 MB, majflt 524 — to 6 decimals).
`best_observed_eval_pass_MB_s = 738.613852` reproduces exactly. Nothing is fabricated; the raw
CSVs are intact and the arithmetic is faithful. The preceding audits' protocol findings
(cool-start ≤32 °C, idle ≥600 s, battery floor, T1/T2 guard, hash-then-idle, separate launches)
all verify again here (Point 7). What follows attacks the **units, the convention, and the
regime** — the numbers are real, they are used to say a specific thing, and the specific thing is
largely not supported.

---

## Point 1 — UNITS in the headroom formula — CONFIRMED (arithmetic) + the decisive bug

The published headroom (`finalize_q61.py` → REPORT.md table 2) is

    headroom = eval_wall / max(io_floor, stime + utime/k)

The `io_floor` is in **wall-seconds**; the compute term `stime + utime/k` is in **CPU-seconds
summed across the 8 threads**. The two are compared directly. For n512 r2: wall 16.012 s, but
utime 37.37 s + stime 16.52 s = 53.9 CPU-s summed; at k=2 the term is 16.52 + 18.69 = 35.21
CPU-s, which exceeds the 16 s wall exclusively because it is a per-thread sum. Dividing by 8
threads (the only honest wall-equivalent of a parallel CPU term) gives

    compute_we(k) = (stime + utime/k) / 8

| n | rep | wall_s | utime_s | stime_s | compute_we k2 | compute_we k4 | compute_we k8 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 512 | 1 | 13.767 | 38.41 | 17.16 | 4.546 | 3.348 | 2.749 |
| 512 | 2 | 16.012 | 37.37 | 16.52 | 4.401 | 3.233 | 2.649 |
| 512 | 3 | 10.047 | 38.98 | 12.07 | 3.945 | 2.727 | 2.118 |
| 2048 | 1 | 60.461 | 166.02 | 47.98 | 16.374 | 11.181 | 8.594 |
| 128 | 1 | 8.365 | 12.38 | 11.66 | 2.231 | 1.844 | 1.653 |

With the corrected term, every `wall / max(io_floor, compute_we)` ≥ 1.0 once io_floor = wall
(self convention) — **no headroom below 1.0 exists for any k, any rep.** The published
0.32–0.88 values (e.g. n512 r2 0.4548 at k2) are the pure artifact of comparing a per-thread CPU
sum to wall time; they are not "sub-unity ceilings". CONFIRMED: the cell's own unit bookkeeping
makes the headline headroom tables wrong.

Full corrected headroom table, `ceiling = wall / max(io_floor, (stime + utime/k)/8)`, k=2 per row:

| n | rep | cache | self (≡wall) | cell-best 426 | cell-best 738.6 | gate seq 2046 | gate rand 1543 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 512 | 1 | cold | 1.000 | 1.000 | 1.733 | 3.029 | 3.029 |
| 512 | 2 | warm | 1.000 | 1.265 | 2.193 | 3.639 | 3.639 |
| 512 | 3 | warm | 1.000 | 2.206 | 2.547 | 2.547 | 2.547 |
| 2048 | 1 | cold | 1.000 | 3.054 | 3.693 | 3.693 | 3.693 |
| 128 | 1 | cold | 1.000 | 1.444 | 2.504 | 3.749 | 3.749 |

(k4/k8 columns raise the gate-convention numbers toward 5–7 but never change the self/cell-best
conclusions; compute_we is small at k≥4.)

**Corrected headroom range (both conventions, user-compute-only model):**
- self-consistent: **exactly 1.00 every rep every k** (this is the tautology, Point 2)
- cell-best, honest (426 MB/s — the corrected measured best): **1.00–2.21**, pp512 warm
  **1.27–2.21 (median 1.74)**
- cell-best as-conceived (738.6, contaminated): pp512 warm **2.19–2.55 (median 2.37)**
- io_gate seq/rand (2046/1543): pp512 warm **2.55–3.64 (median 3.09)** — a bound, not a
  forecast: the eval re-read pattern does not reach gate rates (Point 3)

So the corrected pp512-warm headroom, user-only model, spans **≈1.0–2.2×** under honest
conventions and **2.5–3.6×** only if the access pattern ran at io_gate speed (it does not).
The PREREG settling thresholds (≥2.0 GO / ≤1.3 CPU / between = owner) therefore land this cell
in the **"between → owner decision" band** under the honest cell-best reading — not cleanly in
the ≤1.3 "streaming stays CPU" branch. Under the gate reading it would even cross 2.0. The
published ≤1.3 conclusion is an artifact of the unit bug + tautology.

## Point 2 — TAUTOLOGY of the "self-consistent" convention — CONFIRMED, from code

`finalize_q61.py` literally assigns

    self_io = wall                       # line ~": self_io = wall"
    row["self_consistent_io_floor_ratio"] = self_io / wall   # ≡ 1.000 always

So `pp512_warm_self_consistent_io_floor_ratio_median = 1.000000` and `classify(1.0) =
"flash-bound"` are **automatic by construction** — the "self-consistent flash-bound" wording is a
tautology and carries zero information. Confirmed: self_io_floor ≡ eval_wall (the cell "recomputes"
I/O floor as read_rate ÷ read_rate = wall). Any run of this cell would print flash-bound; it is
not a measurement.

Informative conventions here:
1. **cell-best, honest = 426 MB/s** (corrected best observed eval re-read rate, Point 3) — pp512
   warm headroom k2 = **1.27 / 2.21, median 1.74**.
2. **cell-best as-conceived = 738.6 MB/s** — median 2.37 (this 738.6 is itself contaminated, see
   Point 3/4; do not bank on it).
3. **io_gate UFS 4.0 seq 2046 / rand 1543** (results/io_gate/xiaomi_ufs4/summary.txt, verified:
   seq_median 2046.336, rand_median 1542.932, ratio 1.326) — pp512 warm k2 median 3.09, but only
   if the eval pattern ran at gate rates.
4. Honest physical floor: given the measured pattern cannot beat ~426 MB/s, the *real* I/O floor
   is ~wall at the achieved rate → **headroom ≈ 1.0 on the mmap streaming path**.

**Honest headroom under each (pp512 warm, user-only, k=2): self 1.0; cell-best 1.7; io_gate 3.1.**
The first two are the "what this cell measured"; the third is a design bound the pattern does not
satisfy.

## Point 3 — pattern vs flash: page-fault/eviction-limited, and the UFS 4.0 extrapolation was optimistic — CONFIRMED (decisive)

Delivered eval re-read rates (recomputed): Xiaomi n512 r1 426.1, r2 336.8, r3 193.1 MB/s;
n2048 139.5 (corrected — see Point 6); n128 295.0 MB/s. Gate seq is 2046 MB/s. So the eval
re-read pattern delivers **9–36 % of the UFS 4.0 sequential gate** (ratios 0.181/0.361/0.248/
0.090/0.306).

Against S23 (UFS 3.1, gate 430 MB/s, q60b): S23 n512 eval rates 378–393 MB/s (= 0.88–0.91 × its
gate); Xiaomi n512 corrected 193–427 MB/s (= 0.09–0.21 × its gate). **Absolute improvement from
UFS 3.1 → 4.0 is ≈ ×1.1 best-case (427/393), and ≈ 0.5× on the median rep** — versus a raw flash
improvement of ×4.76 (2046/430). Faster flash did NOT move the delivered byte rate on the
mmap/fault path. CONFIRMED: the limiter is the **load pattern (readahead granting, eviction,
majflt service latency)**, not flash bus bandwidth.

The cleanest evidence is internal: the **load-phase prefetch** (separate, before eval) streams at
**1821 / 1851 / 1332 / 1152 / 747 MB/s** — i.e. the *same* flash delivers ~0.9× of gate seq when
accessed sequentially at load, then collapses to 193–427 MB/s during the eval re-read. Same
device, same file, same flash: only the access pattern differs. majflt confirms the mechanism:

| run | majflt | read_bytes | bytes/fault | readahead-per-fault |
|---|---:|---:|---:|---:|
| n512 r1 | 524 | 12.5 GB | 23.8 MB | huge (≥ thousands of pages per fault) |
| n512 r2 | 590 | 11.8 GB | 20.0 MB | huge |
| n512 r3 | 598 | 5.1 GB | 8.5 MB | large |
| n2048 r1 | 117,783 | 11.1 GB | 94.6 kB | ~24 pages — readahead window collapsed |
| n128 r1 | 1,084 | 5.2 GB | 4.8 MB | large |

At n512, majflt ≈ 600 for 5–12 GB of reads: the data is served almost entirely by kernel
readahead outside the fault path (faults are ~600, not hundreds of thousands). At n2048 the same
read profile collapses to ~95 kB per fault — the same signature q60b found on S23 (90–107 kB per
fault) — i.e. the thrash regime where readahead stops and every fault pays latency. This is the
"page-fault/eviction pattern is the limit" story, and it says: **a faster flash does NOT rescue
mmap streaming; the q60b UFS 4.0 extrapolation (which scaled the 2.5–3× with sequential BW) was
optimistic and is REFUTED by direct measurement** (observed ×1.1 best; the settling claim that
"the door stays open" is not supported by this cell). The right engine to exploit UFS 4.0 is the
product's organized block reader (Point 5), not mmap.

## Point 4 — REGIME: not a clean streaming measurement; settling statement not licensed by the PREREG — CONFIRMED

- MemTotal 11,436,476 kB ≈ 11.44 GB; MemAvailable at inventory 6,051,456 kB ≈ **6.05 GB**
  (inventory_meminfo.txt); model 6.51 GB = **0.569× MemTotal** (6.51/11.44), barely 1.08×
  MemAvailable. PREREG's primary arm requires model ≥ **1.2× usable RAM**; the manifest itself
  records `no PC MoE GGUF met the clarified ≥1.2x MemTotal primary threshold; no model push`.
  So the arm actually run (6.51 GB < 11.44 GB, "secondary borderline") is exactly the regime the
  PREREG told the cell to RECORD and NOT use as the settling arm.
- Re-read (corrected split, Point 6): r1 0.90×, r2 0.83×, r3 **0.30×** model per eval pass;
  n128 0.38×. Two of three warm pp512 reps re-read **less than one model volume** — i.e. a large
  fraction of the eval was served from page cache (r2 17 %, r3 70 % cache-resident). This is not
  a streaming measurement in the q60/q60b sense (where warm re-read stayed 0.8–0.99× and the
  model was >1.4× MemAvailable). A partially cache-resident arm has a low I/O floor by
  construction, inflating any headroom figure.
- **Does the PREREG allow the settling statement on this regime? No.** The ≤1.3-stays-CPU /
  ≥2.0-GO thresholds are defined for the primary streaming arm (≥1.2× usable RAM). On the
  borderline arm the cell cannot emit "streaming stays CPU on every generation we own". And the
  corrected headroom median (1.74) actually lands in the PREREG's own "between → owner decision"
  band, not the ≤1.3 branch.

## Point 5 — Product relevance: q61 measures llama-bench mmap page-faulting, NOT the product streamer

q61 (and q60/q60b) measure **llama-bench `-lm mmap` page-fault streaming**: the kernel decides
readahead, holds the page cache, charges majflt, and the eval pass re-reads evicted pages. That
is a different access pattern from the product's **BigMoeOnEdge** engine, which does organized
block reads (io_gate uses 983040-byte ≈ 0.94 MiB blocks; S23 gate seq/rand 430/407 ratio 1.058 —
nearly seq=rand because the blocks are large and aligned). On the Xiaomi io_gate delivers
**seq 2046 / rand 1543 MB/s**.

What q61 says about the product: (1) naive mmap streaming of a >cache MoE on UFS 4.0 is
pattern/eviction-bound at ~200–430 MB/s and will not use the flash; (2) therefore an
organized block reader (as BigMoeOnEdge already is) is necessary, not optional, to exploit
UFS 4.0 — this indirectly *supports* the product's design; (3) it does **not** measure the
product's reader, so nothing here bounds the product streamer's achievable MB/s or its compute
share.

What would settle the product question (one cheap measurement, on the Xiaomi): run the same
sampler (per-launch utime/stime/majflt/read_bytes + wall) but with the **product's block-read
path** (organized ~1 MiB pread) pulling the same 6.5 GB model, `-ngl 0`, no page-fault flood.
Record the delivered MB/s and the user-compute share. That is the number that feeds the HVX
headroom under the real streamer; this cell cannot supply it.

## Point 6 — pp2048 untimed pass + majflt explosion — CONFIRMED

Sampler window 93.25 s vs eval wall 60.46 s → **1.54×, 32.8 s untimed extra** (q60b C2
double-decode signature; same artifact seen on S23 at pp2048). The pp2048 row is a
**launch-level** metric, not an eval-level one: utime/stime/read_bytes/majflt accumulate over
the full ~93 s window, so `user_share_8t = 166.02/(8×60.46) = 0.343` mixes the untimed pass into
the "eval" denominator. majflt 117,783 (vs ~600 at n512, a ~200× jump): what changed is the
re-read volume (corrected 1.30× model) and the readahead collapse to ~95 kB/fault — the pp2048
working set thrashes the cache mid-pass and the kernel falls back to paying per-fault latency,
dropping delivery to ~139–184 MB/s. The n2048 row should be excluded from the headroom verdict or
explicitly marked launch-level (q60b flagged the identical problem).

## Point 7 — Protocol verification — CONFIRMED (all pass)

- Cool-start ≤32 °C: pre temps 27.2/27.9/28.4/28.4 °C; cooldown logs start 28.2/29.2/29.9 °C; max
  in-session 29.7 °C. ✓
- Battery: 78 → 75 %, floor 45 %, `plugged=false`, `ac/usb/wireless/dock powered=false`
  throughout every battery log. ✓
- Guard T2: PASS (guard rc 0, workload rc 0, KILL threshold 430, samples 271/79, MAX logged;
  htp0=false). ✓ Guard T1: PASS (killed at threshold, guard rc 2, workload rc 137; rehearsal with
  HTP-linked binary explicitly excluded, valid T2 uses kalsa16 CPU/OpenCL build). ✓
- Hash-then-idle: each r1 has `model_sha256_before_idle` set + identity with inventory sha
  `bd63fc…feeb419`; idle gaps measured 602–603 s ≥ 600 s no-touch before every r1 (cooldown logs:
  n512 10:02, n2048 10:03, n128 10:02). ✓
- No reconnects: `adb_reconnect_attempts=0`, `adb_disconnect=false` in **all five** launcher
  manifests; `-ngl 0`, `-mmp 1`, `-nr`, `-t 8`, CPU-only, no NPU/GPU flags; binary sha
  `b2ae0fa6…` = inventory. ✓
- Anomaly honesty: psi unreadable (documented), recorder-run-1 salvage (documented, no rerun) —
  both disclosed. ✓

---

## Corrected tables (from raw CSVs, recomputed)

**Corrected prefetch/eval split** (the cell's clock-offset subtraction pushed `eval_index` to 0 on
4/5 runs → prefetch=0 and eval_read = whole-launch read; nearest-marker split is the honest one):

| n | rep | cache | prefetch_MB | eval_corr_MB | eval_rate_corr MB/s | re-read_corr × | cache-resident (eval) |
|---|---:|---:|---:|---:|---:|---:|---:|
| 512 | 1 | cold | 6628.7 | 5866.2 | 426.1 | 0.901 | ~10 % |
| 512 | 2 | warm | 6434.6 | 5392.1 | 336.8 | 0.828 | ~17 % |
| 512 | 3 | warm | 3158.9 | 1940.4 | 193.1 | 0.298 | ~70 % |
| 2048 | 1 | cold | 2713.2 | 8433.9 | 139.5* | 1.296 | ~0 |
| 128 | 1 | cold | 2763.1 | 2467.6 | 295.0 | 0.379 | ~62 % |

\* includes untimed-pass contamination (Point 6). The published 738.6 "best eval pass" is the
r2 whole-launch read / eval wall — not an eval-only rate.

**Corrected headroom, user-compute-only ((stime + utime/k)/8), k=2** — see table in Point 1.
Key values: pp512 warm self **1.000** (tautology), cell-best-426 **1.27/2.21 (median 1.74)**,
cell-best-738.6 **2.19/2.55**, io_gate 2046 **2.55/3.64**.

---

## Conclusion

- **Point 1 (units): CONFIRMED.** Compute term was CPU-seconds-over-8-threads vs wall; corrected
  headrooms are ≥1.0 everywhere; the 0.32–0.88 table is a unit artifact.
- **Point 2 (tautology): CONFIRMED.** `self_io = wall` in `finalize_q61.py`; "self-consistent
  flash-bound" is automatic. Informative conventions: cell-best (426 honest / 738.6 as-conceived)
  and io_gate.
- **Point 3 (pattern vs flash): CONFIRMED.** Eval re-read = 9–36 % of UFS 4.0 gate vs load
  prefetch at 90 % of gate; S23→Xiaomi absolute gain ≈×1.1 on raw ×4.76 flash. Faster flash does
  not rescue mmap; the q60b UFS 4.0 extrapolation (2.5–3×) was **optimistic**.
- **Point 4 (regime): CONFIRMED.** 0.569× MemTotal, 0.3–0.9× re-read (partially cache-resident);
  settling statement on an arm PREREG points as "record, don't settle".
- **Point 5 (product): NOT measurable here.** q61 ≠ product streamer; needs the block-read
  measurement on the Xiaomi.
- **Point 6 (pp2048): CONFIRMED** launch-level; majflt 200× jump = readahead collapse/thrash.
- **Point 7 (protocol): CONFIRMED** clean.

**Net physical result that survives:** on the mmap page-fault path, UFS 4.0 does not change the
streaming-preflooor floor — the eval re-read is eviction/readahead/pattern-bound (~200–430 MB/s),
not flash-bound. That *strengthens* the case that the product needs its organized block reader
and that NPU-for-matmul alone (on the mmap path) buys ≈×1.0–1.7. It does **not** support the
published numeric "≤1.3 → streaming stays CPU" (that came from a unit bug + tautology on a
non-licensed regime), and it **refutes** the q60b UFS 4.0 extrapolation as an accelerator.

---

## FINAL LINE: **BANK-with-corrections**

The measurement (raw numbers, protocol, reproduction) is clean — no fabrication, no directional
selection, no protocol breach. Corrections before the numbers leave the bank:

1. **C1 — headroom units:** recompute with `(stime + utime/k)/8`; publish both corrected
   conventions (self 1.00; cell-best honest 1.27–2.21 pp512 warm, median 1.74; io_gate
   2.55–3.64 as a pattern-unreachable bound). Delete the sub-unity ceiling cells.
2. **C2 — tautology:** label self-consistent as "by-construction = wall"; remove "flash-bound"
   as a find. State cell-best and io_gate as the informative conventions.
3. **C3 — prefetch/eval split:** redo with nearest-marker (no clock-offset); publish corrected
   eval rates (193–427 MB/s), re-read ≤0.9× warm/0.30× r3, cache-residency column.
4. **C4 — pp2048:** mark launch-level (1.54× sampler):wall); exclude from headroom verdict until
   the untimed pass is explained/probed (same as q60b C2).
5. **C5 — settling statement:** downgrade to "borderline secondary arm (0.57× MemTotal,
   partially cache-resident): owner-decision band (corrected median 1.74); primary ≥1.2× arm not
   run; UFS 4.0 extrapolation not supported — need product block-read measurement".

(Bank status: with C1–C5 the cell becomes a valid characterization of *mmap* streaming on the
Xiaomi, pattern-bound at ~200–430 MB/s — not a settling measurement for the HVX decision, and not
a UFS 4.0 endorsement.)

Sources: q60 `scratchpad/agents/q60-streaming-prefill-amdahl/REVIEW_MATH.md`; q60b
`scratchpad/agents/q60b-s23-streaming-floor/REVIEW_MATH.md`; `results/io_gate/xiaomi_ufs4/
summary.txt` (seq 2046.336 / rand 1542.932 / ratio 1.326) and `s23_ufs31/summary.txt`
(seq 430.223 / rand 406.625 / ratio 1.058); BigMoeOnEdge `core/src/moe/expert_stream_source.cpp`
and `core/src/io/file_reader.*`; io_gate tool `results/io_gate/` (983040-byte blocks).
