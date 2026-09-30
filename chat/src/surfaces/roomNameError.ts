// The name refusals with approved copy, by code. The codes without a
// sentence here (empty, invisible, not a member, io) show nothing: the
// old name stands and the owner has not approved words for them.

const ENGLISH: Record<string, string> = {
  name_taken: "Someone in this room already uses that name. Pick another.",
  name_reserved: "Kalsa is the assistant's name. Pick another.",
  name_framing: "Names can't use [ or ].",
  name_mixed_scripts: "Use letters from one alphabet in your name.",
  name_too_long: "That name is too long. Try a shorter one.",
};

export function roomNameError(code: string | null | undefined): string | null {
  if (!code) return null;
  return ENGLISH[code] ?? null;
}
