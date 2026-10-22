import type { WireMessage } from "../chat";
import { PINNED_DOCS_MARK } from "../attachments";
import { stripUntrusted } from "../pageFence";
import { findSensitive } from "../webgate/sensitive";
import { addressesIn, canonical, rememberAddresses } from "./addresses";
import { BROWSER_NAMES } from "./browserTools";
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

const USERINFO: FetchRefusal = {
  code: "web.link_userinfo",
  text: "Not run: that address carries a username or password in front of the host, so it was not opened. Ask the user for the page without them.",
};

const UNSEEN: FetchRefusal = {
  code: "web.link_unseen",
  text: "Not run: this link has not appeared in the conversation, so it was not opened. Use web_search to find the page, or ask the user for the link.",
};

// **The same refusal said to a turn that already has a page in front of it.**
// The browser tools are the way through — the link is on the page that is
// open, with a ref to click — so telling this model to go and search for the
// page it is already looking at is a step backwards.
const UNSEEN_BROWSER: FetchRefusal = {
  code: UNSEEN.code,
  text: "Not run: this link has not appeared in the conversation, so it was not opened. The page in front of you carries it: use browser_read or browser_find to locate the link, then click its ref. If the link has no ref, copy its whole printed address, including the path and query, and open that; do not shorten or reconstruct it.",
};

// Browser recovery can use the open page; the shared fetch refusal still
// offers a search. **Click first, address second**: the model is holding a
// page, and the link is on it with a ref that can be clicked — an address
// written by hand is a page nobody asked for, and one the rule will refuse
// again anyway. The last sentence is the one way out of that: the product's
// own short address, which the rule opens when the conversation already
// carries its id on that host.
//
// **And it says not to ask again.** The owner's test of 21 October: a turn
// that named a service instead of an address ("open google maps and look
// for a place") was refused here nine times in a minute, each time with a
// different address the model had made up, and the person saw nothing but
// "Kalsa could not do it. Try again." The refusal is where the model is
// redirected, so it says three things: the address did not open as asked,
// the same address will not open the second time either, and the way
// through is the person's own address — asked for, written out whole — or
// another address they gave. The way through the page, when there is a page
// in front of the model, is still the ref to click.
const BROWSER_UNSEEN: FetchRefusal = {
  code: UNSEEN.code,
  text: "Not run: this address has not appeared in the conversation, so it did not open the way you asked. Do not open it again, and do not try another form of it: the same address will not open the second time either. If the page in front of you carries the link, use browser_read or browser_find to find it and click its ref. Otherwise ask the person for the exact address, written out whole, and open that — or open another address they gave you. A shorter form opens only when it is the same http or https address, spelled the same way, with no query of its own, and with the last piece of its path already printed in a link you have read: the product's own address, for example https://shop.example/dp/B012345678.",
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
const NEVER_PROVENANCE = [
  "Not run:",
  "No search was made:",
  "No page was opened:",
  "Nothing was searched for:",
];

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
  // Before anything else, and before the address is canonicalised. `canonical`
  // builds from the host alone, so `https://me:pw@bank.example/login` reads as
  // `https://bank.example/login` — the very page the conversation saw — and a
  // credential folded into the host is a credential sent to it. Whether the
  // detectors happen to name it is beside the point; it is never opened.
  if (carriesUserinfo(url)) return USERINFO;
  const { seen, userTexts } = seenCorpus(conversation);
  // Opening the address would send the credential to its host, so only the
  // user's own words excuse one; a page or a result quoting it does not.
  if (!credentialExcused(url, userTexts)) return CREDENTIAL;
  const key = canonical(url);
  // **A turn that already holds a browser result is answered with the browser's
  // way through**, not with a search: the link it wants is on the page it is
  // looking at, and a search for it is a page the person never asked for.
  if (key === null || !seen.has(key)) return browserResults(conversation) ? UNSEEN_BROWSER : UNSEEN;
  return null;
}

type BrowserEntry = { url: string; refusal: null } | { url: null; refusal: FetchRefusal };

/**
 * Whether the conversation already holds a browser result: a page the browser
 * read, not a refusal of one. **It is the signal that there is a page in
 * front of the model** — and a page is where the ref it needs lives, which is
 * why the unseen link is answered with the browser's way through and not with
 * a search.
 */
function browserResults(conversation: WireMessage[]): boolean {
  const calls = new Map<string, string>();
  for (const message of conversation) {
    if (message.role !== "assistant" || !Array.isArray(message.tool_calls)) continue;
    for (const call of message.tool_calls) calls.set(call.id, call.function.name);
  }
  for (const message of conversation) {
    if (message.role !== "tool" || typeof message.content !== "string") continue;
    const name = calls.get(message.tool_call_id ?? "");
    if (name === undefined || !BROWSER_NAMES.has(name)) continue;
    // A refusal read nothing, so no page is in front of the model.
    if (neverRan(name, message.content)) continue;
    return true;
  }
  return false;
}

// Open the user's homepage spelling and let the site redirect it; www and
// the bare host are not interchangeable provenance for paths or queries.
export function browserEntry(url: string, conversation: WireMessage[]): BrowserEntry {
  const refusal = fetchProvenanceRefusal(url, conversation);
  if (refusal === null) return { url, refusal: null };
  if (refusal.code !== UNSEEN.code) return { url: null, refusal };
  const named = userNamedHomepage(url, conversation);
  if (named !== null) return { url: named, refusal: null };
  // **The second check**: the product's own short address, which the exact
  // rule refuses and the person asked for all the same.
  const short = shortFormEntry(url, conversation);
  return short === null ? { url: null, refusal: BROWSER_UNSEEN } : { url: short, refusal: null };
}

function userNamedHomepage(url: string, conversation: WireMessage[]): string | null {
  if (carriesUserinfo(url)) return null;
  const asked = canonical(url);
  if (asked === null || !isHomepage(asked)) return null;
  const wanted = new URL(asked);
  const { userSeen, userTexts } = seenCorpus(conversation);
  for (const named of userSeen) {
    if (!isHomepage(named)) continue;
    const other = new URL(named);
    if (other.protocol !== wanted.protocol) continue;
    if (withoutWww(other.host) !== withoutWww(wanted.host)) continue;
    if (!credentialExcused(named, userTexts)) continue;
    return named;
  }
  return null;
}

function isHomepage(key: string): boolean {
  const parsed = new URL(key);
  return parsed.pathname === "/" && parsed.search === "";
}

function withoutWww(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : host;
}

/**
 * **The short form of a product: the same page, addressed by its own name.**
 *
 * A listing prints the whole address of every link on it — path, tracking
 * tokens, query, hundreds of characters the model cannot copy — and what the
 * model builds instead is the product's own short address
 * (`https://shop.example/dp/B0XXXX`). The exact rule refuses that, because
 * the conversation never carried it, and the model is left holding a page it
 * cannot reach: measured on a real turn, three tries out of three ended in
 * `open_unseen` and no product page was ever opened. This is the way through,
 * and it is narrow on purpose.
 *
 * **Why this form is safe.** The rule exists to stop two things: (a) an
 * address towards a host nobody has ever seen, and (b) data walking out
 * through the query string. (a) stands — the address asked for must be the
 * same address, spelled the same way, as one the conversation already
 * carries: scheme, host and port, byte for byte, with no `www` forgiven here,
 * no scheme forgiven and no userinfo folded away, so a host the model
 * invented is still refused and `http` is not `https`. (b) stands — the form
 * that opens carries no query of its own, and **every piece of its path** must
 * already be a piece of one path an address the conversation already carries
 * prints: a piece nobody printed is a piece the model made up, and a piece in
 * the middle of the path is a piece that carries data out. So a secret can
 * leave only if the conversation already carried a path carrying it, which is
 * the case today's design already arms for `web_fetch`. The short form
 * reaches the same site the person asked to navigate to, and every piece of
 * the address it opens was already printed there.
 *
 * **Only `browser_open` gets this.** A `web_fetch` is the app's own door and
 * it stays exact: nothing about it changes here.
 */
function shortFormEntry(url: string, conversation: WireMessage[]): string | null {
  // A name or a password in front of the host is never folded away.
  if (carriesUserinfo(url)) return null;
  const key = canonical(url);
  if (key === null) return null;
  const asked = new URL(key);
  // No fragment of its own. The door never sends one, so an address that
  // carries one is not the product's own address.
  if (url.includes("#")) return null;
  // **No query of its own.** This is where data walks out, and the short form
  // has no query to walk it through.
  if (asked.search !== "") return null;
  // Not the front door: a homepage has no piece of path to name a product
  // by, and it has a rule of its own.
  const pieces = asked.pathname.split("/").filter((piece) => piece !== "");
  if (pieces.length === 0) return null;
  const { seen } = seenCorpus(conversation);
  // **The address, spelled the same way.** The addresses already carried are
  // the conversation's own corpus — the person's words, the web results, the
  // pages the browser read — and nothing is forgiven here: the scheme, the
  // host and the port have to be the ones already carried. `www` is not
  // dropped (`shop.example` and `www.shop.example` are two addresses), and a
  // scheme is not dropped either: the same host on `http` and on `https` is
  // two addresses, and the bytes a plain request gets back are not the bytes a
  // secure one gets back.
  const onHost: URL[] = [];
  for (const address of seen) {
    let other: URL;
    try {
      other = new URL(address);
    } catch {
      continue;
    }
    if (other.origin === asked.origin) onHost.push(other);
  }
  if (onHost.length === 0) return null;
  // **Every piece of the path asked for, already printed.** Each piece of the
  // path has to be a piece of ONE path the conversation already carries: the
  // listing prints the whole address, so its pieces are in it; a piece nobody
  // printed is a piece the model made up, and it opens nothing. The pieces
  // have to come from the same printed path — a piece taken from one path and
  // another from a different one is not a printed path either, and an
  // invented piece is a piece that carries data out.
  const known = onHost.some((other) => {
    const printed = new Set(other.pathname.split("/"));
    return pieces.every((piece) => printed.has(piece));
  });
  // **What was checked is what opens.** The verified spelling of the address,
  // with its scheme — not the raw text the model wrote, which was never the
  // thing this rule read.
  return known ? asked.href : null;
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
function seenCorpus(conversation: WireMessage[]): { seen: Set<string>; userTexts: string[]; userSeen: Set<string> } {
  const seen = new Set<string>();
  const userTexts: string[] = [];
  // The person's own words, and only theirs: what a page, a tool's result or
  // the assistant wrote is no proof the person named a site. **And the digest's
  // block is no proof either**: it rides inside the person's own message, and
  // the strip takes it off before the message is read as the person's.
  const userSeen = new Set<string>();
  for (const message of conversation) {
    if (message.role === "user") {
      const text = userWords(message.content);
      if (text !== "") {
        userTexts.push(text);
        for (const key of addressesIn(text)) {
          seen.add(key);
          userSeen.add(key);
        }
      }
    } else if (message.role === "system" && typeof message.content === "string") {
      // The pinned documents ride the system message; the fixed prompt above
      // them is the app's own text and arms nothing.
      const at = message.content.indexOf(PINNED_DOCS_MARK);
      if (at >= 0) rememberAddresses(message.content.slice(at), seen);
    }
  }
  // Only web and browser results can supply page addresses. Other tools can
  // echo strings the model supplied and cannot establish provenance.
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
    if (call === undefined) continue;
    // A browser page is outside content exactly as a fetched page is: a stranger
    // wrote it. It arms what the model could have opened itself, which is the
    // rule `web_fetch` already applies.
    const isPage = call.name === "web_fetch" || BROWSER_NAMES.has(call.name);
    if (!isPage && call.name !== "web_search") continue;
    // Arguments that cannot be read cannot be scrubbed out of the echo, so
    // the whole result stays out of the corpus.
    if (call.own === null) continue;
    if (neverRan(call.name, text)) continue;
    let scrubbed = text;
    // Find returns page lines and never echoes its needle, even on no match.
    // Scrubbing that needle would change addresses the page actually printed.
    for (const value of call.name === "browser_find" ? [] : call.own) {
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
      // A page fetched from an address the conversation carried, or read in the
      // browser: its text is outside content, not the model's. The fence is
      // stripped first — its markers are the app's, and its warning line is an
      // instruction the app wrote, not an address anyone should be able to arm.
      rememberAddresses(pageBody(scrubbed), seen);
    }
  }
  return { seen, userTexts, userSeen };
}

/** The page's own lines: the fenced block without the app's warning and markers,
    which are the app's words and not the page's. */
function pageBody(text: string): string {
  const fenced = text.match(/^<kalsa-page-[0-9a-f]+>\n([\s\S]*?)\n<\/kalsa-page-[0-9a-f]+>$/m);
  return fenced === null ? text : fenced[1];
}

/** Whether the address names a user or a password before its host. */
function carriesUserinfo(url: string): boolean {
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
    return parsed.username !== "" || parsed.password !== "";
  } catch {
    // An address that will not parse is not one we open either way.
    return false;
  }
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

/**
 * The person's own words, with the app's fences taken off.
 *
 * **The digest's block is not the person's speech.** The block rides inside
 * the last user message, and it carries the conversation's earlier turns — the
 * model's words, a page's words, a document's text. A page's line inside it
 * must not excuse a credential the person never typed, and the model's line
 * inside it must not name a site the person never named: the block comes off
 * before the message is read as the person's own words.
 *
 * **A page's fence comes off as well** (defence in depth): a page's words are
 * a stranger's words wherever they are.
 */
function userWords(content: WireMessage["content"]): string {
  const text =
    typeof content === "string"
      ? content
      : content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
  return stripUntrusted(text);
}
