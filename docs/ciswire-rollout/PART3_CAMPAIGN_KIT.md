# PART 3 — CisWire device campaign kit (S23 + Jelly, LFM2.5-2.6B-QAD-Q4_0)

Rev 1, 2026-08-25. Executes PLAN_CISWIRE_FOR_REAL.md Part 3. Code under test: the CisWire
rollout commit (S1–S4 sealed; see docs/ciswire-rollout/AUDIT_S{1,3,4}*.md). APK must come
from CI on that exact commit — jest green ≠ CI green.

## 0. Question the campaign answers

**Do the three CisWire legs earn default-on on real phones?** Per-flag attribution (the 2³
matrix) + all-on viability, measured with FORCED EVICTION (primary) and production length
(sanity). Decision gate at §5 → drives post-campaign step S6 (remove anchored / flip
defaults) ONLY on a pass.

## 1. Config discipline (every conversation)

Production config: `thinking: "default"` (never off — standing trap), model
`lfm2.5-2.6b-qad-q4_0`, locale Italian. Unplugged; battery ≥ 30 % floor; stop at ≥ 44 °C /
thermal status ≥ 3; timings INVALID while charging (segment wall-clock by charge state);
never uninstall either phone (models live in app data); S23 wireless adb — ask before
disconnecting. Verify before start: `result.json` notes say `thinking=default`; APK build =
campaign commit; `KALSA_TELEMETRY.predictedPerSecond` present with `tokensPredicted`.

## 2. Arms — the 2³ factorial

| arm | compaction | memory | toolhelp | what isolates |
|---|---|---|---|---|
| **A** | off | off | off | control (legacy window; web-search gate still active = today's behavior) |
| **B** | ✓ | – | – | digest alone |
| **C** | – | ✓ | – | organelle A alone |
| **D** | – | – | ✓ | toolhelp expansion (calendar structural gate + audit log) |
| E | ✓ | ✓ | – | compaction×memory |
| F | ✓ | – | ✓ | compaction×toolhelp |
| G | – | ✓ | ✓ | memory×toolhelp |
| **H** | ✓ | ✓ | ✓ | the candidate default |
| **A′** | anchored | – | – | continuity reference (today's shipped regime) |

Flag semantics reminder: toolhelp OFF still gates web search (pre-existing). The D-vs-A
delta measures ONLY the expansion: calendar structural gate + audit logging. Do not
attribute general tool precision to the flag.

## 3. Eviction modes (per arm, both run)

- **PRIMARY — forced eviction**: `kalsa.bench.winbudget=3000` (chars) so the derived window
  evicts from ~turn 6 and the digest corpus is non-empty from ~turn 8. 24-turn conversations
  (more evicted material for BM25 + more probe surface).
- **SECONDARY — production length**: default budget, 16 turns. Expected ≈ null difference;
  that null is itself the §7.35 correction, reported not buried.

**Positive controls (hard requirement, learned §7.35):** per conversation record
`digestChars` timeline (must be > 0 from turn 8 in forced mode) and a reuseFrac drop on the
first evicted turn. An arm failing its positive control is VOID, not zero-effect.

## 4. Conversation script (both modes)

Italian. Structure: 4 user-profile facts planted early (name, job, preference, constraint —
matches the extractor's USER-facts contract, fixing §3.3's wrong shape), filler coding-task
turns, **≥ 3 `probe_tool` turns spread across the conversation** (§3.1-era designs had n=1 —
unusable), fact-recall probes early AND late with exact give-away-token grading (no LLM
judge — five judge defects to date), plus one explicitly-requested search turn
("Cerca sul web …") — the gate must NOT block it (§1.1b regression check).

Seeds: ≥ 4/arm on S23 first (~17 tok/s mean, ~5–6.5 h total, 1–2 recharges);
Jelly runs the decisive subset **A / B / H, 3 seeds**, attended daytime sessions only
(~6–8 h + 3–4 recharge interventions; overnight unattended impossible). Arms interleaved
ABBA-style within each seed block to smear thermal drift; KV session restore between arms
(1.8 s) preferred over cold reloads; battery start-% normalized ±5 %; record repack/
load-policy activity once (first in-app exercise of §7.52's policy).

## 5. Metrics & decision gates

Per arm × mode: recall early/late + decay slope · blank/empty reply rate (§3.1 closure
check) · tool precision + spurious rate + **gate block-rate per tool from the new audit log**
(watch: `calendar-private-data` overblock — the "Rome" containment risk is expected to show
here) · explicitly-requested-search success (must stay 100 % on every arm) · prompt
tokens/turn · prefill ms · tok/s · MemAvailable/major faults · dnaInjected/dnaDeferred/
dnaBudgetTokens · battery %/arm · wall clock.

Gates:
1. H beats A on recall (forced-eviction mode) with blank-rate ≤ A and no RAM regression,
   **Holm-corrected across the factorial contrasts** → flip defaults ON (S6).
2. Memory leg extracts > 0 facts and moves recall → keep flag; else park with write-up.
3. Calendar gate block-rate > threshold-of-absurdity (> 20 % of legit agenda turns) →
   tighten containment before any default-on, regardless of recall wins.
4. Any surprise → HARNESS_FINDINGS.md in the same pass that produced it.

## 6. Harness work needed before launch (small coder task)

Extend the fase4 device harness: (a) `ciswireFlags` env → AsyncStorage keys mapping,
(b) forced-eviction winbudget arm support (key exists, matrix entry doesn't), (c) 24-turn +
probe_tool-density script variant, (d) result.json records arm + positive-control fields.
Everything else exists.

## 7. Runbook skeleton

```
S23 day 1:  arms A′ A B C × seeds (interleaved), charge at <30 %
S23 day 2:  arms D E F G H + forced-eviction repeats
Jelly day 3+: A B H × 3 seeds, attended, charge-segmented timing
After each day: pull result.json + KALSA_* logs, run benchAggregate, append to
HARNESS_FINDINGS §STATE — same pass, no batching.
```
