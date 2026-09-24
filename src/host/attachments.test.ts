/**
 * The attachment rules (`attachments.ts`) — each test names the refusal it
 * would catch if the rule drifted: the cap, the dedupe, the vision predicate
 * and the PDF-error mapping, all against the controller's own keys.
 */
import {
  ATTACHMENT_CAP_NOTICE,
  MAX_ATTACHMENT_ITEMS,
  PDF_CAP_NOTICE,
  addAttachment,
  addLibraryDocument,
  atAttachmentCap,
  documentHints,
  pdfErrorNotice,
  removeAttachment,
  routePickedKind,
  visionInputPresent,
} from "./attachments";
import type { LocalAttachment } from "./hostMessage";

function item(over: Partial<LocalAttachment> = {}): LocalAttachment {
  return { id: "img-1", kind: "image", name: "a.jpg", uri: "file:///a.jpg", ...over };
}

describe("the host attachment cap", () => {
  it("uses its exported five-row limit at the boundary", () => {
    expect(MAX_ATTACHMENT_ITEMS).toBe(5);
    expect(atAttachmentCap(Array.from({ length: 4 }, (_, i) => item({ id: `i${i}` })))).toBe(false);
    expect(atAttachmentCap(Array.from({ length: 5 }, (_, i) => item({ id: `i${i}` })))).toBe(true);
  });

  it("an add at the cap refuses with the generic line and keeps the rows", () => {
    const rows = Array.from({ length: MAX_ATTACHMENT_ITEMS }, (_, i) => item({ id: `i${i}` }));
    expect(atAttachmentCap(rows)).toBe(true);
    const outcome = addAttachment(rows, item({ id: "i6" }));
    expect(outcome).toEqual({ ok: false, notice: ATTACHMENT_CAP_NOTICE });
    expect(ATTACHMENT_CAP_NOTICE).toBe("errors.attachmentLimitReachedGeneric");
  });

  it("an add under the cap appends without mutating the input", () => {
    const rows = [item()];
    const outcome = addAttachment(rows, item({ id: "img-2" }));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.next.map((r) => r.id)).toEqual(["img-1", "img-2"]);
    }
    expect(rows).toHaveLength(1);
  });

  it("the PDF-path cap keeps the PDF-worded line the controller used there", () => {
    expect(PDF_CAP_NOTICE).toBe("errors.attachmentLimitReached");
    expect(addAttachment(
      Array.from({ length: MAX_ATTACHMENT_ITEMS }, (_, i) => item({ id: `i${i}` })),
      item({ id: "pdf-extra", kind: "pdf" }),
      PDF_CAP_NOTICE,
    )).toEqual({ ok: false, notice: PDF_CAP_NOTICE });
  });
});

describe("a library document attaches deduplicated and in order (Chat:3689-3715)", () => {
  it("joins as kind document with its library id and an empty uri", () => {
    const outcome = addLibraryDocument([], { id: "doc-9", name: "fisica.pdf" });
    expect(outcome.outcome).toBe("added");
    if (outcome.outcome === "added") {
      expect(outcome.next).toEqual([
        {
          id: expect.stringMatching(/^doc-\d+$/),
          kind: "document",
          name: "fisica.pdf",
          uri: "",
          libraryDocId: "doc-9",
        },
      ]);
    }
  });

  it("the same library doc twice keeps ONE row, silently", () => {
    const first = addLibraryDocument([], { id: "doc-9", name: "fisica.pdf" });
    expect(first.outcome).toBe("added");
    const rows = first.outcome === "added" ? first.next : [];
    expect(addLibraryDocument(rows, { id: "doc-9", name: "fisica.pdf" }).outcome).toBe(
      "duplicate",
    );
  });

  it("a full row refuses with the generic cap line (controller:3696)", () => {
    const rows = Array.from({ length: MAX_ATTACHMENT_ITEMS }, (_, i) =>
      item({ id: `i${i}` }),
    );
    const outcome = addLibraryDocument(rows, { id: "doc-9", name: "fisica.pdf" });
    expect(outcome).toEqual({ outcome: "capped", notice: ATTACHMENT_CAP_NOTICE });
  });
});

describe("remove is by index, in order", () => {
  it("drops exactly the indexed row", () => {
    const rows = [item({ id: "a" }), item({ id: "b" }), item({ id: "c" })];
    expect(removeAttachment(rows, 1).map((r) => r.id)).toEqual(["a", "c"]);
    // sample: out-of-range removes nothing rather than throwing mid-render
    expect(removeAttachment(rows, 9)).toHaveLength(3);
  });
});

describe("the vision predicate (Chat:2441-2446): documents never count", () => {
  it("images and page-rendered PDFs are vision; documents and page-less PDFs are not", () => {
    expect(visionInputPresent([item()])).toBe(true);
    expect(visionInputPresent([item({ kind: "pdf", pages: ["p1"], pageCount: 1 })])).toBe(true);
    expect(visionInputPresent([item({ kind: "pdf" })])).toBe(false);
    expect(
      visionInputPresent([item({ kind: "document", uri: "", libraryDocId: "d" })]),
    ).toBe(false);
    // sample: an empty row set is not a vision send
    expect(visionInputPresent([])).toBe(false);
  });
});

describe("the doc-hint annotation (Chat:2450-2455)", () => {
  it("is `[document:<id> name=\"<name>\"]`, space-joined, documents only", () => {
    const rows = [
      item({ kind: "document", uri: "", libraryDocId: "d1", name: "a.pdf" }),
      item({ kind: "document", uri: "", libraryDocId: "d2", name: "b.pdf" }),
      item(),
    ];
    expect(documentHints(rows)).toBe('[document:d1 name="a.pdf"] [document:d2 name="b.pdf"]');
    expect(documentHints([item()])).toBe("");
    // A document without a library id cannot be hinted — and must not
    // fabricate one.
    expect(documentHints([item({ kind: "document", uri: "" })])).toBe("");
  });
});

describe("picked-document routing (Chat:1731-1763)", () => {
  it("pdf and docx act; legacy Word and everything else refuse", () => {
    expect(routePickedKind("pdf")).toEqual({ action: "pdf" });
    expect(routePickedKind("docx")).toEqual({ action: "docx" });
    expect(routePickedKind("doc_legacy")).toEqual({ action: "legacy" });
    expect(routePickedKind("txt")).toEqual({ action: "invalid" });
    expect(routePickedKind(null)).toEqual({ action: "invalid" });
  });
});

describe("the PDF error → notice map (Chat:1817-1829)", () => {
  it("each PdfExtractError code gets the controller's own line", () => {
    expect(pdfErrorNotice("timeout")).toBe("errors.pdfExtractTimeout");
    expect(pdfErrorNotice("page_timeout")).toBe("errors.pdfTimeout");
    expect(pdfErrorNotice("renderer_gone")).toBe("errors.pdfRendererGone");
    expect(pdfErrorNotice("cap")).toBe("errors.pdfTooLarge");
  });

  it("an absent OR unknown code falls to the generic extraction line, never a fabricated one", () => {
    expect(pdfErrorNotice(null)).toBe("errors.pdfExtractFailed");
    expect(pdfErrorNotice("something_new")).toBe("errors.pdfExtractFailed");
  });
});
