// The room's English: the approved copy, keyed the way the page reads it.
// The note codes are the backend's contract, unchanged.

export interface RoomTable {
  /** How the language joins the names after "then": English "Luca and
      Sofia", whole-message rule — never fragments. */
  listJoin: (items: string[]) => string;
  closedRoom: string;
  emptyRoom: string;
  /** Inside Kalsa's bubble while the turn runs and no answer word has
      arrived yet — not while she waits for a seat (the note says that). */
  readingRoom: string;
  queueNext: (name: string) => string;
  queueThen: (name: string, rest: string) => string;
  askKalsa: string;
  writePlaceholder: string;
  writeAria: string;
  nameAria: string;
  namePlaceholder: string;
  youAre: (name: string) => string;
  left: string;
  askedKalsa: string;
  readLast: (count: number) => string;
  /** The app's own sentence for any code the notes table does not know —
      one policy for notes, refusals, name errors and failed sends. */
  noteFallback: string;
  /** The host's default name, for the name the backend leaves empty: the
      computer itself, in the household's language. */
  defaultHostName: string;
  notes: Record<string, string>;
  /** Pictures and videos: the composer's chips, and the shelf's refusal
      codes (§5b) in the household's words. */
  media: {
    compressing: (pct: number) => string;
    uploading: (pct: number) => string;
    cancel: string;
    remove: string;
    videoLabel: string;
    videoUnavailable: string;
    imageUnavailable: string;
    enlarge: string;
    playVideo: string;
    notMedia: string;
    tooManyMedia: string;
    tooLargeImage: string;
    imageUnreadable: string;
    tooLargeVideo: string;
    undecodableVideo: string;
    full: string;
    uploadBroken: string;
    uploadFailed: string;
    clearAction: string;
    clearConfirm: string;
    clearDelete: string;
    clearKeep: string;
    clearFailed: string;
    fallbackImage: string;
    fallbackVideo: string;
  };
}

export const ROOM: RoomTable = {
  listJoin: (items) => {
    if (items.length < 3) return items.join(" and ");
    return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  },
  closedRoom: "Turn on Kalsa to use the room.",
  emptyRoom: "No messages yet. Say something, or ask Kalsa.",
  readingRoom: "Reading the room — Kalsa will answer soon.",
  queueNext: (name) => `Kalsa will answer ${name} next.`,
  queueThen: (name, rest) => `Kalsa will answer ${name} next, then ${rest}.`,
  askKalsa: "Ask Kalsa",
  writePlaceholder: "Write, or type @Kalsa…",
  writeAria: "Message",
  nameAria: "Your name",
  namePlaceholder: "Your name",
  youAre: (name) => `You are ${name}`,
  left: " · left",
  askedKalsa: "asked Kalsa ·",
  readLast: (count) =>
    count === 1 ? " · read the last message" : ` · read the last ${count} messages`,
  noteFallback: "Something did not work. Try again.",
  defaultHostName: "This computer",
  notes: {
    busy_waiting: "Kalsa is busy with another conversation. You keep your turn.",
    unavailable: "Kalsa can't answer in this room right now.",
    empty_answer: "Kalsa had no answer to that.",
    could_not_start: "Kalsa couldn't start. Try again.",
    engine_problem: "Kalsa ran into a problem on this computer and couldn't answer. Ask again.",
    seat_timeout: "Kalsa waited for a turn at the engine and gave up. Ask again.",
    too_large: "That message is too long for the room. Shorten it or split it in two.",
    read_only: "The room can't take messages right now. Try again in a moment.",
    client_msg_id_reused: "That message is already in the room.",
    internal: "Something went wrong on this computer. Try again.",
    already_pending: "You already have a question waiting for Kalsa.",
    name_taken: "Someone in this room already uses that name. Pick another.",
    name_reserved: "Kalsa is the assistant's name. Pick another.",
    name_framing: "Names can't use [ or ].",
    name_mixed_scripts: "Use letters from one alphabet in your name.",
    name_too_long: "That name is too long. Try a shorter one.",
  },
  media: {
    compressing: (pct) => `Compressing… ${pct}%`,
    uploading: (pct) => `Uploading… ${pct}%`,
    cancel: "Cancel",
    remove: "Remove",
    videoLabel: "Video",
    videoUnavailable: "Video unavailable",
    imageUnavailable: "Picture unavailable",
    enlarge: "View full size",
    playVideo: "Play video",
    notMedia: "Only pictures and videos can be attached here.",
    tooManyMedia: "Up to 8 photos and videos can ride one message.",
    tooLargeImage: "That picture is too large for the room (4 MB at most).",
    imageUnreadable: "That picture can't be read here. Try another one.",
    tooLargeVideo: "That video is too large for the room (over 100 MB).",
    undecodableVideo: "That video can't be read here. Convert it to MP4 and try again.",
    full: "The Room is full (2 GB). Use Clear Room photos and videos to make room.",
    uploadBroken: "The file didn't survive the upload whole. Try again.",
    uploadFailed: "The upload didn't go through. Try again.",
    clearAction: "Clear Room photos and videos",
    clearConfirm: "Delete all photos and videos in this Room for everyone? Messages stay.",
    clearDelete: "Delete",
    clearKeep: "Keep",
    clearFailed: "Couldn't clear the Room's media. Try again.",
    // The computer's stored fallback tokens (§5b), shown again when the
    // blob itself cannot be shown: the same words every reader sees.
    fallbackImage: "[Image]",
    fallbackVideo: "[Video]",
  },
};
