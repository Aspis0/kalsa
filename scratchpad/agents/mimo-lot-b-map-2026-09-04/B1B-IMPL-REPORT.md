# B1-B Implementation Report

## Checklist

- [x] Moved the memory switch into the Memory panel and changed its label/a11y copy to `memory.enabled`.
- [x] Rewrote the CisWire hint for compaction/tool help only and removed unused `settings.ciswireMemory` and `memory.disabled` keys.
- [x] Added localized cap guidance with fact-count interpolation and toggle-gated reply/truncation guidance using shared prompt caps.
- [x] Kept the 200-character store input limit and 120-character injection behavior unchanged.
- [x] Surfaced a localized full-memory notice for manual adds at the exported `MAX_FACTS` limit.
- [x] Softened the local extractor copy so clearly volunteered personal details may be stored locally; credential extraction remains excluded.
- [x] Added a ref-based add busy guard, full-capacity Add disablement, live-region feedback, warning styling, delete notice clearing, and foreground refresh.
- [x] No edit-fact UI, drawer entry/export, engine cap, DNA bounding, or sensitive filter changes.
- [x] Declared the intentional `MemoryStore.ts` deviation: the capacity error/export are required to prevent silent manual overflow/eviction and surface the locked full-memory UX.
- [x] No commit or push performed.

## Key UI/i18n lines

```tsx
{t("memory.enabled")}
accessibilityLabel={t("memory.enabled")}

{t("memory.capHint", { count, max })}
{memoryEnabled ? t("memory.capReplyHint", { perReply, chars }) : null}
{memoryEnabled ? t("memory.truncNote", { chars }) : null}
```

```ts
capHint:
  "{count} / {max} facts saved",
capReplyHint: "Up to {perReply} used per reply ({chars} chars each)",
truncNote: "Facts over {chars} chars are shortened in replies.",
full: "Memory is full ({count} facts). Delete a fact before adding another.",
```

## Verification

- `npm run typecheck` — exit 0.
- `npx jest src/memory/MemoryStore.test.ts src/engine/memoryPrompt.test.ts --runInBand` — exit 0; 2 suites, 9 tests, including B1-B capacity and both-locale interpolation tests. The existing A′ tests are not counted as B1-B coverage.
- `git diff --check` — exit 0.
