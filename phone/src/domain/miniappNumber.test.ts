import { parseLocaleNumber } from "./miniappNumber";

describe("parseLocaleNumber", () => {
  test("Italian: a dot groups in threes, a comma is the decimal mark", () => {
    expect(parseLocaleNumber("12.500", "it")).toBe(12500);
    expect(parseLocaleNumber("12,5", "it")).toBe(12.5);
    expect(parseLocaleNumber("1.234.567", "it")).toBe(1234567);
    expect(parseLocaleNumber("1.234,5", "it")).toBe(1234.5);
  });

  test("English: a comma groups in threes, a dot is the decimal mark", () => {
    expect(parseLocaleNumber("12.500", "en")).toBe(12.5);
    expect(parseLocaleNumber("1,234,567", "en")).toBe(1234567);
    expect(parseLocaleNumber("1,234.5", "en")).toBe(1234.5);
  });

  test("a lone wrong-kind separator forgives a decimal mark unless it groups in threes", () => {
    expect(parseLocaleNumber("12.5", "it")).toBe(12.5);
    expect(parseLocaleNumber("1,5", "en")).toBe(1.5);
    expect(parseLocaleNumber("12.5000", "it")).toBe(12.5);
  });

  test("both marks: the later one is the decimal mark, whatever the language", () => {
    expect(parseLocaleNumber("1.234,5", "en")).toBe(1234.5);
    expect(parseLocaleNumber("1,234.5", "it")).toBe(1234.5);
  });

  test("a field mid-typing reads as the number it has so far", () => {
    expect(parseLocaleNumber("1.", "en")).toBe(1);
    expect(parseLocaleNumber("1,", "it")).toBe(1);
    expect(parseLocaleNumber(",5", "it")).toBe(0.5);
    expect(parseLocaleNumber("-2,5", "it")).toBe(-2.5);
  });

  test("spaces inside the number are ignored", () => {
    expect(parseLocaleNumber(" 1 234,5 ", "it")).toBe(1234.5);
  });

  test("text that reads as no number is NaN", () => {
    for (const raw of ["", "-", ".", "abc", "1e5", "1..2", "1,2,3"]) {
      expect(parseLocaleNumber(raw, "it")).toBeNaN();
    }
  });
});
