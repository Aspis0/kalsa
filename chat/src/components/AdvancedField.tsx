import type { ReactNode } from "react";
import type { KnobCopy } from "../lib/knobs/types";
import { KnobInfo } from "./KnobInfo";

export interface AdvancedFieldProps {
  id: string;
  knob: KnobCopy;
  help: string;
  children: ReactNode;
  check?: boolean;
}

export function AdvancedField({ id, knob, said, help, children, check = false }: AdvancedFieldProps & { said: { label: string; whatItIs: string; whatItsFor: string; usualValues: string | null } }): JSX.Element {
  return (
    <div className={`advanced-field${check ? " advanced-field-check" : ""}`}>
      <div className="advanced-field-heading">
        <label className="advanced-field-label" htmlFor={id}>{said.label}</label>
        <KnobInfo knob={knob} label={said.label} whatItIs={said.whatItIs} whatItsFor={said.whatItsFor} usualValues={said.usualValues} />
      </div>
      {children}
      <p className="advanced-help">{help}</p>
    </div>
  );
}
