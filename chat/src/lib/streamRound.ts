import {
  ChatRequestError,
  completionBody,
  completionsUrl,
  createPrefillWatch,
  roundTimings,
} from "./chat";
import type { StreamOptions, WireMessage } from "./chat";
import { accumulate } from "./toolCalls";
import { createToolMarkupStripper } from "./toolMarkup";
import type { ToolCall } from "./toolCalls";
import { logUiEvent } from "./uiLog";
import { telemetryPrefill } from "./telemetry";
import type { ToolDefinition } from "./tools/definitions";

/**
 * One request to the server, streamed to the caller's sinks as it arrives.
 *
 * Reasoning, answer text, tool calls and the finish reason are four separate
 * channels: a delta's `tool_calls` never becomes answer text, and answer text
 * never becomes a tool call. The caller decides what the calls mean; this file
 * only reports what the server said.
 */

/** What one request produced. Content and reasoning already went to the sinks
    as they streamed; this is what the loop needs to decide on another round. */
export interface Round {
  gotContent: boolean;
  gotReasoning: boolean;
  sawDone: boolean;
  finishReason: string | null;
  toolCalls: ToolCall[];
  /** The answer text and the reasoning the sinks were given this round, exactly. */
  text: string;
  reasoning: string;
}

function firstPresent(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value !== "") return value;
  }
  return null;
}

function nestedReasoning(value: unknown): unknown[] {
  if (value && typeof value === "object") {
    const nested = value as Record<string, unknown>;
    return [nested.content, nested.text];
  }
  return [];
}

/**
 * Deterministic pick across the two field names (llama.cpp/DeepSeek send
 * reasoning_content, vLLM sends reasoning): reasoning_content wins, then its
 * one-level nestings, then reasoning and its nestings. Empty strings never
 * win — a server emitting every key with an empty default must not silence
 * the populated one. Unknown shapes are dropped, never merged into content.
 */
function pickReasoning(scope: Record<string, unknown>): string | null {
  const direct = [scope.reasoning_content, ...nestedReasoning(scope.reasoning_content)];
  const found = firstPresent(direct);
  if (found !== null) return found;
  return firstPresent([scope.reasoning, ...nestedReasoning(scope.reasoning)]);
}

/**
 * A server that ignored `stream: true` answers with one complete message:
 * content, thinking, finished tool calls, and why it stopped. Read once here,
 * so the loop can take the calls through the same accumulator — a completed
 * `message.tool_calls` array has no index of its own, so the array's order is
 * the only placement it has.
 */
function readComplete(payload: unknown): {
  content: string | null;
  reasoning: string | null;
  toolCalls: unknown[];
  finishReason: string | null;
} {
  const empty = { content: null, reasoning: null, toolCalls: [] as unknown[], finishReason: null };
  if (typeof payload !== "object" || payload === null) return empty;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return empty;
  const choice = (choices[0] ?? {}) as { message?: unknown; finish_reason?: unknown };
  if (!choice.message || typeof choice.message !== "object") return empty;
  const message = choice.message as Record<string, unknown>;
  return {
    content: typeof message.content === "string" ? message.content : null,
    reasoning: pickReasoning(message),
    toolCalls: Array.isArray(message.tool_calls)
      ? message.tool_calls.map((call, index) => ({ ...(call as object), index }))
      : [],
    finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : null,
  };
}

// NOTE: only delta.content ever becomes answer text, and only
// delta.tool_calls ever becomes a tool call. A delta's unknown fields are
// ignored (see pickReasoning): never merged into content.

/**
 * The engine's own answer when a prompt does not fit its window — the only
 * thing a 400 body is ever read for. llama.cpp's server answers with the
 * structured `type` and the sentence (upstream added the type in #15780;
 * this repo's own engine was measured saying "request (4225 tokens) exceeds
 * the available context size (4096 tokens), try increasing it" —
 * docs/MULTI-DEVICE-SHAPE.md:129). Matching it is what lets the caller shed
 * history and ask again; any other 400 stays an ordinary HTTP failure. The
 * body's words are never logged, shown, or carried in the error.
 */
function contextOverflow(body: string): boolean {
  return (
    body.includes("exceed_context_size_error") ||
    body.includes("exceeds the available context size")
  );
}

/** The most of a non-stream answer this client reads. Only a 400's body is
    ever read here, and only to classify it: an engine's error text is short,
    and a server that sends more must not be buffered whole. */
const ERROR_BODY_LIMIT = 8 * 1024;

/**
 * A short opaque name for one request, sent to the door as `X-Kalsa-Request`
 * and echoed into its audit line, so a line this page writes about a round and
 * the door's line about the same request can be joined. Nothing reads meaning
 * into it: the door checks it is letters, digits and dashes and puts it in a
 * log, and it carries nothing the owner wrote.
 */
function requestId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The first bytes of a body that is not a stream, read to the ceiling above
 * and then cancelled — a body that keeps coming past it is not this turn's to
 * carry, and one that never ends must not hold the turn open either. The text
 * is classified, never shown or logged.
 *
 * The byte count comes back with the text so an idle line can report what this
 * turn actually read: a body counted nowhere reads as a round that received
 * nothing, which is the one thing it was not.
 */
async function readPlainBody(response: Response): Promise<{ text: string; bytes: number }> {
  if (!response.body) return { text: "", bytes: 0 };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (bytes < ERROR_BODY_LIMIT) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  return { text: text + decoder.decode(), bytes };
}

/**
 * One request, streamed to the caller's sinks, reported as a [`Round`].
 * `messages` is the conversation as it stands *for this round* — the loop
 * appends the tool exchange to its own copy between rounds.
 */
export async function runRound(
  options: StreamOptions,
  messages: WireMessage[],
  tools: ToolDefinition[],
  toolChoice: "auto" | "none",
  hideInventedCalls: boolean,
): Promise<Round> {
  const { token, model, sampling, signal, onToken, onReasoning } = options;
  const url = completionsUrl(options.endpoint);
  // The round as the caller will judge it: every chunk, whether or not the caller shows it yet.
  let shown = "";
  const show = (text: string): void => {
    shown += text;
    onToken(text);
  };
  let reasoningShown = "";
  const think = (text: string): void => {
    reasoningShown += text;
    onReasoning(text);
  };

  // Invented markup was seen in exactly one situation: the capped round, where
  // `tool_choice: "none"` forbids a structured call and the model writes one out
  // anyway. Everything else — an ordinary round, and the round that asks a
  // silent model for words — is the answer, because hiding it cost an answer
  // outright once (live, 2026-09-19). Fresh per round, like the phone.
  const markup = hideInventedCalls ? createToolMarkupStripper() : null;

  // The user's signal (Stop) and our idle timer share one controller so a
  // stalled read() can be released without confusing the two causes.
  const linked = new AbortController();
  let timedOut = false;
  // What an idle end reports, so the line says where the round was and how far
  // it got: the phase it was in, the status it was given, the bytes it read and
  // how many events it recognised. `fetch` is the wait for the head; `read` a
  // live stream; `error` a refusal's body; `json` a body that was not a stream.
  // Counts and names only — never a word of the answer.
  let phase: "fetch" | "read" | "error" | "json" = "fetch";
  let status = 0;
  let received = 0;
  let events = 0;
  // The caller's name for this request, echoed into the door's own line so the
  // two can be joined after the fact. Opaque here and there.
  const request = requestId();
  const fireIdle = () => {
    timedOut = true;
    logUiEvent(`chat.idle.${phase}.${status}.${received}.${events}.${request}`);
    linked.abort();
  };
  // The head — or, failing that, the first chunk or prefill report — puts the
  // ordinary bound straight back (`alive`), so a server that opens the stream
  // and then goes quiet is still given up on promptly.
  const prefill = createPrefillWatch();
  // The silence allowed after the last sign of life: the ordinary bound, or —
  // while the engine reports its prefill and no word has come — what its own
  // pace says the next batch needs (`createPrefillWatch`).
  //
  // Nothing has arrived yet, so the wait is a LOADING wait, not an idle one: a
  // request that reaches a sleeping engine is answered by a whole model load
  // before the door relays a single byte, and that load has been measured from
  // 1.6 s to 32.3 s on this Mac (kalsa-engine.log). Starting at the ordinary
  // bound ended those turns at 60 s and threw away complete answers.
  const timings = roundTimings();
  let allowance = timings.loadingMs;
  let idle: number | undefined = window.setTimeout(fireIdle, allowance);
  const poke = () => {
    window.clearTimeout(idle);
    idle = window.setTimeout(fireIdle, allowance);
  };
  const alive = () => {
    allowance = timings.idleMs;
    poke();
  };
  const forwardAbort = () => linked.abort();
  if (signal.aborted) linked.abort();
  else signal.addEventListener("abort", forwardAbort, { once: true });

  let response: Response;
  // The round's last act in every direction — answer, error or Stop — is to
  // say so: the engine is idle again, and only an idle engine's death is an
  // init failure rather than a failed answer.
  // A throw after a normal finish reaches it again from the catch: once only.
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(idle);
    signal.removeEventListener("abort", forwardAbort);
    logUiEvent("chat.turn_end");
  };
  try {
    logUiEvent("chat.prefill");
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // The door reads this for its own log and never forwards it.
        "X-Kalsa-Request": request,
        ...(token.trim() ? { Authorization: `Bearer ${token.trim()}` } : {}),
      },
      body: JSON.stringify(
        completionBody(model, messages, sampling, tools, toolChoice, options.thinking ?? null),
      ),
      signal: linked.signal,
    });
    // The head IS a sign of life: the server took the request and opened the
    // answer. Whatever it does next — stall, refuse, cut — is an ordinary
    // stream, so from here the ordinary bound applies again. Only the wait
    // BEFORE this point is the loading wait above.
    status = response.status;
    alive();
  } catch (error) {
    finish();
    if (timedOut) throw new ChatRequestError("timeout", "Idle too long", undefined, url);
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ChatRequestError("aborted", "Stopped", undefined, url);
    }
    throw new ChatRequestError("network", "Network failure", undefined, url);
  }

  if (response.status === 401 || response.status === 403) {
    finish();
    throw new ChatRequestError("unauthorized", "Unauthorized", response.status, url);
  }
  if (!response.ok) {
    // A 400 may be the engine's own overflow answer, and the two need
    // different handling: an overflow can shrink and be retried, an ordinary
    // 400 cannot. Reading the body is the only way to tell them apart, and it
    // is read (bounded) for that decision alone.
    let overflow = false;
    if (response.status === 400) {
      phase = "error";
      const body = await readPlainBody(response).catch(() => ({ text: "", bytes: 0 }));
      received += body.bytes;
      overflow = contextOverflow(body.text);
    }
    finish();
    if (timedOut) throw new ChatRequestError("timeout", "Idle too long", response.status, url);
    // Stop pressed while that body was being read ends the turn as a Stop,
    // not as the server's 400: the person's word outranks the refusal.
    if (signal.aborted) throw new ChatRequestError("aborted", "Stopped", undefined, url);
    if (overflow) throw new ChatRequestError("oversize", "Context exceeded", response.status, url);
    throw new ChatRequestError("http", `HTTP ${response.status}`, response.status, url);
  }
  // A 200 with an empty body is not an error status — it is simply not a
  // stream. (Chromium reports response.body as null for these.)
  if (!response.body) {
    finish();
    throw new ChatRequestError("bad-response", "Empty body", response.status, url);
  }

  // Media types are case-insensitive; a server may answer Text/Event-Stream.
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("text/event-stream")) {
    // A server ignoring stream:true answers plain JSON (or an HTML login
    // page with status 200). Read it as a completion before giving up. The
    // body is read through the same reader as a refusal so its bytes land in
    // the idle line, and the phase says this was not a stream.
    phase = "json";
    try {
      const body = await readPlainBody(response);
      received += body.bytes;
      const raw: unknown = JSON.parse(body.text);
      const complete = readComplete(raw);
      finish();
      if (
        complete.content === null &&
        complete.reasoning === null &&
        complete.toolCalls.length === 0
      ) {
        throw new Error("not a completion");
      }
      if (complete.reasoning) think(complete.reasoning);
      // A server that ignored `stream: true` can carry the same tool-call
      // markup the streamed path filters, so it is filtered the same way.
      const visible =
        markup === null
          ? (complete.content ?? "")
          : markup.push(complete.content ?? "") + markup.flush();
      if (visible) show(visible);
      return {
        gotContent: complete.content !== null,
        gotReasoning: complete.reasoning !== null,
        sawDone: true,
        finishReason: complete.finishReason,
        toolCalls: accumulate([], complete.toolCalls),
        text: shown,
        reasoning: reasoningShown,
      };
    } catch (error) {
      finish();
      // Stop pressed while that body was arriving is a stop, not a server that
      // answered with something other than a stream. A timer that fired is a
      // timeout, not a Stop and not a bad answer: the body never finished, so
      // "Not a stream" would be a guess about a body nobody read.
      if (timedOut) throw new ChatRequestError("timeout", "Idle too long", undefined, url);
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ChatRequestError("aborted", "Stopped", undefined, url);
      }
      throw new ChatRequestError("bad-response", "Not a stream", response.status, url);
    }
  }

  phase = "read";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let gotToken = false;
  let gotReasoning = false;
  let sawDone = false;
  let toolCalls: ToolCall[] = [];
  let finishReason: string | null = null;

  const round = (): Round => ({
    gotContent: gotToken,
    gotReasoning,
    sawDone,
    finishReason,
    toolCalls,
    text: shown,
    reasoning: reasoningShown,
  });

  function releaseMarkup(): void {
    const tail = markup === null ? "" : markup.flush();
    if (tail) show(tail);
  }

  function handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") {
      sawDone = true;
      events += 1;
      return;
    }
    // One delta may carry thinking, answer text, tool calls and the finish
    // reason at once; each goes to its own channel.
    let choice: { delta?: unknown; finish_reason?: unknown };
    try {
      const data = JSON.parse(payload) as { choices?: unknown; prompt_progress?: unknown };
      // A prefill report is a sign of life and nothing else: its delta is
      // role-only, so it can never become text below.
      if (data.prompt_progress !== undefined && data.prompt_progress !== null) {
        telemetryPrefill(data.prompt_progress);
        allowance = prefill.report(data.prompt_progress);
        events += 1;
        poke();
      }
      if (!Array.isArray(data.choices)) return;
      choice = (data.choices[0] ?? {}) as { delta?: unknown; finish_reason?: unknown };
    } catch {
      return;
    }
    if (choice.delta && typeof choice.delta === "object") {
      const thought = pickReasoning(choice.delta as Record<string, unknown>);
      if (thought) {
        if (!gotToken && !gotReasoning) logUiEvent("chat.decode");
        gotReasoning = true;
        events += 1;
        alive();
        think(thought);
      }
      const content = (choice.delta as { content?: unknown }).content;
      if (typeof content === "string" && content) {
        // Text arrived, so this is not an empty stream — even when all of it
        // turns out to be markup and nothing is shown.
        if (!gotToken && !gotReasoning) logUiEvent("chat.decode");
        gotToken = true;
        events += 1;
        alive();
        const visible = markup === null ? content : markup.push(content);
        if (visible) show(visible);
      }
      const calls = accumulate(toolCalls, (choice.delta as { tool_calls?: unknown }).tool_calls);
      // With no tools offered, a tool call is a contradiction, not news: the
      // turn asked for an answer and the model did not give one. Nothing
      // reaches the wire or the transcript from here.
      if (tools.length > 0 && calls !== toolCalls) {
        if (!gotToken && !gotReasoning && toolCalls.length === 0) logUiEvent("chat.decode");
        toolCalls = calls;
        events += 1;
        alive();
      }
    }
    if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason;
  }

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // ANY byte is proof the engine is still there: a keep-alive comment, an
      // event this reader does not recognise, a partial line — all of them say
      // the answer is coming, and all of them restart the wait. Only the first
      // one ends the LOADING wait; after that the allowance in force is the one
      // the engine's own prefill pace set, and a plain restart must not shorten
      // it back to the ordinary bound.
      const first = received === 0;
      received += value.byteLength;
      if (first) alive();
      else poke();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
      if (sawDone) {
        releaseMarkup();
        finish();
        return round();
      }
    }
    // An idle abort that ends the stream cleanly instead of failing the read
    // is still the idle abort, not an empty answer.
    if (timedOut) throw new ChatRequestError("timeout", "Idle too long", undefined, url);
    // The final frame may arrive without a trailing newline: drain it.
    buffer += decoder.decode();
    if (buffer.trim()) handleLine(buffer);
    if (sawDone) {
      releaseMarkup();
      finish();
      return round();
    }
    finish();
    // Partial text stays with the caller either way; only the diagnosis
    // differs: accidental cut vs nothing arrived at all. Reasoning alone
    // (no content, clean close) is a complete thinking-only answer, not
    // an error — the thread says so.
    if (gotToken || gotReasoning) {
      throw new ChatRequestError("truncated", "Cut without [DONE]", undefined, url);
    }
    throw new ChatRequestError("bad-response", "Empty stream", undefined, url);
  } catch (error) {
    finish();
    if (error instanceof ChatRequestError) throw error;
    if (timedOut) throw new ChatRequestError("timeout", "Idle too long", undefined, url);
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ChatRequestError("aborted", "Stopped", undefined, url);
    }
    // The socket died mid-answer (reset, proxy cut): anything arrived but
    // no [DONE]. That is a truncation, not an unreachable server.
    if ((gotToken || gotReasoning) && !sawDone) {
      throw new ChatRequestError("truncated", "Connection dropped", undefined, url);
    }
    throw new ChatRequestError("network", "Network failure", undefined, url);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Already released or cancelled; nothing to do.
    }
  }
}
