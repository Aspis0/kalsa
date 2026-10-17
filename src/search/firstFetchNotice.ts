/**
 * The notice before this install opens its FIRST web page.
 *
 * A search's recipient is a search provider the user can name and choose. A
 * fetch's recipient is the page's own site — whoever published it, reached
 * without the user naming or choosing anyone — so it needs its own notice, once
 * per install. It is not covered by the per-provider search consent: that names
 * Brave, this opens somebody's blog.
 *
 * Pure decision logic — the host owns the dialog and AsyncStorage is injected,
 * so the gate is testable without a UI and without a device. The asking
 * machinery — queue, cancellation, storage bound — is oneTimeConsent.ts, shared
 * with the search notice so the two cannot drift on the cancel guarantees.
 *
 * Fail CLOSED. A gate that cannot read its own stored state cannot claim the
 * user ever said yes, so the page is not opened.
 */
import {
  askOncePerInstall,
  type ConsentStorage,
  type ConsentVerdict,
} from "./oneTimeConsent";

/** Same AsyncStorage pattern as the other one-time choices. */
export const FETCH_CONSENT_KEY = "kalsa.fetch.consent.v1";

/** The format marker: a value without it is one this module never wrote, so it
 *  is not a consent. */
const FETCH_CONSENT_FORMAT = "v1";

/** One question, so one pending dialog. */
const FETCH_CONSENT_ID = "fetch";

/** Exactly what the gate wrote, and nothing else. */
export function parseFetchConsent(raw: string | null | undefined): boolean {
  return raw === FETCH_CONSENT_FORMAT;
}

/**
 * Resolve the consent for opening web pages on this install.
 *
 * `confirm` must resolve false on dismiss as well as on "Not now", and runs
 * with no focused button, so a stray Enter never opens a page. `signal` is the
 * turn's cancellation: a turn cancelled before or during its dialog resolves
 * "deny" and opens nothing. A failed write after "Open" still opens the page —
 * asking again next time is the honest outcome of a storage that is down.
 */
export async function confirmFetchConsent(args: {
  confirm: () => Promise<boolean>;
  signal?: AbortSignal;
  storage?: ConsentStorage;
}): Promise<ConsentVerdict> {
  return askOncePerInstall({
    questionId: FETCH_CONSENT_ID,
    storageKey: FETCH_CONSENT_KEY,
    isAccepted: parseFetchConsent,
    // The answer is the same on every later fetch, so nothing is merged into it.
    acceptedValue: () => FETCH_CONSENT_FORMAT,
    confirm: args.confirm,
    signal: args.signal,
    storage: args.storage,
  });
}