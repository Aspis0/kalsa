// The room's note and refusal codes, with their English fallbacks. Clients
// (and this page) translate by code; the sentence is the fallback the
// backend sends beside every code. The approved list lives in
// ROOM-PROTOCOL.md — a code not on it shows nothing here.

const ENGLISH: Record<string, string> = {
  busy_waiting: "Kalsa is busy with another conversation. You keep your turn.",
  unavailable: "Kalsa can't answer in this room right now.",
  empty_answer: "Kalsa had no answer to that.",
  could_not_start: "Kalsa couldn't start. Try again.",
  engine_problem: "Kalsa ran into a problem on this computer and couldn't answer. Ask again.",
};

/** The sentence for a code — the backend's own fallback when the table
    has nothing, and nothing at all when there is neither. */
export function roomNote(
  code: string | null | undefined,
  fallback: string | null | undefined,
): string | null {
  if (!code) return null;
  return ENGLISH[code] ?? fallback ?? null;
}
