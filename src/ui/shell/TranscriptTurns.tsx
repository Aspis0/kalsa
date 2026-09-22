/**
 * The transcript's two turn boxes and the inline copy chip — lifted OUT of
 * `TranscriptParts.tsx` (which stayed behind as the stylesheet) to cut a seam
 * rather than raise the size ratchet.
 *
 * The long-press is the controller's, shape for shape: `delayLongPress={350}`
 * on a pressable that has ONLY `onLongPress`, so the gesture cannot fight the
 * scroll view — with no `onPress`, a hold that turns into a drag (Pressability
 * cancels the pending timer once the finger moves) has no tap side effect,
 * while a stationary 350 ms hold opens the menu.
 *
 * The chip is the controller's copy row minus read-aloud (TTS is not wired —
 * deferred, not inert) and minus "more" (it only ever opened this same menu,
 * which the long-press now opens). It flashes for +400 ms (`copiedFlash.ts`) and
 * only when the host's copy actually took the text.
 */
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Copy } from "lucide-react-native";

import { useLocale } from "../../i18n";
import { type DesignColors } from "../../theme/design";
import { ThoughtCloud } from "../thinking/ThoughtCloud";
import { COPIED_FLASH_MS } from "./copiedFlash";
import { SourceChips, ToolRows } from "./TranscriptEvidence";
import { MarkdownBlocks } from "./TranscriptMarkdown";
import { StreamCaret } from "./StreamCaret";
import type { TranscriptStyles } from "./TranscriptParts";
import type { TranscriptLayout } from "./transcriptLayout";
import type { TranscriptSource, TranscriptStop, TranscriptThinking, TranscriptToolCall } from "./transcriptTypes";

/** The pressable's label: the message itself, cut at 200 characters. */
function pressLabel(text: string): string {
  return text.length > 200 ? text.slice(0, 200) : text;
}

/** The message long-press, shared by both boxes: 350 ms, hint from the
 *  catalogue, and NO onPress — see the header. */
function useLongPressProps(onLongPress: (() => void) | undefined, label: string) {
  const { t } = useLocale();
  return {
    onLongPress,
    ...(onLongPress ? { delayLongPress: 350, accessibilityHint: t("chat.a11yMessageActions") } : {}),
    accessibilityLabel: label,
  };
}

/** The inline copy chip: a real 48 dp box around a small painted pill, the
 *  source chip's split. It copies through the host and confirms for +400 ms. */
function CopyChip({
  align,
  colors,
  id,
  onCopy,
  styles,
  text,
}: {
  align: "left" | "right";
  colors: DesignColors;
  id: string;
  onCopy: (text: string) => Promise<boolean>;
  styles: TranscriptStyles;
  text: string;
}) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );
  const label = copied ? t("common.copied") : t("common.copy");
  return (
    <View style={[styles.actionChips, align === "right" ? styles.actionChipsRight : null]}>
      <Pressable
        testID={`transcript.copy.${id}`}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => {
          void (async () => {
            const ok = await onCopy(text);
            if (!ok) return;
            setCopied(true);
            if (flashTimer.current) clearTimeout(flashTimer.current);
            flashTimer.current = setTimeout(() => {
              flashTimer.current = null;
              setCopied(false);
            }, COPIED_FLASH_MS);
          })();
        }}
        style={({ pressed }) => [styles.actionChipBox, { opacity: pressed ? 0.7 : 1 }]}
      >
        <View style={styles.actionChip}>
          <Copy size={14} color={copied ? colors.accent : colors.silence} />
          <Text style={styles.actionChipLabel}>{label}</Text>
        </View>
      </Pressable>
    </View>
  );
}

/** The only boxed turn: tinted, right-aligned, no border, no tail, one radius.
 *  The capsule itself is the pressable — the controller made the bubble the
 *  long-press target rather than a wrapper around it. */
export function UserTurn({
  colors,
  id,
  layout,
  onCopy,
  onLongPress,
  styles,
  text,
}: {
  colors: DesignColors;
  id: string;
  layout: TranscriptLayout;
  onCopy?: (text: string) => Promise<boolean>;
  onLongPress?: () => void;
  styles: TranscriptStyles;
  text: string;
}) {
  const press = useLongPressProps(onLongPress, pressLabel(text));
  return (
    <View style={{ alignSelf: "flex-end", maxWidth: layout.capsuleMaxWidth }}>
      <Pressable {...press} style={[styles.userCapsule]} testID={`transcript.user.${id}`}>
        <Text style={styles.userText}>{text}</Text>
      </Pressable>
      {onCopy && text.trim() ? (
        <CopyChip align="right" colors={colors} id={id} onCopy={onCopy} styles={styles} text={text} />
      ) : null}
    </View>
  );
}

/** The answer is bare: serif ink on the page, full measure, no container, no
 *  tail. The cloud sits above it while that answer is still thinking, the tool
 *  rows sit between the two (what the answer stands on, §2.4), the copy chip
 *  follows the text, and the source chips close the entry below (§2.5). */
export function Answer({
  caret,
  colors,
  id,
  labels,
  onCopy,
  onLongPress,
  readingMeasure,
  sources,
  stop,
  styles,
  text,
  thinking,
  tools,
}: {
  caret?: boolean;
  colors: DesignColors;
  id: string;
  labels: { show: string; hide: string; region: string };
  /** The width the answer got, handed on because the table's own decision
   *  (`tableScrollDecision`) is a function of the column count and this width. */
  readingMeasure: number;
  onCopy?: (text: string) => Promise<boolean>;
  onLongPress?: () => void;
  sources?: readonly TranscriptSource[];
  stop?: TranscriptStop;
  styles: TranscriptStyles;
  text: string;
  thinking?: TranscriptThinking;
  tools?: readonly TranscriptToolCall[];
}) {
  const press = useLongPressProps(onLongPress, pressLabel(text));
  const { t } = useLocale();
  const showChips = onCopy !== undefined && !caret && text.trim().length > 0;
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
      {text.trim() || caret ? (
        // The pressable wraps the TEXT, like the controller's — not the cloud,
        // not the chips, not the source row (those keep their own presses).
        <Pressable {...press} testID={`transcript.text.${id}`}>
          {caret === true ? (
            // Plain text + caret while it arrives: markdown is parsed only once
            // the turn settles, never per token.
            <Text style={styles.answer} testID={`transcript.streaming.${id}`}>
              {text}
              <StreamCaret color={colors.accent} text={text} />
            </Text>
          ) : (
            <MarkdownBlocks
              colors={colors}
              id={id}
              readingMeasure={readingMeasure}
              sources={sources}
              styles={styles}
              text={text}
            />
          )}
        </Pressable>
      ) : null}
      {showChips && onCopy ? (
        // Left-aligned under the answer; the user's copy chip right-aligns under
        // its capsule.
        <CopyChip align="left" colors={colors} id={id} onCopy={onCopy} styles={styles} text={text} />
      ) : null}
      {sources ? <SourceChips sources={sources} styles={styles} /> : null}
      {stop ? (
        // §2.8's line in the outcome's tone; this file writes no other sentence.
        <Text
          style={[styles.stopLine, stop.tone === "danger" ? styles.stopLineDanger : null, stop.tone === "attention" ? styles.stopLineAttention : null]}
          testID={`transcript.stop.${id}`}
        >
          {t(stop.key, stop.params)}
        </Text>
      ) : null}
    </View>
  );
}
