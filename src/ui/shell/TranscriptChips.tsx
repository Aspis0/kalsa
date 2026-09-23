/**
 * The inline chip row under a turn — copy under both boxes, read-aloud under
 * an answer — lifted OUT of `TranscriptTurns.tsx` when the read-aloud chip
 * landed, so the turn boxes' file stays under its ratchet
 * (`fileSize.test.ts`) instead of the ratchet being raised for it.
 *
 * Every chip is a real `MIN_TOUCH_TARGET` box around a small painted pill
 * (the source chip's split), never `hitSlop`, with a testID and an
 * accessible name. The copy chip flashes `common.copied` for the
 * controller's +400 ms and only when the host's copy actually took the
 * text; the speak chip's label flips to `voice.stopReading` while its own
 * answer is the one speaking (controller `AiChatPage.tsx:5601-5616`).
 *
 * The controller's THIRD chip — the "more" chip (`Chat:5593-5624`) — is not
 * drawn, by decision, because it is a second door to the same room: its
 * `onPress` calls `onOpenMessageMenu(m.id, m.text, m.role, m.streaming)`,
 * byte-identical to the handler both 350 ms holds call (`Chat:5332,5395`),
 * so it adds an affordance but no capability (PARITY row 16's last delta /
 * Table 3 gap 10). This header is where that absence is recorded.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Copy, Volume2 } from "lucide-react-native";

import { useLocale } from "../../i18n";
import type { DesignColors } from "../../theme/design";
import { COPIED_FLASH_MS } from "./copiedFlash";
import type { TranscriptStyles } from "./TranscriptParts";

/** The row itself: a flex row under the turn, right-aligned under a capsule. */
export function ChipRow({
  align,
  styles,
  children,
}: {
  align: "left" | "right";
  styles: TranscriptStyles;
  children: ReactNode;
}) {
  return (
    <View style={[styles.actionChips, align === "right" ? styles.actionChipsRight : null]}>
      {children}
    </View>
  );
}

/** The copy chip: it copies through the host and confirms for +400 ms. */
export function CopyChip({
  colors,
  id,
  onCopy,
  styles,
  text,
}: {
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
        <Copy size={18} color={copied ? colors.accent : colors.silence} strokeWidth={1.75} />
        <Text style={styles.actionChipLabel}>{label}</Text>
      </View>
    </Pressable>
  );
}

/** The read-aloud chip (D1 row 19): the controller's `MessageActionChip` —
 *  label flips to "Stop reading" while THIS answer speaks. */
export function SpeakChip({
  colors,
  id,
  onSpeak,
  speaking,
  styles,
}: {
  colors: DesignColors;
  id: string;
  onSpeak: () => void;
  speaking: boolean;
  styles: TranscriptStyles;
}) {
  const { t } = useLocale();
  const label = speaking ? t("voice.stopReading") : t("voice.readAloud");
  return (
    <Pressable
      testID={`transcript.speak.${id}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onSpeak}
      style={({ pressed }) => [styles.actionChipBox, { opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={styles.actionChip}>
        <Volume2 size={18} color={speaking ? colors.accent : colors.silence} strokeWidth={1.75} />
        <Text style={styles.actionChipLabel}>{label}</Text>
      </View>
    </Pressable>
  );
}
