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
      "src/documents/docOpGate.ts",
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
    reorderDocs,
    makePreviewSnippet,
    formatBytesLocalized,
    formatAddedBucket,
    formatAddedDate,
    docKey,
    decideDocStrategy,
    estimateTokensForDoc,
    formatPassageCitation,
    shouldUseVisionFallback,
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
    isDocumentOpInFlight,
    DOC_OP_STALE_CAP_MS,
  } = tool;

  // Pure mirrors of DocumentsScreen exports (keep in sync with screen helpers).
  const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
  const MAX_TEXT_BYTES = 10 * 1024 * 1024;
  function normalizeUriPath(uri) {
    if (!uri || typeof uri !== "string") return "";
    const s = uri.replace(/\\/g, "/");
    const schemeMatch = s.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)(.*)$/);
    const scheme = schemeMatch ? schemeMatch[1] : "";
    const pathPart = schemeMatch ? schemeMatch[2] : s;
    const leadingSlash = pathPart.startsWith("/");
    const stack = [];
    for (const seg of pathPart.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") {
        if (stack.length > 0) stack.pop();
        continue;
      }
      stack.push(seg);
    }
    const body = stack.join("/");
    if (scheme) return `${scheme}/${body}`;
    return (leadingSlash ? "/" : "") + body;
  }
  function isOwnedDocumentUri(fileUri, baseDir) {
    if (!fileUri || typeof fileUri !== "string") return false;
    if (!baseDir || typeof baseDir !== "string") return false;
    const normUri = normalizeUriPath(fileUri);
    const normBase = normalizeUriPath(baseDir);
    if (!normUri || !normBase) return false;
    const basePrefix = normBase.endsWith("/") ? normBase : `${normBase}/`;
    // Mirrors documentStorage: library files + cover JPEGs are owned.
    const ownedPrefixes = [
      `${basePrefix}kalsa-documents/`,
      `${basePrefix}kalsa-covers/`,
    ];
    for (const canonicalPrefix of ownedPrefixes) {
      if (
        normUri === canonicalPrefix.slice(0, -1) ||
        normUri.startsWith(canonicalPrefix)
      ) {
        return true;
      }
    }
    return false;
  }
  function sizeWithinLimits(sizeBytes, kind) {
    if (
      sizeBytes == null ||
      typeof sizeBytes !== "number" ||
      !Number.isFinite(sizeBytes) ||
      sizeBytes < 0
    ) {
      return { ok: false, reason: "unknown" };
    }
    const max = kind === "txt" ? MAX_TEXT_BYTES : MAX_DOCUMENT_BYTES;
    const n = Math.floor(sizeBytes);
    if (n === 0) return { ok: false, reason: "empty" };
    if (n > max) return { ok: false, reason: "too_large" };
    return { ok: true, sizeBytes: n };
  }

  // ── 1 pure add (prepends — new-on-top) ──────────────────────────────────
  {
    const s0 = emptyLibraryState();
    const d = sampleDoc();
    const s1 = addDoc(s0, d);
    check("addDoc inserts", s1.docs.length === 1 && s1.docs[0].id === "d1");
    check("addDoc pure (no mutate)", s0.docs.length === 0);
    const s2 = addDoc(s1, sampleDoc({ id: "d2", name: "Second.pdf" }));
    check(
      "addDoc prepends (new first)",
      s2.docs.length === 2 && s2.docs[0].id === "d2" && s2.docs[1].id === "d1",
      `order=${s2.docs.map((x) => x.id).join(",")}`,
    );
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
        out.provenance.includes("not instructions") &&
        out.kind === "document_chat" &&
        // Provenance must NOT be embedded in the body (engine appends after trunc).
        !out.text.includes("not instructions"),
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
        // Body must NOT embed provenance (engine appends after trunc).
        !out.text.includes("not instructions") &&
        out.kind === "document_chat",
    );
    check(
      "tool retrieve has passages or matched body",
      (Array.isArray(out.passages) && out.passages.length > 0) ||
        /ATP|electron|mitochondrial/i.test(out.text),
      `passages=${out.passages?.length ?? 0}`,
    );
    // FIX 10: top-ranked passage must be the query-matching page, not just any hit.
    check(
      "tool retrieve top passage is query-matching doc",
      Array.isArray(out.passages) &&
        out.passages.length > 0 &&
        out.passages[0].docId === "paper#p1",
      `top=${out.passages?.[0]?.docId ?? "none"}`,
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

  // ── 16 abort during full_context read forwards signal to host ─────────
  __resetDocumentChatBusyForTests();
  {
    let sawSignal = false;
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const host = {
      getLibraryDocs: () => [
        sampleDoc({ id: "abort-me", kind: "txt", docCount: 1, estimatedTokens: 10 }),
      ],
      requestPdfText: async () => ({ docs: [], skippedPages: [] }),
      readTxt: async (_doc, opts) => {
        sawSignal = Boolean(opts?.signal);
        await new Promise((resolve, reject) => {
          const onAbort = () => reject(new Error("aborted"));
          if (opts?.signal?.aborted) {
            onAbort();
            return;
          }
          opts?.signal?.addEventListener("abort", onAbort, { once: true });
          void gate.then(() => {
            opts?.signal?.removeEventListener?.("abort", onAbort);
            resolve(undefined);
          });
        });
        return "should not reach";
      },
      getCtxTokens: () => 4096,
      getIndexFor: () => null,
    };
    const exec = createDocumentChatExecutor(host, { timeoutMs: 10_000 });
    const ac = new AbortController();
    const p = exec("document_chat", { query: "q", docId: "abort-me" }, ac.signal);
    await new Promise((r) => setTimeout(r, 20));
    ac.abort();
    const out = await p;
    check(
      "abort during full_context forwards signal",
      sawSignal === true &&
        out.strategy === "error" &&
        /abort/i.test(out.error ?? out.text),
      `sawSignal=${sawSignal} strategy=${out.strategy} err=${out.error ?? out.text}`,
    );
    release();
    // Wait for strategy.finally to settle before the next case (generation-guarded,
    // but avoid cross-test races on shared host gates).
    await new Promise((r) => setTimeout(r, 30));
    __resetDocumentChatBusyForTests();
  }

  // ── 17 single-flight: second call does NOT invoke host twice ──────────
  __resetDocumentChatBusyForTests();
  {
    let hostCalls = 0;
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const host = {
      getLibraryDocs: () => [
        sampleDoc({ id: "sf", kind: "txt", docCount: 1, estimatedTokens: 10 }),
      ],
      requestPdfText: async () => ({ docs: [], skippedPages: [] }),
      readTxt: async () => {
        hostCalls += 1;
        await gate;
        return "first call body";
      },
      getCtxTokens: () => 4096,
      getIndexFor: () => null,
    };
    const exec = createDocumentChatExecutor(host, { timeoutMs: 10_000 });
    const firstP = exec("document_chat", { query: "q", docId: "sf" });
    await new Promise((r) => setTimeout(r, 20));
    const second = await exec("document_chat", { query: "q2", docId: "sf" });
    check(
      "single-flight second is busy error",
      second.strategy === "error" && /busy/i.test(second.error ?? second.text),
    );
    check(
      "single-flight host invoked once while first in flight",
      hostCalls === 1,
      `hostCalls=${hostCalls}`,
    );
    release();
    await firstP;
    // After settle, a new call works.
    const third = await exec("document_chat", { query: "q3", docId: "sf" });
    check(
      "single-flight after settle works",
      third.strategy === "full_context" || third.strategy === "retrieve",
      `got ${third.strategy}`,
    );
    check(
      "single-flight host invoked again after settle",
      hostCalls === 2,
      `hostCalls=${hostCalls}`,
    );
    __resetDocumentChatBusyForTests();
  }

  // ── 18 top-ranked retrieval across two docs ───────────────────────────
  __resetDocumentChatBusyForTests();
  {
    // Deterministic fixture: query terms only in doc A page.
    const host = {
      getLibraryDocs: () => [
        sampleDoc({
          id: "docA",
          name: "A.pdf",
          sourceId: "A",
          docCount: 1,
          estimatedTokens: 50_000,
          kind: "pdf",
        }),
      ],
      requestPdfText: async () => ({
        docs: [
          {
            docId: "A#p1",
            title: "alpha",
            text:
              "UniqueTokenAlpha appears only here with enough surrounding words for BM25 sentence scoring to rank this passage first among candidates.",
          },
          {
            docId: "A#p2",
            title: "beta",
            text: "Completely unrelated gardening notes about tomatoes basil soil moisture and compost bins without the unique token.",
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
      { query: "UniqueTokenAlpha", docId: "docA" },
      undefined,
    );
    check(
      "top passage is doc section with query terms",
      out.strategy === "retrieve" &&
        Array.isArray(out.passages) &&
        out.passages.length > 0 &&
        out.passages[0].docId === "A#p1",
      `strategy=${out.strategy} top=${out.passages?.[0]?.docId ?? "none"}`,
    );
  }

  // ── 19 single-flight latch outlives wrapper abort (late host settle) ──
  __resetDocumentChatBusyForTests();
  {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    let hostCalls = 0;
    const host = {
      getLibraryDocs: () => [
        sampleDoc({ id: "late", kind: "txt", docCount: 1, estimatedTokens: 10 }),
      ],
      requestPdfText: async () => ({ docs: [], skippedPages: [] }),
      // Host ignores abort and settles LATE (mirrors uncancellable FS read).
      readTxt: async (_doc, _opts) => {
        hostCalls += 1;
        await gate;
        return "late body after abort window";
      },
      getCtxTokens: () => 4096,
      getIndexFor: () => null,
    };
    const exec = createDocumentChatExecutor(host, { timeoutMs: 10_000 });
    const ac = new AbortController();
    const firstP = exec("document_chat", { query: "q", docId: "late" }, ac.signal);
    await new Promise((r) => setTimeout(r, 20));
    check("late-settle busy flag after start", isDocumentChatBusy() === true);
    check("late-settle isDocumentOpInFlight", isDocumentOpInFlight() === true);
    ac.abort();
    const first = await firstP;
    check(
      "late-settle first rejects abort",
      first.strategy === "error" && /abort/i.test(first.error ?? first.text),
      `strategy=${first.strategy} err=${first.error ?? first.text}`,
    );
    // Latch must still be held while host strategy has not settled.
    check(
      "late-settle latch held after wrapper abort",
      isDocumentChatBusy() === true,
      `busy=${isDocumentChatBusy()}`,
    );
    const second = await exec("document_chat", { query: "q2", docId: "late" });
    check(
      "late-settle second still busy while host unsettled",
      second.strategy === "error" && /busy/i.test(second.error ?? second.text),
      `strategy=${second.strategy} err=${second.error ?? second.text}`,
    );
    check(
      "late-settle host not invoked twice while latch held",
      hostCalls === 1,
      `hostCalls=${hostCalls}`,
    );
    release();
    // Allow strategy finally to clear latch.
    await new Promise((r) => setTimeout(r, 30));
    check(
      "late-settle latch cleared after host settle",
      isDocumentChatBusy() === false,
      `busy=${isDocumentChatBusy()}`,
    );
    const third = await exec("document_chat", { query: "q3", docId: "late" });
    check(
      "late-settle third succeeds after settle",
      third.strategy === "full_context" || third.strategy === "retrieve",
      `got ${third.strategy}`,
    );
    check(
      "DOC_OP_STALE_CAP_MS above timeout",
      typeof DOC_OP_STALE_CAP_MS === "number" && DOC_OP_STALE_CAP_MS > 165_000,
      `cap=${DOC_OP_STALE_CAP_MS}`,
    );
    __resetDocumentChatBusyForTests();
  }

  // ── 20 ownership prefix predicate (normalized; base = document root) ──
  {
    const root = "file:///data/user/0/app/files/";
    const owned = "file:///data/user/0/app/files/kalsa-documents/doc-1.pdf";
    check(
      "owned uri under canonical prefix",
      isOwnedDocumentUri(owned, root) === true,
    );
    check(
      "sibling dir with kalsa-documents/ in the middle is NOT owned",
      isOwnedDocumentUri(
        "file:///data/user/0/app/cache/evil-kalsa-documents/x.pdf",
        root,
      ) === false,
    );
    check(
      "cacheDirectory-style path is NOT owned",
      isOwnedDocumentUri(
        "file:///data/user/0/app/cache/kalsa-documents/doc-1.pdf",
        root,
      ) === false,
    );
    check(
      "substring-only kalsa-documents elsewhere is NOT owned",
      isOwnedDocumentUri(
        "file:///tmp/other/kalsa-documents/nested/x.pdf",
        root,
      ) === false,
    );
    // FIX 4: traversal / backslash normalization
    check(
      "owned: base/kalsa-documents/evil",
      isOwnedDocumentUri("base/kalsa-documents/evil", "base") === true,
    );
    check(
      "NOT owned: base/kalsa-documents-evil/x (prefix boundary)",
      isOwnedDocumentUri("base/kalsa-documents-evil/x", "base") === false,
    );
    check(
      "owned after backslash normalize",
      isOwnedDocumentUri("base\\kalsa-documents\\evil", "base") === true,
    );
    check(
      "NOT owned: base/../outside/kalsa-documents/evil escapes base",
      isOwnedDocumentUri("base/../outside/kalsa-documents/evil", "base") === false,
    );
    check(
      "NOT owned: base/kalsa-documents/../x resolves outside library",
      isOwnedDocumentUri("base/kalsa-documents/../x", "base") === false,
    );
    check(
      "owned: base/kalsa-covers/doc.jpg",
      isOwnedDocumentUri("base/kalsa-covers/doc.jpg", "base") === true,
    );
    check(
      "NOT owned: base/kalsa-covers-evil/x (prefix boundary)",
      isOwnedDocumentUri("base/kalsa-covers-evil/x", "base") === false,
    );
  }

  // ── 21 sizeWithinLimits fail-closed ───────────────────────────────────
  {
    check(
      "size null rejected",
      sizeWithinLimits(null, "pdf").ok === false &&
        sizeWithinLimits(null, "pdf").reason === "unknown",
    );
    check(
      "size undefined rejected",
      sizeWithinLimits(undefined, "txt").ok === false &&
        sizeWithinLimits(undefined, "txt").reason === "unknown",
    );
    check(
      "size NaN rejected",
      sizeWithinLimits(Number.NaN, "pdf").ok === false,
    );
    check(
      "size over pdf max rejected",
      sizeWithinLimits(MAX_DOCUMENT_BYTES + 1, "pdf").ok === false &&
        sizeWithinLimits(MAX_DOCUMENT_BYTES + 1, "pdf").reason === "too_large",
    );
    check(
      "size over txt max rejected",
      sizeWithinLimits(MAX_TEXT_BYTES + 1, "txt").ok === false &&
        sizeWithinLimits(MAX_TEXT_BYTES + 1, "txt").reason === "too_large",
    );
    check(
      "size at pdf max ok",
      sizeWithinLimits(MAX_DOCUMENT_BYTES, "pdf").ok === true,
    );
    check(
      "size under txt max ok",
      sizeWithinLimits(100, "txt").ok === true &&
        sizeWithinLimits(100, "txt").sizeBytes === 100,
    );
    // FIX 2: zero-byte rejection
    check(
      "size 0 pdf rejected empty",
      sizeWithinLimits(0, "pdf").ok === false &&
        sizeWithinLimits(0, "pdf").reason === "empty",
    );
    check(
      "size 0 txt rejected empty",
      sizeWithinLimits(0, "txt").ok === false &&
        sizeWithinLimits(0, "txt").reason === "empty",
    );
    check(
      "size 1 txt ok",
      sizeWithinLimits(1, "txt").ok === true &&
        sizeWithinLimits(1, "txt").sizeBytes === 1,
    );
    check(
      "size max pdf ok",
      sizeWithinLimits(MAX_DOCUMENT_BYTES, "pdf").ok === true,
    );
    check(
      "size max+1 pdf rejected",
      sizeWithinLimits(MAX_DOCUMENT_BYTES + 1, "pdf").ok === false &&
        sizeWithinLimits(MAX_DOCUMENT_BYTES + 1, "pdf").reason === "too_large",
    );
    check(
      "size null pdf rejected",
      sizeWithinLimits(null, "pdf").ok === false &&
        sizeWithinLimits(null, "pdf").reason === "unknown",
    );
  }

  // ── provenance constant ─────────────────────────────────────────────────
  check(
    "DOCUMENT_CHAT_PROVENANCE constant",
    typeof DOCUMENT_CHAT_PROVENANCE === "string" &&
      DOCUMENT_CHAT_PROVENANCE.includes("not instructions"),
  );

  // ── 22 shared docOpGate pure exclusion tests ──────────────────────────
  {
    const gatePath = pathToFileURL(resolveBuilt("docOpGate.js")).href;
    const gate = await import(gatePath);
    const {
      tryAcquireRead,
      releaseRead,
      tryAcquireDelete,
      releaseDelete,
      isReadActive,
      isDeleteActive,
      isAnyActive,
      __resetDocOpGateForTests,
    } = gate;

    __resetDocOpGateForTests();
    check("gate starts idle", isAnyActive() === false);

    // read/read exclusion
    check("first read acquires", tryAcquireRead() === true);
    check("second read excluded", tryAcquireRead() === false);
    check("read active while held", isReadActive() === true && isAnyActive() === true);
    releaseRead();
    check("release restores idle", isAnyActive() === false);
    check("read re-acquires after release", tryAcquireRead() === true);
    releaseRead();

    // delete/delete exclusion
    check("first delete acquires", tryAcquireDelete() === true);
    check("second delete excluded", tryAcquireDelete() === false);
    check("delete active while held", isDeleteActive() === true && isAnyActive() === true);
    releaseDelete();
    check("delete release restores idle", isAnyActive() === false);

    // read/delete exclusion
    check("read then delete excluded", (() => {
      __resetDocOpGateForTests();
      tryAcquireRead();
      const denied = tryAcquireDelete() === false;
      releaseRead();
      return denied;
    })());

    // delete/read exclusion
    check("delete then read excluded", (() => {
      __resetDocOpGateForTests();
      tryAcquireDelete();
      const denied = tryAcquireRead() === false;
      releaseDelete();
      return denied;
    })());

    // release restores both ways
    check("after delete release, read ok", (() => {
      __resetDocOpGateForTests();
      tryAcquireDelete();
      releaseDelete();
      return tryAcquireRead() === true;
    })());
    releaseRead();
    check("after read release, delete ok", (() => {
      __resetDocOpGateForTests();
      tryAcquireRead();
      releaseRead();
      return tryAcquireDelete() === true;
    })());
    releaseDelete();

    // Stale-cap must NOT release early: simulate holding READ across an
    // "abort" without calling releaseRead — second acquire still fails.
    check("stale-cap does not release early", (() => {
      __resetDocOpGateForTests();
      tryAcquireRead();
      // pretend stale-cap fired abort only (no release)
      const stillHeld = tryAcquireRead() === false && tryAcquireDelete() === false;
      // only finally releases
      releaseRead();
      return stillHeld && tryAcquireRead() === true;
    })());
    releaseRead();
    __resetDocOpGateForTests();
  }

  // ── reorderDocs strict permutation ─────────────────────────────────────
  {
    const a = sampleDoc({ id: "a", name: "A.pdf" });
    const b = sampleDoc({ id: "b", name: "B.pdf" });
    const c = sampleDoc({ id: "c", name: "C.pdf" });
    let s = emptyLibraryState();
    // Build [a, b, c] in that order via direct state (addDoc prepends).
    s = { docs: [a, b, c] };
    const ids = () => s.docs.map((d) => d.id).join(",");

    const identity = reorderDocs(s, ["a", "b", "c"]);
    check(
      "reorderDocs identity",
      identity.docs.map((d) => d.id).join(",") === "a,b,c",
      identity.docs.map((d) => d.id).join(","),
    );

    const mid = reorderDocs(s, ["a", "c", "b"]);
    check(
      "reorderDocs mid swap",
      mid.docs.map((d) => d.id).join(",") === "a,c,b",
      mid.docs.map((d) => d.id).join(","),
    );
    // Original unchanged.
    check("reorderDocs pure (no mutate)", ids() === "a,b,c");

    const rev = reorderDocs(s, ["c", "b", "a"]);
    check(
      "reorderDocs full reverse",
      rev.docs.map((d) => d.id).join(",") === "c,b,a",
      rev.docs.map((d) => d.id).join(","),
    );

    const missing = reorderDocs(s, ["a", "b", "zzz"]);
    check(
      "reorderDocs missing-id → unchanged",
      missing.docs.map((d) => d.id).join(",") === "a,b,c",
    );

    const dup = reorderDocs(s, ["a", "a", "b"]);
    check(
      "reorderDocs duplicate-id → unchanged",
      dup.docs.map((d) => d.id).join(",") === "a,b,c",
    );

    const empty = reorderDocs(s, []);
    check(
      "reorderDocs empty input → unchanged",
      empty.docs.map((d) => d.id).join(",") === "a,b,c",
    );

    const short = reorderDocs(s, ["a", "b"]);
    check(
      "reorderDocs length-mismatch → unchanged",
      short.docs.map((d) => d.id).join(",") === "a,b,c",
    );

    // addedAt never rewritten
    const reordered = reorderDocs(s, ["c", "a", "b"]);
    check(
      "reorderDocs preserves addedAt",
      reordered.docs[0].addedAt === c.addedAt &&
        reordered.docs[1].addedAt === a.addedAt,
    );
  }

  // ── makePreviewSnippet ─────────────────────────────────────────────────
  {
    check(
      "makePreviewSnippet empty → undefined",
      makePreviewSnippet("") === undefined &&
        makePreviewSnippet("   \n\t  ") === undefined,
    );
    check(
      "makePreviewSnippet short passthrough",
      makePreviewSnippet("hello world") === "hello world",
    );
    const long = "a".repeat(250);
    const snip = makePreviewSnippet(long);
    check(
      "makePreviewSnippet caps at 200 code points",
      typeof snip === "string" && Array.from(snip).length === 200,
      `len=${snip ? Array.from(snip).length : "undef"}`,
    );
    // Unicode-safe: emoji is one code point each; cut must not split surrogates.
    const emoji = "😀".repeat(210);
    const eSnip = makePreviewSnippet(emoji);
    check(
      "makePreviewSnippet Unicode-safe cut",
      typeof eSnip === "string" &&
        Array.from(eSnip).length === 200 &&
        eSnip === "😀".repeat(200),
      `len=${eSnip ? Array.from(eSnip).length : "undef"}`,
    );
    check(
      "makePreviewSnippet strips NUL",
      makePreviewSnippet("ab\u0000cd") === "abcd",
    );
    check(
      "makePreviewSnippet no NUL leakage",
      !String(makePreviewSnippet("x\u0000y\u0000z") ?? "").includes("\u0000"),
    );
  }

  // ── sanitizeDoc / parse round-trip previewUri ──────────────────────────
  {
    // Legacy: missing previewUri is fine.
    const legacy = sampleDoc({ id: "legacy-1" });
    delete legacy.previewUri;
    const sLegacy = addDoc(emptyLibraryState(), legacy);
    check(
      "sanitizeDoc accepts missing previewUri",
      sLegacy.docs[0]?.previewUri === undefined && sLegacy.docs[0]?.id === "legacy-1",
    );

    const withCover = sampleDoc({
      id: "cover-1",
      previewUri: "file:///data/kalsa-covers/cover-1.jpg",
    });
    const raw = serializeLibraryState(addDoc(emptyLibraryState(), withCover));
    const back = parseLibraryState(raw);
    check(
      "parseLibraryState round-trips previewUri",
      back.docs[0]?.previewUri === "file:///data/kalsa-covers/cover-1.jpg",
      `got=${back.docs[0]?.previewUri}`,
    );
  }

  // ── formatBytesLocalized + formatAddedBucket ───────────────────────────
  {
    check(
      "formatBytesLocalized en MB",
      /1\.4\s*MB/.test(formatBytesLocalized(1_400_000, "en")),
      formatBytesLocalized(1_400_000, "en"),
    );
    check(
      "formatBytesLocalized it MB",
      /1,4\s*MB/.test(formatBytesLocalized(1_400_000, "it")),
      formatBytesLocalized(1_400_000, "it"),
    );

    // Midnight-boundary: added at 23:30 local yesterday, now at 00:30 today → yesterday.
    const now = new Date();
    now.setHours(0, 30, 0, 0);
    const yest = new Date(now.getTime());
    yest.setDate(yest.getDate() - 1);
    yest.setHours(23, 30, 0, 0);
    check(
      "formatAddedBucket yesterday across midnight",
      formatAddedBucket(yest.getTime(), now.getTime()) === "yesterday",
    );
    const todayMorning = new Date(now.getTime());
    todayMorning.setHours(1, 0, 0, 0);
    check(
      "formatAddedBucket today",
      formatAddedBucket(todayMorning.getTime(), now.getTime()) === "today",
    );
    const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    check(
      "formatAddedBucket older",
      formatAddedBucket(weekAgo, now.getTime()) === "older",
    );
    check(
      "formatAddedDate returns non-empty",
      typeof formatAddedDate(weekAgo, "en") === "string" &&
        formatAddedDate(weekAgo, "en").length > 0,
    );
  }

  // ── FIX 5: extractionStatus timeout must NOT vision-fallback ───────────
  __resetDocumentChatBusyForTests();
  {
    check(
      "shouldUseVisionFallback timeout → false",
      shouldUseVisionFallback({ docCount: 0, extractionStatus: "timeout" }) === false,
    );
    check(
      "shouldUseVisionFallback no_text_layer → true",
      shouldUseVisionFallback({ docCount: 0, extractionStatus: "no_text_layer" }) === true,
    );
    check(
      "shouldUseVisionFallback ok empty → true",
      shouldUseVisionFallback({ docCount: 0, extractionStatus: "ok" }) === true,
    );
    check(
      "shouldUseVisionFallback renderer_error → false",
      shouldUseVisionFallback({ docCount: 0, extractionStatus: "renderer_error" }) === false,
    );
    check(
      "shouldUseVisionFallback legacy absent → true",
      shouldUseVisionFallback({ docCount: 0 }) === true,
    );
    check(
      "shouldUseVisionFallback with text → false",
      shouldUseVisionFallback({ docCount: 2, extractionStatus: "timeout" }) === false,
    );

    // Persist round-trip
    const timedOut = sampleDoc({
      id: "to1",
      docCount: 0,
      pageCount: 5,
      estimatedTokens: 0,
      extractionStatus: "timeout",
    });
    const serialized = serializeLibraryState(addDoc(emptyLibraryState(), timedOut));
    const parsed = parseLibraryState(serialized);
    check(
      "extractionStatus timeout persists through serialize/parse",
      parsed.docs[0]?.extractionStatus === "timeout" && parsed.docs[0]?.docCount === 0,
    );

    const host = {
      getLibraryDocs: () => [
        sampleDoc({
          id: "timeout-doc",
          docCount: 0,
          pageCount: 5,
          estimatedTokens: 0,
          extractionStatus: "timeout",
        }),
      ],
      requestPdfText: async () => {
        throw Object.assign(new Error("timed out"), { code: "timeout" });
      },
      readTxt: async () => "",
      getCtxTokens: () => 4096,
      getIndexFor: () => null,
    };
    const exec = createDocumentChatExecutor(host);
    const out = await exec("document_chat", { query: "summary", docId: "timeout-doc" });
    check(
      "tool extraction timeout → error NOT vision_fallback",
      out.strategy === "error" &&
        !out.text.includes(DOCUMENT_CHAT_VISION_MARKER) &&
        typeof out.error === "string" &&
        out.error.length > 0,
    );

    const hostScan = {
      getLibraryDocs: () => [
        sampleDoc({
          id: "scan2",
          docCount: 0,
          pageCount: 4,
          estimatedTokens: 0,
          extractionStatus: "no_text_layer",
        }),
      ],
      requestPdfText: async () => ({ docs: [], skippedPages: [1, 2, 3, 4] }),
      readTxt: async () => "",
      getCtxTokens: () => 4096,
      getIndexFor: () => null,
    };
    const execScan = createDocumentChatExecutor(hostScan);
    const outScan = await execScan("document_chat", { query: "summary", docId: "scan2" });
    check(
      "tool no_text_layer still vision_fallback",
      outScan.strategy === "vision_fallback" &&
        outScan.text.includes(DOCUMENT_CHAT_VISION_MARKER),
    );
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
