import { useEffect, useState } from "react";

import {
  currentCards,
  latestOutcome,
  subscribe,
  type Card,
  type Outcome,
} from "./confirm";
import { isOpen, isPaused, subscribe as watchWindow } from "./window";

/**
 * The window's view of what a person is being asked about, what became of it,
 * and whether there is a browser window to pause at all.
 *
 * Redraws on anything that changes it: a card arriving, a card answered, an
 * outcome, a pause, a window opening or closing. Nothing here polls — every
 * change is either an event from Rust or a change this app made itself, and the
 * stores it reads are the truth about both.
 *
 * **Only this conversation's cards are drawn.** The window is shared by every
 * chat, and a card is a question about one request in one of them: a button here
 * would be refused on the other side anyway, so drawing it would be offering
 * somebody a press that cannot work.
 *
 * **The window's own state is everybody's**, and comes from the other store: a
 * pause belongs to the browser, not to the chat whose turn raised the last card.
 */
export function useConfirm(conversation: string): {
  cards: Card[];
  outcome: Outcome | null;
  paused: boolean;
  windowOpen: boolean;
} {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const redraw = () => setVersion((was) => was + 1);
    const offCards = subscribe(redraw);
    const offWindow = watchWindow(redraw);
    return () => {
      offCards();
      offWindow();
    };
  }, []);
  // Referenced so the value is read on every redraw rather than captured once.
  void version;
  return {
    cards: currentCards().filter((card) => card.conversation === conversation),
    outcome: latestOutcome(conversation),
    paused: isPaused(),
    windowOpen: isOpen(),
  };
}