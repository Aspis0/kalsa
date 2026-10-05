import { asArray, asRecord, asText } from "./values";

/**
 * A `data_table` block, capped the way the phone renderer caps it: 50 rows,
 * 12 columns. Columns may be plain strings (compare_data) or {key,label}
 * records (pros_cons); rows may be objects keyed by column key, or arrays.
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
  const rawRows = sourceRows.slice(0, MAX_TABLE_ROWS);
  const rawColumns = asArray(block.columns, MAX_TABLE_COLUMNS);
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
    hasMoreColumns: rawColumns.length > MAX_TABLE_COLUMNS,
  };
}

export function DataTable({ block }: { block: Record<string, unknown> }) {
  const table = normalizeTable(block);
  return (
    <div className="miniapp-block">
      <p className="miniapp-block-title">{asText(block.title, "Table")}</p>
      {table.columns.length > 0 ? (
        <div className="miniapp-table-wrap">
          <table className="miniapp-table">
            <thead>
              <tr>
                {table.columns.map((column) => (
                  <th key={column.key} scope="col">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
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
      {table.rows.length === 0 ? <p className="miniapp-note">No rows yet.</p> : null}
      {table.hasMoreRows || table.hasMoreColumns ? (
        <p className="miniapp-note">
          Showing up to {Math.min(table.rows.length, MAX_TABLE_ROWS)} rows and{" "}
          {Math.min(table.columns.length, MAX_TABLE_COLUMNS)} columns.
        </p>
      ) : null}
    </div>
  );
}
