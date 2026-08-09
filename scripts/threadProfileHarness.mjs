/**
 * Harness for src/engine/threadProfile.ts (pure chooseThreadCount + parseCpuPresent).
 *
 * Covers null→4, 8-core→6, big SoC→6, 6–7→4, low-end→2, and never-all-cores
 * for cores 3..16 (dual-core floor may equal cores), plus Linux CPU-list parsing
 * for /sys/devices/system/cpu/present. Compile-from-disk pattern
 * (same as engineParamsHarness). Exit 1 on fail.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

function compile() {
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/engine/threadProfile.ts",
      "--outDir",
      "scripts/.build",
      "--module",
      "nodenext",
      "--target",
      "es2020",
      "--moduleResolution",
      "nodenext",
      "--skipLibCheck",
      "--ignoreConfig",
      "--esModuleInterop",
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

function resolveBuilt() {
  const candidates = [
    path.join(projectRoot, "scripts/.build/threadProfile.js"),
    path.join(projectRoot, "scripts/.build/engine/threadProfile.js"),
    path.join(projectRoot, "scripts/.build/src/engine/threadProfile.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error("Could not find compiled threadProfile.js. Tried:\n", candidates.join("\n"));
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log("Compiling threadProfile.ts …");
  compile();
  const modPath = resolveBuilt();
  console.log("Loading", modPath);
  const mod = require(modPath);
  const { chooseThreadCount, parseCpuPresent } = mod;

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  OK  ${name}`);
      passed += 1;
    } catch (err) {
      console.error(`  FAIL ${name}: ${err instanceof Error ? err.message : err}`);
      failed += 1;
    }
  }

  await test("null → 4 (unknown / iOS / probe fail)", () => {
    assert(chooseThreadCount(null) === 4, `got ${chooseThreadCount(null)}`);
  });

  await test("8 → 6 (Snapdragon 8 Gen 3 class)", () => {
    assert(chooseThreadCount(8) === 6, `got ${chooseThreadCount(8)}`);
  });

  await test("12 → 6 (big SoC still leaves little cluster out)", () => {
    assert(chooseThreadCount(12) === 6, `got ${chooseThreadCount(12)}`);
  });

  await test("6 → 4", () => {
    assert(chooseThreadCount(6) === 4, `got ${chooseThreadCount(6)}`);
  });

  await test("7 → 4", () => {
    assert(chooseThreadCount(7) === 4, `got ${chooseThreadCount(7)}`);
  });

  await test("4 → 2", () => {
    assert(chooseThreadCount(4) === 2, `got ${chooseThreadCount(4)}`);
  });

  await test("2 → 2 (floor)", () => {
    assert(chooseThreadCount(2) === 2, `got ${chooseThreadCount(2)}`);
  });

  await test("5 → 2", () => {
    assert(chooseThreadCount(5) === 2, `got ${chooseThreadCount(5)}`);
  });

  await test("non-finite / non-positive treated as unknown → 4", () => {
    assert(chooseThreadCount(0) === 4, "0");
    assert(chooseThreadCount(-1) === 4, "-1");
    assert(chooseThreadCount(NaN) === 4, "NaN");
  });

  await test("never all-core for cores 3..16 (leave little cluster out)", () => {
    for (let c = 2; c <= 16; c++) {
      const t = chooseThreadCount(c);
      assert(typeof t === "number" && Number.isFinite(t) && t >= 1, `bad t for cores=${c}: ${t}`);
      // Dual-core floor is 2 (t===c). Above that, never pin every core —
      // set_best_cores would otherwise drag in efficiency cores.
      if (c > 2) {
        assert(t < c, `all-core forbidden: cores=${c} threads=${t}`);
      }
      assert(t !== c || c <= 2, `never returns cores for 3..16: cores=${c} threads=${t}`);
    }
  });

  // --- parseCpuPresent (Linux CPU-list from /sys/devices/system/cpu/present) ---

  await test('parseCpuPresent "0-7\\n" → 8', () => {
    assert(parseCpuPresent("0-7\n") === 8, `got ${parseCpuPresent("0-7\n")}`);
  });

  await test('parseCpuPresent "0" → 1', () => {
    assert(parseCpuPresent("0") === 1, `got ${parseCpuPresent("0")}`);
  });

  await test('parseCpuPresent "0-3,4-7" → 8', () => {
    assert(parseCpuPresent("0-3,4-7") === 8, `got ${parseCpuPresent("0-3,4-7")}`);
  });

  await test('parseCpuPresent "0-2,4-7" → 7 (gap, not max+1)', () => {
    assert(parseCpuPresent("0-2,4-7") === 7, `got ${parseCpuPresent("0-2,4-7")}`);
  });

  await test('parseCpuPresent "" → null', () => {
    assert(parseCpuPresent("") === null, `got ${parseCpuPresent("")}`);
  });

  await test('parseCpuPresent "garbage" → null', () => {
    assert(parseCpuPresent("garbage") === null, `got ${parseCpuPresent("garbage")}`);
  });

  await test('parseCpuPresent "0-" → null', () => {
    assert(parseCpuPresent("0-") === null, `got ${parseCpuPresent("0-")}`);
  });

  await test('parseCpuPresent "3-1" → null (reversed range)', () => {
    assert(parseCpuPresent("3-1") === null, `got ${parseCpuPresent("3-1")}`);
  });

  await test('parseCpuPresent "0-0" → 1 (single-cpu range)', () => {
    assert(parseCpuPresent("0-0") === 1, `got ${parseCpuPresent("0-0")}`);
  });

  await test('parseCpuPresent trailing comma / empty item → null', () => {
    assert(parseCpuPresent("0-3,") === null, "trailing comma");
    assert(parseCpuPresent(",0-3") === null, "leading comma");
  });

  await test('parseCpuPresent whitespace inside item → null', () => {
    assert(parseCpuPresent("0 - 7") === null, "spaces around dash");
    assert(parseCpuPresent("0-3, 4-7") === null, "space after comma");
  });

  await test("parseCpuPresent is exported pure function", () => {
    assert(typeof parseCpuPresent === "function", "missing export");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("All threadProfile harness cases passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
