/**
 * Harness for pure helpers in src/engine/embeddingPure.ts
 * (hash, prefixes, degrade gate, planChunksToEmbed, listDocumentChunksForEmbed).
 *
 * Compile-from-disk pattern. llama.rn / ModelDownloader paths are OUT of scope.
 * Exit 1 on fail. ≥8 cases.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
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
      "src/context/retrievalLoop.ts",
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

  // 1. hash stability (64-bit / 16-char hex)
  check("hashChunkContent stable for same text", () => {
    const a = hashChunkContent("hello world");
    const b = hashChunkContent("hello world");
    assert(typeof a === "string" && a.length === 16, `bad hash shape: ${a}`);
    assert(/^[0-9a-f]{16}$/.test(a), `not hex: ${a}`);
    assert(a === b, `unstable: ${a} vs ${b}`);
  });

  // 1b. canonical FNV-1a 64-bit constants (offset basis / "a")
  check("hashChunkContent canonical FNV-1a 64 constants", () => {
    // FNV("")  = 0xcbf29ce484222325
    // FNV("a") = 0xaf63dc4c8601ec8c
    const empty = hashChunkContent("");
    const a = hashChunkContent("a");
    assert(empty === "cbf29ce484222325", `FNV(\"\") expected cbf29ce484222325, got ${empty}`);
    assert(a === "af63dc4c8601ec8c", `FNV(\"a\") expected af63dc4c8601ec8c, got ${a}`);
  });

  // 1c. Unicode FNV — non-ASCII via charCodeAt (UTF-16 code units, not UTF-8).
  // Reference (charCodeAt of "è" = 0x00E8):
  //   h = 0xcbf29ce484222325 ^ 0xE8; h = (h * 0x100000001b3) & 0xffffffffffffffff
  //   → 0xaf64654c8602d557
  check("hashChunkContent Unicode è deterministic", () => {
    const once = hashChunkContent("è");
    const twice = hashChunkContent("è");
    assert(once === twice, `unstable unicode: ${once} vs ${twice}`);
    assert(/^[0-9a-f]{16}$/.test(once), `not hex: ${once}`);
    // Reference implementation in harness (mirrors embeddingPure BigInt path).
    const FNV_OFFSET = 0xcbf29ce484222325n;
    const FNV_PRIME = 0x100000001b3n;
    const MASK64 = 0xffffffffffffffffn;
    let h = FNV_OFFSET;
    const s = "è";
    for (let i = 0; i < s.length; i++) {
      h ^= BigInt(s.charCodeAt(i));
      h = (h * FNV_PRIME) & MASK64;
    }
    const expected = h.toString(16).padStart(16, "0");
    assert(once === expected, `FNV("è") expected ${expected}, got ${once}`);
    // Documented constant for regression (charCodeAt 0xE8 path).
    assert(once === "af64654c8602d557", `documented FNV("è") constant, got ${once}`);
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

  // 8. planChunksToEmbed — new + unchanged (dedupe by chunkId+hash)
  check("planChunksToEmbed returns only missing (chunkId,hash)", () => {
    const { embedChunkKey } = mod;
    const chunks = [
      { chunkId: "d#sentence#0", text: "aaa", contentHash: hashChunkContent("aaa") },
      { chunkId: "d#sentence#1", text: "bbb", contentHash: hashChunkContent("bbb") },
      { chunkId: "d#sentence#2", text: "ccc", contentHash: hashChunkContent("ccc") },
    ];
    const existing = new Set([
      embedChunkKey(chunks[0].chunkId, chunks[0].contentHash),
      embedChunkKey(chunks[2].chunkId, chunks[2].contentHash),
    ]);
    const need = planChunksToEmbed(existing, chunks);
    assert(need.length === 1, `expected 1, got ${need.length}`);
    assert(need[0].chunkId === "d#sentence#1", `got ${need[0]?.chunkId}`);
  });

  // 9. planChunksToEmbed empty when all present
  check("planChunksToEmbed empty when all (chunkId,hash) exist", () => {
    const { embedChunkKey } = mod;
    const chunks = [
      { chunkId: "d#0", text: "x", contentHash: hashChunkContent("x") },
    ];
    const existing = new Set([embedChunkKey(chunks[0].chunkId, chunks[0].contentHash)]);
    const need = planChunksToEmbed(existing, chunks);
    assert(need.length === 0, `expected 0, got ${need.length}`);
  });

  // 9b. same text in different chunks embeds per chunk (provenance kept)
  check("planChunksToEmbed keeps same text across different chunkIds", () => {
    const { embedChunkKey } = mod;
    const h = hashChunkContent("same text");
    const chunks = [
      { chunkId: "d#sentence#0", text: "same text", contentHash: h },
      { chunkId: "d#paragraph#0", text: "same text", contentHash: h },
    ];
    // Only sentence is already embedded — paragraph with same hash still needed.
    const existing = new Set([embedChunkKey("d#sentence#0", h)]);
    const need = planChunksToEmbed(existing, chunks);
    assert(need.length === 1, `expected 1, got ${need.length}`);
    assert(need[0].chunkId === "d#paragraph#0", `got ${need[0]?.chunkId}`);
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
      assert(
        typeof c.contentHash === "string" && c.contentHash.length === 16,
        `bad hash: ${c.contentHash}`,
      );
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

  // 13. shared chunking: listDocumentChunksForEmbed ≡ listDocChunks (byte-identical ids)
  check("listDocumentChunksForEmbed matches listDocChunks (shared source)", () => {
    // Compile retrievalLoop for listDocChunks and compare ids/texts.
    const rlOut = path.join(projectRoot, "scripts/.build/embeddingServiceHarness");
    // Already compiled as dependency of embeddingPure (import of retrievalLoop).
    const rlCandidates = [
      path.join(rlOut, "context/retrievalLoop.js"),
      path.join(rlOut, "src/context/retrievalLoop.js"),
      path.join(rlOut, "retrievalLoop.js"),
    ];
    let rlPath = null;
    for (const c of rlCandidates) {
      if (existsSync(c)) {
        rlPath = c;
        break;
      }
    }
    assert(rlPath, `retrievalLoop.js not found among ${rlCandidates.join(", ")}`);
    const { listDocChunks } = require(rlPath);
    const text =
      "First sentence about a house purchase. Second sentence continues the story.\n\n" +
      "A longer paragraph that should be indexed as a paragraph window for hybrid retrieval later.";
    const fromShared = listDocChunks(text, "doc1");
    const fromEmbed = listDocumentChunksForEmbed([{ docId: "doc1", text }]);
    assert(fromShared.length === fromEmbed.length, `len ${fromShared.length} vs ${fromEmbed.length}`);
    for (let i = 0; i < fromShared.length; i++) {
      assert(
        fromShared[i].chunkId === fromEmbed[i].chunkId,
        `id mismatch @${i}: ${fromShared[i].chunkId} vs ${fromEmbed[i].chunkId}`,
      );
      assert(
        fromShared[i].text === fromEmbed[i].text,
        `text mismatch @${i}`,
      );
    }
  });

  // 14. FIX 2: EmbeddingService exports EMBEDDER_RELEASE_TIMEOUT_MS + release never throws
  // (source-level: EmbeddingService cannot compile here without llama.rn).
  check("EMBEDDER_RELEASE_TIMEOUT_MS exported (=15000) + releaseEmbedder never throws", () => {
    const src = readFileSync(
      path.join(projectRoot, "src/engine/EmbeddingService.ts"),
      "utf8",
    );
    const m = src.match(/export const EMBEDDER_RELEASE_TIMEOUT_MS\s*=\s*([\d_]+)/);
    assert(m, "EMBEDDER_RELEASE_TIMEOUT_MS export missing");
    const ms = Number(m[1].replace(/_/g, ""));
    assert(ms === 15_000, `timeout ${ms} !== 15000`);
    // releaseEmbedder body catches errors and never rethrows.
    assert(/export async function releaseEmbedder\(\)/.test(src), "releaseEmbedder missing");
    const releaseBody = src.slice(src.indexOf("export async function releaseEmbedder"));
    const bodyEnd = releaseBody.indexOf("\nexport ");
    const body = bodyEnd > 0 ? releaseBody.slice(0, bodyEnd) : releaseBody.slice(0, 800);
    assert(/catch\s*\{/.test(body), "releaseEmbedder must catch errors");
    // Reject real throw statements; allow comments that mention "throw".
    const codeOnly = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert(!/\bthrow\b/.test(codeOnly), "releaseEmbedder must not throw");
  });

  // 15. Round 6: hung flag + shared runNativeOp barrier (source-level).
  check("markEmbedderHung / isEmbedderHung + runNativeOp wrap every native call", () => {
    const src = readFileSync(
      path.join(projectRoot, "src/engine/EmbeddingService.ts"),
      "utf8",
    );
    assert(/export function markEmbedderHung\(\)/.test(src), "markEmbedderHung export");
    assert(/export function isEmbedderHung\(\)/.test(src), "isEmbedderHung export");
    assert(/let embedderHung\s*=\s*false/.test(src), "embedderHung module flag");
    // markEmbedderHung drops JS refs without calling native release.
    const hungBody = src.slice(src.indexOf("export function markEmbedderHung"));
    const hungEnd = hungBody.indexOf("\nexport ") > 0
      ? hungBody.indexOf("\nexport ")
      : hungBody.indexOf("\nasync function");
    const hung = hungEnd > 0 ? hungBody.slice(0, hungEnd) : hungBody.slice(0, 600);
    assert(/embedderHung\s*=\s*true/.test(hung), "sets embedderHung");
    assert(/context\s*=\s*null/.test(hung), "drops context ref");
    assert(!/\.release\(/.test(hung), "must NOT call native release on hung");
    // Shared barrier: no private withEmbedJob / embedJobChain; use runNativeOp.
    assert(!/function withEmbedJob/.test(src), "private FIFO must be replaced by runNativeOp");
    assert(!/embedJobChain/.test(src), "embedJobChain removed");
    assert(/runNativeOp/.test(src), "runNativeOp imported/used");
    // Native sites wrapped: initLlama, context.release, embedding().
    assert(/return runNativeOp\(async/.test(src), "ensure/release/embed use runNativeOp");
    // Early null on hung for public embed paths.
    assert(/if \(embedderHung\) return null/.test(src), "embed paths short-circuit on hung");
    assert(/if \(embedderHung\) return false/.test(src), "ensureEmbedder short-circuit on hung");
  });

  // 16. Round 7 BLOCK: AppShell wraps disposeEngine in runNativeOp;
  // timeout marks hung and REFUSES chat (no abandon / no force handoff).
  // Round 9: atomic runNativeOpBounded at both initEngine sites (replaces
  // observe-then-submit acquireNativeOpBounded + runNativeOp race).
  check("AppShell: runNativeOpBounded(initEngine) + block-on-timeout (no abandon)", () => {
    const src = readFileSync(
      path.join(projectRoot, "src/app/AppShell.tsx"),
      "utf8",
    );
    assert(/runNativeOp/.test(src), "imports/uses runNativeOp");
    assert(/runNativeOpBounded/.test(src), "imports/uses runNativeOpBounded");
    assert(/markEmbedderHung/.test(src), "imports markEmbedderHung");
    // Round 9: acquireNativeOpBounded removed (atomic check-and-submit).
    assert(!/acquireNativeOpBounded/.test(src), "must NOT import/use acquireNativeOpBounded");
    // Round 7: abandon + force handoff removed (block-not-proceed).
    assert(!/abandonNativeOpChain/.test(src), "must NOT import/use abandonNativeOpChain");
    assert(!/forceChatAcquireAfterEmbedTimeout/.test(src), "must NOT use force handoff");
    // Both chat-init call sites use atomic runNativeOpBounded(initEngine).
    const wraps = src.match(/runNativeOpBounded\(\s*\(\)\s*=>\s*[\s\S]*?initEngine\(/g);
    assert(
      wraps && wraps.length >= 2,
      `expected ≥2 runNativeOpBounded(initEngine) sites, got ${wraps ? wraps.length : 0}`,
    );
    // Both dispose call sites wrap disposeEngine in runNativeOp.
    const disposeWraps = src.match(/runNativeOp\(\s*\(\)\s*=>\s*disposeEngine\(\)\s*\)/g);
    assert(
      disposeWraps && disposeWraps.length >= 2,
      `expected ≥2 runNativeOp(() => disposeEngine()) sites, got ${disposeWraps ? disposeWraps.length : 0}`,
    );
    // releaseEmbedderBounded BLOCK policy: mark hung, no chain clear, no proceed.
    const bounded = src.slice(src.indexOf("async function releaseEmbedderBounded"));
    const boundedEnd = bounded.indexOf("\nfunction ");
    const body = boundedEnd > 0 ? bounded.slice(0, boundedEnd) : bounded.slice(0, 2000);
    assert(/markEmbedderHung\(\)/.test(body), "timeout → markEmbedderHung");
    assert(!/abandonNativeOpChain\(\)/.test(body), "timeout must NOT abandon chain");
    // Busy UI string on timeout paths.
    assert(/embedding\.busy/.test(src), "timeout surfaces embedding.busy");
    // Round 9: ≥2 runNativeOpBounded(..., EMBEDDER_RELEASE_TIMEOUT_MS) submissions.
    // Calls are multi-line: runNativeOpBounded(\n () => initEngine(...),\n TIMEOUT,\n).
    const acq = src.match(/runNativeOpBounded\([\s\S]*?EMBEDDER_RELEASE_TIMEOUT_MS\s*,?\s*\)/g);
    assert(
      acq && acq.length >= 2,
      `expected ≥2 runNativeOpBounded(..., EMBEDDER_RELEASE_TIMEOUT_MS), got ${acq ? acq.length : 0}`,
    );
    // Round 8 FIX 2: isEmbedderHung() top-guard on both init paths (refuse before submit).
    const hungGuards = src.match(/if\s*\(\s*isEmbedderHung\(\)\s*\)/g);
    assert(
      hungGuards && hungGuards.length >= 2,
      `expected ≥2 isEmbedderHung() guards, got ${hungGuards ? hungGuards.length : 0}`,
    );
    // Round 8 FIX 2: restart guidance on model bar when hung.
    assert(/embedding\.restartHint/.test(src), "model bar uses embedding.restartHint when hung");
    // Round 9 nit: hung bar disabled (pointerEvents none or disabled when hung).
    assert(
      /pointerEvents=\{isEmbedderHung\(\)\s*\?\s*["']none["']/.test(src) ||
        /disabled=\{[\s\S]*?isEmbedderHung\(\)/.test(src),
      "hung model bar must be disabled / pointerEvents none",
    );
    // Zero-vector capped sidecar records reason before early return.
    assert(
      /chunkCount\s*<=\s*0[\s\S]{0,200}isCapped[\s\S]{0,120}capped/.test(src),
      "zero-vector capped sidecar must record 'capped' before early return",
    );
  });

  // 16b. Round 7: releaseEmbedder absorbs native_op_abandoned (no throw).
  check("releaseEmbedder absorbs barrier errors (never throws / fire-and-forget safe)", () => {
    const src = readFileSync(
      path.join(projectRoot, "src/engine/EmbeddingService.ts"),
      "utf8",
    );
    const releaseBody = src.slice(src.indexOf("export async function releaseEmbedder"));
    const bodyEnd = releaseBody.indexOf("\nexport ");
    const body = bodyEnd > 0 ? releaseBody.slice(0, bodyEnd) : releaseBody.slice(0, 1200);
    // Outer try/catch around runNativeOp so abandoned rejections are absorbed.
    assert(/try\s*\{[\s\S]*runNativeOp[\s\S]*\}\s*catch/.test(body), "outer try/catch around runNativeOp");
    const codeOnly = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert(!/\bthrow\b/.test(codeOnly), "releaseEmbedder must not throw");
  });

  // 16c. Round 7: markEmbedderHung logs + Settings shows hung.
  check("markEmbedderHung logs + SettingsScreen shows hung state", () => {
    const embSrc = readFileSync(
      path.join(projectRoot, "src/engine/EmbeddingService.ts"),
      "utf8",
    );
    const hungBody = embSrc.slice(embSrc.indexOf("export function markEmbedderHung"));
    const hungEnd = hungBody.indexOf("\nexport ") > 0
      ? hungBody.indexOf("\nexport ")
      : hungBody.indexOf("\nasync function");
    const hung = hungEnd > 0 ? hungBody.slice(0, hungEnd) : hungBody.slice(0, 800);
    assert(/console\.warn/.test(hung), "markEmbedderHung must console.warn on entry");

    const settingsSrc = readFileSync(
      path.join(projectRoot, "src/screens/SettingsScreen.tsx"),
      "utf8",
    );
    assert(/isEmbedderHung/.test(settingsSrc), "Settings imports/uses isEmbedderHung");
    assert(/embedding\.hung/.test(settingsSrc), "Settings shows embedding.hung");
    // Round 8 FIX 3: memo deps include isEmbedderHung() so hang re-evaluates label.
    assert(
      /isEmbedderHung\(\)\s*\]/.test(settingsSrc) ||
        /\[.*isEmbedderHung\(\).*\]/.test(settingsSrc),
      "embeddingStatusLabel memo deps must include isEmbedderHung()",
    );
  });

  // 17. Round 6: documentChatTool surfaces 'hung' via degradedNoEmbedder text.
  check("documentChatTool DenseUnavailableReason includes hung → degradedNoEmbedder", () => {
    const src = readFileSync(
      path.join(projectRoot, "src/documents/documentChatTool.ts"),
      "utf8",
    );
    assert(/\|\s*"hung"/.test(src), "DenseUnavailableReason includes hung");
    assert(
      /reason === "no_embedder"\s*\|\|\s*reason === "hung"/.test(src),
      "denseDegradeLine maps hung → degradedNoEmbedder",
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
