// The page's events back to the door, in the shape of the turn stream
// (docs/PHONE-CHAT-PROTOCOL.md §3). The sink is where "exactly one terminal
// event" is kept: after `done` or `error` nothing else leaves for that request.

import { invoke } from "../tauri";
import type { Mail, MailDraft, MailRecord } from "../mail/types";
import type { ToolRun } from "../types";

export function sendPhoneEvent(request: string, event: string, data: unknown): void {
  // A send that fails has no one left to tell: the door ends the request on its own side.
  void invoke("brain_phone_chat_event", { request, event, data }).catch(() => {});
}

export interface PhoneSink {
  reasoning: (text: string) => void;
  delta: (text: string) => void;
  toolRun: (run: ToolRun) => void;
  read: (record: MailRecord, body: string) => void;
  done: () => void;
  fail: (code: string) => void;
}

export function phoneSink(send: (event: string, data: unknown) => void): PhoneSink {
  let ended = false;
  // The loop reports a run again when its mail arrives; the card set or draft
  // is sent once per run however many reports there are.
  const drawn = new Set<string>();
  const emit = (event: string, data: unknown): void => {
    if (!ended) send(event, data);
  };
  const end = (event: string, data: unknown): void => {
    if (ended) return;
    ended = true;
    send(event, data);
  };
  return {
    reasoning: (text) => emit("reasoning", { text }),
    delta: (text) => emit("delta", { text }),
    toolRun(run) {
      emit("tool_run", { id: run.id, name: run.name, state: run.state });
      if (run.mail === undefined || drawn.has(run.id)) return;
      drawn.add(run.id);
      const [event, data] = mailEvent(run.mail);
      emit(event, data);
    },
    read: (record, body) => emit("read", { record, body }),
    done: () => end("done", {}),
    fail: (code) => end("error", { code }),
  };
}

function mailEvent(mail: Mail): [string, unknown] {
  return mail.kind === "cards" ? ["cards", mail] : ["draft", draftWire(mail)];
}

/** `to` is shown to the person; nothing comes back with a recipient, because the
    send names the draft and the door resolves the address from it. */
function draftWire(draft: MailDraft) {
  return {
    reply_to_id: draft.replyToId,
    to: draft.to,
    to_name: draft.toName,
    subject: draft.subject,
    body: draft.body,
  };
}
