import { useEffect, useState } from "react";

import {
  currentCards,
  isPaused,
  latestOutcome,
  setPaused as setPause,
  subscribe,
  type Card,
  type Outcome,
} from "./confirm";

/**
 * The window's view of what a person is being asked about, the Pausa control's
 * state, and what the last request they answered became of it.
 *
 * Redraws on anything that changes it: a card arriving, a card answered, an
 * outcome, a pause. Nothing here polls — every change is an event from Rust, and
 * the store it reads is the truth about what is waiting.
 *
 * **Only this conversation's cards are drawn.** The window is shared by every
 * chat, and a card is a question about one request in one of them: a button here
 * would be refused on the other side anyway, so drawing it would be offering
 * somebody a press that cannot work.
 */
export function useConfirm(conversation: string): {
  cards: Card[];
  outcome: Outcome | null;
  paused: boolean;
  setPaused: (next: boolean) => void;
} {
  const [version, setVersion] = useState(0);
  useEffect(() => subscribe(() => setVersion((was) => was + 1)), []);
  // Referenced so the value is read on every redraw rather than captured once.
  void version;
  return {
    cards: currentCards().filter((card) => card.conversation === conversation),
    outcome: latestOutcome(conversation),
    paused: isPaused(),
    setPaused: setPause,
  };
}