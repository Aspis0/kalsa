/**
 * The file half of share-in (`AppShell.tsx:3583-3637`), pinned through its
 * ports so the branch order and the notice mapping run in node:
 *
 * - TOO LARGE and FAILED each serve their notice for `.txt`/`.md` reads;
 * - BUSY serves its notice while an import is in flight (the controller's
 *   `shareImportingRef`) and when the library refuses the entry;
 * - a successful PDF import lands in Documents AND joins the composer's
 *   attachment rows — the controller's `setShareAttachDoc` (`App:3616-3621`),
 *   silently, as the controller did. BEFORE the attach flow this test pinned
 *   an adaptation notice (`errors.shareImportNotAttached`); that key was
 *   deleted with the flow's arrival, and the attach PORT is now asserted;
 * - every notice key this file can fire exists in BOTH catalogues.
 */
import { en as enCatalog } from "../i18n/en";
import { it as itCatalog } from "../i18n/it";
import { SHARE_TEXT_CAP, SHARE_TEXT_FILE_MAX_BYTES } from "../app/shareIntent";
import { applyShareFile, type ShareFilePorts } from "./shareImport";
import type { LibraryDoc } from "../documents/DocumentLibrary";
import type { TranslationKey } from "../i18n";

function sharedDoc(id = "doc-1"): LibraryDoc {
  return {
    id,
    name: "shared.pdf",
    sourceId: id,
    kind: "pdf",
    addedAt: 1,
    sizeBytes: 128,
    docCount: 1,
    fileUri: "file:///owned/shared.pdf",
  };
}

function harness(overrides: Partial<ShareFilePorts> = {}) {
  const notices: TranslationKey[] = [];
  const prefills: string[] = [];
  const imported: string[] = [];
  const attached: string[] = [];
  let importing = false;
  const ports: ShareFilePorts = {
    getInfo: async () => ({ exists: true, isDirectory: false, size: 16 }),
    readText: async () => "shared text",
    importPdf: async (uri) => {
      imported.push(uri);
      return sharedDoc();
    },
    addDocument: () => true,
    attach: (entry) => attached.push(entry.id),
    isImporting: () => importing,
    setImporting: (busy) => {
      importing = busy;
    },
    notice: (key) => notices.push(key),
    prefill: (text) => prefills.push(text),
    ...overrides,
  };
  return { ports, notices, prefills, imported, attached, isBusy: () => importing };
}

describe("the .txt/.md read (App:3583-3610)", () => {
  test("a file over the cap is too large — notice, no prefill, no import", async () => {
    const h = harness({ getInfo: async () => ({ exists: true, size: SHARE_TEXT_FILE_MAX_BYTES + 1 }) });
    await applyShareFile("file:///shared/notes.md", h.ports);
    expect(h.notices).toEqual(["errors.shareImportTooLarge"]);
    expect(h.prefills).toEqual([]);
    expect(h.imported).toEqual([]);
  });

  test("a missing file, a directory and an unreadable size each fail loudly", async () => {
    const missing = harness({ getInfo: async () => ({ exists: false }) });
    await applyShareFile("file:///nope.txt", missing.ports);
    const directory = harness({ getInfo: async () => ({ exists: true, isDirectory: true }) });
    await applyShareFile("file:///folder.txt", directory.ports);
    const sizeless = harness({ getInfo: async () => ({ exists: true }) });
    await applyShareFile("file:///sizeless.txt", sizeless.ports);
    expect(missing.notices).toEqual(["errors.shareImportFailed"]);
    expect(directory.notices).toEqual(["errors.shareImportFailed"]);
    expect(sizeless.notices).toEqual(["errors.shareImportFailed"]);
  });

  test("a failed read fails loudly and never falls into the PDF import", async () => {
    const h = harness({ readText: async () => Promise.reject(new Error("io")) });
    await applyShareFile("file:///shared/notes.txt", h.ports);
    expect(h.notices).toEqual(["errors.shareImportFailed"]);
    expect(h.imported).toEqual([]);
  });

  test("a readable text file prefills, clipped to the controller's cap", async () => {
    const body = "y".repeat(SHARE_TEXT_CAP + 500);
    const h = harness({ readText: async () => body });
    await applyShareFile("file:///shared/notes.TXT", h.ports);
    expect(h.prefills).toHaveLength(1);
    expect(h.prefills[0]).toHaveLength(SHARE_TEXT_CAP);
    expect(h.notices).toEqual([]);
  });

  test("a whitespace-only text file falls through to the import, as the controller does", async () => {
    const h = harness({ readText: async () => "   \n" });
    await applyShareFile("file:///shared/empty.md", h.ports);
    expect(h.prefills).toEqual([]);
    expect(h.imported).toEqual(["file:///shared/empty.md"]);
    // The import succeeded, so it attached — success serves NO notice.
    expect(h.attached).toEqual(["doc-1"]);
    expect(h.notices).toEqual([]);
  });
});

describe("the PDF import (App:3611-3636)", () => {
  test("a successful import lands in Documents AND attaches — silently, as the controller did", async () => {
    // BEFORE the attach flow this asserted the adaptation notice
    // `errors.shareImportNotAttached`; the flow landed, so the controller's
    // real behaviour is back: import + attach, no notice on success.
    const h = harness();
    await applyShareFile("file:///shared/paper.pdf", h.ports);
    expect(h.imported).toEqual(["file:///shared/paper.pdf"]);
    expect(h.attached).toEqual(["doc-1"]);
    expect(h.notices).toEqual([]);
    // The flag always releases — the finally half of the controller's block.
    expect(h.isBusy()).toBe(false);
  });

  test("a library that refuses the entry maps to the busy notice", async () => {
    const h = harness({ addDocument: () => false });
    await applyShareFile("file:///shared/paper.pdf", h.ports);
    expect(h.notices).toEqual(["errors.shareImportBusy"]);
    expect(h.isBusy()).toBe(false);
  });

  test("SharedImportError codes map: too_large, busy, everything else failed", async () => {
    const tooLarge = harness({
      importPdf: async () => {
        throw Object.assign(new Error("too_large"), { code: "too_large" });
      },
    });
    await applyShareFile("file:///shared/huge.pdf", tooLarge.ports);
    expect(tooLarge.notices).toEqual(["errors.shareImportTooLarge"]);

    const busy = harness({
      importPdf: async () => {
        throw Object.assign(new Error("busy"), { code: "busy" });
      },
    });
    await applyShareFile("file:///shared/busy.pdf", busy.ports);
    expect(busy.notices).toEqual(["errors.shareImportBusy"]);

    const failed = harness({
      importPdf: async () => {
        throw new Error("renderer gone");
      },
    });
    await applyShareFile("file:///shared/broken.pdf", failed.ports);
    expect(failed.notices).toEqual(["errors.shareImportFailed"]);
    expect(failed.isBusy()).toBe(false);
  });

  test("a share arriving mid-import gets the busy notice — one import at a time", async () => {
    let release: (doc: LibraryDoc) => void = () => undefined;
    const gate = new Promise<LibraryDoc>((resolve) => {
      release = resolve;
    });
    const h = harness({ importPdf: () => gate });
    const first = applyShareFile("file:///shared/one.pdf", h.ports);
    expect(h.isBusy()).toBe(true);
    await applyShareFile("file:///shared/two.pdf", h.ports);
    expect(h.notices).toEqual(["errors.shareImportBusy"]);
    release(sharedDoc("doc-2"));
    await first;
    expect(h.isBusy()).toBe(false);
    // The first import finished its own path after the busy refusal — it
    // attached (the gate released with doc-2); only the refusal spoke.
    expect(h.notices).toEqual(["errors.shareImportBusy"]);
    expect(h.attached).toEqual(["doc-2"]);
  });
});

describe("both catalogues carry every notice this flow can fire", () => {
  test("failed / too large / busy resolve in en and it (the adaptation key is deleted)", () => {
    const keys = [
      "errors.shareImportFailed",
      "errors.shareImportTooLarge",
      "errors.shareImportBusy",
    ] as const;
    const flatten = (catalog: object, prefix = ""): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(catalog)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === "string") out[path] = value;
        else if (value && typeof value === "object") Object.assign(out, flatten(value, path));
      }
      return out;
    };
    const enFlat = flatten(enCatalog);
    const itFlat = flatten(itCatalog);
    for (const key of keys) {
      expect(typeof enFlat[key]).toBe("string");
      expect(typeof itFlat[key]).toBe("string");
      expect(itFlat[key]).not.toBe(enFlat[key]);
    }
  });
});
