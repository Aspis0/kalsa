# Governor plan from first principles (Fable 5.1, 2026-09-30)

Author: Paseo agent `14215b50-4c11-47d4-9d1f-fec1ab8e8475` (claude-fable-5-1, high, read-only). Brief: owner's
words "we cannot copy things already done / your training" - every choice tied to a lab number or a line of our
code, or marked as a hypothesis with its cheapest experiment. Coordinator: not yet verified line by line; each
milestone gets its own on-disk check, audit and device run before anything is claimed.

## Inputs we can actually sense

| signal | source | rate / latency | status |
|---|---|---|---|
| battery temperature | `ACTION_BATTERY_CHANGED`, `GovernorBatteryModule.kt:55` | pushed to the engine once per completion (`LlamaService.ts:1704-1748`), never during generation | CONFIRMED |
| Android thermal status 0..6 | `KalsaThermalModule.kt:43-79` listener | event-driven in app; reaches engine only per completion (`governorInputs.ts:353-359`) | CONFIRMED |
| thermal headroom forecast | `PowerManager.getThermalHeadroom(s)` (API 30+) | not read anywhere | UNKNOWN on S23 |
| battery current / charge / voltage | 1 Hz native sampler `GovernorBatteryModule.kt:168-170, 222` | Jelly: changes on ~98 % of 1 Hz rows; S23 adb every ~30 s; S23 in-app UNMEASURED | CONFIRMED / UNKNOWN |
| skin/NSP/GPU/CPU zones | shell sysfs (harness only) | in-app only `thermal_zone0` every 30 s, advisory | CONFIRMED |
| per-token timings, prefill ms | `KALSA_GOVERNOR` stats `LlamaService.ts:1770-1806` | per turn | CONFIRMED |
| backend availability | binding HTP0 resolver (`c0bbbd35`) | at load | CONFIRMED |
| trend C/min | wire field, always 0; no native producer | inert | CONFIRMED |

Levers today: prefill backend (load-time device), prefill chunk dose (`llama-governor-policy.cpp:327-396`), decode
backend (reload only, `llama-governor-runtime.cpp:194-197`), one-copy per-phase admission (`llama-context.cpp:1227-1246`,
one-copy branch only), prewarm skip, pause. No thread/ubatch/pacing lever.

## Architecture (proposed)

- Engine: classifier, admission, chunk dose, pause line; NEW per-backend cost table `cost[phase][backend]` ranked
  each turn; NEW pace lever in the decode loop. No sensing.
- Binding: thermal push that may arrive mid-completion (`set_thermo_profile` is decode-thread-only today,
  `llama-governor-policy.h:33-39`); admission call for one-copy.
- App: sensing (thermal listener, 1 Hz battery sampler), NEW push every 10 s during generation, persistence of the
  learned table per SoC, exploratory-turn scheduler.
- Loop: per turn rank backends by cost above the floor with hysteresis (winner must beat incumbent by a margin two
  turns in a row); per chunk existing admission; mid-turn on SEVERE pace decode (AIMD) and send the next chunk to
  the coolest backend. Learning: after each UNPLUGGED turn integrate current x voltage per phase window / tokens,
  EWMA into the table; one exploratory turn on the runner-up every N cool turns. Priors = lab heat tables per SoC,
  replaced after 3 real turns.
- Failure modes: no platform status -> battery-only; no current -> priors only, learning off; plugged -> learning
  off, ranking on; NPU unavailable -> GPU lane; mmproj -> governor off.

## What contradicts the owner rules today (CONFIRMED)

a. Platform floor collapses MODERATE/SEVERE/+ into one COOLMODE (`llama-governor-policy.cpp:41-51`).
b. Admission deltas `{1.9, 3.25, 3.25, 5.15}` applied to all backends, "unmeasured defaults" (`:337-338`); measured
   spread is 7x (6.45 vs 44.59 C·s/1k).
c. Battery-only thresholds 38/39.5/44 C refreshed once per turn: one 981-token turn went 33.6 -> 41.6 C, status 0 -> 3
   under FAST. Cadence is as much the cause as the sensor.
d. LOWBAT and safety states return CPU prefill (`:236-240`), the hottest backend.
e. WARM trend rule is dead on the wire.
f. Three engine lines diverge: `feat/governor-platform-status` (on the phone) is not in fork main;
   `feat/governor-onecopy` lacks the platform-status commits.
Stale lab claim: `s23-backend-hopping-heat` HAS a REPORT (28/09): S23 decode CPU 22.13 / GPU 14.03 / HTP 22.09 tok/s,
battery 0.20 / 0.43 / 0.14 C·s/token, CPU and HTP ranges overlap -> "NPU decode wins on S23" is PLAUSIBLE, not
CONFIRMED.

## Milestones (each: one coder, one hostile audit, one device check)

1. **De-risk: does in-app current separate backends on the S23?** Debuggable APK, `kalsa.bench.energy_trace`,
   `kalsa.bench.npu_lane`, `/bench route`; 3 turns each NPU-prefill, GPU-prefill, CPU-decode, unplugged, same
   prompt. Pass: current changes on >= 90 % of rows AND per-phase mean current differs between backends by > 3x idle
   std-dev. Fail: drop energy learning, rank on heat priors only.
2. **Profile cadence during generation**: push every 10 s during a completion; make `set_thermo_profile` safe off
   the decode thread. Pass: `KALSA_GOVERNOR` state changes within one push interval of battery crossing 39.5 C.
3. **Three-rung ladder**: MODERATE = prefer cooler backend, SEVERE = coolest only + no prewarm, CRITICAL unchanged;
   drop CPU fallback for LOWBAT prefill when an accelerator qualifies. Pass: same long prompt twice, no status 3 in
   the turn, tok/s within 20 %.
4. **Per-backend admission deltas** from heat tables (prior per SoC). Pass: 12 back-to-back NPU prefills, projected
   delta within +-50 % of measured skin rise per prefill.
5. **Thermal headroom probe** (app only): log `getThermalHeadroom(30)` at each push. Pass: finite, rises before
   status 3; if NaN drop it.
6. **Energy-per-token table + learning** (only if 1 passes). Pass: after 6 unplugged turns the learned NPU/CPU decode
   ratio agrees in sign with the heat table.
7. **Mid-turn NPU <-> CPU decode hop under one-copy**: needs raw DSP decode >= two-copy speed and platform-status
   merged onto the one-copy line. Pass: KLD unchanged, switch < 500 ms, no reload.
8. **Pace lever** for persistent SEVERE (AIMD `pace_us`, never zero throughput). Pass: forced SEVERE via bench
   thermo key, tokens = requested, battery slope <= 0.5 C/min.

## Owner decisions

a. Decode tok/s floor: 10, 15 or 20? (in-app S23 CPU decode was 10-12 in the smoke, half the CLI)
b. Rank by battery area, skin area, or joules once measured?
c. Exploratory turn frequency: 1 in 10 cool turns, or never on a user's phone?
d. One-copy needs no-mmap loading in the app: accept RAM/load-time cost before it is measured?
e. Merge order of the three engine lines.

## Hypotheses

H1 S23 in-app current is live at 1 Hz like the Jelly (milestone 1). H2 FAST-while-SEVERE is mostly cadence
(milestone 2). H3 a sustained NPU lane overheats (`q57`: +2.33 C/min, 41.4 C in 4 min on v73) so "GPU when NPU is
hot" will fire (12-prefill NPU block in-app). H4 S23 NPU decode heat advantage is real (n >= 5 ABBA tg256).
H5 `getThermalHeadroom` works on the S23 (milestone 5).

Sources: https://developer.android.com/reference/android/os/BatteryManager ·
https://developer.android.com/reference/android/os/PowerManager · https://developer.android.com/games/optimize/adpf/thermal
