/**
 * Pure OpenAI SSE helpers. No I/O. Frames are `data: …` lines separated by
 * a blank line. `[DONE]` ends the stream.
 */

export type OpenAiChatDelta = {
  content: string;
  reasoning: string;
  done: boolean;
  finishReason: string | null;
};

const DONE = "[DONE]";

/** Split a byte buffer into complete SSE frames; leftover is incomplete. */
export function splitSseFrames(buffer: string): { frames: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
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

/** `data:` payloads in one frame (multi-line data joined with newline). */
export function sseDataPayloads(frame: string): string[] {
  const payloads: string[] = [];
  let current: string[] = [];
  for (const rawLine of frame.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("data:")) {
      current.push(line.slice(5).replace(/^ /, ""));
      continue;
    }
    if (current.length > 0 && line === "") {
      payloads.push(current.join("\n"));
      current = [];
    }
  }
  if (current.length > 0) payloads.push(current.join("\n"));
  return payloads;
}

export function parseOpenAiSseData(data: string): OpenAiChatDelta | null {
  const trimmed = data.trim();
  if (!trimmed) return null;
  if (trimmed === DONE) {
    return { content: "", reasoning: "", done: true, finishReason: "stop" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as {
    choices?: Array<{
      delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown };
      finish_reason?: unknown;
    }>;
  };
  const choice = Array.isArray(obj.choices) ? obj.choices[0] : undefined;
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
  return {
    content,
    reasoning,
    done: false,
    finishReason: finish,
  };
}

export function parseSseFrame(frame: string): OpenAiChatDelta[] {
  const out: OpenAiChatDelta[] = [];
  for (const payload of sseDataPayloads(frame)) {
    const delta = parseOpenAiSseData(payload);
    if (delta) out.push(delta);
  }
  return out;
}

export function newRequestId(): string {
  const rand = Math.random().toString(16).slice(2, 10);
  return `kalsa-remote-${Date.now().toString(16)}-${rand}`;
}
