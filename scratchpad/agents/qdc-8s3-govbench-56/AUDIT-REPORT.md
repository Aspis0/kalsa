# HOSTILE AUDIT — Cell #56 REPORT.md

Auditor: automated. Raw files are the only truth.

---

## ANGLE 1: Citation truth

### 925/925, 407/407

**CONFIRMED.** `raw/tbo_mm_sa802025.out` tail:

> `925/925 tests passed`

`raw/tbo_mmid_sa802025.out` tail:

> `407/407 tests passed`

Both exit=0. Zero FAIL lines in either file (`grep -ci 'fail'` returns 0 for both).

### Six bench numbers ±

| Claim (REPORT.md) | Raw source | Raw value | Verdict |
|---|---|---|---|
| GPU pp512 **154.82 ± 1.34** | bench_gpu_sa802025.out | `154.82 ± 1.34` | **CONFIRMED** |
| GPU tg128 **16.49 ± 0.01** | bench_gpu_sa802025.out | `16.49 ± 0.01` | **CONFIRMED** |
| CPU-weights hybrid pp512 **15.12 ± 0.17** | bench_cpu_sa802025.out | `15.12 ± 0.17` | **CONFIRMED** |
| CPU-weights hybrid tg128 **11.68 ± 0.10** | bench_cpu_sa802025.out | `11.68 ± 0.10` | **CONFIRMED** |
| CPU pure pp512 **14.91 ± 0.01** | bench_cpu_pure_sa802025.out | `14.91 ± 0.01` | **CONFIRMED** |
| CPU pure tg128 **11.34 ± 0.09** | bench_cpu_pure_sa802025.out | `11.34 ± 0.09` | **CONFIRMED** |

### SM8635

**CONFIRMED.** `raw/recon_sa802025.txt` line 1:

> `SM8635`

### Core frequencies

REPORT.md: "cpu0-2 @2.016, cpu3-6 @2.8032, cpu7 @3.0144 GHz"

`raw/recon_sa802025.txt`:

> `/sys/devices/system/cpu/cpu0 2016000`
> `/sys/devices/system/cpu/cpu1 2016000`
> `/sys/devices/system/cpu/cpu2 2016000`
> `/sys/devices/system/cpu/cpu3 2803200`
> `/sys/devices/system/cpu/cpu4 2803200`
> `/sys/devices/system/cpu/cpu5 2803200`
> `/sys/devices/system/cpu/cpu6 2803200`
> `/sys/devices/system/cpu/cpu7 3014400`

2016000 kHz = 2.016 GHz ✓. 2803200 kHz = 2.8032 GHz ✓. 3014400 kHz = 3.0144 GHz ✓.

**CONFIRMED.**

### CPU_MASK f0

`raw/recon_sa802025.txt`: `nproc=8`. `/tmp/cell56.log` line 3:

> `CPU_MASK=f0 nproc=8`

**CONFIRMED.**

### ~13.5 min

REPORT.md: "Running 07:32:31 → ended 07:46:02 CEST = ~13.5 min billed"

`/tmp/cell56.log`: first timestamp `[07:33:05]`, last `[07:45:25] DONE`. Portal times (07:32:31→07:46:02) = 13.52 min. Log-internal span = 12.4 min. Report uses portal times.

**CONFIRMED** (portal-sourced, not log-sourced — acceptable but should say "portal-verified" which it does).

---

## ANGLE 2: Cross-tier claim

### "tbo_mm has no FAIL line at all"

**CONFIRMED.** `grep -ci 'fail' raw/tbo_mm_sa802025.out` = 0.

### "The 750's 20-FAIL family does NOT reproduce on the 735"

Cell #55 (`qdc-8g3-govbench-55/raw/tbo_mm_sa802004.out`):

> `905/925 tests passed`

20 failures (925 − 905 = 20). All 20 are f16/bf16 batched MUL_MAT variants with bs=[2,1], [4,1], [8,1], [1,3], [2,3], [4,3], [8,3] — exactly the "f16/bf16-batched family" described. Cell #55 tbo_mmid: `407/407 tests passed`, zero FAIL.

Cell #56 tbo_mm: 925/925, zero FAIL. Cell #56 tbo_mmid: 407/407, zero FAIL.

**CONFIRMED** — the defect does not reproduce on Adreno 735.

### "Same kit binary" — kit_verify SHA comparison

REPORT.md (via PREREG.md line 3): "gov-kit 5c3979438 `419bef91…`"

All three kit_verify files (cells #52, #55, #56) are **byte-identical** (`diff` exits 0). Contents:

```
BUILD_NOTE.txt: OK
libomp.so: OK
llama-bench: OK
...
```

**PROBLEM:** The kit_verify script prints only OK/FAIL per filename — **no sha256 hashes are recorded in raw/**. The "419bef91… family payload shas" claim in the PREREG is not verifiable from raw files alone. The log says "kit shas OK" (`/tmp/cell56.log` line: `push verified (model sha OK, kit shas OK)`) but the actual hash values are not captured.

**VERDICT: PLAUSIBLE** — the push verification passed, but the raw evidence is insufficient to independently confirm the specific SHA family. The kit_verify script is a weak verification artifact.

### "20-FAIL" count accuracy

Cell #55 `grep -c 'FAIL' tbo_mm_sa802004.out` = 22. After filtering `grep -v 'Backend|backends|exit'`: 21 lines. But one of those is a trailing `[1;31mFAIL[0m` backend summary marker, not a test line. Actual test FAIL lines = 20 (matching `905/925`).

The report's "20-FAIL" is **CONFIRMED**.

---

## ANGLE 3: Gate discipline

### GATE_FAIL count in /tmp/cell56.log

`grep -c 'GATE_FAIL' /tmp/cell56.log` = **0**.

**CONFIRMED.**

### GATE_PASS count

`grep -c 'GATE_PASS' /tmp/cell56.log` = **10**.

5 arms × 2 gates (pre+post) = 10. Pattern from log:

```
GATE_PASS          (1 — PRE tbo_mm)
[07:34:44] start tbo_mm
GATE_PASS          (2 — POST tbo_mm start)
...
GATE_PASS          (9 — PRE bench_cpu_pure)
[07:42:23] start bench_cpu_pure
GATE_PASS          (10 — POST bench_cpu_pure start, "the final one")
```

The "final one" (GATE_PASS #10) is indeed GATE_PASS. No retries visible in log.

**CONFIRMED.**

---

## ANGLE 4: Grid discipline

### G1 wording — first-contact legitimacy

REPORT.md line: "G1 fires (grid as #52, first contact): kernels all-PASS and GPU pp512 (154.8) ≫ CPU pp512 (14.9)"

Inherited grid from `../qdc-7pg3-govbench-52/PREREG.md`:

> G1: Q1 all-PASS AND GPU pp512 > CPU pp512 → 7xx behaves like the 750-class

"First-contact" is correct: Adreno 735 has **no prior data** in any cell. This is a legitimate first-contact grid application, unlike cell #55's post-hoc issue. No problem here.

**CONFIRMED.**

---

## ANGLE 5: Four-tier table

### 740 flagged as non-comparable

REPORT.md: "† 740 numbers are Q4_K_M from the A/B cell — NOT comparable to the Q4_0 rows"

Raw `bench_base_1_sa801919.out` (cell #53):

> `lfm2 2.6B Q4_K - Medium` — pp512 **83.82 ± 0.74**

Cell #53 uses Q4_K_M, not Q4_0. Cell #53 build: `a0cabca6b (10033)` vs cell #56 build: `5c3979438 (10050)` — **different kit builds** too.

**CONFIRMED** — correctly flagged. The footnote is accurate.

### "735≈732 one performance class" — overlap check

| Tier | pp512 | ± |
|---|---|---|
| 732 (cell #52 raw) | 151.78 | ± 1.12 |
| 735 (cell #56 raw) | 154.82 | ± 1.34 |

Difference: 3.04 t/s.

- 1σ overlap: 732 upper = 152.90, 735 lower = 153.48. **Gap = 0.58. NO overlap at 1σ.**
- 2σ overlap: 732 upper = 154.02, 735 lower = 152.14. **Overlap exists at 2σ.**

REPORT.md says "the two mid-tier Adrenos are effectively one performance class." At 1σ they are **disjoint**. At 2σ they overlap. "Within noise" is defensible at 2σ but the report doesn't specify which sigma.

**VERDICT: PLAUSIBLE** — the claim is not wrong, but "within noise" without specifying σ is imprecise. Should say "overlap at 2σ" or similar.

### Missing ± in four-tier table

The four-tier table reports bare numbers (151.8, 154.8, 84.1, 284.2) with no ±. The ± values exist in the raw files for all four tiers. This is a formatting omission that weakens the table's utility.

**OMISSION.**

---

## ANGLE 6: Omissions in raw/

### What's present (17 files)

recon, kit_verify, 3 bench files (cpu, gpu, cpu_pure), 2 tbo files (mm, mmid), 10 therm files (5 pre + 5 post).

### What's missing

1. **No kit SHA256SUMS printout.** Kit_verify only prints OK/FAIL per file. The PREREG claims `419bef91…` family shas but no file in raw/ contains the actual hash values. Cannot independently verify kit identity.

2. **No model SHA256 printout.** The log says "model sha OK" but the raw hash is not recorded anywhere.

3. **No loadprobe files.** Cell #52 raw contains `loadprobe_sa801864.out` and `loadprobe_FAcrash_sa801864.out`. Cell #56 has none. The cell #56 PREREG inherits #52's procedure which includes loadprobe in the raw. However, the cell #56 REPORT only describes 5 arms and doesn't mention loadprobe. If loadprobe was run, its output is missing. If it wasn't run, this is a procedure deviation from the inherited PREREG that should be documented.

4. **No FA test.** REPORT.md says "FA not exercised, as in #52." But cell #52 raw contains `loadprobe_FAcrash_sa801864.out`, suggesting FA **was** tested in #52 (and crashed). The four-tier table says "732: FA does not compile" which is consistent with a crash. The claim "as in #52" is inaccurate if #52 did exercise FA.

**OMISSION / INACCURACY.**

---

## VERDICT SUMMARY

| Claim | Verdict |
|---|---|
| 925/925, 407/407 | **CONFIRMED** |
| Zero FAIL in tbo files | **CONFIRMED** |
| Six bench numbers ± | **CONFIRMED** |
| SM8635, core freqs, mask f0 | **CONFIRMED** |
| ~13.5 min | **CONFIRMED** |
| Cross-tier: no FAIL on 735 | **CONFIRMED** |
| "Same kit binary" (SHA verifiable) | **PLAUSIBLE** (push OK, but raw lacks hashes) |
| 20-FAIL count for cell #55 | **CONFIRMED** |
| GATE_FAIL = 0 | **CONFIRMED** |
| GATE_PASS = 10, consistent with 5×2 | **CONFIRMED** |
| G1 first-contact (no post-hoc) | **CONFIRMED** |
| 740 non-comparable (Q4_K_M) | **CONFIRMED** |
| 735≈732 "one performance class" | **PLAUSIBLE** (2σ overlap, not 1σ) |
| FA "not exercised, as in #52" | **REFUTED** (#52 has loadprobe_FAcrash) |
| Four-tier table ± values | **OMISSION** |
| Kit SHA in raw | **OMISSION** |
| Model SHA in raw | **OMISSION** |

## FIX LIST

1. **Four-tier table: add ± columns.** All four tiers have ± in their raw files. Omitting them makes the table look like exact numbers.

2. **"735≈732 one performance class": qualify the σ.** Say "overlap at 2σ" not just "within noise." At 1σ the intervals are disjoint (gap = 0.58).

3. **"FA not exercised, as in #52"**: Cell #52 raw contains `loadprobe_FAcrash_sa801864.out`. Either correct to "FA not exercised in #56; #52's FA test crashed" or clarify what "as in #52" means.

4. **Kit SHA verification**: The kit_verify script should print actual sha256 hashes, not just "OK." Current raw evidence is insufficient to verify the `419bef91…` claim independently.

5. **Model SHA**: Record the model sha256 in a raw file (e.g., in kit_verify or a separate model_verify file).

6. **Loadprobe**: If loadprobe was run in #56, its output is missing from raw/. If it was deliberately omitted (since #56 is a different tier than #52's procedure), state this explicitly in the REPORT.

## OVERALL: **APPLY** (with fixes 1–3 mandatory, 4–6 recommended)