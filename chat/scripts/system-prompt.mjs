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

let dir = null;
let server = null;
try {
  dir = await mkdtemp(join(tmpdir(), "kalsa-system-prompt-"));
  const outfile = join(dir, "app.mjs");
  await build({
    stdin: {
      contents: `
        export { buildPinnedContext, historyTokens, SYSTEM_PROMPT, SYSTEM_PROMPT_TOKENS, systemPrompt, wireTokens } from "../src/lib/attachments.ts";
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
  const { buildPinnedContext, historyTokens, SYSTEM_PROMPT, SYSTEM_PROMPT_TOKENS, systemPrompt, wireTokens, streamChatCompletion } = app;

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
    pinned: true,
  };

  // The wire carries ONE system message — several chat templates render only
  // the one at index 0 — and it is the fixed prompt with the pinned documents
  // appended to the same content, which keeps the prompt as the byte prefix the
  // engine's cache holds onto.
  const withDocs = buildPinnedContext(MESSAGES, [ATTACHMENT], null);
  equal(
    "one system message with documents attached",
    withDocs.wire.filter((m) => m.role === "system").length,
    1,
  );
  equal("the system message is first", withDocs.wire[0], withDocs.wire.find((m) => m.role === "system"));
  check(
    "it starts with the fixed prompt, byte for byte",
    (withDocs.wire[0]?.content ?? "").startsWith(SYSTEM_PROMPT.content),
    JSON.stringify((withDocs.wire[0]?.content ?? "").slice(0, 70)),
  );
  check(
    "the pinned documents ride in the same message",
    (withDocs.wire[0]?.content ?? "").includes("Attached documents") &&
      (withDocs.wire[0]?.content ?? "").includes("report.txt") &&
      (withDocs.wire[0]?.content ?? "").includes("HELLO"),
    JSON.stringify((withDocs.wire[0]?.content ?? "").slice(-90)),
  );
  check(
    "the prompt is followed by a blank line, then the block",
    (withDocs.wire[0]?.content ?? "").includes(`${SYSTEM_PROMPT.content}\n\nAttached documents`),
  );
  check(
    "the turn follows the one system message",
    withDocs.wire[1]?.role === "user" && withDocs.wire[1]?.content === "Look at my picture.",
    JSON.stringify(withDocs.wire[1] ?? null).slice(0, 120),
  );

  const withoutDocs = buildPinnedContext(MESSAGES, [], null);
  equal(
    "one system message without documents",
    withoutDocs.wire.filter((m) => m.role === "system").length,
    1,
  );
  equal("without documents the content is the prompt itself", withoutDocs.wire[0], SYSTEM_PROMPT);
  check(
    "without documents no block is appended",
    !(withoutDocs.wire[0]?.content ?? "").includes("Attached documents"),
  );

  // The fit counts it: what the wire costs for a conversation is the stored
  // history plus the fixed prompt, and the difference is exactly the prompt.
  equal(
    "the budget counts the prompt",
    wireTokens(MESSAGES) - historyTokens(MESSAGES),
    SYSTEM_PROMPT_TOKENS,
  );
  check(
    // The fixed prompt is small on purpose: every byte of it is re-prefilled
    // whenever it changes, so the bound catches a sentence that would quietly
    // grow it by a third.
    "the prompt costs more than nothing",
    SYSTEM_PROMPT_TOKENS > 0 && SYSTEM_PROMPT_TOKENS < 130,
    `${SYSTEM_PROMPT_TOKENS} tokens`,
  );
  check(
    "the prompt's own cost is the wire cost",
    SYSTEM_PROMPT_TOKENS === Math.max(1, Math.ceil(SYSTEM_PROMPT.content.length / 4)),
    `${SYSTEM_PROMPT_TOKENS} tokens for ${SYSTEM_PROMPT.content.length} chars`,
  );

  // The prompt is fixed PER MODEL: the vision sentence follows /props, and
  // the capability changes only with the model, which restarts the engine's
  // cache anyway. Blind keeps today's bytes; seeing names the images and
  // still refuses audio and video.
  equal("blind is the prompt as always", systemPrompt(false), SYSTEM_PROMPT);
  const seeing = systemPrompt(true);
  check(
    "seeing says the images arrive as images",
    seeing.content.includes("Images the user attaches reach you as images."),
    JSON.stringify(seeing.content.slice(0, 140)),
  );
  check(
    "seeing still refuses audio and video",
    seeing.content.includes("You cannot see audio or video.") &&
      !seeing.content.includes("cannot see images"),
    JSON.stringify(seeing.content.slice(0, 160)),
  );
  check(
    "seeing costs a few tokens more, and the wire says so",
    wireTokens([], true) > wireTokens([], false),
    `${wireTokens([], true)} vs ${wireTokens([], false)}`,
  );

  // One turn through the tool loop: round one asks for a call, round two
  // answers after the result, and both requests carry the one system message,
  // first, still whole.
  const bodies = [];
  server = createServer((request, response) => {
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
    const systems = body.messages.filter((m) => m.role === "system");
    equal(`round ${round}: exactly one system message`, systems.length, 1);
    equal(`round ${round}: it is the first message`, body.messages[0], systems[0]);
    check(
      `round ${round}: it still starts with the fixed prompt`,
      (body.messages[0]?.content ?? "").startsWith(SYSTEM_PROMPT.content),
      JSON.stringify((body.messages[0]?.content ?? "").slice(0, 70)),
    );
    check(
      `round ${round}: the documents still ride in it`,
      (body.messages[0]?.content ?? "").includes("Attached documents"),
    );
  }
  check(
    "round two carries the tool's answer",
    bodies[1].messages.some((m) => m.role === "tool" && m.content === "SEARCH RESULT"),
    JSON.stringify(bodies[1].messages.map((m) => m.role)),
  );

} finally {
  if (server) server.close();
  if (dir) await rm(dir, { recursive: true, force: true });
}


if (fail > 0) {
  console.log(`\n${fail} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
