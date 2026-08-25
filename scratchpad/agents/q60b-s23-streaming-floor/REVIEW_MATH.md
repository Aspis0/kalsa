# q60b hostile pre-bank audit — REVIEW_MATH

Audited: `scratchpad/agents/q60b-s23-streaming-floor` (PREREG lock `9e2b6b36`), read-only, 2026-08-25.
Method: every claimed number recomputed from `raw/*.sampler.csv` (first→last row deltas: utime/stime
ticks, majflt, read_bytes, psi_*), `raw/*.stdout.jsonl` (`samples_ns` → wall), `run.json`,
`guard.log`, `manifest.json`; headroom tables recomputed at three rate conventions
(cell-best 1157.377 MB/s, per-rep self rate, io_gate seq-median 430.223 MB/s) and under a
user-compute-only model; cross-checked against the q60 (Jelly, UFS 2.2) cell and
`results/io_gate/{s23_ufs31,xiaomi_ufs4}/summary.txt`.

Independent recomputation of the 9 final2 reps reproduces every REPORT.md value **bit-for-bit**
(wall, utime, stime, busy_frac_8t, stime_frac_8t, read_MB, MB/s, majflt, both headroom tables,
best rate, wording). No fabrication, no arithmetic error, no cherry-picked reps (the two failed
probe launches are excluded in `run_records.json` and their samplers are single-row — correct).

---

## Point 1 — Recompute busy, stime share, read MB, MB/s, majflt; headroom at cell-best AND self-consistent

**CONFIRMED (as-measured arithmetic).** Report vs recomputed (all 9 reps) match to 6 decimals.
Representative (pp512):

| rep | wall_s | utime_s | stime_s | busy_8t | user_share_8t | stime_share_8t | read_MB | MB/s (report) | majflt | readahead kB/majflt |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| r1 | 16.007762 | 31.49 | 28.03 | 0.464775 | 0.2459 | 0.218878 | 12029.182 | 751.459 | 35734 | 329 |
| r2 | 16.639369 | 33.55 | 29.53 | 0.473876 | 0.2520 | 0.221838 | 11207.922 | 673.579 | 30810 | 355 |
| r3 | 16.961654 | 34.05 | 30.83 | 0.478137 | 0.2509 | 0.227204 | 12210.602 | 719.895 | 34116 | 350 |

Headroom at cell-best 1157.376741 MB/s: **reproduces exactly** (pp512 k2 0.5379/0.5276/0.5229,
k4 1.0758/1.0551/1.0457, k8 1.5402/1.7183/1.6077 — matches claim "k2 0.52–0.54, k4 1.05–1.08,
k8 1.54–1.72").

**Self-consistent headroom (each rep at its own MB/s, per the q60 audit convention): io_floor =
wall by construction → headroom = wall/max(wall, compute/k) = 0.87–1.00 for every rep, every k.**
The k2 column of the report (0.52–0.54) therefore means "compute at 2× still cannot reach wall —
I/O is binding", not "the machine is 0.5× slow", and the difference between the two tables is
entirely the rate assumption: the device delivers 674–751 MB/s on pp512, not 1157. The 1157 MB/s
peak is a single *warm* pp128 rep whose reads are partly page-cache hits (cache hits are not
counted in read_bytes — see Point 2), so it is an optimistic ceiling, not a sustained rate.

**Second finding (phase mixing):** read_bytes is a **per-launch** counter, the bench wall is the
**eval-only** window. Every launch contains a full-file prefetch burst before the eval starts
(5.2–6.6 GB at ~730–1100 MB/s, utime frozen, majflt ≈ 0 — kernel readahead/WILLNEED signature,
not user-space reads). MB/s = total_read/wall therefore blends a ~1 GB/s load pass with the
eval-phase re-read pass:

| rep | load_MB (prefetch) | eval_MB (re-read) | eval rate MB/s | eval re-read × model |
|---:|---:|---:|---:|---:|
| n128 r1 | 6583 | 5787 | 312 | 0.89× |
| n128 r3 | 5217 | 5609 | 600 | 0.86× |
| n512 r1 | 5736 | 6293 | 393 | 0.97× |
| n512 r3 | 5795 | 6415 | 378 | 0.99× |
| n2048 r1 | 6231 | 23674 | 253* | 3.64× |
| n2048 r3 | 5703 | 25156 | 277* | 3.87× |

*pp2048 eval_MB spans two eval-equivalent passes — see Point 2.

So "1.8× model per rep" (pp512) decomposes as ≈0.98× load prefetch + ≈0.9× eval re-read;
"4.7×" (pp2048) as ≈0.96× + ≈3.7×.

## Point 2 — Is read_bytes counting cache re-reads (thrash)? majflt×4 KB vs read_bytes; pp2048 30 GB; design implication

**CONFIRMED — the excess reads are re-fetches of evicted pages, with readahead amplification.**

- majflt × 4 KB: pp512 = 124–144 MB vs read_bytes 11.2–12.2 GB → read_bytes is **~85× larger**.
  Per-major-fault readahead granularity: 240–355 kB/fault (n128/n512), **90–107 kB/fault (n2048)**.
  read_bytes is therefore readahead-amplified, not 4-kB page-ins — the check asked for, and it
  confirms the fetch path is kernel readahead, not single-page faults. The shrinking readahead
  window at pp2048 (355→100 kB) is the signature of a random-ish re-touch pattern killing
  sequential prefetch. Four-kB interpretation would be REFUTED; readahead-amplified re-reads CONFIRMED.
- Mechanism: model 6.51 GB > MemAvailable 4.5–4.7 GB; per-launch prefetch (≤6.58 GB, cold) then
  eval re-touches pages evicted mid-pass. PSI `some avg10` reaches 8–20% during runs — the kernel
  is actively reclaiming cache while the prefill runs.
- Batch scaling: eval-phase re-read per token is **flat** — n512: 11.3–12.5 MB/tok,
  n2048: 11.6–12.3 MB/tok — while the **total re-read multiplier grows 0.9× → 3.7×** and the
  delivered eval-phase rate collapses 393 → 253 MB/s. Working set > cache ⇒ re-read multiplier
  grows with batch. CONFIRMED.
- **New finding the cell missed:** every pp2048 launch contains a systematic **untimed
  eval-equivalent phase**. Sampler window vs bench wall: r1 197.5 vs 93.5 s (extra 104 s),
  r2 231.8 vs 102.0 (extra 130 s), r3 182.6 vs 90.9 (extra 92 s) — for n128/n512 the extra is
  only 6–13 s. utime and read_bytes keep growing across the extra phase at eval-like rates
  (n2048 r1: ~14 GB @ ~147 MB/s untimed + ~9 GB @ ~95 MB/s timed; both ≈ 11.6 MB/tok).
  Either llama-bench on this pinned build (7686ca6fc, `--no-warmup`) decodes the 2048-token
  prompt twice, or the model's MTP/trunk block adds an untimed pass. Mechanism unverified, but
  the 30 GB/launch is real **per launch**; only ~9–14 GB belongs to the timed eval (1.4–2.1×),
  and "MB/s 300–340" for pp2048 blends load + two eval passes over the single timed wall.
- **Streaming-design implication:** a 6.5 GB file cannot be resident on a 7.2 GB device; any
  streaming design must (a) schedule layer-local double-buffering (hold one layer's routed-expert
  pages, prefetch the next layer while computing) so a page is never refetched twice per prefill,
  (b) keep batches ≤ ~512 tokens unless the fetch loop is re-read-aware, and (c) treat the pp2048
  behaviour (100-kB readahead, 100–150 MB/s) as the thrash-regime floor to design against.

## Point 3 — User-vs-kernel decomposition; NPU headroom with user-compute-only

**CONFIRMED.** User share of 8×wall: n128 0.064–0.109 (6–11%), n512 0.246–0.252 (25%),
n2048 0.198–0.286 (20–29%). Stime share: 0.169–0.290 / 0.219–0.227 / 0.073–0.121. The remainder
(0.53–0.77) is I/O-stall (flash/DRAM wait), NOT spare compute. Only the user share is
matmul-accelerable; stime (page-fault processing) and the stall stay on the CPU.

NPU headroom, user-compute-only (`wall / max(io_floor, utime/k)`, k=2):

| rate convention | n128 | n512 | n2048 |
|---|:---:|:---:|:---:|
| **self-consistent** (per-rep achieved) | 1.00 | 0.99–1.00 | 0.87–1.00 |
| cell-best 1157 MB/s | 1.93–3.71 | 0.99–1.02 (k2), 1.54 (k4) | 1.17–1.26 (k2), 3.4–3.9 (k8) |
| io_gate 430 MB/s | 0.72–1.38 | 0.99–1.24 | 0.87–1.77 |

With the eval-phase-only read floor (the load prefetch amortizes in a resident design):
k2 headroom 1.9–3.7× (n128) and 2.9–3.3× (n512) **only if** the re-read stream actually ran at
1157 MB/s — which the device does not deliver on pp512 (674–751 MB/s) nor on pp2048 (243–277).

**Honest headroom (user-compute-only, this device): ≈1.0–1.3×.** The wall is set by the flash/
fault path; removing user matmul does not move it. The k8 values in the report (1.54–3.19) are
real arithmetic but describe a fantasy rate corner; stime+stall dominate at every batch size.

## Point 4 — Cold vs warm: was the protocol effective? is "warm" meaningful?

**CONFIRMED — protocol followed; warm is weakly meaningful on this device.**

- Protocol as locked: model hashed before idle (sha `bd63fc0f…` in inventory, matched to the
  run-time binary check), ≥600 s no-touch idle before each r1 with **guard-epoch gaps 627 s and
  632 s** (n512 r1, n2048 r1) — the ≥600 s claim verifies; separate `-r 1` launches per rep —
  verified in `run.json` (`workload` arrays); r1 genuinely cold: cold n128 r1 prefetched
  6.58 GB ≈ 1.01× file vs 5.22–6.13 GB on warm reps (the ~0.4–1.3 GB delta = surviving cache tail).
- read_MB cold vs warm: n512 12029 → 11208/12211 (**no reduction**); n2048 29904 → 30586/30860
  (flat); n128 12371 → 12290/10825 (−12% on r3). The page cache retains ≤ ~1.5 GB of a 6.5 GB
  file on this device, so "warm" barely changes the flash volume — the PREREG's premise
  ("cache holds little of a 6.5 GB file anyway") is confirmed.
- "Warm" is still meaningful where it shows: n128 eval-phase rate 312 → 600 MB/s (r1→r3) — the
  18.6 s → 9.35 s wall gap is real cold-vs-warm eval behaviour, though n128 r1 also carries
  day-first-launch overhead (launcher 52.2 s vs 23.7–30.3 s later; 27 s extra window vs 6–13 s).
  For n512/n2048 cold vs warm wall barely moves (16.0/16.6/17.0; 93.5/102.0/90.9). Cold-designated
  labels are honest; they just encode little on this device.

## Point 5 — Frozen wording: "mixed" 0.622

**CONFIRMED as written.** pp512 warm ratios at cell-best rate: r2 9.683901/16.639369 = 0.58196,
r3 10.550240/16.961654 = 0.62200 → mean 0.601996, median 0.622005; classify(): ≥0.8 → flash-bound,
≤0.5 → compute-bound, else mixed → **"mixed"** exactly per the frozen thresholds.
Caveat (not an arithmetic error): the ratio input uses the cell-best 1157 MB/s. At the
self-consistent rate all three pp512 ratios = 1.0 (flash-bound); at the device's own io_gate
430 MB/s they are 1.57–1.75 (flash-bound). "Mixed" is an artifact of the optimistic rate corner;
under any non-optimistic convention the frozen thresholds read **flash-bound**.

## Point 6 — Cross-device: Jelly UFS 2.2 vs S23 UFS 3.1; UFS 4.0 extrapolation

**CONFIRMED + extrapolation.** q60 Jelly (UFS 2.2, 10.51 GB model vs 5.54 GB usable): pp512 warm
read 8.4–9.2 GB (0.80–0.88×, re-streamed) at 361–376 MB/s; self-consistent headroom 1.00–1.04×,
NO-GO per its audit. q60b S23 (UFS 3.1, 6.51 GB vs 4.53–4.73 GB usable): pp512 read 11.2–12.2 GB
(1.72–1.88×) at 674–751 MB/s.

- Faster flash moved the **absolute delivered rate ~1.9×** (361→674+ MB/s) but NOT the
  self-consistent headroom (≈1.0 both devices): the workload self-paces at its own delivery rate,
  so headroom only materialises against an *external* rate yardstick (gate or design rate).
  Flash generation does change *which* term binds: Jelly (slower flash, denser model) shows
  compute_share 0.77; S23 shows 0.47 busy (0.25 user) — the S23 is more I/O-pinned.
- UFS 4.0: measured device reference `results/io_gate/xiaomi_ufs4/` — seq median **2046 MB/s**,
  rand 1543 MB/s (vs S23 430/407). Extrapolation, user-compute-only, assumptions stated: (1) same
  RAM (≈4.5–4.7 GB usable) → same re-read volumes; (2) pattern/seq ratio transfers from S23
  (pp512 ≈ 1.57×, pp2048 ≈ 0.58× of gate — measured, not assumed); (3) NPU removes all utime
  (generous, zero-cost); (4) stime and page-fault behaviour unchanged.

| workload | UFS 4.0 rate (pattern) | I/O floor | user wall-share | projected wall | headroom vs S23 |
|---|:---:|:---:|:---:|:---:|:---:|
| pp512 r1 | 3.21 GB/s (1.57×) | 3.7 s | 3.9 s | ~4–5 s | **3.2–4.1×** |
| pp512 r1 | 2.05 GB/s (1.0×) | 5.9 s | 3.9 s | ~6–7 s | **2.3–2.7×** |
| pp512 r1 | 1.19 GB/s (0.58×) | 10.1 s | 3.9 s | ~10–11 s | **1.5–1.6×** |
| pp2048 r1 (full launch) | 1.19–3.21 GB/s | 9.3–25.2 s | 19.9 s | 20–26 s | **3.5–4.7×** |

pp512 range: **~1.6–4.1×, central ≈2.5–3×; with the user matmul term (3.9–4.3 s) binding once
flash clears ~4 s, the practical UFS4+NPU ceiling for pp512 is ≈3–4×** — at which point compute
supersedes flash as the binding term (assuming the double-decode is fixed/irrelevant for pp2048,
otherwise ~3.5×, user-term-bound at 20–26 s). The throughput gain from UFS 2.2→3.1 was ×1.9;
UFS 3.1→4.0 (430→2046 MB/s gate) is ×4.8 raw, but the re-read multiplier (cache-size-bound) does
**not** improve, and the thrash-regime pattern ratio (0.58×) caps pp2048-style batches near
1.2 GB/s regardless of the gate number.

**Settling measurement (one, cheap):** on the v75/UFS 4.0 device run the same cell once —
pp512×3 + pp2048×1 cold protocol on a model ≥1.2× usable RAM, `-lm mmap -nr 1 -ngl 0`, with
per-launch read_bytes, utime/stime split, majflt, sampler window vs bench wall (double-decode
check), and a readable /proc/pressure/io. If warm read_bytes ≈ model size → streaming persists →
headroom = wall/max(readGB/V_pattern, ut/8, st/8) with V_pattern measured in-run (self rate) and
vs a fresh io_gate (2046 MB/s device); if warm read_bytes ≈ 0 → RAM-resident, re-gate on the
CPU-time fraction instead.

## Point 7 — REPORT.md overclaim / misread risk

**PLAUSIBLE — nothing is fabricated and nothing states GO/NO-GO, but three lines invite misreading:**

1. `pp512_warm_wording = mixed` + the headroom k-columns sit in REPORT.md with **no legend and no
   "this cell does not decide" disclaimer** (that text lives in PREREG.md/RUN_LOG.md only). k8
   values of 1.54–1.72 (pp512) and 2.79–3.19 (pp2048) are exactly what a reader would grab as an
   NPU-GO signal — the q60 failure mode. The wording is also convention-dependent (Point 5).
2. `best_sustained_cell_MB_s = 1157.4` — one warm pp128 rep; "sustained" overstates.
3. MB/s column is total-read/bench-wall (Point 1/2: includes the ~1 GB/s load prefetch and, for
   pp2048, an untimed second eval pass); the io_gate columns print without the `comparable=0`
   flag (RUN_LOG only); the pp2048 double-decode is absent from `anomalies`.
4. Minor: cold-designated labels without the caveat that warm ≠ residency here
   (file = 1.4× usable RAM); n128 r1's cold penalty is partly day-first-launch.

---

## Corrections to apply before banking (all derivable in-repo; no re-run strictly required for pp512/pp128, one probe recommended for pp2048)

- **C1 (labels).** State that read_MB/MB/s span load-prefetch + eval (and pp2048's untimed pass);
  add the eval-phase split columns (312–393 MB/s n128/n512; ~95–277 MB/s n2048 phases).
- **C2 (pp2048 double-decode).** Explain or probe the untimed 92–130 s eval-equivalent phase
  (strace `-p 2048` on the pinned binary, or check llama-bench 7686ca6fc for multi-ubatch/MTP
  behaviour). Until resolved, pp2048 rows are launch-level, not eval-level, metrics.
- **C3 (headroom).** Publish the self-consistent table (all ≈1.0) next to the cell-best table and
  mark k<1 cells as "compute-not-binding", k≥1 as "I/O-floor-capped"; state the rate convention
  on every headroom number.
- **C4 (wording).** "mixed" → "mixed (cell-best-rate convention); flash-bound under self-consistent
  and io_gate conventions".
- **C5 (REPORT.md hygiene).** Add the no-decision sentence + column legend + `comparable=0` for
  io_gate; rename best_sustained → best_observed (warm pp128).

## FINAL LINE: **BANK-with-corrections** (C1–C5 above)

All claimed numbers reproduce bit-for-bit from raw CSVs/jsonl; protocol claims verified (hash
before idle, 627/632 s idles, 0 guard kills, battery 67→62 % unplugged, PSI readable, probes
excluded, launcher_rc=0, no sampler errors); no fabrication or directional selection. The
corrections are interpretive: phase-mixed MB/s, the pp2048 untimed second eval pass, the
rate-convention dependence of both the headroom table and the "mixed" wording, and REPORT.md
hygiene. The cell's core physical result stands: **on 8 GB-class devices with a model > usable
RAM, prefill is flash/fault-bound (self-consistent headroom ≈1.0×; user matmul is only 6–29 % of
8×wall), and NPU-for-matmul alone buys ~nothing until the delivery path is fixed.** Honest
user-compute-only headroom on this S23: **1.0–1.3× (k=2)**; UFS 4.0/v75 projection: **≈2–3.5×
(pp512; compute-term-bound near 3–4×), ≈3.5× (pp2048)** — pending one settling measurement
(per-launch read_bytes + user/stime split + double-decode check on the target device).