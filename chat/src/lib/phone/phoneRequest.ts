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
}

type PhoneBody = { kind: "turn"; turn: PhoneTurn } | { kind: "read"; id: string };

interface PhoneEnvelope {
  request: string;
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
  return { request, mail: mailOf(payload), body: bodyOf(payload) };
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
  if (replyFor === undefined || language === null) return null;
  return { kind: "turn", turn: { messages, replyFor, language } };
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
