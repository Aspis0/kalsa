import { useEffect, useRef, useState } from "react";
import { SUCCESS_HOLD_MS } from "./motion";

// What the beat needs from a device record: identity and the wait. The
// page's fuller records satisfy it structurally.
interface BeatDevice {
  id: number;
  waiting?: boolean;
}

/** The beat a row plays when the owner's Allow lands: which row is saying
    "connected" right now, and the bookkeeping that starts and ends it. */
export function useDeviceBeats(devices: BeatDevice[] | undefined) {
  const [connectedId, setConnectedId] = useState<number | null>(null);
  // The Allows this page pressed: from the record the command acts on to
  // the row the owner saw it on — the same id, except a pairing-again
  // request, whose Allow acts on the request while the row that stays is
  // its seat.
  const pending = useRef(new Map<number, number>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef(true);

  // A page that goes away mid-beat leaves nothing behind.
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    const house = Array.isArray(devices) ? devices : [];
    if (pending.current.size === 0) return;
    const current = new Map(house.map((device) => [device.id, device]));
    for (const [actedId, rowId] of [...pending.current]) {
      const after = current.get(actedId);
      // Still waiting: the store has not answered the Allow yet. A record
      // gone — or standing allowed — is the answer, and the beat lands on
      // the row the owner saw; a row that left with it shows nothing.
      if (after && after.waiting === true) continue;
      pending.current.delete(actedId);
      if (timer.current !== null) clearTimeout(timer.current);
      setConnectedId(rowId);
      timer.current = setTimeout(() => {
        timer.current = null;
        if (live.current) setConnectedId(null);
      }, SUCCESS_HOLD_MS);
    }
  }, [devices]);

  return {
    connectedId,
    /** Remember an Allow this page pressed, before its answer can land. */
    expect: (actedId: number, rowId: number) => {
      pending.current.set(actedId, rowId);
    },
    /** The command refused: nothing is going to land. */
    revoke: (actedId: number) => {
      pending.current.delete(actedId);
    },
  };
}
