export type EngineKind = "reference" | "fork" | "engine";
export interface Review {
  commit: string;
  date: string;
  upstream: string;
}

export interface Benchmark {
  source: string;
  machine: string;
  chipTag: string;
  model: string;
  quant: string;
  decodeTokS: number | null;
  prefillTokS: number | null;
  baseline: string;
  baselineDecodeTokS: number | null;
  baselinePrefillTokS: number | null;
  note: string | null;
}

export interface Engine {
  id: string;
  name: string;
  repo: string;
  author: string;
  license: string;
  kind: EngineKind;
  upstream: string | null;
  hardware: string[];
  summary: string;
  recommendable: boolean;
  note: string | null;
  benchmark: Benchmark[];
  reviewed: Review | null;
}

export interface EngineMachine {
  chipName: string;
  chipTag: string;
  cores: number | null;
  ramBytes: number;
}

export interface Pick {
  engineId: string;
  benchmark: Benchmark | null;
  reason: string;
  sameChip: boolean;
  exactMachine: boolean;
  metric: "decode" | "prefill" | null;
  figureLabel: string | null;
  gain: number | null;
  gainLabel: string | null;
  chipLabel: string | null;
  recommendable: boolean;
}

export interface EnginesView {
  machine: EngineMachine;
  engines: Engine[];
  picks: Pick[];
}
