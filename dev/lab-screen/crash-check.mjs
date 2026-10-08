// Crash-check client (one responsibility: send the probe requests and record
// what came back). The launcher, crash-check.sh, owns the engine and its exit.
// usage: node crash-check.mjs --base http://127.0.0.1:8150 --model A --out r.json --frame f.png --big b.png
import { writeFileSync } from "node:fs";
import { eraseSlot, imageDataUrl, replyText, timingsOf } from "./engine.mjs";

const flag = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
};
const base = flag("base");
const model = flag("model");
const out = flag("out");
const framePath = flag("frame");
const bigPath = flag("big");
const text = "Describe what you see in one sentence.";

const results = [];
let engineAlive = true;

async function probe(label, parts) {
  if (!engineAlive) return results.push({ label, skipped: "engine already dead" });
  try {
    await eraseSlot(base);
  } catch (error) {
    engineAlive = false;
    return results.push({ label, error: `erase failed: ${error.cause?.code ?? error.message}` });
  }
  const body = {
    model,
    messages: [{ role: "user", content: parts }],
    stream: false,
    temperature: 0,
    max_tokens: 60,
    chat_template_kwargs: { enable_thinking: false },
  };
  try {
    const response = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(600000),
    });
    const json = await response.json().catch(() => null);
    results.push({ label, status: response.status, reply: replyText({ body: json }).slice(0, 160), timings: timingsOf({ body: json }) });
  } catch (error) {
    engineAlive = false;
    results.push({ label, error: `${error.cause?.code ?? error.message}` });
  }
}

const img = (path) => ({ type: "image_url", image_url: { url: imageDataUrl(path) } });
const txt = { type: "text", text };

await probe("twin-text", [txt]);
await probe("frame-1920", [img(framePath), txt]);
await probe("big-3000", [img(bigPath), txt]);
await probe("two-frames-1920", [img(framePath), img(framePath), txt]);

const twin = results.find((r) => r.label === "twin-text")?.timings?.totalN ?? null;
for (const r of results) {
  if (r.timings && twin !== null && r.label !== "twin-text") {
    r.imageTokens = r.timings.totalN - twin;
  }
}
writeFileSync(out, JSON.stringify({ model, base, engineAlive, results }, null, 2) + "\n");
console.log(JSON.stringify(results.map((r) => ({ label: r.label, imageTokens: r.imageTokens ?? null, status: r.status ?? null, error: r.error ?? null })), null, 0));
