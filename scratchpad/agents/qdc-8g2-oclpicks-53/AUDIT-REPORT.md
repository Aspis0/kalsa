# AUDIT — Cell #53 REPORT.md

Hostile audit. Raw files are the only truth.

---

## 1. Citation Truth

### 1a. Correctness counts (925/925 ×2, 407/407 ×2, 229/229 ×2)

| Claim | Raw file | Actual | Verdict |
|---|---|---|---|
| MUL_MAT 925/925 base | `raw/tbo_base_mm_sa801919.out` | 1470 total MUL_MAT lines − 545 not-supported = **925 supported**; `2/2 backends passed`, `exit=0` | **CONFIRMED** |
| MUL_MAT 925/925 picks | `raw/tbo_picks_mm_sa801919.out` | Same: 925 supported, all pass, exit=0 | **CONFIRMED** |
| MUL_MAT_ID 407/407 base | `raw/tbo_base_mmid_sa801919.out` | 812 total − 405 not-supported = **407 supported**; all pass, exit=0 | **CONFIRMED** |
| MUL_MAT_ID 407/407 picks | `raw/tbo_picks_mmid_sa801919.out` | 407 supported, all pass, exit=0 | **CONFIRMED** |
| FLASH_ATTN_EXT 229/229 base | `raw/tbo_base_fa_sa801919.out` | 5097 total − 4868 not-supported = **229 supported**; all pass, exit=0 | **CONFIRMED** |
| FLASH_ATTN_EXT 229/229 picks | `raw/tbo_picks_fa_sa801919.out` | 229 supported, all pass, exit=0 | **CONFIRMED** |

### 1b. Bench numbers (four rows, pp512/tg128 with ±)

| REPORT claim | Raw line | Verdict |
|---|---|---|
| bench_base_1: pp512 83.82 ± 0.74, tg128 16.04 ± 0.01 | `bench_base_1_sa801919.out` line: `83.82 ± 0.74` / `16.04 ± 0.01` | **CONFIRMED** |
| bench_picks_1: pp512 84.78 ± 0.71, tg128 16.01 ± 0.01 | `bench_picks_1_sa801919.out`: `84.78 ± 0.71` / `16.01 ± 0.01` | **CONFIRMED** |
| bench_picks_2: pp512 84.50 ± 0.50, tg128 16.03 ± 0.02 | `bench_picks_2_sa801919.out`: `84.50 ± 0.50` / `16.03 ± 0.02` | **CONFIRMED** |
| bench_base_2: pp512 84.36 ± 0.55, tg128 16.04 ± 0.02 | `bench_base_2_sa801919.out`: `84.36 ± 0.55` / `16.04 ± 0.02` | **CONFIRMED** |

### 1c. Bench row attribution (base vs picks — the swap test)

Build shas embedded in `.out` trailing lines:
- `bench_base_1_sa801919.out`: `build: a0cabca6b` (base) — **CORRECT**
- `bench_picks_1_sa801919.out`: `build: 12f6d9b6d` (picks) — **CORRECT**
- `bench_picks_2_sa801919.out`: `build: 12f6d9b6d` (picks) — **CORRECT**
- `bench_base_2_sa801919.out`: `build: a0cabca6b` (base) — **CONFIRMED**

No swap. Attribution matches filename, kit tag, and build sha.

### 1d. Device / SoC / cores / RAM

| Claim | Source line | Verdict |
|---|---|---|
| SM8550 | `recon_sa801919.txt`: line 2 = `SM8550` | **CONFIRMED** |
| platform kalama | recon line 4: `kalama` | **CONFIRMED** |
| cpu0-2 @2.016 GHz | recon: `cpu0 2016000`, `cpu1 2016000`, `cpu2 2016000` | **CONFIRMED** |
| cpu3-6 @2.8032 GHz | recon: `cpu3 2803200`…`cpu6 2803200` | **CONFIRMED** |
| cpu7 @3.1872 GHz | recon: `cpu7 3187200` | **CONFIRMED** |
| RAM 11,548,288 kB | recon: `MemTotal: 11548288 kB` | **CONFIRMED** |
| nproc printed 6 | recon: `nproc` output = `6` | **CONFIRMED** |

### 1e. SHA heads

| Claim | Source | Verdict |
|---|---|---|
| base kit `385c80a5…` | REPORT line 23 | Kit_verify shows `BASE_SHA_OK` (sha256sum -c passed); actual sha256 head not printed in pulled output — **PLAUSIBLE** (verified on device, output truncated to status) |
| picks kit `5f8c6552…` | REPORT line 26 | Kit_verify shows `PICKS_SHA_OK` — same caveat — **PLAUSIBLE** |
| model sha `02a8b7e1…` | REPORT line 45, `MODEL_SHA.txt` | `MODEL_SHA.txt` contains `02a8b7e17487d326e46d68ce0ba24211e1b80a14c4cd0597fa73c1cd697f52ed` — **CONFIRMED** |
| base build `a0cabca6b` | bench_base_1/2 trailing line | **CONFIRMED** |
| picks build `12f6d9b6d` | bench_picks_1/2 trailing line | **CONFIRMED** |

---

## 2. Arithmetic

### 2a. Means

| Quantity | REPORT | Recomputed | Verdict |
|---|---|---|---|
| base mean pp512 | 84.09 | (83.82 + 84.36) / 2 = 84.09 | **CONFIRMED** |
| picks mean pp512 | 84.64 | (84.78 + 84.50) / 2 = 84.64 | **CONFIRMED** |
| base mean tg128 | 16.04 | (16.04 + 16.04) / 2 = 16.04 | **CONFIRMED** |
| picks mean tg128 | 16.02 | (16.01 + 16.03) / 2 = 16.02 | **CONFIRMED** |

### 2b. Delta percentages

| Quantity | REPORT | Recomputed | Verdict |
|---|---|---|---|
| Δ pp512 | +0.65% | (84.64 − 84.09) / 84.09 × 100 = +0.654% → rounds to +0.65% | **CONFIRMED** |
| Δ tg128 | −0.12% | (16.02 − 16.04) / 16.04 × 100 = −0.1247% → rounds to −0.12% | **CONFIRMED** |

### 2c. Billed minutes

REPORT: "Running 06:43:58 → 07:07:58 … = 24 min billed"

07:07:58 − 06:43:58 = 24:00. **CONFIRMED.**

Note: the first arm actually starts at 06:46:43 (from `/tmp/cell53.log`), so 06:43:58 is the session Setup time, not first-arm time. The 24 min billed = session wall clock, which is standard QDC billing. Not a contradiction, but the gap between Setup and first arm is ~2:45 of push/verify time.

---

## 3. A/B Integrity

### 3a. Kit tags match filenames

| File | Trailing kit= | Filename implies | Verdict |
|---|---|---|---|
| `tbo_base_mm_sa801919.out` | `kit=base` | base | **CONFIRMED** |
| `tbo_picks_mm_sa801919.out` | `kit=picks` | picks | **CONFIRMED** |
| `tbo_base_mmid_sa801919.out` | `kit=base` | base | **CONFIRMED** |
| `tbo_picks_mmid_sa801919.out` | `kit=picks` | picks | **CONFIRMED** |
| `tbo_base_fa_sa801919.out` | `kit=base` | base | **CONFIRMED** |
| `tbo_picks_fa_sa801919.out` | `kit=picks` | picks | **CONFIRMED** |
| `bench_base_1_sa801919.out` | `kit=base` | base | **CONFIRMED** |
| `bench_picks_1_sa801919.out` | `kit=picks` | picks | **CONFIRMED** |
| `bench_picks_2_sa801919.out` | `kit=picks` | picks | **CONFIRMED** |
| `bench_base_2_sa801919.out` | `kit=base` | base | **CONFIRMED** |

10/10. No mismatches.

### 3b. Builds differed

- base build: `a0cabca6b` (10033) — from bench_base_1/2 trailing lines
- picks build: `12f6d9b6d` (10036) — from bench_picks_1/2 trailing lines
- kit_verify: `PICKS_SHA_OK` and `BASE_SHA_OK` — both kits passed sha256sum -c on device

**CONFIRMED.** Different build shas + both kits sha-verified = distinct builds.

---

## 4. Grid Discipline

### 4a. G1 hygiene branch

REPORT: "picks all-PASS, baseline all-PASS, perf within ±3% → TAKE as correctness/hygiene only — NO perf claim"

PREREG line (G1): "within ±3% → TAKE as correctness/hygiene only (no perf claim)"

Both Δ values (+0.65%, −0.12%) are inside ±3%. **CONFIRMED** — REPORT applies G1 hygiene branch correctly.

### 4b. Amendment 1 non-trigger

REPORT: "All 10 arms ran once, in order, exit=0 — the ABBA block is UNFRAGMENTED"

From `/tmp/cell53.log` execution order:
1. tbo_base_mm → 2. tbo_picks_mm → 3. tbo_base_mmid → 4. tbo_picks_mmid → 5. tbo_base_fa → 6. tbo_picks_fa → 7. bench_base_1 → 8. bench_picks_1 → 9. bench_picks_2 → 10. bench_base_2

All exit=0. No re-runs. B block = bench_base_1 → bench_picks_1 → bench_picks_2 → bench_base_2 = ABBA. **CONFIRMED** — unfragmented, Amendment 1 does not trigger.

---

## 5. Thermal Claims

### 5a. "7 retries total" — **REFUTED**

`/tmp/cell53.log` shows 8 `GATE_FAIL pre` lines, each at `try 1/3`:

```
[06:50:23] GATE_FAIL pre tbo_base_mmid (try 1/3)
[06:52:50] GATE_FAIL pre tbo_picks_mmid (try 1/3)
[06:55:18] GATE_FAIL pre tbo_base_fa (try 1/3)
[06:56:57] GATE_FAIL pre tbo_picks_fa (try 1/3)
[06:58:36] GATE_FAIL pre bench_base_1 (try 1/3)
[07:00:47] GATE_FAIL pre bench_picks_1 (try 1/3)
[07:02:58] GATE_FAIL pre bench_picks_2 (try 1/3)
[07:05:09] GATE_FAIL pre bench_base_2 (try 1/3)
```

**8 retries, not 7.** Off by one.

### 5b. "0 aborts" — **CONFIRMED**

No `GATE_ABORT` in `/tmp/cell53.log`. Every retry succeeded on try 1/3.

### 5c. "63.0 °C / status 3 after the MUL_MAT census"

REPORT references `raw/therm_post_tbo_picks_mm…`:
- `therm_post_tbo_picks_mm_sa801919.txt`: `max_hal_temp=63.0 status=3` — **CONFIRMED**

Note: this is the picks MM post snapshot, not the highest in the session. `therm_post_bench_base_2_sa801919.txt` hits `max_hal_temp=64.1 status=3`, and `therm_post_bench_picks_2_sa801919.txt` hits `max_hal_temp=63.0 status=3`. The report's "up to 63.0" is accurate for the cited file but understates the session peak (64.1).

### 5d. "every post-arm snapshot failed the #38 gate" — **REFUTED**

`therm_post_tbo_base_mm_sa801919.txt` (the very first post snapshot):
```
Thermal Status: 0
max_hal_temp=45.0 status=0
```

Status=0 is PASS. The first post snapshot did NOT fail. The claim "every post-arm snapshot failed" is false for this file. Later post snapshots (from tbo_picks_mm onward) do show status=3, but the universal "every" is wrong.

### 5e. "every subsequent PRE gate passed after exactly one 60 s cooldown retry"

From the log: the first two PRE gates (tbo_base_mm, tbo_picks_mm) passed WITHOUT any retry (GATE_PASS on first attempt). The subsequent 8 PRE gates each failed once then passed on retry. The report's "every subsequent" is ambiguous but the "7 retries" count is wrong (it's 8), and the first two PRE gates needed zero retries.

---

## 6. Omissions / Contradictions

### 6a. kit_verify doesn't show actual sha256 heads

REPORT line 23: "base-kit-53.tgz `385c80a5…`" — the `kit_verify_sa801919.txt` file only shows `PICKS_SHA_OK` / `BASE_SHA_OK`, not the actual sha256 values. The specific heads (385c80a5, 5f8c6552) are asserted but not directly verifiable from the pulled raw. This is a provenance gap, not a contradiction — the kits were verified on-device, but we can't re-verify the heads from the artifacts we have.

### 6b. Thermal snapshot asymmetry

The REPORT focuses on the 63.0 °C reading from `therm_post_tbo_picks_mm` but doesn't mention:
- `therm_post_tbo_base_mm`: status=0 (passed, not failed) — contradicts "every post-arm snapshot failed"
- `therm_post_bench_base_2`: max_hal_temp=64.1 — higher than the cited 63.0

### 6c. No \r line endings detected

Checked bench_*.out, recon, kit_verify with `od -c`. Zero `\r` bytes found. No line-ending issues.

### 6d. nproc=6 in ALL .out files

Every .out trailing line shows `nproc=6`. REPORT explains this as "toybox oddity" and notes live probes show 8 cores online. The explanation is plausible (the driver's `NPROC` variable is set from `nproc` output, and all .out files record it). However, the REPORT doesn't note that `nproc=6` means the correctness arms ran with only 6 threads, not 4 as the bench command specifies (`-t 4`). The tbo arms don't use `-t` — they use the tool's default thread count, which may differ from the bench's `-t 4`. This is not a problem per se, but it's an unreported asymmetry in threading between the A (correctness) and B (perf) blocks.

---

## Summary of Findings

| # | Finding | Verdict | Severity |
|---|---|---|---|
| 1 | All correctness counts (925, 407, 229 ×2) match raw | **CONFIRMED** | — |
| 2 | All four bench rows match raw verbatim | **CONFIRMED** | — |
| 3 | Bench row attribution (base/picks) correct, no swap | **CONFIRMED** | — |
| 4 | Device/SoC/core-freq/RAM match recon | **CONFIRMED** | — |
| 5 | SHA heads (kit verify, model, build) | **PLAUSIBLE** | Low — on-device verified but heads not in pulled output |
| 6 | Means and Δ percentages arithmetically correct | **CONFIRMED** | — |
| 7 | 24 min billed = 06:43:58→07:07:58 | **CONFIRMED** | — |
| 8 | Kit tags match filenames (10/10) | **CONFIRMED** | — |
| 9 | Builds differed (different build shas + sha-verified) | **CONFIRMED** | — |
| 10 | G1 hygiene branch applied correctly | **CONFIRMED** | — |
| 11 | Amendment 1 non-trigger (ABBA unfragmented) | **CONFIRMED** | — |
| 12 | "7 retries total" — actual is 8 | **REFUTED** | Low — off by one, no aborts, no impact on results |
| 13 | "0 aborts" | **CONFIRMED** | — |
| 14 | 63.0 °C / status 3 in cited therm_post file | **CONFIRMED** | — |
| 15 | "every post-arm snapshot failed" — therm_post_tbo_base_mm has status=0 | **REFUTED** | Low — one snapshot passed, not all failed |
| 16 | First two PRE gates needed zero retries (report implies all needed one) | **REFUTED** | Low — doesn't affect A/B fairness |
| 17 | Threading asymmetry (tbo default threads vs bench -t 4) unreported | **OMISSION** | Low — correctness doesn't depend on thread count |

---

## FIX LIST

| # | Item | Action |
|---|---|---|
| F1 | "7 retries total" → should be 8 | Change to "8 retries total, 0 aborts" |
| F2 | "every post-arm snapshot failed the #38 gate" | Qualify: "all post-arm snapshots from tbo_picks_mm onward failed" or "all but the first" |
| F3 | "every subsequent PRE gate passed after exactly one 60 s cooldown retry" | Clarify: "the first two PRE gates passed cold; the subsequent 8 each needed one retry" |
| F4 | Kit sha256 heads cited without raw evidence | Add note that heads are from pre-session BUILD_NOTE, not from pulled kit_verify output |

## Overall Verdict

**APPLY** with corrections F1–F4. The core scientific claims (correctness all-PASS, perf within ±3%, no swap, correct attribution) are solid. The thermal narrative has three factual errors (retry count, universality of post-gate failures, universality of pre-gate retries) but none affect the A/B outcome or the G1 hygiene verdict. Fix the prose, keep the data.
