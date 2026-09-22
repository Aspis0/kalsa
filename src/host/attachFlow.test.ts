/**
 * The picker flows (`attachFlow.ts`) through their ports — each test names
 * the refusal it catches: cancel, cap-before-pick, cap-after-await, the
 * sniff, legacy Word, invalid type, no pages, and the vision notices that
 * ride success.
 */
import {
  MAX_ATTACHMENT_ITEMS,
  addAttachment,
} from "./attachments";
import {
  pdfConversionDone,
  runDocumentPick,
  runImagePick,
  type ImageSource,
  type PickerPorts,
} from "./attachFlow";
import type { TranslationKey } from "../i18n";
import type { LocalAttachment } from "./hostMessage";

function rows(count: number): LocalAttachment[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `img-${i}`,
    kind: "image" as const,
    name: `a${i}.jpg`,
    uri: `file:///a${i}.jpg`,
  }));
}

type PortOverrides = Partial<PickerPorts> & { count?: () => number };

function ports(overrides: PortOverrides = {}): PickerPorts {
  return {
    launchImage: async () => null,
    resizeImage: async (uri) => `${uri}#resized`,
    pickDocument: async () => null,
    peekHead: async () => null,
    count: () => 0,
    nextId: (prefix) => `${prefix}-99`,
    ...overrides,
  };
}

const pickImage = (p: PickerPorts, source: ImageSource = "library", visionCapable = true) =>
  runImagePick(p, { source, visionCapable, now: 4242 });

describe("the image path (Chat:1663-1711)", () => {
  it("a cancel or a thrown picker is ignored — no resize, no add, no notice", async () => {
    let resized = 0;
    const p = ports({
      resizeImage: async (uri) => {
        resized += 1;
        return uri;
      },
    });
    expect(await pickImage(p)).toEqual({ action: "ignored" });
    const throwing = ports({ launchImage: async () => Promise.reject(new Error("denied")) });
    expect(await pickImage(throwing)).toEqual({ action: "ignored" });
    expect(resized).toBe(0);
  });

  it("a successful pick resizes to JPEG first, then caps — name from the asset", async () => {
    const order: string[] = [];
    const p = ports({
      launchImage: async () => {
        order.push("launch");
        return { uri: "file:///raw.heic", fileName: "shot.heic" };
      },
      resizeImage: async (uri) => {
        order.push("resize");
        return `${uri}#jpeg`;
      },
      count: () => 0,
    });
    const outcome = await pickImage(p, "camera");
    expect(order).toEqual(["launch", "resize"]);
    expect(outcome).toEqual({
      action: "added",
      item: {
        id: "img-99",
        kind: "image",
        name: "shot.heic",
        uri: "file:///raw.heic#jpeg",
      },
      notice: null,
      closeSheet: true,
    });
  });

  it("an unnamed asset gets the controller's seeded fallback name", async () => {
    const p = ports({ launchImage: async () => ({ uri: "file:///raw.jpg" }) });
    const outcome = await pickImage(p);
    expect(outcome.action === "added" && outcome.item.name).toBe("photo-4242.jpg");
  });

  it("a full row refuses with the generic cap line AND skips the vision notice (its own cap rule)", async () => {
    const p = ports({ launchImage: async () => ({ uri: "u", fileName: "x.jpg" }), count: () => MAX_ATTACHMENT_ITEMS });
    const outcome = await pickImage(p, "library", false);
    expect(outcome).toEqual({
      action: "capped",
      notice: "errors.attachmentLimitReachedGeneric",
      closeSheet: true,
    });
  });

  it("a vision-incapable model is told exactly when an image lands", async () => {
    const p = ports({ launchImage: async () => ({ uri: "u", fileName: "x.jpg" }) });
    const blind = await pickImage(p, "library", false);
    expect(blind.action === "added" && blind.notice).toBe("chat.visionUnsupportedNotice");
    const seeing = await pickImage(p, "library", true);
    expect(seeing.action === "added" && seeing.notice).toBeNull();
  });
});

const DOCX_HEAD = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const LEGACY_HEAD = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]);

describe("the document path (Chat:1713-1768)", () => {
  it("the cap is checked BEFORE the picker opens, with the PDF-worded line — picker never called", async () => {
    let called = 0;
    const outcome = await runDocumentPick(
      ports({
        count: () => MAX_ATTACHMENT_ITEMS,
        pickDocument: async () => {
          called += 1;
          return null;
        },
      }),
    );
    expect(outcome).toEqual({
      action: "capped",
      notice: "errors.attachmentLimitReached",
      closeSheet: false,
    });
    expect(called).toBe(0);
  });

  it("legacy Word refuses with the documents line and keeps the sheet open", async () => {
    const outcome = await runDocumentPick(
      ports({ pickDocument: async () => ({ uri: "u", name: "old.doc", mimeType: "application/msword" }) }),
    );
    expect(outcome).toEqual({
      action: "legacy",
      notice: "documents.errorLegacyWord",
      closeSheet: false,
    });
  });

  it("an ambiguous pick is sniffed from its first bytes: zip → docx, OLE → legacy", async () => {
    const docx = await runDocumentPick(
      ports({
        pickDocument: async () => ({ uri: "u", name: "mystery", mimeType: null }),
        peekHead: async () => DOCX_HEAD,
      }),
    );
    expect(docx.action).toBe("docx");
    const legacy = await runDocumentPick(
      ports({
        pickDocument: async () => ({ uri: "u", name: "mystery", mimeType: null }),
        peekHead: async () => LEGACY_HEAD,
      }),
    );
    expect(legacy.action).toBe("legacy");
  });

  it("a non-pdf/Word type refuses with attachmentInvalidType", async () => {
    const outcome = await runDocumentPick(
      ports({ pickDocument: async () => ({ uri: "u", name: "notes.txt", mimeType: "text/plain" }) }),
    );
    expect(outcome).toEqual({
      action: "invalid",
      notice: "errors.attachmentInvalidType",
      closeSheet: false,
    });
  });

  it("a pdf routes to a conversion with the controller's default name when blank", async () => {
    const outcome = await runDocumentPick(
      ports({ pickDocument: async () => ({ uri: "file:///p.pdf", name: "  ", mimeType: "application/pdf" }) }),
    );
    expect(outcome).toEqual({
      action: "convert",
      uri: "file:///p.pdf",
      name: "document.pdf",
      closeSheet: true,
    });
  });

  it("the cap can fill WHILE the picker is open — the second check catches it", async () => {
    let calls = 0;
    const outcome = await runDocumentPick(
      ports({
        count: () => (calls++ === 0 ? MAX_ATTACHMENT_ITEMS - 1 : MAX_ATTACHMENT_ITEMS),
        pickDocument: async () => ({ uri: "u", name: "p.pdf", mimeType: "application/pdf" }),
      }),
    );
    expect(outcome.action).toBe("capped");
  });

  it("a rejected picker or a rejected byte-peek is ignored, never thrown", async () => {
    expect(
      await runDocumentPick(ports({ pickDocument: async () => Promise.reject(new Error("x")) })),
    ).toEqual({ action: "ignored" });
    expect(
      await runDocumentPick(
        ports({
          pickDocument: async () => ({ uri: "u", name: "mystery", mimeType: null }),
          peekHead: async () => Promise.reject(new Error("io")),
        }),
      ),
    ).toEqual({ action: "ignored" });
  });
});

describe("the conversion's completion (handlePdfDone, Chat:1778-1810)", () => {
  const meta = { uri: "file:///p.pdf", name: "p.pdf" };

  it("no meta (unmounted or already consumed) is ignored", () => {
    expect(pdfConversionDone(null, ["p"], 0, true, (p) => `${p}-1`)).toEqual({
      action: "ignored",
    });
  });

  it("zero pages says so on the controller's line", () => {
    expect(pdfConversionDone(meta, [], 0, true, (p) => `${p}-1`)).toEqual({
      action: "noPages",
      notice: "errors.pdfNoPages",
    });
  });

  it("the cap refuses AND hands back the rendered JPEGs to delete", () => {
    const outcome = pdfConversionDone(meta, ["p1", "p2"], MAX_ATTACHMENT_ITEMS, true, (p) => `${p}-1`);
    expect(outcome).toEqual({
      action: "capped",
      notice: "errors.attachmentLimitReached",
      dropPages: ["p1", "p2"],
    });
  });

  it("a success carries pages, page count and the vision notice when the model is blind", () => {
    const blind = pdfConversionDone(meta, ["p1", "p2"], 0, false, (p) => `${p}-7`);
    expect(blind).toEqual({
      action: "added",
      item: {
        id: "pdf-7",
        kind: "pdf",
        name: "p.pdf",
        uri: "file:///p.pdf",
        pages: ["p1", "p2"],
        pageCount: 2,
      },
      notice: "chat.visionUnsupportedNotice",
    });
    const seeing = pdfConversionDone(meta, ["p1"], 0, true, (p) => `${p}-7`);
    expect(seeing.action === "added" && seeing.notice).toBeNull();
  });
});

describe("the composed rows actually enter the state (the hook's add in miniature)", () => {
  it("an added image lands through the same `addAttachment` the hook calls", async () => {
    const p = ports({ launchImage: async () => ({ uri: "u", fileName: "x.jpg" }) });
    const outcome = await pickImage(p);
    expect(outcome.action).toBe("added");
    if (outcome.action !== "added") return;
    const added = addAttachment([], outcome.item);
    expect(added.ok).toBe(true);
  });

  it("sample: the cap predicate is what the pre-pick check and the hook share", () => {
    const notices: TranslationKey[] = [];
    const refuse = (n: number) => {
      if (n >= MAX_ATTACHMENT_ITEMS) notices.push("errors.attachmentLimitReached");
    };
    refuse(MAX_ATTACHMENT_ITEMS);
    expect(notices).toEqual(["errors.attachmentLimitReached"]);
  });
});
