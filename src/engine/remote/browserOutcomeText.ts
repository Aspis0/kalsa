/**
 * What became of a held request, said in the phone's own words
 * (PHONE-CHAT-PROTOCOL §3.1).
 *
 * Two families and one rule: a code the contract does not name is never
 * echoed. A person reading a sentence has to be able to trust it, and a
 * sentence assembled out of whatever arrived is a sentence nobody wrote.
 *
 * The door's own codes (`remote_brain_*`) belong to `remoteBrainErrors`, and
 * this delegates them for the same reason `phoneChatFailures` does: an answer
 * can fail of the road and not of the card, and the phone must not say two
 * different things about one dead door.
 */
import type { TranslationKey } from "../../i18n";
import { humanRemoteBrainError } from "./remoteBrainErrors";

type Translate = (key: TranslationKey, vars?: Record<string, string>) => string;

const OUTCOME_KEYS: Record<string, TranslationKey> = {
  // The request went, and to this bare host — the only line that names a place.
  sent: "chat.browser.sentTo",
  declined: "chat.browser.declined",
  expired: "chat.browser.expired",
  // The browser itself is gone: nothing was sent and nothing will be.
  gone: "chat.browser.gone",
  unsendable: "chat.browser.unsendable",
  // The card was spent and nobody can say what happened. **Never a retry.**
  unclear: "chat.browser.unclear",
};

const ANSWER_FAILURE_KEYS: Record<string, TranslationKey> = {
  // Spent by an earlier answer, another phone's, or never held at all.
  card_unknown: "chat.browser.failSpent",
  card_expired: "chat.browser.failExpired",
  busy: "chat.browser.failBusy",
  // The computer had no browser window left to take the answer — NOT an
  // unreachable computer: the door answered. Saying otherwise would send the
  // person looking for a network problem that never happened (§3.1).
  cancelled: "chat.browser.failCancelled",
  browser_unavailable: "chat.browser.failUnavailable",
  browser_unreadable: "chat.browser.failUnreadable",
};

function lookup(
  table: Record<string, TranslationKey>,
  code: string,
  fallback: TranslationKey,
): TranslationKey {
  // Own properties only: a code off the wire ("constructor") must not resolve
  // to an inherited member and leak into `t()`.
  return Object.prototype.hasOwnProperty.call(table, code) ? table[code] : fallback;
}

/** The fate of a card the person answered, or was told about. `host` is only
 *  ever the bare name that rode a `sent`, and it is the caller's to pass. */
export function humanBrowserOutcome(code: string, host: string, t: Translate): string {
  if (code.startsWith("remote_brain_")) return humanRemoteBrainError(code, t);
  const key = lookup(OUTCOME_KEYS, code, "chat.browser.unknown");
  return t(key, key === "chat.browser.sentTo" ? { to: host } : undefined);
}

/** An answer that did not reach the computer, or that the computer refused. */
export function humanBrowserAnswerFailure(code: string, t: Translate): string {
  if (code.startsWith("remote_brain_")) return humanRemoteBrainError(code, t);
  return t(lookup(ANSWER_FAILURE_KEYS, code, "chat.browser.failUncertain"));
}

/** Whether a refusal is proof that **nothing was sent**.
 *
 *  This is the one question a card must not get wrong in either direction: a
 *  dead road says nothing at all about a request that may already have been in
 *  the browser's hands, and telling a person "nothing was sent" when it was
 *  would have them buy the same thing twice.
 *
 *  §3.1 names what does prove it, and only two refusals qualify: the card's
 *  five minutes were up before the press, so nothing was ever given to the
 *  browser; and the card was not this phone's to answer, so this press spent
 *  nothing. A refusal to read the answer, a road that died mid-flight and a
 *  code nobody named are all silence, and silence is `failUncertain`. */
export function answerLeftNothingSent(code: string): boolean {
  return code === "card_expired" || code === "card_unknown";
}