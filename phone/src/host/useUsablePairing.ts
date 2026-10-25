/**
 * Whether this phone holds a pairing it can still use: the ACTIVE record —
 * the one `getPairingCredential` returns, which is the record the Settings
 * "Where it responds" control and the remote engine's door both route through
 * — unless a room already refused it (`removed`, the 401 mark). Only then may
 * the pill offer a chooser.
 *
 * A store error says nothing about pairing, so the last answer stands (the
 * `paired` flag in Settings follows the same rule). A completed pairing
 * re-reads; and a removal that lands mid-session — a 401 on the room stream —
 * has no event on this branch, so `refresh` re-reads on demand: the pill calls
 * it as it opens, and the rows are then the store's answer at that moment.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { subscribePairingCompleted } from "../pairing/pairingCompletedAt";
import { getPairingCredential } from "../pairing/pairingCredentialStore";
import type { PairingRecord } from "../pairing/pairingRecord";

/** The usability rule, on a record the store already chose. */
export function usablePairing(record: PairingRecord | null): boolean {
  return record !== null && record.removed !== true;
}

export function useUsablePairing(): {
  usable: boolean;
  /** Re-read the store now and publish the verdict before resolving. */
  refresh: () => Promise<void>;
} {
  const [usable, setUsable] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const read = useCallback(async () => {
    try {
      const record = await getPairingCredential();
      if (mountedRef.current) setUsable(usablePairing(record));
    } catch {
      // Unreadable says nothing about pairing: keep the last answer.
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribePairingCompleted(() => {
      void read();
    });
    void read();
    return unsubscribe;
  }, [read]);

  return { usable, refresh: read };
}
