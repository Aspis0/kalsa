# PART 3 — CisWire device campaign kit (S23 + Jelly, LFM2.5-2.6B-QAD-Q4_0)

Rev 3, 2026-08-25. Incorporates AUDIT_PART3_KIT.md findings F1–F12 and the REV2 re-audit's
six text-level corrections. Code under test: commits `510157d` + `be52606`. APK from CI.

## 0. Question

**Do the three CisWire legs earn default-on on real phones?** Primary inference = ⚡ main
effects (pooled), not pairwise contrasts. Viability of H (all-on) is measured descriptively.
Decision gates §7 drive S6. ⚡ SCOPE NOTE: this campaign tests the three LEGS; it does not
test `anchored` — the "remove anchored" half of S6 is licensed separately by rerun campaign
`32514162034` and cannot be executed off this campaign's results.

## 1. Config discipline (every conversation)

Production config, `thinking: "default"` (verify `result.json` notes say so), model
`lfm2.5-2.6b-qad-q4_0`, Italian, unplugged, battery ≥ 30 % floor, stops ≥ 44 °C / status ≥ 3,
timings invalid while charging, never uninstall, S23 wireless adb ask-first. APK from CI
(`apk.yml`, arm64-v8a, debuggable=true) on the campaign commit.

## 2. ⚡ Design — resolution-III fractional factorial (fixes F1, F4)

Pairwise H-vs-A at n=4 cannot pass Holm (p-floor 0.0286 > threshold 0.00714). The
pre-registered primary test is the three pooled **main-effect** tests, one per leg:

| arm | compaction | memory | toolhelp |
|---|---|---|---|
| R1 | – | – | – |
| R2 | ✓ | ✓ | – |
| R3 | ✓ | – | ✓ |
| R4 | – | ✓ | ✓ |

Each factor is ON in exactly 2 arms / OFF in 2 → balanced for main effects.

Seeds: **6 per arm** (48 conversations total across the 4 core arms; per factor: 24 ON-side
vs 24 OFF-side conversations, i.e. 12 vs 12 distinct seeds — the permutation pairs within
factor, not across all 48). ⚡ TEST VARIANT
(rev 3): the primary statistic is the **conversation-level 6-vs-6 exact permutation test on
per-conversation mean recall** per factor (exact p-floor 2/C(12,6) ≈ 0.00216), clearing Holm
0.05/3 = 0.0167. ⚡ POWER (honest, rev 4): exact simulation of this 6v6 permutation gives
**1.00 / 0.983 / 0.586** at δ = +0.635 with σ = 0.083 / 0.2 / 0.35 (generous per-seed
reading: 1.00 / 1.00 / 0.90). At σ ≥ 0.35 the campaign is UNDERPOWERED and the honest
possible outcome is "no significant result" — reported as absence of evidence, never spun.
σ is estimated during Phase 0 smoke; if σ̂ > 0.2, the pre-declared fallback statistic is
the m = 24-pair sign test (power 0.973 at σ = 0.35, conversations paired by session
position), promoted to primary BEFORE Phase 1 starts — never after seeing Phase-1 data.
⚡ ALIASING DISCLOSURE (honest version): this design has I = −ABC; main
effects are unbiased ONLY under additivity. One interaction is STRUCTURALLY real:
memory×toolhelp (calendar containment is inert without facts), so the toolhelp main effect
partly absorbs a memory-dependent component. Main-effect wins are claims about "leg ON
averaged over its two arms", never about the leg alone. Interactions are NOT evaluated in
Phase 1; if R4 diverges from its main-effect prediction, that is reported as an aliased
anomaly, not tested.

## 3. ⚡ Phases — smoke gates everything (fixes F5, F7)

- **Phase 0 — SMOKE (2 conversations, S23, not counted):** one R2 forced-eviction + one R4.
  Verifies: flags reach the app through the harness mapping; digestChars > 0 from the
  expected turn; dna* telemetry populated; audit log written; **calibrate winbudget**
  (measure the derived window's real char budget on this script, set winbudget ≈ ¼ of it);
  record the MemAvailable curve — first S23 exercise of §7.52's mmap=false load policy.
  ⚡ SMOKE ACCEPTANCE (all four required before Phase 1 counts):
  (i) `windowStartIndex`/promptTokens show the plateau expected from the calibrated budget;
  (ii) settled KALSA_MEMORY_EXTRACT lines carry non-default `extractParseOutcome` /
  `extractGateSource` / `extractStopReason`;
  (iii) `result.json` notes say `thinking=default`;
  (iv) `ciswireFlags` bitmask matches the arm definition on every telemetry line.
- **Phase 1 — FORCED EVICTION (primary):** winbudget from Phase 0, 24-turn conversations,
  6 conversations per arm × 4 arms.
- **Phase 2 — SANITY (production length):** default budget, 16 turns, 2 conversations per
  arm — expected null; reported as the §7.35 correction, minimal cost (fixes F6).

## 4. Conversation script (fixes F3)

Italian. 24 turns forced / 16 sanity: 4 user-profile facts planted early (USER-facts — the
extractor's contract), filler coding tasks, recall probes early+late with exact-token
grading, one explicitly-requested search turn (must succeed on every arm — §1.1b check),
⚡ ≥ 3 calendar-agenda turns per conversation, two deliberately overlapping a planted fact
(fact names a city, agenda asks about that city) — without these the containment rule is
inert (`facts.length === 0 → return false`). ⚡ Harness MUST expose an audit-log clear
between arms (cap 500 would blend arms); block-rate computed per-arm from entries tagged
with that arm.

## 5. Metrics

Per arm × phase: recall early/late + decay slope · blank/empty reply rate (§3.1 closure) ·
tool precision + spurious rate · calendar-gate block rate per arm from audit log ·
requested-search success (100 % required everywhere) · prompt tokens/turn · prefill ms ·
tok/s · MemAvailable/major faults · dnaInjected/dnaDeferred/dnaBudgetTokens · battery %/arm ·
charge-segmented wall clock. Instrument named for gate 2: extract outcome lives on the
settled-line fields `extractParseOutcome` / `extractGateSource` / `extractStopReason`
(§3.3b) — parseOutcome ≠ success is an INSTRUMENT failure first, subsystem failure second.

## 6. ⚡ Calendar containment acceptance (two-sided, fixing F3's inverted axis)

- **LEAK SIDE (must-block):** on fact-overlap agenda probes in memory-ON arms, containment
  MUST fire — acceptance: block-rate ≥ 50 % (~24 leak calls pooled); below 25 % the guard is
  dead and memory+toolhelp jointly fail gate 7.3.
- **OVERBLOCK SIDE (must-not-block):** legit agenda turns with NO fact overlap — block-rate
  ≤ 10 %, else containment is too greedy (the "Rome" risk).
- Rates computed WITHIN memory-ON arms only — pooling memory-OFF structural zeros is
  forbidden (zero by construction, not evidence).

## 7. Decision gates (pre-registered)

1. ⚡ Compaction main effect: conversation-level 6v6 exact permutation, p < 0.0167 (Holm,
   family of 3), recall direction positive, blank-rate non-inferior, no RAM regression →
   flip compaction ON. Memory and toolhelp likewise, independently.
2. Memory leg additionally requires extracted-facts > 0 with parseOutcome clean.
3. ⚡ Calendar containment: two-sided acceptance per §6 — leak-side failure or overblock
   breach → tighten containment BEFORE any default-on, regardless of wins.
4. Jelly results are ⚡ directional only (n=3 subsets cannot reach significance — p-floor
   0.10; they validate ratios, never decide defaults). Budget note: ~9 conversations ≈
   ~6.5 h attended on the §7.42-derived rate.
5. Any surprise → HARNESS_FINDINGS.md in the same pass.

## 8. ⚡ Honest budget (recomputed, fixes F2)

Forced-eviction conversations have NO state-cache hits and thinking=default tokens:
≈ 72 min/conversation on S23 (§2.1 battery slope ~1.5 pts/turn). Total: 24 Phase-1 + 2 smoke
+ 4 H-add-on forced + 8 Phase-2 sanity ≈ **38 conversations ≈ 46 h inference ≈ 21 battery
cycles ≈ 5–6 S23 sessions across 4–5 days**, recharge-segmented. Memory-leg arms' extraction
overhead is bounded at **+9 h worst case** (§3.3's +40 % on the 16 memory-arm forced calls)
— inside the session-count margin, not invisible. Jelly: directional subset R1/R2/R4 × 3 ≈
9 conversations ≈ ~6.5 h attended. If still too expensive, cut seeds to 5 before cutting
arms (main effects stay balanced).
⚡ ARM DEFINITION: the H-add-on is **R5 = all three legs ON** (compaction+memory+toolhelp),
4 conversations, descriptive comparison against R1 only.

## 9. ⚡ Run order + RECHARGE RULE (fixes B2)

ABBA interleaving at the SEED level: within each charging session, seed-pairs run as
…A-B-B-A…-style alternations of the 4 arms so arm×session-order stays unconfounded; session
index recorded with every conversation.
⚡ **One Phase-1 conversation per charge segment**: each burns ≈36 pts, so a conversation
STARTS only at ≥ 66 % battery and ends ≥ 30 % — a pair cannot fit above the floor, and the
old "2 × ~18 pts" arithmetic was wrong by 2×. Recharge happens BETWEEN conversations; the
seed-pair's shared app-session state SURVIVES via session/KV restore (1.8 s) — the pair's
second conversation restores instead of cold-starting, which IS the designed state-sharing
mechanism. Only unplugged time yields valid timings. ⚡ PSEUDO-REPLICATION PINNED: the unit
of analysis is the CONVERSATION; a "seed" = its 2-conversation pair sharing one app-session
state, declared in result.json so the permutation pairs correctly. Phase-2 sanity turns
(16 turns ≈ 24 pts) may run two per charge starting at ≥ 90 %.

## 10. Harness prerequisites (coder task before Phase 0)

(a) `ciswireFlags` env → AsyncStorage mapping; (b) winbudget arm support in the device
matrix; (c) 24-turn script variant with probe_tool AND calendar_agenda density +
planted-fact overlap; (d) result.json records arm, phase, positive-control fields;
(e) audit-log clear exposed to the harness; ⚡ (f) result.json carries the seed/pair
structure of §9.
