import { publicHttpUrl } from "../publicUrl";
import { logUiEvent } from "../uiLog";
import { exceedsCodePoints, firstCodePoints } from "../text";
import { canonical, credentialRefusal, neverRan } from "./fetchProvenance";
import { PAGE_HEADERS, URL_LINE, encodeAddress } from "./resultFormat";
import { through } from "./door";
import type { WireMessage } from "../chat";

/**
 * Read the pages a search found, for a model that only asked for a search.
 *
 * Measured with the real model (2026-10-17): asked what was on this weekend,
 * Qwen3.6-35B-A3B called web_search once and answered out of the four snippets
 * — two runs in three — and the run that opened a page gave the best answer.
 * The description it was given already told it to fetch; it did not, and no
 * prompt will make every model do it. So the code reads them: the model still
 * decides when to search and what to make of the answer, and the pages under
 * its own search stop being something it can forget.
 */

/** How many of a search's results are read. Two is what a turn pays for: the
    best two, before any of the others are looked at. */
const PAGES = 2;

/** What one page may cost the turn. Rust allows half a minute; this page is
    already blocking a search the model is waiting for. */
const PAGE_BUDGET_MS = 8_000;

/** What one page may add to the answer. A search result is already up to 2500
    characters of its own (exa.rs), and a whole page would crowd out the round
    after it. */
const PAGE_CHARS = 3_000;

export interface PagesRead {
  /** The search's own text, with every page that came back appended. */
  text: string;
  /** How many pages are in it, for the card that says the search read some. */
  count: number;
}

/**
 * The top pages of this search's own result, read and appended to it. null
 * when the turn was stopped while they were in flight — an answer out of half
 * its pages is not an answer, and the turn is going away regardless.
 */
export async function readSearchPages(
  found: string,
  conversation: WireMessage[],
  signal: AbortSignal | undefined,
): Promise<PagesRead | null> {
  const urls = pages(found, conversation);
  // Nothing left to read, or a turn already on its way out: no request for a
  // page nobody is waiting for.
  if (urls.length === 0 || signal?.aborted) return { text: found, count: 0 };
  // At once, not one after the other: the model is waiting for all of them,
  // and two pages in sequence cost it twice what they are worth.
  const read = await Promise.all(urls.map((url) => readOne(url, conversation, signal)));
  if (signal?.aborted) return null;

  let text = found;
  let count = 0;
  for (const [at, page] of read.entries()) {
    if (page === null) continue;
    count += 1;
    // Numbered by what is actually in the answer, and carrying the address it
    // was read at: a model that wants this one again fetches the address, not a
    // number that only meant something in this block. Encoded, so a parenthesis
    // in the address cannot close the header early.
    text += `\n\nPage ${count} (${encodeAddress(urls[at])}):\n${page}`;
  }
  // Counts and nothing else: which pages were read is an address a stranger's
  // page chose, and the log promises never to carry one.
  logUiEvent(`chat.tool.web_pages_read.${count}.${urls.length}`);
  return { text, count };
}

/**
 * One page, under the rules an address the app reads for itself goes through:
 * the credential layer holds even though a search printed it, and the door's
 * own address gate refuses this machine either way. A page that is refused,
 * unreachable or late is simply not in the answer — the snippets are still
 * there, and the model can ask for this address. Nothing here throws: a rule
 * that fails must cost this page its read, never the whole search.
 */
async function readOne(
  url: string,
  conversation: WireMessage[],
  signal: AbortSignal | undefined,
): Promise<string | null> {
  try {
    if (credentialRefusal(url, conversation) !== null) return null;
    const page = await through("brain_web_fetch", { url }, signal, PAGE_BUDGET_MS);
    return page === "" ? null : cut(page);
  } catch {
    return null;
  }
}

/**
 * What one page may add, and the sentence that says the rest is not here: a
 * prefix must never read as the whole page. Cut by code points, which is what
 * the engine is charged for and what never leaves half a surrogate pair behind.
 */
function cut(page: string): string {
  if (!exceedsCodePoints(page, PAGE_CHARS)) return page;
  return `${firstCodePoints(page, PAGE_CHARS)}\n\n[Only the first ${PAGE_CHARS} characters of this page are shown. Open it with web_fetch to read the rest.]`;
}

/**
 * The addresses this search will read: the first ones on its own `URL:` lines,
 * which are the provider's and not the query's — the result is read raw here
 * on purpose, because the provenance rule's scrub removes a query echoed back
 * into a result, and the provider's own address is still an address the
 * provider printed. Non-public ones never become a read, and neither does a
 * page this turn has already read.
 */
function pages(found: string, conversation: WireMessage[]): string[] {
  const seen = readAddresses(conversation);
  const urls: string[] = [];
  for (const line of found.split("\n")) {
    if (!line.startsWith(URL_LINE)) continue;
    // The fragment falls away before anything else sees the address, as it
    // does for a web_fetch the model asked for: HTTP never sends it, and the
    // header would carry an address nothing was ever read at.
    const raw = line.slice(URL_LINE.length).split("#")[0];
    const url = publicHttpUrl(raw);
    if (url === null) continue;
    // Compared in the form a block header carries, which is the form the
    // previous search's header is in.
    const key = canonical(encodeAddress(url));
    if (key === null || seen.has(key)) continue;
    seen.add(key);
    urls.push(url);
    if (urls.length === PAGES) break;
  }
  return urls;
}

/**
 * The addresses this turn has already read: every page the model opened, and
 * every page the app read under an earlier search — which is what the block
 * headers it wrote say. A call that never ran is not one: it left nothing
 * behind, and remembering its address would skip a page nobody ever read. A
 * header inside a page's own text can put an address in here too, and that
 * only ever costs the app a read it would have made — the direction that is
 * safe to be wrong in.
 */
function readAddresses(conversation: WireMessage[]): Set<string> {
  const calls = new Map<string, string>();
  for (const message of conversation) {
    if (message.role !== "assistant" || !Array.isArray(message.tool_calls)) continue;
    for (const call of message.tool_calls) calls.set(call.id, call.function.name);
  }
  const seen = new Set<string>();
  // Every comparison is on the encoded form, which is the form a block header
  // carries: encoding twice is the identity, and a real `%28` in a path stays
  // itself either way.
  const remember = (address: string) => {
    const key = canonical(encodeAddress(address));
    if (key !== null) seen.add(key);
  };
  const answers = new Map<string, string>();
  for (const message of conversation) {
    if (message.role !== "tool" || typeof message.content !== "string") continue;
    const id = message.tool_call_id ?? "";
    const name = calls.get(id);
    if (name === "web_search") {
      // The app's own reads under that search, by the headers it wrote.
      for (const [, address] of message.content.matchAll(PAGE_HEADERS)) remember(address);
    } else if (name === "web_fetch") {
      answers.set(id, message.content);
    }
  }
  for (const message of conversation) {
    if (message.role !== "assistant" || !Array.isArray(message.tool_calls)) continue;
    for (const call of message.tool_calls) {
      if (call.function.name !== "web_fetch") continue;
      const answer = answers.get(call.id);
      // A call that ran and failed still asked for that page, and the answer is
      // why: the model already has the refusal in front of it. A call that
      // never ran read nothing, so its address is not one this turn has read.
      if (answer === undefined || neverRan("web_fetch", answer)) continue;
      try {
        const args: unknown = JSON.parse(call.function.arguments);
        const url = args !== null && typeof args === "object" ? (args as { url?: unknown }).url : undefined;
        if (typeof url === "string") remember(url);
      } catch {
        // Arguments that cannot be read cannot be compared; this page is read
        // again, which is what an unreadable call did before.
      }
    }
  }
  return seen;
}