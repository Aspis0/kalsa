/**
 * The app session's one log upload. The panel asks here instead of holding its
 * own copy, so a remount during a send joins the same request and a press
 * never becomes a second upload while one is in flight. Only the id of a
 * successful send is kept, and only for the app session: nothing is persisted.
 */
import { sendLog, type SendLogResult } from "./sendLog";

let lastId: string | null = null;
let inFlight: Promise<SendLogResult> | null = null;

/** The session as a mounting panel finds it: the last successful id and the
 * send that is still in flight, both null before the first press. */
export function reportSession(): { id: string | null; inFlight: Promise<SendLogResult> | null } {
  return { id: lastId, inFlight };
}

/**
 * Send the log once: an in-flight send is handed back instead of started
 * again, a session that already sent answers from its id, and the in-flight
 * slot is cleared when the send settles, so a failure re-arms the button.
 */
export function sendLogOnce(): Promise<SendLogResult> {
  if (inFlight !== null) return inFlight;
  if (lastId !== null) return Promise.resolve({ ok: true, id: lastId });
  const attempt = sendLog()
    .then((result) => {
      if (result.ok) lastId = result.id;
      return result;
    })
    .finally(() => {
      inFlight = null;
    });
  inFlight = attempt;
  return attempt;
}
