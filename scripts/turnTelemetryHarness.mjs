/**
 * Harness for src/engine/turnTelemetry.ts (per-turn performance telemetry).
 *
 * Covers:
 *  - stable KALSA_TELEMETRY prefix
 *  - JSON round-trip of { turnId, ...RoundTelemetry }
 *  - exact key set (no user text / surprise keys)
 *  - -1 timing defaults serialize as -1
 *  - roundTelemetryFromResult missing-field defaults
 *
 * Compile-from-disk pattern (same as streamCoalescerHarness). Exit 1 on fail.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function compile() {
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/engine/turnTelemetry.ts",
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
    path.join(projectRoot, "scripts/.build/turnTelemetry.js"),
    path.join(projectRoot, "scripts/.build/engine/turnTelemetry.js"),
    path.join(projectRoot, "scripts/.build/src/engine/turnTelemetry.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error("Could not find compiled turnTelemetry.js. Tried:\n", candidates.join("\n"));
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const EXPECTED_KEYS = [
  "turnId",
  "round",
  "tokensCached",
  "tokensEvaluated",
  "tokensPredicted",
  "draftTokens",
  "draftAccepted",
  "promptMs",
  "predictedMs",
  "predictedPerSecond",
  "contextFull",
  "interrupted",
].sort();

async function main() {
  console.log("Compiling turnTelemetry.ts …");
  compile();
  const modPath = resolveBuilt();
  console.log("Loading", modPath);
  const { formatTelemetryLine, roundTelemetryFromResult } = await import(
    pathToFileURL(modPath).href
  );

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  OK  ${name}`);
      passed += 1;
    } catch (err) {
      console.error(`  FAIL ${name}: ${err instanceof Error ? err.message : err}`);
      failed += 1;
    }
  }

  const sample = {
    round: 1,
    tokensCached: 100,
    tokensEvaluated: 120,
    tokensPredicted: 45,
    draftTokens: 8,
    draftAccepted: 6,
    promptMs: 12.5,
    predictedMs: 300,
    predictedPerSecond: 15,
    contextFull: false,
    interrupted: false,
  };

  // ── 1. Prefix ──────────────────────────────────────────────────────────
  test("prefix is KALSA_TELEMETRY (exact, single space)", () => {
    const line = formatTelemetryLine("1", sample);
    assert(line.startsWith("KALSA_TELEMETRY "), `expected prefix, got: ${line.slice(0, 40)}`);
    assert(
      line.indexOf("KALSA_TELEMETRY ") === 0,
      "prefix must start at index 0",
    );
    // Exactly one space after the token.
    assert(line[16] !== " ", "must be exactly one space after KALSA_TELEMETRY");
  });

  // ── 2. JSON round-trip ─────────────────────────────────────────────────
  test("JSON round-trip equals { turnId, ...r }", () => {
    const line = formatTelemetryLine("turn-42", sample);
    const json = line.slice("KALSA_TELEMETRY ".length);
    const parsed = JSON.parse(json);
    assert(
      JSON.stringify(parsed) === JSON.stringify({ turnId: "turn-42", ...sample }),
      `payload mismatch: ${json}`,
    );
  });

  // ── 3. No extra fields (base sample has no optional tool/strategy) ─────
  test("payload keys are exactly the expected set", () => {
    const line = formatTelemetryLine("2", sample);
    const parsed = JSON.parse(line.slice("KALSA_TELEMETRY ".length));
    const keys = Object.keys(parsed).sort();
    assert(
      JSON.stringify(keys) === JSON.stringify(EXPECTED_KEYS),
      `unexpected keys: ${JSON.stringify(keys)}`,
    );
  });

  // ── 3b. Optional tool/strategy fields (document_chat telemetry) ────────
  test("optional tool + strategy fields serialize when present", () => {
    const withTool = {
      ...sample,
      tool: "document_chat",
      strategy: "hybrid",
    };
    const line = formatTelemetryLine("tool-1", withTool);
    const parsed = JSON.parse(line.slice("KALSA_TELEMETRY ".length));
    assert(parsed.tool === "document_chat", `tool expected document_chat, got ${parsed.tool}`);
    assert(parsed.strategy === "hybrid", `strategy expected hybrid, got ${parsed.strategy}`);
    // Base keys still present.
    for (const k of EXPECTED_KEYS) {
      assert(k in parsed, `missing base key ${k}`);
    }
  });

  // ── 4. -1 timing defaults serialize as -1 ──────────────────────────────
  test("handles -1 timing defaults (not null/undefined)", () => {
    const withMissingTimings = {
      ...sample,
      promptMs: -1,
      predictedMs: -1,
      predictedPerSecond: -1,
    };
    const line = formatTelemetryLine("3", withMissingTimings);
    const parsed = JSON.parse(line.slice("KALSA_TELEMETRY ".length));
    assert(parsed.promptMs === -1, `promptMs expected -1, got ${parsed.promptMs}`);
    assert(parsed.predictedMs === -1, `predictedMs expected -1, got ${parsed.predictedMs}`);
    assert(
      parsed.predictedPerSecond === -1,
      `predictedPerSecond expected -1, got ${parsed.predictedPerSecond}`,
    );
    assert(!("content" in parsed), "must not include content");
    assert(!("text" in parsed), "must not include text");
  });

  // ── 5. roundTelemetryFromResult defaults ───────────────────────────────
  test("roundTelemetryFromResult: missing timings → -1, draft → 0, bools → false", () => {
    assert(typeof roundTelemetryFromResult === "function", "roundTelemetryFromResult not exported");
    const r = roundTelemetryFromResult({}, 0);
    assert(r.round === 0, `round expected 0, got ${r.round}`);
    assert(r.tokensCached === 0, `tokensCached expected 0, got ${r.tokensCached}`);
    assert(r.tokensEvaluated === 0, `tokensEvaluated expected 0, got ${r.tokensEvaluated}`);
    assert(r.tokensPredicted === 0, `tokensPredicted expected 0, got ${r.tokensPredicted}`);
    assert(r.draftTokens === 0, `draftTokens expected 0, got ${r.draftTokens}`);
    assert(r.draftAccepted === 0, `draftAccepted expected 0, got ${r.draftAccepted}`);
    assert(r.promptMs === -1, `promptMs expected -1, got ${r.promptMs}`);
    assert(r.predictedMs === -1, `predictedMs expected -1, got ${r.predictedMs}`);
    assert(r.predictedPerSecond === -1, `predictedPerSecond expected -1, got ${r.predictedPerSecond}`);
    assert(r.contextFull === false, `contextFull expected false, got ${r.contextFull}`);
    assert(r.interrupted === false, `interrupted expected false, got ${r.interrupted}`);
  });

  test("roundTelemetryFromResult: maps real field names", () => {
    const r = roundTelemetryFromResult(
      {
        tokens_cached: 10,
        tokens_evaluated: 20,
        tokens_predicted: 30,
        draft_tokens: 4,
        draft_tokens_accepted: 3,
        context_full: true,
        interrupted: true,
        timings: {
          prompt_ms: 1.5,
          predicted_ms: 2.5,
          predicted_per_second: 9.9,
        },
      },
      2,
    );
    assert(r.round === 2, `round expected 2, got ${r.round}`);
    assert(r.tokensCached === 10, `tokensCached expected 10, got ${r.tokensCached}`);
    assert(r.tokensEvaluated === 20, `tokensEvaluated expected 20, got ${r.tokensEvaluated}`);
    assert(r.tokensPredicted === 30, `tokensPredicted expected 30, got ${r.tokensPredicted}`);
    assert(r.draftTokens === 4, `draftTokens expected 4, got ${r.draftTokens}`);
    assert(r.draftAccepted === 3, `draftAccepted expected 3, got ${r.draftAccepted}`);
    assert(r.promptMs === 1.5, `promptMs expected 1.5, got ${r.promptMs}`);
    assert(r.predictedMs === 2.5, `predictedMs expected 2.5, got ${r.predictedMs}`);
    assert(r.predictedPerSecond === 9.9, `predictedPerSecond expected 9.9, got ${r.predictedPerSecond}`);
    assert(r.contextFull === true, `contextFull expected true, got ${r.contextFull}`);
    assert(r.interrupted === true, `interrupted expected true, got ${r.interrupted}`);
  });

  test("roundTelemetryFromResult: null timings → -1", () => {
    const r = roundTelemetryFromResult({ timings: null, tokens_cached: 5 }, 1);
    assert(r.tokensCached === 5, `tokensCached expected 5, got ${r.tokensCached}`);
    assert(r.promptMs === -1, `promptMs expected -1 with null timings, got ${r.promptMs}`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("All turnTelemetry harness cases passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
