/**
 * Harness for claimEagerKick (V2-1 one-shot eager init).
 * Compile-from-disk. Exit 1 on fail.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outDir = path.join(projectRoot, "scripts/.build/eagerKickHarness");

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
  const modPath = resolveBuilt();
  const { EAGER_ENGINE_INIT, EAGER_PREFIX_PREWARM, claimEagerKick } = await import(
    pathToFileURL(modPath).href
  );

  assert(EAGER_ENGINE_INIT === true, "EAGER_ENGINE_INIT must default true");
  assert(EAGER_PREFIX_PREWARM === true, "EAGER_PREFIX_PREWARM must default true");
  assert(claimEagerKick("m1", 0) === true, "first claim wins");
  assert(claimEagerKick("m1", 0) === false, "same key is one-shot");
  assert(claimEagerKick("m1", 1) === true, "new generation may claim again");
  assert(claimEagerKick("m1", 1) === false, "same generation stays claimed");
  assert(claimEagerKick("m2", 1) === true, "new modelId may claim");
  assert(claimEagerKick("m2", 1) === false, "repeat new model is one-shot");

  console.log("eagerKickHarness OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
