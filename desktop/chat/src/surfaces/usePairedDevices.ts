// The stored devices and nothing else, for a page that draws the house and
// needs no ceremony with it. The Phones page's reader (`usePairingRead`) polls
// `brain_pairing`, and that read is not free: every tick expires what is due,
// mints or retires a square, and detects a tailnet. Settings → Mail wants a
// list — which phone may read the mailbox — and asking through that read would
// refresh a square the owner never looked at, every two seconds, on a page
// whose whole subject is somebody else's phone.
//
// So this asks `brain_pairing_devices`: the same rows, with nothing behind
// them. It keeps the three states apart, because they are three different
// answers: `null` while the first read is in flight (nothing is drawn — an
// unanswered read is not a house with nobody in it), the list once it lands,
// and `unreadable` when it does not.

import { useCallback, useEffect, useRef, useState } from "react";
import { lastKnown } from "../lib/slotGate";
import { visibleInterval } from "../lib/pageVisible";
import { available, invoke } from "../lib/tauri";
import type { PairedDevice } from "./pairingWords";

// The poll this page runs while it is open, the Phones page's cadence: a
// phone may pair while the owner reads this list, and the row appears.
const POLL_MS = 2000;

export interface PairedDevices {
  /** Every stored device, in the store's order. Null until the first read
      answers, which is not the same as a store with nothing in it. */
  devices: PairedDevice[] | null;
  /** A read that was refused or threw. The last good list stays on screen
      behind it: the phones do not stop existing because a read failed. */
  unreadable: boolean;
  /** Moves one phone's switch on screen at once, before the store answers.
      A refused save puts it back through this same call. */
  applyMail: (id: number, allowed: boolean) => void;
}

export function usePairedDevices(): PairedDevices {
  // The last list this page knows. A read that rejects, or one that answers
  // nothing, leaves it standing: "I could not ask" is not "no phone is
  // paired".
  const [devices, setDevices] = useState<PairedDevice[] | null>(null);
  // The first read has settled either way, so the page is not saying
  // "checking" over a list that will never arrive.
  const [settled, setSettled] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  // One read at a time: a tick during a slow read is skipped, so two answers
  // cannot race, and `live` keeps a late reply off an unmounted page.
  const inFlight = useRef(false);
  const live = useRef(false);
  // How many of this page's own edits have been made. A read that began
  // before the last one answered a question the store had not been asked
  // yet, so its answer is older than what is on screen and is dropped: a
  // poll that landed mid-save would otherwise put the switch back the way it
  // was, under the owner's finger, as though the save had failed. The next
  // poll reads the store, which now says what the owner said.
  const edits = useRef(0);
  const refresh = useCallback(async (): Promise<void> => {
    if (!live.current || inFlight.current) return;
    inFlight.current = true;
    const mine = edits.current;
    // No Tauri here: nothing can be asked. Settling keeps the page from
    // waiting on a read that will never come.
    if (!available()) {
      inFlight.current = false;
      setSettled(true);
      return;
    }
    try {
      const found = await invoke<PairedDevice[] | null>("brain_pairing_devices");
      if (!live.current) return;
      if (mine !== edits.current) return;
      setDevices((previous) => lastKnown(previous, Array.isArray(found) ? found : []));
      setUnreadable(false);
    } catch {
      // The command rejected; what the page already knows stands. A refusal
      // is not a stale answer either: it says nothing about the list.
      if (live.current && mine === edits.current) setUnreadable(true);
    } finally {
      if (live.current) setSettled(true);
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    live.current = true;
    void refresh();
    const stopClock = visibleInterval(() => void refresh(), POLL_MS);
    return () => {
      live.current = false;
      stopClock();
    };
  }, [refresh]);

  const applyMail = useCallback((id: number, allowed: boolean): void => {
    edits.current += 1;
    setDevices((previous) =>
      previous === null
        ? previous
        : previous.map((device) => (device.id === id ? { ...device, mail: allowed } : device)),
    );
  }, []);

  return { devices: settled ? devices : null, unreadable: unreadable && settled, applyMail };
}