# C1/C2 Kalsallama–Governor Map

**Date:** 2026-09-05
**Mode:** READ-ONLY recon
**App:** `/Users/marco/Projects/kalsa` — `native/kalsallama.pin` → main @ `a0cabca6b`
**Governor worktree:** `/Users/marco/Projects/kalsallama-wt-governor` — branch `kalsa/governor-v0.2`

---

## 1. Pin vs Governor Worktree

**Production pin** (`native/kalsallama.pin`):
```json
{
  "repo": "https://github.com/Aspis0/kalsallama.git",
  "branch": "main",
  "commit": "a0cabca6b1b3248a92e05a8633fd0d82cf776e75"
}
```

**Vendor SHA** on disk (`vendor/kalsallama-cpp/VENDOR_SHA`):
```
a0cabca6b1b3248a92e05a8633fd0d82cf776e75
```

✅ **Pin and vendor match.** The sync script (`scripts/sync-kalsallama.sh`) enforces this: `overlay` mode asserts `VENDOR_SHA == PIN_COMMIT` before rsync.

**Governor worktree HEAD:**
```
1a33da0f6 test(governor): cover runtime wrapper callbacks
```
Branch `kalsa/governor-v0.2`. The common ancestor is `a0cabca6b` — the governor branch diverges **from** the production pin.

**Governor commits ahead of production** (20 commits, linear):
```
1a33da0f6 test(governor): cover runtime wrapper callbacks
fb67821b8 fix(governor): repair thermal exit boundaries
06171a51f fix(governor): partition admitted token batches safely
e5adc86ab test(governor): add v0.2 router golden tests
f7bb1369a feat(governor): implement tri-engine runtime contract v0.2
204e78259 docs: KALSA_FORK.md — governor-v0 pushed at cff0a4a75
cff0a4a75 docs: KALSA_FORK.md — do not self-pin HEAD hash
578f20840 docs: KALSA_FORK.md — record cann-off tip 3cfe5ddab
3cfe5ddab ci: stop auto-running Huawei CANN workflow on this fork
4c7101af4 docs: KALSA_FORK.md — branch map, two lineages, hexagon skels
556118a08 mtmd-cli: unconditional phase timing line for measurement cells
5c3979438 feat(governor): add cross-backend benchmark and honest transfer stats
21d6ecc7d feat(governor): route phases across devices
1bfd144a2 fix(governor): bound staged graph cache
1bb3c24a0 feat(governor): stage transposed V commits
479eae4a2 tests: account exact hybrid commit bytes
58ece1a41 tests: fix hybrid handoff count oracle
91877a18f governor: support hybrid memory handoff
3551c3d55 governor: count graph builds by ubatch
7349b4b3e governor: add attach-once instrumentation
```

**Key implication:** Governor v0.2 is NOT in production yet. The vendor tree on main has no governor files. All governor source lives only in the worktree branch.

---

## 2. Governor Public Surface — Model Load/Routing

### What the governor knows: **arch enums, not model IDs**

The governor's public API accepts two `llama_model *` pointers plus `llama_governor_params`. The params struct (`src/llama-ext.h:199-227`) carries:

```cpp
struct llama_governor_params {
    llama_governor_generation generation;   // Unknown | NoHTP | V73 | V75 | V79
    llama_governor_model_kind model_kind;   // Unknown | Dense | Hybrid | MoE
    llama_governor_fit gpu_fit;             // Unknown | NotFit | Fit
    llama_governor_fit npu_fit;             // Unknown | NotFit | Fit
    bool htp_trunk_readable;
    bool htp_experts_readable;
    bool npu_lane_enabled;
    bool gpu_prefill_measured;
    bool cool_prefill_eligible;
    bool cool_delta_measured;
    bool kexp_cool_scope;
    llama_governor_cool_pays cool_pays;     // Unknown | No | Yes
    bool reload_budget_available;
    float admission_margin_c;
    uint64_t cache_budget_bytes;
    uint64_t expert_cycle_bytes;
    float expert_substitution_lambda;
};
```

**The governor never sees model IDs, file paths, or HF repo names.** It operates on:
- `llama_model *` (opaque pointer — the model is already loaded)
- `llama_governor_model_kind` — an arch-category enum (`Dense`, `Hybrid`, `MoE`)
- `llama_governor_generation` — a device-generation enum (SoC class)
- Capability booleans (`gpu_fit`, `cool_prefill_eligible`, etc.)

The policy (`src/llama-governor-policy.h:33`) uses `model_kind` in exactly two places:
- `prefill_engine()` (line 54-55): checks `V73 + MoE + cool_prefill_eligible + gpu_fit` for GPU_COOLMODE
- `select_decode()` (line 110-111): same `V73 + MoE` gate

**The governor is model-agnostic.** It routes based on architecture class and thermal state, never by model identity.

### Public surface file:line references

| Symbol | File | Line |
|---|---|---|
| `llama_governor_params` struct | `src/llama-ext.h` | 199-227 |
| `llama_governor_model_kind` enum | `src/llama-ext.h` | 161-166 |
| `llama_governor_generation` enum | `src/llama-ext.h` | 153-159 |
| `llama_governor_engine` enum | `src/llama-ext.h` | 146-151 |
| `llama_governor_fit` enum | `src/llama-ext.h` | 168-173 |
| `llama_governor_init_with_params()` | `src/llama-ext.h` | 342 |
| `llama_governor::prefill_engine()` | `src/llama-governor-policy.cpp` | 54-67 |
| `llama_governor::select_decode()` | `src/llama-governor-policy.cpp` | 101-128 |
| `llama_governor::decode_impl()` | `src/llama-governor.cpp` | 111-155 |
| `llama_kv_commit()` API | `src/llama-ext.h` | 259-266 |

---

## 3. Hardcoded Model Names in Governor / Kalsallama

### Governor sources: ✅ ZERO hardcoded model names

Searched all `src/llama-governor*.cpp`, `src/llama-governor*.h`, `tools/governor-bench/`, and `tests/test-governor-v0*.cpp` for `qwen`, `gemma`, `lfm`, `phi`, `model_id`, `model_name`, `gguf`, `mmproj`, `vl`. **No hits.**

The governor operates entirely on `llama_model *` pointers and arch-category enums. It cannot know what model it is routing.

### Kalsallama vendor (pinned at a0cabca6b): arch-dispatch, not model-ID dispatch

The vendor's `llama-model.cpp` has an arch-dispatch table (`case LLM_ARCH_QWEN3:`, `case LLM_ARCH_LFM2:`, etc.) that creates the right `llama_model_*` subclass based on GGUF metadata. This is **arch-level**, not model-ID-level — it's how llama.cpp works upstream. The arch is embedded in the GGUF file; the code doesn't pick models by name.

**No hardcoded file paths, HF repos, or model IDs** exist anywhere in the governor or vendor C++ sources.

### ⚠️ App TS: model names ARE hardcoded in the catalog

`src/engine/ModelRegistry.ts` is the single source of truth and it hardcodes:
- `id: "qwen3.5-4b"`, `id: "gemma-4-e2b"`, `id: "lfm2.5-2.6b"`, `id: "lfm2.5-8b-a1b-kexp"`
- HF repos, file names, revision SHAs, sizeBytes
- Per-model flags: `hybrid`, `kvUnified`, `canStreamExperts`, `loadPolicy`, `mmproj`

**This is the correct architectural boundary** — the catalog SHOULD live in TS (declarative, no native rebuild to change). But there are places where TS logic **assumes specific IDs exist** (see §6).

---

## 4. Hybrid / MoE / mmproj / VL: What Native Requires for `lfm2.5-vl-3b`

### Current native support for LFM2

The vendor at `a0cabca6b` already supports:
- `LLM_ARCH_LFM2` (dense LFM2) — `llama-model.cpp:271-272`
- `LLM_ARCH_LFM2MOE` (MoE LFM2) — `llama-model.cpp:273-274`
- Hybrid memory path — `llama-memory-hybrid.cpp`, gated at `llama-model.cpp:2088-2151`
- Shared cells via `mem_other` — `llama-kv-cache.cpp:83-96, 174-190`

### Adding a VL (vision-language) model

`lfm2.5-vl-3b` would be a **new arch** (e.g., `LLM_ARCH_LFM2VL` or reuse `LLM_ARCH_LFM2` + mmproj). What the native layer needs:

1. **mmproj GGUF file**: The multimodal projector weights. The `ModelRegistry` TS already has `mmproj?: ModelFileSpec` — qwen3.5-4b and gemma-4-e2b carry mmproj specs. The native `tools/mtmd/` directory ships the CLIP/mtmd code:
   - `mtmd.h` — `mtmd_init_from_file(mmproj_fname, ...)` API
   - `clip.h` / `clip.cpp` — CLIP model loading
   - `mtmd-image.h` / `mtmd-image.cpp` — image encoding

2. **Arch registration** in `llama-arch.h` and `llama-model.cpp` — the GGUF must declare an arch that the model loader recognizes.

3. **`n_embd_inp` dimension match** between text model and mmproj (`mtmd.cpp:374-378` — throws on mismatch).

4. **Governor impact: NONE.** The governor doesn't know about mmproj or VL. It routes prefill/decode by batch size and thermal state. A VL model would be another `llama_model *` with an arch enum.

### What app TS would need

- `mmproj` field in the `ModelInfo` entry (already supported: `ModelRegistry.ts:68`)
- Image preprocessing pipeline in the app (iOS/Android native code that calls `mtmd_encode`)
- The `tools/mtmd/` C++ layer is already in the vendor tree — no native patch needed for the CLIP/multimodal pipeline itself

### APIs to point at (do not implement)

| Purpose | API | File |
|---|---|---|
| Load mmproj | `mtmd_init_from_file()` | `tools/mtmd/mtmd.h:123` |
| Query mmproj dims | `mtmd_get_n_embd()` | `tools/mtmd/mtmd.h:747` |
| Encode image | `mtmd_encode()` | `tools/mtmd/mtmd.h` |
| Arch enum | `LLM_ARCH_LFM2` | `llama-arch.h:123` |
| Hybrid memory | `llama_memory_hybrid` | `llama-memory-hybrid.h` |
| Governor params | `llama_governor_params` | `llama-ext.h:199` |

---

## 5. Constraints for C1 Prune: Can the App Remove `gemma-4-e2b` / `qwen3.5-2b` Without Native Changes?

### Short answer: **Yes for C1 prune. No native changes needed.**

### Analysis

The native layer (vendor kalsallama-cpp at `a0cabca6b`) is **completely model-agnostic**. It:
- Loads any GGUF that declares a supported arch in its metadata
- Creates the right `llama_model_*` subclass via the arch-dispatch table
- Has no hardcoded file paths, HF repos, or model IDs

The governor (v0.2 worktree) is also model-agnostic — it routes by arch category and thermal state.

**Removing a model from the TS catalog (`ModelRegistry.ts`) means:**
1. The entry disappears from `MODEL_REGISTRY` array
2. `getModelById()` falls back to the default (currently `qwen3.5-4b`)
3. `getDefaultModel()` returns the first entry with `default: true`
4. Download/install logic no longer offers the removed model
5. Settings UI no longer shows it

### What would break if you remove models

| ID | Can remove safely? | What breaks | Native follow-up needed? |
|---|---|---|---|
| `gemma-4-e2b` | ✅ YES | Settings UI loses this option; any saved sessions referencing this ID become orphaned | No |
| `qwen3.5-2b` | ✅ YES | Same as above; also `minRamTier: "low"` tier loses its fallback | No |
| `qwen3.5-4b` | ⚠️ CAREFUL | This is `default: true` — removing it shifts default to the next entry; `minRamTier: "high"` loses its model | No |
| `qwen3.5-4b-q3` | ✅ YES | `minRamTier: "mid"` loses its model | No |
| `lfm2.5-2.6b` | ✅ YES | No tier assignment, self-contained | No |
| `lfm2.5-8b-a1b` | ✅ YES | Only model with `canStreamExperts` + `streamingResident` | No |
| `lfm2.5-8b-a1b-kexp` | ✅ YES | KEXP requant; has `loadPolicy: {mmap:false, repack:true}` | No |

### When would native need a follow-up?

Native changes would be required only if:
1. **A new arch is added** (e.g., `lfm2.5-vl-3b` needs `LLM_ARCH_LFM2VL` in `llama-arch.h` and a model class in `llama-model.cpp`) — but this is the vendor pin bump, not a prune
2. **A model's KV cache profile changes** and the governor's commit path doesn't handle the new quant — but the governor uses `llama_kv_commit` which is quant-agnostic (it does `tensor_get/set` on raw bytes)
3. **The governor's `model_kind` enum** is extended to cover a new architecture class — but existing values (`Dense`, `Hybrid`, `MoE`) already cover all current models

**Bottom line: C1 prune is purely a TS catalog change. The native layer doesn't care which models exist.**

---

## 6. Recommendations for Parent: What to Verify Before Allowing TS Catalog Edits

### Hard checks (blocking)

1. **Default model fallback chain**: `qwen3.5-4b` is `default: true`. If removed, verify `getDefaultModel()` returns a valid entry. Check `MODEL_REGISTRY.find(m => m.default) ?? MODEL_REGISTRY[0]` — does the next entry make sense?

2. **RAM tier orphaning**: `minRamTier` assigns models to RAM tiers:
   - `"high"` → only `qwen3.5-4b`
   - `"mid"` → only `qwen3.5-4b-q3`
   - `"low"` → only `qwen3.5-2b`
   
   Removing a tier's sole model breaks `resolveContextProfile()` — search for `minRamTier` usage and verify the tier-to-model mapping still covers all three tiers or is updated consistently.

3. **Orphaned session files**: `src/engine/sessionPool.ts` keys sessions by `modelId`. Orphaned sessions (saved under a deleted model ID) should be handled gracefully — check `deleteLegacyModelSession()` and the session-listing paths for null safety.

4. **Test files with hardcoded IDs**: `src/engine/ModelDownloader.test.ts:29` uses `MODEL_REGISTRY.find(m => m.id === "lfm2.5-2.6b")!`. `src/engine/loadPolicy.test.ts:135` iterates `["gemma-4-e2b", "lfm2.5-8b-a1b"]`. These tests will fail or NPE if the referenced models are removed.

5. **Expert streaming gate**: `lfm2.5-8b-a1b` is the only model with `canStreamExperts: true` and `streamingResident`. Removing it disables the expert-streaming code path in production. Verify that `modelGateRAM.ts` and `expertStreaming.test.ts` don't assume this model exists.

### Soft checks (non-blocking but important)

6. **mmproj availability**: `qwen3.5-4b` and `gemma-4-e2b` have `mmproj` specs. Removing them reduces vision capability. If `lfm2.5-vl-3b` is being added as a VL model, ensure its mmproj is available before removing the only vision-capable models.

7. **`isHybridOrKvUnifiedModel()`**: Called by `contextProfile.ts` and `sessionPersistence.ts`. After a prune, verify that any remaining model that should be hybrid IS flagged — otherwise the context-profile upgrade logic won't fire.

8. **i18n keys**: Removed models have `descriptionKey` and `ramBadgeKey` entries. Dead i18n keys are harmless but should be cleaned up in a follow-up.

9. **Benchmark harness**: `tools/governor-bench/` accepts any GGUF path — no ID coupling. But the CI/test matrix may reference specific models in device-test scripts outside the TS source.

### Summary

| Risk | Severity | Action |
|---|---|---|
| Default model orphan | 🔴 HIGH | Verify fallback chain before merge |
| RAM tier gap | 🔴 HIGH | Update `resolveContextProfile` or remove tier |
| Orphaned sessions | 🟡 MED | Null-safe session listing |
| Test failures | 🔴 HIGH | Update test fixtures to use remaining models |
| Expert streaming dead path | 🟡 MED | Decide: keep lfm2.5-8b or remove capability |
| mmproj coverage | 🟡 MED | Confirm lfm2.5-vl-3b mmproj before pruning vision models |
| Dead i18n | 🟢 LOW | Clean up later |
