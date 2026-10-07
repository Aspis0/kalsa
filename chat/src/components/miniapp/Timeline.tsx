import { useLanguage } from "../../i18n/useLanguage";
import { asArray, asRecord, asText } from "./values";

/**
 * A `timeline` block, the shape old saved checklists were built as:
 * `steps[]` of {title}. `items[]` and `events[]` are read too, as on the
 * phone, and the whole list is capped at 50. A checklist's own block renders
 * as the tickable list; this plain reader is for a timeline under any other
 * kind.
 */

const MAX_ENTRIES = 50;

export function Timeline({ block }: { block: Record<string, unknown> }) {
  const { table } = useLanguage();
  const t = table.miniapp;
  const entries = [
    ...asArray(block.items, MAX_ENTRIES),
    ...asArray(block.steps, MAX_ENTRIES),
    ...asArray(block.events, MAX_ENTRIES),
  ].slice(0, MAX_ENTRIES);

  return (
    <div className="miniapp-block">
      <p className="miniapp-block-title">{asText(block.title, t.timeline)}</p>
      {entries.length === 0 ? <p className="miniapp-note">{t.noTimelineEntries}</p> : null}
      <ol className="miniapp-steps">
        {entries.map((entry, index) => {
          const record = asRecord(entry);
          const when = asText(record.time, asText(record.when));
          const title = asText(record.title, asText(record.label));
          const output = asText(record.output);
          return (
            <li className="miniapp-step" key={String(record.id ?? index)}>
              <p className="miniapp-step-head">
                {t.step(index + 1)}
                {when ? ` • ${when}` : ""}
              </p>
              {title ? <p className="miniapp-step-title">{title}</p> : null}
              {output ? <p className="miniapp-step-output">{output}</p> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
