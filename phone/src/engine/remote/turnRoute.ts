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

/** A computer that answered a non-2xx before the first SSE byte may simply not
 *  know this route — but only a door saying "no such route" means that. A 401
 *  (revoked credential) or a 5xx (a proxy, a server in trouble) says nothing
 *  about the route, and remembering one as an old computer would take the turn
 *  route away from a computer that has it. */
export function isTurnRouteRefusal(failure: { error?: Error } | undefined): boolean {
  const status = /^remote_brain_http_(\d{3})$/.exec(failure?.error?.message ?? "");
  if (status === null) return false;
  const code = Number(status[1]);
  return code === 404 || code === 405 || code === 501;
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