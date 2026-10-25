/**
 * The composer's disclaimer line, drawn the same under the chat band and under
 * the Room's own input. One line, truncated rather than wrapped, and the OS
 * text scale capped at the one its line box can hold.
 */
import { Text } from "react-native";

import { useLocale } from "../../i18n";
import { type } from "../../theme/design";
import { COMPOSER_DISCLAIMER_GAP, DISCLAIMER_MAX_FONT_SCALE } from "./disclaimerMetrics";

export function ComposerDisclaimer({ color }: { color: string }) {
  const { t } = useLocale();
  return (
    <Text
      numberOfLines={1}
      maxFontSizeMultiplier={DISCLAIMER_MAX_FONT_SCALE}
      style={{
        color,
        fontFamily: type.caption.fontFamily,
        fontSize: type.caption.fontSize,
        lineHeight: type.caption.lineHeight,
        marginTop: COMPOSER_DISCLAIMER_GAP,
        textAlign: "center",
      }}
    >
      {t("shell.disclaimer")}
    </Text>
  );
}
