import { isBrowserRun } from "../browser/runs";
import { isMailRun } from "../mail/runs";
import { TOOL_STOPPED } from "../types";
import type { ChatMessage } from "../types";
import type { Source } from "./pick";

/**
 * The text of the documents a turn bound, by the id its message carries. The
 * digest reads the text the model would have read with them, and nothing
 * else: a document the store no longer holds has no text here and rides
 * nothing.
 */
export type DocumentTexts = ReadonlyMap<string, string>;

/**
 * The texts of the turns the fit left behind, each stamped with its turn and
 * with whose words they are: the person's, the model's, a page the browser
 * read, or a document the person attached. A turn is a user message and the
 * answers that follow it; the shed always starts at the conversation's first
 * message, so counting the turns from here gives the number the person sees.
 *
 * **A turn that ran mail is skipped whole**, because the model's words about
 * that mail are the owner's too.
 */
export function sourcesOf(shed: ChatMessage[], documents: DocumentTexts): Source[] {
  const sources: Source[] = [];
  let turn = 0;
  for (const messages of turnsOf(shed)) {
    if (messages[0]?.role === "user") turn++;
    if (messages.some(ranMail)) continue;
    const number = Math.max(1, turn);
    for (const message of messages) {
      // The order is the wire's order: a turn's documents ride before its
      // words, and a turn's tool answers ride before the model's own reply.
      if (message.role === "user") {
        for (const text of documentsOf(message, documents)) {
          sources.push({ turn: number, role: "document", text });
        }
      } else {
        for (const text of pagesOf(message)) {
          sources.push({ turn: number, role: "tool", text });
        }
      }
      if (message.content === "") continue;
      sources.push({
        turn: number,
        role: message.role === "user" ? "user" : "assistant",
        text: message.content,
      });
    }
  }
  return sources;
}

/** A turn is a user message and the answers that follow it, until the next
    user message. */
function turnsOf(shed: ChatMessage[]): ChatMessage[][] {
  const turns: ChatMessage[][] = [];
  for (const message of shed) {
    const last = turns[turns.length - 1];
    if (message.role === "user" || last === undefined) turns.push([message]);
    else last.push(message);
  }
  return turns;
}

/** The documents this turn bound, as their text. */
function documentsOf(message: ChatMessage, documents: DocumentTexts): string[] {
  const texts: string[] = [];
  for (const id of message.docs ?? []) {
    const text = documents.get(id);
    if (text !== undefined && text !== "") texts.push(text);
  }
  return texts;
}

/**
 * The pages the browser read, as the model read them: a run's own answer. A
 * run that answered nothing carries nothing, a run that died mid-way carries
 * its code, not a page, and a run the app refused never went to the model at
 * all — so its answer is not one the model read.
 */
function pagesOf(message: ChatMessage): string[] {
  const texts: string[] = [];
  for (const run of message.toolRuns ?? []) {
    if (!isBrowserRun(run.name)) continue;
    if (run.state === "refused") continue;
    if (run.result === "" || run.result === TOOL_STOPPED) continue;
    texts.push(run.result);
  }
  return texts;
}

function ranMail(message: ChatMessage): boolean {
  return (message.toolRuns ?? []).some((run) => run.mail !== undefined || isMailRun(run.name));
}
