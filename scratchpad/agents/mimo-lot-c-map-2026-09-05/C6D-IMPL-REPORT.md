# C6d — Miniapp Impl Report

**Date:** 2026-09-06 · **Branch:** `feat/moe-stream` · **Commit:** `3c9e2a3` (no push)

## What changed

Reused existing planner glass cards for the three weakest blocks (timeline / quality / citations) — **no new design tokens, colors, blur, or radii**.

### Files (3)
- `src/i18n/en.ts` — added `miniapp.*` keys: `timelineTitle`, `timelineEmpty`, `stepN`, `qualityTitle`, `qualityEmpty`, `citationsTitle`, `citationsEmpty`.
- `src/i18n/it.ts` — mirrored the same 7 keys (IT).
- `src/ui/AskAssistantMiniappRenderer.tsx` — rewrote `TimelineBlockView`, `QualityPanelBlockView`, `CitationsBlockView`.

### View rewrites (structure copied from `WorkflowTimelineBlockView`)
- **`TimelineBlockView`**: outer `miniappPlannerTimeline` (was `miniappFallbackBlock`), per-entry `miniappPlannerTimelineItem` cards, header = `miniapp.stepN` (`Step {n}`) + time, body = `title`/`label`, optional `output`, empty = `miniapp.timelineEmpty`.
- **`QualityPanelBlockView`**: outer `miniappPlannerTimeline`, per-row `miniappPlannerTimelineItem` card showing `label: value`.
- **`CitationsBlockView`**: outer `miniappPlannerTimeline`, per-citation `miniappEvidenceItem` card (map recommends evidence for citations) with `title`/`id` statement + optional `source`/`note`.

Reuse only: `miniappPlannerTimeline`, `miniappPlannerTimelineItem`, `miniappEvidenceItem`, `miniappBlockTitle`, `miniappFallbackText`. No new `createStyles` keys. Builders / battery untouched.

## Verify
- `npx tsc --noEmit` → **TSC_EXIT:0** (log `/tmp/c6d-tsc.log`).
- Grep `TimelineBlockView` → `miniappFallbackBlock` count = **0** (no longer wraps with fallback).

## i18n keys added (miniapp.*)
| key | EN | IT |
|---|---|---|
| `timelineTitle` | Timeline | Scheda cronologia |
| `timelineEmpty` | No timeline entries yet. | Nessuna voce da scheda ancora. |
| `stepN` | Step {n} | Passo {n} |
| `qualityTitle` | Quality panel | Pannello qualità |
| `qualityEmpty` | No quality entries yet. | Nessuna voce di qualità ancora. |
| `citationsTitle` | Citations | Citazioni |
| `citationsEmpty` | No citations yet. | Nessuna citazione ancora. |