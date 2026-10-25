/**
 * What a mini app remembers across reloads: the state stored in the envelope
 * (`miniapp.state`), the readers that resolve it against a block, and the
 * pure transitions the widgets write through. State is keyed by stable ids —
 * the checklist builder's item ids, the block's position for a quiz — never
 * by anything that moves when the conversation is replayed.
 */

import { isPlainObject } from "./slots";

/** The checklist items a block holds, ids resolved: the builder's `{id,
 *  title}` items, or an old timeline-shaped `steps` block whose items have
 *  no id and fall back to their index — in a stored payload just as stable. */
export function checklistItems(block: Record<string, unknown>): Array<{ id: string; title: string }> {
  const items = Array.isArray(block.items) ? block.items : Array.isArray(block.steps) ? block.steps : [];
  return items.flatMap((entry, index) => {
    const record = isPlainObject(entry) ? entry : null;
    const title = typeof record?.title === "string" ? record.title.trim() : "";
    if (!title) return [];
    return [{ id: typeof record?.id === "string" && record.id ? record.id : String(index), title }];
  });
}

/** True when the checklist item with this id is ticked. */
export function isItemTicked(state: unknown, itemId: string): boolean {
  const checked = isPlainObject(state) && isPlainObject(state.checked) ? state.checked : {};
  return checked[itemId] === true;
}

/** Tick or untick one checklist item; unticking removes the key, so the
 *  state never grows a graveyard of `false`s. */
export function toggleChecklistItem(
  state: Record<string, unknown>,
  itemId: string,
  ticked: boolean,
): Record<string, unknown> {
  const checked = { ...(isPlainObject(state.checked) ? state.checked : {}) };
  if (ticked) checked[itemId] = true;
  else delete checked[itemId];
  return { ...state, checked };
}

export interface QuizAnswer {
  picked: number;
  checked: boolean;
  correct: boolean;
}

/** The stored answer of the quiz block at this position, or null. */
export function quizAnswer(state: unknown, blockIndex: number): QuizAnswer | null {
  const answers = isPlainObject(state) && isPlainObject(state.quiz) ? state.quiz : {};
  const entry = answers[String(blockIndex)];
  if (!isPlainObject(entry) || typeof entry.picked !== "number") return null;
  return { picked: entry.picked, checked: entry.checked === true, correct: entry.correct === true };
}

/** Store the quiz block's answer; `picked: null` clears it (a retry). */
export function recordQuizAnswer(
  state: Record<string, unknown>,
  blockIndex: number,
  picked: number | null,
  checked: boolean,
  correct: boolean,
): Record<string, unknown> {
  const answers = { ...(isPlainObject(state.quiz) ? state.quiz : {}) };
  if (picked === null) delete answers[String(blockIndex)];
  else answers[String(blockIndex)] = { picked, checked, correct };
  return { ...state, quiz: answers };
}

/** The calculator's stored field values, or null when none are stored. */
export function calculatorValues(state: unknown): Record<string, number> | null {
  const calculator = isPlainObject(state) && isPlainObject(state.calculator) ? state.calculator : null;
  if (!calculator || !isPlainObject(calculator.fields)) return null;
  const fields: Record<string, number> = {};
  for (const [id, value] of Object.entries(calculator.fields)) {
    if (typeof value === "number" && Number.isFinite(value)) fields[id] = value;
  }
  return Object.keys(fields).length > 0 ? fields : null;
}

/** The calculator's stored result, or null. */
export function calculatorResult(state: unknown): number | null {
  const calculator = isPlainObject(state) && isPlainObject(state.calculator) ? state.calculator : null;
  const result = calculator?.result;
  return typeof result === "number" && Number.isFinite(result) ? result : null;
}

/** Store the calculator's current field values and result. A result that is
 *  not a finite number (nothing entered, unsupported formula) is left out —
 *  the absence is the fact. */
export function recordCalculatorValues(
  state: Record<string, unknown>,
  fields: Record<string, number>,
  result: number | null,
): Record<string, unknown> {
  return {
    ...state,
    calculator: { fields: { ...fields }, ...(result === null ? {} : { result }) },
  };
}
