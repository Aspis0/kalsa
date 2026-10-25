import { currentCards, pendingOutcomes, takeOutcomes } from "./confirm";
import type { Outcome } from "./confirm";
import { fence } from "../pageFence";
import type { Recap, RecapWords } from "./recap";
import { recapLine, recapOf } from "./recap";
import type { ToolRun } from "../types";

/**
 * What one conversation's last browser turn did, and what the model is told of
 * it on its next turn.
 *
 * **Two readers of one record.** The person reads it as a line at the end of the
 * turn that ran the calls; the model reads the same line on its next turn, when
 * the answers are in. They are the same words out of the same counts — a second
 * account of the turn would be one more thing that can disagree with the first.
 *
 * **Nothing here waits.** The person is slower than any tool deadline, so a
 * turn that blocked to be told would hang the chat for minutes behind a button.
 */

/** The runs of the turn that has just ended, waiting for the model. */
const ran = new Map<string, ToolRun[]>();

/** What became of a request since the window last drew a line about one. The
    model is told first and drains the queue `confirm.ts` keeps, so the answers
    are re-filed here for the person — who was not in the room for that note. */
const since = new Map<string, Outcome[]>();

/** What one turn ran, kept for the note its next turn reads. */
export function sayRuns(conversation: string, runs: ToolRun[]): void {
  if (conversation === "") return;
  ran.set(conversation, runs);
}

/**
 * What one turn did, for the line the window draws when it ends — **`null`
 * when it has nothing to say**.
 *
 * Built from this turn's runs, what is still waiting, and every request that
 * has become of something since the last line was drawn: the ones the model
 * was just told and the ones still to be. A send the owner was told about
 * once and never saw on screen is a send they cannot account for.
 */
export function closeRecap(conversation: string, runs: ToolRun[]): Recap | null {
  const waiting = currentCards().filter((card) => card.conversation === conversation).length;
  const recap = recapOf(runs, [...(since.get(conversation) ?? []), ...pendingOutcomes(conversation)], waiting);
  since.delete(conversation);
  return recap;
}

/**
 * The note the model reads at the start of its next turn.
 *
 * **Built then, from the record as it is then.** The line drawn at the end of
 * the last turn said what was true at the end of it — a request that was
 * waiting then may have been answered since, and a note that still said it was
 * waiting would be teaching the model a state the owner has already left. So
 * the facts are read here: the last turn's runs, the answers drained now, and
 * the cards on the window as it stands.
 *
 * **Fenced, because it names a host.** Everything else the model reads off a
 * page arrives between markers that say the words are not instructions, and a
 * note that could speak outside them would be the one place a stranger's own
 * name reaches the model unguarded.
 */
export function takeNote(conversation: string, t: RecapWords): string {
  if (conversation === "") return "";
  const runs = ran.get(conversation) ?? [];
  ran.delete(conversation);
  // **Read before the drain, not after it.** Draining is what lets the window
  // drop the line it drew for an answered card, and a card that is no longer
  // being answered reads as one still waiting — so the count taken afterwards
  // would name as waiting the very requests this note is reporting on.
  const waiting = currentCards().filter((card) => card.conversation === conversation).length;
  const outcomes = takeOutcomes(conversation);
  since.set(conversation, [...(since.get(conversation) ?? []), ...outcomes]);
  const recap = recapOf(runs, outcomes, waiting);
  return recap === null ? "" : fence(recapLine(recap, t));
}
