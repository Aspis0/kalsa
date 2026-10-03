/**
 * One room's live stream as a state machine: connect over the wire,
 * hand frames to the dispatch that dedupes and assembles them, resume
 * with Last-Event-ID and the cached epoch, and decide what every ending
 * means — capped backoff with jitter when the door is unreachable, a
 * resync through that same backoff when the cursor or epoch is dead
 * (three fruitless resyncs in a row are the end), and stop for good on
 * 401 or 404. One wire at a time: a reconnect closes the old before the
 * new opens, so the door's per-device seat cap is never raced. The
 * backoff restarts only after a healthy stream — up a minute, or an
 * entry delivered — never on the bare head.
 *
 * Privacy: this module logs nothing — never message text, a name, or the
 * bearer. Its output is the typed events a listener receives.
 */
import { markPairingRemoved } from "../pairing/pairingCredentialStore";
import { isPairingStoreDamaged } from "../pairing/pairingMap";
import { roomDoorForCall } from "./roomApi";
import { cachedRoomEpoch, forgetRoomEpoch, noteRoomEpoch } from "./roomEpochs";
import { IROH_MISSING_MESSAGE, type RoomError } from "./roomError";
import { backoffDelayMs } from "./roomBackoff";
import { createRoomFrameDispatch, type RoomFrameEvent } from "./roomStreamDispatch";
import { flushRoomQueue } from "./roomQueue";
import { refetchInfo, refetchResync } from "./roomStreamRefetch";
import {
  roomStreamStatusAction,
  type RoomStreamStopCode,
} from "./roomStreamStatus";
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
/** Up this long, or an entry delivered, earns a fresh backoff. */
const HEALTHY_STREAM_MS = 60_000;
/** Resyncs with no numbered entry between them before the session gives up. */
const MAX_CONSECUTIVE_RESYNC = 3;

export type RoomStreamEvent =
  | RoomFrameEvent
  /** After every reconnect: info refetched once, the member news the
   *  resume does not replay (§7). */
  | { type: "refetched"; info: RoomInfo }
  /** The epoch (or cursor) died: drop everything and rebuild — the page
   *  is the transcript's new floor. */
  | { type: "resynced"; info: RoomInfo; history: RoomHistoryPage }
  /** The room refused this pairing: the stream is over for good. */
  | { type: "removed" }
  /** The open wire ended — the door cut it or the transport failed — and
   *  a reconnect follows; the UI's cue to say so. */
  | { type: "disconnected" }
  /** The door can't be dialed at all right now (a doorless pairing whose
   *  iroh road is gone): the message is user copy, and a reconnect
   *  follows — the road can come back, so this is not a stop. */
  | { type: "door_unusable"; message: string }
  /** A terminal stop with no retry behind it. */
  | { type: "error"; code: RoomStreamStopCode; message: string };

export type RoomStreamHandle = {
  /** Background: close the wire and the timers, keep the resume state. */
  pause(): void;
  /** Foreground: dial again from where this session left off. */
  resume(): void;
  /** The queue just sent this seq: the stream must not deliver it twice. */
  markDelivered(seq: number): void;
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
  let cycling = false;
  let wire: RoomEventsWire | null = null;
  let dial: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setInterval> | null = null;
  let attempt = 0;
  let needsResync = false;
  let resyncStreak = 0;
  /** The next open's info is already the resync's; it needs no refetch. */
  let infoFresh = false;
  let everConnected = false;
  let lastByteAt = 0;
  let connectedSince: number | null = null;

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
    connectedSince = null;
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
   *  "removed" — mark, forget the epoch, tell the listener, stop. A
   *  doorless door whose iroh road is gone tells the listener why and
   *  comes back through the backoff (the module load retries, so the
   *  road can heal); anything else terminal stops silently: only the
   *  room's refusal has a verdict the listener must see. */
  const refuse = (error: RoomError): void => {
    if (error.code === "removed") {
      forgetRoomEpoch(roomLocalId);
      void markPairingRemoved(roomLocalId).catch(() => undefined);
      stop();
      emit({ type: "removed" });
      return;
    }
    if (error.code === "door_unusable" && error.message === IROH_MISSING_MESSAGE) {
      emit({ type: "door_unusable", message: error.message });
      scheduleReconnect();
      return;
    }
    stop();
  };

  const scheduleReconnect = (): void => {
    if (closed || paused || reconnectTimer !== null) return;
    const delay = backoffDelayMs(attempt);
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void cycle();
    }, delay);
  };

  /** A dead epoch or cursor: forget it (an epoch guard would refuse the
   *  refetch itself), drop any waiting timer, and come back through the
   *  backoff — a persistent409 must never hot-loop. */
  const beginResync = (): void => {
    needsResync = true;
    forgetRoomEpoch(roomLocalId);
    dropWire();
    clearReconnect();
    scheduleReconnect();
  };

  const handleStatus = (outcome: Extract<RoomEventsOutcome, { kind: "status" }>): void => {
    const action = roomStreamStatusAction(outcome.status, outcome.body);
    if (action.kind === "removed") return refuse(action.error);
    if (action.kind === "stop") {
      stop();
      emit({ type: "error", code: action.code, message: action.message });
      return;
    }
    if (action.kind === "resync") {
      if (action.forgetEpoch) forgetRoomEpoch(roomLocalId);
      return beginResync();
    }
    // A retry: through the backoff, never hot — and any timer a previous
    // ending left behind is replaced, not raced.
    clearReconnect();
    scheduleReconnect();
  };

  /** §7's resync: one info and one history page rebuild the floor before
   *  the stream reopens — through the backoff, counted, and stopped
   *  after MAX_CONSECUTIVE_RESYNC fruitless rounds. False = something
   *  else already decided what happens next. */
  const runResync = async (gen: number): Promise<boolean> => {
    const outcome = await refetchResync(roomLocalId);
    if (!ready(gen)) return false;
    if (outcome.kind === "refused") {
      refuse(outcome.error);
      return false;
    }
    if (outcome.kind === "retry") {
      // needsResync stands: the next round redoes both fetches.
      scheduleReconnect();
      return false;
    }
    resyncStreak += 1;
    if (resyncStreak >= MAX_CONSECUTIVE_RESYNC) {
      stop();
      emit({
        type: "error",
        code: "resync_failed",
        message: `The room could not be resynced after ${MAX_CONSECUTIVE_RESYNC} attempts.`,
      });
      return false;
    }
    needsResync = false;
    // Every resync trigger invalidates the old floor — a dead epoch's
    // seqs or a cursor that claimed past the end — so the page's own
    // newest seq is the only thing worth resuming after.
    frames.setFloor(outcome.value.history.messages);
    infoFresh = true;
    emit({ type: "resynced", info: outcome.value.info, history: outcome.value.history });
    return true;
  };

  /** The reconnect's one info call (§7) — the stream stands even if the
   *  refetch fails; only the room's refusal stops it. */
  const refreshInfo = async (gen: number): Promise<void> => {
    const outcome = await refetchInfo(roomLocalId);
    if (!ready(gen)) return;
    if (outcome.kind === "refused") {
      refuse(outcome.error);
      return;
    }
    if (outcome.kind === "done") emit({ type: "refetched", info: outcome.value });
  };

  const handlersFor = (gen: number): RoomEventsHandlers => ({
    onActivity: () => {
      if (ready(gen)) lastByteAt = Date.now();
    },
    onWire: (opened) => {
      if (!ready(gen)) return;
      wire = opened;
      lastByteAt = Date.now();
    },
    onOpen: (epochHeader) => {
      if (!ready(gen)) return;
      connectedSince = Date.now();
      lastByteAt = Date.now();
      // A reconnect starts the partial answer over: whatever survives, the
      // first ai_status and the next ai_message will say (§7).
      frames.discardAssembly();
      const cached = cachedRoomEpoch(roomLocalId);
      if (epochHeader !== null) {
        if (cached !== null && cached !== epochHeader) return beginResync();
        noteRoomEpoch(roomLocalId, epochHeader);
      }
      if (everConnected && !infoFresh) void refreshInfo(gen);
      infoFresh = false;
      everConnected = true;
      // The room answers again — whatever waited out the outage posts now.
      void flushRoomQueue(roomLocalId);
    },
    onMessage: (message) => {
      if (!ready(gen)) return;
      const verdict = frames.dispatch(message);
      if (verdict.kind === "event") {
        if (verdict.event.type === "message" || verdict.event.type === "ai_message") {
          // A delivered entry is the health that earns a fresh backoff,
          // and it ends any run of fruitless resyncs.
          attempt = 0;
          resyncStreak = 0;
        }
        emit(verdict.event);
      } else if (verdict.kind === "epoch_died") {
        beginResync();
      }
    },
    onDone: (outcome) => {
      if (!ready(gen)) return;
      wire = null;
      connectedSince = null;
      if (outcome.kind === "status") return handleStatus(outcome);
      // The open wire ended — the door cut it or the transport failed.
      emit({ type: "disconnected" });
      scheduleReconnect();
    },
  });

  const cycle = async (): Promise<void> => {
    if (cycling || closed || paused) return;
    cycling = true;
    try {
      const gen = ++generation;
      dial = new AbortController();
      if (needsResync && !(await runResync(gen))) return;
      if (!ready(gen)) return;
      const resolved = await roomDoorForCall(roomLocalId);
      if (!ready(gen)) return;
      if (!resolved.ok) return refuse(resolved.error);
      const opened = await openRoomEvents(
        {
          door: resolved.value.door,
          base: resolved.value.base,
          token: resolved.value.token,
          lastSeq: frames.resumeFrom(),
          epoch: cachedRoomEpoch(roomLocalId),
          signal: dial.signal,
        },
        handlersFor(gen),
      );
      if (!ready(gen)) opened.close();
    } catch (error) {
      // A store the user must repair, not a network the next dial can win:
      // retrying would read a known-damaged map every backoff window.
      if (isPairingStoreDamaged(error)) {
        stop();
      } else if (!closed && !paused) {
        scheduleReconnect();
      }
    } finally {
      cycling = false;
    }
  };

  const startIdleWatch = (): void => {
    if (idleTimer !== null) return;
    idleTimer = setInterval(() => {
      if (closed || paused) return;
      if (wire !== null && connectedSince !== null && Date.now() - connectedSince >= HEALTHY_STREAM_MS) {
        connectedSince = null;
        attempt = 0; // up this long: the next cut restarts the backoff
      }
      if (wire === null) return;
      if (Date.now() - lastByteAt <= PING_TIMEOUT_MS) return;
      // Nothing — ping included — for twice the door's interval: dead.
      dropWire();
      emit({ type: "disconnected" });
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
    markDelivered: (seq) => frames.markDelivered(seq),
    close: stop,
  };
}
