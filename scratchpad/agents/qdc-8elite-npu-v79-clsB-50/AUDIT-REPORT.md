# AUDIT-REPORT — cell #50 (qdc-8elite-npu-v79-clsB-50)

**Auditor:** hostile (different model from report author GPT-5.6 Luna)
**Date:** 2026-02-09
**Target:** DIR/REPORT.md
**Ground truth:** DIR/raw/*, DIR/PREREG.md, DIR/d_run.sh, cross-cell raw files

## 1. FABRICATION / DRIFT

### 1a. Cross-cell quotes — #48 :592/:593

REPORT claims `../qdc-8elite-npu-v79-fixA-48/raw/ops_mm_r1.txt:592` carries `PLAIN_HOST=1` and `:593` carries `dev-out`.

Actual `sed -n '592,593p' ops_mm_r1.txt`:
```
[MUL_MAT] NaN at index 354 (HTP0=nan CPU=3.173089) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set
[ref-buf] dev-out name=out type=f32 op=MUL_MAT buf="HTP0" buft="HTP0" host=1
```

`:592` = NaN line with `PLAIN_HOST=1`. `:593` = `dev-out` line. **CONFIRMED.**

Same for `ops_mm_r2.txt:592` — verified identical structure. **CONFIRMED.**

### 1b. Judge :642

REPORT claims `../qdc-8elite-npu-v79-judge/raw/ops_mm_ph1.txt:642` carries index 305.

Actual `sed -n '642p'`:
```
[MUL_MAT] NaN at index 305 (HTP0=nan CPU=-12.339559) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set
```

**CONFIRMED.**

### 1c. #50 nan_*.txt quotes

All four nan_*.txt files verified against REPORT's quoted text:

- `nan_r1_stock.txt:1` — index 388, `dev-out` embedded. REPORT quote exact. **CONFIRMED.**
- `nan_r2_zpad.txt:1` — index 359, `dev-out` embedded. REPORT quote exact. **CONFIRMED.**
- `nan_r3_stock.txt:1` — index 353, `PLAIN_HOST=1` (not dev-out). REPORT quote exact. **CONFIRMED.**
- `nan_r4_zpad.txt:1` — index 334, `dev-out` embedded. REPORT quote exact. **CONFIRMED.**

### 1d. Provenance lines

REPORT: `#50 raw/provenance.txt:1` = `f25c433a`; `#48` = `b4bd0901`; `#49` = `41c5710f`.

Actual provenance.txt line 1 in each:
- #50: `f25c433a` **CONFIRMED.**
- #48: `b4bd0901` **CONFIRMED.**
- #49: `41c5710f` **CONFIRMED.**

### 1e. PREREG.md:16 quote — LINE NUMBER WRONG

REPORT: `PREREG.md:16` — ``because stock never NaN'd. #49's design flaw: `GGML_TEST_EXTRA_MM_FIRST=1` on``

Actual `sed -n '16p' PREREG.md`:
```
every run destroyed the reproduction condition. Confound: #49 also changed the
```

The quoted text is from **line 15**:
```
because stock never NaN'd. #49's design flaw: `GGML_TEST_EXTRA_MM_FIRST=1` on
```

The report misattributes the quote to `:16` when it is `:15`. The quoted text itself is real — this is a line-number drift, not fabrication. **PLAUSIBLE** (content correct, citation off-by-one).

---

## 2. THE VERDICT

### 2a. Arm mapping — stock vs zeropad

REPORT: R1/R3 = stock (37131e07), R2/R4 = zeropad (398879cc).

Actual `raw/skel_active.txt`:
```
r1_stock active_skel=37131e079e14a09c0cfe22637ab2a614e67862924e6e106351bc6f0e864c6044 tbo=5cf3565b20b6c23bab757183c5a61c276727f216c3ece30fce211bdc1bbed5e8
r2_zpad active_skel=398879cc6c7e02b5b9d943d0f64c453a446150b4c0c2000edc41d8c2b830ca5b tbo=5cf3565b20b6c23bab757183c5a61c276727f216c3ece30fce211bdc1bbed5e8
r3_stock active_skel=37131e079e14a09c0cfe22637ab2a614e67862924e6e106351bc6f0e864c6044 tbo=5cf3565b20b6c23bab757183c5a61c276727f216c3ece30fce211bdc1bbed5e8
r4_zpad active_skel=398879cc6c7e02b5b9d943d0f64c453a446150b4c0c2000edc41d8c2b830ca5b tbo=5cf3565b20b6c23bab757183c5a61c276727f216c3ece30fce211bdc1bbed5e8
```

R1/R3 = 37131e07 (stock). R2/R4 = 398879cc (zeropad). **CONFIRMED.**

### 2b. NaN present on ALL FOUR arms

`grep -c 'NaN at index' ops_*.txt`:
```
ops_r1_stock.txt:1
ops_r2_zpad.txt:1
ops_r3_stock.txt:1
ops_r4_zpad.txt:1
```

Each run has exactly one NaN diagnostic. REPORT says `nan_diags=1` for all four. **CONFIRMED.**

### 2c. Census shape is the same q4_0 in all four

`grep 'NaN at index' ops_*.txt`:
```
ops_r1_stock.txt: [MUL_MAT] NaN at index 388 ... MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,...)
ops_r2_zpad.txt: [MUL_MAT] NaN at index 359 ... MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,...)
ops_r3_stock.txt: [MUL_MAT] NaN at index 353 ... MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,...)
ops_r4_zpad.txt: [MUL_MAT] NaN at index 334 ... MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,...)
```

All four are the census q4_0 shape (m=2880,n=32,k=2880). **CONFIRMED.**

### 2d. Grid case 2 — verdict is correct

PREREG grid case 2: "R1/R3 NaN present AND R2/R4 NaN persists → T1 REFUTED as sole cause; T2 promoted."

R1 (stock): NaN present. R3 (stock): NaN present. R2 (zeropad): NaN present. R4 (zeropad): NaN present.

This is grid case 2. REPORT's verdict: **T1 REFUTED as sole cause; T2 promoted.** **CONFIRMED.**

### 2e. No arm mapping error

REPORT correctly maps R1/R3 to stock and R2/R4 to zeropad. A single mismapped arm would flip the verdict (e.g., if R2 were stock, grid case 2 would not apply). The skel_active.txt evidence is unambiguous. **CONFIRMED.**

---

## 3. ARITHMETIC

### 3a. 545/546 in all four runs

`grep 'tests passed' raw/ops_*.txt`:
```
ops_r1_stock.txt:   545/546 tests passed
ops_r2_zpad.txt:   545/546 tests passed
ops_r3_stock.txt:   545/546 tests passed
ops_r4_zpad.txt:   545/546 tests passed
```

REPORT says 545/546 for all four. **CONFIRMED.**

### 3b. NaN indices mapped to correct runs

REPORT table:
- R1 (r1_stock) → 388
- R2 (r2_zpad) → 359
- R3 (r3_stock) → 353
- R4 (r4_zpad) → 334

Actual `grep 'NaN at index' raw/ops_*.txt`:
```
ops_r1_stock.txt: NaN at index 388
ops_r2_zpad.txt: NaN at index 359
ops_r3_stock.txt: NaN at index 353
ops_r4_zpad.txt: NaN at index 334
```

All four indices and run assignments match. **CONFIRMED.**

### 3c. Cross-cell index table

REPORT claims: #46=305, #48=354/354, #50 stock=388/353, #50 zeropad=359/334.

Verified:
- #46 judge :642 → index 305. **CONFIRMED.**
- #48 r1 :592 → index 354; r2 :592 → index 354. **CONFIRMED.**
- #50 r1 → 388; r2 → 359; r3 → 353; r4 → 334. **CONFIRMED.**

### 3d. EXIT=1 at :2502 in all four logs

`sed -n '2502p' raw/ops_*.txt`:
```
ops_r1_stock.txt: EXIT=1
ops_r2_zpad.txt: EXIT=1
ops_r3_stock.txt: EXIT=1
ops_r4_zpad.txt: EXIT=1
```

**CONFIRMED.**

### 3e. adb.exit files = 0

`cat raw/ops_*.adb.exit`:
```
ops_r1_stock.adb.exit: 0
ops_r2_zpad.adb.exit: 0
ops_r3_stock.adb.exit: 0
ops_r4_zpad.adb.exit: 0
```

**CONFIRMED.**

---

## 4. OVERCLAIM

### 4a. Does REPORT claim T2 is proven-as-specific-mechanism?

REPORT grid verdict section: "What dies is the scale-pad-only theory and its candidate cure... What is promoted is T2—VTCM layout/state corruption elsewhere. The poison is state-dependent under the restored dirty-process configuration and position-unstable across runs; the exact source of the movement remains unresolved."

The phrase "the exact source of the movement remains unresolved" explicitly limits the claim. T2 is "promoted" (candidate), not "proven." **CONFIRMED** (no overclaim).

### 4b. Does REPORT separate device-vs-run variance?

REPORT limitations: "the cross-cell movement from #48's 354 cannot be assigned uniquely to device, run, or session variance."

This correctly refuses to separate the variance sources. **CONFIRMED** (no overclaim).

### 4c. Zeropad "safe but not curative"

REPORT: "The zeropad skel remains SAFE in the append configuration. It introduces no failure beyond the expected census NaN... zeroing the per-tile pad does not remove the failure."

Correctly characterized: safe (no new failures) but not curative (NaN persists). **CONFIRMED.**

### 4d. Limitations section covers device change

REPORT limitations: "#50 ran on f25c433a, #48 on b4bd0901, and #49 on 41c5710f."

Three serials verified from provenance.txt files (§1d). **CONFIRMED.**

---

## 5. OMISSION

### 5a. grep all 4 ops logs for anomalies

`grep -c` across all four ops_*.txt:

| Pattern | r1_stock | r2_zpad | r3_stock | r4_zpad |
|---------|----------|---------|----------|----------|
| `NaN at index` | 1 | 1 | 1 | 1 |
| `NMSE` | 0 | 0 | 0 | 0 |
| `INTERNAL-ERROR` | 0 | 0 | 0 | 0 |
| `FAIL` | 3 | 3 | 3 | 3 |
| `not supported` | 930 | 930 | 930 | 930 |

**FAIL = 3 per log:** The 3 grep hits are ANSI-styled fragments of the SAME single failure event:
```
[1;31mFAIL[0m                    ← test result line
  Backend HTP0: [1;31mFAIL[0m  ← backend summary
[1;31mFAIL[0m                    ← failing test echo
```
All three refer to the one census q4_0 NaN. REPORT says "single census q4_0 failure" — correct.

**not supported = 930 per log:** These are HTP-unsupported op shapes — expected, not failures. REPORT does not mention them. Not an omission (they are informational, not binding).

**NMSE = 0:** No NMSE diagnostics in any log. REPORT does not mention NMSE. Not an omission.

**CONFIRMED** (no hidden anomalies omitted).

### 5b. Thermal gates

All 8 gate files (4 pre + 4 post) contain `GATE_PASS`. REPORT cites all eight correctly. **CONFIRMED.**

### 5c. kit_verify.txt and list_devices.txt

REPORT: `raw/kit_verify.txt:45` = `lib/libmtmd.so: OK`; `:46` = `MANIFEST_LINES=45`.

Actual:
```
lib/libmtmd.so: OK
MANIFEST_LINES=45
```

Total lines in kit_verify.txt: 46. **CONFIRMED.**

REPORT: `raw/list_devices.txt:7` = `ggml-hex: Hexagon Arch version v79`; `:15` = `EXIT=0`.

Actual:
```
ggml-hex: Hexagon Arch version v79
EXIT=0
```

**CONFIRMED.**

### 5d. Timing and done

REPORT: `raw/serial.txt:1` = `serial=f25c433a t0=1788367238 t0_iso=2026-09-02T16:40:39Z`.

Actual: `serial=f25c433a t0=1788367238 t0_iso=2026-09-02T16:40:39Z`. **CONFIRMED.**

REPORT: `raw/events.txt:1` = `[12:41:46 e=68] DONE npu_dead=0`; `raw/done.txt:1` = `DONE elapsed=68 npu_dead=0`.

Actual: both match. **CONFIRMED.**

---

## FINAL VERDICT

| Section | Verdict |
|---------|---------|
| §1 Fabrication/Drift | **CONFIRMED** (all cross-cell quotes exact; §1e off-by-one on PREREG:16) |
| §2 The Verdict | **CONFIRMED** (arm mapping correct, grid case 2 binding) |
| §3 Arithmetic | **CONFIRMED** (545/546 all four, indices correct, EXIT codes correct) |
| §4 Overclaim | **CONFIRMED** (T2 promoted not proven, variance not separated, zeropad safe-not-curative) |
| §5 Omission | **CONFIRMED** (no hidden anomalies, all cited files verified) |

**APPLY.**

The report is faithful to the raw data. The one finding (§1e) is a trivial line-number drift in a PREREG quote (`:16` instead of `:15`) — the quoted text is real, the citation is off-by-one. All numerical claims, verdict logic, arm mappings, and cross-cell comparisons are accurate.
