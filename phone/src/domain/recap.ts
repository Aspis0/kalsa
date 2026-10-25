/**
 * The turn's recap line (PHONE-CHAT-PROTOCOL §3.2): what Kalsa did in the turn, in
 * one line, in the phone's language. It is the computer's own account of its own
 * runs, and the phone draws it as it is.
 *
 * **Checked here, on every road it travels** — the turn stream, the saved history
 * and the answer it is stored on — so one rule decides what a recap may be.
 */
import { utf8Length } from "./browserCardPayload";

/** The most a recap line may be, in UTF-8 bytes. One line is a few words; a larger one
 *  is dropped whole, never cut in the middle of a character. */
export const MAX_RECAP_BYTES = 500;

/** The recap as the phone may draw it, or `null` when it is not a recap: not a string,
 *  over the cap, or nothing left once control and format characters are removed. */
export function normalizeRecap(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (utf8Length(raw) > MAX_RECAP_BYTES) return null;
  const text = raw.replace(/[\p{Cc}\p{Cf}]/gu, " ").trim();
  return text === "" ? null : text;
}
