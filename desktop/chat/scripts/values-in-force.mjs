// The "In force" line's units, in every table: the idle part already carries
// its localized unit (the panel builds `300 seconds`), so the sentence must
// not append another one. English did, and the AI page read "300 seconds
// seconds.".
//
// Pure. Run: node scripts/values-in-force.mjs   (from chat/)

import { mkdtemp, rm } from "node:fs/promises";
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

const dir = await mkdtemp(join(tmpdir(), "kalsa-values-"));
try {
  for (const tag of ["en", "it", "fr", "es", "zh"]) {
    const outfile = join(dir, `${tag}.mjs`);
    await build({
      entryPoints: [fileURLToPath(new URL(`../src/i18n/${tag}/advanced.ts`, import.meta.url))],
      bundle: true,
      format: "esm",
      platform: "node",
      outfile,
      logLevel: "silent",
    });
    const table = Object.values(await import(pathToFileURL(outfile).href)).find(
      (value) => value && typeof value === "object" && typeof value.valuesInForce === "function",
    );
    const idle = `300 ${table.secondsWord}`;
    const line = table.valuesInForce({
      lead: table.inForce,
      context: "4,096",
      batch: "512",
      ubatch: "256",
      kv: "q8_0",
      flash: "on",
      gpu: "all",
      threads: "10",
      idle,
      tune: null,
    });
    const unit = new RegExp(table.secondsWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    check(`${tag}: the unit appears once`, (line.match(unit) ?? []).length === 1, line);
    check(`${tag}: the idle value is untouched`, line.includes(idle), line);
    check(`${tag}: no doubled unit`, !line.includes(`${table.secondsWord} ${table.secondsWord}`), line);
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

if (fail > 0) {
  console.log(`\n${fail} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
