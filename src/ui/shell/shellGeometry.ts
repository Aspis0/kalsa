/**
 * The shell's vertical arithmetic: three bands that partition the usable height
 * exactly, plus the tap targets they hold.
 *
 * Pure on purpose: the test stack has no render harness (DESIGN.md, "proof
 * regime"), so every size the layout depends on lives here where a test can
 * assert it; Shell.tsx only places the boxes this module returns. Device facts
 * are DESIGN.md §1.1; the keyboard-as-inset rule is §2.7. The layout is tuned
 * on HEIGHT, because the two device widths (349/360 dp) nearly agree.
 */

import { spacing, type } from "../../theme/design";

export type Insets = { top: number; bottom: number };

/** A band in container coordinates: `top` is from the container's top edge. */
export type Band = { top: number; height: number };

/** A real box, never a `hitSlop`. Both axes are checked by the test. */
export type TouchBox = { width: number; height: number };

/** The 48 dp floor: a real box, never a `hitSlop`. */
export const MIN_TOUCH_TARGET = 48;

/** Strip: one 48 dp control plus 6 dp above and below; two lines (model name
 *  over where it runs) while there is room, one when the keyboard is up. */
export const STRIP_HEIGHT = 60;
export const STRIP_HEIGHT_COLLAPSED = 52;
/** Below this the strip drops its second line: the 325 dp keyboard case. */
export const STRIP_COLLAPSE_BELOW = 420;
export const STRIP_SIDE_PADDING = 12;
export const STRIP_GAP = 9;
/**
 * What the strip pill spends OUTSIDE its text column, dp — the whole budget of
 * a pill whose one job is the model's name (DESIGN.md §2.1). The mark, the dot
 * and the 20 dp of padding are gone because a capture cut the name to
 * `LFM2.5 …`; the 48/154 dp frame and chevron are untouched.
 */
export const STRIP_PILL_PADDING_X = spacing.xs;
export const STRIP_PILL_GAP = spacing.xs;
export const STRIP_CHEVRON_SIZE = 15;

/** The column the name must have to paint in full, dp: the device capture's
 *  105, not the shipped font's 84.6 — only the capture sees the real screen. */
export const MODEL_NAME_COLUMN_NEED_DP = 105;

/** What is left of the name between padding and chevron: everything in there
 *  is chrome, and chrome is what starved the name last time. */
export function stripPillTextColumn(pillWidth: number): number {
  return clamp(pillWidth - 2 * STRIP_PILL_PADDING_X - STRIP_PILL_GAP - STRIP_CHEVRON_SIZE);
}

/** Composer: an 8 dp lift, a 56 dp field, and a 14 dp lift over the gesture
 *  bar — the mock's `.dock` and `.field`, re-measured in dp. */
export const COMPOSER_HEIGHT = 78;
export const COMPOSER_SIDE_PADDING = 12;
export const COMPOSER_FIELD_HEIGHT = 56;

/**
 * The source chip's two sizes (DESIGN.md §2.5): the painted chip stays ~28 dp —
 * a row of 48 dp pills would out-weigh the answer — but the box the finger
 * lands on is a real 48 dp on both axes; hitSlop cannot buy that back.
 */
export const SOURCE_CHIP_PAINTED_HEIGHT = type.meta.lineHeight + 2 * spacing.xs;
export const SOURCE_CHIP_TOUCH_BOX = MIN_TOUCH_TARGET;
/** What the box costs over the paint, per row of chips: 48 - 28 = 20 dp. */
export const SOURCE_CHIP_BOX_COST = SOURCE_CHIP_TOUCH_BOX - SOURCE_CHIP_PAINTED_HEIGHT;

/**
 * The preview's mismatch notice: ONE line of `type.meta` under the strip — a
 * band carved out of the usable height before the bands partition, so the
 * transcript yields the line instead of being covered by it. The 7 dp is
 * CHOSEN, not derived (HANDOFF, "what the vision pass added", item 2); two
 * lines never fit — a wrapping notice is the defect this replaced.
 */
export const SHELL_NOTICE_GAP = 7;
export const SHELL_NOTICE_HEIGHT = 2 * SHELL_NOTICE_GAP + type.meta.lineHeight;

/**
 * The composer's toolbar row (templates ✦ and mode chips), drawn OUTSIDE the
 * three bands: Shell.tsx adds it to `extraRows` and subtracts it BEFORE
 * `shellGeometry` partitions, so strip + transcript + composer still sum to
 * the given height. A real 48 dp row on the finger's axis; its pills paint
 * small inside it, like the source chip's box.
 */
export const COMPOSER_TOOLBAR_HEIGHT = MIN_TOUCH_TARGET;

/**
 * The composer's attachment-chip row (`ComposerAttachments.tsx`): drawn
 * OUTSIDE the three bands like the toolbar — Shell.tsx adds it to
 * `extraRows` only while chips or a conversion exist, so an empty composer
 * pays nothing. 48 dp is the remove box's own size, so one row holds chips
 * AND their finger targets without a second number.
 */
export const COMPOSER_ATTACHMENTS_HEIGHT = MIN_TOUCH_TARGET;

/**
 * The toolbar row's horizontal arithmetic: 349 dp cannot hold everything on one
 * line, so what fits is decided by numbers a test can read. The row spends
 * `2 * spacing.md` padding, the 48 dp ✦ target, one `spacing.xs` gap, then the
 * scroller; each chip spends pill padding, the 15 dp icon, the 4 dp gap and its
 * measured label. ComposerToolbar binds exactly these, and
 * composerToolbarWidth.test measures the real labels in the real fonts.
 */
export const TOOLBAR_CHIP_ICON = 15;
export const TOOLBAR_CHIP_LABEL_GAP = 4;

export function toolbarChipsAvailable(width: number): number {
  return width - 2 * spacing.md - MIN_TOUCH_TARGET - spacing.xs;
}

export function toolbarChipWidth(labelWidth: number): number {
  return 2 * spacing.sm + TOOLBAR_CHIP_ICON + TOOLBAR_CHIP_LABEL_GAP + labelWidth;
}

export function toolbarChipsWidth(labelWidths: readonly number[]): number {
  if (labelWidths.length === 0) return 0;
  return (
    labelWidths.reduce((sum, label) => sum + toolbarChipWidth(label), 0) +
    spacing.xs * (labelWidths.length - 1)
  );
}

function clamp(value: number): number {
  return value > 0 ? value : 0;
}

/**
 * The bottom obstruction the bands must clear: **the larger of the safe-area
 * inset and the keyboard height, never the sum** — the IME covers the nav bar
 * and the safe-area inset excludes it (DESIGN.md §2.7). `keyboardHeight` must
 * be the FULL IME height, which rules out RN's own `Keyboard` event. A
 * negative or non-finite height is "no keyboard", not something to arithmetic on.
 */
export function bottomInsetFor(insets: Insets, keyboardHeight: number = 0): Insets {
  const keyboard = Number.isFinite(keyboardHeight) && keyboardHeight > 0 ? keyboardHeight : 0;
  return { top: insets.top, bottom: Math.max(insets.bottom, keyboard) };
}

export type ShellGeometry = {
  /** Echo of the inputs, so a caller cannot lose them. */
  width: number;
  height: number;
  usableHeight: number;
  strip: Band;
  transcript: Band;
  composer: Band;
  /** The transcript's whole band is usable: its content is clipped to it. */
  transcriptUsableHeight: number;
  /** Container bottom to the composer band's bottom edge: the bottom inset the
   *  bands were partitioned with, so the composer stops at the top of the
   *  gesture bar — or, with the keyboard up, at the IME's top edge. */
  composerBottomOffset: number;
  minTouchTarget: number;
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
 * Lay out the three bands (`width` only sizes the horizontal tap targets).
 * Degenerate heights squeeze, never overflow — composer keeps its space first,
 * the strip shrinks to a sliver, the transcript yields last — and in every
 * branch the three heights sum to `usableHeight`: the partition invariant
 * survives the short case instead of being waived there.
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
  // The pill takes what the strip leaves: THREE icon buttons (menu, Web,
  // new chat) — Export moved to the drawer as a chat-level action. Four buttons
  // left the pill 97 dp with a 14 dp text column and ellipsised the model name
  // (DESIGN.md §2.1); three restore 154: 349 - 2*12 - 3*48 - 3*9 = 154.
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
