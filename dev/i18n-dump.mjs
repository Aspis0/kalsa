import { build } from "/Users/marco/Projects/kalsa-brain/chat/node_modules/esbuild/lib/main.js";
import { pathToFileURL } from "node:url";
import { mkdtemp } from "node:fs/promises";
const dir = await mkdtemp("/tmp/i18n3-");
const out = `${dir}/tables.mjs`;
await build({
  entryPoints: ["/Users/marco/Projects/kalsa-brain/chat/src/i18n/index.ts"],
  bundle: true, format: "esm", platform: "node", target: "node20",
  outfile: out, nodePaths: ["/Users/marco/Projects/kalsa-brain/chat/node_modules"],
  loader: { ".css": "empty" }, logLevel: "silent",
});
const mod = await import(pathToFileURL(out).href + `?c=${Date.now()}`);


/** Example values for the function keys: Marco for {name}, each language's
    own list join for {rest}, readLast at N=1 and N=5. */
const RENDER_CASES = (room, key) => {
  if (key === "answering" || key === "queueNext" || key === "youAre") return (fn) => fn("Marco");
  if (key === "queueThen") return (fn) => fn("Marco", room.listJoin(["Luca", "Sofia"]));
  if (key === "readLast") return (fn) => `${fn(1)} / ${fn(5)}`;
  if (key === "listJoin") return (fn) => fn(["Luca", "Sofia"]);
  return (fn) => fn("?");
};

function collect(table) {
  const rows = [];
  const walk = (node, area) => {
    for (const [key, value] of Object.entries(node)) {
      const path = area ? `${area}.${key}` : key;
      if (typeof value === "function") {
        // listJoin lives inside the room table itself; other function keys
        // read its sentences from there too.
        const room = area.startsWith("room") ? table.room : undefined;
        rows.push([path, RENDER_CASES(room, key)((...args) => value(...args))]);
      } else if (typeof value === "string") {
        rows.push([path, value]);
      } else if (value !== null && typeof value === "object") {
        walk(value, path);
      }
    }
  };
  walk(table, "");
  return rows;
}

const english = collect(mod.TABLES.en);
const others = {};
for (const lang of ["it", "es", "fr", "zh"]) others[lang] = collect(mod.TABLES[lang]);
console.log(JSON.stringify({ english, others }));
