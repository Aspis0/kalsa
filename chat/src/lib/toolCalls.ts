/**
 * Tool calls as they arrive in a stream, folded back into whole calls.
 *
 * The phone has nothing to copy here: `llama.rn` hands over a completed array
 * (`src/engine/LlamaService.ts:4948`) and never parses deltas. A server on the
 * wire spreads one call over many chunks — the id and the name come once,
 * usually on the first fragment, and the argument JSON arrives as a string cut
 * into pieces. The only field that holds the pieces together is `index`, which
 * says which call a fragment belongs to.
 *
 * Everything here is pure: the stream carries the state, this carries the rule.
 */

/** One call, as far as the stream has told us about it. */
export interface ToolCall {
  /** The slot the server put this call in. */
  index: number;
  /** The id the server gave, or a synthetic one. Unique across the round. */
  id: string;
  name: string;
  /** The argument JSON as text, concatenated but not yet parsed. */
  arguments: string;
  /** True when the arguments were longer than this app accepts and were cut. */
  cut: boolean;
}

/**
 * More parallel calls than any model sends in one round. A fragment naming an
 * index past this is junk, and following its index would allocate on demand.
 */
const MAX_CALLS = 16;

/**
 * The longest arguments this app will hold. A query or an address is short; a
 * stream that keeps sending argument text is not describing a tool call any
 * more, and without a cap it would grow the browser and the transcript with it.
 * A cut call cannot parse, so it becomes a failed call rather than a wrong one.
 */
export const MAX_ARGUMENTS = 4_096;

/**
 * Fold one delta's `tool_calls` array into the calls so far. The result is a
 * new array; the array passed in is never touched. A delta with nothing usable
 * in it returns the calls unchanged, by identity.
 */
export function accumulate(calls: ToolCall[], deltas: unknown): ToolCall[] {
  if (!Array.isArray(deltas) || deltas.length === 0) return calls;

  let next = calls;
  for (const raw of deltas) {
    if (typeof raw !== "object" || raw === null) continue;
    const fragment = raw as { index?: unknown; id?: unknown; function?: unknown };
    const index = fragment.index;
    // A fragment that cannot be placed is dropped. Folding it into call zero
    // would hand one tool another tool's arguments.
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= MAX_CALLS) {
      continue;
    }

    // Copy on the first usable fragment, so an input we never change is never
    // held while the calls grow.
    if (next === calls) next = calls.map((call) => ({ ...call }));
    const slot = next.findIndex((call) => call.index === index);
    const call =
      slot >= 0 ? { ...next[slot] } : { index, id: "", name: "", arguments: "", cut: false };
    if (slot >= 0) next[slot] = call;
    else next.push(call);

    if (!call.id && typeof fragment.id === "string" && fragment.id) call.id = fragment.id;
    if (typeof fragment.function === "object" && fragment.function !== null) {
      const fn = fragment.function as { name?: unknown; arguments?: unknown };
      if (!call.name && typeof fn.name === "string" && fn.name) call.name = fn.name;
      if (!call.cut && typeof fn.arguments === "string" && fn.arguments) {
        const room = MAX_ARGUMENTS - call.arguments.length;
        if (fn.arguments.length > room) {
          call.arguments += fn.arguments.slice(0, room);
          call.cut = true;
        } else {
          call.arguments += fn.arguments;
        }
      }
    }
  }

  if (next === calls) return calls;
  // A call the server never named still needs an id: its result travels back as
  // a `tool` message, and that message is matched by id or not at all. The ids
  // must also be unique — the transcript replaces a run by id, so two calls
  // sharing one would lose one of them.
  const taken = new Set<string>();
  return next.map((call) => {
    const id = freeId(taken, call.id || `call-${call.index}`);
    taken.add(id);
    return id === call.id ? call : { ...call, id };
  });
}

function freeId(taken: Set<string>, wanted: string): string {
  if (!taken.has(wanted)) return wanted;
  let nth = 2;
  while (taken.has(`${wanted}-${nth}`)) nth += 1;
  return `${wanted}-${nth}`;
}

/**
 * Parse a call's arguments, once, when the call is complete. Malformed JSON is
 * the tool's problem, not the stream's — the sentence returned is what the
 * model reads as the result, so the turn goes on.
 */
export function readArguments(
  name: string,
  argumentsText: string,
  cut = false,
): {
  args: Record<string, unknown>;
  problem: string | null;
} {
  if (cut) return { args: {}, problem: tooLong };
  const raw = argumentsText.trim();
  if (raw === "") return { args: {}, problem: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { args: {}, problem: notValid(name) };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { args: {}, problem: notValid(name) };
  }
  return { args: parsed as Record<string, unknown>, problem: null };
}

const tooLong =
  "The arguments for this call were longer than this app accepts, so nothing was run. Try again with a shorter query or address.";

function notValid(name: string): string {
  return `The arguments for “${name}” were not valid JSON, so nothing was run. Try the call again with proper JSON.`;
}
