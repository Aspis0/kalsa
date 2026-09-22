/**
 * The translation state under ONE message (D1 row 18): the controller's
 * "Translating…" row (`AiChatPage.tsx:5446-5462`, `:5631-5647`) and its
 * `TranslationBlock` (`Chat:5919-6010`) as one leaf — the busy row while the
 * engine job runs, the bordered panel once a result exists.
 *
 * The controller's layout, kept: a header with the language badge captured
 * at run start, expand/collapse on the header, a close that dismisses the
 * result, error + Retry on a failed run, the copy with its own 1500 ms flash
 * (`Chat:5955`), the truncation note when the source overran the engine's
 * 4000-character cap. Its `hitSlop={8}` close/copy/retry controls become real
 * `MIN_TOUCH_TARGET` boxes here — this project's floor, no slop.
 */
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { ChevronDown, Copy, Languages, X } from "lucide-react-native";

import { useLocale } from "../../i18n";
import { radius, spacing, type, type DesignColors } from "../../theme/design";
import { MIN_TOUCH_TARGET } from "./shellGeometry";
import type { TranscriptTranslateAction } from "./transcriptTypes";

/** The block's own copy confirmation: the controller's 1500 ms, not the
 *  menu/chip's +400 ms flash — a different control, its own number. */
const COPY_FLASH_MS = 1500;

export type TranslationUnderProps = {
  /** Right under a user capsule, left under an answer (controller's order). */
  align: "left" | "right";
  colors: DesignColors;
  /** The message id, for the testIDs the host's tests address. */
  id: string;
  /** The band's clipboard path; absent → the block draws no copy control. */
  onCopy?: (text: string) => Promise<boolean>;
  action: TranscriptTranslateAction;
};

export function TranslationUnder({
  align,
  colors,
  id,
  onCopy,
  action,
}: TranslationUnderProps) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );
  const { view } = action;
  const styles = {
    spinnerRow: {
      marginTop: spacing.xs,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: spacing.xs,
      ...(align === "right" ? { alignSelf: "flex-end" as const } : {}),
    },
    panel: {
      marginTop: spacing.xs,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: "hidden" as const,
    },
    header: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: spacing.xs,
      paddingHorizontal: spacing.xs,
    },
    toggle: {
      flex: 1,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: spacing.xs,
      minHeight: MIN_TOUCH_TARGET,
    },
    label: {
      flex: 1,
      ...type.meta,
      color: colors.silence,
    },
    closeBox: {
      width: MIN_TOUCH_TARGET,
      height: MIN_TOUCH_TARGET,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    body: {
      paddingHorizontal: spacing.sm,
      paddingBottom: spacing.sm,
      gap: spacing.xs,
    },
    text: {
      ...type.label,
      color: colors.ink,
    },
    note: {
      ...type.meta,
      color: colors.silence,
    },
    buttonBox: {
      minHeight: MIN_TOUCH_TARGET,
      minWidth: MIN_TOUCH_TARGET,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: spacing.xxs,
      paddingHorizontal: spacing.xs,
    },
    buttonLabel: {
      ...type.meta,
      color: colors.accent,
    },
  };

  if (view.busy) {
    return (
      <View style={styles.spinnerRow} testID={`transcript.translating.${id}`}>
        <ActivityIndicator size="small" color={colors.silence} />
        <Text style={styles.note}>{t("translate.translating")}</Text>
      </View>
    );
  }

  const result = view.result;
  if (!result) return null;
  // Badge from the result's own lang (captured at run start), not the live
  // locale — the controller's rule (`Chat:5931-5932`).
  const langBadge = result.lang === "it" ? "IT" : "EN";
  const label = t("translate.label", { lang: langBadge });

  const copyLabel = copied ? t("common.copied") : t("common.copy");
  const handleCopy = () => {
    if (!onCopy || !result.text) return;
    void onCopy(result.text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => {
        flashTimer.current = null;
        setCopied(false);
      }, COPY_FLASH_MS);
    });
  };

  return (
    <View style={styles.panel} testID={`transcript.translation.${id}`}>
      <View style={styles.header}>
        <Pressable
          testID={`transcript.translation.toggle.${id}`}
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={action.onToggle}
          style={styles.toggle}
        >
          <Languages size={14} color={colors.silence} />
          <Text style={styles.label}>{label}</Text>
          <View style={{ transform: [{ rotate: view.expanded ? "180deg" : "0deg" }] }}>
            <ChevronDown size={14} color={colors.silence} />
          </View>
        </Pressable>
        <Pressable
          testID={`transcript.translation.close.${id}`}
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          onPress={action.onClose}
          style={({ pressed }) => [styles.closeBox, { opacity: pressed ? 0.7 : 1 }]}
        >
          <X size={14} color={colors.silence} />
        </Pressable>
      </View>
      {view.expanded ? (
        <View style={styles.body}>
          {result.error ? (
            <>
              <Text style={styles.text}>{t("translate.error")}</Text>
              <Pressable
                testID={`transcript.translation.retry.${id}`}
                accessibilityRole="button"
                accessibilityLabel={t("translate.retry")}
                onPress={action.onRetry}
                style={({ pressed }) => [styles.buttonBox, { opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={styles.buttonLabel}>{t("translate.retry")}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.text}>{result.text}</Text>
              {result.truncated ? (
                <Text style={styles.note}>{t("translate.truncated")}</Text>
              ) : null}
              {onCopy ? (
                <Pressable
                  testID={`transcript.translation.copy.${id}`}
                  accessibilityRole="button"
                  accessibilityLabel={copyLabel}
                  onPress={handleCopy}
                  style={({ pressed }) => [styles.buttonBox, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <Copy size={14} color={colors.accent} />
                  <Text style={styles.buttonLabel}>{copyLabel}</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}
