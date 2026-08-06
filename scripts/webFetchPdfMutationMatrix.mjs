/**
 * Mutation matrix for web_fetch PDF guards (phase C1 follow-up).
 *
 * Pattern: read source → one textual mutation (CRLF-tolerant regex) → run
 * webFetchHarness → restore in finally → assert byte-identical restore.
 * Reports mutation → which named contracts go red.
 *
 * Does not leave the tree dirty. Run from repo root:
 *   node scripts/webFetchPdfMutationMatrix.mjs
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const SRC = path.join(projectRoot, "src/agent/webFetchTool.ts");

/** Contracts we expect each mutation to turn red (substring match on FAIL lines). */
const MUTATIONS = [
  {
    name: "pdf-content-type-accept",
    description: "Always reject non-ALLOWED content types (no PDF exception)",
    // if (!(isPdf && pdfPathEnabled)) → if (true)
    pattern: /if\s*\(\s*!\s*\(\s*isPdf\s*&&\s*pdfPathEnabled\s*\)\s*\)/,
    replace: "if (true /* mutated: no pdf accept */)",
    expectRed: [
      "pdf with extractor routed",
      "timeout: application/pdf at /doc.pdf routes to extractor",
    ],
  },
  {
    name: "extract-presence-check",
    description: "Accept/route PDF without requiring extractPdfText",
    // Gate: allow PDF by media type alone; path: enter handlePdf even without extractor
    apply(src) {
      let out = src;
      const gate = /if\s*\(\s*!\s*\(\s*isPdf\s*&&\s*pdfPathEnabled\s*\)\s*\)/;
      const pathIf = /if\s*\(\s*isPdf\s*&&\s*pdfPathEnabled\s*\)\s*\{/;
      if (!gate.test(out) || !pathIf.test(out)) {
        throw new Error("extract-presence-check: anchors not found");
      }
      out = out.replace(gate, "if (!isPdf /* mutated: no extract presence */)");
      out = out.replace(pathIf, "if (isPdf /* mutated: no extract presence */) {");
      return out;
    },
    expectRed: ["pdf no-extractor → unsupported"],
  },
  {
    name: "pdf-size-cap",
    description: "Disable Content-Length PDF size early exit",
    pattern:
      /if\s*\(\s*Number\.isFinite\s*\(\s*declared\s*\)\s*&&\s*declared\s*>\s*PDF_BODY_HARD_CAP\s*\)/,
    replace:
      "if (false && Number.isFinite(declared) && declared > PDF_BODY_HARD_CAP /* mutated */)",
    expectRed: ["pdf size cap fires"],
  },
  {
    name: "cache-finally-delete",
    description: "Skip pdfCacheFs.remove in finally",
    pattern: /await\s+pdfCacheFs\.remove\s*\(\s*cacheUri\s*\)\s*;/,
    replace: "/* mutated: no remove */ void cacheUri;",
    expectRed: [
      "pdf cache deleted on success",
      "pdf cache deleted on extract error",
    ],
  },
  {
    name: "no-text-layer-branch",
    description: "Empty docs always use invalid, never no-text-layer message",
    pattern:
      /if\s*\(\s*pageCount\s*>\s*0\s*\)\s*\{\s*return\s*\{\s*text:\s*errors\.webFetchPdfNoTextLayer/,
    replace:
      "if (false && pageCount > 0) { return { text: errors.webFetchPdfNoTextLayer",
    expectRed: ["pdf no-text-layer explicit message"],
  },
  {
    name: "pn-docid-remap",
    description: "remapPdfDocsToSourceUrl drops #pN provenance",
    apply(src) {
      // Replace function body to return docs with bare sourceUrl (no #pN).
      const re =
        /export function remapPdfDocsToSourceUrl\([\s\S]*?\n\}/;
      if (!re.test(src)) throw new Error("pn-docid-remap: function not found");
      return src.replace(
        re,
        `export function remapPdfDocsToSourceUrl(
  docs: Array<{ docId: string; title?: string; text: string }>,
  sourceUrl: string,
): Array<{ docId: string; title?: string; text: string }> {
  // MUTATED: lose page provenance
  return docs
    .filter((d) => d && typeof d.text === "string" && d.text.length > 0)
    .map((d) => ({ docId: sourceUrl, title: d.title, text: d.text }));
}`,
      );
    },
    expectRed: [
      "remapPdfDocsToSourceUrl builds #pN",
      "pdf passages numbered with page labels",
    ],
  },
  {
    name: "allowlist-gate",
    description: "Skip allowlist refusal (shared HTML+PDF path)",
    pattern: /if\s*\(\s*!allowlist\.has\s*\(\s*url\s*\)\s*\)\s*\{/,
    replace: "if (false && !allowlist.has(url) /* mutated */) {",
    expectRed: [
      "pdf allowlist refusal no network",
      "1 allowlist refusal no network",
    ],
  },
  {
    name: "host-gate",
    description:
      "Skip isPubliclyRoutableHttpUrl on requested URL in the executor (pure helper still correct)",
    pattern: /if\s*\(\s*!isPubliclyRoutableHttpUrl\s*\(\s*url\s*\)\s*\)\s*\{/,
    replace: "if (false && !isPubliclyRoutableHttpUrl(url) /* mutated */) {",
    // Pure "host gate REFUSED attack family" stays green (tests the helper).
    // Executor-level PDF attack-family contract must go red.
    expectRed: ["pdf host gate REFUSED attack family"],
  },
];

function applyMutation(src, mut) {
  if (typeof mut.apply === "function") return mut.apply(src);
  if (!mut.pattern.test(src)) {
    throw new Error(`${mut.name}: pattern did not match source (CRLF/anchor?)`);
  }
  return src.replace(mut.pattern, mut.replace);
}

function runHarness() {
  const r = spawnSync("node", ["scripts/webFetchHarness.mjs"], {
    cwd: projectRoot,
    encoding: "utf8",
    shell: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const failLines = out
    .split(/\r?\n/)
    .filter((l) => l.startsWith("FAIL "))
    .map((l) => l.replace(/^FAIL\s+/, "").replace(/\s+—.*$/, "").trim());
  const passLines = out
    .split(/\r?\n/)
    .filter((l) => l.startsWith("PASS "))
    .map((l) => l.replace(/^PASS\s+/, "").trim());
  return {
    exitCode: r.status ?? 1,
    failLines,
    passLines,
    out,
  };
}

function contractRed(failLines, nameSubstr) {
  return failLines.some(
    (f) => f === nameSubstr || f.startsWith(nameSubstr) || f.includes(nameSubstr),
  );
}

function main() {
  const original = readFileSync(SRC);
  const originalText = original.toString("utf8");
  /** @type {Array<{ name: string; description: string; expectRed: string[]; red: string[]; missing: string[]; extraFails: string[]; exitCode: number }>} */
  const rows = [];

  console.log("=== web_fetch PDF mutation matrix ===\n");
  console.log(`Source: ${SRC}`);
  console.log(`Baseline length: ${original.length} bytes\n`);

  try {
    // Baseline must be green first.
    console.log("── BASELINE (unmutated) ──");
    const base = runHarness();
    if (base.exitCode !== 0 || base.failLines.length > 0) {
      console.error("BASELINE harness is not green; aborting matrix.");
      console.error(base.failLines.join("\n"));
      process.exit(1);
    }
    console.log(`BASELINE ok (${base.passLines.length} PASS)\n`);

    for (const mut of MUTATIONS) {
      console.log(`── mutation: ${mut.name} ──`);
      console.log(`   ${mut.description}`);
      let mutatedText;
      try {
        mutatedText = applyMutation(originalText, mut);
      } catch (e) {
        console.error(`   APPLY FAILED: ${e.message}`);
        rows.push({
          name: mut.name,
          description: mut.description,
          expectRed: mut.expectRed,
          red: [],
          missing: mut.expectRed.slice(),
          extraFails: [`APPLY: ${e.message}`],
          exitCode: -1,
        });
        continue;
      }
      if (mutatedText === originalText) {
        console.error("   APPLY produced identical source");
        rows.push({
          name: mut.name,
          description: mut.description,
          expectRed: mut.expectRed,
          red: [],
          missing: mut.expectRed.slice(),
          extraFails: ["no-op mutation"],
          exitCode: -1,
        });
        continue;
      }
      writeFileSync(SRC, mutatedText, "utf8");
      const result = runHarness();
      // Always restore before next mutation.
      writeFileSync(SRC, original);
      const restored = readFileSync(SRC);
      if (!restored.equals(original)) {
        console.error("   FATAL: restore not byte-identical");
        process.exit(1);
      }

      const red = mut.expectRed.filter((c) => contractRed(result.failLines, c));
      const missing = mut.expectRed.filter((c) => !contractRed(result.failLines, c));
      const expectedSet = new Set(mut.expectRed);
      const extraFails = result.failLines.filter(
        (f) => ![...expectedSet].some((e) => f.includes(e) || e.includes(f)),
      );

      rows.push({
        name: mut.name,
        description: mut.description,
        expectRed: mut.expectRed,
        red,
        missing,
        extraFails: extraFails.slice(0, 12),
        exitCode: result.exitCode,
      });

      console.log(`   exit=${result.exitCode} fails=${result.failLines.length}`);
      console.log(`   expected-red caught: ${red.join(" | ") || "(none)"}`);
      if (missing.length) {
        console.log(`   MISSING (still green — need contract?): ${missing.join(" | ")}`);
      }
      if (extraFails.length) {
        console.log(`   other FAIL (sample): ${extraFails.slice(0, 5).join(" | ")}`);
      }
      console.log("");
    }
  } finally {
    writeFileSync(SRC, original);
    const final = readFileSync(SRC);
    if (!final.equals(original)) {
      console.error("finally: restore failed — writing original again");
      writeFileSync(SRC, original);
    } else {
      console.log("Source restored byte-identical to baseline.\n");
    }
  }

  // Summary table
  console.log("=== Mutation → contracts red ===\n");
  console.log(
    "| mutation | expected red | caught | missing | ok |",
  );
  console.log("|---|---|---|---|---|");
  let allOk = true;
  for (const r of rows) {
    const ok = r.missing.length === 0 && r.exitCode !== 0;
    if (!ok) allOk = false;
    console.log(
      `| ${r.name} | ${r.expectRed.join("; ")} | ${r.red.join("; ") || "—"} | ${r.missing.join("; ") || "—"} | ${ok ? "YES" : "NO"} |`,
    );
  }

  console.log(`\nMatrix ${allOk ? "PASS" : "FAIL"}: every mutation turns its named contracts red.`);
  process.exit(allOk ? 0 : 1);
}

main();
