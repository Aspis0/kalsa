/**
 * The state a mini app holds, as the plain lines the replayed tool result
 * carries on the next turn's wire — never the envelope, only what tells the
 * model where the person left the widgets. The wire language is English
 * whatever the interface speaks.
 *
 *   checklist:  "[x] Milk" / "[ ] Eggs", in block order
 *   quiz:       "Q: <question> picked: <option> (correct|wrong)"
 *   calculator: "<fieldId> = <value>" per field, then "Result: <value>"
 */

import type { Miniapp } from "./types";
import { calculatorResult, calculatorValues, checklistItems, isItemTicked, quizAnswer } from "./state";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function miniappStateLines(miniapp: Miniapp): string[] {
  const state = miniapp.state ?? {};
  const lines: string[] = [];
  miniapp.blocks.forEach((block, index) => {
    if (block.type === "checklist") {
      for (const item of checklistItems(block)) {
        lines.push(`${isItemTicked(state, item.id) ? "[x]" : "[ ]"} ${item.title}`);
      }
      return;
    }
    if (block.type === "quiz") {
      const answer = quizAnswer(state, index);
      const options = Array.isArray(block.options) ? block.options : [];
      const picked = answer ? options[answer.picked] : undefined;
      if (answer && typeof picked === "string") {
        const verdict = answer.checked ? (answer.correct ? " (correct)" : " (wrong)") : "";
        const question = typeof block.question === "string" ? block.question : "";
        lines.push(`Q: ${question} picked: ${picked}${verdict}`);
      }
      return;
    }
    if (block.type === "calculator") {
      const values = calculatorValues(state);
      for (const field of Array.isArray(block.fields) ? block.fields : []) {
        const record = asRecord(field);
        const id = typeof record.id === "string" ? record.id : "";
        const value = values?.[id];
        if (id && typeof value === "number") lines.push(`${id} = ${value}`);
      }
      const result = calculatorResult(state);
      if (result !== null) lines.push(`Result: ${result}`);
    }
  });
  return lines;
}
