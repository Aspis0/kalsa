#!/usr/bin/env node
/**
 * Smoke must mirror the fase4 campaign matrix in .github/workflows/bench.yml.
 *
 * Three times a smoke de-risked a config the campaign does not run
 * (a78f126 thinking, 4ab91a8 families, fase4 toolchoice arms with no twin).
 * This harness fails the build when the two matrices drift.
 *
 * Fase0 is out of scope and ignored. Zero npm deps: the include block is a
 * flat list of maps; a full YAML library is not declared in package.json
 * (yaml/js-yaml exist only as transitives — not load-bearing).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const BENCH_YML = path.join(projectRoot, ".github/workflows/bench.yml");

const AXES = ["compaction", "toolchoice", "toolgate", "block_format", "thinking"];
const EXPECTED_ARMS = ["baseline", "v42", "ciswire", "nogate"];
const EXPECTED_AXES = {
  baseline: { compaction: "off", block_format: "none", thinking: "off" },
  v42: { compaction: "on", block_format: "none", thinking: "off" },
  ciswire: { compaction: "ciswire", block_format: "none", thinking: "off" },
  nogate: {
    compaction: "off",
    block_format: "none",
    thinking: "off",
    toolgate: "0",
  },
};

let passed = 0;
let failed = 0;

function check(name, cond, detail = "") {
  if (cond) {
    console.log(`PASS  ${name}`);
    passed += 1;
  } else {
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failed += 1;
  }
}

function unquote(s) {
  const t = String(s ?? "").trim();
  if (t.length >= 2) {
    const a = t[0];
    const b = t[t.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) {
      return t.slice(1, -1);
    }
  }
  return t;
}

/**
 * Extract `strategy.matrix.include` entries from a GitHub Actions workflow.
 *
 * Not a YAML parser. This file's include items are:
 *   - phase: <scalar>
 *     key: <scalar>
 * Comments, blanks, and quoted/unquoted scalars only. Nested maps, multiline
 * strings, and flow-style lists are out of scope — bench.yml does not use
 * them inside include. First `matrix:` / `include:` nest wins (one job).
 */
function parseMatrixInclude(text) {
  const entries = [];
  let inInclude = false;
  let includeIndent = -1;
  let itemIndent = -1;
  let seenMatrix = false;
  let current = null;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const indent = line.match(/^ */)[0].length;
    const content = line.slice(indent);

    if (!inInclude) {
      if (/^matrix:\s*$/.test(content)) {
        seenMatrix = true;
        continue;
      }
      if (seenMatrix && /^include:\s*$/.test(content)) {
        inInclude = true;
        includeIndent = indent;
      }
      continue;
    }

    if (indent <= includeIndent) break;

    const item = content.match(/^- (\w+):\s*(.*?)\s*$/);
    if (item && (itemIndent < 0 || indent === itemIndent)) {
      current = { [item[1]]: unquote(item[2]) };
      entries.push(current);
      itemIndent = indent;
      continue;
    }

    const kv = content.match(/^(\w+):\s*(.*?)\s*$/);
    if (kv && current && indent > itemIndent) {
      current[kv[1]] = unquote(kv[2]);
    }
  }
  return entries;
}

function axisRecord(entry) {
  const rec = {};
  for (const k of AXES) {
    if (Object.prototype.hasOwnProperty.call(entry, k)) rec[k] = entry[k];
  }
  return rec;
}

function axesEqual(a, b) {
  for (const k of AXES) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/** Distinct arms for one phase. Conflicting axis values on the same arm fail. */
function distinctArms(entries, phase) {
  const map = new Map();
  const failures = [];
  for (const e of entries) {
    if (e.phase !== phase) continue;
    const arm = e.arm;
    if (arm == null || arm === "") continue;
    const axes = axisRecord(e);
    if (!map.has(arm)) {
      map.set(arm, axes);
      continue;
    }
    const prev = map.get(arm);
    for (const k of AXES) {
      if (prev[k] !== axes[k]) {
        failures.push(
          `arm '${arm}' field '${k}' conflicts within ${phase}: ${fmt(prev[k])} vs ${fmt(axes[k])}`,
        );
      }
    }
  }
  return { map, failures };
}

function fmt(v) {
  return v === undefined ? "(absent)" : JSON.stringify(v);
}

/**
 * Fase0 is excluded explicitly. Every distinct fase4 arm needs a smoke twin
 * with the same axis values; a smoke-only arm is also a failure.
 */
function checkParity(entries) {
  const failures = [];
  const fase4 = distinctArms(entries, "fase4");
  const smoke = distinctArms(entries, "smoke");
  failures.push(...fase4.failures, ...smoke.failures);

  for (const [arm, axes] of fase4.map) {
    if (!smoke.map.has(arm)) {
      failures.push(`fase4 arm '${arm}' has no smoke twin`);
      continue;
    }
    const s = smoke.map.get(arm);
    for (const k of AXES) {
      if (axes[k] !== s[k]) {
        failures.push(
          `arm '${arm}' field '${k}' differs: fase4=${fmt(axes[k])} smoke=${fmt(s[k])}`,
        );
      }
    }
  }
  for (const arm of smoke.map.keys()) {
    if (!fase4.map.has(arm)) {
      failures.push(`smoke arm '${arm}' has no fase4 counterpart`);
    }
  }
  return failures;
}

function yamlFromRows(rows) {
  const lines = [
    "jobs:",
    "  bench:",
    "    strategy:",
    "      matrix:",
    "        include:",
  ];
  for (const row of rows) {
    const keys = Object.keys(row);
    lines.push(`          - phase: ${JSON.stringify(String(row.phase))}`);
    for (const k of keys) {
      if (k === "phase") continue;
      lines.push(`            ${k}: ${JSON.stringify(String(row[k]))}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function matchedPair(arm, extra = {}) {
  return {
    compaction: "off",
    block_format: "none",
    thinking: "off",
    ...extra,
    arm,
  };
}

function main() {
  const matched = [
    { phase: "fase4", seed: "1", ...matchedPair("baseline") },
    { phase: "fase4", seed: "2", ...matchedPair("baseline") },
    { phase: "smoke", seed: "1", ...matchedPair("baseline") },
  ];
  const fMatch = checkParity(parseMatrixInclude(yamlFromRows(matched)));
  check(
    "matched campaign/smoke pairs pass",
    fMatch.length === 0,
    fMatch.join("; "),
  );

  const noTwin = [
    { phase: "fase4", ...matchedPair("baseline") },
    { phase: "fase4", ...matchedPair("nogate", { toolgate: "0" }) },
    { phase: "smoke", ...matchedPair("baseline") },
  ];
  const fNoTwin = checkParity(parseMatrixInclude(yamlFromRows(noTwin)));
  check(
    "fase4 arm with no smoke twin fails naming the arm",
    fNoTwin.some((m) => /fase4 arm 'nogate' has no smoke twin/.test(m)),
    fNoTwin.join("; "),
  );

  const thinkDiff = [
    { phase: "fase4", ...matchedPair("baseline", { thinking: "off" }) },
    {
      phase: "smoke",
      ...matchedPair("baseline", { thinking: "budget256" }),
    },
  ];
  const fThink = checkParity(parseMatrixInclude(yamlFromRows(thinkDiff)));
  check(
    "thinking mismatch fails naming the field",
    fThink.some((m) => /arm 'baseline' field 'thinking' differs/.test(m)),
    fThink.join("; "),
  );

  const smokeOnly = [
    { phase: "fase4", ...matchedPair("baseline") },
    { phase: "smoke", ...matchedPair("baseline") },
    { phase: "smoke", ...matchedPair("forcing") },
  ];
  const fSmoke = checkParity(parseMatrixInclude(yamlFromRows(smokeOnly)));
  check(
    "smoke-only arm fails",
    fSmoke.some((m) => /smoke arm 'forcing' has no fase4 counterpart/.test(m)),
    fSmoke.join("; "),
  );

  const withFase0 = [
    { phase: "fase0", arm: "none_off", block_format: "none", thinking: "off" },
    { phase: "fase4", ...matchedPair("baseline") },
    { phase: "smoke", ...matchedPair("baseline") },
  ];
  const fF0 = checkParity(parseMatrixInclude(yamlFromRows(withFase0)));
  check("fase0 entries ignored", fF0.length === 0, fF0.join("; "));

  const realText = readFileSync(BENCH_YML, "utf8");
  const realEntries = parseMatrixInclude(realText);
  const fase4 = distinctArms(realEntries, "fase4");
  const smoke = distinctArms(realEntries, "smoke");
  const fase4Names = [...fase4.map.keys()].sort();
  const smokeNames = [...smoke.map.keys()].sort();
  const expected = [...EXPECTED_ARMS].sort();
  const axesOk =
    expected.every((arm) => {
      const want = EXPECTED_AXES[arm];
      return (
        fase4.map.has(arm) &&
        smoke.map.has(arm) &&
        axesEqual(fase4.map.get(arm), want) &&
        axesEqual(smoke.map.get(arm), want)
      );
    }) &&
    fase4Names.join(",") === expected.join(",") &&
    smokeNames.join(",") === expected.join(",");
  check(
    "parses current bench.yml into expected arm set",
    axesOk,
    `fase4=${fase4Names.join(",")} smoke=${smokeNames.join(",")}`,
  );

  const realFail = checkParity(realEntries);
  check(
    "real bench.yml passes",
    realFail.length === 0 && axesOk,
    realFail.join("; "),
  );

  console.log("");
  console.log(
    `=== OVERALL: ${failed === 0 ? "PASS" : "FAIL"} (${passed} passed, ${failed} failed) ===`,
  );
  if (failed > 0) process.exit(1);
}

main();
