/**
 * `create_miniapp` executed: build the miniapp from the model's slots, answer
 * the model with the phone's short result text, and hand the built envelope
 * back on the outcome so the thread can render it. Pure and local — no
 * network, no Tauri command, nothing for the web gate to check.
 */

import type { ToolOutcome } from "../chat";
import { buildMiniappV1 } from "../miniapp/build";
import { quickCalculatorRefusal } from "../miniapp/quickCalculator";
import { MINIAPP_TEMPLATE_IDS, type MiniappTemplateId } from "../miniapp/templates";

/** The phone's English strings for this tool (see its `i18n/en.ts`). */
const INVALID_TEMPLATE = (template: string): string =>
  `create_miniapp: unknown template "${template}". Use compare_data, quick_calculator, reading_quiz, or checklist.`;
const INVALID_SLOTS = "create_miniapp could not build the miniapp from the slots you provided.";
/** What a title-less build is called on the wire: the model reads English,
 *  whatever the interface speaks; the person never sees this name — the view
 *  names it in the interface's language. */
const DEFAULT_TITLES: Record<MiniappTemplateId, string> = {
  compare_data: "Comparison",
  quick_calculator: "Calculator",
  reading_quiz: "Quiz",
  checklist: "Checklist",
};
const CREATED = (title: string, template: MiniappTemplateId): string =>
  `Miniapp created: ${title || DEFAULT_TITLES[template]}`;

export function runCreateMiniapp(args: unknown): ToolOutcome {
  const raw = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const template = typeof raw.template === "string" ? raw.template.trim() : "";

  if (!MINIAPP_TEMPLATE_IDS.includes(template as MiniappTemplateId)) {
    return { text: INVALID_TEMPLATE(template || "—"), ok: false };
  }

  const miniapp = buildMiniappV1(template, raw.slots);
  if (!miniapp) {
    // A quick_calculator whose fields and formula disagree is refused with
    // the precise rule it broke, so the model can retry; the generic line
    // covers everything else.
    const refusal =
      template === "quick_calculator" ? quickCalculatorRefusal(raw.slots) : null;
    return { text: refusal ?? INVALID_SLOTS, ok: false };
  }
  return { text: CREATED(miniapp.title, template as MiniappTemplateId), ok: true, miniapp };
}
