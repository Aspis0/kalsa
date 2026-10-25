// The lab's engine client (one responsibility: one tool-calling round trip).
// Native tool calling through the engine's chat template, temperature 0,
// non-streaming; Gemma runs with enable_thinking:false (the receipts lab's
// finding: its thinking channel otherwise eats the generation budget).
import { readFileSync } from "node:fs";

export const SYSTEM_PROMPT =
  "You are Kalsa, a private assistant running on this computer. " +
  "You cannot see images, audio or video. " +
  "Attached files reach you as plain text in a message; if no text is there, " +
  "no file reached you. " +
  "Use only the tools you are given; never claim an ability you do not have. " +
  "Use create_miniapp only when the person asks for a comparison table, calculator, quiz, KPI strip, checklist or pros/cons. " +
  "Reply in the language the user writes in. " +
  "Current local date and time: Monday 5 October 2026, 10:00 (Europe/Rome, UTC+02:00).";

export async function ask({ base, model, prompt, tools, noThink, timeoutMs = 120000 }) {
  const body = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    stream: false,
    temperature: 0,
    tools,
    tool_choice: "auto",
  };
  if (noThink) body.chat_template_kwargs = { enable_thinking: false };
  const began = Date.now();
  const response = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const wallMs = Date.now() - began;
  const json = await response.json().catch(() => null);
  return { status: response.status, wallMs, body: json, request: body };
}

/** The first real tool call, or null — a nameless stub (an empty
 *  tool_calls entry some templates emit beside a text answer) is no call. */
export function toolCall(result) {
  const call = result?.body?.choices?.[0]?.message?.tool_calls?.[0];
  return call?.function?.name ? call : null;
}

/** The reply text. */
export function replyText(result) {
  const m = result?.body?.choices?.[0]?.message;
  return m?.content ?? "";
}

/** The call's arguments as an object (llama-server sends a JSON string). */
export function callArguments(call) {
  if (!call?.function?.arguments) return null;
  try { return JSON.parse(call.function.arguments); } catch { return null; }
}
