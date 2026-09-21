/**
 * The shell's vertical arithmetic: three bands that partition the usable height
 * exactly, and the tap targets they must hold.
 *
 * Pure on purpose. The test stack is `jest` on `node` with `.ts` only and no
 * render harness (DESIGN.md, "proof regime"), so every size the layout depends
 * on is written here where a real test can assert it; Shell.tsx only places the
 * boxes this module returns.
 *
 * Measured facts this is built on, DESIGN.md §1.1:
 * - Jelly Star: 349 x 621 dp logical (480 x 854 px @ 220 dpi). With the
 *   keyboard open the app area is 349 x 325 dp (480 x 447 px @ 220 dpi) — the
 *   case that decides the strip's collapsed form.
 * - Galaxy S23: 360 x 780 dp logical (1080 x 2340 px @ 480 dpi).
 * The two widths are nearly identical (349 vs 360), so the layout is tuned on
 * HEIGHT; a bug that only shows in height would be invisible on width.
 *
 * `height` is the edge-to-edge container height; the safe-area insets are
 * subtracted from it, so the bands never drift under the status bar or the
 * gesture bar.
 */

export type Insets = { top: number; bottom: number };

/** A band in container coordinates: `top` is from the container's top edge. */
export type Band = { top: number; height: number };

/** A real box, never a hitSlop. Both axes are checked by the test. */
export type TouchBox = { width: number; height: number };

/** Real boxes, never hitSlop (DESIGN.md Part 3, rows 2 and 5). */
export const MIN_TOUCH_TARGET = 48;

/** Strip: one 48 dp control plus 6 dp above and below. Two lines when it can
 *  afford them (model name over where it runs), one when the keyboard is up. */
export const STRIP_HEIGHT = 60;
export const STRIP_HEIGHT_COLLAPSED = 52;
/** Below this usable height the strip gives up its second line. 621 and 780
 *  are well above it; the 325 dp keyboard case is well below. */
export const STRIP_COLLAPSE_BELOW = 420;
export const STRIP_SIDE_PADDING = 12;
export const STRIP_GAP = 9;

/** Composer: an 8 dp lift, a 56 dp field, and a 14 dp lift over the gesture
 *  bar — the mock's `.dock` and `.field`, re-measured in dp. */
export const COMPOSER_HEIGHT = 78;
export const COMPOSER_SIDE_PADDING = 12;
export const COMPOSER_FIELD_HEIGHT = 56;

function clamp(value: number): number {
  return value > 0 ? value : 0;
}

export type ShellGeometry = {
  /** Echo of the inputs, so a caller cannot lose them. */
  width: number;
  height: number;
  /** height - insets.top - insets.bottom, floored at 0. */
  usableHeight: number;
  strip: Band;
  transcript: Band;
  composer: Band;
  /** The transcript's whole band is usable: its content is clipped to it. */
  transcriptUsableHeight: number;
  /** Container bottom to the composer band's bottom edge: equals the bottom
   *  inset, so the composer stops exactly at the top of the gesture bar. */
  composerBottomOffset: number;
  minTouchTarget: number;
  /** True at 325 dp, where the strip drops its second line. */
  stripCollapsed: boolean;
  /** Every tap target the shell draws, in dp. The 48 dp floor is a property of
   *  the geometry, because the stack cannot measure a rendered tree. */
  touchTargets: {
    stripButton: TouchBox;
    stripPill: TouchBox;
    composerAttach: TouchBox;
    composerMic: TouchBox;
    composerField: TouchBox;
    composerSend: TouchBox;
  };
};

/**
 * Lay out the three bands. `width` is used only for the horizontal tap targets;
 * height is what the layout is tuned on.
 *
 * Degenerate heights are squeezed, not overflowed: the composer keeps its space
 * first (it is the band the user must reach), the strip shrinks to a sliver,
 * and the transcript yields last. In every branch
 * `strip.height + transcript.height + composer.height === usableHeight`, so the
 * partition invariant survives the short case instead of being waived there.
 */
export function shellGeometry(width: number, height: number, insets: Insets): ShellGeometry {
  const usableHeight = clamp(height - insets.top - insets.bottom);
  const stripCollapsed = usableHeight < STRIP_COLLAPSE_BELOW;
  const stripWant = stripCollapsed ? STRIP_HEIGHT_COLLAPSED : STRIP_HEIGHT;

  const composerHeight = Math.min(COMPOSER_HEIGHT, usableHeight);
  const stripHeight = Math.min(stripWant, clamp(usableHeight - composerHeight));
  const transcriptHeight = clamp(usableHeight - stripHeight - composerHeight);

  const strip: Band = { top: insets.top, height: stripHeight };
  const transcript: Band = {
    top: strip.top + strip.height,
    height: transcriptHeight,
  };
  const composer: Band = {
    top: transcript.top + transcript.height,
    height: composerHeight,
  };

  const full = MIN_TOUCH_TARGET;
  const stripPillWidth = clamp(
    width - 2 * STRIP_SIDE_PADDING - 2 * full - 2 * STRIP_GAP,
  );

  return {
    width,
    height,
    usableHeight,
    strip,
    transcript,
    composer,
    transcriptUsableHeight: transcript.height,
    composerBottomOffset: clamp(height - (composer.top + composer.height)),
    minTouchTarget: full,
    stripCollapsed,
    touchTargets: {
      stripButton: { width: full, height: full },
      stripPill: { width: Math.max(full, stripPillWidth), height: full },
      composerAttach: { width: full, height: full },
      composerMic: { width: full, height: full },
      composerField: {
        width: Math.max(full, width - 2 * COMPOSER_SIDE_PADDING),
        height: full,
      },
      composerSend: { width: full, height: full },
    },
  };
}
