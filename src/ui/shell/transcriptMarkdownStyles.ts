/**
 * The styles for the answer's markdown blocks: the inline spans, the heading
 * steps, the list and quote boxes, the code block and the table.
 *
 * They live beside the band's stylesheet because that file crossed the line
 * budget, and they are SPREAD into `TranscriptParts.createTranscriptStyles` —
 * one table at runtime, produced by one call, so a markdown style cannot drift
 * from the page, ink or hairline it sits next to.
 *
 * No numeric `fontWeight` appears here, and no weight is implied by a literal:
 * on Android a numeric weight beside a custom family is silently ignored, so
 * every weight below is the face's own name (`design.ts` `families`).
 */
import { StyleSheet } from "react-native";

import { families, radius, spacing, type, type DesignColors } from "../../theme/design";
import { TABLE_CELL_PADDING, TABLE_MIN_COLUMN_WIDTH } from "./transcriptLayout";

export function markdownStyles(colors: DesignColors) {
  return StyleSheet.create({
    // Bold and italic take the READING face's weights, never the sans ones.
    inlineBold: {
      fontFamily: families.display,
    },
    inlineItalic: {
      fontFamily: families.displayItalic,
    },
    inlineCode: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: radius.xs,
      fontFamily: families.mono,
      paddingHorizontal: spacing.xxs,
    },
    // Underlined as well as tinted: colour alone may not be the only thing that
    // says "this opens" (WCAG 1.4.1).
    inlineLink: {
      color: colors.accent,
      textDecorationLine: "underline",
    },
    // The `[N]` marker: a filled pill, deliberately NOT tappable — why is in
    // `TranscriptInline.tsx`; the 48 dp chip it mirrors sits under the answer.
    inlineCitation: {
      ...type.meta,
      backgroundColor: colors.accent,
      borderRadius: radius.pill,
      color: colors.onAccent,
      overflow: "hidden",
      paddingHorizontal: spacing.xs,
    },
    // One step per level, all in the reading face: the design layer carries no
    // heading role, so each step borrows an existing role's metrics with the
    // display family instead of inventing sizes: 28/34, 18/24, 16/26.
    heading1: { ...type.display, color: colors.ink },
    heading2: { ...type.title, fontFamily: families.display, color: colors.ink },
    heading3: { ...type.body, fontFamily: families.display, color: colors.ink },
    headingSpacing: {
      marginBottom: spacing.xs,
      marginTop: spacing.lg,
    },
    quote: {
      borderLeftColor: colors.border,
      borderLeftWidth: spacing.xxs,
      paddingLeft: spacing.sm,
    },
    quoteText: { ...type.body, color: colors.silence },
    listRow: {
      flexDirection: "row",
      marginVertical: spacing.xxs,
    },
    listMarker: { ...type.body, color: colors.silence },
    rule: {
      backgroundColor: colors.border,
      // Hairline literal: RN has no token for a device-pixel-thin rule, and the
      // day marker's own hairline is the same literal for the same reason.
      height: 1,
      marginVertical: spacing.sm,
    },
    // Code is mono on its own recessed surface: no syntax highlighting and no
    // copy control, both the owner's decisions. The language label is the fence's
    // own first word, and it shrinks rather than pushing the block wider.
    codeBlock: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: radius.sm,
      overflow: "hidden",
    },
    codeHeader: {
      borderBottomColor: colors.border,
      borderBottomWidth: 1,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xxs,
    },
    codeLang: { ...type.mono, color: colors.silence, flexShrink: 1 },
    codeText: {
      ...type.mono,
      color: colors.ink,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
    },
    // A cell never shrinks below the width a label and its number need
    // (`TABLE_MIN_COLUMN_WIDTH`), which is what makes `tableScrollDecision` the
    // decider instead of a squeeze nobody chose. No vertical rules on purpose:
    // one would come out of the cell's own box and eat into that 97, and the
    // horizontal hairlines already carry the grouping.
    tableRow: {
      flexDirection: "row",
    },
    tableHeaderRow: {
      borderBottomColor: colors.border,
      borderBottomWidth: 1,
    },
    tableRowDivider: {
      borderTopColor: colors.border,
      borderTopWidth: 1,
    },
    tableCell: {
      flex: 1,
      minWidth: TABLE_MIN_COLUMN_WIDTH,
      paddingHorizontal: TABLE_CELL_PADDING,
      paddingVertical: spacing.xs,
    },
    tableHeaderText: { ...type.meta, color: colors.inkSoft, fontFamily: families.sansSemi },
    tableCellText: { ...type.label, color: colors.ink },
  });
}
