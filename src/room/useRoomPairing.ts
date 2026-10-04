/**
 * Which computer the Room opens: the newest pairing this phone still holds
 * and the room has not refused. The map is written in pairing order — the
 * last record is the newest, and the `active` pointer names it — and it
 * keeps no last-used stamp, so "the newest pairing" is the closest thing
 * to "most recently used" that exists. No picker in v1: one Room entry,
 * one computer; a phone holding several pairs with the newest.
 */
import { useEffect, useState } from "react";
import { subscribePairingCompleted } from "../pairing/pairingCompletedAt";
import { listPairings } from "../pairing/pairingCredentialStore";
import type { PairingRecord } from "../pairing/pairingRecord";

/** The record a room may open: the newest one a 401 has not retired. */
export function pickRoomPairing(records: readonly PairingRecord[]): PairingRecord | null {
  for (let at = records.length - 1; at >= 0; at -= 1) {
    if (records[at].removed !== true) return records[at];
  }
  return null;
}

/** The usable pairing, re-read when a pairing completes. A store that
 *  cannot be read holds no room: the entry stays hidden. */
export function useRoomPairing(): { localId: string | null } {
  const [localId, setLocalId] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const refresh = (): void => {
      void listPairings()
        .then((records) => {
          if (live) setLocalId(pickRoomPairing(records)?.localId ?? null);
        })
        .catch(() => {
          if (live) setLocalId(null);
        });
    };
    refresh();
    const leave = subscribePairingCompleted(refresh);
    return () => {
      live = false;
      leave();
    };
  }, []);
  return { localId };
}
