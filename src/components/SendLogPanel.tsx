/**
 * The "Send the log" panel body: the privacy sentence in large bold type, one
 * press-to-send button, and the result line. A send starts ONLY on a button
 * press — never on mount. The parent supplies the section chrome (Settings
 * Diagnostics card now, the crash prompt in step 3).
 */
import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { useLocale, type TranslationKey } from "../i18n";
import type { SendLogFailure, SendLogResult } from "../logReport/sendLog";
import { reportSession, sendLogOnce } from "../logReport/sendLogOnce";
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
  // The session as it was at mount, read once: a send another panel started
  // is still in flight, and this panel joins it below instead of pressing.
  const [session] = useState(reportSession);
  const [phase, setPhase] = useState<Phase>(() => {
    if (session.id !== null) return { kind: "sent", id: session.id };
    return session.inFlight !== null ? { kind: "sending" } : { kind: "idle" };
  });
  // Cleared by the mount effect's cleanup: a send that settles after unmount
  // must not set state on a dead tree.
  const mounted = useRef(true);

  const track = (attempt: Promise<SendLogResult>) => {
    void attempt.then(
      (result) => {
        if (!mounted.current) return;
        setPhase(
          result.ok ? { kind: "sent", id: result.id } : { kind: "error", reason: result.reason },
        );
      },
      () => {
        if (mounted.current) setPhase({ kind: "error", reason: "failed" });
      },
    );
  };

  useEffect(() => {
    mounted.current = true;
    // Mounted onto another panel's send: this attaches to it and starts none.
    if (session.inFlight !== null) track(session.inFlight);
    return () => {
      mounted.current = false;
    };
  }, [session]);

  const busy = phase.kind === "sending";
  const done = phase.kind === "sent";

  const onSend = () => {
    if (busy || done) return;
    setPhase({ kind: "sending" });
    track(sendLogOnce());
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
        <Text
          selectable
          testID="sendlog.result"
          accessibilityRole="text"
          // Live region so the report number itself is announced (Android;
          // the button keeps its own label, the result line is the message).
          accessibilityLiveRegion="polite"
          style={[typography.bodySm, { color: colors.muted }]}
        >
          {t("report.sentWithId", { id: phase.id })}
        </Text>
      ) : null}
      {phase.kind === "error" ? (
        <Text
          testID="sendlog.result"
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          style={[typography.bodySm, { color: colors.muted }]}
        >
          {t(errorKey(phase.reason))}
        </Text>
      ) : null}
    </View>
  );
}
