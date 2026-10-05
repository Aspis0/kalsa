/**
 * quick_calculator → one `calculator` block. The formula is validated here,
 * exactly as the renderer's evaluator will read it, so an unknown field id or
 * a malformed expression is an error the model sees, not a dead calculator.
 */

import { evaluateCalculatorFormula } from "./calculator";
import { asString, asStringCapped, envelope, isPlainObject } from "./slots";
import type { Miniapp } from "./types";

function buildCalculatorFields(
  value: unknown,
): Record<string, unknown>[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const out: Record<string, unknown>[] = [];
  const seenIds = new Set<string>();
  for (const field of value) {
    if (!isPlainObject(field)) {
      return null;
    }
    // Reject empty or duplicate field ids: duplicate ids collide on the
    // renderer's per-field state key — one input overwrites the other.
    const id = asString(field.id);
    if (!id) return null;
    if (seenIds.has(id)) return null;
    seenIds.add(id);
    const entry: Record<string, unknown> = { id, label: asString(field.label) ?? id };
    if (field.value !== undefined) entry.value = field.value;
    out.push(entry);
  }
  return out;
}

/** Coerce a field value to a finite number, else undefined. */
function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Build the { id: number } map the calculator evaluator needs. Non-numeric
 *  field values are skipped; a formula referencing them is then rejected. */
function fieldsToVars(
  fields: Record<string, unknown>[] | undefined,
): Record<string, number> {
  const vars: Record<string, number> = {};
  if (!fields) return vars;
  for (const field of fields) {
    const id = asString(field.id);
    if (!id) continue;
    const n = toNumber(field.value);
    if (typeof n === "number") vars[id] = n;
  }
  return vars;
}

export function buildQuickCalculator(slots: Record<string, unknown>): Miniapp | null {
  const formula = asStringCapped(slots.formula);
  if (!formula) return null;

  const fields = buildCalculatorFields(slots.fields);
  if (fields === null) return null; // provided but invalid

  // Validate the formula exactly as the renderer's evaluator does (length /
  // charset gate + field-id substitution). A formula that references an unknown
  // id or is arithmetically invalid is rejected here, not as a dead calculator.
  if (!evaluateCalculatorFormula(formula, fieldsToVars(fields)).ok) return null;

  const block: Record<string, unknown> = { type: "calculator", formula };
  if (fields) block.fields = fields; // omitted fields are optional
  return envelope("quick_calculator", asString(slots.title) ?? "Calculator", [block]);
}
