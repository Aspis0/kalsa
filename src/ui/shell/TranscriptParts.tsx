/**
 * The transcript's stylesheet — the one table every band file draws with.
 *
 * The two turn boxes moved out to `TranscriptTurns.tsx` (the file sits on the
 * shell's size ratchet), but the table stayed: `TranscriptEvidence`,
 * `TranscriptMarkdown` and two source-check tests read these styles by name,
 * and one table read in one place beats two that can drift. The markdown half
 * is built in `transcriptMarkdownStyles.ts` and spread in, because all of it
 * here crossed the line budget.
 */
import { StyleSheet } from "react-native";

import { elevation, families, radius, spacing, type, type DesignColors } from "../../theme/design";
import { MIN_TOUCH_TARGET, SOURCE_CHIP_TOUCH_BOX } from "./shellGeometry";
import {
  PARAGRAPH_GAP,
  TRANSCRIPT_LAST_ITEM_GAP,
  TURN_GAP,
} from "./transcriptLayout";
import { markdownStyles } from "./transcriptMarkdownStyles";

/** The one stylesheet, as a named type: the evidence and markdown files draw
 *  with it rather than carrying a second table. */
export type TranscriptStyles = ReturnType<typeof createTranscriptStyles>;

export function createTranscriptStyles(colors: DesignColors) {
  // Two `create` calls and a spread: TypeScript cannot infer
  // `StyleSheet.create`'s generic through a spread — the styles would come out
  // `NamedStyles<any>` and every `styles.<typo>` in three files would error
  // about the helper instead of the typo. Two typed halves merged keeps the
  // key checking exact, and the band still gets ONE table from ONE call.
  return {
    ...markdownStyles(colors),
    ...StyleSheet.create({
      root: {
        flex: 1,
      },
      scroll: {
        flex: 1,
      },
      // Drawn only while the reader is away from the end — the only thing here
      // that moves the view for them. A real 48 dp box, never a hitSlop, and no
      // visible label: a hostile vision audit found the labelled version floating
      // over the transcript and hiding the reader's own word behind it, so it is
      // now a corner icon whose accessible name (`shell.a11y.jumpToEnd`) is the
      // only thing that names it.
      // The ring says "this is a CONTROL", not "this is a surface" (§1.2 lets
      // elevation carry surfaces): WCAG 2.2 SC 1.4.11 wants a UI component's
      // boundary at 3:1, the first ring measured ~1.5:1 and no audit could trace
      // it, and `colors.silence` clears 3:1 against all four pairs — measured by
      // `transcriptJumpPill.test.ts` on every run.
      jump: {
        ...elevation.raised,
        alignItems: "center",
        backgroundColor: colors.surface,
        borderColor: colors.silence,
        borderWidth: 1,
        borderRadius: MIN_TOUCH_TARGET / 2,
        bottom: spacing.sm,
        height: MIN_TOUCH_TARGET,
        justifyContent: "center",
        position: "absolute",
        right: spacing.md,
        width: MIN_TOUCH_TARGET,
      },
      content: {
        // The gap that keeps the last item — the cloud above all — off the
        // composer band's edge: one chosen number, never the cloud's own height
        // (`transcriptLayout.ts` `TRANSCRIPT_LAST_ITEM_GAP`).
        paddingBottom: TRANSCRIPT_LAST_ITEM_GAP,
      },
      userCapsule: {
        alignSelf: "flex-end",
        backgroundColor: colors.selection,
        // Uniform 22 dp on every corner: no tail, so there is no corner to mark.
        borderRadius: radius.lg,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
      },
      userText: {
        color: colors.ink,
        fontFamily: families.sans,
        fontSize: type.body.fontSize,
        lineHeight: type.body.lineHeight,
      },
      answer: {
        color: colors.ink,
        // The reading face. Line-height 26 at 16 is 1.625, the design's ~1.62.
        fontFamily: families.reading,
        fontSize: type.body.fontSize,
        lineHeight: type.body.lineHeight,
      },
      paragraphGap: {
        marginTop: PARAGRAPH_GAP,
      },
      // One quiet line per tool call, above the answer (§2.4). No icon, no
      // container, no lift: the rows state what the answer stands on and must
      // not compete with it for attention.
      toolRows: {
        gap: spacing.xxs,
        marginBottom: spacing.xs,
      },
      toolRow: {
        color: colors.silence,
        fontFamily: families.sansMedium,
        fontSize: type.meta.fontSize,
        lineHeight: type.meta.lineHeight,
      },
      // The source chips below the answer (§2.5).
      sourceChips: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: spacing.xs,
        marginTop: spacing.sm,
      },
      sourceChip: {
        alignItems: "center",
        borderRadius: radius.pill,
        flexDirection: "row",
        gap: spacing.xs,
        maxWidth: "100%",
        paddingHorizontal: spacing.sm,
        // The mock's `.src` padding: ~28 dp tall. Deliberately under the shell's
        // own 48 dp floor — §2.5 asks for small text chips; the BOX below pays.
        paddingVertical: spacing.xs,
      },
      // The box the finger lands on, NOT the paint above (§2.5): 48 dp on both
      // axes with the chip centred inside, because the project requires a real
      // box and forbids `hitSlop` — this is where `SOURCE_CHIP_BOX_COST` goes.
      // Being invisible on both, it also keeps a row mixing tappable and static
      // chips on one baseline.
      sourceChipBox: {
        alignItems: "center",
        justifyContent: "center",
        maxWidth: "100%",
        minHeight: SOURCE_CHIP_TOUCH_BOX,
        minWidth: SOURCE_CHIP_TOUCH_BOX,
      },
      // A chip that can be opened gets a surface and a lift, because the palette
      // cannot tell a surface from the page by a border (§1.2).
      sourceChipLink: {
        backgroundColor: colors.surface,
        ...elevation.raised,
      },
      // A chip that cannot be opened is text with reduced emphasis; the dashed
      // hairline is the mock's `.src.off` — the difference between two kinds of
      // chip, not an attempt to separate a surface from the page.
      sourceChipStatic: {
        borderColor: colors.border,
        borderStyle: "dashed",
        borderWidth: 1,
      },
      sourceIndex: {
        color: colors.accent,
        fontFamily: families.sansSemi,
        fontSize: type.meta.fontSize,
        lineHeight: type.meta.lineHeight,
      },
      sourceIndexStatic: {
        color: colors.silence,
      },
      sourceHost: {
        color: colors.inkSoft,
        flexShrink: 1,
        fontFamily: families.sansMedium,
        fontSize: type.meta.fontSize,
        lineHeight: type.meta.lineHeight,
      },
      sourceHostStatic: {
        color: colors.silence,
      },
      // The inline action row under a turn — today just the copy chip: the
      // controller's MessageActionChip row minus read-aloud and "more", for
      // which this build has no honest version yet.
      actionChips: {
        flexDirection: "row",
        gap: spacing.xs,
        marginTop: spacing.xs,
      },
      // The user's chips ride under the capsule, on its side of the page.
      actionChipsRight: {
        justifyContent: "flex-end",
      },
      // The chip's real box: 48 dp both axes, paint inside it — the source
      // chip's split, on a BUTTON. `hitSlop` would be the cheap way; forbidden.
      actionChipBox: {
        alignItems: "center",
        justifyContent: "center",
        minHeight: MIN_TOUCH_TARGET,
        minWidth: MIN_TOUCH_TARGET,
      },
      actionChip: {
        alignItems: "center",
        backgroundColor: colors.surface,
        borderRadius: radius.pill,
        ...elevation.raised,
        flexDirection: "row",
        gap: spacing.xxs,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
      },
      actionChipLabel: {
        color: colors.ink,
        fontFamily: families.sansMedium,
        fontSize: type.meta.fontSize,
        lineHeight: type.meta.lineHeight,
      },
      dayMarker: {
        alignItems: "center",
        flexDirection: "row",
        gap: spacing.sm,
        marginBottom: TURN_GAP,
      },
      hairline: {
        backgroundColor: colors.border,
        flex: 1,
        height: 1,
      },
      dayLabel: {
        color: colors.silence,
        fontFamily: families.sansMedium,
        fontSize: type.meta.fontSize,
        lineHeight: type.meta.lineHeight,
      },
      // §2.8's stop line: one quiet row at meta size, tone from the outcome.
      stopLine: {
        color: colors.silence,
        fontFamily: families.sansMedium,
        fontSize: type.meta.fontSize,
        lineHeight: type.meta.lineHeight,
        marginTop: spacing.xs,
      },
      stopLineDanger: {
        color: colors.danger,
      },
      stopLineAttention: {
        color: colors.accent,
      },
    }),
  };
}
