/**
 * The transcript's two boxes and the stylesheet they are drawn with: the user's
 * capsule and the bare answer. Split out of `Transcript.tsx` when that file
 * crossed the line budget. They hold no state of their own — the cloud, the
 * markdown and the day marker are the band's business, not theirs.
 *
 * The stylesheet stays whole here, including the band's own jump control, because
 * one table of styles read in one place beats two that can drift.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { elevation, families, radius, spacing, type, type DesignColors } from "../../theme/design";
import { ThoughtCloud } from "../thinking/ThoughtCloud";
import {
  PARAGRAPH_GAP,
  TRANSCRIPT_BOTTOM_PADDING,
  TURN_GAP,
  splitParagraphs,
  type TranscriptLayout,
} from "./transcriptLayout";
import type { TranscriptThinking } from "./transcriptTypes";

/** The only boxed turn: tinted, right-aligned, no border, no tail, one radius. */
export function UserTurn({
  id,
  layout,
  styles,
  text,
}: {
  id: string;
  layout: TranscriptLayout;
  styles: ReturnType<typeof createTranscriptStyles>;
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
 *  cloud sits above it while that answer is still thinking. */
export function Answer({
  colors,
  id,
  labels,
  styles,
  text,
  thinking,
}: {
  colors: DesignColors;
  id: string;
  labels: { show: string; hide: string; region: string };
  styles: ReturnType<typeof createTranscriptStyles>;
  text: string;
  thinking?: TranscriptThinking;
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
      {paragraphs.map((paragraph, index) => (
        <Text key={index} style={[styles.answer, index > 0 ? styles.paragraphGap : null]}>
          {paragraph}
        </Text>
      ))}
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
      // The clearance that lets the last item — the cloud above all — sit clear
      // of the composer band and, when its disclosure opens, have room to open
      // into. Without it the newest element is crushed against the band's edge.
      paddingBottom: TRANSCRIPT_BOTTOM_PADDING,
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
