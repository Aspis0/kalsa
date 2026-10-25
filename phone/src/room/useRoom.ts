/**
 * One room on screen: the pairing's info and its newest history read on
 * mount, the live stream folded in from then on, the persisted shelf folded
 * beside it, and what the reader can do — name themselves, post (an asked
 * call riding the same post), retry, discard, start over. Leaving stops
 * everything: the subscriptions leave (the last listener out closes the
 * wire and the queue's own timers with it) and a read in flight is aborted.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchRoomHistory, fetchRoomInfo, putRoomName } from "./roomApi";
import type { RoomError } from "./roomError";
import {
  emptyRoomFeed,
  failRoom,
  foldHistory,
  foldInfo,
  foldQueue,
  foldQueueSent,
  roomRows,
  type RoomFeed,
  type RoomQueueRow,
  type RoomRow,
} from "./roomFeed";
import { foldEvent } from "./roomFrames";
import {
  discardRoomQueueItem,
  createRoomClientMsgId,
  enqueueRoomMessage,
  getRoomQueue,
  retryRoomQueueItem,
  subscribeRoomQueue,
} from "./roomQueue";
import { subscribeRoomEvents } from "./roomSubscriptions";

/** §4's own cap, and the page the Room asks for: the newest 200. */
const HISTORY_LIMIT = 200;

type FeedLogOp = "mount" | "read" | "history" | "resync" | "entry" | "info" | "removed" | "error";

function feedSequenceBounds(feed: RoomFeed): { seqFirst: number; seqLast: number } {
  return {
    seqFirst: feed.entries[0]?.seq ?? -1,
    seqLast: feed.entries[feed.entries.length - 1]?.seq ?? -1,
  };
}

function logRoomFeed(op: FeedLogOp, feed: RoomFeed): void {
  console.log(`KALSA_ROOM_FEED ${JSON.stringify({
    op,
    entries: feed.entries.length,
    ...feedSequenceBounds(feed),
    epoch8: feed.epoch.slice(0, 8) || "unknown",
    status: feed.status,
  })}`);
}

export type RoomView = {
  feed: RoomFeed;
  rows: RoomRow[];
  pending: RoomQueueRow[];
  /** The code of the last name the room refused, for the form. */
  nameErrorCode: string | null;
  /** The code of the last compose the shelf refused, before anything was
   *  stored — the words stay in the composer. */
  sendErrorCode: string | null;
  /** The code of a page that would not load (`feed.hasOlder` still says
   *  the room holds one: the same tap is the retry). */
  pageErrorCode: string | null;
  loadingOlder: boolean;
  setName: (name: string) => Promise<void>;
  /** Post the words; true when the shelf took them. */
  send: (text: string, askKalsa: boolean) => Promise<boolean>;
  retry: (clientMsgId: string) => Promise<void>;
  discard: (clientMsgId: string) => Promise<void>;
  /** §4's `before` cursor: the page immediately older than the window's
   *  floor, merged by seq (a page the reader already holds adds nothing). */
  loadOlder: () => Promise<void>;
  /** Read info and history again and resubscribe: the error state's way out. */
  reload: () => void;
};

export function useRoom(localId: string): RoomView {
  const [feed, setFeed] = useState<RoomFeed>(emptyRoomFeed);
  const [nameErrorCode, setNameErrorCode] = useState<string | null>(null);
  const [sendErrorCode, setSendErrorCode] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [pageErrorCode, setPageErrorCode] = useState<string | null>(null);
  const pendingSendRef = useRef<{ text: string; askKalsa: boolean; clientMsgId: string } | null>(null);
  // An action's answer may land after the screen is gone: the state it would
  // set must not.
  const liveRef = useRef(true);
  const mountLogged = useRef(false);
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const commitFeed = useCallback((op: FeedLogOp, fold: (current: RoomFeed) => RoomFeed): void => {
    const previous = feedRef.current;
    let next: RoomFeed;
    try {
      next = fold(previous);
    } catch (error) {
      logRoomFeed("error", previous);
      setFeed(() => {
        throw error;
      });
      return;
    }
    const previousBounds = feedSequenceBounds(previous);
    const nextBounds = feedSequenceBounds(next);
    if (
      previous.entries.length !== next.entries.length ||
      previous.epoch !== next.epoch ||
      previousBounds.seqFirst !== nextBounds.seqFirst ||
      previousBounds.seqLast !== nextBounds.seqLast ||
      op === "removed" ||
      op === "error"
    ) {
      logRoomFeed(op, next);
    }
    feedRef.current = next;
    setFeed(next);
  }, []);
  const olderInFlight = useRef(false);
  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (mountLogged.current) return;
    mountLogged.current = true;
    logRoomFeed("mount", feedRef.current);
  }, []);

  useEffect(() => {
    let live = true;
    const apply = (op: FeedLogOp, fold: (current: RoomFeed) => RoomFeed): void => {
      if (live) commitFeed(op, fold);
    };
    commitFeed("mount", () => emptyRoomFeed());
    setNameErrorCode(null);
    setSendErrorCode(null);
    pendingSendRef.current = null;
    setPageErrorCode(null);

    // The listeners attach before the reads: nothing the room announces
    // while the page loads is lost.
    const leaveStream = subscribeRoomEvents(localId, (event) => {
      const op: FeedLogOp =
        event.type === "message" || event.type === "ai_message"
          ? "entry"
          : event.type === "resynced"
            ? "resync"
            : event.type === "refetched"
              ? "info"
              : event.type === "removed"
                ? "removed"
                : event.type === "error"
                  ? "error"
                  : "info";
      apply(op, (current) => foldEvent(current, event));
    });
    const leaveQueue = subscribeRoomQueue(localId, (event) => {
      if (event.type === "changed") apply("info", (current) => foldQueue(current, event.items));
      else apply("info", (current) => foldQueueSent(current, event.item));
    });
    // A subscription only announces what moves after it: the shelf as it
    // stands is read once, here.
    void getRoomQueue(localId)
      .then((items) => apply("info", (current) => foldQueue(current, items)))
      .catch(() => undefined);

    const controller = new AbortController();
    const options = { roomLocalId: localId, signal: controller.signal };
    // §7: a dead cached epoch answers 409 epoch_changed once — roomApi drops
    // the cache on that answer, so one more read goes bare and learns the
    // new one. Any other refusal is the screen's own state.
    const read = async (): Promise<RoomError | null> => {
      const info = await fetchRoomInfo(options);
      if (!live) return null;
      if (!info.ok) return info.error;
      const history = await fetchRoomHistory({ limit: HISTORY_LIMIT }, options);
      if (!live) return null;
      if (!history.ok) return history.error;
      apply("read", (current) => foldHistory(foldInfo(current, info.value), history.value));
      return null;
    };
    void (async () => {
      const refused = await read();
      if (refused === null) return;
      if (refused.code !== "epoch_changed") {
        apply("error", (current) => failRoom(current, refused));
        return;
      }
      const again = await read();
      if (again !== null) apply("error", (current) => failRoom(current, again));
    })();

    return () => {
      live = false;
      controller.abort();
      leaveQueue();
      leaveStream();
    };
  }, [localId, attempt]);

  const setName = useCallback(
    async (name: string): Promise<void> => {
      const result = await putRoomName(name.trim(), { roomLocalId: localId });
      if (!liveRef.current) return;
      if (result.ok) {
        setNameErrorCode(null);
        // The room confirmed the name: a rename of the reader, and the rows
        // already held resolve to it (the room resolves names at read time).
        commitFeed("info", (current) =>
          foldEvent(current, {
            type: "member",
            member: { action: "renamed", memberId: result.value.memberId, name: result.value.name },
          }),
        );
      } else {
        setNameErrorCode(result.error.code);
      }
    },
    [commitFeed, localId],
  );

  const send = useCallback(
    async (text: string, askKalsa: boolean): Promise<boolean> => {
      const body = text.trim();
      // A bare "@" names nobody: nothing to post (the desktop's own rule).
      if (body === "" || body === "@") return false;
      let pending = pendingSendRef.current;
      if (pending === null || pending.text !== body || pending.askKalsa !== askKalsa) {
        try {
          pending = { text: body, askKalsa, clientMsgId: createRoomClientMsgId() };
          pendingSendRef.current = pending;
        } catch {
          if (liveRef.current) setSendErrorCode("client_msg_id_unavailable");
          return false;
        }
      }
      let result;
      try {
        result = await enqueueRoomMessage(localId, {
          text: body,
          callAi: askKalsa,
          clientMsgId: pending.clientMsgId,
        });
      } catch {
        // A shelf that cannot even be read must be a sentence, not a
        // silent clear: the words go back to the composer either way.
        result = { ok: false, error: { code: "unexpected", message: "The message could not be queued." } };
      }
      if (result.ok) pendingSendRef.current = null;
      if (liveRef.current) setSendErrorCode(result.ok ? null : result.error.code);
      return result.ok;
    },
    [localId],
  );

  const retry = useCallback(
    async (clientMsgId: string): Promise<void> => {
      await retryRoomQueueItem(localId, clientMsgId);
    },
    [localId],
  );

  const discard = useCallback(
    async (clientMsgId: string): Promise<void> => {
      await discardRoomQueueItem(localId, clientMsgId);
    },
    [localId],
  );

  const loadOlder = useCallback(async (): Promise<void> => {
    const current = feedRef.current;
    // The window's floor is the cursor; without one (or without older
    // entries) there is no page to ask for.
    if (olderInFlight.current || !current.hasOlder || current.entries.length === 0) return;
    olderInFlight.current = true;
    setLoadingOlder(true);
    try {
      const page = await fetchRoomHistory(
        { before: current.entries[0].seq, limit: HISTORY_LIMIT },
        { roomLocalId: localId },
      );
      if (!liveRef.current) return;
      if (!page.ok) {
        // A dead epoch is not the reader's to fix: the stream's resync reads
        // the room again. Every other refusal is a sentence.
        setPageErrorCode(page.error.code === "epoch_changed" ? null : page.error.code);
        return;
      }
      setPageErrorCode(null);
      commitFeed("history", (held) => foldHistory(held, page.value));
    } finally {
      olderInFlight.current = false;
      if (liveRef.current) setLoadingOlder(false);
    }
  }, [commitFeed, localId]);

  const reload = useCallback(() => setAttempt((current) => current + 1), []);

  const rows = useMemo(() => roomRows(feed), [feed]);
  return {
    feed,
    rows,
    pending: feed.queue,
    nameErrorCode,
    sendErrorCode,
    pageErrorCode,
    loadingOlder,
    setName,
    send,
    retry,
    discard,
    loadOlder,
    reload,
  };
}
