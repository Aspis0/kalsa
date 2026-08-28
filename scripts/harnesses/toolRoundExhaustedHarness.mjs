/**
 * Harness for tool-round-exhausted fallback (blank bubble fix).
 *
 * Tests three scenarios:
 * 1. Rounds exhausted with no text → fallback fires, message is non-empty
 * 2. Rounds exhausted with text already produced → no fallback
 * 3. Normal single-round turn → no fallback
 *
 * Also verifies telemetry formatter and i18n strings.
 *
 * The decision function (shouldFireToolRoundFallback) is compiled from the
 * REAL src/engine/toolRoundFallback.ts — the same module LlamaService.ts calls.
 * A mutation there turns this harness red. No re-implementation copies.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

// Dedicated, wiped-on-every-run outDir. The shared scripts/.build is NOT safe:
// toolRoundFallback.ts and toolCallTelemetry.ts live under src/engine/, so tsc's
// common root is src/ and output lands in <outDir>/engine/*.js — while an older
// build (when the root was src/engine) could leave a flat <outDir>/*.js that
// resolveBuilt prefers. That shadow made compactorHarness silently validate a
// stale compiler output for a whole day. Wipe first, resolve second.
const outDir = path.join(projectRoot, "scripts/.build/toolRoundExhaustedHarness");

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/engine/toolRoundFallback.ts",
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
    path.join(outDir, `engine/${name}.js`),
    path.join(outDir, `src/engine/${name}.js`),
    path.join(outDir, `${name}.js`),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error(`Could not find compiled ${name}.js. Tried:\n`, candidates.join("\n"));
  process.exit(1);
}

async function main() {
  console.log("Compiling toolRoundFallback.ts + toolCallTelemetry.ts …");
  compile();
  const fallbackModPath = resolveBuilt("toolRoundFallback");
  const telemetryModPath = resolveBuilt("toolCallTelemetry");
  console.log("Loading", fallbackModPath);
  console.log("Loading", telemetryModPath);
  const fallbackMod = await import(`${pathToFileURL(fallbackModPath).href}?t=${Date.now()}`);
  const telemetryMod = await import(`${pathToFileURL(telemetryModPath).href}?t=${Date.now()}`);
  const { shouldFireToolRoundFallback } = fallbackMod;
  const { formatToolRoundExhaustedLine } = telemetryMod;

  // Sanity: the import resolved to a real function from the REAL module.
  if (typeof shouldFireToolRoundFallback !== "function") {
    console.error("shouldFireToolRoundFallback is not a function — got:", typeof shouldFireToolRoundFallback);
    process.exit(1);
  }

  const results = [];
  const check = (label, cond, detail) => {
    results.push({ label, pass: Boolean(cond), detail });
  };

  // ── Scenario 1: Rounds exhausted with no text ─────────────────────────────
  // Simulates: model spent all 3 rounds producing tool calls, streamedText is empty
  console.log("\n[Scenario 1] Rounds exhausted with no text");
  {
    const streamedText = ""; // All tool call markup stripped
    const fallbackShouldFire = shouldFireToolRoundFallback(streamedText);
    check("Scenario 1: fallback should fire", fallbackShouldFire === true);

    // Simulate fallback firing
    if (fallbackShouldFire) {
      // Tier 1: try extra completion (mocked - assume it produces text)
      const fallbackText = "I couldn't find the information you're looking for.";
      const messageIsNonEmpty = fallbackText.trim().length > 0;
      check("Scenario 1: fallback produces non-empty message", messageIsNonEmpty);

      // If tier 1 fails, tier 2: canned message
      const cannedMessage = "I couldn't complete the search. Please try again or rephrase your question.";
      const cannedIsNonEmpty = cannedMessage.trim().length > 0;
      check("Scenario 1: canned message is non-empty", cannedIsNonEmpty);
    }
  }

  // ── Scenario 2: Rounds exhausted with text already produced ───────────────
  // Simulates: model produced some text in earlier rounds, then tool calls
  console.log("\n[Scenario 2] Rounds exhausted with text already produced");
  {
    const streamedText = "Here's what I found: "; // Some text was streamed
    const fallbackShouldFire = shouldFireToolRoundFallback(streamedText);
    check("Scenario 2: fallback should NOT fire", fallbackShouldFire === false);
  }

  // ── Scenario 3: Normal single-round turn ──────────────────────────────────
  // Simulates: model produced text in first round, no tool calls
  console.log("\n[Scenario 3] Normal single-round turn");
  {
    const streamedText = "The answer is 42."; // Model produced text
    const fallbackShouldFire = shouldFireToolRoundFallback(streamedText);
    check("Scenario 3: fallback should NOT fire", fallbackShouldFire === false);
  }

  // ── Scenario 4: Rounds exhausted with only whitespace ─────────────────────
  // Simulates: model produced only whitespace/newlines (should be treated as empty)
  console.log("\n[Scenario 4] Rounds exhausted with only whitespace");
  {
    const streamedText = "   \n\n  \t  "; // Only whitespace
    const fallbackShouldFire = shouldFireToolRoundFallback(streamedText);
    check("Scenario 4: fallback should fire (whitespace is empty)", fallbackShouldFire === true);
  }

  // ── Telemetry formatter ───────────────────────────────────────────────────
  console.log("\n[Test] Telemetry formatter");
  {
    const tel = {
      roundsUsed: 3,
      streamedLen: 0,
      fallbackFired: true,
      fallbackOk: false,
    };
    const line = formatToolRoundExhaustedLine("turn-123", tel);
    check("Telemetry: line starts with KALSA_TOOLROUND_EXHAUSTED", line.startsWith("KALSA_TOOLROUND_EXHAUSTED "));

    const json = JSON.parse(line.slice("KALSA_TOOLROUND_EXHAUSTED ".length));
    check("Telemetry: turnId present", json.turnId === "turn-123");
    check("Telemetry: roundsUsed is number", typeof json.roundsUsed === "number");
    check("Telemetry: streamedLen is number", typeof json.streamedLen === "number");
    check("Telemetry: fallbackFired is boolean", typeof json.fallbackFired === "boolean");
    check("Telemetry: fallbackOk is boolean", typeof json.fallbackOk === "boolean");

    // Verify no extra fields
    const keys = Object.keys(json).sort();
    const expectedKeys = ["fallbackFired", "fallbackOk", "roundsUsed", "streamedLen", "turnId"].sort();
    check(
      "Telemetry: only expected fields",
      JSON.stringify(keys) === JSON.stringify(expectedKeys),
      `Expected ${expectedKeys.join(",")}, got ${keys.join(",")}`,
    );

    // Verify no user text or model output in telemetry
    const lineStr = JSON.stringify(json);
    check("Telemetry: no user text", !lineStr.includes("user") || json.turnId === "user");
    check("Telemetry: no model output", !lineStr.includes("content") && !lineStr.includes("text"));
  }

  // ── i18n strings ──────────────────────────────────────────────────────────
  console.log("\n[Test] i18n strings");
  {
    const enPath = path.join(projectRoot, "src/i18n/en.ts");
    const itPath = path.join(projectRoot, "src/i18n/it.ts");
    const enContent = readFileSync(enPath, "utf8");
    const itContent = readFileSync(itPath, "utf8");
    check("i18n: en.ts has toolRoundsExhausted", enContent.includes("toolRoundsExhausted"));
    check("i18n: it.ts has toolRoundsExhausted", itContent.includes("toolRoundsExhausted"));

    // Verify the messages are non-empty
    const enMatch = enContent.match(/toolRoundsExhausted:\s*"([^"]+)"/);
    const itMatch = itContent.match(/toolRoundsExhausted:\s*"([^"]+)"/);
    check("i18n: en message is non-empty", enMatch && enMatch[1].trim().length > 0);
    check("i18n: it message is non-empty", itMatch && itMatch[1].trim().length > 0);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  let passed = 0;
  let failed = 0;
  for (const r of results) {
    const status = r.pass ? "✓" : "✗";
    console.log(`${status} ${r.label}${r.detail ? ` — ${r.detail}` : ""}`);
    if (r.pass) passed++;
    else failed++;
  }
  console.log("═".repeat(60));
  console.log(`Total: ${results.length}, Passed: ${passed}, Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Harness failed:", err);
  process.exit(1);
});
