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
 * Desk-mode chats that search from the PC are a different path and are out of
 * scope here: this gate guards the phone-local providers only.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { getStrings, type Locale } from "../i18n";
import { PROVIDERS, PROVIDER_IDS, type SearchProviderId } from "./registry";

/** The accepted providers, one entry per install. Same AsyncStorage pattern as
 *  the other one-time choices (PROVIDER_STORAGE_KEY, GOVERNOR_ENABLED_KEY). */
export const SEARCH_CONSENT_KEY = "kalsa.search.consent.v1";

/** Storage format marker: anything without it is a value this module never
 *  wrote, and is therefore not read as consent. */
const CONSENT_FORMAT = "v1";

/**
 * "allow" the search · "deny" — the user chose "Not now": this search is
 * skipped and the notice comes back next time for that provider · "unavailable"
 * — the gate could not be resolved, so the search did not run.
 */
export type SearchConsentVerdict = "allow" | "deny" | "unavailable";

export type SearchConsentStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

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

/** One pending dialog per provider, so two searches for the SAME provider
 *  share one question instead of stacking two copies of it. */
const pending = new Map<SearchProviderId, Promise<SearchConsentVerdict>>();

/** Every dialog, and every dialog's read-modify-write of the consent key, runs
 *  on this one chain. Two providers must never show two Alerts at once (the
 *  platform's behaviour for concurrent dialogs is not something this app
 *  should depend on), and a read-modify-write outside the chain could drop a
 *  provider another dialog accepted while it was open. */
let dialogChain: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = dialogChain.then(task, task);
  dialogChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Resolve the consent for sending a query to `providerId` on this install.
 *
 * `confirm` is the host's dialog and must resolve false on dismiss as well as
 * on "Not now" — an unanswered dialog is not consent. It runs with no focused
 * button, so a stray Enter never accepts the search.
 *
 * A failed write after "Search" still runs the search: the user answered yes,
 * and asking again next time is the honest outcome of a storage that is down.
 */
export async function confirmSearchProvider(args: {
  locale: Locale;
  providerId: SearchProviderId;
  confirm: (providerName: string) => Promise<boolean>;
  storage?: SearchConsentStorage;
}): Promise<SearchConsentVerdict> {
  const storage: SearchConsentStorage = args.storage ?? AsyncStorage;
  const providerName = providerDisplayName(args.providerId);
  if (providerName === null) return "unavailable";
  let accepted: SearchProviderId[];
  try {
    // Read OUTSIDE the chain on purpose: an already-accepted provider must not
    // queue behind an unrelated open dialog. The read that guards the WRITE is
    // the one inside askOnce.
    accepted = parseSearchConsent(await storage.getItem(SEARCH_CONSENT_KEY));
  } catch {
    return "unavailable";
  }
  if (accepted.includes(args.providerId)) return "allow";

  const alreadyOpen = pending.get(args.providerId);
  if (alreadyOpen) return alreadyOpen;
  const asking = enqueue(() => askOnce(args, providerName, storage)).finally(() => {
    pending.delete(args.providerId);
  });
  pending.set(args.providerId, asking);
  return asking;
}

async function askOnce(
  args: {
    providerId: SearchProviderId;
    confirm: (providerName: string) => Promise<boolean>;
  },
  providerName: string,
  storage: SearchConsentStorage,
): Promise<SearchConsentVerdict> {
  let answer = false;
  try {
    answer = await args.confirm(providerName);
  } catch {
    // A dialog that cannot be shown is not consent.
    return "unavailable";
  }
  if (!answer) return "deny";
  // Inside the chain, so no other dialog can read-modify-write between here
  // and the setItem below.
  let next = [args.providerId];
  try {
    const stored = parseSearchConsent(await storage.getItem(SEARCH_CONSENT_KEY));
    next = [...new Set([...stored, args.providerId])];
  } catch {
    // Unreadable: keep only what this answer accepts. A storage that cannot be
    // read asks again next time rather than losing an earlier consent.
  }
  try {
    await storage.setItem(SEARCH_CONSENT_KEY, `${CONSENT_FORMAT}:${next.join(",")}`);
  } catch {
    // Consent given, write refused: run the search and ask again next time.
  }
  return "allow";
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