/**
 * One-shot: fetch Unsloth Qwen3.5-4B chat_template, force-close thinking
 * on generation prompt, write src/engine/qwenNoThinkTemplate.ts
 *
 * Fetch is pinned to a specific revision (not floating `main`) so regenerating
 * is reproducible. Update REVISION when intentionally re-syncing upstream.
 *
 * TODO: the app ships unsloth/Qwen3.5-4B-MTP-GGUF (rev 86835bf…); its embedded
 * GGUF chat_template has never been byte-compared against this base-repo
 * tokenizer_config.json (MTP-GGUF has no tokenizer_config.json — needs a GGUF
 * metadata dump of tokenizer.chat_template). Out of scope for this script.
 */
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const OUT = path.join(projectRoot, "src/engine/qwenNoThinkTemplate.ts");
// Pinned 2026-08-07: unsloth/Qwen3.5-4B main tip at generation time.
// Resolve via HF API `sha` field; do not float on raw/main.
const REVISION = "3764fa359b9082ea5a1e4a5e3ac3aaf6e9671636";
const URL = `https://huggingface.co/unsloth/Qwen3.5-4B/raw/${REVISION}/tokenizer_config.json`;

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchText(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

// After JSON.parse of HF tokenizer_config:
// - real newlines separate Jinja statements
// - INSIDE Jinja single-quoted string literals, `\n` is the two-char sequence
//   backslash+n (JSON `\\n`), which the chat renderer expands to newlines.
const OLD =
  "{%- if add_generation_prompt %}\n" +
  "    {{- '<|im_start|>assistant\\n' }}\n" +
  "    {%- if enable_thinking is defined and enable_thinking is false %}\n" +
  "        {{- '<think>\\n\\n</think>\\n\\n' }}\n" +
  "    {%- else %}\n" +
  "        {{- '<think>\\n' }}\n" +
  "    {%- endif %}\n" +
  "{%- endif %}";

const NEU =
  "{%- if add_generation_prompt %}\n" +
  "    {{- '<|im_start|>assistant\\n' }}\n" +
  "    {{- '<think>\\n\\n</think>\\n\\n' }}\n" +
  "{%- endif %}";

const HEADER = `/**
 * Qwen3.5 chat template override that force-closes thinking on every generation prompt.
 *
 * Why this exists (research report §1.2 / §5 Rank 1):
 * - Qwen3.5 tokenizer templates default to an OPEN \`<think>\\n\` when
 *   \`enable_thinking\` is undefined or not strictly boolean false.
 * - On device, llama.rn 0.12.8 \`enable_thinking:false\` / kwargs / budget-0 alone
 *   still left Thinking=Off models generating CoT (kwargs never reach Jinja).
 * - \`reasoning_format:"none"\` is display-only and does not stop generation.
 * - Hard override: generation prompt ALWAYS prefills \`<think>\\n\\n</think>\\n\\n\`
 *   (no enable_thinking conditional). Official Qwen hard-switch semantics.
 *
 * Source: unsloth/Qwen3.5-4B tokenizer_config.json chat_template at revision
 * ${REVISION} (pinned 2026-08-07; developer-role + tool-calling Unsloth patches
 * kept intact — app uses tools and images).
 * Re-sync this string if the model / Unsloth revision changes
 * (\`node scripts/_genQwenNoThinkTemplate.mjs\`).
 *
 * TODO: embedded GGUF template of the shipped MTP model
 * (unsloth/Qwen3.5-4B-MTP-GGUF) has never been byte-compared against this
 * string — needs a GGUF metadata dump (out of scope today).
 *
 * Used only for Thinking modes off/default on model ids starting with "qwen3.5".
 * Budget modes must keep the stock template so thinking can open.
 */

`;

const raw = await fetchText(URL);
const j = JSON.parse(raw);
let t = j.chat_template;
if (typeof t !== "string") {
  console.error("chat_template missing");
  process.exit(1);
}
if (!t.includes("enable_thinking is defined and enable_thinking is false")) {
  console.error("expected enable_thinking conditional missing");
  process.exit(1);
}
if (!t.includes(OLD)) {
  const idx = t.indexOf("{%- if add_generation_prompt %}");
  console.error("OLD fragment not exact match. Around generation prompt:");
  console.error(JSON.stringify(t.slice(idx, idx + 450)));
  process.exit(2);
}
t = t.replace(OLD, NEU);
if (t.includes("enable_thinking is defined and enable_thinking is false")) {
  console.error("conditional still present after replace");
  process.exit(1);
}
if (!t.includes("{{- '<think>\\n\\n</think>\\n\\n' }}")) {
  console.error("force-close empty think prefill missing after replace");
  process.exit(1);
}
if (t.includes("{{- '<think>\\n' }}")) {
  console.error("open-think prefill still present");
  process.exit(1);
}

const body = `export const QWEN35_NO_THINK_CHAT_TEMPLATE: string = ${JSON.stringify(t)};\n`;
fs.writeFileSync(OUT, HEADER + body, "utf8");
console.log("wrote", OUT, "len=", t.length);
const g = t.indexOf("{%- if add_generation_prompt %}");
console.log("--- generation prompt ---");
console.log(t.slice(g, g + 180));
console.log("--- unsloth footer ---");
console.log(t.slice(-80));
