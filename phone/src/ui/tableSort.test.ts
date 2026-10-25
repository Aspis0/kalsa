/** The table header sort's order: numbers before text, either direction,
 *  empty last — the contract the sortable compare_data header rests on. */
import { compareForSort, numericCell } from "./tableSort";

test("numericCell reads plain, comma-decimal and grouped numbers", () => {
  expect(numericCell("12.5")).toBe(12.5);
  expect(numericCell("1,5")).toBe(1.5);
  expect(numericCell("1,234.5")).toBe(1234.5);
  expect(numericCell("1.234,5")).toBe(1234.5);
  expect(numericCell("1,234,567")).toBe(1234567);
  expect(Number.isNaN(numericCell("12abc"))).toBe(true);
  expect(Number.isNaN(numericCell("1.2.3"))).toBe(true);
});

test("ascending: numbers before text, numerically within numbers", () => {
  const cells = ["10", "9", "apple", "2", "100"];
  expect([...cells].sort((a, b) => compareForSort(a, b, "asc"))).toEqual(["2", "9", "10", "100", "apple"]);
});

test("empty cells stay last in both directions", () => {
  const cells = ["", "beta", "5", "alpha"];
  expect([...cells].sort((a, b) => compareForSort(a, b, "asc"))).toEqual(["5", "alpha", "beta", ""]);
  expect([...cells].sort((a, b) => compareForSort(a, b, "desc"))).toEqual(["beta", "alpha", "5", ""]);
});

test("descending reverses the numbers and the text", () => {
  expect(compareForSort("2", "10", "desc")).toBeGreaterThan(0);
  expect(compareForSort("alpha", "beta", "desc")).toBeGreaterThan(0);
});
