// The fixed system prompt: first in every wire, exactly once, with the pinned
// documents still right behind it — driven through the real
// `buildPinnedContext` and the real tool loop against a real stream, not a
// copy of either.
//
// The loop's round two is the point: the conversation array grows by the
// assistant's call and the tool's answer, and the prompt must still be the
// first message and still be the only one.
//
// Run: node scripts/system-prompt.mjs   (from chat/)

import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "../node_modules/esbuild/lib/main.js";

let fail = 0;
function check(label, condition, detail) {
  const ok = condition ? "ok  " : "FAIL";
  if (!condition) fail++;
  console.log(`${ok} ${label}${condition || detail === undefined ? "" : `\n     ${detail}`}`);
}
function equal(label, actual, expected) {
  check(
    label,
    JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}\n     want ${JSON.stringify(expected)}`,
  );
}

const dir = await mkdtemp(join(tmpdir(), "kalsa-system-prompt-"));
const outfile = join(dir, "app.mjs");
await build({
  stdin: {
    contents: `
      export { buildPinnedContext, historyTokens, SYSTEM_PROMPT, SYSTEM_PROMPT_TOKENS, wireTokens } from "../src/lib/attachments.ts";
      export { streamChatCompletion } from "../src/lib/toolLoop.ts";
      export { TOOL_DEFINITIONS } from "../src/lib/tools/definitions.ts";
    `,
    resolveDir: fileURLToPath(new URL(".", import.meta.url)),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  outfile,
  logLevel: "silent",
  plugins: [
    {
      // attachments.ts imports the pdf.js worker as a vite `?url` asset; the
      // worker only matters when a PDF is extracted, which this never does.
      name: "vite-url-asset",
      setup(build) {
        build.onResolve({ filter: /\?url$/ }, (args) => ({ path: args.path, namespace: "url-asset" }));
        build.onLoad({ filter: /.*/, namespace: "url-asset" }, () => ({
          contents: 'export default "";',
          loader: "js",
        }));
      },
    },
  ],
});

// streamRound's idle timer is a browser one.
globalThis.window = { setTimeout, clearTimeout };

const app = await import(pathToFileURL(outfile).href);
const { buildPinnedContext, historyTokens, SYSTEM_PROMPT, SYSTEM_PROMPT_TOKENS, wireTokens, streamChatCompletion } = app;

const MESSAGES = [{ id: "u1", role: "user", content: "Look at my picture.", createdAt: 1 }];
const ATTACHMENT = {
  id: "a1",
  name: "report.txt",
  kind: "txt",
  chars: 5,
  tokens: 2,
  text: "HELLO",
  attachedAt: 1,
  active: true,
};

// The prompt is the wire's first message, exactly once, with and without
// documents, and the documents follow it.
const withDocs = buildPinnedContext(MESSAGES, [ATTACHMENT], null);
equal("first wire message is the system prompt", withDocs.wire[0], SYSTEM_PROMPT);
equal(
  "the prompt appears exactly once",
  withDocs.wire.filter((m) => m.content === SYSTEM_PROMPT.content).length,
  1,
);
check(
  "the pinned documents follow the prompt",
  withDocs.wire[1]?.role === "system" && (withDocs.wire[1]?.content ?? "").startsWith("Attached documents"),
  JSON.stringify(withDocs.wire[1] ?? null).slice(0, 120),
);
check(
  "the turn is still on the wire",
  withDocs.wire.some((m) => m.role === "user" && m.content === "Look at my picture."),
);
const withoutDocs = buildPinnedContext(MESSAGES, [], null);
equal("without documents the prompt is still first", withoutDocs.wire[0], SYSTEM_PROMPT);
equal(
  "without documents it is still once",
  withoutDocs.wire.filter((m) => m.content === SYSTEM_PROMPT.content).length,
  1,
);

// The fit counts it: what the wire costs for a conversation is the stored
// history plus the fixed prompt, and the difference is exactly the prompt.
equal(
  "the budget counts the prompt",
  wireTokens(MESSAGES) - historyTokens(MESSAGES),
  SYSTEM_PROMPT_TOKENS,
);
check(
  "the prompt costs more than nothing",
  SYSTEM_PROMPT_TOKENS > 0 && SYSTEM_PROMPT_TOKENS < 80,
  `${SYSTEM_PROMPT_TOKENS} tokens`,
);
check(
  "the prompt's own cost is the wire cost",
  SYSTEM_PROMPT_TOKENS === Math.max(1, Math.ceil(SYSTEM_PROMPT.content.length / 4)),
  `${SYSTEM_PROMPT_TOKENS} tokens for ${SYSTEM_PROMPT.content.length} chars`,
);

// One turn through the tool loop: round one asks for a call, round two
// answers after the result, and both requests carry the prompt once and
// first.
const bodies = [];
const server = createServer((request, response) => {
  let raw = "";
  request.on("data", (chunk) => (raw += chunk));
  request.on("end", () => {
    bodies.push(JSON.parse(raw));
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    if (bodies.length === 1) {
      const delta = {
        tool_calls: [
          {
            index: 0,
            id: "call-1",
            type: "function",
            function: { name: "web_search", arguments: '{"query":"x"}' },
          },
        ],
      };
      response.write(
        `data: ${JSON.stringify({ choices: [{ delta, finish_reason: "tool_calls" }] })}\n\n`,
      );
    } else {
      response.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Done." }, finish_reason: "stop" }] })}\n\n`,
      );
    }
    response.write("data: [DONE]\n\n");
    response.end();
  });
});
await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
const port = server.address().port;

await streamChatCompletion({
  endpoint: `http://127.0.0.1:${port}/v1`,
  token: "",
  model: "test-model",
  messages: withDocs.wire,
  sampling: {},
  signal: new AbortController().signal,
  onToken: () => {},
  onReasoning: () => {},
  tools: app.TOOL_DEFINITIONS,
  runTool: async () => ({ ok: true, text: "SEARCH RESULT" }),
});
server.close();

equal("the tool round asked twice", bodies.length, 2);
for (const [index, body] of bodies.entries()) {
  const round = index + 1;
  equal(`round ${round}: the prompt is first`, body.messages[0], SYSTEM_PROMPT);
  equal(
    `round ${round}: the prompt appears exactly once`,
    body.messages.filter((m) => m.content === SYSTEM_PROMPT.content).length,
    1,
  );
  check(
    `round ${round}: the documents still follow`,
    (body.messages[1]?.content ?? "").startsWith("Attached documents"),
    JSON.stringify(body.messages[1] ?? null).slice(0, 120),
  );
}
check(
  "round two carries the tool's answer",
  bodies[1].messages.some((m) => m.role === "tool" && m.content === "SEARCH RESULT"),
  JSON.stringify(bodies[1].messages.map((m) => m.role)),
);

await rm(dir, { recursive: true, force: true });

if (fail > 0) {
  console.log(`\n${fail} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
