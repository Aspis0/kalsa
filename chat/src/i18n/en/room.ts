// The room's English: the approved copy, keyed the way the page reads it.
// The note codes are the backend's contract, unchanged.

export interface RoomTable {
  /** How the language joins the names after "then": English "Luca and
      Sofia", whole-message rule — never fragments. */
  listJoin: (items: string[]) => string;
  closedRoom: string;
  emptyRoom: string;
  answering: (name: string) => string;
  queueNext: (name: string) => string;
  queueThen: (name: string, rest: string) => string;
  stop: string;
  askKalsa: string;
  writePlaceholder: string;
  writeAria: string;
  nameAria: string;
  namePlaceholder: string;
  youAre: (name: string) => string;
  left: string;
  askedKalsa: string;
  readLast: (count: number) => string;
  notes: Record<string, string>;
}

export const ROOM: RoomTable = {
  listJoin: (items) => {
    if (items.length < 3) return items.join(" and ");
    return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  },
  closedRoom: "Turn on Kalsa to use the room.",
  emptyRoom: "No messages yet. Say something, or ask Kalsa.",
  answering: (name) => `Kalsa is answering ${name}.`,
  queueNext: (name) => `Kalsa will answer ${name} next.`,
  queueThen: (name, rest) => `Kalsa will answer ${name} next, then ${rest}.`,
  stop: "Stop",
  askKalsa: "Ask Kalsa",
  writePlaceholder: "Write, or type @Kalsa…",
  writeAria: "Message",
  nameAria: "Your name",
  namePlaceholder: "Your name",
  youAre: (name) => `You are ${name}`,
  left: " · left",
  askedKalsa: "asked Kalsa ·",
  readLast: (count) => ` · read the last ${count}`,
  notes: {
    busy_waiting: "Kalsa is busy with another conversation. You keep your turn.",
    unavailable: "Kalsa can't answer in this room right now.",
    empty_answer: "Kalsa had no answer to that.",
    could_not_start: "Kalsa couldn't start. Try again.",
    engine_problem: "Kalsa ran into a problem on this computer and couldn't answer. Ask again.",
    already_pending: "You already have a question waiting for Kalsa.",
    name_taken: "Someone in this room already uses that name. Pick another.",
    name_reserved: "Kalsa is the assistant's name. Pick another.",
    name_framing: "Names can't use [ or ].",
    name_mixed_scripts: "Use letters from one alphabet in your name.",
    name_too_long: "That name is too long. Try a shorter one.",
  },
};
