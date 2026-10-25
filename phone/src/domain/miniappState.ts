// The state a mini app keeps in its envelope (`miniapp.state`): the readers
// that resolve it against a block, and the transitions the widgets write
// through. State is keyed by stable ids — the checklist builder's item ids,
// falling back to the item's position when a hand-written block gave none —
// never by anything that moves when the conversation is replayed.

import { isPlainObject } from "./miniappBuilderCommon";

/** The checklist items a block holds, ids resolved: the builder's `{id,
 *  title}` items, or a hand-written block whose items have no id and fall
 *  back to their index — stable in a stored payload just as much. */
export function checklistItems(
  block: Record<string, unknown>,
): Array<{ id: string; title: string }> {
  const items = Array.isArray(block.items) ? block.items : [];
  return items.flatMap((entry, index) => {
    if (!isPlainObject(entry)) return [];
    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    if (!title) return [];
    return [{ id: typeof entry.id === "string" && entry.id ? entry.id : String(index), title }];
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

/** The stored answer of the quiz block keyed by `blockKey` (its position in
 *  the envelope's `blocks`), or null when nothing was picked. */
export function quizAnswer(state: unknown, blockKey: string): QuizAnswer | null {
  const answers = isPlainObject(state) && isPlainObject(state.quiz) ? state.quiz : {};
  const entry = answers[blockKey];
  if (!isPlainObject(entry) || typeof entry.picked !== "number") return null;
  return { picked: entry.picked, checked: entry.checked === true, correct: entry.correct === true };
}

/** Store the quiz block's answer; `picked: null` clears it (a retry). */
export function recordQuizAnswer(
  state: Record<string, unknown>,
  blockKey: string,
  picked: number | null,
  checked: boolean,
  correct: boolean,
): Record<string, unknown> {
  const answers = { ...(isPlainObject(state.quiz) ? state.quiz : {}) };
  if (picked === null) delete answers[blockKey];
  else answers[blockKey] = { picked, checked, correct };
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
