const MAX_SERIES_VALUES = 200;

const GRUBBS_ALPHA_0_05_CRITICAL = {
  3: 1.153,
  4: 1.463,
  5: 1.672,
  6: 1.822,
  7: 1.938,
  8: 2.032,
  9: 2.11,
  10: 2.176,
  11: 2.234,
  12: 2.285,
  13: 2.331,
  14: 2.371,
  15: 2.409,
  16: 2.443,
  17: 2.475,
  18: 2.504,
  19: 2.532,
  20: 2.557,
  25: 2.663,
  30: 2.745,
  40: 2.928,
  50: 3.128,
  100: 3.384,
  200: 3.715,
};

function toFiniteNumber(value) {
  const parsed = Number(String(value ?? "").trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function normalizeSeries(values) {
  if (!Array.isArray(values)) return [];
  return values
    .slice(0, MAX_SERIES_VALUES)
    .map((value) => {
      if (Array.isArray(value)) return toFiniteNumber(value[1] ?? value[0]);
      if (value && typeof value === "object") return toFiniteNumber(value.value ?? value.y ?? value.measurement);
      return toFiniteNumber(value);
    })
    .filter((value) => value !== null);
}

function grubbsCriticalValue(count) {
  const keys = Object.keys(GRUBBS_ALPHA_0_05_CRITICAL).map(Number).sort((a, b) => a - b);
  for (const key of keys) {
    if (count <= key) return GRUBBS_ALPHA_0_05_CRITICAL[key];
  }
  return GRUBBS_ALPHA_0_05_CRITICAL[200];
}

function computeStatistics(values) {
  const series = normalizeSeries(values);
  const count = series.length;
  if (!count) {
    return {
      count: 0,
      max: 0,
      mean: 0,
      min: 0,
      outlier: null,
      populationStdDev: 0,
      sampleStdDev: 0,
    };
  }

  const sum = series.reduce((total, value) => total + value, 0);
  const mean = sum / count;
  const squaredDeviations = series.map((value) => (value - mean) ** 2);
  const populationVariance = squaredDeviations.reduce((total, value) => total + value, 0) / count;
  const sampleVariance = count > 1 ? squaredDeviations.reduce((total, value) => total + value, 0) / (count - 1) : 0;
  const sampleStdDev = Math.sqrt(sampleVariance);
  const maxDeviation = series.reduce(
    (current, value, index) => {
      const deviation = Math.abs(value - mean);
      return deviation > current.deviation ? { deviation, index, value } : current;
    },
    { deviation: -1, index: 0, value: series[0] },
  );
  const gStatistic = sampleStdDev > 0 ? maxDeviation.deviation / sampleStdDev : 0;
  const criticalValue = count >= 3 ? grubbsCriticalValue(count) : 0;

  return {
    count,
    max: Math.max(...series),
    mean: round(mean),
    min: Math.min(...series),
    outlier: count >= 3
      ? {
          criticalValue: round(criticalValue),
          gStatistic: round(gStatistic),
          index: maxDeviation.index,
          isOutlier: gStatistic > criticalValue,
          method: "grubbs_approx_alpha_0_05",
          value: maxDeviation.value,
        }
      : null,
    populationStdDev: round(Math.sqrt(populationVariance)),
    sampleStdDev: round(sampleStdDev),
  };
}

function normalizeVolumeToMl(volume, unit) {
  const numeric = toFiniteNumber(volume) ?? 0;
  const normalizedUnit = String(unit || "mL").trim().toLowerCase();
  if (normalizedUnit === "l" || normalizedUnit === "liter" || normalizedUnit === "litre") return { ok: true, value: numeric * 1000 };
  if (normalizedUnit === "ul" || normalizedUnit === "µl" || normalizedUnit === "μl") return { ok: true, value: numeric / 1000 };
  if (normalizedUnit === "ml" || normalizedUnit === "milliliter" || normalizedUnit === "millilitre") return { ok: true, value: numeric };
  return { error: "unsupported_volume_unit", ok: false, value: null };
}

function normalizeDensityToGPerMl(density, unit) {
  const numeric = toFiniteNumber(density) ?? 0;
  const normalizedUnit = String(unit || "g/mL").trim().toLowerCase();
  if (normalizedUnit === "mg/ml" || normalizedUnit === "mg per ml") return { ok: true, value: numeric / 1000 };
  if (normalizedUnit === "kg/l" || normalizedUnit === "kg per l") return { ok: true, value: numeric };
  if (normalizedUnit === "g/ml" || normalizedUnit === "g per ml") return { ok: true, value: numeric };
  return { error: "unsupported_density_unit", ok: false, value: null };
}

function convertVolumeDensityToMass({ density, densityUnit = "g/mL", volume, volumeUnit = "mL" }) {
  const volumeResult = normalizeVolumeToMl(volume, volumeUnit);
  const densityResult = normalizeDensityToGPerMl(density, densityUnit);
  if (!volumeResult.ok || !densityResult.ok) {
    return {
      densityGPerMl: densityResult.value,
      error: volumeResult.error || densityResult.error,
      formula: "mass = volume_mL x density_g_per_mL",
      mass: null,
      massUnit: "g",
      ok: false,
      volumeMl: volumeResult.value,
    };
  }
  const volumeMl = volumeResult.value;
  const densityGPerMl = densityResult.value;
  return {
    densityGPerMl: round(densityGPerMl),
    formula: "mass = volume_mL x density_g_per_mL",
    mass: round(volumeMl * densityGPerMl),
    massUnit: "g",
    ok: true,
    volumeMl: round(volumeMl),
  };
}

function normalizePoints(points) {
  if (!Array.isArray(points)) return [];
  return points
    .slice(0, MAX_SERIES_VALUES)
    .map((point, index) => {
      if (Array.isArray(point)) {
        const x = toFiniteNumber(point[0]);
        const y = toFiniteNumber(point[1]);
        return x !== null && y !== null ? { x, y } : null;
      }
      if (point && typeof point === "object") {
        const x = toFiniteNumber(point.x ?? point.label ?? index + 1);
        const y = toFiniteNumber(point.y ?? point.value);
        return x !== null && y !== null ? { x, y } : null;
      }
      const y = toFiniteNumber(point);
      return y !== null ? { x: index + 1, y } : null;
    })
    .filter(Boolean);
}

function calculateR2(points, predict) {
  if (!points.length) return 0;
  const meanY = points.reduce((total, point) => total + point.y, 0) / points.length;
  const sst = points.reduce((total, point) => total + (point.y - meanY) ** 2, 0);
  if (sst === 0) return 1;
  const sse = points.reduce((total, point) => total + (point.y - predict(point.x)) ** 2, 0);
  return round(1 - sse / sst);
}

function fitLinear(points) {
  const n = points.length;
  const sumX = points.reduce((total, point) => total + point.x, 0);
  const sumY = points.reduce((total, point) => total + point.y, 0);
  const sumXY = points.reduce((total, point) => total + point.x * point.y, 0);
  const sumX2 = points.reduce((total, point) => total + point.x ** 2, 0);
  const denominator = n * sumX2 - sumX ** 2;
  const slope = denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator;
  const intercept = n ? (sumY - slope * sumX) / n : 0;
  const predict = (x) => slope * x + intercept;
  return {
    coefficients: { intercept: round(intercept), slope: round(slope) },
    equation: `y = ${round(slope, 3)}x + ${round(intercept, 3)}`,
    fitType: "linear",
    points,
    predicted: points.map((point) => ({ x: point.x, y: round(predict(point.x)) })),
    r2: calculateR2(points, predict),
  };
}

function solve3x3(matrix, vector) {
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let pivot = 0; pivot < 3; pivot += 1) {
    let maxRow = pivot;
    for (let row = pivot + 1; row < 3; row += 1) {
      if (Math.abs(rows[row][pivot]) > Math.abs(rows[maxRow][pivot])) maxRow = row;
    }
    if (Math.abs(rows[maxRow][pivot]) < 1e-12) return [0, 0, 0];
    [rows[pivot], rows[maxRow]] = [rows[maxRow], rows[pivot]];
    const pivotValue = rows[pivot][pivot];
    for (let col = pivot; col < 4; col += 1) rows[pivot][col] /= pivotValue;
    for (let row = 0; row < 3; row += 1) {
      if (row === pivot) continue;
      const factor = rows[row][pivot];
      for (let col = pivot; col < 4; col += 1) rows[row][col] -= factor * rows[pivot][col];
    }
  }
  return [rows[0][3], rows[1][3], rows[2][3]];
}

function fitQuadratic(points) {
  if (points.length < 3) return fitLinear(points);
  const n = points.length;
  const sx = points.reduce((total, point) => total + point.x, 0);
  const sx2 = points.reduce((total, point) => total + point.x ** 2, 0);
  const sx3 = points.reduce((total, point) => total + point.x ** 3, 0);
  const sx4 = points.reduce((total, point) => total + point.x ** 4, 0);
  const sy = points.reduce((total, point) => total + point.y, 0);
  const sxy = points.reduce((total, point) => total + point.x * point.y, 0);
  const sx2y = points.reduce((total, point) => total + point.x ** 2 * point.y, 0);
  const [c, b, a] = solve3x3(
    [
      [n, sx, sx2],
      [sx, sx2, sx3],
      [sx2, sx3, sx4],
    ],
    [sy, sxy, sx2y],
  );
  const predict = (x) => a * x ** 2 + b * x + c;
  return {
    coefficients: { a: round(a), b: round(b), c: round(c) },
    equation: `y = ${round(a, 3)}x^2 + ${round(b, 3)}x + ${round(c, 3)}`,
    fitType: "quadratic",
    points,
    predicted: points.map((point) => ({ x: point.x, y: round(predict(point.x)) })),
    r2: calculateR2(points, predict),
  };
}

function fitRegression(rawPoints, fitType = "linear") {
  const points = normalizePoints(rawPoints);
  if (points.length < 2) {
    return {
      coefficients: {},
      equation: "not enough points",
      fitType: fitType === "quadratic" ? "quadratic" : "linear",
      points,
      predicted: [],
      r2: 0,
    };
  }
  return fitType === "quadratic" ? fitQuadratic(points) : fitLinear(points);
}

module.exports = {
  computeStatistics,
  convertVolumeDensityToMass,
  fitRegression,
};
