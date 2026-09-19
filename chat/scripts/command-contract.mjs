/**
 * Keep the page's Tauri command vocabulary from drifting away from the binary.
 *
 * A missing handler is silent from the page's point of view: the feature asks
 * the binary for an answer that can never arrive. This is a text scan, not a
 * type checker. It sees every quoted `brain_...` command-shaped literal in
 * `chat/src/`, plus literal entries in `generate_handler![...]`; that covers
 * typed invokes and wrappers. Literals passed to event-listener APIs are
 * reported separately, since events are not command handlers. It cannot see
 * a command assembled at runtime from a variable, or a handler registered
 * indirectly.
 * Run: `node scripts/command-contract.mjs`
 */

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const REPO_DIR = fileURLToPath(new URL("../..", import.meta.url));
const FRONTEND_DIR = `${REPO_DIR}/chat/src`;
const MAIN = `${REPO_DIR}/src-tauri/src/main.rs`;
const COMMAND_LITERAL = /["'`](brain_[a-z_]+)["'`]/g;
const EVENT_LITERAL = /\b(?:listen|emit|on|once)\s*\(\s*["'`](brain_[a-z_]+)["'`]/g;

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
  for (const match of source.matchAll(COMMAND_LITERAL)) {
    frontendCommands.add(match[1]);
  }
  for (const match of source.matchAll(EVENT_LITERAL)) frontendEvents.add(match[1]);
}
const mainSource = await readFile(MAIN, "utf8");
const handlerMatch = mainSource.match(/tauri::generate_handler!\s*\[([\s\S]*?)\]/);
if (handlerMatch === null) {
  console.log("COMMAND CONTRACT FAILURE: could not find tauri::generate_handler! in src-tauri/src/main.rs");
  process.exit(1);
}

const registeredCommands = new Set();
for (const rawEntry of handlerMatch[1].split(",")) {
  const entry = rawEntry.replace(/\/\/.*$/gm, "").trim();
  if (!entry) continue;
  const match = entry.match(/^(?:[A-Za-z_]\w*::)*([A-Za-z_]\w*)$/);
  if (match !== null) registeredCommands.add(match[1]);
}

const missing = [...frontendCommands].filter(
  (command) => !registeredCommands.has(command) && !frontendEvents.has(command),
);
if (missing.length > 0) {
  console.log("COMMAND CONTRACT FAILURE: frontend source contains unregistered command literals:");
  for (const command of missing) console.log(`  - ${command}`);
  if (frontendEvents.size > 0) {
    console.log(`INFO: event literals are not command handlers: ${[...frontendEvents].join(", ")}`);
  }
  process.exit(1);
}

const commandLiterals = [...frontendCommands].filter((command) => !frontendEvents.has(command));
const unused = [...registeredCommands].filter((command) => !commandLiterals.includes(command));
const unusedSummary = unused.length > 0 ? `; registered-only: ${unused.join(", ")}` : "";
const eventSummary =
  frontendEvents.size > 0 ? `; event literals ignored: ${[...frontendEvents].join(", ")}` : "";
console.log(
  `ok: ${commandLiterals.length} frontend command literals are registered; ${unused.length} registered-only${unusedSummary}${eventSummary}`,
);
