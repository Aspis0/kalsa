/**
 * i18n parity harness for Documents Tab v1.
 * - Every §10 screen key exists in both en.ts and it.ts.
 * - Dropped jargon keys (intro, addPdf, addTxt, extracting, noTextLayer as
 *   USER labels) are not referenced from user-facing screen/app/component code.
 * Exit 1 on fail.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const outDir = path.join(projectRoot, "scripts/.build/i18nParityHarness");

const SCREEN_KEYS = [
  "title",
  "emptyTitle",
  "emptyBody",
  "add",
  "reorderHint",
  "reorderHintDismiss",
  "reading",
  "readingName",
  "pageCount",
  "pageCountOne",
  "sizeOnly",
  "metaPagesSize",
  "addedToday",
  "addedYesterday",
  "addedOn",
  "unreadable",
  "errorPdf",
  "errorTxt",
  "errorEmpty",
  "errorBinary",
  "errorLegacyWord",
  "errorDocx",
  "errorTooLarge",
  "errorBusy",
  "errorStorage",
  "delete",
  "deleteConfirm",
  "deleteCancel",
  "detailBack",
  "detailFallback",
  "detailA11yRow",
  "detailA11yCover",
  "detailA11yDrag",
];

/** Dropped as USER labels — must not appear in screens/app/components as t("documents.X"). */
const DROPPED_USER_KEYS = [
  "intro",
  "addPdf",
  "addTxt",
  "extracting",
  "noTextLayer",
  "empty",
  "extractBusy",
  "readFailed",
  "tooLarge",
  "cannotRead",
  "storageUnavailable",
  "busy",
];

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`PASS ${name}`);
    pass++;
  } else {
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    fail++;
  }
}

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/i18n/en.ts",
      "src/i18n/it.ts",
      "src/i18n/types.ts",
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
      "--esModuleInterop",
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

function resolveBuilt(base) {
  const candidates = [
    path.join(outDir, `i18n/${base}`),
    path.join(outDir, `src/i18n/${base}`),
    path.join(outDir, base),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error(`Could not find compiled ${base}`);
  process.exit(1);
}

function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) out.push(p);
  }
  return out;
}

async function main() {
  console.log("Compiling i18n catalogs…");
  compile();
  const enMod = await import(pathToFileURL(resolveBuilt("en.js")).href);
  const itMod = await import(pathToFileURL(resolveBuilt("it.js")).href);
  const enDocs = enMod.en?.documents ?? {};
  const itDocs = itMod.it?.documents ?? {};

  for (const key of SCREEN_KEYS) {
    check(
      `en.documents.${key}`,
      typeof enDocs[key] === "string" && enDocs[key].length > 0,
      `got=${typeof enDocs[key]}`,
    );
    check(
      `it.documents.${key}`,
      typeof itDocs[key] === "string" && itDocs[key].length > 0,
      `got=${typeof itDocs[key]}`,
    );
  }

  // Tool keys preserved.
  for (const key of ["timeout", "renderer", "fsError", "retryHint"]) {
    check(
      `en.documents.extraction.${key} preserved`,
      typeof enDocs.extraction?.[key] === "string",
    );
    check(
      `it.documents.extraction.${key} preserved`,
      typeof itDocs.extraction?.[key] === "string",
    );
  }

  // Grep user-facing code for dropped keys as t("documents.X") references.
  const roots = [
    path.join(projectRoot, "src/screens"),
    path.join(projectRoot, "src/app"),
    path.join(projectRoot, "src/components"),
  ];
  const files = roots.flatMap((r) => walkFiles(r));
  const dropHits = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const key of DROPPED_USER_KEYS) {
      const re = new RegExp(
        String.raw`(?:t\(|translate\([^,]+,\s*)["'\`]documents\.${key}["'\`]`,
      );
      if (re.test(text)) {
        dropHits.push(`${path.relative(projectRoot, file)}: documents.${key}`);
      }
    }
  }
  check(
    "no dropped user keys referenced in screens/app/components",
    dropHits.length === 0,
    dropHits.join("; "),
  );

  // Deep recursive key-set parity en↔it across the whole catalog (not only subgroups).
  function collectKeys(obj, prefix = "", out = new Set()) {
    if (!obj || typeof obj !== "object") return out;
    for (const [k, v] of Object.entries(obj)) {
      const pathKey = prefix ? `${prefix}.${k}` : k;
      if (typeof v === "string") out.add(pathKey);
      else if (v && typeof v === "object") collectKeys(v, pathKey, out);
    }
    return out;
  }
  const enKeys = collectKeys(enMod.en);
  const itKeys = collectKeys(itMod.it);
  const missingInIt = [...enKeys].filter((k) => !itKeys.has(k));
  const missingInEn = [...itKeys].filter((k) => !enKeys.has(k));
  check(
    "deep en→it key-set parity (whole catalog)",
    missingInIt.length === 0,
    missingInIt.slice(0, 30).join(", "),
  );
  check(
    "deep it→en key-set parity (whole catalog)",
    missingInEn.length === 0,
    missingInEn.slice(0, 30).join(", "),
  );
  // typeof parity for shared keys
  let typeMismatches = 0;
  function typeWalk(a, b, prefix = "") {
    if (typeof a !== typeof b) {
      typeMismatches += 1;
      return;
    }
    if (a && typeof a === "object" && !Array.isArray(a)) {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b || {})])) {
        typeWalk(a[k], b?.[k], prefix ? `${prefix}.${k}` : k);
      }
    }
  }
  typeWalk(enMod.en, itMod.it);
  check("deep en↔it typeof parity", typeMismatches === 0, `mismatches=${typeMismatches}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
