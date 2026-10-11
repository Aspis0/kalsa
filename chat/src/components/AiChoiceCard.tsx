import type { ReactNode } from "react";
import { useLanguage } from "../i18n/useLanguage";
import { wholeGigabytes } from "../lib/downloadBytes";
import { Icon } from "./Icon";
import "./AiChoiceCard.css";

/** What a card may claim. `null` claims nothing: the card is titled with the
    model's name, for an option the backend's facts call neither. */
export type AiKind = "smartest" | "quickest" | null;

/** One of the AI choices (RULES.md "AI cards"), holding `children`: the in-use
    line or the switch button. */
export function AiChoiceCard({
  kind,
  name,
  model,
  needsBytes,
  chosen,
  chip,
  children,
}: {
  kind: AiKind;
  /** The model's short name, the title of a card that claims nothing. */
  name: string;
  /** The model's name with its maker, the small line. */
  model: string;
  needsBytes: number;
  chosen: boolean;
  /** The chip beside the title: "In use" or "Chosen". */
  chip?: string;
  children?: ReactNode;
}) {
  const { table, tag } = useLanguage();
  const t = table.machine;
  return (
    <div className={`ai-card${chosen ? " is-chosen" : ""}`}>
      <span className="ai-card-icon">
        <Icon name={kind === "smartest" ? "bookOpen" : kind === "quickest" ? "zap" : "leaf"} size={26} />
      </span>
      <span className="ai-card-title">
        {kind === "smartest" ? t.smartest : kind === "quickest" ? t.quickest : name}
        {chip ? <em>{chip}</em> : null}
      </span>
      {kind ? <span className="ai-card-line">{kind === "smartest" ? t.smartestLine : t.quickestLine}</span> : null}
      <span className="ai-card-need">
        <Icon name="download" size={20} />
        {t.needsSpace(wholeGigabytes(needsBytes, tag))}
      </span>
      <small className="ai-card-model">{model}</small>
      {children}
    </div>
  );
}
