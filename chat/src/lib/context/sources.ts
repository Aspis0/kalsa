import { pageText } from "../pageFence";
import { isMailRun } from "../mail/runs";
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
        // **A document's words ride as they are.** The wire already sent them
        // as plain user text — the attached documents are a block of the
        // person's own message — so the digest carries them the same way, and
        // a fence around them would fence the person's words.
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
 * The pages the browser read, as the model read them: **the fenced payload of
 * a run's answer.**
 *
 * **The fence is the mark, not the name of the call.** The app fences what it
 * brings back from the browser — a page's words, and a refusal too, because
 * a refusal can carry the page's own words — so what lies between the
 * markers is never anything else: not a picture's line, not a sentence the
 * app wrote, not a mail's own fence. A call that did not fence its answer
 * carried no page text, and a call that did is read for the page however it
 * was made.
 *
 * **And only a call that answered carries a page.** The fence alone cannot
 * tell an answer from a refusal: both are fenced, and a refusal can quote
 * the page. The run's own state says it — a call that was refused, or that
 * was stopped, is the app's sentence and not the page's words, and stamping
 * it as a page's would be a lie about where the words came from.
 */
function pagesOf(message: ChatMessage): string[] {
  const texts: string[] = [];
  for (const run of message.toolRuns ?? []) {
    if (run.state !== "ok") continue;
    const page = pageText(run.result);
    if (page === null || page === "") continue;
    texts.push(page);
  }
  return texts;
}

function ranMail(message: ChatMessage): boolean {
  return (message.toolRuns ?? []).some((run) => run.mail !== undefined || isMailRun(run.name));
}
