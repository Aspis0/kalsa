# AUDIT — cell #49 REPORT.md

## Fabrication / Drift

- `kit_verify.txt:44` quoted as `lib-zeropad/libmtmd.so: OK` — **REFUTED**. Actual line 44 is `lib/libmtmd.so: OK`. The zeropad variant is line 24. **FABRICATED line quote.**
- All other line quotes verified correct: serial.txt:1, events.txt:1, done.txt:1, provenance.txt:2, list_devices.txt:7/14/15, kit_sha_host.txt:3/4/5, skel_active.txt:1-4, summary.txt:1-4, ops_r1_stock.txt:28/35/36/43/44/51/52/53/618/625/626/634/2477, ops_r2-4 EXIT=0 at :2477, all 8 gate files GATE_PASS, d_run.sh:12/68/81-84, PREREG.md:43-45/60-67/68-73, cross-cell #48 d_run.sh:9/12/80-81, cross-cell #48 summary.txt:1-2, cross-cell #48 ops_mm_r1.txt:592, #48 ops_mm_r2.txt:592, judge ops_mm_ph1.txt:642.

## Arithmetic

- `544 = 540 + 4` (#49): EXTRA has 4 entries → CONFIRMED. `grep -c 'q4_0:2880,32,2880' d_run.sh:12` → 4 semicolons before last.
- `546 = 540 + 6` (#48): EXTRA has 6 entries → CONFIRMED (3×q4_0 + q4_0:1024 + q8_0 + q4_0:64).
- Census size 540 both cells: #49 544−4=540, #48 546−6=540 → CONFIRMED.
- `grep -c 'MUL_MAT(type_a=q4_0.*m=2880,n=32,k=2880' ops_r1_stock.txt` → 5 (lines 28,36,44,52,618) → CONFIRMED.
- #48 q4_0 census shape matches: `grep -c 'MUL_MAT(type_a=q4_0.*m=2880,n=32,k=2880' ops_mm_r1.txt` → 5 (592+census, 2452/2460/2468 extras, 2496 failing-list echo) → CONFIRMED.
- #48 q8_0 m=2880 count: `grep -c 'MUL_MAT(type_a=q8_0.*m=2880' ops_mm_r1.txt` → 2 (600 census + 2484 extra) → CONFIRMED.
- #48 mxfp4 m=2880 count: `grep -c 'MUL_MAT(type_a=mxfp4.*m=2880' ops_mm_r1.txt` → 1 (608 census) → CONFIRMED.
- 20 shape executions: 5 per run × 4 runs → CONFIRMED.
- Probe result lines 35/43/51/53 all `[1;32mOK[0m` → CONFIRMED.
- Census q4_0 OK at line 625 → CONFIRMED.

## Overclaim

- Report explicitly states "NOT grid case 1 or case 2" → CONFIRMED.
- Report explicitly states "result does NOT confirm T1; T1 versus T2 remains open" → CONFIRMED.
- Report correctly identifies this as case-3-mechanism refined, not grid case 1/2 outcome → CONFIRMED.
- Report flags binary confound (host-binary changed, NaN index differs 305 vs 354) → CONFIRMED.
- Report flags FIRST=1 design flaw masking live reproduction → CONFIRMED.
- No claim that NaN is fixed → CONFIRMED (report says "Class B NaN did not reproduce" not "is fixed").

## Omission

- All 4 ops logs NaN count: `grep -c 'NaN at index' ops_r{1,2,3,4}_*.txt` → 0/0/0/0 → CONFIRMED.
- NMSE count: 0 in all 4 logs → CONFIRMED.
- INTERNAL-ERROR count: 0 in all 4 logs → CONFIRMED.
- FAIL count: 0 in all 4 logs → CONFIRMED.
- All 4 failing_*.txt: 0 bytes → CONFIRMED.
- All 4 nan_*.txt: 0 bytes → CONFIRMED.
- pty-interleave trap: "Failing tests:" section empty (failing_*.txt extracted via sed, all empty) → CONFIRMED.
- #49 #48 cross-cell: #48 summary lacks `nan_diags` field (different d_run.sh) — report does not quote nan_diags for #48 → CONFIRMED, no omission.

## Skel Mapping

- skel_active.txt: r1/r2 → stock 37131e07, r3/r4 → zeropad 398879cc → CONFIRMED.
- kit_sha_host.txt:3 stock = 37131e07 → matches skel_active r1/r2 → CONFIRMED.
- kit_sha_host.txt:4 zeropad = 398879cc → matches skel_active r3/r4 → CONFIRMED.

## Verdict Table

| Check | Verdict |
|---|---|
| kit_verify.txt:44 quote | **FIX** — FABRICATED: actual is `lib/libmtmd.so: OK`, not `lib-zeropad/libmtmd.so: OK` |
| All other line quotes (20+) | CONFIRMED |
| Arithmetic (544/546/540 census/5×4=20) | CONFIRMED |
| Overclaim discipline (no T1 confirm, no NaN-fixed) | CONFIRMED |
| Omission sweep (NaN/NMSE/IE/FAIL = 0) | CONFIRMED |
| Skel mapping r1-4 × stock/zpad | CONFIRMED |

## Final

**FIX** — One fabricated line quote (`kit_verify.txt:44`). Correct the line number to `:24` or the text to `lib/libmtmd.so: OK`. All other claims in the report are substantively accurate.
