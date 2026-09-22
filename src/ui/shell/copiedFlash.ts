/**
 * The confirmation window after a copy, shared by the two places that show it:
 * the menu's "Copied!" row/caption and the inline chip's own flash.
 *
 * 400 ms is the controller's number, measured from where it is visible:
 * after a Copy inside the menu, `AiChatPage.tsx:4424-4431` kept the sheet open
 * for exactly 400 ms showing `common.copied` before closing it. The controller
 * ALSO held its `copiedFlash` state for 1500 ms (`Chat:3511-3514`), but that
 * half was unobservable — the only consumer was the menu, which had already
 * closed at 400 — so one number carries both here instead of two, and the chip
 * (which the controller never flashed) gets the same +400 ms confirmation.
 *
 * A constant in its own file because the flash spans two layers: the chip in
 * the transcript band and the menu in the host, and neither may import the
 * other to share a number.
 */
export const COPIED_FLASH_MS = 400;
