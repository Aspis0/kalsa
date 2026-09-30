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
  | { type: "ai_delta"; delta: RoomAiDelta };

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
};

export function createRoomFrameDispatch(roomLocalId: string): RoomFrameDispatch {
  let lastSeq = 0;

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
        lastSeq = entry.seq;
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
        return delta === null ? { kind: "skip" } : { kind: "event", event: { type: "ai_delta", delta } };
      }
      return { kind: "skip" };
    },
    resumeFrom: () => lastSeq,
    setFloor: (messages) => {
      lastSeq = messages.reduce((max, entry) => Math.max(max, entry.seq), 0);
    },
  };
}
