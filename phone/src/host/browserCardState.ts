/**
 * What the messages of a conversation know about its browser cards: two
 * whole-list rewrites, both pure, both returning the SAME array when nothing
 * changed — the transcript's rows are memoized, and a new array would redraw
 * every row for a strip that touched nothing.
 *
 * Both walk **every** message, not just the one being streamed to. A queued
 * outcome is handed over at the start of this phone's next turn (§3.1), long
 * after the turn that raised the card closed, so the card it belongs to is
 * sitting on an older answer.
 */
import {
  isBrowserCardExpired,
  stripCardValues,
  type BrowserOutcome,
} from "../domain/browserCardPayload";
import type { Message } from "./hostMessage";

/** A card nobody may answer any more gives its values back (§6). */
export function spentBrowserCards(prev: Message[], cardId: string): Message[] {
  return rewriteCards(prev, cardId, (entry) => ({
    ...entry,
    card: stripCardValues(entry.card),
  }));
}

/** An outcome lands on the card it names, wherever that card is drawn. A card
 *  id this conversation is not drawing is ignored: the queue is per phone, and
 *  an id the phone does not hold is nothing it can close. */
export function applyBrowserOutcome(
  prev: Message[],
  cardId: string,
  outcome: BrowserOutcome,
): Message[] {
  return rewriteCards(prev, cardId, (entry) => ({
    ...entry,
    card: stripCardValues(entry.card),
    outcome,
  }));
}

/** Every card whose budget is spent, across every message, whatever is drawn.
 *
 *  A card that has run out of time must lose its values **whether or not
 *  anyone is looking at it**: the transcript virtualizes, so a card scrolled
 *  out of view is unmounted, and an unmounted card's timer is not running.
 *  Deriving expiry at render is what the CARD does with its own budget; this
 *  is what the conversation does with the ones it is holding. Same clock, same
 *  verdict, so the two can never disagree about whether a card is still live.
 */
export function expireBrowserCards(prev: Message[], nowMs: number): Message[] {
  let changed = false;
  const next = prev.map((message) => {
    const cards = message.browserCards;
    if (!cards) return message;
    let touched = false;
    const swept = cards.map((entry) => {
      // Identity, not equality: `stripCardValues` hands back the SAME card
      // when there is nothing left to take. Without that, a spent card would
      // rebuild its message on every tick for the rest of the conversation —
      // the sweep would redraw the transcript once a second, forever.
      if (!isBrowserCardExpired(entry.card, nowMs)) return entry;
      const card = stripCardValues(entry.card);
      if (card === entry.card) return entry;
      touched = true;
      return { ...entry, card };
    });
    if (!touched) return message;
    changed = true;
    return { ...message, browserCards: swept };
  });
  return changed ? next : prev;
}

function rewriteCards(
  prev: Message[],
  cardId: string,
  rewrite: (entry: NonNullable<Message["browserCards"]>[number]) => NonNullable<
    Message["browserCards"]
  >[number],
): Message[] {
  let changed = false;
  const next = prev.map((message) => {
    const cards = message.browserCards;
    if (!cards?.some((entry) => entry.card.cardId === cardId)) return message;
    changed = true;
    return {
      ...message,
      browserCards: cards.map((entry) =>
        entry.card.cardId === cardId ? rewrite(entry) : entry,
      ),
    };
  });
  return changed ? next : prev;
}