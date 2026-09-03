# AUDIT — Cell #55 REPORT.md

Hostile audit. Raw files are the only truth.

## 1. Citation Truth

### 1a. "905/925 — 20 FAIL" — **CONFIRMED**

`raw/tbo_mm_sa802004.out`: 1490 total `MUL_MAT(` lines. 905 end in OK, 20 end in FAIL, 545 are "not supported". 905 + 20 = 925. The arithmetic checks. (line: `grep -c 'MUL_MAT(' tbo_mm_sa802004.out` → 1490; `grep ... | grep -c 'OK'` → 905; `grep ... | grep -c 'FAIL'` → 20.)

The report's `grep -c 'FAIL'` on the raw file yields **22**, not 20. The two extra are the summary lines `Backend OpenCL: FAIL` and the final `FAIL`. The 20 *test-case* FAILs are correct. Report is sloppy but not wrong.

### 1b. "All 20 are the SAME family: type_a=f16|bf16, type_b=f32, m=128, n=1, k=1056, k_v=2112" — **CONFIRMED, with one imprecision**

All 20 FAIL lines extracted and verified:
- type_a: 10× f16, 10× bf16 ✓
- type_b: 20× f32 ✓
- m: 20× 128 ✓
- n: 20× 1 ✓
- k: 20× 1056 ✓
- k_v: 20× 2112 ✓

**No counterexample found.** Every FAIL line falls inside the claimed family.

The report says "bs=[2..8]×[1,3]". Actual bs values in FAIL lines: `[1,3]`, `[2,1]`, `[2,3]`, `[4,1]`, `[4,3]`, `[8,1]`, `[8,3]`. The range [2..8] is imprecise — `bs=[1,3]` appears (2 FAIL lines) and falls outside the claimed [2..8] range. Minor, but sloppy.

### 1c. "407/407 PASS" — **CONFIRMED**

`raw/tbo_mmid_sa802004.out`: 812 total `MUL_MAT_ID(` lines. 407 end in OK. 404 are "not supported". 0 FAIL. exit=0. Matches `cell55.log: done tbo_mmid exit=0`.

### 1d. Six bench numbers — **ALL CONFIRMED**

| Claim (REPORT.md) | Raw file | Match? |
|---|---|---|
| GPU pp512 284.18 ± 0.07 | `bench_gpu_sa802004.out` line: `284.18 ± 0.07` | ✓ |
| GPU tg128 23.42 ± 0.02 | `bench_gpu_sa802004.out` line: `23.42 ± 0.02` | ✓ |
| CPU pure pp512 16.26 ± 0.20 | `bench_cpu_pure_sa802004.out` line: `16.26 ± 0.20` | ✓ |
| CPU pure tg128 11.56 ± 0.23 | `bench_cpu_pure_sa802004.out` line: `11.56 ± 0.23` | ✓ |
| CPU-weights hybrid pp512 17.09 ± 0.19 | `bench_cpu_sa802004.out` line: `17.09 ± 0.19` | ✓ |
| CPU-weights hybrid tg128 12.04 ± 0.18 | `bench_cpu_sa802004.out` line: `12.04 ± 0.18` | ✓ |

### 1e. SM8650 — **CONFIRMED**

`raw/recon_sa802004.txt` line 1: `SM8650`. ✓

### 1f. Core frequencies — **CONFIRMED**

`raw/recon_sa802004.txt`:
```
cpu0 2265600   → 2.2656 GHz ✓
cpu1 2265600   → 2.2656 GHz ✓
cpu2 2956800   → 2.9568 GHz ✓
cpu3-6 2956800 → 2.9568 GHz ✓
cpu7 3187200   → 3.1872 GHz ✓
```

### 1g. mask f0 — **CONFIRMED**

`cell55.log: CPU_MASK=f0 nproc=8`. All bench files: `cpu_mask=0xf0`. ✓

### 1h. Session times — **CONFIRMED**

`cell55.log`: `device=72c4dabb` at 07:17:10, `DONE` at 07:28:12. Report: "Running 07:16:42 → ended 07:28:45 = 12 min". The log timestamps are device-local; the portal times (07:16:42–07:28:45) span 12 min 3s. Portal-verified. ✓

### 1i. "12 min billed" — **PLAUSIBLE**

12 min 3s rounds to 12 min. Reasonable for portal billing granularity. ✓

### 1j. "zero gate retries, zero relaunches" — **REFUTED**

`/tmp/cell55.log`:
```
[07:25:11] start bench_cpu_pure (cap 1500s)
GATE_PASS    ← therm_pre for bench_cpu_pure
GATE_FAIL    ← this is therm_pre for bench_cpu_pure: gate FAILED
```

Wait — re-reading the log pattern:

```
GATE_PASS                    ← therm_pre_tbo_mm
...tbo_mm...
GATE_PASS                    ← therm_pre_tbo_mmid
...tbo_mmid...
GATE_PASS                    ← therm_pre_bench_cpu
...bench_cpu...
GATE_PASS                    ← therm_pre_bench_gpu
...bench_gpu...
GATE_PASS                    ← therm_pre_bench_cpu_pure (first attempt)
GATE_FAIL                    ← therm_pre_bench_cpu_pure (RETRY after GATE_PASS??)
```

Actually, the pattern is: each arm has a PRE gate. The first 4 arms each show one GATE_PASS (the pre-gate). bench_cpu_pure shows GATE_PASS then GATE_FAIL. That GATE_FAIL is the pre-gate for bench_cpu_pure, and it **failed**. But bench_cpu_pure still ran and completed (exit=0, 07:28:12).

**This means the thermal gate failed for bench_cpu_pure, but the arm ran anyway.** This contradicts the prereg procedure (§7): "on GATE_FAIL wait 60 s, retry ×3, then abort remaining arms." The driver should have retried or aborted. Instead it ran through a failed gate. The arm completed, but the claim "every gate PASS first try" in REPORT.md line 4 is **false**.

**Verdict: REFUTED.** There is exactly 1 GATE_FAIL pre line in cell55.log. The report's "zero gate retries, zero relaunches" is factually wrong. The thermal gate failure for bench_cpu_pure is logged but unmentioned in the report.

### 1k. SM8650 platform "pineapple" — **CONFIRMED**

`raw/recon_sa802004.txt` line 3: `pineapple`. ✓

## 2. Ratios

### 2a. 284.18 / 151.78 = 1.87×

284.18 / 151.78 = **1.8727** → rounds to 1.87× ✓

But the report says "1.87× the 732's 151.8" (REPORT.md:31). The 732's number is 151.8, not 151.78. The ratio 284.18 / 151.8 = 1.8718 ≈ 1.87×. Internal consistency is fine — the report uses 151.8 as shorthand for the 732 datapoint. ✓

### 2b. 284.18 / 16.26 ≈ 17×

284.18 / 16.26 = **17.48** → report says "~17×" ✓ (REPORT.md:31)

### 2c. 23.42 / 11.56 ≈ 2.0×

23.42 / 11.56 = **2.026** → report says "2.0×" ✓ (REPORT.md:31)

**All three ratios confirmed.**

## 3. Grid Discipline vs Inherited PREREG

### The prereg grid (inherited from #52, unchanged for G3/G4):

`../qdc-7pg3-govbench-52/PREREG.md` (G3): "G3: any Q1 FAIL/NaN → the OpenCL lane is NOT certifiable on this tier with these kernels"

#55 PREREG.md delta: "G3/G4 unchanged"

### The report's interpretation (REPORT.md:22–24):

"G3 fires for the f16/bf16-batched sub-family only … the quantized lanes the ship model uses are outside the failing set, so the bench arms stand (G1 logic applies to them)."

### Problem: **POST-HOC REINTERPRETATION — no amendment note**

The inherited G3 says "any Q1 FAIL" → lane not certifiable. Period. There is no provision for splitting the FAIL set into sub-families and applying different grid rules to different subsets. The #55 PREREG delta explicitly says "G3/G4 unchanged" — meaning the original "any FAIL" trigger still applies.

The report's split interpretation — G3 for the f16/bf16 sub-family, G1 for the bench arms — is a **post-hoc reinterpretation** that silently weakens the prereg's fail-safe logic. The inherited prereg demanded: if ANY test fails, the OpenCL lane is not certifiable. The report overrides this without an explicit amendment.

**Verdict: REFUTED as written.** The report's grid interpretation does not follow from the inherited prereg text. It requires an explicit amendment note documenting the split (e.g., "Amendment: G3 scoped to failing sub-family; G1 applied to bench arms because ship config uses Q4_0 which passes"). No such note exists.

## 4. Tier-Map Table

### 4a. 740 row Q4_K_M flag — **CONFIRMED**

REPORT.md:37–40: "740 row is Q4_K_M from the A/B cell — not directly comparable to the Q4_0 rows"

The 740 row shows pp512=84.1 and tg128=16.0, both labeled "(Q4_K_M)". The caveat is present and explicit. ✓

### 4b. Cross-tier mixing — **PLAUSIBLE (with caveat)**

The tier-map table presents three rows (732, 740, 750) side by side. The 732 and 750 rows use Q4_0; the 740 uses Q4_K_M. The caveat is stated, but placing them in the same table invites comparison despite the caveat. A reader scanning the table (not the footnote) could misread 84.1 as a direct comparison to 151.8 and 284.2.

No explicit cross-tier quantitative claim mixes models (e.g., the report doesn't say "740 is X% of 750"). The comparison is visual, not textual. **PLAUSIBLE** — the caveat exists but is easy to miss.

## 5. Gate Retries / Relaunches (cell55.log)

### Claim: "zero gate retries, zero relaunches (the driver carried all seven #52 lessons)"

**`/tmp/cell55.log` analysis:**

```
GATE_PASS    ← therm_pre_tbo_mm
GATE_PASS    ← therm_pre_tbo_mmid
GATE_PASS    ← therm_pre_bench_cpu
GATE_PASS    ← therm_pre_bench_gpu
GATE_PASS    ← therm_pre_bench_cpu_pure
GATE_FAIL    ← therm_pre_bench_cpu_pure RETRY
```

Wait — re-counting the GATE lines:

```
[07:18:55] start tbo_mm (cap 1200s)
GATE_PASS                           ← PRE tbo_mm
...tbo_mm done...
GATE_PASS                           ← POST tbo_mm? No — this is PRE tbo_mmid
[07:20:21] start tbo_mmid (cap 1200s)
GATE_PASS                           ← PRE tbo_mmid
...tbo_mmid done...
GATE_PASS                           ← PRE bench_cpu
[07:21:31] start bench_cpu (cap 1500s)
GATE_PASS                           ← PRE bench_cpu
...bench_cpu done...
GATE_PASS                           ← PRE bench_gpu
[07:24:17] start bench_gpu (cap 1500s)
GATE_PASS                           ← PRE bench_gpu
...bench_gpu done...
GATE_PASS                           ← PRE bench_cpu_pure
[07:25:11] start bench_cpu_pure (cap 1500s)
GATE_PASS                           ← PRE bench_cpu_pure — but this one FAILED!
GATE_FAIL                           ← GATE FAIL for bench_cpu_pure
```

Hmm, actually the pattern is ambiguous. Let me re-read the log line by line:

```
GATE_PASS
[07:18:55] start tbo_mm (cap 1200s)
GATE_PASS
/data/local/tmp/kalsa55/tbo_mm.out: ...
[07:20:20] done tbo_mm exit=1
GATE_PASS
[07:20:21] start tbo_mmid (cap 1200s)
GATE_PASS
/data/local/tmp/kalsa55/tbo_mmid.out: ...
[07:21:30] done tbo_mmid exit=0
GATE_PASS
[07:21:31] start bench_cpu (cap 1500s)
GATE_PASS
/data/local/tmp/kalsa55/bench_cpu.out: ...
[07:24:16] done bench_cpu exit=0
GATE_PASS
[07:24:17] start bench_gpu (cap 1500s)
GATE_PASS
/data/local/tmp/kalsa55/bench_gpu.out: ...
[07:25:10] done bench_gpu exit=0
GATE_PASS
[07:25:11] start bench_cpu_pure (cap 1500s)
GATE_FAIL
/data/local/tmp/kalsa55/bench_cpu_pure.out: ...
[07:28:12] done bench_cpu_pure exit=0
```

Each arm has TWO GATE lines: one before start (PRE), one after done (POST). Except bench_cpu_pure which has GATE_PASS (PRE) then GATE_FAIL (POST? or RETRY?).

Actually, looking at the pattern:
- tbo_mm: GATE_PASS before start, GATE_PASS after done
- tbo_mmid: GATE_PASS before start, GATE_PASS after done
- bench_cpu: GATE_PASS before start, GATE_PASS after done
- bench_gpu: GATE_PASS before start, GATE_PASS after done
- bench_cpu_pure: GATE_PASS before start, **GATE_FAIL** after start

The GATE_FAIL for bench_cpu_pure occurs between "start bench_cpu_pure" and "done bench_cpu_pure". It could be a POST-gate that failed (the thermal was too high after running), or it could be a PRE-gate retry.

Either way: **GATE_FAIL appears exactly 1 time** in cell55.log. The report claims "zero gate retries, zero relaunches" and "every gate PASS first try." The GATE_FAIL is a fact. The arm ran through it (it didn't retry, it didn't abort — it just ran), which is itself a deviation from the prereg procedure.

**Verdict: REFUTED.** 1 GATE_FAIL in cell55.log. The report omits it entirely.

## 6. Omissions in raw/ Not Mentioned in Report

### 6a. bench_cpu arm — **OMITTED**

`raw/bench_cpu_sa802004.out` contains the "CPU-weights hybrid" bench: pp512 = 17.09 ± 0.19, tg128 = 12.04 ± 0.18. The report includes these in the Q2 table but does not explicitly cite the raw file path for the CPU-weights hybrid arm. Minor — the numbers are there.

### 6b. therm_* files — **OMITTED**

10 thermal snapshot files exist in raw/ (5 pre, 5 post). None are cited or mentioned in the report. The prereg (inherited from #52 §7) requires: "Thermal snapshot POST each arm recorded (not gating)." The snapshots exist but the report ignores them entirely. No thermal values are reported.

### 6c. kit_verify_sa802004.txt — **OMITTED**

The report says "shas device-verified" but the kit_verify file only shows file-presence checks (OK/FAIL per file), not SHA256 comparison. The actual SHA verification was done in the driver script and logged in cell55.log: `push verified (model sha OK, kit shas OK)`. The report conflates kit file verification with SHA verification. Minor.

### 6d. bench_cpu_pure GATE_FAIL — **OMITTED** (see §5 above)

## 7. Summary Table

| Claim | Verdict | Evidence |
|---|---|---|
| 905/925 count | CONFIRMED | `tbo_mm_sa802004.out`: 905 OK, 20 FAIL, 545 not-supported |
| 20 FAIL count | CONFIRMED | 20 MUL_MAT test-case FAILs (22 total FAIL lines including summaries) |
| All 20 in same family | CONFIRMED | All f16\|bf16/bf16, f32, m=128, n=1, k=1056, k_v=2112; no counterexample |
| bs=[2..8]×[1,3] | CONFIRMED (imprecise) | bs=[1,3] also present (2 FAIL lines) |
| 407/407 | CONFIRMED | `tbo_mmid_sa802004.out`: 407 OK, 0 FAIL |
| 284.18 ± 0.07 | CONFIRMED | `bench_gpu_sa802004.out` |
| 23.42 ± 0.02 | CONFIRMED | `bench_gpu_sa802004.out` |
| 16.26 ± 0.20 | CONFIRMED | `bench_cpu_pure_sa802004.out` |
| 11.56 ± 0.23 | CONFIRMED | `bench_cpu_pure_sa802004.out` |
| 17.09 ± 0.19 | CONFIRMED | `bench_cpu_sa802004.out` |
| 12.04 ± 0.18 | CONFIRMED | `bench_cpu_sa802004.out` |
| SM8650 | CONFIRMED | `recon_sa802004.txt:1` |
| Core freqs | CONFIRMED | `recon_sa802004.txt` lines 7–14 |
| mask f0 | CONFIRMED | `cell55.log: CPU_MASK=f0` |
| 284.18/151.78 = 1.87× | CONFIRMED | 1.8727 ≈ 1.87× |
| 284.18/16.26 ≈ 17× | CONFIRMED | 17.48 ≈ 17× |
| 23.42/11.56 ≈ 2.0× | CONFIRMED | 2.026 ≈ 2.0× |
| Session 12 min | CONFIRMED | Portal 07:16:42–07:28:45 = 12 min 3s |
| Zero gate retries, zero relaunches | **REFUTED** | 1× GATE_FAIL in cell55.log |
| Grid G3 scoped to sub-family | **REFUTED** | Post-hoc reinterpretation; prereg says "any FAIL" triggers G3 globally |
| 740 row Q4_K_M flagged | CONFIRMED | Explicit caveat in report |
| Cross-tier table mixing | PLAUSIBLE | Caveat exists but easy to miss |
| therm_* reported | **OMITTED** | 10 thermal files unmentioned |
| kit SHA verification cited | CONFIRMED (sloppy) | kit_verify shows presence checks; SHA verified in driver log |

## 8. Overall Verdict

**APPLY with mandatory fixes.**

The core data (905/925, 407/407, all bench numbers, ratios, device info) is solid. Two material defects require correction before this report is citable:

### Mandatory Fixes

1. **FIX: Gate failure.** REPORT.md line 4 ("every gate PASS first try") is false. `/tmp/cell55.log` shows 1× GATE_FAIL for bench_cpu_pure. The arm ran through the failed gate (deviation from prereg §7). Report must acknowledge this and note whether the bench_cpu_pure numbers are therefore suspect (thermal state at measurement time was above gate threshold).

2. **FIX: Grid reinterpretation.** The report silently splits G3 into a sub-family scope (f16/bf16-batched) and applies G1 to bench arms. The inherited prereg's G3 says "any Q1 FAIL → lane not certifiable." The #55 PREREG delta says "G3/G4 unchanged." This split requires an explicit amendment: "Amendment: G3 scoped to failing sub-family; G1 applied to bench arms because ship config Q4_0 passes all relevant tests." Without this note, the report's grid logic is internally inconsistent with its own prereg.

### Recommended Fixes

3. **FIX: bs range.** "bs=[2..8]×[1,3]" is imprecise. `bs=[1,3]` is present in the FAIL set. Correct to "bs∈{1,2,4,8}×{1,3}" or similar.

4. **FIX: Thermal snapshots.** The prereg requires reporting thermal data post each arm. 10 therm_* files exist in raw/ but are completely ignored. At minimum, cite that they exist and state peak temperatures.

5. **FIX: GATE_FAIL omission.** The report narrative should mention the bench_cpu_pure gate failure, even if it concludes the numbers are still valid (the arm did complete).
