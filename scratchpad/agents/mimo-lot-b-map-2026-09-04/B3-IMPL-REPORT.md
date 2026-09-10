# B3 implementation report

## Files touched

- `src/rules/webFetchGate.ts` — added sensitive-pattern gates for `url` and `query`.
- `src/agent/toolRegistry.ts` — wired `WEB_FETCH_GATE_TABLE`; updated checklist comment.
- `src/rules/toolGateRegistry.ts` — keeps `web_search` and `web_fetch` privacy-gated with `expand=false`.
- `src/rules/runToolGate.ts` — snapshots explicit string-coerced web_fetch `url` and `query` fields.
- `src/rules/toolGateRegistry.test.ts` — verifies web_fetch resolution with expand on/off.
- `src/rules/runToolGate.test.ts` — covers sensitive URL/query blocking, clean pass, and expand-off blocking.
- `src/telemetry/pure.test.ts` — focused sanitizer, signal, and classifier coverage.

## Tests and checks

- `npx jest src/rules/toolGateRegistry.test.ts src/rules/runToolGate.test.ts src/telemetry/pure.test.ts --runInBand` — EXIT: 0 (3 suites, 38 tests).
- `npm run typecheck` — EXIT: 0.
- `git diff --check` — EXIT: 0.

## Skipped

- Full test suite, per task scope.
- Separate `webFetchGate.test.ts`; the new table is covered through the registry and `runToolGate` tests.
- Commit and push, per task scope.

## Fix pass F1–F5

- F1: `getToolGateEnabled` now honors `kalsa.bench.toolgate="0"` only in dev builds; release builds always keep privacy gates enabled, with dev/release tests.
- F2: `runToolGate` now fails closed with the privacy-blocked response if gate evaluation throws; a malformed-table test covers the path.
- F3: documented JSON-serializable model args and matching `String()` coercion for `web_fetch` URLs.
- F4: added the `expand=false` sensitive-IBAN-in-URL case.
- F5: URL rule priority is 26 and query rule priority is 25, with an explicit priority assertion.

Files: `src/bench/benchConfig.ts`, `src/bench/benchConfig.test.ts`, `src/rules/runToolGate.ts`, `src/rules/runToolGate.test.ts`, `src/rules/webFetchGate.ts`, `src/rules/toolGateRegistry.test.ts`.

Checks:

- `npx jest src/bench/benchConfig.test.ts src/rules/toolGateRegistry.test.ts src/rules/runToolGate.test.ts --runInBand` — EXIT: 0 (3 suites, 44 tests).
- `npm run typecheck` — EXIT: 0.
- `git diff --check` — EXIT: 0.
