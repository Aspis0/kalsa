# HOSTILE AUDIT — APP-SHIPPED-CONFIG.md

Target: `APP-SHIPPED-CONFIG.md` — claims to describe what the Kalsa app sends to the engine for a chat turn on `lfm2.5-2.6b` on Android.
Repo: `/Users/marco/Projects/kalsa`, branch `main`, commit `9e90f99`. Read-only.

---

## 1. ModelRegistry.ts line-number claims

| Claim | Actual | Verdict |
|---|---|---|
| qwen3.5-4b entry starts L162 | L177 (`grep -n`) | **REFUTED** — off by 15 |
| lfm2.5-2.6b entry at L216–246 | L217–242 | **REFUTED** — off by 1 start, 4 end |
| isHybridOrKvUnifiedModel at L270–274 | L343–345 | **REFUTED** — off by 73 |
| getDefaultModel at L263–265 | L331–332 | **REFUTED** — off by 68 |
| All LFM2.5 field values (L220–245) | Exact match | **CONFIRMED** |
| Qwen kvUnified L201, mtp L209, default L214 | Exact | **CONFIRMED** |
| LFM2.5 kvBytesPerToken L238, thinking L240, preserveThinking L241 | Exact | **CONFIRMED** |

Line numbers for helper functions are wrong by 68–73 lines; field values within the LFM2.5 entry are correct.

---

## 2. Model catalog field values (§1.1)

Every field claimed for lfm2.5-2.6b is **CONFIRMED** against ModelRegistry.ts L217–242. Specific verifications:

| Field | Claimed | Actual L2xx | Verdict |
|---|---|---|---|
| id | `"lfm2.5-2.6b"` | L217 | **CONFIRMED** |
| vendor | `"Liquid AI"` | L218 | **CONFIRMED** |
| quant | `"QAD-Q4_0"` | L220 | **CONFIRMED** |
| hfRepo | `"LiquidAI/LFM2.5-2.6B-GGUF"` | L221 | **CONFIRMED** |
| revision | `"f4a289c8a200a5ca71005ba7abc2dad33058a450"` | L222 | **CONFIRMED** |
| file | `"LFM2.5-2.6B-QAD-Q4_0.gguf"` | L223 | **CONFIRMED** |
| sizeBytes | 1,593,894,944 | L224 | **CONFIRMED** |
| weightsBytesPerToken | 1,585,647,616 (tensor-map) | L225–228 | **CONFIRMED** |
| mmproj | absent (text-only) | L230 comment | **CONFIRMED** |
| contextLength | 131072 | L230 | **CONFIRMED** |
| engineCtx | 8192 | L231 | **CONFIRMED** |
| kvCache | `{ k: "q8_0", v: "q4_0" }` | L232 | **CONFIRMED** |
| hybrid | true | L233 | **CONFIRMED** |
| kvUnified | not set (only Qwen3.5 at L201) | absent from LFM entry | **CONFIRMED** |
| sizeClass | `"2B"` | L234 | **CONFIRMED** |
| kvBytesPerToken | 6656 | L238 | **CONFIRMED** |
| mtp | absent | absent from LFM entry | **CONFIRMED** |
| thinking | `{ short: 256, extended: 512 }` | L240 | **CONFIRMED** |
| preserveThinking | true | L241 | **CONFIRMED** |
| minRamTier | `"low"` | L244 | **CONFIRMED** |
| recommendForTiers | `["low","mid"]` | L245 | **CONFIRMED** |

Helper functions:
- `getDefaultModel()` returns `default:true` entry else `MODEL_REGISTRY[0]` → qwen3.5-4b is default — **CONFIRMED** (L331–332).
- `isHybridOrKvUnifiedModel` checks `hybrid === true || kvUnified === true` — **CONFIRMED** (L343–345).
- Qwen3.5 thinking comment "template has no off switch" — **CONFIRMED** (L239).

---

## 3. devModelCatalog.ts (§1.2)

| Claim | Actual | Verdict |
|---|---|---|
| DEV_MODEL_REGISTRY at L61 | L61 | **CONFIRMED** |
| 6 entries (correct 6 ids) | Confirmed | **CONFIRMED** |
| CatalogDefaults type L5–20 | L5–20 | **CONFIRMED** |
| DEV_ARTIFACT_REPO = "Kalsa-DevModels" L3 | L3 | **CONFIRMED** |
| Header comment L14 | L14 exact text | **CONFIRMED** |
| getDevModelsEnabled benchConfig.ts L79–83, key L65 | L79–83, L65 | **CONFIRMED** |
| configureModelRegistry ModelRegistry.ts L252–259 | L252–259 | **CONFIRMED** |

---

## 4. System prompt (§2.1)

| Claim | Actual | Verdict |
|---|---|---|
| buildSystemPrompt at LlamaService.ts L451–460 | L451–466 | **CONFIRMED** (end off by 6) |
| Signature `(locale, withTools, facts?)` | L452–454 | **CONFIRMED** |
| MEMORY_FACTS_ON_USER_TAIL = true (ttftFlags.ts L23) | L23 exact | **CONFIRMED** |
| Facts never in system prompt on shipped path | Dead code gated by `!MEMORY_FACTS_ON_USER_TAIL` | **CONFIRMED** |

---

## 5. STOP_WORDS

| Claim | Actual | Verdict |
|---|---|---|
| STOP_WORDS at LlamaService.ts L467–473 | L467–473, exact list: `["