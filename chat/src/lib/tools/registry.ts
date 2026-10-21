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
import { browserEntry, fetchProvenanceRefusal, searchQueryRefusal } from "./fetchProvenance";
import { readSearchPages } from "./searchPages";
import { runMailDraft, runMailList, runMailRead } from "./mailCall";
import { runMailShow } from "./mailShow";
import { BROWSER_NAMES, BROWSER_TOOLS } from "./browserTools";
import { logBrowserFailure, logProvenanceFailure } from "../browser/diagnostics";
import { isPaused } from "../browser/window";
import { browserUsable } from "../browser/usable";
import { browserClick, browserFind, browserOpen, browserRead, browserType, fence } from "./browserCall";
import { browserCode, LINK_UNSEEN } from "../browser/codes";
import * as ledger from "../callLedger";
import { mailAllowed } from "../mail/allowlist";
import { isMailRun } from "../mail/runs";
import { carriesMail } from "../mail/fence";
import type { Language } from "../../i18n";

/**
 * The sentence a call the turn has already refused gets. **The code is the
 * reason, and the model is told so in as many words as it takes to stop
 * asking** — "you have already tried this" is not something a model can act on,
 * but a code it has seen twice is.
 */
function refusedTwice(code: string, name: string): string {
  const what = `browser.${name.replace(/^browser_/, "").replace(/_/g, " ")}`;
  return code === "browser.too_many_steps"
    ? `No more browser steps this turn: Kalsa has already run ${ledger.BROWSER_CALLS_PER_TURN}. Answer the person, or stop asking the browser.`
    : code === "browser.already_run"
      ? `You already asked for that ${what} since the page last changed, and have its answer above. Do not ask again.`
      : code === LINK_UNSEEN
        ? `You already asked for that ${what} in this turn and it failed with ${code}: that address has not appeared in the conversation. Click its ref instead: use browser_read or browser_find to find the link on the page, then click its ref.`
        : `You already asked for that ${what} in this turn and it failed with ${code}, which will not change on a second try. Say what you will do instead, or stop.`;
}

/** What one held call looks like to the page: which tool, the exact string
    that would leave, what the detectors saw in it, and what armed the gate at
    all — the documents pinned, and whether the mailbox is in the conversation. */
export interface GateCheck {
  tool: "web_search" | "web_fetch" | "browser_click" | "browser_type";
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
/** What a paused browser says for itself: a plain sentence, because the model
 * reads it and not a person, and it names what did not happen. */
const PAUSED =
  "The browser is paused: the person has asked that nothing more be done in it. Nothing was sent. \
Say what you would have done, and wait.";

/** What a browser call says when the owner has turned the web off. */
const WEB_OFF =
  "Not run: web access is switched off in Settings, so Kalsa is not opening or driving a \
browser. Nothing was sent. Answer from the conversation, or ask the person to turn it on.";

/**
 * Which family of tools a turn may offer. **The two never sit in the same
 * list**: the person chooses, not the model. The composer carries a "Browse
 * for me" control, and the turn it arms is a browser turn — the web tools are
 * then not offered at all, so a model that would rather search than open a
 * page cannot.
 */
export type ToolMode = "web" | "browser";

export function offeredTools(
  enabled: boolean,
  language: Language,
  model: string,
  /** The family this turn may offer. Required on purpose: a caller that
   *  forgets to say which turn it is building is a compile error, not a
   *  silent choice between the browser and the web. */
  mode: ToolMode,
): ToolDefinition[] {
  if (!available()) return [];
  const mail = mailAllowed(model) ? [...MAIL_TOOLS, mailShowTool(language)] : [];
  // **The armed turn is the browser's turn and nothing else.** The person armed
  // it because the task needs a real page — a search result is not a page, and
  // a mini app is not a page — so the browser's five tools are the whole list.
  // The web tools are not offered beside them: a list with both families in it
  // is a list the model chooses from, and the choice is not the person's.
  if (mode === "browser") {
    // The browser is behind the owner's web switch, like everything else that
    // reaches the web — and behind the driver being installed. An armed turn
    // with no browser to drive offers nothing at all: it would answer in words,
    // which is the honest answer for a browser that cannot open.
    return browserUsable() && enabled ? [...BROWSER_TOOLS] : [];
  }
  const web = enabled ? TOOL_DEFINITIONS : [CREATE_MINIAPP_TOOL];
  // **The web tools are behind the owner's web switch, like everything else
  // that reaches the web.** Step 4 made these tools able to *send*, and an
  // owner who turned the web off did so because this computer should not be
  // reaching out — a window opening a stranger's page is that, whatever runs
  // the fetch. So the switch is checked here, where it is an offer, and again
  // at the call, where an offer cannot be the only thing standing between a
  // model and the network: a name in a tool list is something the model wrote,
  // not a promise.
  //
  // **And the browser's tools are not in this list at all.** A turn that was not
  // armed for the browser is a web turn; the two families are exclusive, and
  // the control in the composer is what arms the browser's.
  return [...web, ...mail];
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
  /** Whether the owner has left web access on. **Read at the call and not only
   *  at the offer**: a name in a tool list is something the model wrote, so a
   *  browser call is refused here as well as being withheld from the list.
   *  Absent is off — a caller that forgot is exactly the case this closes. */
  webOn = false,
  /** The chat this turn belongs to, which every write it causes is stamped with:
   *  a card is drawn and answered in its own conversation, and its outcome
   *  rides that chat's next turn and no other. Empty is a conversation nobody
   *  can be in, so a caller that forgot raises cards it cannot itself answer —
   *  refused here and in the UI, rather than sent to the wrong chat. */
  conversationId = "",
  /** What this turn has already done and already failed at, for the browser's
   *  five tools. Absent means no ledger — a caller that never had one keeps the
   *  behaviour of a turn with nothing to remember, which is the honest answer
   *  for a turn that did not open a page. */
  calls: ledger.Ledger | null = null,
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
      // The switch, checked at the call as well as at the offer. See
      // `offeredTools`: an offer is something the model can write past.
      if (name.startsWith("browser_") && !webOn) {
        return { text: WEB_OFF, ok: false, resultCode: "web.switch_off" };
      }
      // Pausa is checked here, before anything is asked of the sidecar and
      // before a single argument is read: a paused browser acts no further, and
      // a card already on screen is still answered — pausing is not declining.
      // **Every browser tool, not only the two that write, and before the reads
      // and the find.** A paused browser that still opens a page and reads
      // around inside it is a browser Kalsa is driving, and the person pressed
      // a button that says it is not. It sits after the switch above so a
      // browser that is off is told the truth about why; the sidecar refuses
      // the same five the same way, so a caller that skipped this gate still
      // stops.
      if (isPaused() && BROWSER_NAMES.has(name)) {
        return { text: PAUSED, ok: false, resultCode: "browser.paused" };
      }
      // **What the turn already knows about this exact action.** Asked before any
      // argument is read and before the browser is asked anything: a call that
      // already ran in this round reuses its answer, and one that failed with a
      // code is refused with that code rather than run again. There is no retry
      // here and none below — the same element fails the same way.
      if (calls !== null && BROWSER_NAMES.has(name)) {
        const said = ledger.decide(calls, name, record);
        if (!said.run) {
          return {
            // **The reason the call failed the first time**, not the ledger's
            // own word for "it failed again": the model is told what happened,
            // so it can do something else instead of asking a third time.
            text: refusedTwice(said.said, name),
            ok: false,
            resultCode: said.answer === null ? said.code : "browser.already_run",
          };
        }
      }
      if (name === "browser_open") {
        const url = typeof record.url === "string" ? record.url.trim() : "";
        if (!url) {
          logBrowserFailure("open_empty");
          return { text: "No page was opened: the address was empty.", ok: false };
        }
        const bare = url.split("#")[0];
        // The gate must inspect the address actually opened, including a
        // homepage restored to the spelling the user named.
        const entry = browserEntry(bare, conversation);
        if (entry.refusal !== null) {
          logProvenanceFailure(entry.refusal.code);
          return { text: entry.refusal.text, ok: false, resultCode: entry.refusal.code };
        }
        // **The gate `web_fetch` goes through, because opening an address is
        // exactly what web_fetch does.** Step 3 reasoned that the browser "reads
        // a page this computer fetched and checked, not a request the engine
        // sends" — true, and beside the point: the owner being asked about text
        // leaving the app is asked about the address leaving the app, whoever
        // types it. A turn armed by a pinned document or by mail has to ask
        // about this one too, or the ask is a thing a model chooses by using
        // the other tool.
        const allowed = await admitted(gate, "web_fetch", entry.url, armed(gate, conversation), conversation, signal);
        if (!allowed) {
          // A Stop is not the owner saying no, so it is not the gate's category.
          if (!signal?.aborted) logBrowserFailure("open_gate");
          return heldBack(entry.url, signal, stoppedText);
        }
        // A Stop that landed while the owner was being asked. **Nothing has run
        // and no session was started**, so this must not end one: the session is
        // shared, and closing it would tear a page out from under the calls
        // already in flight over the same Stop. See the note at the top of this
        // function — asking first is what made this window exist, and it is why
        // the abort is read here rather than left to `throughBrowser`.
        if (signal?.aborted) return stopped(stoppedText);
        return { text: await browserOpen(entry.url, conversationId, signal), ok: true };
      }
      if (name === "browser_read") {
        // No page number is the first page, which is what the model means by
        // leaving it out; a number that is not a whole one is a different thing.
        const page = record.page === undefined ? 1 : wholePage(record.page);
        if (page === null) return { text: "No page was read: the page number was not a whole number.", ok: false };
        return { text: await browserRead(page === 1 ? undefined : page, conversationId, signal), ok: true };
      }
      if (name === "browser_click") {
        const ref = typeof record.ref === "string" ? record.ref.trim() : "";
        if (!ref) return { text: "Nothing was clicked: there was no element to click.", ok: false };
        // **A click is a gate call too.** A click navigates, and on a page the
        // model was given — a document, a mail — the address it lands on is the
        // document's own words going to a stranger's server. Not asking here is
        // how a search that asks becomes a click that does not.
        const allowed = await admitted(gate, "browser_click", ref, armed(gate, conversation), conversation, signal);
        if (!allowed) return heldBack(ref, signal, stoppedText);
        if (signal?.aborted) return stopped(stoppedText);
        return { text: await browserClick(ref, conversationId, signal), ok: true };
      }
      if (name === "browser_type") {
        // The text is not trimmed: a space is something a person typed into a
        // field, and a form that submits on a space is a real thing.
        const ref = typeof record.ref === "string" ? record.ref.trim() : "";
        if (!ref) return { text: "Nothing was typed: there was no field to type into.", ok: false };
        if (typeof record.text !== "string") {
          return { text: "Nothing was typed: there were no words to type.", ok: false };
        }
        // **And what is typed is the model's own words going out.** This is the
        // one browser call that carries text, so it is the one that most needs the
        // gate: a passphrase read out of a mail, typed into a form, submitted.
        const allowed = await admitted(gate, "browser_type", record.text, armed(gate, conversation), conversation, signal);
        if (!allowed) return heldBack(record.text, signal, stoppedText);
        if (signal?.aborted) return stopped(stoppedText);
        return { text: await browserType(ref, record.text, conversationId, signal), ok: true };
      }
      const text = typeof record.text === "string" ? record.text.trim() : "";
      if (!text) return { text: "Nothing was searched for: there were no words to look for.", ok: false };
      return { text: await browserFind(text, conversationId, signal), ok: true };
    }
    return { text: `There is no tool called “${name}”.`, ok: false };
  } catch (error) {
    // A coded refusal from Rust: the wire keeps the English the model
    // reads, the code rides along for the screen.
    const coded = error as { code?: unknown; text?: unknown };
    if (coded !== null && typeof coded === "object" && typeof coded.code === "string" && typeof coded.text === "string") {
      // **A refusal is fenced like an answer.** It can carry the page's own words
      // — a label, a field name — and those are page text like any other.
      return { text: fence(coded.text), ok: false, resultCode: browserCode(coded.code) };
    }
    // Anything else is a surprise and is passed on as it reads. A rejected command
    // with only a code says that code, not "[object Object]".
    const detail =
      error instanceof Error ? error.message : typeof coded?.code === "string" ? coded.code : String(error);
    // A failure with no code of its own: the log cannot tell it from any other,
    // and the sentence below carries the reason in prose.
    if (name === "browser_open") logBrowserFailure("open_uncoded");
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
  return armedConversation(conversation, gate.documents().map((doc) => doc.id));
}

/**
 * Whether this conversation holds something its owner would not want typed into
 * a website: mail the model has read, or a document pinned in this chat.
 *
 * **One rule, asked two ways.** The desktop's own gate asks its store, because a
 * desktop chat can pin a document. A phone's turn runs the same loop with no gate
 * and no store — a phone has no Settings → Documents and pins nothing — so it has
 * no documents and can only be armed by mail, which the conversation carries.
 * The mail half is the same function either way, and a conversation that is
 * armed is armed for the same reason in both: **the model is holding something
 * the owner's, and a browser is a place things go out to.**
 *
 * Exported because the phone's rule is this rule: it is the same question, asked
 * about the same conversation, and it must not be answered twice in two places.
 */
export function armedConversation(conversation: WireMessage[], documents: readonly string[] = []): boolean {
  return documents.length > 0 || mailIn(conversation);
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
