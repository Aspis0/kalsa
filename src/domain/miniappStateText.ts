/**
 * The state a mini app holds, as the plain lines the model-facing history
 * carries on a later turn's wire — never the envelope, only what tells the
 * model where the person left the widgets. The wire language is English
 * whatever the interface speaks.
 *
 *   checklist:  "[x] Milk" / "[ ] Eggs", in block order
 *   quiz:       "Q: <question> picked: <option> (correct|wrong)"
 *   calculator: "<fieldId> = <value>" per field, then "Result: <value>"
 *
 * Every model-authored string is flattened to one line first: a title or
 * question carrying a newline would otherwise forge extra state lines.
 *
 * Only the shapes above are read: every miniapp in a stored message has
 * been through `normalizeMiniapp`, which converts an old checklist's
 * timeline block to the tickable `checklist` block at the boundary.
 */

import { isPlainObject } from "./miniappBuilderCommon";
import {
  calculatorResult,
  calculatorValues,
  checklistItems,
  isItemTicked,
  quizAnswer,
} from "./miniappState";

/** Whitespace and newlines to single spaces: nothing model-authored may
 *  break a state line in two. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The state lines of one envelope, or [] when it holds no state the model
 *  could act on. Reads stored data defensively — this runs for every history
 *  message on every send, and a corrupt envelope must not fail the turn. */
export function miniappStateLines(miniapp: unknown): string[] {
  if (!isPlainObject(miniapp)) return [];
  const state = isPlainObject(miniapp.state) ? miniapp.state : {};
  if (!Array.isArray(miniapp.blocks)) return [];
  const lines: string[] = [];
  miniapp.blocks.forEach((block, index) => {
    if (!isPlainObject(block)) return;
    if (block.type === "checklist") {
      for (const item of checklistItems(block)) {
        lines.push(`${isItemTicked(state, item.id) ? "[x]" : "[ ]"} ${oneLine(item.title)}`);
      }
      return;
    }
    if (block.type === "quiz") {
      const answer = quizAnswer(state, String(index));
      const options = Array.isArray(block.options) ? block.options : [];
      const picked = answer ? options[answer.picked] : undefined;
      if (answer && typeof picked === "string") {
        const verdict = answer.checked ? (answer.correct ? " (correct)" : " (wrong)") : "";
        const question = typeof block.question === "string" ? block.question : "";
        lines.push(`Q: ${oneLine(question)} picked: ${oneLine(picked)}${verdict}`);
      }
      return;
    }
    if (block.type === "calculator") {
      const values = calculatorValues(state);
      const fields = Array.isArray(block.fields) ? block.fields : [];
      for (const field of fields) {
        if (!isPlainObject(field)) continue;
        if (typeof field.id !== "string") continue;
        const value = values?.[field.id];
        if (value !== undefined) lines.push(`${oneLine(field.id)} = ${value}`);
      }
      const result = calculatorResult(state);
      if (result !== null) lines.push(`Result: ${result}`);
    }
  });
  return lines;
}
