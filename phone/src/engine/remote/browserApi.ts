/**
 * The computer's route for a person's answer to a held request
 * (PHONE-CHAT-PROTOCOL §3.1), one JSON POST, on the door road a turn rides.
 *
 * Like a draft's send, this happens outside a turn — a person answers a card
 * long after the turn that raised it closed — so each call establishes its own
 * road and never borrows a turn's.
 *
 * **Nothing here says anything about the card.** No log line, no console, no
 * error message: the id, the site and the values a stranger typed are not this
 * module's to speak. A failure is a code, and the card writes the sentence.
 */
import { doorFetchFor, establishDoorRoad } from "../../remote/doorRoad";
import { doorRequestBase } from "./doorRequestBase";
import { getRemoteDoorConfig, getRemoteDoorToken } from "./remoteDoorConfig";
import { canSendAuthorization, joinRemoteApiUrl, remoteUrlGateError } from "./remoteUrl";
import { readBrowserAnswer, type BrowserAnswer } from "../../domain/browserCardPayload";

export const BROWSER_ROUTES = {
  answer: "/kalsa/chat/browser/answer",
} as const;

/** A computer that does not know the route says so; a missing answer is never
 *  the computer's way of saying the card is spent. */
export const BROWSER_ROUTE_ABSENT = "browser.unavailable";

/** Above the computer's own answer wait (30 s) plus the hand-over: an answer
 *  the computer was about to take must not fail on the phone's clock. */
const ANSWER_TIMEOUT_MS = 45_000;

/** Which button was pressed. The two and nothing else (§3.1). */
export type BrowserAnswerVerb = "send" | "decline";

function errorCodeOf(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return message.startsWith("remote_brain_") ? message : "remote_brain_network";
}

export async function answerBrowserCard(
  cardId: string,
  answer: BrowserAnswerVerb,
  signal?: AbortSignal,
): Promise<BrowserAnswer> {
  let url: string;
  let token: string | null;
  let fetcher: ReturnType<typeof doorFetchFor>;
  try {
    const door = await getRemoteDoorConfig();
    const base = doorRequestBase(door);
    if (!base.ok) return { ok: false, errorCode: base.error };
    url = joinRemoteApiUrl(base.base, BROWSER_ROUTES.answer);
    const gate = remoteUrlGateError(url);
    if (gate) return { ok: false, errorCode: gate };
    token = await getRemoteDoorToken(door);
    fetcher = doorFetchFor(await establishDoorRoad(door, signal), ANSWER_TIMEOUT_MS);
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
      body: JSON.stringify({ card_id: cardId, answer }),
      signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        errorCode: res.status === 401 ? "remote_brain_http_401" : BROWSER_ROUTE_ABSENT,
      };
    }
    const payload = await res.json().catch(() => null);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, errorCode: BROWSER_ROUTE_ABSENT };
    }
    return readBrowserAnswer(payload as Record<string, unknown>);
  } catch (error) {
    return { ok: false, errorCode: errorCodeOf(error) };
  }
}