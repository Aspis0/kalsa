# C6d — Audit Fix Report

**Date:** 2026-09-06 · **Branch:** `feat/moe-stream` · **Commit:** `869c28d` (no push) · **Parent audit:** `C6D-AUDIT-DEEPSEEK.md` (commit `3c9e2a3`)

## What was fixed (self-audit of `3c9e2a3`)

Only the audit's Part 3 fix list, riding along with the required items. **No new styles/tokens.**

### Files (2)
- `src/i18n/it.ts` — corrected IT copy for 4 keys.
- `src/ui/AskAssistantMiniappRenderer.tsx` — `block.title` precedence in 3 views + citations `text`→note + numbering + timeline double-eval cleanup.

### 1. `block.title` precedence restored (S-1, S-2)
All three views now use `toStringValue(block.title, context.t("miniapp.<key>"))`, matching `WorkflowTimelineBlockView`:
- `TimelineBlockView` → `miniapp.timelineTitle`
- `QualityPanelBlockView` → `miniapp.qualityTitle`
- `CitationsBlockView` → `miniapp.citationsTitle`

`block.title` now wins when populated (checklist builder emits it); the i18n string is a true fallback.

### 2. IT copy corrected (`it.ts:565-571`)
| key | before | after |
|---|---|---|
| `timelineTitle` | `Scheda cronologia` | `Cronologia` |
| `timelineEmpty` | `Nessuna voce da scheda ancora.` | `Ancora nenhuma voce.` |
| `qualityEmpty` | `Nessuna voce di qualità ancora.` | `Ancora nenhuma voce di qualità.` |
| `citationsEmpty` | `Nessuna citazione ancora.` | `Ancora nessuna citazione.` |

### 3. Citations — `text` mapped as note, numbering restored (F-1, F-3)
- `source = source ?? url` (previously `text` was mislabeled as source).
- `note = note ?? summary ?? text` (quote/passage now renders as note/body, per `EvidencePanelBlockView`).
- Numbering restored: bold line renders `${n}. {title}` (old one-liner behavior).
- `statement = title || id` (url-only citations still render a number + id).

### 4. Timeline double-eval cleaned (F-9)
`const when = toStringValue(record.time, toStringValue(record.when));` extracted and reused in both the condition and the `• ${when}` output — no behavior change.

## Verify
- `npx tsc --noEmit` → **TSC_EXIT:0** (log `/tmp/c6d-fix-tsc.log`).
- Grep the three views for `toStringValue(block.title` → **count 3** (timeline, quality, citations all fixed).

## Audit items intentionally NOT touched (out of scope this PR)
- F-2 (url-only statement fallback to source) — statement keeps `title || id`; acceptable, numbering still shows.
- F-4 (quality `numberOfLines={2}`) — unchanged.
- F-5 (checklist vs generic-timeline vocabulary) — unchanged.
- F-6 (keys in `miniapp:` vs `renderer:`) — left as-is.
- F-7 (`WorkflowTimelineBlockView` still EN-hardcoded) — follow-up C6e.
- F-8 (empty-statement Text) — citations now always has a numbered statement; timeline guards `when`.