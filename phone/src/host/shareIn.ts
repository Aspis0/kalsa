/**
 * The pure half of share-in (D1 row 41 / D2 row 16): the consume gate and
 * the nonce prefill state the hook mutates, lifted out so the controller's
 * traps are testable in node without `Linking` or `expo-file-system`.
 *
 * Three facts this file owns, each a trap the controller recorded:
 *
 * - CONSUME ONCE: a URL is recorded in `handled` at CLAIM time, before any
 *   async work runs, so the double delivery of one intent (`getInitialURL`
 *   plus the `url` event) applies exactly once (`AppShell.tsx:3561,3654`).
 * - HOLD, never drop: a URL arriving before the conversations are ready
 *   parks in `pending` and is re-claimed on the flush — one slot, emptied
 *   before the consume runs (`AppShell.tsx:3562,3661-3671`).
 * - NONCE RE-MERGE: every applied text advances the nonce, so two identical
 *   payloads are two distinct states and the merge effect runs again —
 *   sharing the same passage twice must still land twice
 *   (`AiChatPage.tsx:1959-1969`).
 *
 * Parsing goes through the controller's own `parseShareUrl` — called, never
 * rebuilt (`src/app/shareIntent.ts`).
 */
import { parseShareUrl, type ShareInPayload } from "../app/shareIntent";

export type ShareGate = {
  /** URLs this build has already claimed; membership means "applied or
   *  currently applying" — never a second time. */
  handled: Set<string>;
  /** The one URL held until `conversationsReady` flips. */
  pending: string | null;
};

export function createShareGate(): ShareGate {
  return { handled: new Set(), pending: null };
}

export type ShareClaim =
  /** No URL at all (the other event of a pair, say) — nothing to do. */
  | { outcome: "empty" }
  /** Already claimed: the same intent never applies twice. */
  | { outcome: "duplicate" }
  /** Conversations not ready: parked in the gate, not applied, not lost. */
  | { outcome: "held" }
  /** Not a `kalsa://share` link — dropped BEFORE recording, as the
   *  controller's parse check does (`AppShell.tsx:3556`). */
  | { outcome: "invalid" }
  /** Recorded and ready; the payload is the controller's own parse result
   *  (the controller re-parses inside `applySharePayload`; one parse here
   *  is the same function over the same URL). */
  | { outcome: "apply"; payload: ShareInPayload };

export function claimShare(
  gate: ShareGate,
  url: string | null,
  conversationsReady: boolean,
): ShareClaim {
  if (!url) return { outcome: "empty" };
  if (gate.handled.has(url)) return { outcome: "duplicate" };
  if (!conversationsReady) {
    gate.pending = url;
    return { outcome: "held" };
  }
  const payload = parseShareUrl(url);
  if (!payload) return { outcome: "invalid" };
  gate.handled.add(url);
  return { outcome: "apply", payload };
}

/** The flush's take-then-clear (`AppShell.tsx:3663-3668`): the slot empties
 *  before the consume runs, so one flush applies the held URL exactly once
 *  and a second flush finds nothing. */
export function takePendingShare(gate: ShareGate): string | null {
  const held = gate.pending;
  gate.pending = null;
  return held;
}

export type SharePrefill = { text: string; nonce: number };

/**
 * The nonce bump (`AppShell.tsx:3559,3578`): every applied payload produces
 * a NEW state object even when the text is byte-identical to the last one —
 * the merge effect keys on the nonce, so a repeated share re-runs the merge
 * instead of looking unchanged to its dependencies.
 */
export function recordSharePrefill(
  previous: SharePrefill | null,
  text: string,
): SharePrefill {
  return { text, nonce: (previous?.nonce ?? 0) + 1 };
}
