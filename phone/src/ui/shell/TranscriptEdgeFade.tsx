/**
 * The transcript band's two edge fades: paint, not a control.
 *
 * A vision audit found the band's clip edges slicing content mid-glyph in the
 * ORDINARY resting state — with no fade or mask. The owner did not ask for
 * this element; the audit did, and the owner may reverse it. A hard clip across
 * live text reads as a rendering bug, not as a scroll.
 *
 * The ramp dissolves content into the page colour before the clip line. Both
 * gradients are inert by construction: `pointerEvents="none"`,
 * `importantForAccessibility="no"`, and no `testID` — decoration is not a
 * control, and only interactive nodes carry a `testID` and an accessible name.
 *
 * The clear stop is the page hex with a `00` alpha, never `"transparent"`:
 * that is rgba(0,0,0,0), and a ramp ending in it interpolates through black —
 * a dark smear across a green page. Hex alpha-last keeps the ramp inside the
 * page colour's own channels (react-native's parser reads the hex alpha-last).
 */
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet } from "react-native";

import type { DesignColors } from "../../theme/design";

/**
 * The fade's height in dp. CHOSEN — nothing derives it; labelled so a reviewer
 * can move it. 24 is the band's own resting clearance (`TRANSCRIPT_LAST_ITEM_GAP`,
 * pinned to this constant by `transcriptEdgeFade.test.ts`), so at rest the
 * bottom ramp veils exactly the strip the layout keeps empty, and it holds every
 * glyph box the audit caught (28 dp chip, 24 dp H2). Under ~16 dp the ramp
 * completes inside half a line and a severed chip still meets the clip nearly
 * opaque; over ~48 dp it would veil a quarter of the 171 dp keyboard band.
 */
export const EDGE_FADE_HEIGHT = 24;

export function TranscriptEdgeFade({
  colors,
  topClipped,
}: {
  colors: DesignColors;
  /**
   * Whether content has actually scrolled under the band's TOP edge. The top
   * ramp is opaque at the edge it protects, so drawing it while nothing is
   * clipped would veil the first line (a short conversation starts flush at the
   * top). The bottom ramp needs no gate: the 24 dp resting clearance keeps
   * readable content out whenever nothing is clipped there.
   */
  topClipped: boolean;
}) {
  // The page colour at zero alpha, never `"transparent"` (see the file header).
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
