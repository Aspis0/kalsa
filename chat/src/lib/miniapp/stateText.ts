/**
 * The state a mini app holds, as the plain lines the replayed tool result
 * carries on the next turn's wire — never the envelope, only what tells the
 * model where the person left the widgets. The wire language is English
 * whatever the interface speaks.
 *
 *   checklist:  "[x] Milk" / "[ ] Eggs", in block order
 *   quiz:       "Q: <question> picked: <option> (correct|wrong)"
 *   calculator: "<fieldId> = <value>" per field, then "Result: <value>"
 *
 * Every model-authored string is flattened to one line first: a title or id
 * carrying a newline would otherwise forge extra state lines.
 */

import type { Miniapp } from "./types";
import { calculatorResult, calculatorValues, checklistItems, isItemTicked, quizAnswer } from "./state";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Whitespace and newlines to single spaces: nothing model-authored may
 *  break a state line in two. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function miniappStateLines(miniapp: Miniapp): string[] {
  const state = miniapp.state ?? {};
  const lines: string[] = [];
  miniapp.blocks.forEach((block, index) => {
    // An old saved checklist carries a timeline block; it renders tickable,
    // so its ticks ride too.
    const tickable =
      block.type === "checklist" || (block.type === "timeline" && miniapp.kind === "checklist");
    if (tickable) {
      for (const item of checklistItems(block)) {
        lines.push(`${isItemTicked(state, item.id) ? "[x]" : "[ ]"} ${oneLine(item.title)}`);
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
        lines.push(`Q: ${oneLine(question)} picked: ${oneLine(picked)}${verdict}`);
      }
      return;
    }
    if (block.type === "calculator") {
      const values = calculatorValues(state);
      for (const field of Array.isArray(block.fields) ? block.fields : []) {
        const id = asRecord(field).id;
        if (typeof id !== "string") continue;
        const value = values?.[id];
        if (value !== undefined) lines.push(`${oneLine(id)} = ${value}`);
      }
      const result = calculatorResult(state);
      if (result !== null) lines.push(`Result: ${result}`);
    }
  });
  return lines;
}
