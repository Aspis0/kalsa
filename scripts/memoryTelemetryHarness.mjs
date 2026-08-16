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
 * 7. Turn-end N/A sentinels, settled enabled state, and extraction lifecycle coverage
 *
 * Exit 1 on any failure.
 *
 * This harness imports the REAL modules, not copies:
 * - formatMemoryLine from src/memory/memoryTelemetry.ts (compiled)
 * - readMemoryTelemetry from scripts/benchGrade.mjs
 * - collectMemoryTelemetryByMode, collectMemoryExtractTelemetryByMode, and
 *   findEmptyStoreFailures from scripts/benchAggregate.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readMemoryTelemetry } from "./benchGrade.mjs";
import {
  collectMemoryTelemetryByMode,
  collectMemoryExtractTelemetryByMode,
  findEmptyStoreFailures,
  runAggregate,
} from "./benchAggregate.mjs";

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
    extractParseOutcome: 3,
    extractGateSource: 2,
    extractStopReason: 3,
  };

  const line = formatMemoryLine(telemetry);

  // Verify it starts with KALSA_MEMORY
  assert(line.startsWith("KALSA_MEMORY "), "Line must start with KALSA_MEMORY");

  // Parse the JSON part
  const jsonPart = line.substring("KALSA_MEMORY ".length);
  const parsed = JSON.parse(jsonPart);

  // Verify all 10 numeric fields are present, including the settled-only fields.
  assert("memoryEnabled" in parsed, "memoryEnabled must be present");
  assert("factsExtracted" in parsed, "factsExtracted must be present");
  assert("factsStored" in parsed, "factsStored must be present");
  assert("factsRejectedSensitive" in parsed, "factsRejectedSensitive must be present");
  assert("factsRejectedFull" in parsed, "factsRejectedFull must be present");
  assert("factsInjected" in parsed, "factsInjected must be present");
  assert("totalFactsInStore" in parsed, "totalFactsInStore must be present");
  assert("extractParseOutcome" in parsed, "extractParseOutcome must be present");
  assert("extractGateSource" in parsed, "extractGateSource must be present");
  assert("extractStopReason" in parsed, "extractStopReason must be present");
  assert(parsed.extractParseOutcome === 3, "3 must represent extraction threw");
  assert(parsed.extractGateSource === 2, "2 must represent the safety timeout gate source");
  assert(parsed.extractStopReason === 3, "3 must represent a changed store epoch");

  // Verify all values are numbers
  assert(typeof parsed.memoryEnabled === "number", "memoryEnabled must be number");
  assert(typeof parsed.factsExtracted === "number", "factsExtracted must be number");
  assert(typeof parsed.factsStored === "number", "factsStored must be number");
  assert(typeof parsed.factsRejectedSensitive === "number", "factsRejectedSensitive must be number");
  assert(typeof parsed.factsRejectedFull === "number", "factsRejectedFull must be number");
  assert(typeof parsed.factsInjected === "number", "factsInjected must be number");
  assert(typeof parsed.totalFactsInStore === "number", "totalFactsInStore must be number");
  assert(typeof parsed.extractParseOutcome === "number", "extractParseOutcome must be number");
  assert(typeof parsed.extractGateSource === "number", "extractGateSource must be number");
  assert(typeof parsed.extractStopReason === "number", "extractStopReason must be number");

  // Verify NO string fields can leak (the whole point of enumerating by name)
  const keys = Object.keys(parsed);
  assert(keys.length === 10, "Exactly 10 fields must be present");

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
    '{"memoryEnabled":1,"factsInjected":3,"factsExtracted":-1,"extractParseOutcome":-1}',
    '{"memoryEnabled":1,"factsInjected":2,"factsExtracted":-1,"extractParseOutcome":-1}',
  ];
  writeFileSync(sidecarPath, lines.join("\n"));

  // Use the real readMemoryTelemetry from benchGrade.mjs
  const records = readMemoryTelemetry(tmpDir);

  assert(records.length === 2, `Expected 2 records, got ${records.length}`);
  assert(records[0].memoryEnabled === 1, "First record memoryEnabled must be 1");
  assert(records[0].factsInjected === 3, "First record factsInjected must be 3");
  assert(!("extractParseOutcome" in records[0]), "Turn parser must not expose extract codes");
  assert(records[1].memoryEnabled === 1, "Second record memoryEnabled must be 1");
  assert(records[1].factsInjected === 2, "Second record factsInjected must be 2");

  rmSync(tmpDir, { recursive: true, force: true });
  console.log("✓ readMemoryTelemetry parses memory.jsonl correctly");
}

function test3_collectMemoryTelemetryByModeAggregates() {
  console.log("\nTest 3: settled collector owns extraction fields");

  const fase4 = [
    {
      arm: "baseline",
      compactionActive: "off",
      memoryTelemetry: [
        [{ memoryEnabled: 1, factsInjected: 3, extractParseOutcome: -1 }],
        [{ memoryEnabled: 1, factsInjected: 2, extractParseOutcome: -1 }],
      ],
      memoryExtractTelemetry: [
        [{ memoryEnabled: 1, factsExtracted: 5, factsStored: 3, factsRejectedSensitive: 1, factsRejectedFull: 1, totalFactsInStore: 10, extractParseOutcome: 1, extractGateSource: 1, extractStopReason: 0 }],
        [{ memoryEnabled: 1, factsExtracted: 2, factsStored: 2, factsRejectedSensitive: 0, factsRejectedFull: 0, totalFactsInStore: 12, extractParseOutcome: 1, extractGateSource: 2, extractStopReason: 0 }],
      ],
    },
    {
      arm: "v42",
      compactionActive: "v42",
      memoryTelemetry: [[{ memoryEnabled: 1, factsInjected: 5, extractParseOutcome: -1 }]],
      memoryExtractTelemetry: [[{ memoryEnabled: 1, factsExtracted: 10, factsStored: 8, factsRejectedSensitive: 2, factsRejectedFull: 0, totalFactsInStore: 20, extractParseOutcome: 1, extractGateSource: 1, extractStopReason: 0 }]],
    },
  ];

  const turnResult = collectMemoryTelemetryByMode(fase4);
  const result = collectMemoryExtractTelemetryByMode(fase4);

  assert(turnResult.find(r => r.mode === "off").totalExtracted === null, "Turn collector must not read extraction counters");
  const offMode = result.find(r => r.mode === "off");
  assert(offMode.hasData === true, "off mode should have settled data");
  assert(offMode.totalExtracted === 7, `off mode extracted should be 7, got ${offMode.totalExtracted}`);
  assert(offMode.totalStored === 5, `off mode stored should be 5, got ${offMode.totalStored}`);
  assert(offMode.maxFactsInStore === 12, `off mode maxInStore should be 12, got ${offMode.maxFactsInStore}`);
  assert(offMode.extractParseOutcomes.join(",") === "1", "Parse outcomes must come from settled telemetry");
  assert(offMode.extractGateSources.join(",") === "1,2", "Gate sources must come from settled telemetry");

  const v42Mode = result.find(r => r.mode === "v42");
  assert(v42Mode.totalExtracted === 10, `v42 mode extracted should be 10, got ${v42Mode.totalExtracted}`);
  assert(v42Mode.totalStored === 8, `v42 mode stored should be 8, got ${v42Mode.totalStored}`);

  const ciswireMode = result.find(r => r.mode === "ciswire");
  assert(ciswireMode.hasData === false, "ciswire mode should not have data");

  console.log("✓ settled collector aggregates extraction fields and lifecycle codes");
}

function test4_emptyStoreFailureDetection() {
  console.log("\nTest 4: Empty-store failure detection");

  const memoryTelemetryByMode = [
    { mode: "off", arm: "baseline", hasData: true, totalStored: 5 },
    { mode: "v42", arm: "v42", hasData: true, totalStored: 0 }, // FAILURE: has data but stored 0
    { mode: "ciswire", arm: "ciswire", hasData: false, totalStored: 0 }, // OK: no data
  ];

  const emptyStoreFailures = findEmptyStoreFailures(memoryTelemetryByMode);

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
    factText: "I use secret123 and 4111111111111111 for my credit card", // must be ignored
    factsRejectedSensitive: 1,
    factsRejectedFull: 0,
    factsInjected: 0,
    totalFactsInStore: 0,
    extractParseOutcome: 2,
    extractGateSource: 1,
    extractStopReason: 2,
    modelOutput: "{\\\"add\\\":[\\\"secret123\\\"]}", // must be ignored
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
      memoryExtractTelemetry: [
        [{ memoryEnabled: 0, factsExtracted: 0, factsStored: 0, factsRejectedSensitive: 0, factsRejectedFull: 0, totalFactsInStore: 0, extractParseOutcome: 0 }],
        [{ memoryEnabled: 0, factsExtracted: 0, factsStored: 0, factsRejectedSensitive: 0, factsRejectedFull: 0, totalFactsInStore: 0, extractParseOutcome: 0 }],
      ],
    },
  ];

  const resultOff = collectMemoryExtractTelemetryByMode(fase4_memoryOff);
  const offMode = resultOff.find(r => r.mode === "off");
  assert(offMode.hasData === false, "memory OFF + zero counters → hasData must be false (no failure)");
  console.log("  ✓ memory OFF + zero counters → hasData=false (no failure)");

  // Test 6b: memory ON + zero stored → failure (hasData should be true, totalStored=0)
  const fase4_memoryOn = [
    {
      arm: "v42",
      compactionActive: "v42",
      memoryExtractTelemetry: [
        [{ memoryEnabled: 1, factsExtracted: 5, factsStored: 0, factsRejectedSensitive: 5, factsRejectedFull: 0, totalFactsInStore: 0, extractParseOutcome: 1 }],
        [{ memoryEnabled: 1, factsExtracted: 3, factsStored: 0, factsRejectedSensitive: 3, factsRejectedFull: 0, totalFactsInStore: 0, extractParseOutcome: 1 }],
      ],
    },
  ];

  const resultOn = collectMemoryExtractTelemetryByMode(fase4_memoryOn);
  const v42Mode = resultOn.find(r => r.mode === "v42");
  assert(v42Mode.hasData === true, "memory ON + zero stored → hasData must be true");
  assert(v42Mode.totalStored === 0, "memory ON + zero stored → totalStored must be 0");

  const emptyStoreFailuresOn = findEmptyStoreFailures(resultOn);
  assert(emptyStoreFailuresOn.length === 1, "memory ON + zero stored → should be 1 failure");
  assert(emptyStoreFailuresOn[0].mode === "v42", "Failure should be in v42 mode");
  assert(findEmptyStoreFailures(resultOff).length === 0, "memory OFF → must not be flagged");
  console.log("  ✓ memory ON + zero stored → hasData=true, totalStored=0 → failure");
  console.log("  ✓ memory OFF + zero stored → no failure");

  // Exercise the real aggregate gate as well as the exported predicate. The
  // turn-end rows deliberately contain only -1 extraction sentinels; only the
  // settled v42 row is an empty-store failure.
  const gateFixtureDir = path.join(outDir, "empty-store-gate");
  for (const [arm, mode, stored] of [
    ["baseline", "off", 1],
    ["v42", "v42", 0],
    ["ciswire", "ciswire", 1],
  ]) {
    const armDir = path.join(gateFixtureDir, arm);
    mkdirSync(armDir, { recursive: true });
    writeFileSync(
      path.join(armDir, "result.json"),
      JSON.stringify({
        schema: 2,
        phase: "fase4",
        arm,
        seed: 1,
        compactionActive: mode,
        turns: [{ promptMs: 1, elapsed_s: 1, promptTokens: 1 }],
        probes: [{ family: "fact_recall", found: true }],
        recall: 1,
        summaryEvents: { captured: 1 },
        positiveControl: {
          promptTokensByTurn: { "1": 100, "2": 101 },
          compactorChars: 1,
          digestCharsByTurn: { "2": 1 },
          boundaryByTurn: { "2": 1 },
        },
        memoryTelemetry: [[{
          memoryEnabled: 1,
          factsInjected: 0,
          factsExtracted: -1,
          factsStored: -1,
          factsRejectedSensitive: -1,
          factsRejectedFull: -1,
          totalFactsInStore: -1,
        }]],
        memoryExtractTelemetry: [[{
          memoryEnabled: 1,
          factsExtracted: 1,
          factsStored: stored,
          factsRejectedSensitive: 0,
          factsRejectedFull: 0,
          totalFactsInStore: stored,
        }]],
      }),
    );
  }
  const savedSeeds = process.env.BENCH_EXPECT_SEEDS;
  const savedPhase = process.env.BENCH_EXPECT_PHASE;
  process.env.BENCH_EXPECT_SEEDS = "1";
  process.env.BENCH_EXPECT_PHASE = "fase4";
  try {
    const aggregate = runAggregate([gateFixtureDir]);
    assert(aggregate.exitCode === 1, "real aggregate gate must fail settled empty-store fixture");
    assert(
      aggregate.markdown.includes("Memory subsystem stored zero facts despite"),
      "real aggregate gate must report settled empty-store fixture",
    );
  } finally {
    if (savedSeeds === undefined) delete process.env.BENCH_EXPECT_SEEDS;
    else process.env.BENCH_EXPECT_SEEDS = savedSeeds;
    if (savedPhase === undefined) delete process.env.BENCH_EXPECT_PHASE;
    else process.env.BENCH_EXPECT_PHASE = savedPhase;
    rmSync(gateFixtureDir, { recursive: true, force: true });
  }
  console.log("  ✓ real aggregate gate uses settled rows");

  console.log("✓ Memory enabled/disabled gate works in both directions");
}

async function test7_settledLineIsAuthoritative() {
  console.log("\nTest 7: line variants and settled memory state are truthful");

  const modPath = resolveBuilt("memoryTelemetry.js");
  const { formatMemoryLine } = await import(pathToFileURL(modPath).href);
  const base = {
    memoryEnabled: 1,
    factsExtracted: 4,
    factsStored: 2,
    factsRejectedSensitive: 1,
    factsRejectedFull: 1,
    factsInjected: 3,
    totalFactsInStore: 9,
    extractParseOutcome: 1,
    extractGateSource: 1,
    extractStopReason: 0,
  };

  // The turn-end line is before extraction: all extraction fields are N/A,
  // never zero (zero would falsely mean a settled empty extraction).
  const turnLine = formatMemoryLine({
    ...base,
    factsExtracted: -1,
    factsStored: -1,
    factsRejectedSensitive: -1,
    factsRejectedFull: -1,
    totalFactsInStore: -1,
    extractParseOutcome: -1,
    extractGateSource: -1,
    extractStopReason: -1,
  });
  const turn = JSON.parse(turnLine.substring("KALSA_MEMORY ".length));
  for (const field of ["factsExtracted", "factsStored", "factsRejectedSensitive", "factsRejectedFull", "totalFactsInStore", "extractParseOutcome", "extractGateSource", "extractStopReason"]) {
    assert(turn[field] === -1, `Turn-end ${field} must be the -1 N/A sentinel`);
  }
  assert(turn.factsInjected === 3, "Turn-end line must retain the turn-owned injection count");

  // Settled line carries truthful enabled state in both directions and marks
  // the turn-owned injection count N/A.
  for (const enabled of [1, 0]) {
    const line = formatMemoryLine({ ...base, memoryEnabled: enabled, factsInjected: -1 }, "KALSA_MEMORY_EXTRACT");
    const parsed = JSON.parse(line.substring("KALSA_MEMORY_EXTRACT ".length));
    assert(parsed.memoryEnabled === enabled, `Settled memoryEnabled must be ${enabled}`);
    assert(parsed.factsInjected === -1, "Settled factsInjected must be N/A");
  }
  for (const reason of [0, 1, 2, 3, 4]) {
    const line = formatMemoryLine({ ...base, extractStopReason: reason }, "KALSA_MEMORY_EXTRACT");
    const parsed = JSON.parse(line.substring("KALSA_MEMORY_EXTRACT ".length));
    assert(parsed.extractStopReason === reason, `Settled stop reason ${reason} must survive`);
  }

  const appShell = readFileSync(path.join(projectRoot, "src/app/AppShell.tsx"), "utf8");
  const settledHelper = appShell.slice(
    appShell.indexOf("const emitSettledMemoryTelemetry"),
    appShell.indexOf("const armMemoryExtract"),
  );
  assert(
    settledHelper.includes("MemoryStore.trackMemoryEnabled(settledMemoryEnabled)"),
    "Extract job must re-track memoryEnabled before settled snapshot",
  );
  assert(
    settledHelper.includes("MemoryStore.trackMemoryStoreSize(settledFacts.length)"),
    "Extract job must re-track totalFactsInStore before settled snapshot",
  );
  assert(
    /catch \{\s*MemoryStore\.trackMemoryParseOutcome\(3\);/.test(appShell),
    "AppShell catch must record extractParseOutcome 3",
  );
  for (const reason of [0, 1, 2, 3, 4]) {
    assert(
      appShell.includes(`MemoryStore.trackMemoryExtractStopReason(${reason});`),
      `AppShell must record extractStopReason ${reason}`,
    );
  }
  const resetIndex = appShell.indexOf("const turnTelemetry = MemoryStore.getAndResetMemoryTelemetry();");
  const turnBlock = appShell.slice(resetIndex, appShell.indexOf("console.log(formatMemoryLine(memTelemetry));", resetIndex));
  assert(
    (turnBlock.match(/extractParseOutcome: MemoryStore\.MEMORY_TELEMETRY_NOT_APPLICABLE/g) ?? []).length === 1,
    "Turn-end parse outcome must use the N/A sentinel",
  );

  console.log("✓ Settled line is authoritative; both memory states and N/A turn fields are covered");
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
  await test7_settledLineIsAuthoritative();

  console.log("\n✅ All memory telemetry harness tests passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌ Memory telemetry harness failed:", err.message);
  process.exit(1);
});
