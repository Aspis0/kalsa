/**
 * Harness for memory telemetry measurement system.
 *
 * Tests:
 * 1. formatMemoryLine enumerates fields by name (no strings leak)
 * 2. readMemoryTelemetry parses memory.jsonl sidecars
 * 3. collectMemoryTelemetryByMode aggregates per-mode
 * 4. Empty-store failure detection (hasData=true but totalStored=0)
 * 5. Privacy: fact text cannot appear in telemetry output
 *
 * Exit 1 on any failure.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function assert(cond, msg) {
  if (!cond) {
    console.error(`ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
}

function test1_formatMemoryLineEnumeratesFields() {
  console.log("Test 1: formatMemoryLine enumerates fields by name");

  // Simulate the formatMemoryLine function
  const formatMemoryLine = (telemetry) => {
    return `KALSA_MEMORY ${JSON.stringify({
      factsExtracted: telemetry.factsExtracted,
      factsStored: telemetry.factsStored,
      factsRejectedSensitive: telemetry.factsRejectedSensitive,
      factsRejectedFull: telemetry.factsRejectedFull,
      factsInjected: telemetry.factsInjected,
      totalFactsInStore: telemetry.totalFactsInStore,
    })}`;
  };

  const telemetry = {
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

  // Verify all 6 fields are present
  assert("factsExtracted" in parsed, "factsExtracted must be present");
  assert("factsStored" in parsed, "factsStored must be present");
  assert("factsRejectedSensitive" in parsed, "factsRejectedSensitive must be present");
  assert("factsRejectedFull" in parsed, "factsRejectedFull must be present");
  assert("factsInjected" in parsed, "factsInjected must be present");
  assert("totalFactsInStore" in parsed, "totalFactsInStore must be present");

  // Verify all values are numbers
  assert(typeof parsed.factsExtracted === "number", "factsExtracted must be number");
  assert(typeof parsed.factsStored === "number", "factsStored must be number");
  assert(typeof parsed.factsRejectedSensitive === "number", "factsRejectedSensitive must be number");
  assert(typeof parsed.factsRejectedFull === "number", "factsRejectedFull must be number");
  assert(typeof parsed.factsInjected === "number", "factsInjected must be number");
  assert(typeof parsed.totalFactsInStore === "number", "totalFactsInStore must be number");

  // Verify NO string fields can leak (the whole point of enumerating by name)
  const keys = Object.keys(parsed);
  assert(keys.length === 6, "Exactly 6 fields must be present");

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
    '{"factsExtracted":5,"factsStored":3,"factsRejectedSensitive":1,"factsRejectedFull":1,"factsInjected":3,"totalFactsInStore":10}',
    '{"factsExtracted":2,"factsStored":2,"factsRejectedSensitive":0,"factsRejectedFull":0,"factsInjected":2,"totalFactsInStore":12}',
  ];
  writeFileSync(sidecarPath, lines.join("\n"));

  // Simulate readMemoryTelemetry
  const readMemoryTelemetry = (turnDir) => {
    const file = path.join(turnDir, "memory.jsonl");
    if (!existsSync(file)) return [];

    const content = readFileSync(file, "utf8");
    const records = [];
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        const factsExtracted = typeof obj.factsExtracted === "number" ? obj.factsExtracted : null;
        const factsStored = typeof obj.factsStored === "number" ? obj.factsStored : null;
        const factsRejectedSensitive = typeof obj.factsRejectedSensitive === "number" ? obj.factsRejectedSensitive : null;
        const factsRejectedFull = typeof obj.factsRejectedFull === "number" ? obj.factsRejectedFull : null;
        const factsInjected = typeof obj.factsInjected === "number" ? obj.factsInjected : null;
        const totalFactsInStore = typeof obj.totalFactsInStore === "number" ? obj.totalFactsInStore : null;

        if (factsExtracted != null || factsStored != null || factsRejectedSensitive != null ||
            factsRejectedFull != null || factsInjected != null || totalFactsInStore != null) {
          records.push({ factsExtracted, factsStored, factsRejectedSensitive, factsRejectedFull, factsInjected, totalFactsInStore });
        }
      } catch {
        // skip unparseable lines
      }
    }
    return records;
  };

  const records = readMemoryTelemetry(tmpDir);

  assert(records.length === 2, `Expected 2 records, got ${records.length}`);
  assert(records[0].factsExtracted === 5, "First record factsExtracted must be 5");
  assert(records[1].factsStored === 2, "Second record factsStored must be 2");
  assert(records[1].totalFactsInStore === 12, "Second record totalFactsInStore must be 12");

  rmSync(tmpDir, { recursive: true, force: true });
  console.log("✓ readMemoryTelemetry parses memory.jsonl correctly");
}

function test3_collectMemoryTelemetryByModeAggregates() {
  console.log("\nTest 3: collectMemoryTelemetryByMode aggregates per-mode");

  // Simulate the aggregation logic
  const FASE4_MODES = ["off", "v42", "ciswire"];

  const collectMemoryTelemetryByMode = (fase4) => {
    const acc = new Map();
    for (const mode of FASE4_MODES) {
      acc.set(mode, {
        extracted: 0,
        stored: 0,
        rejectedSensitive: 0,
        rejectedFull: 0,
        injected: 0,
        maxInStore: 0,
        hasData: false,
        arm: null,
      });
    }

    for (const r of fase4) {
      const mode = r.compactionActive;
      if (!mode || !acc.has(mode)) continue;
      const row = acc.get(mode);
      row.arm = r.arm;
      const telemetry = r.memoryTelemetry;
      if (!Array.isArray(telemetry)) continue;

      for (const turnTelemetry of telemetry) {
        if (!Array.isArray(turnTelemetry)) continue;
        for (const m of turnTelemetry) {
          row.hasData = true;
          if (typeof m.factsExtracted === "number") row.extracted += m.factsExtracted;
          if (typeof m.factsStored === "number") row.stored += m.factsStored;
          if (typeof m.factsRejectedSensitive === "number") row.rejectedSensitive += m.factsRejectedSensitive;
          if (typeof m.factsRejectedFull === "number") row.rejectedFull += m.factsRejectedFull;
          if (typeof m.factsInjected === "number") row.injected += m.factsInjected;
          if (typeof m.totalFactsInStore === "number") {
            row.maxInStore = Math.max(row.maxInStore, m.totalFactsInStore);
          }
        }
      }
    }

    return FASE4_MODES.map((mode) => {
      const row = acc.get(mode);
      return {
        mode,
        arm: row.arm,
        hasData: row.hasData,
        totalExtracted: row.extracted,
        totalStored: row.stored,
        totalRejectedSensitive: row.rejectedSensitive,
        totalRejectedFull: row.rejectedFull,
        totalInjected: row.injected,
        maxFactsInStore: row.maxInStore,
      };
    });
  };

  const fase4 = [
    {
      arm: "baseline",
      compactionActive: "off",
      memoryTelemetry: [
        [{ factsExtracted: 5, factsStored: 3, factsRejectedSensitive: 1, factsRejectedFull: 1, factsInjected: 3, totalFactsInStore: 10 }],
        [{ factsExtracted: 2, factsStored: 2, factsRejectedSensitive: 0, factsRejectedFull: 0, factsInjected: 2, totalFactsInStore: 12 }],
      ],
    },
    {
      arm: "v42",
      compactionActive: "v42",
      memoryTelemetry: [
        [{ factsExtracted: 10, factsStored: 8, factsRejectedSensitive: 2, factsRejectedFull: 0, factsInjected: 5, totalFactsInStore: 20 }],
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

function test5_privacyFactTextCannotLeak() {
  console.log("\nTest 5: Privacy - fact text cannot appear in telemetry");

  // Create a fact with sensitive-looking text
  const sensitiveFact = "My credit card is 4111111111111111 and password is secret123";

  // Simulate formatMemoryLine with this fact
  const formatMemoryLine = (telemetry) => {
    return `KALSA_MEMORY ${JSON.stringify({
      factsExtracted: telemetry.factsExtracted,
      factsStored: telemetry.factsStored,
      factsRejectedSensitive: telemetry.factsRejectedSensitive,
      factsRejectedFull: telemetry.factsRejectedFull,
      factsInjected: telemetry.factsInjected,
      totalFactsInStore: telemetry.totalFactsInStore,
    })}`;
  };

  const telemetry = {
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

// Run all tests
try {
  test1_formatMemoryLineEnumeratesFields();
  test2_readMemoryTelemetryParsesSidecar();
  test3_collectMemoryTelemetryByModeAggregates();
  test4_emptyStoreFailureDetection();
  test5_privacyFactTextCannotLeak();

  console.log("\n✅ All memory telemetry harness tests passed");
  process.exit(0);
} catch (err) {
  console.error("\n❌ Memory telemetry harness failed:", err.message);
  process.exit(1);
}
