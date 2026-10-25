/**
 * The one-shot ask shown at launch after the previous process exited
 * uncleanly: the approved title and body, then the Settings panel's own send
 * body (privacy sentence, press-only Send the log, id/error line) and Not now.
 * The decision runs once on mount and consumes the record; Not now (or
 * Android back) hides the prompt for this run only, and nothing sends without
 * the press.
 */
import { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";

import { useLocale } from "../i18n";
import { consumeUncleanExitAsk } from "../logReport/uncleanExit";
import { radius, shadows, spacing } from "../theme/tokens";
import { fontFamilies, useTypography } from "../theme/typography";
import { useLabTheme } from "../ui/labTheme";
import { MIN_TOUCH_TARGET } from "../ui/shell/shellGeometry";
import { SendLogPanel } from "./SendLogPanel";

export function UncleanExitPrompt() {
  const { t } = useLocale();
  const typography = useTypography();
  const { colors } = useLabTheme<any>();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let mounted = true;
    consumeUncleanExitAsk()
      .then((ask) => {
        if (mounted && ask) setVisible(true);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  if (!visible) return null;
  const dismiss = () => setVisible(false);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.panelSolid }]}>
          <Text testID="uncleanExit.title" style={[typography.title, { color: colors.ink }]}>
            {t("report.crashUncleanTitle")}
          </Text>
          <Text style={[typography.bodySm, { color: colors.muted }]}>
            {t("report.crashUncleanBody")}
          </Text>
          <SendLogPanel />
          <Pressable
            testID="uncleanExit.notNow"
            accessibilityRole="button"
            accessibilityLabel={t("report.notNow")}
            onPress={dismiss}
            style={({ pressed }) => [styles.notNow, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text
              style={[
                typography.bodySm,
                { color: colors.muted, fontFamily: fontFamilies.bodySemi },
              ]}
            >
              {t("report.notNow")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = {
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.42)",
    justifyContent: "center" as const,
    padding: spacing.lg,
  },
  card: {
    borderRadius: radius.xl,
    ...shadows.lift,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  notNow: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
} as const;
