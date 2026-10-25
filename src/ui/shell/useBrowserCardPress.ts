/**
 * What a browser card knows while it waits to be answered (PHONE-CHAT-PROTOCOL
 * §3.1): its budget, the press that spends it, the copy held while the answer
 * travels, and the flags that say which secret the person chose to read.
 *
 * The drawing lives in `BrowserConfirmCard`; this owns the state the drawing
 * reads, so the card is a card and not a machine.
 */
import { useCallback, useEffect, useState } from "react";

import {
  isBrowserCardExpired,
  monotonicNowMs,
  type BrowserAnswer,
  type BrowserCard,
  type BrowserCardEntry,
} from "../../domain/browserCardPayload";
import type { BrowserAnswerVerb } from "../../engine/remote/browserApi";
import { useBrowserActions } from "./browserActions";

/** How often the budget is re-read, on the phone's own monotonic clock:
 *  the deadline is this phone's, counted down from the card's arrival. */
const TICK_MS = 1000;

/** What an answer that blew up looks like: the road died, and nothing can be
 *  said about whether the request reached the computer — the failure the answer
 *  route itself returns for a request that never got there. */
const ROAD_FAILURE: BrowserAnswer = { ok: false, errorCode: "remote_brain_network" };

/** The card as it was the moment it was pressed: the destination and the fields
 *  it drew, kept only until the answer comes back. */
export type FrozenCard = {
  destination: BrowserCard["destination"];
  fields: BrowserCard["fields"];
};

/** What the drawing reads: the card's budget, its answer, the copy held while
 *  the answer travels, and the two things a person can do with it. */
export type BrowserCardPress = {
  expired: boolean;
  settled: boolean;
  live: boolean;
  pressed: boolean;
  /** Whether this phone can reach the computer at all: without it the card
   *  draws its words and offers no button. */
  reachable: boolean;
  answer: BrowserAnswer | null;
  now: number;
  frozen: FrozenCard | null;
  shown: ReadonlySet<string>;
  toggle: (key: string) => void;
  press: (verb: BrowserAnswerVerb) => void;
};

export function useBrowserCardPress(entry: BrowserCardEntry): BrowserCardPress {
  const { card, outcome } = entry;
  const browser = useBrowserActions();
  const [now, setNow] = useState(monotonicNowMs);
  const [frozen, setFrozen] = useState<FrozenCard | null>(null);
  const [answer, setAnswer] = useState<BrowserAnswer | null>(null);
  /** One flag per secret field: what the person has chosen to look at, held here
   *  and nowhere else. */
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set());

  const expired = isBrowserCardExpired(card, now);
  // An absent outcome is not an outcome: a card nobody answered is still open,
  // and `!== null` against `undefined` would call every card spent on arrival.
  const settled = answer !== null || outcome !== undefined;
  const live = !expired && !settled;
  /** A pressed card is one whose answer is on the road: it cannot be pressed
   *  again, and it keeps drawing its card until it settles. */
  const pressed = frozen !== null;

  /** Every way a card stops being answerable ends here. §6 is about the value
   *  GOING, not about a card that keeps it and draws dots — so the message is
   *  told, and the message drops it. Idempotent at both ends, so a press, an
   *  outcome and a deadline landing together strip once. */
  const spend = useCallback(() => {
    browser?.spentBrowserCard(card.cardId);
  }, [browser, card.cardId]);

  // An outcome settles the card from under us, with no press of ours.
  useEffect(() => {
    if (settled) spend();
  }, [settled, spend]);

  // The deadline passes while the card is drawn, and nobody presses anything.
  useEffect(() => {
    if (expired) spend();
  }, [expired, spend]);

  // The deadline passes while the card is drawn, so the card watches it — and
  // stops watching the moment nobody can answer, because a timer that outlives
  // the question is a timer keeping a stranger's value alive for nothing.
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(monotonicNowMs()), TICK_MS);
    return () => clearInterval(timer);
  }, [live, card.cardId]);

  // Expired or answered: the values go, and the flags with them (§6).
  useEffect(() => {
    if (live || shown.size === 0) return;
    setShown(new Set());
  }, [live, shown.size]);

  // The backstop for the paths where no answer of ours ever comes: a card that
  // expires or is settled from under us drops its frozen copy (§6).
  useEffect(() => {
    if (live) return;
    setFrozen(null);
  }, [live]);

  const toggle = useCallback((key: string) => {
    setShown((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const press = useCallback(
    async (verb: BrowserAnswerVerb) => {
      // Re-checked at the press and not only on the tick: a card that expired
      // between two renders must not put a request on the road.
      // No host, no send: a card with no destination can be declined and never sent (§3.1).
      // No host, no press: the buttons are not drawn at all (see browserActions).
      const sendable = verb === "decline" || card.destination !== null;
      if (browser === null || !sendable || pressed || isBrowserCardExpired(card, monotonicNowMs())) return;
      // Frozen before the spend: the strip takes the host and the values back at
      // once, and the card must not blink while its answer travels.
      setFrozen({ destination: card.destination, fields: card.fields });
      // A revealed value stops being readable the moment the card is spent.
      setShown(new Set());
      // Spent before the answer is even asked: the card is the one thing that
      // knows nobody may answer this any more.
      spend();
      const answer = await browser.answerCard(card.cardId, verb).catch(() => ROAD_FAILURE);
      // The answer is in: the frozen copy goes now, not one render later.
      setAnswer(answer);
      setFrozen(null);
    },
    [browser, card, pressed, spend],
  );

  return {
    expired,
    settled,
    live,
    pressed,
    reachable: browser !== null,
    answer,
    now,
    frozen,
    shown,
    toggle,
    press,
  };
}
