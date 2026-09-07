import {
  createDocumentChatExecutor,
  isDocumentChatBusy,
  __resetDocumentChatBusyForTests,
  type DocumentChatHost,
} from "./documentChatTool";
import { SemanticVectorIndex } from "./semanticIndex";
import type { LibraryDoc } from "./DocumentLibrary";

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
