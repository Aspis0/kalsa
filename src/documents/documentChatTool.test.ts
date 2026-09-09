import {
  buildAnswerLanguageCue,
  createDocumentChatExecutor,
  DOCUMENT_CHAT_FULL_CONTEXT_MAX_CHARS,
  DOCUMENT_CHAT_TOOL_BODY_BUDGET_CHARS,
  isDocumentChatBusy,
  __resetDocumentChatBusyForTests,
  type DocumentChatHost,
} from "./documentChatTool";
import { SemanticVectorIndex } from "./semanticIndex";
import { decideDocStrategy, type LibraryDoc } from "./DocumentLibrary";

const doc: LibraryDoc = {
  id: "doc-1",
  name: "Notes.pdf",
  sourceId: "notes",
  kind: "pdf",
  addedAt: 1,
  sizeBytes: 100,
  docCount: 1,
  estimatedTokens: 20_000,
  fileUri: "file:///notes.pdf",
};

const pageText =
  "Apples are harvested in autumn. The orchard stores fruit in a cool room. " +
  "These notes describe the seasonal harvest and storage process.";

function host(overrides: Partial<DocumentChatHost> = {}): DocumentChatHost {
  return {
    getLibraryDocs: () => [doc],
    requestPdfText: async () => ({
      docs: [{ docId: "notes#p1", title: "Page 1", text: pageText }],
      skippedPages: [],
    }),
    readTxt: async () => "",
    getCtxTokens: () => 4096,
    getIndexFor: () => null,
    ...overrides,
  };
}

function selectionHost(
  docs: LibraryDoc[],
  activeAttachment?: DocumentChatHost["getActiveAttachment"],
): DocumentChatHost {
  return host({
    getLibraryDocs: () => docs,
    getActiveAttachment: activeAttachment,
    requestPdfText: async (selected) => ({
      docs: [
        {
          docId: `${selected.sourceId}#p1`,
          title: selected.name,
          text: `Selected ${selected.id}. ${pageText}`,
        },
      ],
      skippedPages: [],
    }),
  });
}

beforeEach(() => {
  __resetDocumentChatBusyForTests();
});

afterEach(() => {
  __resetDocumentChatBusyForTests();
});

describe("document_chat executor", () => {
  test("returns an error for an empty library", async () => {
    const exec = createDocumentChatExecutor(host({ getLibraryDocs: () => [] }));
    const result = await exec("document_chat", { query: "Where?" });

    expect(result.strategy).toBe("error");
    expect(result.error).toMatch(/document/i);
  });

  test("selects an exact library id first", async () => {
    const other = { ...doc, id: "doc-2", name: "Other.pdf", sourceId: "other" };
    const exec = createDocumentChatExecutor(selectionHost([doc, other]));
    const result = await exec("document_chat", { query: "apples", docId: "doc-2" });

    expect(result.strategy).not.toBe("error");
    expect(result.text).toMatch(/Selected doc-2/);
  });

  test("matches a document filename stem case-insensitively", async () => {
    const named = { ...doc, id: "library-id", name: "Small Condominium Notice IT.pdf" };
    const other = { ...doc, id: "doc-2", name: "Other.pdf", sourceId: "other" };
    const exec = createDocumentChatExecutor(selectionHost([named, other]));
    const result = await exec("document_chat", {
      query: "apples",
      docId: "small_condominium_notice_it",
    });

    expect(result.strategy).not.toBe("error");
    expect(result.text).toMatch(/Selected library-id/);
  });

  test("uses the only library document when docId is absent", async () => {
    const exec = createDocumentChatExecutor(selectionHost([doc]));
    const result = await exec("document_chat", { query: "apples" });

    expect(result.strategy).not.toBe("error");
    expect(result.text).toMatch(/Selected doc-1/);
  });

  test("prefixes a not-found line when docId matches nothing and one doc exists", async () => {
    const exec = createDocumentChatExecutor(selectionHost([doc]));
    const result = await exec("document_chat", {
      query: "apples",
      docId: "missing-document",
    });

    expect(result.strategy).not.toBe("error");
    expect(result.text).toMatch(/missing-document/);
    expect(result.text).toMatch(/only available document/);
    expect(result.text).toMatch(/Selected doc-1/);
  });

  test("routes a 40-page text document to retrieval", () => {
    expect(
      decideDocStrategy({
        docCount: 40,
        estimatedTokens: 20_000,
        ctxTokens: 16_384,
      }),
    ).toBe("retrieve");
  });

  test("retrieves a match from page 31 of a 40-page PDF", async () => {
    const manual: LibraryDoc = {
      ...doc,
      id: "manual",
      sourceId: "manual",
      name: "Manual.pdf",
      docCount: 40,
      estimatedTokens: 20_000,
    };
    const exec = createDocumentChatExecutor(
      host({
        getLibraryDocs: () => [manual],
        requestPdfText: async () => ({
          docs: Array.from({ length: 40 }, (_, index) => ({
            docId: `manual#p${index + 1}`,
            title: `Page ${index + 1}`,
            text:
              index === 30
                ? "The buriedword-31 procedure is documented here."
                : `General manual text for page ${index + 1}.`,
          })),
          skippedPages: [],
        }),
      }),
    );
    const result = await exec("document_chat", { query: "buriedword-31" });

    expect(result.strategy).toBe("retrieve");
    expect(result.passages.some((passage) => passage.docId === "manual#p31")).toBe(true);
  });

  test("uses the active document attachment when the library is ambiguous", async () => {
    const other = { ...doc, id: "doc-2", name: "Other.pdf", sourceId: "other" };
    const exec = createDocumentChatExecutor(
      selectionHost([doc, other], () => ({ libraryDocId: "doc-2", name: "Other.pdf" })),
    );
    const result = await exec("document_chat", { query: "apples" });

    expect(result.strategy).not.toBe("error");
    expect(result.text).toMatch(/Selected doc-2/);
  });

  test("lists available documents when selection remains ambiguous", async () => {
    const other = { ...doc, id: "doc-2", name: "Other.pdf", sourceId: "other" };
    const exec = createDocumentChatExecutor(selectionHost([doc, other]));
    const result = await exec("document_chat", {
      query: "apples",
      docId: "missing-document",
    });

    expect(result.strategy).toBe("error");
    expect(result.error).toMatch(/doc-1.*Notes\.pdf/);
    expect(result.error).toMatch(/doc-2.*Other\.pdf/);
  });

  test("ignores the active attachment for an unmatched explicit docId", async () => {
    const other = { ...doc, id: "doc-2", name: "Other.pdf", sourceId: "other" };
    const exec = createDocumentChatExecutor(
      selectionHost([doc, other], () => ({ libraryDocId: "doc-2", name: "Other.pdf" })),
    );
    const result = await exec("document_chat", {
      query: "apples",
      docId: "missing-document",
    });

    expect(result.strategy).toBe("error");
    expect(result.error).toMatch(/Available documents: doc-1/);
    expect(result.error).toMatch(/doc-2 — Other\.pdf/);
  });

  test("forwards abort to the host and returns an aborted error", async () => {
    let sawSignal = false;
    const pendingHost = host({
      getLibraryDocs: () => [{ ...doc, kind: "txt" }],
      readTxt: async (_doc, options) => {
        sawSignal = Boolean(options?.signal);
        await new Promise<never>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(new Error("document_chat aborted")),
            { once: true },
          );
        });
        throw new Error("unreachable");
      },
    });
    const exec = createDocumentChatExecutor(pendingHost);
    const controller = new AbortController();
    const promise = exec("document_chat", { query: "Where?" }, controller.signal);
    await Promise.resolve();
    controller.abort();
    const result = await promise;

    expect(sawSignal).toBe(true);
    expect(result.strategy).toBe("error");
    expect(result.error).toMatch(/abort/i);
  });

  test("uses BM25-only when the dense arm is unavailable", async () => {
    const exec = createDocumentChatExecutor(
      host({
        isEmbedderDownloaded: () => false,
        getSemanticIndexFor: () => null,
      }),
    );
    const result = await exec("document_chat", { query: "apples" });

    expect(result.strategy).toBe("bm25_only");
    expect(result.denseUnavailableReason).toBe("no_embedder");
    expect(result.passages.length).toBeGreaterThan(0);
    expect(result.text).toMatch(/apples/i);
  });

  test("runs hybrid retrieval through the public executor when vectors exist", async () => {
    const index = new SemanticVectorIndex({ dims: 2 });
    index.addVectors([
      {
        chunkId: "notes#p1#sentence#0",
        vector: new Float32Array([1, 0]),
        text: "Apples are harvested in autumn.",
      },
    ]);
    const exec = createDocumentChatExecutor(
      host({
        isEmbedderDownloaded: () => true,
        getSemanticIndexFor: () => index,
        embedQuery: async () => new Float32Array([1, 0]),
      }),
    );
    const result = await exec("document_chat", { query: "apples" });

    expect(result.strategy).toBe("hybrid");
    expect(result.denseUnavailableReason).toBeNull();
    expect(result.passages[0]?.chunkId).toBe("notes#p1#paragraph#0");
    expect(result.passages.some((passage) => passage.chunkId === "notes#p1#sentence#0")).toBe(true);
  });

  test("refuses an overlapping call while the first call holds the latch", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const exec = createDocumentChatExecutor(
      host({
        getLibraryDocs: () => [{ ...doc, kind: "txt" }],
        readTxt: async () => {
          await gate;
          return pageText;
        },
      }),
    );
    const first = exec("document_chat", { query: "apples" });
    await Promise.resolve();
    expect(isDocumentChatBusy()).toBe(true);

    const second = await exec("document_chat", { query: "storage" });
    expect(second.strategy).toBe("error");
    expect(second.error).toMatch(/busy/i);

    release();
    await first;
  });
});

describe("answer-language cue", () => {
  test("builds an English instruction with the locale's language name as tie-break", () => {
    expect(buildAnswerLanguageCue("it")).toBe(
      "Answer in the language of the user's question (if unclear, Italian). " +
        "Quote passages in their original language.",
    );
    expect(buildAnswerLanguageCue("en")).toBe(
      "Answer in the language of the user's question (if unclear, English). " +
        "Quote passages in their original language.",
    );
  });

  test("lands at the END of the retrieval tool result, inside the body budget", async () => {
    const exec = createDocumentChatExecutor(host({ isEmbedderDownloaded: () => false }), {
      locale: "it",
    });
    const result = await exec("document_chat", { query: "apples" });

    expect(result.strategy).toBe("bm25_only");
    expect(result.text.endsWith(buildAnswerLanguageCue("it"))).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(
      DOCUMENT_CHAT_TOOL_BODY_BUDGET_CHARS,
    );
  });

  test("lands at the END of the full_context result and survives the tool-body budget cap", async () => {
    const longDoc: LibraryDoc = {
      ...doc,
      id: "long",
      sourceId: "long",
      name: "Long.pdf",
      // Small enough that decideDocStrategy picks full_context.
      docCount: 1,
      estimatedTokens: 400,
    };
    const exec = createDocumentChatExecutor(
      host({
        getLibraryDocs: () => [longDoc],
        requestPdfText: async () => ({
          docs: [
            {
              docId: "long#p1",
              title: "Page 1",
              text: "".padEnd(DOCUMENT_CHAT_FULL_CONTEXT_MAX_CHARS + 10, "w"),
            },
          ],
          skippedPages: [],
        }),
      }),
      { locale: "en" },
    );
    const result = await exec("document_chat", { query: "apples" });

    expect(result.strategy).toBe("full_context");
    expect(result.text.endsWith(buildAnswerLanguageCue("en"))).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(
      DOCUMENT_CHAT_TOOL_BODY_BUDGET_CHARS,
    );
  });

  test("keeps the cue at the end with many tiny passages (numbered prefixes never eat it)", async () => {
    const tiny: LibraryDoc = {
      ...doc,
      id: "tiny",
      sourceId: "tiny",
      name: "Tiny.pdf",
      docCount: 20,
      estimatedTokens: 20_000,
    };
    const exec = createDocumentChatExecutor(
      host({
        getLibraryDocs: () => [tiny],
        isEmbedderDownloaded: () => false,
        requestPdfText: async () => ({
          docs: Array.from({ length: 20 }, (_, index) => ({
            docId: `tiny#p${index + 1}`,
            title: `Page ${index + 1}`,
            // ~90 chars per page: 15+ passages saturate the 1800-char text
            // budget while every numbered citation prefix adds ~10 chars.
            text: "berry ".repeat(15),
          })),
          skippedPages: [],
        }),
      }),
      { locale: "en" },
    );
    const result = await exec("document_chat", { query: "berry" });

    expect(result.strategy).toBe("bm25_only");
    expect(result.passages.length).toBeGreaterThan(0);
    // Whatever the cap did to the passage body, the cue is never sliced:
    expect(result.text.endsWith(buildAnswerLanguageCue("en"))).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(
      DOCUMENT_CHAT_TOOL_BODY_BUDGET_CHARS,
    );
  });
});
