/**
 * TEMPORARY (step 2 of the interface rebuild): renders the bare shell, alone,
 * so it can be screenshotted without the engine, a session or a conversation.
 * Removed in step 3, when the shell is mounted inside the real transcript.
 *
 * This is the only consumer of `Shell` today. It holds no state but the size
 * switch, and calls no service; the strip's text is literal preview data.
 *
 * The size is switched AT RUNTIME on purpose. It used to be a compile-time
 * constant, so capturing 349x621 and the 349x325 keyboard case cost two native
 * builds — two runs of the NDK's parallel `clang`, minutes of a flattened
 * machine, to change one number. See the proof regime in `docs/DESIGN.md`.
 */
import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLocale } from "../../i18n";
import { useLabTheme } from "../labTheme";
import { Shell } from "./Shell";

/** `undefined` lets the live window decide; the other two are the measured cases. */
const PREVIEW_SIZES: ReadonlyArray<number | undefined> = [undefined, 325, 780];

const PREVIEW_MODEL_NAME = "LFM2.5 2.6B";

export function ShellPreview() {
  const insets = useSafeAreaInsets();
  const { t } = useLocale();
  const { mode } = useLabTheme<{ mode: "light" | "dark" }>();
  const [sizeIndex, setSizeIndex] = useState(0);

  return (
    <View style={{ flex: 1 }}>
      <Shell
        insets={{ top: insets.top, bottom: insets.bottom }}
        modelName={PREVIEW_MODEL_NAME}
        whereLabel={t("shell.where.thisPhone")}
        height={PREVIEW_SIZES[sizeIndex]}
        mode={mode}
      />
      {/*
        The switch sits in the top inset, which the preview leaves empty because
        it draws no status bar. A visible chip would land on the strip's own
        controls and would appear in every capture; the file name says which
        case a PNG is, so nothing is lost by keeping the affordance invisible.
      */}
      <Pressable
        testID="shell.preview.size"
        accessibilityRole="button"
        accessibilityLabel={t("shell.a11y.previewSize")}
        onPress={() => setSizeIndex((i) => (i + 1) % PREVIEW_SIZES.length)}
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: Math.max(insets.top, 24) }}
      />
    </View>
  );
}
