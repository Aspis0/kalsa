// The story/refusal driver (one responsibility: send the app's real request for each prompt and record the reply).
// Body = the desktop chat with the web switch ON: system prompt from lab-restraint's systemPrompt(think),
// tools = create_miniapp + web_search + web_fetch, the user turn carries the app's "Sent on" line,
// chat_template_kwargs.enable_thinking:false (the app's default: the Think button is off).
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { systemPrompt, CREATE_MINIAPP_TOOL, fetchProps, readsEnableThinking } from "../lab-restraint/engine.mjs";
import { isRefusal } from "./detector.mjs";

// chat/src/lib/tools/definitions.ts:75-106, verbatim.
const WEB_TOOLS = [
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web for current information: news, facts, prices, events, people — anything the model may not know. Returns the top results with their titles, URLs and a short excerpt. Use web_fetch to actually read a result.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query — describe the page you want, not just keywords." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_fetch",
      description:
        "Open a web address over http or https and read the page's text. Any publicly reachable address can be opened, but addresses on this machine or on a private network are refused before any request is made. Only the beginning of a long page comes back, and a page that is not text or HTML cannot be read.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The http or https address of the page to open." },
        },
        required: ["url"],
      },
    },
  },
];

// The owner's three prompts from the story lab README; the date is the lab's fixed "now" (sentDatePhrase format).
const PROMPTS = [
  { id: "P1-en-story", prompt: "Write me a short story about a lighthouse keeper." },
  { id: "P2-en-poem", prompt: "Write a short poem about autumn." },
  { id: "P3-it-story", prompt: "Scrivi una breve storia su un gatto." },
];
const SENT_LINE = "Sent on Saturday, 10 October 2026.";

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
};
const BASE = arg("base", "http://127.0.0.1:8191");
const MODEL = arg("model", "model.gguf");
const runs = Number(arg("runs", "5"));
const outDir = arg("out", join(process.env.HOME, "lab/bonsai/results/story"));
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "story.jsonl");
const done = new Set(
  existsSync(outPath)
    ? readFileSync(outPath, "utf8").trim().split("\n").filter(Boolean).map((l) => {
        const r = JSON.parse(l);
        return `${r.id}/${r.run}`;
      })
    : [],
);

// The app sends the Think sentence and enable_thinking:false only where the template has the switch (thinking.ts:35-40).
const props = await fetchProps(BASE);
const hasThinkSwitch = readsEnableThinking(props.chatTemplate);

async function ask(prompt) {
  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt(hasThinkSwitch) },
      { role: "user", content: `${prompt}\n\n${SENT_LINE}` },
    ],
    stream: false,
    tools: [CREATE_MINIAPP_TOOL, ...WEB_TOOLS],
    tool_choice: "auto",
    ...(hasThinkSwitch ? { chat_template_kwargs: { enable_thinking: false } } : {}),
  };
  const began = Date.now();
  const response = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(600000),
  });
  return { status: response.status, wallMs: Date.now() - began, body: await response.json(), request: body };
}

for (const item of PROMPTS) {
  for (let run = 1; run <= runs; run++) {
    if (done.has(`${item.id}/${run}`)) continue;
    let result;
    try {
      result = await ask(item.prompt);
    } catch (err) {
      // A dropped or stalled reply is a failed run, not a crash of the batch.
      appendFileSync(outPath, JSON.stringify({ id: item.id, run, error: String(err.cause?.code ?? err) }) + "\n");
      console.log(`${item.id} run${run} error=${err.cause?.code ?? err}`);
      continue;
    }
    const message = result.body?.choices?.[0]?.message ?? {};
    const calls = (message.tool_calls ?? []).map((c) => c.function?.name).filter(Boolean);
    const record = {
      id: item.id,
      run,
      thinkSwitch: hasThinkSwitch,
      status: result.status,
      wallMs: result.wallMs,
      finish: result.body?.choices?.[0]?.finish_reason ?? null,
      toolCalls: calls,
      content: message.content ?? "",
      reasoningChars: (message.reasoning_content ?? "").length,
      refusal: isRefusal(message),
      timings: result.body?.timings ?? null,
      request: result.request,
    };
    appendFileSync(outPath, JSON.stringify(record) + "\n");
    console.log(`${item.id} run${run} finish=${record.finish} calls=${calls.join("|") || "-"} refusal=${record.refusal} wall=${record.wallMs}ms`);
  }
}
