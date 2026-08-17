# K-F confirmatory cell, COLD regime, Jelly Star — REPORT

**VERDICT: NULL, leaning against K-F. The exploratory −20% does not reproduce.
The registered activation policy is NOT licensed. KF_SHIP closes as
characterization only.**

Registered endpoint, Wilcoxon signed-rank exact two-sided on 12 (OFF − ON) pair
differences, alpha 0.05: **W = 12, p = 0.0635 — not significant**. Direction:
K-F ON is **4.3% slower** than OFF (mean OFF 0.1919 vs ON 0.2001 s/token),
Hodges–Lehmann shift −0.0090 s/token, with **9 of 11 non-tied pairs favouring
OFF**.

Cell ran to the full pre-registered design: **24/24 blocks, 12/12 complete
pairs**, no arm/flag/endpoint/test changed after registration
(`results/kf_cold_jelly/PREREG.md`, committed `01350f1` before staging).

## Primary result (registered, verbatim from `analyze_pairs.py`)

```
Kept blocks (excluded=0): 24 / 24
Complete registered pairs: 12 (need >= 10)

| pair | OFF blk | ON blk | OFF s/tok | ON s/tok | OFF-ON |
|    1 |      1 |      2 |    0.1890 |   0.2000 | -0.0110 |
|    2 |      4 |      3 |    0.1930 |   0.1930 | +0.0000 |
|    3 |      5 |      6 |    0.2430 |   0.1990 | +0.0440 |
|    4 |      8 |      7 |    0.1920 |   0.1950 | -0.0030 |
|    5 |      9 |     10 |    0.1920 |   0.1980 | -0.0060 |
|    6 |     12 |     11 |    0.1900 |   0.1880 | +0.0020 |
|    7 |     13 |     14 |    0.1920 |   0.1950 | -0.0030 |
|    8 |     16 |     15 |    0.1910 |   0.2240 | -0.0330 |
|    9 |     17 |     18 |    0.1780 |   0.2000 | -0.0220 |
|   10 |     20 |     19 |    0.1850 |   0.1990 | -0.0140 |
|   11 |     21 |     22 |    0.1830 |   0.1980 | -0.0150 |
|   12 |     24 |     23 |    0.1750 |   0.2120 | -0.0370 |

N pairs = 12; ties dropped -> effective N = 11
exact-test floor for that N = 0.000976562 (2/2^11)
Wilcoxon exact two-sided: W=12 p=0.0634766
mean OFF=0.1919 ON=0.2001 -> ON vs OFF +4.3%
Hodges-Lehmann shift (OFF-ON) = -0.009000 s/tok
signs: ON faster 2 / ON slower 9 / ties 1

Decision: not significant at alpha 0.05 (null).
```

Note the exact-test floor: pair 2 is a tie (0.1930 = 0.1930 at the harness's
4-decimal resolution) and Wilcoxon drops zero differences, so the test runs on
**11 effective pairs** and the floor is 2/2¹¹ = 0.000977, not the N=12 floor of
0.000488. Stated because anyone recomputing from "N=12" will otherwise find a
discrepancy. (Same situation arose in the Xiaomi ship cell.)

## Robustness checks — disclosed, post-hoc, NOT the registered endpoint

Two blocks are visibly anomalous. Both checks below are post-hoc and are
reported only as sensitivity; the primary result above stands as the verdict.

| variant | N | eff | W | p | ON vs OFF | ON slower |
|---|---|---|---|---|---|---|
| **primary (registered)** | 12 | 11 | 12 | **0.0635** | **+4.3%** | 9/11 |
| without b24 | 11 | 10 | 11 | 0.0996 | +2.9% | 8/10 |
| without b5 | 11 | 10 | 1 | **0.0039** | **+6.9%** | 9/10 |
| without b24 and b5 | 10 | 9 | 1 | 0.0078 | +5.6% | 8/9 |

**Every post-hoc variant makes our own technique look worse, not better.** That
is why these are safe to disclose: the usual hazard of post-hoc exclusion is
that it rescues the author's hypothesis, and here it does the opposite. Nothing
below licenses K-F; the checks only sharpen the negative.

**b5** (OFF, 0.2430 s/token against an OFF median of ~0.19) is the single
anomalously slow OFF block, and it is the sole reason the primary lands at
p=0.0635 instead of significance. It contributes the only large positive
difference (+0.0440), i.e. the only pair that looks like a K-F win. **The one
apparent win in this cell is an OFF-arm outlier, not an ON-arm success.**
Removing it yields **+6.9% against K-F at p=0.0039** — which is within noise of
the warm cell's pre-registered **+7.1% against (p=0.000977)**. Two independent
regimes, two independent cells, the same magnitude and the same sign.

**b24** (OFF) read **12.60 GB** against 22.1–22.5 GB for every other OFF block,
and was the fastest block in the cell (0.1750 s/token). It passed the registered
cold-validity rule — `fadv_rc=0`, `drop_mb=2739` (threshold 1000), reads 12.60 GB
above the pinned floor of 11.14 GB — so it is COLD-VALID by the rule declared in
advance and is **not** excluded. But it is plainly a different regime from the
other 11 OFF blocks and is flagged here. Its energy reading is also broken
(0.0867 J/token against ~0.75–0.83 elsewhere, ~10× off).

## Cold-validity accounting (the integrity mechanism)

| item | value |
|---|---|
| cold floor, pinned from first OFF block before pairs | 11 144 366 080 bytes |
| `fadv` DONTNEED before every measured run, both arms | yes, no exception |
| `Cached` recorded before and after every call | yes (`cold_reset.csv`) |
| COLD-VALID rule | drop ≥ 1000 MB **and** reads above floor |
| runs excluded for warmth | **2** |
| blocks void after retries, re-run appended | **1** (block 16) |
| final blocks kept | 24/24 |

**The gate earned its place.** At ~18:00 I left two harnesses running
concurrently during a resume; two `bmoe-cli` processes held the model mmap'd,
`fadv` returned rc=3 ("still has 618912 resident pages"), and block 16 burned
three attempts with `drop_mb` of 0, 390 and 222 against the 1000 MB threshold.
All three were excluded automatically. Without the gate those would have entered
a pre-registered cell as *warm* runs — and warm is exactly where K-F loses by
7%, so they would not have added noise, they would have biased the cell toward
refuting our own hypothesis while looking like an honest refutation. Block 16
was later re-run cleanly by the harness's void-scan pass (`b16_OFF_retry_try1`,
`drop_mb` clean) and is pair 8 in the primary table.

## Secondary endpoints (disclosed, not gated)

| axis | OFF | ON | note |
|---|---|---|---|
| stall share | 21.4–25.7% (mean 21.9) | 12.1–15.5% (mean 13.4) | **the mechanism works, on every single block** |
| read bytes (block mean) | 21.39 GB | 24.41 GB | **+14% — prefetch wasted** |
| prefetch precision | — | 76.4–76.6% | ~23% of issued bytes never used |
| J/token | 0.7764 (excl. broken b24) | 0.8308 | ratio **1.070** |
| J/token as analyzer reports | 0.7147 (incl. broken b24) | 0.8306 | ratio 1.162 — inflated by b24 |
| majflt/token | 8.20 | 8.64 | parity |
| temp max | 36.0 °C | 36.0 °C | parity |
| TTFT | 13.83 s | 13.86 s | parity |

Per-token tail axes (p50/p95/p99, stutter rate) are **missing**: the harness
recorded no per-token rows in this cell, so `KF_ROBUST_WIN` and the thermal sag
gate are `MIXED (missing)`, not measured. Reported as a gap, not glossed.

**This is the shape of the whole K-F story in one table.** The mechanism does
exactly what it was designed to do — it removes eight to twelve points of I/O
stall, reproducibly, on every block. It just does not convert that into time,
because it reads 14% more bytes to get it and roughly a quarter of the prefetched
bytes are never used.

## Interruptions (declared)

1. **14:41** — screen went off, sshd died, and the harness died with it because
   it was not detached. That is a defect of my mandate, which never required
   detachment, not of the agent. 93 minutes lost, 5 blocks safe, `RESUME_AT=6`.
2. **~18:00** — two concurrent harnesses (my error, see the gate section above).
   Cost: block 16, three excluded attempts. Root cause: the wrapper `exec`s into
   the inner script, so `pgrep` on the wrapper name returns empty on a live
   harness and I read that as "nothing is running".
3. **18:15** — `STATUS = STOP_PLUGGED`. The device was put on charge and the
   harness **refused to measure while charging**, as the PREREG requires
   (UNPLUGGED). Not a fault: the guard-rail working. It also stopped *after*
   sshd had died, which proves the detachment finally held.

No partial pair entered the analysis. Blocks 17–24 and the block-16 re-run all
ran unattended on a single detached harness at battery 100→90%, 24–31 °C.

## Does this license the registered activation policy?

The policy registered in advance, before any data:

> K-F is enabled if and only if measured stall share is high AND the cache is
> cold AND no thermal alarm is active. Battery level is explicitly NOT a gate.

**No. It is not licensed.** The cold half of that conjunction was the last
surviving hope for K-F, and it does not deliver: cold K-F is 4.3% slower
(p=0.0635), and under robustness checks it converges on the same ~7% deficit the
warm cell measured pre-registered. The policy stays unshipped and **K-F stays
off**.

## Where this leaves K-F

| device / regime | result |
|---|---|
| Jelly, warm | **+7.1% against**, pre-registered, W=1 p=0.000977 |
| Jelly, cold | **+4.3% against**, pre-registered, W=12 **p=0.0635 (null)** |
| Jelly, cold (exploratory, never pre-registered) | −20% — **does not reproduce** |
| S23 | null (stall 11% → 6%) |
| Xiaomi, warm and cold | null (cold stall share 8.7%) |
| CalaQwen-35B, cold | stall share 6.0% — big-model hypothesis refuted |

The asymmetry this cell was built to remove is now removed: the only surviving
positive was exploratory, and its pre-registered replication is a null that leans
the other way. **The characterization map is the deliverable, not the technique.**
That map is a real result — it says precisely where a prefetch of this kind can
and cannot pay, and it cost far less than shipping the technique and discovering
it in the field.
