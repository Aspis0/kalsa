/**
 * The refetches a session owes: the reconnect's one info call (§7) and
 * resync's info+history pair, mapped to one verdict each — done, the
 * room said removed, or transient (the session's backoff decides). This
 * file touches no wire handle and no timer; the session turns verdicts
 * into actions.
 */
import { fetchRoomHistory, fetchRoomInfo } from "./roomApi";
import type { RoomError } from "./roomError";
import type { RoomHistoryPage, RoomInfo } from "./roomWire";

export type RefetchOutcome<T> =
  | { kind: "done"; value: T }
  | { kind: "refused"; error: RoomError }
  | { kind: "retry" };

/** §7's resync pair: info first (it names the epoch the history call
 *  then sends), the page second — it sets the floor. */
export async function refetchResync(
  roomLocalId: string,
): Promise<RefetchOutcome<{ info: RoomInfo; history: RoomHistoryPage }>> {
  const info = await fetchRoomInfo({ roomLocalId });
  if (!info.ok) {
    return info.error.code === "removed"
      ? { kind: "refused", error: info.error }
      : { kind: "retry" };
  }
  const history = await fetchRoomHistory({}, { roomLocalId });
  if (!history.ok) {
    return history.error.code === "removed"
      ? { kind: "refused", error: history.error }
      : { kind: "retry" };
  }
  return { kind: "done", value: { info: info.value, history: history.value } };
}

/** The reconnect's single info call; a transient failure is no verdict
 *  — the open stream stands, the next reconnect fetches again. */
export async function refetchInfo(roomLocalId: string): Promise<RefetchOutcome<RoomInfo>> {
  const info = await fetchRoomInfo({ roomLocalId });
  if (!info.ok) {
    return info.error.code === "removed"
      ? { kind: "refused", error: info.error }
      : { kind: "retry" };
  }
  return { kind: "done", value: info.value };
}
