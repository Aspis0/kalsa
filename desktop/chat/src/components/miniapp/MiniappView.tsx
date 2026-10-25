import type { Miniapp } from "../../lib/miniapp/types";
import { useLanguage } from "../../i18n/useLanguage";
import { Calculator } from "./Calculator";
import { Checklist } from "./Checklist";
import { DataTable } from "./DataTable";
import { MetricStrip } from "./MetricStrip";
import { Quiz } from "./Quiz";
import { Timeline } from "./Timeline";
import { displayTitle } from "./title";
import { Icon } from "../Icon";
import type { IconName } from "../Icon";
import { checklistItems, isItemTicked } from "../../lib/miniapp/state";
import "./Miniapp.css";

/** The header's mark, by the widget the card opens with. */
const MARKS: Record<string, IconName> = {
  calculator: "gauge",
  quiz: "help",
  checklist: "check",
  data_table: "sort",
};

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
  // The type comes from the model: "constructor" must not reach Object.prototype.
  const firstType = String(miniapp.blocks[0].type);
  const mark = Object.hasOwn(MARKS, firstType) ? MARKS[firstType] : undefined;
  // A lone checklist says how far it got in its header (12-miniapps-checklist).
  const list = miniapp.blocks.length === 1 && miniapp.blocks[0].type === "checklist" ? checklistItems(miniapp.blocks[0]) : null;
  const done = list ? list.filter((item) => isItemTicked(miniapp.state, item.id)).length : 0;
  return (
    <section className="miniapp" aria-label={table.miniapp.viewAria(title)}>
      <p className="miniapp-title">
        {mark ? (
          <span className="miniapp-mark">
            <Icon name={mark} size={17} />
          </span>
        ) : null}
        {title}
        {list && list.length > 0 ? <span className="miniapp-count">{table.miniapp.ticked(done, list.length)}</span> : null}
      </p>
      <div className="miniapp-body">
        {miniapp.blocks.map((block, index) => (
          <Block key={index} miniapp={miniapp} block={block} index={index} onState={onState} />
        ))}
      </div>
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
      return <DataTable block={block} envelopeTitle={miniapp.title} />;
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
