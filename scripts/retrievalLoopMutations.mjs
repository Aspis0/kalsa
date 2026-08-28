/**
 * Mutation matrix for containment dedup — test-only.
 * Patches copies of src under a temp dir, compiles there, never touches src/.
 *
 * Invoked from retrievalLoopHarness.mjs after the product contracts pass.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

/** Broken metric kept in the harness only — never in src/. */
export function wordSetContainedAt(normA, normB, thr = 0.9) {
  const setA = new Set(String(normA).split(/\s+/).filter(Boolean));
  const setB = new Set(String(normB).split(/\s+/).filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return false;
  let inter = 0;
  for (const w of setA) {
    if (setB.has(w)) inter++;
  }
  return inter / Math.min(setA.size, setB.size) >= thr;
}

/**
 * Replace isTextuallyContained body with word-set containment ≥ 0.9.
 * Anchors tolerate CRLF on disk.
 */
function mutateIsTextuallyContainedToWordSet(src) {
  // Match the full exported function (brace-balanced-ish via non-greedy to next
  // top-level "function " or end). Use [\s\S] so CRLF is fine.
  const re =
    /export function isTextuallyContained\(normA: string, normB: string\): boolean \{[\s\S]*?\n\}(?=\r?\n\r?\n|\r?\nfunction |\r?\n\/\*\*)/;
  const replacement = `export function isTextuallyContained(normA: string, normB: string): boolean {
  const setA = new Set(normA.split(/\\s+/).filter(Boolean));
  const setB = new Set(normB.split(/\\s+/).filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return false;
  let inter = 0;
  for (const w of setA) {
    if (setB.has(w)) inter++;
  }
  return inter / Math.min(setA.size, setB.size) >= 0.9;
}`;
  if (!re.test(src)) {
    // Fallback: match until the closing brace before stableSortIndices
    const re2 =
      /export function isTextuallyContained\(normA: string, normB: string\): boolean \{[\s\S]*?\n\}/;
    if (!re2.test(src)) {
      throw new Error(
        "mutateIsTextuallyContainedToWordSet: could not find isTextuallyContained",
      );
    }
    return src.replace(re2, replacement);
  }
  return src.replace(re, replacement);
}

function compileTemp(tempRoot) {
  // Use the project's local tsc; cwd=tempRoot has no node_modules.
  const tscJs = path.join(
    projectRoot,
    "node_modules",
    "typescript",
    "lib",
    "tsc.js",
  );
  if (!existsSync(tscJs)) {
    throw new Error(`project tsc not found at ${tscJs}`);
  }
  const r = spawnSync(
    process.execPath,
    [
      tscJs,
      path.join(tempRoot, "src/context/ngramRank.ts"),
      path.join(tempRoot, "src/context/retriever.ts"),
      path.join(tempRoot, "src/context/retrievalLoop.ts"),
      "--outDir",
      path.join(tempRoot, "build"),
      "--module",
      "nodenext",
      "--target",
      "es2020",
      "--moduleResolution",
      "nodenext",
      "--skipLibCheck",
      "--ignoreConfig",
    ],
    { cwd: projectRoot, encoding: "utf8", shell: false },
  );
  if (r.status !== 0) {
    throw new Error(`temp tsc failed:\n${r.stdout}\n${r.stderr}`);
  }
}

function resolveBuilt(tempRoot, name) {
  const candidates = [
    path.join(tempRoot, `build/${name}.js`),
    path.join(tempRoot, `build/context/${name}.js`),
    path.join(tempRoot, `build/src/context/${name}.js`),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(`temp build missing ${name}.js`);
}

/**
 * Copy project sources needed for tsc into temp, apply mutator to retriever.ts.
 * Returns { tempRoot, loopPath, retrieverPath }.
 */
function buildMutated(mutator) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "kalsa-contain-mut-"));
  const srcDir = path.join(tempRoot, "src", "context");
  mkdirSync(srcDir, { recursive: true });

  const retSrc = readFileSync(
    path.join(projectRoot, "src/context/retriever.ts"),
    "utf8",
  );
  const loopSrc = readFileSync(
    path.join(projectRoot, "src/context/retrievalLoop.ts"),
    "utf8",
  );

  writeFileSync(path.join(srcDir, "retriever.ts"), mutator(retSrc), "utf8");
  writeFileSync(path.join(srcDir, "retrievalLoop.ts"), loopSrc, "utf8");
  const ngramSrc = readFileSync(
    path.join(projectRoot, "src/context/ngramRank.ts"),
    "utf8",
  );
  writeFileSync(path.join(srcDir, "ngramRank.ts"), ngramSrc, "utf8");

  compileTemp(tempRoot);
  return {
    tempRoot,
    loopPath: resolveBuilt(tempRoot, "retrievalLoop"),
    retrieverPath: resolveBuilt(tempRoot, "retriever"),
  };
}

async function loadBuilt(loopPath, retrieverPath) {
  // Cache-bust: unique query so re-imports of different temps work
  const bust = `?t=${Date.now()}-${Math.random()}`;
  const mod = await import(pathToFileURL(loopPath).href + bust);
  const ret = await import(pathToFileURL(retrieverPath).href + bust);
  return { mod, ret };
}

function eval15a(isTextuallyContained, normalize) {
  const pairs = [
    [
      "the dose was not increased",
      "the dose was increased and the patient was not monitored",
    ],
    [
      "revenue grew in 2024",
      "revenue did not grow in 2024 although costs grew",
    ],
    [
      "Rome is the capital of Italy",
      "Paris is the capital of France and Rome is a city in Italy",
    ],
    ["The model is accurate", "The model is not accurate in edge cases"],
  ];
  return pairs.every(
    ([a, b]) => isTextuallyContained(normalize(a), normalize(b)) === false,
  );
}

function eval18(DocRetrieverIndex, runRetrievalLoop) {
  const short =
    "alpha beta gamma delta epsilon zeta eta theta iota MARKER-77 protocol.";
  const longer =
    "alpha beta gamma delta epsilon zeta eta theta iota protocol requires cold storage ambient monitoring and review.";
  const idx = new DocRetrieverIndex();
  idx.append([
    { docId: "mark-short", text: short },
    { docId: "mark-long", text: longer },
  ]);
  const res = runRetrievalLoop(
    idx,
    "alpha beta MARKER-77 protocol storage monitoring",
    {
      maxRounds: 2,
      topNPerRound: 4,
      budgetChars: 2000,
      maxCharsPerPassage: 400,
      coverageThreshold: 0.5,
      minPassagesFloor: 1,
    },
  );
  return /MARKER-77/i.test(res.passages.map((p) => p.text).join(" "));
}

function eval19(DocRetrieverIndex, runRetrievalLoop) {
  const idx = new DocRetrieverIndex();
  idx.append([
    {
      docId: "neg-model",
      text:
        "The model is accurate. The model is not accurate in edge cases. Additional notes on evaluation protocols follow.",
    },
  ]);
  const res = runRetrievalLoop(idx, "is the model accurate");
  const texts = res.passages.map((p) => p.text);
  const hasStandaloneAffirmative = texts.some(
    (t) => /the model is accurate/i.test(t) && !/not accurate/i.test(t),
  );
  const hasNegative = texts.some((t) => /not accurate/i.test(t));
  return {
    pass: hasStandaloneAffirmative && hasNegative,
    standaloneAff: hasStandaloneAffirmative,
    neg: hasNegative,
    texts,
  };
}

/**
 * Run BASELINE (using already-loaded product modules) + wordset mutation.
 * Returns matrix rows; throws if wordset fails to turn 15a/18/19 red.
 */
export async function runMutationMatrix(productMod, productRet) {
  const { DocRetrieverIndex, runRetrievalLoop } = productMod;
  const { normalize, isTextuallyContained } = productRet;

  const rows = [];
  const ids = ["15a", "18", "19"];

  // BASELINE from product build
  {
    const r15a = eval15a(isTextuallyContained, normalize);
    const r18 = eval18(DocRetrieverIndex, runRetrievalLoop);
    const r19 = eval19(DocRetrieverIndex, runRetrievalLoop);
    rows.push({
      name: "BASELINE",
      "15a": r15a,
      "18": r18,
      "19": r19.pass,
      detail19: r19,
    });
  }

  // WORDSET: temp-dir patch of isTextuallyContained only
  let tempRoot;
  try {
    const built = buildMutated(mutateIsTextuallyContainedToWordSet);
    tempRoot = built.tempRoot;
    const { mod, ret } = await loadBuilt(built.loopPath, built.retrieverPath);
    const r15a = eval15a(ret.isTextuallyContained, ret.normalize);
    const r18 = eval18(mod.DocRetrieverIndex, mod.runRetrievalLoop);
    const r19 = eval19(mod.DocRetrieverIndex, mod.runRetrievalLoop);
    rows.push({
      name: "wordset",
      "15a": r15a,
      "18": r18,
      "19": r19.pass,
      detail19: r19,
    });
  } finally {
    if (tempRoot) {
      try {
        rmSync(tempRoot, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }

  console.log("\n=== Mutation matrix (temp-dir patch; no src/ seam) ===");
  console.log(["mutation", ...ids].join(" | "));
  for (const row of rows) {
    console.log(
      [
        row.name,
        ...ids.map((id) => (row[id] ? "PASS" : "FAIL")),
      ].join(" | "),
    );
  }
  const ws = rows.find((r) => r.name === "wordset");
  if (ws) {
    console.log(
      `  wordset 19 detail: standaloneAff=${ws.detail19.standaloneAff} neg=${ws.detail19.neg} texts=${JSON.stringify(ws.detail19.texts)}`,
    );
  }

  // Hard requirement: word-set turns the three gates red
  const wordset = rows.find((r) => r.name === "wordset");
  const baseline = rows.find((r) => r.name === "BASELINE");
  if (!baseline || !wordset) {
    throw new Error("mutation matrix incomplete");
  }
  if (!baseline["15a"] || !baseline["18"] || !baseline["19"]) {
    throw new Error("BASELINE must pass 15a/18/19 before mutation");
  }
  if (wordset["15a"] || wordset["18"] || wordset["19"]) {
    throw new Error(
      `word-set mutation must turn 15a/18/19 red; got 15a=${wordset["15a"]} 18=${wordset["18"]} 19=${wordset["19"]}`,
    );
  }

  // Confirm production src has no seam
  const retDisk = readFileSync(
    path.join(projectRoot, "src/context/retriever.ts"),
    "utf8",
  );
  const loopDisk = readFileSync(
    path.join(projectRoot, "src/context/retrievalLoop.ts"),
    "utf8",
  );
  const forbidden = [
    "__setTextualContainedOverride",
    "__setDedupProbe",
    "wordSetContainedAt",
    "textualContainedOverride",
    "dedupProbe",
    "DedupProbeFlags",
  ];
  for (const tok of forbidden) {
    if (retDisk.includes(tok) || loopDisk.includes(tok)) {
      throw new Error(`production src still contains probe seam: ${tok}`);
    }
  }
  console.log("  src/ probe-seam scan: clean (no __set* / wordSetContainedAt / override)");

  return rows;
}
