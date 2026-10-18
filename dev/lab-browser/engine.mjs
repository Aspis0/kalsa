// The lab's engine client (one responsibility: one chat round trip to an
// OpenAI-compatible llama-server with the browser tools attached, and reading
// back what the model asked for). Temperature 0, non-streaming; thinking is off
// unless the run asks for it.
export async function ask({ endpoint, model, messages, tools, think = false, maxTokens = 1024, timeoutMs = 120000 }) {
  const body = {
    model,
    messages,
    stream: false,
    temperature: 0,
    max_tokens: maxTokens,
    tools,
    tool_choice: "auto",
    chat_template_kwargs: { enable_thinking: think },
  };
  const began = Date.now();
  let response;
  try {
    response = await fetch(`${endpoint.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { status: 0, wallMs: Date.now() - began, body: null, error: `engine unreachable: ${String(error?.message ?? error).split("\n")[0]}` };
  }
  const wallMs = Date.now() - began;
  const json = await response.json().catch(() => null);
  return {
    status: response.status,
    wallMs,
    body: json,
    error: response.ok ? null : (json?.error?.message ?? `HTTP ${response.status}`),
  };
}

/** The tool calls the model asked for, each with the arguments as the model
 *  wrote them and as they parse. A call the model left unnamed is not a call. */
export function callsOf(result) {
  const raw = result?.body?.choices?.[0]?.message?.tool_calls ?? [];
  return raw
    .filter((c) => c?.function?.name)
    .map((c) => {
      const text = c.function.arguments ?? "";
      let args = null;
      try {
        args = JSON.parse(text);
      } catch {
        args = null;
      }
      return { id: c.id, name: c.function.name, rawArguments: text, args };
    });
}

/** Whatever the model said in words, beside or instead of a call. Inline
 *  thinking is stripped: a question inside it is not the person's reply. */
export function replyText(result) {
  const text = result?.body?.choices?.[0]?.message?.content ?? "";
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/** Prompt and completion tokens, when the server counts them. */
export function usageOf(result) {
  const usage = result?.body?.usage;
  return { prompt: usage?.prompt_tokens ?? null, completion: usage?.completion_tokens ?? null };
}