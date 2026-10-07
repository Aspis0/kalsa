// Programmatic builders for the `create_miniapp` tool.
//
// A small on-device model emits a short tool call (template id + slots);
// these builders turn it into a renderable `miniapp_v1` envelope. Each
// template validates its slots strictly and returns `null` on bad input so
// the executor can surface an error instead of rendering a broken miniapp.
//
// The produced envelope only ever uses block types the renderer already
// supports (data_table / calculator / quiz / checklist), so no new UI is
// required.

import { normalizeMiniapp } from "./askAssistant";
import type { AskAssistantMiniapp } from "./askAssistant";
import {
  MINIAPP_TEMPLATE_IDS,
  type MiniappTemplateId,
} from "./miniappTemplates";
import { evaluateCalculatorFormula } from "./miniappCalculator";
import { buildC6c } from "./miniappBuildersNew";
import { recordCalculatorValues } from "./miniappState";
import {
  asString,
  asStringArrayCapped,
  asStringCapped,
  envelope,
  isPlainObject,
  isUnsafeId,
  MAX_ID_CHARS,
  type Slots,
} from "./miniappBuilderCommon";

/** Per-block JSON byte cap (F-5). Duplicated from askAssistant.js
 *  (MAX_BLOCK_JSON_BYTES = 64 * 1024); keep in sync — normalizeMiniappBlock
 *  degrades any block past this to {type:"unknown"}. */
const MAX_BLOCK_JSON_BYTES = 64 * 1024;

/** True when any block (or the full envelope) serializes past MAX_BLOCK_JSON_BYTES,
 *  which normalizeMiniappBlock would otherwise silently degrade to {type:"unknown"}. */
function oversizedBuilt(miniapp: AskAssistantMiniapp): boolean {
  const cap = MAX_BLOCK_JSON_BYTES;
  for (const block of miniapp.blocks) {
    if (JSON.stringify(block).length > cap) return true;
  }
  return JSON.stringify(miniapp).length > cap;
}

function buildCompareData(slots: Slots): AskAssistantMiniapp | null {
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
  return envelope("compare_data", asString(slots.title) ?? "Comparison", [
    block,
  ]);
}

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

/** The renderer draws at most this many inputs (its MAX_CHILD_BLOCKS). A
 *  formula referencing a field past it would render as a dead calculator, so
 *  a longer field list is rejected here instead. */
const MAX_CALCULATOR_FIELDS = 24;

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

function buildQuickCalculator(slots: Slots): AskAssistantMiniapp | null {
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

  // F3: validate the REWRITTEN formula exactly as the renderer's evaluator
  // does (length / charset gate + field-id substitution). A formula that
  // references an unknown id or is arithmetically invalid is rejected here,
  // not as a dead calculator.
  const vars = fieldsToVars(allFields);
  const evaluated = evaluateCalculatorFormula(rewritten, vars);
  if (!evaluated.ok) return null;

  const block: Record<string, unknown> = { type: "calculator", formula: rewritten };
  if (fields || lifted.length > 0) block.fields = allFields;
  // The initial values and result are the envelope's first state, so the next
  // turn's wire carries what the calculator shows even before anyone edits it.
  return {
    ...envelope("quick_calculator", asString(slots.title) ?? "Calculator", [block]),
    state: recordCalculatorValues({}, vars, evaluated.value),
  };
}

/**
 * Build a `miniapp_v1` from a template id + slots, or null when the template
 * is unknown or its slots fail validation. The result is normalized so the
 * executor can hand it straight to `onMiniapp`.
 */
export function buildMiniappV1(
  templateId: string,
  slots: unknown,
): AskAssistantMiniapp | null {
  if (!MINIAPP_TEMPLATE_IDS.includes(templateId as MiniappTemplateId)) {
    return null;
  }
  const safeSlots: Slots = isPlainObject(slots) ? slots : {};

  let built: AskAssistantMiniapp | null;
  switch (templateId as MiniappTemplateId) {
    case "compare_data":
      built = buildCompareData(safeSlots);
      break;
    case "quick_calculator":
      built = buildQuickCalculator(safeSlots);
      break;
    case "reading_quiz":
    case "checklist":
      built = buildC6c(templateId, safeSlots);
      break;
    default:
      return null;
  }
  if (!built) return null;
  // F-5: reject the whole miniapp if any block (or the envelope) exceeds the
  // 64 KiB cap normalizeMiniappBlock applies (MAX_BLOCK_JSON_BYTES).
  if (oversizedBuilt(built)) return null;
  // Second guard: a builder produced something normalizeMiniapp rejects.
  return normalizeMiniapp(built);
}