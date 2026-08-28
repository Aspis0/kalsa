/**
 * Harness for src/engine/threadProfile.ts
 * (pure chooseThreadCountFromCapacities + parseCpuPresent / listCpuPresent).
 *
 * Capacity-based thread selection from real SoC layouts, clamp rails, null
 * fallback, reasoned unmeasured layouts, mutation-killers for floor / guards /
 * strict `>`, plus Linux CPU-list parsing for /sys/devices/system/cpu/present.
 * Compile-from-disk pattern (same as engineParamsHarness). Exit 1 on fail.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
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
  const {
    chooseThreadCountFromCapacities,
    parseCpuPresent,
    listCpuPresent,
    FALLBACK_THREAD_COUNT,
    getThreadCountSource,
  } = mod;

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

  // --- chooseThreadCountFromCapacities (real SoC layouts + rails) ---

  await test("Snapdragon 8 Gen 2 capacities → 5", () => {
    const t = chooseThreadCountFromCapacities([
      266, 266, 266, 811, 811, 811, 811, 1024,
    ]);
    assert(t === 5, `got ${t}`);
  });

  await test("Helio G99 capacities → 2", () => {
    const t = chooseThreadCountFromCapacities([
      348, 348, 348, 348, 348, 348, 1024, 1024,
    ]);
    assert(t === 2, `got ${t}`);
  });

  await test("Snapdragon 8 Gen 3 shape (1P+5perf+2eff) → 6", () => {
    const t = chooseThreadCountFromCapacities([
      1024, 980, 980, 980, 940, 940, 320, 320,
    ]);
    assert(t === 6, `got ${t}`);
  });

  await test("[1024,1024] dual-core floor → 2", () => {
    const t = chooseThreadCountFromCapacities([1024, 1024]);
    assert(t === 2, `got ${t}`);
  });

  await test("empty / all-zero / non-finite → null", () => {
    assert(chooseThreadCountFromCapacities([]) === null, "[]");
    assert(chooseThreadCountFromCapacities([0, 0, 0, 0]) === null, "[0,0,0,0]");
    assert(chooseThreadCountFromCapacities([NaN, 1]) === null, "[NaN,1]");
  });

  // Mutation killers: negative / Infinity / non-array must not be accepted.
  await test("negative capacity → null (non-finite/negative guard)", () => {
    assert(chooseThreadCountFromCapacities([-1, 1024]) === null, "[-1,1024]");
    assert(chooseThreadCountFromCapacities([1024, -0.5]) === null, "[1024,-0.5]");
    assert(chooseThreadCountFromCapacities([Infinity, 1]) === null, "[Infinity,1]");
  });

  await test("non-array input → null (Array.isArray guard)", () => {
    assert(chooseThreadCountFromCapacities(null) === null, "null");
    assert(chooseThreadCountFromCapacities(undefined) === null, "undefined");
    assert(chooseThreadCountFromCapacities({ length: 2, 0: 1024, 1: 1024 }) === null, "array-like object");
    assert(chooseThreadCountFromCapacities("1024") === null, "string");
  });

  // Floor-at-2: single high-capacity core would yield high=1 without the floor.
  await test("single high core among lows → floor 2 (kills floor deletion)", () => {
    const t = chooseThreadCountFromCapacities([1024, 100, 100, 100]);
    assert(t === 2, `got ${t}`);
  });

  await test("all-equal capacities, 8 cores → <= 7 (never all cores)", () => {
    const caps = Array(8).fill(1024);
    const t = chooseThreadCountFromCapacities(caps);
    assert(typeof t === "number" && t !== null, `got ${t}`);
    assert(t <= 7, `expected <= 7, got ${t}`);
    assert(t === 7, `all-equal 8 → clamp to 7, got ${t}`);
  });

  await test("all high-capacity, 4 cores → <= 3", () => {
    const t = chooseThreadCountFromCapacities([1024, 1024, 1024, 1024]);
    assert(typeof t === "number" && t !== null, `got ${t}`);
    assert(t <= 3, `expected <= 3, got ${t}`);
    assert(t === 3, `all-high 4 → clamp to 3, got ${t}`);
  });

  // Boundary: exact 50% of max. With `>` littles at 512 are excluded → 4.
  // With `>=` they are included → 8 → clamp 7 (pathological). Kills flip to >=.
  await test("4+4 @1024/512 boundary → 4 (strict >, not >=)", () => {
    const t = chooseThreadCountFromCapacities([
      1024, 1024, 1024, 1024, 512, 512, 512, 512,
    ]);
    assert(t === 4, `got ${t} (expected 4; >= would yield 7)`);
  });

  // --- REASONED (not measured) unmeasured layouts — we do not own this hardware ---
  // After fix `>` : expected outputs below. Do not treat as measured optima.

  // 2 big + 6 little with a small capacity gap (littles still > 50% of max).
  // All eight count as high → never-all-cores clamp 7.
  await test("REASONED 2+6 small gap → 7 (clamp; unmeasured)", () => {
    const t = chooseThreadCountFromCapacities([
      1024, 1024, 700, 700, 700, 700, 700, 700,
    ]);
    assert(t === 7, `got ${t}`);
  });

  // 4+4 @1024/512 already covered as the boundary case → 4.

  // 1 prime + 3 mid + 4 little, all tiers still above 50% of max.
  // All eight high → clamp 7.
  await test("REASONED 1+3+4 all-above-50% → 7 (clamp; unmeasured)", () => {
    const t = chooseThreadCountFromCapacities([
      1024, 900, 900, 900, 600, 600, 600, 600,
    ]);
    assert(t === 7, `got ${t}`);
  });

  // Threshold band note: the three measured SoCs only bound the factor to
  // roughly (0.34, 0.79) — G99 little 348/1024≈0.34, 8 Gen 2 mid 811/1024≈0.79.
  // Moving 0.5 anywhere inside that open interval still passes those cases.
  // We do NOT add a synthetic case that pretends to prove 0.5; the constant is
  // a choice within the band. (See threadProfile.ts header.)

  await test("fallback when capacities unavailable is 4", () => {
    assert(
      FALLBACK_THREAD_COUNT === 4,
      `FALLBACK_THREAD_COUNT=${FALLBACK_THREAD_COUNT}`,
    );
    // Capacities unavailable → chooseThreadCountFromCapacities returns null;
    // detectThreadCount then uses FALLBACK_THREAD_COUNT (4). Pure path mirrors that.
    const unavailable = chooseThreadCountFromCapacities([]);
    assert(unavailable === null, "unavailable capacities → null");
    const resolved = unavailable === null ? FALLBACK_THREAD_COUNT : unavailable;
    assert(resolved === 4, `resolved fallback got ${resolved}`);
  });

  await test("chooseThreadCountFromCapacities is exported pure function", () => {
    assert(typeof chooseThreadCountFromCapacities === "function", "missing export");
  });

  await test("getThreadCountSource is exported and starts unset", () => {
    assert(typeof getThreadCountSource === "function", "missing export");
    assert(getThreadCountSource() === "unset", `got ${getThreadCountSource()}`);
  });

  // --- parseCpuPresent / listCpuPresent (Linux CPU-list) ---

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

  await test("parseCpuPresent trailing comma / empty item → null", () => {
    assert(parseCpuPresent("0-3,") === null, "trailing comma");
    assert(parseCpuPresent(",0-3") === null, "leading comma");
  });

  await test("parseCpuPresent whitespace inside item → null", () => {
    assert(parseCpuPresent("0 - 7") === null, "spaces around dash");
    assert(parseCpuPresent("0-3, 4-7") === null, "space after comma");
  });

  await test("parseCpuPresent is exported pure function", () => {
    assert(typeof parseCpuPresent === "function", "missing export");
  });

  await test('listCpuPresent "0-7" → [0..7]', () => {
    const list = listCpuPresent("0-7");
    assert(Array.isArray(list), "not array");
    assert(list.length === 8, `len ${list.length}`);
    assert(list.join(",") === "0,1,2,3,4,5,6,7", `got ${list.join(",")}`);
  });

  await test('listCpuPresent "0-2,4-7" → gap indices', () => {
    const list = listCpuPresent("0-2,4-7");
    assert(Array.isArray(list), "not array");
    assert(list.join(",") === "0,1,2,4,5,6,7", `got ${list.join(",")}`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("All threadProfile harness cases passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
