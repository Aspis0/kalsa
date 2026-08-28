/**
 * Harness for toolCallTelemetry clamp (privacy-safe tool name logging).
 *
 * Tests that formatToolCallLine clamps tool names to the known set,
 * replacing arbitrary model-invented strings with a fixed placeholder.
 *
 * The clamp function (clampToolNames) is compiled from the REAL
 * src/engine/toolCallTelemetry.ts — the same module LlamaService.ts calls.
 * A mutation there turns this harness red. No re-implementation copies.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

// Dedicated, wiped-on-every-run outDir. The shared scripts/.build is NOT safe:
// toolCallTelemetry.ts lives under src/engine/, so tsc's common root is src/
// and output lands in <outDir>/engine/*.js. Wipe first, resolve second.
const outDir = path.join(projectRoot, "scripts/.build/telemetryClampHarness");

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/engine/toolCallTelemetry.ts",
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

function resolveBuilt(name) {
  const candidates = [
    path.join(outDir, "engine", name),
    path.join(outDir, name),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(`Cannot resolve built ${name} in ${outDir}`);
}

function loadModule() {
  const telemetryPath = resolveBuilt("toolCallTelemetry.js");
  const telemetryUrl = pathToFileURL(telemetryPath).href;
  return import(telemetryUrl);
}

// Compile and load
compile();
const telemetryModule = await loadModule();
const { clampToolNames, formatToolCallLine } = telemetryModule;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`✗ ${name}`);
    console.error(`  ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

function assertDeepEquals(actual, expected, message) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(message || `Expected ${expectedStr}, got ${actualStr}`);
  }
}

// ── clampToolNames tests ─────────────────────────────────────────────────────

test("clampToolNames: three real names pass through unchanged", () => {
  const input = ["web_search", "web_fetch", "document_chat"];
  const output = clampToolNames(input);
  assertDeepEquals(output, input, "Real names should pass through");
});

test("clampToolNames: arbitrary model-invented name becomes placeholder", () => {
  const input = ["cerca_il_gatto_di_marco"];
  const output = clampToolNames(input);
  assertDeepEquals(output, ["other"], "Unknown name should become 'other'");
  assert(
    !output.includes("cerca_il_gatto_di_marco"),
    "Original string must not appear in output"
  );
});

test("clampToolNames: count is preserved", () => {
  const input = ["web_search", "cerca_il_gatto_di_marco", "web_fetch"];
  const output = clampToolNames(input);
  assertEquals(output.length, input.length, "Count must be preserved");
  assertDeepEquals(
    output,
    ["web_search", "other", "web_fetch"],
    "Real names pass, unknown becomes 'other'"
  );
});

test("clampToolNames: multiple unknown names all become placeholder", () => {
  const input = ["unknown_tool_1", "unknown_tool_2", "web_search"];
  const output = clampToolNames(input);
  assertDeepEquals(
    output,
    ["other", "other", "web_search"],
    "Multiple unknowns become multiple placeholders"
  );
});

test("clampToolNames: empty array returns empty array", () => {
  const output = clampToolNames([]);
  assertDeepEquals(output, [], "Empty input should return empty output");
});

test("clampToolNames: non-array input returns empty array", () => {
  const output = clampToolNames(null);
  assertDeepEquals(output, [], "null should return empty array");
  const output2 = clampToolNames(undefined);
  assertDeepEquals(output2, [], "undefined should return empty array");
});

// ── formatToolCallLine tests ─────────────────────────────────────────────────

test("formatToolCallLine: clamps toolNames in output", () => {
  const turnId = "test_turn";
  const telemetry = {
    round: 1,
    toolChoice: "auto",
    structuredCalls: 2,
    fallbackCalls: 0,
    fallbackDialect: "none",
    executed: 2,
    skippedCap: 0,
    skippedDup: 0,
    skippedFailedRepeat: 0,
    failed: 0,
    blockedPrivacy: 0,
    namesValid: false,
    argsParsed: true,
    toolNames: ["web_search", "cerca_il_gatto_di_marco"],
  };

  const line = formatToolCallLine(turnId, telemetry);

  // The original string must NOT appear in the formatted line
  assert(
    !line.includes("cerca_il_gatto_di_marco"),
    "Original unknown name must not appear in formatted line"
  );

  // The placeholder should appear
  assert(line.includes('"other"'), "Placeholder 'other' should appear in output");

  // Real name should still be there
  assert(line.includes('"web_search"'), "Real tool name should pass through");

  // Parse the JSON to verify structure
  const match = line.match(/KALSA_TOOLCALL\s+(.+)/);
  assert(match, "Line should start with KALSA_TOOLCALL");
  const parsed = JSON.parse(match[1]);
  assertDeepEquals(
    parsed.toolNames,
    ["web_search", "other"],
    "Parsed toolNames should be clamped"
  );
});

test("formatToolCallLine: three real tools remain distinguishable for selection grading", () => {
  const turnId = "test_turn";
  const telemetry = {
    round: 1,
    toolChoice: "auto",
    structuredCalls: 1,
    fallbackCalls: 0,
    fallbackDialect: "none",
    executed: 1,
    skippedCap: 0,
    skippedDup: 0,
    skippedFailedRepeat: 0,
    failed: 0,
    blockedPrivacy: 0,
    namesValid: true,
    argsParsed: true,
    toolNames: ["web_search"],
  };

  const line = formatToolCallLine(turnId, telemetry);
  const match = line.match(/KALSA_TOOLCALL\s+(.+)/);
  const parsed = JSON.parse(match[1]);

  // Selection grading needs to distinguish the three real tools
  assert(parsed.toolNames.includes("web_search"), "web_search should be present");
  assert(!parsed.toolNames.includes("web_fetch"), "web_fetch should not be present");
  assert(!parsed.toolNames.includes("document_chat"), "document_chat should not be present");

  // Now test with web_fetch
  telemetry.toolNames = ["web_fetch"];
  const line2 = formatToolCallLine(turnId, telemetry);
  const parsed2 = JSON.parse(line2.match(/KALSA_TOOLCALL\s+(.+)/)[1]);
  assert(parsed2.toolNames.includes("web_fetch"), "web_fetch should be distinguishable");

  // Now test with document_chat
  telemetry.toolNames = ["document_chat"];
  const line3 = formatToolCallLine(turnId, telemetry);
  const parsed3 = JSON.parse(line3.match(/KALSA_TOOLCALL\s+(.+)/)[1]);
  assert(parsed3.toolNames.includes("document_chat"), "document_chat should be distinguishable");
});

test("formatToolCallLine: leak assertion — user-like text never reaches log", () => {
  const turnId = "test_turn";
  // Simulate a model hallucinating a tool name derived from user text
  const userLikeText = "cerca_il_gatto_di_marco_che_gioca_a_pallone";
  const telemetry = {
    round: 1,
    toolChoice: "auto",
    structuredCalls: 1,
    fallbackCalls: 0,
    fallbackDialect: "none",
    executed: 1,
    skippedCap: 0,
    skippedDup: 0,
    skippedFailedRepeat: 0,
    failed: 0,
    blockedPrivacy: 0,
    namesValid: false,
    argsParsed: true,
    toolNames: [userLikeText],
  };

  const line = formatToolCallLine(turnId, telemetry);

  // CRITICAL LEAK ASSERTION: the original string must NEVER appear in the log
  assert(
    !line.includes(userLikeText),
    `LEAK DETECTED: user-like text "${userLikeText}" appeared in formatted line`
  );

  // The placeholder should appear instead
  assert(line.includes('"other"'), "Placeholder should replace leaked content");
});

// ── Summary ─────────────────────────────────────────────────────────────────

console.log("");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
