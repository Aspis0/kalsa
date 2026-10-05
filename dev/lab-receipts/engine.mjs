// The lab's engine client (one responsibility: one HTTP round trip).
// POST /v1/chat/completions with an image and a prompt, non-streaming,
// temperature 0 for extraction, optional response_format. Returns the parsed
// body plus wall seconds and the engine's own token accounting from `usage`.
const IMAGE_MAX_EDGE = 1100;

export async function extract({ base, model, system, prompt, imagePath, responseFormat, templateKwargs, timeoutMs = 120000 }) {
  const { readFileSync } = await import("node:fs");
  const raw = readFileSync(imagePath);
  const mime = imagePath.endsWith(".png") ? "image/png" : "image/jpeg";
  const dataUrl = `data:${mime};base64,${raw.toString("base64")}`;
  const body = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: [
        { type: "image_url", image_url: { url: dataUrl } },
        { type: "text", text: prompt },
      ] },
    ],
    stream: false,
    temperature: 0,
    max_tokens: 1300,
  };
  if (responseFormat) body.response_format = responseFormat;
  if (templateKwargs) body.chat_template_kwargs = templateKwargs;
  const began = Date.now();
  const response = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const wallMs = Date.now() - began;
  const json = await response.json().catch(() => null);
  return {
    status: response.status,
    wallMs,
    body: json,
    request: body,
  };
}

/** The reply's text, or "" when the shape is not a completion. */
export function replyText(result) {
  return result?.body?.choices?.[0]?.message?.content ?? "";
}
