/**
 * pros_cons → a `data_table` with one row per pro/con pair. Column `key`
 * stays the stable "pro"/"con" used to look up row values; `label` is the
 * header shown in the UI.
 */

import { asString, asStringCapped, envelope, isPlainObject } from "./slots";
import type { Miniapp } from "./types";

const MAX_ROWS = 50;

const COLUMN_LABELS = { pro: "Pro", con: "Con" };

export function buildProsCons(slots: Record<string, unknown>): Miniapp | null {
  const rawRows = slots.rows;
  if (!Array.isArray(rawRows)) return null;

  const rows: Record<string, string>[] = [];
  for (const raw of rawRows) {
    if (!isPlainObject(raw)) return null;
    const pro = asStringCapped(raw.pro);
    const con = asStringCapped(raw.con);
    if (!pro && !con) continue; // skip empty rows
    rows.push({ pro: pro ?? "", con: con ?? "" });
  }
  if (rows.length < 1) return null;

  return envelope("pros_cons", asString(slots.title) ?? "Pros & Cons", [
    {
      type: "data_table",
      columns: [
        { key: "pro", label: COLUMN_LABELS.pro },
        { key: "con", label: COLUMN_LABELS.con },
      ],
      rows: rows.slice(0, MAX_ROWS),
    },
  ]);
}
