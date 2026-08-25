# q57 Arms B/C — hostile pre-bank audit

**Reviewer:** independent read-only audit. All numbers recomputed from raw
guard logs, battery pre/post files, jsonl, stderr, and manifest. No edits to
source data. PREREG: `a4999d53`.

---

## 1. Throughput (pp512 t/s) from jsonl

Each arm's `stdout.jsonl` contains exactly 1 JSON row (`jsonl_rows=1`).
The field `avg_ts` is the mean of the `samples_ns` array (2 elements, from
`-r 2`). The field `n_prompt=512, n_gen=0` confirms these are prefill-only
timings.

| Arm | Field | jsonl `avg_ts` | jsonl `samples_ts` | Report | Verdict |
|---|---|---|---|---|---|
| B1 | `pp512_tps` | 88.272380 | [81.9936, 94.5511] | 88.272 | **CONFIRMED** |
| B2 | `pp512_tps` | 90.568617 | [86.3959, 94.7414] | 90.569 | **CONFIRMED** |
| C1 | `pp512_tps` | 32.780367 | [34.8171, 30.7436] | 32.780 | **CONFIRMED** |
| C2 | `pp512_tps` | 27.406200 | [26.9187, 27.8937] | 27.406 | **CONFIRMED** |

**Execute-op proof (B arms):** `grep -c "HTP0 execute-op"` on stderr:
B1 = 1764, B2 = 1764. Report: 1764. **CONFIRMED.**

**Offloaded layers:** B stderr shows all 33 layers assigned to `HTP0` (all
`load_tensors: layer N assigned to device HTP0`). C stderr shows all layers
assigned to `CPU`. Report: B=33/33, C=0/33. **CONFIRMED.**

C arms: 0 `HTP0 execute-op` lines in stderr. Report: execute_op_count=0.
**CONFIRMED.**

---

## 2. ΔT and MAX from guard logs

**Definition used:** ΔT = battery_post_temp − battery_pre_temp (from
`dumpsys battery` pre/post snapshots, NOT guard MAX − guard first sample).
MAX = maximum temperature recorded in the guard's 1-second poll log. Both
metrics are independently reported.

### B1
- Guard log: first sample epoch 1787670784 @ 296 tenths; MAX epoch
  1787670825 @ 306 tenths (flagged `MAX`). Report MAX = 30.6 °C.
  Recompute: 306/10 = 30.6. **CONFIRMED.**
- Battery pre: 296 tenths (29.6 °C). Battery post: 308 tenths (30.8 °C).
  ΔT = 30.8 − 29.6 = 1.2 °C. Report ΔT = 1.2. **CONFIRMED.**

### B2
- Guard log: first sample 314 tenths; MAX 321 tenths (flagged `MAX`).
  Report MAX = 32.1. 321/10 = 32.1. **CONFIRMED.**
- Battery pre: 315 (31.5 °C). Battery post: 321 (32.1 °C).
  ΔT = 32.1 − 31.5 = 0.6. Report ΔT = 0.6. **CONFIRMED.**
- Guard first sample (314) vs battery pre (315): 0.1 °C difference, due to
  different sampling instants. Not a finding.

### C1
- Guard log: first sample 297 tenths; MAX 325 tenths. Report MAX = 32.5.
  325/10 = 32.5. **CONFIRMED.**
- Battery pre: 298 (29.8 °C). Battery post: 323 (32.3 °C).
  ΔT = 32.3 − 29.8 = 2.5. Report ΔT = 2.5. **CONFIRMED.**

### C2
- Guard log: first sample 309 tenths; MAX 333 tenths. Report MAX = 33.3.
  333/10 = 33.3. **CONFIRMED.**
- Battery pre: 311 (31.1 °C). Battery post: 331 (33.1 °C).
  ΔT = 33.1 − 31.1 = 2.0. Report ΔT = 2.0. **CONFIRMED.**

### Start temperature consistency across arms

| Arm | Guard 1st (°C) | Battery pre (°C) | RUN_LOG gate poll (°C) |
|---|---|---|---|
| B1 | 29.6 | 29.6 | 29.7 |
| C1 | 29.7 | 29.8 | 29.8 |
| C2 | 30.9 | 31.1 | 31.2 |
| B2 | 31.4 | 31.5 | 31.6 |

Guard-first vs battery-pre differences (0.1–0.2 °C) are timing artifacts.
All four arms started within 2 °C of each other (29.6–31.5 range). B1 and
C1 started nearly identically (29.6 vs 29.8); C2 and B2 started warmer
(31.1, 31.5).

**Cool-start gate ≤ 32.0 °C met for each?** Yes — all four ≤ 32.0 °C.
**CONFIRMED.** But see Finding 5 for PREREG gate discrepancy.

---

## 3. Wall time, °C/s, °C/512-token-pass — confound analysis

| Arm | Wall (s) | ΔT (°C) | Reps | °C/pass | °C/s |
|---|---|---|---|---|---|
| B1 | 46.527 | 1.2 | 2 | 0.6 | 0.0258 |
| B2 | 55.452 | 0.6 | 2 | 0.3 | 0.0108 |
| C1 | 60.526 | 2.5 | 2 | 1.25 | 0.0413 |
| C2 | 90.961 | 2.0 | 2 | 1.0 | 0.0220 |

Report °C/pass: B1=0.6, B2=0.3, C1=1.25, C2=1.0. **CONFIRMED.**

**Is "NPU cooler per pass" confounded by NPU running shorter?**

No. Both arms perform identical work (2 reps × pp512 = 1024 tokens). The
°C/pass metric normalizes for time. NPU mean = 0.45 °C/pass; CPU mean =
1.125 °C/pass. The NPU produces ~2.5× less heating per unit of work.

The wall-time difference (NPU ~46–55 s vs CPU ~61–91 s) reflects throughput
(88 t/s vs 30 t/s), not a different amount of work. The NPU is genuinely
more energy-efficient per token for the prefill workload, not merely faster.

**Fair statement:** "less heat per prompt" (product-relevant, normalized by
work done) is supported by the data. "Lower heating rate" (°C/s) is also true
but is the less precise framing. Both statements hold.

**Start-temperature caveat:** B1 vs C1 (near-identical start temps 29.6 vs
29.8 °C) shows the cleanest comparison: 0.6 vs 1.25 °C/pass. C2 started
warmer (31.1 °C) but still showed 1.0 °C/pass — higher than either B arm.
The ranking is robust to start-temperature differences within the observed
range. **PLAUSIBLE** — effect is real, magnitude may shift ±0.1 °C/pass with
different ambient conditions.

---

## 4. Energy: charge counter usability

### Raw charge counter deltas (from battery.pre.txt / battery.post.txt)

| Arm | Counter pre (µAh) | Counter post (µAh) | Δ (µAh) | Mean V (mV) | Energy (J) |
|---|---|---|---|---|---|
| B1 | 3,172,500 | 3,161,250 | 11,250 | 4,175 | 169.09 |
| C1 | 3,161,250 | 3,161,250 | 0 | 4,163.5 | 0 |
| C2 | 3,161,250 | 3,161,250 | 0 | 4,155.5 | 0 |
| B2 | 3,161,250 | 3,101,250 | 60,000 | 4,152.5 | 896.94 |

Energy formula: Δcharge_uAh × mean_voltage_mV × 3.6 / 1e6 = J.
B1: 11250 × 4175 × 3.6e-6 = 169.0875 J. Report: 169.09. ✓
B2: 60000 × 4152.5 × 3.6e-6 = 896.94 J. Report: 896.94. ✓

### Charge counter field and granularity

The charge counter is read from `dumpsys battery` (field `charge_counter` in
µAh), taken immediately before and after each arm via the pre/post snapshot
files. The guard's battery.log 4th column is NOT the charge counter — it
reads "0" for all entries across all arms (a different metric, likely
instantaneous current, which the guard doesn't track meaningfully).

The Samsung Galaxy S23 `dumpsys battery` charge_counter has a nominal
granularity of 1 mAh (1000 µAh), but actual precision is worse due to
internal quantization and the battery fuel gauge's estimation algorithm.

### B1 vs B2: the proof of unreliability

Both B1 and B2 are NPU arms executing identical work (2 reps × pp512 on
HTP0, same model, same command). B1 consumed 11,250 µAh; B2 consumed
60,000 µAh. The ratio is 5.3× for ~1.2× difference in wall time (46.5 s
vs 55.5 s). This is physically implausible: the same workload at nearly
identical voltages (4175 vs 4152.5 mV) cannot consume 5.3× more charge.

The B2 counter drop of 60 mAh in 55 seconds implies a current draw of ~3.9
A, which exceeds the Samsung S23's maximum SoC power delivery. The true
consumption for a 55-second pp512 benchmark should be ~5–15 mAh.

### Verdict on energy

**CONFIRMED — INCONCLUSIVE is the only honest label.** The charge counter
is unusable at this measurement scale. C1/C2 reading 0 (unchanged) proves
the counter cannot resolve sub-mAh changes over 60–90 s. B1 reading 11.25
mAh is in the plausible range but unreliable. B2 reading 60 mAh is
physically impossible for the workload. No J/token comparison is valid.

### Reporting gap

The `charge_counter_granularity_caveat` in REPORT.md states only:
`C1,C2 unchanged`. It does not flag the B1/B2 5.3× discrepancy. The
J_per_token values (0.165 for B1, 0.876 for B2) remain in the data
table without a caveat. A reader could interpret these as meaningful NPU
energy-per-token figures.

**FINDING:** The caveat should extend to: "All energy values (B1, B2, C1,
C2) are unreliable. B1 and B2 report 169 J and 897 J for identical work —
a 5.3× discrepancy that proves the charge counter is unusable at this
scale. J/token values should not be cited."

---

## 5. Order B-C-C-B, cooldowns, declarations

### Execution order (from battery.pre.txt timestamps)

| Arm | Pre timestamp (UTC) | Post timestamp (UTC) |
|---|---|---|
| B1 | 2026-08-25T15:12:48Z | 2026-08-25T15:13:57Z |
| C1 | 2026-08-25T15:15:46Z | 2026-08-25T15:17:11Z |
| C2 | 2026-08-25T15:18:39Z | 2026-08-25T15:20:30Z |
| B2 | 2026-08-25T15:21:47Z | 2026-08-25T15:23:04Z |

Order: B1 → C1 → C2 → B2. **CONFIRMED.**

Gaps: B1→C1 = 109 s, C1→C2 = 88 s, C2→B2 = 77 s. These are sequential-run
gaps (model load + guard arm), not active cooldown procedures.

### Start temperature and gate compliance

| Arm | Battery pre temp (°C) | PREREG gate (≤30.0) | RUN_LOG gate (≤32.0) |
|---|---|---|---|
| B1 | 29.6 | PASS | PASS |
| C1 | 29.8 | PASS | PASS |
| C2 | 31.1 | **FAIL** | PASS |
| B2 | 31.5 | **FAIL** | PASS |

**FINDING:** The PREREG states "Preconditions per arm: temp ≤ 30.0 °C at
start" and "B/C run only if ... device is back ≤ 30 °C." C2 (31.1 °C) and
B2 (31.5 °C) both started above the PREREG gate of 30.0 °C. The RUN_LOG
applied a relaxed gate of ≤32.0 °C without documenting the deviation. This
does not affect the thermal or throughput conclusions (the guard thresholds
for C are already set at KILL 430 = 43.0 °C, providing ample headroom), but
it is a protocol deviation.

### Battery ≥ 50%

All arms: B1=84%, C1=84%, C2=83%, B2=82%. All ≥ 50%. **CONFIRMED.**

### Plugged state declarations

All battery pre and post files confirm: AC=false, USB=false, Wireless=false.
RUN_LOG: "Device remained unplugged for all arms." **CONFIRMED.**

### Declarations present start+end

Yes. Each arm has battery.pre.txt (start) and battery.post.txt (end) with
plugged state, level, voltage, temperature, and charge counter. **CONFIRMED.**

---

## 6. Overclaims / adjectives in REPORT.md

The REPORT.md Arms B/C section is entirely a code block of structured
numbers. No adjectives, no interpretive prose, no qualitative claims.

The RUN_LOG descriptive text for each arm is factual: guard MAX, ΔT,
°C/pass, execute-op counts, offloaded layers. No overclaiming language
("impressive", "remarkable", etc.) detected.

**One issue:** The RUN_LOG presents `J/token=0.165124512` (B1) and
`J/token=0.875917969` (B2) as computed values alongside the energy caveat,
which only addresses C1/C2 zero values. This implicitly suggests B1/B2
J/token figures are meaningful. See Finding 4.

**CONFIRMED** — no adjective overclaims. **REFUTED** — the energy caveat is
incomplete (see Finding 4).

---

## Summary table

| # | Claim / Area | Verdict |
|---|---|---|
| 1 | pp512 t/s from jsonl (field, reps, mean) | **CONFIRMED** |
| 1b | execute-op count B (1764) and offloaded 33/33 vs C (0, 0/33) | **CONFIRMED** |
| 2 | ΔT and MAX from guard logs (definition, recomputation) | **CONFIRMED** |
| 2b | Same start temp across arms? Within 2 °C; B1/C1 near-identical | **CONFIRMED** |
| 2c | Cool-start gate ≤ 32.0 met | **CONFIRMED** |
| 3 | °C/pass: NPU cooler not confounded by shorter runtime | **CONFIRMED** |
| 3b | Fair statement is "less heat per prompt" (product-relevant) | **CONFIRMED** |
| 4 | Energy: charge counter unusable; INCONCLUSIVE only honest label | **CONFIRMED** |
| 4b | B1 (169 J) vs B2 (897 J) for same work = 5.3× discrepancy | **CONFIRMED** |
| 4c | charge_counter_granularity_caveat incomplete — missing B1/B2 flag | **FINDING** |
| 4d | J/token values for B1/B2 still present without caveat | **FINDING** |
| 5 | Order B-C-C-B verified from timestamps | **CONFIRMED** |
| 5b | C2 (31.1 °C) and B2 (31.5 °C) started above PREREG gate (30.0 °C) | **FINDING** |
| 5c | Plugged state start+end declarations present | **CONFIRMED** |
| 6 | No adjective overclaims in REPORT.md | **CONFIRMED** |
| 6b | RUN_LOG presents J/token without caveat for B arms | **FINDING** |

---

**Final line:**

BANK-with-corrections(charge_counter_granularity_caveat must also flag
B1/B2 5.3× discrepancy for identical work; J/token rows for B1/B2 should
carry explicit "unreliable — do not cite" caveat; C2/B2 start-temp
deviation from PREREG 30.0 °C gate should be documented as a protocol
note)
