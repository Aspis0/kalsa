// The fit note says nothing about files when there are none: an unknown
// context size is a warning about attached files, so with zero attached it is
// silent. Too much is still too much, and a known size stays quiet until the
// free share of the window falls below a sixth — then the one sentence.
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
equal("files that fit with room to spare: quiet", fitView(8192, 1, 1200, 300, RESERVE), "quiet");
equal("no files, a known size: quiet", fitView(8192, 0, 0, 300, RESERVE), "quiet");
// 1024 − 400 − 50 − 512 = 62 free, under the 154 the sixth asks for.
equal("free under a sixth of the window: the one sentence", fitView(1024, 1, 400, 50, RESERVE), "almost");
// 1024 − 350 − 0 − 512 = 162 free, past the line.
equal("free past the line: quiet again", fitView(1024, 1, 350, 0, RESERVE), "quiet");
equal("almost full on history alone, no files", fitView(1024, 0, 0, 380, RESERVE), "almost");

await rm(dir, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
