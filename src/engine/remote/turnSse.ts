/**
 * The turn route's named SSE events (PHONE-CHAT-PROTOCOL §3), read one frame
 * at a time. No I/O, and nothing here knows the OpenAI dialect: `/v1/chat/
 * completions` keeps `openaiSse.ts`, whose parser must not change under a
 * turn that never touched it.
 *
 * A frame the contract does not name (a `: ping` comment, an empty frame, a
 * name from a newer computer) is ignored, so a pinging turn keeps the
 * watchdog fed and an unknown event cannot end the answer.
 */
import { frameLines } from "./openaiSse";

/** The code of a frame that should have been JSON and was not: our own
 *  failure, never the computer's words. */
export const MALFORMED_TURN_FRAME = "stream_malformed";

export type TurnSseEvent =
  | { kind: "turn"; turn: string }
  | { kind: "reasoning"; text: string }
  | { kind: "delta"; text: string }
  | { kind: "tool_run"; id: string; name: string; state: string }
  | { kind: "cards"; cards: unknown }
  | { kind: "draft"; draft: unknown }
  | { kind: "error"; code: string }
  | { kind: "done" }
  | { kind: "ignore" };

const IGNORE: TurnSseEvent = { kind: "ignore" };

type ParsedPayload = { ok: true; value: Record<string, unknown> } | { ok: false };

function parsedPayload(payload: string): ParsedPayload {
  try {
    const value: unknown = JSON.parse(payload);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return { ok: true, value: value as Record<string, unknown> };
    }
  } catch {
    // fall through to malformed
  }
  return { ok: false };
}

function textField(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  return typeof value === "string" ? value : "";
}

function toolRun(obj: Record<string, unknown>): TurnSseEvent {
  return {
    kind: "tool_run",
    id: textField(obj, "id"),
    name: textField(obj, "name"),
    state: textField(obj, "state"),
  };
}

export function parseTurnSseFrame(frame: string): TurnSseEvent {
  let eventName = "";
  const dataLines: string[] = [];
  for (const raw of frameLines(frame)) {
    const line = raw.replace(/^\uFEFF/, "");
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim().toLowerCase();
      continue;
    }
    if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (eventName === "ping" || eventName === "") return IGNORE;
  if (eventName === "done") return { kind: "done" };
  const payload = dataLines.join("\n").trim();
  if (!payload) return IGNORE;
  const parsed = parsedPayload(payload);
  if (!parsed.ok) return { kind: "error", code: MALFORMED_TURN_FRAME };
  const obj = parsed.value;
  if (eventName === "error") {
    const code = textField(obj, "code");
    return { kind: "error", code: code === "" ? MALFORMED_TURN_FRAME : code };
  }
  if (eventName === "cards") return { kind: "cards", cards: obj };
  if (eventName === "draft") return { kind: "draft", draft: obj };
  if (eventName === "tool_run") return toolRun(obj);
  // A turn's answer may arrive in pieces that carry no words (an empty delta
  // is how a computer marks a status change); it is still the answer's frame.
  if (eventName === "delta") return { kind: "delta", text: textField(obj, "text") };
  if (eventName === "reasoning") return { kind: "reasoning", text: textField(obj, "text") };
  if (eventName === "turn") return { kind: "turn", turn: textField(obj, "turn") };
  return IGNORE;
}