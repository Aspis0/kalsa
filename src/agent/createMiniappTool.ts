// `create_miniapp` tool: definition + executor.
//
// On success the executor builds a miniapp_v1 (see miniappBuilders.ts), hands
// it to `onMiniapp` so it opens inline in the chat, and returns a short result
// text for the model's synthesis round. On invalid template/slots it returns a
// clear error string and does NOT call onMiniapp (no broken UI).

import { getStrings, type Locale } from "../i18n";
import type { AskAssistantMiniapp } from "../domain/askAssistant";
import {
  MINIAPP_TEMPLATE_IDS,
  type MiniappTemplateId,
} from "../domain/miniappTemplates";
import { buildMiniappV1 } from "../domain/miniappBuilders";
import { normalizeMiniapp } from "../domain/askAssistant";
import type { EngineTool, EngineToolResult } from "../engine/LlamaService";

export const CREATE_MINIAPP_TOOL: EngineTool = {
  type: "function",
  function: {
    name: "create_miniapp",
    description:
      "Build an interactive on-device miniapp in a single call. Pick one " +
      "template — compare_data (a comparison table), quick_calculator (a " +
      "formula calculator), reading_quiz (a quiz with several questions), " +
      "kpi_strip (key metrics), checklist (ordered steps), or pros_cons (pros " +
      "vs cons) — and pass its slots. The app opens inline in the chat. Use " +
      "this instead of writing miniapp JSON by hand.",
    parameters: {
      type: "object",
      properties: {
        template: {
          type: "string",
          enum: [...MINIAPP_TEMPLATE_IDS] as MiniappTemplateId[],
          description: "Which miniapp template to build.",
        },
        slots: {
          type: "object",
          description:
            "Per-template slots: compare_data (title?, columns[], rows[]), " +
            "quick_calculator (title?, formula, fields[]), reading_quiz " +
            "(title?, questions[] of {question, options[2..4], answerIndex?, " +
            "explanation?}), kpi_strip (title?, metrics[] of {label, value, " +
            "unit?, tone?}), checklist (title?, steps[] or items[]), or " +
            "pros_cons (title?, rows[] of {pro?, con?}).",
          additionalProperties: true,
        },
      },
      required: ["template"],
    },
  },
};

type CreateMiniappDeps = {
  /** Opens the built miniapp inline (AppShell wires this to message state). */
  onMiniapp?: (miniapp: AskAssistantMiniapp) => void;
};

/**
 * Execute a `create_miniapp` call. Synchronous: no I/O, so abort is not
 * applicable. Returns a result whose `kind` tags provenance for telemetry.
 */
export function makeCreateMiniappExecutor(
  locale: Locale,
  deps?: CreateMiniappDeps,
): (
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<EngineToolResult> {
  const onMiniapp = deps?.onMiniapp;

  return async (name, args) => {
    const strings = getStrings(locale);
    if (name !== "create_miniapp") {
      return { text: strings.errors.unknownTool.replace("{name}", name) };
    }

    const raw = args && typeof args === "object" ? args : {};
    const template = typeof raw.template === "string" ? raw.template.trim() : "";

    if (
      !MINIAPP_TEMPLATE_IDS.includes(
        template as MiniappTemplateId,
      )
    ) {
      return {
        text: strings.errors
          .createMiniappInvalidTemplate
          ?.replace("{template}", template || "—"),
        kind: "create_miniapp",
        error: "invalid_template",
      };
    }

    const built = buildMiniappV1(template, raw.slots, {
      pro: strings.miniapp.pro,
      con: strings.miniapp.con,
    });
    const normalized = built ? normalizeMiniapp(built) : null;
    if (!normalized) {
      return {
        text: strings.errors.createMiniappInvalidSlots,
        kind: "create_miniapp",
        error: "invalid_slots",
      };
    }

    onMiniapp?.(normalized);
    return {
      text: strings.errors.createMiniappCreated?.replace(
        "{title}",
        normalized.title,
      ),
      kind: "create_miniapp",
    };
  };
}