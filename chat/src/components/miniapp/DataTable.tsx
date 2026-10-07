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

/** Cells that read as numbers compare by value — "2" before "10" — after the
 *  decimal-comma forgiveness the inputs themselves get; an empty or partly
 *  numeric cell makes the pair plain text. */
function compareCells(a: string, b: string): number {
  const number = (cell: string): number =>
    cell.trim() === "" ? Number.NaN : Number(cell.trim().replace(",", "."));
  const na = number(a);
  const nb = number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b);
}

export function DataTable({ block }: { block: Record<string, unknown> }) {
  const { table } = useLanguage();
  const t = table.miniapp;
  const { columns, rows: sourceRows, hasMoreRows, hasMoreColumns } = normalizeTable(block);
  const [sort, setSort] = useState<{ at: number; dir: "asc" | "desc" } | null>(null);
  const rows = sort
    ? [...sourceRows].sort((a, b) =>
        sort.dir === "asc" ? compareCells(a[sort.at] ?? "", b[sort.at] ?? "") : compareCells(b[sort.at] ?? "", a[sort.at] ?? ""),
      )
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
