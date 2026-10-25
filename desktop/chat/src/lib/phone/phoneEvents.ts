// The page's events back to the door, in the shape of the turn stream
// (docs/PHONE-CHAT-PROTOCOL.md §3). The sink is where "exactly one terminal
// event" is kept: after `done` or `error` nothing else leaves for that request.

import { invoke } from "../tauri";
import type { Mail, MailDraft, MailRecord } from "../mail/types";
import type { ToolRun } from "../types";

export function sendPhoneEvent(request: string, event: string, data: unknown): void {
  // **A send that fails is logged, not swallowed.** The door ends the request on
  // its own side, so nobody is left to tell the person — and a quiet catch is
  // how an event goes missing for a week and nobody can say which. The console
  // is the only place this has a voice, so it is where it goes.
  void invoke("brain_phone_chat_event", { request, event, data }).catch((why: unknown) => {
    console.error(`phone turn ${request}: the ${event} event did not go out`, why);
  });
}

export interface PhoneSink {
  reasoning: (text: string) => void;
  delta: (text: string) => void;
  toolRun: (run: ToolRun) => void;
  read: (record: MailRecord, body: string) => void;
  /** What Kalsa did in the turn, as one line, sent before the turn ends. */
  recap: (line: string) => void;
  done: () => void;
  fail: (code: string) => void;
}

export function phoneSink(send: (event: string, data: unknown) => void): PhoneSink {
  let ended = false;
  // The loop reports a run again when its mail arrives; the card set or draft
  // is sent once per run however many reports there are.
  const drawn = new Set<string>();
  // The phone shows the cards under the answer, so they wait for its first word
  // as the desktop waits. Same frames, later: nothing is lost either way,
  // because whatever is held goes out before the turn's terminal event.
  let held: { event: string; data: unknown }[] = [];
  const emit = (event: string, data: unknown): void => {
    if (!ended) send(event, data);
  };
  const release = (): void => {
    for (const frame of held) emit(frame.event, frame.data);
    held = [];
  };
  const end = (event: string, data: unknown): void => {
    if (ended) return;
    release();
    ended = true;
    send(event, data);
  };
  return {
    reasoning: (text) => emit("reasoning", { text }),
    delta: (text) => {
      emit("delta", { text });
      if (text !== "") release();
    },
    toolRun(run) {
      emit("tool_run", { id: run.id, name: run.name, state: run.state });
      if (run.mail === undefined || drawn.has(run.id)) return;
      drawn.add(run.id);
      const [event, data] = mailEvent(run.mail);
      held.push({ event, data });
    },
    read: (record, body) => emit("read", { record: recordWire(record), body }),
    // **The turn's own line goes out before whatever ends it**, on every ending:
    // an answer, a failure, a Stop. It is the last thing the phone says about the
    // turn, and it is the same line the desktop draws.
    recap: (line) => emit("recap", { text: line }),
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

/** A record as the protocol's snake_case carries it (docs §1), which is how the
    sidecar built it: `records.ts` reads `thread_ids` into `threadIds`, and this
    turns it back rather than putting the app's own spelling on a wire that does
    not use it. Every other field is one word and keeps its name. */
function recordWire(record: MailRecord) {
  return {
    id: record.id,
    from: record.from,
    subject: record.subject,
    date: record.date,
    snippet: record.snippet,
    thread_ids: record.threadIds,
    attachments: record.attachments,
    labels: record.labels,
  };
}
