/**
 * One room's live stream as a state machine: connect over the wire,
 * hand frames to the dispatch that dedupes them, resume with
 * Last-Event-ID and the cached epoch, and decide what every ending
 * means — capped backoff with jitter when the door is unreachable, one
 * resync (drop the epoch, refetch info + history, reopen) when the
 * cursor or epoch is dead, and stop for good on401. One wire at a time:
 * a reconnect closes the old before the new opens, so the door's
 * per-device seat cap is never raced.
 *
 * Privacy: this module logs nothing — never message text, a name, or the
 * bearer. Its output is the typed events a listener receives.
 */
import { markPairingRemoved } from "../pairing/pairingCredentialStore";
import { isPairingStoreDamaged } from "../pairing/pairingMap";
import { fetchRoomHistory, fetchRoomInfo, roomDoorForCall } from "./roomApi";
import { cachedRoomEpoch, forgetRoomEpoch, noteRoomEpoch } from "./roomEpochs";
import { roomErrorFromResponse, type RoomError } from "./roomError";
import {
  createRoomFrameDispatch,
  type RoomFrameEvent,
} from "./roomStreamDispatch";
import {
  openRoomEvents,
  type RoomEventsOutcome,
  type RoomEventsHandlers,
  type RoomEventsWire,
} from "./roomStreamWire";
import type { RoomHistoryPage, RoomInfo } from "./roomWire";

/** The door pings every 15 s (stream.rs PING): no byte for twice that
 *  — ping included — means the stream is dead, not quiet. */
const PING_TIMEOUT_MS = 30_000;
const IDLE_CHECK_MS = 5_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;

/** Capped exponential backoff with half-jitter: attempt 0 lands in
 *  [500, 1000) ms, and no attempt exceeds the cap. */
export function reconnectDelayMs(attempt: number): number {
  const growth = BACKOFF_BASE_MS * 2 ** Math.min(Math.max(attempt, 0), 16);
  const capped = Math.min(BACKOFF_CAP_MS, growth);
  return Math.floor(capped / 2 + Math.random() * (capped / 2));
}

export type RoomStreamEvent =
  | RoomFrameEvent
  /** After every reconnect: info refetched once, the member news the
   *  resume does not replay (§7). */
  | { type: "refetched"; info: RoomInfo }
  /** The epoch (or cursor) died: drop everything and rebuild — the page
   *  is the transcript's new floor. */
  | { type: "resynced"; info: RoomInfo; history: RoomHistoryPage }
  /** The room refused this pairing: the stream is over for good. */
  | { type: "removed" };

export type RoomStreamHandle = {
  /** Background: close the wire and the timers, keep the resume state. */
  pause(): void;
  /** Foreground: dial again from where this session left off. */
  resume(): void;
  /** The subscription is over: stop for good, keep nothing. */
  close(): void;
};

type Listener = (event: RoomStreamEvent) => void;

export function openRoomStream(roomLocalId: string, listener: Listener): RoomStreamHandle {
  const frames = createRoomFrameDispatch(roomLocalId);
  let closed = false;
  let paused = false;
  /** Bumped whenever the session moves on: stale callbacks check it. */
  let generation = 0;
  let wire: RoomEventsWire | null = null;
  let dial: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setInterval> | null = null;
  let attempt = 0;
  let needsResync = false;
  /** The next open's info is already the resync's; it needs no refetch. */
  let infoFresh = false;
  let everConnected = false;
  let lastByteAt = 0;

  const emit = (event: RoomStreamEvent): void => {
    try {
      listener(event);
    } catch {
      // A listener's throw must not take the stream down.
    }
  };

  const ready = (gen: number): boolean => gen === generation && !closed && !paused;

  const dropWire = (): void => {
    const current = wire;
    wire = null;
    current?.close();
  };

  const clearReconnect = (): void => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  /** Tear down whatever runs — in flight, connected, or waiting — while
   *  keeping the session's resume state (seq floor, epoch, backoff). */
  const halt = (): void => {
    generation += 1;
    dial?.abort();
    dial = null;
    dropWire();
    clearReconnect();
    if (idleTimer !== null) {
      clearInterval(idleTimer);
      idleTimer = null;
    }
  };

  const stop = (): void => {
    if (closed) return;
    closed = true;
    halt();
  };

  /** One terminal verdict: 401 (or a record that no longer exists) is
   *  "removed" — mark, forget the epoch, tell the listener, stop.
   *  Anything else terminal (an unusable door) stops silently: only the
   *  room's refusal has a verdict the listener must see. */
  const refuse = (error: RoomError): void => {
    if (error.code !== "removed") {
      stop();
      return;
    }
    forgetRoomEpoch(roomLocalId);
    void markPairingRemoved(roomLocalId).catch(() => undefined);
    stop();
    emit({ type: "removed" });
  };

  const scheduleReconnect = (): void => {
    if (closed || paused || reconnectTimer !== null) return;
    const delay = reconnectDelayMs(attempt);
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void cycle();
    }, delay);
  };

  const beginResync = (): void => {
    // The cache (or the cursor) is dead before the refetch starts (§7).
    needsResync = true;
    forgetRoomEpoch(roomLocalId);
    dropWire();
    void cycle();
  };

  const handleStatus = (outcome: Extract<RoomEventsOutcome, { kind: "status" }>): void => {
    let body: unknown = null;
    try {
      body = outcome.body === "" ? null : JSON.parse(outcome.body);
    } catch {
      body = null;
    }
    const error = roomErrorFromResponse(outcome.status, body);
    if (error.code === "removed") return refuse(error);
    if (error.code === "epoch_changed" || error.code === "bad_cursor") {
      needsResync = true;
      if (error.code === "epoch_changed") forgetRoomEpoch(roomLocalId);
      void cycle();
      return;
    }
    scheduleReconnect();
  };

  /** §7's resync: one info and one history page rebuild the floor before
   *  the stream reopens. False = something else already decided what
   *  happens next (a refusal, a backoff, a stale generation). */
  const runResync = async (gen: number): Promise<boolean> => {
    const info = await fetchRoomInfo({ roomLocalId });
    if (!ready(gen)) return false;
    if (!info.ok) {
      if (info.error.code === "removed") refuse(info.error);
      else scheduleReconnect();
      return false;
    }
    const history = await fetchRoomHistory({}, { roomLocalId });
    if (!ready(gen)) return false;
    if (!history.ok) {
      if (history.error.code === "removed") refuse(history.error);
      else scheduleReconnect(); // needsResync stands: the retry redoes both
      return false;
    }
    needsResync = false;
    // Every resync trigger invalidates the old floor — a dead epoch's
    // seqs or a cursor that claimed past the end — so the page's own
    // newest seq is the only thing worth resuming after.
    frames.setFloor(history.value.messages);
    attempt = 0;
    infoFresh = true;
    emit({ type: "resynced", info: info.value, history: history.value });
    return true;
  };

  /** The reconnect's one info call (§7) — the stream stands even if the
   *  refetch fails; only the room's refusal stops it. */
  const refreshInfo = async (gen: number): Promise<void> => {
    const info = await fetchRoomInfo({ roomLocalId });
    if (!ready(gen)) return;
    if (!info.ok) {
      if (info.error.code === "removed") refuse(info.error);
      return;
    }
    emit({ type: "refetched", info: info.value });
  };

  const handlersFor = (gen: number): RoomEventsHandlers => ({
    onOpen: (epochHeader) => {
      if (!ready(gen)) return;
      attempt = 0;
      lastByteAt = Date.now();
      const cached = cachedRoomEpoch(roomLocalId);
      if (epochHeader !== null) {
        if (cached !== null && cached !== epochHeader) return beginResync();
        noteRoomEpoch(roomLocalId, epochHeader);
      }
      if (everConnected && !infoFresh) void refreshInfo(gen);
      infoFresh = false;
      everConnected = true;
    },
    onMessage: (message) => {
      if (!ready(gen)) return;
      const verdict = frames.dispatch(message);
      if (verdict.kind === "event") emit(verdict.event);
      else if (verdict.kind === "epoch_died") beginResync();
    },
    onDone: (outcome) => {
      if (!ready(gen)) return;
      wire = null;
      if (outcome.kind === "status") return handleStatus(outcome);
      scheduleReconnect();
    },
  });

  const cycle = async (): Promise<void> => {
    if (closed || paused) return;
    const gen = ++generation;
    dial = new AbortController();
    try {
      if (needsResync && !(await runResync(gen))) return;
      if (!ready(gen)) return;
      const resolved = await roomDoorForCall(roomLocalId);
      if (!ready(gen)) return;
      if (!resolved.ok) return refuse(resolved.error);
      const opened = await openRoomEvents(
        {
          door: resolved.value.door,
          token: resolved.value.token,
          lastSeq: frames.resumeFrom(),
          epoch: cachedRoomEpoch(roomLocalId),
          signal: dial.signal,
        },
        handlersFor(gen),
      );
      if (!ready(gen)) {
        opened.close();
        return;
      }
      wire = opened;
      lastByteAt = Date.now();
    } catch (error) {
      if (!ready(gen)) return;
      // A store the user must repair, not a network the next dial can win:
      // retrying would read a known-damaged map every backoff window.
      if (isPairingStoreDamaged(error)) {
        stop();
        return;
      }
      scheduleReconnect();
    }
  };

  const startIdleWatch = (): void => {
    if (idleTimer !== null) return;
    idleTimer = setInterval(() => {
      if (closed || paused || wire === null) return;
      if (Date.now() - lastByteAt <= PING_TIMEOUT_MS) return;
      // Nothing — ping included — for twice the door's interval: dead.
      dropWire();
      scheduleReconnect();
    }, IDLE_CHECK_MS);
  };

  startIdleWatch();
  void cycle();

  return {
    pause: () => {
      if (closed || paused) return;
      paused = true;
      halt();
    },
    resume: () => {
      if (closed || !paused) return;
      paused = false;
      attempt = 0; // foreground dials at once; the backoff starts over
      startIdleWatch();
      void cycle();
    },
    close: stop,
  };
}
