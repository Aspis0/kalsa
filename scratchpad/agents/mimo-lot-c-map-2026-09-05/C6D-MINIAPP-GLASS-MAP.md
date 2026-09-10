# C6D — Miniapp Glass Map

> **Branch:** `feat/moe-stream` · **Date:** 2026-09-05  
> **Goal:** Map existing glass/surface patterns so a polish pass reuses them — no new tokens.

---

## 1. Block → glass wrapper path

Every registered block flows through this chain:

1. `MiniappBlockRenderer` (line ~2130) looks up `ASK_ASSISTANT_MINIAPP_BLOCK_REGISTRY[blockType]`
2. Calls `registryEntry.render(…)` → renders the inner `<View>` (e.g. `TimelineBlockView`)
3. Wraps the result in `<MiniappBlockSurface>` (line ~2110):

```tsx
// AskAssistantMiniappRenderer.tsx:2110-2130
function MiniappBlockSurface({ capabilities, children, context, visual }) {
  const styleNames = [
    "miniappBlockSurfaceBase",
    ...(miniappSurfaceStylesByKind[visual.liquidGlassSurface] ?? …),
    miniappSurfaceDensityStyles[visual.density],
    miniappSurfaceAccentStyles[visual.accent],
    capabilities.interactive ? "miniappSurfaceInteractive" : null,
    capabilities.stateful ? "miniappSurfaceStateful" : null,
  ];
  // ...
  return <View style={surfaceStyles}>{children}</View>;
}
```

4. The **outer miniapp shell** uses `<GlassSurface>` (line ~2142), which picks a variant:
   - **iOS:** `<BlurView intensity={40}>` + `LinearGradient` + `miniappIosInner`
   - **Android:** `<View style={miniappAndroidShell}>` + `LinearGradient` + `miniappAndroidInner`
   - **Vision:** `<BlurView intensity={52}>` + `LinearGradient` + highlight orb + `miniappVisionInner`

**Key insight:** Block-level glass is pure StyleSheet (no BlurView). Real blur only lives at the shell level (`GlassSurface`) and in `GlassPanel2`. Block surfaces use `backgroundColor: colors.panel` / `colors.panelSolid` + border — "flat glass" with accent left-borders.

---

## 2. Which of the 6 template block types get glass chrome vs plain fallback?

| Block type | Registry `liquidGlassSurface` | Actual chrome? | Notes |
|---|---|---|---|
| **data_table** | `data_sheet` | ✅ Custom | `miniappTableBlock` (panel bg, border-r24, header row, cell rows) |
| **calculator** | `floating_control` | ✅ Custom | `miniappInputGrid` + `miniappFormulaBox` + `miniappInputCard` — polished |
| **quiz** | `frosted_panel` | ⚠️ Shared | `miniappFallbackBlock` wrapper, but has its own `miniappQuizOption*` styles with selected/correct/wrong states |
| **metric_strip** | `metric_glass` | ✅ Custom | `miniappMetricGrid` → `miniappMetricCard` (panelSolid bg, r24, accent value) |
| **timeline** | `frosted_panel` | ❌ Fallback | Uses `miniappFallbackBlock` — plain panel, no numbered steps, no frosted rows |
| **pros_cons** (=data_table alias) | `data_sheet` | ✅ Custom | Same as data_table |

**Timeline is the weakest of the six** — it falls through to the same generic `miniappFallbackBlock` as warnings, quality panels, citations.

---

## 3. Existing `miniappSurface*` style keys

All defined in `createStyles.ts`:

| Key | backgroundColor | padding | borderRadius | border | Other |
|---|---|---|---|---|---|
| `miniappBlockSurfaceBase` | — | — | 24 | 1px `colors.line` | overflow hidden |
| `miniappSurfaceHeroGlass` | `panelSolid` | `spacing.md` | 28 | — | — |
| `miniappSurfaceMetricGlass` | `panel` | `spacing.sm` | — | — | — |
| `miniappSurfaceScientificCanvas` | `panel` | `spacing.sm` | — | — | minHeight 150 |
| `miniappSurfaceWellPlate` | `panel` | `spacing.sm` | — | — | — |
| `miniappSurfaceDataSheet` | `panel` | `spacing.xs` | — | — | — |
| `miniappSurfaceCommandBar` | `panel` | x: sm, y: xs | 999 (pill) | — | — |
| `miniappSurfaceFloatingControl` | `panel` | `spacing.xs` | 22 | — | — |
| `miniappSurfaceFrostedPanel` | `panel` | `spacing.sm` | — | — | — |

Accent modifiers (all `borderLeft: 3px`):
- `AccentCyan` → `colors.cyan`
- `AccentIndigo` / `AccentViolet` → `colors.violet`
- `AccentLime` → `colors.good`
- `AccentRose` → `colors.bad`
- `AccentZinc` → `colors.lineStrong`

Density modifiers (top margin): `compact` → xs, `comfortable` → sm, `spacious` → md.

**No BlurView, no glass.hairline, no glass.rimDark at block level.** Block glass is flat color + border only.

---

## 4. Best existing pattern to reuse for timeline/checklist

### **`MetricListBlockView`** (best candidate for frosted-row look)

```tsx
// AskAssistantMiniappRenderer.tsx:368-386
function MetricListBlockView({ block, context, wide = false }) {
  const metricRows = getMetricRows(block);
  return (
    <View style={context.styles.miniappMetricGrid}>
      {metricRows.map((metric, index) => (
        <Metric key={…} label={…} styles={context.styles} value={…} wide={wide} />
      ))}
    </View>
  );
}
```

Each `Metric` renders:
```tsx
// createStyles.ts
miniappMetricCard: {
  backgroundColor: colors.panelSolid,  // ← opaque white/dark card
  borderColor: colors.line,
  borderRadius: 24,
  borderWidth: 1,
  flexGrow: 1,
  minWidth: 120,
  padding: spacing.sm,
}
```

### **`miniappPlannerTimelineItem`** (the OTHER timeline — already frosted rows!)

```tsx
// createStyles.ts
miniappPlannerTimelineItem: {
  backgroundColor: colors.panel,
  borderColor: colors.line,
  borderRadius: 16,
  borderWidth: 1,
  gap: 4,
  padding: spacing.sm,
}
```

Used by `WorkflowTimelineBlockView` (line ~616) which renders `Day {index+1}` + action + output — **this is the frosted-row checklist pattern**. It already looks good with numbered steps (`Day 1`, `Day 2`…) and per-item cards.

### **`miniappFormulaBox`** (for compact result rows inside timeline)

```tsx
miniappFormulaBox: {
  backgroundColor: colors.panel,
  borderColor: colors.line,
  borderRadius: 24,
  borderWidth: 1,
  padding: spacing.sm,
}
```

### Recommended copy-from recipe for polished timeline:

1. **Outer:** `miniappPlannerTimeline` (gap: xs) — already exists, just change the view function
2. **Per-row:** `miniappPlannerTimelineItem` (panel bg, r16, border) — already frosted
3. **Step number:** bold label like `Day N` (use `miniappBlockTitle` for the "Day N" prefix)
4. **Step text:** `miniappFallbackText` or `miniappPrimaryText`

---

## 5. Hardcoded English strings (i18n gaps)

All in `AskAssistantMiniappRenderer.tsx`:

| Line | String | Context |
|---|---|---|
| ~632 | `"Workflow timeline"` | WorkflowTimelineBlockView title fallback |
| ~656 | `"No timeline steps configured."` | WorkflowTimelineBlockView empty |
| ~672 | `"Decision tree"` | DecisionTreeBlockView title fallback |
| ~682 | `"Node ${index + 1}"` | DecisionTreeBlockView node fallback |
| ~683 | `"Review output"` | DecisionTreeBlockView then fallback |
| ~695 | `"No decision nodes yet."` | DecisionTreeBlockView empty |
| ~706 | `"Risk panel"` | RiskPanelBlockView title fallback |
| ~732 | `"No risks identified."` | RiskPanelBlockView empty |
| ~1267 | `"Timeline"` | TimelineBlockView title fallback |
| ~1278 | `"No timeline entries yet."` | TimelineBlockView empty |
| ~1285 | `"Quality panel"` | QualityPanelBlockView title fallback |
| ~1296 | `"No quality entries yet."` | QualityPanelBlockView empty |
| ~1303 | `"Citations"` | CitationsBlockView title fallback |
| ~1315 | `"No citations yet."` | CitationsBlockView empty |
| ~1322 | `"AI insight"` | InsightBlockView title fallback |
| ~1325 | `"No insight yet."` | InsightBlockView body fallback |
| ~510 | `"Untitled hypothesis"` | HypothesisCardBlockView |
| ~513 | `"No measurable prediction provided."` | HypothesisCardBlockView |
| ~516 | `"Hypothesis card"` | HypothesisCardBlockView title |
| ~518 | `"Assumptions:"` | HypothesisCardBlockView |
| ~548 | `"Experiment matrix"` | ExperimentMatrixBlockView title |
| ~561 | `"Condition"` | ExperimentMatrixBlockView header |
| ~577 | `"No matrix rows yet."` | ExperimentMatrixBlockView empty |

---

## 6. Minimal polish slice (1 PR)

### Files to change

| File | Change | Copy from |
|---|---|---|
| `src/ui/AskAssistantMiniappRenderer.tsx` | **Rewrite `TimelineBlockView`** to use `miniappPlannerTimelineItem` per-row cards with `Day N` header + text (match `WorkflowTimelineBlockView` pattern) | `WorkflowTimelineBlockView` (same file, line ~616) |
| `src/ui/AskAssistantMiniappRenderer.tsx` | **Rewrite `QualityPanelBlockView`** to use per-row `miniappPlannerTimelineItem` cards instead of flat text | `WorkflowTimelineBlockView` |
| `src/ui/AskAssistantMiniappRenderer.tsx` | **Wrap `CitationsBlockView` items** in `miniappEvidenceItem` cards | `EvidencePanelBlockView` (same file) |
| `src/theme/createStyles.ts` | Add one style: `miniappChecklistStep` (copy `miniappPlannerTimelineItem`, add `flexDirection: "row"`, `gap: spacing.sm`, step-number + text layout) OR just reuse `miniappPlannerTimelineItem` as-is | `miniappPlannerTimelineItem` |

### What NOT to change
- No new BlurView at block level
- No new color tokens
- No new glass constants
- `miniappFallbackBlock` stays as-is (it's the correct fallback)
- Quiz, calculator, data_table, metric_strip — already have good chrome

### Estimated diff
- **~60 lines** changed in `AskAssistantMiniappRenderer.tsx` (3 view functions rewritten)
- **~8 lines** added in `createStyles.ts` (one new style, or zero if reusing `miniappPlannerTimelineItem` directly)
- **~15 lines** moved from hardcoded strings to `context.t(…)` if touching those views (optional for polish PR)

### PR sequence
1. Rewrite `TimelineBlockView` → use `WorkflowTimelineBlockView` card pattern
2. Rewrite `QualityPanelBlockView` → same frosted-row treatment
3. Wrap `CitationsBlockView` items in `miniappEvidenceItem` cards
4. (Optional) i18n the hardcoded fallbacks in the above views
