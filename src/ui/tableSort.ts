/**
 * The table header's sort: a total order over cells, so any two columns
 * answer the same way in both directions — numbers before text, and an
 * empty cell last whichever way the sort runs. Pure: the renderer keeps the
 * sort state, this decides what it means.
 */

/** One cell as a number, when it reads as one. A lone separator is the
 *  decimal mark wherever it sits ("1.5", "1,5"); two kinds mean grouping
 *  ("1,234.5", "1.234,5" — the later one is decimal); one kind repeated
 *  means thousands ("1,234,567"). Everything else stays text. */
export function numericCell(raw: string): number {
  const t = raw.trim();
  if (!/^[+-]?[\d.,]+$/.test(t)) return Number.NaN;
  const separators = (t.match(/[.,]/g) ?? []).length;
  if (separators === 0) return Number(t);
  const hasComma = t.includes(",");
  const hasDot = t.includes(".");
  if (hasComma && hasDot) {
    const decimalAt = Math.max(t.lastIndexOf(","), t.lastIndexOf("."));
    const integer = t.slice(0, decimalAt).replace(/[.,]/g, "");
    const fraction = t.slice(decimalAt + 1);
    return /^\d+$/.test(fraction) && /^[+-]?\d+$/.test(integer)
      ? Number(`${integer}.${fraction}`)
      : Number.NaN;
  }
  if (separators > 1) {
    const parts = t.split(/[.,]/);
    return parts.slice(1).every((part) => /^\d{3}$/.test(part)) ? Number(parts.join("")) : Number.NaN;
  }
  return Number(t.replace(",", "."));
}

/** The sort's total order over non-empty cells: numbers before text, so any
 *  two cells answer once and the same way in both directions. */
export function compareCells(a: string, b: string): number {
  const na = numericCell(a);
  const nb = numericCell(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  if (Number.isFinite(na)) return -1;
  if (Number.isFinite(nb)) return 1;
  return a.localeCompare(b);
}

/** The column's comparison as the sort reads it: the direction reverses the
 *  numbers and the text, and an empty cell stays last whichever way it runs. */
export function compareForSort(a: string, b: string, dir: "asc" | "desc"): number {
  const at = a.trim();
  const bt = b.trim();
  if (at === "" || bt === "") {
    if (at === "" && bt === "") return 0;
    return at === "" ? 1 : -1;
  }
  const compared = compareCells(at, bt);
  return dir === "asc" ? compared : -compared;
}
