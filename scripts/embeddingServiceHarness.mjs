/**
 * Harness for pure helpers in src/engine/embeddingPure.ts
 * (hash, prefixes, degrade gate, planChunksToEmbed, listDocumentChunksForEmbed).
 *
 * Compile-from-disk pattern. llama.rn / ModelDownloader paths are OUT of scope.
 * Exit 1 on fail. ≥8 cases.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const outDir = path.join(projectRoot, "scripts/.build/embeddingServiceHarness");

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/engine/embeddingPure.ts",
      "src/documents/semanticIndex.ts",
      "src/context/retriever.ts",
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
    path.join(outDir, `engine/${base}`),
    path.join(outDir, `src/engine/${base}`),
    path.join(outDir, base),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error(`Could not find compiled ${base}. Tried:\n`, candidates.join("\n"));
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log("Compiling embeddingPure.ts …");
  compile();
  const modPath = resolveBuilt("embeddingPure.js");
  console.log("Loading", modPath);
  const mod = require(modPath);
  const {
    hashChunkContent,
    shouldDegradeToBm25Only,
    applyEmbedPrefix,
    listDocumentChunksForEmbed,
    planChunksToEmbed,
  } = mod;

  let passed = 0;
  let failed = 0;
  function check(name, fn) {
    try {
      fn();
      console.log(`PASS ${name}`);
      passed++;
    } catch (e) {
      console.log(`FAIL ${name} — ${e && e.message ? e.message : e}`);
      failed++;
    }
  }

  // 1. hash stability
  check("hashChunkContent stable for same text", () => {
    const a = hashChunkContent("hello world");
    const b = hashChunkContent("hello world");
    assert(typeof a === "string" && a.length === 8, `bad hash shape: ${a}`);
    assert(a === b, `unstable: ${a} vs ${b}`);
  });

  // 2. hash sensitivity
  check("hashChunkContent differs for different text", () => {
    const a = hashChunkContent("hello world");
    const b = hashChunkContent("hello world!");
    assert(a !== b, `collision: ${a}`);
  });

  // 3. query prefix
  check("applyEmbedPrefix query adds query: ", () => {
    const out = applyEmbedPrefix("casa", "query");
    assert(out === "query: casa", `got ${out}`);
  });

  // 4. doc prefix + idempotent
  check("applyEmbedPrefix doc adds passage: and is idempotent", () => {
    const once = applyEmbedPrefix("acquisto", "doc");
    assert(once === "passage: acquisto", `got ${once}`);
    const twice = applyEmbedPrefix(once, "doc");
    assert(twice === once, `not idempotent: ${twice}`);
    const qOnce = applyEmbedPrefix("q", "query");
    const qTwice = applyEmbedPrefix(qOnce, "query");
    assert(qTwice === qOnce, `query not idempotent: ${qTwice}`);
  });

  // 5. degrade: not downloaded
  check("shouldDegradeToBm25Only when not downloaded", () => {
    assert(
      shouldDegradeToBm25Only({
        embedderDownloaded: false,
        vectorChunkCount: 10,
      }) === true,
      "expected degrade",
    );
  });

  // 6. degrade: no vectors
  check("shouldDegradeToBm25Only when zero vectors", () => {
    assert(
      shouldDegradeToBm25Only({
        embedderDownloaded: true,
        vectorChunkCount: 0,
      }) === true,
      "expected degrade",
    );
  });

  // 7. ready for hybrid
  check("shouldDegradeToBm25Only false when downloaded + vectors", () => {
    assert(
      shouldDegradeToBm25Only({
        embedderDownloaded: true,
        vectorChunkCount: 3,
      }) === false,
      "expected hybrid-ready",
    );
  });

  // 8. planChunksToEmbed — new + unchanged
  check("planChunksToEmbed returns only missing hashes", () => {
    const chunks = [
      { chunkId: "d#sentence#0", text: "aaa", contentHash: hashChunkContent("aaa") },
      { chunkId: "d#sentence#1", text: "bbb", contentHash: hashChunkContent("bbb") },
      { chunkId: "d#sentence#2", text: "ccc", contentHash: hashChunkContent("ccc") },
    ];
    const existing = new Set([chunks[0].contentHash, chunks[2].contentHash]);
    const need = planChunksToEmbed(existing, chunks);
    assert(need.length === 1, `expected 1, got ${need.length}`);
    assert(need[0].chunkId === "d#sentence#1", `got ${need[0]?.chunkId}`);
  });

  // 9. planChunksToEmbed empty when all present
  check("planChunksToEmbed empty when all hashes exist", () => {
    const chunks = [
      { chunkId: "d#0", text: "x", contentHash: hashChunkContent("x") },
    ];
    const existing = new Set([chunks[0].contentHash]);
    const need = planChunksToEmbed(existing, chunks);
    assert(need.length === 0, `expected 0, got ${need.length}`);
  });

  // 10. listDocumentChunksForEmbed produces both granularities
  check("listDocumentChunksForEmbed emits sentence+paragraph chunkIds", () => {
    const pages = [
      {
        docId: "doc1",
        text:
          "First sentence about a house purchase. Second sentence continues the story.\n\n" +
          "A longer paragraph that should be indexed as a paragraph window for hybrid retrieval later.",
      },
    ];
    const chunks = listDocumentChunksForEmbed(pages);
    assert(chunks.length > 0, "expected some chunks");
    const ids = chunks.map((c) => c.chunkId);
    assert(
      ids.some((id) => id.includes("#sentence#")),
      `no sentence ids: ${ids.join(",")}`,
    );
    assert(
      ids.some((id) => id.includes("#paragraph#")),
      `no paragraph ids: ${ids.join(",")}`,
    );
    for (const c of chunks) {
      assert(typeof c.contentHash === "string" && c.contentHash.length === 8, "bad hash");
      assert(typeof c.text === "string" && c.text.length > 0, "empty text");
    }
  });

  // 11. empty / bad inputs
  check("listDocumentChunksForEmbed / planChunksToEmbed empty inputs", () => {
    assert(listDocumentChunksForEmbed([]).length === 0, "empty pages");
    assert(listDocumentChunksForEmbed(null).length === 0, "null pages");
    assert(planChunksToEmbed(new Set(), []).length === 0, "empty chunks");
    assert(hashChunkContent("") === hashChunkContent(""), "empty hash stable");
    assert(shouldDegradeToBm25Only(null) === true, "null opts degrade");
  });

  // 12. degradation decision mirrors hybrid gate (no download → null embed path)
  check("degradation decision: no download implies bm25_only path", () => {
    const degrade = shouldDegradeToBm25Only({
      embedderDownloaded: false,
      vectorChunkCount: 0,
    });
    assert(degrade === true, "must degrade without download");
    assert(
      shouldDegradeToBm25Only({
        embedderDownloaded: true,
        vectorChunkCount: 0,
      }) === true,
      "cold index must degrade",
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
