/**
 * The long-chat nudge row (controller `Chat:3987-4006`): dot, sentence,
 * "New chat" — whose press is the controller's own action (`clearChat`
 * there, the new-conversation action here, which also resets the latch
 * through the id change). The action is a real `MIN_TOUCH_TARGET` box, not
 * the controller's `hitSlop={8}`.
 *
 * Cut out of `HostChatSurface.tsx` when the attach sheet landed: a row with
 * one job is a file with one job, and the surface composes it (the latch,
 * the recompute deps and the render gate stay in the surface — the state IS
 * its concern; pinned by `longChatNudge.test.ts`).
 */
import { Pressable, Text, View } from "react-native";

import { useLocale } from "../i18n";
import { spacing, type, type DesignColors } from "../theme/design";
import { MIN_TOUCH_TARGET } from "../ui/shell/shellGeometry";

export interface LongChatNudgeRowProps {
  colors: DesignColors;
  onNewChatPress: () => void;
}

export function LongChatNudgeRow({ colors, onNewChatPress }: LongChatNudgeRowProps) {
  const { t } = useLocale();
  return (
    <View
      testID="transcript.longChatNudge"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        marginHorizontal: spacing.md,
        marginTop: spacing.sm,
        padding: spacing.sm + 2,
        backgroundColor: `${colors.accent}1f`,
        borderRadius: 12,
      }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: colors.accent }} />
      <Text numberOfLines={2} style={[type.meta, { flex: 1, color: colors.ink }]}>
        {t("chat.longChatNudge")}
      </Text>
      <Pressable
        testID="transcript.longChatNudge.newChat"
        accessibilityRole="button"
        accessibilityLabel={t("chat.a11yNewChat")}
        onPress={onNewChatPress}
        style={({ pressed }) => [
          {
            minHeight: MIN_TOUCH_TARGET,
            minWidth: MIN_TOUCH_TARGET,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: spacing.sm,
          },
          { opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Text style={[type.meta, { color: colors.silence }]}>{t("chat.longChatNudgeAction")}</Text>
      </Pressable>
    </View>
  );
}
