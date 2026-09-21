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
 * machine, to change one number. See the proof regime in `docs/DESIGN.md`. The
 * three cases are a data list and the choice is state: no `PREVIEW_HEIGHT`-style
 * constant comes back, because that is the shape that made one number cost a
 * rebuild.
 *
 * ── Why the switch is where it is (2026-09-21) ─────────────────────────────
 * It used to be an invisible tap zone in the top inset (`top: 0`, height
 * `max(insets.top, 24)`), justified by the claim that the preview "leaves the
 * top inset empty because it draws no status bar". On this device that claim is
 * false: the top inset belongs to the STATUS BAR, whose touchable region sits
 * above the app window, so taps in it are dropped before the app sees them.
 * Measured on the Jelly Star emulator: taps at y = 3, 12, 16 and 30 px in adb
 * coordinates (all inside the 24 dp status bar) did nothing, and
 * the only reason a 325 dp capture exists at all is that a D-pad focused the
 * old zone — `KEYCODE_TAB` nine times, then `KEYCODE_ENTER`. A control that
 * needs a keyboard is not a control. The switch is now three visible segments
 * at the top of the TRANSCRIPT band: below the status bar, below the shell's
 * own strip, above the composer, clear of all of them, and it works under a
 * thumb. It covers the transcript's first 48 dp; that is the price of a
 * reachable affordance, and it is preview chrome, not the shell. Each segment
 * is `MIN_TOUCH_TARGET` tall and, at 349 dp wide, 103 dp wide; nothing in the
 * node test stack can measure a rendered tree (DESIGN.md, "proof regime"), so
 * that is a claim the screenshot has to carry, not a test.
 *
 * ── How a capture is taken, so the next one is scriptable ──────────────────
 * 325 dp IS THE APP AREA WITH THE SOFT KEYBOARD UP (Jelly Star: 480x854 px at
 * 220 dpi = 349x621 dp down, 480x447 px = 349x325 dp with the IME). A capture
 * of 325 WITHOUT the keyboard is not evidence: the shell then fills 325 of the
 * window's 621 dp, the rest is blank, and the PNG reads as a broken half-empty
 * screen — which is how the last one was read. The keyboard comes from focusing
 * the composer field; nothing is drawn to imitate it. When the pinned case and
 * the live window disagree the bar says so on screen, so a misleading PNG
 * carries its own warning instead of waiting for a reviewer to notice.
 *
 * The sequence, with `SHELL_PREVIEW = true` in `App.tsx`. `tap_node`,
 * `tap_editable`, `shot` and `OUT` are `scripts/ci-lib.sh`'s: they read a node's
 * live bounds, because fixed coordinates break as soon as the IME moves the
 * layout. The strings tapped are the segments' accessibility labels, which
 * follow the app's locale — English below (`DEFAULT_LOCALE`), «Anteprima a
 * 621 dp» under the Italian catalogue; the live segment prints the window's own
 * height.
 *
 *   adb shell input keyevent KEYCODE_WAKEUP                      # screen on
 *   adb shell wm size; adb shell wm density                      # 480x854, 220
 *   adb shell am start -n com.kalsa.app/.MainActivity            # Metro reload
 *   adb shell input keyevent 111                                 # ESC: IME down
 *   OUT=mock
 *
 *   # (1) the live window, 621 dp on the Jelly, keyboard down
 *   tap_node "Preview at 621 dp"; sleep 1; shot shell-jelly-621
 *
 *   # (2) 325 dp — ONLY with the keyboard up
 *   tap_node "Preview at 325 dp"
 *   tap_editable                    # focuses the composer field, raises the IME
 *   adb shell dumpsys input_method | tr -d '\r' \
 *     | grep -qE 'mInputShown=true|isInputViewShown=true|mIsInputViewShown=true' \
 *     || echo "IME NOT UP — do not ship this PNG"
 *   sleep 2; shot shell-jelly-325
 *
 *   # (3) 780 dp is the S23's window, not the emulator's: on a 621 dp window
 *   # the shell overflows it and the composer leaves the screen.
 *   adb shell input keyevent 111; tap_node "Preview at 780 dp"
 *   sleep 1; shot shell-s23-780
 */
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLocale } from "../../i18n";
import {
  elevation,
  families,
  measure,
  modes,
  radius,
  spacing,
  type,
  type DesignColors,
  type ThemeMode,
} from "../../theme/design";
import { useLabTheme } from "../labTheme";
import { Shell } from "./Shell";
import { Transcript, type TranscriptMessage } from "./Transcript";
import { MIN_TOUCH_TARGET, shellGeometry, type Insets } from "./shellGeometry";

/**
 * The three measured cases, as data. `live` follows the window, so its segment
 * prints whatever height the emulator is running at — 621 on the Jelly, 780 on
 * the S23 — and the capture names its own case.
 */
const PREVIEW_CASES: ReadonlyArray<{ id: string; height: number | undefined }> = [
  { id: "live", height: undefined },
  { id: "325", height: 325 },
  { id: "780", height: 780 },
];

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
  const { mode } = useLabTheme<{ mode: ThemeMode }>();
  const window = useWindowDimensions();
  const [caseIndex, setCaseIndex] = useState(0);
  const styles = useMemo(() => createPreviewStyles(modes[mode]), [mode]);

  const liveHeight = Math.round(window.height);
  const pinned = PREVIEW_CASES[caseIndex].height;
  const size: Insets = { top: insets.top, bottom: insets.bottom };
  // The same inputs the `Shell` below gets, so the switch lands exactly on the
  // transcript band's top edge and moves with the case instead of guessing.
  const geometry = shellGeometry(window.width, pinned ?? window.height, size);
  const mismatched = pinned !== undefined && pinned !== liveHeight;

  return (
    <View style={{ flex: 1 }}>
      <Shell
        insets={size}
        modelName={PREVIEW_MODEL_NAME}
        whereLabel={t("shell.where.thisPhone")}
        height={pinned}
        mode={mode}
      >
        <Transcript
          insets={size}
          messages={PREVIEW_TRANSCRIPT}
          height={pinned}
          mode={mode}
          now={PREVIEW_NOW}
        />
      </Shell>

      <View
        testID="shell.preview.sizeSwitch"
        accessibilityLabel={t("shell.a11y.previewSize")}
        style={[styles.switchBar, { top: geometry.transcript.top }]}
      >
        <View style={styles.segmentRow}>
          {PREVIEW_CASES.map((previewCase, index) => {
            const active = index === caseIndex;
            const shown = String(previewCase.height ?? liveHeight);
            return (
              <Pressable
                key={previewCase.id}
                testID={`shell.preview.size.${previewCase.id}`}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={t("shell.a11y.previewSizeOption", { height: shown })}
                onPress={() => setCaseIndex(index)}
                style={[styles.segment, active && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{shown}</Text>
              </Pressable>
            );
          })}
        </View>
        {mismatched ? (
          <Text testID="shell.preview.sizeWarning" style={styles.warning}>
            {t("shell.preview.sizeNotLive", { pinned: String(pinned), live: String(liveHeight) })}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function createPreviewStyles(colors: DesignColors) {
  return StyleSheet.create({
    switchBar: {
      gap: spacing.xxs,
      left: 0,
      paddingHorizontal: measure.gutterCompact,
      position: "absolute",
      right: 0,
    },
    segmentRow: {
      flexDirection: "row",
      gap: spacing.xs,
      height: MIN_TOUCH_TARGET,
    },
    segment: {
      alignItems: "center",
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      flex: 1,
      height: MIN_TOUCH_TARGET,
      justifyContent: "center",
      ...elevation.raised,
    },
    segmentActive: {
      backgroundColor: colors.accent,
    },
    segmentText: {
      color: colors.inkSoft,
      fontFamily: families.mono,
      fontSize: type.mono.fontSize,
      lineHeight: type.mono.lineHeight,
    },
    segmentTextActive: {
      color: colors.onAccent,
    },
    warning: {
      alignSelf: "flex-start",
      backgroundColor: colors.surfaceMuted,
      borderRadius: radius.xs,
      color: colors.inkSoft,
      fontFamily: families.sansMedium,
      fontSize: type.meta.fontSize,
      lineHeight: type.meta.lineHeight,
      overflow: "hidden",
      paddingHorizontal: spacing.xs,
      paddingVertical: spacing.xxs,
    },
  });
}
