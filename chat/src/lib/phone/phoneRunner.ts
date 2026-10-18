// Answers the phone's requests from this window. Two listeners, one per Rust
// event; mounted once at the app root so an answer does not depend on which
// page is on screen.
//
// **A card and an outcome do not come through here.** They arrive on the phone's
// own stream — the same one its turn is being read from — and this used to
// listen for a second copy of each and forward it onto that same stream, so a
// phone was handed every card twice. The window's job is the turn; the door's
// stream is the phone's, and it writes there directly.

import { available, listen } from "../tauri";
import { loadSettings } from "../settings";
import type { LiveSettings } from "../types";
import { getBrainServer, withBrainDefaults } from "../../surfaces/useBrain";
import { phoneSink, sendPhoneEvent } from "./phoneEvents";
import { readPhoneRequest, requestIdOf } from "./phoneRequest";
import { runPhoneRead } from "./phoneRead";
import { runPhoneTurn } from "./phoneTurn";
import { forgetArmedChat } from "./phoneTurn";
import type { PhoneBody, PhoneTurn } from "./phoneRequest";

type TurnBody = Extract<PhoneBody, { kind: "turn" }>;

const REQUEST_EVENT = "phone-chat-request";
const STOP_EVENT = "phone-chat-stop";
const UNPAIRED_EVENT = "phone-chat-unpaired";

/**
 * The turn a request is run as.
 *
 * **The device goes on beside the turn, from the app.** It is what the app
 * resolved the credential to, and the browser writes of this turn are stamped
 * with it — so a card raised here is drawn on that phone, and its outcome comes
 * back under the same conversation. The phone's own body carries no device: it
 * cannot learn its own number (the pairing seal hands back the credential and
 * nothing else) and the door builds the turn without the field, so the app's is
 * the only one there is. A body that tries is `device: null` here already, and
 * is overwritten by this.
 */
export function turnFor(body: TurnBody, device: string | null): PhoneTurn {
  return { ...body.turn, device };
}

/** Starts answering. The returned function aborts what is running and removes
    both listeners. */
export function startPhoneChatRunner(): () => void {
  if (!available()) return () => {};
  const live = new Map<string, AbortController>();
  let disposed = false;
  const unlisten = Promise.all([
    listen(REQUEST_EVENT, (payload) => accept(payload)),
    listen(STOP_EVENT, (payload) => halt(payload)),
    // **A phone that is no longer paired takes this window's memory of it with
    // it**: what its chat was refused for is a thing this computer remembered
    // about a phone that no longer exists, and a phone paired again later must
    // not inherit another phone's caution.
    listen(UNPAIRED_EVENT, (payload) => {
      for (const conversation of Array.isArray(payload) ? payload : []) forgetArmedChat(String(conversation));
    }),
  ]);

  function accept(payload: unknown): void {
    if (disposed) return;
    const envelope = readPhoneRequest(payload);
    // A request id already running is not a second request: its answers belong to the first.
    if (envelope === null || live.has(envelope.request)) return;
    const { request, body, mail, device } = envelope;
    const sink = phoneSink((event, data) => sendPhoneEvent(request, event, data));
    if (body === null) return sink.fail("bad_request");
    // The door refuses a mail route before it ever reaches the page, so this
    // is the second door and not the first: a page that answered a read for a
    // phone whose switch is off would read the owner's mailbox behind a
    // refusal the phone has already seen. Same code either way. A TURN is
    // untouched — a phone that may not read mail still talks to Kalsa, with no
    // mail tool offered (§2).
    if (body.kind === "read" && !mail) return sink.fail("phone_mail_off");
    sendPhoneEvent(request, "accepted", {});
    const controller = new AbortController();
    live.set(request, controller);
    const work =
      body.kind === "turn"
        ? runPhoneTurn(turnFor(body, device), currentSettings(), sink, controller.signal, mail)
        : runPhoneRead(body.id, sink, controller.signal);
    void work.catch(() => sink.fail("engine")).finally(() => live.delete(request));
  }

  function halt(payload: unknown): void {
    const request = requestIdOf(payload);
    if (request !== null) live.get(request)?.abort();
  }

  return () => {
    disposed = true;
    live.forEach((controller) => controller.abort());
    live.clear();
    void unlisten.then((offs) => offs.forEach((off) => off()));
  };
}

/** Read per request, never at mount: a model or endpoint change applies to the next turn. */
function currentSettings(): LiveSettings {
  return withBrainDefaults(loadSettings(), getBrainServer());
}
