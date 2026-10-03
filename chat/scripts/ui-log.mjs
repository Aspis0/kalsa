// The page's `ui:` line, driven through the real `lib/chat.ts` and `lib/uiLog.ts`
// against a fake door on a real socket.
//
// What the log promises is that a failure's SENTENCE never reaches it: the
// page has the door's own words in hand — a sentence, and in a real report a
// UUID beside it — and must hand over a code alone. The refusal body below
// carries both, so a regression that forwards the text is visible here. The
// fake bridge records every `brain_log_event` argument, exactly what Rust
// would validate.
//
// Run: node scripts/ui-log.mjs

import { rm } from "node:fs/promises";
import { createServer } from "node:http";
import { loadApp } from "./lib/app-bundle.mjs";

const SENTENCE = "Kalsa non ha potuto aprire questa conversazione. Riprova.";
const UUID = "0f1e2d3c-5a6b-4c7d-8e9f-001122334455";
const TOKEN = "not-a-real-credential";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/// The bridge the page talks to: it records what a command was invoked with,
/// and answers nothing (the app's `brain_log_event` is a fire-and-forget).
function bridge() {
  const calls = [];
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke(command, args) {
          calls.push({ command, args });
          return Promise.resolve(null);
        },
      },
    },
  };
  return calls;
}

/// A door answering `plan` per request: the status and the body the route
/// answers with, so a coded refusal and a plain success are one server.
const servers = [];

function door(plan) {
  const requests = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      requests.push({ url: request.url, body });
      const { status, payload } = plan();
      response.writeHead(status, { "Content-Type": payload === null ? "text/plain" : "application/json" });
      response.end(payload === null ? "" : payload);
    });
  });
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port, requests });
    });
  });
}

const bridgeCalls = bridge();
let dir = null;
try {
  const loaded = await loadApp();
  dir = loaded.dir;
  const app = loaded.app;

  // The door's own coded refusal, with the sentence and the chat's UUID in the
  // body: the code is the only thing the page may forward.
  const coded = await door(() => ({
    status: 502,
    payload: JSON.stringify({ code: "door.restore_failed", text: `${SENTENCE} (${UUID})` }),
  }));
  const refusal = await app.activateChat(`http://127.0.0.1:${coded.port}`, TOKEN, UUID);
  check("a coded refusal is reported as refused", refusal.kind === "refused", refusal.message);
  check(
    "the door's sentence is what the page shows",
    refusal.message.includes(SENTENCE),
    refusal.message,
  );
  // The invoke is fire-and-forget: let its promise settle.
  await new Promise((resolve) => setTimeout(resolve, 20));
  const logged = bridgeCalls.filter((call) => call.command === "brain_log_event");
  check(
    "the page logged exactly one code for the refusal",
    logged.length === 1,
    JSON.stringify(logged),
  );
  check(
    "the code names the route and the door's own code",
    logged[0]?.args?.code === "chat.activate.door.restore_failed",
    JSON.stringify(logged[0] ?? null),
  );
  check(
    "the sentence and the chat id never reached the log call",
    !logged.some((call) => JSON.stringify(call.args ?? {}).includes(SENTENCE)) &&
      !logged.some((call) => JSON.stringify(call.args ?? {}).includes(UUID)),
    JSON.stringify(logged),
  );

  // A door that never answered: the page's own unknown-slot sentence, and the
  // code that says the network was the failure.
  coded.server.close();
  bridgeCalls.length = 0;
  const unreachable = await app.activateChat(`http://127.0.0.1:${coded.port}`, TOKEN, UUID);
  check("a dead door is reported as refused", unreachable.kind === "refused" && unreachable.silent === true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const dead = bridgeCalls.filter((call) => call.command === "brain_log_event");
  check(
    "a dead door logs the unreachable code",
    dead[0]?.args?.code === "chat.activate.unreachable",
    JSON.stringify(dead),
  );

  // A door with the tier unwired: a status, not an error, and its own code.
  bridgeCalls.length = 0;
  const noTier = await door(() => ({
    status: 501,
    payload: "The engine could not be reached for this chat.",
  }));
  const plain = await app.activateChat(`http://127.0.0.1:${noTier.port}`, TOKEN, UUID);
  check("a 501 is a no-tier answer", plain.kind === "no-tier", plain.kind);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const tierless = bridgeCalls.filter((call) => call.command === "brain_log_event");
  check(
    "a tierless door logs its own code",
    tierless[0]?.args?.code === "chat.activate.no_tier",
    JSON.stringify(tierless),
  );
  noTier.server.close();

  // Success: an answer that is not a failure logs nothing at all.
  bridgeCalls.length = 0;
  const open = await door(() => ({ status: 204, payload: null }));
  const ok = await app.activateChat(`http://127.0.0.1:${open.port}`, TOKEN, UUID);
  check("a 204 opens", ok.kind === "ok", ok.kind);
  await new Promise((resolve) => setTimeout(resolve, 20));
  check(
    "a success writes no ui line",
    bridgeCalls.length === 0,
    JSON.stringify(bridgeCalls),
  );
} finally {
  for (const server of servers) server.close();
  await rm(dir, { recursive: true, force: true });
}


if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
