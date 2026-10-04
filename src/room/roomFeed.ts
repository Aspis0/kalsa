/**
 * The room one screen reads, as pure state: the info and its members, the
 * transcript folded from history pages and live frames (deduped by seq, the
 * newest 200 kept), the posts the queue completed (the stream skips its own
 * copy of an acked seq, so that row is built from the ack and dropped when a
 * real entry for the seq arrives), the answer being assembled, the shelf
 * still waiting, and the one note a turn left. No wire, no timers, no React.
 */
import type { RoomError } from "./roomError";
import type { RoomStreamEvent } from "./roomStream";
import type { RoomQueueItem, RoomQueueSent } from "./roomQueueStore";
import type {
  RoomAiStatus,
  RoomHistoryMessage,
  RoomHistoryPage,
  RoomInfo,
  RoomMemberEvent,
} from "./roomWire";

/** The transcript window this phone keeps — §4's own page cap: the room's
 *  transcript is unbounded, the screen is not. */
const ENTRY_CAP = 200;

/** A turn that ended for any reason: no half answer survives it (§7). */
const TERMINAL_AI_STATES = new Set(["done", "refused", "cancelled", "stopped"]);

/** A post the door took: the ack's seq, paired with the words the shelf
 *  held. Never stored by the room, never stored here. */
type RoomSentPost = {
  clientMsgId: string;
  seq: number;
  time: number;
  text: string;
  callAi: boolean;
};

/** One message still on its way out. */
export type RoomQueueRow = {
  clientMsgId: string;
  text: string;
  callAi: boolean;
  state: "queued" | "sending" | "failed";
  /** The last attempt's refusal code, for the reader to be told. */
  errorCode: string | null;
};

/** One transcript line, whoever wrote it. */
export type RoomRow = {
  /** React key: the room's seq, so a re-render never moves a row. */
  seq: number;
  time: number;
  text: string;
  callAi: boolean;
  former: boolean;
  /** The room's resolved name; "" only for a host that never named itself. */
  name: string;
  /** The reader's own words, and the assistant's. */
  own: boolean;
  kalsa: boolean;
};

export type RoomFeed = {
  status: "loading" | "ready" | "error" | "removed";
  /** The one refusal or stop the page must read, if any. */
  error: RoomError | null;
  info: RoomInfo | null;
  /** Ascending seq, deduped, at most ENTRY_CAP newest. */
  entries: RoomHistoryMessage[];
  /** Acks whose entry the stream's floor skipped. */
  sent: RoomSentPost[];
  /** The shelf, in FIFO order, still on its way. */
  queue: RoomQueueRow[];
  /** The answer being assembled; its ai_message replaces it. */
  live: string | null;
  /** The last note code a turn left — i18n turns codes into sentences. */
  noteCode: string | null;
  /** A wire ended and a reconnect follows. */
  reconnecting: boolean;
};

export function emptyRoomFeed(): RoomFeed {
  return {
    status: "loading",
    error: null,
    info: null,
    entries: [],
    sent: [],
    queue: [],
    live: null,
    noteCode: null,
    reconnecting: false,
  };
}

/** Any frame that can only come from a live wire: the outage is over, and
 *  a sentence about it has had its reader. */
function wake(feed: RoomFeed): RoomFeed {
  if (!feed.reconnecting && feed.error === null) return feed;
  return { ...feed, reconnecting: false, error: null };
}

function bySeq(a: { seq: number }, b: { seq: number }): number {
  return a.seq - b.seq;
}

function capped(entries: RoomHistoryMessage[]): RoomHistoryMessage[] {
  return entries.length > ENTRY_CAP ? entries.slice(entries.length - ENTRY_CAP) : entries;
}

/** Info: the members, the AI's turn view and the room's own name, now. */
export function foldInfo(feed: RoomFeed, info: RoomInfo): RoomFeed {
  return { ...feed, status: "ready", error: null, info };
}

/** A read that never became the room: the 401 is the removed state, every
 *  other refusal the error state — the screen's two ways out are reload
 *  and nothing (the room is gone). */
export function failRoom(feed: RoomFeed, error: RoomError): RoomFeed {
  return {
    ...feed,
    status: error.code === "removed" ? "removed" : "error",
    error,
    reconnecting: false,
  };
}

/** A history page merges by seq: a page must never move a row a reader has
 *  already seen, and the room sends renames as events of their own. */
export function foldHistory(feed: RoomFeed, page: RoomHistoryPage): RoomFeed {
  const bySeqNumber = new Map<number, RoomHistoryMessage>();
  for (const entry of feed.entries) bySeqNumber.set(entry.seq, entry);
  for (const entry of page.messages) {
    if (!bySeqNumber.has(entry.seq)) bySeqNumber.set(entry.seq, entry);
  }
  const entries = capped([...bySeqNumber.values()].sort(bySeq));
  // A real entry for an acked seq takes over the row the ack built.
  const seqs = new Set(entries.map((entry) => entry.seq));
  return { ...wake(feed), entries, sent: feed.sent.filter((post) => !seqs.has(post.seq)) };
}

/** §7's resync: the page is the transcript's new floor. A dead epoch's seqs,
 *  a cursor that claimed past the end, and the rows and acks they named all
 *  go with it. */
export function foldResync(feed: RoomFeed, info: RoomInfo, history: RoomHistoryPage): RoomFeed {
  return {
    ...foldInfo(feed, info),
    entries: capped([...history.messages].sort(bySeq)),
    sent: [],
    live: null,
  };
}

function foldEntry(feed: RoomFeed, entry: RoomHistoryMessage, final: boolean): RoomFeed {
  const base = wake(feed);
  const held = base.entries.some((seen) => seen.seq === entry.seq);
  const entries = held ? base.entries : capped([...base.entries, entry].sort(bySeq));
  return {
    ...base,
    entries,
    sent: held ? base.sent : base.sent.filter((post) => post.seq !== entry.seq),
    // The final text replaces the assembly, for the turn it names (§7).
    live: final ? null : base.live,
  };
}

/** A member joined, left or was renamed. The room resolves every row's name
 *  at read time, so a rename rewrites the entries already held. */
function foldMember(feed: RoomFeed, event: RoomMemberEvent): RoomFeed {
  const base = wake(feed);
  const info = base.info;
  if (info === null) return base;
  if (event.action === "left") {
    return {
      ...base,
      info: {
        ...info,
        members: info.members.filter((member) => member.memberId !== event.memberId),
      },
    };
  }
  const name = event.name;
  if (name === null) return base;
  if (event.action === "joined") {
    if (info.members.some((member) => member.memberId === event.memberId)) return base;
    return {
      ...base,
      info: {
        ...info,
        members: [...info.members, { memberId: event.memberId, name, kind: "phone" }],
      },
    };
  }
  return {
    ...base,
    info: {
      ...info,
      members: info.members.map((member) =>
        member.memberId === event.memberId ? { ...member, name } : member,
      ),
    },
    entries: base.entries.map((entry) =>
      entry.memberId === event.memberId ? { ...entry, name } : entry,
    ),
  };
}

function foldAiStatus(feed: RoomFeed, status: RoomAiStatus): RoomFeed {
  const base = wake(feed);
  const info = base.info;
  return {
    ...base,
    info:
      info === null
        ? null
        : {
            ...info,
            ai: {
              busy: status.busy ?? info.ai.busy,
              running: status.running,
              queue: status.queue,
              youPending: status.youPending ?? info.ai.youPending,
            },
          },
    // The opening idle snapshot is not news: a turn's note stands until the
    // next move owns one (the desktop's own rule).
    noteCode: status.state === "idle" ? base.noteCode : status.noteCode ?? null,
    live: TERMINAL_AI_STATES.has(status.state) ? null : base.live,
  };
}

/** One stream event, folded. */
export function foldEvent(feed: RoomFeed, event: RoomStreamEvent): RoomFeed {
  switch (event.type) {
    case "message":
    case "ai_message":
      return foldEntry(feed, event.entry, event.type === "ai_message");
    case "member":
      return foldMember(feed, event.member);
    case "ai_status":
      return foldAiStatus(feed, event.status);
    case "ai_delta":
      return { ...wake(feed), live: event.assembled };
    case "refetched":
      return foldInfo(feed, event.info);
    case "resynced":
      return foldResync(feed, event.info, event.history);
    case "removed":
      return { ...feed, status: "removed", reconnecting: false };
    case "disconnected":
      return { ...feed, reconnecting: true };
    case "door_unusable":
      // The stream keeps trying: the road can come back, so this is a
      // sentence beside a reconnect, not a stop.
      return {
        ...feed,
        reconnecting: true,
        error: { code: "door_unusable", message: event.message },
      };
    case "error":
      // A terminal stop with no retry behind it.
      return {
        ...feed,
        status: "error",
        reconnecting: false,
        error: {
          code: event.code === "not_found" ? "not_found" : "unexpected",
          message: event.message,
        },
      };
  }
}

/** The shelf, as the screen's waiting list. */
export function foldQueue(feed: RoomFeed, items: readonly RoomQueueItem[]): RoomFeed {
  return {
    ...feed,
    queue: items.map((item) => ({
      clientMsgId: item.clientMsgId,
      text: item.text,
      callAi: item.callAi,
      state: item.state,
      errorCode: item.error?.code ?? null,
    })),
  };
}

export function foldQueueSent(feed: RoomFeed, post: RoomQueueSent): RoomFeed {
  if (feed.sent.some((held) => held.clientMsgId === post.clientMsgId)) return feed;
  const sent = [
    ...feed.sent,
    {
      clientMsgId: post.clientMsgId,
      seq: post.seq,
      time: post.time,
      text: post.text,
      callAi: post.callAi,
    },
  ];
  return { ...feed, sent: sent.length > ENTRY_CAP ? sent.slice(sent.length - ENTRY_CAP) : sent };
}

/** What the transcript renders: the room's entries plus, for an acked seq
 *  the stream skipped, the row its own post built. */
export function roomRows(feed: RoomFeed): RoomRow[] {
  const info = feed.info;
  const aiId = info?.members.find((member) => member.kind === "ai")?.memberId ?? null;
  const you = info?.you ?? null;
  const mine = info?.members.find((member) => member.memberId === you)?.name ?? "";
  const rows: RoomRow[] = feed.entries.map((entry) => ({
    seq: entry.seq,
    time: entry.time,
    text: entry.text,
    callAi: entry.callAi,
    former: entry.former,
    name: entry.name,
    own: you !== null && entry.memberId === you,
    kalsa: aiId !== null && entry.memberId === aiId,
  }));
  const seen = new Set(rows.map((row) => row.seq));
  for (const post of feed.sent) {
    if (seen.has(post.seq)) continue;
    rows.push({
      seq: post.seq,
      time: post.time,
      text: post.text,
      callAi: post.callAi,
      former: false,
      name: mine,
      own: true,
      kalsa: false,
    });
  }
  return rows.sort(bySeq);
}
