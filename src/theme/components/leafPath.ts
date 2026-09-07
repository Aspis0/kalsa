/** Leaf silhouette from leaf-fold-v9.html (v11.1). ViewBox 390×800. */

export const LEAF_VB_W = 390;
export const LEAF_VB_H = 800;

/** Wide-band content padding on the 390×800 stage. */
export const LEAF_PAD_TOP = 138;
export const LEAF_PAD_X = 34;
export const LEAF_PAD_BOTTOM = 92;

/** Vertical fold axis in viewBox space (leaf midline). */
export const LEAF_FOLD_X = 195;
export const LEAF_FOLD_Y = 400;

export const LEAF_D =
  "M 195 42 " +
  "C 300 55, 365 95, 385 170 " +
  "C 395 250, 395 400, 393 560 " +
  "C 391 660, 375 730, 310 765 " +
  "C 255 785, 220 792, 195 794 " +
  "C 170 792, 135 785, 80 765 " +
  "C 15 730, -1 660, -3 560 " +
  "C -5 400, -5 250, 5 170 " +
  "C 25 95, 90 55, 195 42 Z";

/** Right-half path: demo sag (790 vs 785) so halves overlap at the crease. */
export const LEAF_FLAP_D =
  "M 195 42 " +
  "C 300 55, 365 95, 385 170 " +
  "C 395 250, 395 400, 393 560 " +
  "C 391 660, 375 730, 310 765 " +
  "C 255 790, 220 792, 195 794 " +
  "C 170 792, 135 790, 80 765 " +
  "C 15 730, -1 660, -3 560 " +
  "C -5 400, -5 250, 5 170 " +
  "C 25 95, 90 55, 195 42 Z";

export const LEAF_CLIP_LEFT = "M 195 42 L 195 794 L -30 820 L -30 -20 Z";
export const LEAF_CLIP_RIGHT = "M 195 42 L 195 794 L 420 820 L 420 -20 Z";

export function leafContentPad(width: number, height: number) {
  return {
    paddingTop: (LEAF_PAD_TOP / LEAF_VB_H) * height,
    paddingHorizontal: (LEAF_PAD_X / LEAF_VB_W) * width,
    paddingBottom: (LEAF_PAD_BOTTOM / LEAF_VB_H) * height,
  };
}
