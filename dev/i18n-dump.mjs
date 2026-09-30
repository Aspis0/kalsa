import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "../chat/node_modules/esbuild/lib/main.js";

// Every path is relative to this file, never to a home directory: the
// renderer must run from any checkout, and the bundle never lands in one.
const checkout = fileURLToPath(new URL("..", import.meta.url));
const chat = join(checkout, "chat");
const dir = await mkdtemp(join(tmpdir(), "i18n3-"));
const out = join(dir, "tables.mjs");
await build({
  entryPoints: [join(chat, "src/i18n/index.ts")],
  bundle: true, format: "esm", platform: "node", target: "node20",
  outfile: out, nodePaths: [join(chat, "node_modules")],
  loader: { ".css": "empty" }, logLevel: "silent",
});
const mod = await import(`${pathToFileURL(out).href}?c=${Date.now()}`);


/** Example values for the function keys: Marco for {name}, each language's
    own list join for {rest}, readLast at N=1 and N=5. */
const RENDER_CASES = (key, areaTable) => {
  if (key === "answering" || key === "queueNext" || key === "youAre") return (fn) => fn("Marco");
  if (key === "queueThen") return (fn) => fn("Marco", areaTable.listJoin(["Luca", "Sofia"]));
  if (key === "readLast") return (fn) => `${fn(1)} / ${fn(5)}`;
  if (key === "listJoin") return (fn) => fn(["Luca", "Sofia"]);
  return (fn) => fn("?");
};

function collect(table) {
  const rows = [];
  const seen = new Set();
  const walk = (node, area, areaTable) => {
    for (const [key, value] of Object.entries(node)) {
      const path = area ? `${area}.${key}` : key;
      // A flattened key naming two rows would make the rendered card
      // ambiguous, so the walk refuses to continue past the first repeat.
      if (seen.has(path)) throw new Error(`duplicate flattened key: ${path}`);
      seen.add(path);
      if (typeof value === "function") {
        // A function key renders with its own area's table — queueThen
        // borrows its area's listJoin to build {rest}.
        rows.push([path, RENDER_CASES(key, areaTable)((...args) => value(...args))]);
      } else if (typeof value === "string") {
        rows.push([path, value]);
      } else if (value !== null && typeof value === "object") {
        walk(value, path, value);
      }
    }
  };
  walk(table, "", table);
  return rows;
}

const english = collect(mod.TABLES.en);
const others = {};
for (const lang of ["it", "es", "fr", "zh"]) others[lang] = collect(mod.TABLES[lang]);
console.log(JSON.stringify({ english, others }));
