/**
 * researchPlanHarness — pure-logic tests for src/research/plan.ts
 * (deep-research trigger, JSON planner parsing, sub-query sanitization,
 * Jaccard dedupe, mechanical fallback). No engine, no RN imports.
 * Exit 1 on fail.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

function compile() {
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/research/plan.ts",
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

let mod;
async function load() {
  if (!mod) {
    mod = await import(
      pathToFileURL(path.join(projectRoot, "scripts/.build/plan.js")).href
    );
  }
  return mod;
}

let passed = 0;
let failed = 0;

function ok(cond, name) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL: ${name}`);
  }
}

function eq(actual, expected, name) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL: ${name}\n  expected ${e}\n  actual   ${a}`);
  }
}

compile();
const {
  hasDeepResearchTrigger,
  stripDeepResearchTrigger,
  fallbackSubqueries,
  parsePlannerOutput,
  sanitizeSubqueries,
  jaccardPhrases,
  PLANNER_JSON_SCHEMA,
} = await load();

// ── trigger regex ──────────────────────────────────────────────────────────
ok(hasDeepResearchTrigger("do a deep research on insulin"), "trigger en lowercase");
ok(hasDeepResearchTrigger("DEEP RESEARCH on therapy"), "trigger en uppercase");
ok(hasDeepResearchTrigger("ricerca approfondita su insulina"), "trigger it");
ok(hasDeepResearchTrigger("Ricerca Approfondita"), "trigger it case");
ok(!hasDeepResearchTrigger("what is a research question"), "no false positive research alone");
ok(!hasDeepResearchTrigger(""), "empty string no trigger");
ok(!hasDeepResearchTrigger("deep sea diving"), "no false positive deep");

// ── strip ──────────────────────────────────────────────────────────────────
eq(stripDeepResearchTrigger("deep research on insulin resistance"), "on insulin resistance", "strip en");
eq(stripDeepResearchTrigger("spiega la ricerca approfondita sui topi"), "spiega la sui topi", "strip it");
eq(stripDeepResearchTrigger("deep research"), "", "strip single phrase -> empty");
eq(stripDeepResearchTrigger("  deep research on x  "), "on x", "strip collapsed whitespace");

// ── jaccard ────────────────────────────────────────────────────────────────
eq(jaccardPhrases("", ""), 1, "jaccard empty/empty");
eq(jaccardPhrases("a b c", "a b c"), 1, "jaccard identical");
eq(jaccardPhrases("a b c", "d e f"), 0, "jaccard disjoint");
eq(jaccardPhrases("a b", "a b c"), 2 / 3, "jaccard partial");

// ── sanitizeSubqueries ─────────────────────────────────────────────────────
eq(sanitizeSubqueries([], "q"), [], "sanitize empty list");
eq(
  sanitizeSubqueries(["ok query here", "ok query here"], "q"),
  ["ok query here"],
  "sanitize duplicate drop",
);
eq(
  sanitizeSubqueries(
    ["what is the exact mechanism of insulin resistance in skeletal muscle tissue cells"],
    "q",
  ),
  [],
  "sanitize >12 words dropped",
);
eq(
  sanitizeSubqueries(
    ["insulin therapy", "insulin resistance and therapy"],
    "insulin resistance and therapy",
  ),
  ["insulin therapy"],
  "sanitize question clone dropped on 2nd entry (1st exempt)",
);
eq(
  sanitizeSubqueries(
    ["a b", "c d", "e f", "g h", "i j", "k l"],
    "zzz q",
  ),
  ["a b", "c d", "e f", "g h", "i j"],
  "sanitize max 5",
);
eq(
  sanitizeSubqueries(["a b", "a b c"], "q"),
  ["a b", "a b c"],
  "sanitize below jaccard dup threshold",
);

// ── fallbackSubqueries ─────────────────────────────────────────────────────
eq(fallbackSubqueries(""), [], "fallback empty input");
eq(fallbackSubqueries("   "), [], "fallback whitespace input");
const fb = fallbackSubqueries("insulin resistance");
eq(fb.length, 5, "fallback 5 slots");
eq(fb[0], "insulin resistance", "fallback q first");
ok(fb.every((s) => s.length > 0), "fallback non-empty items");
ok(fb.every((s) => s.split(/\s+/).length <= 12), "fallback word caps");

// ── parsePlannerOutput ─────────────────────────────────────────────────────
eq(
  parsePlannerOutput(JSON.stringify({ subqueries: ["a", "b", "c"] }), "q"),
  ["a", "b", "c"],
  "parse plain json",
);
eq(
  parsePlannerOutput('```json\n{"subqueries":["a","b","c"]}\n```', "q"),
  ["a", "b", "c"],
  "parse fenced json",
);
eq(
  parsePlannerOutput('<think>thinking</think>{"subqueries":["a","b","c"]}', "q"),
  ["a", "b", "c"],
  "parse think-tag prefix",
);
eq(
  parsePlannerOutput('trailing {"subqueries":["a","b","c"]} more', "q"),
  ["a", "b", "c"],
  "parse unclosed braces extraction",
);
eq(parsePlannerOutput('{"subqueries":["a"]}', "q"), null, "parse 1 item -> null");
eq(parsePlannerOutput('{"subqueries":[]}', "q"), null, "parse empty list -> null");
eq(parsePlannerOutput("not json at all", "q"), null, "parse garbage -> null");
eq(parsePlannerOutput('["a","b","c"]', "q"), null, "parse array root -> null");
eq(parsePlannerOutput("", "q"), null, "parse empty -> null");
eq(parsePlannerOutput('{"other":1}', "q"), null, "parse missing key -> null");

// ── schema shape ───────────────────────────────────────────────────────────
eq(PLANNER_JSON_SCHEMA.type, "object", "schema object");
ok(
  PLANNER_JSON_SCHEMA.properties.subqueries.items &&
    PLANNER_JSON_SCHEMA.properties.subqueries.items.type === "string",
  "schema items",
);
eq(PLANNER_JSON_SCHEMA.required, ["subqueries"], "schema required");

console.log(`\nOVERALL: ${failed === 0 ? "PASS" : "FAIL"} (${passed} passed, ${failed} failed)`);
process.exit(failed === 0 ? 0 : 1);
