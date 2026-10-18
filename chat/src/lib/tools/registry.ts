import type { ToolOutcome, WireMessage } from "../chat";
import { available } from "../tauri";
import { findCopied } from "../webgate/copied";
import type { PinnedDoc } from "../webgate/copied";
import type { GateFinding } from "../webgate/finding";
import { findSensitive } from "../webgate/sensitive";
import { TOOL_DEFINITIONS, CREATE_MINIAPP_TOOL, MAIL_TOOLS, mailShowTool } from "./definitions";
import type { ToolDefinition } from "./definitions";
import { runCreateMiniapp } from "./createMiniapp";
import { through } from "./door";
import { fetchProvenanceRefusal, searchQueryRefusal } from "./fetchProvenance";
import { readSearchPages } from "./searchPages";
import { runMailDraft, runMailList, runMailRead } from "./mailCall";
import { runMailShow } from "./mailShow";
import { BROWSER_NAMES, BROWSER_TOOLS, withheld } from "./browserTools";
import { browserUsable } from "../browser/usable";
import { browserFind, browserOpen, browserRead } from "./browserCall";
import { mailAllowed } from "../mail/allowlist";
import { isMailRun } from "../mail/runs";
import { carriesMail } from "../mail/fence";
import type { Language } from "../../i18n";

/** What one held call looks like to the page: which tool, the exact string
    that would leave, what the detectors saw in it, and what armed the gate at
    all — the documents pinned, and whether the mailbox is in the conversation. */
export interface GateCheck {
  tool: "web_search" | "web_fetch";
  outgoing: string;
  findings: GateFinding[];
  /** The ids of the documents pinned, so an allowance is per document, not per name. */
  documentIds: string[];
  mail: boolean;
}

/**
 * The page's half of the gate. `null` is a stated decision, not a default:
 * this caller has no owner to ask — the browser harnesses and a plain
 * `vite dev` page — so its calls go out as they did before the gate existed,
 * the same spirit as `offeredTools` below, where the harnesses simply get no
 * tools rather than tools that cannot run. The parameter is required on
 * purpose: a caller that forgets to state its intent is a compile error, not
 * a silent open door.
 */
export interface WebGate {
  /** The documents pinned in this conversation right now, read at call time. */
  documents: () => PinnedDoc[];
  /** Held for the owner's answer: true lets the call leave, false refuses it. */
  confirm: (check: GateCheck) => Promise<boolean>;
  /** The one-time notice in front of this install's first search, asked
      before `confirm` on the same call. Its answer is the page's to keep;
      this only asks. */
  firstSearch: () => Promise<boolean>;
}

/**
 * The tools this build may offer on a request. Outside the desktop app there
 * is no command behind the web tools or the mailbox — the browser harnesses
 * and a plain `vite dev` page get an empty list, so no request ever offers a
 * tool that cannot run. Inside it, the owner's switch is the only thing the
 * web tools sit behind; `create_miniapp` and the mail tools run on this
 * computer, so they are offered either way — but only to a model the mailbox
 * is open to, the same list the executor enforces. The language is the app's,
 * and the mail tools read it: it is what `mail_show` tells the model to write
 * its one lines in.
 */
export function offeredTools(enabled: boolean, language: Language, model: string): ToolDefinition[] {
  if (!available()) return [];
  const mail = mailAllowed(model) ? [...MAIL_TOOLS, mailShowTool(language)] : [];
  const web = enabled ? TOOL_DEFINITIONS : [CREATE_MINIAPP_TOOL];
  // The browser is offered on its own terms, behind the owner's web switch or
  // not: what it reads is a page this computer fetched and checked, not a
  // request the engine sends. So it sits behind the driver being installed and
  // a browser existing, and behind nothing else.
  return browserUsable() ? [...web, ...mail, ...BROWSER_TOOLS] : [...web, ...mail];
}

/**
 * Run one call the model asked for and answer with the text it will read next
 * round: the tool's own words, or the reason it did not run. A tool that fails
 * is a tool result, never a thrown error — the turn has to be able to go on and
 * say what happened.
 */
export async function executeToolCall(
  name: string,
  args: unknown,
  signal: AbortSignal | undefined,
  gate: WebGate | null,
  /** The conversation the model is reading right now, read at call time by
      the web_fetch provenance rule (fetchProvenance.ts). */
  conversation: WireMessage[],
  /** The model running this turn: the mailbox is closed to any but the
      approved ones, so the tool list and the executor agree on who may read. */
  model: string,
  /** The mail this turn was opened for, when the person pressed a button on one
      of its cards: a draft for any other id is refused. */
  openedFor: string | undefined,
  /** The sentence a stopped call answers with, in the owner's language;
      absent is English. */
  stoppedText = "Stopped before this finished.",
): Promise<ToolOutcome> {
  // The turn can be stopped while the arguments are being read; starting a
  // request nobody is waiting for would be work and traffic for nothing.
  //
  // A browser call that is refused here has **never run**, so it must not end
  // the session: the session is shared, and closing it would tear a page out
  // from under the calls already in flight over one Stop. The only Stop→close
  // path is the abort listener in `throughBrowser`, which fires for a Stop that
  // lands on a call that did run.
  if (signal?.aborted) return stopped(stoppedText);
  const record = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  try {
    // Local: it builds here, and the web gate has nothing to hold — the
    // switch governs traffic leaving the machine, not this one.
    if (name === "create_miniapp") {
      return runCreateMiniapp(record);
    }
    // The mailbox runs on this computer, so the web switch says nothing about
    // it: what leaves it is the person's mail and no request made by this tool
    // goes anywhere.
    if (MAIL_TOOLS.some((tool) => tool.function.name === name) || name === "mail_show") {
      if (!mailAllowed(model)) return { text: MAIL_CLOSED, ok: false };
    }
    if (name === "mail_show") {
      return runMailShow(record, conversation);
    }
    if (name === "mail_list") {
      const listed = await runMailList(record, conversation);
      return {
        text: listed.text,
        ok: listed.ok,
        ...(listed.code ? { resultCode: listed.code } : {}),
        ...(listed.cards ? { mail: listed.cards } : {}),
      };
    }
    if (name === "mail_read") {
      const read = await runMailRead(record);
      return { text: read.text, ok: read.ok, ...(read.code ? { resultCode: read.code } : {}) };
    }
    if (name === "mail_draft") {
      const drafted = await runMailDraft(record, openedFor);
      return {
        text: drafted.text,
        ok: drafted.ok,
        ...(drafted.code ? { resultCode: drafted.code } : {}),
        ...(drafted.draft ? { mail: drafted.draft } : {}),
      };
    }
    if (name === "web_search") {
      const query = typeof record.query === "string" ? record.query.trim() : "";
      if (!query) return { text: "No search was made: the query was empty.", ok: false };
      // Egress before the gate: the words leave as they are, so an address
      // among them is a fetch that never asked — allowed only where a fetch
      // of it would run.
      const refusal = searchQueryRefusal(query, conversation);
      if (refusal !== null) return { text: refusal.text, ok: false, resultCode: refusal.code };
      // Read once, before the query leaves: the documents getter is live, and a
      // decision taken from two reads of it is not a decision but a race.
      const gateArmed = armed(gate, conversation);
      // The notice comes after the refusal because nothing is sent there, and
      // before the gate because the owner has to know who receives a search
      // before deciding whether this one may go.
      if (!(await notified(gate, signal))) return heldBack(query, signal, stoppedText);
      if (!(await admitted(gate, "web_search", query, gateArmed, conversation, signal))) return heldBack(query, signal, stoppedText);
      const found = await through("brain_web_search", { query }, signal);
      // Where this turn is armed, the search answers as it always did. Reading
      // pages under it would be the app spending an allowance it was only given
      // for the query — so there, the model's own web_fetch is the only road to
      // a page, and it gets its own ask.
      if (gateArmed) return { text: found, ok: true };
      const pages = await readSearchPages(found, conversation, signal);
      if (pages === null) return stopped(stoppedText);
      return { text: pages.text, ok: true, ...(pages.count > 0 ? { pagesRead: pages.count } : {}) };
    }
    if (name === "web_fetch") {
      let url = typeof record.url === "string" ? record.url.trim() : "";
      if (!url) return { text: "No page was opened: the address was empty.", ok: false };
      // The fragment falls away before anything else sees the address: HTTP
      // never sends it and matching already ignores it, so the model can
      // append nothing of its own to an address the conversation has seen.
      url = url.split("#")[0];
      // Provenance before the gate: an address the conversation never carried
      // is not opened at all, so there is nothing to ask about.
      const refusal = fetchProvenanceRefusal(url, conversation);
      if (refusal !== null) return { text: refusal.text, ok: false, resultCode: refusal.code };
      // The address is checked whole: a URL carries a payload as well as any
      // query does (`...?q=<IBAN>` leaves exactly as much).
      if (!(await admitted(gate, "web_fetch", url, armed(gate, conversation), conversation, signal))) return heldBack(url, signal, stoppedText);
      return { text: await through("brain_web_fetch", { url }, signal), ok: true };
    }
    if (BROWSER_NAMES.has(name)) {
      // The browser runs on this computer and reads a page the app already
      // chose to open, so the web switch says nothing about it — and the gate
      // does not either, because the page was fetched by the sidecar before any
      // of this. What does apply is provenance: an address the conversation has
      // never carried is refused here exactly as web_fetch refuses it, and
      // never reaches the sidecar.
      if (name === "browser_open") {
        const url = typeof record.url === "string" ? record.url.trim() : "";
        if (!url) return { text: "No page was opened: the address was empty.", ok: false };
        const bare = url.split("#")[0];
        const refusal = fetchProvenanceRefusal(bare, conversation);
        if (refusal !== null) return { text: refusal.text, ok: false, resultCode: refusal.code };
        return { text: await browserOpen(bare, signal), ok: true };
      }
      if (name === "browser_read") {
        // No page number is the first page, which is what the model means by
        // leaving it out; a number that is not a whole one is a different thing.
        const page = record.page === undefined ? 1 : wholePage(record.page);
        if (page === null) return { text: "No page was read: the page number was not a whole number.", ok: false };
        return { text: await browserRead(page === 1 ? undefined : page, signal), ok: true };
      }
      const text = typeof record.text === "string" ? record.text.trim() : "";
      if (!text) return { text: "Nothing was searched for: there were no words to look for.", ok: false };
      return { text: await browserFind(text, signal), ok: true };
    }
    const notYet = withheld(name);
    if (notYet !== null) return { text: notYet, ok: false, resultCode: "web.not_offered_yet" };
    return { text: `There is no tool called “${name}”.`, ok: false };
  } catch (error) {
    // A coded refusal from Rust: the wire keeps the English the model
    // reads, the code rides along for the screen.
    const coded = error as { code?: unknown; text?: unknown };
    if (coded !== null && typeof coded === "object" && typeof coded.code === "string" && typeof coded.text === "string") {
      return { text: coded.text, ok: false, resultCode: coded.code };
    }
    // Anything else is a surprise and is passed on as it reads. A rejected command
    // with only a code says that code, not "[object Object]".
    const detail =
      error instanceof Error ? error.message : typeof coded?.code === "string" ? coded.code : String(error);
    return { text: `${name} could not run: ${detail}`, ok: false };
  }
}

/** The page number the model asked for, a whole number and nothing else. */
function wholePage(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(number) && number > 0 ? number : null;
}

/**
 * The gate itself, and the only door it guards. It asks when a document is
 * pinned or mail is in the conversation — either one arms it, so a plain
 * conversation with nothing attached runs exactly as it always did — and the
 * detectors only decide how loudly the question warns, never whether it is asked.
 */

/**
 * The one-time notice, asked in front of the gate's own question: which
 * service this install sends its searches to, once, before the first one
 * leaves. Whether it has been asked already is the page's memory
 * (`webgate/searchNotice.ts`); this only asks and takes the answer.
 */
async function notified(gate: WebGate | null, signal?: AbortSignal): Promise<boolean> {
  if (gate === null) return true;
  let allowed: boolean;
  try {
    allowed = await gate.firstSearch();
  } catch {
    // A page that cannot answer must not fail open: the words stay inside.
    return false;
  }
  // Stop while the notice was up ends the wait with a refusal, and the
  // aborted check below turns it into the turn's own stopped sentence.
  return allowed && !Boolean(signal?.aborted);
}

const MAIL_CLOSED =
  "The mailbox is closed to this AI: it must be one of the approved models. Tell the person to switch AI in Settings → Your AI, then ask again.";
async function admitted(
  gate: WebGate | null,
  tool: GateCheck["tool"],
  outgoing: string,
  gateArmed: boolean,
  conversation: WireMessage[],
  signal?: AbortSignal,
): Promise<boolean> {
  if (gate === null || !gateArmed) return true;
  const docs = gate.documents();
  const findings = [...findSensitive(outgoing), ...findCopied(outgoing, docs)];
  let allowed: boolean;
  try {
    allowed = await gate.confirm({
      tool,
      outgoing,
      findings,
      documentIds: docs.map((d) => d.id),
      mail: mailIn(conversation),
    });
  } catch {
    // A gate that throws must not fail open: the string stays inside.
    return false;
  }
  // Stop while the ask was up ends the wait with a refusal, and the aborted
  // check below turns it into the turn's own stopped sentence.
  return allowed && !Boolean(signal?.aborted);
}

/**
 * Whether this turn's gate would ask the owner anything: a document is pinned,
 * or mail text is in the conversation.
 *
 * A turn with no gate at all — a phone — is not armed, and does its page reads:
 * there the model's own web_fetch runs without an ask either, so skipping them
 * would protect nothing the model could not already do. On the desktop the
 * gate's fetches are confirmed by the owner, and the reads under a search
 * stay behind that allowance rather than spending it.
 */
function armed(gate: WebGate | null, conversation: WireMessage[]): boolean {
  if (gate === null) return false;
  return gate.documents().length > 0 || mailIn(conversation);
}

/** Whether mail text is in the conversation the model is reading: a mail call
    whose answer carries fenced mail, from this turn or an earlier one. A failed
    call or an empty list has no mail in it, so it does not arm the gate. */
function mailIn(conversation: WireMessage[]): boolean {
  const mailIds = new Set<string>();
  for (const message of conversation) {
    if (message.role !== "assistant" || !Array.isArray(message.tool_calls)) continue;
    for (const call of message.tool_calls) {
      if (isMailRun(call.function.name)) mailIds.add(call.id);
    }
  }
  return conversation.some(
    (message) =>
      message.role === "tool" &&
      typeof message.tool_call_id === "string" &&
      mailIds.has(message.tool_call_id) &&
      typeof message.content === "string" &&
      carriesMail(message.content),
  );
}

/** The tool result a held call answers with, so the turn goes on and says
    what happened instead of throwing. */
function heldBack(outgoing: string, signal: AbortSignal | undefined, stoppedText: string): ToolOutcome {
  if (signal?.aborted) return stopped(stoppedText);
  return {
    text: `Not run: the owner did not allow this to leave the app. Nothing was sent — the text began “${outgoing.slice(0, 80)}”.`,
    ok: false,
  };
}

function stopped(text: string): ToolOutcome {
  return { text, ok: false };
}
