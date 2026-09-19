import {
  ChatRequestError,
  IDLE_TIMEOUT_MS,
  completionBody,
  completionsUrl,
} from "./chat";
import type { StreamOptions, WireMessage } from "./chat";
import { accumulate } from "./toolCalls";
import { createToolMarkupStripper } from "./toolMarkup";
import type { ToolCall } from "./toolCalls";
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
  const fireIdle = () => {
    timedOut = true;
    linked.abort();
  };
  let idle: number | undefined = window.setTimeout(fireIdle, IDLE_TIMEOUT_MS);
  const poke = () => {
    window.clearTimeout(idle);
    idle = window.setTimeout(fireIdle, IDLE_TIMEOUT_MS);
  };
  const forwardAbort = () => linked.abort();
  if (signal.aborted) linked.abort();
  else signal.addEventListener("abort", forwardAbort, { once: true });

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token.trim() ? { Authorization: `Bearer ${token.trim()}` } : {}),
      },
      body: JSON.stringify(
        completionBody(model, messages, sampling, tools, toolChoice, options.thinking ?? null),
      ),
      signal: linked.signal,
    });
  } catch (error) {
    window.clearTimeout(idle);
    signal.removeEventListener("abort", forwardAbort);
    if (timedOut) throw new ChatRequestError("timeout", "Idle too long", undefined, url);
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ChatRequestError("aborted", "Stopped", undefined, url);
    }
    throw new ChatRequestError("network", "Network failure", undefined, url);
  }

  const finish = () => {
    window.clearTimeout(idle);
    signal.removeEventListener("abort", forwardAbort);
  };

  if (response.status === 401 || response.status === 403) {
    finish();
    throw new ChatRequestError("unauthorized", "Unauthorized", response.status, url);
  }
  if (!response.ok) {
    finish();
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
    // page with status 200). Read it as a completion before giving up.
    try {
      const raw: unknown = await response.json();
      const complete = readComplete(raw);
      finish();
      if (
        complete.content === null &&
        complete.reasoning === null &&
        complete.toolCalls.length === 0
      ) {
        throw new Error("not a completion");
      }
      if (complete.reasoning) onReasoning(complete.reasoning);
      // A server that ignored `stream: true` can carry the same tool-call
      // markup the streamed path filters, so it is filtered the same way.
      const visible =
        markup === null
          ? (complete.content ?? "")
          : markup.push(complete.content ?? "") + markup.flush();
      if (visible) onToken(visible);
      return {
        gotContent: complete.content !== null,
        gotReasoning: complete.reasoning !== null,
        sawDone: true,
        finishReason: complete.finishReason,
        toolCalls: accumulate([], complete.toolCalls),
      };
    } catch (error) {
      finish();
      // Stop pressed while that body was arriving is a stop, not a server that
      // answered with something other than a stream.
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ChatRequestError("aborted", "Stopped", undefined, url);
      }
      throw new ChatRequestError("bad-response", "Not a stream", response.status, url);
    }
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let gotToken = false;
  let gotReasoning = false;
  let sawDone = false;
  let toolCalls: ToolCall[] = [];
  let finishReason: string | null = null;

  const round = (): Round => ({ gotContent: gotToken, gotReasoning, sawDone, finishReason, toolCalls });

  function releaseMarkup(): void {
    const tail = markup === null ? "" : markup.flush();
    if (tail) onToken(tail);
  }

  function handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") {
      sawDone = true;
      return;
    }
    // One delta may carry thinking, answer text, tool calls and the finish
    // reason at once; each goes to its own channel.
    let choice: { delta?: unknown; finish_reason?: unknown };
    try {
      const data = JSON.parse(payload) as { choices?: unknown };
      if (!Array.isArray(data.choices)) return;
      choice = (data.choices[0] ?? {}) as { delta?: unknown; finish_reason?: unknown };
    } catch {
      return;
    }
    if (choice.delta && typeof choice.delta === "object") {
      const thought = pickReasoning(choice.delta as Record<string, unknown>);
      if (thought) {
        gotReasoning = true;
        poke();
        onReasoning(thought);
      }
      const content = (choice.delta as { content?: unknown }).content;
      if (typeof content === "string" && content) {
        // Text arrived, so this is not an empty stream — even when all of it
        // turns out to be markup and nothing is shown.
        gotToken = true;
        poke();
        const visible = markup === null ? content : markup.push(content);
        if (visible) onToken(visible);
      }
      const calls = accumulate(toolCalls, (choice.delta as { tool_calls?: unknown }).tool_calls);
      // With no tools offered, a tool call is a contradiction, not news: the
      // turn asked for an answer and the model did not give one. Nothing
      // reaches the wire or the transcript from here.
      if (tools.length > 0 && calls !== toolCalls) {
        toolCalls = calls;
        poke();
      }
    }
    if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason;
  }

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
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
