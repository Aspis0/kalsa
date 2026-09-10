# C1 — Catalog Hardcode Map

> **Agent**: MiMo | **Date**: 2026-09-05 | **Branch**: `feat/moe-stream`  
> **Repo**: `/Users/marco/Projects/kalsa`  
> **Hard Rule** (Marco): NO scattered hardcoded model IDs. Catalog/RAM/recommendations must stay easy to change. This map FINDs every hardcode so the implementer can collapse them into declarative registry/config — NOT propose more string switches.

---

## 1. MODEL_REGISTRY inventory (source of truth)

All entries live in `src/engine/ModelRegistry.ts`. Two standalone models sit outside the array.

### 1a. LLM catalog — `MODEL_REGISTRY` array (`:90-403`)

| # | id | vendor | quant | sizeBytes | mmproj | hybrid | kvUnified | mtp | canStream | loadPolicy | minRamTier | default | i18n key | file:line |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `qwen3.5-4b` | Alibaba | Q4_K_M | 2.83 GB | ✅ mmproj-F16 (672 MB, separate repo) | ✅ | ✅ | {nMax:3} | — | default | `"high"` | ✅ `true` | `models.qwen4b.*` | `:158-197` |
| 2 | `qwen3.5-4b-q3` | Alibaba | Q3_K_M | 2.37 GB | ✅ mmproj-F16 (672 MB, separate repo) | ✅ | ✅ | — | — | default | `"mid"` | — | `models.qwen4bQ3.*` | `:198-232` |
| 3 | `gemma-4-e2b` | Google | Q4_K_M | 3.11 GB | ✅ mmproj-F16 (986 MB) | — | — | — | — | `{mmap:true, repack:false}` | — | — | `models.gemmaE2b.*` | `:234-256` |
| 4 | `qwen3.5-2b` | Alibaba | Q4_K_M | 1.28 GB | — | ✅ | ✅ | — | — | default | `"low"` | — | `models.qwen2b.*` | `:258-290` |
| 5 | `lfm2.5-2.6b` | Liquid AI | QAD-Q4_0 | 1.59 GB | — | ✅ | — | — | — | default | — | — | `models.lfm25.*` | `:292-313` |
| 6 | `lfm2.5-8b-a1b` | Liquid AI | Q4_K_M | 5.16 GB | — | ✅ | — | — | ✅ | `{mmap:true, repack:false}` | — | — | `models.lfm258b.*` | `:315-344` |
| 7 | `lfm2.5-8b-a1b-kexp` | Liquid AI | KEXP | 3.33 GB | — | ✅ | — | — | ✅ | `{mmap:false, repack:true}` | — | — | `models.lfm258b.*` | `:345-403` |

**Standalone utility models** (NOT in `MODEL_REGISTRY`, separate download paths):

| id | vendor | sizeBytes | file:line | Notes |
|---|---|---|---|---|
| `whisper-tiny` | OpenAI/ggerganov | 77 MB | `:409-421` | ASR, Settings → Voice |
| `multilingual-e5-small` | intfloat/keisuke-miyako | 132 MB | `:445-460` | Embedding, optional Settings |

**Key fields on ModelInfo** (type at `:37-155`):
- `id`, `name`, `vendor`, `quant`, `hfRepo`, `revision`, `file`, `sizeBytes` — identity + download
- `mmproj?: ModelFileSpec` — vision projector (absent = text-only)
- `contextLength`, `engineCtx`, `kvCache` — runtime config
- `hybrid?`, `kvUnified?` — architecture flags (Qwen3.5 family)
- `mtp?` — speculative decoding capability
- `thinking?`, `preserveThinking?` — thinking budget + KV persistence
- `canStreamExperts?`, `streamingResident?` — MoE expert streaming (lfm2.5-8b*)
- `loadPolicy?: LoadPolicy` — mmap/repack override
- `descriptionKey`, `ramBadgeKey?`, `minRamTier?` — i18n + RAM tier advisory
- `kvBytesPerToken?`, `weightsBytesPerToken?` — measured pricing fields
- `default?: boolean` — catalog default (`qwen3.5-4b` is the only one)

### 1b. Owner keep/remove intent vs on-disk state

| id | Owner intent | On-disk today | Action needed |
|---|---|---|---|
| `qwen3.5-4b` | **KEEP** (high tier) | ✅ present, `default: true` | None |
| `qwen3.5-4b-q3` | **TBD** (mentioned as potentially remove) | ✅ present, `minRamTier: "mid"` | Decision required |
| `gemma-4-e2b` | **REMOVE** | ✅ present | Delete registry entry + i18n keys + blast radius |
| `qwen3.5-2b` | **REMOVE** | ✅ present, `minRamTier: "low"` | Delete + retarget low-tier recommendation |
| `lfm2.5-2.6b` | **KEEP** (low/mid tier) | ✅ present | Will become low/mid recommendation |
| `lfm2.5-8b-a1b` | **TBD** (mentioned as potentially remove) | ✅ present | Decision required |
| `lfm2.5-8b-a1b-kexp` | **TBD** (mentioned as potentially remove) | ✅ present | Decision required |
| `lfm2.5-vl-3b` | **ADD** (missing today) | ❌ not present | New registry entry + mmproj + i18n |

---

## 2. Hardcoded ID inventory — every literal model ID string outside ModelRegistry.ts

### 2a. Production code hardcodes

| file:line | id string | role | Risk |
|---|---|---|---|
| `src/engine/contextProfile.ts:88` | `"qwen3.5-4b"` | recommendation (high tier) | **HIGH** — removing this model or changing tier mapping breaks the recommended-model badge |
| `src/engine/contextProfile.ts:90` | `"qwen3.5-4b-q3"` | recommendation (mid tier) | **HIGH** — same; mid-tier recommendation points here |
| `src/engine/contextProfile.ts:92` | `"qwen3.5-2b"` | recommendation (low tier) | **HIGH** — removing this model while it's the low-tier recommendation = dangling ref |
| `src/engine/llamaContextGate.ts:97-98` | `"4b"`, `"2b"` (substring match) | co-residency gate (isChatModel2BClass) | **MEDIUM** — heuristic by substring; `lfm2.5-2.6b` includes `"2b"` but the function checks for `4b` first; fragile if a new model id contains `"2b"` substring (e.g. hypothetical `"3.2b"`) |
| `src/engine/llamaContextGate.ts:104` | `"4b"` (substring match) | isChatModel4BClass | **MEDIUM** — same substring heuristic fragility |
| `src/engine/deviceTuning.ts:633-635` | `"4b"`, `"4B"` (substring match) | thermal guard flag (is4bTier) | **MEDIUM** — same substring fragility; only affects a flag (not enforced today) |

### 2b. Test file hardcodes

| file:line | id string | role | Risk |
|---|---|---|---|
| `src/engine/loadPolicy.test.ts:32` | `"lfm2.5-8b-a1b-kexp"` | test assertion (mmap off) | LOW — tests break on prune but are not user-facing |
| `src/engine/loadPolicy.test.ts:42` | `"gemma-4-e2b"`, `"lfm2.5-8b-a1b"` | test assertion (repack off) | LOW — test for removed models |
| `src/engine/loadPolicy.test.ts:135` | `"gemma-4-e2b"`, `"lfm2.5-8b-a1b"` | test filter (exclude from default-policy test) | LOW |
| `src/engine/loadPolicy.test.ts:141-148` | `"lfm2.5-8b-a1b-kexp"`, `"gemma-4-e2b"`, `"lfm2.5-8b-a1b"` | test assertions (mmap off only on kexp) | LOW |
| `src/engine/modelHost.test.ts:6` | `"lfm2.5-2.6b"` | test fixture | LOW |
| `src/engine/modelHost.test.ts:16` | `"qwen3.5-4b"` | test fixture | LOW |
| `src/engine/modelHost.test.ts:31` | `"lfm2.5-2.6b"` | test fixture | LOW |
| `src/engine/sessionKey.test.ts:29` | `"lfm2.5-8b-a1b-kexp"` | test fixture | LOW |
| `src/engine/sessionKey.test.ts:58` | `"qwen3.5-4b"` | test fixture | LOW |
| `src/engine/sessionKey.test.ts:67-70` | `"qwen3.5-4b"` | legacy session filename tests | LOW |
| `src/engine/modelGateRAM.test.ts:12` | `"lfm2.5-8b-a1b"` | test constant | LOW |
| `src/engine/modelGateRAM.test.ts:61` | `"lfm2.5-8b-a1b"` | test assertion | LOW |
| `src/engine/modelGateRAM.test.ts:129` | `"lfm2.5-8b-a1b-kexp"` | test fixture | LOW |
| `src/engine/ModelDownloader.test.ts:29` | `"lfm2.5-2.6b"` | test fixture | LOW |

### 2c. Script hardcodes

| file:line | id string | role | Risk |
|---|---|---|---|
| `scripts/ci-bench.sh:90` | `"qwen3.5-2b"` | bench default model dir | **MEDIUM** — bench default for removed model; CI bench would break |
| `scripts/ci-bench.sh:261` | `"lfm2.5-2.6b"`, `"lfm2.5-8b-a1b"` | thinking-axis skip condition | **MEDIUM** — needs update if these models change |
| `scripts/ci-bench.sh:273` | `"qwen3.5-4b"` | mmproj sideload comment | LOW — comment only |
| `scripts/benchPreflight.mjs:251` | `"qwen3.5-2b"`, `"qwen3.5-4b"`, `"lfm2.5-2.6b"`, `"lfm2.5-8b-a1b"` | workflow model filter (hardcoded allowlist) | **MEDIUM** — must update when catalog changes |

### 2d. i18n key hardcodes (implicit model IDs via key naming)

| file:line | key pattern | model | Risk |
|---|---|---|---|
| `src/i18n/en.ts:239-243` | `models.qwen4b.*` | qwen3.5-4b | LOW — keyed by short name, not id |
| `src/i18n/en.ts:244-248` | `models.qwen4bQ3.*` | qwen3.5-4b-q3 | LOW |
| `src/i18n/en.ts:249-252` | `models.qwen2b.*` | qwen3.5-2b | **MEDIUM** — removing model requires removing or repurposing these keys |
| `src/i18n/en.ts:253-256` | `models.gemmaE2b.*` | gemma-4-e2b | **MEDIUM** — same |
| `src/i18n/en.ts:257-260` | `models.lfm25.*` | lfm2.5-2.6b | LOW |
| `src/i18n/en.ts:261-264` | `models.lfm258b.*` | lfm2.5-8b-a1b / kexp | LOW |
| `src/i18n/en.ts:265-268` | `models.whisperTiny.*` | whisper-tiny | N/A — utility |
| `src/i18n/it.ts:247-265` | same pattern | same models | Same risk as en.ts |

**Total hardcoded ID sites**: 3 production (contextProfile switch), 2 production (substring heuristics), 12 test, 3 script, 2 i18n files (× 7 keys each).

---

## 3. Blast radius of prune/add

### 3a. Removing `gemma-4-e2b`

| Surface | What to do | File(s) |
|---|---|---|
| Registry entry | Delete from `MODEL_REGISTRY` array | `ModelRegistry.ts:234-256` |
| i18n keys | Remove `models.gemmaE2b.*` | `en.ts:253-256`, `it.ts:247-250` |
| Tests | Update loadPolicy tests (3 sites) | `loadPolicy.test.ts:42,135,147` |
| SettingsScreen | No hardcoded id — iterates `MODEL_REGISTRY` | — |
| Bench scripts | Not in workflow filter | `benchPreflight.mjs:251` (not listed) |
| substring heuristic | `"2b"/"4b"` — gemma-4-e2b would match neither (has `4` but not `4b`) — no impact | — |

### 3b. Removing `qwen3.5-2b`

| Surface | What to do | File(s) |
|---|---|---|
| Registry entry | Delete from `MODEL_REGISTRY` array | `ModelRegistry.ts:258-290` |
| **recommendation** | **Retarget low-tier** in `recommendedModelId()` | `contextProfile.ts:92` — **MUST change before deleting** |
| i18n keys | Remove `models.qwen2b.*` | `en.ts:249-252`, `it.ts:243-246` |
| Tests | No direct test references for `qwen3.5-2b` outside contextProfile | — |
| Bench scripts | Default MODEL_DIR in ci-bench.sh | `ci-bench.sh:90` — **must update** |
| Bench preflight | In workflow filter | `benchPreflight.mjs:251` — **must update** |
| SettingsScreen | `minRamTier` badge shows "Under 6 GB RAM" — needs new low-tier model to display this | `SettingsScreen.tsx:2160-2162` |
| Co-residency gate | `isChatModel2BClass` checks for `"2b"` substring — `lfm2.5-2.6b` already matches this, so no change needed if it becomes low-tier | `llamaContextGate.ts:97-98` |

### 3c. Removing `qwen3.5-4b-q3` (if decided)

| Surface | What to do | File(s) |
|---|---|---|
| Registry entry | Delete from `MODEL_REGISTRY` array | `ModelRegistry.ts:198-232` |
| **recommendation** | **Retarget mid-tier** in `recommendedModelId()` | `contextProfile.ts:90` — **MUST change before deleting** |
| i18n keys | Remove `models.qwen4bQ3.*` | `en.ts:244-248`, `it.ts:239-242` |
| Tests | No direct test references | — |
| Bench scripts | Not in workflow filter | — |

### 3d. Removing `lfm2.5-8b-a1b` (if decided)

| Surface | What to do | File(s) |
|---|---|---|
| Registry entry | Delete from `MODEL_REGISTRY` array | `ModelRegistry.ts:315-344` |
| i18n keys | Shares `models.lfm258b.*` with kexp — if kexp kept, keys stay | `en.ts:261-264`, `it.ts:255-258` |
| Tests | Update loadPolicy tests (4 sites), modelGateRAM test (1 site) | `loadPolicy.test.ts:42,65,135,148`, `modelGateRAM.test.ts:12,61` |
| Bench preflight | In workflow filter | `benchPreflight.mjs:251` — **must update** |
| Bench scripts | Thinking-axis skip | `ci-bench.sh:261` — **must update** |

### 3e. Removing `lfm2.5-8b-a1b-kexp` (if decided)

| Surface | What to do | File(s) |
|---|---|---|
| Registry entry | Delete from `MODEL_REGISTRY` array | `ModelRegistry.ts:345-403` |
| i18n keys | Shares `models.lfm258b.*` — if non-kexp kept, keys stay | — |
| Tests | Update loadPolicy tests (3 sites), modelGateRAM test (1 site), sessionKey test (1 site) | `loadPolicy.test.ts:32,141,146`, `modelGateRAM.test.ts:129`, `sessionKey.test.ts:29` |
| `hfArtifactRepo` | Only model with custom artifact repo — removing eliminates this download path | `ModelRegistry.ts:371` |

### 3f. Adding `lfm2.5-vl-3b` — see §5 below

---

## 4. Additional blast radius notes

### 4a. Substring heuristic fragility

The co-residency gate (`llamaContextGate.ts:94-104`) and thermal flag (`deviceTuning.ts:633-635`) use **substring matching** on model IDs to classify size:

```typescript
// isChatModel2BClass — checks id.includes("2b"), rejects if id.includes("4b")
// isChatModel4BClass — checks id.includes("4b")
// resolveThermal — checks id.includes("4b") || id.includes("4B")
```

This works for today's catalog but is fragile:
- `lfm2.5-2.6b` matches `"2b"` → classified as 2B-class ✅ (correct today)
- A hypothetical `lfm2.5-3.2b` would match `"2b"` → misclassified ❌
- `lfm2.5-8b-a1b` contains `"8b"` → neither 2B nor 4B → classified as neither (default is false) — this is correct for co-residency (8B never co-resides)

**Recommendation for implementer**: These substring checks should ideally read a declared field from ModelInfo (e.g. `sizeClass: "2B" | "4B" | "8B"`) rather than parsing the id string.

### 4b. ModelDownloader — no hardcoded ids

`src/engine/ModelDownloader.ts` reads all model info from the `ModelInfo` parameter passed to it. No hardcoded model IDs. ✅

### 4c. AppShell model iteration — no hardcoded ids

`src/screens/SettingsScreen.tsx:2153` renders `MODEL_REGISTRY.map(...)` — dynamically iterates the array. No hardcoded model list. ✅

### 4d. Embedding/Whisper — separate constants

`WHISPER_MODEL` and `EMBEDDING_MODEL` are standalone exported constants, not in `MODEL_REGISTRY`. They are imported by name in `AppShell.tsx:53` and `EmbeddingService.ts:37`. Removing or adding LLM models does not affect them. ✅

---

## 5. What would be needed to ADD `lfm2.5-vl-3b`

This model is NOT on disk today. The scout doc confirms it must be added. Here is what's needed:

### 5a. Registry entry fields (UNKNOWN = not verifiable from current codebase)

| Field | Value | Source |
|---|---|---|
| `id` | `"lfm2.5-vl-3b"` | Owner intent |
| `name` | `"LFM2.5 VL 3B"` | Convention |
| `vendor` | `"Liquid AI"` | Same vendor as lfm2.5-2.6b |
| `quant` | **UNKNOWN** — need to find a GGUF quant on HF | Must check `LiquidAI/LFM2.5-VL-3B-GGUF` or similar |
| `hfRepo` | **UNKNOWN** — need exact HF repo name | Must check if LiquidAI publishes GGUF for this model |
| `revision` | **UNKNOWN** — pinned SHA | Must pin after finding the repo |
| `file` | **UNKNOWN** — GGUF filename | Must check repo contents |
| `sizeBytes` | **UNKNOWN** — exact download size | Must get from HF API |
| `mmproj` | **REQUIRED** — this is a vision model | Must find the mmproj GGUF file + size + revision |
| `contextLength` | **UNKNOWN** — likely 131072 (matches lfm2.5 family) | Must verify from model card or GGUF header |
| `engineCtx` | 8192 (convention for new models) | Pattern from other lfm2.5 entries |
| `kvCache` | `{ k: "q8_0", v: "q4_0" }` (convention) | Pattern from lfm2.5-2.6b |
| `hybrid` | **UNKNOWN** — need to verify architecture | LiquidAI models are typically hybrid |
| `kvUnified` | **UNKNOWN** | Need to check |
| `thinking` | `{ short: 256, extended: 512 }` (convention) | Pattern from lfm2.5-2.6b |
| `preserveThinking` | `true` (convention for lfm2.5) | Pattern from lfm2.5-2.6b |
| `descriptionKey` | `"models.lfm25vl3b.description"` (new key) | Must add to en.ts + it.ts |
| `ramBadgeKey` | Possibly `"models.lfm25vl3b.ramBadge"` | If part of tier scheme |
| `minRamTier` | **UNKNOWN** — owner must decide tier | 3B with vision → probably mid? |
| `default` | `false` | Only qwen3.5-4b is default today |
| `weightsBytesPerToken` | **UNKNOWN** — needs tensor map or measurement | Cannot fabricate |
| `kvBytesPerToken` | **UNKNOWN** — needs on-device measurement | Cannot fabricate |
| `loadPolicy` | **UNKNOWN** — need to test on device | 3B dense probably default ok |
| `canStreamExperts` | **UNKNOWN** — is this MoE? | Need to check architecture |
| `streamingResident` | **UNKNOWN** — needs phone measurement | Cannot fabricate |

### 5b. Additional work for `lfm2.5-vl-3b`

1. **i18n keys**: Add `models.lfm25vl3b.description` (and optionally `.ramBadge`) to `en.ts` and `it.ts`
2. **Tier recommendation**: Decide where it fits in the RAM tier scheme (owner said low/mid → LFM, high → Qwen; 3B vision model might be a "mid" option or a standalone)
3. **mmproj download path**: The existing `ModelDownloader` already handles `mmproj` downloads (`:426`) — no code change needed, just the field populated correctly
4. **Tests**: Add at least one test entry in `loadPolicy.test.ts` if the model has a non-default load policy
5. **Bench preflight**: Add to `benchPreflight.mjs:251` workflow filter if it should be benchable

---

## 6. Data-driven design sketch (no code)

### Problem

Today, **recommendations and visibility are hardwired in switch/if-else chains and substring heuristics**, not driven by ModelInfo fields. Changing the catalog requires editing:

1. `MODEL_REGISTRY` array (the easy part)
2. `recommendedModelId()` switch statement (contextProfile.ts:85-96)
3. `isChatModel2BClass()` / `isChatModel4BClass()` substring checks (llamaContextGate.ts:94-104)
4. `resolveThermal()` substring check (deviceTuning.ts:633-635)
5. `benchPreflight.mjs:251` hardcoded filter array
6. `scripts/ci-bench.sh:90` default model dir
7. i18n key objects (en.ts, it.ts)

This violates the hard rule. The implementer should collapse (2)–(6) into fields on ModelInfo or a small declarative config.

### Proposed ModelInfo field additions

```typescript
// NEW FIELDS on ModelInfo (add to the type at ModelRegistry.ts:37-155):

/**
 * Advisory: which RAM tiers recommend this model. Empty/absent = not part of
 * the recommendation scheme (e.g. Gemma, Whisper). Replaces the switch in
 * recommendedModelId() and the hardcoded minRamTier.
 */
recommendForTiers?: RamTier[];

/**
 * Whether this model appears in the Settings model list. false = hidden from
 * user selection but still downloadable programmatically (e.g. utility models,
 * or models kept for backward-compat but not promoted). Replaces the
 * workflow filter in benchPreflight.mjs.
 */
listed?: boolean;

/**
 * When this model replaces another (e.g. lfm2.5-2.6b replaces qwen3.5-2b
 * for low-tier), record the old id so migration logic can find it.
 * Absent = no predecessor.
 */
replaces?: string;

/**
 * Explicit size class for gates that today use substring matching.
 * "2B" | "4B" | "8B" | "other". Replaces isChatModel2BClass / isChatModel4BClass
 * substring heuristics and resolveThermal's id.includes("4b") check.
 */
sizeClass?: "2B" | "4B" | "8B" | "other";
```

### How each hardcode site collapses

| Today's hardcode | Replaced by | Mechanism |
|---|---|---|
| `recommendedModelId()` switch | `recommendForTiers` field | `MODEL_REGISTRY.filter(m => m.recommendForTiers?.includes(tier))` — pick the one (or first) that matches |
| `isChatModel2BClass()` substring | `sizeClass === "2B"` | Direct field read, no string parsing |
| `isChatModel4BClass()` substring | `sizeClass === "4B"` | Direct field read |
| `resolveThermal()` `id.includes("4b")` | `sizeClass === "4B"` | Direct field read |
| `benchPreflight.mjs:251` filter | `listed: true` | `MODEL_REGISTRY.filter(m => m.listed !== false)` |
| `ci-bench.sh:90` default MODEL_DIR | `m.default === true` in registry | Script reads the `default` model from a JSON dump or env |
| i18n `models.gemmaE2b.*` keys | Tied to registry entry via `descriptionKey` | Deleting the registry entry means the i18n key is dead; grep to clean up |

### Resulting catalog example (conceptual)

```typescript
// After refactor, an entry would look like:
{
  id: "lfm2.5-2.6b",
  // ... existing fields ...
  sizeClass: "2B",
  recommendForTiers: ["low", "mid"],  // replaces the switch cases
  listed: true,
  // no `replaces` — this is the keeper
}
```

Adding or removing a model then means: edit one entry in `MODEL_REGISTRY`. The recommendation engine, co-residency gate, thermal flag, bench filter, and Settings iteration all read the fields — no switch cases to hunt.

---

## 7. `native/kalsallama.pin` — pinned SHA/branch

```
{
  "repo": "https://github.com/Aspis0/kalsallama.git",
  "branch": "main",
  "commit": "a0cabca6b1b3248a92e05a8633fd0d82cf776e75"
}
```

- **Repo**: `Aspis0/kalsallama` (GitHub)
- **Branch**: `main`
- **Commit**: `a0cabca6b1b3248a92e05a8633fd0d82cf776e75`

### App hardcodes assuming a specific native SHA

**None found.** The app reads `native/kalsallama.pin` at build time via `scripts/sync-kalsallama.sh:9` which resolves `$ROOT/native/kalsallama.pin`. No source file in `src/` or `app/` contains the literal SHA `a0cabca` or hardcodes a kalsallama commit. The pin file is the single source of truth. ✅

The `vendor/kalsallama-cpp` directory is the build artifact of the sync script, not referenced by string in JS/TS source.

---

## Summary of findings

| Category | Count | Severity |
|---|---|---|
| Production hardcodes (switch/heuristic) | **5 sites** (3 string literals + 2 substring patterns) | **HIGH** — changing catalog breaks recommendations and gates |
| Test hardcodes | **14 sites** | LOW — tests break but are not user-facing |
| Script hardcodes | **5 sites** (ci-bench default, filter arrays) | **MEDIUM** — CI breaks on prune |
| i18n key objects | **2 files × 7 keys** (en + it) | **MEDIUM** — dead keys on prune |
| native SHA assumption in app | **0** | ✅ clean |
| ModelDownloader / SettingsScreen hardcoded ids | **0** | ✅ clean |

**The critical path**: The 3 string literals in `contextProfile.ts:88-92` (the recommendation switch) and the 2 substring heuristics in `llamaContextGate.ts:94-104` are the highest-risk hardcodes. These MUST be collapsed into ModelInfo fields before any model is pruned from the catalog — otherwise the recommendation and co-residency systems break silently.
