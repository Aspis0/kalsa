/**
 * A request the computer held for the person to decide on
 * (PHONE-CHAT-PROTOCOL §3.1), kept only in the shape a card draws.
 *
 * Everything here is a stranger's words: the site named the URL and the values.
 * The values are the point — a person is not asked to allow a form they cannot
 * read — so they cross and are drawn behind a Show button rather than filtered.
 *
 * **A card is refused whole rather than trimmed.** A field over its cap is a
 * field this card would be showing short of what the site would really receive,
 * and a payload shown short is a lie told to the person deciding. So one bad
 * field draws nothing, exactly as the desktop refuses a body it cannot render
 * honestly.
 *
 * Nothing here keeps anything: the card lives on the message for as long as the
 * person may answer it and is stripped from disk in the same breath as a draft
 * (§6). The reveal of one value is the card's own state and lives nowhere else.
 */
export type BrowserCardField = {
  name: string;
  /** The real value while the card may still be answered, and **null once it
   *  may not**: answered, settled by an outcome, or past its deadline. §6 is
   *  about the value going, not about it being hidden — a value still sitting
   *  in a message is a value a later render, a debug view or a crash report
   *  can reach. */
  value: string | null;
  secret: boolean;
};

export type BrowserCard = {
  cardId: string;
  method: string;
  /** Where it would go, while the card may still be answered, and null once it
   *  may not (§6): the address is a stranger's site as much as the values are
   *  a stranger's typing, and a spent card has nothing left to decide. */
  url: string | null;
  fields: BrowserCardField[];
  /** When this phone's five minutes are up, on **this phone's** clock,
   *  counted from the moment the card arrived (PHONE-CHAT-PROTOCOL §3.1).
   *
   *  Never an absolute stamp the computer sent: `answer_by_ms` is gone and
   *  `asked_at_ms` stays for the computer's own logs. A phone whose clock is a
   *  day out would have read an absolute deadline as already past, and one
   *  half an hour out as not yet arrived — both without the person ever
   *  touching anything. A duration is the only thing both clocks can agree on. */
  deadlineAtMs: number;
};

export type BrowserOutcome = {
  /** The contract names six. A seventh arrives anyway when a computer is newer
   *  than this phone, and keeping the type open is what lets the card close
   *  with an honest sentence instead of staying open for an answer that will
   *  never come. The words live in `browserOutcomeText`, which names the six. */
  code: string;
  host: string;
};

/** One card on one answer, and what became of it once it was spent. */
export type BrowserCardEntry = { card: BrowserCard; outcome?: BrowserOutcome };

/** §3.1's own caps, as the phone reads them. The address is 8 KiB, not the
 *  megabyte a turn body allows: a card has to fit in one frame beside 200
 *  fields of 8 KiB, and an address nobody is going to read is not worth one. */
const MAX_FIELDS = 200;
const MAX_NAME = 256;
const MAX_METHOD = 256;
const MAX_URL = 8 * 1024;
const MAX_VALUE = 8 * 1024;

/** This phone's own clock for a card's budget. Monotonic where the runtime
 *  offers one (Hermes does), so a clock that jumps mid-countdown — NTP, or a
 *  person changing the phone's time — cannot hand back a minute the person
 *  never had or cut one short. Both callers must read the same clock; the
 *  fallback is `Date.now`, and it is only a fallback. */
export function monotonicNowMs(): number {
  const perf = typeof performance === "undefined" ? undefined : performance;
  return perf !== undefined && typeof perf.now === "function" ? perf.now() : Date.now();
}

/** A value nobody may read at a glance, drawn as this. */
export const SECRET_DOTS = "••••••";

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(obj: Record<string, unknown>, key: string, max: number): string | null {
  const value = obj[key];
  if (typeof value !== "string") return null;
  return value.length <= max ? value : null;
}

function millis(obj: Record<string, unknown>, key: string): number | null {
  const value = obj[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** The id every answer names. Without one the card cannot be answered at all,
 *  and a card nobody can answer is worse than no card. */
function cardIdOf(obj: Record<string, unknown>): string | null {
  const id = text(obj, "card_id", 32);
  return id !== null && /^[0-9a-f]{32}$/.test(id) ? id : null;
}

/** One field, or null — which takes the whole card with it, on purpose. */
function field(raw: unknown): BrowserCardField | null {
  const one = asObject(raw);
  if (one === null) return null;
  const name = text(one, "name", MAX_NAME);
  // The value is never optional: an absent one is not an empty field, it is a
  // field this card cannot show as it would be sent.
  const value = text(one, "value", MAX_VALUE);
  if (name === null || value === null) return null;
  return { name, value, secret: one.secret === true };
}

export function normalizeBrowserCard(raw: unknown, arrivedAtMs = monotonicNowMs()): BrowserCard | null {
  const card = asObject(raw);
  if (card === null) return null;
  const cardId = cardIdOf(card);
  const method = text(card, "method", MAX_METHOD);
  const url = text(card, "url", MAX_URL);
  // `answer_in_ms` is a DURATION, not a deadline: the moment the card arrived
  // is the only moment this phone knows for certain. `asked_at_ms` is the
  // computer's clock, kept for its logs, and deliberately not read here.
  const answerInMs = millis(card, "answer_in_ms");
  const fields = card.fields;
  if (
    cardId === null ||
    method === null ||
    method === "" ||
    url === null ||
    url === "" ||
    answerInMs === null ||
    !Array.isArray(fields) ||
    fields.length > MAX_FIELDS
  ) {
    return null;
  }
  const parsed = fields.map(field);
  if (parsed.some((one) => one === null)) return null;
  return {
    cardId,
    method,
    url,
    fields: parsed as BrowserCardField[],
    deadlineAtMs: arrivedAtMs + answerInMs,
  };
}

/** What became of one card, as the wire carries it: a code from the closed
 *  set, and **a host only where a request went**. Both the answer's own body
 *  and the outcome event are this, minus the id — so they are read once here.
 *
 *  A code the contract does not name is **kept, not refused**: the card is over
 *  whatever it was over, and refusing it would leave the card on screen asking
 *  a question nobody can answer any more. It is drawn with the generic sentence
 *  and never with the code itself.
 *
 *  A host rides nothing but `sent`, and only ever bare (§3.1): no path, no
 *  port, no query, no `user@`. */
export function readBrowserOutcome(raw: unknown): BrowserOutcome | null {
  const wire = asObject(raw);
  if (wire === null) return null;
  const code = text(wire, "code", 64);
  if (code === null) return null;
  if (code !== "sent") {
    // `host` appears only with a `sent`, so a host on any other outcome is
    // dropped rather than believed — and the outcome itself is still read: a
    // protocol slip must not leave a card on screen that nobody will ever
    // answer again, with its buttons still asking.
    return { code, host: "" };
  }
  const host = text(wire, "host", 512);
  return host === null || !isBareHost(host) ? null : { code: "sent", host };
}

/** An outcome the phone did not ask for (§3.1): what became of a card the
 *  window closed on, or whose phone unpairs. The id is what finds the card. */
export function normalizeBrowserOutcome(
  raw: unknown,
): { cardId: string; outcome: BrowserOutcome } | null {
  const wire = asObject(raw);
  if (wire === null) return null;
  const cardId = cardIdOf(wire);
  if (cardId === null) return null;
  const outcome = readBrowserOutcome(wire);
  return outcome === null ? null : { cardId, outcome };
}

/** Letters, digits, dot, dash, underscore, or a bracketed IPv6 address: the
 *  desktop's own rule about a host, checked again on the phone's side. */
function isBareHost(host: string): boolean {
  if (host.length === 0) return false;
  const bracketed = host.startsWith("[") && host.endsWith("]") && host.length > 2;
  if (bracketed) {
    const inner = host.slice(1, -1);
    return [...inner].every((c) => /[0-9a-fA-F:.%]/.test(c));
  }
  return [...host].every((c) => /[a-zA-Z0-9._-]/.test(c));
}

/** The answer's own 200 body (§3.1): a code, or an error. The id is named by
 *  the request, not the answer, so this reads the outcome and nothing else. */
export type BrowserAnswer =
  | { ok: true; outcome: BrowserOutcome }
  | { ok: false; errorCode: string };

export function readBrowserAnswer(payload: Record<string, unknown>): BrowserAnswer {
  const error = payload.error;
  if (typeof error === "string" && error !== "") return { ok: false, errorCode: error };
  const outcome = readBrowserOutcome(payload);
  return outcome === null ? { ok: false, errorCode: "browser.unreadable" } : { ok: true, outcome };
}

/** The field names the card says are secret. The URL is masked on exactly
 *  these, which is why the masking takes the card and not a list. */
export function secretFieldNames(card: BrowserCard): string[] {
  return card.fields.filter((one) => one.secret).map((one) => one.name);
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return text;
  }
}

/** The address the card draws, with the value of every secret-named query
 *  parameter as dots (§3.1). A URL the phone cannot take apart is drawn whole:
 *  it is the computer's own address, not a parse failure worth hiding.
 *
 *  Only the value is replaced — the name stays, because the person is deciding
 *  on a request to `passphrase_2` and a card showing `secret=value` tells them
 *  nothing they did not already know from the fields list below it. */
export function maskSecretQuery(url: string, secretNames: readonly string[]): string {
  if (secretNames.length === 0) return url;
  const cut = url.indexOf("?");
  if (cut === -1) return url;
  const secrets = new Set(secretNames);
  const head = url.slice(0, cut);
  const rest = url.slice(cut + 1);
  const hashAt = rest.indexOf("#");
  const query = hashAt === -1 ? rest : rest.slice(0, hashAt);
  const fragment = hashAt === -1 ? "" : rest.slice(hashAt);
  const masked = query
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq === -1) return pair;
      const name = decode(pair.slice(0, eq));
      if (!secrets.has(name)) return pair;
      const value = pair.slice(eq + 1);
      return `${pair.slice(0, eq)}=${value === "" ? "" : SECRET_DOTS}`;
    })
    .join("&");
  return `${head}?${masked}${fragment}`;
}

/** A card nobody may answer any more keeps its shape — its identity, its
 *  fields' names, its method — and loses everything that was the stranger's
 *  words: every value, and the address they would have gone to.
 *
 *  Idempotent: stripping twice is stripping once, so a frame, an answer and a
 *  deadline arriving together cannot undo each other. */
export function stripCardValues(card: BrowserCard): BrowserCard {
  const strippedFields = card.fields.every((one) => one.value === null);
  if (strippedFields && card.url === null) return card;
  return {
    ...card,
    url: null,
    fields: strippedFields
      ? card.fields
      : card.fields.map((one) => (one.value === null ? one : { ...one, value: null })),
  };
}

/** True once the card may not be answered: it was answered, an outcome landed
 *  on it, or its deadline passed. The card keeps its identity either way — a
 *  spent card still has to say what became of it. */
export function isCardAnswerable(
  entry: BrowserCardEntry,
  nowMs: number,
): boolean {
  if (entry.outcome !== undefined) return false;
  return !isBrowserCardExpired(entry.card, nowMs);
}

/** Past its budget the card is off the person's screen (§3.1). The deadline is
 *  this phone's own, counted from the card's arrival, and `nowMs` must come
 *  from the same clock it was written on (`monotonicNowMs`) — comparing a
 *  monotonic deadline against a wall clock would read as already past. */
export function isBrowserCardExpired(card: BrowserCard, nowMs: number): boolean {
  return nowMs >= card.deadlineAtMs;
}