# C1/C2 HOSTILE AUDIT — deepseek

**Date:** 2026-09-05 · **Branch:** `feat/moe-stream` (working tree, uncommitted; HEAD `070b5f9`)
**Method:** read-only; no sub-agents. Ran `npx tsc --noEmit` (clean), `npx jest` (41 suites, **360/360**), targeted 9 suites (44/44), harnesses (`llamaContextGateHarness` 33, `deviceProfileHarness` 36, `thinkingBudgetsHarness` 12, `telemetryHarness` 58 — all pass), `node scripts/benchPreflight.mjs` (+`--env` both models → clean, `--env qwen3.5-2b` → exit 1), full-tree greps.

## Verified claims (outline items)

| Claim | Verdict | Evidence quoted |
|---|---|---|
| Registry KEEP-only: qwen3.5-4b + lfm2.5-2.6b (+ whisper/e5 standalone) | **CONFIRMED** | `ModelRegistry.ts:180` `export const MODEL_REGISTRY: ModelInfo[] = [` … entries `qwen3.5-4b` / `lfm2.5-2.6b`; `WHISPER_MODEL`/`EMBEDDING_MODEL` outside array. Five entries (q3, gemma, qwen-2b, lfm-8b, kexp) deleted, incl. `hfArtifactRepo` path. |
| ModelInfo: recommendForTiers, sizeClass, listed | **CONFIRMED** | `ModelRegistry.ts:86 sizeClass?: "2B" \| "4B" \| "8B" \| "other"`; `:103 recommendForTiers?: RamTier[]`; `:108 listed?: boolean`. |
| recommendedModelId = registry find, `string \| null` | **CONFIRMED** | `contextProfile.ts:94-99` `registry.find((model) => model.listed !== false && model.recommendForTiers?.includes(tier) === true)?.id ?? null` — no switch, no ids. |
| llamaContextGate via sizeClass, unknown id unclassified | **CONFIRMED** | `llamaContextGate.ts:97-100` `const model = getModelById(modelId); … return model.id === modelId ? model.sizeClass : undefined;` — the `model.id === modelId` guard kills the fallback misclassification. |
| deviceTuning thermal guard via sizeClass | **CONFIRMED** | `deviceTuning.ts:635` `const is4bTier = model.sizeClass === "4B";` — and it's plumbed: `LlamaService.ts:1202` `model: modelInfo` (full ModelInfo structurally satisfies `TuningModelInfo`; `sizeClass` flows). |
| benchPreflight filters `listed !== false` | **CONFIRMED** | `benchPreflight.mjs:254` `const workflowModels = models.filter((m) => m.listed !== false);` — runs live: "Preflight: checking 2 models… OK". |
| ci-bench default = KEEP model | **CONFIRMED** | `ci-bench.sh:89-90` `MODEL_FILE="${MODEL_FILE:-Qwen3.5-4B-Q4_K_M.gguf}"` / `MODEL_DIR="${MODEL_DIR:-qwen3.5-4b}"`. ci-e2e.sh, ci-screens.sh, workflows likewise (all added literals are KEEP ids). |
| SettingsScreen null-guard present | **CONFIRMED** | `SettingsScreen.tsx:2158` `const isRecommended = recommendedModel !== null && entry.id === recommendedModel;` Sole consumer of `recommendedModelId` (`:935`). |
| Invariants tested (exactly-one-per-tier; unknown-id; sizeClass on listed) | **CONFIRMED** | `ModelRegistry.test.ts:14` `expect(candidates).toHaveLength(1);` (both ≥1 and ≤1); `:25` unknown-id; `contextProfile.test.ts:41` `expect(missing).toHaveLength(0);` |
| modelGateRAM.test.ts STREAMED_MIB const restored | **CONFIRMED** | `modelGateRAM.test.ts:9` `const STREAMED_MIB = MEASURED_BYTES / MiB;` — present and used by remaining test. |
| sessionKey expectation matches implementation | **CONFIRMED** | `sessionKey.test.ts:29` `lfm2_002e5-2_002e6b__conv-1__…` — hand-verified against `sanitizeSessionSegment` injective encoding (`sessionKey.ts:17-33`). Passes. |
| default:true only qwen | **CONFIRMED** | `ModelRegistry.ts:211` `default: true,` — only occurrence in MODEL_REGISTRY; `getDefaultModel()` = `find(default) ?? [0]`. |
| i18n dead keys gone, en/it parity | **CONFIRMED** | `en.ts:238-247` `qwen4b`/`lfm25`/`whisperTiny` only; zero refs to `gemmaE2b|qwen2b|qwen4bQ3|lfm258b` in src/scripts; `lfm25` gained `ramBadge` ("Under 6 GB RAM") matching `ramBadgeKey`. |
| No removed-id literals remain in src/scripts | **CONFIRMED** | `git grep -iE 'qwen3\.5-2b|gemma-4|8b-a1b|kexp|…' -- src/** scripts/**` → only `scripts/quality/**` (historical bench data), comments, and synthetic fixtures (e.g. `deviceProfileHarness.mjs:358 quant: "KEXP"`). |
| Native/vendor untouched | **CONFIRMED** | `git status` / `git diff --stat` on `vendor/`, `native/` → empty. Pin/vendor SHA match (map §1). |
| Report debt: typecheck clean, 360/360, harnesses pass | **CONFIRMED** | independently re-run, all green. |

## Angle findings

**1. Security / session-restore crash — none found. CONFIRMED safe.** Stored `kalsa.model.id` pointing at a pruned id is absorbed: `AppShell.tsx:2591-2593` `const savedIndex = MODEL_REGISTRY.findIndex((model) => model.id === saved); if (savedIndex >= 0) setModelIndex(savedIndex);` → stays on default. `activeModelId` is runtime-only (`LlamaService.ts:196`), never persisted. Session stems are opaque strings (`sessionPool.ts`); a pruned-model `.kvs` is simply unreachable, never parsed through the registry. `SettingsScreen.tsx:977` `const active = MODEL_REGISTRY.find((m) => m.id === model.currentModelId); if (active) {…}` — guarded.

**3. Bugs — none crash-level.**
- `recommendedModelId` null → single consumer guarded (above). **REFUTED** as a crash.
- `getModelById` fallback → guarded at the only classification site (`llamaContextGate.ts:99`); `isHybridOrKvUnifiedModel` deliberately returns false for unknown (`ModelRegistry.ts:322-324`). **REFUTED**.
- Exactly-one invariant: tested, passes. **CONFIRMED** tested.

**4. Hardcode regressions — one leftover.**
- `src/telemetry/pure.ts:93`: `if (id.includes("moe") || id.includes("mixtral") || id.includes("a0.")) { return "moe"; }` — the only remaining `id.includes` heuristic in a production module, sitting 3 lines above the new registry lookup it contradicts. It's arch-name sniffing (not catalog ids), and `a0.` is vestigial (matches nothing in current catalog). Scope judgment: violates the *letter* of the hard rule. **NIT.**
- `deviceTuning.ts:272` `id.includes("sdk_gphone")` — device ID emulator check, not a model catalog id. Clean.
- No `switch(tier)`, no model allowlists anywhere in `src/engine` or Settings.

**5. Orphans — clean.** No dead i18n refs; `default` single; removed-model sessions/downloads orphaned but harmless (see M1).

**6. Test hygiene.**
- No test references removed ids. Env save/restore present (`benchAggregateHarness.mjs:342-351`, `memoryTelemetryHarness.mjs:377-390`).
- `ModelRegistry.test.ts:19`: `expect(MODEL_REGISTRY.every((model) => model.canStreamExperts !== true)).toBe(true);` — pins the ABSENCE of MoE capability. The field exists precisely for a future MoE entry; that legitimate catalog edit breaks this pin. Over-broad. **NIT.**
- `modelGateRAM.test.ts` streaming-path coverage now uses only synthetic fixtures; no real entry exercises `canStreamExperts` → production `shouldStreamModel` (`modelGateRAM.ts:81` `if (input.canStreamExperts !== true) return false;`) is dead until a MoE model returns. Deliberate prune consequence; code kept is honest. **NIT.**

**7. Native — untouched. CONFIRMED.**

## Must-fix

- **M1 — Orphaned on-device downloads of pruned models are undeletable (disk leak).** `ModelDownloader.ts:17 const MODELS_DIR = \`${FileSystem.documentDirectory ?? ""}models/\`;` — the dir is never enumerated or swept; `deleteModelFiles` (`:434`) has **no production caller** (Settings has no model-delete UI at all; it iterates `MODEL_REGISTRY` only, `SettingsScreen.tsx:2153`). A user who downloaded `qwen3.5-2b`/`gemma-4-e2b`/`lfm2.5-8b*` before this prune keeps 1.3–5.2 GB of dead GGUF forever with no UI path to remove it. Not a crash — but the prune makes it permanent. Mitigation: boot-time sweep of `models/` subdirs whose id ∉ MODEL_REGISTRY (+ `whisper-tiny`, `multilingual-e5-small`), or a delete affordance. Flagged per angle-1 instruction; mechanics **CONFIRMED**, impact product-level.

## Nits

- **N1** `telemetry/pure.ts:93` leftover `id.includes("moe") || id.includes("mixtral") || id.includes("a0.")` — vestigial `a0.`, inconsistent with the registry path beside it.
- **N2** `ModelRegistry.test.ts:19` `canStreamExperts !== true` absence-pin is too broad (see angle 6).
- **N3** CI default asymmetry: `ci-bench.sh`/`ci-e2e.sh` default `qwen3.5-4b`; `ci-screens.sh:11` defaults `lfm2.5-2.6b` — plausible intent, undocumented.
- **N4** Report §4 net-diff table lists only 2 files while the C1/C2 blast radius (ModelRegistry, contextProfile, llamaContextGate, deviceTuning, i18n en/it, benchPreflight, ci-bench, 4 harnesses, 2 workflows, Settings-dependent tests) is attributed to "Luna" verbally. Documentation gap, not a code defect.
- **N5** Report's "stale jest transform cache" explanation for `sessionKey.test.ts` — process claim, **PLAUSIBLE** (unverifiable post-hoc); end state correct.

## Bottom line

Implementation matches the shipped outline and the hard rule: recommendations, gates, bench preflight, and CI are registry/field-driven; no scattered ids, no size heuristics in engine/Settings paths; stale-id paths are null-safe; typecheck + 360/360 + harnesses independently re-verified; native clean. No must-fix code defects in the C1/C2 diff itself. **M1** (orphaned-download disk leak) is the only must-fix-worthy finding and it is a product consequence of the prune, not a bug in the new logic.