/**
 * The room one screen reads, as pure state: the info and its members, the
 * transcript folded from the numbered entries and the reads (deduped by
 * seq, the newest page plus what the reader paged in), the posts the queue
 * completed (the stream skips its own copy of an acked seq, so that row is
 * built from the ack and dropped when a real entry for the seq arrives),
 * the shelf still waiting, and what the screen renders. The news frames
 * fold in beside this file (`roomFrames.ts`); no wire, no timers, no React.
 */
import type { RoomError } from "./roomError";
import type { RoomQueueItem, RoomQueueSent } from "./roomQueueStore";
import type {
  RoomHistoryMessage,
  RoomHistoryPage,
  RoomInfo,
  RoomMember,
} from "./roomWire";

/** One history page: §4's own cap, and what the reader asks for. */
const PAGE_SIZE = 200;
/** The paged window's bound: the newest page plus four the reader asked
 *  for. An older page falling off here is not lost — the room has it, and
 *  `hasOlder` says so. */
const WINDOW_SIZE = PAGE_SIZE * 5;

/** A post the door took: the ack's seq, paired with the words the shelf
 *  held, and the code of any call the room refused (null when it took it). */
type RoomSentPost = {
  clientMsgId: string;
  seq: number;
  time: number;
  text: string;
  callAi: boolean;
  refusal: string | null;
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
  /** The transcript epoch every entry held belongs to; "" before the first
   *  answer names one. A read or a frame from another epoch is stale (§7). */
  epoch: string;
  /** Ascending seq, deduped, at most WINDOW_SIZE newest. */
  entries: RoomHistoryMessage[];
  /** Whether the room holds entries older than the window's floor. */
  hasOlder: boolean;
  /** Acks whose entry the stream's floor skipped. */
  sent: RoomSentPost[];
  /** The shelf, in FIFO order, still on its way. */
  queue: RoomQueueRow[];
  /** The answer being assembled; its ai_message replaces it. */
  live: string | null;
  /** The last note code a turn left — i18n turns codes into sentences. */
  noteCode: string | null;
  /** The last call the room refused with the post it carried (§5). */
  callRefusalCode: string | null;
  /** A wire ended and a reconnect follows. */
  reconnecting: boolean;
};

export function emptyRoomFeed(): RoomFeed {
  return {
    status: "loading",
    error: null,
    info: null,
    epoch: "",
    entries: [],
    hasOlder: false,
    sent: [],
    queue: [],
    live: null,
    noteCode: null,
    callRefusalCode: null,
    reconnecting: false,
  };
}

/** Any frame that can only come from a live wire: the outage is over, and
 *  a sentence about it has had its reader. */
export function wake(feed: RoomFeed): RoomFeed {
  if (!feed.reconnecting && feed.error === null) return feed;
  return { ...feed, reconnecting: false, error: null };
}

function bySeq(a: { seq: number }, b: { seq: number }): number {
  return a.seq - b.seq;
}

/** What the window kept, and whether the bound dropped anything: a room
 *  that still holds what fell off must keep offering it. */
function capped(entries: RoomHistoryMessage[]): {
  entries: RoomHistoryMessage[];
  trimmed: boolean;
} {
  if (entries.length <= WINDOW_SIZE) return { entries, trimmed: false };
  return { entries: entries.slice(entries.length - WINDOW_SIZE), trimmed: true };
}

/** The room's own name resolution, applied to the rows held: a rename
 *  recolors their past words, and an author the room no longer lists is a
 *  former member — their words stay, marked (the room resolves names at
 *  read time; this is that resolution arriving late). The SAME array comes
 *  back when nothing changed, so a refetch that says what is already on
 *  screen re-renders nothing. */
export function resolveNames(
  entries: RoomHistoryMessage[],
  members: readonly RoomMember[],
): RoomHistoryMessage[] {
  const byId = new Map(members.map((member) => [member.memberId, member]));
  let changed = false;
  const resolved = entries.map((entry) => {
    const member = byId.get(entry.memberId);
    if (member === undefined) {
      if (entry.former) return entry;
      changed = true;
      return { ...entry, former: true };
    }
    if (entry.name === member.name && !entry.former) return entry;
    changed = true;
    return { ...entry, name: member.name, former: false };
  });
  return changed ? resolved : entries;
}

/** Info: the members, the AI's turn view and the room's own name, now —
 *  and the name resolution for the rows already held. A read that lost a
 *  race — the room refused this phone, or moved to another epoch while the
 *  request was out — changes nothing: the live feed is the newer word. */
export function foldInfo(feed: RoomFeed, info: RoomInfo): RoomFeed {
  if (feed.status === "removed") return feed;
  if (feed.epoch !== "" && feed.epoch !== info.epoch) return feed;
  return {
    ...feed,
    status: "ready",
    error: null,
    info,
    epoch: info.epoch,
    entries: resolveNames(feed.entries, info.members),
  };
}

/** A read that never became the room: the 401 is the removed state, every
 *  other refusal the error state — the screen's two ways out are reload
 *  and nothing (the room is gone). Removal is the one verdict a slower
 *  answer must not take back. */
export function failRoom(feed: RoomFeed, error: RoomError): RoomFeed {
  if (feed.status === "removed") return feed;
  return {
    ...feed,
    status: error.code === "removed" ? "removed" : "error",
    error,
    reconnecting: false,
  };
}

/** A history page merges by seq: a page must never move a row a reader has
 *  already seen, and the room sends renames as events of their own. A page
 *  from another epoch than the feed's is a stale read of a floor that has
 *  been replaced: it changes nothing. */
export function foldHistory(feed: RoomFeed, page: RoomHistoryPage): RoomFeed {
  if (feed.status === "removed") return feed;
  if (page.messages.some((entry) => feed.epoch !== "" && entry.epoch !== feed.epoch)) {
    return feed;
  }
  const bySeqNumber = new Map<number, RoomHistoryMessage>();
  for (const entry of feed.entries) bySeqNumber.set(entry.seq, entry);
  for (const entry of page.messages) {
    if (!bySeqNumber.has(entry.seq)) bySeqNumber.set(entry.seq, entry);
  }
  const kept = capped([...bySeqNumber.values()].sort(bySeq));
  // A real entry for an acked seq takes over the row the ack built.
  const seqs = new Set(kept.entries.map((entry) => entry.seq));
  return {
    ...wake(feed),
    entries: kept.entries,
    hasOlder: page.hasOlder || kept.trimmed,
    sent: feed.sent.filter((post) => !seqs.has(post.seq)),
  };
}

/** §7's resync: the page is the transcript's new floor. A dead epoch's seqs,
 *  a cursor that claimed past the end, and the rows and acks they named all
 *  go with it. */
export function foldResync(feed: RoomFeed, info: RoomInfo, history: RoomHistoryPage): RoomFeed {
  const kept = capped([...history.messages].sort(bySeq));
  return {
    ...foldInfo({ ...feed, epoch: "" }, info),
    entries: kept.entries,
    hasOlder: history.hasOlder || kept.trimmed,
    sent: [],
    live: null,
  };
}

export function foldEntry(feed: RoomFeed, entry: RoomHistoryMessage, final: boolean): RoomFeed {
  const base = wake(feed);
  // The epoch the first frame names is the feed's: after that, an entry from
  // another one belongs to a floor a resync will bring whole.
  if (base.epoch !== "" && entry.epoch !== base.epoch) return base;
  const held = base.entries.some((seen) => seen.seq === entry.seq);
  const kept = held ? null : capped([...base.entries, entry].sort(bySeq));
  return {
    ...base,
    epoch: base.epoch === "" ? entry.epoch : base.epoch,
    entries: kept === null ? base.entries : kept.entries,
    hasOlder: base.hasOlder || (kept !== null && kept.trimmed),
    sent: held ? base.sent : base.sent.filter((post) => post.seq !== entry.seq),
    // The final text replaces the assembly, for the turn it names (§7).
    live: final ? null : base.live,
  };
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
  const sent = feed.sent.some((held) => held.clientMsgId === post.clientMsgId)
    ? feed.sent
    : [...feed.sent, {
        clientMsgId: post.clientMsgId,
        seq: post.seq,
        time: post.time,
        text: post.text,
        callAi: post.callAi,
        refusal: post.refusal,
      }];
  return {
    ...feed,
    // §5's refused call is news about the reader's own post: the room refused
    // the CALL, not the message, and the ack is where it says so — before
    // (and without) any ai_status frame.
    callRefusalCode: post.refusal,
    sent: sent.length > PAGE_SIZE ? sent.slice(sent.length - PAGE_SIZE) : sent,
  };
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
