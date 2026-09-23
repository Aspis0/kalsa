/**
 * TEMPORARY: renders the shell with a demo transcript, alone, so it can be
 * screenshotted without the engine, a session or a conversation — the only
 * consumer of `Shell` until it is mounted in the real conversation.
 *
 * Holds no state but the size switch, reads the keyboard through the shell's
 * own `useKeyboardHeight`, and calls no service: the strip's text and the
 * messages are preview DATA, not interface copy, so they skip `t()`; the
 * mismatch notice IS interface copy and goes through it.
 *
 * The size switch is runtime state on the shell's own `+` control (inert in
 * the app): a tap cycles live -> 325 -> 780 -> live. Never a compile-time
 * constant again — that shape made one number cost a native rebuild, and the
 * earlier placements drew preview chrome over the transcript. 325 dp IS the
 * app area with the IME up, and only then is it evidence: the capture recipe
 * lives in HANDOFF-2026-09-21.md, "how a capture is taken".
 */
import { useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { type ThemeMode } from "../../theme/design";
import { useLabTheme } from "../labTheme";
import { Shell } from "./Shell";
import { Transcript, type TranscriptMessage } from "./Transcript";
import { bottomInsetFor, type Insets } from "./shellGeometry";
import { useKeyboardHeight } from "./useKeyboardHeight";

/**
 * The three measured cases, as data. `live` follows the window — 621 on the
 * Jelly, 780 on the S23 — and the cycle names its own case.
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
 * 26 h back, so ALWAYS a different calendar day from `PREVIEW_NOW`, whatever
 * hour the app launches: `daysAgo(1) + 9h` lands on the same day after 15:00
 * and the marker disappears — the fixture was undercutting the layout.
 */
const PREVIEW_EARLIER_AT = PREVIEW_NOW - 26 * 60 * MINUTE;

/**
 * Sample data whose SHAPE is the fixture: tool rows above an answer, source
 * chips below it, plus a non-tappable local-file chip for the reduced-emphasis
 * form. The last answer carries every shape a capture must show (heading,
 * bullets, quote, three-column table, code block — 3 x 117 = 351 > 321, so the
 * table always scrolls at 349 dp), sized to fit the 443 dp band; it is last
 * because the pinned view photographs whatever is last. The user turn above it
 * exists for the frame's TOP edge: the 56-character capsule sits where the
 * edge can fall safely — never halfway through the previous answer's cloud.
 */
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
    tools: [{ name: "document_chat" }, { name: "write_note" }],
    sources: [
      { url: "https://en.wikipedia.org/wiki/Observational_error", title: "Observational error" },
      { url: "https://www.nist.gov/pml/nist-technical-note-1297", title: "NIST TN 1297" },
      {
        url: "file:///data/user/0/com.kalsa.app/files/measurement-error.pdf",
        title: "measurement-error.pdf",
      },
    ],
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
    // The live case: the row is already there while the answer streams.
    tools: [{ name: "web_search" }],
    thinking: {
      reasoning:
        "Weighing the three methods against the scatter in the series. The second one overfits the noisiest points; the third holds its error flat across the range.",
      working: true,
      answered: false,
    },
  },
  {
    id: "preview-5",
    role: "user",
    text: "Can you put that in a table for the note I am writing?",
    createdAt: PREVIEW_NOW + MINUTE,
  },
  {
    id: "preview-6",
    role: "assistant",
    text:
      "## What the document says\n\n" +
      "- The third method is the steadiest.\n" +
      "- It is the slowest: 1.8 s.\n\n" +
      "> The second method was the noisiest.\n\n" +
      "| method | error | time |\n" +
      "|---|---|---|\n" +
      "| one | 0.41 | 1.2 |\n" +
      "| two | 6.90 | 0.6 |\n" +
      "| three | 0.12 | 1.8 |\n\n" +
      '```json\n{ "pick": "three" }\n```',
    createdAt: PREVIEW_NOW + 2 * MINUTE,
  },
];

export function ShellPreview() {
  const insets = useSafeAreaInsets();
  const { mode } = useLabTheme<{ mode: ThemeMode }>();
  const window = useWindowDimensions();
  const keyboardHeight = useKeyboardHeight();
  const [caseIndex, setCaseIndex] = useState(0);

  const pinned = PREVIEW_CASES[caseIndex].height;
  const size: Insets = { top: insets.top, bottom: insets.bottom };
  // A pinned case is a height the harness dictates, so the IME must not add a
  // second bottom term on top of it: at the 325 pin the two together would
  // leave 5 dp of content. The live case is where the hook speaks (DESIGN.md §2.7).
  const keyboard = pinned === undefined ? keyboardHeight : 0;
  // One bottom obstruction, two consumers: `Shell` combines safe area and
  // keyboard itself, the transcript is handed the combined value so its band
  // cannot drift from the band the shell drew.
  const bandInsets = bottomInsetFor(size, keyboard);
  // The switch rides the strip's own `+` control — preview-only binding, inside
  // a box the shell already draws, so nothing is added over the transcript.
  const cycleSize = () => setCaseIndex((index) => (index + 1) % PREVIEW_CASES.length);
  const layoutHeight = pinned === undefined ? undefined : pinned;

  return (
    <View style={{ flex: 1 }}>
      <Shell
        insets={size}
        modelName={PREVIEW_MODEL_NAME}
        location="phone"
        keyboardHeight={keyboard}
        height={pinned}
        mode={mode}
        onMenuPress={cycleSize}
      >
        <Transcript
          insets={bandInsets}
          messages={PREVIEW_TRANSCRIPT}
          height={layoutHeight}
          mode={mode}
          now={PREVIEW_NOW}
        />
      </Shell>
    </View>
  );
}
