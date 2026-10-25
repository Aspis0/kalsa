# AUDIT S4 FIX PASS — hostile re-audit (2026-08-26)

Scope: F-3a (calendar contract) and F-9 (kalsa.bench.toolgate=0). Read-only. No git surgery.

## Must-answer questions

| # | Question | Verdict | Evidence |
|---|----------|---------|----------|
| Q1 | Does `CALENDAR_AGENDA_TOOL.parameters.required` include both `fromISO` and `toISO`? | **CONFIRMED** | `calendarTool.ts:32`: `required: ["fromISO", "toISO"]` |
| Q2 | Are `calendar-empty-range` / `calendar-malformed-range` gone from `calendarGate.ts`? | **CONFIRMED** | `calendarGate.ts:19-45`: single rule `calendar-private-data`. No other rules. The string `"empty-range"` and `"malformed-range"` do not appear in the file. |
| Q3 | Is `containsPrivateData` still scanned over `stringFields`? | **CONFIRMED** | `calendarGate.ts:30-35`: `for (const text of stringFields(input)) { for (const fact of facts) { … containsPrivateData(text, trimmed) … } }` |
| Q4 | Does `executeTool` skip `runToolGate` when `getToolGateEnabled()` is false, regardless of `toolhelpRef`? | **CONFIRMED** | `AppShell.tsx:1975-1982`: `const gate = (await getToolGateEnabled()) ? await runToolGate({…}) : { blocked: false };` — ternary short-circuits the entire `runToolGate` call. |
| Q5 | Does `getToolGateEnabled()` return `true` unless AsyncStorage raw `=== "0"`? Flag-off users without the key: zero change? | **CONFIRMED** | `benchConfig.ts:464-472`: `if (raw === "0") return false; … return true;`. Absent key → raw is `null` → not `"0"` → returns `true`. Flag-off users without the key see identical behavior. |
| Q6 | Any sealed S1/S3 file touched? | **CONFIRMED — DEFECT** | 10 of 12 sealed files have uncommitted diffs in the working tree (see Finding S-1). `toolGate.ts` is the only sealed file byte-unchanged. `dnaBounding.ts` is a new untracked file. |

## Findings

| # | Verdict | Category | Finding | Evidence |
|---|---------|----------|---------|----------|
| **F-3a** | **CONFIRMED** | Schema/gate alignment | `required: ["fromISO", "toISO"]` added; description updated to "Required"; `calendar-empty-range` and `calendar-malformed-range` rules deleted from `calendarGate.ts`; `calendar-private-data` is the sole rule; `containsPrivateData` still scans `stringFields`. | `calendarTool.ts:19,23,27,32`; `calendarGate.ts:19-45` |
| **F-3a-edge** | **PLAUSIBLE** | Edge case | `resolveAgendaRange` (`calendarAgenda.ts:28-43`) still falls back to `localDayRange(now)` for empty/missing/invalid `fromISO`/`toISO`. Schema `required` is a model hint, not runtime enforcement. If the model sends empty strings, the gate passes (empty strings don't trigger `calendar-private-data`) and the executor silently defaults to "today". This is correct graceful degradation, but means the `required` contract is soft. | `calendarAgenda.ts:29`: `parseIsoDate(args.fromISO) ?? fallback.from` |
| **F-9** | **CONFIRMED** | Bench knob bypass | `getToolGateEnabled()` is called per-tool-invocation (not per-memo). When it returns `false`, `gate = { blocked: false }` with no `warnNote`/`text`/`decision`. `gate.blocked` is `false` → tool executes. `applyWarnToResult(outcome, gate.warnNote)` receives `undefined` → returns outcome unchanged. | `AppShell.tsx:1975-1982,2053` |
| **F-9-type** | **CONFIRMED** | Type safety | `gate` type is `ToolGateResult \| { blocked: false }`. Since `{ blocked: false }` is assignable to `ToolGateResult` (all other fields optional), TypeScript infers `ToolGateResult`. `gate.warnNote` is `string \| undefined`. No type error. `tsc --noEmit` exit 0. | `tsc --noEmit` exit 0 |
| **F-9-flag-off** | **CONFIRMED** | Backward compat | Flag-off users without `kalsa.bench.toolgate` key: `getToolGateEnabled()` returns `true` → full gate path runs → identical to pre-fix behavior. | `benchConfig.ts:464-472` |
| **F-9-dead** | **PLAUSIBLE** | Dead code | `LlamaService.ts:3126` still blanks `lastUserMessage` when `toolGateEnabled` is false: `toolGateEnabled ? lastUserMessageText : ""`. This is now redundant — the gate bypass in AppShell makes the 4th arg irrelevant for the gate. Harmless dead code. Spec explicitly permits this ("The 4th-arg blanking can remain as dead/redundant"). | `LlamaService.ts:3120-3126` |
| **S-1** | **CONFIRMED** | Process defect | 10 sealed S1/S3 files have uncommitted diffs in the working tree. These appear to be S1/S3 feature work (CisWire flags, DNA bounding, memory telemetry fields) that was never committed, not S4 changes. But they are mixed into the same working tree, making it impossible to verify S4 isolation by diff alone. `toolGate.ts` is the sole sealed file with no diff. `dnaBounding.ts` is new (untracked, 151 lines). Files with diffs: `LlamaService.ts` (+11 lines), `MemoryStore.ts` (+17), `sessionPersistence.ts` (+7), `memoryTelemetry.ts` (+22), `memoryFactsTail.ts` (-24), `compactor.ts` (+15), `ttftFlags.ts` (+27), `digestTelemetry.ts` (+3), `turnTelemetry.ts` (+6), `SettingsScreen.tsx` (+63). | `git diff --name-only` |
| **S-dead** | **CONFIRMED** | Dead code | `runToolGate.ts:56`: `if (reason === "empty-range" \|\| reason === "malformed-range")` in `blockText` is unreachable — no registered rule produces these reasons anymore (calendar gate deleted them, web_search uses `"empty-query"`). Spec allows this ("dead empty-range branch in blockText is allowed leftover"). | `runToolGate.ts:56` |
| **security** | **CONFIRMED** | No leak | `BENCH_TOOLGATE_KEY` = `"kalsa.bench.toolgate"` appears only in `benchConfig.ts` (constant + read) and `AppShell.tsx` (comment + call). Not logged, not in error strings, not in Debug, not in event payloads, not written to disk. | `grep` clean |
| **privacy** | **CONFIRMED** | No leak | Audit log (`gateAuditLog.ts`) stores only `turnId`/`toolName`/`ruleId`/`action`/`outcome` — no query text, no memoryFacts, no user content. `sanitize()` strips unknown fields. `snapshotInput` in `runToolGate.ts` puts `lastUserMessage`/`memoryFacts` into the evaluation input, but these never reach `appendGateAudit` (line 114 passes only decision-derived fields). | `gateAuditLog.ts:13-19,32-41,80-87`; `runToolGate.ts:114-121` |
| **race** | **CONFIRMED** | No issue | `gateAuditLog.ts:23` module-level `writeChain` serializes all RMW. Single call site (`runToolGate.ts:114`). No concurrent callers. `getToolGateEnabled()` is async but `executeTool` is called sequentially by the engine (one tool at a time per turn). | `gateAuditLog.ts:23,80-88` |
| **memory** | **CONFIRMED** | No leak | `writeChain = writeChain.then(…)` replaces the ref each call; previous promise is GC'd after resolve. No listeners, no subscriptions added by S4 changes. | `gateAuditLog.ts:81` |
| **test-hygiene** | **CONFIRMED** | Clean | `runToolGate.test.ts:34`: `beforeEach` clears audit log only — no `process.env` mutation. `calendarGate.test.ts`: no env mutation. No save/restore needed. | `runToolGate.test.ts:34-36`; `calendarGate.test.ts` (full read) |
| **test-correctness** | **CONFIRMED** | Correct | `calendarGate.test.ts:15-36` "empty or malformed range is not gated" — tests that empty/missing/garbage/inverted ranges pass through the gate. Correct: the only rule is `calendar-private-data`, and none of these inputs contain private data. `runToolGate.test.ts:17-33` "flag off" — confirms calendar is exempt (ungated) and no audit writes. | `calendarGate.test.ts:15-36`; `runToolGate.test.ts:17-33` |
| **tsc-jest** | **CONFIRMED** | Pass | `npx tsc --noEmit` → exit 0. `npx jest src/rules/ src/memory/` → 7 suites / 26 tests pass, exit 0. No `src/agent/*.test.ts` exists (grep exit 1). | This session |

## Dead code inventory

| File | Line | What | Status |
|------|------|------|--------|
| `runToolGate.ts` | 56 | `if (reason === "empty-range" \|\| reason === "malformed-range")` | Unreachable — no rule produces these reasons. Allowed by spec. |
| `LlamaService.ts` | 3120-3126 | 4th-arg blanking `toolGateEnabled ? lastUserMessageText : ""` | Redundant — gate bypass moved to AppShell. Allowed by spec. |

## Final verdict: **SEAL** (F-3a and F-9 are correctly implemented)

Both fixes are clean. Schema `required` aligns with gate rules. Bench knob bypass works per-invocation, doesn't affect flag-off users, and `tsc`/`jest` pass. The only structural concern is S-1 (10 sealed files with uncommitted diffs in the working tree), which is a process/commit hygiene issue, not a code correctness defect. The S4 changes themselves touch exactly: `calendarTool.ts`, `calendarGate.ts`, `calendarGate.test.ts`, `runToolGate.ts`, `runToolGate.test.ts`, `AppShell.tsx`. `benchConfig.ts` is unchanged (getToolGateEnabled was already at HEAD). `evaluate.ts` has warn/ruleId additions needed for the gate machinery.

**Seal S4 fix pass. Commit the working tree before anything else touches it.**
