/**
 * Frames in, typed events out: parses one SSE frame, checks the epoch a
 * numbered entry belongs to, and keeps the seq floor the resume claims —
 * the dedupe that lets replay and history pages overlap without ever
 * delivering a second copy. It touches no wire and sets no timer.
 */
import { cachedRoomEpoch, noteRoomEpoch } from "./roomEpochs";
import type { SseMessage } from "./sseParser";
import {
  parseRoomAiDelta,
  parseRoomAiStatus,
  parseRoomHistoryEntry,
  parseRoomMemberEvent,
  type RoomAiDelta,
  type RoomAiStatus,
  type RoomHistoryMessage,
  type RoomMemberEvent,
} from "./roomWire";

/** The events a frame can carry; the lifecycle's own events live with
 *  the session that emits them. */
export type RoomFrameEvent =
  /** A member's entry, in seq order, at most once within the epoch. */
  | { type: "message"; entry: RoomHistoryMessage }
  /** The AI's finished answer — same shape, its own event name (§7). */
  | { type: "ai_message"; entry: RoomHistoryMessage }
  | { type: "member"; member: RoomMemberEvent }
  | { type: "ai_status"; status: RoomAiStatus }
  /** One chunk, with the turn's assembly so far — the text a viewer
   *  renders until ai_message replaces it with the final answer (§7). */
  | { type: "ai_delta"; delta: RoomAiDelta; assembled: string };

export type FrameVerdict =
  | { kind: "event"; event: RoomFrameEvent }
  /** A duplicate seq, an unparseable payload, or a name this client does
   *  not know yet (§1: unknown fields — and events — are outgrown, not
   *  fatal). */
  | { kind: "skip" }
  /** A numbered entry from an epoch this client is not in: a recovery
   *  ran, and the session must drop the wire and resync (§7). */
  | { kind: "epoch_died" };

export type RoomFrameDispatch = {
  dispatch(message: SseMessage): FrameVerdict;
  /** The seq the next connection resumes after (0 = nothing seen yet). */
  resumeFrom(): number;
  /** The history page's floor: every seq at or below it is a duplicate
   *  the replay would hand back anyway. */
  setFloor(messages: readonly RoomHistoryMessage[]): void;
  /** The queue sent this seq itself: skip ITS copy when the stream
   *  carries it — without ever moving the resume floor, which may only
   *  advance on entries this stream actually delivered. */
  markDelivered(seq: number): void;
  /** Drop the partial answer: a reconnect or resync starts the
   *  assembly over — whatever survives, the next ai_status and
   *  ai_message will say (§7). */
  discardAssembly(): void;
};

export function createRoomFrameDispatch(roomLocalId: string): RoomFrameDispatch {
  let lastSeq = 0;
  /** Seqs this room's queue completed itself: their stream copies are
   *  shown once (the sent event), never again here. Bounded — an ack
   *  whose entry never comes is the first re-delivered, and it is a
   *  duplicate either way. */
  let ackedSeqs = new Set<number>();
  /** The one turn answering right now: chunk id → text so far. One turn
   *  streams at a time (§7), so a single slot is the whole assembly —
   *  a chunk from another turn starts it fresh, never appends. */
  let assembly: { turn: number | undefined; text: string } | null = null;

  const parseJson = (data: string): unknown => {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  };

  return {
    dispatch(message: SseMessage): FrameVerdict {
      if (message.event === "message" || message.event === "ai_message") {
        const entry = parseRoomHistoryEntry(parseJson(message.data));
        if (entry === null) return { kind: "skip" };
        const cached = cachedRoomEpoch(roomLocalId);
        if (cached !== null && entry.epoch !== cached) return { kind: "epoch_died" };
        if (cached === null) noteRoomEpoch(roomLocalId, entry.epoch);
        if (entry.seq <= lastSeq) return { kind: "skip" };
        if (ackedSeqs.has(entry.seq)) {
          // Our own post's copy: skipped exactly once — and the floor
          // moves only when the entry is the very next one, so an ack
          // heard BEFORE the entries before it can never blind the
          // resume past them (never skip past an undelivered seq).
          if (entry.seq === lastSeq + 1) {
            ackedSeqs.delete(entry.seq);
            lastSeq = entry.seq;
          }
          return { kind: "skip" };
        }
        lastSeq = entry.seq;
        // The final text replaces the assembly — for its turn, and for
        // any partial a stopped turn left behind (§7).
        if (message.event === "ai_message") assembly = null;
        return { kind: "event", event: { type: message.event, entry } };
      }
      if (message.event === "member") {
        const member = parseRoomMemberEvent(parseJson(message.data));
        return member === null ? { kind: "skip" } : { kind: "event", event: { type: "member", member } };
      }
      if (message.event === "ai_status") {
        const status = parseRoomAiStatus(parseJson(message.data));
        return status === null ? { kind: "skip" } : { kind: "event", event: { type: "ai_status", status } };
      }
      if (message.event === "ai_delta") {
        const delta = parseRoomAiDelta(parseJson(message.data));
        if (delta === null) return { kind: "skip" };
        if (assembly !== null && (delta.turn === undefined || assembly.turn === delta.turn)) {
          assembly = { turn: assembly.turn, text: assembly.text + delta.text };
        } else {
          assembly = { turn: delta.turn, text: delta.text };
        }
        return { kind: "event", event: { type: "ai_delta", delta, assembled: assembly.text } };
      }
      return { kind: "skip" };
    },
    resumeFrom: () => lastSeq,
    setFloor: (messages) => {
      // A resync's page REPLACES the floor: the old epoch's seqs, the
      // dead cursor, and that epoch's acks all go with them.
      ackedSeqs = new Set();
      lastSeq = messages.reduce((max, entry) => Math.max(max, entry.seq), 0);
    },
    markDelivered: (seq) => {
      // An ack is a promise about ONE entry, never about the gap before
      // it: record it, leave the resume floor exactly where it is.
      if (seq <= lastSeq) return;
      ackedSeqs.add(seq);
      if (ackedSeqs.size > 256) {
        const oldest = ackedSeqs.values().next().value;
        if (oldest !== undefined) ackedSeqs.delete(oldest);
      }
    },
    discardAssembly: () => {
      assembly = null;
    },
  };
}
