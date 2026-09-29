import { useEffect, useRef, useState } from "react";
import { FOLD_MS, SUCCESS_HOLD_MS } from "./motion";

// What the beat needs from a device record: identity and the wait. The
// page's fuller records satisfy it structurally.
interface BeatDevice {
  id: number;
  waiting?: boolean;
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
  // The Refuses this page pressed. The same poll answer shape resolves
  // both — the record leaves — so the beat keys on which button was
  // pressed, never on the leaving alone.
  const refuses = useRef(new Set<number>());
  const previous = useRef<BeatDevice[] | null>(null);
  // One hold per row: two Allows in one poll are two beats, not one.
  const holds = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  // The unfold's own clock: once it has played, the entering state is gone
  // and the row's other classes (the breath) take over.
  const enteringTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef(true);

  // A page that goes away mid-beat leaves nothing behind.
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      for (const hold of holds.current.values()) clearTimeout(hold);
      holds.current.clear();
      if (enteringTimer.current !== null) clearTimeout(enteringTimer.current);
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
        // stays — and only while that seat is still drawn.
        if (current.has(rowId)) land(rowId);
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
        setEnteringIds(new Set(entering));
        // The entrance is a beat, not a state: once it has played the row
        // is an ordinary waiting row, and the classes it no longer wears
        // stop deferring to it.
        if (enteringTimer.current !== null) clearTimeout(enteringTimer.current);
        enteringTimer.current = setTimeout(() => {
          enteringTimer.current = null;
          if (live.current) setEnteringIds(() => new Set());
        }, FOLD_MS);
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
    }, SUCCESS_HOLD_MS);
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
