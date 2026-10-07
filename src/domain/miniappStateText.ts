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
 * The walk mirrors the renderer's container keys exactly — an expandable's
 * child reads `<parent>.<childIndex>`, a tab's `<parent>.<tabIndex>.<childIndex>`
 * (AskAssistantMiniappRenderer.tsx) — so nested quiz answers read back under
 * the very key they were written to. Checklist and calculator state is keyed
 * by id, not position, so it reads at any depth. Every envelope here has
 * been through `normalizeMiniapp`, which gives every checklist item a safe,
 * unique id and converts an old checklist's timeline block to the tickable
 * `checklist` block at the boundary.
 */

import { isPlainObject } from "./miniappBuilderCommon";
import {
  calculatorResult,
  calculatorValues,
  checklistItems,
  isItemTicked,
  quizAnswer,
} from "./miniappState";

/** The renderer's child cap (MAX_CHILD_BLOCKS): children past it are never
 *  drawn, so their keys are never written either — mirror it to keep the
 *  indexes aligned. */
const MAX_NESTED_CHILDREN = 24;

/** Past the renderer's deepest reachable child, walking only reads keys
 *  nobody can write — a cheap guard against pathological nesting. */
const MAX_WALK_DEPTH = 5;

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

  /** One block's lines, keyed the way the renderer keyed its state. */
  const emit = (block: Record<string, unknown>, key: string): void => {
    if (block.type === "checklist") {
      for (const item of checklistItems(block)) {
        lines.push(`${isItemTicked(state, item.id) ? "[x]" : "[ ]"} ${oneLine(item.title)}`);
      }
      return;
    }
    if (block.type === "quiz") {
      const answer = quizAnswer(state, key);
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
  };

  /** Depth-first over the blocks, carrying the renderer's `blockKey`. */
  const walk = (blocks: unknown[], keyPrefix: string, depth: number): void => {
    if (depth > MAX_WALK_DEPTH) return;
    blocks.forEach((block, index) => {
      if (!isPlainObject(block)) return;
      const key = keyPrefix === "" ? String(index) : `${keyPrefix}.${index}`;
      emit(block, key);
      if (block.type === "expandable" && Array.isArray(block.blocks)) {
        walk(block.blocks, key, depth + 1);
      } else if (block.type === "tabs") {
        // Same order the renderer reads its tabs in: `tabs` first, then
        // `items` as the fallback list.
        const tabs = [...(Array.isArray(block.tabs) ? block.tabs : []), ...(Array.isArray(block.items) ? block.items : [])];
        tabs.slice(0, MAX_NESTED_CHILDREN).forEach((tab, tabIndex) => {
          if (!isPlainObject(tab) || !Array.isArray(tab.blocks)) return;
          walk(tab.blocks, `${key}.${tabIndex}`, depth + 1);
        });
      }
    });
  };

  walk(miniapp.blocks, "", 0);
  return lines;
}
