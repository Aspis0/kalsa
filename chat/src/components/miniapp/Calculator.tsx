import { useState } from "react";
import { evaluateCalculatorFormula } from "../../lib/miniapp/calculator";
import { asArray, asNumber, asRecord, asText, formatNumber } from "./values";

/**
 * A `calculator` block: one numeric input per field, and the result evaluated
 * live through the ported parser — never eval, never Function.
 */

const MAX_FIELDS = 24;

export function Calculator({ block }: { block: Record<string, unknown> }) {
  const fields = asArray(block.fields, MAX_FIELDS).map(asRecord);
  const [values, setValues] = useState<Record<string, number>>(() => {
    const seed: Record<string, number> = {};
    fields.forEach((field, index) => {
      seed[asText(field.id, `field_${index}`)] = asNumber(field.value);
    });
    return seed;
  });
  const formula = asText(block.formula ?? block.expr, "");
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
                  setValues((current) => ({
                    ...current,
                    [id]: asNumber(event.target.value, current[id]),
                  }))
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
