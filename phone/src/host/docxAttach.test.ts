/**
 * The .docx import (`docxAttach.ts`) through its ports — each test names the
 * refusal it catches: both caps, every `DocxExtractError` code, the storage
 * failure, the unmount race, a library that refuses, and the entry that
 * finally commits. The controller's own order and catalogue lines are the
 * expectation (`AiChatPage.tsx:3723-3830`).
 */
import { readFileSync } from "fs";
import { join } from "path";
import { TXT_CAP_BYTES, importAndAttachDocx, type DocxAttachPorts } from "./docxAttach";
import { PDF_CAP_NOTICE } from "./attachments";
import type { TranslationKey } from "../i18n";
import type { LibraryDoc } from "../documents/DocumentLibrary";

function harness(overrides: Partial<DocxAttachPorts> = {}) {
  const notices: Array<{ key: TranslationKey; params?: Record<string, string | number> }> = [];
  const committed: LibraryDoc[] = [];
  const attached: Array<{ id: string; name: string }> = [];
  const deleted: string[] = [];
  const ports: DocxAttachPorts = {
    count: () => 0,
    notice: (key, params) => notices.push({ key, params }),
    resolveSizeBytes: async () => 1024,
    withinLimits: () => ({ ok: true }),
    extractText: async () => "body text",
    containerCapLabel: "50 MB",
    textCapLabel: "10 MB",
    byteLength: (text) => text.length,
    nextDocId: () => "doc-new",
    writeOwnedText: async (id) => `file:///owned/${id}.txt`,
    deleteOwnedFile: async (uri) => {
      deleted.push(uri);
    },
    addDocument: (entry) => {
      committed.push(entry);
      return true;
    },
    attachDocument: (doc) => attached.push(doc),
    now: () => 123,
    estimateTokens: (text) => Math.ceil(text.length / 4),
    isMounted: () => true,
    ...overrides,
  };
  const run = (uri = "file:///pick.docx", name = "report.docx") =>
    importAndAttachDocx(uri, name, ports);
  return { ports, run, notices, committed, attached, deleted };
}

describe("the controller's order: cap, then `importingWord`, then the checks", () => {
  it("a full row refuses BEFORE any notice of progress", async () => {
    const h = harness({ count: () => 5 });
    expect(await h.run()).toBe(false);
    expect(h.notices).toEqual([{ key: PDF_CAP_NOTICE, params: { max: 5 } }]);
  });

  it("`documents.importingWord` is the first thing a real import says", async () => {
    const h = harness();
    expect(await h.run()).toBe(true);
    expect(h.notices[0]).toEqual({ key: "documents.importingWord", params: undefined });
  });

  it("a second cap check guards the commit (a share-in attach can land mid-read)", async () => {
    let calls = 0;
    const h = harness({ count: () => (calls++ === 0 ? 0 : 5) });
    expect(await h.run()).toBe(false);
    expect(h.notices.map((n) => n.key)).toEqual([
      "documents.importingWord",
      PDF_CAP_NOTICE,
    ]);
    expect(h.committed).toHaveLength(0);
  });
});

describe("the container and text caps keep their controller lines", () => {
  it("an unknown container size fails closed on errorDocx; empty and too large name their reasons", async () => {
    const unknown = harness({ withinLimits: () => ({ ok: false, reason: "unknown" }) });
    await unknown.run();
    expect(unknown.notices.at(-1)).toEqual({ key: "documents.errorDocx", params: undefined });

    const empty = harness({ withinLimits: () => ({ ok: false, reason: "empty" }) });
    await empty.run();
    expect(empty.notices.at(-1)).toEqual({ key: "documents.errorEmpty", params: undefined });

    const big = harness({ withinLimits: () => ({ ok: false, reason: "too_large" }) });
    await big.run();
    expect(big.notices.at(-1)).toEqual({
      key: "documents.errorTooLarge",
      params: { max: "50 MB" },
    });
  });

  it("an inflated text over the 10 MiB cap is refused with the TEXT label", async () => {
    const h = harness({ byteLength: () => TXT_CAP_BYTES + 1 });
    expect(await h.run()).toBe(false);
    expect(h.notices.at(-1)).toEqual({
      key: "documents.errorTooLarge",
      params: { max: "10 MB" },
    });
    expect(h.committed).toHaveLength(0);
  });

  it("the mirrored cap is byte-identical to documentStorage's constant (drift guard)", () => {
    const source = readFileSync(
      join(__dirname, "..", "documents", "documentStorage.ts"),
      "utf8",
    );
    expect(source).toContain("MAX_TEXT_BYTES = 10 * 1024 * 1024");
    expect(TXT_CAP_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe("extraction failures map by the DocxExtractError code", () => {
  const failing = (code: string | null) =>
    harness({
      extractText: async () =>
        Promise.reject(
          code === null ? new Error("boom") : Object.assign(new Error(code), { code }),
        ),
    });

  it("DOCX_EMPTY → errorEmpty, DOCX_TOO_LARGE → errorTooLarge(text label)", async () => {
    const empty = failing("DOCX_EMPTY");
    await empty.run();
    expect(empty.notices.at(-1)).toEqual({ key: "documents.errorEmpty", params: undefined });
    const large = failing("DOCX_TOO_LARGE");
    await large.run();
    expect(large.notices.at(-1)).toEqual({
      key: "documents.errorTooLarge",
      params: { max: "10 MB" },
    });
  });

  it("any other failure (or a non-Docx error) → errorDocx, never a crash", async () => {
    const coded = failing("DOCX_NOT_ZIP");
    await coded.run();
    expect(coded.notices.at(-1)).toEqual({ key: "documents.errorDocx", params: undefined });
    const raw = failing(null);
    await raw.run();
    expect(raw.notices.at(-1)).toEqual({ key: "documents.errorDocx", params: undefined });
  });
});

describe("the owned file is never leaked, and never committed without its row", () => {
  it("NO_DOCUMENT_DIRECTORY → errorStorage; any other write error → errorDocx", async () => {
    const noDir = harness({
      writeOwnedText: async () => Promise.reject(new Error("NO_DOCUMENT_DIRECTORY")),
    });
    expect(await noDir.run()).toBe(false);
    expect(noDir.notices.at(-1)).toEqual({ key: "documents.errorStorage", params: undefined });

    const other = harness({
      writeOwnedText: async () => Promise.reject(new Error("disk gone")),
    });
    await other.run();
    expect(other.notices.at(-1)).toEqual({ key: "documents.errorDocx", params: undefined });
  });

  it("unmounted AFTER the write → the owned file is deleted, nothing commits", async () => {
    let mounted = true;
    const h = harness({
      writeOwnedText: async (id) => {
        mounted = false;
        return `file:///owned/${id}.txt`;
      },
      isMounted: () => mounted,
    });
    expect(await h.run()).toBe(false);
    expect(h.deleted).toEqual(["file:///owned/doc-new.txt"]);
    expect(h.committed).toHaveLength(0);
    expect(h.attached).toHaveLength(0);
  });

  it("a library that refuses (delete gate held) → errorBusy + owned file deleted", async () => {
    const h = harness({ addDocument: () => false });
    expect(await h.run()).toBe(false);
    expect(h.deleted).toEqual(["file:///owned/doc-new.txt"]);
    expect(h.notices.at(-1)).toEqual({ key: "documents.errorBusy", params: undefined });
    expect(h.attached).toHaveLength(0);
  });
});

describe("the commit: library entry first, then the composer row (controller:3824-3828)", () => {
  it("a success writes the controller's entry fields and attaches with id + name", async () => {
    const h = harness();
    expect(await h.run()).toBe(true);
    expect(h.committed).toHaveLength(1);
    expect(h.committed[0]).toEqual({
      id: "doc-new",
      name: "report.docx",
      sourceId: "doc-new",
      kind: "txt",
      addedAt: 123,
      sizeBytes: "body text".length,
      docCount: 1,
      fileUri: "file:///owned/doc-new.txt",
      extractionStatus: "ok",
      estimatedTokens: Math.ceil("body text".length / 4),
    });
    expect(h.attached).toEqual([{ id: "doc-new", name: "report.docx" }]);
    expect(h.deleted).toHaveLength(0);
  });
});
