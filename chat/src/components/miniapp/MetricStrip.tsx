import { asArray, asRecord, asText, formatNumber } from "./values";

/**
 * A `metric_strip` block: the label/value pairs the model asked for, value
 * formatted the way the phone formats it (numbers through formatNumber,
 * everything else as written).
 */

const MAX_METRICS = 12;

function metricValue(metric: Record<string, unknown>): string {
  const raw = metric.value;
  if (typeof raw === "number") return formatNumber(raw);
  return asText(raw, "--");
}

export function MetricStrip({ block }: { block: Record<string, unknown> }) {
  const metrics = asArray(block.metrics, MAX_METRICS).map(asRecord);
  return (
    <div className="miniapp-block">
      {asText(block.title) ? (
        <p className="miniapp-block-title">{asText(block.title)}</p>
      ) : null}
      <div className="miniapp-metrics">
        {metrics.map((metric, index) => {
          const unit = asText(metric.unit);
          return (
            <div className="miniapp-metric" key={index}>
              <p className="miniapp-metric-label">{asText(metric.label, asText(metric.id))}</p>
              <p className="miniapp-metric-value">
                {metricValue(metric)}
                {unit ? <span className="miniapp-metric-unit"> {unit}</span> : null}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
