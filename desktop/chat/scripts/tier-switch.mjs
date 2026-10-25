// The app's client for the door's two chat routes, against a fake door: what
// it sends, and what it does with each answer the door can give.
//
// `activate` decides which file this device's slot is written into and
// `erase` decides whether a chat's file survives, so two things are worth
// proving and both are mechanical: the request carries the conversation's id
// and this window's credential and no name at all, and the door's sentence
// reaches the caller verbatim — including the one distinction the door makes
// and the app must never flatten, "unknown" against "empty"
// (`crates/kalsa-door/src/paging/io.rs`).
//
// The real `chat.ts` is compiled by `lib/app-bundle.mjs`, never a copy of it.
// The UI's own wiring — which chat stays active when the door refuses — is not
// covered here and has no harness in this project.
//
// Run: node scripts/tier-switch.mjs

import { createServer } from "node:http";
import { rm } from "node:fs/promises";
import { loadApp } from "./lib/app-bundle.mjs";

const TOKEN = "not-a-real-credential";
const CHAT = "0f1e2d3c-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

// The door's sentences are copied here on purpose: reading them back out of the
// app would pass while the app rewrote them, which is the one thing this route
// must not do. Each is the literal string of its case in
// `crates/kalsa-door/src/paging.rs` and `paging/io.rs`.
const NO_MODEL = "This door has no model identity pinned, so it cannot name a saved chat.";
const NO_DIR = "This door has no save directory, so it cannot keep a chat on disk.";
const SLOT_EMPTY = "The chat could not be opened; the slot is now empty.";
const SLOT_UNKNOWN = "The engine could not be reached, so the state of this device's slot is unknown.";
const REPAIRED = "The chat could not be opened; the chat that was open is back in the slot.";
const ENGINE_SILENT = "The engine could not be reached for this chat.";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/// A door that answers what the case tells it to, and remembers what it was
/// asked. One request at a time: the client's own order is what is checked.
let plan = { status: 204, body: "" };
const seen = [];
const door = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    seen.push({
      method: request.method,
      url: request.url,
      auth: request.headers.authorization ?? "",
      body,
    });
    response.writeHead(plan.status, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(plan.body);
  });
});
await new Promise((resolve) => door.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${door.address().port}`;

const { app, dir } = await loadApp();
try {
  // The opening that works, and the exact shape of what goes out. The endpoint
  // ends in /v1, which is what the door's own address looks like: the routes
  // live on the server root, so a client that kept /v1 would ask the wrong
  // place.
  plan = { status: 204, body: "" };
  seen.length = 0;
  const opened = await app.activateChat(`${base}/v1`, TOKEN, CHAT);
  check("a 204 is the slot taking the chat", opened.kind === "ok", JSON.stringify(opened));
  const request = seen[0] ?? {};
  check(
    "the request is a POST to the door's own route, with no /v1 in front of it",
    request.method === "POST" && request.url === "/kalsa/chat/activate",
    `${request.method} ${request.url}`,
  );
  check(
    "the credential is this device's, in the bearer header",
    request.auth === `Bearer ${TOKEN}`,
    request.auth,
  );
  const carried = (() => {
    try {
      const parsed = JSON.parse(request.body);
      return Array.isArray(parsed) ? null : parsed;
    } catch {
      return null;
    }
  })();
  check(
    "the body is the conversation's id and nothing else",
    carried !== null && JSON.stringify(Object.keys(carried)) === '["id"]' && carried.id === CHAT,
    request.body,
  );
  check(
    "no file name, no path, no directory leaves this side",
    !/filename|\.bin|\/|\\/.test(request.body),
    request.body,
  );

  // A door built without the tier: 501 is an answer, not a fault, and the
  // sentence says which half is missing. Both halves, because a client that
  // hardcoded one would look identical here.
  plan = { status: 501, body: NO_MODEL };
  const noTier = await app.activateChat(base, TOKEN, CHAT);
  check("a 501 is the door saying it has no tier", noTier.kind === "no-tier", JSON.stringify(noTier));
  check("...and it is not shown as a refusal", noTier.kind !== "refused", noTier.kind);
  check("...with the door's sentence as it wrote it", noTier.message === NO_MODEL, noTier.message);
  plan = { status: 501, body: NO_DIR };
  const noDir = await app.activateChat(base, TOKEN, CHAT);
  check(
    "the other half of the 501 arrives too",
    noDir.kind === "no-tier" && noDir.message === NO_DIR,
    JSON.stringify(noDir),
  );

  // The refusals. `SLOT_EMPTY` is the door's word for a slot it did empty, and
  // every other sentence must survive unchanged as well — in particular the one
  // that says the door only kept what it had.
  plan = { status: 502, body: SLOT_EMPTY };
  const refused = await app.activateChat(base, TOKEN, CHAT);
  check(
    "a refusal is a refusal, with the door's sentence",
    refused.kind === "refused" && refused.message === SLOT_EMPTY,
    JSON.stringify(refused),
  );
  plan = { status: 502, body: REPAIRED };
  const repaired = await app.activateChat(base, TOKEN, CHAT);
  check(
    "a repair is carried through as the door's own words",
    repaired.kind === "refused" && repaired.message === REPAIRED,
    JSON.stringify(repaired),
  );
  plan = { status: 502, body: SLOT_UNKNOWN };
  const unknown = await app.activateChat(base, TOKEN, CHAT);
  check(
    "an engine the door never reached arrives as unknown",
    unknown.kind === "refused" && unknown.message === SLOT_UNKNOWN,
    JSON.stringify(unknown),
  );
  check(
    "...and is never rewritten as empty",
    !unknown.message.toLowerCase().includes("empty"),
    unknown.message,
  );

  // erase: the same route shape and the same id body, so a chat's file is
  // removed by the chat the client names and never by a name it chose.
  plan = { status: 204, body: "" };
  seen.length = 0;
  const erased = await app.eraseChat(base, TOKEN, CHAT);
  check("erase answers 204", erased.kind === "ok", JSON.stringify(erased));
  check(
    "erase posts to its own route with the same id body",
    seen[0]?.method === "POST" &&
      seen[0]?.url === "/kalsa/chat/erase" &&
      seen[0]?.body === JSON.stringify({ id: CHAT }) &&
      seen[0]?.auth === `Bearer ${TOKEN}`,
    `${seen[0]?.url} ${seen[0]?.body}`,
  );
  plan = { status: 502, body: ENGINE_SILENT };
  const notErased = await app.eraseChat(base, TOKEN, CHAT);
  check(
    "an erase the door refused keeps the door's sentence",
    notErased.kind === "refused" && notErased.message === ENGINE_SILENT,
    JSON.stringify(notErased),
  );

  // The door that never answered, which is the case no sentence of the door's
  // exists for. The app's own must say unknown — the door's word — and never
  // empty: on this path nothing at all is known about the slot.
  await new Promise((resolve) => door.close(resolve));
  const silent = await app.activateChat(base, TOKEN, CHAT);
  check(
    "a door that never answered is not called empty",
    silent.kind === "refused" && !silent.message.toLowerCase().includes("empty"),
    JSON.stringify(silent),
  );
  check(
    "...and says unknown in the app's own sentence, since the door gave none",
    silent.message === app.DOOR_SILENT && silent.message.includes("unknown"),
    silent.message,
  );
} finally {
  await rm(dir, { recursive: true, force: true });
  door.close();
}

console.log(failures === 0 ? "tier-switch: all checks passed" : `tier-switch: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
