/**
 * The "Send the log" panel body: the privacy sentence in large bold type, one
 * press-to-send button, and the result line. Fires sendLog() only from the
 * button press — never on mount. The parent supplies the section chrome
 * (Settings Diagnostics card now, the crash prompt in step 3).
 */
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { useLocale, type TranslationKey } from "../i18n";
import { sendLog, type SendLogFailure } from "../logReport/sendLog";
import { useLabTheme } from "../ui/labTheme";
import { radius, spacing } from "../theme/tokens";
import { useTypography, fontFamilies } from "../theme/typography";

type Phase =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; id: string }
  | { kind: "error"; reason: SendLogFailure["reason"] };

function errorKey(reason: SendLogFailure["reason"]): TranslationKey {
  switch (reason) {
    case "empty":
      return "report.errEmpty";
    case "rate_limited":
      return "report.errRateLimited";
    case "daily_limit":
      return "report.errTryTomorrow";
    case "failed":
      return "report.errSend";
  }
}

export function SendLogPanel() {
  const { t } = useLocale();
  const typography = useTypography();
  const { colors } = useLabTheme<any>();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const busy = phase.kind === "sending";
  const done = phase.kind === "sent";

  const onSend = () => {
    if (busy || done) return;
    setPhase({ kind: "sending" });
    void sendLog().then((result) => {
      if (result.ok) setPhase({ kind: "sent", id: result.id });
      else setPhase({ kind: "error", reason: result.reason });
    });
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[typography.title, { color: colors.ink }]}>{t("report.privacy")}</Text>
      <Pressable
        onPress={onSend}
        disabled={busy || done}
        accessibilityRole="button"
        accessibilityLabel={busy ? t("report.sending") : t("report.send")}
        testID="sendlog.send"
        style={{
          marginTop: spacing.xxs,
          paddingVertical: spacing.sm,
          borderRadius: radius.md,
          backgroundColor: colors.accent,
          alignItems: "center",
          opacity: busy || done ? 0.6 : 1,
        }}
      >
        <Text
          style={[
            typography.bodySm,
            { color: colors.primaryText, fontFamily: fontFamilies.displayBold },
          ]}
        >
          {busy ? t("report.sending") : t("report.send")}
        </Text>
      </Pressable>
      {phase.kind === "sent" ? (
        <Text selectable testID="sendlog.result" style={[typography.bodySm, { color: colors.muted }]}>
          {t("report.sentWithId", { id: phase.id })}
        </Text>
      ) : null}
      {phase.kind === "error" ? (
        <Text testID="sendlog.result" style={[typography.bodySm, { color: colors.muted }]}>
          {t(errorKey(phase.reason))}
        </Text>
      ) : null}
    </View>
  );
}
