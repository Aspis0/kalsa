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

export function AdvancedField({ id, knob, help, children, check = false }: AdvancedFieldProps): JSX.Element {
  return (
    <div className={`advanced-field${check ? " advanced-field-check" : ""}`}>
      <div className="advanced-field-heading">
        <label className="advanced-field-label" htmlFor={id}>{knob.label}</label>
        <KnobInfo knob={knob} />
      </div>
      {children}
      <p className="advanced-help">{help}</p>
    </div>
  );
}
