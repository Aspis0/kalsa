import type { ReactNode } from "react";
import { useLanguage } from "../i18n/useLanguage";
import { wholeGigabytes } from "../lib/downloadBytes";
import { Icon } from "./Icon";
import "./AiChoiceCard.css";

/** What a card may claim. `null` claims nothing: the card is titled with the
    model's name, for an option the backend's facts call neither. */
export type AiKind = "smartest" | "quickest" | null;

/** One of the AI choices (RULES.md "AI cards"). On Your AI it holds
    `children`, the in-use line or the switch button; with `onSelect` it is
    the first run's pick, the whole card one radio of its group. */
export function AiChoiceCard({
  kind,
  name,
  model,
  needsBytes,
  chosen,
  chip,
  onDisk = false,
  onSelect,
  children,
}: {
  kind: AiKind;
  /** The model's short name, the title of a card that claims nothing. */
  name: string;
  /** The model's name with its maker, the small line. */
  model: string;
  needsBytes: number;
  chosen: boolean;
  /** The chip beside the title: "In use", "Chosen" or "Recommended". */
  chip?: string;
  /** Already downloaded: the space line says so instead of asking for room. */
  onDisk?: boolean;
  onSelect?: () => void;
  children?: ReactNode;
}) {
  const { table, tag } = useLanguage();
  const t = table.machine;
  const className = `ai-card${chosen ? " is-chosen" : ""}${onSelect ? " is-pick" : ""}`;
  const body = (
    <>
      {onSelect ? <span className="ai-card-mark">{chosen ? <Icon name="check" size={16} stroke={3} /> : null}</span> : null}
      <span className="ai-card-icon">
        <Icon name={kind === "smartest" ? "bookOpen" : kind === "quickest" ? "zap" : "leaf"} size={26} />
      </span>
      <span className="ai-card-title">
        {kind === "smartest" ? t.smartest : kind === "quickest" ? t.quickest : name}
        {chip ? <em>{chip}</em> : null}
      </span>
      {kind ? <span className="ai-card-line">{kind === "smartest" ? t.smartestLine : t.quickestLine}</span> : null}
      {onDisk ? (
        <span className="ai-card-need is-on-disk">
          <Icon name="check" size={20} stroke={2.4} />
          {table.setup.alreadyOnComputer}
        </span>
      ) : (
        <span className="ai-card-need">
          <Icon name="download" size={20} />
          {t.needsSpace(wholeGigabytes(needsBytes, tag))}
        </span>
      )}
      <small className="ai-card-model">{model}</small>
    </>
  );
  return onSelect ? (
    // One tab stop for the group: the chosen card; the arrows move between them.
    <button type="button" role="radio" aria-checked={chosen} tabIndex={chosen ? 0 : -1} className={className} onClick={onSelect}>
      {body}
    </button>
  ) : (
    <div className={className}>
      {body}
      {children}
    </div>
  );
}
