// Answers the phone's requests from this window. Two listeners, one per Rust
// event; mounted once at the app root so an answer does not depend on which
// page is on screen.

import { available, listen } from "../tauri";
import { loadSettings } from "../settings";
import type { LiveSettings } from "../types";
import { getBrainServer, withBrainDefaults } from "../../surfaces/useBrain";
import { phoneSink, sendPhoneEvent } from "./phoneEvents";
import { readPhoneRequest, requestIdOf } from "./phoneRequest";
import { runPhoneRead } from "./phoneRead";
import { runPhoneTurn } from "./phoneTurn";

const REQUEST_EVENT = "phone-chat-request";
const STOP_EVENT = "phone-chat-stop";

/** Starts answering. The returned function aborts what is running and removes
    both listeners. */
export function startPhoneChatRunner(): () => void {
  if (!available()) return () => {};
  const live = new Map<string, AbortController>();
  let disposed = false;
  const unlisten = Promise.all([
    listen(REQUEST_EVENT, (payload) => accept(payload)),
    listen(STOP_EVENT, (payload) => halt(payload)),
  ]);

  function accept(payload: unknown): void {
    if (disposed) return;
    const envelope = readPhoneRequest(payload);
    // A request id already running is not a second request: its answers belong to the first.
    if (envelope === null || live.has(envelope.request)) return;
    const { request, body } = envelope;
    const sink = phoneSink((event, data) => sendPhoneEvent(request, event, data));
    if (body === null) return sink.fail("bad_request");
    sendPhoneEvent(request, "accepted", {});
    const controller = new AbortController();
    live.set(request, controller);
    const work =
      body.kind === "turn"
        ? runPhoneTurn(body.turn, currentSettings(), sink, controller.signal)
        : runPhoneRead(body.id, sink);
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
