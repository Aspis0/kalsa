# PLAN — CisWire in Kalsa, for real (flags + on-device A/B) — rev 2

Rev 2, 2026-08-25: incorporates `docs/AUDIT_PLAN_CISWIRE.md`. Changes from rev 1 marked ⚡.
Owner decision this session: ship the port under three visible settings flags, then measure ON
PHONES with **LFM2.5-2.6B QAD-Q4_0** (shipping model per 2026-08-25 decision).

Sources of truth: `docs/HARNESS_FINDINGS.md` (living doc), `docs/KALSA.md` §6,
`~/Projects/ciswire` (README, src).

---

## Part 1 — What exists today (verified on disk 2026-08-25)

| Piece | State | Where |
|---|---|---|
| `v42` mode | **already deleted** (tombstone) | `src/context/compactor.ts:263` |
| Context modes | `off \| ciswire \| anchored`, resolver + digest + BM25 implemented | `src/context/compactor.ts:270`, `retriever.ts`, `windowProfile.ts` |
| Current default | `anchored` — unmeasured winner of a VACUOUS campaign (§7.35) | `AppShell.tsx:2394` |
| Choice key | `kalsa.context.compaction.choice` (+ master `COMPACTION_ENABLED_KEY`) | `compactor.ts:254` |
| Memory (organelle A) | `MemoryStore` facts (**undated strings**, opt-in key `kalsa.memory.enabled`), per-turn `extractMemory` job w/ KV checkpointing | `src/memory/MemoryStore.ts:39-40`, `AppShell.tsx:4218-4400` |
| Rules engine (CisWire tool half) | Ported AND live: literal `RuleTable` + `evaluateTurn`; FIXED inverted echo rule (thresholds 0.40/0.15, abstain semantics, §1.1b) + `echo-of-memory-fact` privacy rule. ⚠️ Wired into **web search ONLY** — calendar & future tools UNGATED | `src/rules/*`, `src/agent/webSearchTool.ts:91` |
| Retrieval ranking | char 3/4-gram BM25; hybrid leg OFF, do not ship (§1.6) | `src/context/retriever.ts` |

## Part 2 — The three flags

One Settings section **"CisWire"**. ⚡ Memory REUSES the existing `kalsa.memory.enabled`
store (no second key — audit found the collision risk); compaction reuses
`kalsa.context.compaction.choice`.

| Flag | Storage | Default | Controls |
|---|---|---|---|
| **CisWire Compaction** | `kalsa.context.compaction.choice` → `ciswire` | off (=legacy window) | Full window + BM25 digest of everything outside it |
| **CisWire Memory** | `kalsa.memory.enabled` (existing) | off | Organelle A: extraction → frozen operative-block re-injection every turn |
| **CisWire Tool Help** | `kalsa.ciswire.toolhelp` (new) | off | The deterministic when-then gate extended to EVERY tool call (calendar, miniapps) + non-block actions (warn / inject standing instruction) + audit log |

Rules:
1. ⚡ **OWNER DECISION 2026-08-25: `anchored` STAYS user-visible in Settings until the
   Part-3 campaign confirms ciswire wins on a real phone.** Only then is it removed
   (added as post-campaign step **S6: remove anchored + flip defaults**, executed only on
   a passing campaign). Until that day it remains a selectable choice — no bench-only
   demotion.
2. **Flag independence**: any combination legal — this IS the benchmark matrix. Verified:
   `extractMemory` reads only the live turn pair; memory does not depend on the digest.
3. ⚡ ~~"Off byte-identical to today"~~ — **false as stated**: today ships `anchored`; after
   S2 all-off = legacy `off`. Corrected requirement: each flag's OFF path is byte-identical
   to the same code with the flag absent, AND arm A′ (current shipped config, anchored) is
   carried through measurement as the continuity reference.
4. Telemetry: settled lines + `ciswireFlags` bitmask on every line.
5. ⚡ §3.1 blank-bubble blocker **reframed**: its counts predate the §1.1b fix that measured
   **0 blanks in 96 turns**; treat as "confirm closure at scale", not a live go/no-go.
6. Thinking never off in any arm (standing trap, STATE #1).

### Implementation steps
Each step: Paseo subagent (writer ≠ auditor model) → verify on disk → ONE hostile audit →
targeted jest → CI green.

- **S1 — Flag plumbing** (toolhelp key; choice-key mapping; resolver order bench > flag > default)
- **S2 — Compaction leg** (`contextModeRef` derives from flag; anchored KEPT visible per
  owner decision above)
- **S3 — Memory leg hardening**. ⚡ Two corrections: (a) the deferral code lives at
  `ciswire/src/index.ts:463-521` (`computeDnaDeferral`, `boundDnaAppendix`:523) — README's
  L364-429 is stale; (b) it operates on DATED `- [YYYY-MM-DD]` notes while Kalsa facts are
  undated strings → S3 must first add dates to `MemoryStore` writes (migration: existing
  facts stamped with their stored-at date), THEN port the bounding contract. Verify §3.3b
  instrument fixes are in the shipped path (quote lines).
- **S4 — Tool-help leg** ⚡ OWNER DECISIONS 2026-08-25: (a) calendar gets STRUCTURAL rules
  only (empty-range block + privacy containment) — text-echo similarity stays
  web-search-only until measured otherwise; (b) miniapp tool calls are EXEMPT from the
  gate (they are constrained by grammar in miniapp-v2, not judged by rules); (c) ship
  **block + warn** (warn = note prepended to the tool result) + audit log; `inject`
  standing-instruction DEFERRED until a campaign shows the need (mid-turn prompt rebuild
  would invalidate warm KV, §7.37).
  ARCHITECTURE REQUIREMENT (owner): per-tool rule REGISTRY — a map toolName → RuleTable
  (web_search → echo/privacy table; calendar_agenda → structural table; new tools register
  their own table) resolved at the universal `executeTool` chokepoint, so adding a gated
  tool tomorrow is one table entry, not new plumbing. Route calendar through it now.
  OUT of scope here: retrieval injection into tool rounds (not CisWire).
- **S5 — Telemetry bitmask + HARNESS_FINDINGS update in the same pass**

## Part 3 — On-device test (Jelly + S23, LFM2.5-2.6B-QAD-Q4_0) — ⚡ redesigned

⚡ **Rev-1 design was vacuous by its own source**: 16 production turns (~30 msgs / 7.6 k chars)
fit inside the derived window (40 msgs / 13.8 k chars) ⇒ nothing evicts ⇒ corpus empty ⇒
ciswire ≡ off. This is exactly §7.35's VACUOUS trap. Fixed by construction:

**Primary endpoint runs FORCED EVICTION** (the `32514162034` design): `winbudget` set low
enough that eviction begins by turn ~6 and the digest corpus is non-empty from turn ~8 on.
Positive control recorded per conversation (digestChars > 0 from turn 8; reuseFrac drop on
evicted turns). **Secondary endpoint**: production-length 16-turn conversations, reported as
sanity (expected ≈ null difference — that null is itself the §STATE correction).

Config discipline: production config, thinking default, unplugged, battery ≥ 30 %, stops at
≥ 44 °C / status ≥ 3, S23 wireless adb ask-first, never uninstall. Model = QAD-Q4_0 already
on the Jelly.

Arms: 2³ factorial {compaction, memory, toolhelp} × {forced-eviction, production-length}
plus A′ (anchored, continuity). ≥ 4 seeds/arm S23; Jelly reduced to the decisive subset
⚡ **A vs H (all-on) vs B (compaction-only), 3 seeds — attended daytime sessions, NOT
overnight**: ⚡ audit arithmetic stands — ~6-8 h wall plus 3-4 recharge interventions on the
Jelly, and timings are INVALID while charging (memory rule), so unattended overnights are
impossible. Recharge pauses segment the run; wall-clock metrics only within charge segments.
Battery start-% normalized ±5 %. Arms interleaved ABBA-style; KV session restore between arms
(1.8 s) preferred over cold reloads (120.8 s); record repack/load-policy activity once (§7.52
path exercised in-app for the first time).

Metrics: fact recall early/late (exact token) · decay slope · blank/empty replies (confirm
§3.1 closure) · tool precision + spurious rate — ⚡ conversations now carry ≥ 3 `probe_tool`
turns each so gate metrics reach usable n · prompt tokens/turn · prefill ms · tok/s ·
MemAvailable/major faults · digest chars + corpus size (positive control) · battery %/arm.
Premises note: S23/Jelly rate figures come from §7.41/§7.42 which ran production thinking —
verify `result.json` notes say `thinking=default` before trusting comparisons.

Decision gates:
- Forced-eviction H beats A on recall, blank rate ≤ A, no RAM regression → defaults ON.
- Memory extracts > 0 facts (dated-store) and recall moves → keep; else park with write-up.
- Every surprise goes into HARNESS_FINDINGS.md in the same pass. Report n per cell;
  ⚡ apply Holm correction across the factorial contrasts before any "significant".

## Part 4 — Post-campaign step S6 (only on a PASSING campaign)
Remove `anchored` from Settings/user paths (bench override survives), flip ciswire defaults
ON, update HARNESS_FINDINGS §STATE + KALSA.md in the same commit.
