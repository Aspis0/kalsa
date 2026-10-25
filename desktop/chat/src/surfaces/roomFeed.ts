// The room feed's state and its rules: what one live event does, what a
// history page does, and what an epoch move does. Pure — the bench drives
// these directly, which is how a merge that must not wipe a live page and
// an epoch that must replace stay proven.

/** One blob a message carries, the descriptor whole (§5b): the id names
    it, the rest says what it is. */
export interface RoomEntryMedia {
  id: string;
  kind: "image" | "video";
  mime: string;
  bytes: number;
  sha256: string;
  width: number;
  height: number;
  duration_ms: number | null;
  frames: string[];
}

export interface RoomMember {
  member_id: number;
  name: string;
  kind: "host" | "phone" | "ai";
  former: boolean;
}

export interface RoomAi {
  state: string;
  running: string | null;
  queue: string[];
  you_pending: boolean;
}

export interface RoomInfo {
  epoch: string;
  open: boolean;
  room_name: string;
  you: number;
  members: RoomMember[];
  ai: RoomAi;
}

export interface RoomEntry {
  seq: number;
  member_id: number;
  name: string;
  former: boolean;
  text: string;
  time: number;
  call_ai: boolean;
  read: number | null;
  /** The blobs this post carries, absent when it carries none. */
  media?: RoomEntryMedia[];
}

export type RoomEvent =
  | ({ kind: "message" | "ai_message"; epoch: string } & RoomEntry)
  | { kind: "member"; action: "joined" | "renamed" | "left"; member_id: number; name: string }
  | {
      kind: "ai_status";
      state: string;
      note_code: string | null;
      note: string | null;
      running: string | null;
      queue: string[];
      you_pending: boolean;
    }
  | { kind: "ai_delta"; turn: number; text: string };

export interface LiveAnswer {
  turn: number;
  text: string;
}

export interface RoomFeed {
  epoch: string;
  entries: RoomEntry[];
  /** The seqs the feed holds, so a history page cannot double an entry
      the live news already delivered. */
  seen: Set<number>;
  live: LiveAnswer | null;
}

export function emptyFeed(): RoomFeed {
  return { epoch: "", entries: [], seen: new Set(), live: null };
}

function bySeq(a: RoomEntry, b: RoomEntry): number {
  return a.seq - b.seq;
}

/** How many entries the page holds, matching the history command's own
    cap: a room that outgrows the window drops its oldest, on one rule. */
const ENTRY_CAP = 200;

function trim(state: RoomFeed): RoomFeed {
  if (state.entries.length <= ENTRY_CAP) return state;
  const entries = state.entries.slice(state.entries.length - ENTRY_CAP);
  const seen = new Set<number>();
  for (const entry of entries) seen.add(entry.seq);
  return { ...state, entries, seen };
}

/** Merges a history page into the feed. Within one epoch the merge is by
    seq, sorted — a page must never wipe entries the live news already
    delivered. A new epoch REPLACES: its seqs name different words, so
    keeping anything across the boundary would be a lie. */
export function mergeHistory(state: RoomFeed, epoch: string, history: RoomEntry[]): RoomFeed {
  if (state.epoch !== "" && state.epoch !== epoch) {
    const seen = new Set<number>();
    for (const entry of history) seen.add(entry.seq);
    return { epoch, entries: history, seen, live: null };
  }
  const entries = [...state.entries];
  for (const entry of history) {
    if (!state.seen.has(entry.seq) && !entries.some((held) => held.seq === entry.seq)) {
      entries.push(entry);
    }
  }
  entries.sort(bySeq);
  const seen = new Set<number>();
  for (const entry of entries) seen.add(entry.seq);
  return trim({ ...state, epoch, entries, seen });
}

/** One live event, folded into the feed. */
export function reduceEvent(state: RoomFeed, event: RoomEvent): RoomFeed {
  if (event.kind === "message" || event.kind === "ai_message") {
    if (state.epoch !== "" && state.epoch !== event.epoch) {
      const seen = new Set<number>([event.seq]);
      return {
        epoch: event.epoch,
        entries: [event],
        seen,
        live: event.kind === "ai_message" ? null : state.live,
      };
    }
    if (state.seen.has(event.seq)) return state;
    // The seen set is cloned, never mutated: this fold runs under StrictMode's
    // double invocation, and a set shared with the previous state would mark
    // the seq present for the second run, which then keeps the old state and
    // the message never lands.
    const seen = new Set(state.seen);
    seen.add(event.seq);
    const next = { ...state, entries: [...state.entries, event], seen };
    const cleared = event.kind === "ai_message" ? { ...next, live: null } : next;
    return trim(cleared);
  }
  if (event.kind === "ai_delta") {
    const live =
      state.live && state.live.turn === event.turn
        ? { turn: state.live.turn, text: state.live.text + event.text }
        : { turn: event.turn, text: event.text };
    return { ...state, live };
  }
  if (event.kind === "ai_status") {
    // The terminal frame clears a live assembly that never became a
    // message: the turn it belonged to is over.
    const live = event.state === "done" ? null : state.live;
    return { ...state, live };
  }
  return state;
}

/** A member's rename, applied to every entry that names them. */
export function renameEntries(
  entries: RoomEntry[],
  member_id: number,
  name: string,
): RoomEntry[] {
  return entries.map((entry) =>
    entry.member_id === member_id ? { ...entry, name } : entry,
  );
}
