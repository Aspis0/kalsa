import { useState } from "react";
import { useLanguage } from "../../i18n/useLanguage";
import { asArray, asRecord, asText } from "./values";

/**
 * A `data_table` block, capped the way the phone renderer caps it: 50 rows,
 * 12 columns. Columns may be plain strings (compare_data) or {key,label}
 * records (pros_cons); rows may be objects keyed by column key, or arrays.
 * A header is a button: clicking it sorts by that column, ascending then
 * descending — cells that read as numbers by value, everything else by text.
 */

const MAX_TABLE_ROWS = 50;
const MAX_TABLE_COLUMNS = 12;

type Column = { key: string; label: string };

function normalizeTable(block: Record<string, unknown>): {
  columns: Column[];
  rows: string[][];
  hasMoreRows: boolean;
  hasMoreColumns: boolean;
} {
  const sourceRows = Array.isArray(block.rows) ? block.rows : [];
  // The source lengths are read before the slice: the overflow notice must
  // know what was cut, or a table past the cap says nothing about it.
  const sourceColumns = Array.isArray(block.columns) ? block.columns : [];
  const rawRows = sourceRows.slice(0, MAX_TABLE_ROWS);
  const rawColumns = sourceColumns.slice(0, MAX_TABLE_COLUMNS);
  const firstRowRecord = asRecord(
    rawRows.find((row) => row && typeof row === "object" && !Array.isArray(row)),
  );
  const columns = (
    rawColumns.length
      ? rawColumns.map((column) => {
          const columnRecord = asRecord(column);
          const key = asText(columnRecord.key, asText(columnRecord.id, asText(column)));
          return { key, label: asText(columnRecord.label, key) };
        })
      : Object.keys(firstRowRecord).map((key) => ({ key, label: key }))
  )
    .filter((column) => column.key)
    .slice(0, MAX_TABLE_COLUMNS);
  const rows = rawRows.map((row) => {
    if (Array.isArray(row)) {
      return asArray(row, MAX_TABLE_COLUMNS).map((cell) => asText(cell));
    }
    if (row && typeof row === "object") {
      const rowRecord = asRecord(row);
      return columns.map((column) => asText(rowRecord[column.key]));
    }
    return [asText(row)];
  });
  const cappedRows = rows.map((row) => row.slice(0, MAX_TABLE_COLUMNS));
  return {
    columns,
    rows: cappedRows,
    hasMoreRows: sourceRows.length > MAX_TABLE_ROWS,
    hasMoreColumns: sourceColumns.length > MAX_TABLE_COLUMNS,
  };
}

/** One cell as a number, when it reads as one. A lone separator is the
 *  decimal mark wherever it sits ("1.5", "1,5"); two kinds mean grouping
 *  ("1,234.5", "1.234,5" — the later one is decimal); one kind repeated
 *  means thousands ("1,234,567"). Everything else stays text. */
function numericCell(raw: string): number {
  const t = raw.trim();
  if (!/^[+-]?[\d.,]+$/.test(t)) return Number.NaN;
  const separators = (t.match(/[.,]/) ?? []).length;
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
function compareCells(a: string, b: string): number {
  const na = numericCell(a);
  const nb = numericCell(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  if (Number.isFinite(na)) return -1;
  if (Number.isFinite(nb)) return 1;
  return a.localeCompare(b);
}

/** The column's comparison as the sort reads it: the direction reverses the
 *  numbers and the text, and an empty cell stays last whichever way it runs. */
function compareForSort(a: string, b: string, dir: "asc" | "desc"): number {
  const at = a.trim();
  const bt = b.trim();
  if (at === "" || bt === "") {
    if (at === "" && bt === "") return 0;
    return at === "" ? 1 : -1;
  }
  const compared = compareCells(at, bt);
  return dir === "asc" ? compared : -compared;
}

export function DataTable({ block }: { block: Record<string, unknown> }) {
  const { table } = useLanguage();
  const t = table.miniapp;
  const { columns, rows: sourceRows, hasMoreRows, hasMoreColumns } = normalizeTable(block);
  const [sort, setSort] = useState<{ at: number; dir: "asc" | "desc" } | null>(null);
  const rows = sort
    ? [...sourceRows].sort((a, b) => compareForSort(a[sort.at] ?? "", b[sort.at] ?? "", sort.dir))
    : sourceRows;
  const toggleSort = (at: number): void =>
    setSort((current) =>
      current?.at === at ? { at, dir: current.dir === "asc" ? "desc" : "asc" } : { at, dir: "asc" },
    );

  return (
    <div className="miniapp-block">
      <p className="miniapp-block-title">{asText(block.title, t.table)}</p>
      {columns.length > 0 ? (
        <div className="miniapp-table-wrap">
          <table className="miniapp-table">
            <thead>
              <tr>
                {columns.map((column, at) => {
                  const sorted = sort?.at === at ? (sort.dir === "asc" ? "ascending" : "descending") : undefined;
                  return (
                    <th key={column.key} scope="col" aria-sort={sorted}>
                      <button type="button" className="miniapp-sort" onClick={() => toggleSort(at)}>
                        {column.label}
                        {sorted === "ascending" ? " ▲" : sorted === "descending" ? " ▼" : ""}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {rows.length === 0 ? <p className="miniapp-note">{t.noRows}</p> : null}
      {hasMoreRows || hasMoreColumns ? (
        <p className="miniapp-note">
          {t.showingCap(Math.min(rows.length, MAX_TABLE_ROWS), Math.min(columns.length, MAX_TABLE_COLUMNS))}
        </p>
      ) : null}
    </div>
  );
}
