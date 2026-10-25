// The product is Kalsa and the first page is Home — and two names in this repo
// must NOT follow the product name, because they are where the user's data
// lives:
//
//   * `identifier` in `src-tauri/tauri.conf.json` decides `app_data_dir()`, so
//     renaming it moves the settings and the pairing record out from under the
//     owner;
//   * `kalsa-runtime`'s runtime root is the literal `kalsa-brain` — twenty
//     gigabytes of models live under it.
//
// This pins both, and pins the copy the reader actually sees, so a future
// rename cannot quietly do either. Run: `node scripts/product-name.mjs`.

import { readFile } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const conf = JSON.parse(await readFile(join(REPO, "src-tauri/tauri.conf.json"), "utf8"));
check("the product is named Kalsa", conf.productName === "Kalsa", String(conf.productName));
check("the window says Kalsa", conf.app?.windows?.[0]?.title === "Kalsa", String(conf.app?.windows?.[0]?.title));
// The identifier is not `ai.kalsa.` + the product name: it is pinned, and it is
// what `app_data_dir()` derives from.
check("the identifier did not follow the rename", conf.identifier === "ai.kalsa.brain", String(conf.identifier));

const store = readFileSync(join(REPO, "crates/kalsa-runtime/src/store.rs"), "utf8");
const roots = [...store.matchAll(/join\("kalsa-brain"\)|Support\/kalsa-brain\//g)].length;
check("the runtime root still points at the models on disk", roots === 3, `${roots} runtime-root literals`);
check(
  "and its own test still pins that literal",
  store.includes('contains("kalsa-brain")'),
  store.includes('contains("kalsa-brain")') ? "held by the crate's own test" : "the pinning test is gone",
);

// Nothing a reader can see still calls the app Kalsa Brain.
const sources = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(ts|tsx|rs)$/.test(entry.name)) sources.push(path);
  }
}
walk(join(REPO, "chat/src"));
walk(join(REPO, "src-tauri/src"));
const named = sources.filter((path) => readFileSync(path, "utf8").includes("Kalsa Brain"));
check("no source a reader can see still says Kalsa Brain", named.length === 0, named.join(", "));

console.log(failures === 0 ? "\nthe product's two names, and the two that must not move, are pinned" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
