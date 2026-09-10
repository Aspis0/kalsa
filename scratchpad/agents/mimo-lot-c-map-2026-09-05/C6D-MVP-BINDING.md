# C6d MVP binding — miniapp polish (reuse only) · parent 2026-09-06

Marco: glass/iOS **as Kalsa already does** — do not invent tokens/colors/blur.

Source map: `C6D-MINIAPP-GLASS-MAP.md` (parent verified `WorkflowTimelineBlockView` ~976 uses `miniappPlannerTimeline` + `miniappPlannerTimelineItem`).

## In scope

1. **Rewrite `TimelineBlockView`** (checklist path) to match `WorkflowTimelineBlockView` layout:
   - Outer: `styles.miniappPlannerTimeline` (not `miniappFallbackBlock`)
   - Per step: `styles.miniappPlannerTimelineItem`
   - Header line: step index via **i18n** (e.g. `miniapp.stepN` / `{n}`) — **not** hardcoded `"Day N"` (that's workflow-specific copy; checklist should say Step)
   - Body: `title` / `label` (+ optional `time` as today)
   - Empty state: i18n key (add EN+IT), no hardcoded English
   - Title fallback: i18n (checklist/timeline), not `"Timeline"`

2. **Same card pattern for `QualityPanelBlockView` and `CitationsBlockView`** if still flat-text — reuse `miniappPlannerTimelineItem` or `miniappEvidenceItem` (map says evidence for citations). **Zero new StyleSheet keys** unless map's optional copy of planner item is needed — prefer reuse as-is.

3. **i18n EN+IT** only for strings you touch (title fallbacks, empty states, step label).

## Out of scope

- New blur / GlassSurface at block level
- New colors, radii, shadows
- Redesigning QuizBlock / calculator / data_table / metric_strip (already have chrome)
- Changing builders / create_miniapp tool
- Inventing a checklist checkbox UI (not in existing patterns)

## Verify

- tsc 0; no new jest required unless you add a tiny pure helper (optional)
- Grep: TimelineBlockView no longer uses `miniappFallbackBlock` as outer wrapper
- Visual: parent will spot-check code; device later

## Impl

Ornith first. Commit, no push until audit.
