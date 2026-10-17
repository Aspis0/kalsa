import type { WireMessage } from "../chat";
import { PINNED_DOCS_MARK } from "../attachments";
import { findSensitive } from "../webgate/sensitive";
import { addressesIn, canonical, rememberAddresses } from "./addresses";
import { URL_LINE, pageTexts, providerText } from "./resultFormat";

// One shape for an address wherever it is compared: the page reads under a
// search fold theirs the same way this rule folds one to arm.
export { canonical };

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
 * results — counts for nothing, and a search's result arms its own `URL:`
 * lines (exa.rs) and nothing of its prose, which the query steered. A page
 * the app read under a search is one tier up: it is a page the model could
 * have opened itself, so it arms exactly what opening it would have armed.
 * A query that itself carries an address with a path or a query is a fetch
 * that never asked, and follows the same rule.
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

/** Whether this answer is the refusal of a call that never ran. Such a call
 * opened nothing, so its address is not one this conversation has read —
 * both here, where it arms nothing, and where the app's own page reads decide
 * what a turn has already read (searchPages.ts). */
export function neverRan(name: string, result: string): boolean {
  return NEVER_PROVENANCE.some((prefix) => result.startsWith(prefix)) || result.startsWith(`${name} could not run:`);
}

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

/** The refusal for this address, or null when the rule lets it through to
    the gate. */
export function fetchProvenanceRefusal(url: string, conversation: WireMessage[]): FetchRefusal | null {
  const { seen, userTexts } = seenCorpus(conversation);
  // Opening the address would send the credential to its host, so only the
  // user's own words excuse one; a page or a result quoting it does not.
  if (!credentialExcused(url, userTexts)) return CREDENTIAL;
  const key = canonical(url);
  if (key === null || !seen.has(key)) return UNSEEN;
  return null;
}

/**
 * The credential layer on its own, for an address the app reads itself rather
 * than one the model asked for. Such an address comes from the provider's own
 * `URL:` lines, so it needs no arming — but a credential in it is still a
 * secret the user did not type, and opening it would send that secret to its
 * host. The rule is this file's, not a second copy of it.
 */
export function credentialRefusal(url: string, conversation: WireMessage[]): FetchRefusal | null {
  const { userTexts } = seenCorpus(conversation);
  return credentialExcused(url, userTexts) ? null : CREDENTIAL;
}

function credentialExcused(url: string, userTexts: string[]): boolean {
  return credentialTexts(url).every((credential) => userTexts.some((text) => text.includes(credential)));
}

/** The egress rule for a search query: the words go to the engine as they
    are, so an address with a path or a query among them is a fetch that
    never asked — allowed only where a fetch of it would run. A bare name
    carries nothing to send and passes; plain words the model could re-spell
    cannot be policed. */
export function searchQueryRefusal(query: string, conversation: WireMessage[]): FetchRefusal | null {
  const { seen } = seenCorpus(conversation);
  for (const key of addressesIn(query)) {
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
        rememberAddresses(text, seen);
      }
    } else if (message.role === "system" && typeof message.content === "string") {
      // The pinned documents ride the system message; the fixed prompt above
      // them is the app's own text and arms nothing.
      const at = message.content.indexOf(PINNED_DOCS_MARK);
      if (at >= 0) rememberAddresses(message.content.slice(at), seen);
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
    if (neverRan(call.name, text)) continue;
    let scrubbed = text;
    for (const value of call.own) {
      for (const form of echoForms(value)) scrubbed = scrubbed.split(form).join(" ");
    }
    if (call.name === "web_search") {
      // The provider's own lines arm their addresses and nothing else; each
      // page block underneath arms as the page it is, because it is one the
      // model could have opened itself (resultFormat.ts has the rule: a
      // boundary mistake moves text between these two tiers, never above the
      // one `web_fetch` already gives).
      for (const line of providerText(scrubbed).split("\n")) {
        if (line.startsWith(URL_LINE)) rememberAddresses(line.slice(URL_LINE.length), seen);
      }
      for (const text of pageTexts(scrubbed)) rememberAddresses(text, seen);
    } else {
      // A page fetched from an address the conversation carried: its text is
      // outside content, not the model's.
      rememberAddresses(scrubbed, seen);
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

function userWords(content: WireMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}
