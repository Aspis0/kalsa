import { useRef, useState } from "react";
import { useLanguage } from "../i18n/useLanguage";
import { runMailRead } from "../lib/tools/mailCall";
import { withBody, withDraft, withSent } from "../lib/mail/drafts";
import type { DraftRecord, Drafts, SentTo } from "../lib/mail/drafts";
import type { MailCardItem } from "../lib/mail/types";
import type { OpenMail } from "../components/mail/MailView";
import type { PendingSend } from "../lib/mail/pending";

/**
 * Which mail stands open beside the chat, the replies being written to each
 * mail, and the one press between "Invia" and the command. The dialog is the
 * ONLY caller of the send command, and it only exists because a person pressed
 * the button on a card or in the panel: a model can write the words of a reply
 * and cannot send one.
 */

export function useMail(compose: (text: string, mail?: { id: string; subject: string; note: string }) => void) {
  const { table } = useLanguage();
  const t = table.mail;
  const [open, setOpen] = useState<OpenMail | null>(null);
  /** Whether a read is still running, so the pane can say so instead of
      saying no mail is open. The read is the slowest call the mailbox makes. */
  const [opening, setOpening] = useState(false);
  /** Which read owns the pane. Two «Apri» in a row run one behind the other, and
      the first answer must not land on top of the mail the second one opened. */
  const reading = useRef(0);
  /** The words of every reply in hand, each under the mail it answers. The chat's
      draft card and the panel's box are two views of the same entry: one reply
      can never be shown under another mail's name. */
  const [drafts, setDrafts] = useState<Drafts>({});
  /** Where each reply went, under the same key, for the same reason. */
  const [sent, setSent] = useState<SentTo>({});
  const [send, setSend] = useState<PendingSend | null>(null);

  /** Reads the mail in full and shows it in the panel. The record comes from
      the sidecar; the body from the fenced text, which is the only copy of it
      that ever leaves the server. */
  async function show(item: MailCardItem): Promise<void> {
    const ticket = reading.current + 1;
    reading.current = ticket;
    setOpening(true);
    const answer = await runMailRead({ id: item.id });
    if (reading.current !== ticket) return;
    setOpening(false);
    setOpen({ item, record: answer.record, body: answer.body, code: answer.code });
  }

  /** "Scrivi una risposta: " in the composer: the person finishes the sentence.
      The sender's name stays on the card — in the box it would read to the
      model as the person's own words, outside the fence. */
  function reply(item: MailCardItem): void {
    compose(t.replyLine(), { id: item.id, subject: item.subject, note: t.replyNote(item.id) });
  }

  /** Modifica: the draft's words in the composer, editable. */
  function edit(body: string): void {
    compose(body);
  }

  /** A draft the sidecar wrote, with the address the backend will send to. */
  function save(id: string, record: DraftRecord): void {
    setDrafts((before) => withDraft(before, id, record));
  }

  /** The person typed: only the words of that one mail change. */
  function type_(id: string, body: string): void {
    setDrafts((before) => withBody(before, id, body));
  }

  /** Another mail is another reply. The pending confirmation is about the mail
      that was on screen, so it goes; the replies already written stay. */
  function changeMail(next: OpenMail | null): void {
    setOpen(next);
    if (next !== null) setSend(null);
  }

  function done(id: string, to: string): void {
    setSend(null);
    setSent((before) => withSent(before, id, to));
  }

  return {
    open,
    opening,
    setOpen: changeMail,
    show,
    reply,
    edit,
    drafts,
    save,
    type: type_,
    sent,
    send,
    setSend,
    done,
  };
}

export type MailState = ReturnType<typeof useMail>;

export type { OpenMail };