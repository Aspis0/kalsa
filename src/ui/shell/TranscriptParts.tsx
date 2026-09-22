/**
 * The transcript's two boxes and the stylesheet they are drawn with: the user's
 * capsule and the bare answer. Split out of `Transcript.tsx` when that file
 * crossed the line budget. They hold no state of their own — the cloud and the day
 * marker are the band's business, not theirs, and the answer's markdown is
 * `TranscriptMarkdown.tsx`, which these two only place.
 *
 * The band's own stylesheet lives here, including the jump control, the tool
 * rows and the source chips, because one table of styles read in one place beats
 * two that can drift. `TranscriptEvidence.tsx` draws the tool rows and the chips
 * and `TranscriptMarkdown.tsx` the answer's blocks, each taking this table as a
 * prop rather than keeping a second one. The markdown half of the SAME table is
 * built in `transcriptMarkdownStyles.ts` and spread into this one, because putting
 * all of it here crossed the line budget.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { elevation, families, radius, spacing, type, type DesignColors } from "../../theme/design";
import { ThoughtCloud } from "../thinking/ThoughtCloud";
import { SourceChips, ToolRows } from "./TranscriptEvidence";
import { MarkdownBlocks } from "./TranscriptMarkdown";
import { MIN_TOUCH_TARGET, SOURCE_CHIP_TOUCH_BOX } from "./shellGeometry";
import {
  PARAGRAPH_GAP,
  TRANSCRIPT_LAST_ITEM_GAP,
  TURN_GAP,
  type TranscriptLayout,
} from "./transcriptLayout";
import { markdownStyles } from "./transcriptMarkdownStyles";
import type { TranscriptSource, TranscriptThinking, TranscriptToolCall } from "./transcriptTypes";

/** The one stylesheet, as a named type: `TranscriptEvidence.tsx` draws the tool
 *  rows and the source chips with it rather than carrying a second table. */
export type TranscriptStyles = ReturnType<typeof createTranscriptStyles>;

/** The only boxed turn: tinted, right-aligned, no border, no tail, one radius. */
export function UserTurn({
  id,
  layout,
  styles,
  text,
}: {
  id: string;
  layout: TranscriptLayout;
  styles: TranscriptStyles;
  text: string;
}) {
  return (
    <View
      style={[styles.userCapsule, { maxWidth: layout.capsuleMaxWidth }]}
      testID={`transcript.user.${id}`}
    >
      <Text style={styles.userText}>{text}</Text>
    </View>
  );
}

/** The answer is bare: serif ink on the page, full measure, no container. The
 *  cloud sits above it while that answer is still thinking, the tool rows sit
 *  between the two (what the answer stands on, §2.4), and the source chips
 *  close the entry below the text (§2.5). */
export function Answer({
  colors,
  id,
  labels,
  readingMeasure,
  sources,
  styles,
  text,
  thinking,
  tools,
}: {
  colors: DesignColors;
  id: string;
  labels: { show: string; hide: string; region: string };
  /** The width the answer got, handed on because the table's own decision
   *  (`tableScrollDecision`) is a function of the column count and this width. */
  readingMeasure: number;
  sources?: readonly TranscriptSource[];
  styles: TranscriptStyles;
  text: string;
  thinking?: TranscriptThinking;
  tools?: readonly TranscriptToolCall[];
}) {
  return (
    <View testID={`transcript.answer.${id}`}>
      {thinking ? (
        <ThoughtCloud
          answered={thinking.answered}
          colors={colors}
          labels={labels}
          messageId={id}
          reasoning={thinking.reasoning}
          reasoningMs={thinking.reasoningMs}
          tail={thinking.tail}
          working={thinking.working}
        />
      ) : null}
      {tools ? <ToolRows styles={styles} tools={tools} /> : null}
      <MarkdownBlocks
        colors={colors}
        id={id}
        readingMeasure={readingMeasure}
        sources={sources}
        styles={styles}
        text={text}
      />
      {sources ? <SourceChips sources={sources} styles={styles} /> : null}
    </View>
  );
}

export function createTranscriptStyles(colors: DesignColors) {
  // Two `create` calls and a spread, rather than one call whose argument spreads
  // a function's return: TypeScript cannot infer `StyleSheet.create`'s generic
  // through a spread, and the styles come out as `NamedStyles<any>`, which would
  // have turned every `styles.<typo>` in three files into a compile error about
  // the helper instead of about the typo. Creating each half and merging the two
  // typed objects keeps the key checking exact, and the band still gets ONE table
  // from ONE call.
  return {
    ...markdownStyles(colors),
    ...StyleSheet.create({
      root: {
        flex: 1,
      },
      scroll: {
        flex: 1,
      },
      // Drawn only while the reader is away from the end. It is the only thing in
      // this file that moves the view on their behalf, and it is a real 48 dp box
      // rather than a hitSlop.
      //
      // It carries no visible label, and that is a fix rather than a preference. A
      // hostile vision audit of the 621 capture found the labelled version — about
      // 131 x 48 dp — floating over the transcript and hiding the reader's own word
      // "trust?" behind it. Any control that floats over a scroll view covers
      // something; the honest minimum is to cover as little as possible and never
      // the middle of a line, so this became a 48 dp round icon in the bottom-right
      // corner. The accessible name is unchanged (`shell.a11y.jumpToEnd`), and it is
      // the only thing that names the control now.
      // Deviation from §1.2, which forbids a border telling a SURFACE from
      // the page (white on `#f4f8f3` is 1.07:1, so elevation carries
      // surfaces): this ring says "this is a CONTROL", not "this is another
      // surface". Its number is not taste: WCAG 2.2 SC 1.4.11 (non-text
      // contrast) requires the boundary of a UI component to reach 3:1 against
      // the colours it sits between. The first ring (`colors.borderStrong`)
      // measured 1.53:1 against the page and 1.64:1 against the control's own
      // white fill in light mode (2.09 / 1.88 dark), and a vision audit could
      // not trace it — "if the arrow were removed, I could not reliably tell
      // you where the circle ends". `colors.silence` measures 5.97 / 6.41 in
      // light and 7.12 / 6.40 in dark: all four pairs clear 3:1, measured by
      // `transcriptJumpPill.test.ts` on every run. `colors.inkSoft` would also
      // clear it (11.67 / 12.52 light, 11.35 / 10.19 dark) but at 11–13:1
      // reads as a hard frame rather than a control edge, so the quieter of
      // the two passing tokens wins.
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
        // composer band's edge. One chosen number, not the cloud's own height:
        // the cloud has to be visible and scrollable, not to fit in the gap
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
      // container, no lift: the rows state what the answer stands on and must not
      // compete with it for attention.
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
      // The source chips below the answer (§2.5): small text, wrapped, the
      // citation index and the host.
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
        // The mock's `.src` padding: 6 dp above and below, so the chip is about
        // 28 dp tall. Smaller than the 48 dp floor the shell's own controls are
        // held to, deliberately: §2.5 asks for small text chips, and the mock
        // draws exactly this.
        paddingVertical: spacing.xs,
      },
      // The box the finger lands on, which is NOT the paint above (§2.5): 48 dp on
      // both axes, with the chip centred inside it, because the project requires a
      // real box and forbids `hitSlop`. This is where `SOURCE_CHIP_BOX_COST` — the
      // 20 dp per row of chips the design accepts — actually goes. It is also what
      // keeps a row that mixes a tappable chip with a static one on one baseline:
      // the box is invisible on both, so the two pills line up.
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
      // A chip that cannot is text with reduced emphasis, and the dashed hairline
      // is the mock's `.src.off`: it is the difference between the two kinds of
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
    }),
  };
}
