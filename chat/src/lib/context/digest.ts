import type { Attachment } from "../attachments";
import type { WireMessage } from "../chat";
import type { ChatMessage } from "../types";
import { fragmentLine, pickFragments, type Source } from "./pick";

/** The block's room, in tokens: what the cap says, measured the house way. */
export const DIGEST_CAP_TOKENS = 400;

/** The house rule for the block's weight: a token is three and a half
    characters. The cap is spent in these, so the block never weighs more
    than the cap whichever way it is counted. */
const CHARS_PER_TOKEN = 3.5;

/** The fixed line the block opens with. Model-facing copy, in English like the
    rest of the wire: it says what the lines are and why they are there. */
export const DIGEST_HEADER =
  "[Kalsa older turns] Facts from earlier exchanges that fell out of the window, picked because they match this turn:";

/**
 * The digest block for one turn: the sentences of the turns the fit left
 * behind (`shed`) that match what this turn asks, verbatim and stamped. Empty
 * when the switch is off, when nothing was left behind, or when nothing in
 * what was left behind matches. The recent window is never searched: it stays
 * as the fit kept it.
 */
export function digestForTurn(
  enabled: boolean,
  shed: ChatMessage[],
  kept: ChatMessage[],
  docs: Attachment[],
  cap: number = DIGEST_CAP_TOKENS,
): string {
  if (!enabled || shed.length === 0) return "";
  const query = queryOf(kept);
  if (query === "") return "";
  const room = Math.floor(cap * CHARS_PER_TOKEN) - DIGEST_HEADER.length;
  const picked = pickFragments(sourcesOf(shed, docs), query, room);
  if (picked.length === 0) return "";
  return [DIGEST_HEADER, ...picked.map(fragmentLine)].join("\n");
}

/**
 * The block placed at the head of the last user message's own content, which
 * is the end of the history: the wire's prefix up to that message does not
 * change, and the block never comes before the history. An empty block leaves
 * the wire as it was, the same array.
 */
export function withDigest(wire: WireMessage[], block: string): WireMessage[] {
  if (block === "") return wire;
  let last = -1;
  for (let i = wire.length - 1; i >= 0; i--) {
    if (wire[i]?.role === "user") {
      last = i;
      break;
    }
  }
  const message = wire[last];
  if (last < 0 || message === undefined) return wire;
  const content: WireMessage["content"] =
    typeof message.content === "string"
      ? `${block}\n\n${message.content}`
      : [{ type: "text", text: block }, ...message.content];
  return wire.map((item, i) => (i === last ? { ...item, content } : item));
}

/** The query: the turn's own words, and the answer before them when there is
    one. The kept history ends with the current user message. */
function queryOf(kept: ChatMessage[]): string {
  let current = -1;
  for (let i = kept.length - 1; i >= 0; i--) {
    if (kept[i]?.role === "user") {
      current = i;
      break;
    }
  }
  if (current < 0) return "";
  const asked = kept[current]?.content ?? "";
  let answered = "";
  for (let i = current - 1; i >= 0; i--) {
    const message = kept[i];
    if (message?.role === "assistant" && message.content !== "") {
      answered = message.content;
      break;
    }
  }
  return answered === "" ? asked : `${asked}\n${answered}`;
}

/** The text of each left-behind message, stamped with its turn. A turn is a
    user message and the answer that follows it; the shed always starts at the
    conversation's first message, so counting from here gives the number the
    person sees. */
function sourcesOf(shed: ChatMessage[], docs: Attachment[]): Source[] {
  const byId = new Map(docs.map((doc) => [doc.id, doc] as const));
  const sources: Source[] = [];
  let turn = 0;
  for (const message of shed) {
    if (message.role === "user") turn++;
    const stamp = Math.max(1, turn);
    if (message.role === "user") {
      for (const id of message.docs ?? []) {
        const doc = byId.get(id);
        if (doc !== undefined) sources.push({ turn: stamp, role: "document", text: doc.text });
      }
    }
    if (message.content !== "") {
      sources.push({ turn: stamp, role: message.role === "user" ? "user" : "assistant", text: message.content });
    }
    for (const run of message.toolRuns ?? []) {
      if (run.state !== "refused" && run.result !== "") {
        sources.push({ turn: stamp, role: "tool", text: run.result });
      }
    }
  }
  return sources;
}
