import { useState } from "react";
import { evaluateCalculatorFormula } from "../../lib/miniapp/calculator";
import { calculatorValues, recordCalculatorValues } from "../../lib/miniapp/state";
import { MAX_CALCULATOR_FIELDS } from "../../lib/miniapp/quickCalculator";
import { asArray, asNumber, asRecord, asText, formatNumber } from "./values";

/**
 * A `calculator` block: one numeric input per field, and the result evaluated
 * live through the ported parser — never eval, never Function. The field cap
 * is the builder's own, so a formula can never reference a field this refuses
 * to draw. Each edit is written through to the envelope's state, so the next
 * turn's wire carries the values the person left.
 */

export function Calculator({
  block,
  state,
  onState,
}: {
  block: Record<string, unknown>;
  state?: Record<string, unknown>;
  onState?: (state: Record<string, unknown>) => void;
}) {
  const fields = asArray(block.fields, MAX_CALCULATOR_FIELDS).map(asRecord);
  const stored = calculatorValues(state);
  const [values, setValues] = useState<Record<string, number>>(() => {
    const seed: Record<string, number> = {};
    fields.forEach((field, index) => {
      const id = asText(field.id, `field_${index}`);
      seed[id] = stored?.[id] ?? asNumber(field.value);
    });
    return seed;
  });
  const formula = asText(block.formula ?? block.expr, "");

  // One road for both the input's own state and the envelope's: the result is
  // stored with the values, and a formula that currently evaluates to nothing
  // stores no result — the absence is the fact.
  function edit(next: Record<string, number>): void {
    setValues(next);
    const live = formula ? evaluateCalculatorFormula(formula, next) : null;
    onState?.(recordCalculatorValues(state ?? {}, next, live && live.ok ? live.value : null));
  }

  const live = formula ? evaluateCalculatorFormula(formula, values) : null;
  let displayValue: string;
  if (live && live.ok) {
    displayValue = formatNumber(live.value, 4);
  } else if (live && !live.ok) {
    displayValue = "Unsupported formula";
  } else {
    displayValue = asText(block.value ?? block.result, "No result.");
  }

  return (
    <div className="miniapp-block">
      <p className="miniapp-block-title">{asText(block.title, "Calculator")}</p>
      <div className="miniapp-fields">
        {fields.map((field, index) => {
          const id = asText(field.id, `field_${index}`);
          const unit = asText(field.unit);
          const label = asText(field.label, id) + (unit ? ` (${unit})` : "");
          return (
            <label className="miniapp-field" key={id}>
              <span className="miniapp-field-label">{label}</span>
              <input
                className="miniapp-input"
                inputMode="decimal"
                value={String(values[id] ?? "")}
                onChange={(event) =>
                  edit({
                    ...values,
                    [id]: asNumber(event.target.value, values[id]),
                  })
                }
              />
            </label>
          );
        })}
      </div>
      {formula ? (
        <p className="miniapp-formula">
          <span className="miniapp-note-label">Formula</span>
          <span className="miniapp-formula-text">{formula}</span>
        </p>
      ) : null}
      <p className="miniapp-formula">
        <span className="miniapp-note-label">{asText(block.label, "Result")}</span>
        <span className="miniapp-result">{displayValue}</span>
      </p>
    </div>
  );
}
