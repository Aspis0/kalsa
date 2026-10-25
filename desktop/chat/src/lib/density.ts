/**
 * The two densities this app measures a wire with.
 *
 * **The house rule** — four characters to a token — is right for prose, and
 * prose is what a conversation mostly is. It is wrong for the two things
 * that ride with a request and are not prose: a tool result's body (a page's
 * own text) and the tool definitions (English descriptions in a JSON
 * envelope). The engine's own count of a page on 21 October 2026 said 1.76
 * characters to a token — nearly twice as dense as prose — while the
 * estimate said four. That gap is the whole defect: the app's estimate said
 * 25000 tokens where the engine counted 63828, and the turn died on the
 * request after that one, with its thought cut in half.
 *
 * **The dense rate** is the pessimistic one: two characters to a token, with
 * a fifteenth of margin on top of it, so that a body is never counted below
 * what the engine counted. Two characters a token is 1/1.74, and the engine
 * said 1/1.76 — the margin covers that difference and a little more, because
 * a page is not the only dense thing a model reads.
 *
 * These are numbers, not an estimator: how a message is weighed stays
 * injected (`attachments.ts` → `wireSize` in the app), and this module only
 * says which characters are prose and which are not.
 */

import type { ToolDefinition } from "./tools/definitions";

/** The house rule: characters to a token, for prose. */
export const HOUSE_CHARS_PER_TOKEN = 4;

/** The pessimistic rule: characters to a token, for what the engine counts
    denser than prose. */
export const DENSE_CHARS_PER_TOKEN = 2;

/**
 * The margin on the dense rule.
 *
 * The engine's own count of a page came to 1.76 characters to a token, and
 * the dense rate alone is two — which would count a page *under* what the
 * engine said. The margin lifts the count above that number: 2 / 1.15 is
 * 1.74 characters a token, so the count is a shade above the one the engine
 * gave on the day it was measured.
 */
export const DENSE_MARGIN = 1.15;

/**
 * The tokens a body of `chars` characters costs, counted the pessimistic
 * way. No characters cost nothing.
 */
export function denseTokens(chars: number): number {
  if (chars <= 0) return 0;
  return Math.ceil((chars * DENSE_MARGIN) / DENSE_CHARS_PER_TOKEN);
}

/**
 * What the tool definitions of a request weigh: the JSON the server reads,
 * counted the pessimistic way.
 *
 * The definitions travel with **every** request and the engine counts them
 * into the prompt, so a fit that leaves them out sends a request the engine
 * refuses — a 400, before there is any measurement to go by. The five
 * browser tools are 2755 characters of JSON: about 689 tokens by the house
 * rule, 1566 by the engine's own count on the day it was measured.
 */
export function definitionsTokens(tools: ToolDefinition[]): number {
  if (tools.length === 0) return 0;
  return denseTokens(JSON.stringify(tools).length);
}
