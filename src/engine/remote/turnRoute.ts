/**
 * Which route a chat turn asks the computer over, and what to do when the
 * computer answers that it does not know the route (PHONE-CHAT-PROTOCOL §2):
 * the same turn the old way, silently, and no second try afterwards.
 *
 * The verdict is one boolean per pairing, not per turn: a phone that re-asks
 * a route the computer refuses pays the round trip on every message, and a
 * person would see nothing but a slower chat.
 */

/** Set once a computer has refused the turn route before any byte of it. */
let turnRouteAbsent = false;

export function isTurnRouteAbsent(): boolean {
  return turnRouteAbsent;
}

/** A computer that answered a non-2xx before the first SSE byte does not
 *  know this route; a token problem or a dead network must not be mistaken
 *  for one, so only the refusal itself counts. Deciding it and remembering it
 *  are two things: the caller that saw the answer says so, and the fallback
 *  below is the only place the verdict is kept. */
export function isTurnRouteRefusal(failure: { error?: Error } | undefined): boolean {
  const status = /^remote_brain_http_(\d{3})$/.exec(failure?.error?.message ?? "");
  // Status 0 is not an answer: a dead road must not be remembered as a
  // computer that does not know the route.
  return status !== null && Number(status[1]) > 0;
}

/** A pairing change is a different computer: its answer must be asked again. */
export function forgetTurnRouteVerdict(): void {
  turnRouteAbsent = false;
}

/**
 * Run one attempt on a route. `absent` says the route was refused before any
 * byte, so the turn has not been sent and can be asked again.
 */
export type TurnRouteAttempt = (route: "turn" | "completions") => Promise<"settled" | "absent">;

/**
 * The turn route first, then `/v1/chat/completions`: once, and only when the
 * first answer never started.
 */
export async function streamTurnWithFallback(args: {
  wantsTurnRoute: boolean;
  attempt: TurnRouteAttempt;
}): Promise<void> {
  if (!args.wantsTurnRoute || turnRouteAbsent) {
    await args.attempt("completions");
    return;
  }
  if ((await args.attempt("turn")) === "settled") return;
  turnRouteAbsent = true;
  await args.attempt("completions");
}