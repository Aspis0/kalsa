# Errata — qdc-8elite-cpu-day0 (bank companion)

Audit: qdc-day0-bank-audit/REPORT.md (GLM, hostile, 2026-08-28). Verdict BANK-WITH-ERRATA.
Orchestrator spot-checks on disk: cert lines (1144/1144 at cert_mm_cpu.out:1477, 812/812 at
cert_mmid.out:819), manifest skip record, battery UPDATES-STOPPED line, t8 tg128 median
re-derived from the three raw avg_ts (58.10 / 59.10 / 63.53 → 59.095).

1. **Aggregator not preregistered** (audit REFUTED on method, not numbers): "median of
   per-invocation avg_ts" was chosen ex-post; median over the 9 samples would give t8
   tg128 60.190 (+1.9%). The chosen aggregator is the conservative one; future preregs
   must pin the aggregator.
2. **Ramp-contaminated numbers**: monotone decline across invocations in all 4 configs
   (−8.6% worst, t8 tg128), thermal status 0→1 mid-cell, HAL CPU 39.6→53.8 °C, skin
   32.6→48.0 °C. The medians are mid-ramp, not steady-state. A steady-state cell needs
   fixed-duration warmup + longer spacing.
3. **Battery service frozen**: `(UPDATES STOPPED)` in battery.final.txt — ALL battery
   telemetry (43.0 °C, level 100, ac:false) is a stub on this rack device; "plugged" is
   a declaration from QDC's device class, not a measurement. Thermal truth comes from
   thermalservice HAL only.
4. `.so` provenance: the kit was dynamically linked; 7 libs pushed from the same
   build-android tree (kit binaries byte-identical to that tree — strong mitigation) but
   no per-lib on-device sha in raw, and the initial CANNOT-LINK failure has no raw file.
   Next kit: static or bundled with per-lib SHA256SUMS.
5. Comparator caveat is wider than the prereg said: S23 #20 ran with no_repack=true vs
   false here, and binaries are same-family but older lineage — the ~2.1× CPU-vs-CPU
   reading stands as a device-class comparison, not a controlled A/B.
6. Correctness sweep totals differ from S23 night0 (1144/812 vs 925/407): different
   enumeration on this CPU/build — declared, not comparable one-to-one.
