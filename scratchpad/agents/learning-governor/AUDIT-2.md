# Hostile audit 2 of DESIGN.md v0.2 (2026-10-12)

Auditor: Paseo Reviewer (codex gpt-6-luna, xhigh), agent c7d5e9b4, read-only; HEADs engine f1f612388, binding
2581a9aa, app df359450. Condensed by the coordinator; verdicts and citations as reported.

## AUDIT-1 findings in v0.2

- Resolved on paper (REFUTED as open): #1 (enabled by `decode_speed_lookahead_s > 0`, DESIGN:44/370), #3 (separate
  `decode_speed_heat`, HEAT_RANK reads only `decode_heat_per_token_*`, policy-hop.cpp:48), #6 (row per completion;
  latch per completion rn-completion.cpp:807; JSI counters cumulative RNLlamaJSI.cpp:947 -> deltas needed), #8, #9
  (window counters, unimplemented), #10 (mean clamped at 0), #11 (zero = engine seed; parser needs all three leaves),
  #13, #14.
- #2 arithmetic blocker gone (forecast 0 abstains, zone fit decides), but safety PLAUSIBLE: the Xiaomi zone trips the
  fit test relies on are unmeasured (DESIGN:171).
- #4 CONFIRMED, partly fixed: the binding carries the last finite forecast up to 10 s (rn-governor.cpp:218,
  rn-platform-thermal.cpp:37-39); `armed()` checks finite, not age.
- #5 CONFIRMED: rank-1 design matrix (DESIGN:270); Xiaomi turns had zero GPU decode tokens (cell REPORT:26); four
  GPU completions do not identify a GPU coefficient.
- #7 PLAUSIBLE: mean + 2 SD with floor/cap, but the noise model is unspecified and a 4x cap of an "indicative"
  one-run seed is no bound on true heat.
- #12 PLAUSIBLE: Build.FINGERPRINT added; a thermal firmware change can leave it unchanged.

## Owner corrections

- Both sources, blind abstains: resolved on paper (zone headroom = passive trip - temp, rn-thermal-legs.cpp:112);
  Xiaomi trip values not validated.
- Real life (pauses, cooling, reloads, other apps) CONFIRMED unresolved: `wall_min` uses `predicted_ms`
  (DESIGN:242), which is token-generation time, not elapsed wall time (rn-slot.cpp:729); "No cooling term"
  (DESIGN:248).
- Breaker "off for the session" CONFIRMED unresolved across reloads: off until model load (DESIGN:208); policy state
  is rebuilt at load (llama-governor.cpp:40), so a reload re-arms the same bad model.
- Stage 0 from real use PLAUSIBLE: per-completion JSONL (DESIGN:336) cannot support the promised per-hop overshoot
  replay (DESIGN:341) without per-hop forecast/leg/zone samples.

## Safety

- Substituting GPU for NPU on the Xiaomi spends ~2.9x heat per token (3.2 vs 1.1).
- High: finite is not fresh (10 s carried forecast). High: battery temp and plugged refresh per completion
  (LlamaService.ts:5243) - plugging in or crossing WARM mid-completion leaves stale FAST/unplugged; status 2+ is
  debounced (rn-platform-thermal.cpp:74); status -1 = no vote and duty 1 (pacing-duty.cpp:50), absent status does
  not disarm.
- Blocker for the Xiaomi safety claim: the GPU passive trip must be >= 56.3 C (DESIGN:171, assumption); Stage 0 logs
  only last zone headroom, not contemporaneous zone temperatures or per-hop samples (DESIGN:334).
- High: the breaker sees forecast change only after h_now > 0 (DESIGN:205); no in-engine skin; its damage bound is
  not established under sensor delay, blindness, or reload.

## Arithmetic (recomputed)

- Cold Xiaomi: 3.2 x 21 / 1000 = 0.0672 C/s; 3.1 C in 46.1 s / 968 tokens (49.2 s at the measured 6.3 C/100 s).
  GPU/NPU +31 % vs the 16 tok/s seed, +36 % vs the cell's 15.46 mean.
- Current lines, seeded UCB (6.4 = 3.2 + 2 x 1.6): over 20 s 2.688 C + background 0.333 C + margin 0.5 C = 3.521 C
  required; max margin at current lines 0.053 x 30 = 1.59 C -> never.
- Proposed 0.15 start: seeded cutoff h <= 0.0326 (~37.3 C, not 37.5); learned example ~38.3 C (not 38.5). The
  learned UCB in the example is assumed, not derived. Re-entry adds 0.5 C.
- UCB floor/cap 1.6 / 12.8 C per 1k; lambda 0.95 -> 20 rows of weight, 13.5-row half-life; background prior
  0 +- 0.5 C/min -> UCB 1 C/min.

## Plan and code

- Stage 2 omits registering the new engine source and test in `src/CMakeLists.txt:36` and `tests/CMakeLists.txt:442`.
- Stage 3 line choice left open (DESIGN:394) and "no pacing change" in scope (DESIGN:75) conflicts with changing the
  lines. NOTE: the owner has since set the Xiaomi lines: pacing start skin 39.0 C, full 42.6 C (headroom 0.083 /
  0.203), PLAN 2026-10-12.
- New files under ~350 lines; Stage 0 JSONL is numeric (no model text, no user content) but is usage and device-health
  metadata kept locally.
