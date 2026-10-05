/**
 * kpi_strip → a single `metric_strip` block, 1..8 metrics. Each metric needs
 * a non-empty label and a value (string or number); `unit` and `tone` are
 * optional and passed through.
 */

import { asString, asStringCapped, envelope, isPlainObject } from "./slots";
import type { Miniapp } from "./types";

const MAX_METRICS = 8;

export function buildKpiStrip(slots: Record<string, unknown>): Miniapp | null {
  const rawMetrics = slots.metrics;
  if (!Array.isArray(rawMetrics)) return null;
  if (rawMetrics.length < 1 || rawMetrics.length > MAX_METRICS) return null;

  const metrics: Record<string, unknown>[] = [];
  for (const metric of rawMetrics) {
    if (!isPlainObject(metric)) return null;
    const label = asStringCapped(metric.label);
    if (!label) return null;
    const value = metric.value;
    if (
      value === undefined ||
      value === null ||
      (typeof value !== "string" && typeof value !== "number")
    ) {
      return null;
    }
    const entry: Record<string, unknown> = { label, value };
    const unit = asString(metric.unit);
    if (unit) entry.unit = unit;
    const tone = asString(metric.tone);
    if (tone) entry.tone = tone;
    metrics.push(entry);
  }

  const block: Record<string, unknown> = { type: "metric_strip", metrics };
  const title = asString(slots.title);
  if (title) block.title = title;
  return envelope("kpi_strip", title ?? "KPIs", [block]);
}
