/**
 * Whether this phone holds a pairing it can still use: the ACTIVE record —
 * the one `getPairingCredential` returns, which is the record the Settings
 * "Where it responds" control and the remote engine's door both route through
 * — unless a room already refused it (`removed`, the 401 mark). Only then may
 * the pill offer a chooser.
 *
 * A store error says nothing about pairing, so the last answer stands (the
 * `paired` flag in Settings follows the same rule). A completed pairing
 * re-reads: the pairing screen runs over this chat, so a mount-time answer
 * would leave the new computer undiscoverable from the pill. A removal
 * landing mid-session has no event here — it is read again on the next
 * pairing or remount.
 */
import { useEffect, useState } from "react";
import { subscribePairingCompleted } from "../pairing/pairingCompletedAt";
import { getPairingCredential } from "../pairing/pairingCredentialStore";
import type { PairingRecord } from "../pairing/pairingRecord";

/** The usability rule, on a record the store already chose. */
export function usablePairing(record: PairingRecord | null): boolean {
  return record !== null && record.removed !== true;
}

export function useUsablePairing(): boolean {
  const [usable, setUsable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const read = () => {
      void getPairingCredential().then(
        (record) => {
          if (!cancelled) setUsable(usablePairing(record));
        },
        () => undefined,
      );
    };
    const unsubscribe = subscribePairingCompleted(read);
    read();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return usable;
}
