export type KnobLevel = "message" | "start";
export type SamplingKind = "number" | "integer";
export type LaunchKind = "integer" | "choice" | "boolean";

export interface KnobCopy {
  wire: string;
  label: string;
  group: string;
  level: KnobLevel;
  whatItIs: string;
  whatItsFor: string;
  usualValues: string | null;
  automaticSentinels?: readonly number[];
  automaticDescription?: string;
}

export interface SamplingKnob extends KnobCopy {
  kind: SamplingKind;
  min: number;
  max: number;
  step: number;
}

export interface LaunchKnob extends KnobCopy {
  kind: LaunchKind;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly string[];
}
