// The room's note codes and their English fallbacks, in one table. Clients
// translate by code; this English column is the fallback the backend sends
// beside every code. Shipping another language is another column's worth of
// entries under its code — no library, one lookup.
//
// The codes are the backend's contract (ROOM-PROTOCOL.md §7); a code that
// arrives without an entry here falls back to the note text the backend
// sent, so a code added on the Rust side can never render as "undefined".

export type RoomNoteCode =
  | "busy_waiting"
  | "unavailable"
  | "empty_answer"
  | "could_not_start"
  | "engine_problem";

type RoomNotes = Record<RoomNoteCode, string>;

const ENGLISH: RoomNotes = {
  busy_waiting: "Kalsa is busy with another conversation. You keep your turn.",
  unavailable: "Kalsa can't answer in this room right now.",
  empty_answer: "Kalsa had no answer to that.",
  could_not_start: "Kalsa couldn't start. Try again.",
  engine_problem:
    "Kalsa ran into a problem on this computer and couldn't answer. Ask again.",
};

/** English for now; the ship languages add their tables beside it. */
const TABLE: Record<string, RoomNotes> = { en: ENGLISH };

/** The note for a code, in the room's language when the table has it. The
    backend's own sentence is the fallback of last resort. */
export function roomNote(
  code: string | null | undefined,
  fallback: string | null | undefined,
): string | null {
  if (!code) return null;
  const table: Partial<RoomNotes> = TABLE.en;
  return table[code as RoomNoteCode] ?? fallback ?? null;
}
