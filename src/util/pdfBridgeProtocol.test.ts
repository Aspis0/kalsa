import {
  MAX_PDF_PAGES,
  MAX_PDF_TEXT_PAGES,
  parseBridgeMessage,
  reconcileTextPassPages,
} from "./pdfBridgeProtocol";

describe("PDF bridge mode-specific caps", () => {
  test("allows text pages beyond the vision bound", () => {
    const text = parseBridgeMessage(
      JSON.stringify({ kind: "textChunk", page: MAX_PDF_PAGES + 1, chunk: 0, total: 1, data: "[]" }),
    );
    const image = parseBridgeMessage(
      JSON.stringify({ page: MAX_PDF_PAGES + 1, chunk: 0, total: 1, data: "x" }),
    );

    expect(MAX_PDF_TEXT_PAGES).toBe(200);
    expect(text.ok).toBe(true);
    expect(image).toEqual({ ok: false, category: "cap", reason: "page_cap" });
  });

  test("accepts a truncated text pass and reconciles all processed pages", () => {
    const parsed = parseBridgeMessage(
      JSON.stringify({
        kind: "textPassDone",
        pageCount: 40,
        documentPageCount: 80,
        truncated: true,
      }),
    );

    expect(parsed.ok).toBe(true);
    if (
      parsed.ok &&
      "kind" in parsed.message &&
      parsed.message.kind === "textPassDone"
    ) {
      expect(parsed.message.truncated).toBe(true);
    }
    expect(reconcileTextPassPages([1, 17, 31, 40], 40).expected).toHaveLength(40);
  });
});
