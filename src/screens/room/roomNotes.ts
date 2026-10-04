/**
 * The room's codes in the household's words: §9's refusals, the turn's
 * notes and the shelf's own composes all read through one policy — the
 * table's sentence when the language knows the code, the app's own fallback
 * when it does not (the desktop's rule). The door's English is never shown;
 * for a door this phone cannot dial at all, the app's own remote-brain copy
 * takes over, because its message is a machine code.
 */
import { humanRemoteBrainError } from "../../engine/remote/remoteBrainErrors";
import type { TranslateFn, TranslationKey } from "../../i18n";
import { IROH_MISSING_MESSAGE } from "../../room/roomError";

/** Every code the room's own copy covers. */
const NOTE_KEYS: Record<string, TranslationKey> = {
  busy_waiting: "room.note.busy_waiting",
  unavailable: "room.note.unavailable",
  empty_answer: "room.note.empty_answer",
  could_not_start: "room.note.could_not_start",
  engine_problem: "room.note.engine_problem",
  seat_timeout: "room.note.seat_timeout",
  too_large: "room.note.too_large",
  read_only: "room.note.read_only",
  client_msg_id_reused: "room.note.client_msg_id_reused",
  internal: "room.note.internal",
  already_pending: "room.note.already_pending",
  name_taken: "room.note.name_taken",
  name_reserved: "room.note.name_reserved",
  name_framing: "room.note.name_framing",
  name_mixed_scripts: "room.note.name_mixed_scripts",
  name_too_long: "room.note.name_too_long",
};

/** The sentence for one code (and, for an undialable door, the wire's own
 *  message), or null when there is no code to read. */
export function noteLine(
  t: TranslateFn,
  code: string | null | undefined,
  message?: string | null,
): string | null {
  if (!code) return null;
  if (code === "door_unusable") {
    return message === IROH_MISSING_MESSAGE
      ? t("settings.remoteBrainFailIrohMissing")
      : humanRemoteBrainError(message ?? undefined, t);
  }
  const key = Object.prototype.hasOwnProperty.call(NOTE_KEYS, code) ? NOTE_KEYS[code] : undefined;
  return t(key ?? "room.noteFallback");
}
