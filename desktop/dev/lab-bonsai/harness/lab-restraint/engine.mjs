// The lab's engine client (one responsibility: the app's real request, once).
// Wire shape mirrors the desktop chat with the web switch OFF:
// - system prompt = promptBytes(false) byte for byte
//   (chat/src/lib/attachments.ts:421-433, non-vision branch);
// - tools = [CREATE_MINIAPP_TOOL] alone (chat/src/lib/tools/registry.ts:44-47);
// - body per completionBody (chat/src/lib/chat.ts:443-474): no sampling
//   fields when the owner never touched the panel (chat/src/lib/sampling.ts:58-65
//   drops nulls, so the engine argv's catalog defaults stand), tool_choice auto,
//   and chat_template_kwargs.enable_thinking:false when the model's template
//   reads it (chat/src/lib/thinking.ts:37, thinking off as the default).
// Deviations, both decision-neutral: stream:false instead of the app's stream
// (same template, same sampling; plain JSON is easier to score) and no
// return_progress (a streaming nicety).

// LAB FIX (2026-10-10): the 2026-10-08 prompt, copied from chat/src/lib/attachments.ts:425-448
// (promptBytes(vision=false, think)); the think sentence is sent only where the template reads enable_thinking.
export function systemPrompt(think) {
  return (
    "You are Kalsa, a private assistant running on this computer. " +
    "You can write, explain, translate, summarise and answer from your own knowledge; that needs no tool. " +
    "You cannot see images, audio or video. " +
    "Attached files reach you as plain text in a message; if no text is there, " +
    "no file reached you. " +
    "Use a tool only when a task needs one, and only the tools you are given. " +
    "Use create_miniapp only when the person asks for a comparison table, calculator, quiz or checklist. " +
    "Reply in the language the user writes in. " +
    "The app around you: " +
    (think
      ? "A Think button sits in the message box: when it is off you answer at once, without reasoning first; when it is on, any reasoning you do is folded above your answer for the person to open. "
      : "") +
    "A paperclip in the message box attaches files. " +
    "Miniapps (a table, calculator, quiz or checklist) open inline in the chat. " +
    "Phones paired to this computer can get answers from you too. " +
    "The Room is a group chat on this computer where people call you by writing @Kalsa or with the button in the message box that asks you. " +
    "You cannot press these buttons yourself; tell the person which one to use."
  );
}

// chat/src/lib/tools/definitions.ts:23-65, verbatim; the enum order is
// MINIAPP_TEMPLATE_IDS (chat/src/lib/miniapp/templates.ts:12-17).
export const CREATE_MINIAPP_TOOL = {
  type: "function",
  function: {
    name: "create_miniapp",
    description:
      "Build an interactive on-device miniapp in a single call. Pick one " +
      "template — compare_data (a comparison table), quick_calculator (a " +
      "formula calculator), reading_quiz (a quiz with several questions), or " +
      "checklist (an ordered, tickable list) — and pass its slots. The app " +
      "opens inline in the chat. Use this instead of writing miniapp JSON by " +
      "hand. For quick_calculator, give every number the person might change " +
      "a labelled field (id, label, value) and write the formula from those " +
      "ids — every field must appear in the formula. A number equal to a " +
      "not-yet-used field's value is replaced by that field's id; any other " +
      "number stays in the formula as a constant (amount * 1.22). With no " +
      "fields, a formula of bare numbers is split into editable Number " +
      "fields automatically. Never show the tool's or a template's name " +
      "(create_miniapp, compare_data…) to the person, and never mention " +
      "templates or slots: describe the mini app in plain words, as the thing " +
      "it is — a table, a calculator, a quiz, a list.",
    parameters: {
      type: "object",
      properties: {
        template: {
          type: "string",
          enum: ["compare_data", "quick_calculator", "reading_quiz", "checklist"],
          description: "Which miniapp template to build.",
        },
        slots: {
          type: "object",
          description:
            "Per-template slots: compare_data (title?, columns[], rows[]), " +
            "quick_calculator (title?, formula, fields[] of {id, label, " +
            "value}), reading_quiz (title?, questions[] of {question, " +
            "options[2..4], answerIndex?, explanation?}), or checklist " +
            "(title?, steps[] or items[]).",
          additionalProperties: true,
        },
      },
      required: ["template"],
    },
  },
};

/** GET /props: the chat template decides the thinking flag, as the app does. */
export async function fetchProps(base, timeoutMs = 8000) {
  const response = await fetch(`${base}/props`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`/props answered ${response.status}`);
  const data = await response.json();
  return {
    model: data?.model_id ?? null,
    chatTemplate: typeof data?.chat_template === "string" ? data.chat_template : "",
    nctx: data?.default_generation_settings?.n_ctx ?? null,
  };
}

/** Whether this model can be told not to think (thinking.ts:35-40). */
export function readsEnableThinking(chatTemplate) {
  return chatTemplate.includes("enable_thinking");
}

export async function ask({ base, model, prompt, noThink, timeoutMs = 240000 }) {
  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt(noThink) },
      { role: "user", content: prompt },
    ],
    stream: false,
    tools: [CREATE_MINIAPP_TOOL],
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
    // A reply that outlasts timeoutMs is a failed item, not a crash of the run.
    if (err?.name !== "TimeoutError") throw err;
    return { status: 0, wallMs: Date.now() - began, body: null, request: body, timedOut: true };
  }
  const wallMs = Date.now() - began;
  const json = await response.json().catch(() => null);
  return { status: response.status, wallMs, body: json, request: body, timedOut: false };
}

/** The first named tool call, or null — a nameless stub some templates emit
    beside a text answer is no call. */
export function toolCall(result) {
  const call = result?.body?.choices?.[0]?.message?.tool_calls?.[0];
  return call?.function?.name ? call : null;
}

/** The visible text the model writes next to the call (or instead of it). */
export function replyText(result) {
  const m = result?.body?.choices?.[0]?.message;
  return m?.content ?? "";
}

/** The call's arguments as an object (the server sends a JSON string). */
export function callArguments(call) {
  if (!call?.function?.arguments) return null;
  try { return JSON.parse(call.function.arguments); } catch { return null; }
}
