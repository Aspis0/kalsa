/**
 * The transcript's two boxes and the stylesheet they are drawn with: the user's
 * capsule and the bare answer. Split out of `Transcript.tsx` when that file
 * crossed the line budget. They hold no state of their own — the cloud, the
 * markdown and the day marker are the band's business, not theirs.
 *
 * The stylesheet stays whole here, including the band's own jump control AND the
 * tool rows and source chips, because one table of styles read in one place
 * beats two that can drift. `TranscriptEvidence.tsx` draws those two and takes
 * this table as a prop rather than keeping a second one.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { elevation, families, radius, spacing, type, type DesignColors } from "../../theme/design";
import { ThoughtCloud } from "../thinking/ThoughtCloud";
import { SourceChips, ToolRows } from "./TranscriptEvidence";
import {
  PARAGRAPH_GAP,
  TRANSCRIPT_LAST_ITEM_GAP,
  TURN_GAP,
  splitParagraphs,
  type TranscriptLayout,
} from "./transcriptLayout";
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
  sources,
  styles,
  text,
  thinking,
  tools,
}: {
  colors: DesignColors;
  id: string;
  labels: { show: string; hide: string; region: string };
  sources?: readonly TranscriptSource[];
  styles: TranscriptStyles;
  text: string;
  thinking?: TranscriptThinking;
  tools?: readonly TranscriptToolCall[];
}) {
  const paragraphs = splitParagraphs(text);
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
      {paragraphs.map((paragraph, index) => (
        <Text key={index} style={[styles.answer, index > 0 ? styles.paragraphGap : null]}>
          {paragraph}
        </Text>
      ))}
      {sources ? <SourceChips sources={sources} styles={styles} /> : null}
    </View>
  );
}

export function createTranscriptStyles(colors: DesignColors) {
  return StyleSheet.create({
    root: {
      flex: 1,
    },
    scroll: {
      flex: 1,
    },
    // Drawn only while the reader is away from the end. It is the only thing in
    // this file that moves the view on their behalf, and it is a real 48 dp box
    // rather than a hitSlop.
    jump: {
      ...elevation.raised,
      alignItems: "center",
      alignSelf: "center",
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      bottom: spacing.sm,
      flexDirection: "row",
      gap: spacing.sm,
      minHeight: 48,
      paddingHorizontal: spacing.md,
      position: "absolute",
    },
    jumpLabel: {
      color: colors.inkSoft,
      fontFamily: families.sansMedium,
      fontSize: type.meta.fontSize,
      lineHeight: type.meta.lineHeight,
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
  });
}
