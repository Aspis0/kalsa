# Hostile audit 3 (re-audit of DESIGN.md v0.3), 2026-10-12

Auditor: same Paseo Reviewer agent as AUDIT-2 (codex gpt-6-luna, xhigh, c7d5e9b4), read-only. Condensed by the
coordinator; verdicts as reported. Verdict: **v0.3 is not ready to start Stage 0 as "observation only, no decision
change"** - its Stage 0 also moves the Xiaomi pacing lines, and Stage 0 cannot validate GPU overshoot.

## Critical / high

- CRITICAL: Stage 0 is not observation-only: DESIGN:339 "no decision change" vs DESIGN:341 moving the Xiaomi lines
  (declaredSevere.ts:8-9 38.1/41.7 -> 39.0/42.6 changes today's pacing). Owner-decided change, but a decision change:
  it must be its own step.
- HIGH: "absent status disarms" is defeated by the binding: rn-governor.cpp:204-214 carries the remembered status
  when the app sends -1 and native status is recent; rn-platform-thermal.cpp:60-64 ignores an absent read; no
  status-read timestamp in the engine (llama-ext.h:428-456).
- HIGH: battery WARM and plugged are not fresh mid-completion: the 120 s gate (DESIGN:94) vs one refresh per
  completion (LlamaService.ts:5242-5244); status escalation waits 5 s (rn-platform-thermal.h:21-23).
- HIGH (by design): the speed pass heats more than HEAT_RANK: GPU 2.91x per token, ~3.82x per second at 21 vs 16 tok/s.
- HIGH: the blind-path bound is not a skin bound: the engine sees forecast, not skin; GPU trips unmeasured; while the
  GPU is current the fit guard is 5 C (policy-hop.cpp:78-80) -> at an assumed 56.3 C trip the zone may reach 51.3 C;
  the 2048-token cap (~6.55 C at seed heat) resets per completion and tool rounds are separate completions.
- HIGH: breaker timing overstated and blind heat missed: it latches at the first h_now > 0 (DESIGN:193-200); for
  2x / 3x true heat the 0.5 C threshold takes ~9.9 / 4.25 s, not 7.5 / 3.7 s, before sampling delay.
- HIGH/PLAUSIBLE: arming inputs only partly at hop_decide: speed params, breaker and both age fields do not exist;
  `now_ms` reaches select_decode but not hop_decide (runtime.cpp:195-196, policy-hop.cpp:159) - easy to plumb.

## Freshness, arithmetic, learning

- Headroom `read_us` exists in the binding (rn-platform-thermal.h:50-54) but unchanged readings return before
  updating the engine profile (rn-governor.cpp:285-288): a 4 s age gate would stale a healthy constant forecast.
- UCB/forgetting arithmetic checks out (UCB 4.0, clamp 2.4-9.6, predicted rise 0.923 C, margin 1.423 C, 13.5-row
  half-life).
- REFUTED: the worst-case formula (DESIGN:157-159) double-counts 0.5 C; recomputed overshoots over the line for 2x /
  3x / 4x true heat: 0.004 / 0.676 / 1.348 C; at 3x duty ~0.878.
- Worked token arithmetic sound (968 + 333 = ~1301 tokens, +31 % vs 16 tok/s); but DESIGN:166-167 mixes two
  skin/headroom maps (fit h = 0.0327 x skin - 1.187 vs skin = 36.5 + 30h): 39 C -> h 0.0873 vs 0.083.
- "~20 rows" is a post-enable estimate (SE ~0.134 C/1k after 20 rows, single column); Stage 0 keeps today's decisions,
  so it collects no GPU rows.
- REFUTED: Stage 0 cannot replay GPU overshoot (DESIGN:348-350 substitutes NPU-to-pacing transitions).
- Wall-time and cooling fixes implementable, not present; cooling/background fit unvalidated, possibly collinear.
- Firmware change detection acknowledged, not resolved; GovernorBatteryModule.kt:93-100 has no Build.FINGERPRINT yet.

## Persistence, plan, privacy

- 6 h app breaker latch plausible, only proposed. CMake/vendor chain now named (src/CMakeLists.txt:37,
  tests/CMakeLists.txt:455-457). File sizes reasonable; keep the ring in its own file (rn-governor.cpp is 335 lines).
- Stage 0 JSONL: numeric, no model text or user content, still usage/device-health metadata in private storage;
  rotation unverified.

# Re-audit of v0.4, scoped to Stage 0 / 0b (same auditor), 2026-10-12

Verdict: **No - resolve the freshness fields, trip-data route, acceptance checks, probe contract and hook timing
before a coder starts Stage 0.**

1. HIGH: the hook awaits after the result (DESIGN:132); stop is checked afterwards (LlamaService.ts:5378); the stats
   call can wait up to 15 s (LlamaService.ts:1770); file I/O unbounded -> delays cancellation and the next tool round.
2. HIGH: Stage 0 windows carry only `headroom_age_ms` (DESIGN:58); no ages/stamps for status and app samples
   (DESIGN:124), which Stage 2's freshness gates (DESIGN:208-209) need.
3. HIGH: trip ranges have no route to JSI: `governorSamples()` returns only the ring (DESIGN:90); the thermal-leg
   pointer is private (rn-governor.h:87).
4. HIGH/PLAUSIBLE: one combined per-window sysfs snapshot not specified; `sample()` already reads each zone
   (rn-governor.cpp:191, rn-thermal-legs.cpp:102); a separate temps call would read them twice.
5. HIGH: `decode_us_*` exposed as ms (DESIGN:93) but `tok/us` compared to tok/s (DESIGN:158): x1000; "identical leg
   mix" checks only GPU = 0 (DESIGN:161), not CPU/NPU vs a named baseline.
6. HIGH: Stage 0b check `duty < 1` (DESIGN:173) is not forecast-specific (duty = min of headroom, battery, status,
   pacing-duty.cpp:75); `duty_last` is the previous step's realized duty (llama-ext.h:619).
7. MEDIUM: the battery sysfs probe (OPEN 4, DESIGN:268) has no function/fields/failure values/test, and
   `KALSA_GOVERNOR_PLATFORM` is status-only by contract (rn-governor.cpp:80).
8. MEDIUM: NaN window cells typed `number[][]` (DESIGN:98) -> JSON null; define nullable + replay handling; the hook
   names `governorThermoSnapshot` (DESIGN:134) but LlamaService.ts:5242 discards the snapshot; run_tests.sh needs an
   invocation, not only an executable check.
9. Sound: stage split; binding-only change needs no VERSIONS/skel change (VERSIONS:8 pins f1f612388). "No engine
   call" (DESIGN:325) is literally false (read-only getGovernorStats).
10. Sound: 0b arithmetic (0.0833 / 0.2033); JSONL excludes text/user content but includes turn/device/build ids and
    usage/thermal metadata; the new completion tag must be registered in the closed log-report schema.
