// quick_calculator → one `calculator` block. The fields decide how bare numbers
// are read — the model proposes, the code decides: with no fields every literal
// is lifted into an editable field; with fields a literal takes the id of a free
// field holding its value, and any other literal stays a constant.

import type { AskAssistantMiniapp } from "./askAssistant";
import { evaluateCalculatorFormula } from "./miniappCalculator";
import { recordCalculatorValues } from "./miniappState";
import {
  asString,
  asStringCapped,
  isPlainObject,
  isUnsafeId,
  MAX_ID_CHARS,
  type Slots,
} from "./miniappBuilderCommon";

/** The renderer draws at most this many inputs (its MAX_CHILD_BLOCKS). A
 *  formula referencing a field past it would render as a dead calculator, so
 *  a longer field list is rejected here instead. */
const MAX_CALCULATOR_FIELDS = 24;

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
    // F4: reject empty, duplicate, oversized and unsafe field ids (duplicate
    // ids collide on the renderer's per-field state key — one input overwrites
    // the other; an unsafe one writes along the prototype chain instead of it).
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

/** The identifiers the formula reads fields by. */
function formulaIdentifiers(formula: string): Set<string> {
  return new Set(formula.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);
}

/** Where the unary minus before this literal starts, or -1 when there is none.
 *  It is unary when the minus sits at the formula's start or after an operator
 *  or "(" — otherwise it is the binary minus of "a - 5". */
function unaryMinusStart(formula: string, start: number): number {
  let at = start - 1;
  while (at >= 0 && /\s/.test(formula[at])) at -= 1;
  if (at < 0 || formula[at] !== "-") return -1;
  let before = at - 1;
  while (before >= 0 && /\s/.test(formula[before])) before -= 1;
  return before < 0 || /[+\-*/(]/.test(formula[before]) ? at : -1;
}

/** Replaces each literal span with its field id, left to right. */
function rewriteFormula(formula: string, replacements: Array<Literal & { id: string }>): string {
  const parts: string[] = [];
  let cursor = 0;
  for (const span of replacements) {
    parts.push(formula.slice(cursor, span.start), span.id);
    cursor = span.end;
  }
  return parts.join("") + formula.slice(cursor);
}

function fieldIds(fields: Record<string, unknown>[]): string[] {
  return fields.map((field) => asString(field.id) ?? "");
}

/** One planned build: the envelope, or the English refusal the model retries
 *  on. Only the field rules a retry can fix carry a refusal; a malformed
 *  formula stays the generic slots refusal. */
type Plan = { miniapp: AskAssistantMiniapp | null; refusal: string | null };

const FAILED: Plan = { miniapp: null, refusal: null };

function refused(refusal: string): Plan {
  return { miniapp: null, refusal };
}

/** The envelope for a formula whose fields are settled. Its first state holds
 *  the values and the result, so the next turn's wire carries what the
 *  calculator shows before anyone edits it. No title is stored when none was
 *  given: the view names a calculator in the interface's language. */
function seal(slots: Slots, formula: string, fields: Record<string, unknown>[]): Plan {
  const vars = fieldsToVars(fields);
  const evaluated = evaluateCalculatorFormula(formula, vars);
  if (!evaluated.ok) return FAILED;
  const miniapp: AskAssistantMiniapp = {
    schema: "miniapp_v1",
    kind: "quick_calculator",
    title: asString(slots.title) ?? "",
    blocks: [{ type: "calculator", formula, fields }],
    state: recordCalculatorValues({}, vars, evaluated.value),
  };
  return { miniapp, refusal: null };
}

/** No fields given: every literal becomes an editable field, so the person can
 *  play with the numbers the model hardcoded. Lifted ids are minted n1, n2…
 *  past any identifier the formula already uses, and carry no label — the
 *  renderer names a lifted field in the interface's language. */
function liftLiterals(slots: Slots, formula: string): Plan {
  const taken = formulaIdentifiers(formula);
  let next = 1;
  const idFor = (): string => {
    while (taken.has(`n${next}`)) next += 1;
    const id = `n${next}`;
    taken.add(id);
    next += 1;
    return id;
  };
  const replacements = formulaLiterals(formula).map((literal) => ({ ...literal, id: idFor() }));
  if (replacements.length > MAX_CALCULATOR_FIELDS) return FAILED;
  const lifted = replacements.map(({ id, value }) => ({ id, value }));
  return seal(slots, rewriteFormula(formula, replacements), lifted);
}

/** Fields given: every identifier must be a field, and every field must appear
 *  in the formula, or it would render as a dead input. A literal takes a free
 *  field's id when the field holds its value; any other literal stays a
 *  constant. */
function fieldsFormula(slots: Slots, formula: string, fields: Record<string, unknown>[]): Plan {
  if (fields.length > MAX_CALCULATOR_FIELDS) return FAILED;
  const known = new Set(fieldIds(fields));
  const identifiers = formulaIdentifiers(formula);
  for (const id of identifiers) {
    if (!known.has(id)) {
      return refused(
        `create_miniapp: the formula references ${id}, which is not one of the fields. Write the formula from the field ids you gave.`,
      );
    }
  }

  // A literal takes the id of a field the formula does not reference yet, when
  // that field holds the literal's value; a unary minus on the literal matches
  // a negative field and is absorbed. Any other literal stays a constant:
  // "amount * 1.22" is a calculator too.
  const referenced = new Set(identifiers);
  const replacements: Array<Literal & { id: string }> = [];
  for (const literal of formulaLiterals(formula)) {
    const minus = unaryMinusStart(formula, literal.start);
    const target = minus >= 0 ? -literal.value : literal.value;
    const match = fields.find(
      (field) => !referenced.has(asString(field.id) ?? "") && toNumber(field.value) === target,
    );
    const id = asString(match?.id);
    if (!id) continue;
    referenced.add(id);
    replacements.push({ ...literal, start: minus >= 0 ? minus : literal.start, id });
  }

  const rewritten = rewriteFormula(formula, replacements);
  const dead = fieldIds(fields).find((id) => !referenced.has(id));
  if (dead !== undefined) {
    return refused(
      `create_miniapp: the field ${dead} is not used in the formula. Every field must appear in it; drop the ones that do not.`,
    );
  }
  return seal(slots, rewritten, fields);
}

function planQuickCalculator(slots: Slots): Plan {
  const formula = asStringCapped(slots.formula);
  if (!formula) return FAILED;
  const fields = buildCalculatorFields(slots.fields);
  if (fields === null) return FAILED; // provided but invalid
  return fields && fields.length > 0 ? fieldsFormula(slots, formula, fields) : liftLiterals(slots, formula);
}

export function buildQuickCalculator(slots: Slots): AskAssistantMiniapp | null {
  return planQuickCalculator(slots).miniapp;
}

/** The model's precise refusal for a quick_calculator whose fields and formula
 *  disagree, or null when the failure is only the generic slots refusal. */
export function quickCalculatorRefusal(slots: unknown): string | null {
  return isPlainObject(slots) ? planQuickCalculator(slots).refusal : null;
}
