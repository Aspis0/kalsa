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
        fields: fields.flatMap((field) => {
          if (field === null || typeof field !== "object") return [];
          const one = field as Record<string, unknown>;
          if (typeof one.name !== "string" || typeof one.value !== "string") return [];
          return [{ name: one.name, value: one.value, secret: one.secret === true }];
        }),
      },
    ];
  });
}

let cards: Card[] = [];
let paused = false;
/** What became of a request, per conversation, waiting for that chat's next turn.
 * Never drained by anybody but the conversation it belongs to. */
const outcomes = new Map<ConversationId, Outcome[]>();
const listeners = new Set<() => void>();

function tell(): void {
  for (const listener of listeners) listener();
}

/** What the window is drawing right now. */
export function currentCards(): Card[] {
  return cards;
}

/** Whether the person has pressed Pausa. */
export function isPaused(): boolean {
  return paused;
}

/** Pressed from a control, so it changes here and every card redraws. */
export function setPaused(next: boolean): void {
  if (paused === next) return;
  paused = next;
  tell();
}

/**
 * **Pausa, as the person presses it.** The sidecar is told first, and the flag
 * moves only if it said yes — a control that reads "paused" while the browser is
 * still being driven is worse than no control, because it is a promise nobody
 * kept. Resuming reads the page again, which is what stops the model reasoning
 * about a page the person has had the window since.
 *
 * **The local flag alone is not enough**, and never was: the sidecar is what
 * stops holding, so without this the person would be pausing a button.
 */
export async function pressPause(next: boolean): Promise<boolean> {
  try {
    if (next) await browserPause();
    else await browserResume();
  } catch {
    return paused;
  }
  paused = next;
  tell();
  return paused;
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

/**
 * What the model is told, in this app's own words.
 *
 * **One sentence per outcome, and a host only where there was a request to
 * name.** A decline, an expiry and a window that closed never mention an
 * address: nobody sent anything, and saying where a request would have gone
 * teaches a model to go looking for it again.
 */
export function outcomeSentence({ code, host }: Outcome): string {
  switch (code) {
    case "sent":
      return `The person allowed the request, and it was sent to ${host || "the site"}.`;
    case "declined":
      // Said the same way whether a person pressed "no" or the window closed with
      // the card on it: in both cases nothing was allowed through, and in both
      // cases nothing was sent.
      return "The request was not allowed. Nothing was sent, and the page is as it was.";
    case "expired":
      return "Nobody answered the request in time, so it was given up on. Nothing was sent.";
    case "gone":
      return "The browser window closed before the request was answered, so it was given up on. Nothing was sent.";
    case "unsendable":
      return "The request could not be shown to the person as it would have been sent, so it was never sent.";
    default:
      return "Whether the request was sent could not be established. It may have been sent, and it has not been tried again.";
  }
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
  tell();
  return said;
}

function queue(conversation: ConversationId, outcome: Outcome): void {
  outcomes.set(conversation, [...(outcomes.get(conversation) ?? []), outcome]);
}

/** The newest thing that became of a request in this conversation, for the line
 * under the cards. **One chat's outcome is nobody else's**: the person reads what
 * they just decided here, and a chat that caused nothing shows nothing rather
 * than somebody else's request going out.
 */
export function latestOutcome(conversation: ConversationId): Outcome | null {
  const said = outcomes.get(conversation);
  return said && said.length > 0 ? said[said.length - 1] : null;
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
  const said = payload as { conversation?: unknown };
  const outcome = readOutcome(payload);
  if (outcome === null || typeof said.conversation !== "string") return;
  queue(said.conversation, outcome);
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
  const card = cards.find((one) => one.id === id);
  if (!card) return null;
  cards = cards.filter((one) => one.id !== id);
  tell();
  try {
    return await browserAnswer(allow, id, conversation);
  } catch {
    // Unclear, and queued for the conversation that caused it, so the next thing
    // the person says in that chat carries it.
    queue(conversation, { code: "unclear", host: "" });
    tell();
    return null;
  }
}

/** The line these outcomes ride under, in the model's words rather than the
 * person's: they came from Rust as a code and a host, and this only says that
 * they are here and what became of them — in sentences written here, not
 * forwarded from the sidecar. */
export function browserOutcomesNote(outcomes: Outcome[]): string {
  if (outcomes.length === 0) return "";
  return [
    "About the browser: since you last spoke, the person was asked about a request and answered it. What follows is this app's own account of what happened, and it repeats no field of the request.",
    ...outcomes.map((one) => `- ${outcomeSentence(one)}`),
    "Carry on from this. It was a button the person pressed, not an answer from them to you.",
  ].join("\n");
}