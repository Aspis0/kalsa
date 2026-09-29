import { useEffect, useRef, useState } from "react";
import { BEAT_MS, FOLD_MS } from "./motion";

// What the beat needs from a device record: identity, the wait, and the
// seat a pairing-again request rides on. The page's fuller records
// satisfy it structurally.
interface BeatDevice {
  id: number;
  waiting?: boolean;
  pairing_again?: number | null;
}

/** The beat a row plays when the owner's Allow lands: which rows are saying
    "connected" right now, and the bookkeeping that starts and ends it. */
export function useDeviceBeats(devices: BeatDevice[] | undefined) {
  const [connected, setConnected] = useState<ReadonlySet<number>>(() => new Set());
  const [enteringIds, setEnteringIds] = useState<ReadonlySet<number>>(() => new Set());
  // The records this page has sent a decision for and is still waiting on
  // the store to answer: the row's buttons stay down until an answer makes
  // the outcome visible.
  const [decided, setDecided] = useState<ReadonlySet<number>>(() => new Set());
  // The Allows this page pressed: from the record the command acts on to
  // the row the owner saw it on — the same id, except a pairing-again
  // request, whose Allow acts on the request while the row that stays is
  // its seat.
  const allows = useRef(new Map<number, number>());
  // The Refuses this page pressed: they arm nothing, they only disarm. The
  // store's next answer may show the record gone either way — allowed,
  // refused, replaced — and the one fact this page holds is which button
  // the owner pressed.
  const refuses = useRef(new Set<number>());
  const previous = useRef<BeatDevice[] | null>(null);
  // One hold per row: two Allows in one poll are two beats, not one.
  const holds = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  // Each entrance keeps its own clock: one row arriving must not end
  // another's entrance, and a page that goes away leaves none behind.
  const enteringTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const live = useRef(true);

  // A page that goes away mid-beat leaves nothing behind.
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      for (const hold of holds.current.values()) clearTimeout(hold);
      holds.current.clear();
      for (const entrance of enteringTimers.current.values()) clearTimeout(entrance);
      enteringTimers.current.clear();
    };
  }, []);

  useEffect(() => {
    // No answer yet is not an empty house: the baseline the beats diff
    // against is the first answer the page draws, never the page's own
    // opening blank.
    const house = Array.isArray(devices) ? devices : null;
    if (house === null) return;
    const current = new Map(house.map((device) => [device.id, device]));
    const resolved: number[] = [];
    for (const [actedId, rowId] of [...allows.current]) {
      const after = current.get(actedId);
      if (after && after.waiting === true) continue; // the store has not answered
      allows.current.delete(actedId);
      resolved.push(actedId);
      if (actedId !== rowId) {
        // A pairing-again request, spent: the beat lands on the seat that
        // stays — only while that seat is still drawn AND nothing new is
        // asking on it. A replacement request is not an Allow's outcome:
        // the phone did not get in, someone asked again.
        const seatStillAsked = house.some(
          (device) => device.waiting === true && device.pairing_again === rowId,
        );
        if (current.has(rowId) && !seatStillAsked) land(rowId);
      } else if (after !== undefined) {
        // Allowed in place: the one answer that says the phone is in.
        land(rowId);
      }
      // A record that left is a refuse or a forget wearing the same shape;
      // no beat celebrates it.
    }
    for (const actedId of [...refuses.current]) {
      // The refuse's own answer is the record leaving; until then the
      // buttons stay down.
      if (!current.has(actedId)) {
        refuses.current.delete(actedId);
        resolved.push(actedId);
      }
    }
    if (resolved.length > 0) {
      setDecided((prior) => {
        const next = new Set(prior);
        for (const id of resolved) next.delete(id);
        return next;
      });
    }
    const before = previous.current;
    previous.current = house;
    // The first answer is the page's opening state, not a change: rows
    // that are there from it stand, they do not arrive.
    if (before !== null) {
      const seen = new Set(before.map((device) => device.id));
      const entering = house
        .filter((device) => device.waiting === true && !seen.has(device.id))
        .map((device) => device.id);
      if (entering.length > 0) {
        // The entrance is a beat, not a state: once it has played the row
        // is an ordinary waiting row, and the classes it no longer wears
        // stop deferring to it.
        setEnteringIds((prior) => {
          const next = new Set(prior);
          for (const id of entering) next.add(id);
          return next;
        });
        for (const id of entering) {
          if (enteringTimers.current.has(id)) continue;
          const entrance = setTimeout(() => {
            enteringTimers.current.delete(id);
            if (live.current) {
              setEnteringIds((prior) => {
                const next = new Set(prior);
                next.delete(id);
                return next;
              });
            }
          }, FOLD_MS);
          enteringTimers.current.set(id, entrance);
        }
      }
    }
  }, [devices]);

  function land(rowId: number): void {
    const standing = holds.current.get(rowId);
    if (standing !== undefined) clearTimeout(standing);
    setConnected((prior) => new Set(prior).add(rowId));
    const hold = setTimeout(() => {
      holds.current.delete(rowId);
      if (live.current) setConnected((prior) => {
        const next = new Set(prior);
        next.delete(rowId);
        return next;
      });
    }, BEAT_MS);
    holds.current.set(rowId, hold);
  }

  return {
    connected,
    enteringIds,
    decided,
    /** Remember an Allow this page pressed, before its answer can land. */
    expect: (actedId: number, rowId: number) => {
      allows.current.set(actedId, rowId);
      refuses.current.delete(actedId);
      setDecided((prior) => new Set(prior).add(actedId));
    },
    /** A Refuse this page pressed: its answer must never land a beat. */
    deny: (actedId: number) => {
      allows.current.delete(actedId);
      refuses.current.add(actedId);
      setDecided((prior) => new Set(prior).add(actedId));
    },
    /** The command refused: nothing is going to land. */
    revoke: (actedId: number) => {
      allows.current.delete(actedId);
      refuses.current.delete(actedId);
      setDecided((prior) => {
        const next = new Set(prior);
        next.delete(actedId);
        return next;
      });
    },
    /** A Forget takes the record — or the seat a pending Allow was going
        to land on — out with it. */
    revokeTouching: (id: number) => {
      const gone = [id];
      for (const [actedId, rowId] of [...allows.current]) {
        if (actedId === id || rowId === id) {
          allows.current.delete(actedId);
          gone.push(actedId);
        }
      }
      refuses.current.delete(id);
      setDecided((prior) => {
        const next = new Set(prior);
        for (const actedId of gone) next.delete(actedId);
        return next;
      });
    },
  };
}
