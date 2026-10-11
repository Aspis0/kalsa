// The lab's engine client (one responsibility: one tool-calling round trip).
// Native tool calling through the engine's chat template, temperature 0,
// non-streaming; Gemma runs with enable_thinking:false (the receipts lab's
// finding: its thinking channel otherwise eats the generation budget).
import { readFileSync } from "node:fs";

// LAB FIX (2026-10-10): the current app prompt (lab-restraint/engine.mjs systemPrompt, from
// chat/src/lib/attachments.ts) instead of the 2026-10-05 copy; the fixed clock below stays,
// because every ground truth in items.mjs is computed from it.
import { systemPrompt } from "../lab-restraint/engine.mjs";

const CLOCK_LINE = "Current local date and time: Monday 5 October 2026, 10:00 (Europe/Rome, UTC+02:00).";

export async function ask({ base, model, prompt, tools, noThink, timeoutMs = 120000 }) {
  const body = {
    model,
    messages: [
      { role: "system", content: `${systemPrompt(noThink)} ${CLOCK_LINE}` },
      { role: "user", content: prompt },
    ],
    stream: false,
    temperature: 0,
    tools,
    tool_choice: "auto",
  };
  if (noThink) body.chat_template_kwargs = { enable_thinking: false };
  const began = Date.now();
  let response;
  try {
    response = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // A reply that outlasts timeoutMs is a failed item (status 0), not a crash of the run.
    if (err?.name !== "TimeoutError") throw err;
    return { status: 0, wallMs: Date.now() - began, body: null, request: body, timedOut: true };
  }
  const wallMs = Date.now() - began;
  const json = await response.json().catch(() => null);
  return { status: response.status, wallMs, body: json, request: body, timedOut: false };
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
