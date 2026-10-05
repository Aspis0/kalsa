/**
 * compare_data → one `data_table` block. Needs at least one column; rows are
 * optional (a comparison table with headers only is still a table).
 */

import { asString, asStringArrayCapped, envelope, isPlainObject } from "./slots";
import type { Miniapp } from "./types";

export function buildCompareData(slots: Record<string, unknown>): Miniapp | null {
  const columns = asStringArrayCapped(slots.columns);
  if (!columns || columns.length === 0) return null;

  const rows: Record<string, unknown>[] = [];
  if (slots.rows !== undefined) {
    if (!Array.isArray(slots.rows)) return null;
    for (const row of slots.rows) {
      if (!isPlainObject(row)) return null;
      rows.push(row);
    }
  }

  const block: Record<string, unknown> = { type: "data_table", columns };
  if (rows.length > 0) block.rows = rows;
  return envelope("compare_data", asString(slots.title) ?? "Comparison", [block]);
}
