/**
 * Harness for the bench-only n_ctx override (src/engine/contextProfile.ts).
 *
 * The override exists so the benchmark can cross the context limit inside a
 * 16-turn conversation instead of needing ~55 turns. A malformed pref must
 * fall back to catalog n_ctx and never reach initLlama as 0 or NaN: that
 * would either crash the engine or silently run the campaign in the wrong
 * regime while the log claims otherwise.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outDir = path.join(projectRoot, "scripts/.build/benchNCtxHarness");

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/engine/contextProfile.ts",
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
      "--types",
      "node",
    ],
    { cwd: projectRoot, encoding: "utf8", shell: true },
  );
  if (r.status !== 0) {
    console.error("tsc failed:\n", r.stdout, r.stderr);
    process.exit(1);
  }
}

function resolveBuilt(base) {
  for (const c of [
    path.join(outDir, `engine/${base}`),
    path.join(outDir, `src/engine/${base}`),
    path.join(outDir, base),
  ]) {
    if (existsSync(c)) return c;
  }
  console.error(`Could not find compiled ${base}`);
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`PASS ${name}`);
    pass++;
  } else {
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    fail++;
  }
}

async function main() {
  compile();
  const mod = await import(pathToFileURL(resolveBuilt("contextProfile.js")).href);
  const { parseBenchNCtx, resolveContextProfile, BENCH_NCTX_FLOOR } = mod;

  check("floor is the app's minimum chat context (8192)", BENCH_NCTX_FLOOR === 8192);

  // Absent pref: the benchmark must run at catalog n_ctx, not at a fabricated one.
  check("null → no override", parseBenchNCtx(null) === null);
  check("undefined → no override", parseBenchNCtx(undefined) === null);
  check("empty string → no override", parseBenchNCtx("") === null);
  check("whitespace → no override", parseBenchNCtx("   ") === null);

  // Malformed pref: reject rather than let Number() produce 0 or NaN downstream.
  check("non-numeric → no override", parseBenchNCtx("abc") === null);
  check("NaN literal → no override", parseBenchNCtx("NaN") === null);
  check("non-integer → no override", parseBenchNCtx("4096.5") === null);

  // Below the floor: the parser refuses before a sub-floor value can become an
  // override, whatever the engine would do with it.
  check("\"0\" → no override (below floor)", parseBenchNCtx("0") === null);
  check("1024 → no override (below floor)", parseBenchNCtx("1024") === null);
  check("8191 → no override (one below floor)", parseBenchNCtx("8191") === null);

  // Valid values, including exactly the floor.
  check("8192 → 8192 (floor is inclusive)", parseBenchNCtx("8192") === 8192);
  check("16384 → 16384", parseBenchNCtx("16384") === 16384);
  check("surrounding whitespace tolerated", parseBenchNCtx(" 16384 ") === 16384);

  // The override must beat both the catalog value and the high-RAM upgrade,
  // otherwise a 16k-catalog model would ignore the bench regime entirely.
  const catalog = resolveContextProfile({ catalogCtx: 16384, totalMemoryBytes: null });
  check("no override → catalog 16384 wins", catalog.nCtx === 16384);

  const overridden = resolveContextProfile({
    catalogCtx: 16384,
    explicitNCtx: 4096,
    totalMemoryBytes: null,
  });
  check("override 4096 beats catalog 16384", overridden.nCtx === 4096);

  const hybridHighRam = resolveContextProfile({
    hybrid: true,
    catalogCtx: 8192,
    explicitNCtx: 4096,
    totalMemoryBytes: 8_000_000_000,
  });
  check(
    "override beats the high-RAM hybrid upgrade",
    hybridHighRam.nCtx === 4096,
    `got ${hybridHighRam.nCtx}`,
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
