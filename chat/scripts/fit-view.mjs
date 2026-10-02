// The fit bar says nothing about files when there are none: an unknown
// context size is a warning about attached files, so with zero attached it is
// silent. Too much is still too much, and a known size still draws the bar.
//
// Pure. Run: node scripts/fit-view.mjs   (from chat/)

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "../node_modules/esbuild/lib/main.js";

const dir = await mkdtemp(join(tmpdir(), "kalsa-fit-"));
const outfile = join(dir, "fit.mjs");
await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/fit.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile,
  logLevel: "silent",
});
const { fitView } = await import(pathToFileURL(outfile).href);

let fail = 0;
function equal(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n     got ${actual}, want ${expected}`}`);
}
const RESERVE = 512;
// fitView(contextTokens, fileCount, docTokens, historyTokens, reserve)
equal("no files and an unknown size: nothing is shown", fitView(null, 0, 0, 300, RESERVE), "hidden");
equal("no files, an unknown size and a huge history: still nothing", fitView(null, 0, 0, 10_000_000, RESERVE), "hidden");
equal("a file and an unknown size: the warning", fitView(null, 1, 1200, 300, RESERVE), "unknown");
equal("a file that weighs nothing still gets the warning", fitView(null, 1, 0, 300, RESERVE), "unknown");
equal("no files but too much history: still too much", fitView(4096, 0, 0, 4000, RESERVE), "over");
equal("files that do not fit: too much", fitView(4096, 2, 3800, 300, RESERVE), "over");
equal("files that fit: the bar", fitView(8192, 1, 1200, 300, RESERVE), "bar");
equal("no files, a known size: the bar", fitView(8192, 0, 0, 300, RESERVE), "bar");

await rm(dir, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
