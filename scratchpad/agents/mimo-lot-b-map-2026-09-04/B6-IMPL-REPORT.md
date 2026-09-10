# B6 implementation report

- Registry invariants now validate length, order, definition names, and duplicate names through a pure assertion called at module load and unit-tested with bad fixtures.
- Toggle keys are a closed union with exhaustive assembly; gate lookup now derives from `TOOL_ENTRIES.gateTable` while preserving the `web_search` expand-off rule.
- Contributor checklist covers names, entries, AppShell dispatch/guards, prewarm dependencies, Settings, i18n, and gate wiring.
- Added all eight assembly flag combinations plus ledger state/citation coverage; web toggle loading uses `parseToolToggle`.
- Report moved from the repo docs directory to this B6 map folder.

Validation:

- `npm run typecheck` — pass.
- `npx jest src/agent/toolRegistry.test.ts src/agent/toolSourceLedger.test.ts src/rules/toolGateRegistry.test.ts src/rules/runToolGate.test.ts --runInBand` — 4 suites, 18 tests passed.
- `node scripts/telemetryClampHarness.mjs` — 9/9; `node scripts/toolRoundExhaustedHarness.mjs` — 19/19; `node scripts/toolSourceLedgerHarness.mjs` — 28/28.
- `git diff --check` — pass.
