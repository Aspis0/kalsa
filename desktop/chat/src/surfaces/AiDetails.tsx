import { useId, useState } from "react";
import { Icon } from "../components/Icon";
import { useLanguage } from "../i18n/useLanguage";
import { wholeGigabytes } from "../lib/downloadBytes";
import { speedLine } from "../lib/speed";
import { shownSpeed, speedText, tokensText } from "./MachineCard";
import type { ModelOption } from "./MachineCard";
import "./AiPage.css";

/** The Your AI page's Details (mockups 07-ai-page, 14-home-states-ai-details-live):
    the only place on the page with technical figures, and only the in-use
    model's. A reading the server has not given is left out, never said as 0. */
export function AiDetails({
  option,
  tokensPerSecond,
  phones,
  contextSplit,
  reason,
}: {
  /** The option Kalsa runs or starts with; null when it is none of the cards. */
  option: ModelOption | null;
  tokensPerSecond: number | null;
  phones: number | null;
  /** The launch's context as the reader meets it: the window one chat gets
      and how many chats the engine serves at once. */
  contextSplit: { perSlot: number; slots: number } | null;
  /** Why Kalsa chose what it runs, for this start. */
  reason: string | null;
}) {
  const { table, tag } = useLanguage();
  const t = table.machine;
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  const rows: [string, string][] = [];
  if (tokensPerSecond !== null) rows.push([t.speedNow, speedLine(t, tag, tokensPerSecond)]);
  if (option) {
    rows.push([t.speedHere, speedText(t, shownSpeed(t, option), tag)]);
    rows.push([t.spaceOnDisk, t.gigabytes(wholeGigabytes(option.download_bytes, tag))]);
  }
  if (contextSplit) {
    rows.push([t.longestChat, t.longestChatValue(tokensText(contextSplit.perSlot))]);
    rows.push([t.chatsAtOnce, new Intl.NumberFormat(tag).format(contextSplit.slots)]);
  }
  if (phones !== null) rows.push([t.phonesNow, new Intl.NumberFormat(tag).format(phones)]);
  if (rows.length === 0 && !reason) return null;

  return (
    <section className="ai-details">
      <button
        type="button"
        className="ai-details-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
      >
        {t.details}
        <Icon name={open ? "down" : "right"} size={15} stroke={2.2} />
      </button>
      {open ? (
        <div id={bodyId}>
          <dl className="ai-details-rows">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {reason ? <p className="surface-sentence">{reason}</p> : null}
          {option ? <p className="ai-details-note">{t.speedsHeld}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
