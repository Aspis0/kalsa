# S2 — resolved by construction (verdict recorded 2026-08-25)

Plan step S2 ("compaction leg wiring") required: contextModeRef derives from the user-facing
flag; `anchored` stays visible (owner decision 2026-08-25); no behavior change unless chosen.

Findings:
1. The consumption side pre-dates this rollout: `AppShell.tsx:4499` reads
   `parseContextMode(COMPACTION_ENABLED_KEY)` every send; `retrievalOn` (:4512),
   `legacyWindowMode` (:4515), boundary rebuild (:4569-4640), digest build (:4685-4760),
   `assembleEngineHistory(..., compactionEnabled: contextMode === "anchored")` (:4769)
   all branch on it already.
2. S1 delivered the production side: the CisWire panel's 3-way [Off|Standard|CisWire]
   control is the single writer of the raw values that parser consumes
   (AUDIT_S1.md RE-AUDIT: SEALED).
3. Therefore the compaction leg is fully wired end-to-end: Settings choice → storage →
   per-send parse → history assembly + digest. No code remained for S2.

Evidence chain: MAP_S1_S2_S5.md §1–§2 (consumers), AUDIT_S1.md + RE-AUDIT (SEALED),
jest suites `compactor.test.ts` (18) + `ciswireFlagsTelemetry.test.ts` (4) green,
`tsc --noEmit` exit 0 (verified by orchestrator, not delegated).

Residual risk carried forward to the device campaign: none known in the wiring;
the open question is behavioral (does ciswire beat anchored/off under forced eviction),
which is Part 3's job, not S2's.
