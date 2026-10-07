/**
 * quick_calculator → one `calculator` block. The formula is validated here,
 * exactly as the renderer's evaluator will read it, so an unknown field id or
 * a malformed expression is an error the model sees, not a dead calculator.
 * A formula with bare numbers is never drawn dead either: every literal is
 * lifted into an editable field and the formula rewritten to reference it.
 */

import { evaluateCalculatorFormula } from "./calculator";
import { recordCalculatorValues } from "./state";
import { asString, asStringCapped, envelope, isPlainObject, isUnsafeId, MAX_ID_CHARS } from "./slots";
import type { Miniapp } from "./types";

/** The renderer draws at most this many inputs (the phone's MAX_CHILD_BLOCKS).
 *  A formula referencing a field past it would render as a dead calculator,
 *  so a longer field list is rejected here instead. */
export const MAX_CALCULATOR_FIELDS = 24;

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
    // Reject empty, duplicate, oversized and unsafe field ids: duplicate ids
    // collide on the renderer's per-field state key, and an unsafe one writes
    // along the prototype chain instead of it — one input overwrites the
    // other, or neither.
    const id = asString(field.id);
    if (!id || id.length > MAX_ID_CHARS || isUnsafeId(id)) return null;
    if (seenIds.has(id)) return null;
    seenIds.add(id);
    const entry: Record<string, unknown> = { id, label: asString(field.label) ?? id };
    if (field.value !== undefined) entry.value = field.value;
    out.push(entry);
  }
  return out;
}

/** Coerce a field value to a finite number, else undefined. A string value
 *  may write its decimal with a comma, as the phone's inputs do. */
function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && /^-?\d+([.,]\d+)?$/.test(value.trim())) {
    const n = Number(value.trim().replace(",", "."));
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

/** One numeric literal in the formula: where it spans, and its value. */
interface Literal {
  start: number;
  end: number;
  value: number;
}

/** The formula's numeric literals, read the way the evaluator reads them: a
 *  number not inside an identifier (the `0` of `f0` is part of the id) and
 *  not the tail of an earlier one (the second dot of `2.5.3` lifts nothing —
 *  the rewritten formula is rejected by the evaluator, as it always was). */
function formulaLiterals(formula: string): Literal[] {
  const out: Literal[] = [];
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (/[A-Za-z_]/.test(ch)) {
      i += 1;
      while (i < formula.length && /[A-Za-z0-9_]/.test(formula[i])) i += 1;
      continue;
    }
    const startsNumber = /[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(formula[i + 1] ?? ""));
    const prev = i > 0 ? formula[i - 1] : "";
    if (startsNumber && !/[A-Za-z0-9_.]/.test(prev)) {
      let j = i;
      let sawDot = false;
      while (j < formula.length && (/[0-9]/.test(formula[j]) || (formula[j] === "." && !sawDot))) {
        if (formula[j] === ".") sawDot = true;
        j += 1;
      }
      const value = Number(formula.slice(i, j));
      if (Number.isFinite(value)) out.push({ start: i, end: j, value });
      i = j;
      continue;
    }
    i += 1;
  }
  return out;
}

export function buildQuickCalculator(slots: Record<string, unknown>): Miniapp | null {
  const formula = asStringCapped(slots.formula);
  if (!formula) return null;

  const fields = buildCalculatorFields(slots.fields);
  if (fields === null) return null; // provided but invalid

  // Every literal becomes an editable field, so the person can play with the
  // numbers the model hardcoded. Lifted ids are minted n1, n2… past the
  // model's own, and carry no label: the renderer names a lifted field in
  // the interface's language.
  const literals = formulaLiterals(formula);
  const lifted: Record<string, unknown>[] = [];
  let rewritten = formula;
  if (literals.length > 0) {
    const taken = new Set((fields ?? []).map((field) => asString(field.id) ?? ""));
    let next = 1;
    const idFor = (): string => {
      while (taken.has(`n${next}`)) next += 1;
      const id = `n${next}`;
      taken.add(id);
      next += 1;
      return id;
    };
    const parts: string[] = [];
    let cursor = 0;
    for (const literal of literals) {
      const id = idFor();
      parts.push(formula.slice(cursor, literal.start), id);
      cursor = literal.end;
      lifted.push({ id, value: literal.value });
    }
    rewritten = parts.join("") + formula.slice(cursor);
  }

  const allFields = [...(fields ?? []), ...lifted];
  if (allFields.length > MAX_CALCULATOR_FIELDS) return null;

  // Validate the rewritten formula exactly as the renderer's evaluator does
  // (length / charset gate + field-id substitution). A formula that references
  // an unknown id or is arithmetically invalid is rejected here, not as a
  // dead calculator.
  const vars = fieldsToVars(allFields);
  const evaluated = evaluateCalculatorFormula(rewritten, vars);
  if (!evaluated.ok) return null;

  const block: Record<string, unknown> = { type: "calculator", formula: rewritten };
  if (fields || lifted.length > 0) block.fields = allFields;
  // The initial values and result are the envelope's first state, so the next
  // turn's wire carries what the calculator shows even before anyone edits it.
  return {
    ...envelope("quick_calculator", asString(slots.title) ?? "", [block]),
    state: recordCalculatorValues({}, vars, evaluated.value),
  };
}
