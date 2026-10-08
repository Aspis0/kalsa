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
import { buildC6c } from "./miniappBuildersNew";
import { buildQuickCalculator } from "./miniappQuickCalculator";
import {
  asString,
  asStringArrayCapped,
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
