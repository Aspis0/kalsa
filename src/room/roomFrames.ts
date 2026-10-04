/**
 * §7's live frames, folded into the feed: a member's join, rename or leave,
 * the AI's turn view with the partial answer, and the endings — the
 * reconnect's own info, a resync's new floor, the room's refusal, a cut
 * wire, a door with no road, a terminal stop. Wire in, feed out; the
 * numbered entries and the reads live with the feed itself.
 */
import type { RoomStreamEvent } from "./roomStream";
import {
  foldEntry,
  foldInfo,
  foldResync,
  resolveNames,
  wake,
  type RoomFeed,
} from "./roomFeed";
import type { RoomAiStatus, RoomMemberEvent } from "./roomWire";

/** A turn that ended for any reason: no half answer survives it (§7). */
const TERMINAL_AI_STATES = new Set(["done", "refused", "cancelled", "stopped"]);

/** A member joined, left or was renamed: the member list follows, and the
 *  rows already held are re-resolved — a rename rewrites their names, a
 *  leave marks them former (the room resolves names at read time). */
function foldMember(feed: RoomFeed, event: RoomMemberEvent): RoomFeed {
  const base = wake(feed);
  const info = base.info;
  if (info === null) return base;
  if (event.action === "left") {
    const members = info.members.filter((member) => member.memberId !== event.memberId);
    return { ...base, info: { ...info, members }, entries: resolveNames(base.entries, members) };
  }
  const name = event.name;
  if (name === null) return base;
  if (event.action === "joined") {
    if (info.members.some((member) => member.memberId === event.memberId)) return base;
    const members = [...info.members, { memberId: event.memberId, name, kind: "phone" as const }];
    return { ...base, info: { ...info, members }, entries: resolveNames(base.entries, members) };
  }
  const members = info.members.map((member) =>
    member.memberId === event.memberId ? { ...member, name } : member,
  );
  return { ...base, info: { ...info, members }, entries: resolveNames(base.entries, members) };
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
