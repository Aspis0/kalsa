import { spacing } from "../tokens";

/** Shared with ChatNavBar — unfold origin tracks the real menu icon. */
export const CHAT_NAV_ROW = 48;
export const CHAT_MENU_HIT = 36;
export const CHAT_MENU_PAD_X = spacing.md;

export function chatMenuOriginX() {
  return CHAT_MENU_PAD_X + CHAT_MENU_HIT / 2;
}

/** `modelBarHeight` is the measured block above ChatNavBar (includes status inset). */
export function chatMenuOriginY(modelBarHeight: number) {
  return modelBarHeight + CHAT_NAV_ROW / 2;
}
