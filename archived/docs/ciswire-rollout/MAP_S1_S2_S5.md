# CisWire Rollout — S1/S2/S5 Reconnaissance Map

**Rev 2, generated from disk 2026-08-25.** All `file:line` pointers verified.

---

## 1. compactor.ts — Full Public Surface

| file:line | symbol | role | note-for-coder |
|---|---|---|---|
| `src/context/compactor.ts:270` | `ContextMode` | Type alias `"off" \| "ciswire" \| "anchored"` | S2 adds/renames; `"anchored"` is the target of demotion |
| `src/context/compactor.ts:280` | `parseContextMode(raw)` | Regime from raw AsyncStorage string | `"0"/"false"/"off"` → off; `"ciswire"` → ciswire; **everything else** → anchored (incl. null, garbage, "1", "true") |
| `src/context/compactor.ts:288` | `modeUsesBoundary(mode)` | True only for `"anchored"` | Gates the boundary→end window path |
| `src/context/compactor.ts:291` | `modeUsesDigest(mode)` | True only for `"ciswire"` | Gates BM25 digest + rolling summary |
| `src/context/compactor.ts:247` | `COMPACTION_ENABLED_KEY` | `"kalsa.context.compaction"` — legacy boolean toggle key | Still read; `"0"` = off, `"1"` = on |
| `src/context/compactor.ts:254` | `COMPACTION_CHOICE_KEY` | `"kalsa.context.compaction.choice"` — explicit choice marker | `"1"` means user (or CI) explicitly chose; absent = fallback to default |
| `src/context/compactor.ts:243` | `COMPACTION_ENABLED_DEFAULT` | Resides at `src/engine/ttftFlags.ts:65`, value `true` | AppShell.tsx:182 imports it; only fires when raw key is absent/garbage |
| `src/context/compactor.ts:311` | `legacyWindowStartIndex(...)` | Start index for legacy sliding window; accepts optional bench `override` | Both assembly and ciswire corpus boundary derive from this single value |
| `src/context/compactor.ts:330` | `COMPACTION_*` storage key constants | `compactorStorageKey(chatId)` → `"kalsa.chat.compactor.{id}"`; `summaryStorageKey(chatId)` → `"kalsa.chat.summary.{id}"` | Per-chat compactor state; summary key shared with ciswire only |
| `src/context/compactor.ts:102` | `parseBenchWindowBudget(raw)` | Bench-only char-budget override; below floor (500) → null | Feeds `getBenchWindowBudget()` in benchConfig.ts:418 |
| `src/context/compactor.ts:122` | `parseBenchLegacyWindow(raw)` | Bench-only legacy-window override; below floor (4) → null | Feeds `getBenchLegacyWindow()` in benchConfig.ts:433 |
| `src/context/compactor.ts:142` | `parseBenchDigestCadence(raw)` | Bench-only operative-block cadence; below 1 → null | Feeds `getBenchDigestCadence()` in benchConfig.ts:448 |
| `src/context/compactor.ts:172` | `parseBenchRanking(raw)` | Bench-only `"bm25"/"hybrid"` override | Feeds `getBenchRanking()` in benchConfig.ts:462 |
| `src/context/compactor.ts:400` | `shouldRebuild(...)` | Cadence (K turns) + size trigger for legacy/ciswire boundary | NOT used by anchored |
| `src/context/compactor.ts:526` | `shouldRebuildAnchored(...)` | Pressure-only rebuild predicate for anchored | No cadence; uses `anchoredWindowExceedsBudget` |
| `src/context/compactor.ts:485` | `computeAnchoredBoundary(...)` | Picks widest anchored suffix at 62.5% of budget | `ANCHORED_REBUILD_TARGET_SHARE = 0.625` |
| `src/context/compactor.ts:625` | `assembleEngineHistory(...)` | Core history-slicer; `compactionEnabled` bool selects boundary vs legacy window | `compactionEnabled: contextMode === "anchored"` is the only call from AppShell |
| `src/context/compactor.ts:845` | `advanceAnchoredBoundary(...)` | Rebuild for anchored; clears digest + summary | State always resets both operative fields |
| `src/context/compactor.ts:820` | `advanceCompactionBoundary(...)` | Rebuild for ciswire; preserves summary, advances boundary | Cadence-driven, not pressure-driven |

**Resolution order for regime** (S1 flag plumbing):

```
Raw from AsyncStorage (COMPACTION_ENABLED_KEY)
  → parseContextMode(raw)
    → "0"/"false"/"off"     → off
    → "ciswire"              → ciswire
    → anything else          → anchored  (← this is the default path)
```

**Resolution order for boolean ON/OFF** (separate concern, lives in ttftFlags.ts):

```
Raw from AsyncStorage (COMPACTION_ENABLED_KEY)
  → parseCompactionEnabled(raw, choice === "1")
    → "0"/"false"   → false (OFF)
    → "1"/"true"    → true  (ON)
    → absent/garbage → COMPACTION_ENABLED_DEFAULT (true)
```

---

## 2. Consumers: contextMode / windowStartIndex / Digest Assembly

### AppShell.tsx — Send-path (~4496–4840)

| file:line | symbol / action | role | note-for-coder |
|---|---|---|---|
| `src/app/AppShell.tsx:182` | `COMPACTION_ENABLED_DEFAULT` import | Default boolean | From `ttftFlags.ts:65` |
| `src/app/AppShell.tsx:235` | `COMPACTION_CHOICE_KEY`, `COMPACTION_ENABLED_KEY` imports | Storage keys | |
| `src/app/AppShell.tsx:243` | `parseContextMode` import | Regime parser | |
| `src/app/AppShell.tsx:2394` | `contextModeRef = useRef<ContextMode>("anchored")` | **Hardcoded default** | Comment says "default anchored (boolean ON)" |
| `src/app/AppShell.tsx:2396` | `compactionEnabledRef = useRef(COMPACTION_ENABLED_DEFAULT)` | Boolean mirror | |
| `src/app/AppShell.tsx:4496-4499` | `AsyncStorage.getItem(COMPACTION_ENABLED_KEY)` + `parseContextMode(raw)` | Per-send regime read | Two parallel gets; catch → falls back to `"anchored"` |
| `src/app/AppShell.tsx:4505-4506` | catch block: `contextModeRef.current = "anchored"` | Fallback | Comment: "default ON" |
| `src/app/AppShell.tsx:4509` | `const contextMode = contextModeRef.current` | Local binding for this send | |
| `src/app/AppShell.tsx:4512` | `retrievalOn = contextMode === "ciswire"` | Digest/summary gate | |
| `src/app/AppShell.tsx:4513` | `anchoredOn = contextMode === "anchored"` | Boundary-only gate | |
| `src/app/AppShell.tsx:4515` | `legacyWindowMode = contextMode === "off" \|\| contextMode === "ciswire"` | Legacy sliding window | Both off and ciswire use the legacy window; anchored does not |
| `src/app/AppShell.tsx:4569-4640` | `if (retrievalOn \|\| anchoredOn)` block | Compactor state load + boundary rebuild | Reads per-chat state; anchoredOn clears digest/summary; shouldRebuildAnchored vs shouldRebuild |
| `src/app/AppShell.tsx:4540-4558` | `windowProfile` resolution | Profile from engine nCtx or bench override | `getBenchWindowBudget()` can override |
| `src/app/AppShell.tsx:4558-4568` | `legacyWindowStart` | Derived once, shared by assembly + corpus | `windowStartIndex(historyLengths, ..., perMessageCap)` |
| `src/app/AppShell.tsx:4685-4760` | CisWire digest path | `refreshQueryDigest`, `syncDigestIndex`, `formatDigestLine` emit | Ranking override from `getBenchRanking()` |
| `src/app/AppShell.tsx:4769` | `assembleEngineHistory(...)` | History slicer | `compactionEnabled: contextMode === "anchored"` — only `"anchored"` passes true |
| `src/app/AppShell.tsx:4880` | `contextMode === "anchored"` check | context_full → force rebuild flag | Only anchored forces rebuild on context_full error |

**Key architecture note**: `legacyWindowStart` is computed ONCE and handed to both `assembleEngineHistory` (via `legacyWindowStart`) and the ciswire corpus boundary (via `corpusBoundary`). If these ever diverge, messages could land in both or neither.

---

## 3. SettingsScreen.tsx — Compaction Toggle + Choice UI

| file:line | symbol / action | role | note-for-coder |
|---|---|---|---|
| `src/screens/SettingsScreen.tsx:68` | `COMPACTION_CHOICE_KEY` import | From compactor.ts | |
| `src/screens/SettingsScreen.tsx:69` | `COMPACTION_ENABLED_KEY` import | From compactor.ts | |
| `src/screens/SettingsScreen.tsx:72` | `COMPACTION_ENABLED_DEFAULT` import | From ttftFlags.ts | |
| `src/screens/SettingsScreen.tsx:203` | `useState(COMPACTION_ENABLED_DEFAULT)` | Toggle state | No `parseContextMode` — settings only cares about ON/OFF boolean |
| `src/screens/SettingsScreen.tsx:377-382` | `useEffect` read: `AsyncStorage.getItem(COMPACTION_ENABLED_KEY)` + `COMPACTION_CHOICE_KEY` → `parseCompactionEnabled(raw, choice === "1")` | Initial load | Same two-key read as AppShell |
| `src/screens/SettingsScreen.tsx:423-438` | `handleToggleCompaction` callback | Toggle handler | Writes `COMPACTION_ENABLED_KEY` ("1"/"0") + `COMPACTION_CHOICE_KEY` ("1") via `multiSet` |
| `src/screens/SettingsScreen.tsx:430-431` | `AsyncStorage.multiSet([[COMPACTION_ENABLED_KEY, next ? "1" : "0"], [COMPACTION_CHOICE_KEY, "1"]])` | **The write** | Always sets choice to "1" on toggle; never writes choice "0" |
| `src/screens/SettingsScreen.tsx:1108` | `{t("settings.contextCompactionHint")}` | i18n label | Section header hint |
| `src/screens/SettingsScreen.tsx:1120` | `{t("settings.contextCompaction")}` | i18n label | Toggle label |
| `src/screens/SettingsScreen.tsx:1123` | `value={compactionEnabled}` | Switch binding | |
| `src/screens/SettingsScreen.tsx:1127` | `accessibilityLabel={t("settings.contextCompaction")}` | A11y | |

**Current UI**: Single `Switch` in a `GlassPanel2` titled `"settings.context"` / `"settings.contextCompaction"`. No radio/choice selector — only ON/OFF.

### i18n Pattern (en.ts / it.ts)

| file:line | key pattern | convention |
|---|---|---|
| `src/i18n/en.ts:89` | `settings.context` | Section header (title for the GlassPanel) |
| `src/i18n/en.ts:90` | `settings.contextCompaction` | Toggle label (short, action-oriented) |
| `src/i18n/en.ts:91` | `settings.contextCompactionHint` | Grey hint text below section header |

House style for a new "CisWire" section:
- Section title: `settings.ciswire` → `"CisWire"`
- Toggle labels: `settings.ciswireMemory`, `settings.ciswireToolHelp`
- Hint text: `settings.ciswireHint` (grey, below header)
- Place BELOW the existing `context` panel in the ScrollView
- Same `GlassPanel2 opaque rounded="lg"` wrapper

**Note**: `settings.telemetry` (line 123) already exists as a separate section below privacy — same structural pattern.

---

## 4. Telemetry — All KALSA_* Emission Sites

### KALSA_TELEMETRY (turn-end)

| file:line | symbol | fields | emit pattern |
|---|---|---|---|
| `src/engine/LlamaService.ts:832-870` | `emitTurnTelemetry(...)` | `roundTelemetryFromResult` → `turnId, round, tokensCached, tokensEvaluated, tokensPredicted, draftTokens, draftAccepted, promptMs, predictedMs, predictedPerSecond, contextFull, interrupted` + optional `tool, strategy` | Emitted per completion round (may be multiple per turn: tool-call round + synthesis round). **Not** reset-and-emitted at turn end — emitted inline at each completion. |
| `src/engine/turnTelemetry.ts:187-189` | `formatTelemetryLine(turnId, r)` | Returns `KALSA_TELEMETRY ${JSON.stringify({ turnId, ...r })}` | Machine-parseable line |
| `src/engine/turnTelemetry.ts:105-185` | `RoundTelemetry` type | All fields listed above; optional `tool?`, `strategy?` | `tool`/`strategy` are omitted (not null) when no successful tool ran yet |

**Event-order contract**: `tool`/`strategy` reflect the last SUCCESSFUL tool before this completion. First tool-call round has no fields. Failed tools do not overwrite prior success.

### KALSA_MEMORY (turn-end, reset-and-emitted)

| file:line | symbol | fields | emit pattern |
|---|---|---|---|
| `src/app/AppShell.tsx:4864-4868` | `onDone` handler | Calls `MemoryStore.getAndResetMemoryTelemetry()` → emits with `formatMemoryLine(memTelemetry)` | **Reset-and-emitted at turn end** (after `onDone`). Extraction fields are ALL set to `-1` (NOT_APPLICABLE) because the extract job hasn't settled yet. |
| `src/memory/memoryTelemetry.ts:47` | `formatMemoryLine(t, prefix)` | Default prefix `"KALSA_MEMORY"` | Fields: `memoryEnabled, factsExtracted, factsStored, factsRejectedSensitive, factsRejectedFull, factsInjected, totalFactsInStore, extractParseOutcome, extractGateSource, extractStopReason` |

### KALSA_MEMORY_EXTRACT (extract-settled, independent timing)

| file:line | symbol | fields | emit pattern |
|---|---|---|---|
| `src/app/AppShell.tsx:4244-4248` | `emitSettledMemoryTelemetry(...)` | Same fields as KALSA_MEMORY but prefix `"KALSA_MEMORY_EXTRACT"` | Emitted when the extract job completes (may be delayed). `factsInjected` set to `-1` (belongs to the turn, not extraction). |
| `src/app/AppShell.tsx:4233-4238` | Early-exit path (aborted/failed/empty) | Emits immediately with lifecycle codes, all extraction fields `-1` | Stop-reason code `4` = early exit |

### KALSA_DIGEST (per-turn, from digest build)

| file:line | symbol | fields | emit pattern |
|---|---|---|---|
| `src/app/AppShell.tsx:4698` | `console.log(formatDigestLine(t))` inside `refreshQueryDigest` → `onTelemetry` callback | `durationMs, corpusSize, selectedCount` | Emitted every turn the ciswire digest path runs (not anchored, not off) |
| `src/engine/digestTelemetry.ts:31` | `formatDigestLine(t)` | Returns `KALSA_DIGEST ${JSON.stringify({...})}` | Machine-parseable |

**Where `ciswireFlags` bitmask field would be added**:
- `KALSA_TELEMETRY`: add `ciswireFlags` to `RoundTelemetry` in `turnTelemetry.ts:105` and emit in `formatTelemetryLine` at line 189
- `KALSA_MEMORY`: add `ciswireFlags` to `MemoryTelemetry` in `memoryTelemetry.ts:40` and emit in `formatMemoryLine` at line 47
- `KALSA_MEMORY_EXTRACT`: same type, emitted via `formatMemoryLine` with prefix at `AppShell.tsx:4248`
- `KALSA_DIGEST`: add `ciswireFlags` to `DigestTelemetry` in `digestTelemetry.ts:24` and emit in `formatDigestLine` at line 31
- All four sites use the same `MemoryTelemetry` / `DigestTelemetry` / `RoundTelemetry` type, so the bitmask can be added once per type and flows to all emit sites automatically.

---

## 5. Bench Override Entry Points (Resolution Order)

Bench overrides **always outrank** production values. The resolution chain:

```
bench key present & valid → bench value wins
bench key absent/invalid  → production constant wins
```

| benchConfig.ts line | bench key | production constant it overrides | parser |
|---|---|---|---|
| benchConfig.ts:49 | `kalsa.bench.thinking` | ThinkingMode default `"default"` | Direct parse |
| benchConfig.ts:50 | `kalsa.bench.format` | BlockFormat default `"none"` | Direct parse |
| benchConfig.ts:55 | `kalsa.bench.nctx` | Catalog `n_ctx` | `parseBenchNCtx` (contextProfile.ts) |
| benchConfig.ts:56 | `kalsa.bench.winbudget` | `WINDOW_CHAR_BUDGET` (16000) | `parseBenchWindowBudget` (compactor.ts:102) |
| benchConfig.ts:57 | `kalsa.bench.legacywindow` | `LEGACY_MAX_HISTORY` (20) / `_IMAGES` (8) | `parseBenchLegacyWindow` (compactor.ts:122) |
| benchConfig.ts:58 | `kalsa.bench.ranking` | `"bm25"` | `parseBenchRanking` (compactor.ts:172) |
| benchConfig.ts:59 | `kalsa.bench.digestcadence` | inject every turn (cadence=1) | `parseBenchDigestCadence` (compactor.ts:142) |
| benchConfig.ts:61 | `kalsa.bench.norepack` | per-model loadPolicy | `parseBenchNoRepack` (benchConfig.ts:475) |

**For the new ciswireFlags flag**: bench override must use `kalsa.bench.ciswireflags` (or similar) and be read AFTER the production flag, following the same pattern: absent → production flag wins. The `ci-bench.sh` script (`scripts/ci-bench.sh:260-285`) writes bench prefs via `sql_write` into `catalystLocalStorage` — the new bench key needs a corresponding `sql_write` line there and in `bench.yml` matrix env vars.

---

## 6. All Call Sites of `parseContextMode` and `COMPACTION_ENABLED_DEFAULT`

### parseContextMode

| file:line | caller | context |
|---|---|---|
| `src/app/AppShell.tsx:4499` | `contextModeRef.current = parseContextMode(raw)` | Per-send read from AsyncStorage |
| `src/context/compactor.test.ts:16` | Imported | Test suite |
| `src/context/compactor.test.ts:33-54` | Test cases | Covers all inputs: null, "", "0", "false", "off", "1", "true", "yes", "compact", "ciswire", "anchored" |

**Only one production call site** (AppShell.tsx:4499).

### COMPACTION_ENABLED_DEFAULT

| file:line | caller | context |
|---|---|---|
| `src/engine/ttftFlags.ts:65` | Definition: `true` | |
| `src/app/AppShell.tsx:182` | Import | Used at line 2396 (`useRef`) and line 4506 (catch fallback) |
| `src/screens/SettingsScreen.tsx:72` | Import | Used at line 203 (`useState`) and implicitly via `parseCompactionEnabled` |

### parseCompactionEnabled (the boolean ON/OFF parser)

| file:line | caller | context |
|---|---|---|
| `src/engine/ttftFlags.ts:70` | Definition | Takes raw value + optional `hasExplicitChoice` (unused) |
| `src/app/AppShell.tsx:4501` | `compactionEnabledRef.current = parseCompactionEnabled(raw, choice === "1")` | Per-send |
| `src/screens/SettingsScreen.tsx:382` | `setCompactionEnabled(parseCompactionEnabled(raw, choice === "1"))` | Settings initial load |

---

## 7. Blast Radius — What Breaks If `anchored` Is Removed from User Paths

### Tests

| file:line | impact |
|---|---|
| `src/context/compactor.test.ts:40-46` | Tests that `parseContextMode(null)`, `parseContextMode("")`, `parseContextMode("1")`, `parseContextMode("true")` all return `"anchored"` — **will break if default changes to `"off"` or `"ciswire"`** |
| `src/context/compactor.test.ts:53-54` | Test that `parseContextMode("anchored")` returns `"anchored"` — **will break if `"anchored"` is removed from `ContextMode`** |
| `src/context/compactor.test.ts:126-132` | Tests `assembleEngineHistory` with `compactionEnabled: true` (anchored path) — **will break** |
| `src/context/compactor.test.ts:179+` | Entire `"anchored no-digest window"` describe block — **will break** |
| `src/engine/modelEmittedText.test.ts:210,224` | Uses `compactionEnabled: false` — **safe** (off path) |

### Bench Scripts

| file:line | impact |
|---|---|
| `scripts/benchGradeHarness.mjs:42-47` | Hardcoded `arm: "anchored"`, `compaction: "anchored"`, `compactionPrefRaw: "anchored"` — **will break if anchored arm is removed from matrix** |
| `scripts/benchGradeHarness.mjs:1169-1224` | `compactionActive` validation tests reference `"anchored"` as valid mode string — **will break** |
| `scripts/benchAggregate.mjs:49-65` | `FASE4_ARMS = ["baseline", "anchored", "ciswire"]`, pairwise comparisons `anchored_vs_off`, `ciswire_vs_anchored` — **will break** |
| `scripts/benchAggregate.mjs:466-584` | `compactionActive` parsing expects `"off"\|"anchored"\|"ciswire"` — **will break if mode removed** |
| `scripts/benchAggregate.mjs:748` | `modeToArm = { off: "baseline", anchored: "anchored", ciswire: "ciswire" }` — **will break** |
| `scripts/ci-bench.sh:21,115-118,267-272` | `COMPACTION` env accepted as `anchored\|off\|ciswire`; `compaction_pref_raw_for()` maps `"anchored"` → `"anchored"` — **will break** |

### CI Workflows

| file:line | impact |
|---|---|
| `.github/workflows/bench.yml:248-425` | 10 `fase4` matrix entries with `compaction: "anchored"` (seeds 1-10) — **will break** |
| `.github/workflows/bench.yml:790-795` | 4 `smoke` matrix entries with `compaction: "anchored"` — **will break** |
| `.github/workflows/e2e-emulator.yml:21-22` | `compaction` input options `["on", "off"]` — **"on" maps to anchored via `compaction_pref_raw_for`**; changing the mapping breaks e2e |

### Production Code (if `"anchored"` removed from `ContextMode`)

| file:line | impact |
|---|---|
| `src/app/AppShell.tsx:2394` | `useRef<ContextMode>("anchored")` — **TS error** |
| `src/app/AppShell.tsx:4505` | catch fallback `"anchored"` — **TS error** |
| `src/app/AppShell.tsx:4513,4569,4578,4594,4646,4685,4769,4880` | All `anchoredOn` checks — **dead code or TS error** |
| `src/context/compactor.ts:283` | `parseContextMode` default return — **TS error** |
| `src/context/compactor.ts:288` | `modeUsesBoundary` — **always false** |
| `src/context/compactor.ts:485-545` | `computeAnchoredBoundary`, `shouldRebuildAnchored`, `advanceAnchoredBoundary` — **dead code** |
| `src/context/windowProfile.ts:158-195` | `anchoredWindowChars`, `anchoredWindowExceedsBudget` — **dead code** |

---

## RISKS / DOUBTS

1. **`parseContextMode` default is `"anchored"` for ALL garbage/absent values.** S2 must change this default without breaking the boolean ON/OFF path (`parseCompactionEnabled`). The two parsers live in different files (`compactor.ts` vs `ttftFlags.ts`) and serve different purposes — verify they stay consistent when the regime mapping changes.

2. **Settings toggle writes `COMPACTION_CHOICE_KEY = "1"` always.** It never writes `"0"` — if the new flag plumbing needs a distinct "explicitly chose X" marker, the SettingsScreen write logic at line 430-431 must change. Currently the choice key only signals "user has interacted with this toggle" (not "user chose X").

3. **AppShell catch fallback hardcodes `"anchored"`.** If S2 changes the default, the catch at line 4505 must change too, or the fallback becomes inconsistent with the new production default.

4. **`contextModeRef` initial value is `"anchored"`.** Same issue — line 2394 is the in-memory default before the first AsyncStorage read completes. Changing it without updating the comment creates a window where the send path runs with the old regime.

5. **`compactionEnabled` boolean and `contextMode` enum are decoupled.** AppShell reads both from the same key (`COMPACTION_ENABLED_KEY`) but via different parsers. The boolean is used for `compactionEnabled` (assembly) while the enum drives `retrievalOn` / `anchoredOn`. S1/S2 must ensure these stay in sync when adding the new flag.

6. **Bench matrix uses `compaction: "anchored"` as a literal string.** If the mode is renamed or removed, every matrix entry in `bench.yml` (40+ entries across fase4 + smoke) must be updated, plus `ci-bench.sh`'s `compaction_pref_raw_for()`, plus `benchGradeHarness.mjs` and `benchAggregate.mjs`. This is the largest blast radius surface.

7. **`emitSettledMemoryTelemetry` at AppShell.tsx:4233-4248** has an early-exit path that emits with `extractStopReason: 4` and all extraction fields as `NOT_APPLICABLE`. A new `ciswireFlags` field must be added to this path too, or the settled line will be missing the bitmask.

8. **The `COMPACTION_ENABLED_DEFAULT = true` in ttftFlags.ts:65** means compaction is ON by default for new installs. After S2, this default must map to the correct regime (not anchored). Verify `parseCompactionEnabled` and `parseContextMode` agree on what "default ON" means.

9. **e2e-emulator.yml** accepts `compaction: "on"` (line 22), which maps to `"anchored"` via `compaction_pref_raw_for` in ci-bench.sh. If the e2e workflow's `compaction` input is not updated, it will continue to test anchored mode even after S2 changes the default.

10. **`benchAggregate.mjs:1325`** has a comment "baseline↔anchored so a silent ciswire no-op cannot hide behind a green anchored control" — this test-architecture assumption must be revisited if anchored is no longer a user-reachable arm.
