export type StatisticsResult = {
  count: number;
  max: number;
  mean: number;
  min: number;
  outlier: null | {
    criticalValue: number;
    gStatistic: number;
    index: number;
    isOutlier: boolean;
    method: string;
    value: number;
  };
  populationStdDev: number;
  sampleStdDev: number;
};

export type MassConversionInput = {
  density: number;
  densityUnit?: string;
  volume: number;
  volumeUnit?: string;
};

export type MassConversionResult = {
  densityGPerMl: number | null;
  error?: "unsupported_density_unit" | "unsupported_volume_unit";
  formula: string;
  mass: number | null;
  massUnit: string;
  ok: boolean;
  volumeMl: number | null;
};

export type RegressionPoint = [number, number] | { label?: number | string; value?: number | string; x?: number | string; y?: number | string };

export type RegressionResult = {
  coefficients: Record<string, number>;
  equation: string;
  fitType: "linear" | "quadratic";
  points: Array<{ x: number; y: number }>;
  predicted: Array<{ x: number; y: number }>;
  r2: number;
};

export function computeStatistics(values: unknown[]): StatisticsResult;
export function convertVolumeDensityToMass(input: MassConversionInput): MassConversionResult;
export function fitRegression(points: RegressionPoint[], fitType?: "linear" | "quadratic"): RegressionResult;
