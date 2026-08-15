#!/usr/bin/env node
/**
 * Smoke must mirror every campaign phase in .github/workflows/bench.yml.
 *
 * Three times a smoke de-risked a config the campaign does not run
 * (a78f126 thinking, 4ab91a8 families, fase4 toolchoice arms with no twin).
 * This harness fails the build when the two matrices drift.
 *
 * Campaign phases are derived structurally from the workflow: a phase is a
 * "campaign" if any arm in it has seed ≥ 2 (repeated measurements for
 * statistical power). Single-seed phases (smoke itself, fase0, tools) are
 * excluded. If a future campaign is added (fase5, emote, …) with multi-seed
 * arms, it is covered automatically. A hardcoded list silently misses the
 * next phase — that is exactly the defect this harness exists to prevent.
 *
 * tools: single arm, single seed — a tool-use validation run selected by its
 * own workflow_dispatch input, not a measurement campaign. Excluded
 * structurally by the seed ≥ 2 rule. An implicit exclusion is how the mem
 * gap appeared; this comment makes the decision explicit.
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

const AXES = ["compaction", "toolchoice", "toolgate", "block_format", "thinking", "memory"];

// Expected arms for each campaign phase
const EXPECTED_FASE4_ARMS = ["baseline", "v42", "ciswire", "nogate"];
const EXPECTED_MEM_ARMS = ["off_off", "off_on", "ciswire_off", "ciswire_on"];
const EXPECTED_SMOKE_ARMS = [...EXPECTED_FASE4_ARMS, ...EXPECTED_MEM_ARMS].sort();

// Expected axis values for each arm
const EXPECTED_AXES = {
  // fase4 arms
  baseline: { compaction: "off", block_format: "none", thinking: "off" },
  v42: { compaction: "on", block_format: "none", thinking: "off" },
  ciswire: { compaction: "ciswire", block_format: "none", thinking: "off" },
  nogate: {
    compaction: "off",
    block_format: "none",
    thinking: "off",
    toolgate: "0",
  },
  // mem arms
  off_off: {
    compaction: "off",
    block_format: "none",
    thinking: "off",
    memory: "0",
  },
  off_on: {
    compaction: "off",
    block_format: "none",
    thinking: "off",
    memory: "1",
  },
  ciswire_off: {
    compaction: "ciswire",
    block_format: "none",
    thinking: "off",
    memory: "0",
  },
  ciswire_on: {
    compaction: "ciswire",
    block_format: "none",
    thinking: "off",
    memory: "1",
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
 * Derive campaign phases structurally: a phase is a "campaign" if any arm
 * in it has seed ≥ 2 (repeated measurements for statistical power).
 * Single-seed phases (smoke itself, fase0, tools) are excluded.
 *
 * Why structural, not literal: if a future campaign is added (fase5, emote, …)
 * with multi-seed arms, it is covered automatically. A hardcoded list
 * silently misses the next phase — that is exactly the defect this harness
 * exists to prevent (three campaigns shipped with unmirrored smokes).
 *
 * tools: single arm, single seed — a tool-use validation run, not a
 * measurement campaign. Excluded structurally by the seed ≥ 2 rule;
 * named here so the exclusion is visible, not implicit.
 */
function checkParity(entries) {
  const failures = [];

  // Derive campaign phases: any phase (except smoke/fase0) with max seed ≥ 2
  const phaseMaxSeed = new Map();
  for (const e of entries) {
    const p = e.phase;
    if (p === "smoke" || p === "fase0") continue;
    const s = e.seed !== undefined ? Number(e.seed) : 1;
    phaseMaxSeed.set(p, Math.max(phaseMaxSeed.get(p) || 0, s));
  }
  const campaignPhases = [...phaseMaxSeed.entries()]
    .filter(([, maxSeed]) => maxSeed >= 2)
    .map(([p]) => p)
    .sort();

  const smoke = distinctArms(entries, "smoke");
  failures.push(...smoke.failures);

  // Track all campaign arms for the "smoke arm has no counterpart" check
  const allCampaignArms = new Map(); // arm -> { phase, axes }

  for (const phase of campaignPhases) {
    const dp = distinctArms(entries, phase);
    failures.push(...dp.failures);

    for (const [arm, axes] of dp.map) {
      allCampaignArms.set(arm, { phase, axes });

      if (!smoke.map.has(arm)) {
        failures.push(`${phase} arm '${arm}' has no smoke twin`);
        continue;
      }
      const s = smoke.map.get(arm);
      for (const k of AXES) {
        if (axes[k] !== s[k]) {
          failures.push(
            `arm '${arm}' field '${k}' differs: ${phase}=${fmt(axes[k])} smoke=${fmt(s[k])}`,
          );
        }
      }
    }
  }

  // Every smoke arm must be the twin of some campaign arm
  for (const arm of smoke.map.keys()) {
    if (!allCampaignArms.has(arm)) {
      failures.push(`smoke arm '${arm}' has no campaign counterpart`);
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
    { phase: "fase4", seed: "1", ...matchedPair("baseline") },
    { phase: "fase4", seed: "2", ...matchedPair("baseline") },
    { phase: "fase4", seed: "1", ...matchedPair("nogate", { toolgate: "0" }) },
    { phase: "fase4", seed: "2", ...matchedPair("nogate", { toolgate: "0" }) },
    { phase: "smoke", seed: "1", ...matchedPair("baseline") },
  ];
  const fNoTwin = checkParity(parseMatrixInclude(yamlFromRows(noTwin)));
  check(
    "fase4 arm with no smoke twin fails naming the arm",
    fNoTwin.some((m) => /fase4 arm 'nogate' has no smoke twin/.test(m)),
    fNoTwin.join("; "),
  );

  const thinkDiff = [
    { phase: "fase4", seed: "1", ...matchedPair("baseline", { thinking: "off" }) },
    { phase: "fase4", seed: "2", ...matchedPair("baseline", { thinking: "off" }) },
    {
      phase: "smoke",
      seed: "1",
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
    { phase: "fase4", seed: "1", ...matchedPair("baseline") },
    { phase: "fase4", seed: "2", ...matchedPair("baseline") },
    { phase: "smoke", seed: "1", ...matchedPair("baseline") },
    { phase: "smoke", seed: "1", ...matchedPair("forcing") },
  ];
  const fSmoke = checkParity(parseMatrixInclude(yamlFromRows(smokeOnly)));
  check(
    "smoke-only arm fails",
    fSmoke.some((m) => /smoke arm 'forcing' has no campaign counterpart/.test(m)),
    fSmoke.join("; "),
  );

  const withFase0 = [
    { phase: "fase0", arm: "none_off", seed: "1", block_format: "none", thinking: "off" },
    { phase: "fase0", arm: "none_off", seed: "2", block_format: "none", thinking: "off" },
    { phase: "fase4", seed: "1", ...matchedPair("baseline") },
    { phase: "fase4", seed: "2", ...matchedPair("baseline") },
    { phase: "smoke", seed: "1", ...matchedPair("baseline") },
  ];
  const fF0 = checkParity(parseMatrixInclude(yamlFromRows(withFase0)));
  check("fase0 entries ignored", fF0.length === 0, fF0.join("; "));

  // Test that mem phase is now covered
  const memNoTwin = [
    { phase: "mem", seed: "1", ...matchedPair("off_off", { memory: "0" }) },
    { phase: "mem", seed: "2", ...matchedPair("off_off", { memory: "0" }) },
    { phase: "mem", seed: "1", ...matchedPair("off_on", { memory: "1" }) },
    { phase: "mem", seed: "2", ...matchedPair("off_on", { memory: "1" }) },
  ];
  const fMemNoTwin = checkParity(parseMatrixInclude(yamlFromRows(memNoTwin)));
  check(
    "mem arm with no smoke twin fails naming the arm",
    fMemNoTwin.some((m) => /mem arm 'off_on' has no smoke twin/.test(m)),
    fMemNoTwin.join("; "),
  );

  const realText = readFileSync(BENCH_YML, "utf8");
  const realEntries = parseMatrixInclude(realText);
  const fase4 = distinctArms(realEntries, "fase4");
  const mem = distinctArms(realEntries, "mem");
  const smoke = distinctArms(realEntries, "smoke");
  const fase4Names = [...fase4.map.keys()].sort();
  const memNames = [...mem.map.keys()].sort();
  const smokeNames = [...smoke.map.keys()].sort();
  const expectedFase4 = [...EXPECTED_FASE4_ARMS].sort();
  const expectedMem = [...EXPECTED_MEM_ARMS].sort();
  const expectedSmoke = [...EXPECTED_SMOKE_ARMS].sort();

  const fase4Ok =
    expectedFase4.every((arm) => {
      const want = EXPECTED_AXES[arm];
      return fase4.map.has(arm) && axesEqual(fase4.map.get(arm), want);
    }) && fase4Names.join(",") === expectedFase4.join(",");

  const memOk =
    expectedMem.every((arm) => {
      const want = EXPECTED_AXES[arm];
      return mem.map.has(arm) && axesEqual(mem.map.get(arm), want);
    }) && memNames.join(",") === expectedMem.join(",");

  const smokeOk =
    expectedSmoke.every((arm) => {
      const want = EXPECTED_AXES[arm];
      return smoke.map.has(arm) && axesEqual(smoke.map.get(arm), want);
    }) && smokeNames.join(",") === expectedSmoke.join(",");

  const axesOk = fase4Ok && memOk && smokeOk;

  check(
    "parses current bench.yml into expected arm set",
    axesOk,
    `fase4=${fase4Names.join(",")} mem=${memNames.join(",")} smoke=${smokeNames.join(",")}`,
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
