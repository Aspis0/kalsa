# B1-A′ Implementation Report

## Checklist

- [x] Extracted sensitive-pattern/Luhn detection into pure `containsSensitivePattern()`.
- [x] Added `sensitive-pattern-in-query` above echo rules under descending priority sort.
- [x] Removed sensitive rejection from `MemoryStore` writes and migration reads.
- [x] Removed `factsRejectedSensitive` from runtime telemetry, AppShell, grader, and aggregate output.
- [x] Removed the obsolete Settings notice and locale key; updated the memory note.
- [x] Added FN/FP envelope, egress, and discriminating MemoryStore acceptance tests.
- [x] No commit or push performed.

## Key diffs

```ts
const IBAN_PATTERN =
  /(?:^|[^A-Z0-9])[A-Z]{2}\s*\d{2}(?:\s*[A-Z0-9]){10,30}(?:$|[^A-Z0-9])/i;
const CF_PATTERN =
  /(?:^|[^A-Z0-9])[A-Z]{6}\s*\d{2}\s*[A-Z]\s*\d{2}\s*[A-Z]\s*\d{3}\s*[A-Z](?:$|[^A-Z0-9])/i;
```

```ts
{
  id: "sensitive-pattern-in-query",
  priority: 25,
  condition: (input) => containsSensitivePattern(asString(input.query)),
  action: { kind: "block", reason: "sensitive-pattern-in-query" },
}
```

```ts
const migrated = dedupeAndCap(current);
```

Sensitive `addFact` and `applyExtractResults` inputs now proceed through normal storage/capacity handling. Card scans normalize whitespace and Luhn-check every candidate run.

```ts
factsStored: t.factsStored,
factsRejectedFull: t.factsRejectedFull,
```

Settings now says: “Facts stay on this device; searches are blocked when they would carry private data.”

## Verification

- `npx jest --runInBand ...` — exit 0; 5 suites, 49 tests.
- `npx jest --runInBand` — exit 0; 30 suites, 272 tests.
- `npx tsc --noEmit > /tmp/kalsa-b1a-tsc.log 2>&1; echo $?` — `0`.
- `node scripts/memoryTelemetryHarness.mjs` — exit 0; all 8 harness checks passed.
- `git diff --check` and JS syntax checks — exit 0.

## Follow-up

`web_fetch` remains unregistered and ungated. A URL/query-content sensitive scan was not added because full `web_fetch` gating is explicitly out of scope for B1-A′.
