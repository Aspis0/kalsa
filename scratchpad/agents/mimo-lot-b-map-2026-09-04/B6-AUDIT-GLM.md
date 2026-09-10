# B6-AUDIT-GLM — hostile self-audit of B6 registry/wiring/telemetry work

Repo: `/Users/marco/Projects/kalsa` (branch `feat/moe-stream`, uncommitted working tree)
Scope audited personally, no delegation:
- `src/agent/toolRegistry.ts` (new, 100 lines)
- `src/agent/toolNames.ts` (new, 18 lines)
- `src/app/AppShell.tsx` (assembleTools wiring, imports, toggle load)
- `src/agent/toolToggles.ts` (WEB key centralization)
- `src/engine/toolCallTelemetry.ts` (ALL_TOOL_NAMES)
- `src/agent/toolRegistry.test.ts` (new), `src/agent/toolSourceLedger.test.ts` (new)

Maps: B6-REGISTRY-WIRE-MAP.md, B6-DX-GAPS-MAP.md, B6-ROUNDTRIP-MAP.md. Impl report: `docs/B6-IMPL-REPORT.md`.

---

## 0. Parent claims — re-verified by me, not trusted

| Parent claim | My verification | Verdict |
|---|---|---|
| typecheck 0 | `npx tsc --noEmit` → exit 0 | CONFIRMED |
| 15 targeted jest pass | Re-ran. The two new suites = **7 tests**. The 4 most B6-relevant suites (toolRegistry, toolSourceLedger, toolCallParser, runToolGate) = **35 tests**, all pass. I could not reconstruct "4 suites / 15 tests" from any B6-relevant combination; the closest 4-suite combo that lands near 15 (16) includes two unrelated WIP suites (`memoryPrompt.test.ts`, `ciswireFlagsTelemetry.test.ts`) that carry **unrelated uncommitted edits** sitting in the same tree. | **NOT REPRODUCIBLE as stated** (BUG-NIT, see N5) |
| executeTool if/else left intact | `git diff src/app/AppShell.tsx` — only the tools array + imports changed; dispatch block untouched | CONFIRMED |
| web key remains `kalsa.web.enabled` | Old inline const (AppShell:307, deleted) = `kalsa.web.enabled`; new `toolToggles.ts:3` = same string. No migration hazard | CONFIRMED |
| telemetry recognizes device/calendar | Verified in code + ran both standalone harnesses: `telemetryClampHarness` 9/9, `toolRoundExhaustedHarness` 19/19 | CONFIRMED |
| `git diff --check` clean | re-ran, clean | CONFIRMED |

Also verified myself: full `npx jest src/agent` (2 suites, 7 tests) green; both telemetry harnesses recompile from source and pass, proving the new `toolNames` import is genuinely Node-safe.

---

## 1. Verdicts per requested angle

### Angle 1 — assembleTools order/flags parity with old spread — CONFIRMED (parity holds)

Old (deleted, AppShell ~1946):
```ts
const tools = [
  ...(webToolsEnabled ? [WEB_SEARCH_TOOL, WEB_FETCH_TOOL] : []),
  DOCUMENT_CHAT_TOOL,
  ...(deviceToolsEnabled ? [DEVICE_INFO_TOOL, DEVICE_CALC_TOOL] : []),
  ...(calendarToolsEnabled ? [CALENDAR_AGENDA_TOOL] : []),
];
```
New: `TOOL_ENTRIES` order (`toolRegistry.ts:31-75`) is `web_search, web_fetch, document_chat, device_info, device_calc, calendar_agenda` — identical. Flag semantics identical: web ON / device ON / calendar OFF defaults match old `useState(true)/useState(true)/useState(false)` (AppShell:684, 714, 717). Assembly uses the same state values, memo deps unchanged (`}, [calendarToolsEnabled, deviceToolsEnabled, locale, webToolsEnabled]);` AppShell:2070) and prewarm deps unchanged (AppShell:2084). **No behavior change.** Caveat: parity test matrix covers only 4 of 8 flag combos (see N1).

### Angle 2 — TOOL_ENTRIES vs ALL_TOOL_NAMES sync throw: false positives? — CONFIRMED no false positives today, but the check is **asymmetric and has two blind spots** (BUG 1, BUG 2)

`toolRegistry.ts:96-99`:
```ts
// Keep the registry's exported name list tied to the metadata rows at runtime.
if (TOOL_ENTRIES.some((entry, index) => entry.name !== ALL_TOOL_NAMES[index])) {
  throw new Error("Tool registry names and ALL_TOOL_NAMES are out of sync");
}
```
- No false positive fires today: lists are identical in order and content; jest + app boot prove it. A pure reorder *would* throw — intended, since order is wire semantics — but the message misdescribes it (N8).
- **Blind spot A:** removing a *trailing* TOOL_ENTRIES row does NOT throw — `.some()` iterates TOOL_ENTRIES only; a 5-row array that is a prefix of a 6-name ALL_TOOL_NAMES passes. Same hole if a name is appended to ALL_TOOL_NAMES without adding a row.
- **Blind spot B (worse):** `entry.def.function.name` is never compared to `entry.name`. The registry's whole point is one source of truth for tool names, yet the *actual* wire name (what the model sees, what dispatch compares, what telemetry clamps) is unverified. A typo in `webSearchTool.ts`'s `function.name` sails through the registry, the sync throw, and all tests; the model gets a name the dispatcher answers with `unknownTool` and telemetry clamps to `"other"`.

### Angle 3 — importing EngineTool from LlamaService in toolRegistry — CONFIRMED safe, with an unguarded fragility

`toolRegistry.ts:11`: `import type { EngineTool } from "../engine/LlamaService";` — type-only, erased by both tsc and ts-jest (jest.config.js uses ts-jest). LlamaService imports react-native (`src/engine/LlamaService.ts:1: import { AppState, Platform } from "react-native";`) so a *value* import would detonate the Node jest env — but nothing today forces one. Residual risk: no lint rule (e.g. `consistent-type-imports`) or comment guards against an IDE auto-fix upgrading `import type` → `import`, which would pull the whole RN-dependent engine into the registry test graph (N13).

### Angle 4 — telemetry recognizes all 6 names; no "other" for device/calendar — CONFIRMED

- `toolCallTelemetry.ts:12`: `import { ALL_TOOL_NAMES } from "../agent/toolNames";` and `:37`: `const KNOWN_TOOL_NAMES: readonly string[] = ALL_TOOL_NAMES;` — 6 names, up from the hardcoded 3. `clampToolNames` (:79) maps device/calendar through; only model-invented names become `"other"`.
- `LlamaService.ts:3068` pushes every emitted call name into `toolTel.toolNames`; `namesValid` semantics unchanged (validated against the per-turn `options.tools` array, `LlamaService.ts:2347-2358`) — correct pre-existing behavior, untouched.
- Both standalone harnesses still pass because `toolNames.ts` is truly dependency-free. Nits: type widening to `readonly string[]` (N10) and nothing guards the "dependency-free" header claim of `toolNames.ts` (N16).

### Angle 5 — toolSourceLedger tests: coverage holes / wrong mocks — CONFIRMED holes; no wrong mocks

The 3 tests are correct (I checked each expectation against `toolSourceLedger.ts`: decide order cap→dup→failed_repeat→execute matches test 1; `name:raw:rawArguments` matches `makeToolCallKey` :180-183; HTTPS/case/fragment/trailing-slash dedup with assigned `[1,2,1]` matches `accumulateToolSources` :52-71). But (N3): `recordToolSuccess`/`recordToolFailure` — the only state-mutating APIs — have **zero** tests; the test titled *"decides each execution path without mutating state"* (toolSourceLedger.test.ts:8) contains **no assertion that state is unmutated**; no fail-count=1 boundary; no failed-then-succeeded path; no `executions > max`; no circular-args JSON.stringify-throw branch (toolSourceLedger.ts:192-195); and `buildCiteInstructionSuffix`, `normalizePdfPages`, `pdfPagesFromSources`, `citeKindForTool`, `sourceUrlOf` have zero direct tests. The report's "pure tool-source-ledger tests" oversells: 3 of ~10 exported functions. No wrong mocks — the file is mock-free and the module is pure.

### Angle 6 — dead imports in AppShell after assembleTools — REFUTED (none exist)

Grep for all six tool constants in AppShell.tsx → zero hits. All imports kept by the diff are live: `WEB_TOOLS_ENABLED_KEY` (AppShell:689, 707), `DEVICE_TOOLS_KEY`/`CALENDAR_TOOLS_KEY` (:724-725), `parseToolToggle` (:728-729). tsc clean, diff clean.

### Angle 7 — behavior change risk (toggle defaults) — REFUTED (none)

Defaults identical end-to-end: registry `defaultOn` per row (toolRegistry.ts:35,42,51,57,64,71) = old inline spread; web read path unchanged (`raw === "0" || raw === "false"` only, AppShell:693, comment "Missing key → default ON (current historical behavior)"); device/calendar `parseToolToggle(raw, true/false)` unchanged; SettingsScreen writes unchanged (`src/screens/SettingsScreen.tsx:433,441`). The **only** new runtime behavior is the module-load sync throw (fail-fast; production boot crash if lists diverge — flagged in N8).

---

## 2. Findings — every defect and nit, ordered

**BLOCKER: none.** No runtime regression found: order, flags, dispatch, keys, defaults all preserved; telemetry change is a strict superset.

### BUGS

- **BUG 1 — Sync assertion is prefix-only; one divergence direction is invisible.** `toolRegistry.ts:96-99` compares index-by-index over TOOL_ENTRIES only. Removing the last row, or appending a name to `ALL_TOOL_NAMES` without a row, throws nothing. A "safety check" that fails 50% open is a bug, not a nit.
- **BUG 2 — Registry never validates `entry.def.function.name === entry.name`.** `ToolEntry` (toolRegistry.ts:26-32) carries `name` and `def` side by side with no linkage; neither the module-load throw nor `toolRegistry.test.ts` ("lists all six live tool names", :14) compares them. The single-source-of-truth claim of B6 is enforceable in two lines and isn't.
- **BUG 3 — `gateTable` is dead data; gate wiring is misdocumented.** `TOOL_GATE_REGISTRY` (`toolGateRegistry.ts:13-16`) remains the only lookup consumed by `resolveToolGateTable` (:26-31, untouched). `grep gateTable` across src returns only toolRegistry.ts itself and its test. The checklist header (toolRegistry.ts:2-6) step 3 — "Add an optional gate, toggle, and i18n strings when the tool needs them." — never says WHERE; a contributor will conclude the row's `gateTable` field wires it. It does not. B6 killed one three-place sync and quietly added a two-place sync for gates.
- **BUG 4 — `toggleKey: string | null` (toolRegistry.ts:29) + silent `?? entry.defaultOn` fallback (toolRegistry.ts:84-92).** `assembleTools` hard-codes the toggleKey→flag map inside its body; a new tool with a NEW toggleKey resolves `undefined ?? defaultOn` → always assembles per default, forever, with no compile-time and no runtime signal. TS can't help because the field is typed `string`. This reinstates the exact "add a tool, touch N places, silent miss" failure mode B6 was chartered to kill.
- **BUG 5 — Delivered contributor checklist is incomplete against the map's own gap list.** toolRegistry.ts:2-6 has 3 steps and omits: (a) adding the name to `ALL_TOOL_NAMES`/toolNames.ts (the throw *will* catch it — at production boot), (b) the defense-in-depth toggle guard block (AppShell:1962-1986), (c) the prewarm toggle dep (AppShell:2084), (d) the Settings UI write (SettingsScreen.tsx:433-441), (e) where gates actually go (see BUG 3). B6-DX-GAPS §2 G2.6 ("no checklist") is half-cured with a checklist that causes exactly the silent misses it lists.

### NITS (all of them)

- **N1 — Flag-combo coverage 4/8.** toolRegistry.test.ts:26-51 covers TTF, FTF, TFT, FFT. Missing: **TTT (the real production full set)**, **FFF (the deleted HIGH-5 invariant: `document_chat always stays available` — that rationale comment was deleted from AppShell and lives nowhere now)**, TFF, FTT.
- **N2 — No test for `entry.def.function.name === entry.name`, none for duplicate rows, none that the module-load throw fires on divergence.** The sync throw itself is untested and untestable as written (import-time side effect).
- **N3 — Ledger test gaps (full list):** no mutation assertion despite the test name (toolSourceLedger.test.ts:8); `recordToolSuccess`/`recordToolFailure` untested; fail-count=1 (retry allowed) untested; failed-then-succeeded key precedence untested; `executions > max` untested (only `==`); circular-args fallback `name:raw:` branch (toolSourceLedger.ts:192-195) untested; `args = undefined/null` untested; nested-object/array canonicalization untested; `buildCiteInstructionSuffix` (contiguity rule, mapped form, passages-never-plain, pdfPages `{index}`/`{pages}` substitution) entirely untested; `normalizePdfPages`, `pdfPagesFromSources`, `citeKindForTool`, `sourceUrlOf` untested; URL-less duplicate always-append semantics untested; absolute-index continuation with a pre-populated accumulator (>1 existing entry) untested.
- **N4 — Web toggle load hand-rolls parsing** (AppShell:693 `if (raw === "0" || raw === "false")`) instead of `parseToolToggle(raw, true)`. Behaviorally equivalent today (defaultOn=true makes them coincide) but two parsers will drift; map P2 ("AppShell reads via parseToolToggle like device/calendar") only half-delivered: key centralized, parse not.
- **N5 — Impl-report validation line is not reproducible:** "targeted Jest (4 suites, 15 tests)" — no suite composition named; B6-relevant counts are 7 (new suites) or 35 (4 relevant suites); the only near-15 4-suite combo I found includes two unrelated WIP suites with unrelated uncommitted edits in the same working tree.
- **N6 — Report overclaims:** "registry flag-combination tests" = 4/8 combos; "metadata" includes `gateTable`, which has zero readers.
- **N7 — Undocumented test fragility:** `toolRegistry.test.ts:1-5` mocks `expo-secure-store` with no comment; it is needed transitively (webSearchTool → `../search` → `secretStore` → expo-secure-store). Next transitive native dep breaks the "pure registry" test cryptically. (The suite also silently relies on the checked-in `src/rules/entityContainment.js` build artifact resolving under jest — pre-existing, but now load-bearing for this test.)
- **N8 — Module-load throw runs at production boot** with a message lacking index/names (`"Tool registry names and ALL_TOOL_NAMES are out of sync"`, toolRegistry.ts:99) and mislabels a pure reorder as "out of sync". Consider index + both values in the message, and/or `__DEV__`-gating with a console.error fallback.
- **N9 — No uniqueness guard on toggle keys:** the `enabledByToggle` computed-key Record (toolRegistry.ts:84-88) would silently collapse if two toggle constants collided; the name check got a throw, the key check got nothing.
- **N10 — `KNOWN_TOOL_NAMES: readonly string[] = ALL_TOOL_NAMES`** (toolCallTelemetry.ts:37) widens the frozen literal type; clamp loses the compile-time tie to the `ToolName` union.
- **N11 — Behavioral name comparisons not typed to the new union:** `citeKindForTool(name: string)` string-compares `"web_fetch"` (toolSourceLedger.ts:267-268); provenance `name === "web_search" || name === "web_fetch"` (LlamaService.ts:3172); guard block + dispatch bare strings (AppShell:1962-2067). Dispatch stays by design (parent's constraint), but the new union could at least type these signatures for free.
- **N12 — ARCHITECTURE.md has zero "adding a tool" mention** (grep: no hits) — map nice-to-have skipped silently; the contributor surface is a file-header comment only.
- **N13 — `import type` from LlamaService is unguarded** — no `consistent-type-imports` lint rule or comment; an auto-fix to a value import breaks the registry test graph via react-native.
- **N14 — Two import surfaces for names:** toolRegistry re-exports `ALL_TOOL_NAMES`/`ToolName` (toolRegistry.ts:18); a harness consumer importing from toolRegistry pulls all tool defs + the secure-store graph. Telemetry correctly imports from `toolNames` — nothing documents or enforces that choice.
- **N15 — Map's `UNIQUE_TOGGLE_KEYS` single-read design not implemented**; AppShell still reads 3 keys individually (AppShell:689, 724-725) and SettingsScreen writes 2 (SettingsScreen:433,441) — no runtime check ties registry toggleKeys to the keys the shell actually loads (ties to BUG 4).
- **N16 — `toolNames.ts` "dependency-free" header claim is unguarded** — one stray import poisons telemetry and both standalone harnesses.
- **N17 — `DocumentChatToolDef`/`WebFetchToolDef` duplication persists** (webFetchTool.ts:53, documentChatTool.ts:43) with comments now in tension with toolRegistry's own LlamaService type import; map P3 (labeled "zero-risk") neither done nor acknowledged in the report.
- **N18 — `assembleTools`'s `?? entry.defaultOn` fallback branch is unreachable for the current 3 keys** — it exists only to mask BUG 4's silent default; prefer exhaustive mapping or throw on unknown key.

---

## 3. Ordered fix list

1. **BUG 2 (+N2):** extend the module-load check with `entry.def.function.name !== entry.name` and a duplicate-name check; add one test per invariant (testable by extracting the check into a pure `assertRegistryInvariants()` and calling it both at module load and in tests).
2. **BUG 1:** add the length comparison (or compare `TOOL_ENTRIES.map(e => e.name).join("\u0000")` against the joined `ALL_TOOL_NAMES`) so trailing removal/appends throw too.
3. **BUG 4 (+N9, N18):** narrow `toggleKey` to `typeof WEB_TOOLS_ENABLED_KEY | typeof DEVICE_TOOLS_KEY | typeof CALENDAR_TOOLS_KEY | null` and derive the flag exhaustively (or throw on unknown key). This makes the "new tool with new toggle key" failure a compile error instead of a silent default.
4. **BUG 3:** either drive `resolveToolGateTable` from `TOOL_ENTRIES[].gateTable` (map P5) or delete the field; fix checklist step 3 to point at `toolGateRegistry.ts`.
5. **BUG 5:** expand the checklist to the full 7-step path (toolNames.ts entry, TOOL_ENTRIES row, AppShell dispatch branch, guard block, prewarm dep, Settings UI write, i18n + gate registry pointers).
6. **N1/N2:** add the 4 missing flag combos (TTT, FFF, TFF, FTT) — FFF re-asserts the deleted HIGH-5 offline invariant.
7. **N3:** ledger tests for `recordToolSuccess`/`recordToolFailure`, mutation-freedom assertion, fail-count=1 boundary, failed-then-succeeded, `executions > max`, circular args, and at minimum `buildCiteInstructionSuffix` (contiguity, mapped form, passages-never-plain, pdfPages).
8. **N4:** replace the inline web parse with `parseToolToggle(raw, true)`.
9. **N5/N6:** rewrite the impl report validation line with named suites/counts; downgrade "flag-combination tests" and "metadata" claims to what shipped.
10. **N7/N14:** comment the expo-secure-store mock and document "harnesses import from toolNames, not toolRegistry"; consider dropping the re-export.
11. **N8/N16:** richer throw message (index + both values), optional `__DEV__` gating; add a jest test asserting `toolNames.ts` has no imports (read-and-parse or eslint import rule).
12. **N10/N11/N13:** drop the `readonly string[]` widening; type `citeKindForTool`/provenance params as `ToolName`; add `consistent-type-imports` lint rule.
13. **N12/N15/N17:** ARCHITECTURE.md one-paragraph add-tool note; implement or explicitly descope `UNIQUE_TOGGLE_KEYS`; do or explicitly descope P3 type dedup.

---

## 4. Bottom line

The mechanical work is clean: order parity, flag parity, key preservation, and telemetry superset are all real, and I re-verified every parent claim (one — the "15 tests" count — did not reproduce as stated). What is NOT clean is that the registry's two safety mechanisms (the sync throw and the test suite) both fail open on the most likely contributor mistakes: dropping a row, typing the def name wrong, adding a new toggle key, or following the shipped 3-step checklist. The deliverable's purpose was making tool addition idiot-proof; four of the five bugs are exactly the holes an idiot would fall through. Fix items 1–5 before this is called done.
