import { useState } from "react";
import { evaluateCalculatorFormula } from "../../lib/miniapp/calculator";
import { calculatorValues, recordCalculatorValues } from "../../lib/miniapp/state";
import { MAX_CALCULATOR_FIELDS } from "../../lib/miniapp/quickCalculator";
import { useLanguage } from "../../i18n/useLanguage";
import { asArray, asNumber, asRecord, asText, formatNumber } from "./values";

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

/** The text of one input as a number, when it reads as one — a comma is a
 *  decimal mark, as it is on the phone. A field mid-typing ("1.", "-")
 *  parses to nothing and simply contributes no value yet. */
function parseCell(raw: string): number | undefined {
  const parsed = asNumber(raw, Number.NaN);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseAll(texts: Record<string, string>): Record<string, number> {
  const numbers: Record<string, number> = {};
  for (const [id, raw] of Object.entries(texts)) {
    const n = parseCell(raw);
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
    const numbers = parseAll(next);
    const live = formula ? evaluateCalculatorFormula(formula, numbers) : null;
    onState?.(recordCalculatorValues(state ?? {}, numbers, live && live.ok ? live.value : null));
  }

  const live = formula ? evaluateCalculatorFormula(formula, parseAll(texts)) : null;
  let displayValue: string;
  if (live && live.ok) {
    displayValue = formatNumber(live.value, tag, 4);
  } else if (live && !live.ok) {
    displayValue = t.unsupportedFormula;
  } else {
    displayValue = asText(block.value ?? block.result, t.noResult);
  }

  // The formula as the person reads it: the fields' names where their ids
  // were. One pass over an alternation of whole ids, so "n1" never matches
  // inside "n12" and a name can never be re-substituted.
  const escapeId = (id: string) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const labeledFormula =
    formula && names.size > 0
      ? formula.replace(
          new RegExp(`\\b(${[...names.keys()].map(escapeId).join("|")})\\b`, "g"),
          (matched) => names.get(matched) ?? matched,
        )
      : formula;

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
      {labeledFormula ? (
        <p className="miniapp-formula">
          <span className="miniapp-note-label">{t.formula}</span>
          <span className="miniapp-formula-text">{labeledFormula}</span>
        </p>
      ) : null}
      <p className="miniapp-formula">
        <span className="miniapp-note-label">{asText(block.label, t.result)}</span>
        <span className="miniapp-result">{displayValue}</span>
      </p>
    </div>
  );
}
