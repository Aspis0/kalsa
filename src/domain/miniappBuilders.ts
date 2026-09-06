// Programmatic builders for the `create_miniapp` tool.
//
// A small on-device model emits a short tool call (template id + slots);
// these builders turn it into a renderable `miniapp_v1` envelope. Each
// template validates its slots strictly and returns `null` on bad input so
// the executor can surface an error instead of rendering a broken miniapp.
//
// The produced envelope only ever uses block types the renderer already
// supports (data_table / calculator / quiz), so no new UI is required.

import { normalizeMiniapp } from "./askAssistant";
import type { AskAssistantMiniapp } from "./askAssistant";
import {
  MINIAPP_TEMPLATE_IDS,
  type MiniappTemplateId,
} from "./miniappTemplates";
import { evaluateCalculatorFormula } from "./miniappCalculator";

type Slots = Record<string, unknown>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Non-empty trimmed string, or null. */
function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Array of non-empty strings, or null when any entry is not a string. */
function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const entry of value) {
    const cleaned = asString(entry);
    if (cleaned === null) return null;
    out.push(cleaned);
  }
  return out;
}

/** Integer answer index that addresses a real option (0..length-1), else undefined. */
function safeAnswerIndex(
  raw: unknown,
  optionCount: number,
): number | undefined {
  const asInt = (n: number) =>
    Number.isInteger(n) && n >= 0 && n < optionCount ? n : undefined;
  if (typeof raw === "number") return asInt(raw);
  if (typeof raw === "string" && /^\s*-?\d+\s*$/.test(raw)) {
    return asInt(Number(raw));
  }
  return undefined;
}

function envelope(
  templateId: MiniappTemplateId,
  title: string,
  blocks: Array<Record<string, unknown>>,
): AskAssistantMiniapp {
  return {
    schema: "miniapp_v1",
    kind: templateId,
    title: title || "Miniapp",
    blocks,
  };
}

function buildCompareData(slots: Slots): AskAssistantMiniapp | null {
  const columns = asStringArray(slots.columns);
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
    // F4: reject empty or duplicate field ids (duplicate ids collide on the
    // renderer's per-field state key — one input overwrites the other).
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

function buildQuickCalculator(slots: Slots): AskAssistantMiniapp | null {
  const formula = asString(slots.formula);
  if (!formula) return null;

  const fields = buildCalculatorFields(slots.fields);
  if (fields === null) return null; // provided but invalid

  // F3: validate the formula exactly as the renderer's evaluator does (length /
  // charset gate + field-id substitution). A formula that references an unknown
  // id or is arithmetically invalid is rejected here, not as a dead calculator.
  if (!evaluateCalculatorFormula(formula, fieldsToVars(fields)).ok) return null;

  const block: Record<string, unknown> = { type: "calculator", formula };
  if (fields) block.fields = fields; // omitted fields are optional
  return envelope("quick_calculator", asString(slots.title) ?? "Calculator", [
    block,
  ]);
}

function buildReadingQuiz(slots: Slots): AskAssistantMiniapp | null {
  const question = asString(slots.question);
  if (!question) return null;

  // F2: cap to 2..4 options. More than 4 is rejected as invalid slots so that
  // any safe answerIndex (0..length-1) always addresses a kept option — the
  // renderer truncates to 4, so an out-of-range index would silently disable
  // grading. No truncation happens here, so answerIndex can never be invalidated.
  const options = asStringArray(slots.options);
  if (!options || options.length < 2 || options.length > 4) return null;

  const block: Record<string, unknown> = {
    type: "quiz",
    question,
    options,
  };
  const answerIndex = safeAnswerIndex(slots.answerIndex, options.length);
  if (answerIndex !== undefined) block.answerIndex = answerIndex;
  const explanation = asString(slots.explanation);
  if (explanation) block.explanation = explanation;

  return envelope("reading_quiz", asString(slots.title) ?? "Quiz", [block]);
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
      built = buildReadingQuiz(safeSlots);
      break;
    default:
      return null;
  }
  if (!built) return null;
  // Second guard: a builder produced something normalizeMiniapp rejects.
  return normalizeMiniapp(built);
}