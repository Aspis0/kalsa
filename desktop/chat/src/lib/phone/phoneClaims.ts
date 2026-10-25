// The claims a phone's turns make on the page, and what became of the requests
// they raised.
//
// **A claim names the phone, the pairing it belongs to and the turn.** The
// browser calls of a turn are stamped with it, the release at the turn's end is
// stamped with it, and a card raised by that turn is stamped with it — so a
// turn's end lets go of the claim of that turn and of no other's, and a card of
// a turn that has ended is known to be a card of a turn that has ended.
//
// **The pairing is in it because a device id is reused.** The next phone paired
// under a forgotten phone's number is another phone, and it may neither take
// over the page the old one left claimed nor read it.
//
// What became of a request comes back under that claim, and the claim names a
// turn rather than a phone. The phone is what outlives the turn, and the note
// the model reads on the phone's next turn belongs to the phone — so the
// outcome is filed under the phone here, and the claim's own copy is dropped:
// an outcome is said once, to the one reader that has it.

import { noteAnswered, pendingOutcomes, takeOutcomes } from "../browser/confirm";
import { browserRelease } from "../tools/browserCall";

/**
 * The claims of the turns this page ran, and the phone each one belongs to.
 *
 * **Kept per phone, and bounded.** A phone is asked about eight cards at once
 * and no more, and every one of those is raised under its own turn's claim — so
 * nine claims is one more than a phone can ever have waiting, and the tenth is
 * a claim that could never be answered.
 */
const claims = new Map<string, string[]>();

const CLAIMS_PER_PHONE = 9;

/**
 * Remembers the claim of a turn this page ran, and the phone it belongs to.
 *
 * **Before the turn drives anything with it**, so the outcome of a card the
 * turn is about to raise has a claim to come back under — and so the outcome
 * of a card an earlier turn raised is filed under the phone that raised it.
 */
export function rememberStamp(conversation: string, stamp: string): void {
  if (conversation === "" || typeof stamp !== "string" || stamp === "") return;
  const mine = claims.get(conversation) ?? [];
  const kept = [...mine.filter((one) => one !== stamp), stamp];
  claims.set(conversation, kept.slice(-CLAIMS_PER_PHONE));
}

/**
 * Files what became of this phone's requests under the phone.
 *
 * **Nothing else is moved.** A desktop's outcomes are filed under a desktop
 * conversation and are read by the desktop, and a claim this page does not know
 * is not this phone's to move.
 */
export function fileUnderThePhone(conversation: string): void {
  for (const stamp of claims.get(conversation) ?? []) {
    // **A claim with nothing pending is left alone.** Draining it would tell the
    // window again, once per claim, for a turn that has nothing to say.
    if (pendingOutcomes(stamp).length === 0) continue;
    for (const outcome of takeOutcomes(stamp)) {
      noteAnswered({ conversation, code: outcome.code, host: outcome.host });
    }
  }
}

/**
 * Forgets the claims of a phone that is no longer paired.
 *
 * **Device ids are reused.** A phone paired again later under the same number is
 * another phone, and it must not inherit the old one's answers: what came back
 * under the old phone's claim is the old phone's to hear.
 *
 * **And the page the old phone left claimed goes with it.** The claim is the
 * turn's and the turn lets it go at its end — but a release that never came
 * would leave the page claimed by a phone that no longer exists, and the phone
 * paired again under that number has a claim of its own and may not take that
 * one over. So the claim is let go here, on the way out.
 */
export function forgetClaims(conversation: string): void {
  for (const stamp of claims.get(conversation) ?? []) {
    void browserRelease(stamp).catch(() => {});
  }
  claims.delete(conversation);
}
