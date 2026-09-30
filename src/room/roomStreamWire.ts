/**
 * One `GET /kalsa/room/events` over the door chat already rides: the
 * road decides the transport exactly as `/v1/chat/completions` does —
 * RN's XHR on HTTPS, the iroh chat shim on the door lane — and the bytes
 * go to the SSE parser. No EventSource, no new networking: this file
 * owns one request (its resume headers included), and the outcome when
 * it ends. It logs nothing — never a name, a text or the bearer.
 */
import { establishDoorRoad, type DoorRoad } from "../remote/doorRoad";
import { createIrohChatXhr } from "../remote/irohChatXhr";
import type { RemoteDoorConfig } from "../engine/remote/remoteDoorConfig";
import type { XhrLike } from "../engine/remote/openaiTransport";
import { canSendAuthorization, joinRemoteApiUrl } from "../engine/remote/remoteUrl";
import { createSseParser, type SseMessage } from "./sseParser";

/** The XHR states (as openaiTransport names them): the wire sees the
 *  same sequence on both roads. */
const HEADERS_RECEIVED = 2;
const LOADING = 3;
const DONE = 4;

export type RoomEventsOutcome =
  /** A non-2xx answer: its status and whatever error body arrived. */
  | { kind: "status"; status: number; body: string }
  /** The 2xx body ended — the door cut the stream. */
  | { kind: "closed" }
  /** The transport failed before or during the body. */
  | { kind: "failed" };

export type RoomEventsHandlers = {
  /** New bytes arrived — pings and comments included. This is the
   *  stream's heartbeat: the dead-window is measured from here. */
  onActivity: () => void;
  /** The wire exists — delivered BEFORE send, so even a synchronous head
   *  finds it already assigned. */
  onWire: (wire: RoomEventsWire) => void;
  /** The 2xx head, with the epoch the response names (the door's
   *  `Kalsa-Room-Epoch`), null when the road gave no header. */
  onOpen: (epochHeader: string | null) => void;
  onMessage: (message: SseMessage) => void;
  onDone: (outcome: RoomEventsOutcome) => void;
};

export type RoomEventsTarget = {
  door: RemoteDoorConfig;
  token: string | null;
  /** The last seq this client delivered; sent as Last-Event-ID when set. */
  lastSeq: number;
  /** The cached epoch to send as Kalsa-Room-Epoch; null sends none. */
  epoch: string | null;
  signal?: AbortSignal;
};

export type RoomEventsWire = {
  /** End this wire deliberately: no outcome fires for a close. */
  close(): void;
};

function newRoomXhr(road: DoorRoad): XhrLike {
  if (road.road === "https") return new XMLHttpRequest() as unknown as XhrLike;
  // One wire sends once, so the establishment tunnel rides that send.
  return createIrohChatXhr(() => road.firstTunnel);
}

export async function openRoomEvents(
  target: RoomEventsTarget,
  handlers: RoomEventsHandlers,
): Promise<RoomEventsWire> {
  const road = await establishDoorRoad(target.door, target.signal);
  const xhr = newRoomXhr(road);
  const parser = createSseParser();
  const url = joinRemoteApiUrl(target.door.url, "/kalsa/room/events");
  let consumed = 0;
  let settled = false;

  const done = (outcome: RoomEventsOutcome): void => {
    if (settled) return;
    settled = true;
    handlers.onDone(outcome);
  };

  const consume = (): void => {
    if (settled) return;
    const text = xhr.responseText ?? "";
    if (text.length <= consumed) return;
    // Every growth of the body is a byte the door sent — a ping counts.
    handlers.onActivity();
    const messages = parser.push(text.slice(consumed));
    consumed = text.length;
    for (const message of messages) {
      if (settled) return; // a handler may have closed us mid-batch
      handlers.onMessage(message);
    }
  };

  const handle: RoomEventsWire = {
    close: () => {
      if (settled) return;
      settled = true;
      try {
        xhr.abort();
      } catch {
        // A transport that refuses to abort is still a closed wire to us.
      }
    },
  };

  xhr.open("GET", url);
  xhr.setRequestHeader("Accept", "text/event-stream");
  if (target.token !== null && canSendAuthorization(url)) {
    xhr.setRequestHeader("Authorization", `Bearer ${target.token}`);
  }
  if (target.lastSeq > 0) xhr.setRequestHeader("Last-Event-ID", String(target.lastSeq));
  if (target.epoch !== null) xhr.setRequestHeader("Kalsa-Room-Epoch", target.epoch);
  // Handlers after open, before send — the order the chat transport's
  // proven wire uses on both roads.
  xhr.onreadystatechange = () => {
    if (settled) return;
    if (xhr.readyState === HEADERS_RECEIVED && xhr.status !== 0) {
      if (xhr.status >= 200 && xhr.status < 300) {
        handlers.onOpen(xhr.getResponseHeader?.("kalsa-room-epoch") ?? null);
      }
      // A refusal waits for DONE so its error body arrives whole.
      return;
    }
    if (xhr.readyState === LOADING) consume();
    if (xhr.readyState === DONE) {
      if (xhr.status === 0) return done({ kind: "failed" });
      if (xhr.status >= 200 && xhr.status < 300) {
        consume();
        return done({ kind: "closed" });
      }
      return done({ kind: "status", status: xhr.status, body: xhr.responseText ?? "" });
    }
  };
  xhr.onprogress = () => consume();
  xhr.onerror = () => done({ kind: "failed" });
  xhr.ontimeout = () => done({ kind: "failed" });
  xhr.onabort = () => done({ kind: "failed" });
  // The listener holds the wire before send(): a transport that reports
  // its head synchronously must still find it assigned.
  handlers.onWire(handle);
  xhr.send();

  return handle;
}
