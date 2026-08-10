/**
 * Harness for DocumentLibrary + documentChatTool (pure paths).
 * Compile-from-disk pattern (same as webFetchHarness). Exit 1 on fail.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outDir = path.join(projectRoot, "scripts/.build/documentLibraryHarness");

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/documents/DocumentLibrary.ts",
      "src/documents/documentChatTool.ts",
      "src/context/retriever.ts",
      "src/context/retrievalLoop.ts",
      "src/i18n/en.ts",
      "src/i18n/it.ts",
      "src/i18n/types.ts",
      // pdfText is type-only for the tool; include util so types resolve if emitted
      "src/util/pdfText.ts",
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
    path.join(outDir, `documents/${base}`),
    path.join(outDir, `src/documents/${base}`),
    path.join(outDir, base),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error(`Could not find compiled ${base}. Tried:\n`, candidates.join("\n"));
  process.exit(1);
}

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

function sampleDoc(overrides = {}) {
  return {
    id: "d1",
    name: "Spec.pdf",
    sourceId: "src1",
    kind: "pdf",
    addedAt: 1_700_000_000_000,
    pageCount: 3,
    sizeBytes: 12_000,
    docCount: 3,
    fileUri: "file:///tmp/spec.pdf",
    estimatedTokens: 400,
    ...overrides,
  };
}

async function main() {
  console.log("Compiling DocumentLibrary + documentChatTool …");
  compile();

  const libPath = pathToFileURL(resolveBuilt("DocumentLibrary.js")).href;
  const toolPath = pathToFileURL(resolveBuilt("documentChatTool.js")).href;
  const lib = await import(libPath);
  const tool = await import(toolPath);

  const {
    addDoc,
    removeDoc,
    docKey,
    decideDocStrategy,
    estimateTokensForDoc,
    formatPassageCitation,
    emptyLibraryState,
    parseLibraryState,
    serializeLibraryState,
    loadLibraryState,
    saveLibraryState,
  } = lib;

  const {
    createDocumentChatExecutor,
    DOCUMENT_CHAT_PROVENANCE,
    DOCUMENT_CHAT_VISION_MARKER,
    __resetDocumentChatBusyForTests,
    isDocumentChatBusy,
  } = tool;

  // ── 1 pure add ──────────────────────────────────────────────────────────
  {
    const s0 = emptyLibraryState();
    const d = sampleDoc();
    const s1 = addDoc(s0, d);
    check("addDoc appends", s1.docs.length === 1 && s1.docs[0].id === "d1");
    check("addDoc pure (no mutate)", s0.docs.length === 0);
  }

  // ── 2 pure remove ───────────────────────────────────────────────────────
  {
    const s = addDoc(emptyLibraryState(), sampleDoc());
    const s2 = removeDoc(s, "d1");
    check("removeDoc drops id", s2.docs.length === 0);
    check("removeDoc pure", s.docs.length === 1);
    check("removeDoc missing id no-op", removeDoc(s, "nope").docs.length === 1);
  }

  // ── 3 docKey ────────────────────────────────────────────────────────────
  {
    const s = addDoc(emptyLibraryState(), sampleDoc({ id: "abc" }));
    check("docKey hit", docKey(s, "abc") === "abc");
    check("docKey miss", docKey(s, "zzz") === null);
  }

  // ── 4–6 decideDocStrategy matrix ────────────────────────────────────────
  check(
    "strategy small → full_context",
    decideDocStrategy({ docCount: 2, estimatedTokens: 100, ctxTokens: 4096 }) ===
      "full_context",
  );
  check(
    "strategy large → retrieve",
    decideDocStrategy({ docCount: 10, estimatedTokens: 3000, ctxTokens: 4096 }) ===
      "retrieve",
  );
  check(
    "strategy no-text → vision_fallback",
    decideDocStrategy({ docCount: 0, estimatedTokens: 0, ctxTokens: 4096 }) ===
      "vision_fallback",
  );
  check(
    "strategy null estimate + text → retrieve",
    decideDocStrategy({ docCount: 5, estimatedTokens: null, ctxTokens: 4096 }) ===
      "retrieve",
  );
  check(
    "strategy boundary half ctx is retrieve (strict <)",
    decideDocStrategy({ docCount: 1, estimatedTokens: 2048, ctxTokens: 4096 }) ===
      "retrieve",
  );

  // ── 7 estimateTokens ────────────────────────────────────────────────────
  check("estimateTokens empty", estimateTokensForDoc("") === 0);
  check(
    "estimateTokens whitespace/4",
    estimateTokensForDoc("abcd") === 1 && estimateTokensForDoc("a".repeat(8)) === 2,
  );

  // ── 8 formatPassageCitation ─────────────────────────────────────────────
  check(
    "formatPassageCitation src#p3 → p. 3",
    formatPassageCitation("src#p3") === "p. 3",
  );
  check(
    "formatPassageCitation invalid",
    formatPassageCitation("no-page") === "" && formatPassageCitation("x#p0") === "",
  );

  // ── 9 serialize/parse round-trip ────────────────────────────────────────
  {
    const s = addDoc(emptyLibraryState(), sampleDoc({ name: "Round.pdf" }));
    const raw = serializeLibraryState(s);
    const back = parseLibraryState(raw);
    check(
      "serialize/parse round-trip",
      back.docs.length === 1 && back.docs[0].name === "Round.pdf",
    );
    check("parse corrupt → empty", parseLibraryState("{not json").docs.length === 0);
  }

  // ── 10 injected storage load/save ───────────────────────────────────────
  {
    const mem = new Map();
    const storage = {
      async getItem(k) {
        return mem.has(k) ? mem.get(k) : null;
      },
      async setItem(k, v) {
        mem.set(k, v);
      },
    };
    const s = addDoc(emptyLibraryState(), sampleDoc({ id: "persist-1" }));
    await saveLibraryState(storage, s);
    const loaded = await loadLibraryState(storage);
    check(
      "injected storage load/save",
      loaded.docs.length === 1 && loaded.docs[0].id === "persist-1",
    );
  }

  // ── 11 documentChatTool full_context ────────────────────────────────────
  __resetDocumentChatBusyForTests();
  {
    const longEnough = "word ".repeat(20); // small
    const host = {
      getLibraryDocs: () => [
        sampleDoc({
          id: "small",
          docCount: 1,
          estimatedTokens: 50,
          kind: "txt",
          fileUri: "file:///tmp/a.txt",
        }),
      ],
      requestPdfText: async () => ({ docs: [], skippedPages: [] }),
      readTxt: async () => longEnough,
      getCtxTokens: () => 4096,
      getIndexFor: () => null,
    };
    const exec = createDocumentChatExecutor(host, { timeoutMs: 5_000 });
    const out = await exec("document_chat", { query: "What is this?" }, undefined);
    check(
      "tool full_context returns whole text",
      out.strategy === "full_context" &&
        typeof out.text === "string" &&
        out.text.includes(longEnough.trim().slice(0, 10)) &&
        out.provenance.includes("not instructions"),
    );
  }

  // ── 12 documentChatTool retrieve + provenance ───────────────────────────
  __resetDocumentChatBusyForTests();
  {
    const pageText =
      "The mitochondrial electron transport chain produces ATP via oxidative phosphorylation. " +
      "Complex I oxidizes NADH. Complex IV reduces oxygen. " +
      "This paragraph is long enough for sentence segmentation and BM25 retrieval scoring.";
    const host = {
      getLibraryDocs: () => [
        sampleDoc({
          id: "big",
          docCount: 2,
          estimatedTokens: 50_000,
          kind: "pdf",
          sourceId: "paper",
        }),
      ],
      requestPdfText: async () => ({
        docs: [
          { docId: "paper#p1", title: "P1", text: pageText },
          {
            docId: "paper#p2",
            title: "P2",
            text: "Unrelated gardening notes about tomatoes and basil soil moisture.",
          },
        ],
        skippedPages: [],
        documentPageCount: 2,
      }),
      readTxt: async () => "",
      getCtxTokens: () => 4096,
      getIndexFor: () => null,
    };
    const exec = createDocumentChatExecutor(host, { timeoutMs: 5_000 });
    const out = await exec(
      "document_chat",
      { query: "electron transport chain ATP", docId: "big" },
      undefined,
    );
    check(
      "tool retrieve strategy",
      out.strategy === "retrieve",
      `got ${out.strategy} err=${out.error ?? ""}`,
    );
    check(
      "tool retrieve provenance not instructions",
      typeof out.provenance === "string" &&
        out.provenance.includes("not instructions") &&
        out.text.includes("not instructions"),
    );
    check(
      "tool retrieve has passages or matched body",
      (Array.isArray(out.passages) && out.passages.length > 0) ||
        /ATP|electron|mitochondrial/i.test(out.text),
      `passages=${out.passages?.length ?? 0}`,
    );
  }

  // ── 13 vision_fallback ──────────────────────────────────────────────────
  __resetDocumentChatBusyForTests();
  {
    const host = {
      getLibraryDocs: () => [
        sampleDoc({ id: "scan", docCount: 0, pageCount: 4, estimatedTokens: 0 }),
      ],
      requestPdfText: async () => ({ docs: [], skippedPages: [1, 2, 3, 4] }),
      readTxt: async () => "",
      getCtxTokens: () => 4096,
      getIndexFor: () => null,
    };
    const exec = createDocumentChatExecutor(host);
    const out = await exec("document_chat", { query: "summary", docId: "scan" });
    check(
      "tool vision_fallback marker",
      out.strategy === "vision_fallback" &&
        out.text.includes(DOCUMENT_CHAT_VISION_MARKER),
    );
  }

  // ── 14 error path ───────────────────────────────────────────────────────
  __resetDocumentChatBusyForTests();
  {
    const host = {
      getLibraryDocs: () => [],
      requestPdfText: async () => ({ docs: [], skippedPages: [] }),
      readTxt: async () => "",
      getCtxTokens: () => 4096,
      getIndexFor: () => null,
    };
    const exec = createDocumentChatExecutor(host);
    const out = await exec("document_chat", { query: "hello" });
    check(
      "tool error no doc",
      out.strategy === "error" && typeof out.error === "string" && out.error.length > 0,
    );
    const emptyQ = await exec("document_chat", { query: "   " });
    check(
      "tool error empty query",
      emptyQ.strategy === "error" && typeof emptyQ.error === "string",
    );
  }

  // ── 15 single-flight busy ───────────────────────────────────────────────
  __resetDocumentChatBusyForTests();
  {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const host = {
      getLibraryDocs: () => [
        sampleDoc({ id: "slow", kind: "txt", docCount: 1, estimatedTokens: 10 }),
      ],
      requestPdfText: async () => ({ docs: [], skippedPages: [] }),
      readTxt: async () => {
        await gate;
        return "slow text body for the first call";
      },
      getCtxTokens: () => 4096,
      getIndexFor: () => null,
    };
    const exec = createDocumentChatExecutor(host, { timeoutMs: 10_000 });
    const firstP = exec("document_chat", { query: "q", docId: "slow" });
    // Yield so first call can set inflight
    await new Promise((r) => setTimeout(r, 20));
    check("single-flight busy flag", isDocumentChatBusy() === true);
    const second = await exec("document_chat", { query: "q2", docId: "slow" });
    check(
      "single-flight busy error",
      second.strategy === "error" && /busy/i.test(second.error ?? second.text),
    );
    release();
    const first = await firstP;
    check(
      "single-flight first completes",
      first.strategy === "full_context" || first.strategy === "retrieve",
      `got ${first.strategy}`,
    );
    __resetDocumentChatBusyForTests();
  }

  // ── provenance constant ─────────────────────────────────────────────────
  check(
    "DOCUMENT_CHAT_PROVENANCE constant",
    typeof DOCUMENT_CHAT_PROVENANCE === "string" &&
      DOCUMENT_CHAT_PROVENANCE.includes("not instructions"),
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
