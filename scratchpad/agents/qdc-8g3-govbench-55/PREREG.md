# PREREG — Cell #55: ship-config tier point on QRD8650 (Snapdragon 8 Gen 3 / Adreno 750)

Date: 2026-09-03. **Inherits the ENTIRE preregistration of cell #52**
(`../qdc-7pg3-govbench-52/PREREG.md`) with these deltas:

1. Device: QRD8650 (8 Gen 3, Adreno 750). Purpose: refresh/validate the
   750-class row of the router decision table with the SHIP config on
   reference hardware. Prior 750 data exists (campaign #16, physical phone,
   different model/binary): this cell does NOT overwrite it, it adds an
   independent reference-board point with the 2.6B ship model.
2. Grid deltas: G1/G2 read "750 confirms/contradicts the #16-era 'GPU
   flies' verdict for the ship config" instead of the 7xx wording. G3/G4
   unchanged. FA note: tbo arms are MUL_MAT/MUL_MAT_ID only (as #52);
   whether FA compiles on the 750 is already implied by upstream usage but
   the loadprobe-style FA evidence is NOT collected here (bench runs use
   -fa 0 for cross-tier comparability with #52).
3. Materials identical to #52: gov-kit-5c3979438 (`419bef91…`), model
   LFM2.5-2.6B-QAD-Q4_0 sha `a247afd6…`, thermal gate #38 semantics.
   Driver = #52 rev7 verbatim (T4 launch, adbT caps, re-entrant arms,
   bare-hex taskset, bench_cpu/-ngl 0, bench_gpu/-fa 0, bench_cpu_pure/-dev
   none). Same CPU caveat carries: the kit lacks -march tuning, CPU numbers
   are build-suspect and yield no crossover constant.
4. Cost: ~35-45 min of the 1000 free 8 Gen 3 minutes (push ~1.6 GB + 5 arms).
   Session booked 90 min. Ops lesson 7 applies (ref-clicks only on portal
   dialogs, verify status after End).
