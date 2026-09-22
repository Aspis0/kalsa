/**
 * The transcript band's two edge fades: paint, not a control.
 *
 * A vision audit found the band's clip edges slicing content mid-glyph in the
 * app's ORDINARY resting state — the citation chip `3 measurement-error.pdf`
 * cut in half horizontally by the top edge, the heading "What the document
 * says" chopped by the bottom edge under the composer, "with no fade or mask" —
 * after the previous fix had killed this class only at the pinned seam. The
 * owner did not ask for this element; the audit did, and the owner may reverse
 * it. The reason it exists: a hard clip across live text reads as a rendering
 * bug, not as a scroll, in the most-scanned region of the screen.
 *
 * The ramp dissolves content into the page colour before the clip line, so
 * nothing meets the edge at full ink. Both gradients are inert by construction:
 * `pointerEvents="none"` (the scroll view keeps every touch),
 * `importantForAccessibility="no"` (there is no node to announce), and no
 * `testID` — decoration is not a control, and this project's interactive nodes
 * are the ones that carry a `testID` and an accessible name.
 *
 * The colour is the design layer's page colour for the CURRENT mode
 * (`design.ts`, `modes[mode].page`), handed in by the band that owns the mode.
 * The clear stop is the same hex with a `00` alpha, never `"transparent"`:
 * `"transparent"` is rgba(0,0,0,0), and a ramp ending in it interpolates
 * through black — a dark smear across a green page. `#f4f8f300` parses to the
 * same RGB with alpha 0 (react-native's colour parser reads the hex
 * alpha-last), so the ramp stays inside the page colour's own channel.
 */
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet } from "react-native";

import type { DesignColors } from "../../theme/design";

/**
 * The fade's height in dp. CHOSEN: nothing in the layout's arithmetic derives
 * it, and it is labelled here so a reviewer can move it.
 *
 * 24 is the band's own resting clearance (`transcriptLayout.ts`,
 * TRANSCRIPT_LAST_ITEM_GAP, pinned to this constant by
 * `transcriptEdgeFade.test.ts`), so at rest the bottom ramp occupies exactly
 * the strip the layout already keeps empty under the last line: while nothing
 * crosses the edge the fade veils empty page, and everything scrolling into it
 * dissolves. It also holds every glyph box the audit caught inside the ramp:
 * the 16 dp meta line inside the 28 dp source chip, and the 24 dp H2 the bottom
 * edge was chopping.
 *
 * Smaller than ~16 dp completes the whole ramp inside half a line, so a
 * severed chip or heading still meets the clip with its ink nearly opaque — a
 * softened cut, not a dissolve. Larger (48 dp, a touch target) would veil a
 * quarter of the 171 dp keyboard-case band, where content rests.
 */
export const EDGE_FADE_HEIGHT = 24;

export function TranscriptEdgeFade({
  colors,
  topClipped,
}: {
  colors: DesignColors;
  /**
   * Whether content has actually scrolled under the band's TOP edge. The top
   * ramp is opaque by construction at the edge it protects, so drawing it while
   * nothing is clipped — a short conversation starts flush at the top with no
   * gap above it (`rhythmGap`, first item) — would veil the first line to
   * near-invisibility. The bottom ramp needs no such gate: the 24 dp resting
   * clearance keeps readable content out of it whenever nothing is clipped
   * there.
   */
  topClipped: boolean;
}) {
  // The page colour at zero alpha, not `"transparent"` (see the file header).
  const clear = `${colors.page}00`;
  return (
    <>
      {topClipped ? (
        <LinearGradient
          colors={[colors.page, clear]}
          importantForAccessibility="no"
          pointerEvents="none"
          style={[styles.edge, styles.top]}
        />
      ) : null}
      <LinearGradient
        colors={[clear, colors.page]}
        importantForAccessibility="no"
        pointerEvents="none"
        style={[styles.edge, styles.bottom]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  edge: {
    height: EDGE_FADE_HEIGHT,
    left: 0,
    position: "absolute",
    right: 0,
  },
  top: {
    top: 0,
  },
  bottom: {
    bottom: 0,
  },
});
