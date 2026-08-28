# PART 3 — CisWire device campaign kit — rev 5 (FULL FACTORIAL, exhaustive)

Date: 2026-08-26. Supersedes rev 4. Owner decisions folded in (Marco, 2026-08-26):
(1) reset flags clean; (2) optionally thinking min-vs-esteso later; (3) 8 arms × 6 conv × 24 turns;
(4) deterministic profile primary + Ornith LLM judge at the END; (5) save everything;
(6) **the harness must be REUSABLE for future tool/miniapp testing** — this is the framing change.

Code under test: commits `510157d`…`7c8cce7`. APK: `kalsa-apk-arm64-v8a-debuggable-7c8cce7…`.
Device: Jelly Star (adb `192.168.1.82:34037`, Android 13) — charging continuously, speed IGNORED.
Model: `lfm2.5-2.6b` QAD-Q4_0 (shipping). Thinking: ALWAYS ON (app default budget; extended is a
separate optional arm — §7).

---

## 0. Goal

Exhaustive A/B on real hardware: for EACH of the three CisWire legs, does **on** change behaviour vs
**off** — from "does it work" to "does it change the TYPE of response" — across the full 2³ space,
with a crash-proof data pipeline and a harness reusable for future feature/tool/miniapp campaigns.

## 1. Phase 0 — reset + smoke (needs: phone, ~30 min)

- Reset ALL three flags to OFF (`kalsa.context.compaction='off'`, `kalsa.memory.enabled='0'`,
  `kalsa.ciswire.toolhelp='0'`) — clears Marco's test-state. Baseline = R1.
- Confirm `kalsa.model.id='lfm2.5-2.6b'`, header `Pronto`, battery/thermals recorded.
- One conversation, arm R1 (all off), 6 turns: verify the collector captures turn-by-turn
  (KALSA_TELEMETRY/MEMORY/DIGEST), transcript append, response-profile extraction, and that
  `ciswireFlags=0` on every line (bitmask sanity). Calibrate the derived-window budget for the
  forced-eviction tests (winbudget ≈ ¼ of measured, used only in the eviction sub-arm).

## 2. Arms — FULL FACTORIAL 2³ = 8 (point 4)

Every combination, one arm each:

| arm | compaction | memory | toolhelp |
|---|---|---|---|
| R1 | off | off | off |
| R2 | on | off | off |
| R3 | off | on | off |
| R4 | off | off | on |
| R5 | on | on | off |
| R6 | on | off | on |
| R7 | off | on | on |
| R8 | on | on | on |

**6 conversations × 24 turns per arm** (point 3) = 48 conversations, ~1150 turns total.
Two variants per arm, split ~half/half, so BOTH regimes are measured (not one):
- **A — eviction regime**: `winbudget` low (from Phase 0) → digest corpus non-empty from turn ~8.
- **B — production regime**: default budget, no forced eviction (the real user path).

Because the phone charges continuously and speed is ignored, arms run back-to-back in any order;
there is no battery/thermal wall-clock constraint (§ old F2 is moot). Logical records are
charge-state independent.

## 3. What we collect — ALL information (point 1)

Per conversation, per turn (append-only, never in-device-only):

| Channel | What | Source |
|---|---|---|
| Telemetry | tokensCached/evaluated/predicted · promptMs · predictedPerSecond · interrupted · contextFull · **ciswireFlags** · tool · strategy | KALSA_TELEMETRY |
| Memory | factsExtracted/Stored/Rejected/Injected · dnaInjected/dnaDeferred/dnaBudgetTokens · extractParseOutcome/GateSource/StopReason | KALSA_MEMORY + KALSA_MEMORY_EXTRACT |
| Digest | corpusSize · selectedCount · durationMs | KALSA_DIGEST |
| Gate audit | per-tool block/warn decisions + ruleId (toolhelp ON arms only) | gateAuditLog |
| **Transcript** | full user + assistant text per turn | pull from storage / logcat (point 5: save ALL) |
| **Timing validity** | charnge/charge state stamped INVALID if charging | supervisor |

Bug NOTE (rev 5.1 fix): variant B is NOT 'no eviction' — the cadence-3 rebuild + 20-msg cap
still evicts in all arms by ~turn 11. winbudget only affects compaction-ON arms, so the
eviction vs production variants are asymmetric by construction. Label this honestly; never
claim variant B is eviction-free.

Bug NOTE (rev 5.1 fix): the calendar gate is structurally inert WITHOUT memory
(facts.length===0 → return false), so toolhelp's calendar axis must be reported per
TOOL × MEMORY-subset, not pooled across memory.

**Response PROFILE (deterministic — the "type of response" axis, point 1):** per assistant reply:
token count; sentence count; syllables; hedging markers (`potrebbe`,`non sono sicuro`,`credo`,`forse`);
**restated-fact echo** (does the reply contain a planted fact verbatim or near-verbatim?);
first-person-user reference count; **language drift** (reply language vs prompt language, a known
LFM2.5 failure mode); refusal / empty / apology markers; hallucination signal (unsupported numeric
claim rate); structural (bullet lists, headings); length ratio reply/user. All regex/deterministic.

**Tool usage:** tool called? which? result ok? spurious (echo-of-context block)? For web + calendar
turns. This is the "does toolhelp change behaviour" axis for arms R4/R6/R7/R8.

## 4. Recovery — nothing lost on crash (point 3)

- **Host-side datastore** (never trust device storage): every turn appended to
  `results/ciswire-campaign/<YYYY-MM-DD>/<arm>/<conv-id>.jsonl` on the Mac, pulled incrementally.
- **Continuous logcat capture** to host: streamed into a rolling file; it MUST capture crash
  stacks (logcat `-s ReactNativeJS` is blind to them) and survive logcat rotation during adb drops.
- **Per-turn HANG watchdog** (rev 5.1 fix — the audit's F3): pidof-alive is NOT enough. If a turn
exceeds the per-turn timeout (e.g. 20 min) or no KALSA_TELEMETRY lands for a long gap, treat as a
HANG: abort that turn, log it, and resume/skip cleanly — never let a stalled generation block a
2-4 h conversation invisibly.
- **Crash/device-drop watchdog** (supervisor, ~2 min): `adb get-state`, `pidof`, thermal status;
  on divergence reconnect via mDNS→connect, relaunch, reinstall `-r` over the SAME data if the app
  won't start (models in `files/models/` — never lost), pull RKStorage via `run-as` BEFORE any
  restart, and KV-session restore (1.8 s) to resume the SAME conversation vs cold-start.
- **Phase-aware resume**: on thermal stop (42-44 °C) cooldown then resume the SAME arm/conv/turn.
- **Force-stop before writing flags** (rev 5.1 fix) — flag-switch via sql_write needs the app
  stopped or the write races the app's own state.
- Timing fields stamped INVALID when charging (rev 5.1 fix).

## 4b. Flag-trap guard (rev 5.1 fix — critical)

NEVER write `'on'`/`'1'` for compaction — `parseContextMode` maps those to `anchored` (no-digest
boundary), not ciswire. The harness writes ONLY the literals `'off'`/`'anchored'`/`'ciswire'` for
compaction and `'0'`/`'1'` for the booleans. Telemetry guard: after each turn assert
ciswireFlags bit0 == the declared arm's compaction bit, and fail loudly if not — so a mistyped
config can NEVER silently run the wrong regime.

## 5. Thinking budget — optional secondary (point 2)

Main matrix runs at the app default budget (always-on). If time remains after Phase 1, add a small
**Phase-2 comparison**: arm R1 (all off) run with `extended` thinking vs `default`, ~4 conversations
each, to see if thinking budget alone shifts the response profile independent of CisWire. This is a
separate 2-arm mini-study, not part of the factorial; only if the main run finishes early.

## 6. LLM judge at the very END (point 4, Marco's Ornith)

Deterministic profile is the ground truth. As a FINAL, read-only pass ONLY after all data is
collected: an **Ornith (free, macOS)** agent reads the saved transcripts and scores response-TYPE
dimensions (hedging, fact-anchoring, drift, tone) against a rubric. This is corroboration only; the
deterministic profile decides. The doc's 5 judge-defect warnings apply — Ornith output is never the
headline, only checks the deterministic read on qualitative dimensions.

## 7. Reusability (point 6) — THE framing deliverable

The harness is built general, not CisWire-shaped. Everything is declared in ONE config file:
`campaigns/<name>.json`:

```json
{
  "name": "ciswire",
  "device": "192.168.1.82:34037",
  "model": "lfm2.5-2.6b",
  "arms": [
    {"id":"R1","flags":{"kalsa.context.compaction":"off","kalsa.memory.enabled":"0","kalsa.ciswire.toolhelp":"0"}},
    {"id":"R8","flags":{"kalsa.context.compaction":"ciswire","kalsa.memory.enabled":"1","kalsa.ciswire.toolhelp":"1"}}
  ],
  "turns": 24, "conversations": 6,
  "telemetry": ["KALSA_TELEMETRY","KALSA_MEMORY","KALSA_MEMORY_EXTRACT","KALSA_DIGEST"],
  "score": ["recall","tool","response_profile"]
}
```

A FUTURE tool/miniapp campaign = a new config file (different flags, telemetry prefixes, scorer).
The collector, supervisor, recovery, transcript store, and profile extractor are feature-agnostic.
Point 6 is therefore satisfied by the framework, not by this one test.

## 8. Gate / verdict

Report per arm × variant: recall (exact-token), tool precision + spurious rate + gate block-rate,
response-profile deltas vs R1 (the "type of response" comparison), memory facts/dna, digest health,
transcript samples. **Decide by inspection + deterministic deltas, not a single p-value** (the full
factorial trades significance for completeness — owner accepted this). Holm-corrected note where a
contrast is tested; where n is too small for significance, say so plainly (absence of evidence, no spin).

## 9. Harness build (delegated to Grok, after audit)

(a) generic config loader `campaigns/<name>.json`; (b) supervisor loop (collect → crash-detect →
recover → resume); (c) host datastore + logcat capture; (d) deterministic profile extractor
`scripts/device/responseProfile.mjs`; (e) RKStorage pull + KV restore helpers; (f) per-arm phase-aware resume.
Verify: typecheck + harness scripts green; dry-run the supervisor against a 3-turn conversation.
