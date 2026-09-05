import { isDocumentUnreadable } from "./DocumentLibrary";

/**
 * Unit tests for `isDocumentUnreadable` — the rebuild gate that decides
 * whether a library entry has no usable text AND a failed extraction.
 *
 * Unreadable = docCount ≤ 0 AND extractionStatus is one of
 * timeout | renderer_error | fs_error.
 *
 * Everything else (usable text, ok / no_text_layer / absent status) is
 * NOT unreadable — those route to vision fallback or are simply fine.
 */
describe("isDocumentUnreadable", () => {
  test("returns true when extraction failed and there is no usable text", () => {
    expect(isDocumentUnreadable({ docCount: 0, extractionStatus: "timeout" })).toBe(
      true,
    );
    expect(
      isDocumentUnreadable({ docCount: 0, extractionStatus: "renderer_error" }),
    ).toBe(true);
    expect(isDocumentUnreadable({ docCount: 0, extractionStatus: "fs_error" })).toBe(
      true,
    );
  });

  test("returns false when there is usable text (docCount > 0), regardless of status", () => {
    expect(isDocumentUnreadable({ docCount: 1, extractionStatus: "timeout" })).toBe(
      false,
    );
    expect(isDocumentUnreadable({ docCount: 42, extractionStatus: "fs_error" })).toBe(
      false,
    );
    expect(isDocumentUnreadable({ docCount: 3, extractionStatus: "renderer_error" })).toBe(
      false,
    );
  });

  test("returns false for 'ok' with no text (empty but extractable)", () => {
    expect(isDocumentUnreadable({ docCount: 0, extractionStatus: "ok" })).toBe(
      false,
    );
  });

  test("returns false for 'no_text_layer' (scanned PDF → vision path)", () => {
    expect(
      isDocumentUnreadable({ docCount: 0, extractionStatus: "no_text_layer" }),
    ).toBe(false);
  });

  test("returns false for legacy entries with absent status and no text", () => {
    expect(isDocumentUnreadable({ docCount: 0 })).toBe(false);
    expect(isDocumentUnreadable({ docCount: 0, extractionStatus: undefined })).toBe(
      false,
    );
  });

  test("treats non-positive docCount (<= 0) as no usable text", () => {
    expect(isDocumentUnreadable({ docCount: -5, extractionStatus: "timeout" })).toBe(
      true,
    );
    expect(isDocumentUnreadable({ docCount: -1, extractionStatus: "fs_error" })).toBe(
      true,
    );
    // non-positive count but a non-failure status is not unreadable
    expect(isDocumentUnreadable({ docCount: 0, extractionStatus: "ok" })).toBe(
      false,
    );
  });
});