/**
 * Which computer the Room opens: the newest pairing this phone still holds
 * and the room has not refused. The map is written in pairing order — the
 * last record is the newest, and the `active` pointer names it — and it
 * keeps no last-used stamp, so "the newest pairing" is the closest thing
 * to "most recently used" that exists. No picker in v1: one Room entry,
 * one computer; a phone holding several pairs with the newest.
 *
 * The answer is re-read whenever it can change: a pairing completing, and a
 * room refusing one (the drawer must stop offering a computer that already
 * answered 401).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { subscribePairingCompleted } from "../pairing/pairingCompletedAt";
import {
  listPairings,
  subscribePairingRemoved,
} from "../pairing/pairingCredentialStore";
import type { PairingRecord } from "../pairing/pairingRecord";

/** The record a room may open: the newest one a 401 has not retired. */
export function pickRoomPairing(records: readonly PairingRecord[]): PairingRecord | null {
  for (let at = records.length - 1; at >= 0; at -= 1) {
    if (records[at].removed !== true) return records[at];
  }
  return null;
}

/** The usable pairing. A store that cannot be read holds no room: the entry
 *  stays hidden. */
export function useRoomPairing(): { localId: string | null } {
  const [localId, setLocalId] = useState<string | null>(null);
  const live = useRef(true);
  const read = useCallback(() => {
    void listPairings()
      .then((records) => {
        if (live.current) setLocalId(pickRoomPairing(records)?.localId ?? null);
      })
      .catch(() => {
        if (live.current) setLocalId(null);
      });
  }, []);
  useEffect(() => {
    live.current = true;
    read();
    const leaveCompleted = subscribePairingCompleted(read);
    const leaveRemoved = subscribePairingRemoved(read);
    return () => {
      live.current = false;
      leaveCompleted();
      leaveRemoved();
    };
  }, [read]);
  return { localId };
}
