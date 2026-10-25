import { useCallback, useEffect, useRef, useState } from "react";
import { lastKnown } from "../lib/slotGate";
import { visibleInterval } from "../lib/pageVisible";
import { available, invoke, PAIRING_ASK_BOUND_MS } from "../lib/tauri";
import type { InviteList } from "./InvitePanel";
import type { PairingState } from "./pairingWords";

// The poll this page runs while it is open. Read by the review bench,
// which waits its cadence out rather than guessing wall-clock numbers.
export const POLL_MS = 2000;

/** The Phones page's reads: `brain_pairing` and the invitations, polled
    while the page is open, one at a time. `folding` holds a read back while
    a row folds out, so the list it started from stays on screen. */
export function usePairingRead(folding: () => boolean) {
  // The last pairing answer this page knows. A read that rejects, or one
  // that answers nothing, leaves it standing: "I could not ask" is not
  // "there is no phone connected".
  const [state, setState] = useState<PairingState | null>(null);
  // The first read has settled — answered, rejected, or past the bound.
  // Until then the page is checking, which is not a failure.
  const [settled, setSettled] = useState(false);
  // The invitations as the last read heard them: the page's poll reads them
  // beside the pairing, and the panel below reports its own reads back
  // through `onList` so the two never disagree.
  const [invites, setInvites] = useState<InviteList | null>(null);
  // One read at a time: a poll tick during a slow read is skipped, so two
  // answers cannot race. The generation numbers each read, so a reply from a
  // read the bound already released is dropped instead of landing over a
  // newer answer, and `live` keeps a late reply off an unmounted page.
  const inFlight = useRef(false);
  const generation = useRef(0);
  const live = useRef(false);
  const refresh = useCallback(async (): Promise<void> => {
    // No read STARTS while a row folds — all this line claims. A read
    // already in flight when the fold began still finishes, and its answer
    // is dropped where it lands, for the same reason: a list that no longer
    // holds the folding row would cut the beat short.
    if (!live.current || inFlight.current || folding()) return;
    inFlight.current = true;
    const mine = ++generation.current;
    const stillMine = (): boolean => live.current && mine === generation.current;
    // No Tauri here: nothing can be asked. Settling keeps the page from
    // saying "checking" forever, and the failure below offers no Try again,
    // which could not work either.
    if (!available()) {
      inFlight.current = false;
      setSettled(true);
      return;
    }
    // A read that has not answered by the bound stops holding the lock, the
    // page stops waiting on it, and whatever it says later is no longer this
    // page's next answer.
    const bound = setTimeout(() => {
      if (!stillMine()) return;
      generation.current += 1;
      inFlight.current = false;
      setSettled(true);
    }, PAIRING_ASK_BOUND_MS);
    try {
      // The square first — the page's own checking state hangs on this
      // answer — then the invitations on the same tick, under the same
      // guards, so the two lists cannot race each other either. Each keeps
      // its own answer: one failing must not cost the other its read.
      try {
        const next = await invoke<PairingState | null>("brain_pairing");
        if (stillMine()) {
          // A fold under way holds its row: an answer that has already let
          // it go would drop the row mid-beat, so it is dropped instead and
          // the next poll takes it.
          if (!folding()) setState((previous) => lastKnown(previous, next));
          setSettled(true);
        }
      } catch {
        // The command rejected: what this page already knows stands.
        if (stillMine()) setSettled(true);
      }
      if (!stillMine()) return;
      try {
        const listed = await invoke<InviteList | null>("brain_invite_list");
        if (stillMine()) setInvites((previous) => lastKnown(previous, listed));
      } catch {
        // The list rejected: what this page already knows stands.
      }
    } finally {
      clearTimeout(bound);
      if (mine === generation.current) inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    live.current = true;
    void refresh();
    // `brain_pairing` expires and refreshes the pairing square, so the hidden clock slows, never stops.
    const stopClock = visibleInterval(() => void refresh(), POLL_MS);
    return () => {
      live.current = false;
      stopClock();
    };
  }, [refresh]);

  // Whether the page is still mounted: a command's answer may land after it left.
  const mounted = useCallback(() => live.current, []);
  return { state, setState, settled, invites, setInvites, refresh, mounted };
}
