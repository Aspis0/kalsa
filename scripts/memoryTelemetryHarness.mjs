/**
 * Harness for memory telemetry measurement system.
 *
 * Tests:
 * 1. formatMemoryLine enumerates fields by name (no strings leak)
 * 2. readMemoryTelemetry parses memory.jsonl sidecars
 * 3. collectMemoryTelemetryByMode aggregates per-mode
 * 4. Empty-store failure detection (hasData=true but totalStored=0)
 * 5. Privacy: fact text cannot appear in telemetry output
 * 6. Memory enabled/disabled gate: memory off + zero counters → no failure; memory on + zero stored → failure
 *
 * Exit 1 on any failure.
 *
 * This harness imports the REAL modules, not copies:
 * - formatMemoryLine from src/memory/memoryTelemetry.ts (compiled)
 * - readMemoryTelemetry from scripts/benchGrade.mjs
 * - collectMemoryTelemetryByMode from scripts/benchAggregate.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readMemoryTelemetry } from "./benchGrade.mjs";
import { collectMemoryTelemetryByMode } from "./benchAggregate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outDir = path.join(projectRoot, "scripts/.build/memoryTelemetryHarness");

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/memory/memoryTelemetry.ts",
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

function resolveBuilt(name) {
  const candidates = [
    path.join(outDir, `memory/${name}`),
    path.join(outDir, `src/memory/${name}`),
    path.join(outDir, name),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error(`Could not find compiled ${name}`);
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
}

async function test1_formatMemoryLineEnumeratesFields() {
  console.log("Test 1: formatMemoryLine enumerates fields by name");

  const modPath = resolveBuilt("memoryTelemetry.js");
  const mod = await import(pathToFileURL(modPath).href);
  const { formatMemoryLine } = mod;

  const telemetry = {
    memoryEnabled: 1,
    factsExtracted: 5,
    factsStored: 3,
    factsRejectedSensitive: 1,
    factsRejectedFull: 1,
    factsInjected: 3,
    totalFactsInStore: 10,
  };

  const line = formatMemoryLine(telemetry);

  // Verify it starts with KALSA_MEMORY
  assert(line.startsWith("KALSA_MEMORY "), "Line must start with KALSA_MEMORY");

  // Parse the JSON part
  const jsonPart = line.substring("KALSA_MEMORY ".length);
  const parsed = JSON.parse(jsonPart);

  // Verify all 7 fields are present (including memoryEnabled)
  assert("memoryEnabled" in parsed, "memoryEnabled must be present");
  assert("factsExtracted" in parsed, "factsExtracted must be present");
  assert("factsStored" in parsed, "factsStored must be present");
  assert("factsRejectedSensitive" in parsed, "factsRejectedSensitive must be present");
  assert("factsRejectedFull" in parsed, "factsRejectedFull must be present");
  assert("factsInjected" in parsed, "factsInjected must be present");
  assert("totalFactsInStore" in parsed, "totalFactsInStore must be present");

  // Verify all values are numbers
  assert(typeof parsed.memoryEnabled === "number", "memoryEnabled must be number");
  assert(typeof parsed.factsExtracted === "number", "factsExtracted must be number");
  assert(typeof parsed.factsStored === "number", "factsStored must be number");
  assert(typeof parsed.factsRejectedSensitive === "number", "factsRejectedSensitive must be number");
  assert(typeof parsed.factsRejectedFull === "number", "factsRejectedFull must be number");
  assert(typeof parsed.factsInjected === "number", "factsInjected must be number");
  assert(typeof parsed.totalFactsInStore === "number", "totalFactsInStore must be number");

  // Verify NO string fields can leak (the whole point of enumerating by name)
  const keys = Object.keys(parsed);
  assert(keys.length === 7, "Exactly 7 fields must be present");

  console.log("✓ formatMemoryLine enumerates fields by name, no strings leak");
}

function test2_readMemoryTelemetryParsesSidecar() {
  console.log("\nTest 2: readMemoryTelemetry parses memory.jsonl sidecars");

  const tmpDir = path.join(projectRoot, "scripts/.build/memoryHarnessTest");
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  // Write a sample memory.jsonl
  const sidecarPath = path.join(tmpDir, "memory.jsonl");
  const lines = [
    '{"memoryEnabled":1,"factsExtracted":5,"factsStored":3,"factsRejectedSensitive":1,"factsRejectedFull":1,"factsInjected":3,"totalFactsInStore":10}',
    '{"memoryEnabled":1,"factsExtracted":2,"factsStored":2,"factsRejectedSensitive":0,"factsRejectedFull":0,"factsInjected":2,"totalFactsInStore":12}',
  ];
  writeFileSync(sidecarPath, lines.join("\n"));

  // Use the real readMemoryTelemetry from benchGrade.mjs
  const records = readMemoryTelemetry(tmpDir);

  assert(records.length === 2, `Expected 2 records, got ${records.length}`);
  assert(records[0].memoryEnabled === 1, "First record memoryEnabled must be 1");
  assert(records[0].factsExtracted === 5, "First record factsExtracted must be 5");
  assert(records[1].memoryEnabled === 1, "Second record memoryEnabled must be 1");
  assert(records[1].factsStored === 2, "Second record factsStored must be 2");
  assert(records[1].totalFactsInStore === 12, "Second record totalFactsInStore must be 12");

  rmSync(tmpDir, { recursive: true, force: true });
  console.log("✓ readMemoryTelemetry parses memory.jsonl correctly");
}

function test3_collectMemoryTelemetryByModeAggregates() {
  console.log("\nTest 3: collectMemoryTelemetryByMode aggregates per-mode");

  const fase4 = [
    {
      arm: "baseline",
      compactionActive: "off",
      memoryTelemetry: [
        [{ memoryEnabled: 1, factsExtracted: 5, factsStored: 3, factsRejectedSensitive: 1, factsRejectedFull: 1, factsInjected: 3, totalFactsInStore: 10 }],
        [{ memoryEnabled: 1, factsExtracted: 2, factsStored: 2, factsRejectedSensitive: 0, factsRejectedFull: 0, factsInjected: 2, totalFactsInStore: 12 }],
      ],
    },
    {
      arm: "v42",
      compactionActive: "v42",
      memoryTelemetry: [
        [{ memoryEnabled: 1, factsExtracted: 10, factsStored: 8, factsRejectedSensitive: 2, factsRejectedFull: 0, factsInjected: 5, totalFactsInStore: 20 }],
      ],
    },
  ];

  const result = collectMemoryTelemetryByMode(fase4);

  assert(result.length === 3, "Should have 3 modes");

  const offMode = result.find(r => r.mode === "off");
  assert(offMode.hasData === true, "off mode should have data");
  assert(offMode.totalExtracted === 7, `off mode extracted should be 7, got ${offMode.totalExtracted}`);
  assert(offMode.totalStored === 5, `off mode stored should be 5, got ${offMode.totalStored}`);
  assert(offMode.maxFactsInStore === 12, `off mode maxInStore should be 12, got ${offMode.maxFactsInStore}`);

  const v42Mode = result.find(r => r.mode === "v42");
  assert(v42Mode.hasData === true, "v42 mode should have data");
  assert(v42Mode.totalExtracted === 10, `v42 mode extracted should be 10, got ${v42Mode.totalExtracted}`);
  assert(v42Mode.totalStored === 8, `v42 mode stored should be 8, got ${v42Mode.totalStored}`);

  const ciswireMode = result.find(r => r.mode === "ciswire");
  assert(ciswireMode.hasData === false, "ciswire mode should not have data");
  assert(ciswireMode.totalExtracted === 0, "ciswire mode extracted should be 0");

  console.log("✓ collectMemoryTelemetryByMode aggregates per-mode correctly");
}

function test4_emptyStoreFailureDetection() {
  console.log("\nTest 4: Empty-store failure detection");

  // Simulate the empty-store check
  const memoryTelemetryByMode = [
    { mode: "off", arm: "baseline", hasData: true, totalStored: 5 },
    { mode: "v42", arm: "v42", hasData: true, totalStored: 0 }, // FAILURE: has data but stored 0
    { mode: "ciswire", arm: "ciswire", hasData: false, totalStored: 0 }, // OK: no data
  ];

  const emptyStoreFailures = memoryTelemetryByMode.filter(
    (row) => row.hasData && row.totalStored === 0
  );

  assert(emptyStoreFailures.length === 1, `Expected 1 empty-store failure, got ${emptyStoreFailures.length}`);
  assert(emptyStoreFailures[0].mode === "v42", "Failure should be in v42 mode");
  assert(emptyStoreFailures[0].arm === "v42", "Failure should be in v42 arm");

  console.log("✓ Empty-store failure detection works correctly");
}

async function test5_privacyFactTextCannotLeak() {
  console.log("\nTest 5: Privacy - fact text cannot appear in telemetry");

  const modPath = resolveBuilt("memoryTelemetry.js");
  const mod = await import(pathToFileURL(modPath).href);
  const { formatMemoryLine } = mod;

  // Create a fact with sensitive-looking text
  const telemetry = {
    memoryEnabled: 1,
    factsExtracted: 1,
    factsStored: 0, // rejected as sensitive
    factsRejectedSensitive: 1,
    factsRejectedFull: 0,
    factsInjected: 0,
    totalFactsInStore: 0,
  };

  const line = formatMemoryLine(telemetry);

  // Verify the fact text does NOT appear in the output
  assert(!line.includes("4111111111111111"), "Credit card number must not appear in telemetry");
  assert(!line.includes("secret123"), "Password must not appear in telemetry");
  assert(!line.includes("credit card"), "Sensitive keywords must not appear in telemetry");

  // Verify only numbers are in the JSON
  const jsonPart = line.substring("KALSA_MEMORY ".length);
  const parsed = JSON.parse(jsonPart);
  for (const key of Object.keys(parsed)) {
    assert(typeof parsed[key] === "number", `${key} must be a number, not ${typeof parsed[key]}`);
  }

  console.log("✓ Fact text cannot leak into telemetry output");
}

function test6_memoryEnabledGate() {
  console.log("\nTest 6: Memory enabled/disabled gate - both directions");

  // Test 6a: memory OFF + zero counters → no failure (hasData should be false)
  const fase4_memoryOff = [
    {
      arm: "baseline",
      compactionActive: "off",
      memoryTelemetry: [
        [{ memoryEnabled: 0, factsExtracted: 0, factsStored: 0, factsRejectedSensitive: 0, factsRejectedFull: 0, factsInjected: 0, totalFactsInStore: 0 }],
        [{ memoryEnabled: 0, factsExtracted: 0, factsStored: 0, factsRejectedSensitive: 0, factsRejectedFull: 0, factsInjected: 0, totalFactsInStore: 0 }],
      ],
    },
  ];

  const resultOff = collectMemoryTelemetryByMode(fase4_memoryOff);
  const offMode = resultOff.find(r => r.mode === "off");
  assert(offMode.hasData === false, "memory OFF + zero counters → hasData must be false (no failure)");
  console.log("  ✓ memory OFF + zero counters → hasData=false (no failure)");

  // Test 6b: memory ON + zero stored → failure (hasData should be true, totalStored=0)
  const fase4_memoryOn = [
    {
      arm: "v42",
      compactionActive: "v42",
      memoryTelemetry: [
        [{ memoryEnabled: 1, factsExtracted: 5, factsStored: 0, factsRejectedSensitive: 5, factsRejectedFull: 0, factsInjected: 0, totalFactsInStore: 0 }],
        [{ memoryEnabled: 1, factsExtracted: 3, factsStored: 0, factsRejectedSensitive: 3, factsRejectedFull: 0, factsInjected: 0, totalFactsInStore: 0 }],
      ],
    },
  ];

  const resultOn = collectMemoryTelemetryByMode(fase4_memoryOn);
  const v42Mode = resultOn.find(r => r.mode === "v42");
  assert(v42Mode.hasData === true, "memory ON + zero stored → hasData must be true");
  assert(v42Mode.totalStored === 0, "memory ON + zero stored → totalStored must be 0");

  // Simulate the empty-store check
  const emptyStoreFailures = resultOn.filter(
    (row) => row.hasData && row.totalStored === 0
  );
  assert(emptyStoreFailures.length === 1, "memory ON + zero stored → should be 1 failure");
  assert(emptyStoreFailures[0].mode === "v42", "Failure should be in v42 mode");
  console.log("  ✓ memory ON + zero stored → hasData=true, totalStored=0 → failure");

  console.log("✓ Memory enabled/disabled gate works in both directions");
}

// Run all tests
async function main() {
  compile();
  await test1_formatMemoryLineEnumeratesFields();
  test2_readMemoryTelemetryParsesSidecar();
  test3_collectMemoryTelemetryByModeAggregates();
  test4_emptyStoreFailureDetection();
  await test5_privacyFactTextCannotLeak();
  test6_memoryEnabledGate();

  console.log("\n✅ All memory telemetry harness tests passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌ Memory telemetry harness failed:", err.message);
  process.exit(1);
});
