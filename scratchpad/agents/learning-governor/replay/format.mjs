/**
 * Markdown formatting for the replay report: numbers that print as numbers,
 * empty cells that print as a dash, and the table itself.
 */
import { describe } from "./distributions.mjs";

export const n = (value, digits = 3) =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "-";

export const s = (value) => (value === null || value === undefined ? "-" : String(value));

export const pct = (value) => (value === null ? "-" : `${(value * 100).toFixed(1)} %`);

/** A collinear design drives the condition ratio to machine precision; print
 *  it as an exponent rather than as seventeen digits. */
export const condText = (value) =>
  value === null ? "infinite" : value >= 1e6 ? value.toExponential(1) : n(value, 1);

/** Trips arrive as milli-C / 1000, so they carry float noise at 1e-6 C. */
export const tripText = (trips) => `[${trips.map((t) => n(t, 1)).join(", ")}]`;

export const table = (headers, rows) =>
  [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");

export const distLine = (label, values, digits = 0) => {
  const d = describe(values);
  return `${label}: n=${d.n} min=${n(d.min, digits)} p50=${n(d.p50, digits)} p90=${n(d.p90, digits)} max=${n(d.max, digits)}`;
};
