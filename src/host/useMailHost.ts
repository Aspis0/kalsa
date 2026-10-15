/**
 * What a person can do with the mail a remote answer brought: open a card to
 * read the mail, ask the computer for a reply, and send the draft the computer
 * built — after the phone's own confirm.
 *
 * The state lives here, not on the message: a card and a draft describe one
 * turn on one screen, so they are read once and thrown away with the screen.
 * Nothing here reaches the engine, and nothing here names a recipient — the
 * draft's recipient and subject come from the computer and are shown, never
 * chosen (PHONE-CHAT-PROTOCOL §5).
 */
import { useCallback, useState } from "react";

import {
  MAIL_ROUTE_ABSENT,
  readRemoteMail,
  sendRemoteMailDraft,
} from "../engine/remote/mailApi";
import { normalizeMailRead, type OpenedMail } from "../domain/mailPayload";

export type MailReadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; mail: OpenedMail }
  | { status: "failed"; errorCode: string };

export type MailSendState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "sent"; sentTo: string }
  | { status: "failed"; errorCode: string };

export type MailActions = {
  /** Ask the computer for a reply to this mail: a normal turn, pinned to it. */
  draftReply: (mailId: string) => void;
  readMail: (mailId: string) => void;
  closeMail: () => void;
  sendDraft: (draftId: string, body: string) => void;
  openMail: MailReadState;
  sends: Readonly<Record<string, MailSendState>>;
};

export function useMailHost(params: {
  send: (text: string, opts?: { mailReplyFor?: string }) => void;
  /** The sentence the card's button sends as this turn's words, in the app's
   *  language: the computer pins its work to the mail, not to the sentence. */
  askDraftText: string;
}): MailActions {
  const { send, askDraftText } = params;
  const [openMail, setOpenMail] = useState<MailReadState>({ status: "idle" });
  const [sends, setSends] = useState<Record<string, MailSendState>>({});

  const draftReply = useCallback(
    (mailId: string) => {
      send(askDraftText, { mailReplyFor: mailId });
    },
    [send, askDraftText],
  );

  const readMail = useCallback(async (mailId: string) => {
    setOpenMail({ status: "loading" });
    const result = await readRemoteMail(mailId);
    setOpenMail(
      result.ok
        ? // A record the computer changed under us after its own card is the
          // only way this can fail to read; it reads as a failure, not a blank.
          readStateOr(result.value, MAIL_ROUTE_ABSENT)
        : { status: "failed", errorCode: result.errorCode },
    );
  }, []);

  const closeMail = useCallback(() => setOpenMail({ status: "idle" }), []);

  const sendDraft = useCallback(async (draftId: string, body: string) => {
    setSends((prev) => ({ ...prev, [draftId]: { status: "sending" } }));
    const result = await sendRemoteMailDraft(draftId, body);
    setSends((prev) => ({
      ...prev,
      [draftId]: result.ok
        ? { status: "sent", sentTo: result.value }
        : { status: "failed", errorCode: result.errorCode },
    }));
  }, []);

  return { draftReply, readMail, closeMail, sendDraft, openMail, sends };
}

function readStateOr(
  payload: Parameters<typeof normalizeMailRead>[0],
  errorCode: string,
): MailReadState {
  const mail = normalizeMailRead(payload);
  return mail === null ? { status: "failed", errorCode } : { status: "ready", mail };
}