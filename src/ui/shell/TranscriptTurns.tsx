/**
 * The transcript's two turn boxes — lifted OUT of `TranscriptParts.tsx`
 * (which stayed behind as the stylesheet) to cut a seam rather than raise the
 * size ratchet; the inline chips live beside it in `TranscriptChips.tsx`.
 *
 * The long-press is the controller's, shape for shape: `delayLongPress={350}`
 * on a pressable that has ONLY `onLongPress`, so the gesture cannot fight the
 * scroll view — with no `onPress`, a hold that turns into a drag (Pressability
 * cancels the pending timer once the finger moves) has no tap side effect,
 * while a stationary 350 ms hold opens the menu.
 *
 * The chips both boxes draw are `TranscriptChips.tsx` (copy, and read-aloud
 * under an answer; no "more" — the long-press opens that menu now). This
 * file adds what hangs under a message itself: the translation block and,
 * under a user capsule, the edit badge.
 */
import { Pressable, Text, View } from "react-native";

import { useLocale } from "../../i18n";
import { spacing, type as typeRole, type DesignColors } from "../../theme/design";
import { ThoughtCloud } from "../thinking/ThoughtCloud";
import { MiniappCard } from "./MiniappCard";
import { ChipRow, CopyChip, SpeakChip } from "./TranscriptChips";
import { SourceChips, ToolRows } from "./TranscriptEvidence";
import { MarkdownBlocks } from "./TranscriptMarkdown";
import { StreamCaret } from "./StreamCaret";
import type { TranscriptStyles } from "./TranscriptParts";
import { TranslationUnder } from "./TranslationBlock";
import type { TranscriptLayout } from "./transcriptLayout";
import type { TranscriptCta, TranscriptMiniapp, TranscriptSource, TranscriptStop, TranscriptThinking, TranscriptToolCall, TranscriptTranslateAction } from "./transcriptTypes";

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

/** The only boxed turn: tinted, right-aligned, no border, no tail, one radius.
 *  The capsule itself is the pressable — the controller made the bubble the
 *  long-press target rather than a wrapper around it. */
export function UserTurn({
  colors,
  edited,
  id,
  layout,
  onCopy,
  onLongPress,
  styles,
  text,
  translate,
}: {
  colors: DesignColors;
  /** The edit modal's save stamped this bubble (D1 row 17). */
  edited?: boolean;
  id: string;
  layout: TranscriptLayout;
  onCopy?: (text: string) => Promise<boolean>;
  onLongPress?: () => void;
  styles: TranscriptStyles;
  text: string;
  /** The translation under this message, handlers bundled (D1 row 18). */
  translate?: TranscriptTranslateAction | null;
}) {
  const press = useLongPressProps(onLongPress, pressLabel(text));
  const { t } = useLocale();
  const chips = onCopy !== undefined && text.trim().length > 0;
  return (
    <View style={{ alignSelf: "flex-end", maxWidth: layout.capsuleMaxWidth }}>
      <Pressable {...press} style={[styles.userCapsule]} testID={`transcript.user.${id}`}>
        <Text style={styles.userText}>{text}</Text>
      </Pressable>
      {chips && onCopy ? (
        <ChipRow align="right" styles={styles}>
          <CopyChip colors={colors} id={id} onCopy={onCopy} styles={styles} text={text} />
        </ChipRow>
      ) : null}
      {edited ? (
        // The controller's badge under the capsule (`Chat:5437-5445`): the
        // catalogued word "Edit", quiet, right-aligned — not a control.
        <Text
          style={[
            typeRole.meta,
            { color: colors.silence, marginTop: spacing.xs, alignSelf: "flex-end" as const },
          ]}
          testID={`transcript.edited.${id}`}
          accessibilityRole="text"
          accessibilityLabel={t("chat.edit")}
        >
          {t("chat.edit")}
        </Text>
      ) : null}
      {translate ? (
        <TranslationUnder
          align="right"
          action={translate}
          colors={colors}
          id={id}
          onCopy={onCopy}
        />
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
  ctas,
  id,
  labels,
  miniapp,
  onCopy,
  onLongPress,
  onMiniappOpen,
  onSpeak,
  readingMeasure,
  sources,
  speaking,
  stop,
  styles,
  text,
  thinking,
  tools,
  translate,
}: {
  caret?: boolean;
  colors: DesignColors;
  ctas?: readonly TranscriptCta[];
  id: string;
  labels: { show: string; hide: string; region: string };
  /** The mini-app card under this answer (D1 row 28); the opener applies
   *  the controller's open policy in the host. */
  miniapp?: TranscriptMiniapp;
  /** The width the answer got, handed on because the table's own decision
   *  (`tableScrollDecision`) is a function of the column count and this width. */
  readingMeasure: number;
  onCopy?: (text: string) => Promise<boolean>;
  onLongPress?: () => void;
  onMiniappOpen?: (miniapp: TranscriptMiniapp) => void;
  /** Read-aloud's press on THIS answer and the speaking fact (D1 row 19):
   *  absent → the chip is absent, never present and silent. */
  onSpeak?: () => void;
  speaking?: boolean;
  sources?: readonly TranscriptSource[];
  stop?: TranscriptStop;
  styles: TranscriptStyles;
  text: string;
  thinking?: TranscriptThinking;
  tools?: readonly TranscriptToolCall[];
  /** The translation under this answer, handlers bundled (D1 row 18). */
  translate?: TranscriptTranslateAction | null;
}) {
  const press = useLongPressProps(onLongPress, pressLabel(text));
  const { t } = useLocale();
  const showChips =
    (onCopy !== undefined || onSpeak !== undefined) && !caret && text.trim().length > 0;
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
      {showChips ? (
        // Left-aligned under the answer; the user's copy chip right-aligns
        // under its capsule. Read-aloud rides the same row, after copy —
        // the controller's order (`Chat:5593-5624`), minus "more".
        <ChipRow align="left" styles={styles}>
          {onCopy && text.trim() ? (
            <CopyChip colors={colors} id={id} onCopy={onCopy} styles={styles} text={text} />
          ) : null}
          {onSpeak ? (
            <SpeakChip
              colors={colors}
              id={id}
              onSpeak={onSpeak}
              speaking={speaking === true}
              styles={styles}
            />
          ) : null}
        </ChipRow>
      ) : null}
      {translate ? (
        // Before the card and the sources: the block belongs to the message
        // itself, exactly where the controller drew it (`Chat:5650`).
        <TranslationUnder
          align="left"
          action={translate}
          colors={colors}
          id={id}
          onCopy={onCopy}
        />
      ) : null}
      {miniapp ? (
        // The controller's order (`AiChatPage.tsx:5665`): the card sits above
        // the source chips — what the answer IS, then what it stands on.
        <MiniappCard
          colors={colors}
          id={id}
          miniapp={miniapp}
          onOpen={onMiniappOpen ? () => onMiniappOpen(miniapp) : undefined}
        />
      ) : null}
      {sources ? <SourceChips sources={sources} styles={styles} /> : null}
      {ctas && ctas.length > 0 ? (
        // D1 row 26: the controller drew these as buttons, but its own press
        // handler was a stub (`AppShell.tsx:7047`) and this build has no
        // outputs view behind `target: "outputs"` — so the chip is TEXT, not
        // a button that does nothing.
        <View style={styles.ctaRow} testID={`transcript.ctas.${id}`}>
          {ctas.map((cta, ctaIdx) => (
            <View
              key={cta.id ?? `${cta.kind}-${ctaIdx}`}
              style={[
                styles.ctaChip,
                cta.kind === "run_monitor_recovery" ? styles.ctaChipRecovery : null,
              ]}
              testID={`transcript.cta.${id}.${ctaIdx}`}
              accessibilityRole="text"
              accessibilityLabel={cta.label}
            >
              <Text numberOfLines={1} style={styles.ctaLabel}>
                {cta.label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
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
