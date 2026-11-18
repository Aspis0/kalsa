import { useRef, useState } from "react";
import { AiChoiceCard } from "../components/AiChoiceCard";
import type { AiKind } from "../components/AiChoiceCard";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { useLanguage } from "../i18n/useLanguage";
import { wholeGigabytes } from "../lib/downloadBytes";
import { modelByMaker, modelOnly } from "../lib/modelName";
import type { ModelOption } from "./MachineCard";
import "./AiPage.css";

export interface Ranked<T> {
  kind: AiKind;
  option: T;
}
export type RankedOption = Ranked<ModelOption>;

/** The chooser's options as the cards claim them, Smartest first. The second
    option's reason code (capability.rs `reason_message`) is the backend's
    comparison with the first: "Smartest" goes only where it says "more
    capable", "Quickest" only where it says smaller AND faster. Where its
    facts support neither — a bigger row that is also faster, a lone pick, a
    code this build does not know — the card claims nothing. */
export function rankOptions<T extends { reason_code?: string | null }>(model: T, quicker: T | null): Ranked<T>[] {
  if (!quicker) return [{ kind: null, option: model }];
  switch (quicker.reason_code) {
    case "model.reason.quicker":
      return [{ kind: "smartest", option: model }, { kind: "quickest", option: quicker }];
    case "model.reason.more_capable":
      return [{ kind: "smartest", option: quicker }, { kind: "quickest", option: model }];
    // Smaller but not faster: the first stays the more capable, the second
    // is only lighter, which no title here says alone.
    case "model.reason.quicker_smaller":
      return [{ kind: "smartest", option: model }, { kind: null, option: quicker }];
    default:
      return [{ kind: null, option: model }, { kind: null, option: quicker }];
  }
}

/** The card Kalsa runs, or starts with while off. A running server names its
    model only by display name, which two rows of one model share: the stored
    token settles that, and alone decides while Kalsa is off. */
export function inUseOption(options: RankedOption[], runningName: string | null, chosenId: string | null): RankedOption | null {
  if (!runningName) return options.find(({ option }) => option.id === chosenId) ?? null;
  const named = options.filter(({ option }) => option.name === runningName);
  return named.length === 1 ? named[0] : (named.find(({ option }) => option.id === chosenId) ?? null);
}

/** The cards of the Your AI page and the switch between them (mockups
    07-ai-page, 18-dialogs-switch-ai). */
export function AiChoices({
  options,
  inUse,
  running,
  busy,
  onChoose,
}: {
  options: RankedOption[];
  inUse: RankedOption | null;
  running: boolean;
  busy: boolean;
  onChoose: (token: string) => void;
}) {
  const { table, tag } = useLanguage();
  const t = table.machine;
  const [asking, setAsking] = useState<{ ranked: RankedOption; token: string } | null>(null);
  // Focus goes back to the button that opened the dialog when it closes unanswered.
  const opener = useRef<HTMLButtonElement | null>(null);
  const said = (option: ModelOption) => modelOnly(option.name);

  function close(): void {
    setAsking(null);
    opener.current?.focus();
  }

  return (
    <div className="ai-cards">
      {options.map((ranked) => {
        const { kind, option } = ranked;
        const token = option.id;
        const chosen = ranked === inUse;
        return (
          <AiChoiceCard
            key={option.id ?? option.name}
            kind={kind}
            name={said(option)}
            model={modelByMaker(t, option.name)}
            needsBytes={option.download_bytes}
            chosen={chosen}
            chip={chosen ? (running ? t.inUse : t.chosenChip) : undefined}
          >
            {chosen && running ? (
              <p className="ai-using-now">
                <i aria-hidden="true" />
                {t.usingThisOne}
              </p>
            ) : !chosen && token !== null ? (
              <button
                type="button"
                className="ai-switch"
                disabled={busy}
                onClick={(event) => {
                  opener.current = event.currentTarget;
                  setAsking({ ranked, token });
                }}
              >
                <Icon name="swap" size={17} />
                {kind ? t.switchTo[kind] : t.startAgainOn(said(option))}
              </button>
            ) : null}
          </AiChoiceCard>
        );
      })}
      {asking ? (
        <ConfirmDialog
          icon="swap"
          tone="accent"
          title={asking.ranked.kind ? t.switchAsk[asking.ranked.kind] : t.switchAskNamed(said(asking.ranked.option))}
          body={t.confirmSwitch(said(asking.ranked.option), t.gigabytes(wholeGigabytes(asking.ranked.option.download_bytes, tag)))}
          cancel={t.cancel}
          confirm={t.startAgainOn(said(asking.ranked.option))}
          onCancel={close}
          onConfirm={() => {
            setAsking(null);
            onChoose(asking.token);
          }}
        />
      ) : null}
    </div>
  );
}
