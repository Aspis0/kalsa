import type { Miniapp } from "../../lib/miniapp/types";
import { useLanguage } from "../../i18n/useLanguage";
import { Calculator } from "./Calculator";
import { Checklist } from "./Checklist";
import { DataTable } from "./DataTable";
import { MetricStrip } from "./MetricStrip";
import { Quiz } from "./Quiz";
import { Timeline } from "./Timeline";
import { displayTitle } from "./title";
import "./Miniapp.css";

/**
 * The miniapp a `create_miniapp` call built, inline in the thread. One block
 * per block the model asked for; a type this build does not draw renders
 * nothing at all. `onState` is the write-back a widget's interaction goes
 * through — the ticks, picks and edits land in the stored message.
 */
export function MiniappView({
  miniapp,
  onState,
}: {
  miniapp: Miniapp;
  onState?: (state: Record<string, unknown>) => void;
}) {
  const { table } = useLanguage();
  if (miniapp.blocks.length === 0) return null;
  // A title the model never gave is named here, in the interface's language;
  // nothing English is persisted as a default the person would read.
  const named = table.miniapp.named as Record<string, string>;
  const title = displayTitle(miniapp.title, miniapp.kind, named);
  return (
    <section className="miniapp" aria-label={table.miniapp.viewAria(title)}>
      <p className="miniapp-title">{title}</p>
      {miniapp.blocks.map((block, index) => (
        <Block key={index} miniapp={miniapp} block={block} index={index} onState={onState} />
      ))}
    </section>
  );
}

function Block({
  miniapp,
  block,
  index,
  onState,
}: {
  miniapp: Miniapp;
  block: Record<string, unknown>;
  index: number;
  onState?: (state: Record<string, unknown>) => void;
}) {
  switch (block.type) {
    case "data_table":
      return <DataTable block={block} />;
    case "calculator":
      return <Calculator block={block} state={miniapp.state} onState={onState} />;
    case "quiz":
      return <Quiz miniapp={miniapp} block={block} index={index} onState={onState} />;
    case "metric_strip":
      return <MetricStrip block={block} />;
    case "checklist":
      return <Checklist miniapp={miniapp} block={block} onState={onState} />;
    case "timeline":
      // Every timeline block this app ever built belonged to a checklist;
      // old saved conversations render as the tickable list it became. A
      // timeline under any other kind keeps the plain reader.
      return miniapp.kind === "checklist" ? (
        <Checklist miniapp={miniapp} block={block} onState={onState} />
      ) : (
        <Timeline block={block} />
      );
    default:
      return null;
  }
}
