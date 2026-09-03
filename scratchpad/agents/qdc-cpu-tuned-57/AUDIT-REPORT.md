# AUDIT-REPORT — Cell #57 REPORT.md

Date: 2026-09-03. Hostile audit. Every claim traced to raw files.

---

## 1. Citation truth

### 1.1 Six tuned numbers — ALL CONFIRMED

All six values match the raw bench outputs exactly:

| Tier | Source file | Report claims | Actual | Verdict |
|---|---|---|---|---|
| 7675 pp512 | `raw/bench_cpu_tuned_sa802058.out` | 95.21 ± 1.17 | 95.21 ± 1.17 | MATCH |
| 7675 tg128 | same | 20.02 ± 0.12 | 20.02 ± 0.12 | MATCH |
| 8635 pp512 | `raw/bench_cpu_tuned_sa802067.out` | 97.14 ± 0.99 | 97.14 ± 0.99 | MATCH |
| 8635 tg128 | same | 20.49 ± 0.12 | 20.49 ± 0.12 | MATCH |
| 8650 pp512 | `raw/bench_cpu_tuned_sa802071.out` | 98.97 ± 12.78 | 98.97 ± 12.78 | MATCH |
| 8650 tg128 | same | 28.58 ± 0.32 | 28.58 ± 0.32 | MATCH |

### 1.2 Untuned comparators — ALL CONFIRMED

Report:19–20 untuned column values match the three `bench_cpu_pure_*.out` files:

| Tier | Source file | Report | Actual | Verdict |
|---|---|---|---|---|
| 7675 pp512 | `../qdc-7pg3-govbench-52/raw/bench_cpu_pure_sa801864.out` | 13.77 | 13.77 ± 0.23 | MATCH |
| 7675 tg128 | same | 10.27 | 10.27 ± 0.09 | MATCH |
| 8635 pp512 | `../qdc-8s3-govbench-56/raw/bench_cpu_pure_sa802025.out` | 14.91 | 14.91 ± 0.01 | MATCH |
| 8635 tg128 | same | 11.34 | 11.34 ± 0.09 | MATCH |
| 8650 pp512 | `../qdc-8g3-govbench-55/raw/bench_cpu_pure_sa802004.out` | 16.26 | 16.26 ± 0.20 | MATCH |
| 8650 tg128 | same | 11.56 | 11.56 ± 0.23 | MATCH |

**Note:** The untuned files report `backend OpenCL` (OpenCL compiled in, ngl=0). The tuned files report `backend CPU` (no OpenCL compiled). This is a cross-binary comparison, acknowledged in caveat 2 but not in table 1 itself.

### 1.3 GPU comparators — ALL CONFIRMED

Report:30 GPU column values match the three `bench_gpu_*.out` files:

| Tier | Source file | Report | Actual | Verdict |
|---|---|---|---|---|
| 7675 GPU pp512 | `../qdc-7pg3-govbench-52/raw/bench_gpu_sa801864.out` | 151.8 | 151.78 ± 1.12 | MATCH (rounded) |
| 7675 GPU tg128 | same | 17.3 | 17.26 ± 0.02 | MATCH (rounded) |
| 8635 GPU pp512 | `../qdc-8s3-govbench-56/raw/bench_gpu_sa802025.out` | 154.8 | 154.82 ± 1.34 | MATCH (rounded) |
| 8635 GPU tg128 | same | 16.5 | 16.49 ± 0.01 | MATCH (rounded) |
| 8650 GPU pp512 | `../qdc-8g3-govbench-55/raw/bench_gpu_sa802004.out` | 284.2 | 284.18 ± 0.07 | MATCH (rounded) |
| 8650 GPU tg128 | same | 23.4 | 23.42 ± 0.02 | MATCH (rounded) |

### 1.4 Backend column says CPU — CONFIRMED

All three tuned bench files show `backend CPU`, no `ggml_opencl` line anywhere. The comparator untuned files all show `backend OpenCL` with `ggml_opencl:` headers. This is consistent with GGML_OPENCL=OFF vs ON.

### 1.5 Session IDs and times

| Session | Report claims | Log actual | Verdict |
|---|---|---|---|
| S1 | job 797989, sa802058, arm done 08:29:55 | `/tmp/cell57s1.log`: job=sa802058, done 08:29:55 | MATCH |
| S2 | job 797998, sa802067, arm done 08:35:57 | `/tmp/cell57s2.log`: job=sa802067, done 08:35:57 | MATCH |
| S3 | job 798002, sa802071, arm done 08:42:19 | `/tmp/cell57s3.log`: job=sa802071, done 08:42:19 | MATCH |

### 1.6 No `\r` endings — CONFIRMED

All three bench files are clean Unix text. `cat -v` and `xxd` confirm no `\r` bytes.

---

## 2. Arithmetic

### 2.1 Tuning effect ratios — ERROR in pp512 range

Report:23 claims **"pp512 ×6.1–6.9"**. Actual computation:

- 7675: 95.21 / 13.77 = **6.91×**
- 8635: 97.14 / 14.91 = **6.52×**
- 8650: 98.97 / 16.26 = **6.09×**

True range: **6.09×–6.91×**. The report's "×6.1–6.9" drops the 8650 from the range entirely (6.09 rounds down, not up). This is a selective presentation that hides the worst-case tuning gain.

Report:23 claims **"tg128 ×1.8–2.5"**. Actual:

- 7675: 20.02 / 10.27 = **1.95×**
- 8635: 20.49 / 11.34 = **1.81×**
- 8650: 28.58 / 11.56 = **2.47×**

True range: 1.81×–2.47×. Report rounds "1.81" down to "×1.8" and "2.47" up to "×2.5". Acceptable rounding but the pp512 error is the real problem.

### 2.2 Table 2 ratios — ONE ERROR

| Ratio | Report | Actual | Verdict |
|---|---|---|---|
| 7675 GPU/CPU pp | 1.59× | 151.78/95.21 = 1.59× | OK |
| 7675 GPU/CPU tg | 0.86× | 17.26/20.02 = 0.86× | OK |
| 8635 GPU/CPU pp | 1.59× | 154.82/97.14 = 1.59× | OK |
| **8635 GPU/CPU tg** | **0.81×** | **16.49/20.49 = 0.80×** | **ERROR** |
| 8650 GPU/CPU pp | 2.87× | 284.18/98.97 = 2.87× | OK |
| 8650 GPU/CPU tg | 0.82× | 23.42/28.58 = 0.82× | OK |

The 8635 tg128 ratio is 0.80×, not 0.81×. Minor but wrong.

### 2.3 Caveat 1 — NEARLY CORRECT

Report:39 claims "mean+2σ = 124 → 2.29×".

- mean+2σ = 98.97 + 2×12.78 = **124.53** (report says 124 — truncated, not rounded)
- GPU/CPU at upper = 284.18 / 124.53 = **2.28×** (report says 2.29×)

Both are off by rounding/truncation. The CV claim of "13%" is 12.9% — acceptable.

### 2.4 Grid thresholds mechanically applied — CONFIRMED

G1 (GPU ≥ 2× tuned-CPU → GPU confirmed):
- 7675: 1.59× < 2× → contested ✓
- 8635: 1.59× < 2× → contested ✓
- 8650: 2.87× ≥ 2× → GPU confirmed ✓

G2 (GPU ≥ 1.25× tuned-CPU → GPU wins decode):
- 7675: 0.86× < 1.25× → CPU wins ✓
- 8635: 0.80× < 1.25× → CPU wins ✓
- 8650: 0.82× < 1.25× → CPU wins ✓

G3 (tuned ≤ 1.15× untuned → build-suspect retracted):
- All tuned/untuned ratios are 1.81×–6.91× ≫ 1.15× → G3 refuted everywhere ✓

### 2.5 Amendment flag on 8650 row — CONFIRMED

Report:33 `⚠️ Amendment` marker is present on the 8650 GPU pp512 cell. Report:35 repeats "provisional per Amendment" in the G1 verdict. Carried through.

---

## 3. No OpenCL banner claim

Report:13 claims "no OpenCL banner". Verified: zero `ggml_opencl` lines in any of the three `raw/bench_cpu_tuned_*.out` files. The comparator `bench_cpu_pure_*.out` files (untuned) all contain `ggml_opencl:` lines. **CONFIRMED.**

---

## 4. Caveat 2: "no CPU-path commits in the governor-v0.2 delta"

`git log --stat 204e78259..1a33da0f6` in `/Users/marco/Projects/kalsallama-wt-governor`:

```
commit f7bb136  feat(governor): implement tri-engine runtime contract v0.2
 src/llama-ext.h, src/llama-governor*.cpp/h, src/CMakeLists.txt

commit e5adc86  test(governor): add v0.2 router golden tests
 tests/CMakeLists.txt, tests/test-governor-v02-router.cpp

commit 06171a5  fix(governor): partition admitted token batches safely
 src/llama-governor-runtime.cpp, src/llama-governor.cpp, src/llama-governor.h

commit fb67821  fix(governor): repair thermal exit boundaries
 src/llama-governor-policy.cpp, src/llama-governor-policy.h

commit 1a33da0  test(governor): cover runtime wrapper callbacks
 src/llama-governor.cpp, src/llama-governor.h, tests/test-governor-v02-router.cpp
```

**Zero files under `ggml/src/ggml-cpu/` touched.** All changes are in `src/llama-governor*.{cpp,h}`, `src/llama-ext.h`, `src/CMakeLists.txt`, `tests/`. Caveat 2's factual claim is **CONFIRMED.**

However: the claim that "CPU-side ops are unchanged" is an inference from "no ggml-cpu files touched." This inference is valid only if no file in `src/` restructures CPU dispatch paths. `src/llama-ext.h` gained 151 lines — worth a second look if it touches inference hot paths, but that is a governor-interface file, not a kernel.

---

## 5. Overreach analysis

### 5.1 "Headline" paragraph (REPORT:37)

> **Headline: the owner's S23 pattern generalizes.**

The S23 pattern (CPU decode wins on the 740) is now observed on 3 additional tiers (7675, 8635, 8650). That's 4 tiers total (740 + 3), not a universal generalization. The word "generalizes" implies a pattern across the entire Qualcomm Adreno lineup. It does not — 8 Elite is explicitly excluded (PREREG: non-goals), no MediaTek, no Samsung Exynos. This is overclaim.

> **decode is CPU territory on every tier measured today**

"every tier measured today" means 3 tiers. Fine as written if scoped to "today." But the sentence continues with "GPU at 0.81-0.86× CPU" — this range is computed from only 3 data points with 1 session each. A single-session 3-rep mean cannot establish a range that will hold under thermal stress, different loads, or different devices of the same SoC.

### 5.2 "Router consequence" paragraph (REPORT:41)

> **the owner's original tri-engine thesis, now with five tiers of evidence.**

This counts: 740 (from the original S23 campaign) + today's 3 tiers = 4. Where does "five" come from? The S23 campaign measured the 740; cells #52/#55/#56 measured GPU lanes; cell #57 measures tuned CPU. If the report counts the S23 740 as one, today's three as three, and the S23 prefill-CPU finding as a separate "tier" — that's double-counting. Or if "five tiers" means the five unique SoCs mentioned in the report (740, 7675, 8635, 8650, + ???), the fifth is missing. **This number is unsupported.**

### 5.3 Single-session limitations

Every tuned number is from **one session × 3 reps**. The report acknowledges this for S3 pp512 (13% CV) but does not acknowledge it for:

- **S3 tg128 = 28.58**, which is **40% higher** than S1 (20.02) and S2 (20.49). The 8650 prime core runs at 3187 MHz vs 2803/3014 for the other tiers, but a 40% decode gap from a ~10% clock difference is anomalous. No discussion of this. The 8650 may have been in a different DVFS/governor state during tg measurement. This is a red flag the report ignores entirely.

- S1 and S2 pp512 have CVs of 1.2% and 1.0% — these are tight. S3 at 13% is 10× worse. The report calls this "possible DVFS interaction" but does not investigate.

---

## 6. Verdicts summary

| Angle | Finding | Verdict |
|---|---|---|
| Citation truth (6 tuned numbers) | All match raw | **CONFIRMED** |
| Citation truth (3 untuned comparators) | All match raw | **CONFIRMED** |
| Citation truth (3 GPU comparators) | All match raw | **CONFIRMED** |
| Backend CPU / no OpenCL | Clean | **CONFIRMED** |
| Session IDs/times | All match logs | **CONFIRMED** |
| pp512 tuning ratio range | "×6.1–6.9" drops 8650 (6.09×) | **REFUTED** — must be 6.09–6.91× |
| tg128 tuning ratio range | "×1.8–2.5" is rounding-fudged | **PLAUSIBLE** — actual 1.81–2.47× |
| 8635 GPU/CPU tg128 ratio | Reported 0.81×, actual 0.80× | **REFUTED** — wrong by 0.01× |
| Caveat 1 upper-bound ratio | 2.29× should be 2.28× | **PLAUSIBLE** — rounding |
| Grid discipline (G1/G2/G3) | Mechanically correct | **CONFIRMED** |
| Amendment flag carried | Present on 8650 row | **CONFIRMED** |
| Caveat 2 (no CPU-path commits) | Zero ggml-cpu files in delta | **CONFIRMED** |
| "Headline: generalizes" | 3 tiers ≠ universal | **REFUTED** — overclaim |
| "five tiers of evidence" | Count is wrong (4 at best) | **REFUTED** — unsupported number |
| S3 tg128 anomaly (28.58 vs ~20) | Not flagged, not investigated | **REFUTED** — omitted red flag |

---

## 7. Required fixes

| # | Location | Issue | Fix |
|---|---|---|---|
| F1 | Report:23, Table 1 | "×6.1–6.9" drops the 8650 (6.09×) | Change to **"×6.09–6.91"** or "×6.1–6.9 (incl. 6.09× at 8650)" |
| F2 | Report:31, Table 2 | 8635 GPU/CPU tg128 says 0.81× | Change to **0.80×** |
| F3 | Report:39 | "124 → 2.29×" | Change to **124.5 → 2.28×** |
| F4 | Report:37 | "Headline: the owner's S23 pattern generalizes" | Replace with scoped statement: "The S23 740 pattern is replicated on three additional tiers in a single-session probe" |
| F5 | Report:41 | "five tiers of evidence" | Change to **"four tiers"** (740 + today's 3) or justify the fifth |
| F6 | Report (new caveat or footnote) | S3 tg128 = 28.58 is 40% above S1/S2 with no explanation | Add caveat: "S3 tg128 (28.58) is anomalous vs S1/S2 (~20); the 8650 decode advantage needs multi-session confirmation" |

---

## 8. Overall verdict

**APPLY with fixes F1–F6.** The raw numbers are honest. The grid discipline is mechanical and correct. Caveats 2–4 are sound. The pp512 ratio range error (F1) and the unsupported overclaim language (F4, F5) are the real problems — they make the report read stronger than the evidence supports. The missing S3 tg128 anomaly flag (F6) is an omission that could mislead the router design if left unaddressed.
