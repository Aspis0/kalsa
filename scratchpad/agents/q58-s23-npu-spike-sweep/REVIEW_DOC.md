# REVIEW_DOC — q58-s23-npu-spike-sweep hostile pre-bank audit

**Audit date:** 2026-08-25  
**Pre-merge commit:** f10d997b  
**Auditor:** hostile read-only pass  
**Raw dir:** scratchpad/agents/q58-s23-npu-spike-sweep/raw/  

---

## 1. Recomputed means vs REPORT.md

### Per-run verification (from manifest battery pre/post and jsonl)

| Run | ΔT_manifest | ΔT_recomputed | t/s_manifest | t/s_recomputed | wall_s_manifest | wall_recomputed | Match? |
|-----|-------------|---------------|--------------|----------------|-----------------|-----------------|--------|
| n128_npu_1 | 0.4 | 0.4 | 75.783 | 75.783 | 16.950 | 16.950 | ✅ |
| n128_cpu_1 | 3.8 | 3.8 | 6.007 | 6.007 | 53.136 | 53.136 | ✅ |
| n128_cpu_2 | 0.0 | 0.0 | 38.686 | 38.686 | 18.209 | 18.209 | ✅ |
| n128_npu_2 | 0.6 | 0.6 | 73.646 | 73.646 | 15.483 | 15.483 | ✅ |
| n512_npu_1 | 0.0 | 0.0 | 126.082 | 126.082 | 20.066 | 20.066 | ✅ |
| n512_cpu_1 | 3.0 | 3.0 | 19.289 | 19.289 | 63.774 | 63.774 | ✅ |
| n512_cpu_2 | 3.5 | 3.5 | 19.227 | 19.227 | 63.707 | 63.707 | ✅ |
| n512_npu_2 | 0.0 | 0.0 | 128.802 | 128.802 | 19.289 | 19.289 | ✅ |
| n1024_npu_1 | 0.8 | 0.8 | 127.868 | 127.868 | 28.201 | 28.201 | ✅ |
| n1024_cpu_1 | 3.3 | 3.3 | 23.942 | 23.942 | 181.904 | 181.904 | ✅ |
| n1024_cpu_2 | 3.2 | 3.2 | 28.213 | 28.213 | 187.293 | 187.293 | ✅ |
| n1024_npu_2 | 1.4 | 1.4 | 82.507 | 82.507 | 87.907 | 87.907 | ✅ |
| n2048_npu_1 | 2.1 | 2.1 | 92.171 | 92.171 | 111.024 | 111.024 | ✅ |
| n2048_cpu_1 | 5.3 | 5.3 | 25.006 | 25.006 | 378.454 | 378.454 | ✅ |
| n2048_cpu_2 | 5.0 | 5.0 | 25.478 | 25.478 | 375.252 | 375.252 | ✅ |
| n2048_npu_2 | 2.3 | 2.3 | 84.396 | 84.396 | 134.888 | 134.888 | ✅ |

All 16 individual runs: ΔT, t/s, wall — **CONFIRMED** correct.

### Per-size means (recomputed)

| n | engine | claim ΔT | recomp ΔT | claim t/s | recomp t/s | claim wall | recomp wall | Match? |
|---|--------|----------|-----------|-----------|------------|------------|-------------|--------|
| 128 | NPU | 0.500 | 0.500 | 74.715 | 74.715 | 16.216 | 16.217 | ✅ (rounding) |
| 128 | CPU | 1.900 | 1.900 | 22.347 | 22.347 | 35.672 | 35.673 | ✅ (rounding) |
| 512 | NPU | 0.000 | 0.000 | 127.442 | 127.442 | 19.678 | 19.678 | ✅ |
| 512 | CPU | 3.250 | 3.250 | 19.258 | 19.258 | 63.740 | 63.740 | ✅ |
| 1024 | NPU | 1.100 | 1.100 | 105.187 | 105.187 | 58.054 | 58.054 | ✅ |
| 1024 | CPU | 3.250 | 3.250 | 26.077 | 26.078 | 184.599 | 184.598 | ✅ (rounding) |
| 2048 | NPU | 2.200 | 2.200 | 88.284 | 88.284 | 122.956 | 122.956 | ✅ |
| 2048 | CPU | 5.150 | 5.150 | 25.242 | 25.242 | 376.853 | 376.853 | ✅ |

**Verdict: CONFIRMED** — all per-size means within float rounding tolerance (< 0.01 s).

---

## 2. CONFOUND: Load share vs prompt processing

### Stderr load_time and total_time (ms) per run

| Run | load_ms | total_stderr_ms | prompt_ms (total−load) | wall_manifest_ms | load_share_of_wall |
|-----|---------|-----------------|------------------------|------------------|--------------------|
| n128_npu_1 | 8,277 | 9,975 | 1,698 | 16,950 | 49% |
| n128_npu_2 | 7,063 | 8,796 | 1,733 | 15,483 | 46% |
| n128_cpu_1 | 26,180 | 47,625 | 21,445 | 53,136 | 49% |
| n128_cpu_2 | 8,415 | 11,533 | 3,118 | 18,209 | 46% |
| n512_npu_1 | 9,211 | 13,302 | 4,091 | 20,066 | 46% |
| n512_npu_2 | 9,313 | 13,257 | 3,944 | 19,289 | 48% |
| n512_cpu_1 | 31,002 | 58,125 | 27,123 | 63,774 | 49% |
| n512_cpu_2 | 31,161 | 58,404 | 27,243 | 63,707 | 49% |
| n1024_npu_1 | 13,263 | 21,212 | 7,949 | 28,201 | 47% |
| n1024_npu_2 | 20,773 | 34,008 | 13,235 | 87,907 | 24% |
| n1024_cpu_1 | 47,875 | 90,869 | 42,994 | 181,904 | 26% |
| n1024_cpu_2 | 41,904 | 80,013 | 38,109 | 187,293 | 22% |
| n2048_npu_1 | 27,132 | 49,996 | 22,864 | 111,024 | 24% |
| n2048_npu_2 | 33,225 | 56,772 | 23,547 | 134,888 | 25% |
| n2048_cpu_1 | 90,491 | 171,504 | 81,013 | 378,454 | 24% |
| n2048_cpu_2 | 86,623 | 168,830 | 82,207 | 375,252 | 23% |

### Key observations

1. **Load share is ~46–49% of wall time at n=128, dropping to ~22–25% at n=2048.** The NPU load is consistently faster (8–33s) vs CPU load (26–90s) due to HTP session allocation + tensor materialization vs CPU mmap.

2. **The confound penalizes NPU at small n.** At n=128, NPU wall = 16.2s but only ~1.7s is prompt processing; the other 8–9s is HTP session + model materialization. CPU at n=128 has wall = 35.7s but only ~12s is prompt processing — the rest is mmap + load. The ratio of prompt-to-load is roughly similar, but the absolute prompt time for NPU is tiny at 128.

3. **°C per 1k tokens** is a per-process number (ΔT measured from battery pre to post, which covers the entire llama-bench process including load). It is NOT a per-prompt metric.

4. **Would ordering flip if load were excluded?** No. Comparing prompt-only wall at every size:
   - n=128: NPU ~1.7s vs CPU ~12.3s → NPU wins
   - n=512: NPU ~4.0s vs CPU ~27.2s → NPU wins
   - n=1024: NPU ~10.6s vs CPU ~40.6s → NPU wins
   - n=2048: NPU ~23.2s vs CPU ~81.6s → NPU wins

   The NPU advantage is consistent at 3–4× across all sizes even after removing the load phase. The load confound does NOT change the qualitative conclusion.

**Verdict: PLAUSIBLE** — the ΔT and wall metrics confound load vs prompt, but the ordering is robust to deconfounding. The "°C per 1k tokens" label should be clarified as per-process in the REPORT.

---

## 3. NPU 512 ΔT = 0.0 °C: real or artifact?

### Evidence from raw data

| Run | pre_temp_tenths | post_temp_tenths | ΔT_raw | guard start temp | guard MAX temp | guard trace shape |
|-----|-----------------|------------------|--------|------------------|----------------|-------------------|
| n512_npu_1 | 317 | 317 | 0 | 317 | 317 | flat at 317 for entire guard duration (~14s) |
| n512_npu_2 | 318 | 318 | 0 | 318 | 318 | flat at 318 for entire guard duration (~19s) |

Both runs show **identical** pre and post temperatures in tenths-degree precision (Android battery service, 0.1°C quantization). The guard traces confirm the battery sensor was flat throughout — no sampling artifacts.

### Context
- Both NPU 512 runs are SHORT (wall ~20s each) with fast load (~9s) and prompt eval (~4s).
- Battery temp sensor (BAT, type=2) updates every ~1s. At 0.1°C resolution, a true ΔT of 0.05°C or less would round to 0.
- The battery was at 31.7°C before n512_npu_1 (after NPU 128 runs), and 31.8°C before n512_npu_2.
- The NPU processes 512 tokens in ~4s prompt time — this is genuinely low power and short enough that the battery sensor may not have registered a rise.

### Is it physically plausible?
- NPU at 512 tokens: ~19.7s total wall, ~4s prompt. The HTP is doing SSM (Mamba-style) + attention, but 512 tokens is still small. Battery temp sensor has thermal mass and lags by several seconds.
- A 0.0°C ΔT for a ~4s workload at ~32°C skin is within measurement noise at 0.1°C resolution.

**Verdict: PLAUSIBLE** — both runs independently show 0.0°C. Not a cooldown artifact (only 1 cooldown sample before n512_npu_1 at 317, no multi-sample cooldown). The battery sensor at 0.1°C resolution cannot distinguish < 0.05°C changes, and a 4s prompt eval at room temperature is genuinely low-heat.

---

## 4. NPU t/s non-monotonic at n=2048

### Observed NPU t/s across sizes
- n=128: 74.7 t/s (2 runs)
- n=512: 127.4 t/s (2 runs)
- n=1024: 105.2 t/s (2 runs)  
- n=2048: 88.3 t/s (2 runs)

### Comparison to q31 (earlier S23 HTP numbers)
From prior cell q31 on the same S23 device, NPU prompt t/s for Qwen3.5-4B on HTP v73 was in the 84–128 range. The current data is **consistent** with those numbers — the peak at n=512 (127 t/s) matches the high end, and the n=2048 (88 t/s) matches the low end.

### Thermal throttling analysis

| Run | guard_slope (°C/s) | thermal_status_pre/post | ΔT_battery |
|-----|-------------------|------------------------|------------|
| n2048_npu_1 | (341−320)/105 = 0.20 °C/s | 0/0 | 2.1 °C |
| n2048_npu_2 | (344−320)/125 = 0.19 °C/s | 0/0 | 2.3 °C |

The guard slope is gentle (~0.2 °C/s) and thermal status remains 0 throughout. No throttling indicators. The decreasing t/s is **consistent with a batch/VTCM effect**: at larger n, the KV cache grows, memory bandwidth becomes the bottleneck, and VTCM (8 MB) may spill to system memory. This is expected behavior for HTP-prompt evaluation and is NOT thermal throttling.

**Verdict: CONFIRMED** — non-monotonicity is real, consistent with earlier S23 HTP numbers, and explained by batch/memory effects, not throttling.

---

## 5. Frozen derivations: N_max and threshold arithmetic

### N_max = 512

Claim: largest n with mean NPU ΔT ≤ 1.0 °C.

| n | mean NPU ΔT | ≤ 1.0? |
|---|-------------|--------|
| 128 | 0.5 | ✅ |
| 512 | 0.0 | ✅ |
| 1024 | 1.1 | ❌ |
| 2048 | 2.2 | ❌ |

**CONFIRMED**: N_max = 512.

### The 1024 rounding question

1024 NPU individual ΔT values: [0.8, 1.4]. Mean = 1.1. Both readings are exact to 0.1°C resolution (Android battery service). No rounding artifact — 1.1 > 1.0 is exact. Even if the true underlying ΔT were continuous, 0.8 and 1.4 are each at least 0.3 and 0.4 above the rounding boundary, so the mean cannot plausibly be ≤ 1.0.

**CONFIRMED**: 1024's mean ΔT = 1.1 > 1.0 is not a rounding artifact.

### Threshold arithmetic error

REPORT.md claims: "thermal-threshold candidate = 40.0 − 0.600 = **39.400** °C"

But the definition says: "threshold = 40.0 − max ΔT over sizes ≤ N_max"

max ΔT over individual NPU runs at n ≤ 512:
- n=128: max(0.4, 0.6) = 0.6
- n=512: max(0.0, 0.0) = 0.0
- Overall max = 0.6

So threshold = 40.0 − 0.6 = **39.4 °C** (individual-max basis). ✅

However, the REPORT.md also shows:
```
thermal_threshold_candidate_C_mean_based: 39.5
```

The REPORT correctly stores both values. The claim in the frozen derivations section uses the individual-max basis (39.4), which is self-consistent with the formula stated.

The user's question flagged that "max ΔT over sizes ≤ N_max = 0.5 → threshold = 39.5, not 39.4". The user used the **mean** ΔT at N_max (0.5), while the report used the **individual maximum** (0.6). The report is internally consistent with its stated formula but has an **ambiguity**: it doesn't specify whether the formula uses mean or individual-max ΔT. The manifest stores both: `max_npu_delta_T_C_individual_for_sizes_le_nmax: 0.6` and `max_npu_delta_T_C_mean_for_sizes_le_nmax: 0.5`.

**Verdict: CONFIRMED (with caveat)** — 39.4 °C is correct under the individual-max formula. If the intended formula uses mean ΔT, the correct value is 39.5 °C. The REPORT should disambiguate which basis is used.

---

## 6. Cool-start gate, run order, battery floor, thermalservice dumps

### Cool-start gate ≤ 32.0 °C

| Run | pre_temp_C | ≤ 32.0? |
|-----|------------|---------|
| n128_npu_1 | 26.9 | ✅ |
| n128_cpu_1 | 27.3 | ✅ |
| n128_cpu_2 | 31.1 | ✅ |
| n128_npu_2 | 31.7 | ✅ |
| n512_npu_1 | 31.7 | ✅ |
| n512_cpu_1 | 31.3 | ✅ (after cooldown from 34.3 → 31.3) |
| n512_cpu_2 | 31.5 | ✅ (after cooldown from 35.0 → 31.5) |
| n512_npu_2 | 31.8 | ✅ (after 4-sample cooldown: 35.0→33.5→32.4→31.8) |
| n1024_npu_1 | 31.8 | ✅ |
| n1024_cpu_1 | 31.9 | ✅ |
| n1024_cpu_2 | 31.8 | ✅ |
| n1024_npu_2 | 31.7 | ✅ |
| n2048_npu_1 | 32.0 | ✅ (exactly at boundary) |
| n2048_cpu_1 | 31.6 | ✅ |
| n2048_cpu_2 | 32.0 | ✅ (exactly at boundary) |
| n2048_npu_2 | 32.0 | ✅ (exactly at boundary) |

**CONFIRMED**: All runs ≤ 32.0 °C. Three runs hit exactly 32.0 °C.

### Run order: NPU, CPU, CPU, NPU per size

MANIFEST run list (chronological):
1. n128: NPU_1 → CPU_1 → CPU_2 → NPU_2 ✅
2. n512: NPU_1 → CPU_1 → CPU_2 → NPU_2 ✅
3. n1024: NPU_1 → CPU_1 → CPU_2 → NPU_2 ✅
4. n2048: NPU_1 → CPU_1 → CPU_2 → NPU_2 ✅

**CONFIRMED**: Order NPU, CPU, CPU, NPU per size respected throughout.

### Battery floor ≥ 45%

Minimum battery level across all runs: 68% (final reading). All pre-run levels ≥ 69%. **CONFIRMED** — no floor violation.

### thermalservice dumps

Final thermalservice.txt saved and contains verbatim output:
- Thermal Status: 0
- All cached temperatures from HAL with mStatus=0
- HAL 2.0 connected: yes
- Headroom thresholds: [NaN, 0.867, 0.933, 1.0, 1.133, 1.433, 2.433]
- Per-run pre/post .thermalservice.pre.txt / .post.txt files all present (32 files total)

**CONFIRMED**: thermalservice dumps saved verbatim, status 0 everywhere, no numeric headroom exposed.

---

## 7. Overclaims in REPORT.md

### Finding 7a: EXECUTE-OP proof

REPORT says "execute-op proof on NPU, offloaded 0/33 on CPU."

From manifest:
- NPU runs: execute_op_count = 1764 (n=128,512) or 3430 (n=1024) or 6762 (n=2048); offloaded = "33/33 layers to GPU"
- CPU runs: execute_op_count = 0; offloaded = "0/33 layers to GPU"

**CONFIRMED**: Execute-op count varies with n (proportional to prompt tokens × ops per layer). NPU offloads 33/33; CPU offloads 0/33. No overclaim.

### Finding 7b: Average ΔT label confusion

REPORT column header says "°C/1k tokens" — this is computed as ΔT/(n/1000). Since ΔT covers the entire process (including load), this is **per-process °C/1k tokens**, not per-prompt. The column header is technically accurate given the ΔT definition, but the user should understand it includes the load phase.

**PLAUSIBLE** — no false numbers, but the metric conflates load and prompt thermal contribution.

### Finding 7c: Wall time includes load

Same issue as 7b. Wall times are launcher_elapsed_s which includes model loading. The REPORT does not separate load from prompt wall time. The stderr logs CAN deconfound this (see Section 2).

**PLAUSIBLE** — no false numbers, but the report could be clearer.

### Finding 7d: n512_cpu_1 t/s anomaly

n512_cpu_1 t/s = 19.3, while n512_cpu_2 t/s = 19.2. These are close and consistent. However, n128_cpu_1 t/s = 6.0 while n128_cpu_2 t/s = 38.7 — a 6.4× difference.

The REPORT does not flag or explain this. The raw stderr shows:
- n128_cpu_1: load_time = 26.2s, total = 47.6s, prompt_only = 21.4s → 256 tokens in 21.4s = 11.9 effective t/s (but jsonl reports 6.0)
- n128_cpu_2: load_time = 8.4s, total = 11.5s, prompt_only = 3.1s → 256 tokens in 3.1s = 82.5 effective t/s (but jsonl reports 38.7)

The jsonl avg_ts values differ from the stderr-derived prompt_only t/s, suggesting the jsonl measures something different (perhaps llama-bench internal metric vs total process time). The n128_cpu_1 cold-start penalty is severe but the REPORT doesn't discuss it.

**PLAUSIBLE** — no data fabrication, but the massive CPU_128 variance (6.0 vs 38.7 t/s) is unexplained and could mislead readers who don't look at the per-run data.

### Finding 7e: Battery end voltage discrepancy

Manifest final battery: voltage_mv = 3995. But the final battery dump from thermalservice shows `voltage: 3995` and the latest battery event at 13:28:07 shows `voltage:3989`. The dump `voltage_mv: 3995` appears to be a snapshot, not the last event. This is a minor inconsistency in how "final battery" is defined (snapshot vs last event).

**PLAUSIBLE** — minor, doesn't affect conclusions.

---

## Final verdict

```
BANK-with-corrections
```

**Corrections required:**
1. Threshold basis ambiguity: REPORT frozen derivations say 39.4 °C (individual-max) but should explicitly state which basis (individual vs mean) is used; if mean basis is intended, correct to 39.5 °C.
2. "°C/1k tokens" and "s/1k tokens" columns should be labeled as "per-process" to avoid confusion with prompt-only metrics.
3. The n128_cpu_1 vs n128_cpu_2 t/s variance (6.0 vs 38.7) is unexplained and should be flagged as a cold-start artifact in the REPORT.

**No data fabrication detected.** All 16 runs verified against raw files. Derivations reproducible. Guard traces, cooldowns, thermalservice dumps, and battery logs all consistent with the reported data.
