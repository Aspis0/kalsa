/**
 * Keep the page's Tauri command vocabulary from drifting away from the
 * binary, in both directions.
 *
 * A missing handler is silent from the page's point of view: the feature asks
 * the binary for an answer that can never arrive. A handler with no caller is
 * the opposite drift — dead weight that an earlier version of this guard only
 * printed, which is how three registered commands survived with no caller.
 * This is a text scan, not a type checker, and it decides by call site, not
 * by name: a literal is a command use when it is passed to `invoke(...)`
 * (typed or not), and an event use when passed to `listen`/`emit`/`once` —
 * events are not command handlers. Deciding by name once miscounted
 * `brain_files_search`, a command and an event that share a name.
 *
 * What a scan cannot see: a name inside a comment or an ordinary string
 * counts as a call site, so deleting the real call while leaving
 * `const doc = 'invoke("brain_state")'` behind defeats the uncalled check.
 * `through` — the one wrapper that forwards a command name on to invoke, in
 * lib/tools/registry.ts — is recognised by name alone: an unrelated local
 * function of that name would satisfy the contract, and a second wrapper
 * under a different name would not be recognised, so its command fails
 * uncalled — loud, the acceptable direction to fail. A command assembled at
 * runtime from a variable, or a handler registered indirectly, is invisible.
 *
 * The scan covers `chat/src` only, deliberately: `chat/scripts` holds
 * harnesses that impersonate the Tauri bridge (live-tools.mjs answers
 * invoke in place of Rust), and counting a mock would let it keep a dead
 * command alive. Do not widen it.
 * Run: `node scripts/command-contract.mjs`
 */

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const REPO_DIR = fileURLToPath(new URL("../..", import.meta.url));
const FRONTEND_DIR = `${REPO_DIR}/chat/src`;
const MAIN = `${REPO_DIR}/src-tauri/src/main.rs`;

// One alphabet for both halves of the guard, so a name one side can see and
// the other cannot does not exist: the frontend patterns and the handler
// entry matcher are all built from it. The class is the whole legal name, so
// a quoted name matches only in full — the character that would continue a
// longer name is itself in the class, and a prefix cannot stop early.
const NAME = "brain_[a-z0-9_]+";
// invoke may carry a type argument before its parenthesis; `through` is the
// forwarding wrapper named in the header.
const COMMAND_CALL = new RegExp(
  "\\b(?:invoke|through)\\s*(?:<[^[()\\]]*>)?\\s*\\(\\s*[\"'`](" + NAME + ")[\"'`]",
  "g",
);
const EVENT_CALL = new RegExp(
  "\\b(?:listen|emit|on|once)\\s*\\(\\s*[\"'`](" + NAME + ")[\"'`]",
  "g",
);
// A handler entry is a module path ending in a command name (web::brain_web_search).
const REGISTERED_ENTRY = new RegExp(`^(?:[A-Za-z_][A-Za-z0-9_]*::)*(${NAME})$`);

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await collectSourceFiles(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const frontendCommands = new Set();
const frontendEvents = new Set();
for (const path of await collectSourceFiles(FRONTEND_DIR)) {
  const source = await readFile(path, "utf8");
  for (const match of source.matchAll(COMMAND_CALL)) frontendCommands.add(match[1]);
  for (const match of source.matchAll(EVENT_CALL)) frontendEvents.add(match[1]);
}
const mainSource = await readFile(MAIN, "utf8");
const macroAt = mainSource.indexOf("tauri::generate_handler!");
// Comments are stripped from the macro onward BEFORE the list's end is
// searched, because the search runs to the first `]`: a `]` inside a comment
// would end the list early and silently drop every command after it, and the
// under-report would fail healthy commands as "missing".
const handlerList =
  macroAt === -1
    ? null
    : mainSource
        .slice(macroAt)
        .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "")
        .match(/tauri::generate_handler!\s*\[([^\]]*)\]/);
if (handlerList === null) {
  console.log("COMMAND CONTRACT FAILURE: could not find tauri::generate_handler! in src-tauri/src/main.rs");
  process.exit(1);
}

const registeredCommands = new Set();
for (const rawEntry of handlerList[1].split(",")) {
  // Empty fragments are the list's own commas (a trailing comma included)
  // and stay ignorable; anything non-empty is an entry, and an entry this
  // guard cannot name is a command it cannot check — dropping it silently
  // is the hole a dead command lives in.
  const entry = rawEntry.trim();
  if (!entry) continue;
  const match = entry.match(REGISTERED_ENTRY);
  if (match === null) {
    console.log("COMMAND CONTRACT FAILURE: generate_handler! holds an entry this guard cannot name:");
    console.log(`  - ${entry}`);
    console.log("It only understands commands named brain_* behind an optional module path (web::brain_web_search).");
    console.log("A command it cannot name is a command it cannot check: bring the name into the convention, or teach this guard the new shape.");
    process.exit(1);
  }
  registeredCommands.add(match[1]);
}

const missing = [...frontendCommands].filter((command) => !registeredCommands.has(command));
if (missing.length > 0) {
  console.log("COMMAND CONTRACT FAILURE: the frontend invokes commands the binary does not register:");
  for (const command of missing) console.log(`  - ${command}`);
  process.exit(1);
}

const uncalled = [...registeredCommands].filter((command) => !frontendCommands.has(command));
if (uncalled.length > 0) {
  console.log("COMMAND CONTRACT FAILURE: the binary registers commands no frontend code invokes:");
  for (const command of uncalled) console.log(`  - ${command}`);
  console.log("Delete the command from src-tauri/src/main.rs, or give it an invoke call site in chat/src.");
  process.exit(1);
}

const events = [...frontendEvents].sort();
const eventSummary =
  events.length > 0 ? `; event literals (not command handlers): ${events.join(", ")}` : "";
console.log(
  `ok: ${frontendCommands.size} frontend command call sites are all registered; ` +
    `${registeredCommands.size} registered commands all have an invoke site${eventSummary}`,
);
