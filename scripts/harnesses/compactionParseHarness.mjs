/**
 * Harness for parseCompactionEnabled (V2-3 default ON when key absent;
 * stored "0" is always explicit OFF).
 * Compile-from-disk. Exit 1 on fail.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const outDir = path.join(projectRoot, "scripts/.build/compactionParseHarness");

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/engine/ttftFlags.ts",
      "--outDir",
      outDir,
      "--module",
      "nodenext",
      "--target",
      "es2020",
      "--moduleResolution",
      "nodenext",
      "--skipLibCheck",
      "--ignoreConfig",
    ],
    { cwd: projectRoot, encoding: "utf8", shell: true },
  );
  if (r.status !== 0) {
    console.error("tsc failed:\n", r.stdout, r.stderr);
    process.exit(1);
  }
}

function resolveBuilt() {
  const candidates = [
    path.join(outDir, "ttftFlags.js"),
    path.join(outDir, "engine/ttftFlags.js"),
    path.join(outDir, "src/engine/ttftFlags.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error("Could not find compiled ttftFlags.js. Tried:\n", candidates.join("\n"));
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log("Compiling ttftFlags.ts …");
  compile();
  const { COMPACTION_ENABLED_DEFAULT, parseCompactionEnabled } = await import(
    pathToFileURL(resolveBuilt()).href
  );

  assert(COMPACTION_ENABLED_DEFAULT === true, "default must be ON");

  // Absent / unrecognized → default ON. Stored "0" is always explicit OFF
  // (Settings is the only writer; there was never a leftover default "0").
  assert(parseCompactionEnabled(null, false) === true, "missing key → ON");
  assert(parseCompactionEnabled(undefined, false) === true, "undefined → ON");
  assert(parseCompactionEnabled("", false) === true, "empty → ON");
  assert(parseCompactionEnabled("0", false) === false, "stored 0 → OFF");
  assert(parseCompactionEnabled("false", false) === false, "stored false → OFF");
  assert(parseCompactionEnabled("1", false) === true, "stored 1 without choice → ON");
  assert(parseCompactionEnabled("true", false) === true, "stored true without choice → ON");
  assert(parseCompactionEnabled("nope", false) === true, "garbage without choice → ON");

  // Explicit choice: honor the stored value.
  assert(parseCompactionEnabled("0", true) === false, "explicit 0 → OFF");
  assert(parseCompactionEnabled("false", true) === false, "explicit false → OFF");
  assert(parseCompactionEnabled("1", true) === true, "explicit 1 → ON");
  assert(parseCompactionEnabled("true", true) === true, "explicit true → ON");
  assert(parseCompactionEnabled(null, true) === true, "explicit but missing value → default ON");
  assert(parseCompactionEnabled("nope", true) === true, "explicit garbage → default ON");

  console.log("compactionParseHarness OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
