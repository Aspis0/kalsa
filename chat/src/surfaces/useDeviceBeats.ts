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
  const [enteringIds, setEnteringIds] = useState<ReadonlySet<number>>(() => new Set());
  // The Allows this page pressed: from the record the command acts on to
  // the row the owner saw it on — the same id, except a pairing-again
  // request, whose Allow acts on the request while the row that stays is
  // its seat.
  const pending = useRef(new Map<number, number>());
  const previous = useRef<BeatDevice[] | null>(null);
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
    // No answer yet is not an empty house: the baseline the beats diff
    // against is the first answer the page draws, never the page's own
    // opening blank.
    const house = Array.isArray(devices) ? devices : null;
    if (house === null) return;
    const before = previous.current;
    previous.current = house;
    // The first answer is the page's opening state, not a change: rows
    // that are there from it stand, they do not arrive.
    if (before !== null) {
      const seen = new Set(before.map((device) => device.id));
      const entering = house
        .filter((device) => device.waiting === true && !seen.has(device.id))
        .map((device) => device.id);
      if (entering.length > 0) setEnteringIds(new Set(entering));
    }
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
    /** The waiting records that appeared with the last answer — the rows
        that should unfold in instead of popping. */
    enteringIds,
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
