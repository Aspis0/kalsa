/**
 * The computer's mail routes for a phone (PHONE-CHAT-PROTOCOL §4 read, §5
 * send): one JSON POST each, on the door road a turn rides. They are separate
 * requests because they happen outside a turn — a person opens a card and
 * presses Send long after that turn's tunnel closed, so each call establishes
 * its own road and never borrows a turn's.
 *
 * Nothing here decides what a person reads: a route that answers
 * `{"error": "keychain"}` hands that code back, and the phone says its own
 * sentence about it.
 */
import { doorFetchFor, establishDoorRoad } from "../../remote/doorRoad";
import { doorRequestBase } from "./doorRequestBase";
import { getRemoteDoorConfig, getRemoteDoorToken } from "./remoteDoorConfig";
import { canSendAuthorization, joinRemoteApiUrl, remoteUrlGateError } from "./remoteUrl";

export const MAIL_ROUTES = {
  read: "/kalsa/chat/mail/read",
  send: "/kalsa/chat/mail/send",
} as const;

/** One tunnel read, above the computer's own answer wait (30 s) plus the hand-
 *  over: a read the computer was about to answer must not fail on the phone's
 *  clock. */
const MAIL_READ_TIMEOUT_MS = 45_000;

/** `404` is this computer saying it has no such route, never a mail that is
 *  missing. */
export const MAIL_ROUTE_ABSENT = "mail.unavailable";

export type MailRouteResult<T> = { ok: true; value: T } | { ok: false; errorCode: string };

function errorCodeOf(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return message.startsWith("remote_brain_") ? message : "remote_brain_network";
}

async function postMailRoute<T>(
  path: string,
  body: unknown,
  pick: (payload: Record<string, unknown>) => T | null,
  signal?: AbortSignal,
): Promise<MailRouteResult<T>> {
  let url: string;
  let token: string | null;
  let fetcher: ReturnType<typeof doorFetchFor>;
  try {
    const door = await getRemoteDoorConfig();
    const base = doorRequestBase(door);
    if (!base.ok) return { ok: false, errorCode: base.error };
    url = joinRemoteApiUrl(base.base, path);
    const gate = remoteUrlGateError(url);
    if (gate) return { ok: false, errorCode: gate };
    token = await getRemoteDoorToken(door);
    fetcher = doorFetchFor(await establishDoorRoad(door, signal), MAIL_READ_TIMEOUT_MS);
  } catch (error) {
    return { ok: false, errorCode: errorCodeOf(error) };
  }
  try {
    const res = await fetcher(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(token && canSendAuthorization(url) ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        errorCode: res.status === 401 ? "remote_brain_http_401" : MAIL_ROUTE_ABSENT,
      };
    }
    const payload = await res.json().catch(() => null);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, errorCode: MAIL_ROUTE_ABSENT };
    }
    const record = payload as Record<string, unknown>;
    const failure = typeof record.error === "string" ? record.error : "";
    if (failure !== "") return { ok: false, errorCode: failure };
    const value = pick(record);
    return value === null ? { ok: false, errorCode: MAIL_ROUTE_ABSENT } : { ok: true, value };
  } catch (error) {
    return { ok: false, errorCode: errorCodeOf(error) };
  }
}

export type MailReadPayload = { record: unknown; body: string };

/** The record and its fence-free body, as the contract carries them: the
 *  shape is kept whole and read by `normalizeMailRead` beside the cards, so
 *  the card's fields and the sheet's cannot drift apart. */
export function readRemoteMail(id: string, signal?: AbortSignal) {
  return postMailRoute<MailReadPayload>(
    MAIL_ROUTES.read,
    { id },
    (record) =>
      record.record && typeof record.record === "object"
        ? { record: record.record, body: typeof record.body === "string" ? record.body : "" }
        : null,
    signal,
  );
}

/** The recipient the computer actually sent to, taken from its own answer:
 *  the phone named no recipient and must not claim one. */
export function sendRemoteMailDraft(draftId: string, body: string, signal?: AbortSignal) {
  return postMailRoute<string>(
    MAIL_ROUTES.send,
    { draft_id: draftId, body },
    (record) => (typeof record.sent_to === "string" ? record.sent_to : null),
    signal,
  );
}