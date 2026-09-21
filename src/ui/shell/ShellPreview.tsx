/**
 * TEMPORARY (step 2 of the interface rebuild): renders the bare shell, alone,
 * so it can be screenshotted without the engine, a session or a conversation.
 * Removed in step 3, when the shell is mounted inside the real transcript.
 *
 * This is the only consumer of `Shell` today. It holds no state and calls no
 * service; the strip's text is literal preview data.
 */
import React from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLocale } from "../../i18n";
import { useLabTheme } from "../labTheme";
import { Shell } from "./Shell";

/** Set to 325 to capture the Jelly's keyboard-open case; undefined = window. */
const PREVIEW_HEIGHT: number | undefined = undefined;

const PREVIEW_MODEL_NAME = "LFM2.5 2.6B";

export function ShellPreview() {
  const insets = useSafeAreaInsets();
  const { t } = useLocale();
  const { mode } = useLabTheme<{ mode: "light" | "dark" }>();

  return (
    <Shell
      insets={{ top: insets.top, bottom: insets.bottom }}
      modelName={PREVIEW_MODEL_NAME}
      whereLabel={t("shell.where.thisPhone")}
      height={PREVIEW_HEIGHT}
      mode={mode}
    />
  );
}
