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
 * gesture bar. The keyboard arrives through those same insets, built by
 * `bottomInsetFor`, because with edge-to-edge the window itself never shrinks:
 * the IME is an inset, and the bands must re-partition rather than the shell
 * being lifted (`docs/DESIGN.md` §2.7).
 */

import { spacing, type } from "../../theme/design";

export type Insets = { top: number; bottom: number };

/** A band in container coordinates: `top` is from the container's top edge. */
export type Band = { top: number; height: number };

/** A real box, never a `hitSlop`. Both axes are checked by the test. */
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
/**
 * The strip pill's mark: the logo's circular clip, in dp. Kept well under the
 * pill's `MIN_TOUCH_TARGET` height so the mark can never be the thing that
 * makes the 48 dp pill grow — the pill is the touch target, the mark is the
 * picture inside it (the mock's `.pick .mark`, same 28).
 */
export const STRIP_MARK_SIZE = 28;

/** Composer: an 8 dp lift, a 56 dp field, and a 14 dp lift over the gesture
 *  bar — the mock's `.dock` and `.field`, re-measured in dp. */
export const COMPOSER_HEIGHT = 78;
export const COMPOSER_SIDE_PADDING = 12;
export const COMPOSER_FIELD_HEIGHT = 56;

/**
 * The source chip, in its two sizes (DESIGN.md §2.5).
 *
 * The painted chip stays small: `type.meta`'s line inside `spacing.xs` above and
 * below, which is the mock's `.src` and about 28 dp. A row of 48 dp pills under
 * every answer would out-weigh the answer it stands under.
 *
 * The box the finger lands on is a different thing from the paint, and it is a
 * real 48 dp on both axes: a tappable thing under 48 dp is an accessibility
 * defect, and this project forbids buying the size back with `hitSlop`. So the
 * painted chip is centred inside a real box, and `SOURCE_CHIP_BOX_COST` is what
 * that costs per row of chips — accepted on purpose rather than discovered
 * later, because "small chip" and "48 dp" read like a contradiction and are not.
 */
export const SOURCE_CHIP_PAINTED_HEIGHT = type.meta.lineHeight + 2 * spacing.xs;
export const SOURCE_CHIP_TOUCH_BOX = MIN_TOUCH_TARGET;
/** What the box costs over the paint, per row of chips: 48 - 28 = 20 dp. */
export const SOURCE_CHIP_BOX_COST = SOURCE_CHIP_TOUCH_BOX - SOURCE_CHIP_PAINTED_HEIGHT;

/**
 * The preview's mismatch notice: ONE line of `type.meta` under the strip, drawn
 * only while the harness is pinned to a height the live window does not have.
 *
 * It is a band like the other three, which is why it is written here and not in
 * the component: it is taken out of the usable height before the bands are
 * partitioned, so the transcript yields the line instead of being covered by it.
 * The line is centred in the band, so `SHELL_NOTICE_GAP` is the clear space it
 * keeps above and below itself. The 7 dp is CHOSEN, not derived: the band was
 * 22 dp (3 dp above and below) and a vision audit found the caption sitting
 * 3–6 px above a table row whose glyph tops the transcript's top edge was
 * slicing in half — "the worst collision in the set, it reads like a rendering
 * bug" — so the band buys the caption room below itself and no arithmetic
 * requires that number. Two lines still do not fit, on purpose — a notice that
 * wraps is the defect this replaced.
 */
export const SHELL_NOTICE_GAP = 7;
export const SHELL_NOTICE_HEIGHT = 2 * SHELL_NOTICE_GAP + type.meta.lineHeight;

function clamp(value: number): number {
  return value > 0 ? value : 0;
}

/**
 * The bottom obstruction the bands must clear, from the two numbers JS has:
 * the safe-area inset and the keyboard height.
 *
 * **The larger, never the sum.** When the keyboard is up it covers the
 * navigation bar instead of sitting above it, and `safe-area-context`'s bottom
 * inset excludes the IME by construction (`SafeAreaUtils.kt` sums status bars,
 * cutout, navigation bars and caption bar, with no `ime()`), so adding the two
 * would reserve the gesture bar twice and lift the composer a bar too high. The
 * existing composer records the same trap (`AiChatPage.tsx:4166-4169`).
 *
 * `keyboardHeight` must be the FULL IME height, which is what
 * `react-native-keyboard-controller` reports under edge-to-edge: its event
 * height is the IME inset minus the navigation bar ONLY when the bar is not
 * translucent (`KeyboardAnimationCallback.kt`), and the provider sets that flag
 * from the app's edge-to-edge mode. React Native's own `Keyboard` event is not a
 * drop-in substitute: `ReactRootView.java` always subtracts the system bars from
 * the IME inset, so pairing that number with this rule would leave the composer
 * one gesture bar under the keyboard.
 *
 * A negative or non-finite height is "no keyboard", not a value to arithmetic
 * on: a bad number would otherwise push the bands off the window.
 */
export function bottomInsetFor(insets: Insets, keyboardHeight: number = 0): Insets {
  const keyboard = Number.isFinite(keyboardHeight) && keyboardHeight > 0 ? keyboardHeight : 0;
  return { top: insets.top, bottom: Math.max(insets.bottom, keyboard) };
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
  /** Container bottom to the composer band's bottom edge: the bottom inset the
   *  bands were partitioned with, so the composer stops exactly at the top of
   *  the gesture bar — or, with the keyboard up, at the IME's top edge (`621`
   *  minus a 296 dp keyboard is the 325 dp app area, and this field is the
   *  296). */
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
  // The pill's remaining width: the strip holds THREE icon buttons (menu,
  // export, new chat) and the pill takes what is left of the row.
  const stripPillWidth = clamp(
    width - 2 * STRIP_SIDE_PADDING - 3 * full - 3 * STRIP_GAP,
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
