export type EngineKind = "reference" | "fork" | "engine";
export interface Review {
  commit: string;
  date: string;
  upstream: string;
}

/** One metric's gain over the author's baseline, worked out once in Rust. A gain under 5% is noise. */
export interface MetricGain {
  ratio: number;
  gainLabel: string;
  noise: boolean;
  label: string;
}

export interface Gains {
  decode: MetricGain | null;
  prefill: MetricGain | null;
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
  gains: Gains;
}

/** A pinned install recipe, as the catalog states it. Field names are the TOML's own. */
export type InstallRecipe =
  | { kind: "release-archive"; url: string; tag: string; sha256: string; size: number; binary: string }
  | { kind: "pip"; package: string; version: string; python: string; lock: string };

export interface SuggestedModel {
  id: string;
  note: string;
  sizeBytes: number | null;
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
  install: InstallRecipe | null;
  suggestedModels: SuggestedModel[];
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
