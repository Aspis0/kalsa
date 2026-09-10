import { sheetCopyVisible } from "./sheetCopyVisible";

describe("sheetCopyVisible", () => {
  it("shows the action-sheet Copy row for a message with text", () => {
    expect(sheetCopyVisible("hello")).toBe(true);
    expect(sheetCopyVisible("  padded  ")).toBe(true);
  });

  it("hides it for empty or whitespace-only text (nothing to copy)", () => {
    expect(sheetCopyVisible("")).toBe(false);
    expect(sheetCopyVisible("   \n\t ")).toBe(false);
  });
});
