// The wire a phone turn sends: the same builder the desktop chat uses for a
// fresh conversation, fed the phone's messages instead of the store's.

import { buildPinnedContext } from "../attachments";
import type { PinnedContext } from "../attachments";
import { TABLES } from "../../i18n";
import { newUserTurn } from "../userTurn";
import { wireTurns } from "../wireTurns";
import type { ChatMessage } from "../types";
import type { PhoneTurn } from "./phoneRequest";

interface PhoneFacts {
  vision: boolean;
  think: boolean;
  /** The window the engine reports, or null when it is unknown. */
  nctx: number | null;
}

/** The phone's last words are the turn being answered, so they alone carry the
    send date and, for a reply, the note that pins the turn to its mail. The
    earlier words went out on their own turns and are sent as they are. */
export function phoneWire(turn: PhoneTurn, facts: PhoneFacts, now: Date): PinnedContext {
  const last = turn.messages.length - 1;
  const messages: ChatMessage[] = turn.messages.map((message, at) => {
    const id = `phone-${at}`;
    if (at !== last) return { id, role: message.role, content: message.content, createdAt: now.getTime() };
    const riders =
      turn.replyFor === null
        ? {}
        : {
            mailId: turn.replyFor,
            mailNote: TABLES[turn.language].mail.askDraftNote(turn.replyFor),
          };
    return newUserTurn(id, message.content, now, riders);
  });
  return buildPinnedContext(wireTurns(messages), [], facts.nctx, {
    vision: facts.vision,
    think: facts.think,
    url: () => null,
  });
}
