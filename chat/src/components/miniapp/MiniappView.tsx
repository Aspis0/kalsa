import type { Miniapp } from "../../lib/miniapp/types";
import { Calculator } from "./Calculator";
import { DataTable } from "./DataTable";
import { MetricStrip } from "./MetricStrip";
import { Quiz } from "./Quiz";
import { Timeline } from "./Timeline";
import "./Miniapp.css";

/**
 * The miniapp a `create_miniapp` call built, inline in the thread. One block
 * per block the model asked for; a type this build does not draw renders
 * nothing at all.
 */
export function MiniappView({ miniapp }: { miniapp: Miniapp }) {
  if (miniapp.blocks.length === 0) return null;
  return (
    <section className="miniapp" aria-label={`Interactive miniapp: ${miniapp.title}`}>
      <p className="miniapp-title">{miniapp.title}</p>
      {miniapp.blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </section>
  );
}

function Block({ block }: { block: Record<string, unknown> }) {
  switch (block.type) {
    case "data_table":
      return <DataTable block={block} />;
    case "calculator":
      return <Calculator block={block} />;
    case "quiz":
      return <Quiz block={block} />;
    case "metric_strip":
      return <MetricStrip block={block} />;
    case "timeline":
      return <Timeline block={block} />;
    default:
      return null;
  }
}
