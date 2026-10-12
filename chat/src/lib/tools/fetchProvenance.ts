import type { WireMessage } from "../chat";
import { PINNED_DOCS_MARK } from "../attachments";
import { findSensitive } from "../webgate/sensitive";

/**
 * Where a web_fetch address may come from, and what a web_search query may
 * carry out. A page the model is reading can hold hidden instructions, and
 * an address the model coined itself is how they walk private data out
 * through a query string — so, like Anthropic's web fetch tool, a page opens
 * only at an address that has already appeared in the conversation, in text
 * the model cannot author: a user message (a per-turn document's text rides
 * its user message), the pinned documents' block of the system message, or
 * the result of a web_search or web_fetch call. Everything the assistant
 * writes — its answers, its own tool-call arguments, every other tool's
 * results — counts for nothing, and a search's result arms only the
 * addresses on its own `URL:` lines (exa.rs), never the prose a query
 * steered. A query that itself carries an address with a path or a query is
 * a fetch that never asked, and follows the same rule.
 */

export interface FetchRefusal {
  /** The screen keys its localized sentence off this; the text is what the
      model reads. */
  code: string;
  text: string;
}

const UNSEEN: FetchRefusal = {
  code: "web.link_unseen",
  text: "Not run: this link has not appeared in the conversation, so it was not opened. Use web_search to find the page, or ask the user for the link.",
};

const CREDENTIAL: FetchRefusal = {
  code: "web.link_credential",
  text: "Not run: this address looks like it carries a password or key that the user did not type.",
};

const QUERY_UNSEEN: FetchRefusal = {
  code: "web.query_link_unseen",
  text: "Not run: the search carries an address that has not appeared in the conversation, so it was not made. Search in your own words, or ask the user for the link.",
};

/** The answers a web call gets when nothing ran. They quote the outgoing
    string — heldBack cuts it at eighty characters, so no scrub could remove
    the quote — so they are never provenance. */
const NEVER_PROVENANCE = ["Not run:", "No search was made:", "No page was opened:"];

/** The detectors' kinds that are not credentials: an address may carry an
    email, an IBAN, a phone, a card or a high-entropy document id and still
    be an address the user meant to open. The rules' kinds (keys and tokens)
    and the parameter names below are what the credential layer is for. */
const NOT_CREDENTIALS = new Set(["IBAN", "payment card number", "phone number", "email address"]);

/** Query parameters that name a credential whatever their value carries. */
const CREDENTIAL_PARAMS = new Set([
  "password", "passwd", "pwd", "pass", "secret", "token", "access_token",
  "api_key", "apikey", "key", "auth", "session", "sid",
]);

/** How exa.rs writes one result's own address line: three spaces, `URL: `,
    the address. A search's prose is text the query steered, so only these
    lines' addresses are provenance. */
const URL_LINE = "   URL: ";

/** The refusal for this address, or null when the rule lets it through to
    the gate. */
export function fetchProvenanceRefusal(url: string, conversation: WireMessage[]): FetchRefusal | null {
  const { seen, userTexts } = seenCorpus(conversation);
  // Opening the address would send the credential to its host, so only the
  // user's own words excuse one; a page or a result quoting it does not.
  const credentials = credentialTexts(url);
  if (!credentials.every((credential) => userTexts.some((text) => text.includes(credential)))) return CREDENTIAL;
  const key = canonical(url);
  if (key === null || !seen.has(key)) return UNSEEN;
  return null;
}

/** The egress rule for a search query: the words go to the engine as they
    are, so an address with a path or a query among them is a fetch that
    never asked — allowed only where a fetch of it would run. A bare name
    carries nothing to send and passes; plain words the model could re-spell
    cannot be policed. */
export function searchQueryRefusal(query: string, conversation: WireMessage[]): FetchRefusal | null {
  const { seen } = seenCorpus(conversation);
  for (const match of query.matchAll(URL_LIKE)) {
    const key = canonical(match[0].replace(/[.,;:!?…*_]+$/, ""));
    if (key === null) continue;
    let parsed: URL;
    try {
      parsed = new URL(key);
    } catch {
      continue;
    }
    if (parsed.pathname === "/" && parsed.search === "") continue;
    if (!seen.has(key)) return QUERY_UNSEEN;
  }
  return null;
}

/** The addresses this conversation has already carried, and the user's own
    words — the corpus both rules read. */
function seenCorpus(conversation: WireMessage[]): { seen: Set<string>; userTexts: string[] } {
  const seen = new Set<string>();
  const userTexts: string[] = [];
  for (const message of conversation) {
    if (message.role === "user") {
      const text = userWords(message.content);
      if (text !== "") {
        userTexts.push(text);
        remember(text, seen);
      }
    } else if (message.role === "system" && typeof message.content === "string") {
      // The pinned documents ride the system message; the fixed prompt above
      // them is the app's own text and arms nothing.
      const at = message.content.indexOf(PINNED_DOCS_MARK);
      if (at >= 0) remember(message.content.slice(at), seen);
    }
  }
  // Tool results, the web tools' only: any other tool's result is text the
  // model authored the shape of, and a web result is scanned only after the
  // call's own argument values are taken out of it.
  const calls = new Map<string, { name: string; own: string[] | null }>();
  for (const message of conversation) {
    if (message.role !== "assistant" || !Array.isArray(message.tool_calls)) continue;
    for (const call of message.tool_calls) {
      calls.set(call.id, { name: call.function.name, own: ownValues(call.function.arguments) });
    }
  }
  for (const message of conversation) {
    if (message.role !== "tool" || typeof message.content !== "string") continue;
    const text = message.content;
    const call = calls.get(message.tool_call_id ?? "");
    if (call === undefined || (call.name !== "web_search" && call.name !== "web_fetch")) continue;
    // Arguments that cannot be read cannot be scrubbed out of the echo, so
    // the whole result stays out of the corpus.
    if (call.own === null) continue;
    if (NEVER_PROVENANCE.some((prefix) => text.startsWith(prefix))) continue;
    if (text.startsWith(`${call.name} could not run:`)) continue;
    let scrubbed = text;
    for (const value of call.own) {
      for (const form of echoForms(value)) scrubbed = scrubbed.split(form).join(" ");
    }
    if (call.name === "web_search") {
      for (const line of scrubbed.split("\n")) {
        if (line.startsWith(URL_LINE)) remember(line.slice(URL_LINE.length), seen);
      }
    } else {
      // A page fetched from an address the conversation carried: its text is
      // outside content, not the model's.
      remember(scrubbed, seen);
    }
  }
  return { seen, userTexts };
}

/** The credentials this address carries, as the text that would excuse each:
    a key or token the detectors know, or a credential-named parameter with a
    value (as `name=value`, the shape the user's message would have to hold). */
function credentialTexts(url: string): string[] {
  const found = findSensitive(url)
    .filter((finding) => !NOT_CREDENTIALS.has(finding.kind) && !finding.kind.startsWith("possible secret"))
    .map((finding) => finding.matched);
  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    return found;
  }
  for (const [name, value] of parsed.searchParams) {
    if (value !== "" && CREDENTIAL_PARAMS.has(name.toLowerCase())) found.push(`${name}=${value}`);
  }
  return found;
}

/** The string values of a call's arguments — what the model authored and what
    an engine may echo back. Null when the text is not readable JSON. */
function ownValues(argsText: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsText);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  return Object.values(parsed).filter((value): value is string => typeof value === "string");
}

/** The forms one argument value can come back in: as sent, trimmed (the
    registry trims before anything leaves), and without a fragment (the door
    strips it). An echo of any of them is the model's own text, not
    provenance. */
function echoForms(value: string): string[] {
  const trimmed = value.trim();
  const forms = new Set([value, trimmed, trimmed.split("#")[0]]);
  return [...forms].filter((form) => form !== "");
}

/** Full addresses and bare `host.tld/…` shapes. The stop class ends a match
    at the quotes and brackets a PDF, a word processor, a chat app or CJK
    prose wraps an address in; sentence punctuation and markdown emphasis
    stuck to the end are trimmed after, so `**…**`, `“…”` and `（…）` give up
    their wrapper. A leading mark can never enter the match: both
    alternatives start at a scheme or a host character. */
const URL_LIKE = /https?:\/\/[^\s<>"'`)\]“”‘’«»（）【】「」]+|\b(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}(?::\d{1,5})?(?:\/[^\s<>"'`)\]“”‘’«»（）【】「」]*)?/gi;

function remember(text: string, seen: Set<string>): void {
  for (const match of text.matchAll(URL_LIKE)) {
    const key = canonical(match[0].replace(/[.,;:!?…*_]+$/, ""));
    if (key !== null) seen.add(key);
  }
}

/** One comparable shape, mirroring the parsers the request itself goes
    through: scheme and host fold to lower case (the WHATWG parser both sides
    use does that), the fragment falls away (no HTTP request carries it),
    and the path and query stay byte-exact — slash included, because the door
    asks `/private` and `/private/` as two different routes. A bare host
    reads as https. */
function canonical(raw: string): string | null {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
}

function userWords(content: WireMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}
