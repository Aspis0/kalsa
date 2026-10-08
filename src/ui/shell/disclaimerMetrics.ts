/**
 * The composer's disclaimer line: its gap and line box, and the largest OS text
 * scale that line box holds. Pure, so the geometry, the component and the fit
 * test read the same numbers.
 */
import { type } from "../../theme/design";

export const COMPOSER_DISCLAIMER_GAP = 4;
export const COMPOSER_DISCLAIMER_HEIGHT = type.caption.lineHeight;

/**
 * The line box is fixed, so the OS text scale can only grow the glyphs until
 * they reach its edges: 16 / (11 x 1.21), with Inter's ascender plus descender
 * at 1.21 em, rounded down. The fit test recomputes it from the font.
 */
export const DISCLAIMER_MAX_FONT_SCALE = 1.2;
