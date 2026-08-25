# q60b numbers

| n | rep | cache | wall_s | utime_s | stime_s | busy_frac_8t | stime_frac_8t | stime_of_busy | read_MB | MB/s | majflt |
|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 128 | 1 | cold-designated | 18.566302 | 9.500000 | 25.110000 | 0.233016 | 0.169056 | 0.725513 | 12370.747 | 666.301 | 43329 |
| 128 | 2 | warm | 12.243919 | 8.620000 | 23.980000 | 0.332818 | 0.244815 | 0.735583 | 12290.159 | 1003.777 | 49692 |
| 128 | 3 | warm | 9.353330 | 8.150000 | 21.710000 | 0.399056 | 0.290137 | 0.727060 | 10825.327 | 1157.377 | 43933 |
| 512 | 1 | cold-designated | 16.007762 | 31.490000 | 28.030000 | 0.464775 | 0.218878 | 0.470934 | 12029.182 | 751.459 | 35734 |
| 512 | 2 | warm | 16.639369 | 33.550000 | 29.530000 | 0.473876 | 0.221838 | 0.468136 | 11207.922 | 673.579 | 30810 |
| 512 | 3 | warm | 16.961654 | 34.050000 | 30.830000 | 0.478137 | 0.227204 | 0.475185 | 12210.602 | 719.895 | 34116 |
| 2048 | 1 | cold-designated | 93.504276 | 159.250000 | 90.290000 | 0.333594 | 0.120703 | 0.361826 | 29904.531 | 319.820 | 285154 |
| 2048 | 2 | warm | 101.971790 | 161.360000 | 94.430000 | 0.313555 | 0.115755 | 0.369170 | 30585.545 | 299.941 | 278849 |
| 2048 | 3 | warm | 90.869036 | 208.020000 | 52.880000 | 0.358896 | 0.072742 | 0.202683 | 30859.604 | 339.605 | 335412 |

| n | rep | io_floor_cell_s | io_floor_iogate_seqmedian_s | headroom_cell_k2 | headroom_cell_k4 | headroom_cell_k8 | headroom_iogate_k2 | headroom_iogate_k4 | headroom_iogate_k8 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 128 | 1 | 10.688609 | 28.754268 | 1.072887 | 1.737018 | 1.737018 | 0.645689 | 0.645689 | 0.645689 |
| 128 | 2 | 10.618978 | 28.566949 | 0.751161 | 1.153022 | 1.153022 | 0.428604 | 0.428604 | 0.428604 |
| 128 | 3 | 9.353330 | 25.162129 | 0.626479 | 1.000000 | 1.000000 | 0.371723 | 0.371723 | 0.371723 |
| 512 | 1 | 10.393489 | 27.960341 | 0.537895 | 1.075790 | 1.540172 | 0.537895 | 0.572517 | 0.572517 |
| 512 | 2 | 9.683901 | 26.051424 | 0.527564 | 1.055128 | 1.718251 | 0.527564 | 0.638712 | 0.638712 |
| 512 | 3 | 10.550240 | 28.382030 | 0.522862 | 1.045725 | 1.607703 | 0.522862 | 0.597619 | 0.597619 |
| 2048 | 1 | 25.838200 | 69.509374 | 0.749413 | 1.498826 | 2.997653 | 0.749413 | 1.345204 | 1.345204 |
| 2048 | 2 | 26.426611 | 71.092305 | 0.797309 | 1.594617 | 3.189235 | 0.797309 | 1.434358 | 1.434358 |
| 2048 | 3 | 26.663404 | 71.729322 | 0.696581 | 1.393163 | 2.786325 | 0.696581 | 1.266832 | 1.266832 |

best_sustained_cell_MB_s = 1157.376741
io_gate_seq_median_MB_s = 430.223000
io_gate_seq_best_MB_s = 452.654000
pp512_warm_io_floor_ratio_mean = 0.601996
pp512_warm_io_floor_ratio_median = 0.622005
pp512_warm_wording = mixed
max_temperature_C_n128 = 31.8
max_temperature_C_n512 = 32.5
max_temperature_C_n2048 = 35.4
max_temperature_C_all = 35.4
battery_start_pct = 67
battery_end_pct = 62

## Corrections applied after audit (REVIEW_MATH.md, BANK-with-corrections)
- DISCLAIMER: this cell does NOT decide GO/NO-GO for any kernel; it characterizes the streaming
  prefill floor. Legend: "headroom" = wall / max(I/O floor, compute/k); k = hypothetical matmul
  speed-up; values > 1 are ceilings, not predictions.
- Phase split: read_MB and MB/s are per-LAUNCH (each launch carries a ~1 GB/s full-file prefetch,
  5.2–6.6 GB, before eval); the timed eval re-read pass runs at only 312–393 MB/s (n ≤ 512).
  The 1157 MB/s "best" is one warm pp128 launch, not a sustained eval rate.
- SELF-CONSISTENT headroom (each rep at its own eval-pass rate): ≈ 1.0 for every rep. With the
  user-compute-only model (stime stays on CPU): 1.0–1.3× at k=2. By rate convention the wording
  is "mixed" only at the cell-best rate; self-consistent and io_gate conventions both read
  FLASH-BOUND.
- pp2048: every launch shows an untimed eval-equivalent pass (sampler window ≈ 2.1× bench wall);
  only ~9–14 GB of the 30 GB belong to the timed eval. Re-read multiplier grows with batch
  (0.9× → 3.7×); batches > 512 fall into a ~100–150 MB/s thrash regime — design implication:
  only layer-local double-buffering can cap it.
- UFS 4.0 extrapolation (audit, from results/io_gate/xiaomi_ufs4: seq 2046 MB/s, rand 1543,
  same RAM/re-read volumes, NPU removing all utime): pp512 ≈ 2.5–3× central (1.6–4.1×),
  pp2048 ≈ 3.5×, with the user-matmul term (3.9–4.3 s) binding near 3–4×. Settling measurement
  on v75: cold-protocol pp512×3 + pp2048 with per-launch read_bytes, utime/stime/majflt, and
  sampler-window-vs-wall check.
