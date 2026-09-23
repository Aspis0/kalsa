/**
 * The mini-app card in the transcript (D1 row 28) — the controller's
 * `MiniappCard` (`AiChatPage.tsx:6033-6093`, rendered at `:5665`) with two
 * deliberate differences, both this build's rules:
 *
 * - the Open control is a real 48 dp box (the controller's was inline text),
 *   with a `testID` and an accessible name like every interactive node here;
 * - with NO opener wired (the preview), the card drops the "tap to open"
 *   hint AND the Open control — the controller dimmed an inert pressable to
 *   50% opacity instead, which promises a tap nothing can honour.
 *
 * Colour: the controller's `computeSoft`/`compute` pair resolves to the
 * accent tint this palette has (the same mapping `ctaChipRecovery` uses —
 * `TranscriptParts.tsx`, PARITY row 12(a): one accent by decision).
 */
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BarChart2,
  BookOpen,
  Calculator,
  ChevronRight,
  ClipboardList,
  Columns2,
  HelpCircle,
  Scale,
  Sparkles,
} from "lucide-react-native";

import { useLocale } from "../../i18n";
import { radius, spacing, type } from "../../theme/design";
import { MIN_TOUCH_TARGET } from "./shellGeometry";
import type { DesignColors } from "../../theme/design";
import type { TranscriptMiniapp } from "./transcriptTypes";

/** The controller's icon map (`AiChatPage.tsx:449-482`), moved whole: tool
 *  miniapps carry the template id as `kind`, legacy ones the model's kind. */
function miniappIcon(kind: string): typeof Sparkles {
  switch (kind) {
    case "compare_data":
      return Columns2;
    case "quick_calculator":
      return Calculator;
    case "reading_quiz":
      return HelpCircle;
    case "kpi_strip":
      return BarChart2;
    case "checklist":
      return ClipboardList;
    case "pros_cons":
      return Scale;
    case "calculator":
    case "comparison":
      return BarChart2;
    case "planner":
      return ClipboardList;
    case "quiz":
      return BookOpen;
    default:
      return Sparkles;
  }
}

function createStyles(colors: DesignColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: `${colors.accent}1f`,
      borderColor: colors.accent,
      borderWidth: 0.5,
      borderRadius: radius.md,
      gap: spacing.xxs,
      marginTop: 6,
      padding: spacing.md,
    },
    header: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.xs,
    },
    // Type roles carry their own family — a numeric fontWeight beside a
    // custom face is the Android trap this palette documents (`design.ts`).
    title: {
      ...type.label,
      color: colors.ink,
      flex: 1,
    },
    badge: {
      backgroundColor: colors.accent,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm - 4,
      paddingVertical: 2,
    },
    badgeText: {
      ...type.meta,
      color: colors.onAccent,
    },
    hint: {
      ...type.meta,
      color: colors.silence,
    },
    // The real box: 48 dp on both axes, paint inside it. `hitSlop` is the
    // cheap way and is forbidden here (same rule as every shell control).
    openBox: {
      alignItems: "center",
      alignSelf: "flex-end",
      flexDirection: "row",
      gap: 4,
      justifyContent: "center",
      minHeight: MIN_TOUCH_TARGET,
      minWidth: MIN_TOUCH_TARGET,
      paddingHorizontal: spacing.xs,
    },
    openLabel: {
      ...type.meta,
      color: colors.accent,
    },
  });
}

export function MiniappCard({
  colors,
  id,
  miniapp,
  onOpen,
}: {
  colors: DesignColors;
  /** The message id, for the testID namespace. */
  id: string;
  miniapp: TranscriptMiniapp;
  /** Absent = no opener wired: no hint, no control (see the header). */
  onOpen?: () => void;
}) {
  const { t } = useLocale();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const Icon = miniappIcon(miniapp.kind);
  return (
    <View
      accessibilityLabel={t("renderer.interactiveMiniappA11y", { title: miniapp.title })}
      style={styles.card}
      testID={`transcript.miniapp.${id}`}
    >
      <View style={styles.header}>
        <Icon size={20} color={colors.accent} strokeWidth={1.75} />
        <Text numberOfLines={1} style={styles.title}>
          {miniapp.title}
        </Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{t("chat.interactive")}</Text>
        </View>
      </View>
      {onOpen ? (
        <>
          <Text style={styles.hint}>{t("chat.miniappTap")}</Text>
          <Pressable
            accessibilityLabel={t("chat.openTool")}
            accessibilityRole="button"
            onPress={onOpen}
            style={({ pressed }) => [styles.openBox, { opacity: pressed ? 0.7 : 1 }]}
            testID={`transcript.miniapp.open.${id}`}
          >
            <Text style={styles.openLabel}>{t("chat.openTool")}</Text>
            <ChevronRight size={16} color={colors.accent} strokeWidth={1.75} />
          </Pressable>
        </>
      ) : null}
    </View>
  );
}
