// What the Rust side hands the page for a phone request (`phone-chat-request`),
// checked against docs/PHONE-CHAT-PROTOCOL.md §2 and §4. A payload that does
// not fit is answered as `bad_request` under its own id; only a payload with no
// usable id is dropped, because there is then nobody to answer.

type PhoneLanguage = "en" | "it";

interface PhoneMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PhoneTurn {
  messages: PhoneMessage[];
  /** The mail the person pressed "Draft a reply" on, if any. */
  replyFor: string | null;
  language: PhoneLanguage;
  /**
   * Which phone sent this, as the number the owner sees for the pairing.
   *
   * **This is what says whose phone this is**, and so what decides where a card
   * is drawn: a card raised by a phone's turn goes to that phone and to no
   * desktop. A turn with no device is offered no browser at all: the page it
   * would read is the desktop's, and a card it raised would never be shown to
   * anyone.
   */
  device: string | null;
  /**
   * **This turn's claim on the page**: the phone's conversation and this turn's
   * own id, put here by the app.
   *
   * **The claim belongs to the turn, not to the phone for the life of the
   * pairing.** The browser calls of this turn are stamped with it, and the
   * release at the turn's end is stamped with it too — so a release lets go of
   * the claim of the turn that made it and of no other's. Empty is no claim: a
   * turn with none is offered no browser, because there is nothing to stamp a
   * write with.
   */
  stamp: string;
}

export type PhoneBody = { kind: "turn"; turn: PhoneTurn } | { kind: "read"; id: string };

interface PhoneEnvelope {
  request: string;
  /**
   * The device this request authenticated as, **put there by the app** from the
   * credential the door resolved it from — and never read out of the phone's
   * body. Anything the body says about a device is not a field of the turn at
   * all, so there is nothing for it to be.
   */
  device: string | null;
  /** Whether that device may read this computer's mail, as the app decided
      when it opened the request. Absent is NO: a payload that never says is
      a payload from a build that does not ask, and the safe reading of that
      is the mailbox closed. */
  mail: boolean;
  /** Null when the body does not fit the protocol. */
  body: PhoneBody | null;
}

const MAX_MESSAGES = 200;

/** The request id a Rust payload carries, or null when there is none to answer. */
export function requestIdOf(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const { request } = payload;
  return typeof request === "string" && request !== "" ? request : null;
}

export function readPhoneRequest(payload: unknown): PhoneEnvelope | null {
  const request = requestIdOf(payload);
  if (request === null) return null;
  const body = bodyOf(payload);
  return { request, mail: mailOf(payload), device: deviceOf(payload), body };
}

/**
 * The device this request authenticated as, as the app states it beside the turn.
 *
 * **Read from the envelope, never from the body** — the phone does not get to
 * say who it is. Digits only, because it goes into a conversation id and an id
 * that can hold anything is an id that can be made to look like somebody else's.
 * Absent is null: a turn with no device is offered no browser write, which is
 * the safe reading of a request that never said.
 */
function deviceOf(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  return typeof payload.device === "string" && /^\d{1,10}$/.test(payload.device) ? payload.device : null;
}

function mailOf(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  return payload.mail === true;
}

function bodyOf(payload: unknown): PhoneBody | null {
  if (!isRecord(payload)) return null;
  if (payload.kind === "turn") return turnOf(payload.turn);
  if (payload.kind === "read") return readOf(payload.read);
  return null;
}

function turnOf(raw: unknown): PhoneBody | null {
  if (!isRecord(raw) || !Array.isArray(raw.messages)) return null;
  if (raw.messages.length === 0 || raw.messages.length > MAX_MESSAGES) return null;
  const messages: PhoneMessage[] = [];
  for (const item of raw.messages) {
    const message = messageOf(item);
    if (message === null) return null;
    messages.push(message);
  }
  // The answer is written to the last words, so a turn that ends on the
  // model's own words has nothing to answer.
  if (messages[messages.length - 1].role !== "user") return null;
  const replyFor = replyForOf(raw.reply_for);
  const language = languageOf(raw.language);
  const stamp = stampOf(raw.stamp);
  if (replyFor === undefined || language === null) return null;
  // **The device is put in by the app after this**, from the credential the door
  // resolved. A `device` in the body is not a field of the protocol and is not
  // read here: the phone has no way to know its own number and no business
  // naming somebody else's.
  return { kind: "turn", turn: { messages, replyFor, language, device: null, stamp } };
}

/**
 * The claim of this turn on the page, as the app put it beside the messages.
 *
 * **A name, and nothing else.** The app builds it and the sidecar reads it
 * back, so the two halves of the computer cannot be saying different things:
 * a claim this page does not recognise is a claim it does not make, and the
 * turn is offered no browser rather than one stamped with a name of its own.
 *
 * **The phone cannot put one here.** The door rebuilds the turn from the fields
 * it knows, so a claim in the phone's own body is dropped before the app ever
 * sees it, and the one that reaches the page is the app's own.
 */
function stampOf(raw: unknown): string {
  return typeof raw === "string" && raw !== "" ? raw : "";
}

function readOf(raw: unknown): PhoneBody | null {
  if (!isRecord(raw)) return null;
  const id = raw.id;
  return isDigits(id) ? { kind: "read", id } : null;
}

function messageOf(raw: unknown): PhoneMessage | null {
  if (!isRecord(raw)) return null;
  const { role, content } = raw;
  if ((role === "user" || role === "assistant") && typeof content === "string") {
    return { role, content };
  }
  return null;
}

/** Absent or null is no mail; `undefined` is a value the protocol refuses. */
function replyForOf(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return isDigits(value) ? value : undefined;
}

function languageOf(value: unknown): PhoneLanguage | null {
  if (value === undefined) return "en";
  return value === "en" || value === "it" ? value : null;
}

function isDigits(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
