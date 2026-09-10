# C1/C2 Implementation Report

**Date:** 2026-09-05
**Branch:** `feat/moe-stream`
**Repo:** `/Users/marco/Projects/kalsa`
**Scope:** Finish remaining gaps of C1 (catalog prune) + C2 (RAM-tier / data-driven recommendation) that Luna left partial on disk. No report was written by the prior agent.
**Hard rule honored:** no new hardcoded model-id switches / `id.includes` heuristics. All remaining logic is registry/field-driven.

---

## 0. Exit codes (evidence)

| Check | Command | Exit | Result |
|---|---|---|---|
| Typecheck | `npx tsc --noEmit` | **0** | clean |
| Targeted jest | `jest <6 files>` | **0** | 33/33 pass |
| New invariant test | `jest src/engine/contextProfile.test.ts` | **0** | 6/6 pass |
| Full jest suite | `jest` | **0** | **360/360 pass** (41 suites) |
| Node harnesses | `node scripts/{deviceProfile,thinkingBudgets,telemetry}Harness.mjs` + `npm run harness:{profile,telemetry}` | **0** | all pass |

---

## 1. What Luna left on disk (verified, kept — no regression)

These were already correct in the working tree. I verified rather than rewrote.

| Area | On-disk state | Verified |
|---|---|---|
| `MODEL_REGISTRY` | KEEP-only: `qwen3.5-4b` (default) + `lfm2.5-2.6b` (+ `whisper-tiny` / `multilingual-e5-small` standalone) | ✅ |
| `ModelInfo` | carries `sizeClass` + `recommendForTiers` | ✅ |
| `recommendedModelId(tier)` | pure registry query → `string | null` (first listed entry that declares the tier) | ✅ |
| `llamaContextGate` | `isChatModel2BClass/4BClass` read `sizeClass` via `getModelById` (no id-string parsing); unknown id not classified as default | ✅ |
| `deviceTuning` | thermal guard reads `sizeClass === "4B"` | ✅ |
| i18n (`en.ts`/`it.ts`) | dead keys for REMOVED models removed (`gemmaE2b`, `qwen2b`, `qwen4bQ3`, `lfm258b`); `qwen4b` + `lfm25` kept | ✅ |
| `scripts/benchPreflight.mjs:251` | hardcoded allowlist replaced by `models.filter(m => m.listed !== false)` (registry-derived) | ✅ |
| `scripts/ci-bench.sh` | default `MODEL_DIR` = `qwen3.5-4b` (a KEEP model) | ✅ |
| node harness scripts | `deviceProfileHarness.mjs`, `telemetryHarness.mjs`, `thinkingBudgetsHarness.mjs` rewritten to derive fixtures from `MODEL_REGISTRY.find(...)` **by field** (`recommendForTiers`), no hardcoded ids | ✅ |
| `SettingsScreen.tsx` | `recommendedModel` already null-guarded (`recommendedModel !== null && entry.id === recommendedModel`) | ✅ |

---

## 2. Gaps I finished

### Gap 1 — i18n dead keys
Already complete on disk (Luna). Removed `models.gemmaE2b.*`, `models.qwen2b.*`, `models.qwen4bQ3.*`, `models.lfm258b.*` from both `en.ts` and `it.ts`. Kept `models.qwen4b.*` and `models.lfm25.*`. No dead-key references remain in tracked source (only gitignored `scripts/.build/` artifacts, which are regenerated). **No change needed.**

### Gap 2 — `benchPreflight.mjs:251` allowlist
Already replaced by Luna with a registry-derived filter (`m.listed !== false`). Adding/removing a listed entry changes the preflight set with no string list. **No change needed.**

### Gap 3 — `ci-bench.sh` default model
Already set by Luna: `MODEL_DIR` defaults to `qwen3.5-4b` (a KEEP model) instead of the removed `qwen3.5-2b`. **No change needed.**

### Gap 4 — broken tests referencing removed ids
Two concrete failures found and fixed:

- **`src/engine/modelGateRAM.test.ts`** — Luna's rewrite dropped the `const STREAMED_MIB = MEASURED_BYTES / MiB;` definition while keeping its usage at the midpoint assertion, producing a TS compile error (`Cannot find name 'STREAMED_MIB'`). **Restored the single const line.** The remaining test ("prices at the resident estimate when there is no streaming measurement") now compiles and passes. No behavior change; the test still prices from a measured constant, not a hardcoded id.
- **`src/engine/sessionKey.test.ts`** — the expectation `lfm2_002e5-2_002e6b__conv-1__…` was already correct for the current `sanitizeSessionSegment` (which encodes *every* non-`[A-Za-z0-9-]` char injectively). The failure was a **stale jest transform cache** holding the old partially-encoded expectation. Cleared the cache; the test now passes against the working-tree expectation. No source edit.

The other enumerated tests (`loadPolicy`, `modelHost`, `ModelDownloader`, `ciswireFlagsTelemetry`) already pass — no removed-id references remain in them.

### Gap 5 — NEW invariant tests
**Created `src/engine/contextProfile.test.ts`** (6 tests) pinning the current production mapping so a future catalog edit that drops it fails loudly:

- `recommendedModelId("high") === "qwen3.5-4b"`.
- `recommendedModelId("low") === "lfm2.5-2.6b"` and `recommendedModelId("mid") === "lfm2.5-2.6b"`.
- `recommendedModelId(tier, []) === null` (no listed entry → no recommendation).
- `isChatModel2BClass("lfm2.5-2.6b") === true`; `isChatModel4BClass("qwen3.5-4b") === true`.
- Unknown id (`"does-not-exist-xyz"`) is **not** classified as either class (i.e., not silently classified as the default model's class).
- Every listed model declares a `sizeClass`.

(Registry-level "exactly one listed recommendation per tier" invariant was already present in `src/engine/ModelRegistry.test.ts`; this file adds the explicit id-level and size-class classification assertions.)

### Gap 6 — SettingsScreen null-safety
Already safe. `recommendedModelId` returns `string | null`; `SettingsScreen.tsx:2158` guards with `recommendedModel !== null && entry.id === recommendedModel`. **No change needed.**

### Gap 7 — Typecheck + targeted jest
- `npx tsc --noEmit` → **exit 0** (includes the new `contextProfile.test.ts`).
- Targeted suite (the 6 enumerated files + new test) → **exit 0**.
- Full suite → **360/360 pass, exit 0**.

---

## 3. What was deliberately left alone (out of scope / working paths)

- `native/kalsallama.pin` / governor worktree — no edits (task: "No native/governor edits").
- `scripts/.build/**` — gitignored regenerated artifacts; not tracked.
- Device-campaign logs / docs — data, not code.
- The four enumerated harness scripts — already field-derived and passing (verified above).

---

## 4. Net diff summary vs HEAD

| File | Change |
|---|---|
| `src/engine/modelGateRAM.test.ts` | Restored the missing `const STREAMED_MIB = MEASURED_BYTES / MiB;` (Luna's edit dropped the definition, kept the usage → TS compile error). |
| `src/engine/contextProfile.test.ts` | **New** — id-level recommendation + size-class classification invariants (6 tests). |
| *(everything else)* | Pre-existing Luna work, verified and kept. |

---

## 5. State: CLOSED

All enumerated gaps 1–8 resolved. Typecheck exit 0; full jest 360/360 (41 suites) exit 0; targeted suite exit 0. No new hardcoded model-id switches introduced. No commit/push performed.
---

## 6. Follow-up fix (orphan sweep + nits) — 2026-09-05

The C1/C2 audit (C1C2-AUDIT-DEEPSEEK.md) flagged **M1** as the only must-fix-worthy finding: after the catalog prune, users who downloaded a removed model keep `documentDirectory/models/<removed-id>/` GGUFs with **no UI delete path** — a permanent disk leak. This section implements M1 and closes nits N1–N3.

**Hard rule honored:** no new hardcoded model-id switches / `id.includes` catalog heuristics. Orphan detection is catalog-derivative (keep-set = registry ids + standalone ids), not an id string list.

### M1 — Orphaned on-device downloads now deletable at boot

**`src/engine/ModelDownloader.ts`** — added:

- `listOrphanModelDirNames(dirNames: readonly string[], keepIds: ReadonlySet<string>): string[]` — **pure, FS-free**. Returns subdirectory names under `MODELS_DIR` whose id ∉ the keep set. This is the testable core.
- `catalogKeepIds()` — private; keep set = `MODEL_REGISTRY` ids + `WHISPER_MODEL.id` (`whisper-tiny`) + `EMBEDDING_MODEL.id` (`multilingual-e5-small`). No id literals — derived from the catalog.
- `sweepOrphanModelDirs(): Promise<{ removed: string[] }>` — best-effort boot sweep:
  - `readDirectoryAsync(MODELS_DIR)` (no-op if missing/absent — caught, returns `{removed: []}`).
  - For each orphan: `getInfoAsync` guard → only delete **directories** (`isDirectory === true`), never stray files; `deleteAsync(target, {idempotent:true})`; then clear matching resume blobs (`kalsa.download.resume.<id>.…`) via `getAllKeys` prefix match.
  - **Never throws to the caller** — each orphan is wrapped so one failure doesn't abort the rest.

**`src/app/AppShell.tsx`** — wired once at boot: `void sweepOrphanModelDirs().catch(() => undefined);` inside the existing model-preference restore effect (right after `MODEL_STORAGE_KEY` read). Fire-and-forget; does not block UI. Import extended to include `sweepOrphanModelDirs`.

**`src/engine/ModelDownloader.orphan.test.ts`** — **new** (4 tests). Pins the pure helper without RN:
- clean/empty dir → `[]`.
- every live catalog id (incl. whisper/embedding) → kept.
- pruned ids (`qwen3.5-2b`, `gemma-4-e2b`, `lfm25-8b-a1b`) → reported as orphans.
- stray non-dir name (`.DS_Store`) → reported (the directory-only guard in `sweepOrphanModelDirs` is what prevents file deletion).

### N1 — `src/telemetry/pure.ts` `modelCategoryFromId`
Removed the `id.includes("moe" | "mixtral" | "a0.")` arch-name sniff. Now only `opts?.moe`, registry `canStreamExperts`, and `sizeClass` paths remain (unknown/stale ids → `"unknown"`).

### N2 — `src/engine/ModelRegistry.test.ts`
Removed the over-broad `MODEL_REGISTRY.every(m => m.canStreamExperts !== true)` absence pin (it would break on any legitimate catalog edit). Kept exactly-one-recommend-per-tier + sizeClass invariants.

### N3 — `scripts/ci-screens.sh`
Added a one-line comment documenting that the default `lfm2.5-2.6b` (vs the 4B) is intentional for the lighter screens CI (no inference runs).

### Verify

| Check | Command | Exit | Result |
|---|---|---|---|
| Typecheck | `npx tsc --noEmit` | **0** | clean |
| Targeted jest | `jest ModelDownloader.orphan ModelDownloader ModelRegistry telemetry/pure` | **0** | **36/36 pass** (incl. 4 new orphan tests) |

No commit/push performed.
