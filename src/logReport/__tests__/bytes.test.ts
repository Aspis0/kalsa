/** Byte-cap tests with multibyte characters: UTF-8 length and newest-line trim. */
import { trimNewestLinesToByteCap, utf8ByteLength } from "../bytes";

describe("utf8ByteLength", () => {
  it("counts ASCII as one byte", () => {
    expect(utf8ByteLength("abc")).toBe(3);
  });

  it("counts two- and three-byte characters", () => {
    expect(utf8ByteLength("é")).toBe(2); // U+00E9
    expect(utf8ByteLength("€")).toBe(3); // U+20AC
    expect(utf8ByteLength("日")).toBe(3); // U+65E5
  });

  it("counts an emoji surrogate pair as four bytes", () => {
    expect(utf8ByteLength("𝄞")).toBe(4); // U+1D11E
    expect(utf8ByteLength("🫡")).toBe(4);
  });

  it("adds up mixed text", () => {
    expect(utf8ByteLength("aé€日𝄞")).toBe(1 + 2 + 3 + 3 + 4);
  });
});

describe("trimNewestLinesToByteCap", () => {
  const euro = "€".repeat(10); // 30 bytes + 1 newline per line

  it("keeps whole lines only, newest first", () => {
    const text = [euro, euro, euro].join("\n") + "\n";
    expect(trimNewestLinesToByteCap(text, 62)).toBe(`${euro}\n${euro}\n`);
    expect(trimNewestLinesToByteCap(text, 61)).toBe(`${euro}\n`);
  });

  it("cuts at a line boundary even when the cap lands mid-character", () => {
    const text = "abc\n日日日\nxyz\n";
    expect(trimNewestLinesToByteCap(text, 8 + 2)).toBe("xyz\n");
  });

  it("drops a single line longer than the whole cap", () => {
    expect(trimNewestLinesToByteCap("€".repeat(20) + "\n", 10)).toBe("");
  });

  it("returns empty for a non-positive cap", () => {
    expect(trimNewestLinesToByteCap("a\nb\n", 0)).toBe("");
    expect(trimNewestLinesToByteCap("a\nb\n", -1)).toBe("");
  });

  it("keeps the trailing newline out of the count of a full fit", () => {
    const text = "one\ntwo\nthree\n";
    expect(trimNewestLinesToByteCap(text, 100)).toBe(text);
  });
});
