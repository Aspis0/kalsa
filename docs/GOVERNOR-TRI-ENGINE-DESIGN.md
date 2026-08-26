# GOVERNOR TRI-ENGINE — DESIGN STUDY (PLAN #24)

Status: DESIGN, paper only (no code, no device runs). v2.1, 2026-08-26.
Directive: gualt 22/08 — **NPU-prefill / CPU-decode / GPU-cool** [PLAN #24].
Source of truth for numbers: cited PLAN rows, ALIVE sections, and cited
`scratchpad/agents/q5x|q6x/REPORT.md` cells. UNKNOWN values name a cell where one
exists. The governor extends the router contract; it does not silently change R1–R9.

## v2.1 changes (audit item → change)

- 1.1 → current ledger is explicit: NO NPU lane is ON; R2 is certified but OFF pending the app-side spike cell plus `npu_fit`, R3 is 10-chunk characterization-only, and R6/R7 are hard OFF.
- 1.2 → v75 51.9/165.4/3.19× and 117–128 t/s now cite PLAN #28b.
- 1.3 → heat ratios are recomputed per size: 3.8× / undefined / 2.95× / 2.34×.
- 1.4 → 39.5 = 40.0 − 0.5, where 0.5 is the largest per-size mean below N_max; rejected individual-max basis 39.4 is recorded.
- 1.5 → 0.812 cites #18/ALIVE §6 only.
- 1.6 → 1.38 °C/min is UNKNOWN as a raw trace; narrative-only PLAN #28c is labeled.
- 1.7 → the alleged original 3-minute arms are UNKNOWN, not a fact.
- 1.8 → half-offload 0.38 is sourced as ALIVE §6: 10.53/27.69.
- 2.1 → plugged thresholds use measured day-1 `T_idle`; absolute unplugged thresholds remain, and CRITICAL exit is never below `T_idle + 1`.
- 2.2 → a pre-turn predicted-end-temperature admission gate blocks CPU-prefill watchdog kills, with a 2048-token arithmetic example.
- 2.3 → the design slope is the q53c CPU bound, 2.6–3.6 °C/min, not the NPU 2.33 °C/min.
- 2.4 → actual hysteresis widths are 2.0 / 3.0 / 8.0 °C; claims are scoped to the N_max spike and GPU per-turn heat is UNKNOWN.
- 2.5 → +1.5 °C/min is an ENGINEERED-TUNABLE pinned by G1/golden tests.
- 2.6 → G5 has unplugged-only NPU runs after the window; its plugged session is CPU-controls-only.
- 2.7 → COOL exit uses a 10-minute dwell and lands in FAST, not WARM.
- 2.8 → LOWBAT <25% is marked unreachable while the 45% floor is enforced.
- 2.9 → initial state is classified from the first successful poll, including a hot launch.
- 2.10 → transient WARN exposure is handled by the admission margin; KILL remains a hard backstop.
- 2.11 → only CPU→GPU engagement consumes the one-flip/hour budget; GPU→CPU exit does not.
- 3.1 → the break-even formula remains, with its sign sanity check and unknown inputs retained.
- 3.2 → banked throttle-adjacent priors from #28e, ALIVE §2, and PLAN ≈1179/≈1201 are added.
- 3.3 → τ is explicitly the remaining hot-window token count set by the exits.
- 4.1 → LaunchConfig is v0.3 with `decode_engine ∈ {cpu, gpu_coolmode}` and explicit golden tests.
- 4.2 → R3 is labeled 10-chunk characterization-only everywhere.
- 4.3 → “v75+” is replaced by v75-class; 8xx remains UNKNOWN until QDC Phase 0.
- 4.4 → the per-turn admission lookup and bounded relaunch are both named mechanisms with separate tests.
- 5.1 → G1 bins only the traversed temperature range and has a pre-committed fallback acceptance.
- 5.2 → G1 uses one sampler, the Marco1c t4 card.
- 5.3 → G5 uses balanced NPU/CPU counts in the allowed unplugged arm.
- 5.4 → G4 is an alias of signed PLAN-10DAYS §6(a), consuming no new device budget.
- 5.5 → G5’s 32 °C contingency threshold is sourced to PLAN-10DAYS §0, not this device.
- 5.6 → G2 pre-registers `gpu_fit` per candidate and reports CPU-only cases.
- 6.1 → plugged deadlock is a named risk with a day-1 baseline guard.
- 6.2 → shutdown irrecoverability until 07/09 gets a kill budget and cumulative stop rule.
- 6.3 → INCIDENT_THERMAL rule 2’s plugged-in ban is carried into G5 and all NPU sessions.
- 6.4 → G3’s likely plugged, relative-only fit is a named risk.
- 6.5 → sensor quantization and the 40-second fail-closed stall window are named limits.
- v2 re-audit (a) → table misses, intermediate sizes, oversize prompts, and GPU-prefill requests now refuse; only tabled chunks may proceed.
- v2 re-audit (b) → the `T_idle ≥ 37.5` cap collapse is an explicit `hot-plugged: CPU-only, no cool mode, refusal announced` regime.
- v2 re-audit (c) → profile invalidity is triggered by `T_idle` drift >1.5 °C or an exit missed for 2× dwell; refuse and re-measure.
- v2 re-audit optional → plugged CRITICAL width is derived as 7.0−1.0=6.0 °C versus 8.0 °C unplugged.
- v2 re-audit label → q53c’s 2.6–3.6 °C/min is marked derived from its rounded narrative.

## 0. Executive summary — proposed defaults with honest confidence

1. Decode → CPU by default: NPU decode 0.37–0.62×, GPU 0.72–0.81× on 740,
   0.992 parity on 750, and half-offload 0.38–0.45× (0.38 = 10.53/27.69,
   ALIVE §6; 0.45 = 7.90/17.55, #18) [HIGH; three banked generations].
2. **Current ledger: NO NPU lane is ON.** R2 is correctness-certified but OFF pending
   the app-side spike cell plus `npu_fit`; R3 is 10-chunk characterization-only,
   not 32-chunk certification; R6 and R7 are hard OFF. After the required ledger
   flips, the candidate set is v75-class R2 and a reopened v73 dense/hybrid R6;
   this design and G1–G5 provide the app-side evidence [MEDIUM-HIGH].
3. q58 per-size heat ratios for v73 NPU vs CPU are **3.8× at n=128, undefined at
   n=512 (CPU denominator 0.0), 2.95× at n=1024, and 2.34× at n=2048**.
   The record does not support “2.5–4× at every size” [MEDIUM; v73 only].
4. GPU cool-mode decode is a 740-class, fits-in-RAM, KEXP-scope feature: −19% t/s
   at A/C 0.812 for −2.75 °C peak; it is forbidden on 750-class parity 0.992.
5. Unplugged defaults: WARM 38.0/36.0 °C, COOL 39.5/36.5 °C, CRITICAL 42.0/34.0 °C
   plus 10-minute soak; watchdog WARN 40.0/KILL 43.0, poll 10 s, battery floor 45%.
   Plugged thresholds are relative to `T_idle` (§2.2), never above the watchdog.
6. Decode-engine change is a full reload (seconds-scale; ~25 s anon-load anchor on
   8B KEXP). Count at most one CPU→GPU engagement per hour; cost by size UNKNOWN → G2.
7. “CPU throttle vs −19%” remains UNKNOWN. Interim policy: switch on eligible COOL
   entry; G1 supplies `rate_cpu(T)` and G3 supplies the GPU slope.
8. Fit gates precede speed: GPU = 800 MiB + 1.05× offloaded bytes; NPU = all weights
   anon, host KV mandatory (`-nkvo`); unknown `npu_fit` → CPU.
9. Router R1–R9 remain pure and ordered, but LaunchConfig is v0.3: decode placement
   is explicit, while the governor adds polling, table lookup, and bounded relaunch.
10. Charging S23 idle is reported at 35–41 °C [PLAN-10DAYS §0]; plugged windows may
    be unavailable. NPU sessions are unplugged-only and post-window under INCIDENT_THERMAL.

## 1. Problem statement — measured constants

### 1.1 Engine speeds (banked cells; product cards and cell numbers never mixed)

Prefill, pp512, nseq=1:

| path | v73 / S23 (8 GB) | v75 / Xiaomi (12 GB class) | unknown 8xx |
|---|---|---|---|
| CPU | 24.1 med (3 reps) [PLAN #28d] | 51.9 [PLAN #28b] | UNKNOWN — Phase 0 QDC |
| NPU dense/hybrid | 84.0 med (76.3–87.0) = 3.49× [PLAN #28d] | 165.4 med (150.3–170.3) = 3.19× [PLAN #28b] | UNKNOWN |
| NPU dense/hybrid spread | 117–128 t/s observed once [PLAN #28b fallback-trap re-test] | — | UNKNOWN |
| NPU experts (MoE all-Q4_0) | dispatch-proven then DSP queue dies under load (F6) [q48] | 686.2 vs 142.2 = 4.82× [q48]; correctness r = −0.02%, 32 chunks [q55 Part A] | UNKNOWN (QDC block D) |
| NPU trunk-only (B′) | LFM-B′ 58.43 vs 51.08 = 1.14× [q46] | Marco-B′ 27.84 vs 19.12 = 1.46×; J/token 0.86× [#28c/q44] | UNKNOWN |
| GPU full offload (fits-RAM only) | pp512 25→69 t/s [PLAN #31] | 2.477× confirmatory [#16 phase d] | UNKNOWN |

Decode, tg128:

| engine | v73/S23 | v75/Xiaomi | verdict |
|---|---|---|---|
| NPU | B′ 10.6 vs 17.0 ≈ 0.62× [q46] | 4.09–4.85 vs 11.94 = 0.37× [PLAN #28e] | never; law 1 |
| GPU full | KEXP 14.25 vs 17.55 = 0.81×; OLMoE 20.03 vs 27.69 = 0.72× [#18/#20, ALIVE §6] | A/C 0.992 parity [#16 phase d] | CPU wins or ties; GPU cool-only |
| half-offload (trunk-GPU/experts-CPU) | 7.90 = 0.45× [#18] | 10.53 vs 27.69 = 0.38× [ALIVE §6] | banned by policy |
| streaming regime (>RAM) | Mellum2 mmap 0.216 vs partial-GPU 0.223 (+3%) [#23] | same wall | recipe decides; engines irrelevant |

### 1.2 Thermal constants (the ones that exist)

| constant | value | source |
|---|---|---|
| sustained full-on-NPU prefill slope, v73 | 2.33 °C/min; 40 °C at 3.75 min; guard-killed 41.4 °C | [q57 REPORT] |
| CPU-ref slope, same hybrid load | **UNKNOWN**; 1.38 °C/min is narrative-only in PLAN #28c, raw not in the q57 cell | [PLAN #28c narrative; q57 raw gap] |
| per-pass heat, 512 tok, v73 | NPU 0.45 °C/pass vs CPU 1.125 °C/pass (B/C, n=2 each) | [q57 B/C] |
| q58 per-size process-mean ΔT at n=128/512/1024/2048 | NPU 0.5/0.0/1.1/2.2 °C vs CPU 1.9/3.25/3.25/5.15 °C; prompt-only wall 1.7 vs 12.3 s (128), 23.2 vs 81.6 s (2048) | [q58 REPORT] |
| frozen spike derivation | N_max = 512; 39.5 °C = 40.0 − 0.5, where 0.5 is the largest per-size mean below N_max (n=128); individual-max 0.6 would be 39.4 and was rejected | [q58 REPORT/REVIEW_DOC] |
| GPU cool mode delta (KEXP, S23) | −19% t/s (A/C 0.812), −2.75 °C peak (CPU peak 40.0) | [#18, ALIVE §6] |
| OLMoE thermal GPU-vs-CPU | median peak gap 0.45 °C → cool mode pointless outside KEXP | [#20] |
| passive cool-down, S23 unplugged | −0.28 °C/min (34.3→29.9 °C over 15.8 min); n=1 | [q56 health] |
| charging idle battery temp, S23 | 35–41 °C reported; day-1 measurement still required | [PLAN-10DAYS §0] |
| CPU fast-heating datum (dense 4B, -t 8) | >38 °C in ~2 min unplugged; guard-killed 43.4 °C at chunk ~7 | [q53c / q53 s3] |
| design safety slope | **3.6 °C/min**, the worst edge of q53c CPU ≥2.6–3.6 °C/min, **derived from the rounded q53c narrative**; 0.43–0.60 °C per 10-s poll | [q53c] |
| v75 spike thermal cost | ΔT ≤1.0 °C per pp512 pass, MAX ≤32.1 °C | [q55 Part B] |
| GPU cool-mode sustained slope; v73 CPU product-decode throttle curve | UNKNOWN → G3; UNKNOWN → G1 | — |

### 1.3 Switch costs

- **NPU prefill → CPU decode in one llama.cpp process: free** — HTP prefill ops and
  CPU decode coexist without a reload [PLAN #24; q31/q46/q48/q55 proofs].
- **Decode-engine switch = full model reload** [PLAN #24]. Anchors: relaunch+prewarm+
  send 2.48 s on Jelly [ALIVE §1]; no-mmap rematerialization adds ~25 s on 8B KEXP
  [PLAN #29]. Cost by model size UNKNOWN → G2; decode placement is therefore a
  load-time decision with a capped relaunch path.
- Prefill-executor flip inside a launched multi-engine process is implementation-
  dependent; do not count on it.

### 1.4 Memory costs / fit gates (decide before speed — law 4)

- **GPU:** conservative gate **800 MiB + 1.05× offloaded bytes**, safe on five measured
  points; driver copies are invisible to RSS and mmap weights to MemAvailable [PLAN #31/#44,
  ALIVE §6 row 12]. Validated on one device+model.
- **NPU:** all weights become anon: LFM-B′ 3672 MiB / 7074 MemTotal [q46]; Marco-B′
  6360 MiB and LMK×2 on S23, fits 12 GB Xiaomi [PLAN #28c]; OLMoE experts 3.6 GiB
  on HTP0-REPACK [q48/q55]. Host KV is mandatory: 256 MB at ctx 2048 fails
  `fastrpc_mmap` [q55]. `npu_fit` is a placeholder on known footprints; unknown → CPU.
- **CPU:** elastic mmap residency plus #29 repack kernel; mlock is dead on retail
  (RLIMIT_MEMLOCK 64 MB) [PLAN #29].

### 1.5 Sensor reality

Battery temperature is the only runtime-readable sensor on v73/v75: dumpsys battery
returns tenths of °C and `getThermalHeadroom` exposes no numeric headroom [q58;
q55 Part B]. Poll every 10 s. Watchdog: WARN 40.0 °C, KILL 43.0 °C, battery floor
45%, fail-closed on sensor failure [q56; PLAN-10DAYS §0]. The 25/08 `shutdown,lpm`
event proves OS protection can fire before user space [INCIDENT_THERMAL; q56].

## 2. State machine

### 2.1 Inputs

```
ThermoProfile {                      // polled, not cached
  batt_temp_c        // tenths-of-°C from dumpsys battery
  batt_level_pct     // product/harness floor: 45%
  plugged            // ac | usb | false
  T_idle_c           // day-1 measured plugged idle baseline, else null
  trend_c_per_min    // last-60-s slope
}
Per-turn: prompt_tokens, gen_len_hint   Per-launch: DeviceProbe + ModelProfile
State: FAST | WARM | COOLMODE | CRITICAL | LOWBAT
```

### 2.2 States and thresholds

Use the absolute profile when unplugged. For a plugged session, day 1 measures
`T_idle` under the reference procedure in `docs/PLAN-10DAYS-2026-08-28.md §0`, then
uses offsets. No plugged launch is allowed if `T_idle + 1.0 ≥ 42.0` or if an offset
would reach KILL before CRITICAL can abort.

| profile | WARM enter / exit | COOL enter / exit | CRITICAL enter / exit |
|---|---|---|---|
| unplugged | 38.0 / 36.0 °C | 39.5 / 36.5 °C | 42.0 / 34.0 °C + 10-min soak |
| plugged | `min(T_idle+3.0, 42.0)` / `T_idle+1.0` | `min(T_idle+4.5, 42.0)` / `T_idle+1.5` | `min(T_idle+7.0, 42.0)` / `T_idle+1.0` + 10-min soak |

The plugged row is relative, not a new absolute thermal claim. `KILL=43.0 °C` is
the absolute watchdog cap for every profile; CRITICAL entry is capped at 42.0 °C
to leave poll margin. The plugged CRITICAL exit is **never below `T_idle+1.0`**.
The nominal plugged CRITICAL width is `7.0−1.0=6.0 °C`, versus `42.0−34.0=8.0 °C`
unplugged: the relative exit must clear measured idle by 1.0 °C while entry stays
below KILL.
For `T_idle ≥37.5 °C`, the COOL cap collapses because
`min(T_idle+4.5,42.0)=42.0=CRITICAL`; this is an explicit regime:
**`hot-plugged: CPU-only, no cool mode, refusal announced`**. At `T_idle ≥39 °C`,
`min(T_idle+3.0,42.0)=42.0` also collapses WARM; announce refusal/cooldown rather
than silently selecting an accelerator.
If the measured idle makes the profile invalid, refuse the plugged turn and wait
for cooldown or require unplugged operation.

Pre-commit profile invalidity: if a 10-minute idle re-measure puts `T_idle` more
than 1.5 °C from the day-1 reference, or any required exit is not reached within
2× its dwell, mark the profile invalid, refuse the turn, and re-measure `T_idle`.

| state | condition | decode | prefill menu | notes |
|---|---|---|---|---|
| FAST | below WARM entry | CPU | admitted table-driven menu | state is classified from the first successful poll, not assumed after load |
| WARM | WARM entry through COOL entry | CPU | only admitted turns; NPU spike only if a lane is ON | WARM width is 2.0 °C unplugged |
| COOLMODE | at COOL entry until its exit | CPU, or `gpu_coolmode` only under §2.4 | NPU spike suppressed | GPU engagement costs one reload |
| CRITICAL | at CRITICAL entry | none — abort | none | kill children, drop HTP, re-derive at next load |
| LOWBAT | <25% only if the 45% floor is not enforced | CPU | CPU only | unreachable under the carried 45% floor; no independent source for 25% |

Threshold rationale: 39.5 is the frozen q58 mean-based derivation; 42.0 is one °C
below KILL, with q53c’s worst banked rise 2.6–3.6 °C/min = 0.43–0.60 °C per poll,
so the margin is about 1–2 polls, not a guaranteed °C. Unplugged widths are WARM
2.0, COOL 3.0, CRITICAL 8.0 °C. WARM’s 2.0 °C exceeds the largest observed NPU
per-run rise at n≤512 (0.6 °C); the n=2048 CPU 5.15 °C case is rejected by admission.
GPU per-turn heat is UNKNOWN; the −2.75 °C value is an arm peak delta, not a turn heat.

### 2.3 Transitions (hysteresis + dwell)

| transition | trigger | exit condition | dwell/min-latency |
|---|---|---|---|
| FAST→WARM | profile WARM enter | profile WARM exit | immediate entry; ≥10 min before exit accept |
| WARM→COOLMODE | profile COOL enter, or `trend ≥ +1.5 °C/min` at WARM+0.5 | profile COOL exit | ≥10 min dwell; CPU→GPU engagement cap ≤1/hour |
| any→CRITICAL | profile CRITICAL enter or watchdog precondition | unplugged ≤34.0; plugged `T_idle+1.0`; plus 10-min soak | immediate abort, no grace period |
| COOLMODE→FAST | profile COOL exit | — | 10-min dwell; no “completed soak” term |

`+1.5 °C/min` is **ENGINEERED-TUNABLE**, not a banked slope; G1 must report
sensitivity to it and the golden tests pin the value. The WARM→COOL trend is a
predictive guard, not a citation to the UNKNOWN raw 1.38 trace. Only CPU→GPU
engagement consumes the hourly flip budget; GPU→CPU exit is not counted.

### 2.4 Placement and pre-turn admission

Admission runs before engine selection and before every prefill chunk:

```
margin = 0.5 °C                         // engineered safety margin
T_limit = WARN - margin = 40.0 - 0.5 = 39.5 °C
if engine == GPU or prompt_tokens is not a table key:
    refuse; chunk down to a tabled size and re-check; never admit an unknown delta.
else:
    delta = ΔT_table(prompt_tokens, engine) // q58 per-size banked table
    if T_now + delta > T_limit:
        downgrade: smaller admitted chunk, then CPU, then cool-down wait;
        re-check every chunk against current T; never sum a rejected turn by fiat.
    else:
        admit the requested engine.
```

Example: a 2048-token CPU prefill from 37.9 °C predicts
`37.9 + 5.15 = 43.05 °C > 39.5 °C`; it is rejected before launch. This blocks
the former WARM/FAST watchdog exposure (`43.05 > KILL 43.0`) rather than relying
on a 10-second poll to catch a discrete jump.

The table used by admission is:

| prompt tokens | 128 | 512 | 1024 | 2048 |
|---|---:|---:|---:|---:|
| NPU ΔT (°C) | 0.5 | 0.0 | 1.1 | 2.2 |
| CPU ΔT (°C) | 1.9 | 3.25 | 3.25 | 5.15 |

Where prefill runs at launch:

```
open NPU only iff:
  generation is v75-class, or v73 dense/hybrid after R6 reopens
  ∧ the specific lane is ON in the ledger
  ∧ quants ⊆ {Q4_0,Q4_1,Q8_0,IQ4_NL,MXFP4}
  ∧ npu_fit(model)
```

Current result is no open NPU session: R2 is OFF pending the app-side spike cell
and `npu_fit`; R3 is only a 10-chunk characterization; R6/R7 are hard OFF. Any
future NPU spike additionally requires `tokens ≤512`, the profile spike ceiling,
state FAST/WARM, and the admission inequality. v73 MoE-expert NPU remains structurally
unreachable under F6. NPU/HTP sessions are unplugged-only, capped at 10 minutes with
watchdog, and post-window under INCIDENT_THERMAL rule 2.

If NPU is unavailable or fails admission, GPU full-offload prefill is considered
only when `gpu_fit` and a measured prefill win hold (2.76× S23 LFM-KEXP [PLAN #31];
2.477× phase-d 750 [#16]); otherwise CPU or cooldown wait. This is a per-turn,
table-driven lookup, not an unbounded online benchmark.

Where decode runs: CPU, except an eligible COOLMODE relaunch with
`decode_engine = gpu_coolmode`:

```
gpu_fit(model)
∧ generation has a measured cool-mode delta (KEXP / v73-A7X scope)
∧ device is not 750-class (A/C 0.992 parity)
∧ cool_pays() == true
```

**Break-even.** The GPU tax is `1−0.812 = 18.8%`; switch iff
`(1/rate_cpu_hot − 1/(0.81·rate_cpu_cold)) · τ_energy_tokens > reload_s`.
Here τ is the remaining **hot-window** token count implied by the selected exits,
not an arbitrary generation length. `rate_cpu(T)` and the sustained GPU slope are
UNKNOWN → G1/G3. Interim rule: switch when eligible on COOL entry.

Banked priors now constrain, but do not replace, G1: #28e has a v75 CPU decode
1.69 t/s “outlier da throttle sospetto” (single rep, flagged); ALIVE §2 has CPU
outliers 29.5 and 18.8 t/s at 38–40 °C in 750 prefill benches; PLAN ≈1179 reports
Xiaomi CalaQwen sustained 4.392 with no collapse (the collapse was Doze/flash I/O);
PLAN ≈1201 reports Xiaomi Marco1c sustained 6.84 with no collapse at 33–35 °C.
Honest conclusion: throttle appears only at ≥38 °C in this record. Break-even
unknowns remain flagged until G1/G3.

## 3. Composition with router v0.3 (SPEC v0.2 rules retained)

The governor is a ThermoProfile input plus two explicit mechanisms: a polling/state
machine with table-driven per-turn admission, and a bounded decode relaunch. R1–R9,
their order, and fail-closed fit semantics remain unchanged. This is an interface
extension, not a reinterpretation of R8 as a decode rule.

- Capability tables and ledger use `schema_version: 2`; unknown version refuses → CPU.
- **LaunchConfig v0.3** adds/changes:
  - `decode_engine: "cpu" | "gpu_coolmode"` (v0.2’s CPU-only type becomes v0.3);
  - `prefill_token_cap: number|null` (512 only after a lane is ON, else null);
  - `admission_margin_c: number` (0.5 in the design table).
- `Mode{thermal_priority:boolean}` is replaced by ThermoProfile. R8 remains the
  prefill thermal fallback; it does not express the decode switch.

| table column | v73 (S23) | v75 (Xiaomi) | unknown 8xx |
|---|---|---|---|
| spike_lane_ids | null; R6 future dedicated spike cell | R2 correctness-certified but OFF pending app cell + `npu_fit`; R3 10-chunk characterization-only | null |
| n_max_tokens | 512 [q58] | 512 provisional; ΔT≤1.0 °C observed at 512 [q55 Part B] | UNKNOWN |
| t_spike_battery_c | 39.5 [q58] | 39.5 provisional | UNKNOWN |
| spike_dT_per_512_c | 0.0–0.5 mean [q58] | ≤1.0 [q55 Part B] | UNKNOWN |
| cool_decode_ratio | 0.812, KEXP scope [#18, ALIVE §6] | n/a; 0.992 parity forbids | UNKNOWN |
| cool_peak_delta_c | −2.75, KEXP [#18] | n/a | UNKNOWN |
| reload_cost_s | UNKNOWN → G2 | UNKNOWN → G2 | UNKNOWN |
| passive_slope_c_per_min | −0.28, n=1 [q56] | UNKNOWN | UNKNOWN |

Ledger handling: the governor reads, never writes, the ledger. R2/R3 provide data
columns only; R6 reopens only through its dedicated v73 spike cell; R7 stays hard OFF;
R8 remains its existing prefill fallback. No lane flips without the SPEC §6 ladder,
the required cell, and `npu_fit`.

Golden tests:

1. Current ledger: R2 OFF, R3 characterization-only, R6/R7 hard OFF → no NPU.
2. v0.3 COOLMODE relaunch emits `decode_engine="gpu_coolmode"`; v0.2/unknown
   schema emits CPU.
3. Missing fit, missing cool delta, 750 parity, or failed admission emits CPU/wait.
4. First-poll hot launch classifies directly into WARM/COOL/CRITICAL as applicable.
5. `37.9 + 5.15 = 43.05` rejects 2048-token CPU prefill; chunk re-admission is tested.
6. Plugged CRITICAL exits at `T_idle+1.0` plus soak; it never waits for absolute 34.0.
7. WARM width=2.0, COOL=3.0, CRITICAL=8.0; +1.5 trend is pinned tunable.
8. Only CPU→GPU counts toward one flip/hour; G5 plugged session rejects NPU.
9. 4096-token prompt, intermediate miss, oversize prompt, and GPU-prefill request refuse
   or chunk to a tabled size; no table miss becomes an admitted no-delta turn.
10. Every new table value is pinned per generation; R1–R9 golden contracts remain green.

## 4. UNKNOWNs → measurement cells (≤1 h/device unless noted)

**G1 — CPU throttle curve under sustained product decode (S23, plugged declared).**
Use one sampler, Marco1c card **t4**, `-ngl 0 -nr`, warm session, tg512 loop for
45 minutes maximum under q56 watchdog (poll 10 s, WARN 40/KILL 43), cpuset 0–7;
sample t/s each minute and battery T each 10 s. Define 2 °C bins over the actually
traversed range `[T_start, min(T_end, WARN)]`, not fixed bins above an unreachable
plugged idle. Primary acceptance: ≥8 usable minutes in every fully traversed bin.
Fallback, pre-committed: if guard/idle prevents that, accept a safety-constrained
partial result with all traversed bins, a bounded slope to the stop, and ≥30
contiguous minutes below WARN if available; untraversed bins remain UNKNOWN and the
cell does not claim a full curve. If `T_start ≥ WARN`, classify G1 unavailable and
schedule the unplugged post-window repeat. Deliver `rate_cpu(T)`, dT/dt, and trend
sensitivity; record `plugged-warm` and same-session-relative reads. G1 is the most
valuable cell because it measures the only unknown directly gating `cool_pays()` and
the WARM→KILL exposure; G3 is its pairing constant.

**G2 — decode-switch reload cost by model size (S23, declared).** Candidates are
Marco1c-KEXP 6.4 GB, LFM-B′ Q8_0-trunk 3.58 GB, and one dense 2.8–3.5 GB model
(Qwen3.5-4B Q4_K_M 3.50 GB incl. 672 MB projector) if retained. N=5 alternations
per model; measure CPU load and CPU→GPU relaunch/upload separately. Pre-register
`gpu_fit` per candidate: the 6.4 GB candidate may be CPU-only on S23, which is a
valid result. Acceptance CV≤15%; bracket first token separately from steady state.

**G3 — GPU cool-mode sustained slope + break-even (S23).** Run 20 min tg512
KEXP ngl=99 A-arm and 20 min C-arm, ABBA, guard-on; unplugged is preferred but
likely infeasible during the 10-day plugged window, so a plugged run is relative-only
and starts at measured `T_idle`. Deliver GPU °C/min and t/s decay versus CPU for
`cool_pays()`, with two replicates/arm within ±15% slope. The original “3-minute
arms” duration is **UNKNOWN** (the cited #18 protocol is not available); this cell
re-tests −19%/−2.75 °C and supplies the missing sustained slope.

**G4 — prompt-length crossover (= signed PLAN-10DAYS §6(a), alias).** Grid
p∈{128,512,2048} × g∈{64,512}, whole-turn A(all-GPU) vs C(all-CPU), N=3 ABBA,
ctx 4096, ubatch 512, production sampler, `-nr`, `-fa off`, load separate
[PLAN-10DAYS §6a]. Budget ≈3 h is the signed plan’s only over-1-h cell; this is
an alias consuming no new device budget. Deliver crossover or “none in grid”;
g*≈900–1000 at p=512 makes g=512 mandatory.

**G5 — spike repeatability and plugged availability (S23, post-window).** After
07/09, and only with owner re-authorization, replay q58 at n∈{128,512} with a
balanced 4 NPU + 4 CPU run count per size, B-C-C-B, guard-on, **unplugged-only**.
The plugged-warm session is CPU-controls-only: it measures start-T and qualified
window frequency without violating INCIDENT_THERMAL rule 2. The 32 °C contingency
threshold comes from PLAN-10DAYS §0, not this device; compare it with day-1 `T_idle`.
Deliver σ(ΔT_NPU), prompt-only wall variance, and window frequency. Keep absolute
ceilings unchanged; NPU arm remains post-window and ≤10 min with watchdog.

Cross-reference: `npu_fit` remains SPEC open item 3 and gates R2/R3 more than the
governor. No current NPU run is authorized by this document.

## 5. Risks / anti-patterns

1. **Oscillation.** Widths are 2.0/3.0/8.0 °C, not all ≥3.0; only WARM is
   compared with the ≤0.6 °C N_max NPU spike. Ten-minute dwell and the one-way
   admission guard limit churn; CPU n=2048 is rejected, not tolerated as overshoot.
2. **Thermal shutdown.** The 25/08 S23 `shutdown,lpm` event is clean OS protection
   [INCIDENT_THERMAL; q56]. Use design slope 2.6–3.6 °C/min (q53c), CRITICAL 42,
   WARN/KILL 40/43, per-turn admission, and a 10-minute cap for any future NPU arm.
3. **Plugged charging heat.** Reported idle is 35–41 °C [PLAN-10DAYS §0], so absolute
   39.5 may be unavailable. Day-1 `T_idle` determines relative thresholds; no NPU
   session runs plugged.
4. **Battery-temp lag.** Battery is the only sensor and lags silicon. Admission,
   N_max, trend, and fail-closed handling cover the gap; no numeric headroom is assumed.
5. **Process death / LMK.** Re-probe memory and re-read the ledger on every launch;
   do not persist mid-session state [ALIVE §1; PLAN #28c].
6. **Energy micro-management.** 169 J vs 897 J is inconclusive [q57 B/C]; 0.86×
   J/token is informational only. Do not route on energy.
7. **Cross-harness division.** Keep product cards and cell numbers separate; historical
   consecutive-run variance reached ±50% [ALIVE §5].
8. **Plugged CRITICAL deadlock.** A fixed absolute exit of 34.0 can be unreachable
   above a 35–41 °C idle floor. Relative exits and `T_idle+1` are mandatory; if the
   day-1 baseline leaves no safe profile, refuse plugged launch and require unplugged.
9. **Shutdown irrecoverability.** PLAN-10DAYS §11 says a thermal shutdown cannot be
   recovered until **07/09**. Set a per-day kill budget; after 2 watchdog kills,
   suspend governor cells until unplugged and owner review. G1/G3/G5 must stop cleanly.
10. **INCIDENT_THERMAL plugged ban.** Rule 2 disallows plugged-in NPU/HTP sustained
    runs; any resumed v73 session is post-window, unplugged-only, ≤10 min, watchdog-on.
11. **G3 range compression.** Ten plugged days make “unplugged preferred” infeasible;
    relative-only slopes from 35–41 °C may not span the break-even region. Mark the
    fit scope and repeat post-window if needed.
12. **Sensor granularity/stall.** Tenths-of-°C plus 10-s polls can move a 2.0 °C WARM
    band by two samples; a q56 40-s binder-unavailability window is fail-closed and
    can look like a false KILL. Plugged-warm will spend most of its life near boundaries.

## 6. Non-goals (v2)

No autotuning, online benchmarking, scheduler replacement, or plugin runtime [SPEC §1].
The design adds only the bounded decode relaunch, the polling state machine, and a
table-driven admission lookup; all R1–R9 policy remains in the router contract.
