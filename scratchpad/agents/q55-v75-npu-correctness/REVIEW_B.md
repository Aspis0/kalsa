# REVIEW_B.md — Hostile pre-bank audit: Part B + Qwen Part A

Auditor: q55-v75-npu-correctness host agent
Scope: Part B OLMoE pp512 (all 4 arms) + Qwen Part A characterization
Date: 2026-08-26
Cell: scratchpad/agents/q55-v75-npu-correctness/
Read-only except this file.

---

## F1 — Part B numbers recomputed from raw

### Per-rep and mean from JSONL

| Arm | rep0 t/s | rep1 t/s | avg_ts (JSONL) | wall_s (manifest) | ΔT guard (°C) | MAX guard (°C) |
|---|---:|---:|---:|---:|---:|---:|
| NPU1 | 581.412 | 1108.530 | 844.972 | 0.671 | 0.0 | 31.9 |
| CPU1 | 52.618 | 88.465 | 70.541 | 7.759 | 0.4 | 31.1 |
| CPU2 | 53.106 | 85.841 | 69.473 | 7.803 | 0.0 | 31.1 |
| NPU2 | 804.845 | 830.953 | 817.899 | 0.626 | 1.0 | 32.1 |

### Which t/s field does REPORT.md use?

REPORT.md table `t/s` column values: 581.412000, 52.618300, 53.105600, 804.845000.
These are **rep0 (first-sample) values**, extracted from JSONL `samples_ts[0]`.
The manifest `wall_s` values (0.671243, 7.759044, 7.802833, 0.626154) match exactly.

### Cross-arm consistency

Both NPU and CPU arms use the same field (rep0 / first-sample). The reporting is **internally consistent** but systematically reports the slower of the two reps for CPU (52.6/53.1 vs avg 70.5/69.5) and the slower rep for NPU (581.4 vs avg 845.0 for NPU1; 804.8 vs avg 817.9 for NPU2).

### Battery pre/post

| Arm | pre_temp (°C) | post_temp (°C) | ΔT_battery | pre_batt% | post_batt% |
|---|---:|---:|---:|---:|---:|
| NPU1 | 31.9 | 31.9 | 0.0 | 59 | 59 |
| CPU1 | 30.7 | 31.1 | 0.4 | 59 | 59 |
| CPU2 | 31.1 | 31.1 | 0.0 | 59 | 59 |
| NPU2 | 31.1 | 32.1 | 1.0 | 59 | 58 |

Battery ΔT matches guard ΔT for all 4 arms (NPU1: 0.0, CPU1: 0.4, CPU2: 0.0, NPU2: 1.0).

**Verdict F1: CONFIRMED** — all Part B numbers recompute from raw. The report uses first-sample t/s, which is consistent across arms but is NOT the JSONL average.

---

## F2 — CPU t/s discrepancy vs q48

### Command-line differences

| Flag | q55 CPU | q48 CPU |
|---|---|---|
| `-n` (n_gen) | 0 | 128 |
| `-t` (threads) | 8 (explicit) | omitted (default) |
| `--load-mode` | none | none |
| `--ubatch-size` | not specified | 1024 |
| `-oe` | absent | present |
| Hexagon env | retained (ADSP/CDSP/NDEV/VERBOSE) | explicitly unset |
| Launcher | nohup setsid supervisor wrapper | direct invocation |

### Observed numbers

- q55 first-sample: 52.6 / 53.1 t/s
- q55 avg_ts: 70.5 / 69.5 t/s
- q48: 142.9 / 141.5 t/s

### Diagnosis

The 2.7× gap (52.6 vs 142.9) is too large to attribute to any single flag difference without isolated testing. Contributing factors:

1. **`-t 8` on a 1+5+2 core layout**: SM8650 has 1 prime + 5 performance + 2 efficiency cores. `-t 8` pins all 8 threads; q48's default thread count may use fewer or different scheduling. No `taskset` evidence in either case.
2. **`-n 0` (pp only, no gen)**: q55 runs prompt-only; q48 runs pp512 + gen128. The gen phase may warm up caches differently, but `--no-warmup` is set in both.
3. **Retained Hexagon env vars**: q55 launcher kept `ADSP_LIBRARY_PATH`, `CDSP_LIBRARY_PATH`, `GGML_HEXAGON_NDEV=1`, `GGML_HEXAGON_VERBOSE=1` even for CPU-only runs. q48 `setup_env_cpu` explicitly unset these. Residual Hexagon initialization may add overhead or interfere with CPU scheduling.
4. **Warm-up (first rep slower)**: With `--no-warmup`, the first rep could be slower due to page faults / cache cold. But q55 rep1 (88.5/85.8) is still far below q48 (142), so warm-up alone cannot explain the gap.

**Fair comparison would require**: identical `-n`, `-t`, environment (unset Hexagon vars for CPU), same launcher (or both direct), same `--ubatch-size`. No rerun performed; this is record-only.

**Verdict F2: PLAUSIBLE** — multiple confounders identified (n_gen, threads, env, launcher). No single factor isolated. The first-sample value (52.6) is the worst case; the average (70.5) closes the gap to ~2× but not to parity. Neither number equals q48's 142.

---

## F3 — Qwen Part A running-PPL verification

### Raw running_ppl.log values

**HTP arm** (`partA_qwen_htp.running_ppl.log`):
```
[8]  7.4331
[10] 7.8331
[12] 8.2314
```

**CPU-ref** (`partA_qwen_cpu_12char.running_ppl.log`):
```
[8]  7.4230
[10] 7.8246
```

### Arithmetic check

- r10 = 7.8331 / 7.8246 − 1 = +0.001087… → +0.109% ✓
- r8 = 7.4331 / 7.4230 − 1 = +0.001361… → +0.136% ✓

Report's values match exactly.

### Flag identity

| Flag | HTP arm (workload.args.txt) | CPU-ref (workload.args.txt) |
|---|---|---|
| `-t` | 8 | 8 |
| `-ngl` | 99 | 0 |
| `--chunks` | 32 | 12 |
| `-nkvo` | present | present |
| `-dev` | HTP0 | absent |
| `-fa` | on | on |
| `--load-mode` | none | none |
| `-c` | 2048 | 2048 |
| `-b` | 2048 | 2048 |
| `-ub` | 1024 | 1024 |
| `--ppl-stride` | 0 | 0 |
| `-f` | wiki.test.raw | wiki.test.raw |

Both arms use `-nkvo`. Core flags (−c, −b, −ub, −f, −ppl-stride, −nkvo, −fa, −load-mode, −t) are identical. Only −ngl, −chunks, and −dev differ by design (NPU vs CPU). Chunk alignment is confirmed: same corpus, same offset formula, chunk [n] is identical text in both arms.

### "10-chunk characterization" label honesty

The CPU-ref was launched with `--chunks 12` but killed at chunk 10 by battery floor. The HTP arm completed all 12 chunks (10-min cap). The common chunk is 10. Labeling this a "10-chunk characterization" (not 32-chunk certification) is accurate and honest — it correctly limits the scope to what both arms produced.

### Is +0.11% within per-chunk noise?

Chunk-level PPL in Qwen HTP spans 7.43 (chunk 8) to 9.92 (chunk 4) — a range of ~33%. OLMoE's certified r = −0.02% (32 chunks) and S23 chunk-1 +0.01% are both sub-0.1% on full runs. The +0.11% at 10 chunks is consistent with per-chunk PPL noise at this sample size (each chunk processes ~2048 tokens; PPL variance across chunks is expected to be larger than the HTP-vs-CPU delta).

**Verdict F3: CONFIRMED** — r10/r8 arithmetic correct, flags identical incl. -nkvo, chunk alignment verified, label is honest, +0.11% is within expected per-chunk noise.

---

## F4 — Guard/battery audit

### Cool-start ≤ 32.0°C

| Arm | pre_temp (°C) | ≤ 32.0? |
|---|---:|---|
| NPU1 | 31.9 | ✓ |
| CPU1 | 30.7 | ✓ |
| CPU2 | 31.1 | ✓ |
| NPU2 | 31.1 | ✓ |
| Qwen HTP | 31.8 | ✓ |
| Qwen CPU | 31.8 | ✓ |

All arms cool-start ≤ 32.0°C. **CONFIRMED.**

### Battery-floor kill

Guard log `partA_qwen_cpu_12char.guard.log` — final lines:
```
1787741990,395,44,BATTERY_LOW_ABORT
1787741990,395,44,KILLED
```

- Battery level at kill: 44% (below floor of 45%)
- Temperature at kill: 39.5°C (below CPU KILL threshold of 43.0°C)
- Guard kill_tenths = 430 (43°C); max was 395 (39.5°C) — thermal kill NOT triggered
- Floor threshold: 45%, declared in manifest (`battery_floor_pct: 45`)
- `battery_floor_triggered: true`, `battery_floor_chunk: 10` — matches

**CONFIRMED** — floor applied correctly, declared in manifest, kill was battery not thermal.

### Max temperature per arm + WARN lines

| Arm | MAX (guard) | MAX (battery_post) | WARN? |
|---|---:|---:|---|
| NPU1 | 31.9 | 31.9 | No WARN in guard.log |
| CPU1 | 31.1 | 31.1 | No WARN |
| CPU2 | 31.1 | 31.1 | No WARN |
| NPU2 | 32.1 | 32.1 | No WARN |
| Qwen HTP | 38.0 | 38.0 | No WARN |
| Qwen CPU | 39.5 | 39.5 | No WARN |

No WARN lines in any guard log. All temperatures well below kill thresholds (NPU 41°C, CPU 43°C).

**Verdict F4: CONFIRMED** — all guard/battery claims correct.

---

## F5 — Thermalservice headroom

Thermalservice dumps (`partB_olmoe_npu_1.thermalservice.pre.txt` and `.post.txt`) are **identical** — both contain cached HAL temperatures and static threshold configuration.

Key findings from the dump:
- `Thermal Status: 0` (no throttling active)
- `Temperature headroom thresholds: [NaN, NaN, NaN, 1.0, NaN, NaN, 1.95]`
- NSP (NPU) sensor thresholds: `[NaN, NaN, NaN, 100.0, NaN, NaN, 115.0]`
- No dynamic numeric headroom value exposed — only static thresholds

The report correctly states `thermalservice_headroom_available=false; no dynamic numeric headroom exposed; raw thresholds include [NaN, NaN, NaN, 1.0, NaN, NaN, 1.95]`.

**Verdict F5: CONFIRMED** — thermalservice dumps present in raw/, no numeric headroom available, report accurately describes the situation.

---

## F6 — Overclaims audit

### Part B

1. **NPU/CPU ratio**: REPORT.md does NOT compute or state an NPU/CPU speedup ratio. The table presents raw t/s for each arm. **No overclaim.**
2. **"first-sample" vs "avg" ambiguity**: The table labels the column "t/s" without specifying which JSONL field. A reader could assume these are steady-state numbers. The actual avg_ts values (70.5/69.5 for CPU, 845.0/817.9 for NPU) would change the perceived gap. **Minor under-disclosure, not an overclaim.** The RUN_LOG and manifest.cpu_throughput_diagnosis section does explain the discrepancy.
3. **"status=STOPPED"**: The Part B table says `status=STOPPED` but all 4 individual arms show rc=0. The STOPPED status refers to the overall session end state (device at 44%/34.9°C after Qwen CPU kill), not to Part B failure. **Potentially confusing but not an overclaim.**
4. **False stop correction**: The report correctly notes that NPU1's stderr CDSP session-open text was initially misclassified. The corrected run classification is documented. **No overclaim.**

### Qwen Part A

5. **"10-chunk characterization" label**: Correctly scoped as NOT a 32-chunk certification. Gate UNAVAILABLE for r12 (CPU didn't reach chunk 12). **No overclaim.**
6. **"r10 = +0.109%, PASS"**: PASS is correct under the ≤2% threshold. But this is a characterization, not certification. The report correctly notes this. **No overclaim.**
7. **Qwen Part B not run**: Correctly documented. **No overclaim.**

### What a reader could mistake for a ship number

The Part B t/s values (especially the NPU numbers at 581–805) are exploratory pp512 numbers with -n 0. The report's DISCLAIMER at the top states "Part B t/s is exploratory and charge-counter energy is recorded only." This is adequate.

**Verdict F6: CONFIRMED (no overclaims)** — The report is appropriately hedged. The only minor issue is the unlabeled "t/s" column using first-sample rather than avg_ts, but this is documented in the diagnosis section.

---

## Summary table

| Finding | Verdict | Notes |
|---|---|---|
| F1: Part B numbers recompute | **CONFIRMED** | All raw values match. Report uses first-sample t/s, not avg_ts. |
| F2: CPU t/s discrepancy diagnosis | **PLAUSIBLE** | Multiple confounders (n_gen, threads, env, launcher). No isolated factor. |
| F3: Qwen r10/r8 arithmetic + flags | **CONFIRMED** | Math exact, -nkvo present in both, chunk alignment verified. |
| F4: Guard/battery floor | **CONFIRMED** | Cool-start ≤32.0 all arms. Battery floor 45% applied correctly at 44%. |
| F5: Thermalservice headroom | **CONFIRMED** | Dumps present, no numeric headroom, static thresholds only. |
| F6: Overclaims | **CONFIRMED** | No overclaims. Minor: t/s column not labeled as first-sample. |

---

## BANK-CLEAN
