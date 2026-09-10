# C2 — RAM Tiers + Data-Driven Recommendation Map

**Repo:** `feat/moe-stream` · **Date:** 2026-09-05 · **Status rule:** LOT-STATUS.md — NO scattered hardcodes; catalog/RAM easy to change.

---

## 1. Current Thresholds (verbatim)

**File:** `src/engine/contextProfile.ts`

```ts
export type RamTier = "low" | "mid" | "high";

export const RAM_MID_BYTES = 5_400_000_000;          // line 61
export const RAM_TIER_HIGH_BYTES = 6_900_000_000;    // line 63
```

**Classification** (lines 72–78):

```ts
export function getRamTier(totalBytes: number | null): RamTier {
  if (typeof totalBytes !== "number" || !Number.isFinite(totalBytes) || totalBytes <= 0) {
    return "low";
  }
  if (totalBytes >= RAM_TIER_HIGH_BYTES) return "high";
  if (totalBytes >= RAM_MID_BYTES) return "mid";
  return "low";
}
```

---

## 2. The Hardcoded Switch (primary target)

**File:** `src/engine/contextProfile.ts`, lines 85–94:

```ts
export function recommendedModelId(tier: RamTier): string {
  switch (tier) {
    case "high":
      return "qwen3.5-4b";
    case "mid":
      return "qwen3.5-4b-q3";
    case "low":
      return "qwen3.5-2b";
  }
}
```

**Owner intent:** low/mid → lfm2.5-2.6b (or VL later); high → qwen3.5-4b. The current switch still embeds the qwen3.5 fallback chain as the only recommendations.

---

## 3. Every Consumer

### 3a. SettingsScreen badge (UI advisory only)

**File:** `src/screens/SettingsScreen.tsx`

- **Line 47:** imports `recommendedModelId`
- **Line 934:** `const deviceRamTier = deviceTotalMemoryBytes !== null ? getRamTier(deviceTotalMemoryBytes) : null;`
- **Line 935:** `const recommendedModel = deviceRamTier !== null ? recommendedModelId(deviceRamTier) : null;`
- **Lines 2157–2162:** Compares `entry.id === recommendedModel` to show green "Recommended" badge; uses `entry.minRamTier` + `ramTierMeets()` to show tier-exceeded warnings.

### 3b. DeviceProfile gate (load path)

**File:** `src/engine/deviceProfile.ts`

- **Line 175:** `if (modelMinRamTier !== undefined && !ramTierMeets(ramTier, modelMinRamTier))` → `blocked_tier`
- **Line 640:** `ramTier: getRamTier(totalMemoryBytes)` (process-cached profile)
- **Line 665:** `ramTier: getRamTier(null)` (unknown RAM fallback)

### 3c. useProcessHealth

**File:** `src/hooks/useProcessHealth.ts`

- **Line 77:** `fitTier: totalMemoryBytes != null ? getRamTier(totalMemoryBytes) : null`
- **Line 127:** Same pattern in the health polling path.
- Used only for telemetry / health display; no engine decision.

### 3d. Telemetry (pure, no engine impact)

**File:** `src/telemetry/pure.ts`

- **Lines 52–58:** `deviceBucketFromRamTier()` maps tier → telemetry bucket (1:1). Pure function, no model id logic.

### 3e. llamaContextGate (heuristic, NOT registry)

**File:** `src/engine/llamaContextGate.ts`

- **Lines 91–106:** `isChatModel2BClass()` / `isChatModel4BClass()` use **string heuristics** (`id.includes("4b")` / `id.includes("2b")`). These are NOT wired to the registry — a model named `lfm2.5-2.6b` would match `2b` by accident. This is a separate hardcode smell but NOT in the tier-recommendation path.

---

## 4. ModelInfo — Existing Tier Fields

**File:** `src/engine/ModelRegistry.ts`

`ModelInfo` already carries:

| Field | Type | Set on | Purpose |
|---|---|---|---|
| `minRamTier` | `RamTier?` | qwen3.5-4b (`"high"`), qwen3.5-4b-q3 (`"mid"`), qwen3.5-2b (`"low"`) | Advisory gate: device below this tier → `blocked_tier` in deviceProfile + Settings badge |
| `ramBadgeKey` | `TranslationKey?` | Same three models | "8 GB+ RAM" badge text in Settings |

**Not set** on: gemma-4-e2b, lfm2.5-2.6b, lfm2.5-8b-a1b, lfm2.5-8b-a1b-kexp, whisper-tiny, multilingual-e5-small.

---

## 5. Anti-Hardcode Design (primary deliverable)

### 5a. Proposed: add `recommendForTiers` to ModelInfo

```ts
export type ModelInfo = {
  // ...existing fields...

  /**
   * RAM tiers this model is the RECOMMENDED choice for (advisory badge).
   * Empty/absent → not recommended for any tier.
   *
   * A model can be recommended for multiple tiers (e.g. a future VL model
   * that works well on both low and mid). The first match wins in the badge
   * when two models claim the same tier — that is a testable invariant:
   *   INVARIANT: every RamTier has exactly one model with that tier in
   *   recommendForTiers (unless C1 prune removes the tier).
   *
   * Changing which model is recommended for a tier = edit one field in one
   * registry entry. No switch, no map, no import of model id strings.
   */
  recommendForTiers?: RamTier[];

  // minRamTier already exists — keep it; it gates downloads,
  // recommendForTiers guides the badge. Orthogonal concerns.
};
```

### 5b. Rewritten `recommendedModelId` becomes a pure registry function

```ts
// contextProfile.ts — replaces the current switch

import { MODEL_REGISTRY } from "./ModelRegistry";

/**
 * Advisory recommended model id for a RAM tier.
 * Pure function over MODEL_REGISTRY — no hardcoded model ids.
 *
 * INVARIANT: for each RamTier, exactly one MODEL_REGISTRY entry
 * declares that tier in its recommendForTiers (tested).
 */
export function recommendedModelId(
  tier: RamTier,
  registry = MODEL_REGISTRY,
): string | null {
  const match = registry.find(
    (m) => m.recommendForTiers?.includes(tier),
  );
  return match?.id ?? null;
}
```

### 5c. Fields to add to registry entries

| Model id | `recommendForTiers` | `minRamTier` (keep) | Rationale |
|---|---|---|---|
| `qwen3.5-4b` | `["high"]` | `"high"` | Owner intent: high-RAM primary |
| `qwen3.5-4b-q3` | (none — **remove from recommendations**) | `"mid"` | Or keep `["mid"]` if still primary mid |
| `qwen3.5-2b` | (none — **remove from recommendations**) | `"low"` | Or keep `["low"]` if still primary low |
| `lfm2.5-2.6b` | `["low", "mid"]` | — | Owner intent: low/mid primary going forward |

**Note:** Setting `recommendForTiers: ["low", "mid"]` on lfm2.5-2.6b while keeping qwen3.5-2b with `["low"]` creates a two-model-per-tier state. The test invariant (§5d) should assert **at most one** per tier in production, or document which is primary/alt. This is a product decision — the mechanism supports either.

### 5d. Test invariant (must-add)

```ts
// ModelRegistry.test.ts (new)

describe("RAM-tier recommendation invariant", () => {
  it("every RamTier has at least one recommendable model", () => {
    const tiers: RamTier[] = ["low", "mid", "high"];
    for (const tier of tiers) {
      const candidates = MODEL_REGISTRY.filter(
        (m) => m.recommendForTiers?.includes(tier),
      );
      expect(candidates.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("no tier has more than one recommended model (primary uniqueness)", () => {
    const tiers: RamTier[] = ["low", "mid", "high"];
    for (const tier of tiers) {
      const candidates = MODEL_REGISTRY.filter(
        (m) => m.recommendForTiers?.includes(tier),
      );
      // Adjust threshold if alt models are intentionally per-tier
      expect(candidates.length).toBeLessThanOrEqual(1);
    }
  });
});
```

---

## 6. Files That Must STOP Embedding Id Strings

| File | Hardcoded id | Must become |
|---|---|---|
| `src/engine/contextProfile.ts:88–92` | `"qwen3.5-4b"`, `"qwen3.5-4b-q3"`, `"qwen3.5-2b"` in `recommendedModelId` switch | Pure registry query (§5b) |
| `src/engine/llamaContextGate.ts:91–106` | `isChatModel2BClass` / `isChatModel4BClass` use `id.includes("2b")` / `id.includes("4b")` heuristics | Either add a `weightClass: "2B" | "4B"` field to ModelInfo, or keep as heuristic but document it as intentionally not-registry (acceptable if co-residency gate is the only consumer). |
| `src/engine/contextProfile.ts:52–54` | Comment block documents the old switch mapping | Update comment to point at registry |

**Test files** (`sessionKey.test.ts`, `modelHost.test.ts`) using `"qwen3.5-4b"` as fixture strings are fine — they test the session-key / host-resolver machinery, not the tier system. Changing the fixture id would test nothing new.

---

## 7. Migration Hazards

| Hazard | Risk | Mitigation |
|---|---|---|
| **Users who already downloaded removed models** | If qwen3.5-4b-q3 is de-recommended, existing downloads sit on disk. Settings still shows them (MODEL_REGISTRY includes them). No breakage — they just lose the "Recommended" badge. | No action needed; keep entries in MODEL_REGISTRY. |
| **Dangling AsyncStorage selected model id** | User selected `qwen3.5-4b-q3` before it was de-recommended. On upgrade, `model.currentModelId` still points at it. Engine loads it fine (entry still in registry). Badge disappears. | Safe. If later the entry is fully removed from registry (C1 prune), add a fallback to `MODEL_REGISTRY[0].id` when stored id is not found. |
| **Benchmarks that pin model ids** | Bench scripts / test harnesses may reference `"qwen3.5-4b"` literally. Changing the recommendation does NOT change the id — the entry stays in registry. | No action needed for C2. C1 prune of entries must audit bench refs. |
| **`recommendedModelId` now returns `string | null`** | Current callers (SettingsScreen) already null-check. `useProcessHealth` does not call it. `deviceProfile` does not call it. | Safe. Add null guard at call site (already present: `deviceRamTier !== null ? recommendedModelId(...) : null`). |
| **`recommendForTiers` not set on non-qwen models** | After refactor, `recommendedModelId("low")` returns null if no entry claims `"low"`. Settings badge vanishes. | MUST set `recommendForTiers` on at least one model per tier before merging the refactor. The test invariant catches this. |

---

## 8. Minimal Patch Set Table

| # | Scope | Files | Can ship without C1? | Depends on C1? |
|---|---|---|---|---|
| **P1** | Add `recommendForTiers?: RamTier[]` to `ModelInfo` | `ModelRegistry.ts` | ✅ Yes | No |
| **P2** | Populate `recommendForTiers` on existing qwen3.5 entries + lfm2.5-2.6b | `ModelRegistry.ts` | ✅ Yes | No |
| **P3** | Rewrite `recommendedModelId` as registry query | `contextProfile.ts` | ✅ Yes | No |
| **P4** | Add invariant tests | `ModelRegistry.test.ts` (new) | ✅ Yes | No |
| **P5** | Update SettingsScreen: `recommendedModel` already null-safe; verify no id-string imports | `SettingsScreen.tsx` | ✅ Yes | No |
| **P6** | Optionally add `weightClass` to ModelInfo, replace llamaContextGate heuristics | `ModelRegistry.ts`, `llamaContextGate.ts` | ✅ Yes (standalone) | No |
| **P7** | C1 prune: remove de-recommended entries from MODEL_REGISTRY entirely | `ModelRegistry.ts` + bench audit + AsyncStorage migration | ❌ Blocked by C1 | Yes |
| **P8** | AsyncStorage fallback: if stored model id not in registry → fallback to `default` entry | Model load path | ❌ Blocked by C1 | Yes (only matters if entries are removed) |

**P1–P5 can ship as a single commit.** No entry is removed, no user-visible behaviour changes except the badge now points at whichever model declares the tier.

---

## 9. Summary

The current `recommendedModelId` is a 9-line switch that hardcodes three model ids. The fix is mechanical:

1. **One new optional field** (`recommendForTiers`) on `ModelInfo`.
2. **One function rewrite** (`recommendedModelId` → registry query).
3. **One new test** (invariant: every tier has ≥1 recommendable model).
4. **Zero new hardcoded maps** — changing a recommendation = edit one `recommendForTiers` array in one registry entry.

The thresholds (`RAM_MID_BYTES`, `RAM_TIER_HIGH_BYTES`) and `getRamTier()` are fine as-is — they encode physical device classification, not model identity. The `minRamTier` field on ModelInfo already does the gate correctly. The only hardcode is the tier→id binding in `recommendedModelId`, and that is exactly what P1–P5 eliminate.
