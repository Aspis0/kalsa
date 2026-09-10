# LOT status — product lots A–D

Updated: 2026-09-05  
Branch: `feat/moe-stream`  
Scout maps: `LOT-A-chat-ui.md`, `LOT-B-memory-search-docs.md`, `LOT-C-models-gates-system.md`, `LOT-D-web-research.md`

---

## LOT-A — Chat UI — **DONE**

| Item | Outcome | Notes |
|------|---------|--------|
| A1 leaf-fold drawer | Shipped (remote demo) | Cloudflare `kalsa-leaf-fold.pages.dev`; not localhost |
| A2–A4 (More / regen / composer) | Out of this pass or superseded | A1 was the structural UI piece executed |

Maps: `scratchpad/agents/mimo-lot-a-map-2026-09-02/`

---

## LOT-B — Memory / search / docs / tools / E5 — **DONE**

| Package | Commit | Summary |
|---------|--------|---------|
| B2 chat search | `15ee404` | Debounce, tail blob, highlights |
| B1-A′ privacy | `b28294b` | Sensitive facts stay local; egress gate on web_search |
| B1-B memory UX | `6c6ca56` | Toggle + clarity |
| B1-C edit fact | `e93e804` | Inline edit |
| B6 tool registry DX | `2de4abd` | Typed registry / add-tool checklist |
| B3 egress | `17c6afc` | web_fetch sensitive gate; release-safe toolgate; pure.test |
| B4 write_note | `e697d33` | AI → local `.md` notes |
| B5 E5 Option D | `070b5f9` | semantic/embed/docChat tests + safe Rebuild index |

Maps/reports: `scratchpad/agents/mimo-lot-b-map-2026-09-04/`

Deferred from B (explicit non-goals): notes/chat in semantic corpus (B5.1), PDF generation from AI.

---

## LOT-C — Models, gates & system — **TODO (next, hardest)**

Scout: `LOT-C-models-gates-system.md` (recon of what exists).  
This lot is **not** a thin feature: it touches catalog identity, RAM recommendations, thermal policy, safety runtime, and power UX. Work is split below so we do not boil the ocean in one PR.

### Owner intent (from scout)

- **Catalog prune:** KEEP `lfm2.5-2.6b`, add `lfm2.5-vl-3b` (missing today), KEEP `qwen3.5-4b` (high). REMOVE at least `gemma-4-e2b`, `qwen3.5-2b` (and decide fate of `qwen3.5-4b-q3`, `lfm2.5-8b-a1b`, `lfm2.5-8b-a1b-kexp`).
- **Tier suggestions:** low/mid → LFM 2.6B family; high → Qwen 3.5 4B (today still points at qwen 2b / q3 / 4b).
- **Thermal:** owner mentioned a ~51°C gate — **code today is advisory-only** (42 warm / 50 hot banners). No hard block.
- **Persona:** already exists (global Format-B tail).
- **Guardrails:** regex pre-filter exists; tinyBERT (or similar) pre-hook was floated — **no classifier runtime**.
- **Miniapps:** rich renderer already exists.
- **Battery “lasts X hours”:** building blocks exist; no continuous estimate.

### Proposed C packages (complexity ↑)

| ID | Package | Why hard / easy | Suggested order |
|----|---------|-----------------|-----------------|
| **C1** | **Catalog prune + add `lfm2.5-vl-3b`** | Blast radius: `ModelRegistry`, i18n, downloaders, benches, tests, docs, any hardcoded ids. Must not leave dangling `recommendedModelId` / fallbacks. | **1 — do first** |
| **C2** | **Retarget `recommendedModelId` + RAM tiers** | Coupled to C1 ids. Small code, high product impact. | **2 — with or right after C1** |
| **C3** | **Thermal policy** | Decide: keep advisory vs hard gate on send/load/download. Hard gate = AppShell/LlamaService hooks + false-positive risk on bad thermal zones. | **3 — product decision required** |
| **C4** | **Persona polish** (only if still wanted) | Contained; store + tail already ship. | Optional / later |
| **C5** | **Second-stage safety (tinyBERT-class)** | **Hardest.** No TFLite/ONNX/classifier path today. Needs runtime choice (GGUF via llama.rn vs native), latency budget, fail-open/closed, model download UX. | **Last or separate epic** |
| **C6** | **Miniapp / structured-output productization** | Infrastructure rich but bio-skewed; new “callable mini apps” = schema + prompts + blocks, not greenfield renderer. | After C1–C3 unless product pulls it forward |
| **C7** | **Battery longevity estimate** | Contained–medium: periodic `expo-battery` + drain model; accuracy caveats. | After C1–C3 |

### What makes C “the complex part”

1. **Identity cascade (C1+C2):** removing models is not deleting rows — recommendations, benches, hybrid/KV policies, and user-installed ids must stay coherent.
2. **Policy vs UX (C3):** advisory banners are easy; a real thermal kill-switch changes when generation is allowed mid-session.
3. **New ML path (C5):** second inference stack or a second llama.rn role — same class of risk as embedding, plus every-send latency.
4. **Vision model add (`lfm2.5-vl-3b`):** new registry entry + mmproj + UI + loadPolicy — not a one-liner.

### Recommended first slice for execution

**C1′ + C2 (single lot slice) — DONE (2026-09-05)** — commit `7b71d18`  
Marco decisions applied:
- **REMOVED:** `gemma-4-e2b`, `qwen3.5-2b`, `qwen3.5-4b-q3`, `lfm2.5-8b-a1b`, `lfm2.5-8b-a1b-kexp`
- **KEEP:** `qwen3.5-4b` (high + default), `lfm2.5-2.6b` (low/mid via `recommendForTiers`)
- **DEFER:** `lfm2.5-vl-3b` add
- Data-driven: `recommendForTiers` / `sizeClass` / `listed`; boot `sweepOrphanModelDirs`
**C3 thermal — DONE (2026-09-05)** — advisory `55008c3`/`cc22682` + hard gate `b28babd` (+ IT `c67f5b5`)  
- Advisory zone0 **45 / 48 / 52 °C** + hysteresis; Settings banner warm/hot/critical.  
- **Hard gate** on OS **CRITICAL+** (Android ≥4, iOS `.critical`): unload LLM (`disposeEngine`) + block send/load; fail-open if API missing; Expo module `modules/kalsa-thermal/`.  
- Not gated on charging/zone0 °C alone. Governor GPU switch still governor-owned.  
**C7 battery longevity — DONE (2026-09-05).** `68e2d76` + audit fix `47cb83a` (pushed). Slope ETA under model bar ≤50%; F1–F7 addressed.  
**C6 miniapp productize — DONE (2026-09-06).** `ab6f4a0` + audit fix `8e788ec` (pushed). Prompt +5 types EN/IT; QuickActionSheet templates mounted in AiChatPage; requiresAi UX; ~1640 LOC bio dead removed; smoke 18/18; parent-verified tsc 0.  
**C6b create_miniapp tool — DONE (2026-09-06).** `f659bda` + audit fix `c26ad2f` (pushed). Tool enum → `buildMiniappV1` → `onMiniapp`; prompts prefer tool; parent tsc 0.  
**C6c template session — DONE (2026-09-06).** `2fdaef4` + `b56d5bc` + F5 `d5008e3` (pushed). Catalog 6 + size caps.  
**C6d miniapp glass reuse — DONE (2026-09-06).** `3c9e2a3`…`9d3db10` (pushed). Timeline/quality/citations reuse planner/evidence cards (no new tokens); block.title restored; IT empty-states cleaned (no PT).  
Leave C4 optional, C5 classifier, VL add as follow-ups.

### HARD RULE for C1+C2 (Marco, 2026-09-05)

**No scattered hardcoded model IDs / RAM thresholds / tier→id switches.**  
Catalog, RAM cutoffs, and recommendations must be easy to change from **one (or few) declarative sources** (registry fields + named constants/config). Explorers map every hardcode; implementers must collapse them — not add more string literals in `switch (tier)` / benches / Settings. Parent verifies **kalsallama** (`native/kalsallama.pin` → `vendor/kalsallama-cpp`, worktree `/Users/marco/Projects/kalsallama-wt-governor` on `kalsa/governor-v0.2`) and **Governor** sources personally before impl.

---

## LOT-D — Web research — **NOT STARTED**

Scout only: `LOT-D-web-research.md`. Do after C (or parallel only if C1′ is landed and owners want it).

---

## Pipeline note (unchanged)

Explorer MiMo → parent verify → impl (prefer Ornith; escalate Luna on mtplx connection fail) → hostile audit (DeepSeek / GLM) → fix → commit/push.
