/**
 * The confirmation window after a copy, shared by the menu's "Copied!" row and
 * the inline chip's flash. 400 ms is the controller's measured number — the
 * sheet held `common.copied` for exactly 400 ms before closing (its separate
 * 1500 ms state was unobservable, so one number carries both here). Own file
 * because the flash spans two layers that may not import each other.
 */
export const COPIED_FLASH_MS = 400;
