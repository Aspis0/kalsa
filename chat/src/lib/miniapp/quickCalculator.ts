/**
 * quick_calculator → one `calculator` block. The formula is validated here,
 * exactly as the renderer's evaluator will read it, so an unknown field id or
 * a malformed expression is an error the model sees, not a dead calculator.
 *
 * The fields decide how bare numbers are treated — the model proposes, the
 * code decides:
 *   no fields    → every literal is lifted into an editable field (n1, n2…)
 *                  and the formula rewritten to reference them;
 *   fields given → the formula must speak in field ids and constants. A
 *                  literal equal to a not-yet-referenced field's value (a
 *                  unary minus matching a negative value counts) is replaced
 *                  by that field's id; any other literal stays a constant
 *                  ("amount * 1.22"). Every field must appear in the final
 *                  formula, or it would render as a dead input.
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
function fieldsToVars(fields: Record<string, unknown>[]): Record<string, number> {
  const vars: Record<string, number> = {};
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

/** The formula's identifiers — the names it may reference fields by. */
function formulaIdentifiers(formula: string): Set<string> {
  const out = new Set<string>();
  for (const match of formula.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) out.add(match[0]);
  return out;
}

/** Where the unary minus before this literal starts, or -1 when there is
 *  none: the nearest non-space character back must be a minus whose own
 *  predecessor is the formula's start or an operator or "(" — otherwise it
 *  is the binary minus of "a - 5". */
function unaryMinusStart(formula: string, start: number): number {
  let at = start - 1;
  while (at >= 0 && /\s/.test(formula[at])) at -= 1;
  if (at < 0 || formula[at] !== "-") return -1;
  let before = at - 1;
  while (before >= 0 && /\s/.test(formula[before])) before -= 1;
  return before < 0 || /[+\-*/(]/.test(formula[before]) ? at : -1;
}

/** Spans rewritten to id references, left to right. */
function rewriteFormula(formula: string, replacements: Array<Literal & { id: string }>): string {
  const parts: string[] = [];
  let cursor = 0;
  for (const span of replacements) {
    parts.push(formula.slice(cursor, span.start), span.id);
    cursor = span.end;
  }
  return parts.join("") + formula.slice(cursor);
}

/** One planned build: the envelope, or the precise English refusal the model
 *  retries on. A refusal is set only for the field rules a retry can fix; a
 *  malformed formula stays a generic refusal. */
interface QuickPlan {
  miniapp: Miniapp | null;
  refusal: string | null;
}

function planQuickCalculator(slots: Record<string, unknown>): QuickPlan {
  const formula = asStringCapped(slots.formula);
  if (!formula) return { miniapp: null, refusal: null };
  const fields = buildCalculatorFields(slots.fields);
  if (fields === null) return { miniapp: null, refusal: null }; // provided but invalid

  if (!fields || fields.length === 0) {
    // Lifted ids are minted n1, n2… past any id already in play, and carry
    // no label: the renderer names a lifted field in the interface's
    // language.
    const taken = new Set(ids(fields ?? []));
    let next = 1;
    const idFor = (): string => {
      while (taken.has(`n${next}`)) next += 1;
      const id = `n${next}`;
      taken.add(id);
      next += 1;
      return id;
    };
    const replacements = formulaLiterals(formula).map((span) => ({ ...span, id: idFor() }));
    const lifted = replacements.map((span) => ({ id: span.id, value: span.value }));
    const rewritten = replacements.length > 0 ? rewriteFormula(formula, replacements) : formula;
    const allFields = [...(fields ?? []), ...lifted];
    if (allFields.length > MAX_CALCULATOR_FIELDS) return { miniapp: null, refusal: null };
    const vars = fieldsToVars(allFields);
    const evaluated = evaluateCalculatorFormula(rewritten, vars);
    if (!evaluated.ok) return { miniapp: null, refusal: null };
    const block: Record<string, unknown> = { type: "calculator", formula: rewritten };
    if (fields || lifted.length > 0) block.fields = allFields;
    // The initial values and result are the envelope's first state, so the
    // next turn's wire carries what the calculator shows even before anyone
    // edits it.
    return {
      miniapp: {
        ...envelope("quick_calculator", asString(slots.title) ?? "", [block]),
        state: recordCalculatorValues({}, vars, evaluated.value),
      },
      refusal: null,
    };
  }

  if (fields.length > MAX_CALCULATOR_FIELDS) return { miniapp: null, refusal: null };
  const known = new Set(ids(fields));

  // The formula may only speak in field ids.
  for (const id of formulaIdentifiers(formula)) {
    if (!known.has(id)) {
      return {
        miniapp: null,
        refusal: `create_miniapp: the formula references ${id}, which is not one of the fields. Write the formula from the field ids you gave.`,
      };
    }
  }

  // A literal is substituted with a field's id only when that field is free
  // (the formula does not mention it yet) and holds exactly the literal's
  // value — a unary minus on the literal matches a negative field. Every
  // other literal stays in the formula as a constant: "amount * 1.22" is a
  // calculator too.
  const referenced = formulaIdentifiers(formula);
  const literals = formulaLiterals(formula);
  let rewritten = formula;
  if (literals.length > 0) {
    const replacements: Array<Literal & { id: string }> = [];
    for (const literal of literals) {
      const minus = unaryMinusStart(formula, literal.start);
      const target = minus >= 0 ? -literal.value : literal.value;
      const match = fields.find(
        (field) => !referenced.has(asString(field.id) ?? "") && toNumber(field.value) === target,
      );
      const id = asString(match?.id) ?? "";
      if (!id) continue;
      referenced.add(id);
      replacements.push({ ...literal, start: minus >= 0 ? minus : literal.start, id });
    }
    rewritten = replacements.length > 0 ? rewriteFormula(formula, replacements) : formula;
  }

  // A field the formula never mentions would render as a dead input — this
  // is what refuses the owner's case (fields 60 and 4, formula "50 / 4": the
  // 4 becomes Divisore, the 50 stays a constant, and Valore iniziale is dead).
  const dead = ids(fields).find((id) => !referenced.has(id));
  if (dead !== undefined) {
    return {
      miniapp: null,
      refusal: `create_miniapp: the field ${dead} is not used in the formula. Every field must appear in it; drop the ones that do not.`,
    };
  }

  // Validate the rewritten formula exactly as the renderer's evaluator does
  // (length / charset gate + field-id substitution). A formula that is
  // arithmetically invalid is rejected here, not as a dead calculator.
  const vars = fieldsToVars(fields);
  const evaluated = evaluateCalculatorFormula(rewritten, vars);
  if (!evaluated.ok) return { miniapp: null, refusal: null };
  const block: Record<string, unknown> = { type: "calculator", formula: rewritten, fields };
  return {
    miniapp: {
      ...envelope("quick_calculator", asString(slots.title) ?? "", [block]),
      state: recordCalculatorValues({}, vars, evaluated.value),
    },
    refusal: null,
  };
}

/** The field ids of a field list, in order. */
function ids(fields: Record<string, unknown>[]): string[] {
  return fields.map((field) => asString(field.id) ?? "");
}

export function buildQuickCalculator(slots: Record<string, unknown>): Miniapp | null {
  return planQuickCalculator(slots).miniapp;
}

/** The model's precise error for a quick_calculator whose fields and formula
 *  disagree, or null when this failure says nothing more than the generic
 *  slots refusal. */
export function quickCalculatorRefusal(slots: unknown): string | null {
  return isPlainObject(slots) ? planQuickCalculator(slots).refusal : null;
}
