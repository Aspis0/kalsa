/**
 * TEMPORARY (steps 2–3 of the interface rebuild): renders the shell with a demo
 * transcript, alone, so it can be screenshotted without the engine, a session
 * or a conversation. Removed when the shell is mounted inside the real
 * conversation.
 *
 * This is the only consumer of `Shell` today. It holds no state but the size
 * switch, and calls no service: the strip's text and the messages below are
 * literal preview DATA, not interface copy, which is why they do not go through
 * `t()` — the same reason the model name does not.
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
import { Transcript, type TranscriptMessage } from "./Transcript";

/** `undefined` lets the live window decide; the other two are the measured cases. */
const PREVIEW_SIZES: ReadonlyArray<number | undefined> = [undefined, 325, 780];

const PREVIEW_MODEL_NAME = "LFM2.5 2.6B";

/** The demo's clock, frozen once so the day marker is stable across a capture. */
const PREVIEW_NOW = Date.now();
const MINUTE = 60_000;

function daysAgo(days: number): number {
  const date = new Date(PREVIEW_NOW);
  date.setDate(date.getDate() - days);
  return date.getTime();
}

/** Sample data. The day marker needs a turn on an earlier day to be visible. */
const PREVIEW_TRANSCRIPT: readonly TranscriptMessage[] = [
  {
    id: "preview-1",
    role: "user",
    text: "What does the document say about measurement error?",
    createdAt: daysAgo(1) + 9 * 60 * MINUTE,
  },
  {
    id: "preview-2",
    role: "assistant",
    text:
      "It compares three methods and reports the largest error each one produced.\n\n" +
      "The third method is the steadiest across the whole series, but it is the slowest to run.",
    createdAt: daysAgo(1) + 9 * 60 * MINUTE + MINUTE,
  },
  {
    id: "preview-3",
    role: "user",
    text: "And which one should I trust?",
    createdAt: PREVIEW_NOW - 3 * MINUTE,
  },
  {
    id: "preview-4",
    role: "assistant",
    text: "",
    createdAt: PREVIEW_NOW,
    thinking: {
      reasoning:
        "Weighing the three methods against the scatter in the series. The second one overfits the noisiest points; the third holds its error flat across the range.",
      working: true,
      answered: false,
    },
  },
];

export function ShellPreview() {
  const insets = useSafeAreaInsets();
  const { t } = useLocale();
  const { mode } = useLabTheme<{ mode: "light" | "dark" }>();
  const [sizeIndex, setSizeIndex] = useState(0);
  const size = { top: insets.top, bottom: insets.bottom };
  const height = PREVIEW_SIZES[sizeIndex];

  return (
    <View style={{ flex: 1 }}>
      <Shell
        insets={size}
        modelName={PREVIEW_MODEL_NAME}
        whereLabel={t("shell.where.thisPhone")}
        height={height}
        mode={mode}
      >
        <Transcript
          insets={size}
          messages={PREVIEW_TRANSCRIPT}
          height={height}
          mode={mode}
          now={PREVIEW_NOW}
        />
      </Shell>
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
