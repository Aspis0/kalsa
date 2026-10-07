/**
 * `buildMiniappV1`: template id + slots → a normalized `miniapp_v1`, or null
 * when the template is unknown or its slots fail validation. The one entry
 * point the `create_miniapp` tool calls.
 */

import { buildChecklist } from "./checklist";
import { buildCompareData } from "./compareData";
import { normalizeMiniapp } from "./normalize";
import { buildQuickCalculator } from "./quickCalculator";
import { buildNQuestionQuiz } from "./readingQuiz";
import { isPlainObject } from "./slots";
import { MINIAPP_TEMPLATE_IDS, type MiniappTemplateId } from "./templates";
import type { Miniapp } from "./types";

/** Per-block JSON byte cap. `normalizeMiniappBlock` degrades any block past
 *  this to {type:"unknown"}; here it rejects the whole build instead, so a
 *  miniapp the model asked for never comes back silently empty. */
const MAX_BLOCK_JSON_BYTES = 64 * 1024;

/** True when any block (or the full envelope) serializes past the cap. */
function oversizedBuilt(miniapp: Miniapp): boolean {
  const cap = MAX_BLOCK_JSON_BYTES;
  for (const block of miniapp.blocks) {
    if (JSON.stringify(block).length > cap) return true;
  }
  return JSON.stringify(miniapp).length > cap;
}

export function buildMiniappV1(templateId: string, slots: unknown): Miniapp | null {
  if (!MINIAPP_TEMPLATE_IDS.includes(templateId as MiniappTemplateId)) {
    return null;
  }
  const safeSlots: Record<string, unknown> = isPlainObject(slots) ? slots : {};

  let built: Miniapp | null;
  switch (templateId as MiniappTemplateId) {
    case "compare_data":
      built = buildCompareData(safeSlots);
      break;
    case "quick_calculator":
      built = buildQuickCalculator(safeSlots);
      break;
    case "reading_quiz":
      built = buildNQuestionQuiz(safeSlots);
      break;
    case "checklist":
      built = buildChecklist(safeSlots);
      break;
    default:
      return null;
  }
  if (!built) return null;
  if (oversizedBuilt(built)) return null;
  // Second guard: a builder produced something normalizeMiniapp rejects.
  return normalizeMiniapp(built);
}
