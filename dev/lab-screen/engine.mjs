// The lab's engine client (one responsibility: one HTTP round trip).
// POST /v1/chat/completions, non-streaming, temperature 0, thinking off unless
// asked. With no image it sends the same text only (the token-count twin).
// Returns the parsed body, the wall time, and the server's own timings.
import { readFileSync } from "node:fs";

export function imageDataUrl(path) {
  const mime = path.endsWith(".png") ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${readFileSync(path).toString("base64")}`;
}

export async function ask({ base, model, system, user, dataUrl = null, thinking = false, maxTokens = 300, timeoutMs = 300000 }) {
  const content = dataUrl
    ? [{ type: "image_url", image_url: { url: dataUrl } }, { type: "text", text: user }]
    : user;
  const body = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content },
    ],
    stream: false,
    temperature: 0,
    max_tokens: maxTokens,
    chat_template_kwargs: { enable_thinking: thinking },
  };
  const began = performance.now();
  const response = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const wallMs = performance.now() - began;
  const json = await response.json().catch(() => null);
  return { status: response.status, wallMs, body: json };
}

/** Drops slot 0's KV cache so the next request is a cold prefill (latency runs). */
export async function eraseSlot(base) {
  const response = await fetch(`${base}/slots/0?action=erase`, { method: "POST" });
  if (response.status !== 200) throw new Error(`slot erase HTTP ${response.status}: start the engine with --slot-save-path`);
}

/** The reply text, or "" when the shape is not a completion. */
export function replyText(result) {
  return result?.body?.choices?.[0]?.message?.content ?? "";
}

/** Server timings. totalN is every prompt token (cached or not): the token count. */
export function timingsOf(result) {
  const t = result?.body?.timings ?? {};
  return {
    promptN: t.prompt_n ?? null,
    cacheN: t.cache_n ?? null,
    totalN: t.prompt_n != null ? t.prompt_n + (t.cache_n ?? 0) : null,
    promptMs: t.prompt_ms ?? null,
    predictedN: t.predicted_n ?? null,
    predictedMs: t.predicted_ms ?? null,
  };
}
