// The host's room feed: the live news reducer, the history merge, and the
// commands the room page acts with. The reducer and the merge are pure —
// the bench drives them directly, which is how a merge that must not wipe
// a live page (and an epoch that must replace, not merge) stays proven.

import { useCallback, useEffect, useState } from "react";
import { available, invoke } from "../lib/tauri";

/** How many entries the page holds, matching the history command's own
    cap: a room that outgrows the window drops its oldest, on one rule. */
const ENTRY_CAP = 200;

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

/** Everything the live feed owns, as one value the pure functions move
    from state to state. */
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

/** Drops the oldest entries past the cap, and their seqs with them: a seq
    the feed forgot must be re-mergeable, not remembered as seen. */
function trim(state: RoomFeed): RoomFeed {
  if (state.entries.length <= ENTRY_CAP) return state;
  const entries = state.entries.slice(state.entries.length - ENTRY_CAP);
  const seen = new Set<number>();
  for (const entry of entries) seen.add(entry.seq);
  return { ...state, entries, seen };
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
    const next = { ...state, entries: [...state.entries, event] };
    next.seen.add(event.seq);
    const cleared =
      event.kind === "ai_message" ? { ...next, live: null } : next;
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

/** A member's rename, applied to the members list and to every entry that
    names them. */
export function renameMember(
  members: RoomMember[],
  entries: RoomEntry[],
  member_id: number,
  name: string,
): { members: RoomMember[]; entries: RoomEntry[] } {
  return {
    members: members.map((member) =>
      member.member_id === member_id ? { ...member, name } : member,
    ),
    entries: entries.map((entry) =>
      entry.member_id === member_id ? { ...entry, name } : entry,
    ),
  };
}

/** What the page's state keeps beside the feed. */
export interface RoomPage {
  info: RoomInfo | null;
  note: { code: string | null; text: string | null } | null;
  naming: boolean;
  nameDraft: string;
}

export function useRoomFeed() {
  const [feed, setFeed] = useState<RoomFeed>(emptyFeed);
  const [info, setInfo] = useState<RoomInfo | null>(null);
  const [note, setNote] = useState<RoomPage["note"]>(null);
  const [naming, setNaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!available()) return;
    try {
      const [nextInfo, history] = await Promise.all([
        invoke<RoomInfo>("brain_room"),
        invoke<RoomEntry[]>("brain_room_history", { limit: 200 }),
      ]);
      setInfo(nextInfo);
      setFeed((current) => mergeHistory(current, nextInfo.epoch, history));
    } catch {
      const closed = await invoke<RoomInfo>("brain_room").catch(() => null);
      if (closed) setInfo(closed);
    }
  }, []);

  useEffect(() => {
    if (!available()) return;
    let off: (() => void) | null = null;
    let cancelled = false;
    // The listener attaches before the reads, so nothing the room
    // announces while the page loads is lost; the reads are the history
    // those events move forward from.
    void window.__TAURI__!.event!.listen("room-event", (payload) => {
      if (cancelled) return;
      const event = payload as RoomEvent;
      if (event.kind === "ai_status") {
        setInfo((current) =>
          current
            ? {
                ...current,
                ai: {
                  state: event.state,
                  running: event.running,
                  queue: event.queue,
                  you_pending: event.you_pending,
                },
              }
            : current,
        );
        setNote(event.note_code || event.note ? { code: event.note_code, text: event.note } : null);
      }
      if (event.kind === "member" && event.action === "renamed") {
        setInfo((current) =>
          current
            ? {
                ...current,
                members: current.members.map((member) =>
                  member.member_id === event.member_id
                    ? { ...member, name: event.name }
                    : member,
                ),
              }
            : current,
        );
        setFeed((current) => {
          const renamed = renameMember([], current.entries, event.member_id, event.name);
          return { ...current, entries: renamed.entries };
        });
        return;
      }
      if (event.kind === "member") {
        void load();
        return;
      }
      setFeed((current) => reduceEvent(current, event));
    }).then((offListen) => {
      if (cancelled) offListen();
      else off = offListen;
    });
    void load();
    return () => {
      cancelled = true;
      off?.();
    };
  }, [load]);

  const send = useCallback(
    async (text: string, withCall: boolean): Promise<RoomEntry | null> => {
      if (!text || !available()) return null;
      setSending(true);
      try {
        const answer = await invoke<RoomEntry & { ai_call: string | null; refusal: string | null }>(
          "brain_room_post",
          { clientMsgId: `host-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, text, callAi: withCall },
        );
        setFeed((current) => reduceEvent(current, { kind: "message", epoch: current.epoch, ...answer }));
        return answer;
      } catch {
        // A refused post keeps the words where they were typed: nothing
        // was stored, nothing pretends.
        return null;
      } finally {
        setSending(false);
      }
    },
    [],
  );

  const stop = useCallback(async () => {
    await invoke("brain_room_stop").catch(() => {});
  }, []);

  const saveName = useCallback(async (name: string): Promise<void> => {
    if (!name) return;
    await invoke("brain_room_set_name", { name }).catch(() => {});
  }, []);

  return {
    feed: feed,
    entries: feed.entries,
    live: feed.live,
    info,
    note,
    naming,
    setNaming,
    nameDraft,
    setNameDraft,
    sending,
    load,
    send,
    stop,
    saveName,
  };
}
