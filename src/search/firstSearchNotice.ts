/**
 * The notice before a phone web search sends the query to a provider it has
 * not been told about yet: what leaves the phone, and to whom. Pure decision
 * logic — the host owns the dialog and AsyncStorage is injected, so the gate
 * is testable without a UI and without a device.
 *
 * Consent is PER PROVIDER, not per install. The search has more than one
 * possible recipient: the active provider, and — when it fails — the free Exa
 * MCP fallback that searchWeb sends the query to. A user who agreed to send
 * queries to Brave has not agreed to send them to Exa, so each recipient is
 * named once, the first time this install sends a query to it.
 *
 * Fail CLOSED. A gate that cannot read its own stored state cannot claim the
 * user ever said yes, so the search does not run. Same for an unknown provider
 * name: the copy names the provider, and copy that cannot name who receives
 * the query is not a consent. Only the exact stored format counts — a value
 * this module cannot parse is a value this module never wrote, so it is not a
 * consent.
 *
 * The asking machinery — queue, cancellation, storage bound — belongs to
 * oneTimeConsent.ts and is shared with the fetch notice.
 *
 * Desk-mode chats that search from the PC are a different path and are out of
 * scope here: this gate guards the phone-local providers only.
 */
import { getStrings, type Locale } from "../i18n";
import { PROVIDERS, PROVIDER_IDS, type SearchProviderId } from "./registry";
import {
  askOncePerInstall,
  type ConsentStorage,
  type ConsentVerdict,
} from "./oneTimeConsent";

/** The accepted providers, one entry per install. Same AsyncStorage pattern as
 *  the other one-time choices (PROVIDER_STORAGE_KEY, GOVERNOR_ENABLED_KEY). */
export const SEARCH_CONSENT_KEY = "kalsa.search.consent.v1";

/** The format marker: anything without it is a value this module never wrote,
 *  and is therefore not read as consent. */
const CONSENT_FORMAT = "v1";

export type SearchConsentVerdict = ConsentVerdict;

/**
 * The name the notice shows, or null when the id names no registered provider.
 * A copy that cannot name who receives the query is not consent, so the caller
 * treats null as "unavailable".
 */
export function providerDisplayName(id: SearchProviderId | null | undefined): string | null {
  if (!id) return null;
  return PROVIDERS[id]?.name ?? null;
}

/** The providers this install has already been told about. Anything this
 *  module cannot parse yields the empty set: no provider is accepted. */
export function parseSearchConsent(raw: string | null | undefined): SearchProviderId[] {
  if (typeof raw !== "string") return [];
  const prefix = `${CONSENT_FORMAT}:`;
  if (!raw.startsWith(prefix)) return [];
  const accepted = raw
    .slice(prefix.length)
    .split(",")
    .filter((id) => (PROVIDER_IDS as string[]).includes(id));
  return accepted as SearchProviderId[];
}

/**
 * Resolve the consent for sending a query to `providerId` on this install.
 *
 * `confirm` must resolve false on dismiss as well as on "Not now", and runs
 * with no focused button, so a stray Enter never accepts the search. A failed
 * write after "Search" still runs the search; see askOncePerInstall for the
 * cancel and fail-closed guarantees it carries for both notices.
 */
export async function confirmSearchProvider(args: {
  locale: Locale;
  providerId: SearchProviderId;
  confirm: (providerName: string) => Promise<boolean>;
  signal?: AbortSignal;
  storage?: ConsentStorage;
}): Promise<SearchConsentVerdict> {
  const providerName = providerDisplayName(args.providerId);
  if (providerName === null) return "unavailable";
  return askOncePerInstall({
    questionId: args.providerId,
    storageKey: SEARCH_CONSENT_KEY,
    isAccepted: (stored) => parseSearchConsent(stored).includes(args.providerId),
    acceptedValue: (baseline) =>
      `${CONSENT_FORMAT}:${[...new Set([...parseSearchConsent(baseline), args.providerId])].join(",")}`,
    confirm: () => args.confirm(providerName),
    signal: args.signal,
    storage: args.storage,
  });
}

/**
 * The refusal for the PRIMARY provider: nothing was sent, so the model is told
 * the search did not run.
 */
export function searchConsentRefusalText(
  verdict: Exclude<SearchConsentVerdict, "allow">,
  locale: Locale,
): string {
  const notice = getStrings(locale).searchNotice;
  return verdict === "deny" ? notice.declined : notice.unavailable;
}

/**
 * The refusal for the FALLBACK provider. The primary request already went out
 * and failed, so "the search did not run" would be false: this names the
 * provider that received the query and the one it was not sent to. Both the
 * "Not now" answer and the fail-closed unreadable case use it, because the
 * user did not agree to the fallback either way.
 */
export function searchFallbackRefusalText(
  locale: Locale,
  primaryId: SearchProviderId,
  fallbackId: SearchProviderId,
): string {
  const name = (id: SearchProviderId): string => providerDisplayName(id) ?? id;
  return getStrings(locale).searchNotice.fallbackDeclined
    .replace("{primary}", name(primaryId))
    .replace("{fallback}", name(fallbackId));
}