import { listen } from "../tauri";
import { browserAnswer, browserPause, browserResume, type ConversationId } from "../tools/browserCall";

/** One field of a card: the value as it will be sent, and whether the window
 * should draw it as dots.
 *
 * **A secret field carries its value.** The card is what the person decides on,
 * and a card that blanks a field — on the page's word, or on anything the page
 * can call — cannot be decided on. So it is drawn as dots with a Show button,
 * and the value lives in the card's own state while that card is on the screen:
 * not in a message, not in the store, not in a log, not on disk.
 */
export interface CardField {
  name: string;
  value: string;
  secret: boolean;
  /** The words the page puts beside the field, or `null` when it gave none. Display
   * only: the card draws it in place of the name, and nothing decides on it. */
  label: string | null;
}

/** What a secret field is drawn as until the person asks to read it. */
export const DOTS = "••••••••";

/** One request, as a person is shown it: what it would send, as sent. */
export interface Card {
  id: string;
  method: string;
  url: string;
  fields: CardField[];
  /** The chat whose turn caused it. A card is drawn and answered only in its own
   * chat, and this is what makes that true here rather than only in Rust. */
  conversation: ConversationId;
  /** When it first appeared, so the card can count down the person's five
   * minutes. Rust owns this and keeps it steady across a redraw. */
  askedAtMs: number;
  /** **Where it goes, told by the sidecar's own parser. `null` is a card with
   * no destination**: nothing here works it out, so nothing here may show a
   * host — and there is nothing for a person to be agreeing to if they press
   * send, which is why such a card is drawn without one. */
  destination: Destination | null;
}

/** The three fields a destination is, or `null`. **Checked rather than trusted**
 *  for the same reason as a code: this is what the window shows a person as the
 *  place their data goes, and a host nobody parsed is not one to show. */
function readDestination(payload: unknown): Destination | null {
  if (payload === null || typeof payload !== "object") return null;
  const said = payload as { host?: unknown; port?: unknown; secure?: unknown };
  if (typeof said.host !== "string" || said.host === "") return null;
  const port = said.port === null || said.port === undefined ? null : said.port;
  if (port !== null && (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535)) return null;
  return { host: said.host, port, secure: said.secure === true };
}

/** Rust says the whole list, every time: there is no shape to guess at. */
function readCards(payload: unknown): Card[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((one) => {
    if (one === null || typeof one !== "object") return [];
    const card = one as Record<string, unknown>;
    if (typeof card.id !== "string" || typeof card.method !== "string" || typeof card.url !== "string") return [];
    const fields = Array.isArray(card.fields) ? card.fields : [];
    return [
      {
        id: card.id,
        method: card.method,
        url: card.url,
        // A card that names no conversation belongs to none: it is drawn in no
        // chat, so a window cannot offer a button that would be refused.
        conversation: typeof card.conversation === "string" ? card.conversation : "",
        askedAtMs: typeof card.askedAtMs === "number" ? card.askedAtMs : 0,
        destination: readDestination(card.destination),
        fields: fields.flatMap((field) => {
          if (field === null || typeof field !== "object") return [];
          const one = field as Record<string, unknown>;
          if (typeof one.name !== "string" || typeof one.value !== "string") return [];
          return [{
            name: one.name,
            value: one.value,
            secret: one.secret === true,
            label: typeof one.label === "string" && one.label !== "" ? one.label : null,
          }];
        }),
      },
    ];
  });
}

let cards: Card[] = [];
/** The cards the person has answered, in the order they were answered, until the
 * conversation that caused them takes its outcomes. Each stays on the window as one
 * line — what became of it — and never as its fields. `outcome` is `null` between the
 * press and the sidecar's word. */
export interface Settled {
  id: string;
  conversation: ConversationId;
  outcome: Outcome | null;
}
const settled = new Map<string, Settled>();
/** What became of a request, per conversation, waiting for that chat's next turn.
 * Never drained by anybody but the conversation it belongs to. */
const outcomes = new Map<ConversationId, Outcome[]>();
const listeners = new Set<() => void>();

function tell(): void {
  for (const listener of listeners) listener();
}

/** The cards still waiting for the person: an answered card is no longer one. */
export function currentCards(): Card[] {
  return cards.filter((card) => !settled.has(card.id));
}

/** The answered cards of one conversation, as lines, in the order they were answered. */
export function settledFor(conversation: ConversationId): Settled[] {
  return [...settled.values()].filter((one) => one.conversation === conversation);
}

/**
 * **Pausa, as the person presses it.** The sidecar is told first, and the page
 * is told what the sidecar said — by the backend, as an event, so a pause that
 * was not taken is never drawn. Resuming reads the page again, which is what
 * stops the model reasoning about a page the person has had the window since.
 *
 * The flag belongs to the backend's slot rather than to this file or to the
 * button: see `window.ts` for the mirror, and `host.rs` for the record that a
 * session takes its pause with it.
 *
 * **The local flag was never enough**, and never was: the sidecar is what stops
 * holding, so without this the person would be pausing a button.
 */
export async function pressPause(next: boolean): Promise<void> {
  try {
    if (next) await browserPause();
    else await browserResume();
  } catch {
    // A pause that could not be delivered moves nothing: the sidecar did not take
    // it, so no event says the window is paused and the button still reads as it
    // was — a refusal that changed the words would be the one lie this control
    // must not tell.
  }
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * What became of a request, as a code and a host — **and nothing else.**
 *
 * The sidecar's sentence used to be carried here verbatim, which is how a
 * stranger's path, and whatever their site wrote in the query, reached a model
 * and then a disk. What arrives now is a word from a closed set and a host name
 * Rust parsed out of the address, and the sentence below is written here, out of
 * this file's own copy.
 */
export interface Outcome {
  code: Code;
  host: string;
}

/** Every outcome this app can be told about, and nothing else. An outcome in a
 * seventh shape is not one to invent a sentence for: it is unclear, which is
 * the honest reading and the safe one. */
export const CODES = ["sent", "declined", "expired", "gone", "unsendable", "unclear"] as const;
export type Code = (typeof CODES)[number];

/** Where a request goes, **as the machine that will send it parsed it**: the bare
 *  host, the port when the address names one that is not its scheme's default, and
 *  whether the connection is the secure one. Nothing else of the address is shown —
 *  no scheme name, no path, no query, no user.
 *
 *  **It is never worked out from `url` here.** A second parser is a second
 *  answer: a rule written here and the browser's own disagree about a backslash,
 *  an extra `@` or a space, and a card that names one host over a request going to
 *  another is the one card that must never exist. The computer that sends the
 *  request says where it goes, and this window shows what it was told.
 */
export interface Destination {
  host: string;
  /** `null` when the address names no port, or names the one its own scheme
   *  would use anyway. */
  port: number | null;
  secure: boolean;
}

/** How a destination is drawn: a host with its port when there is one, and
 *  nothing else. `null` is a card this window is told nothing about — the one
 *  thing it is not allowed to guess at. */
export function destinationLabel(destination: Destination | null): string {
  if (destination === null) return "";
  return destination.port === null ? destination.host : `${destination.host}:${destination.port}`;
}

/** Reads what Rust said into an outcome, or `null` if it is not one. */
function readOutcome(payload: unknown): Outcome | null {
  if (payload === null || typeof payload !== "object") return null;
  const said = payload as { code?: unknown; host?: unknown };
  const code = typeof said.code === "string" ? said.code : "";
  if (!CODES.includes(code as Code)) return null;
  // The host is checked here as well as in Rust: a host is a bare name, and
  // this line is the last one before the words above exist.
  const host = typeof said.host === "string" ? said.host : "";
  const bare = host !== "" && /^[a-z0-9.-]+$|^\[[0-9a-f:.]+\]$/i.test(host);
  return { code: code as Code, host: bare ? host : "" };
}

/** What the model has not been told yet, for one conversation, in the order it
 * happened. **Empty for a conversation that caused nothing**, which is every
 * conversation but one.
 *
 * The model is told on the next turn, not by a turn that waits. A person is
 * slower than any tool deadline, so a turn that blocked on the card would hang
 * the whole chat for minutes and Stop would have to interrupt it. Instead the
 * sentence rides along with the next thing the person says — which is a moment
 * the model is certainly reading something — and a turn is never held up by a
 * button. It is the same shape as the sidecar's own: an outcome is prefixed to
 * the next tool result, so a model that keeps working hears it there too.
 */
export function pendingOutcomes(conversation: ConversationId): Outcome[] {
  return [...(outcomes.get(conversation) ?? [])];
}

/** Drains one conversation's, so an outcome is told once and not again a turn
 * later — and so one chat's outcomes are never drained by another's turn. */
export function takeOutcomes(conversation: ConversationId): Outcome[] {
  const said = outcomes.get(conversation) ?? [];
  outcomes.delete(conversation);
  // The lines were the window's account of these answers, and the model has now been
  // told them: the window lets them go with the outcomes.
  for (const one of settledFor(conversation)) settled.delete(one.id);
  tell();
  return said;
}

function queue(conversation: ConversationId, outcome: Outcome): void {
  outcomes.set(conversation, [...(outcomes.get(conversation) ?? []), outcome]);
}

/** What a `browser_cards` event said, parsed and set. Named for the check that
 * drives it: there is no window here, and a proof about what is drawn needs a
 * way to draw it. */
export function noteCards(payload: unknown): void {
  cards = readCards(payload);
  tell();
}

/** What a `browser_answered` event said, queued for the conversation it names.
 *
 * **A conversation nobody has is still a conversation**, so the outcome waits for
 * that chat rather than landing in whichever one is on screen: it is not lost,
 * and it is not delivered to a turn that never caused the request.
 */
export function noteAnswered(payload: unknown): void {
  if (payload === null || typeof payload !== "object") return;
  const said = payload as { id?: unknown; conversation?: unknown };
  const outcome = readOutcome(payload);
  if (outcome === null || typeof said.conversation !== "string") return;
  queue(said.conversation, outcome);
  // The line for this card, if the window still has it, says what became of it.
  if (typeof said.id === "string" && settled.has(said.id)) settled.get(said.id)!.outcome = outcome;
  tell();
}

/**
 * The one subscription, started once at the app's root and never torn down: a
 * card belongs to the window, not to whichever surface happens to be on screen.
 */
export function startConfirmBus(): Promise<() => void> {
  return Promise.all([listen("browser_cards", (payload) => {
    cards = readCards(payload);
    tell();
  }), listen("browser_answered", noteAnswered)]).then((stops) => () => stops.forEach((stop) => stop()));
}

/**
 * The person's answer, and what became of the request.
 *
 * **The card comes off the window first**, so a second press of the same button
 * finds nothing to press about — and the id is spent inside the sidecar before
 * anything is dispatched, so the window cannot send one request twice even by
 * being asked to.
 *
 * **A press that could not be delivered is reported, not swallowed.** The card
 * was spent and no answer came back, so whether the request went is exactly what
 * nobody can say — and both the person and the model are told so. Saying nothing
 * would leave the model to carry on believing nothing happened, while a stranger's
 * server may already have it.
 */
export async function answer(allow: boolean, id: string, conversation: ConversationId): Promise<string | null> {
  // A press for a card that is not on the window is refused here, before the
  // app is asked: the sidecar spends the id before it dispatches, so this is not
  // what makes an answer single-use — it is what keeps a second press from being
  // a second request's worth of work for no answer at all.
  if (settled.has(id) || !cards.some((one) => one.id === id)) return null;
  // The card collapses to its line at once; its fields leave the window with it.
  settled.set(id, { id, conversation, outcome: null });
  tell();
  try {
    return await browserAnswer(allow, id, conversation);
  } catch {
    // Unclear, and queued for the conversation that caused it, so the next thing
    // the person says in that chat carries it.
    const unclear: Outcome = { code: "unclear", host: "" };
    queue(conversation, unclear);
    settled.get(id)!.outcome = unclear;
    tell();
    return null;
  }
}
