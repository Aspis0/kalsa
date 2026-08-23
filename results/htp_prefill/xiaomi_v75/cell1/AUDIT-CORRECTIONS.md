# Hostile audit (mimo, 23/08) — BANK-with-corrections

Arithmetic, unplugged state (5/5 probes AC=USB=Wireless=Dock=false, 100%),
scheduler proof (448 hmx-tiled execute-ops, HTP0-REPACK 1787.12 MiB), model sha
(== S23 cell 298fcb5f…), flags vs q31 protocol: all verified from raw.

Corrections that supersede NOTES.txt where they conflict:

1. "60s cooldowns" applies ONLY between HTP reps (61s/61s measured from
   timestamps). The CPU rep starts 1s after HTP rep3 — same thermal state
   (arguably fairer), but the NOTES wording is inaccurate.
2. HOSTBUF=1 was set in this cell; the S23 v73 cell ran with HOSTBUF unset.
   Only material flag difference — disclose when comparing across the two cells.
3. Cite the median WITH the full range: 150.26–170.34 t/s (ratio 2.89–3.28x),
   n=3, CV 6.5% (comparable to the S23 cell's 6.6%).

Required caveats for any citation: 4B HYBRID model (GDN/SSM on CPU, 51 graph
splits — speedup is for the full hybrid graph, not HTP alone); single device;
nseq=1 only; n=3 reps.

Audited citable:
On a single Snapdragon 8 Gen 3 device (houji, Hexagon v75, unplugged, build
3f545bec), Qwen3.5-4B-Q4_0 hybrid reached pp512 = 165.42 t/s median (range
150–170, 3 process reps) on HTP vs 51.90 t/s same-harness CPU (ngl=0) = 3.19x
(range 2.89–3.28x). Vs the same model/build on S23 v73 (84.0 vs 24.1, 3.49x):
~2x absolute HTP throughput, comparable ratio — the ratio drops because the CPU
improved more (2.15x) than the HTP (1.97x) on the newer SoC.

Note: the auditor flagged the plugged-houji 116.8 t/s data point as
unverifiable; it is in fact in results/htp_fallback/xiaomi_v75/runA_nohost.out
(116.84, AC-plugged session of 23/08 night) — auditor miss, value stands as a
non-cell data point.
