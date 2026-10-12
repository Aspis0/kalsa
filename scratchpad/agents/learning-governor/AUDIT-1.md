# Hostile audit 1 of DESIGN.md v0 (2026-10-12)

Auditor: Paseo Reviewer (codex gpt-6-luna, xhigh), agent 8f8952fc, read-only; HEADs engine f1f612388, binding
2581a9aa, app df359450 confirmed. Findings verbatim in substance, highest severity first. Coordinator-verified: #2
arithmetic (0.1344 + 0.03 > 0.053 at any h_now >= 0), #13 citation.

1. **Blocker - Stage 3 does not enable SPEED_FIT.** DESIGN.md:119 requires `weighting == SPEED_FIT`; Stage 3
   (DESIGN.md:298) changes only the lookahead. The Xiaomi row is `HEAT_RANK` (`rn-legs-table.cpp:91`) and the JSON
   parser rejects `"speed_fit"` (`rn-governor-params.cpp:85`). CONFIRMED.
2. **Blocker - the Xiaomi margin rejects the seeded GPU at every valid forecast.** 3.2 x 21 x 60 / 1000 / 30 =
   0.1344; with start 0.053 and margin 0.03 the limit is h_now <= -0.1114 (-0.1414 with the re-entry hysteresis);
   finite engine headroom is >= 0 (`llama-governor-policy.cpp:136`). CONFIRMED (also raised by the coordinator).
3. **High - learned heat changes HEAT_RANK outside SPEED_FIT.** Learned values override the row
   (`rn-governor-params.cpp:366`); HEAT_RANK sorts by them (`policy-hop.cpp:70`) and its no-fit fallback subtracts
   weight x heat (`policy-hop.cpp:206`). Example (weight 7, GPU load step 9, hysteresis 4): NPU headroom 0, GPU 17,
   neither fit -> scores NPU -19.6, GPU -14.4 -> GPU; with GPU heat 4 instead of 3.2 -> -20, NPU wins. A stale low
   estimate selects the hotter leg while SPEED_FIT is disarmed. CONFIRMED.
4. **High - the arming gate cannot enforce its exclusions.** Status 2 is debounced 5 s before the engine sees it
   (`rn-platform-thermal.cpp:84`); absent status is -1, which passes `<= 1` (`policy.cpp:51`); `duty_last` is a
   per-token statistic after pacing (`llama-governor-pacing.cpp:48`), not a hop_decide input; battery temp and
   plugged are pushed before completions (`LlamaService.ts:1785`), stale mid-generation. Planned tests omit
   battery-derived WARM/COOLMODE, absent status, plugged, NaN. CONFIRMED.
5. **High - real sessions do not identify GPU or CPU heat.** Mixed-leg turns are needed (DESIGN.md:105) but
   exploration is forbidden (DESIGN.md:149). Xiaomi in-app turns 1-6 are NPU-only (`xiaomi-g2-inapp-233486dd/raw/
   governor-pacing.csv:2-7`): the design matrix stays rank 1, GPU/CPU stay at their seeds. CONFIRMED.
6. **High - the heat observation does not match its token window.** `beginCompletion()` resets the latch per
   completion (`rn-completion.cpp:807`); the platform refresh runs per batch including prompt eval
   (`rn-governor.cpp:116`); `KALSA_GOVERNOR` is once per user turn with counters across rounds
   (`LlamaService.ts:1854`). The delta includes prompt heat; on tool turns start and tokens span different
   completions. CONFIRMED.
7. **High - "provably" safe is not proven.** A point heat estimate without an uncertainty bound (DESIGN.md:128);
   the Xiaomi GPU prior is one run, started 2.4 C warmer, "indicative" (`xiaomi-endur-npu-gpu-75/REPORT.md:49-50`);
   n0 = 4 shrinkage is not an upper bound. CONFIRMED.
8. **Medium - the proposed replay of existing logs cannot recover per-turn heat**: no turn start or headroom-first;
   Xiaomi completion rows 14m42s apart; side sampler has no turn markers. CONFIRMED.
9. **Medium - Stage 3's "GPU windows only while headroom_first <= 0" is not observable**: headroom_first is per
   completion; the hop log records zone headroom only on a leg change (`policy-hop.cpp:292`). Needs per-window
   forecast/margin evidence. CONFIRMED.
10. **Medium - unconstrained ridge can fit a negative heat**, which the binding rejects
    (`rn-governor-params.cpp:160`); no clamp/projection specified. PLAUSIBLE.
11. **Medium - the app-side seed vector is missing**: the parser needs all three leaves
    (`rn-governor-params.cpp:131`); the app has no heat row to fill legs with n < 4. PLAUSIBLE.
12. **Medium - the fingerprint misses OTA/thermal firmware changes** (no OS build fingerprint). PLAUSIBLE.
13. **Low - wrong citation**: `(skin - 12)/30` is from `declaredSevere.ts:36`, not `policy.cpp:22-25`. CONFIRMED.
14. **Low - test placement**: `governorInputs.test.ts` is already 1,001 lines; put learned-override tests in a
    focused file. PLAUSIBLE.

Held: both rows are skin C per 1k tokens (cell 76:51, ALIVE:101), the engine's battery-unit comment is stale; the
speed seeds sit inside recorded ranges (not bounds); the plan includes vendoring, skel rebuild, pin, provenance.
