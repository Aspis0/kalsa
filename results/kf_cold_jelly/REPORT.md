# kf_cold_jelly — pre-registered COLD confirmatory cell: NULL

**Pre-registered verdict: NULL. The exploratory −20 % did not reproduce.**
Wilcoxon exact two-sided on the 12 registered (OFF − ON) pairs:
**W=12, p=0.0635 — not significant at alpha 0.05.** One tie dropped →
**effective N=11**, exact-test floor for that N = **0.000977** (`2/2^11`).
Point estimate: ON is **+4.3 % slower** than OFF (mean 0.2001 vs 0.1919
s/tok). Signs: 9 against, 2 for, 1 tie. Hodges–Lehmann shift (OFF−ON) =
−0.009 s/tok (ON slower). Registration: `PREREG.md`, commit `01350f1`.

This closes `KF_SHIP` as **characterisation only**. The registered
activation policy is **not licensed**.

## Pins (verified on device before block 1)

| pin | value |
|---|---|
| K-F binary | `~/bin/kernel_kf/bmoe-cli` sha `77a94640a56a904301de93ee4c7d74cc7fbb1cc884c2302901d8f173fe3e713e` — carries `--kf-prefetch`; the arm is the flag |
| campaign pin | `~/bin/bmoe-cli.JELLY` sha `36b01966…` (not used as the A/B binary) |
| model | `Marco-Mini-Instruct-KEXP.gguf` sha `2f921958…` size 6385238848 |
| prompt | `p_fact.txt` sha `b5301c32…` |
| start | UNPLUGGED, batt 96 %, 29 °C (block-1 start ≤ 33 °C) |

`~/bin/bmoe-cli` and `bmoe-cli.JELLY` (402 416 B) are the campaign pin and
do **not** carry `--kf-prefetch`. `bmoe-cli-kvfix` does not either. No
substitution was made.

## Cold floor (declared 14:22:15, before remaining pairs)

Pinned from first COLD-VALID OFF (`b1_OFF_try1`):

| pin | value |
|---|---|
| first OFF `read_bytes` | 22 288 732 160 (22.289 GB) |
| **COLD_READ_FLOOR** | **11 144 366 080 bytes** (50 %) |
| first OFF Cached drop | 3884 MB; fadv `resident_after=0` |

A later run is COLD-VALID iff Cached drop ≥ 1000 MB **and**
`read_bytes ≥ 11144366080`.

## Cold-validity accounting

| | n |
|---|---|
| kept COLD-VALID blocks | **24 / 24** (every registered order_idx has an `excluded=0` row) |
| excluded-for-warmth runs | **3** (all on the first attempt at block 16) |
| other excluded runs | **1** (block 16 try1, `cli_rc=143` SIGTERM during a duplicate-harness kill; that attempt *was* COLD-VALID, drop 2439 MB) |
| void pairs recovered | 1 (pair (16 OFF, 15 ON) — block 16 re-run appended at end as `b16_OFF_retry_try1`, drop 2874 MB, kept) |
| systematic reset failure | no — not infeasible |

The three warmth excludes were an already-cold file (drop 0, resident 0)
and two failed fadv calls (drop 390 / 222 MB) while a duplicate harness
held the model mapped. They are not silent warm contamination of the
kept set. Every kept row has `cold_valid=1` and drop ≥ 1325 MB.

## Primary test (registered pairing)

ABBA quartets, pairs (OFF₁, ON₂) and (OFF₄, ON₃) × 6.

| pair | OFF blk | ON blk | OFF s/tok | ON s/tok | OFF−ON |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 2 | 0.189 | 0.200 | −0.011 |
| 2 | 4 | 3 | 0.193 | 0.193 | 0 (tie) |
| 3 | 5 | 6 | 0.243 | 0.199 | +0.044 |
| 4 | 8 | 7 | 0.192 | 0.195 | −0.003 |
| 5 | 9 | 10 | 0.192 | 0.198 | −0.006 |
| 6 | 12 | 11 | 0.190 | 0.188 | +0.002 |
| 7 | 13 | 14 | 0.192 | 0.195 | −0.003 |
| 8 | 16 | 15 | 0.191 | 0.224 | −0.033 |
| 9 | 17 | 18 | 0.178 | 0.200 | −0.022 |
| 10 | 20 | 19 | 0.185 | 0.199 | −0.014 |
| 11 | 21 | 22 | 0.183 | 0.198 | −0.015 |
| 12 | 24 | 23 | 0.175 | 0.212 | −0.037 |

N=12, ties dropped → effective N=11, exact-test floor 0.000977.
W=12, p=0.0635. Null.

## Robustness — post-hoc, disclosed, NOT the registered endpoint

Two blocks are visibly anomalous. The primary above stands as the verdict; these
variants are sensitivity only.

| variant | N | eff | W | p | ON vs OFF | ON slower |
|---|---:|---:|---:|---:|---|---|
| **primary (registered)** | 12 | 11 | 12 | **0.0635** | **+4.3 %** | 9/11 |
| without b24 | 11 | 10 | 11 | 0.0996 | +2.9 % | 8/10 |
| without b5 | 11 | 10 | 1 | **0.0039** | **+6.9 %** | 9/10 |
| without b24 and b5 | 10 | 9 | 1 | 0.0078 | +5.6 % | 8/9 |

**Every variant makes our own technique look worse, never better.** That is what
makes this safe to disclose: the usual hazard of post-hoc exclusion is that it
rescues the author's hypothesis, and here it does the opposite. Nothing here
licenses K-F.

**b5** (OFF, 0.243 s/tok against an OFF median of ~0.19) is the sole reason the
primary lands at p=0.0635 rather than at significance. It contributes the only
large positive difference (+0.044) — i.e. **the one pair in this cell that looks
like a K-F win is an OFF-arm outlier, not an ON-arm success.** Removing it gives
**+6.9 % against at p=0.0039**, within noise of the warm cell's pre-registered
**+7.1 % against**. Two independent regimes, two cells, same sign and magnitude.

**b24** (OFF) read 12.60 GB against 22.1–22.5 GB for every other OFF block and
was the fastest block in the cell (0.175 s/tok). It is COLD-VALID under the rule
declared in advance (`fadv_rc=0`, drop 2739 MB, reads above the 11.14 GB floor)
and is therefore **not** excluded — but it is plainly a different regime, and its
energy reading is broken (see the b24 caveat under Secondary axes).

**Harness counter discrepancy:** `excl_warmth.txt` reports **2**, while the CSV
shows **3** rows carrying `not_cold_valid`. The CSV is ground truth and the
accounting above uses 3; the counter under-counts by one. Recorded as a harness
bug, not a data problem — no kept row is affected.

## Secondary axes

Stall share stayed in the "high" band on both arms (OFF 21–26 %, ON
12–16 %). Prefetch still removes stall; it does not buy wall. That is
the same shape as the warm cell, at a smaller ON penalty (+4.3 % here
vs +7.1 % warm).

| axis | OFF | ON | note |
|---|---|---|---|
| wall s/tok (pair mean) | 0.1919 | 0.2001 | **+4.3 %** — primary |
| stall share | 21–26 % | 12–16 % | prefetch still cuts stall |
| per-token p50 / p99 | 187 / 341 ms | 197 / 328 ms | p99 slightly ON-better |
| stutter rate | 0.55 % | 0.34 % | ON better |
| J/token (analyzer) | 0.715 | 0.831 | ON worse; see b24 caveat |
| majflt/token | 8.20 | 8.64 | mixed |
| TTFT (width table) | 13.83 s | 13.86 s | wash |
| temp_max | 36 °C | 36 °C | thermal YES |

**b24 OFF joules = 0.087** (17 J for a 49 s / 200-token run) is a
sampler-integration failure, not a real 9× energy win. It pulls the
pooled OFF J/token down. Drop 2739 MB and `read_bytes` 12.60 GB still
clear COLD-VALID; the wall number is kept. Energy NO would still hold
if b24 is ignored.

## Disclosed interruptions (resume allowed)

1. Launch 14:20. Blocks 1–5 kept. sshd/process died mid-cooldown of
   block 6 (~14:43).
2. Resume 16:15 at block 6. Blocks 6–15 kept. Process died after
   block 15 (~17:05).
3. Resume 18:05 at block 16. A `am start com.termux` keepalive spawned
   a **second harness**; both CLIs raced. Block 16's first three
   attempts excluded (1 SIGTERM + 3 warmth). `STOP_PLUGGED` at block 17
   (phone placed on charge, 55 %).
4. Resume 19:39 at 100 % / 22 °C / UNPLUGGED. Blocks 17–24 kept. Block
   16 re-run appended, kept. STATUS=`DONE` 20:03:34.

All 12 pairs are complete. Pair 8's two blocks (15, then 16-retry) are
the only pair split across a long interruption (~3 h). Disclosed.

## Activation policy — not licensed

Registered policy:

> K-F is enabled if and only if: measured stall share is high AND the
> cache is cold AND no thermal alarm is active.

This cell is exactly that regime (stall 21–26 % OFF, every kept run
COLD-VALID, no thermal abort) and the primary test is a **null**, with
the point estimate against. The policy does **not** ship. K-F stays
off. The characterisation map is the deliverable:

| device / regime | result |
|---|---|
| Jelly, cold (this cell, pre-registered) | **null** (+4.3 % against, p=0.0635) |
| Jelly, warm | **+7.1 % against**, W=1 p=0.000977 |
| Jelly, cold (exploratory, never pre-registered) | −20 % — **not confirmed** |
| S23 | null |
| Xiaomi, warm and cold | null |
| CalaQwen-35B, cold | stall share 6.0 % — big-model hypothesis refuted |

## Analyzer output (verbatim, `analyze_kf_reality.py` unchanged)

```
# KF REALITY — Jelly analysis

Per-token mechanism: native `--csv` (`wall_ms`). Hot blocks: `order_idx >= 2`.

Rows in runs.csv: 28 (excluded=0: 24)

| order | arm | width | tok/s | wall_s/tok | stall% | J/tok | majflt | read_GB | temp_max | batt | n | dur_s |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| 1 | OFF |  | 5.302 | 0.189 | 22.8 | 0.76574403 | 1922 | 22.288732 | 30.000 | 96→95 | 200 | 53 |
| 2 | ON | 4 | 5.010 | 0.200 | 15.5 | 0.84427043 | 1878 | 24.862323 | 32.000 | 95→94 | 200 | 54 |
| 3 | ON | 4 | 5.185 | 0.193 | 14.0 | 0.80640993 | 2207 | 24.224698 | 33.000 | 93→92 | 200 | 52 |
| 4 | OFF |  | 5.177 | 0.193 | 22.3 | 0.79138999 | 1922 | 22.334771 | 34.000 | 91→91 | 200 | 53 |
| 5 | OFF |  | 4.108 | 0.243 | 21.8 | 0.78494911 | 599 | 22.266147 | 34.000 | 90→89 | 200 | 67 |
| 6 | ON | 4 | 5.030 | 0.199 | 12.6 | 0.82291445 | 1983 | 24.601297 | 30.000 | 78→77 | 200 | 54 |
| 7 | ON | 4 | 5.121 | 0.195 | 13.3 | 0.84954568 | 1524 | 24.497582 | 31.000 | 77→77 | 200 | 53 |
| 8 | OFF |  | 5.200 | 0.192 | 21.4 | 0.80961512 | 1774 | 22.328107 | 33.000 | 75→75 | 200 | 53 |
| 9 | OFF |  | 5.211 | 0.192 | 21.9 | 0.82731185 | 2035 | 22.307217 | 35.000 | 73→73 | 200 | 53 |
| 10 | ON | 4 | 5.055 | 0.198 | 13.6 | 0.85556609 | 2410 | 24.349196 | 35.000 | 71→71 | 192 | 52 |
| 11 | ON | 4 | 5.316 | 0.188 | 12.8 | 0.84078037 | 2012 | 23.758983 | 35.000 | 69→69 | 200 | 52 |
| 12 | OFF |  | 5.269 | 0.190 | 21.6 | 0.78695652 | 2036 | 22.134755 | 35.000 | 67→67 | 200 | 52 |
| 13 | OFF |  | 5.197 | 0.192 | 21.4 | 0.83248227 | 1895 | 22.239556 | 36.000 | 65→65 | 200 | 53 |
| 14 | ON | 4 | 5.130 | 0.195 | 13.3 | 0.82383428 | 1623 | 24.140112 | 36.000 | 63→63 | 200 | 53 |
| 15 | ON | 4 | 4.470 | 0.224 | 12.1 | 0.80505553 | 518 | 24.524026 | 35.000 | 62→61 | 200 | 63 |
| 17 | OFF |  | 5.605 | 0.178 | 24.2 | 0.71983993 | 2143 | 22.498939 | 24.000 | 100→99 | 200 | 51 |
| 18 | ON | 4 | 4.996 | 0.200 | 14.0 | 0.78670700 | 2121 | 24.695288 | 25.000 | 99→98 | 200 | 55 |
| 19 | ON | 4 | 5.027 | 0.199 | 14.6 | 0.83776707 | 1468 | 24.702456 | 27.000 | 98→98 | 193 | 53 |
| 20 | OFF |  | 5.411 | 0.185 | 23.2 | 0.76969045 | 1237 | 22.275211 | 28.000 | 98→97 | 200 | 52 |
| 21 | OFF |  | 5.450 | 0.183 | 23.0 | 0.75374743 | 1718 | 22.141743 | 30.000 | 97→96 | 200 | 51 |
| 22 | ON | 4 | 5.039 | 0.198 | 14.1 | 0.84776886 | 1303 | 24.625422 | 31.000 | 96→95 | 200 | 54 |
| 23 | ON | 4 | 4.714 | 0.212 | 14.2 | 0.84918484 | 1475 | 23.960748 | 31.000 | 94→94 | 191 | 55 |
| 24 | OFF |  | 5.721 | 0.175 | 25.7 | 0.08671375 | 1469 | 12.599276 | 31.000 | 92→92 | 200 | 49 |
| 16 | OFF |  | 5.235 | 0.191 | 23.0 | 0.69902026 | 1207 | 22.140908 | 31.000 | 91→90 | 200 | 52 |

## Per-token tail (hot blocks)

- **OFF** n=2200  p50=`186.70` p90=`255.06` p95=`281.71` p99=`340.81` max=`491.17` ms  stutter(>2×p50)=`12` (0.55%)
- **ON** n=2376  p50=`196.92` p90=`259.38` p95=`278.99` p99=`327.99` max=`768.84` ms  stutter(>2×p50)=`8` (0.34%)

## Thermal sag (late-half vs early-half tok/s, per hot block)

- b1_OFF_try1 (cold-first): sag=`0.0861` n=200
- b2_ON_w4_try1 (hot): sag=`0.1331` n=200
- b3_ON_w4_try1 (hot): sag=`0.0666` n=200
- b4_OFF_try1 (hot): sag=`0.0778` n=200
- b5_OFF_try1 (hot): sag=`0.1363` n=200
- b6_ON_w4_try1 (hot): sag=`0.0456` n=200
- b7_ON_w4_try1 (hot): sag=`-0.0146` n=200
- b8_OFF_try1 (hot): sag=`0.0168` n=200
- b9_OFF_try1 (hot): sag=`0.0686` n=200
- b10_ON_w4_try1 (hot): sag=`0.0123` n=192
- b11_ON_w4_try1 (hot): sag=`-0.0097` n=200
- b12_OFF_try1 (hot): sag=`0.0572` n=200
- b13_OFF_try1 (hot): sag=`0.0762` n=200
- b14_ON_w4_try1 (hot): sag=`0.0300` n=200
- b15_ON_w4_try1 (hot): sag=`0.1180` n=200
- b17_OFF_try1 (hot): sag=`0.0444` n=200
- b18_ON_w4_try1 (hot): sag=`0.0991` n=200
- b19_ON_w4_try1 (hot): sag=`0.0487` n=193
- b20_OFF_try1 (hot): sag=`0.0788` n=200
- b21_OFF_try1 (hot): sag=`0.0819` n=200
- b22_ON_w4_try1 (hot): sag=`0.0488` n=200
- b23_ON_w4_try1 (hot): sag=`-0.0699` n=191
- b24_OFF_try1 (hot): sag=`0.0135` n=200
- b16_OFF_retry_try1 (hot): sag=`0.0855` n=200

## Supporting (hot-block aggregates)

- J/token  OFF=`0.7147015177272728`  ON=`0.8306436645622896`
- majflt/token  OFF=`8.197727272727272`  ON=`8.637205387205388`
- read_bytes_gb (block mean)  OFF=`21.387875454545455`  ON=`24.41184425`
- temp_max (max over hot blocks)  OFF=`36.0`  ON=`36.0`
- memavail_min_kib (hot blocks) = `3023488.0`

## Width Pareto (hot blocks)

Hot = `order_idx >= 2`. OFF pooled; each ON width is its own group. `majflt/tok first100` vs `rest` uses the per-token CSV `majflt` column (already a per-token delta).

| width | tok/s | p50 | p90 | p99 | max | stutter% | J/tok | majflt/tok | majflt/tok first100 | majflt/tok rest | read GB | ttft_s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| OFF | 5.235 | 186.70 | 255.06 | 340.81 | 491.17 | 0.55 | 0.714702 | 8.197727 | 0.0000 | 0.0000 | 21.3879 | 13.827 |
| 4 | 5.008 | 196.92 | 259.38 | 327.99 | 768.84 | 0.34 | 0.830644 | 8.637205 | 0.0000 | 0.0000 | 24.4118 | 13.864 |

## Verdicts

| gate | verdict | numbers |
| --- | --- | --- |
| KF_ENERGY_WIN | **NO** | j/tok ON=0.830644 OFF=0.714702 ratio=1.1622 (YES≤1.05 NO>1.15) |
| KF_THERMAL_WIN | **YES** | sag ON=0.0423 OFF=0.0670  temp_max ON=36.00 OFF=36.00 dT=+0.00C (YES: sag_ON≤sag_OFF and dT≤+1.0  NO: sag_ON>sag_OFF+0.05 or dT>+2.0) |
| KF_MEMORY_WIN | **MIXED** | majflt/tok ON=8.637205387205388 OFF=8.197727272727272 memavail_min_kib=3023488.0 (abort=307200 safe>614400) |
| KF_ROBUST_WIN | **YES** | p99_ms ON=327.99 OFF=340.81  stutter_rate ON=0.0034 OFF=0.0055 (YES: p99_ON≤p99_OFF and stutter_ON≤stutter_OFF  NO: p99_ON>p99_OFF×1.1 or stutter_ON>stutter_OFF+0.01) |
```

Data: `device/` (runs.csv, master log, per_token, power, cold_reset.csv).
Wilcoxon: `analyze_pairs.py` (does not modify `analyze_kf_reality.py`).
