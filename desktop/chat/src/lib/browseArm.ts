/**
 * The browser control's arming.
 *
 * **One message at a time.** The chip in the composer turns it on, the send
 * spends it, and the next message is an ordinary one again: the person said
 * it once, for one message, and the badge on that message is what says so
 * afterwards.
 *
 * The rules live here and not in the component, because the component is only
 * where they are drawn.
 */

import type { ChatMessage } from "./types";
import type { ToolMode } from "./tools/registry";

/** Whether the next message is the browser's. */
export interface Arming {
  armed: boolean;
}

/** Not armed: the next message is an ordinary one. */
export const DISARMED: Arming = { armed: false };

/**
 * The chip: the person turns the control on, and a second tap takes it back
 * before the message is sent. Nothing else moves it.
 */
export function tap(arming: Arming): Arming {
  return { armed: !arming.armed };
}

/**
 * The send: the arming is read, and it is spent.
 *
 * **An armed turn stays the browser's turn, whatever happened to the browser
 * in between.** The person armed the control for that message, so that
 * message is the browser's — and if the driver went away between the tap and
 * the send, the turn is still the browser's with an **empty offer**: no web
 * tool, no mini app, no mail. The model is then told it has no browser
 * tools and asks for the control, which is the honest answer for a browser
 * that cannot open.
 *
 * **The turn does not degrade to a web turn.** A search is not the page the
 * person asked for, and quietly answering with one answers a question they
 * did not ask. The browser's absence is the failure to report, not a
 * licence to substitute something else — and the arming that is kept here is
 * what keeps the badge, the mode and the offer all saying the same thing.
 */
export function spend(arming: Arming): { next: Arming; browserMode: boolean } {
  return { next: DISARMED, browserMode: arming.armed };
}

/**
 * Which family of tools the turn that follows these messages may offer.
 *
 * **One fact, read from one place.** The last user message is the one that was
 * sent, and it carries the flag: the person armed the browser for that message
 * and for no other. The dry run that measures the wire and the offer that
 * sends it are given this same answer, so the wire that is measured is the
 * wire that is sent.
 *
 * **A browser that went missing does not change the answer.** The flag was
 * set when the message was sent, and the offer that follows it is empty —
 * the browser's own family, with nothing in it — rather than the web's.
 */
export function modeOf(messages: ChatMessage[]): ToolMode {
  const last = messages.at(-1);
  const armed = last !== undefined && last.role === "user" && last.browserMode === true;
  return armed ? "browser" : "web";
}
