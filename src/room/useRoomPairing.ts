/**
 * Which computer the Room may open: the newest pairing this phone still
 * holds and the room has not refused — AND that answers, right now. The map
 * is written in pairing order (the last record is the newest; it keeps no
 * last-used stamp), so "the newest pairing" is the closest thing to "most
 * recently used" that exists. No picker in v1: one Room entry, one computer.
 *
 * The answer is asked for when the menu is OPEN (a closed menu asks nothing:
 * no timer, no probe) and re-asked whenever it can change: a pairing
 * completing, and a room refusing one (a stale pairing must leave the menu,
 * and a computer that is off or no longer knows this phone must not offer a
 * room at all).
 */
import { useEffect, useState } from "react";
import { subscribePairingCompleted } from "../pairing/pairingCompletedAt";
import {
  listPairings,
  subscribePairingRemoved,
} from "../pairing/pairingCredentialStore";
import type { PairingRecord } from "../pairing/pairingRecord";
import { fetchRoomInfo } from "./roomApi";

/** How long the entry's reachability check may take: the menu's own
 *  question, not a chat turn's. */
const ENTRY_PROBE_TIMEOUT_MS = 4_000;

/** The record a room may open: the newest one a 401 has not retired. */
export function pickRoomPairing(records: readonly PairingRecord[]): PairingRecord | null {
  for (let at = records.length - 1; at >= 0; at -= 1) {
    if (records[at].removed !== true) return records[at];
  }
  return null;
}

/** The usable pairing, or null while there is none to offer. A store that
 *  cannot be read holds no room: the entry stays hidden. */
export function useRoomPairing(open: boolean): { localId: string | null } {
  const [localId, setLocalId] = useState<string | null>(null);
  useEffect(() => {
    // Nobody can see the answer while the menu is closed: nothing is asked.
    if (!open) return;
    // The reads and both subscriptions share one lifetime flag: nothing this
    // hook started may set state after it left.
    let live = true;
    const ask = (): void => {
      const probe = new AbortController();
      const timer = setTimeout(() => probe.abort(), ENTRY_PROBE_TIMEOUT_MS);
      void (async () => {
        try {
          const chosen = pickRoomPairing(await listPairings());
          if (!live) return;
          if (chosen === null) {
            setLocalId(null);
            return;
          }
          // The room must answer before its door is offered: one info call
          // is the probe — the same route the screen opens with — and a 401
          // marks the record removed on the way (roomApi's own path), which
          // re-asks this question with a shorter list of computers.
          const info = await fetchRoomInfo({
            roomLocalId: chosen.localId,
            signal: probe.signal,
          });
          if (live) setLocalId(info.ok ? chosen.localId : null);
        } catch {
          // A keystore read that fails, or a probe that could not dial: no
          // room is offered, and the next open asks again.
          if (live) setLocalId(null);
        } finally {
          clearTimeout(timer);
        }
      })();
    };
    ask();
    const leaveCompleted = subscribePairingCompleted(ask);
    const leaveRemoved = subscribePairingRemoved(ask);
    return () => {
      live = false;
      leaveCompleted();
      leaveRemoved();
    };
  }, [open]);
  return { localId };
}
