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
import { buildC6c, type ColumnLabels } from "./miniappBuildersNew";
import {
  asString,
  asStringArrayCapped,
  asStringCapped,
  envelope,
  isPlainObject,
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
  const formula = asStringCapped(slots.formula);
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

/**
 * Build a `miniapp_v1` from a template id + slots, or null when the template
 * is unknown or its slots fail validation. The result is normalized so the
 * executor can hand it straight to `onMiniapp`.
 */
export function buildMiniappV1(
  templateId: string,
  slots: unknown,
  labels?: ColumnLabels,
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
    case "kpi_strip":
    case "checklist":
    case "pros_cons":
      built = buildC6c(templateId, safeSlots, labels);
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