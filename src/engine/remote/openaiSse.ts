/**
 * Pure OpenAI SSE helpers. No I/O.
 *
 * Frames are `event:` / `data:` lines separated by a blank line.
 * Line endings: CRLF, LF, or lone CR. `[DONE]` (any surrounding space) ends
 * the stream. `finish_reason` on a chunk is also a terminal marker.
 */

export type OpenAiSseKind = "delta" | "done" | "error" | "ignore";

export type OpenAiSseEvent = {
  kind: OpenAiSseKind;
  content: string;
  reasoning: string;
  finishReason: string | null;
  message?: string;
};

/** @deprecated alias kept for existing delta-shaped tests */
export type OpenAiChatDelta = OpenAiSseEvent;

const DONE = "[DONE]";
const META_KEYS = new Set([
  "id",
  "object",
  "created",
  "model",
  "usage",
  "mtplx_stats",
  "mtplx_progress",
  "timings",
]);

export function isTerminalFinishReason(reason: string | null): boolean {
  return reason === "stop" || reason === "length" || reason === "content_filter";
}

export function isTruncatingFinishReason(reason: string | null): boolean {
  return reason === "length" || reason === "content_filter";
}

export function normalizeSseNewlines(buffer: string): string {
  return buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Split a byte buffer into complete SSE frames; leftover is incomplete. */
export function splitSseFrames(buffer: string): { frames: string[]; rest: string } {
  const normalized = normalizeSseNewlines(buffer);
  const frames: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const sep = normalized.indexOf("\n\n", start);
    if (sep < 0) break;
    const chunk = normalized.slice(start, sep);
    if (chunk.trim().length > 0) frames.push(chunk);
    start = sep + 2;
  }
  return { frames, rest: normalized.slice(start) };
}

function frameLines(frame: string): string[] {
  return normalizeSseNewlines(frame).split("\n");
}

function errorMessageFromJson(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "object") {
    const obj = value as { message?: unknown; error?: unknown; detail?: unknown };
    if (typeof obj.message === "string" && obj.message.trim()) return obj.message.trim();
    if (typeof obj.detail === "string" && obj.detail.trim()) return obj.detail.trim();
    if (obj.error != null && obj.error !== value) {
      const nested = errorMessageFromJson(obj.error);
      if (nested) return nested;
    }
  }
  return null;
}

function isKnownMetadata(obj: Record<string, unknown>): boolean {
  if (Object.prototype.hasOwnProperty.call(obj, "choices")) return false;
  if (Object.prototype.hasOwnProperty.call(obj, "error")) return false;
  return Object.keys(obj).every(
    (key) => META_KEYS.has(key) || key.startsWith("mtplx_"),
  );
}

export function parseOpenAiSseData(data: string): OpenAiSseEvent | null {
  const trimmed = data.trim();
  if (!trimmed) return { kind: "ignore", content: "", reasoning: "", finishReason: null };
  if (trimmed === DONE) {
    return { kind: "done", content: "", reasoning: "", finishReason: "stop" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      kind: "error",
      content: "",
      reasoning: "",
      finishReason: null,
      message: "malformed_sse_json",
    };
  }
  if (!parsed || typeof parsed !== "object") {
    return {
      kind: "error",
      content: "",
      reasoning: "",
      finishReason: null,
      message: "malformed_sse_json",
    };
  }
  const obj = parsed as Record<string, unknown>;
  const errText = errorMessageFromJson(obj.error) ?? errorMessageFromJson(obj);
  if (obj.error != null) {
    return {
      kind: "error",
      content: "",
      reasoning: "",
      finishReason: null,
      message: errText || "remote_sse_error",
    };
  }
  if (isKnownMetadata(obj)) {
    return { kind: "ignore", content: "", reasoning: "", finishReason: null };
  }
  const choices = obj.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return {
      kind: "error",
      content: "",
      reasoning: "",
      finishReason: null,
      message: "malformed_sse_json",
    };
  }
  const choice = choices[0] as {
    delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown };
    finish_reason?: unknown;
  };
  const delta = choice?.delta ?? {};
  const content = typeof delta.content === "string" ? delta.content : "";
  const reasoning =
    typeof delta.reasoning_content === "string"
      ? delta.reasoning_content
      : typeof delta.reasoning === "string"
        ? delta.reasoning
        : "";
  const finish =
    typeof choice?.finish_reason === "string" ? choice.finish_reason : null;
  const kind: OpenAiSseKind =
    finish && isTerminalFinishReason(finish) && !content && !reasoning
      ? "done"
      : "delta";
  return { kind, content, reasoning, finishReason: finish };
}

export function parseSseFrame(frame: string): OpenAiSseEvent[] {
  let eventName = "";
  const dataLines: string[] = [];
  for (const raw of frameLines(frame)) {
    const line = raw.replace(/^\uFEFF/, "");
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim().toLowerCase();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  const payload = dataLines.join("\n");
  if (eventName === "error") {
    let message = payload.trim() || "remote_sse_error";
    try {
      const parsed = JSON.parse(payload);
      message = errorMessageFromJson(parsed) || message;
    } catch {
      // keep raw payload
    }
    return [
      {
        kind: "error",
        content: "",
        reasoning: "",
        finishReason: null,
        message,
      },
    ];
  }
  if (eventName === "ping" && !payload.trim()) {
    return [{ kind: "ignore", content: "", reasoning: "", finishReason: null }];
  }
  if (!payload.trim() && !eventName) {
    return [{ kind: "ignore", content: "", reasoning: "", finishReason: null }];
  }
  const parsed = parseOpenAiSseData(payload);
  return parsed ? [parsed] : [];
}

export function newRequestId(): string {
  const rand = Math.random().toString(16).slice(2, 10);
  return `kalsa-remote-${Date.now().toString(16)}-${rand}`;
}
