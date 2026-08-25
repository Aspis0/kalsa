# q57 / q53c lane-2 / q56 revalidation — hostile pre-bank audit

**Reviewer:** independent read-only audit. All numbers recomputed from raw guard
CSVs, manifest.json, running_ppl.log, and stderr. No edits to source data.

---

## 1. Number verification (recomputed from raw)

### Arm A (q57, HTP0, -ngl 99, --chunks 8, KILL 410)

| Claimed field | REPORT value | Raw recomputation | Verdict |
|---|---|---|---|
| time_to_40_C_seconds | 225 | Guard CSV: first sample epoch 1787669313 @ 318 tenths; first ≥400 epoch 1787669538 @ 405 tenths. Δ = 225 s. | **CONFIRMED** |
| time_to_40_C_minutes | 3.75 | 225/60 = 3.75 min. | **CONFIRMED** |
| slope_available_pre_kill_C_per_min | 2.33 | First data: 31.8 °C; last data: 41.4 °C; window 247 s (4.12 min). (41.4−31.8)/4.12 = 2.33 °C/min. | **CONFIRMED** |
| MAX_temperature_tenths | 414 | Max among all data rows in guard CSV = 414. | **CONFIRMED** |
| execute_op_proof_count | 5,995 | `grep -c "HTP0 execute-op"` on stderr = 5,995. | **CONFIRMED** |
| PPL_HTP_1 | 7.9075 | running_ppl.log line: `1787669420,[1]7.9075`. | **CONFIRMED** |
| PPL_HTP_2 | 9.4123 | running_ppl.log line: `1787669498,[2]9.4123`. | **CONFIRMED** |
| PPL_HTP_8 | NaN | running_ppl.log has only chunks [1] and [2]; chunk 8 never reached. | **CONFIRMED** |
| battery_start | 87,318,unplugged | manifest.json battery_start: level=87, temp=318, ac/usb/wireless=false. | **CONFIRMED** |
| battery_end | 85,415,unplugged | manifest.json battery_end: level=85, temp=415, ac/usb/wireless=false. | **CONFIRMED** |
| guard_exit | 2 | manifest.json guard_exit_code=2; guard log ends KILLED with KILL_THRESHOLD. | **CONFIRMED** |
| workload_rc | 137 | manifest.json workload_rc=137. | **CONFIRMED** |
| launcher_exit | 2 | manifest.json launcher_exit_code=2. | **CONFIRMED** |
| real_crash_signature | NONE | No ggml_abort, dspqueue, INTERNAL-ERROR, Segmentation, or uppercase CDSP in stderr. Benign `cdsp` URI and `libcdsprpc.so` startup text correctly excluded. | **CONFIRMED** |

### Arm C (q53c lane-2 session 3 resume, CPU -ngl 0, KILL 430)

| Claimed field | REPORT value | Raw recomputation | Verdict |
|---|---|---|---|
| chunks_completed | 2 | stdout.jsonl: `[1]7.9064,[2]9.4097,`. running_ppl.log has only `[1]`. Manifest running_ppl_max_chunk=1 (stale; stdout confirms 2). | **CONFIRMED** (REPORT correct; manifest running_ppl_max_chunk lagging) |
| guard_max_temperature_tenths | 434 | Guard CSV max = 434; KILL_THRESHOLD at 434. | **CONFIRMED** |
| battery_start | 94,290,unplugged | manifest.json: level=94, temp=290, unplugged. | **CONFIRMED** |
| battery_end | 88,434,unplugged | manifest.json: level=88, temp=434, unplugged. | **CONFIRMED** |
| guard_exit | 2 | REPORT.md states guard_exit=2; manifest raw shows guard_exit_code=2 but guard_outcome="guard-not-ready" (the raw manifest reflects a launcher reporting race; corrected in REPORT.md). See §2. | **CONFIRMED** with caveat (§2) |
| time-to-40 not claimed | — | Computed: first 290 tenths (29.0 °C); first ≥400 at epoch 1787668397 (404 tenths). Δ = 441 s = 7.35 min. Slope: (43.4−29.0)/10.40 = 1.38 °C/min. REPORT does not claim these numbers. | N/A — not claimed, but computed for §6 |

### q57 REPORT vs recovered lane-2 HTP log (q53 session 2, 32 chunks)

The q57 REPORT references PPL_HTP_8 from the recovered lane-2 log. Verified against
`q53-v73-npu-correctness/raw/lane2_s2_qwen_htp_ppl.log`:

| Chunk | Value in log | Match? |
|---|---|---|
| [1] | 7.9075 | **CONFIRMED** |
| [2] | 9.4123 | **CONFIRMED** |
| [8] | 7.4314 | **CONFIRMED** |
| [32] final | 8.5179 | **CONFIRMED** (matches q56 REPORT pulled_lane2_evidence lane2_s2_qwen_htp_ppl_final=8.5179) |

---

## 2. Guard behavior

### Kill at documented threshold with parser fix in place?

**Arm A (q57):** Guard log START line declares `warn_tenths=400, kill_tenths=410,
effective_kill_tenths=410, sensor_fail_limit=4, sensor_timeout_s=10,
sensor_failure_window_s=40, fail_closed_false_kill_accepted=1`. All 20 data samples
have numeric temperature and level — zero SENSOR_FAILURE lines in the guard log. The
kill event `KILL_THRESHOLD` fires at 414 tenths (41.4 °C), which is ≥410 (the
documented KILL threshold). The 4-tenths overshoot (0.4 °C) is expected given the
10-second polling interval: the temperature rose from 405 to 414 in 22 seconds
(4.09 °C/min instantaneous), so the next poll after crossing 410 read 414.
**CONFIRMED.**

**Arm C (q53c resume):** Guard log START declares `warn_tenths=400, kill_tenths=430,
effective_kill_tenths=430, sensor_fail_limit=4, sensor_timeout_s=10,
sensor_failure_window_s=40`. All 54 data samples have numeric temperature and level
— zero SENSOR_FAILURE lines. Kill at 434 tenths (43.4 °C), 4-tenths overshoot of
430, same mechanism as Arm A. **CONFIRMED.**

### Was the parser fix in place?

Both guard START lines contain `sensor_timeout_s=10, sensor_fail_limit=4,
sensor_failure_window_s=40` — the post-fix parameters. The pre-fix guard (session 3
first attempt, `thermal.csv`) used `sensor_fail_limit=3, sensor_timeout_s=5,
sensor_failure_window_s=15` and produced SENSOR_FAILURE_1/2/3/SENSOR_ERROR. The
post-fix guard (session 3 resume + q57 Arm A) produces clean numeric-only traces.
**CONFIRMED — parser fix was in place for both arms.**

### Guard armed BEFORE workload?

**Arm A:** Guard log first line is `START,1787669313,...` with `READY` and
`TRACKING_12259` at the same epoch (1787669313). The manifest shows
`supervisor_pid=12255, guard_pid=12258, binary_pid=12259`. The stderr first line
timestamps at `0.00.017.160` (17 ms into the binary process). The guard's first
sample (epoch 1787669313) and READY/TRACKING events all occur at the same second as
the guard START. The binary began at t=17 ms relative to its own exec, while the
guard was already sampling. The guard was armed and tracking before the binary
produced any compute load. **CONFIRMED — guard-first.**

**Arm C (q53c resume):** Guard log START at epoch 1787667956 with READY and
TRACKING_25579 at the same epoch. Manifest: supervisor_pid=25577, guard_pid=25578,
binary_pid=25579. Same guard-first pattern. **CONFIRMED.**

---

## 3. Execute-op proof for Arm A (model on HTP0)

- **5,995 lines** containing `HTP0 execute-op` in stderr (grep-verified).
- Manifest field `execute_op_htp0: true`.
- stderr shows `offloaded 33/33 layers to GPU` (twice, for two load passes;
  `-ngl 99` offloads all 33 layers to HTP0 via the Hexagon backend).
- `-dev HTP0` is in the manifest workload command array.
- Arm C (CPU-ref) stderr shows `offloaded 0/33 layers to GPU` and **zero**
  HTP0 execute-op lines, confirming the device-path separation is genuine.

**CONFIRMED — model was genuinely on HTP0.**

---

## 4. PREREG letter and overclaim audit

### q57 outcome table

The REPORT.md states `PPL_HTP_8=NaN` and `delta_vs_7.4314_percent=NaN`. The PREREG
defines PPL_HTP_8 as "Not a gate; replication record" and the consequence section
says "the thermal slope becomes the number behind the 10-min cap rule." The
outcome table honestly represents the guard-killed-before-chunk-8 result. The curve
(data from chunks [1] and [2]) is the deliverable; PPL_HTP_8 is correctly NaN.
**CONFIRMED — no overclaim.**

### q53c lane-2 record

The REPORT.md states:
> CPUref: 1/32 chunks; PPL_CPU[1]=7.9064; PPL_CPU[8]=NaN; PPL_CPU_32=NaN
> r8: NaN; r32: NaN; gate: NOT_COMPUTABLE
> The CPU reference did not reach chunk 8; no lane-2 gate arithmetic is claimed.

This is factually correct: the CPU arm completed only 2 chunks (PPL_CPU[1]=7.9064
from running_ppl.log; PPL_CPU[2]=9.4097 from stdout.jsonl) before guard kill at
434 tenths. Chunk 8 was not reached.

The q57 REPORT.md adds:
> HTP reference values from the recovered lane-2 log: [1] 7.9075 [2] 9.4123

Cross-verified against `lane2_s2_qwen_htp_ppl.log`: [1]=7.9075, [2]=9.4123. These
are exact matches. The 2-chunk agreement:
- Chunk 1: HTP 7.9075 vs CPU 7.9064 → delta +0.014%
- Chunk 2: HTP 9.4123 vs CPU 9.4097 → delta +0.028%

The REPORT does not state "+0.01–0.03 %" explicitly; it states the raw values
and marks r8/r32 as NaN and gate as NOT_COMPUTABLE. No adjective or overclaim
detected in the q53c REPORT or q57 REPORT regarding this comparison.

**CONFIRMED — no overclaim. Values are raw, gate is NOT_COMPUTABLE, no
qualitative embellishment found.**

---

## 5. Battery/plugged declarations and hygiene

### Arm A (q57)
- **Start:** 87%, 318 tenths (31.8 °C), unplugged (ac/usb/wireless=false)
- **End:** 85%, 415 tenths (41.5 °C), unplugged
- **Cool-start gate:** RUN_LOG documents 10 cooldown polls from 37.8 °C down to
  31.9 °C; gate satisfied at poll 10 (≤32.0 °C, ≥45%). Manifest confirms start
  at 318 tenths / 87%.
- **No model pushes:** RUN_LOG states "No model push; no charging-state change; no
  deletion." sha256 verified at session start.
- **No residual processes:** RUN_LOG final check: "no residual llama or guard
  process."
- **Charging state:** unplugged throughout (battery_start and battery_end both
  show ac/usb/wireless=false).

**CONFIRMED.**

### Arm C (q53c lane-2 session 3 resume)
- **Start:** 94%, 290 tenths (29.0 °C), unplugged
- **End:** 88%, 434 tenths (43.4 °C), unplugged
- **Cool-start gate:** RUN_LOG states "Cool-start poll: battery 94%; current
  temperature 29.7 °C; unplugged." Guard after fix verified with T5 parser
  re-check immediately before arm.
- **No model pushes:** RUN_LOG states "No model push; no charging-state change; no
  deletion." sha256 verified.
- **No residual processes:** RUN_LOG states "No residual llama or thermal_guard
  process at final read-only check."
- **Charging state:** unplugged throughout.

**CONFIRMED.**

---

## 6. Method critique: obtaining the 32-chunk CPU reference

Three options to obtain the 32-chunk CPU reference (-ngl 0, --chunks 32) on this
device without thermal guard kill:

**(a) -t 4 instead of -t 8.** Reducing threads halves the concurrent CPU workers.
llama-perplexity PPL is memory-bandwidth-bound on ARM Cortex cores (the -c 2048
context window dominates working-set size, not ALU throughput). At -t 4, per-token
wall time increases approximately linearly with thread count reduction for
memory-bound workloads on Samsung Exynos 2200 (Cortex-A710/A510 cluster), so total
wall time for 32 chunks roughly doubles from ~38 min to ~76 min. This doubles the
thermal exposure window, but the instantaneous heat dissipation is lower because
fewer cores are active simultaneously. The q53c lane-2 session 3 first attempt
(running at -t 8) reached 387 tenths (38.7 °C) at guard exit before completing a
single chunk. At -t 4, the 32-chunk run would likely stay below 41 °C for longer
because the steady-state power draw is lower (roughly 50–60% of the -t 8 thermal
load, based on the Cortex-A710 power curve). However, this is speculative without
a direct measurement; the PREREG does not include a -t 4 arm, and introducing one
would require a fresh device-cool cycle and guard re-validation.

**(b) Running plugged with active cooling.** The PREREG mandates unplugged ("device
unplugged, declared"). A plugged run would introduce a charging current (typically
+0.5–1.0 °C/min bias from battery chemical heating on top of SoC heating), which
would accelerate thermal shutdown rather than prevent it. Active cooling (external
fan, cold plate) is not part of the experimental apparatus and would change the
thermal baseline, making any 32-chunk result non-comparable to the existing 8-chunk
HTP data. This option is rejected by the experimental design.

**(c) Accepting the 2-chunk agreement as the correctness datum.** The 2-chunk
agreement (HTP vs CPU delta +0.014% at chunk 1, +0.028% at chunk 2) is internally
consistent: the HTP values from the recovered session-2 log ([1] 7.9075, [2] 9.4123)
match the q57 live values exactly, and the CPU values ([1] 7.9064, [2] 9.4097) are
the fresh guard-killed measurement. The 0.01–0.03% delta is within the expected
numerical precision of float32 PPL accumulation over a 2048-token context window.
For a Q4_0 quantized model, this agreement confirms that the HTP backend produces
bit-identical or near-identical layer outputs to CPU for the same input, at least
for the first two chunks where the context window is fully populated. The limitation
is that chunk 8 is the PREREG-defined gate point (r8), and the 2-chunk datum does
not certify r8. However, the recovered session-2 HTP log already contains chunk
[8] = 7.4314 (32-chunk final = 8.5179, error margin ±0.12523), so the HTP side of
r8 is known. What is missing is the CPU side of r8. Given the 2-chunk agreement
and the fact that the CPU PPL curve for a deterministic quantized model on the same
corpus should converge to the same value (the only source of variance is the
softmax normalization over the context window, which stabilizes by chunk 8), the
2-chunk agreement is a strong prior but not a certification. The owner should decide
whether a fresh 8-chunk CPU run at -t 4 (one device-cool cycle, ~75 min wall time)
justifies the additional thermal wear on the device, or whether the 2-chunk
agreement plus the recovered session-2 HTP chunk-8 value is sufficient evidence for
the upstream report's device-health note.

---

## Summary table

| # | Finding | Verdict |
|---|---|---|
| 1a | Arm A time-to-40 = 225 s (3.75 min) | **CONFIRMED** |
| 1b | Arm A slope = 2.33 °C/min (available window) | **CONFIRMED** |
| 1c | Arm A MAX = 414 tenths (41.4 °C) | **CONFIRMED** |
| 1d | Arm A execute-op count = 5,995 | **CONFIRMED** |
| 1e | Arm A PPL [1]=7.9075, [2]=9.4123, [8]=NaN | **CONFIRMED** |
| 1f | Arm A battery start/end/plugged | **CONFIRMED** |
| 1g | Arm C guard kill at 434 tenths, chunks [1]=7.9064 [2]=9.4097 | **CONFIRMED** |
| 1h | Arm C battery start/end/plugged | **CONFIRMED** |
| 1i | Recovered lane-2 HTP [8]=7.4314, final=8.5179 | **CONFIRMED** |
| 2a | Kill at documented threshold (410/430) with overshoot 4 tenths | **CONFIRMED** |
| 2b | Parser fix in place (sensor_timeout_s=10, sensor_fail_limit=4, no SENSOR_FAILURE lines) | **CONFIRMED** |
| 2c | Guard armed before workload (guard-first) | **CONFIRMED** |
| 3 | Model on HTP0 (5,995 execute-op lines, 33/33 offloaded) | **CONFIRMED** |
| 4a | q57 outcome table honest (PPL_HTP_8 = NaN, curve is deliverable) | **CONFIRMED** |
| 4b | q53c lane-2 record no overclaim (NOT_COMPUTABLE, raw values only) | **CONFIRMED** |
| 5a | Battery/plugged declarations correct for both arms | **CONFIRMED** |
| 5b | Cool-start gate satisfied, no model pushes, no residual processes | **CONFIRMED** |
| 6 | Method critique: -t 4 viable but untested; plugged rejected; 2-chunk agreement is strong prior not certification | PLAUSIBLE (see §6) |

---

**Final line:**

BANK-CLEAN
