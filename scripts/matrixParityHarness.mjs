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
const APK_YML = path.join(projectRoot, ".github/workflows/apk.yml");
const CI_BENCH_SH = path.join(projectRoot, "scripts/ci-bench.sh");

const AXES = ["compaction", "toolchoice", "toolgate", "block_format", "thinking", "memory"];

// Expected arms for each campaign phase
const EXPECTED_FASE4_ARMS = ["baseline", "anchored", "ciswire", "nogate"];
const EXPECTED_MEM_ARMS = ["off_off", "off_on", "ciswire_off", "ciswire_on"];
const EXPECTED_SMOKE_ARMS = [...EXPECTED_FASE4_ARMS, ...EXPECTED_MEM_ARMS].sort();

// Expected axis values for each arm
const EXPECTED_AXES = {
  // fase4 arms
  baseline: { compaction: "off", block_format: "none", thinking: "default" },
  anchored: { compaction: "anchored", block_format: "none", thinking: "default" },
  ciswire: { compaction: "ciswire", block_format: "none", thinking: "default" },
  nogate: {
    compaction: "off",
    block_format: "none",
    thinking: "default",
    toolgate: "0",
  },
  // mem arms
  off_off: {
    compaction: "off",
    block_format: "none",
    thinking: "default",
    memory: "0",
  },
  off_on: {
    compaction: "off",
    block_format: "none",
    thinking: "default",
    memory: "1",
  },
  ciswire_off: {
    compaction: "ciswire",
    block_format: "none",
    thinking: "default",
    memory: "0",
  },
  ciswire_on: {
    compaction: "ciswire",
    block_format: "none",
    thinking: "default",
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
  const duplicates = []; // Track {entryIndex, key} for duplicate keys within an entry
  let inInclude = false;
  let includeIndent = -1;
  let itemIndent = -1;
  let seenMatrix = false;
  let current = null;
  let entryIndex = -1;

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
      entryIndex += 1;
      itemIndent = indent;
      continue;
    }

    const kv = content.match(/^(\w+):\s*(.*?)\s*$/);
    if (kv && current && indent > itemIndent) {
      const key = kv[1];
      if (Object.prototype.hasOwnProperty.call(current, key)) {
        duplicates.push({
          entryIndex,
          key,
          phase: current.phase ?? "(unknown)",
          arm: current.arm ?? "(unknown)",
          seed: current.seed ?? "(unknown)",
        });
      }
      current[key] = unquote(kv[2]);
    }
  }
  return { entries, duplicates };
}

/**
 * Phases dispatchable from bench.yml's workflow_dispatch `phase` input:
 * the flow-style `options:` list immediately under the `phase:` input.
 * Not a YAML parser — plain regex over the file text. The `phase:` input is
 * the only `phase:` followed by a newline (matrix include uses `- phase: X`
 * on a single line), so the match anchors on the input block.
 */
function parsePhaseOptions(text) {
  const m = text.match(/phase:\s*\n[\s\S]*?options:\s*\[([^\]]*)\]/);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => unquote(s.trim()))
    .filter(Boolean);
}

/**
 * Phases accepted by ci-bench.sh's `case "$PHASE" in` block. Collect the
 * pattern of every branch except the final `*)`; patterns are pipe-separated
 * literals (e.g. `fase4|smoke|mem|tools`), so each is an accepted phase.
 * Plain string/regex over the file text — no shell evaluator, no new dep.
 */
function parseAcceptedPhases(text) {
  const m = text.match(/case\s+"\$PHASE"\s+in\n([\s\S]*?)\n\s*esac/);
  if (!m) return new Set();
  const accepted = new Set();
  for (const line of m[1].split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const pm = t.match(/^(.+?)\)\s*$/);
    if (!pm) continue;
    const pat = pm[1].trim();
    if (pat === "*") continue;
    for (const p of pat.split("|")) {
      const phase = p.trim();
      if (phase) accepted.add(phase);
    }
  }
  return accepted;
}

/**
 * Extract `node scripts/<name>.mjs` harness lines from a workflow's
 * "Typecheck + logic harnesses" step. Plain regex over the file text — no
 * YAML parser. We anchor on the unique step name, then collect `node
 * scripts/...mjs` lines until the next job step (a `- ` item at the 6-space
 * step indent). Comment lines, `npm run typecheck`, `npx jest`, and the
 * bash sideload-guards line are not `node scripts/*.mjs` and are skipped.
 */
function extractTypecheckHarnesses(text) {
  const lines = text.split(/\r?\n/);
  const stepIdx = lines.findIndex((l) => l.includes("Typecheck + logic harnesses"));
  if (stepIdx < 0) return [];
  const out = [];
  for (let i = stepIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^      - /.test(line)) break; // next step at the 6-space indent
    const m = line.match(/^(\s*)node scripts\/(\S+\.mjs)\s*$/);
    if (m) out.push(m[2]);
  }
  return out;
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

/** Distinct arms for one phase. Conflicting axis values on the same arm fail.
 * Within-arm seed divergence: every seed of an arm must carry identical axes.
 * Failure names arm, seed, and field — enough to fix without opening the YAML. */
function distinctArms(entries, phase) {
  const map = new Map();
  const firstSeed = new Map(); // arm -> first seed seen
  const failures = [];
  for (const e of entries) {
    if (e.phase !== phase) continue;
    const arm = e.arm;
    if (arm == null || arm === "") continue;
    const axes = axisRecord(e);
    if (!map.has(arm)) {
      map.set(arm, axes);
      firstSeed.set(arm, e.seed);
      continue;
    }
    const prev = map.get(arm);
    for (const k of AXES) {
      if (prev[k] !== axes[k]) {
        failures.push(
          `arm '${arm}' seed ${e.seed} field '${k}' differs from seed ${firstSeed.get(arm)} within ${phase}: ${fmt(prev[k])} vs ${fmt(axes[k])}`,
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
    thinking: "default",
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
  const fMatch = checkParity(parseMatrixInclude(yamlFromRows(matched)).entries);
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
  const fNoTwin = checkParity(parseMatrixInclude(yamlFromRows(noTwin)).entries);
  check(
    "fase4 arm with no smoke twin fails naming the arm",
    fNoTwin.some((m) => /fase4 arm 'nogate' has no smoke twin/.test(m)),
    fNoTwin.join("; "),
  );

  const thinkDiff = [
    { phase: "fase4", seed: "1", ...matchedPair("baseline", { thinking: "default" }) },
    { phase: "fase4", seed: "2", ...matchedPair("baseline", { thinking: "default" }) },
    {
      phase: "smoke",
      seed: "1",
      ...matchedPair("baseline", { thinking: "budget256" }),
    },
  ];
  const fThink = checkParity(parseMatrixInclude(yamlFromRows(thinkDiff)).entries);
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
  const fSmoke = checkParity(parseMatrixInclude(yamlFromRows(smokeOnly)).entries);
  check(
    "smoke-only arm fails",
    fSmoke.some((m) => /smoke arm 'forcing' has no campaign counterpart/.test(m)),
    fSmoke.join("; "),
  );

  const withFase0 = [
    { phase: "fase0", arm: "none_budget512", seed: "1", block_format: "none", thinking: "budget512" },
    { phase: "fase0", arm: "none_budget512", seed: "2", block_format: "none", thinking: "budget512" },
    { phase: "fase4", seed: "1", ...matchedPair("baseline") },
    { phase: "fase4", seed: "2", ...matchedPair("baseline") },
    { phase: "smoke", seed: "1", ...matchedPair("baseline") },
  ];
  const fF0 = checkParity(parseMatrixInclude(yamlFromRows(withFase0)).entries);
  check("fase0 entries ignored", fF0.length === 0, fF0.join("; "));

  // Test that mem phase is now covered
  const memNoTwin = [
    { phase: "mem", seed: "1", ...matchedPair("off_off", { memory: "0" }) },
    { phase: "mem", seed: "2", ...matchedPair("off_off", { memory: "0" }) },
    { phase: "mem", seed: "1", ...matchedPair("off_on", { memory: "1" }) },
    { phase: "mem", seed: "2", ...matchedPair("off_on", { memory: "1" }) },
  ];
  const fMemNoTwin = checkParity(parseMatrixInclude(yamlFromRows(memNoTwin)).entries);
  check(
    "mem arm with no smoke twin fails naming the arm",
    fMemNoTwin.some((m) => /mem arm 'off_on' has no smoke twin/.test(m)),
    fMemNoTwin.join("; "),
  );

  // Test that seed divergence is detected and names the seed
  const seedDiverge = [
    { phase: "fase4", seed: "1", ...matchedPair("baseline", { thinking: "default" }) },
    { phase: "fase4", seed: "2", ...matchedPair("baseline", { thinking: "default" }) },
    { phase: "fase4", seed: "3", ...matchedPair("baseline", { thinking: "budget256" }) },
    { phase: "smoke", seed: "1", ...matchedPair("baseline", { thinking: "default" }) },
  ];
  const fSeedDiverge = checkParity(parseMatrixInclude(yamlFromRows(seedDiverge)).entries);
  check(
    "seed divergence fails naming arm, seed, and field",
    fSeedDiverge.some(
      (m) =>
        /arm 'baseline' seed 3 field 'thinking' differs from seed 1 within fase4/.test(
          m,
        ),
    ),
    fSeedDiverge.join("; "),
  );

  const realText = readFileSync(BENCH_YML, "utf8");
  const realParsed = parseMatrixInclude(realText);
  const realEntries = realParsed.entries;

  // Duplicate-key guard: a matrix include entry must not declare the same
  // key twice. YAML forbids duplicate keys; GitHub silently takes one value,
  // which masks injections (e.g. thinking: budget256 before thinking: "default").
  // The parser's last-wins semantics would otherwise erase the divergence
  // before distinctArms sees it. Fail naming entry index and key.
  check(
    "real bench.yml has no duplicate keys in any matrix entry",
    realParsed.duplicates.length === 0,
    realParsed.duplicates
      .map(
        (d) =>
          `phase '${d.phase}' arm '${d.arm}' seed ${d.seed} has duplicate key '${d.key}'`,
      )
      .join("; "),
  );
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

  // Gate: every phase dispatchable via bench.yml's `phase` input option list
  // must be accepted by ci-bench.sh's `case "$PHASE" in` — otherwise a
  // dispatched arm dies instantly with "unknown PHASE". Three prior harnesses
  // shipped vacuous; this one derives both lists from the real files and names
  // the offending phase, so it can be seen to fail under mutation.
  const ciBenchText = readFileSync(CI_BENCH_SH, "utf8");
  const phaseOptions = parsePhaseOptions(realText);
  const acceptedPhases = parseAcceptedPhases(ciBenchText);
  check(
    "phase options parsed from bench.yml",
    phaseOptions.length > 0,
    "no phase options parsed from bench.yml `phase` input options list (regex missed?)",
  );
  check(
    "accepted phases parsed from ci-bench.sh",
    acceptedPhases.size > 0,
    'no accepted phases parsed from ci-bench.sh `case "$PHASE" in` (block reformatted?)',
  );
  const rejectedPhases = phaseOptions.filter((p) => !acceptedPhases.has(p));
  check(
    "every dispatchable phase is accepted by ci-bench.sh",
    rejectedPhases.length === 0,
    rejectedPhases
      .map(
        (p) =>
          `phase '${p}' is dispatchable in bench.yml but rejected by ci-bench.sh`,
      )
      .join("; "),
  );

  // apk.yml harness parity: this workflow must run every *Harness.mjs that
  // bench.yml's typecheck step runs, or the device APK can ship logic that
  // bench validated but apk never executed. Enforced structurally — not a
  // hand-maintained list — so a harness added to bench.yml fails here naming
  // the missing file. Fails (one of the two checks below) if either step
  // parses to zero harnesses.
  const apkText = readFileSync(APK_YML, "utf8");
  const apkHarnesses = extractTypecheckHarnesses(apkText);
  const benchHarnesses = extractTypecheckHarnesses(realText);
  check(
    "bench.yml and apk.yml typecheck harness lists parse non-empty",
    benchHarnesses.length > 0 && apkHarnesses.length > 0,
    `bench=${benchHarnesses.length} apk=${apkHarnesses.length}`,
  );
  const apkSet = new Set(apkHarnesses);
  const missingInApk = benchHarnesses.filter((h) => !apkSet.has(h));
  check(
    "apk.yml runs every bench.yml typecheck harness",
    missingInApk.length === 0,
    `missing from apk.yml: ${missingInApk.join(", ")}`,
  );

  console.log("");
  console.log(
    `=== OVERALL: ${failed === 0 ? "PASS" : "FAIL"} (${passed} passed, ${failed} failed) ===`,
  );
  if (failed > 0) process.exit(1);
}

main();
