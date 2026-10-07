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
 * turn's wire carries the values the person left. A field the builder lifted
 * from a bare literal has ids like `n1` and no label; it is named here, in
 * the interface's language.
 */

const LIFTED_ID = /^n(\d+)$/;

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
  const { table } = useLanguage();
  const t = table.miniapp;
  const fields = asArray(block.fields, MAX_CALCULATOR_FIELDS).map(asRecord);
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
    displayValue = formatNumber(live.value, 4);
  } else if (live && !live.ok) {
    displayValue = t.unsupportedFormula;
  } else {
    displayValue = asText(block.value ?? block.result, t.noResult);
  }

  return (
    <div className="miniapp-block">
      <p className="miniapp-block-title">{asText(block.title, t.calculator)}</p>
      <div className="miniapp-fields">
        {fields.map((field, index) => {
          const id = asText(field.id, `field_${index}`);
          const unit = asText(field.unit);
          const lifted = LIFTED_ID.exec(id);
          const name =
            asText(field.label, "") || (lifted ? t.numberField(Number(lifted[1])) : t.numberField(index + 1));
          const label = name + (unit ? ` (${unit})` : "");
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
      {formula ? (
        <p className="miniapp-formula">
          <span className="miniapp-note-label">{t.formula}</span>
          <span className="miniapp-formula-text">{formula}</span>
        </p>
      ) : null}
      <p className="miniapp-formula">
        <span className="miniapp-note-label">{asText(block.label, t.result)}</span>
        <span className="miniapp-result">{displayValue}</span>
      </p>
    </div>
  );
}
