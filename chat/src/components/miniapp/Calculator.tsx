import { useState } from "react";
import { evaluateCalculatorFormula } from "../../lib/miniapp/calculator";
import { calculatorValues, recordCalculatorValues } from "../../lib/miniapp/state";
import { MAX_CALCULATOR_FIELDS } from "../../lib/miniapp/quickCalculator";
import { useLanguage } from "../../i18n/useLanguage";
import { asArray, asRecord, asText, formatNumber, parseLocaleNumber } from "./values";

/**
 * A `calculator` block: one numeric input per field, and the result evaluated
 * live through the ported parser — never eval, never Function. The field cap
 * is the builder's own, so a formula can never reference a field this refuses
 * to draw. Each edit is written through to the envelope's state, so the next
 * turn's wire carries the values the person left.
 *
 * The person never sees an id: a field the builder lifted from a bare literal
 * has ids like `n1` and is named "Number n" here, in the interface's
 * language, and the formula reads with the fields' names in place of their
 * ids. The envelope title is the calculator's only title.
 */

const LIFTED_ID = /^(?:n)(\d+)$/;

/** The text of one input as a number, read the way the interface's language
 *  writes numbers — "12.500" is 12500 in Italian, 12.5 in English. A field
 *  mid-typing ("1.", "-") parses to nothing and simply contributes no value
 *  yet. */
function parseCell(raw: string, tag: string): number | undefined {
  const parsed = parseLocaleNumber(raw, tag);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseAll(texts: Record<string, string>, tag: string): Record<string, number> {
  const numbers: Record<string, number> = {};
  for (const [id, raw] of Object.entries(texts)) {
    const n = parseCell(raw, tag);
    if (n !== undefined) numbers[id] = n;
  }
  return numbers;
}

export function Calculator({
  block,
  state,
  onState,
}: {
  block: Record<string, unknown>;
  state?: Record<string, unknown>;
  onState?: (state: Record<string, unknown>) => void;
}) {
  const { table, tag } = useLanguage();
  const t = table.miniapp;
  const fields = asArray(block.fields, MAX_CALCULATOR_FIELDS).map(asRecord);
  // Each field's name, by id: the model's label, or "Number n" for a lifted
  // one. The inputs and the formula read the same names.
  const names = new Map(
    fields.map((field, index) => {
      const id = asText(field.id, `field_${index}`);
      const lifted = LIFTED_ID.exec(id);
      const name =
        asText(field.label, "") || (lifted ? t.numberField(Number(lifted[1])) : t.numberField(index + 1));
      return [id, name] as const;
    }),
  );
  const stored = calculatorValues(state);
  // What the inputs hold is TEXT: parsing on every keystroke would eat the
  // dot of "1." and snap "-" back the moment it is typed. The numbers the
  // formula reads are derived, and only those are persisted.
  const [texts, setTexts] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    fields.forEach((field, index) => {
      const id = asText(field.id, `field_${index}`);
      const remembered = stored?.[id];
      seed[id] = remembered !== undefined ? String(remembered) : asText(field.value, "");
    });
    return seed;
  });
  const formula = asText(block.formula ?? block.expr, "");

  // One road for both the input's own state and the envelope's: the result is
  // stored with the values, and a formula that currently evaluates to nothing
  // stores no result — the absence is the fact.
  function edit(id: string, raw: string): void {
    const next = { ...texts, [id]: raw };
    setTexts(next);
    const numbers = parseAll(next, tag);
    const live = formula ? evaluateCalculatorFormula(formula, numbers) : null;
    onState?.(recordCalculatorValues(state ?? {}, numbers, live && live.ok ? live.value : null));
  }

  const live = formula ? evaluateCalculatorFormula(formula, parseAll(texts, tag)) : null;
  let displayValue: string;
  if (live && live.ok) {
    displayValue = formatNumber(live.value, tag, 4);
  } else if (live && !live.ok) {
    displayValue = t.unsupportedFormula;
  } else {
    displayValue = asText(block.value ?? block.result, t.noResult);
  }

  // The formula as the person reads it: the fields' names where their ids
  // were, one pass over whole ids so "n1" never matches inside "n12". Each
  // name rides as its own boxed token — an operator between two boxes keeps
  // the precedence readable, whatever spaces the name carries — and inside
  // <bdi>, so a name that runs the other way cannot scramble the line.
  const escapeId = (id: string) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const formulaParts: Array<{ text: string; id?: string }> = [];
  if (formula) {
    if (names.size > 0) {
      const idPattern = new RegExp(`\\b(${[...names.keys()].map(escapeId).join("|")})\\b`, "g");
      let cursor = 0;
      for (const matched of formula.matchAll(idPattern)) {
        const at = matched.index ?? 0;
        if (at > cursor) formulaParts.push({ text: formula.slice(cursor, at) });
        formulaParts.push({ text: names.get(matched[0]) ?? matched[0], id: matched[0] });
        cursor = at + matched[0].length;
      }
      formulaParts.push({ text: formula.slice(cursor) });
    } else {
      formulaParts.push({ text: formula });
    }
  }

  return (
    <div className="miniapp-block">
      <div className="miniapp-fields">
        {fields.map((field, index) => {
          const id = asText(field.id, `field_${index}`);
          const unit = asText(field.unit);
          const label = (names.get(id) ?? id) + (unit ? ` (${unit})` : "");
          return (
            <label className="miniapp-field" key={id}>
              <span className="miniapp-field-label">{label}</span>
              <input
                className="miniapp-input"
                inputMode="decimal"
                value={texts[id] ?? ""}
                onChange={(event) => edit(id, event.target.value)}
              />
            </label>
          );
        })}
      </div>
      {formulaParts.length > 0 ? (
        <p className="miniapp-formula">
          <span className="miniapp-note-label">{t.formula}</span>
          <span className="miniapp-formula-text">
            {formulaParts.map((part, index) =>
              part.id !== undefined ? (
                <bdi key={index} className="miniapp-formula-name">
                  {part.text}
                </bdi>
              ) : (
                <span key={index}>{part.text}</span>
              ),
            )}
          </span>
        </p>
      ) : null}
      <p className="miniapp-formula">
        <span className="miniapp-note-label">{asText(block.label, t.result)}</span>
        <span className="miniapp-result">{displayValue}</span>
      </p>
    </div>
  );
}
