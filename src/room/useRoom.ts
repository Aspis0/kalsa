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
  foldEvent,
  foldHistory,
  foldInfo,
  foldQueue,
  foldQueueSent,
  roomRows,
  type RoomFeed,
  type RoomQueueRow,
  type RoomRow,
} from "./roomFeed";
import {
  discardRoomQueueItem,
  enqueueRoomMessage,
  getRoomQueue,
  retryRoomQueueItem,
  subscribeRoomQueue,
} from "./roomQueue";
import { subscribeRoomEvents } from "./roomSubscriptions";

/** §4's own cap, and the page the Room asks for: the newest 200. */
const HISTORY_LIMIT = 200;

export type RoomView = {
  feed: RoomFeed;
  rows: RoomRow[];
  pending: RoomQueueRow[];
  /** The code of the last name the room refused, for the form. */
  nameErrorCode: string | null;
  /** The code of the last compose the shelf refused, before anything was
   *  stored — the words stay in the composer. */
  sendErrorCode: string | null;
  setName: (name: string) => Promise<void>;
  /** Post the words; true when the shelf took them. */
  send: (text: string, askKalsa: boolean) => Promise<boolean>;
  retry: (clientMsgId: string) => Promise<void>;
  discard: (clientMsgId: string) => Promise<void>;
  /** Read info and history again and resubscribe: the error state's way out. */
  reload: () => void;
};

export function useRoom(localId: string): RoomView {
  const [feed, setFeed] = useState<RoomFeed>(emptyRoomFeed);
  const [nameErrorCode, setNameErrorCode] = useState<string | null>(null);
  const [sendErrorCode, setSendErrorCode] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // An action's answer may land after the screen is gone: the state it would
  // set must not.
  const liveRef = useRef(true);
  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    const apply = (fold: (current: RoomFeed) => RoomFeed): void => {
      if (live) setFeed(fold);
    };
    setFeed(emptyRoomFeed());
    setNameErrorCode(null);
    setSendErrorCode(null);

    // The listeners attach before the reads: nothing the room announces
    // while the page loads is lost.
    const leaveStream = subscribeRoomEvents(localId, (event) =>
      apply((current) => foldEvent(current, event)),
    );
    const leaveQueue = subscribeRoomQueue(localId, (event) => {
      if (event.type === "changed") apply((current) => foldQueue(current, event.items));
      else apply((current) => foldQueueSent(current, event.item));
    });
    // A subscription only announces what moves after it: the shelf as it
    // stands is read once, here.
    void getRoomQueue(localId)
      .then((items) => apply((current) => foldQueue(current, items)))
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
      apply((current) => foldHistory(foldInfo(current, info.value), history.value));
      return null;
    };
    void (async () => {
      const refused = await read();
      if (refused === null) return;
      if (refused.code !== "epoch_changed") {
        apply((current) => failRoom(current, refused));
        return;
      }
      const again = await read();
      if (again !== null) apply((current) => failRoom(current, again));
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
        setFeed((current) =>
          foldEvent(current, {
            type: "member",
            member: { action: "renamed", memberId: result.value.memberId, name: result.value.name },
          }),
        );
      } else {
        setNameErrorCode(result.error.code);
      }
    },
    [localId],
  );

  const send = useCallback(
    async (text: string, askKalsa: boolean): Promise<boolean> => {
      const body = text.trim();
      // A bare "@" names nobody: nothing to post (the desktop's own rule).
      if (body === "" || body === "@") return false;
      const result = await enqueueRoomMessage(localId, { text: body, callAi: askKalsa });
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

  const reload = useCallback(() => setAttempt((current) => current + 1), []);

  const rows = useMemo(() => roomRows(feed), [feed]);
  return {
    feed,
    rows,
    pending: feed.queue,
    nameErrorCode,
    sendErrorCode,
    setName,
    send,
    retry,
    discard,
    reload,
  };
}
