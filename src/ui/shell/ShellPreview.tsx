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
 * ── Where the switch is now (2026-09-21, second move) ──────────────────────
 * It is the strip's `+` control (`shell.strip.newChat`), inert in the preview:
 * a tap cycles live -> 325 -> 780 -> live. Binding a real app control to the
 * preview is a PREVIEW-ONLY choice, and it is the honest one here because the
 * control already exists inside a box the shell draws, so the switch costs the
 * transcript nothing. Every earlier placement drew preview chrome over the
 * transcript, which is why it was wrong: first an invisible tap zone in the top
 * inset, whose touchable region sits under the status bar and drops taps (a 325
 * capture needed nine TABs and an ENTER — a control that needs a keyboard is not
 * a control); then a three-segment bar at the top of the transcript band, which
 * by its own docstring covered the band's first 48 dp. That is the defect the
 * captures show: at 621 dp the bar cut off a line of the answer, and at 325 dp
 * the bar plus its warning chip ate the top of a band that then had nothing left
 * to show. Both are gone from the transcript.
 *
 * The one piece worth keeping is the warning: when the pinned height differs
 * from the live window height, the pill's second line says so in place of the
 * where-label, so a misleading PNG still carries its own indictment inside the
 * strip rather than in a chip over the conversation. (At 325 dp the strip is
 * collapsed to one line, so there is no second line to carry it — but 325 dp
 * only reaches 325 dp with the IME up, and the keyboard in the image is then its
 * own label; the notice fires when a capture is taken at a pinned size the live
 * window does not have.)
 *
 * ── How a capture is taken, so the next one is scriptable ──────────────────
 * 325 dp IS THE APP AREA WITH THE SOFT KEYBOARD UP (Jelly Star: 480x854 px at
 * 220 dpi = 349x621 dp down, 480x447 px = 349x325 dp with the IME). A capture
 * of 325 WITHOUT the keyboard is not evidence: the shell then fills 325 of the
 * window's 621 dp, the rest is blank, and the PNG reads as a broken half-empty
 * screen — which is how the last one was read. The keyboard comes from focusing
 * the composer field; nothing is drawn to imitate it. When the pinned case and
 * the live window disagree the pill's second line says so, so a misleading PNG
 * carries its own warning instead of waiting for a reviewer to notice.
 *
 * The sequence, with `SHELL_PREVIEW = true` in `App.tsx`. `tap_node`,
 * `tap_editable`, `shot` and `OUT` are `scripts/ci-lib.sh`'s: they read a node's
 * live bounds, because fixed coordinates break as soon as the IME moves the
 * layout. The node tapped is the `+` control's accessibility label, which
 * follows the app's locale — "New chat" below (`DEFAULT_LOCALE`), «Nuova chat»
 * under the Italian catalogue. A reload (Metro) resets the cycle to live.
 *
 *   adb shell input keyevent KEYCODE_WAKEUP                      # screen on
 *   adb shell wm size; adb shell wm density                      # 480x854, 220
 *   adb shell am start -n com.kalsa.app/.MainActivity            # Metro reload
 *   adb shell input keyevent 111                                 # ESC: IME down
 *   OUT=mock
 *
 *   # (1) the live window, 621 dp on the Jelly, keyboard down — the reload state
 *   shot shell-jelly-621
 *
 *   # (2) 325 dp — one tap cycles live -> 325, and ONLY with the keyboard up
 *   tap_node "New chat"
 *   tap_editable                    # focuses the composer field, raises the IME
 *   adb shell dumpsys input_method | tr -d '\r' \
 *     | grep -qE 'mInputShown=true|isInputViewShown=true|mIsInputViewShown=true' \
 *     || echo "IME NOT UP — do not ship this PNG"
 *   sleep 2; shot shell-jelly-325
 *
 *   # (3) 780 dp is the S23's window, not the emulator's: on a 621 dp window
 *   # the shell overflows it and the composer leaves the screen.
 *   adb shell input keyevent 111; tap_node "New chat"; sleep 1; shot shell-s23-780
 */
import React, { useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLocale } from "../../i18n";
import { type ThemeMode } from "../../theme/design";
import { useLabTheme } from "../labTheme";
import { Shell } from "./Shell";
import { Transcript, type TranscriptMessage } from "./Transcript";
import { type Insets } from "./shellGeometry";

/**
 * The three measured cases, as data. `live` follows the window, so it prints
 * whatever height the emulator is running at — 621 on the Jelly, 780 on the
 * S23 — and the cycle names its own case.
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

/**
 * The earlier turn sits 26 h back, so it is ALWAYS a different calendar day from
 * `PREVIEW_NOW`, whatever hour the app launches. `daysAgo(1) + 9h` looked
 * equivalent but is not: launched at or after 15:00 it lands on the same
 * calendar day as now, `shouldShowDayMarker` correctly returns false, and a
 * capture taken that afternoon shows no marker at all. The layout is right about
 * the 443 dp band; the fixture was undercutting it.
 */
const PREVIEW_EARLIER_AT = PREVIEW_NOW - 26 * 60 * MINUTE;

/** Sample data. The day marker needs a turn on an earlier day to be visible. */
const PREVIEW_TRANSCRIPT: readonly TranscriptMessage[] = [
  {
    id: "preview-1",
    role: "user",
    text: "What does the document say about measurement error?",
    createdAt: PREVIEW_EARLIER_AT,
  },
  {
    id: "preview-2",
    role: "assistant",
    text:
      "It compares three methods and reports the largest error each one produced.\n\n" +
      "The third method is the steadiest across the whole series, but it is the slowest to run.",
    createdAt: PREVIEW_EARLIER_AT + MINUTE,
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

  const liveHeight = Math.round(window.height);
  const pinned = PREVIEW_CASES[caseIndex].height;
  const size: Insets = { top: insets.top, bottom: insets.bottom };
  const mismatched = pinned !== undefined && pinned !== liveHeight;
  // The switch rides the strip's own `+` control. Preview-only binding: the
  // control is inert in the app, and it is inside a box the shell already
  // draws, so nothing is added over the transcript.
  const cycleSize = () => setCaseIndex((index) => (index + 1) % PREVIEW_CASES.length);
  // The mismatch notice takes the where-label's place on the pill's second
  // line, inside the strip, so no capture artifact sits over the transcript.
  const whereLabel = mismatched
    ? t("shell.preview.sizeNotLive", { pinned: String(pinned), live: String(liveHeight) })
    : t("shell.where.thisPhone");

  return (
    <View style={{ flex: 1 }}>
      <Shell
        insets={size}
        modelName={PREVIEW_MODEL_NAME}
        whereLabel={whereLabel}
        height={pinned}
        mode={mode}
        onNewChatPress={cycleSize}
      >
        <Transcript
          insets={size}
          messages={PREVIEW_TRANSCRIPT}
          height={pinned}
          mode={mode}
          now={PREVIEW_NOW}
        />
      </Shell>
    </View>
  );
}
