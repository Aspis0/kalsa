# REVIEW_MATH — q44 S23 `-ngl` sweep + Phase 2 (hostile audit)

Auditor intent: REFUTE. Method: recompute every claim directly from RAW under
`results/ngl_sweep_s23/device/kalsa_q44/points/*` and
`results/htp_smoke/s23_v73_bprime/phase2/`. No trust in REPORT.md values.
All conversions exact: MiB = 1024*1024 B; meminfo kB = 1024 B.

Verdict: **CLEAN** (0 numeric claims REFUTED). 8 minor nits (mostly
wording / unit-labeling), none changes a k value or the headline conclusion.

---

## 1. Per-point table (MApre / MAmin / MApost / peak Rss*)

Recomputed from `meminfo_pre.txt`, `meminfo_post.txt`, `sampler.csv`.

| ngl | MApre kB (report) | min(MA) kB | MApost kB | peak RssAnon | peak RssFile | peak VmSwap |
|---|---:|---:|---:|---:|---:|---:|
| 0 | 3276416 ✓ | 3240032 ✓ | 4255176 ✓ | 82608 ✓ | 3220144 ✓ | 47844 ✓ |
| 7 | 4170764 ✓ | 2363496 ✓ | 4387372 ✓ | 113140 ✓ | 2599696 ✓ | 83756 ✓ |
| 13 | 4326084 ✓ | 1665804 ✓ | 4334880 ✓ | 85592 ✓ | 3141788 ✓ | 75420 ✓ |
| 19 | 4258468 ✓ | 883008 ✓ | 4398256 ✓ | 81120 ✓ | 3053792 ✓ | 96424 ✓ |
| 99 | 4035088 ✓ | 608732 ✓ | 4835924 ✓ | 78172 ✓ | 2733868 ✓ | 73180 ✓ |

All 25 cells **CONFIRMED** to the kB.

MApre source: `meminfo_pre.txt` full dump (not the sampler's first NA row, which
runs 0.9–9.3 MB lower). Convention is **consistent across all 5 points**. ✓
MAmin = global min of the 1 Hz sampler, for every point it is a mid/early-run
sample with the bench pid live (ngl0 idx 1, ngl7 idx 12, ngl13 idx 40, ngl19 idx 37,
ngl99 idx 24). ✓

## 2. ΔMA = MApre − MAmin (unit conversion kB→MiB)

| ngl | raw diff kB | MiB (÷1024) | report | verdict |
|---|---|---:|---:|---|
| 0 | 36384 | 35.53 | 35.5 | CONFIRMED |
| 7 | 1807268 | 1764.91 | 1764.9 | CONFIRMED |
| 13 | 2660280 | 2597.93 | 2597.9 | CONFIRMED |
| 19 | 3375460 | 3296.35 | 3296.3 | CONFIRMED |
| 99 | 3426356 | 3346.05 | 3346.1 | CONFIRMED |

## 3. Denominators

**(a) layer-frac = model_size × offloaded/25, model_size = 3317921536**
`model_size` in every `stdout.jsonl` line is exactly 3317921536 ✓ (GGUF *file*
size 3326160384 B is a separate number, correctly kept distinct — model_bytes.txt
= 3326160384).
Recompute: 7/25 → 885.98 MiB (rep 886.0 ✓); 13/25 → 1645.39 (1645.4 ✓);
19/25 → 2404.80 (2404.8 ✓); 25/25 → 3164.22 (3164.2 ✓). **CONFIRMED.**
N=25 source verified: `offload_line_raw.txt` = `offloaded 1/25 layers` (ngl1 `-v` probe). ✓

**(b) set-tensor = Σ OPENCL_SET_TENSOR nbytes, re-summed independently**

| ngl | lines | Σ bytes | MiB | report | verdict |
|---|---:|---:|---:|---:|---|
| 0 | 0 | 0 | 0 | 0 | CONFIRMED |
| 7 | 1247 | 1064197428 | 1014.90 | 1014.9 | CONFIRMED |
| 13 | 1310 | 1898857012 | 1810.89 | 1810.9 | CONFIRMED |
| 19 | 1376 | 2728610100 | 2602.21 | 2602.2 | CONFIRMED |
| 99 | 1173 | 3334333732 | 3179.87 | 3179.8 | CONFIRMED |

No double-counting (each line one `nbytes=`, all unique allocs; ngl99 sum 3179.9 MiB
> model_size 3164.2 MiB is only ~0.5 % — expected from computed-node re-sets, not
an accounting error). The ngl99-fewer-lines (1173) vs ngl19 (1376) with *more*
bytes is exactly what the raw shows; `offloaded 25/25` is present in ngl99 stderr,
so anomaly #10's explanation (naming/lifetime, not missing layers) is sound. ✓

## 4. k_layer / k_set / k_incremental — all cells

k_layer = 1.992 / 1.579 / 1.371 / 1.057 → rep 1.99 / 1.58 / 1.37 / 1.06 ✓
k_set   = 1.739 / 1.435 / 1.267 / 1.052 → rep 1.74 / 1.43 / 1.27 / 1.05 ✓
k_opencl_created = 0.349 / 0.320 / 0.294 / 0.249 (ΔMA ÷ OPENCL sum_mib
753.69/5051.89/8127.72/11197.13/13432.17, all verified in stderr) → 0.35/0.32/0.29/0.25 ✓

Incremental (set-tensor denominator, ΔMA vs previous GPU point):

| step | extra ΔMA MiB | extra set MiB | k_inc | verdict |
|---|---|---:|---:|---:|---|
| 0→7 | 1729.38 | 1014.90 | 1.704 | 1.70 ✓ |
| 7→13 | 833.02 | 795.99 | 1.046 | 1.05 ✓ |
| 13→19 | 698.42 | 791.32 | 0.883 | 0.88 ✓ |
| 19→99 | 49.70 | 577.66 | 0.086 | 0.09 ✓ |

All 20+ cells **CONFIRMED**. `OPENCL_ALLOC` "~377 MiB live" at ngl0 also confirmed
(296.75+37.09+43.00 = 376.84 live; sum_mib 753.69 counts try.* + real, as stated).

## 5. Headline claims

- "19→99 adds ~578 MiB set-tensor and ~50 MiB ΔMA": 577.66 / 49.70 → **CONFIRMED**.
- "k falls monotonically": strictly decreasing in k_set (1.74→1.05),
  k_layer (1.99→1.06) and k_inc (1.70→0.09) → **CONFIRMED**.
- "Is 1.99 the max?": yes, 1.992 is k_layer at ngl7, the largest of all 12 k cells.
- "1.7–2.0 conservative band": **CONFIRMED as a conservative envelope; NIT — it
  mixes denominators.** 1.74 = k_set(ngl7), 1.99 = k_layer(ngl7). Single-denominator
  high-ends are 1.74 (k_set) or 1.99 (k_layer), not both. The recommendation sentence
  ("~1.7–2.0 system byte per offloaded-weight byte") presents a cross-denominator
  range; a strict reader could call the band internally inconsistent. Small in
  magnitude, fully visible in the tables, and it errs conservative (safe).
- "Pooled mean k_set = 1.37": arithmetic mean = 1.3731 ✓ **CONFIRMED as written —
  NIT: not a true pool.** Bytes-weighted (ΣΔMA/Σset) = 1.279; weighted k_layer =
  1.359. The label "pooled" overstates; the report's caveat "that average is not a
  model of the curve" is correct, but a byte-weighted pool would cite 1.28, not 1.37.

## 6. Speed / rc / battery / sampler n

- pp512/tg128 avg_ts: ngl0 24.961/13.290, ngl7 20.067/7.985, ngl13 21.203/6.247,
  ngl19 40.493/11.635, ngl99 68.512/13.218 — **all 10 match jsonl avg_ts, CONFIRMED.**
- rc = 0 in all five `rc.txt` **CONFIRMED.** `n_threads=4` in every jsonl ✓.
- Battery T pre/post (°C): 0:26.8/29.9, 7:27.3/29.9, 13:28.1/29.9, 19:28.0/30.3,
  99:28.2/30.9 — **all exact vs probes, CONFIRMED.** Levels 100/99/98/97/96 ✓.
  NIT: header "end 96%/28.3°C" — dumpsys `battery_session_end` reads 308 (30.8 °C);
  28.3 matches the broadcast stream at the same moment. Soft figure, fine either way.
- Sampler n: 37/47/61/48/44 = non-header CSV rows. Each includes ONE pre-load NA
  row (data rows with pid: 36/46/60/47/43). "≥30" holds under both counts. ✓ NIT:
  n implicitly includes the pre-load sample; immaterial.

## 7. Anomaly 7 — is ngl0 (35.5 MiB ΔMA) a fair baseline? Sensitivity to MApre

- ngl0 offloads 0 layers (0 SET_TENSOR lines); its 35.5 MiB ΔMA is Adreno prealloc
  (constant, ~377 MiB live) + OS noise, and via per-point MApre it is exactly the
  by-design baseline the incremental table subtracts. **Fair as a baseline.**
- Sensitivity: recomputed with MApre := previous point's MApost —

  | ngl | k_set (alt) | k_layer (alt) |
  |---:|---:|---:|
  | 7 | 1.820 | 2.085 |
  | 13 | 1.468 | 1.615 |
  | 19 | 1.295 | 1.402 |
  | 99 | 1.164 | 1.170 |

  Same shape: still strictly decreasing, still non-constant, high-end band ≈1.7–2.1.
  **The headline conclusion is NOT sensitive to the MApre convention.** ✓
- NIT: the anomaly's "GiB" figures are MiB/1000 (decimal) values mislabeled GiB —
  3.20 = 3199.6 MiB = 3.12 GiB; "4.16" = 4155 MiB = 4.06 GiB; the "~4.1–4.3 GiB"
  later-point band is really 3.85–4.13 GiB. The *relative* claim (ngl0 pre ~1 GiB
  below the others) survives in any consistent unit (0.73–1.0 GiB true).

## 8. Phase 2 arithmetic

- 5995.65 + 157.65 + 28.25 + 178.50 = **6360.05 MiB** ✓ ("~6360 MiB")
- 6509642624 B ÷ 1024² = **6208.14 MiB** ✓
- Sum > file: 6360.05 > 6208.14, over by 151.9 MiB. "Repack copies are EXTRA anon":
  supported — non-repack buffers (5995.65+28.25 = 6023.90) sit 184.2 MiB *under* the
  file; adding the 336.15 MiB repacks drives the total 151.9 MiB over. Interpretation
  is correct. ✓
- "8 GB vs ~6360 MiB + OS": sound. Nominal 8 GB; MemTotal = 7243748 kB = 7074 MiB
  usable. 6360 MiB leaves 714 MiB for the whole Android/GPU runtime, far below real
  OS use → LMK/SIGKILL plausible. ✓
- Other phase-2 raw: `offloaded 29/29` present ✓; `execute-op` count = 0 ✓;
  both `a_stdout.jsonl` = 0 B ✓; model sha `bd63fc0f…` MATCH ✓; STATUS never left
  STARTING ✓.
- **NIT:** REPORT says the two attempts died with "identical 196051-byte stderr".
  The two files are same size (196051 B) and structurally identical **but not
  byte-identical** — they differ only in ASLR pointer/handle values (e.g.
  `handle 0xb400007121012d40` vs `0xb400007b24412d40`, buffer base `0x709ad66000`
  vs `0x7a9bd66000`). SESSION_LOG's "same 196051 B stderr" is the accurate phrasing.
  Same death point, same size, 0 execute-op — conclusion unaffected. Wording nit.

---

## Final verdict: **CLEAN** (with 8 minor nits)

No REFUTED numeric claim. Every k value, ΔMA, denominator, speed, rc, battery cell,
and incremental step was independently recomputed from raw and matches.
The one substantive caution for downstream consumers remains the report's own:
the "1.7–2.0" band blends the two denominators (1.74 = k_set, 1.99 = k_layer) and
the "pooled mean 1.37" is an unweighted mean (true pool = 1.28). Both are minor and
both err in the conservative (safe) direction; nothing changes the cell's conclusion
that k is not a single constant and that a high-end factor (~1.7–2.0) is the right
conservative choice for a fit-gate.
